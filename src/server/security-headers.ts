/**
 * Security headers applied to every HTTP response.
 *
 * These are injected by app.config.ts (dynamic SSR routes) and mirrored
 * in public/_headers for static assets served directly by Cloudflare.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  // Force HTTPS for 1 year, include subdomains
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",

  // Prevent clickjacking
  "X-Frame-Options": "DENY",

  // Prevent MIME-type sniffing
  "X-Content-Type-Options": "nosniff",

  // Restrict referrer information
  "Referrer-Policy": "strict-origin-when-cross-origin",

  // Content Security Policy
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://*.supabase.co https://*.api.riotgames.com https://*.riotgames.com https://ddragon.leagueoflegends.com",
    "font-src 'self'",
    "frame-src 'self' https://challenges.cloudflare.com",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
};
