/**
 * Production fail-fast secret resolution (FIX-1a item 1).
 * ================================================
 *
 * Every signing/encryption secret in this codebase previously fell back to a
 * public hardcoded dev string when its env var was missing. In production
 * that means anyone can forge ops/household/vendor JWTs. This helper keeps
 * the dev behaviour identical (dev fallbacks stay so local/CI runs work
 * without secrets) but makes a missing secret a hard, loud failure the first
 * time it is resolved in production (module init counts as first use).
 */

interface SecretOptions {
  /** Human-readable owner of the secret, used in error/warning messages. */
  owner: string;
}

export function resolveSecret(
  envName: string,
  devFallback: string,
  opts: SecretOptions
): string {
  const value = process.env[envName];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `[secrets] ${envName} is not set (owner: ${opts.owner}). ` +
        "Refusing to fall back to an insecure development secret in production. " +
        "Configure the secret in the environment and restart the server."
    );
  }

  if (value !== undefined) {
    // Set but empty — almost certainly a misconfiguration.
    console.warn(
      `[secrets] ${envName} is set but empty — using dev fallback for ${opts.owner}. Do NOT ship this to production.`
    );
  } else {
    console.warn(
      `[secrets] ${envName} not set — using dev fallback for ${opts.owner}. Do NOT ship this to production.`
    );
  }
  return devFallback;
}
