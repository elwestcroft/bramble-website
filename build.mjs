#!/usr/bin/env node
// Static page generator for Bramble.
//
// Source of truth for article content: content/<slug>.md (frontmatter + body).
// Shared style/nav/footer chrome is pulled from index.html so pages match the app.
// Emits real, crawlable static HTML so search engines and non-JS crawlers get
// full article content, meta tags, and JSON-LD.
//
// Pure Node, zero dependencies. Run:  node build.mjs  (after editing content/*.md)
// Output (committed to the repo, served as-is by Vercel):
//   articles.js (data the SPA loads), blog/index.html, blog/<slug>.html,
//   sitemap.xml, robots.txt
//
// Only articles that have a `body` are emitted; stubs are skipped until written.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SITE = 'https://trybramble.app';

const src = readFileSync(join(ROOT, 'index.html'), 'utf8');

// ---- pull the shared pieces out of index.html (one source of truth) ----
const grab = (re, label) => {
  const m = src.match(re);
  if (!m) throw new Error('Could not find ' + label + ' in index.html');
  return m[0];
};

const ICON = grab(/<link rel="icon"[^>]*>/, 'favicon link');
const STYLE = grab(/<style>[\s\S]*?<\/style>/, '<style> block');

// Convert the SPA's onclick-based nav into plain links that work without JS.
// Allow other attributes (e.g. data-evt/data-loc on the nav CTA) to sit between
// href and onclick; $1 preserves them, and the SPA-only onclick is stripped.
const staticNav = (html) => html
  .replace(/href="[^"]*"([^>]*?)\s+onclick="goSection\('([^']+)'\);return false"/g, 'href="/#$2"$1')
  .replace(/href="[^"]*"([^>]*?)\s+onclick="go\('blog'\);return false"/g, 'href="/blog"$1')
  .replace(/href="[^"]*"([^>]*?)\s+onclick="go\('home'\);return false"/g, 'href="/"$1')
  .replace(/href="[^"]*"([^>]*?)\s+onclick="openArticle\('([^']+)'\);return false"/g, 'href="/blog/$2"$1');

const HEADER = staticNav(grab(/<header>[\s\S]*?<\/header>/, '<header>'));
const FOOTER = staticNav(grab(/<footer>[\s\S]*?<\/footer>/, '<footer>'));
const ANALYTICS = grab(/<!-- consent\+analytics:start -->[\s\S]*?<!-- consent\+analytics:end -->/, 'analytics block');
const BANNER = grab(/<!-- consent-banner:start -->[\s\S]*?<!-- consent-banner:end -->/, 'consent banner');

// ---- article content: one Markdown file per article in content/ ----
const parseArticle = (file) => {
  const raw = readFileSync(join(ROOT, 'content', file), 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('Bad frontmatter in content/' + file);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    slug: file.replace(/\.md$/, ''),
    title: meta.title || '',
    tag: meta.tag || '',
    excerpt: meta.excerpt || '',
    cta: meta.cta || '',
    order: Number(meta.order) || 0,
    date: meta.date || '',
    updated: meta.updated || '',
    byline: meta.byline || '',
    body: m[2].replace(/\n+$/, '\n'),
  };
};
const ARTICLES = readdirSync(join(ROOT, 'content'))
  .filter((f) => f.endsWith('.md'))
  .map(parseArticle)
  .sort((a, b) => a.order - b.order);

// ---- articles.js: the data the SPA (index.html) loads at runtime ----
const spaData = ARTICLES.map(({ slug, title, tag, excerpt, body, cta }) => ({ slug, title, tag, excerpt, body, cta }));
writeFileSync(join(ROOT, 'articles.js'), 'window.ARTICLES = ' + JSON.stringify(spaData) + ';\n');

// ---- helpers ----
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ld = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

