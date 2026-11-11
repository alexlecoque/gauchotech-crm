// Build the import plan and side CSVs for an area from the verified CSV plus my review overrides.
// Usage: node plan.mjs <verified.csv> <area-key> <overrides.json> [earlier-plan.csv ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { PROJECT, parseCsv, toCsv, loadJson, normPhone, today, stamp } from './lib.mjs';

const [file, area, overridesFile, ...earlier] = process.argv.slice(2);
const { AREAS } = await import(PROJECT + '/areas.js');
const norm = c => String(c || '').toLowerCase().replace(/[^a-z]/g, '');
const ownCities = new Set(AREAS[area].localities.map(norm));
const foreign = new Map();
for (const [k, a] of Object.entries(AREAS)) if (k !== area) for (const c of a.localities) if (!ownCities.has(norm(c))) foreign.set(norm(c), k);
// a row belongs to another area when its city is one of that area's localities and (if that area has a box) it sits inside the box
const inBox = (r, a) => !a.bounds || (Number(r.lat) >= a.bounds.low.latitude && Number(r.lat) <= a.bounds.high.latitude && Number(r.lng) >= a.bounds.low.longitude && Number(r.lng) <= a.bounds.high.longitude);
const foreignArea = r => { const k = !ownCities.has(norm(r.city)) && foreign.get(norm(r.city)); return k && inBox(r, AREAS[k]) ? k : null; };
// ICP-fit heuristic for shops nobody reviewed by hand (unknown-POS shops): counter/takeout pizzeria vs sit-down, bar, venue
const UNFIT_NAME = /\b(ristorante|trattoria|osteria|bar|grill|lounge|bistro|brew|tavern|cater|catering|cucina|steakhouse|wine)\b/i;
const UNFIT_TYPE = new Set(['italian_restaurant', 'bar', 'wine_bar', 'brewery', 'cafe', 'coffee_shop', 'bar_and_grill', 'american_restaurant', 'mediterranean_restaurant', 'greek_restaurant', 'mexican_restaurant', 'sandwich_shop', 'hamburger_restaurant', 'fast_food_restaurant', 'food_court', 'banquet_hall', 'event_venue']);
const VENUE_SITE = /knotts\.com|disney|hilton|marriott|hyatt|airport|mall\.com|stadium|angels\.com|honda-center/i;
function icpGuess(r) {
  if (VENUE_SITE.test(r.website || '')) return ['unlikely', 'venue / hotel / park concession'];
  if (UNFIT_NAME.test(r.name)) return ['unlikely', `name suggests sit-down or bar (${r.name.match(UNFIT_NAME)[1]})`];
  if (UNFIT_TYPE.has(r.primary_type) && r.primary_type !== 'fast_food_restaurant') return ['unlikely', `Google primary type ${r.primary_type}`];
  if (Number(r.rating_count || 0) < 15) return ['likely', 'pizza shop on Google, but fewer than 15 reviews (very new or very small)'];
  return ['likely', `Google primary type ${r.primary_type || 'n/a'}, ${r.rating_count} reviews`];
}
const rows = parseCsv(readFileSync(file, 'utf8'));
const ov = loadJson(overridesFile, {});
const TARGET = new Set(['Square', 'Clover']);
const ts = stamp();

// cross-area dedupe: anything already planned tonight
const planned = new Set();
for (const f of earlier) for (const r of parseCsv(readFileSync(f, 'utf8'))) { planned.add(r.place_id); if (normPhone(r.phone)) planned.add('p' + normPhone(r.phone)); }

const PLAN_COLS = ['verdict', 'reason', 'name', 'address', 'city', 'zip', 'area', 'county', 'phone', 'website', 'pos', 'pos_confidence', 'pos_evidence', 'pos_method', 'pos_conflict', 'ordering_provider', 'ordering_url', 'signals', 'pages_checked', 'fetch_error', 'match_rule', 'matched_type', 'matched_lead_id', 'matched_name', 'primary_place_id', 'location_count', 'place_id', 'google_maps_url', 'primary_type', 'business_status', 'rating_count', 'rating', 'lat', 'lng', 'query', 'import_plan', 'volume_estimate', 'volume_basis', 'icp_fit', 'icp_notes', 'weak_hint', 'open_check', 'pos_checked_live', 'phone_match', 'notes', 'owner_name', 'owner_role', 'owner_confidence', 'owner_source_url', 'original_verdict', 'deep_dig', 'web_searched', 'deep_dig_notes'];
const VOL = { high: 0, medium: 1, low: 2 };

