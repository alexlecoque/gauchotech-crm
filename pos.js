// POS detection: read the shop's website, follow its "order online" links, and
// record which provider's URL was found and where.
//
// A Square or Clover ordering page only counts in full once its address or phone matches
// the shop, and when the website shows no POS the likely Square / Clover addresses are
// tried by name. Sites that refuse a plain fetch are retried with a browser user agent,
// then read through headless Chrome.
import fetch from 'node-fetch';
import https from 'node:https';
import { hostMatches, normName, nameKey, normPhone } from './match.js';
import { renderPage } from './browser.js';

const FETCH_TIMEOUT_MS = 12000;
const MAX_HTML_BYTES = 5_000_000;
const HOST_GAP_MS = 1500;       // at most one request per site every 1.5 s
const PLATFORM_GAP_MS = 1000;   // square.site and clover.com take many single lookups
const MAX_INTERNAL = 8;         // order / menu / contact / footer pages on the shop's own site
const MAX_RENDERED = 5;         // …when every page has to go through Chrome
const MAX_FOLLOWS = 6;          // external order links and embedded widgets
const MAX_NESTED = 2;           // frames inside a followed ordering page
const STRENGTH = { weak: 1, medium: 2, strong: 3 };

// kind 'pos'      — a full point-of-sale system; decides whether the shop is a target
// kind 'ordering' — an ordering layer that sits on top of any POS; tells us nothing about the POS
//
// Rules are checked top to bottom per URL; the first rule that matches wins.
// POS providers are listed in tie-break order: Square is last because Square payment
// scripts and Square/Weebly-hosted sites show up on shops whose POS is something else.
export const PROVIDERS = [
  { name: 'Toast', kind: 'pos', rules: [
    { host: 'toasttab.com', strength: 'strong' },
    { host: 'toast.site', strength: 'strong' },
    { host: 'toast.app', strength: 'strong' },                   // toasttab.com/local redirects here
  ] },
  { name: 'SpotOn', kind: 'pos', rules: [
    { host: 'spoton.com', strength: 'strong' },
    { host: 'spotonorder.com', strength: 'strong' },
  ] },
  { name: 'Adora', kind: 'pos', rules: [
    { host: 'adorapos.com', strength: 'strong' },
  ] },
  { name: 'Lightspeed', kind: 'pos', rules: [
    { host: 'lightspeedrestaurant.com', strength: 'strong' },
    { host: 'upserve.com', strength: 'strong' },
  ] },
  { name: 'TouchBistro', kind: 'pos', rules: [
    { host: 'touchbistro.com', strength: 'strong' },
    { host: 'tbdine.com', strength: 'strong' },
  ] },
  { name: 'Revel', kind: 'pos', rules: [
    { host: 'revelsystems.com', strength: 'strong' },
    { host: 'revelup.com', strength: 'strong' },
  ] },
  { name: 'HungerRush', kind: 'pos', rules: [
    // static.hungerrush.com is the Menufy CDN (an ordering layer HungerRush owns), not the POS
    { host: 'hungerrush.com', not: /^static\./, strength: 'strong' },
  ] },
  { name: 'Thrive', kind: 'pos', rules: [
    { host: 'thrivepos.com', strength: 'strong' },
    { host: 'granburyrs.com', strength: 'strong' },
  ] },
  { name: 'FoodTec', kind: 'pos', rules: [
    { host: 'foodtecsolutions.com', strength: 'strong' },
  ] },
  { name: 'SpeedLine', kind: 'pos', rules: [
    { host: 'speedlinesolutions.com', strength: 'strong' },
  ] },
  { name: 'NCR Aloha', kind: 'pos', rules: [
    { host: 'alohaorderonline.com', strength: 'strong' },
  ] },
  { name: 'SkyTab', kind: 'pos', rules: [
    { host: 'skytab.com', strength: 'strong' },
  ] },
  { name: 'PAR Brink', kind: 'pos', rules: [
    { host: 'brinkpos.net', strength: 'strong' },
  ] },
  { name: 'Rezku', kind: 'pos', rules: [
    { host: 'rezku.com', strength: 'strong' },
  ] },
  { name: 'MenuSifu', kind: 'pos', rules: [
    { host: 'mealkeyway.com', strength: 'strong' },
    { host: 'menusifu.com', strength: 'strong' },
  ] },
  { name: 'Heartland', kind: 'pos', rules: [
    { host: 'mobilebytes.com', strength: 'strong' },
  ] },
  { name: 'eatOS', kind: 'pos', rules: [
    { host: 'eatos.com', strength: 'strong' },
  ] },
  { name: 'Clover', kind: 'pos', target: true, rules: [
    { host: 'checkout.clover.com', strength: 'weak' },           // payment SDK loaded by ChowNow and others
    { host: 'clover.com', path: /^\/online-ordering\/./, strength: 'strong' },
    { host: 'cloveronline.com', strength: 'strong' },
    { host: 'clover.com', strength: 'medium' },
    { host: 'smartonlineorder.com', strength: 'medium' },        // Clover-app ordering
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
  { name: 'Slice', kind: 'ordering', rules: [{ host: 'slicelife.com', strength: 'strong' }] },
  { name: 'ChowNow', kind: 'ordering', rules: [{ host: 'chownow.com', strength: 'strong' }] },
  { name: 'Olo', kind: 'ordering', rules: [{ host: 'olo.com', strength: 'strong' }] },
  { name: 'DoorDash Storefront', kind: 'ordering', rules: [{ host: 'order.online', strength: 'strong' }] },
  { name: 'Menufy', kind: 'ordering', rules: [
    { host: 'menufy.com', strength: 'strong' },
    { host: 'static.hungerrush.com', strength: 'strong' },
  ] },
  { name: 'Owner.com', kind: 'ordering', rules: [{ host: 'owner.com', strength: 'strong' }] },
  { name: 'BeyondMenu', kind: 'ordering', rules: [{ host: 'beyondmenu.com', strength: 'strong' }] },
  { name: 'Orders.co', kind: 'ordering', rules: [{ host: 'orders.co', strength: 'strong' }] },
  { name: 'Blizzfull', kind: 'ordering', rules: [{ host: 'blizzfull.com', strength: 'strong' }] },
  { name: 'Popmenu', kind: 'ordering', rules: [{ host: 'popmenu.com', strength: 'strong' }] },
  { name: 'BentoBox', kind: 'ordering', rules: [{ host: 'getbento.com', strength: 'strong' }] },
  { name: 'Otter', kind: 'ordering', rules: [{ host: 'tryotter.com', strength: 'strong' }] },
  { name: 'GloriaFood', kind: 'ordering', rules: [
    { host: 'gloriafood.com', strength: 'strong' },
    { host: 'foodbooking.com', strength: 'strong' },
    { host: 'restaurantlogin.com', strength: 'strong' },
  ] },
  { name: 'eHungry', kind: 'ordering', rules: [{ host: 'ehungry.com', strength: 'strong' }] },
  { name: 'Uber Eats webshop', kind: 'ordering', rules: [{ host: 'order.store', strength: 'strong' }] },
  { name: 'Flipdish', kind: 'ordering', rules: [{ host: 'flipdish.com', strength: 'strong' }] },
  { name: 'Zuppler', kind: 'ordering', rules: [{ host: 'zuppler.com', strength: 'strong' }] },
  { name: 'MenuDrive', kind: 'ordering', rules: [{ host: 'menudrive.com', strength: 'strong' }] },
  { name: 'EatStreet', kind: 'ordering', rules: [{ host: 'eatstreet.com', strength: 'strong' }] },
];

const MARKETPLACES = [
  { name: 'DoorDash', host: 'doordash.com' },
  { name: 'Uber Eats', host: 'ubereats.com' },
  { name: 'Grubhub', host: 'grubhub.com' },
  { name: 'Postmates', host: 'postmates.com' },
  { name: 'Seamless', host: 'seamless.com' },
];

// Never worth reading as a shop's website or following as an "order" link
const SKIP_HOSTS = [
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'yelp.com',
  'tripadvisor.com', 'google.com', 'goo.gl', 'apple.com', 'linktr.ee', 'pinterest.com', 'vimeo.com', 'wa.me',
  'opentable.com', 'resy.com', 'gstatic.com', 'recaptcha.net', ...MARKETPLACES.map(m => m.host),
];

const ORDER_RE = /order|pick-?up|delivery|carry-?out|take-?out/i;
// Pages on the shop's own site that tend to carry the ordering link or widget
const KEY_PAGE_RE = /menu|order|contact|location|about|cater|deliver|pick-?up|carry-?out|take-?out|online|shop|store|gift|hours|visit|find/i;
const FILE_RE = /\.(pdf|jpe?g|png|gif|webp|svg|mp4|zip|docx?)(\?|$)/i;
const CHALLENGE_RE = /just a moment|attention required|access denied|verify you are human|verifies you are not a bot|performing security verification|checking your browser|captcha/i;
const TOAST_LEGAL_RE = /^https?:\/\/pos\.toasttab\.com\/(privacy|terms)/;
// "Powered by …" footers, matched on the first word after "powered by"
const POWERED_BY = [
  [/^toast/i, 'Toast'], [/^square(?!space)/i, 'Square'], [/^clover/i, 'Clover'], [/^spoton/i, 'SpotOn'],
  [/^hungerrush/i, 'HungerRush'], [/^revel/i, 'Revel'], [/^adora/i, 'Adora'], [/^thrive/i, 'Thrive'], [/^foodtec/i, 'FoodTec'],
  [/^slice/i, 'Slice'], [/^menufy/i, 'Menufy'], [/^chownow/i, 'ChowNow'], [/^beyondmenu/i, 'BeyondMenu'],
  [/^popmenu/i, 'Popmenu'], [/^bentobox/i, 'BentoBox'], [/^gloriafood/i, 'GloriaFood'],
];

const BOT_UA = 'Mozilla/5.0 (compatible; GauchoBot/1.0)';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
      if (hostMatches(host, rule.host) && (!rule.path || rule.path.test(u.pathname)) && !(rule.not && rule.not.test(host))) {
        return { provider, strength: rule.strength };
      }
    }
  }
  return null;
}