// Markdown renderer — ported verbatim from index.html's mdToHtml so static
// output matches the in-app rendering exactly.
function mdToHtml(md){
  const lines=md.split('\n'); let html=''; let inList=false; let para=[]; let tbl=[]; let quote=[];
  const inline=s=>s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>');
  const flush=()=>{ if(para.length){ html+='<p>'+inline(para.join(' '))+'</p>'; para=[]; } };
  const closeList=()=>{ if(inList){ html+='</ol>'; inList=false; } };
  const flushQuote=()=>{ if(quote.length){ html+='<blockquote>'+quote.map(inline).join('<br>')+'</blockquote>'; quote=[]; } };
  const cells=r=>r.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map(c=>c.trim());
  const flushTable=()=>{
    if(!tbl.length) return;
    const rows=tbl; tbl=[];
    const isSep=r=>r.indexOf('-')>=0 && /^[\s:|-]+$/.test(r);
    let head=null, body=rows;
    if(rows.length>=2 && isSep(rows[1])){ head=rows[0]; body=rows.slice(2); }
    let t='<div class="tblwrap"><table>';
    if(head){ t+='<thead><tr>'+cells(head).map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead>'; }
    t+='<tbody>'+body.map(r=>'<tr>'+cells(r).map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
    html+=t;
  };
  for(const raw of lines){
    const line=raw.replace(/\s+$/,'');
    if(/^\s*\|.*\|\s*$/.test(line)){ flush(); closeList(); flushQuote(); tbl.push(line); continue; }
    if(tbl.length) flushTable();
    if(/^> ?/.test(line) && line.charAt(0)==='>'){ flush(); closeList(); quote.push(line.replace(/^> ?/,'')); continue; }
    flushQuote();
    if(/^### /.test(line)){ flush(); closeList(); html+='<h3>'+inline(line.slice(4))+'</h3>'; }
    else if(/^## /.test(line)){ flush(); closeList(); html+='<h2>'+inline(line.slice(3))+'</h2>'; }
    else if(/^# /.test(line)){ flush(); }
    else if(/^---/.test(line)){ flush(); closeList(); }
    else if(/^\d+\. /.test(line)){ flush(); if(!inList){html+='<ol>';inList=true;} html+='<li>'+inline(line.replace(/^\d+\. /,''))+'</li>'; }
    else if(line===''){ flush(); closeList(); }
    else para.push(line);
  }
  flush(); if(tbl.length) flushTable(); closeList(); flushQuote();
  return html;
}

const head = (parts) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${ANALYTICS}
<title>${escHtml(parts.title)}</title>
<meta name="description" content="${escAttr(parts.desc)}">
<link rel="canonical" href="${parts.url}">
<meta property="og:type" content="${parts.ogType}">
<meta property="og:title" content="${escAttr(parts.title)}">
<meta property="og:description" content="${escAttr(parts.desc)}">
<meta property="og:url" content="${parts.url}">
<meta property="og:site_name" content="Bramble">
<meta property="og:image" content="${SITE}/img/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(parts.title)}">
<meta name="twitter:description" content="${escAttr(parts.desc)}">
<meta name="twitter:image" content="${SITE}/img/og.jpg">
${ICON}
<link rel="preload" as="font" type="font/woff2" href="/fonts/fraunces-latin.woff2" crossorigin>
<link rel="preload" as="font" type="font/woff2" href="/fonts/instrumentsans-latin.woff2" crossorigin>
${STYLE}
${parts.jsonld.map((j) => `<script type="application/ld+json">${ld(j)}</script>`).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${HEADER}`;

const FOOT = `${FOOTER}
${BANNER}
</body>
</html>
`;

const crumbLd = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
});

// ---- article pages ----
const withBody = ARTICLES.filter((a) => a.body);
mkdirSync(join(ROOT, 'blog'), { recursive: true });

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const fmtDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
// 3 related articles: same tag first (nearest by order), then nearest others
const relatedTo = (a) => {
  const dist = (x) => Math.abs(x.order - a.order);
  const same = withBody.filter((x) => x.slug !== a.slug && x.tag === a.tag).sort((p, q) => dist(p) - dist(q));
  const rest = withBody.filter((x) => x.slug !== a.slug && x.tag !== a.tag).sort((p, q) => dist(p) - dist(q));
  return [...same, ...rest].slice(0, 3);
};

for (const a of withBody) {
  const url = `${SITE}/blog/${a.slug}`;
  const cta = a.cta;
  const related = relatedTo(a);
  const page = head({
    title: `${a.title} | Bramble`,
    desc: a.excerpt,
    url,
    ogType: 'article',
    jsonld: [
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: a.title,
        description: a.excerpt,
        articleSection: a.tag,
        ...(a.date ? { datePublished: a.date, dateModified: a.updated || a.date } : {}),
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        author: a.byline ? { '@type': 'Person', name: a.byline.split(',')[0].replace(/^By /i, '') } : { '@type': 'Organization', name: 'Bramble' },
        publisher: { '@type': 'Organization', name: 'Bramble' },
      },
      crumbLd([
        { name: 'Home', url: `${SITE}/` },
        { name: 'Blog', url: `${SITE}/blog` },
        { name: a.title, url },
      ]),
    ],
  }) + `
<main id="main">
  <div class="article">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span class="sep" aria-hidden="true">/</span> <a href="/blog">Blog</a> <span class="sep" aria-hidden="true">/</span> <span aria-current="page">${escHtml(a.title)}</span></nav>
    <div class="tag">${escHtml(a.tag)}</div>
    <h1>${escHtml(a.title)}</h1>
    ${a.date ? `<p class="pubdate">${a.byline ? 'By ' + escHtml(a.byline) + ' · ' : ''}<time datetime="${a.date}">${fmtDate(a.date)}</time>${a.updated && a.updated !== a.date ? ' · Updated ' + fmtDate(a.updated) : ''}</p>` : ''}
    ${mdToHtml(a.body)}
    <div class="related"><h2>Related reading</h2><ul>${related.map((r) => `<li><a href="/blog/${r.slug}">${escHtml(r.title)}</a></li>`).join('')}</ul></div>
    <div class="cta-block">${cta ? `<strong style="font-family:var(--display);font-size:19px">${escHtml(cta)}</strong>` : ''}<div style="margin-top:${cta ? '16px' : '0'}"><a class="btn" href="/#pricing" data-evt="trial_cta_click" data-loc="article">Try Bramble Free</a><span class="microtrust" style="margin-left:14px;display:inline-block">14 days. No credit card.</span></div></div>
  </div>
</main>
` + FOOT;
  writeFileSync(join(ROOT, 'blog', `${a.slug}.html`), page);
}

// ---- blog index ----
const card = (a) => a.body
  ? `<a class="post-card" href="/blog/${a.slug}"><div class="tag">${escHtml(a.tag)}</div><h2>${escHtml(a.title)}</h2><p>${escHtml(a.excerpt)}</p><div class="more">Read the article →</div></a>`
  : `<div class="post-card stub"><div class="tag">${escHtml(a.tag)}</div><h2>${escHtml(a.title)}</h2><p>${escHtml(a.excerpt)}</p><div class="more">Coming soon</div></div>`;

const blogIndex = head({
  title: 'The Bramble Blog | Field Notes for Writers',
  desc: 'Craft guides, honest comparisons, and systems for stories with moving parts.',
  url: `${SITE}/blog`,
  ogType: 'website',
  jsonld: [crumbLd([{ name: 'Home', url: `${SITE}/` }, { name: 'Blog', url: `${SITE}/blog` }])],
}) + `
<main id="main">
  <div class="wrap blog-hero">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span class="sep" aria-hidden="true">/</span> <span aria-current="page">Blog</span></nav>
    <div class="eyebrow">The Bramble Blog</div>
    <h1>Field notes for writers with too many characters.</h1>
    <p class="lede">Craft guides, honest comparisons, and systems for stories with moving parts.</p>
  </div>
  <div class="wrap"><div class="blog-grid">
    ${ARTICLES.map(card).join('\n    ')}
  </div></div>
</main>
` + FOOT;
writeFileSync(join(ROOT, 'blog', 'index.html'), blogIndex);

// ---- privacy policy (generated from the shared shell so it never drifts from index.html) ----
const privacyBody = `
<main id="main">
  <div class="article">
    <a class="back" href="/">← Back to Bramble</a>
    <div class="tag">Legal</div>
    <h1>Privacy Policy</h1>
    <p><strong>The short version.</strong> Bramble is a macOS app that runs on your computer. Your manuscripts, characters, notes, and everything else you create live as plain files on your Mac, not on our servers. We can't read your book. We don't want to. We don't train anything on it.</p>
    <h2>What Bramble stores, and where</h2>
    <p>Your projects are non-proprietary files on your disk. They stay there. Bramble does not upload your writing to us, and there is no Bramble cloud your manuscript is copied to. If you choose to keep your library in iCloud, Dropbox, or Google Drive, that is your storage provider under their terms, not ours.</p>
    <h2>What we do collect</h2>
    <p>Only what's needed to sell and license the app. When you buy Bramble or start a trial, our payment provider handles the transaction and we receive your email address and license status so we can support you and keep your license valid.</p>
    <ol>
      <li><strong>Purchase and license data.</strong> Handled by Lemon Squeezy (or any successor payment provider) acting as merchant of record. They process your payment and billing details; we never see or store your full card information. We receive your email, order, and license key status.</li>
      <li><strong>License validation.</strong> Bramble contacts the licensing service to confirm your license is active, with an offline grace period so you can keep writing without a connection. This exchanges your license key, not your writing.</li>
      <li><strong>Update checks.</strong> Bramble checks for new versions so you get fixes and features.</li>
      <li><strong>Optional support contact.</strong> If you email info@trybramble.app, we keep that correspondence to help you.</li>
    </ol>
    <h2>This website (analytics &amp; cookies)</h2>
    <p>This marketing website uses Google Analytics to understand how visitors find and move through the pages, so we can improve them. This is separate from the Bramble app; the app itself still runs no analytics or advertising trackers, as described above.</p>
    <p>We may also use this data with Google&rsquo;s advertising features &mdash; including remarketing to people who have visited the site &mdash; to measure and improve our advertising. Advertising cookies are set only with your consent, and are denied by default for visitors in the European Economic Area and the United Kingdom.</p>
    <p>We use Google Consent Mode. If you visit from the European Economic Area or the United Kingdom, analytics and advertising storage are <strong>denied by default</strong> and no analytics cookies are set unless you choose <strong>Accept</strong> on the cookie banner. You can change your mind any time with the <strong>Cookie choices</strong> link in the footer. Elsewhere, analytics runs by default and you can decline with the same control. Your choice is remembered on your device.</p>
    <h2>What we don't do</h2>
    <p>We don't sell your data. We don't use your writing to train AI. We don't run advertising trackers inside the app. There is no generative AI in your manuscript, by design.</p>
    <h2>Your choices</h2>
    <p>You can request a copy of the limited data we hold (your email, order, and license status), ask us to delete it, or deactivate a license from your device. Because your writing lives on your Mac, deleting your account with us does not touch your manuscripts; those are yours to keep or remove.</p>
    <h2>Contact</h2>
    <p>Questions about privacy? Email <strong>info@trybramble.app</strong>. The full, current policy is published at https://trybramble.app/privacy.</p>
    <div class="cta-block"><strong style="font-family:var(--display);font-size:19px">Your words never leave your Mac unless you send them.</strong><div style="margin-top:16px"><a class="btn" href="/#pricing" data-evt="trial_cta_click" data-loc="privacy">Try Bramble Free</a><span class="microtrust" style="margin-left:14px;display:inline-block">14 days. No credit card.</span></div></div>
  </div>
</main>
`;
const privacyPage = head({
  title: 'Privacy Policy | Bramble',
  desc: "Bramble's privacy policy. Your manuscripts stay on your Mac. We don't read your book or train anything on it.",
  url: `${SITE}/privacy`,
  ogType: 'website',
  jsonld: [],
}) + privacyBody + FOOT;
writeFileSync(join(ROOT, 'privacy.html'), privacyPage);

// ---- sitemap.xml + robots.txt ----
const newest = withBody.map((a) => a.updated || a.date).filter(Boolean).sort().pop() || '';
const entries = [
  { loc: `${SITE}/`, lastmod: newest },
  { loc: `${SITE}/blog`, lastmod: newest },
  { loc: `${SITE}/privacy`, lastmod: newest },
  ...withBody.map((a) => ({ loc: `${SITE}/blog/${a.slug}`, lastmod: a.updated || a.date })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((e) => `  <url><loc>${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
writeFileSync(join(ROOT, 'sitemap.xml'), sitemap);
writeFileSync(join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`Generated ${withBody.length} article page(s), blog index, sitemap (${entries.length} urls), robots.txt`);
console.log('Articles:', withBody.map((a) => a.slug).join(', '));
console.log('Skipped (no body yet):', ARTICLES.filter((a) => !a.body).map((a) => a.slug).join(', ') || 'none');
