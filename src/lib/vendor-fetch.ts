/**
 * Client-side utilities for multi-tab vendor session support.
 *
 * Architecture:
 * - JWT token is stored in sessionStorage (tab-scoped, survives reload within tab).
 * - All vendor API fetches include `Authorization: Bearer <token>` header.
 * - Backend checks Authorization header first (via getVendorSession), falls back to cookie.
 * - The httpOnly cookie remains as a fallback for middleware/SSR page loads.
 *
 * This prevents cookie collision: Tab A and Tab B can each hold a different
 * vendor's token in their own sessionStorage, even though the shared cookie
 * may only hold one vendor's token (last login wins).
 */

// ── sessionStorage keys ──
const VENDOR_TOKEN_KEY = "anna-vendor-token";
const EXPECTED_VENDOR_ID_KEY = "anna-expected-vendor-id";

// ── Token management (sessionStorage — tab-scoped) ──

/** Store the JWT token for this tab. */
export function setVendorToken(token: string) {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(VENDOR_TOKEN_KEY, token);
  }
}

/** Get the JWT token for this tab. */
export function getVendorToken(): string | null {
  if (typeof window !== "undefined") {
    return sessionStorage.getItem(VENDOR_TOKEN_KEY);
  }
  return null;
}

/** Clear the JWT token (on logout). */
export function clearVendorToken() {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(VENDOR_TOKEN_KEY);
  }
}

// ── Expected vendor ID management (for mismatch detection) ──

/** Store the expected vendorId (call this after session loads). */
export function setExpectedVendorId(id: string) {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(EXPECTED_VENDOR_ID_KEY, id);
  }
}

/** Get the stored expected vendorId. */
export function getExpectedVendorId(): string | null {
  if (typeof window !== "undefined") {
    return sessionStorage.getItem(EXPECTED_VENDOR_ID_KEY);
  }
  return null;
}

/** Clear the stored vendorId (on logout). */
export function clearExpectedVendorId() {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(EXPECTED_VENDOR_ID_KEY);
  }
}

// ── Mismatch detection (safety net) ──

/**
 * Check if a fetch response indicates a vendor session mismatch.
 * With Authorization-header-based auth, this should rarely trigger.
 * It remains as a safety net for edge cases (e.g., token expiry).
 */
function isVendorMismatch(response: Response): boolean {
  const expectedId = getExpectedVendorId();
  if (!expectedId) return false;

  const responseVendorId = response.headers.get("X-Vendor-Id");
  if (!responseVendorId) return false;

  return responseVendorId !== expectedId;
}

/**
 * Force-redirect to vendor login, clearing tab-scoped session state.
 */
function forceVendorLogout() {
  clearExpectedVendorId();
  clearVendorToken();
  window.location.replace("/vendor/login");
}

let isHandlingMismatch = false;

// ── Global fetch patch ──

let originalFetch: typeof window.fetch | null = null;
let patchInstalled = false;

/**
 * Install a global fetch interceptor that automatically injects
 * the Authorization header for vendor API calls.
 *
 * Call this once from the vendor portal layout.
 * Returns a cleanup function to restore the original fetch.
 */
export function installVendorFetchPatch(): () => void {
  if (typeof window === "undefined" || patchInstalled) return () => {};
  patchInstalled = true;
  originalFetch = window.fetch;

  window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const token = getVendorToken();
    if (token) {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

      if (url.startsWith("/api/vendor/") || url.startsWith("/api/vendors/")) {
        const headers = new Headers(init?.headers);
        if (!headers.has("Authorization")) {
          headers.set("Authorization", `Bearer ${token}`);
        }
        const newInit = { ...init, headers };
        const promise = originalFetch!(input, newInit);

        // Attach mismatch detection
        return promise.then((response) => {
          if (
            !isHandlingMismatch &&
            response.ok &&
            (url.startsWith("/api/vendor/") || url.startsWith("/api/vendors/"))
          ) {
            if (isVendorMismatch(response)) {
              isHandlingMismatch = true;
              console.warn(
                "[vendor-fetch] Session mismatch detected. " +
                  `Expected vendor ${getExpectedVendorId()}, got ${response.headers.get("X-Vendor-Id")}. ` +
                  "Redirecting to login."
              );
              setTimeout(forceVendorLogout, 100);
            }
          }
          return response;
        });
      }
    }
    return originalFetch!(input, init);
  };

  return () => {
    if (originalFetch) {
      window.fetch = originalFetch;
      originalFetch = null;
      patchInstalled = false;
    }
  };
}

// ── vendorFetch (kept for backward compatibility + explicit use) ──

/**
 * Vendor-aware fetch wrapper.
 * NOTE: With installVendorFetchPatch() active, you can use regular fetch()
 * for vendor API calls. This wrapper is kept for explicit usage and
 * backward compatibility.
 */
export async function vendorFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  // If the global patch is installed, just use regular fetch
  // (it will inject the Authorization header automatically)
  if (patchInstalled) {
    return fetch(input, init);
  }

  // Fallback: inject header manually
  const token = getVendorToken();
  if (token) {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;

    if (url.startsWith("/api/vendor/") || url.startsWith("/api/vendors/")) {
      const headers = new Headers(init?.headers);
      if (!headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      return fetch(input, { ...init, headers });
    }
  }
  return fetch(input, init);
}
