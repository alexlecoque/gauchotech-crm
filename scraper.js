import 'dotenv/config';
import fetch from 'node-fetch';
import https from 'node:https';
import { insertUnique } from './db.js';

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const QUERY_DELAY_MS = 500;
const PAGE_DELAY_MS = 2000;
const POS_FETCH_DELAY_MS = 200;

const SEARCH_QUERIES = [
  // Santa Barbara County
  { query: 'pizza restaurant in Santa Barbara CA',  county: 'Santa Barbara' },
  { query: 'pizza restaurant in Goleta CA',          county: 'Santa Barbara' },
  { query: 'pizza restaurant in Carpinteria CA',     county: 'Santa Barbara' },
  { query: 'pizza restaurant in Lompoc CA',          county: 'Santa Barbara' },
  { query: 'pizza restaurant in Santa Maria CA',     county: 'Santa Barbara' },
  { query: 'pizza restaurant in Solvang CA',         county: 'Santa Barbara' },
  { query: 'pizza restaurant in Buellton CA',        county: 'Santa Barbara' },
  { query: 'pizza restaurant in Orcutt CA',          county: 'Santa Barbara' },
  // Ventura County — uncomment when ready
  // { query: 'pizza restaurant in Ventura CA',        county: 'Ventura' },
  // { query: 'pizza restaurant in Oxnard CA',         county: 'Ventura' },
  // { query: 'pizza restaurant in Camarillo CA',      county: 'Ventura' },
  // { query: 'pizza restaurant in Thousand Oaks CA',  county: 'Ventura' },
  // { query: 'pizza restaurant in Simi Valley CA',    county: 'Ventura' },
  // { query: 'pizza restaurant in Moorpark CA',       county: 'Ventura' },
  // { query: 'pizza restaurant in Fillmore CA',       county: 'Ventura' },
  // { query: 'pizza restaurant in Ojai CA',           county: 'Ventura' },
  // { query: 'pizza restaurant in Port Hueneme CA',   county: 'Ventura' },
  // { query: 'pizza restaurant in Westlake Village CA', county: 'Ventura' },
  // San Luis Obispo County — uncomment when ready
  // { query: 'pizza restaurant in San Luis Obispo CA', county: 'San Luis Obispo' },
  // { query: 'pizza restaurant in Paso Robles CA',    county: 'San Luis Obispo' },
  // { query: 'pizza restaurant in Atascadero CA',     county: 'San Luis Obispo' },
  // { query: 'pizza restaurant in Arroyo Grande CA',  county: 'San Luis Obispo' },
  // { query: 'pizza restaurant in Grover Beach CA',   county: 'San Luis Obispo' },
  // { query: 'pizza restaurant in Pismo Beach CA',    county: 'San Luis Obispo' },
  // { query: 'pizza restaurant in Morro Bay CA',      county: 'San Luis Obispo' },
  // { query: 'pizza restaurant in Templeton CA',      county: 'San Luis Obispo' },
  // { query: 'pizza restaurant in Nipomo CA',         county: 'San Luis Obispo' },
  // Contra Costa County
  { query: 'pizza restaurant in Concord CA',         county: 'Contra Costa' },
  { query: 'pizza restaurant in Antioch CA',         county: 'Contra Costa' },
  { query: 'pizza restaurant in Richmond CA',        county: 'Contra Costa' },
  { query: 'pizza restaurant in San Ramon CA',       county: 'Contra Costa' },
  { query: 'pizza restaurant in Walnut Creek CA',    county: 'Contra Costa' },
  { query: 'pizza restaurant in Pittsburg CA',       county: 'Contra Costa' },
  { query: 'pizza restaurant in Brentwood CA',       county: 'Contra Costa' },
  { query: 'pizza restaurant in Danville CA',        county: 'Contra Costa' },
  { query: 'pizza restaurant in Pleasant Hill CA',   county: 'Contra Costa' },
  { query: 'pizza restaurant in Martinez CA',        county: 'Contra Costa' },
  { query: 'pizza restaurant in Oakley CA',          county: 'Contra Costa' },
  { query: 'pizza restaurant in Hercules CA',        county: 'Contra Costa' },
  { query: 'pizza restaurant in El Cerrito CA',      county: 'Contra Costa' },
  { query: 'pizza restaurant in Lafayette CA',       county: 'Contra Costa' },
  { query: 'pizza restaurant in Pinole CA',          county: 'Contra Costa' },
  { query: 'pizza restaurant in Orinda CA',          county: 'Contra Costa' },
  { query: 'pizza restaurant in Clayton CA',         county: 'Contra Costa' },
  { query: 'pizza restaurant in Moraga CA',          county: 'Contra Costa' },
];

