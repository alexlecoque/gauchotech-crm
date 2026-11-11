// Shared helpers for the overnight deep dig: fetching, web search, site crawl, Toast probe, ABC lookups, Place Details.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import https from 'node:https';
import fetch from 'node-fetch';
import { renderPage, closeBrowser as closeBrowser2 } from './browser2.js';
import { renderPage as renderToast, closeBrowser as closeBrowser3 } from './browser3.js';
export const closeBrowser = () => { closeBrowser2(); closeBrowser3(); };

import { fileURLToPath } from 'node:url';
export const PROJECT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const { classifyUrl, extractLinks, PROVIDERS } = await import(PROJECT + '/pos.js');
const { normName, nameKey, normPhone, hostMatches } = await import(PROJECT + '/match.js');
const { parseCsv, toCsv } = await import(PROJECT + '/csv.js');
export { classifyUrl, extractLinks, PROVIDERS, normName, nameKey, normPhone, hostMatches, parseCsv, toCsv, renderPage };

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const agent = new https.Agent({ rejectUnauthorized: false });
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const today = () => new Date().toISOString().slice(0, 10);
export const stamp = () => new Date().toISOString().slice(0, 19).replace(/:/g, '-');

export const stripTags = s => String(s || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

// ── polite fetch, one request per host every 1.2 s ──────────────────────
const nextTurn = new Map();
async function turn(url) {
  const host = new URL(url).hostname.split('.').slice(-2).join('.');
  const at = Math.max(Date.now(), nextTurn.get(host) || 0);
  nextTurn.set(host, at + 1200);
  if (at > Date.now()) await sleep(at - Date.now());
}
export async function get(url, { timeout = 15000, headers = {} } = {}) {
  await turn(url);
  try {
    const res = await fetch(url, {
      agent: u => (u.protocol === 'https:' ? agent : undefined), signal: AbortSignal.timeout(timeout), size: 4_000_000, redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', ...headers },
    });
    const type = res.headers.get('content-type') || '';
    if (type && !/html|text|json|javascript|xml/i.test(type)) { res.body?.destroy?.(); return { status: res.status, url: res.url || url, html: '', type }; }
    return { status: res.status, url: res.url || url, html: await res.text(), type };
  } catch (e) { return { status: 0, url, html: '', error: String(e.message).split('\n')[0] }; }
}

// ── JSON state files (resumable) ────────────────────────────────────────
export const loadJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);
export const saveJson = (file, data) => writeFileSync(file, JSON.stringify(data, null, 1));

// ── Places request accounting (shared across scripts for the night cap) ─
const COUNTER = PROJECT + '/out/logs/places-requests.json';
export function countPlaces(kind, n = 1) {
  const c = loadJson(COUNTER, { text_search: 0, place_details: 0 });
  c[kind] = (c[kind] || 0) + n;
  saveJson(COUNTER, c);
  return c;
}
export const placesTotal = () => { const c = loadJson(COUNTER, {}); return (c.text_search || 0) + (c.place_details || 0); };

// ── Web search: DuckDuckGo html → lite → Bing ───────────────────────────
let ddgBlocked = false, liteBlocked = false;
let searchGap = Promise.resolve();
export const searchStats = { ddg: 0, lite: 0, bing: 0, failed: 0 };

