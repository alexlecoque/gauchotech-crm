// Matching scraped places against what is already in the CRM.
// Order: place_id → phone → name + address → same business (name + website).

const NAME_STOPWORDS = new Set(['the', 'and', 'pizza', 'pizzas', 'pizzeria', 'restaurant', 'ristorante', 'inc', 'llc', 'co']);
const DIRECTIONALS = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'north', 'south', 'east', 'west']);

// Hosts where the path, not the hostname, identifies the shop — useless as a business fingerprint
const SHARED_HOSTS = [
  'facebook.com', 'instagram.com', 'yelp.com', 'google.com', 'linktr.ee', 'doordash.com', 'ubereats.com',
  'grubhub.com', 'postmates.com', 'order.online', 'toasttab.com', 'slicelife.com', 'chownow.com',
  'clover.com', 'squareup.com', 'spoton.com', 'olo.com',
];

export const hostMatches = (host, suffix) => host === suffix || host.endsWith('.' + suffix);

export function normPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function normName(name) {
  return String(name || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Name with filler words removed, so "Tony's Pizza" and "Tonys Pizzeria" compare equal
export function nameKey(name) {
  const norm = normName(name);
  const core = norm.split(' ').filter(w => !NAME_STOPWORDS.has(w)).join(' ');
  return core || norm;
}

// Street number + first real street word, e.g. "414 N Milpas St, …" → "414|milpas"
function streetKey(address) {
  const first = normName(String(address || '').split(',')[0]);
  const m = first.match(/^(\d+)\s+(.*)$/);
  if (!m) return null;
  const street = m[2].split(' ').find(w => !DIRECTIONALS.has(w));
  return street ? `${m[1]}|${street}` : null;
}

function zipOf(address) {
  // Drop the street number first, so a 5-digit street number is not mistaken for the ZIP
  const zips = String(address || '').replace(/^\s*\d+/, '').match(/\b\d{5}\b/g);
  return zips ? zips[zips.length - 1] : null;
}

// Keys a shop's location can be matched on. ZIP is preferred; city is the fallback
// for manually entered leads that have no ZIP in the address.
export function addressKeys(address, city) {
  const street = streetKey(address);
  if (!street) return [];
  const keys = [];
  const zip = zipOf(address);
  if (zip) keys.push(`${street}|${zip}`);
  if (city) keys.push(`${street}|${normName(city)}`);
  return keys;
}

export function siteDomain(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return SHARED_HOSTS.some(h => hostMatches(host, h)) ? null : host;
  } catch { return null; }
}

export function brandKey(name, website) {
  const domain = siteDomain(website);
  const key = nameKey(name);
  return domain && key ? `${key}|${domain}` : null;
}

const setOnce = (map, key, value) => { if (key && !map.has(key)) map.set(key, value); };

export function buildIndex(leads, customers = []) {
  const index = {
    byPlaceId: new Map(), byPhone: new Map(), byNameAddr: new Map(), byBrand: new Map(), byNameCity: new Map(),
    counts: { leads: leads.length, customers: customers.length },
  };

  for (const lead of leads) {
    const ref = { type: 'lead', record: lead };
    setOnce(index.byPlaceId, lead.place_id, ref);
    setOnce(index.byPhone, normPhone(lead.phone), ref);
    setOnce(index.byBrand, brandKey(lead.name, lead.website), ref);
    for (const k of addressKeys(lead.address, lead.city)) setOnce(index.byNameAddr, `${nameKey(lead.name)}|${k}`, ref);

    // Extra locations already folded into this lead
    for (const loc of lead.locations || []) {
      setOnce(index.byPlaceId, loc.place_id, ref);
      setOnce(index.byPhone, normPhone(loc.phone), ref);
      for (const k of addressKeys(loc.address, loc.city)) setOnce(index.byNameAddr, `${nameKey(lead.name)}|${k}`, ref);
    }
  }

  // Customers have no address or place_id — match on phone, or name within the same city
  for (const customer of customers) {
    const ref = { type: 'customer', record: customer };
    setOnce(index.byPhone, normPhone(customer.phone), ref);
    if (customer.city) setOnce(index.byNameCity, `${nameKey(customer.name)}|${normName(customer.city)}`, ref);
  }

  return index;
}

function knownAddressKeys(record) {
  const keys = new Set(addressKeys(record.address, record.city));
  for (const loc of record.locations || []) for (const k of addressKeys(loc.address, loc.city)) keys.add(k);
  return keys;
}

// candidate: { place_id, name, phone, address, city, website }
// Returns null, or { kind: 'duplicate' | 'extra_location', rule, type, record }
//   duplicate      — this exact shop is already in the CRM
//   extra_location — another location of a business that is already in the CRM
export function findMatch(index, candidate) {
  const hit = (kind, rule, ref) => ({ kind, rule, type: ref.type, record: ref.record });

  let ref = index.byPlaceId.get(candidate.place_id);
  if (ref) return hit('duplicate', 'place_id', ref);

  const candKeys = addressKeys(candidate.address, candidate.city);

  ref = index.byPhone.get(normPhone(candidate.phone));
  if (ref) {
    if (ref.type === 'customer') return hit('duplicate', 'phone', ref);
    const known = knownAddressKeys(ref.record);
    // Same phone at a different address = a shared order line (multi-location business)
    const sameSpot = known.size === 0 || candKeys.length === 0 || candKeys.some(k => known.has(k));
    return hit(sameSpot ? 'duplicate' : 'extra_location', 'phone', ref);
  }

  const key = nameKey(candidate.name);
  for (const k of candKeys) {
    ref = index.byNameAddr.get(`${key}|${k}`);
    if (ref) return hit('duplicate', 'name+address', ref);
  }

  if (candidate.city) {
    ref = index.byNameCity.get(`${key}|${normName(candidate.city)}`);
    if (ref) return hit('duplicate', 'name+city', ref);
  }

  ref = index.byBrand.get(brandKey(candidate.name, candidate.website));
  if (ref) return hit('extra_location', 'name+website', ref);

  return null;
}
