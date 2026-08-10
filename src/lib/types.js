import { normalizeImageUrl, normalizeImageList, normalizeDownloadUrl, isDriveUrl, linkHost } from "./media.js";
const CATEGORIES = [
  "Games",
  "Productivity",
  "Social",
  "Education",
  "Entertainment",
  "Business",
  "Utilities",
  "Health",
  "News",
  "Travel",
  "Shopping",
  "Photography",
  "Finance",
  "Music",
  "Developer Tools"
];
const CATEGORY_META = {
  Games: { icon: "fa-gamepad", color: "#a855f7" },
  Productivity: { icon: "fa-bolt", color: "#3b82f6" },
  Social: { icon: "fa-comments", color: "#ec4899" },
  Education: { icon: "fa-graduation-cap", color: "#f59e0b" },
  Entertainment: { icon: "fa-clapperboard", color: "#ef4444" },
  Business: { icon: "fa-briefcase", color: "#0ea5e9" },
  Utilities: { icon: "fa-screwdriver-wrench", color: "#64748b" },
  Health: { icon: "fa-heart-pulse", color: "#10b981" },
  News: { icon: "fa-newspaper", color: "#f97316" },
  Travel: { icon: "fa-plane", color: "#06b6d4" },
  Shopping: { icon: "fa-bag-shopping", color: "#e11d48" },
  Photography: { icon: "fa-camera", color: "#8b5cf6" },
  Finance: { icon: "fa-chart-line", color: "#22c55e" },
  Music: { icon: "fa-music", color: "#d946ef" },
  "Developer Tools": { icon: "fa-code", color: "#14b8a6" },
  Other: { icon: "fa-cube", color: "#6366f1" }
};
const APP_SELECT = "id,app_id,app_name,app_slug,description,icon_url,screenshots,category,current_version,latest_version,latest_version_code,min_version,is_free,price,download_url,google_drive_link,website,website_link,privacy_policy_link,change_log,auto_update,update_available,email,rating,total_downloads,total_reviews,status,developer_id,store_id,created_at,updated_at";
const APP_SELECT_WITH_DEV = `${APP_SELECT},developers(developer_name,company_name,avatar_url,verified)`;
const APP_SELECT_PLAIN = APP_SELECT;
const DEV_SELECT = "id,user_id,developer_name,company_name,description,website,email,avatar_url,verified,verified_badge,verified_at,apps_count,total_downloads,created_at,updated_at";
const REVIEW_SELECT = "id,app_id,user_id,rating,title,review_text,screenshots,helpful_count,created_at,updated_at";
const ORDER = {
  popular: "total_downloads.desc.nullslast",
  rating: "rating.desc.nullslast",
  newest: "created_at.desc.nullslast",
  name: "app_name.asc",
  reviews: "total_reviews.desc.nullslast"
};
function isFeatured(rating, downloads) {
  return rating >= 4.5 && downloads >= 1e3;
}
function stripMarkdown(md) {
  return md.replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#*_>`~-]/g, " ").replace(/\[\d+(?:,\s*\d+)*\]/g, " ").replace(/\s+/g, " ").trim();
}
function toAppView(row) {
  const description = (row.description || "").trim();
  const plain = stripMarkdown(description);
  return {
    id: row.id,
    app_id: row.app_id,
    name: row.app_name,
    slug: row.app_slug,
    description,
    short_description: plain.length > 160 ? `${plain.slice(0, 157)}\u2026` : plain,
    // Google Drive / Dropbox / GitHub share links are rewritten to direct
    // image URLs so they actually render in <img>.
    icon_url: normalizeImageUrl(row.icon_url, 512),
    screenshots: normalizeImageList(row.screenshots, 1600),
    category: row.category || "Other",
    version: row.latest_version || row.current_version || "1.0.0",
    is_free: row.is_free !== false,
    price: Number(row.price || 0),
    rating: Number(row.rating || 0),
    total_ratings: Number(row.total_reviews || 0),
    downloads: Number(row.total_downloads || 0),
    is_featured: isFeatured(Number(row.rating || 0), Number(row.total_downloads || 0)),
    status: row.status || "draft",
    website: row.website,
    support_email: row.email,
    // The raw value is kept alongside the rewritten one: a Drive share link is
    // still the nicest thing to *show* a user, while the direct link is what
    // the Get button follows.
    download_url: normalizeDownloadUrl(row.download_url),
    download_url_raw: row.download_url || null,
    download_host: linkHost(row.download_url),
    download_is_drive: isDriveUrl(row.download_url),
    // Dedicated Google Drive mirror, plus the extra link fields.
    drive_url: normalizeDownloadUrl(row.google_drive_link),
    drive_share_url: row.google_drive_link || null,
    website_link: row.website_link || null,
    privacy_policy_link: row.privacy_policy_link || null,
    // Auto-update / force-update metadata (see app_versions for per-release flags).
    auto_update: row.auto_update !== false,
    update_available: row.update_available === true,
    version_code: row.latest_version_code ? Number(row.latest_version_code) : null,
    min_version: row.min_version || null,
    change_log: row.change_log || null,
    developer_id: row.developer_id,
    developer_name: row.developers?.developer_name || row.developers?.company_name || "Independent Developer",
    developer_verified: !!row.developers?.verified,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
export {
  APP_SELECT_PLAIN,
  APP_SELECT_WITH_DEV,
  CATEGORIES,
  CATEGORY_META,
  DEV_SELECT,
  ORDER,
  REVIEW_SELECT,
  isFeatured,
  toAppView
};