// Skip major chains — Neo O1 targets independents
const CHAINS = ['domino', 'pizza hut', 'papa john', 'little caesar', 'papa murphy', 'round table', 'sbarro', "cici's"];

const POS_PATTERNS = [
  { name: 'Square',      patterns: ['squareup.com', 'square.site', 'squarecdn.com'] },
  { name: 'Toast',       patterns: ['toasttab.com'] },
  { name: 'Clover',      patterns: ['clover.com'] },
  { name: 'Slice',       patterns: ['slicelife.com'] },
  { name: 'Lightspeed',  patterns: ['lightspeedrestaurant.com'] },
  { name: 'TouchBistro', patterns: ['touchbistro.com'] },
  { name: 'Revel',       patterns: ['revelsystems.com'] },
  { name: 'Chownow',     patterns: ['chownow.com'] },
  { name: 'Olo',         patterns: ['olo.com'] },
];

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const delay = ms => new Promise(r => setTimeout(r, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isChain = name => CHAINS.some(c => name.toLowerCase().includes(c));

async function searchPlaces(query) {
  const places = [];
  let pageToken = null;

  do {
    const body = { textQuery: query, maxResultCount: 20 };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.location,places.types',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (data.error) { console.error(`  API error: ${data.error.message}`); break; }
    if (data.places) places.push(...data.places);
    pageToken = data.nextPageToken || null;
    if (pageToken) await delay(PAGE_DELAY_MS);
  } while (pageToken);

  return places;
}

async function detectPOS(websiteUrl) {
  if (!websiteUrl) return null;
  try {
    const res = await fetch(websiteUrl, {
      agent: (url) => url.protocol === 'https:' ? httpsAgent : undefined,
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GauchoBot/1.0)' },
    });
    const html = await res.text();
    const lower = html.toLowerCase();
    for (const { name, patterns } of POS_PATTERNS) {
      if (patterns.some(p => lower.includes(p))) return name;
    }
  } catch {}
  return null;
}

function extractCity(formattedAddress) {
  const parts = (formattedAddress || '').split(',').map(s => s.trim());
  if (parts.length >= 3) return parts[parts.length - 3];
  if (parts.length >= 2) return parts[parts.length - 2];
  return '';
}

async function run() {
  const seen = new Set();
  let added = 0, skipped = 0, chains = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const { query, county } of SEARCH_QUERIES) {
    console.log(`\nSearching: ${query}`);
    const places = await searchPlaces(query);
    console.log(`  ${places.length} result(s)`);

    for (const place of places) {
      if (seen.has(place.id)) { skipped++; continue; }
      seen.add(place.id);

      const name = place.displayName?.text || '';
      if (isChain(name)) { chains++; continue; }

      const types = place.types || [];
      const isPizza = types.includes('pizza_restaurant') || name.toLowerCase().includes('pizza');
      if (!isPizza) { skipped++; continue; }

      const website = place.websiteUri || null;
      const pos = await detectPOS(website);

      const inserted = await insertUnique('leads', 'place_id', {
        id: uid(),
        name,
        phone: place.nationalPhoneNumber || null,
        address: place.formattedAddress || null,
        city: extractCity(place.formattedAddress || ''),
        county: county || null,
        website,
        pos: pos || null,
        stage: 'prospect',
        owner: '',
        notes: '',
        place_id: place.id,
        lat: place.location?.latitude || null,
        lng: place.location?.longitude || null,
        added: today,
      });

      if (inserted) {
        added++;
        console.log(`  + ${name}${pos ? ' [' + pos + ']' : ''}`);
      } else {
        skipped++;
        console.log(`  ~ ${name} (already in DB)`);
      }

      await delay(POS_FETCH_DELAY_MS);
    }

    await delay(QUERY_DELAY_MS);
  }

  console.log(`\n─────────────────────────────────`);
  console.log(`Done. Added: ${added} | Skipped/duplicate: ${skipped} | Chains filtered: ${chains}`);
}

run().catch(console.error);
