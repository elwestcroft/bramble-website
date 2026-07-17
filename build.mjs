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
const staticNav = (html) => html
  .replace(/href="[^"]*"\s+onclick="goSection\('([^']+)'\);return false"/g, 'href="/#$1"')
  .replace(/href="[^"]*"\s+onclick="go\('blog'\);return false"/g, 'href="/blog"')
  .replace(/href="[^"]*"\s+onclick="go\('home'\);return false"/g, 'href="/"')
  .replace(/href="[^"]*"\s+onclick="openArticle\('([^']+)'\);return false"/g, 'href="/blog/$1"');

const HEADER = staticNav(grab(/<header>[\s\S]*?<\/header>/, '<header>'));
const FOOTER = staticNav(grab(/<footer>[\s\S]*?<\/footer>/, '<footer>'));

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
${HEADER}`;

const FOOT = `${FOOTER}
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
<main>
  <div class="article">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span class="sep" aria-hidden="true">/</span> <a href="/blog">Blog</a> <span class="sep" aria-hidden="true">/</span> <span aria-current="page">${escHtml(a.title)}</span></nav>
    <div class="tag">${escHtml(a.tag)}</div>
    <h1>${escHtml(a.title)}</h1>
    ${a.date ? `<p class="pubdate">${a.byline ? 'By ' + escHtml(a.byline) + ' · ' : ''}<time datetime="${a.date}">${fmtDate(a.date)}</time>${a.updated && a.updated !== a.date ? ' · Updated ' + fmtDate(a.updated) : ''}</p>` : ''}
    ${mdToHtml(a.body)}
    <div class="related"><h2>Related reading</h2><ul>${related.map((r) => `<li><a href="/blog/${r.slug}">${escHtml(r.title)}</a></li>`).join('')}</ul></div>
    <div class="cta-block">${cta ? `<strong style="font-family:var(--display);font-size:19px">${escHtml(cta)}</strong>` : ''}<div style="margin-top:${cta ? '16px' : '0'}"><a class="btn" href="/#pricing">Try Bramble Free</a><span class="microtrust" style="margin-left:14px;display:inline-block">14 days. No credit card.</span></div></div>
  </div>
</main>
` + FOOT;
  writeFileSync(join(ROOT, 'blog', `${a.slug}.html`), page);
}

// ---- blog index ----
const card = (a) => a.body
  ? `<a class="post-card" href="/blog/${a.slug}"><div class="tag">${escHtml(a.tag)}</div><h3>${escHtml(a.title)}</h3><p>${escHtml(a.excerpt)}</p><div class="more">Read the article →</div></a>`
  : `<div class="post-card stub"><div class="tag">${escHtml(a.tag)}</div><h3>${escHtml(a.title)}</h3><p>${escHtml(a.excerpt)}</p><div class="more">Coming soon</div></div>`;

const blogIndex = head({
  title: 'The Bramble Blog | Field Notes for Writers',
  desc: 'Craft guides, honest comparisons, and systems for stories with moving parts.',
  url: `${SITE}/blog`,
  ogType: 'website',
  jsonld: [crumbLd([{ name: 'Home', url: `${SITE}/` }, { name: 'Blog', url: `${SITE}/blog` }])],
}) + `
<main>
  <div class="wrap blog-hero">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span class="sep" aria-hidden="true">/</span> <span aria-current="page">Blog</span></nav>
    <div class="eyebrow">The Bramble Blog</div>
    <h2>Field notes for writers with too many characters.</h2>
    <p class="lede">Craft guides, honest comparisons, and systems for stories with moving parts.</p>
  </div>
  <div class="wrap"><div class="blog-grid">
    ${ARTICLES.map(card).join('\n    ')}
  </div></div>
</main>
` + FOOT;
writeFileSync(join(ROOT, 'blog', 'index.html'), blogIndex);

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