const targets = [], weak = [], unknownFit = [], other = [], dropped = [], merged = [];
for (const r of rows) {
  const o = ov[r.place_id] || {};
  if (o.merge_into) {
    // another location of a shop in this plan: written as extra_location so the import attaches it to that lead
    Object.assign(r, { verdict: 'extra_location', primary_place_id: o.merge_into, reason: `another location of the same business (${o.merge_note || 'merged at review'})`, match_rule: 'review' });
    merged.push(r);
    continue;
  }
  Object.assign(r, Object.fromEntries(Object.entries(o).filter(([k]) => ['icp_fit', 'icp_notes', 'owner_name', 'owner_role', 'owner_confidence', 'owner_source_url', 'volume_estimate', 'volume_basis', 'extra_note', 'drop_reason', 'force_weak', 'phone', 'pos_evidence', 'pos_confidence', 'open_check', 'pos_checked_live', 'phone_match', 'verdict', 'pos', 'pos_method', 'primary_place_id', 'google_status', 'reason', 'county', 'city'].includes(k))));
  const f = foreignArea(r);
  if (f && !o.keep) { r.drop_reason = `${r.city} belongs to the ${f} area — handled in that run`; dropped.push(r); continue; }
  const isTarget = r.verdict === 'new_target' && TARGET.has(r.pos);
  if (isTarget) {
    const liveOk = /POS page matches/.test(r.open_check || '');
    const open = r.google_status === 'OPERATIONAL';
    const dup = planned.has(r.place_id) || (normPhone(r.phone) && planned.has('p' + normPhone(r.phone)));
    const reasons = [];
    if (!open) reasons.push(`Google status ${r.google_status || 'unknown'}`);
    if (!liveOk) reasons.push('POS page not confirmed live');
    if (r.icp_fit === 'no') reasons.push(`ICP: ${r.icp_notes || 'not a fit'}`);
    if (r.drop_reason) reasons.push(r.drop_reason);
    if (dup) reasons.push('already in an earlier plan tonight');
    if (!r.phone) reasons.push('no phone number');
    if (!['strong', 'medium'].includes(r.pos_confidence)) reasons.push(`POS confidence ${r.pos_confidence}`);
    if (r.force_weak) reasons.push(r.force_weak);
    if (reasons.length) {
      r.drop_reason = reasons.join('; ');
      if (/POS page not confirmed|POS confidence|force/.test(r.drop_reason) && open && !dup && r.icp_fit !== 'no') { r.weak_hint = r.weak_hint || r.drop_reason; weak.push(r); }
      else dropped.push(r);
      continue;
    }
    r.import_plan = 'target';
    const owner = r.owner_name ? `Owner: ${r.owner_name}${r.owner_role ? ` — ${r.owner_role}` : ''} (${r.owner_confidence || 'unrated'}${r.owner_source_url ? `; ${r.owner_source_url}` : ''}). ` : 'Owner: not found. ';
    r.notes = `POS: ${r.pos} (${r.pos_confidence} confidence), re-checked live ${today()}. Evidence: ${r.pos_evidence}. ${owner}Volume ${r.volume_estimate}: ${r.volume_basis}.${r.extra_note ? ` Note: ${r.extra_note}.` : ''}`;
    targets.push(r);
  } else if (r.verdict === 'unknown_pos') {
    if (!r.icp_fit) [r.icp_fit, r.icp_notes] = icpGuess(r);
    // weak hints are Square/Clover hints only; a same-name Toast page is just a note
    const hint = [r.weak_hint, r.weak_hint_dig].find(h => h && /Square|Clover/.test(h));
    if (hint) { r.weak_hint = hint; weak.push(r); }
    else if (r.icp_fit === 'yes' || r.icp_fit === 'likely') unknownFit.push(r);
    else other.push(r);
  } else other.push(r);
}
targets.sort((a, b) => (VOL[a.volume_estimate] ?? 3) - (VOL[b.volume_estimate] ?? 3) || Number(b.rating_count_live || b.rating_count || 0) - Number(a.rating_count_live || a.rating_count || 0));

const out = `${PROJECT}/out`;
const allCols = [...new Set([...PLAN_COLS, 'weak_hint_dig', 'drop_reason', 'google_status', 'google_summary', 'reservable', 'serves_cocktails', 'dine_in', 'takeout', 'status_flags', 'abc_hits', 'owner_site_sentences', 'owner_search_hints', 'rating_count_live'])];
const plannedIds = new Set(targets.map(t => t.place_id));
const mergedOk = merged.filter(m => plannedIds.has(m.primary_place_id));
writeFileSync(`${out}/import-plan-${area}-${ts}.csv`, toCsv(PLAN_COLS, [...targets, ...mergedOk]));
for (const m of merged.filter(m => !plannedIds.has(m.primary_place_id))) { m.drop_reason = 'merge target not in plan'; dropped.push(m); }
writeFileSync(`${out}/${area}-weak-hints-${ts}.csv`, toCsv(allCols, weak));
writeFileSync(`${out}/${area}-unknown-icp-fit-${ts}.csv`, toCsv(allCols, unknownFit));
writeFileSync(`${out}/${area}-other-shops-${ts}.csv`, toCsv(allCols, [...dropped, ...other]));
console.log(JSON.stringify({ targets: targets.length, merged_locations: mergedOk.length, weak: weak.length, unknownFit: unknownFit.length, dropped: dropped.length, other: other.length, stamp: ts }));
for (const r of targets) console.log(`  + ${r.name} [${r.city}] ${r.pos} ${r.pos_confidence} vol=${r.volume_estimate} owner=${r.owner_name || '-'}`);
for (const r of dropped) console.log(`  - ${r.name}: ${r.drop_reason}`);
