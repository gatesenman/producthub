export const LIST_HTML = `<html><head><title>Launch Site</title><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>
<nav class="menu"><a href="/">Home</a><a href="/about">About</a></nav>
<div class="grid">${['Alpha AI Writer|AI writing assistant for bloggers and marketers|https://alpha.ai', 'Beta DevKit|Open-source CLI toolkit for developers to deploy APIs|https://betadev.io', 'Gamma Notes|Note-taking productivity app for students|https://gammanotes.app', 'Delta Pay|Invoice and payment platform for freelancers|https://deltapay.com', 'Epsilon Fit|Fitness and workout tracker with AI coach|https://epsilon.fit'].map((s, i) => { const [n, d, u] = s.split('|'); return `<article class="product-card"><img src="/logos/${i}.png"><h3 class="title">${n}</h3><p class="tagline">${d}</p><a href="/p/${n.toLowerCase().replace(/ /g, '-')}">View</a><span class="votes">${(i + 1) * 12} votes</span></article>`; }).join('\n')}
</div><footer class="footer"><a href="https://twitter.com/x">Twitter</a></footer></body></html>`;
export const detailHtml = (n: string, url: string) => `<html><head><meta property="og:title" content="${n} - Launch Site"><meta property="og:description" content="${n} full description from detail page with more words."><meta property="og:image" content="https://cdn.example.com/${encodeURIComponent(n)}.png"></head><body><a href="https://twitter.com/foo">tw</a><a href="${url}?ref=launchsite" rel="nofollow">Visit website</a><a href="https://sponsor.example.org">Sponsor</a></body></html>`;
export const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
<item><title>Zeta Agent - Autonomous AI agent for sales outreach</title><link>https://launch.example.com/p/zeta</link><description><![CDATA[<p>Zeta automates <b>sales</b> outreach with LLM agents.</p><img src="https://cdn.example.com/zeta.png">]]></description><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Eta Design</title><link>https://launch.example.com/p/eta</link><description>Figma plugin for icons and illustration design</description><pubDate>Tue, 06 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Theta Shop</title><link>https://thetashop.com</link><description>Shopify ecommerce analytics</description></item>
</channel></rss>`;
export const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Iota VPN</title><link href="https://iota.vpn"/><summary>Privacy VPN with encryption</summary><updated>2026-09-01T00:00:00Z</updated></entry></feed>`;
export const JSONLD = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","itemListElement":[{"@type":"ListItem","position":1,"item":{"@type":"SoftwareApplication","name":"Kappa CRM","url":"https://kappacrm.com","description":"CRM for small sales teams"}},{"@type":"ListItem","position":2,"item":{"name":"Lambda DB","url":"https://lambdadb.dev","description":"Serverless database for developers"}},{"@type":"ListItem","position":3,"url":"https://mu.app","item":{"name":"Mu Music","description":"AI music generator"}}]}</script></head><body></body></html>`;

/** 模拟网络：按 URL 返回固定页面 */
export function mockFetcher(extra: Record<string, string> = {}) {
  const pages: Record<string, string> = { 'https://launch.example.com/': LIST_HTML, 'https://launch.example.com/feed.xml': RSS, 'https://ld.example.com/': JSONLD, 'https://atom.example.com/': ATOM, ...extra };
  const calls: string[] = [];
  const f = async (url: string) => {
    calls.push(url); const u = new URL(url); const key = u.origin + u.pathname;
    if (pages[key] !== undefined) return { status: 200, text: pages[key], contentType: key.endsWith('.xml') ? 'application/rss+xml' : 'text/html', finalUrl: key };
    const m = u.pathname.match(/^\/p\/(.+)$/); if (m) { const n = m[1].split('-').map(s => s[0].toUpperCase() + s.slice(1)).join(' '); return { status: 200, text: detailHtml(n, 'https://' + m[1].split('-')[0] + '.example.net'), contentType: 'text/html', finalUrl: url }; }
    return { status: 404, text: 'nf', contentType: 'text/html', finalUrl: url };
  };
  return Object.assign(f, { calls });
}
