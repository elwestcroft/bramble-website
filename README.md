# Bramble Marketing Site

Static site. Two real HTML files, no build step, no dependencies.

- `index.html` — the homepage (single-page: features, who-it's-for, desks, pricing, blog, FAQ). Logos and blog article text are embedded, so there are no loose assets.
- `privacy.html` — the standalone privacy policy. Loads directly, JS off. The homepage footer's "Privacy" link points here.
- `vercel.json` — `cleanUrls` on, so `privacy.html` serves at `/privacy` (no extension), matching the URL the Founder's Edition EULA references.

## Deploy (Vercel + GitHub)

1. This folder is the repo root. In Claude Code, from inside this folder:
   "Initialise a new git repo here (separate from the Bramble app repo), create a GitHub repo called bramble-website, and push."
2. vercel.com → sign up with GitHub.
3. Add New Project → import `bramble-website`. Framework: "Other / No framework" (correct, leave it).
4. Deploy. ~1 min → live `.vercel.app` URL, HTTPS handled.
5. Settings → Domains → add `trybramble.app`, set the DNS records Vercel gives you.

Updates: push to GitHub, Vercel redeploys within a minute.

## Before first sale (open items)
- Replace sample beta testimonials with real quotes (flagged on the page).
- Fill Founder pricing placeholders: [PRICE] = $39.99 CAD (confirm), [DATE], [N].
- Have a Manitoba-licensed lawyer review the privacy policy; it's a prototype draft.
- Desk section uses CSS mockups; swap in real app screenshots when available (each card is a labeled slot).
