// Turns raw Places results into one row per place with a verdict, and works out
// what would be written to the CRM. No network or database access in this file.
import { nameKey, normPhone, brandKey, findMatch } from './match.js';
import { chainMatch, notPizzaReason, SUSPECTED_CHAIN_MIN } from './filters.js';

// verdict:
//   new_target      — new independent pizza shop on Square or Clover → becomes a lead
//   unknown_pos     — new shop, POS not visible (incl. ordering-only providers like Slice)
//   excluded_pos    — new shop on another POS (Toast, SpotOn, Adora, …)
//   suspected_chain — name appears 4+ times in this run; review by hand
//   extra_location  — another location of a business in this run or already in the CRM
//   duplicate       — already in the CRM
//   excluded_chain / not_pizza / closed
export const CSV_COLUMNS = [
  'verdict', 'reason', 'name', 'address', 'city', 'zip', 'area', 'county', 'phone', 'website',
  'pos', 'pos_confidence', 'pos_evidence', 'pos_method', 'pos_conflict', 'ordering_provider', 'ordering_url', 'signals',
  'pages_checked', 'fetch_error', 'match_rule', 'matched_type', 'matched_lead_id', 'matched_name',
  'primary_place_id', 'location_count', 'place_id', 'google_maps_url', 'primary_type',
  'business_status', 'rating_count', 'lat', 'lng', 'query',
];

const component = (place, type) => place.addressComponents?.find(c => c.types?.includes(type))?.longText || null;

function cityOf(place, locality) {
  const parts = (place.formattedAddress || '').split(',').map(s => s.trim());
  let city = parts.length >= 3 ? parts[parts.length - 3] : parts.length >= 2 ? parts[parts.length - 2] : '';
  // Inside LA city limits, prefer the neighbourhood (Van Nuys, Encino…) over "Los Angeles"
  if (city === 'Los Angeles') city = component(place, 'neighborhood') || city;
  return city || locality || '';
}

function toRow({ place, query, locality }, area) {
  return {
    verdict: '', reason: '',
    name: place.displayName?.text || '',
    address: place.formattedAddress || null,
    city: cityOf(place, locality),
    zip: component(place, 'postal_code'),
    area: area.label,
    county: area.county,
    phone: place.nationalPhoneNumber || null,
    website: place.websiteUri || null,
    place_id: place.id,
    google_maps_url: place.googleMapsUri || null,
    primary_type: place.primaryType || null,
    business_status: place.businessStatus || null,
    rating_count: place.userRatingCount ?? null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    query,
  };
}

// found: [{ place, query, locality }], already unique by place id.
// Returns { rows, groups } — rows covers every place; groups are the businesses that
// still need a POS check: { primary, members, nameCount }.
export function screenPlaces(found, area, index) {
  const rows = [];
  const pending = [];

  const nameCounts = new Map();
  for (const { place } of found) {
    const key = nameKey(place.displayName?.text);
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }

  for (const item of found) {
    const row = toRow(item, area);
    rows.push(row);

    const match = findMatch(index, row);
    const applyMatch = () => Object.assign(row, {
      verdict: match.kind,
      reason: match.kind === 'duplicate'
        ? `already in CRM as ${match.type} "${match.record.name}" (matched on ${match.rule})`
        : `another location of ${match.type} "${match.record.name}" (matched on ${match.rule})`,
      match_rule: match.rule, matched_type: match.type,
      matched_lead_id: match.record.id, matched_name: match.record.name,
    });

    // The exact shop already in the CRM is a duplicate whatever it is
    if (match?.kind === 'duplicate') { applyMatch(); continue; }

    if (item.place.businessStatus === 'CLOSED_PERMANENTLY') {
      Object.assign(row, { verdict: 'closed', reason: 'permanently closed on Google' });
      continue;
    }
    const chain = chainMatch(row.name);
    if (chain) { Object.assign(row, { verdict: 'excluded_chain', reason: `chain: ${chain}` }); continue; }
    const notPizza = notPizzaReason(item.place);
    if (notPizza) { Object.assign(row, { verdict: 'not_pizza', reason: notPizza }); continue; }

    // Only after the filters: a chain or non-pizza lead left in the CRM by an older run
    // must not collect every other branch of that brand as an extra location
    if (match) { applyMatch(); continue; }

    pending.push(row);
  }

  // Fold locations of the same business together: shared phone, or same name + website
  const groups = [];
  const byKey = new Map();
  for (const row of pending) {
    const phone = normPhone(row.phone);
    const brand = brandKey(row.name, row.website);
    const keys = [phone && `phone:${phone}`, brand && `brand:${brand}`].filter(Boolean);

    let group = keys.map(k => byKey.get(k)).find(Boolean);
    if (group) {
      const rule = byKey.get(keys[0]) === group && phone ? 'phone' : 'name+website';
      Object.assign(row, {
        verdict: 'extra_location',
        reason: `another location of "${group.primary.name}" in this run (matched on ${rule})`,
        match_rule: rule, primary_place_id: group.primary.place_id,
      });
      group.members.push(row);
    } else {
      group = { primary: row, members: [], nameCount: nameCounts.get(nameKey(row.name)) || 1 };
      groups.push(group);
    }
    for (const k of keys) if (!byKey.has(k)) byKey.set(k, group);
  }
  for (const group of groups) group.primary.location_count = 1 + group.members.length;

  return { rows, groups };
}

