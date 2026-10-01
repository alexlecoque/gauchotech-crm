// POS detection: read the shop's website, follow its "order online" links, and
// record which provider's URL was found and where.
import fetch from 'node-fetch';
import https from 'node:https';
import { hostMatches } from './match.js';

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 5_000_000;
const MAX_FOLLOWS = 3;
const STRENGTH = { weak: 1, medium: 2, strong: 3 };

// kind 'pos'      — a full point-of-sale system; decides whether the shop is a target
// kind 'ordering' — an ordering layer that sits on top of any POS; tells us nothing about the POS
//
// Rules are checked top to bottom per URL; the first rule that matches wins.
// POS providers are listed in tie-break order: Square is last because Square payment
// scripts and Square/Weebly-hosted sites show up on shops whose POS is something else.
// Fingerprints marked "verify" are best guesses to confirm against real sites in a dry run.
export const PROVIDERS = [
  { name: 'Toast', kind: 'pos', rules: [
    { host: 'toasttab.com', strength: 'strong' },
    { host: 'toast.site', strength: 'strong' },                  // verify
  ] },
  { name: 'SpotOn', kind: 'pos', rules: [
    { host: 'spoton.com', strength: 'strong' },
  ] },
  { name: 'Adora', kind: 'pos', rules: [
    { host: 'adorapos.com', strength: 'strong' },                // verify
  ] },
  { name: 'Lightspeed', kind: 'pos', rules: [
    { host: 'lightspeedrestaurant.com', strength: 'strong' },
  ] },
  { name: 'TouchBistro', kind: 'pos', rules: [
    { host: 'touchbistro.com', strength: 'strong' },
  ] },
  { name: 'Revel', kind: 'pos', rules: [
    { host: 'revelsystems.com', strength: 'strong' },
    { host: 'revelup.com', strength: 'strong' },                 // verify
  ] },
  { name: 'Clover', kind: 'pos', target: true, rules: [
    { host: 'clover.com', path: /^\/online-ordering/, strength: 'strong' },
    { host: 'clover.com', strength: 'medium' },
    { host: 'smartonlineorder.com', strength: 'medium' },        // Clover-app ordering — verify
  ] },
  { name: 'Square', kind: 'pos', target: true, rules: [
    { host: 'square.site', strength: 'strong' },
    { host: 'squareup.com', path: /^\/store\//, strength: 'strong' },
    { host: 'squareup.com', path: /^\/gift\//, strength: 'medium' },
    { host: 'square.link', strength: 'medium' },
    { host: 'squareup.com', strength: 'weak' },                  // payment scripts, marketing links
    { host: 'squarecdn.com', strength: 'weak' },
    { host: 'editmysite.com', strength: 'weak' },                // Weebly / Square Online hosting
    { host: 'weebly.com', strength: 'weak' },
  ] },
  { name: 'Slice', kind: 'ordering', rules: [
    { host: 'slicelife.com', strength: 'strong' },
  ] },
  { name: 'ChowNow', kind: 'ordering', rules: [
    { host: 'chownow.com', strength: 'strong' },
  ] },
  { name: 'Olo', kind: 'ordering', rules: [
    { host: 'olo.com', strength: 'strong' },
  ] },
  { name: 'DoorDash Storefront', kind: 'ordering', rules: [
    { host: 'order.online', strength: 'strong' },
  ] },
];

const MARKETPLACES = [
  { name: 'DoorDash', host: 'doordash.com' },
  { name: 'Uber Eats', host: 'ubereats.com' },
  { name: 'Grubhub', host: 'grubhub.com' },
  { name: 'Postmates', host: 'postmates.com' },
  { name: 'Seamless', host: 'seamless.com' },
];

// Never worth following as an "order" link
const SKIP_HOSTS = [
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'yelp.com',
  'tripadvisor.com', 'google.com', 'goo.gl', 'apple.com', ...MARKETPLACES.map(m => m.host),
];

const ORDER_RE = /order|pick-?up|delivery|carry-?out|take-?out/i;

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function parseUrl(url, base) {
  try {
    const u = new URL(url, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch { return null; }
}

// Which provider does this URL belong to? → { provider, strength } or null
export function classifyUrl(url) {
  const u = parseUrl(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  for (const provider of PROVIDERS) {
    for (const rule of provider.rules) {
      if (hostMatches(host, rule.host) && (!rule.path || rule.path.test(u.pathname))) {
        return { provider, strength: rule.strength };
      }
    }
  }
  return null;
}

const decodeEntities = s => s.replace(/&amp;/gi, '&').replace(/&#0?38;/g, '&').replace(/&#x2f;/gi, '/').replace(/&quot;/gi, '"');
const stripTags = s => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (attrs, name) => {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null;
};

// Pull links, iframes and any other URLs out of a page
export function extractLinks(html, pageUrl) {
  const links = [];   // { url, label } — things a visitor can click or that are embedded
  const seen = new Set();

  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const u = parseUrl(attr(m[1], 'href') || '', pageUrl);
    if (!u) continue;
    const label = [stripTags(m[2]), attr(m[1], 'aria-label'), attr(m[1], 'title')].filter(Boolean).join(' ').slice(0, 80);
    links.push({ url: u.href, label });
    seen.add(u.href);
  }
  for (const m of html.matchAll(/<iframe\b([^>]*)>/gi)) {
    const u = parseUrl(attr(m[1], 'src') || '', pageUrl);
    if (!u) continue;
    links.push({ url: u.href, label: 'embedded frame' });
    seen.add(u.href);
  }

  // Everything else: script tags, JSON blobs, inline JS (also catches JS-rendered sites)
  const raw = new Set();
  const unescaped = decodeEntities(html).replace(/\\u002f/gi, '/').replace(/\\\//g, '/');
  for (const m of unescaped.matchAll(/https?:\/\/[^\s"'<>\\)]+/gi)) {
    const u = parseUrl(m[0]);
    if (u && !seen.has(u.href)) raw.add(u.href);
  }

  return { links, raw: [...raw] };
}

async function fetchPage(url, fetchImpl) {
  const res = await fetchImpl(url, {
    agent: u => (u.protocol === 'https:' ? httpsAgent : undefined),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    size: MAX_HTML_BYTES,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GauchoBot/1.0)', Accept: 'text/html,*/*' },
  });
  const finalUrl = res.url || url;
  const type = res.headers.get('content-type') || '';
  // PDF menus and images are common "order" link targets — don't download them
  if (type && !/html|text|json/i.test(type)) {
    res.body?.destroy?.();
    return { finalUrl, status: res.status, html: '' };
  }
  return { finalUrl, status: res.status, html: await res.text() };
}

const sameHost = (a, b) => parseUrl(a)?.hostname.replace(/^www\./, '') === parseUrl(b)?.hostname.replace(/^www\./, '');
const stripHash = url => url.split('#')[0];

// Returns {
//   pos, target, confidence ('strong' | 'medium' | 'conflict'), evidenceUrl, evidenceWhere,
//   orderingProvider, orderingUrl, signals[], pagesChecked, error
// }
// `pos` is only set from strong or medium evidence of a full POS system.
export async function detectPOS(websiteUrl, { fetchImpl = fetch } = {}) {
  const result = {
    pos: null, target: false, confidence: null, evidenceUrl: null, evidenceWhere: null,
    orderingProvider: null, orderingUrl: null, signals: [], pagesChecked: 0, error: null,
  };
  if (!websiteUrl) return result;

  const evidence = [];        // { provider, strength, url, where }
  const marketplaces = new Set();
  const toFollow = [];        // order links that didn't identify a provider on their own
  let squareOnlinePath = null;

  // linked = a visitor-facing URL; otherwise it was only found in the page source,
  // which is worth one step less (a payment script is not an ordering page)
  const note = (url, where, linked) => {
    const hit = classifyUrl(url);
    if (!hit) return false;
    let strength = hit.strength;
    if (!linked) strength = strength === 'strong' ? 'medium' : 'weak';
    evidence.push({ provider: hit.provider, strength, url, where });
    return true;
  };

  const scanPage = (html, pageUrl, collectFollows) => {
    const { links, raw } = extractLinks(html, pageUrl);
    for (const { url, label } of links) {
      const isOrderLink = ORDER_RE.test(label) || ORDER_RE.test(new URL(url).pathname);
      const matched = note(url, `link "${label || url}" on ${pageUrl}`, true);
      const host = new URL(url).hostname.toLowerCase();
      const marketplace = MARKETPLACES.find(m => hostMatches(host, m.host));
      if (marketplace) marketplaces.add(marketplace.name);

      if (!isOrderLink) continue;
      if (!result.orderingUrl || (matched && !classifyUrl(result.orderingUrl))) result.orderingUrl = url;
      if (sameHost(url, pageUrl) && /^\/s\/order/.test(new URL(url).pathname)) squareOnlinePath = url;
      if (collectFollows && !matched && !SKIP_HOSTS.some(h => hostMatches(host, h))
          && stripHash(url) !== stripHash(pageUrl) && !toFollow.some(f => stripHash(f.url) === stripHash(url))) {
        toFollow.push({ url, label });
      }
    }
    for (const url of raw) note(url, `page source of ${pageUrl}`, false);
  };

  const hasStrongPos = () => evidence.some(e => e.provider.kind === 'pos' && e.strength === 'strong');

  // 1. Many shops list their ordering page as their website on Google
  note(websiteUrl, 'website listed on Google', true);

  // 2. Homepage
  try {
    const { finalUrl, status, html } = await fetchPage(websiteUrl, fetchImpl);
    result.pagesChecked++;
    // Still scan the body, but a blocked or missing page must not read as "no POS found"
    if (status >= 400) result.error = `HTTP ${status}`;
    if (!sameHost(finalUrl, websiteUrl)) note(finalUrl, `website redirects to ${finalUrl}`, true);
    scanPage(html, finalUrl, true);
  } catch (err) {
    result.error = err.message;
  }

  // 3. Follow order links that didn't already point at a known provider
  if (!hasStrongPos()) {
    // Links that leave the shop's own site are the likeliest ordering pages
    toFollow.sort((a, b) => sameHost(a.url, websiteUrl) - sameHost(b.url, websiteUrl));
    for (const { url, label } of toFollow.slice(0, MAX_FOLLOWS)) {
      try {
        const { finalUrl, html } = await fetchPage(url, fetchImpl);
        result.pagesChecked++;
        if (note(finalUrl, `order link "${label}" leads to ${finalUrl}`, true)) result.orderingUrl = finalUrl;
        scanPage(html, finalUrl, false);
      } catch { /* a dead order link is not a failure of the whole check */ }
      if (hasStrongPos()) break;
    }
  }

  // Square Online sites on a custom domain order at /s/order and load Square assets — verify
  if (squareOnlinePath && evidence.some(e => e.provider.name === 'Square')) {
    const square = PROVIDERS.find(p => p.name === 'Square');
    evidence.push({ provider: square, strength: 'medium', url: squareOnlinePath, where: 'Square Online ordering path on a Square-hosted site' });
  }

  // Pick the POS: strongest evidence wins; ties go to the provider listed first (Square last)
  const rank = e => STRENGTH[e.strength] * 100 - PROVIDERS.indexOf(e.provider);
  const posEvidence = evidence
    .filter(e => e.provider.kind === 'pos' && STRENGTH[e.strength] >= STRENGTH.medium)
    .sort((a, b) => rank(b) - rank(a));
  const best = posEvidence[0];
  if (best) {
    const rivals = new Set(posEvidence.filter(e => e.strength === best.strength && e.provider !== best.provider).map(e => e.provider.name));
    result.pos = best.provider.name;
    result.target = !!best.provider.target;
    result.confidence = rivals.size ? 'conflict' : best.strength;
    result.evidenceUrl = best.url;
    result.evidenceWhere = best.where;
  }

  const ordering = evidence
    .filter(e => e.provider.kind === 'ordering' && STRENGTH[e.strength] >= STRENGTH.medium)
    .sort((a, b) => rank(b) - rank(a))[0];
  if (ordering) {
    result.orderingProvider = ordering.provider.name;
    if (!best) { result.evidenceUrl = ordering.url; result.evidenceWhere = ordering.where; }
  }

  // Everything else we saw, one line per provider, for the CSV
  const seen = new Set();
  for (const e of [...evidence].sort((a, b) => rank(b) - rank(a))) {
    if (e === best || seen.has(e.provider.name) || (e.provider === best?.provider)) continue;
    seen.add(e.provider.name);
    result.signals.push(`${e.provider.name} (${e.strength}): ${e.url}`);
  }
  for (const name of marketplaces) result.signals.push(`marketplace: ${name}`);

  return result;
}
