/** Public address of the site, used for canonical links and the sitemap. Set NEXT_PUBLIC_SITE_URL when the domain changes. */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const base = configured && /^https?:\/\//.test(configured) ? configured : "https://limtok.vercel.app";
  return base.replace(/\/+$/, "");
}

/**
 * Search engines stay out until the owner opens the site to the public. Set ILMTOK_ALLOW_INDEXING=true
 * in the hosting settings on the day of launch. Until then robots.txt asks every crawler to skip the site.
 */
export function indexingAllowed(): boolean {
  return process.env.ILMTOK_ALLOW_INDEXING?.trim() === "true";
}