function parseDdgHtml(html) {
  const out = [];
  for (const m of html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const raw = m[1].replace(/&amp;/g, '&');
    const url = decodeURIComponent((raw.match(/uddg=([^&]+)/) || [])[1] || raw);
    out.push({ url, title: stripTags(m[2]), snippet: '' });
  }
  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map(m => stripTags(m[1]));
  snippets.forEach((s, i) => { if (out[i]) out[i].snippet = s; });
  return out;
}
function parseDdgLite(html) {
  const out = [];
  const links = [...html.matchAll(/<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g)].map(m => stripTags(m[1]));
  links.forEach((m, i) => {
    const raw = m[1].replace(/&amp;/g, '&');
    const url = decodeURIComponent((raw.match(/uddg=([^&]+)/) || [])[1] || raw);
    out.push({ url, title: stripTags(m[2]), snippet: snippets[i] || '' });
  });
  return out;
}
function parseBing(html) {
  const out = [];
  for (const m of html.matchAll(/<li class="b_algo"[\s\S]*?<h2><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>([\s\S]*?)<\/li>/g)) {
    out.push({ url: m[1].replace(/&amp;/g, '&'), title: stripTags(m[2]), snippet: stripTags((m[3].match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '').slice(0, 300) });
  }
  return out;
}

// Returns { engine, results: [{ url, title, snippet }] } or { engine: null, results: [] } when every engine refused.
// Order: DuckDuckGo rendered in headless Chrome (the plain html/lite endpoints block this IP and Bing
// only honours the first word of a quoted query), then Yahoo as a plain-fetch fallback.
function parseYahoo(html) {
  const out = [];
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>\s*<h3[^>]*class="title[^"]*"[^>]*>([\s\S]*?)<\/h3>/g)) {
    let url = m[1].replace(/&amp;/g, '&');
    const ru = url.match(/RU=([^/]+)\//); if (ru) url = decodeURIComponent(ru[1]);
    out.push({ url, title: stripTags(m[2]), snippet: '' });
  }
  const snippets = [...html.matchAll(/<div class="compText[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map(m => stripTags(m[1]).slice(0, 300));
  snippets.forEach((sn, i) => { if (out[i]) out[i].snippet = sn; });
  return out.filter(r => /^https?:/.test(r.url) && !/yahoo\.com/.test(r.url));
}
function parseDdgRendered(html) {
  const out = [];
  for (const m of html.matchAll(/<a\b([^>]*data-testid="result-title-a"[^>]*)>([\s\S]*?)<\/a>/g)) {
    const href = (m[1].match(/href="([^"]+)"/) || [])[1];
    if (href) out.push({ url: href.replace(/&amp;/g, '&'), title: stripTags(m[2]), snippet: '' });
  }
  const snippets = [...html.matchAll(/data-result="snippet"[^>]*>([\s\S]*?)<\/div>/g)].map(m => stripTags(m[1]).slice(0, 300));
  snippets.forEach((sn, i) => { if (out[i]) out[i].snippet = sn; });
  return out;
}
let ddgChromeFails = 0;
export async function webSearch(query) {
  const run = async () => {
    const q = encodeURIComponent(query);
    if (ddgChromeFails < 4) {
      const page = await renderPage(`https://duckduckgo.com/?q=${q}&ia=web`, { waitMs: 15000 });
      if (page?.html) {
        const results = parseDdgRendered(page.html);
        if (results.length) { ddgChromeFails = 0; searchStats.ddg++; await sleep(500); return { engine: 'ddg-chrome', results }; }
        if (/no results|No results/i.test(page.text)) { searchStats.ddg++; return { engine: 'ddg-chrome', results: [] }; }
      }
      ddgChromeFails++;
    }
    const r = await get(`https://search.yahoo.com/search?p=${q}`);
    if (r.status === 200) {
      const results = parseYahoo(r.html);
      if (results.length || /did not match|No results/i.test(r.html)) { searchStats.yahoo = (searchStats.yahoo || 0) + 1; await sleep(2000); return { engine: 'yahoo', results }; }
    }
    searchStats.failed++;
    return { engine: null, results: [] };
  };
  const p = searchGap.then(run);
  searchGap = p.catch(() => {});
  return p;
}
export const searchBlocked = () => ddgChromeFails >= 4;

// ── Site crawl: every internal page (bounded), link hubs, raw URLs ──────
const SOCIAL = ['facebook.com', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com', 'youtube.com', 'yelp.com'];
const LINK_HUBS = ['linktr.ee', 'linkin.bio', 'bio.site', 'beacons.ai', 'lnk.bio', 'bio.link', 'linkpop.com', 'tap.bio', 'solo.to', 'campsite.bio', 'about.me'];
const SKIP = ['google.com', 'goo.gl', 'apple.com', 'gstatic.com', 'maps.apple.com', 'wa.me', 'opentable.com', 'resy.com', 'pinterest.com', 'vimeo.com', 'tripadvisor.com', 'doordash.com', 'ubereats.com', 'grubhub.com', 'postmates.com', 'seamless.com'];
const FILE_RE = /\.(pdf|jpe?g|png|gif|webp|svg|mp4|zip|docx?|css|js|ico|woff2?)(\?|$)/i;
const bare = url => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

// Returns { pages, providerHits: [{ provider, strength, url, where }], orderLinks, social, hubs, poweredBy, text, error, fetchFailures }
export async function crawlSite(website, { maxPages = 20 } = {}) {
  const out = { pages: 0, providerHits: [], orderLinks: [], social: [], hubs: [], poweredBy: [], text: '', error: null, fetchFailures: 0, fetched: [] };
  if (!website) return out;
  const start = (() => { try { return new URL(website).href; } catch { return null; } })();
  if (!start) return out;
  const home = bare(start);
  if (SOCIAL.some(h => hostMatches(home, h)) || SKIP.some(h => hostMatches(home, h))) { out.social.push(start); return out; }

  const queue = [start], seen = new Set([start.split('#')[0]]);
  const hitKeys = new Set();
  const note = (url, where) => {
    const hit = classifyUrl(url);
    if (!hit) return;
    const key = `${hit.provider.name}|${url.split('?')[0]}`;
    if (hitKeys.has(key)) return;
    hitKeys.add(key);
    out.providerHits.push({ provider: hit.provider.name, kind: hit.provider.kind, strength: hit.strength, url, where });
  };
  let texts = [];
  while (queue.length && out.pages < maxPages) {
    const url = queue.shift();
    const page = await get(url);
    out.fetched.push(`${page.status} ${url}`);
    if (page.status === 0 || page.status >= 400) { out.fetchFailures++; if (out.pages === 0 && !out.error) out.error = page.error || `HTTP ${page.status}`; continue; }
    out.pages++;
    if (!page.html) continue;
    if (out.pages === 1 && !bare(page.url).endsWith(home) && bare(page.url) !== home) note(page.url, `site redirects to ${page.url}`);
    const { links, raw } = extractLinks(page.html, page.url);
    const text = stripTags(page.html);
    texts.push(text.slice(0, 20000));
    for (const m of text.matchAll(/powered\s+by\s+([A-Za-z0-9.]{3,20})/gi)) out.poweredBy.push(m[1]);
    for (const { url: u, label } of links) {
      const h = bare(u);
      note(u, `link "${label || u}" on ${page.url}`);
      if (SOCIAL.some(s => hostMatches(h, s))) { if (!out.social.includes(u)) out.social.push(u); continue; }
      if (LINK_HUBS.some(s => hostMatches(h, s))) { if (!out.hubs.includes(u)) out.hubs.push(u); continue; }
      if (/order|pick-?up|delivery|carry-?out|take-?out/i.test(label) || /^(order|ordering|orders)\./.test(h)) if (!out.orderLinks.some(o => o.url === u)) out.orderLinks.push({ url: u, label });
      const sameSite = h === home || h.endsWith('.' + home) || home.endsWith('.' + h);
      if (sameSite && !FILE_RE.test(u) && !seen.has(u.split('#')[0])) { seen.add(u.split('#')[0]); queue.push(u.split('#')[0]); }
    }
    for (const u of raw) note(u, `source of ${page.url}`);
  }
  // Link hubs (linktr.ee etc.) list the ordering page more often than the site does
  for (const hub of out.hubs.slice(0, 3)) {
    const page = await get(hub);
    if (page.status !== 200) continue;
    const { links, raw } = extractLinks(page.html, page.url);
    for (const { url: u, label } of links) {
      note(u, `link "${label || u}" on ${hub}`);
      if (/order|pick-?up|delivery/i.test(label)) out.orderLinks.push({ url: u, label });
    }
    for (const u of raw) note(u, `source of ${hub}`);
  }
  // Order links that lead off-site to an unknown host: fetch and classify where they land and what they embed
  for (const link of out.orderLinks.filter(l => !classifyUrl(l.url) && !SOCIAL.concat(SKIP).some(s => hostMatches(bare(l.url), s)) && bare(l.url) !== home).slice(0, 5)) {
    const page = await get(link.url);
    if (!page.html) continue;
    note(page.url, `order link "${link.label}" leads to ${page.url}`);
    const { links, raw } = extractLinks(page.html, page.url);
    for (const { url: u } of links) note(u, `link on ordering page ${page.url}`);
    for (const u of raw) note(u, `source of ordering page ${page.url}`);
  }
  out.text = texts.join('\n');
  return out;
}

// ── Toast probe through headless Chrome ─────────────────────────────────
const STREET_FULL = { st: 'street', ave: 'avenue', blvd: 'boulevard', dr: 'drive', rd: 'road', ln: 'lane', pl: 'place', ct: 'court', hwy: 'highway', pkwy: 'parkway', cir: 'circle', way: 'way', n: 'north', s: 'south', e: 'east', w: 'west' };
export function toastSlugs(shop) {
  const forms = new Set();
  const words = normName(shop.name).split(' ').filter(w => w && !['inc', 'llc', 'co', 'corp'].includes(w));
  if (words.length) forms.add(words.join('-'));
  const short = normName(String(shop.name).split(/\s+[-–|]\s+|\s*\(/)[0]).split(' ').filter(Boolean).join('-');
  if (short) forms.add(short);
  const street = normName(String(shop.address || '').split(',')[0]);
  const streetFull = street.split(' ').map(w => STREET_FULL[w] || w).join(' ');
  const city = normName(shop.city);
  const slugs = new Set();
  for (const f of forms) {
    if (street) slugs.add(`${f}-${street.replace(/ /g, '-')}`);
    if (city) slugs.add(`${f}-${city.replace(/ /g, '-')}`);
    slugs.add(f);
  }
  for (const f of forms) if (street) slugs.add(`${f}-${streetFull.replace(/ /g, '-')}`);
  return [...slugs].filter(s => s.length >= 5 && s.length <= 90).slice(0, 5);
}
// Returns { found: bool, url, title, match: 'address'|'phone'|'name'|'other', text } for the first live page, else { found: false, tried }
export async function probeToast(shop, slugs = toastSlugs(shop)) {
  const phone = normPhone(shop.phone);
  const num = (String(shop.address || '').match(/^(\d+)/) || [])[1];
  const tried = [];
  for (const slug of slugs) {
    const url = `https://order.toasttab.com/online/${slug}`;
    const page = await renderToast(url, { waitMs: 9000 });
    tried.push(slug);
    if (!page) continue;
    if (/page not found|404/i.test(page.title) || /restaurant not found|page not found/i.test(page.text.slice(0, 2000))) continue;
    const text = page.text.replace(/\s+/g, ' ');
    const digits = text.replace(/\D/g, '');
    const match = phone && digits.includes(phone) ? 'phone' : num && new RegExp(`\\b${num}\\b`).test(text) ? 'address' : /order|menu/i.test(text) ? 'name' : 'other';
    return { found: true, url: page.finalUrl, title: page.title, match, text: text.slice(0, 400), tried };
  }
  return { found: false, tried };
}

// Verify a Toast URL found by web search belongs to the shop
export async function checkToastUrl(url, shop) {
  const page = await renderToast(url, { waitMs: 15000 });
  if (!page) return { ok: false, reason: 'could not render' };
  if (/page not found|404/i.test(page.title)) return { ok: false, reason: '404' };
  const text = page.text.replace(/\s+/g, ' ');
  const phone = normPhone(shop.phone);
  const num = (String(shop.address || '').match(/^(\d+)/) || [])[1];
  const street = normName(String(shop.address || '').split(',')[0]).split(' ').slice(1).find(w => !['n', 's', 'e', 'w'].includes(w));
  if (phone && text.replace(/\D/g, '').includes(phone)) return { ok: true, match: 'phone', title: page.title };
  if (num && street && new RegExp(`\\b${num}\\b[^.]{0,30}${street}`, 'i').test(text)) return { ok: true, match: 'address', title: page.title };
  return { ok: false, reason: 'no address/phone match', title: page.title, text: text.slice(0, 300) };
}

// ── ABC license lookup ──────────────────────────────────────────────────
const ABC_TYPES = [41, 47, 40, 42, 20, 21];
const abcCache = new Map();
async function abcCityList(city, type) {
  const key = `${city}|${type}`;
  if (abcCache.has(key)) return abcCache.get(key);
  const url = `https://www.abc.ca.gov/licensing/licensing-reports/adhoc-report/?LICENSETYPE=${type}&RPTTYPE=6&CITY=${encodeURIComponent(city.toUpperCase())}`;
  const page = await get(url, { timeout: 30000 });
  const rows = [];
  for (const m of page.html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => stripTags(c[1]));
    const lic = (m[1].match(/LICENSE=(\d+)/) || [])[1];
    if (cells.length >= 7) rows.push({ status: cells[0], type: cells[1], orig: cells[2], exp: cells[3], licensee: cells[4], address: cells[5], dba: cells[6], license: lic });
  }
  abcCache.set(key, rows);
  return rows;
}
const streetParts = address => {
  const first = normName(String(address || '').split(',')[0]);
  const m = first.match(/^(\d+)\s+(.*)$/);
  if (!m) return null;
  const word = m[2].split(' ').find(w => !['n', 's', 'e', 'w', 'north', 'south', 'east', 'west'].includes(w));
  return word ? { num: m[1], word } : null;
};
// Returns [{ licensee, dba, address, status, type, license, orig, members: [...] }]
export async function abcLookup(shop) {
  const parts = streetParts(shop.address);
  const cities = [...new Set([shop.city, (String(shop.address).split(',').map(s => s.trim())[1] || '')].filter(Boolean))];
  const hits = [];
  for (const city of cities) {
    for (const type of ABC_TYPES) {
      const rows = await abcCityList(city, type);
      for (const r of rows) {
        const rp = streetParts(r.address);
        const addrMatch = parts && rp && rp.num === parts.num && rp.word === parts.word;
        const nameMatch = r.dba && nameKey(r.dba) && nameKey(shop.name) && (nameKey(r.dba) === nameKey(shop.name) || nameKey(r.dba).includes(nameKey(shop.name)) || nameKey(shop.name).includes(nameKey(r.dba)));
        if (addrMatch || nameMatch) hits.push({ ...r, city, matched: addrMatch ? 'address' : 'name' });
      }
    }
  }
  // de-dup by license, prefer address matches
  const byLic = new Map();
  for (const h of hits.sort((a, b) => (a.matched === 'address' ? -1 : 1) - (b.matched === 'address' ? -1 : 1))) if (h.license && !byLic.has(h.license)) byLic.set(h.license, h);
  const out = [...byLic.values()].slice(0, 3);
  for (const h of out) {
    const page = await get(`https://www.abc.ca.gov/licensing/license-lookup/single-license/?RPTTYPE=12&LICENSE=${h.license}`, { timeout: 30000 });
    h.url = `https://www.abc.ca.gov/licensing/license-lookup/single-license/?RPTTYPE=12&LICENSE=${h.license}`;
    const text = stripTags(page.html);
    // The licensee block lists people with their roles, e.g. "SMITH, JOHN — MEMBER" or table rows
    const members = [];
    const li = page.html.indexOf('Licensee Information'); const lic = li < 0 ? '' : page.html.slice(li, page.html.indexOf('License Types', li) > 0 ? page.html.indexOf('License Types', li) : undefined);
    for (const m of lic.matchAll(/<dd>([^<]*)<\/dd>/g)) if (m[1].trim()) members.push(`LICENSEE: ${m[1].trim()}`);
    for (const m of lic.matchAll(/<p>\s*([A-Z][A-Z /-]{2,30}):\s*([^<]+)<\/p>/g)) members.push(`${m[1].trim()}: ${stripTags(m[2])}`);
    h.members = [...new Set(members)].slice(0, 12);
    h.statusLine = (text.match(/Status:?\s*([A-Z ]+?)\s{2}/) || [])[1] || h.status;
  }
  return out;
}

// ── Place Details ───────────────────────────────────────────────────────
const KEY = readFileSync(PROJECT + '/.env', 'utf8').match(/GOOGLE_PLACES_API_KEY=(.*)/)[1].trim();
const DETAIL_FIELDS = 'id,displayName,businessStatus,rating,userRatingCount,reviews.publishTime,reviews.rating,reviews.text.text,editorialSummary,reservable,servesCocktails,servesBeer,servesWine,dineIn,takeout,delivery,curbsidePickup,primaryType,types,regularOpeningHours.weekdayDescriptions,nationalPhoneNumber,websiteUri,priceLevel,formattedAddress,generativeSummary.overview.text';
export async function placeDetails(placeId) {
  countPlaces('place_details');
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, { headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': DETAIL_FIELDS }, signal: AbortSignal.timeout(20000) });
  const j = await res.json();
  if (j.error) return { error: j.error.message };
  return j;
}

// Owner sentences on the shop's own pages
export function ownerSentences(text) {
  const out = [];
  for (const m of String(text).matchAll(/[^.!?]{0,120}\b(owner|owned|founder|founded|proprietor|family-owned|family owned|chef\/owner|owner\/operator)\b[^.!?]{0,160}/gi)) {
    const s = m[0].trim();
    if (/[A-Z][a-z]+ [A-Z][a-z]+/.test(s)) out.push(s);
  }
  return [...new Set(out)].slice(0, 5);
}
