/**
 * The one error envelope for the whole JSON API.
 *
 * Every failing endpoint returns the same three documented fields:
 *
 *   { error, message, code }
 *
 * `error` and `message` both carry the human-readable sentence, and `code` is
 * the stable machine-readable token a client should branch on. Duplicating the
 * sentence is deliberate: the store's own frontend (public/static/app.js) and
 * the published API docs both read `error` as text to display, so changing it
 * into a token would silently start showing users strings like "not_found".
 *
 * `success: false` is included for the same reason — several existing callers
 * test that flag rather than the HTTP status.
 *
 * This lives in its own module so all five routers share one definition. When
 * each router carried its own copy they drifted apart within a single sitting,
 * which is exactly the inconsistency the envelope is supposed to remove.
 */

/** Default machine codes per HTTP status, used when a caller does not name one. */
const CODES = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "unprocessable",
  429: "rate_limited",
  500: "server_error",
  502: "upstream_error",
  503: "unavailable"
};

/**
 * Build an error response.
 *
 * @param c Hono context.
 * @param status HTTP status code.
 * @param message Sentence safe to show a person. Must not leak internals.
 * @param code Optional machine token; defaults from the status.
 * @param extra Optional additional fields (e.g. `retry_after`, `details`).
 */
export function fail(c, status, message, code, extra) {
  const body = {
    success: false,
    error: message,
    message,
    code: code || CODES[status] || "error"
  };
  if (extra && typeof extra === "object") Object.assign(body, extra);
  return c.json(body, status);
}

export { CODES as ERROR_CODES };
export default fail;
