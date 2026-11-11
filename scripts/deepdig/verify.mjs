// Live verification + owner research + volume estimate for every Square/Clover target in a deep-dig CSV.
// Usage: node verify.mjs <deepdig.csv> <area-key> [--only "name"] [--fresh]
// State: out/logs/verify-<area>.json. Output: <deepdig>-verified.csv with the extra columns below.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  PROJECT, get, webSearch, crawlSite, placeDetails, abcLookup, ownerSentences, stripTags, normPhone, normName, nameKey,
  parseCsv, toCsv, loadJson, saveJson, closeBrowser, today,
} from './lib.mjs';
const { detectPOS } = await import(PROJECT + '/pos.js');

const [file, area] = process.argv.slice(2);
const opt = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const ONLY = opt('--only');
const STATE = `${PROJECT}/out/logs/verify-${area}.json`;
const TARGET = new Set(['Square', 'Clover']);

const rows = parseCsv(readFileSync(file, 'utf8'));
const state = loadJson(STATE, {});
let todo = rows.filter(r => r.verdict === 'new_target' && TARGET.has(r.pos));
if (ONLY) todo = todo.filter(r => r.name.toLowerCase().includes(ONLY.toLowerCase()));
console.log(`${todo.length} target(s) to verify (${Object.keys(state).length} in state)`);

const verifiedWhere = where => /address\/phone match|name and city match|own website is a Square Online site/.test(where || '');
const phoneIn = (phone, text) => { const p = normPhone(phone); return !!p && String(text || '').replace(/\D/g, '').includes(p); };

