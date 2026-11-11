// Deep dig for every unknown-POS shop in a scrape CSV.
// Usage: node dig.mjs <scrape.csv> <area-key> [--limit N] [--only "name substring"]
// Writes <scrape>-deepdig.csv (same rows, POS columns updated where something was found, plus
// original_verdict / deep_dig / web_searched / deep_dig_notes) and keeps state in out/logs/dig-<area>.json.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  PROJECT, get, webSearch, searchStats, searchBlocked, crawlSite, probeToast, checkToastUrl, classifyUrl, hostMatches,
  normPhone, parseCsv, toCsv, loadJson, saveJson, closeBrowser, sleep,
} from './lib.mjs';
const { detectPOS } = await import(PROJECT + '/pos.js');
const { CSV_COLUMNS } = await import(PROJECT + '/pipeline.js');

const [file, area] = process.argv.slice(2);
const opt = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const LIMIT = Number(opt('--limit') || 0);
const ONLY = opt('--only');
const STATE = `${PROJECT}/out/logs/dig-${area}.json`;
const CONCURRENCY = 3;

const rows = parseCsv(readFileSync(file, 'utf8'));
const state = loadJson(STATE, {});
const VERDICTS = (opt("--verdicts") || "unknown_pos").split(",");
let todo = rows.filter(r => VERDICTS.includes(r.verdict));
if (ONLY) todo = todo.filter(r => r.name.toLowerCase().includes(ONLY.toLowerCase()));
if (LIMIT) todo = todo.slice(0, LIMIT);
console.log(`${rows.length} rows, ${todo.length} unknown-POS shops to dig (${Object.keys(state).length} already in state)`);

const TARGET = new Set(['Square', 'Clover']);
const bare = url => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const verifiedWhere = where => /address\/phone match|name and city match|own website is a Square Online site/.test(where || '');

