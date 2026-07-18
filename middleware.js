// Vercel Routing Middleware — IP-accurate EEA/UK detection for the cookie banner.
//
// What this does NOT do: gate analytics data. That is handled authoritatively by
// Google Consent Mode's `region` list in the analytics head block of index.html,
// which denies ad/analytics storage by the visitor's real IP regardless of this
// file. Middleware's only job is to decide whether the banner *UI* is shown, by
// setting a first-party `bramble-geo` cookie that the client reads in likelyEEA().
//
// Runs globally before the CDN cache, on HTML page routes only (see matcher).
// Every path is wrapped so that any failure falls through with next() — page
// delivery is never blocked by this middleware.
import { geolocation, next } from '@vercel/functions';

// EEA + UK. Keep in sync with the Consent Mode `region` list in index.html.
const EEA = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE', 'IS', 'LI', 'NO', 'GB',
]);

export const config = {
  // HTML page routes only — skip /img, /fonts, and anything with a file extension
  // (articles.js, sitemap.xml, favicon.png, *.webp, *.woff2, …).
  matcher: ['/((?!img/|fonts/|.*\\.[a-zA-Z0-9]+$).*)'],
};

export default function middleware(request) {
  try {
    const geo = geolocation(request) || {};
    const country = geo.country || request.headers.get('x-vercel-ip-country') || '';
    const flag = EEA.has(country) ? 'eea' : 'row';
    return next({
      headers: {
        'Set-Cookie': `bramble-geo=${flag}; Path=/; Max-Age=3600; SameSite=Lax; Secure`,
      },
    });
  } catch (e) {
    return next();
  }
}