async function verify(row) {
  const shop = { name: row.name, address: row.address, city: row.city, zip: row.zip, phone: row.phone, website: row.website };
  const s = state[row.place_id] || {};

  // Google today
  if (!s.details) { s.details = await placeDetails(row.place_id); state[row.place_id] = s; saveJson(STATE, state); }
  const d = s.details;

  // POS live: the website first, then the recorded evidence URL
  if (!s.live) {
    let det = row.website ? await detectPOS(row.website, { shop }) : null;
    let via = 'website';
    if (!(det && TARGET.has(det.pos) && verifiedWhere(det.evidenceWhere)) && row.pos_evidence) {
      const det2 = await detectPOS(row.pos_evidence, { shop });
      if (det2 && TARGET.has(det2.pos) && verifiedWhere(det2.evidenceWhere)) { det = det2; via = 'evidence URL'; }
      else if (!det || !det.pos) { det = det2; via = 'evidence URL'; }
    }
    s.live = det ? { via, pos: det.pos, confidence: det.confidence, evidenceUrl: det.evidenceUrl, where: det.evidenceWhere, conflict: det.conflict, signals: det.signals, ok: TARGET.has(det.pos) && verifiedWhere(det.evidenceWhere) } : { via, ok: false };
    state[row.place_id] = s; saveJson(STATE, state);
  }

  // Closed / for sale / chain signals from a plain web search + the site text
  if (!s.status) {
    const r = await webSearch(`"${row.name}" ${row.city} pizza`);
    const blob = r.results.map(x => `${x.title} ${x.snippet}`).join(' | ');
    const flags = [];
    if (/permanently closed|closed permanently|has closed|now closed|closed its doors/i.test(blob)) flags.push('search mentions closed');
    if (/for sale|business for sale|bizbuysell|restaurant for sale/i.test(blob)) flags.push('search mentions for sale');
    if (/franchise|franchising|locations across|\d+ locations/i.test(blob)) flags.push('search mentions franchise/locations');
    const crawl = await crawlSite(row.website, { maxPages: 8 });
    const text = crawl.text || '';
    if (/for sale|business for sale/i.test(text)) flags.push('site mentions for sale');
    if (/permanently closed|we are closed|closed for good|closed our doors/i.test(text)) flags.push('site mentions closed');
    if (/franchis/i.test(text)) flags.push('site mentions franchise');
    const locs = (text.match(/\blocations?\b/gi) || []).length;
    s.status = { engine: r.engine, flags, searchTop: r.results.slice(0, 5).map(x => `${x.title} — ${x.url}`), siteText: text.slice(0, 6000), ownerSentences: ownerSentences(text), locationMentions: locs, social: crawl.social.slice(0, 6), marketplaces: [...new Set((crawl.text.match(/doordash|ubereats|uber eats|grubhub|slice/gi) || []).map(m => m.toLowerCase()))] };
    state[row.place_id] = s; saveJson(STATE, state);
  }

  // Owner research: ABC, own site, web search
  if (!s.owner) {
    const abc = await abcLookup(shop).catch(e => ({ error: e.message }));
    const r = await webSearch(`"${row.name}" ${row.city} owner`);
    const hints = [];
    for (const x of r.results.slice(0, 10)) {
      const t = `${x.title} ${x.snippet}`;
      for (const m of t.matchAll(/(?:owner|owners|co-owner|founder|proprietor|chef-owner|owned by|run by|opened by)[^.]{0,8}?\b([A-Z][a-z]+(?: [A-Z][a-z]+){0,2})|([A-Z][a-z]+ [A-Z][a-z]+)(?:,| is| was|’s| the)? (?:the )?(?:owner|co-owner|founder|proprietor)/g)) {
        hints.push({ name: m[1] || m[2], text: t.slice(Math.max(0, m.index - 80), m.index + 120), url: x.url });
      }
    }
    s.owner = { abc: Array.isArray(abc) ? abc : [], abcError: abc?.error, searchEngine: r.engine, hints: hints.slice(0, 8), searchTop: r.results.slice(0, 6).map(x => `${x.title} — ${x.url} — ${x.snippet.slice(0, 160)}`) };
    state[row.place_id] = s; saveJson(STATE, state);
  }

  // Volume estimate
  const count = d.userRatingCount ?? Number(row.rating_count || 0);
  const rating = d.rating ?? row.rating;
  const dates = (d.reviews || []).map(r => (r.publishTime || '').slice(0, 10)).filter(Boolean).sort();
  const cutoff = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  const recent = dates.filter(x => x >= cutoff).length;
  let volume = count >= 500 ? 'high' : count >= 150 ? 'medium' : 'low';
  if (volume !== 'low' && dates.length && recent === 0) volume = volume === 'high' ? 'medium' : 'low';
  const basis = `${count} Google reviews at ${rating}★; ${recent} of the ${dates.length} reviews Google returned are from the last 6 months (latest ${dates.at(-1) || 'n/a'})${s.status.marketplaces.length ? `; marketplaces on site: ${s.status.marketplaces.join(', ')}` : ''}`;

  s.summary = {
    open_check: `Google ${d.businessStatus || 'unknown'} on ${today()}; ${s.live.ok ? 'POS page matches' : 'POS page NOT confirmed'}; latest reviews ${dates.slice(-3).join(', ') || 'n/a'}`,
    pos_checked_live: s.live.ok ? `${today()}: ${s.live.pos} ${s.live.confidence} ${s.live.evidenceUrl} — ${(s.live.where || '').slice(0, 220)}` : `${today()}: NOT confirmed (${s.live.pos || 'no POS'} ${s.live.confidence || ''} via ${s.live.via}: ${(s.live.where || '').slice(0, 200)})`,
    phone_match: !row.phone ? 'no Google phone' : phoneIn(row.phone, s.live.where) ? 'match' : /address\/phone match/.test(s.live.where || '') ? 'address match' : 'no phone on page',
    volume_estimate: volume, volume_basis: basis,
    google_status: d.businessStatus || '', google_summary: d.editorialSummary?.text || d.generativeSummary?.overview?.text || '',
    reservable: d.reservable ?? '', serves_cocktails: d.servesCocktails ?? '', serves_beer: d.servesBeer ?? '', dine_in: d.dineIn ?? '', takeout: d.takeout ?? '', delivery: d.delivery ?? '',
    primary_type_live: d.primaryType || '', types_live: (d.types || []).filter(t => !['point_of_interest', 'establishment', 'food'].includes(t)).join(' '),
    hours: (d.regularOpeningHours?.weekdayDescriptions || []).join('; '), price_level: d.priceLevel || '',
    status_flags: s.status.flags.join('; '), social: s.status.social.join(' '),
    abc_hits: s.owner.abc.map(a => `${a.dba} / ${a.licensee} (type ${a.type}, ${a.status}, since ${a.orig}; ${a.matched} match) members: ${(a.members || []).join('; ') || 'n/a'} — ${a.url}`).join(' || '),
    owner_site_sentences: s.status.ownerSentences.join(' | '),
    owner_search_hints: s.owner.hints.map(h => `${h.name}: ${h.text.replace(/\s+/g, ' ')} [${h.url}]`).join(' || '),
    owner_search_top: s.owner.searchTop.join(' || '),
    rating_live: rating ?? '', rating_count_live: count,
  };
  state[row.place_id] = s; saveJson(STATE, state);
  console.log(`  ${s.live.ok ? 'OK ' : 'NO '} ${row.name} [${row.city}] ${d.businessStatus} ${volume} ${s.status.flags.join(';')} abc:${s.owner.abc.length}`);
}

for (const row of todo) {
  if (state[row.place_id]?.summary && !process.argv.includes('--fresh')) continue;
  try { await verify(row); } catch (e) { console.error(`  ! ${row.name}: ${e.message}`); }
}
closeBrowser();

const EXTRA = ['open_check', 'pos_checked_live', 'phone_match', 'volume_estimate', 'volume_basis', 'google_status', 'google_summary', 'reservable', 'serves_cocktails', 'serves_beer', 'dine_in', 'takeout', 'delivery', 'primary_type_live', 'types_live', 'hours', 'price_level', 'status_flags', 'social', 'abc_hits', 'owner_site_sentences', 'owner_search_hints', 'owner_search_top', 'rating_live', 'rating_count_live'];
const header = Object.keys(rows[0]);
for (const r of rows) {
  const s = state[r.place_id];
  if (s?.summary) Object.assign(r, s.summary);
}
const outFile = file.replace(/\.csv$/, '') + '-verified.csv';
writeFileSync(outFile, toCsv([...header, ...EXTRA.filter(c => !header.includes(c))], rows));
console.log('CSV:', outFile);
process.exit(0);