// Fill in the POS columns and the final verdict for a business
export function applyDetection(group, det) {
  const row = group.primary;
  Object.assign(row, {
    pos: det.pos,
    pos_confidence: det.confidence,
    pos_evidence: det.evidenceUrl,
    pos_method: det.method,
    pos_conflict: det.conflict,
    ordering_provider: det.orderingProvider,
    ordering_url: det.orderingUrl,
    signals: det.signals.join(' | '),
    pages_checked: det.pagesChecked,
    fetch_error: det.error,
  });

  const conflict = det.confidence === 'conflict' ? ' — conflicting POS evidence, see signals' : '';

  if (group.nameCount >= SUSPECTED_CHAIN_MIN) {
    row.verdict = 'suspected_chain';
    row.reason = `name appears ${group.nameCount} times in this run` + (det.pos ? `; POS looks like ${det.pos}` : '');
  } else if (det.pos && det.target) {
    row.verdict = 'new_target';
    row.reason = `${det.pos}: ${det.evidenceWhere}${conflict}`;
  } else if (det.pos) {
    row.verdict = 'excluded_pos';
    row.reason = `runs ${det.pos}: ${det.evidenceWhere}${conflict}`;
  } else {
    row.verdict = 'unknown_pos';
    row.reason = !row.website && !det.pagesChecked ? 'no website'
      : det.orderingProvider ? `orders via ${det.orderingProvider}; POS not visible`
      : det.error ? `website fetch failed: ${det.error}`
      : det.signals.length ? 'weak signals only'
      : 'no POS evidence found';
  }
}

const num = v => (v === '' || v == null ? null : Number(v));
const text = v => (v === '' || v == null ? null : v);

// A lead's notes start with how sure we are of its POS and where that came from.
// A reviewed CSV can carry its own `notes` column instead.
function posNote(row) {
  const pos = text(row.pos);
  if (!pos || pos === 'Unknown') {
    const via = text(row.ordering_provider);
    return `POS unknown — ask on the call.${via ? ` Orders online via ${via}${text(row.ordering_url) ? ` (${row.ordering_url})` : ''}.` : ''}`;
  }
  return `POS: ${pos} (${text(row.pos_confidence) || 'unrated'} confidence). Evidence: ${text(row.pos_evidence) || 'none recorded'}`;
}

const toLocation = row => ({
  place_id: row.place_id, address: text(row.address), city: text(row.city), phone: text(row.phone),
  lat: num(row.lat), lng: num(row.lng),
});

function buildLead(row, locationRows, today, uid) {
  return {
    id: uid(),
    name: row.name,
    phone: text(row.phone),
    address: text(row.address),
    city: text(row.city) || '',
    county: text(row.county),
    area: text(row.area),
    website: text(row.website),
    pos: text(row.pos),
    pos_confidence: text(row.pos_confidence),
    pos_evidence: text(row.pos_evidence),
    ordering_url: text(row.ordering_url),
    pos_checked: today,
    stage: 'prospect',
    owner: '',
    notes: text(row.notes) || posNote(row),
    place_id: row.place_id,
    lat: num(row.lat),
    lng: num(row.lng),
    google_maps_url: text(row.google_maps_url),
    ...(locationRows.length ? { multi_location: true, locations: locationRows.map(toLocation) } : {}),
    added: today,
  };
}

// Work out the database writes a set of rows implies. Rows can come straight from a
// scrape or from a reviewed CSV, so everything is re-checked against the current CRM.
// Returns { inserts: [lead], locationAdds: [{ lead, locations }], backfills: [{ lead, place_id }], skipped: [row] }
export function planWrites(rows, leads, index, today, uid) {
  const leadsById = new Map(leads.map(l => [l.id, l]));
  const plan = { inserts: [], locationAdds: [], backfills: [], skipped: [] };

  const membersOf = new Map();
  for (const row of rows) {
    if (row.verdict !== 'extra_location' || !row.primary_place_id) continue;
    if (!membersOf.has(row.primary_place_id)) membersOf.set(row.primary_place_id, []);
    membersOf.get(row.primary_place_id).push(row);
  }

  const addsByLead = new Map();
  const backfilled = new Set();

  for (const row of rows) {
    if (row.verdict === 'new_target') {
      if (findMatch(index, row)) { plan.skipped.push(row); continue; }
      plan.inserts.push(buildLead(row, membersOf.get(row.place_id) || [], today, uid));
      continue;
    }

    const lead = row.matched_type === 'lead' ? leadsById.get(row.matched_lead_id) : null;
    if (!lead) continue;

    if (row.verdict === 'extra_location') {
      const known = lead.place_id === row.place_id || (lead.locations || []).some(l => l.place_id === row.place_id);
      if (known) continue;
      if (!addsByLead.has(lead.id)) addsByLead.set(lead.id, { lead, locations: [...(lead.locations || [])] });
      addsByLead.get(lead.id).locations.push(toLocation(row));
    } else if (row.verdict === 'duplicate' && row.match_rule !== 'place_id' && !lead.place_id && !backfilled.has(lead.id)) {
      // A manually entered lead we now know the Google place for
      backfilled.add(lead.id);
      plan.backfills.push({ lead, place_id: row.place_id });
    }
  }

  plan.locationAdds = [...addsByLead.values()];
  return plan;
}
