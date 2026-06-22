// Same-origin guard for the API (CR-D). This app has no auth — it's a local-first, single-user
// tool — but its routes spend money (Anthropic), mutate the athlete's Intervals.icu calendar
// (/api/write) and overwrite the immutable store (/api/import). With no guard, ANY web page open in
// the same browser can drive-by POST to http://localhost:3000/api/* while the app is running: the
// browser attaches no auth (there is none) and the request just lands.
//
// The defence is a same-origin check on state-changing requests. Browsers always send an `Origin`
// header on cross-origin requests and on same-origin non-GET requests (per the Fetch spec), so a
// cross-site write is detectable by comparing the Origin's host to the request's Host. Pure +
// deterministic so the policy is unit-testable; proxy.ts is just the thin wrapper that reads headers.

// Safe methods never mutate, and the browser's same-origin policy already blocks a cross-origin page
// from READING the response — so they need no guard.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Returns true when a request should be rejected as a cross-site write.
// - Safe method → allowed.
// - No Origin header → allowed: not a browser-initiated write (curl, native client, server-to-server,
//   the app's own SSR fetches). A CSRF attack requires a browser, which always sends Origin on writes.
// - Origin present → its host MUST equal the request Host; anything else (mismatch, unparseable
//   Origin, or a missing Host we can't verify against) is rejected.
export function isForbiddenCrossSiteWrite(
  method: string,
  origin: string | null,
  host: string | null
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true; // a write carrying a malformed Origin is not something a legit same-origin client sends
  }
  if (!host) return true; // can't prove same-origin → refuse the write
  return originHost !== host;
}