const decodeEntities = s => s.replace(/&amp;/gi, '&').replace(/&#0?38;/g, '&').replace(/&#x2f;/gi, '/').replace(/&quot;/gi, '"').replace(/&nbsp;/gi, ' ');
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

// ── Fetching ─────────────────────────────────────────────────────────────
// Requests to one site are spaced out; *.square.site and clover.com each count as one site
const nextTurn = new Map();
async function waitTurn(url) {
  const site = new URL(url).hostname.split('.').slice(-2).join('.');
  const gap = site === 'square.site' || site === 'clover.com' ? PLATFORM_GAP_MS : HOST_GAP_MS;
  const now = Date.now();
  const at = Math.max(now, nextTurn.get(site) || 0);
  nextTurn.set(site, at + gap);
  if (at > now) await sleep(at - now);
}

async function fetchOnce(url, fetchImpl, browserUa) {
  await waitTurn(url);
  const res = await fetchImpl(url, {
    agent: u => (u.protocol === 'https:' ? httpsAgent : undefined),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    size: MAX_HTML_BYTES,
    headers: browserUa
      ? { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' }
      : { 'User-Agent': BOT_UA, Accept: 'text/html,*/*' },
  });
  const finalUrl = res.url || url;
  const type = res.headers.get('content-type') || '';
  // PDF menus and images are common "order" link targets — don't download them
  if (type && !/html|text|json|javascript|xml/i.test(type)) {
    res.body?.destroy?.();
    return { finalUrl, status: res.status, html: '' };
  }
  return { finalUrl, status: res.status, html: await res.text() };
}

const pageCache = new Map();
const browserUaHosts = new Set();   // hosts that refused the bot user agent

// Fetch with our own user agent first; a refusal or failure gets one retry with a normal
// browser user agent. Never throws: returns { finalUrl, status, html, error, retried }.
function fetchPage(url, fetchImpl, { browserFirst = false } = {}) {
  const key = url.split('#')[0];
  if (fetchImpl === fetch && pageCache.has(key)) return pageCache.get(key);

  const page = (async () => {
    const host = new URL(url).hostname;
    const first = browserFirst || browserUaHosts.has(host);
    let out = null, err = null, retried = false;
    try { out = await fetchOnce(url, fetchImpl, first); } catch (e) { err = e.message; }

    const refused = !out || (out.status >= 400 && out.status !== 404 && out.status !== 410);
    if (refused && !first) {
      retried = true;
      try {
        const again = await fetchOnce(url, fetchImpl, true);
        if (again.status < 400) browserUaHosts.add(host);
        out = again;
        err = null;
      } catch (e) { if (!out) err = e.message; }
    }
    if (!out) return { finalUrl: url, status: 0, html: '', error: String(err).split('\n')[0], retried };
    return { ...out, error: out.status >= 400 ? `HTTP ${out.status}` : null, retried };
  })();

  if (fetchImpl === fetch) {
    pageCache.set(key, page);
    // keep memory bounded on a long run
    if (pageCache.size > 600) for (const k of [...pageCache.keys()].slice(0, 300)) pageCache.delete(k);
  }
  return page;
}

const bareHost = url => parseUrl(url)?.hostname.toLowerCase().replace(/^www\./, '') || '';
const sameHost = (a, b) => bareHost(a) !== '' && bareHost(a) === bareHost(b);
const stripHash = url => url.split('#')[0].replace(/\/$/, '');

// ── Does an ordering page belong to this shop? ───────────────────────────
const DIRECTIONALS = new Set(['n', 's', 'e', 'w', 'north', 'south', 'east', 'west']);
// Words that don't tell one shop from another when comparing names
const NAME_FILLER = new Set(['los', 'angeles', 'la', 'ca', 'of', 'in', 'at', 'ny', 'new', 'york', 'style', 'italian', 'kitchen', 'cafe', 'grill', 'famous', 'original']);

const streetNumber = s => (String(s || '').trim().match(/^(\d+)/) || [])[1] || null;
const streetWord = s => normName(String(s || '').split(',')[0]).split(' ').slice(1).find(w => !DIRECTIONALS.has(w)) || null;

function namesMatch(a, b) {
  const words = s => new Set(nameKey(s).split(' ').filter(w => w && !NAME_FILLER.has(w)));
  let A = words(a), B = words(b);
  if (!A.size || !B.size) { A = new Set(normName(a).split(' ')); B = new Set(normName(b).split(' ')); }
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  return [...small].some(w => w.length >= 3) && [...small].every(w => big.has(w));
}

// shop: { name, address, city, zip, phone }. page: { name, phones[], addresses[{ street, city, zip }] }
// level: 'address'   — same phone, or same street number and street/ZIP
//        'name+city' — same name in the same city or ZIP
//        'name'      — same name, the page shows no location
//        'elsewhere' — same name at a different location (another branch, or another business)
//        'mismatch'  — a different business
function compareToShop(shop, page) {
  const phone = normPhone(shop.phone);
  const zip = String(shop.zip || '');
  const num = streetNumber(shop.address), word = streetWord(shop.address);

  const samePhone = !!phone && page.phones.some(p => normPhone(p) === phone);
  const sameAddress = !!num && page.addresses.some(a => streetNumber(a.street) === num
    && ((!!zip && (a.zip || '').slice(0, 5) === zip) || (!!word && streetWord(a.street) === word)));
  const sameCity = page.addresses.some(a => (!!zip && (a.zip || '').slice(0, 5) === zip)
    || (!!a.city && (normName(a.city) === normName(shop.city) || ` ${normName(shop.address)} `.includes(` ${normName(a.city)} `))));
  const sameName = namesMatch(shop.name, page.name || '');

  const where = page.addresses.map(a => [a.street, a.city, a.zip].filter(Boolean).join(', ')).join(' / ') || 'no address shown';
  const detail = `page is "${(page.name || '?').trim()}" — ${where}${page.phones.length ? ` — ${page.phones.join(', ')}` : ''}`;

  if (samePhone || sameAddress) return { level: 'address', detail };
  if (sameName && sameCity) return { level: 'name+city', detail };
  if (sameName && !page.addresses.length && !page.phones.length) return { level: 'name', detail };
  return { level: sameName ? 'elsewhere' : 'mismatch', detail };
}

// Is this page about the shop — its phone, its street address, or its name in the title?
// An "order" link can lead to a vendor's marketing page or a directory; what those pages
// link to says nothing about the shop.
function mentionsShop(shop, html) {
  if (!shop) return true;
  const text = stripTags(html);
  const phone = normPhone(shop.phone);
  if (phone && new RegExp(`${phone.slice(0, 3)}\\D{0,3}${phone.slice(3, 6)}\\D{0,2}${phone.slice(6)}`).test(text)) return true;
  const num = streetNumber(shop.address), word = streetWord(shop.address);
  if (num && word && new RegExp(`\\b${num}\\b[^<]{0,25}\\b${word}`, 'i').test(text)) return true;
  return namesMatch(shop.name, decodeEntities(html.match(/<title[^>]*>([^<]*)/i)?.[1] || ''));
}

// A Square Online site (a *.square.site address or a custom domain) → store details, or null.
// The page itself is a JS shell; name, address and phone come from the store-locations API it calls.
async function squareSiteInfo(url, fetchImpl) {
  const page = await fetchPage(url, fetchImpl, { browserFirst: true });
  if (page.status !== 200) return null;
  let boot;
  try { boot = JSON.parse(page.html.match(/__BOOTSTRAP_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/)[1]); } catch { return null; }

  const title = page.html.match(/apple-mobile-web-app-title['"] content=['"]([^'"]*)['"]/i)?.[1]
    || (page.html.match(/<title[^>]*>([^<]*)/i)?.[1] || '').trim();
  const store = boot.storeInfo || {};
  const fulfilment = store.fulfillment_support || {};
  const info = {
    url: page.finalUrl, name: decodeEntities(title), phones: [], addresses: [],
    ordering: !!(store.accepting_orders && (fulfilment.pickup || fulfilment.delivery) && (store.locations_counts?.pickup_or_delivery || 0) > 0),
  };

  const userId = boot.siteData?.user?.id;
  const siteId = boot.siteData?.site?.properties?.classicSiteID || boot.siteData?.site?.properties?.catalogSiteId;
  if (userId && siteId) {
    const api = `${new URL(page.finalUrl).origin}/app/store/api/v28/editor/users/${userId}/sites/${siteId}/store-locations?page=1&per_page=50`;
    const res = await fetchPage(api, fetchImpl, { browserFirst: true });
    try {
      for (const loc of JSON.parse(res.html).data || []) {
        const a = loc.address?.data || {};
        if (a.street) info.addresses.push({ street: a.street, city: a.city, zip: a.postal_code });
        if (a.phone) info.phones.push(a.phone);
        if (!info.name) info.name = loc.display_name || a.business_name || '';
      }
    } catch { /* locations not public */ }
  }
  return info;
}

// Clover online-ordering slug → merchant details, { missing: true } when Clover has no such
// merchant, or null when the lookup failed
async function cloverMerchant(slug, fetchImpl) {
  const page = await fetchPage(`https://www.clover.com/oloservice/v1/merchants/${encodeURIComponent(slug)}?slug=true`, fetchImpl, { browserFirst: true });
  if (page.status === 404) return { missing: true };
  if (page.status !== 200) return null;
  try {
    const m = JSON.parse(page.html);
    if (!m.merchantUuid) return null;
    const a = m.address || {};
    return {
      url: `https://www.clover.com/online-ordering/${slug}`, name: m.name || '', phones: m.phone ? [m.phone] : [],
      addresses: a.address1 ? [{ street: a.address1, city: a.city, zip: a.zip }] : [],
      ordering: (m.services || []).some(s => s.enabled && ['PICKUP', 'DELIVERY', 'CURBSIDE'].includes(s.type)),
    };
  } catch { return null; }
}

function cloverSlugOf(url) {
  const u = parseUrl(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (hostMatches(host, 'cloveronline.com') && host !== 'cloveronline.com') return host.split('.')[0];
  if (hostMatches(host, 'clover.com')) return u.pathname.match(/^\/online-ordering\/([^/?#]+)/)?.[1] || null;
  return null;
}

// ── Square / Clover addresses built from the shop name ───────────────────
// "Vincenzo's Pizza of NoHo" → "vincenzos pizza of noho", "vincenzos pizza"
function nameForms(name) {
  const forms = new Set();
  for (const n of [name, String(name).split(/\s+[-–|]\s+|\s*\(/)[0]]) {
    const words = normName(n).split(' ').filter(Boolean);
    if (words.length) forms.add(words.join(' '));
    const i = words.findIndex(w => /^pizz/.test(w));
    if (i > 0 && i < words.length - 1) forms.add(words.slice(0, i + 1).join(' '));
  }
  return [...forms].filter(f => f.replace(/ /g, '').length >= 5).slice(0, 3);
}

// Google gives the neighbourhood as the city inside LA; the address line may differ
function cityNames(shop) {
  const parts = String(shop.address || '').split(',').map(s => s.trim());
  const addressCity = parts.length >= 3 ? parts[parts.length - 3] : null;
  return [...new Set([shop.city, addressCity].map(c => normName(c)).filter(Boolean))];
}

// name.square.site, namecity.square.site, … plus the shop's own domain name
function squareSlugs(shop) {
  const slugs = new Set();
  for (const form of nameForms(shop.name)) {
    slugs.add(form.replace(/ /g, '-'));
    slugs.add(form.replace(/ /g, ''));
    for (const city of cityNames(shop)) {
      slugs.add(`${form} ${city}`.replace(/ /g, '-'));
      slugs.add(`${form}${city}`.replace(/ /g, ''));
    }
  }
  const domain = bareHost(shop.website || '').split('.')[0];
  if (domain && !classifyUrl(shop.website) && !SKIP_HOSTS.some(h => hostMatches(bareHost(shop.website), h))) slugs.add(domain);
  return [...slugs].filter(s => s.length >= 5 && s.length <= 60).slice(0, 8);
}

// Clover's own format is name-city; LA neighbourhoods are often filed under "los-angeles"
function cloverSlugs(shop) {
  const slugs = new Set();
  for (const form of nameForms(shop.name)) {
    for (const city of [...cityNames(shop), 'los angeles']) slugs.add(`${form} ${city}`.replace(/ /g, '-'));
    slugs.add(form.replace(/ /g, '-'));
  }
  return [...slugs].filter(s => s.length >= 5).slice(0, 9);
}

// ── Detection ────────────────────────────────────────────────────────────
// shop: { name, address, city, zip, phone, website } — enables the address checks and the
// name-built lookups; without it only the website is read.
// Returns {
//   pos, target, confidence ('strong' | 'medium' | 'conflict'), evidenceUrl, evidenceWhere,
//   method ('website' | 'website listed on Google' | 'name-built URL'), conflict,
//   orderingProvider, orderingUrl, signals[], pagesChecked, error, recoveredVia
// }
// `pos` is only set from strong or medium evidence of a full POS system.
export async function detectPOS(websiteUrl, { shop = null, fetchImpl = fetch, render = renderPage } = {}) {
  const result = {
    pos: null, target: false, confidence: null, evidenceUrl: null, evidenceWhere: null, method: null, conflict: null,
    orderingProvider: null, orderingUrl: null, signals: [], pagesChecked: 0, error: null, recoveredVia: null,
  };
  if (!websiteUrl && !shop) return result;

  const evidence = [];        // { provider, strength, url, where, method, linked, check }
  const seen = new Set();
  const marketplaces = new Set();
  const squareOnlineSites = new Set();   // origins whose pages say they are built on Square Online

  const add = e => {
    const key = `${e.provider.name}|${e.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    evidence.push({ method: 'website', linked: true, check: null, ...e });
  };

  // linked = a visitor-facing URL; otherwise it was only found in the page source,
  // which is worth one step less (a payment script is not an ordering page)
  const note = (url, where, linked, sourcePage, method) => {
    const hit = classifyUrl(url);
    if (!hit) return null;
    let strength = hit.strength;
    if (!linked) {
      // scripts on an ordering platform's own page say nothing about the shop
      if (sourcePage && classifyUrl(sourcePage)?.provider.kind === 'ordering') return hit;
      strength = strength === 'strong' ? 'medium' : 'weak';
    }
    if (linked && sourcePage && TOAST_LEGAL_RE.test(url)) {
      // Toast-built websites link Toast's own privacy and terms pages in the footer
      add({ provider: hit.provider, strength, url: sourcePage, where: `Toast-built website: links to Toast's privacy/terms pages on ${sourcePage}` });
      return hit;
    }
    add({ provider: hit.provider, strength, url, where, linked, ...(method ? { method } : {}) });
    return hit;
  };

  // Reads one page's links. Returns the pages worth reading next:
  // { internal: same-site order/menu/contact pages, order: external order links, frames: embedded widgets }
  const scanPage = (html, pageUrl) => {
    const next = { internal: [], order: [], frames: [] };
    if (!html) return next;
    const { links, raw } = extractLinks(html, pageUrl);

    for (const { url, label } of links) {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const hit = note(url, `link "${label || url}" on ${pageUrl}`, true, pageUrl);
      const marketplace = MARKETPLACES.find(m => hostMatches(host, m.host));
      if (marketplace) marketplaces.add(marketplace.name);

      const isOrderLink = ORDER_RE.test(label) || ORDER_RE.test(u.pathname) || /^(order|ordering|orders)\./.test(host);
      if (isOrderLink && (!result.orderingUrl || (hit && !classifyUrl(result.orderingUrl)))) result.orderingUrl = url;

      if (sameHost(url, pageUrl)) {
        if (!FILE_RE.test(u.pathname) && (KEY_PAGE_RE.test(label) || KEY_PAGE_RE.test(u.pathname))) next.internal.push({ url, label, isOrderLink });
        continue;
      }
      if (hit || FILE_RE.test(u.pathname) || SKIP_HOSTS.some(h => hostMatches(host, h))) continue;
      if (label === 'embedded frame') next.frames.push({ url, label });
      else if (isOrderLink) next.order.push({ url, label });
    }
    for (const url of raw) note(url, `page source of ${pageUrl}`, false, pageUrl);

    if (/<meta[^>]+content=["']Square Online["']/i.test(html)) squareOnlineSites.add(new URL(pageUrl).origin);

    if (classifyUrl(pageUrl)?.provider.kind !== 'ordering') {
      const text = stripTags(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' '));
      for (const m of text.matchAll(/powered\s+by\s+([A-Za-z0-9.]{3,20})/gi)) {
        const name = POWERED_BY.find(([re]) => re.test(m[1]))?.[1];
        const provider = PROVIDERS.find(p => p.name === name);
        if (provider) add({ provider, strength: 'medium', url: pageUrl, where: `text "${m[0]}" on ${pageUrl}` });
      }
    }
    return next;
  };

  const hasPos = min => evidence.some(e => e.provider.kind === 'pos' && STRENGTH[e.strength] >= STRENGTH[min]);

  // Square and Clover pages are checked against the shop's own name, address and phone:
  // a link to a sister restaurant's page, or a same-named shop elsewhere, is not evidence
  const applyCheck = (e, cmp, ordering) => {
    let strength = { address: 'strong', 'name+city': 'strong', name: 'medium', elsewhere: 'medium', mismatch: 'weak' }[cmp.level];
    if (!e.linked && cmp.level !== 'address') strength = strength === 'strong' ? 'medium' : 'weak';
    const matched = cmp.level === 'address' || cmp.level === 'name+city';
    // A page with ordering switched off only shows a merchant account, possibly left over from an earlier POS.
    // (The switch is read at run time: a shop that pauses online ordering after hours reads as off.)
    if (matched && ordering === false && strength === 'strong') strength = 'medium';
    e.strength = strength;
    e.check = cmp.level;
    e.where += cmp.level === 'address' ? ` — address/phone match (${cmp.detail})`
      : cmp.level === 'name+city' ? ` — name and city match (${cmp.detail})`
      : cmp.level === 'name' ? ' — name matches, no address on the page'
      : cmp.level === 'elsewhere' ? ` — same name at a different location (${cmp.detail})`
      : ` — NOT this shop (${cmp.detail})`;
    if (matched) e.where += ordering === false ? '; online ordering is switched off there' : ordering ? '; the page is taking orders' : '';
  };

  const verify = async () => {
    if (!shop) return;
    const pages = new Map();   // ordering page → the evidence that points at it
    for (const e of evidence) {
      if (e.check) continue;
      const key = e.provider.name === 'Square' && hostMatches(bareHost(e.url), 'square.site') ? `square:${new URL(e.url).origin}/`
        : e.provider.name === 'Clover' && cloverSlugOf(e.url) ? `clover:${cloverSlugOf(e.url)}`
        : null;
      if (key) pages.set(key, [...(pages.get(key) || []), e]);
    }
    for (const [key, list] of pages) {
      const info = key.startsWith('square:') ? await squareSiteInfo(key.slice(7), fetchImpl) : await cloverMerchant(key.slice(7), fetchImpl);
      result.pagesChecked++;
      for (const e of list) {
        if (info && !info.missing) { applyCheck(e, compareToShop(shop, info), info.ordering); continue; }
        e.check = info?.missing ? 'dead link' : 'unverified';
        if (e.strength === 'strong') e.strength = 'medium';
        e.where += info?.missing ? ' — but that Clover page no longer exists' : ' — ordering page could not be loaded to verify';
      }
    }
    // The shop's own website built on Square Online: an ordering store there is Square
    for (const origin of squareOnlineSites) {
      const square = PROVIDERS.find(p => p.name === 'Square');
      if (seen.has(`Square|${origin}`)) continue;
      const info = await squareSiteInfo(`${origin}/`, fetchImpl);
      result.pagesChecked++;
      add({
        provider: square, strength: info?.ordering ? 'strong' : 'medium', url: origin, check: 'own site',
        where: `the shop's own website is a Square Online site${info?.ordering ? ' with online ordering switched on' : ''}${info ? ` (${compareToShop(shop, info).detail})` : ''}`,
      });
    }
  };

  // 1. Many shops list their ordering page as their website on Google
  const listed = websiteUrl ? note(websiteUrl, 'website listed on Google', true, null, 'website listed on Google') : null;
  // …in which case there is no site of the shop's own to read (a weak hit is just the hosting)
  const readable = websiteUrl && !(listed && listed.strength !== 'weak') && !SKIP_HOSTS.some(h => hostMatches(bareHost(websiteUrl), h));

  if (readable) {
    // 2. Homepage
    const home = await fetchPage(websiteUrl, fetchImpl);
    result.pagesChecked++;
    let html = home.html, homeUrl = home.finalUrl;
    let viaChrome = false;
    const challenged = html.length < 30000 && CHALLENGE_RE.test(html);

    if ((home.error && home.status !== 404 && home.status !== 410) || challenged) {
      // Still scan the body: an error page can carry the real markup
      if (!challenged) scanPage(html, homeUrl);
      const page = await render(websiteUrl, { waitMs: 20000 });
      if (page && page.text.length > 200 && !CHALLENGE_RE.test(`${page.title} ${page.text.slice(0, 600)}`)) {
        html = page.html; homeUrl = page.finalUrl; viaChrome = true;
        result.recoveredVia = 'headless Chrome';
        for (const url of page.requests) note(url, `request made by ${homeUrl}`, false, homeUrl);
      } else {
        // a blocked or missing page must not read as "no POS found"
        result.error = challenged ? `${home.error || 'HTTP 200'} — bot check, also in headless Chrome` : home.error;
        if (challenged) html = '';
      }
    } else if (home.error) result.error = home.error;
    else if (home.retried) result.recoveredVia = 'browser user agent';

    if (!sameHost(homeUrl, websiteUrl)) note(homeUrl, `website redirects to ${homeUrl}`, true);
    const first = scanPage(html, homeUrl);
    const order = [...first.order], frames = [...first.frames];

    // 3. The shop's own order / menu / contact pages, then whatever the footer links to
    const footerAt = html.toLowerCase().lastIndexOf('<footer');
    const footer = extractLinks(footerAt >= 0 ? html.slice(footerAt) : html.slice(-Math.floor(html.length * 0.2)), homeUrl).links
      .filter(l => sameHost(l.url, homeUrl) && !FILE_RE.test(l.url));
    const internal = [];
    for (const link of [...first.internal.filter(l => l.isOrderLink), ...first.internal, ...footer]) {
      if (stripHash(link.url) === stripHash(homeUrl) || internal.some(l => stripHash(l.url) === stripHash(link.url))) continue;
      internal.push(link);
    }
    if (!first.internal.length && html && !result.error) {
      for (const path of ['/order', '/menu', '/contact']) internal.push({ url: new URL(path, homeUrl).href, label: path });
    }

    for (const link of internal.slice(0, viaChrome ? MAX_RENDERED : MAX_INTERNAL)) {
      let page;
      if (viaChrome) {
        const rendered = await render(link.url);
        if (!rendered) continue;
        page = { status: 200, finalUrl: rendered.finalUrl, html: rendered.html };
        for (const url of rendered.requests) note(url, `request made by ${rendered.finalUrl}`, false, rendered.finalUrl);
      } else page = await fetchPage(link.url, fetchImpl);
      result.pagesChecked++;
      if (page.status >= 400 || !page.html) continue;
      if (!sameHost(page.finalUrl, homeUrl)) note(page.finalUrl, `"${link.label}" on the shop's site leads to ${page.finalUrl}`, true);
      const found = scanPage(page.html, page.finalUrl);
      order.push(...found.order);
      frames.push(...found.frames);
    }

    // 4. Follow external order links and embedded widgets that didn't already point at a known provider
    const follow = [];
    for (const link of [...frames, ...order]) if (!follow.some(f => stripHash(f.url) === stripHash(link.url))) follow.push(link);
    let nested = 0;
    for (const link of follow.slice(0, MAX_FOLLOWS)) {
      if (hasPos('strong')) break;
      const page = await fetchPage(link.url, fetchImpl);
      result.pagesChecked++;
      if (!page.html) continue;   // a dead order link is not a failure of the whole check
      if (note(page.finalUrl, `order link "${link.label}" leads to ${page.finalUrl}`, true)) result.orderingUrl = page.finalUrl;
      // A widget embedded on the shop's own site belongs to the shop; a linked page has to mention it
      if (link.label !== 'embedded frame' && !mentionsShop(shop, page.html)) continue;
      const found = scanPage(page.html, page.finalUrl);
      for (const frame of found.frames) {
        if (nested >= MAX_NESTED || hasPos('strong')) break;
        nested++;
        const inner = await fetchPage(frame.url, fetchImpl);
        result.pagesChecked++;
        note(inner.finalUrl, `ordering page ${page.finalUrl} embeds ${inner.finalUrl}`, true);
        scanPage(inner.html, inner.finalUrl);
      }
    }

    // 5. A site that renders everything with JavaScript has nothing in its plain HTML
    if (!viaChrome && !result.error && !evidence.length && !follow.length && (html.match(/<a\b/gi) || []).length < 5) {
      const page = await render(homeUrl);
      if (page?.html) {
        for (const url of page.requests) note(url, `request made by ${homeUrl}`, false, homeUrl);
        scanPage(page.html, page.finalUrl);
      }
    }
  }
  await verify();

  // 6. Nothing solid on the website: try the Square and Clover addresses the shop would have
  //    if it used them, and count one only when the page's address or name + city matches
  //    (a dead Clover link on the site is worth a look for the page that replaced it)
  const solid = evidence.some(e => e.provider.kind === 'pos' && STRENGTH[e.strength] >= STRENGTH.medium && e.check !== 'dead link');
  if (shop && !solid) {
    const byName = (provider, info, cmp) => add({
      provider: PROVIDERS.find(p => p.name === provider), url: info.url, method: 'name-built URL', check: cmp.level,
      // found by guessing, not linked by the shop: full strength only when it is this address and taking orders
      strength: cmp.level === 'address' && info.ordering ? 'strong' : 'medium',
      where: `${provider} page found by name — ${cmp.level === 'address' ? 'address/phone match' : 'name and city match'} (${cmp.detail})`
        + (info.ordering ? '; the page is taking orders' : '; online ordering is switched off there'),
    });
    for (const slug of squareSlugs(shop)) {
      const info = await squareSiteInfo(`https://${slug}.square.site/`, fetchImpl);
      if (!info) continue;
      const cmp = compareToShop(shop, info);
      if (cmp.level === 'address' || cmp.level === 'name+city') { byName('Square', info, cmp); break; }
    }
    for (const slug of cloverSlugs(shop)) {
      if (hasPos('strong')) break;
      const info = await cloverMerchant(slug, fetchImpl);
      if (!info || info.missing) continue;
      const cmp = compareToShop(shop, info);
      if (cmp.level === 'address' || cmp.level === 'name+city') { byName('Clover', info, cmp); break; }
    }
  }

  // Pick the POS: strongest evidence wins; ties go to the provider listed first (Square last)
  // (a page that still exists beats a dead link of the same strength)
  const rank = e => STRENGTH[e.strength] * 100 - PROVIDERS.indexOf(e.provider) - (e.check === 'dead link' ? 0.5 : 0);
  const posEvidence = evidence
    .filter(e => e.provider.kind === 'pos' && STRENGTH[e.strength] >= STRENGTH.medium)
    .sort((a, b) => rank(b) - rank(a));
  const best = posEvidence[0];
  if (best) {
    const others = posEvidence.filter(e => e.provider !== best.provider);
    const tied = others.some(e => e.strength === best.strength);
    result.pos = best.provider.name;
    result.target = !!best.provider.target;
    result.confidence = tied ? 'conflict' : best.strength;
    result.evidenceUrl = best.url;
    result.evidenceWhere = best.where;
    result.method = best.method;
    result.conflict = [...new Set(others.map(e => `${e.provider.name} (${e.strength}): ${e.url}`))].slice(0, 3).join(' ; ') || null;
  }

  const ordering = evidence
    .filter(e => e.provider.kind === 'ordering' && STRENGTH[e.strength] >= STRENGTH.medium)
    .sort((a, b) => rank(b) - rank(a))[0];
  if (ordering) {
    result.orderingProvider = ordering.provider.name;
    if (!best) { result.evidenceUrl = ordering.url; result.evidenceWhere = ordering.where; }
  }

  // Everything else we saw, one line per provider, for the CSV
  const listedProviders = new Set();
  for (const e of [...evidence].sort((a, b) => rank(b) - rank(a))) {
    if (e === best || listedProviders.has(e.provider.name) || (e.provider === best?.provider)) continue;
    listedProviders.add(e.provider.name);
    result.signals.push(`${e.provider.name} (${e.strength}): ${e.url}`);
  }
  for (const name of marketplaces) result.signals.push(`marketplace: ${name}`);
  if (result.recoveredVia) result.signals.push(`site read via ${result.recoveredVia}`);

  return result;
}
