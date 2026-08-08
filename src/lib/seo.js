/*
 * Search-engine metadata helpers.
 *
 * Everything a crawler reads that is NOT plain page copy lives here: JSON-LD
 * structured data, sitemap generation and the robots policy. Kept out of the
 * view layer because the same graph objects are needed by /sitemap.xml (which
 * renders no HTML at all).
 *
 * Structured data is emitted as `application/ld+json`. Google's documented
 * requirement is that the markup describes content actually visible on the
 * page, so every field below is populated from the same database row the page
 * body renders -- never invented, and never left as a placeholder.
 */

/**
 * Serialise a JSON-LD node for embedding in a <script> element.
 *
 * `</script>` appearing inside a JSON string would terminate the element
 * early, so `<` is escaped as \u003c. JSON.stringify already handles quotes and
 * newlines, and because the output sits inside a script (not an attribute) HTML
 * entity escaping must NOT be applied -- it would corrupt the JSON.
 */
export function ldScript(node) {
  if (!node) return "";
  const json = JSON.stringify(node).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

/** Absolute URL for a site-relative path. Crawlers require absolute URLs. */
export function abs(origin, path = "/") {
  const base = String(origin || "").replace(/\/+$/, "");
  const p = String(path || "/");
  return p.startsWith("http") ? p : `${base}${p.startsWith("/") ? p : `/${p}`}`;
}

const SITE_NAME = "Open Appstore";

/**
 * The publisher node, referenced by @id from other nodes rather than repeated.
 * One canonical description of the organisation avoids the contradictory
 * duplicates that make Google discard a graph.
 */
export function organizationLd(origin) {
  return {
    "@type": "Organization",
    "@id": `${abs(origin, "/")}#organization`,
    name: SITE_NAME,
    url: abs(origin, "/"),
    logo: {
      "@type": "ImageObject",
      url: abs(origin, "/static/icon-512.png"),
      width: 512,
      height: 512
    }
  };
}

/**
 * WebSite node with a SearchAction. This is what can earn a sitelinks search
 * box: the `urlTemplate` must be a real, working search URL on this site --
 * /apps?search= is exactly the endpoint the header search form submits to.
 */
export function websiteLd(origin) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationLd(origin),
      {
        "@type": "WebSite",
        "@id": `${abs(origin, "/")}#website`,
        url: abs(origin, "/"),
        name: SITE_NAME,
        description:
          "Discover, browse and download apps from independent developers \u2014 an open app marketplace with a built-in developer console.",
        publisher: { "@id": `${abs(origin, "/")}#organization` },
        inLanguage: "en",
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${abs(origin, "/apps")}?search={search_term_string}`
          },
          "query-input": "required name=search_term_string"
        }
      }
    ]
  };
}

/**
 * Trail of ancestor pages. Produces the breadcrumb line Google shows in place
 * of a raw URL in results.
 */
export function breadcrumbLd(origin, trail) {
  const items = (trail || []).filter((t) => t && t.name);
  if (!items.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: String(t.name),
      // The final crumb is the current page: schema.org says `item` should be
      // omitted there, since it would only ever link to itself.
      ...(t.path && i < items.length - 1 ? { item: abs(origin, t.path) } : {})
    }))
  };
}

/**
 * SoftwareApplication node for an app detail page.
 *
 * `aggregateRating` is only attached when real reviews exist. Google issues a
 * structured-data penalty for a rating with no reviewCount, and inventing one
 * would misrepresent the app -- so an unreviewed app simply omits the field.
 */
export function appLd(origin, app, developer) {
  const url = abs(origin, `/app/${app.slug || app.id}`);
  const node = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${url}#app`,
    name: app.name,
    url,
    description: app.short_description || app.name,
    applicationCategory: "MobileApplication",
    applicationSubCategory: app.category || "Other",
    operatingSystem: "Android",
    softwareVersion: app.version || undefined,
    inLanguage: "en",
    publisher: { "@id": `${abs(origin, "/")}#organization` }
  };
  if (app.icon_url) node.image = app.icon_url;
  if (Array.isArray(app.screenshots) && app.screenshots.length) {
    node.screenshot = app.screenshots.slice(0, 6);
  }
  if (developer && developer.name) {
    node.author = {
      "@type": "Organization",
      name: developer.name,
      ...(developer.id ? { url: abs(origin, `/developer-profile/${developer.id}`) } : {})
    };
  }
  // Offer is always valid to state: a free app is an offer at price 0.
  node.offers = {
    "@type": "Offer",
    price: app.is_free ? 0 : Number(app.price || 0),
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
    url
  };
  const ratings = Number(app.total_ratings || 0);
  const rating = Number(app.rating || 0);
  if (ratings > 0 && rating > 0) {
    node.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Math.round(rating * 10) / 10,
      ratingCount: ratings,
      reviewCount: ratings,
      bestRating: 5,
      worstRating: 1
    };
  }
  if (Number(app.downloads || 0) > 0) {
    node.interactionStatistic = {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/DownloadAction",
      userInteractionCount: Number(app.downloads)
    };
  }
  return node;
}

