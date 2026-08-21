/**
 * Client-side fetch wrapper for vendor API calls.
 * Detects cookie-overwrite / session-switch by comparing the X-Vendor-Id
 * response header against the expected vendorId from React state.
 *
 * When a mismatch is detected (another vendor logged in from another tab),
 * it clears all vendor caches and forces a redirect to login.
 */

const EXPECTED_VENDOR_ID_KEY = "anna-expected-vendor-id";

/**
 * Store the expected vendorId (call this after session loads).
 */
export function setExpectedVendorId(id: string) {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(EXPECTED_VENDOR_ID_KEY, id);
  }
}

/**
 * Get the stored expected vendorId.
 */
export function getExpectedVendorId(): string | null {
  if (typeof window !== "undefined") {
    return sessionStorage.getItem(EXPECTED_VENDOR_ID_KEY);
  }
  return null;
}

/**
 * Clear the stored vendorId (on logout).
 */
export function clearExpectedVendorId() {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(EXPECTED_VENDOR_ID_KEY);
  }
}

/**
 * Check if a fetch response indicates a vendor session mismatch.
 * Returns true if the X-Vendor-Id header doesn't match the expected vendor.
 */
function isVendorMismatch(response: Response): boolean {
  const expectedId = getExpectedVendorId();
  if (!expectedId) return false;

  const responseVendorId = response.headers.get("X-Vendor-Id");
  if (!responseVendorId) return false;

  return responseVendorId !== expectedId;
}

/**
 * Force-redirect to vendor login, clearing session storage.
 */
function forceVendorLogout() {
  clearExpectedVendorId();
  // Clear the vendor_token cookie via the logout API
  fetch("/api/vendor/auth", { method: "DELETE" }).catch(() => {});
  window.location.replace("/vendor/login");
}

let isHandlingMismatch = false;

/**
 * Vendor-aware fetch wrapper.
 * Use this instead of raw fetch() for all vendor API calls.
 * It checks the X-Vendor-Id response header and triggers
 * a forced logout if the server-side session doesn't match
 * the client's expected vendor.
 */
export async function vendorFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, init);

  // Only check responses from vendor API routes
  if (
    !isHandlingMismatch &&
    response.ok &&
    typeof input === "string" &&
    (input.startsWith("/api/vendor/") || input.startsWith("/api/vendors/"))
  ) {
    if (isVendorMismatch(response)) {
      isHandlingMismatch = true;
      console.warn(
        "[vendor-fetch] Session mismatch detected. " +
          `Expected vendor ${getExpectedVendorId()}, got ${response.headers.get("X-Vendor-Id")}. ` +
          "Redirecting to login."
      );
      // Small delay so the current fetch chain can complete
      setTimeout(forceVendorLogout, 100);
    }
  }

  return response;
}