async function dig(row) {
  const shop = { name: row.name, address: row.address, city: row.city, zip: row.zip, phone: row.phone, website: row.website };
  const s = state[row.place_id] || {};
  const notes = [];

  // 1. deep crawl of the site + link hubs
  if (!s.crawl) {
    const c = await crawlSite(row.website, { maxPages: 20 });
    s.crawl = { pages: c.pages, hits: c.providerHits, orderLinks: c.orderLinks.slice(0, 10), social: c.social.slice(0, 8), hubs: c.hubs, poweredBy: c.poweredBy, error: c.error, textSample: c.text.slice(0, 3000), fetched: c.fetched.slice(0, 25) };
    state[row.place_id] = s; saveJson(STATE, state);
  }

  // 2. web search: name + city + square / clover / toast
  if (!s.search) {
    const queries = [`"${row.name}" ${row.city} square`, `"${row.name}" ${row.city} clover`, `"${row.name}" ${row.city} toasttab`];
    const results = [];
    let engines = [];
    for (const q of queries) {
      if (searchBlocked()) { /* Bing only */ }
      const r = await webSearch(q);
      engines.push(r.engine || 'none');
      for (const x of r.results.slice(0, 12)) results.push({ q, ...x });
    }
    s.search = { engines, results: results.map(x => ({ q: x.q, url: x.url, title: x.title.slice(0, 120), snippet: x.snippet.slice(0, 200) })) };
    state[row.place_id] = s; saveJson(STATE, state);
  }

  // 3. candidates: any POS-provider URL from the crawl or the search
  const candidates = [];
  const seenC = new Set();
  const addCand = (url, source) => {
    const hit = classifyUrl(url);
    if (!hit || hit.provider.kind !== 'pos') return;
    if (hit.provider.name === 'Square' && hit.strength === 'weak') return;   // payment scripts / weebly hosting
    if (hit.provider.name === 'Clover' && hit.strength === 'weak') return;
    const key = `${hit.provider.name}|${url.split('?')[0]}`;
    if (seenC.has(key)) return;
    seenC.add(key);
    candidates.push({ provider: hit.provider.name, strength: hit.strength, url, source });
  };
  for (const h of s.crawl.hits) addCand(h.url, h.where);
  // Clover slugs with a doubled dash are usually dead; the collapsed slug is the live page
  const dedash = () => { for (const c of [...candidates]) if (c.provider === 'Clover' && /--/.test(c.url)) addCand(c.url.replace(/-{2,}/g, '-'), `collapsed-dash variant of ${c.url}`); };
  for (const r of s.search.results) {
    addCand(r.url, `search result for ${r.q}: "${r.title}"`);
    // snippets sometimes carry the ordering host as text
    for (const m of (r.snippet + ' ' + r.title).matchAll(/https?:\/\/[^\s"'<>)]+/g)) addCand(m[0], `search snippet for ${r.q}`);
  }
  dedash();
  // Search results that land on the shop's own domain but a page we never crawled (e.g. order.<domain>)
  const home = bare(row.website || '');
  const extraPages = home ? s.search.results.filter(r => bare(r.url) !== home && bare(r.url).endsWith('.' + home)).map(r => r.url) : [];
  s.candidates = candidates;

  // 4. verify candidates: Square / Clover pages must match the shop's address, phone or name + city
  if (!s.verified) {
    s.verified = [];
    const squareClover = candidates.filter(c => TARGET.has(c.provider));
    for (const c of squareClover.slice(0, 6)) {
      const det = await detectPOS(c.url, { shop });
      s.verified.push({ url: c.url, provider: c.provider, pos: det.pos, confidence: det.confidence, where: det.evidenceWhere, evidenceUrl: det.evidenceUrl, ok: TARGET.has(det.pos) && verifiedWhere(det.evidenceWhere), source: c.source });
    }
    for (const u of extraPages.slice(0, 3)) {
      const det = await detectPOS(u, { shop });
      if (det.pos) s.verified.push({ url: u, provider: det.pos, pos: det.pos, confidence: det.confidence, where: det.evidenceWhere, evidenceUrl: det.evidenceUrl, ok: TARGET.has(det.pos) ? verifiedWhere(det.evidenceWhere) : det.confidence !== 'weak', source: 'search result on the shop domain' });
    }
    for (const c of candidates.filter(c => c.provider === 'Toast').slice(0, 3)) {
      const chk = await checkToastUrl(c.url, shop);
      s.verified.push({ url: c.url, provider: 'Toast', pos: chk.ok ? 'Toast' : null, confidence: chk.ok ? 'strong' : null, where: chk.ok ? `Toast ordering page matches the shop's ${chk.match} (${c.source})` : `Toast page ${c.url}: ${chk.reason}`, evidenceUrl: c.url, ok: chk.ok, source: c.source });
    }
    for (const c of candidates.filter(c => !TARGET.has(c.provider) && c.provider !== 'Toast').slice(0, 3)) {
      // other POS: a link from the shop's own site or hub counts; a bare search hit must carry the shop's name in the title
      const linked = /on https?:\/\//.test(c.source) && !/search/.test(c.source);
      const titled = /search result/.test(c.source) && new RegExp(row.name.split(/\s+/)[0].replace(/[^a-z0-9]/gi, ''), 'i').test(c.source);
      s.verified.push({ url: c.url, provider: c.provider, pos: linked || titled ? c.provider : null, confidence: linked ? 'strong' : titled ? 'medium' : null, where: `${c.provider} page ${c.url} — ${c.source}`, evidenceUrl: c.url, ok: linked || titled, source: c.source });
    }
    state[row.place_id] = s; saveJson(STATE, state);
  }

  const found = s.verified.find(v => v.ok && TARGET.has(v.pos)) || s.verified.find(v => v.ok);

  // 5. Toast slug probe when nothing else turned up
  if (!found && !s.toast) {
    s.toast = await probeToast(shop);
    state[row.place_id] = s; saveJson(STATE, state);
  }

  // 6. outcome
  const out = { verdict: 'unknown_pos', pos: '', pos_confidence: '', pos_evidence: '', pos_method: '', reason: row.reason };
  if (found) {
    out.pos = found.pos; out.pos_confidence = found.confidence || 'medium'; out.pos_evidence = found.evidenceUrl || found.url; out.pos_method = 'deep dig';
    out.verdict = TARGET.has(found.pos) ? 'new_target' : 'excluded_pos';
    out.reason = `${found.pos}: ${found.where}`;
    notes.push(`FOUND ${found.pos} (${out.pos_confidence}) via ${found.source.slice(0, 120)}`);
  } else if (s.toast?.found) {
    if (s.toast.match === 'phone' || s.toast.match === 'address') {
      out.verdict = 'excluded_pos'; out.pos = 'Toast'; out.pos_confidence = 'strong'; out.pos_evidence = s.toast.url; out.pos_method = 'Toast slug probe';
      out.reason = `runs Toast: order.toasttab.com page found by name, ${s.toast.match} matches (${s.toast.title})`;
      notes.push(`Toast page by slug (${s.toast.match} match): ${s.toast.url}`);
    } else notes.push(`same-name Toast page, no address/phone match: ${s.toast.url}`);
  } else if (s.toast) notes.push(`Toast: ${s.toast.tried.length} slugs tried, none`);

  const weak = s.verified.filter(v => !v.ok && TARGET.has(v.provider)).map(v => `${v.provider} page not this shop: ${v.url} (${(v.where || '').slice(0, 100)})`);
  const crawlHits = s.crawl.hits.filter(h => h.kind === 'pos').map(h => `${h.provider} ${h.strength}: ${h.url}`);
  notes.push(`crawl: ${s.crawl.pages} pages${s.crawl.error ? ` (error: ${s.crawl.error})` : ''}; hubs: ${s.crawl.hubs.length}; social: ${s.crawl.social.length}; powered by: ${[...new Set(s.crawl.poweredBy)].join('/') || 'none'}`);
  if (crawlHits.length) notes.push(`crawl POS hits: ${crawlHits.slice(0, 4).join(' | ')}`);
  notes.push(`search (${s.search.engines.join('/')}): ${s.search.results.length} results; POS-looking URLs: ${candidates.map(c => `${c.provider} ${c.url}`).slice(0, 4).join(' | ') || 'none'}`);
  if (weak.length) notes.push(weak.slice(0, 3).join(' | '));
  const ordering = s.crawl.hits.filter(h => h.kind === 'ordering').map(h => h.provider);
  if (ordering.length) notes.push(`ordering layers: ${[...new Set(ordering)].join(', ')}`);
  s.outcome = out; s.notes = notes.join(' || '); s.weak_hint = weak.length ? weak[0] : (s.toast?.found && s.toast.match === 'name' ? `same-name Toast page: ${s.toast.url}` : '');
  s.dug_at = new Date().toISOString();
  state[row.place_id] = s; saveJson(STATE, state);
  console.log(`  ${out.verdict.padEnd(12)} ${row.name} [${row.city}] ${out.pos ? `→ ${out.pos} ${out.pos_confidence}` : ''}`);
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const it = items[next++]; try { await fn(it); } catch (e) { console.error(`  ! ${it.name}: ${e.message}`); } }
  }));
}

await mapLimit(todo.filter(r => !state[r.place_id]?.outcome), CONCURRENCY, dig);
closeBrowser();

// write the deep-dig CSV
const extra = ['original_verdict', 'deep_dig', 'web_searched', 'deep_dig_notes', 'weak_hint_dig'];
for (const r of rows) {
  const s = state[r.place_id];
  r.original_verdict = r.original_verdict || r.verdict;
  if (!s?.outcome) continue;
  r.deep_dig = 'yes';
  r.web_searched = s.search.engines.some(e => e !== 'none') ? 'yes' : 'no (engines blocked)';
  r.deep_dig_notes = s.notes;
  r.weak_hint_dig = s.weak_hint || '';
  if (s.outcome.verdict !== 'unknown_pos') Object.assign(r, s.outcome);
}
const outFile = file.replace(/\.csv$/, '') + '-deepdig.csv';
writeFileSync(outFile, toCsv([...CSV_COLUMNS, ...extra], rows));
const counts = {};
for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
console.log('\nverdicts:', JSON.stringify(counts));
console.log('search engines used:', JSON.stringify(searchStats));
console.log('CSV:', outFile);
process.exit(0);