/**
 * ItemList for a listing page (browse, category, top charts). Tells a crawler
 * the page is a curated list and what is on it, which is what makes the
 * individual apps discoverable from the collection page.
 */
export function itemListLd(origin, name, apps, limit = 30) {
  const rows = (apps || []).slice(0, limit);
  if (!rows.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: rows.length,
    itemListElement: rows.map((a, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: abs(origin, `/app/${a.slug || a.id}`),
      name: a.name
    }))
  };
}

/** CollectionPage wrapper used by the developers index. */
export function collectionLd(origin, path, name, description) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description,
    url: abs(origin, path),
    isPartOf: { "@id": `${abs(origin, "/")}#website` },
    inLanguage: "en"
  };
}

/** FAQPage / WebPage node for the legal + static pages. */
export function webPageLd(origin, path, name, description) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name,
    description,
    url: abs(origin, path),
    isPartOf: { "@id": `${abs(origin, "/")}#website` },
    inLanguage: "en"
  };
}

/* ------------------------------------------------------------------ *
 * robots.txt / sitemap.xml
 * ------------------------------------------------------------------ */

/**
 * Paths that must never be indexed.
 *
 * /api and /developer are behind auth or return JSON, and /auth pages are
 * transactional. Letting a crawler spend its budget there means fewer app
 * pages get crawled, and an indexed sign-in page is a poor search result.
 */
export const DISALLOW = [
  "/api/",
  "/auth/",
  "/developer",
  "/developer/",
  // Search-result URLs are infinite in number and near-duplicates of /apps.
  "/apps?search=",
  "/*?search="
];

export function robotsTxt(origin) {
  const lines = [
    "# Open Appstore \u2014 https://schema.org/WebSite",
    "User-agent: *"
  ];
  DISALLOW.forEach((p) => lines.push(`Disallow: ${p}`));
  lines.push("Allow: /static/");
  lines.push("Allow: /");
  lines.push("");
  // Crawl-delay is ignored by Google but honoured by Bing/Yandex; a small
  // value protects the Supabase read quota from an aggressive crawler.
  lines.push("User-agent: Bingbot");
  lines.push("Crawl-delay: 1");
  lines.push("");
  lines.push(`Sitemap: ${abs(origin, "/sitemap.xml")}`);
  return `${lines.join("\n")}\n`;
}

function xmlEsc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Normalise a timestamp to the W3C date form sitemaps require. */
function w3c(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Render a urlset. `entries` are `{ path, lastmod, changefreq, priority }`.
 *
 * Priority and changefreq are advisory only (Google ignores both), but Bing
 * and other engines still read them, and they cost nothing to emit.
 */
export function sitemapXml(origin, entries) {
  const body = (entries || [])
    .filter((e) => e && e.path)
    .map((e) => {
      const parts = [`    <loc>${xmlEsc(abs(origin, e.path))}</loc>`];
      const lm = w3c(e.lastmod);
      if (lm) parts.push(`    <lastmod>${lm}</lastmod>`);
      if (e.changefreq) parts.push(`    <changefreq>${e.changefreq}</changefreq>`);
      if (e.priority != null) parts.push(`    <priority>${e.priority}</priority>`);
      // Image extension: an app icon declared here can surface in Google
      // Images and is the only way a crawler learns about an icon hosted on a
      // third-party domain (Drive, GitHub) that it would otherwise skip.
      if (e.image) {
        parts.push("    <image:image>");
        parts.push(`      <image:loc>${xmlEsc(e.image)}</image:loc>`);
        if (e.imageTitle) parts.push(`      <image:title>${xmlEsc(e.imageTitle)}</image:title>`);
        parts.push("    </image:image>");
      }
      return `  <url>\n${parts.join("\n")}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${body}
</urlset>
`;
}

export { SITE_NAME };
