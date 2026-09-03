// The marketplace forwards an HMAC-SHA256 fingerprint of the request context
// in `x-marketplace-caller`; the Worker never sees an IP or origin. Routes that
// budget per caller require it, so a missing or malformed header is a client
// error rather than an unlimited "anonymous" bucket.
const CALLER_KEY = /^[0-9a-f]{64}$/;

export function callerKey(request: Request): string | null {
  const value = request.headers.get("x-marketplace-caller")?.trim().toLowerCase();
  return value && CALLER_KEY.test(value) ? value : null;
}
