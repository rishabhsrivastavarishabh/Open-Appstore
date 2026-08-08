/**
 * Rate limiting for the `/api/v1` developer surface.
 *
 * Honest description of the guarantee: Cloudflare Workers isolates do not share
 * memory, and this project has no KV/Durable Object binding, so the counter is
 * per-isolate rather than global. In practice one isolate serves a burst of
 * requests from the same client, so this reliably stops runaway loops and
 * accidental hammering, and it always emits correct, monotonic
 * `X-RateLimit-*` headers so clients can implement documented backoff.
 *
 * It is NOT a hard security boundary against a distributed attacker. Upgrading
 * to exact global limits is a one-line swap of `bucket()` for a KV or Durable
 * Object read — see the note in README. Cloudflare's own account-level DDoS
 * protection sits in front of this regardless.
 */

/** tier -> requests per hour, matching the published documentation. */
export const TIERS = {
  free: 1000,
  verified: 5000,
  // AI calls cost real money per request, so they get their own much tighter
  // tier rather than sharing the data-API budget.
  ai: 20
};

const WINDOW_MS = 60 * 60 * 1000; // 1 hour, fixed window

/**
 * Per-isolate counters. Bounded so a long-lived isolate seeing many distinct
 * keys cannot grow this map without limit.
 */
const buckets = new Map();
const MAX_BUCKETS = 5000;

function bucket(id, now) {
  let b = buckets.get(id);
  if (!b || now >= b.reset) {
    // Fixed window: start a fresh one.
    b = { count: 0, reset: now + WINDOW_MS };
    if (buckets.size >= MAX_BUCKETS) {
      // Drop the oldest-resetting entries rather than clearing everything, so
      // active clients keep their counters.
      const stale = [...buckets.entries()].filter(([, v]) => now >= v.reset).map(([k]) => k);
      if (stale.length) stale.forEach((k) => buckets.delete(k));
      else buckets.delete(buckets.keys().next().value);
    }
    buckets.set(id, b);
  }
  return b;
}

/**
 * Consume one unit for `id`.
 * Returns { allowed, limit, remaining, reset, retryAfter }.
 * `reset` is a unix timestamp in seconds (what the docs promise).
 */
export function consume(id, tier = "free") {
  const limit = TIERS[tier] || TIERS.free;
  const now = Date.now();
  const b = bucket(id, now);
  b.count += 1;
  const remaining = Math.max(0, limit - b.count);
  const reset = Math.ceil(b.reset / 1000);
  return {
    allowed: b.count <= limit,
    limit,
    remaining,
    reset,
    retryAfter: Math.max(1, Math.ceil((b.reset - now) / 1000))
  };
}

/** Apply the documented X-RateLimit-* headers to a response. */
export function applyHeaders(c, info) {
  c.header("X-RateLimit-Limit", String(info.limit));
  c.header("X-RateLimit-Remaining", String(info.remaining));
  c.header("X-RateLimit-Reset", String(info.reset));
}
