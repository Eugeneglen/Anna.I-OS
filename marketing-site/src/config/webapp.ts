/**
 * Anna.I — Webapp URL configuration
 * ─────────────────────────────────────────────────────────────
 * Central config for the production webapp URL.
 *
 * Every "Register", "Sign Up", or "Get Started" CTA on the marketing
 * site links here, with an `?intent=` query param so the webapp knows
 * whether the visitor came from a user-facing or vendor-facing CTA.
 *
 * The URL is read from the PUBLIC_WEBAPP_URL env var at build time,
 * falling back to the Railway production deployment.
 *
 * Usage:
 *   import { webappUrl } from '../config/webapp';
 *   <a href={webappUrl('user')}>Get Started</a>
 *   // → https://annai-os-production.up.railway.app?intent=user
 */

export const WEBAPP_URL: string =
  import.meta.env.PUBLIC_WEBAPP_URL || 'https://annai-os-production.up.railway.app';

export type Intent = 'user' | 'vendor';

/**
 * Returns the webapp URL, optionally with an `?intent=` query param.
 * Trims any trailing slash on the base URL to avoid double slashes.
 */
export function webappUrl(intent?: Intent): string {
  const base = WEBAPP_URL.replace(/\/+$/, '');
  if (!intent) return base;
  return `${base}?intent=${intent}`;
}
