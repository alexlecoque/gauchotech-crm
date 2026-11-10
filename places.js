// Google Places Text Search (New) with a request budget and a local response cache.
import fetch from 'node-fetch';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const PAGE_DELAY_MS = 2000;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const MAX_RESULTS_PER_QUERY = 60;   // Text Search stops at 3 pages of 20
// Phone and website put each request in the Text Search Enterprise tier
export const LIST_PRICE_PER_1000 = 35;

// nextPageToken has to be requested in the mask, otherwise pagination stops after page 1
const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents',
  'places.nationalPhoneNumber', 'places.websiteUri', 'places.location', 'places.types',
  'places.primaryType', 'places.businessStatus', 'places.googleMapsUri', 'places.userRatingCount', 'places.rating',
  'nextPageToken',
].join(',');

const delay = ms => new Promise(r => setTimeout(r, ms));

export function createPlacesClient({ apiKey, maxRequests, cacheDir, useCache = true, fetchImpl = fetch, pageDelayMs = PAGE_DELAY_MS }) {
  const stats = { requests: 0, cacheHits: 0, budgetHit: false };

  const cachePath = key => path.join(cacheDir, key + '.json');
  const cacheRead = key => {
    if (!useCache || !cacheDir) return null;
    try {
      const entry = JSON.parse(readFileSync(cachePath(key), 'utf8'));
      return Date.now() - entry.fetchedAt < CACHE_TTL_MS ? entry.places : null;
    } catch { return null; }
  };
  const cacheWrite = (key, textQuery, places) => {
    if (!cacheDir) return;
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath(key), JSON.stringify({ textQuery, fetchedAt: Date.now(), places }));
  };

  // Returns { places, complete, fromCache }. complete is false when the request budget cut the query short.
  async function searchText(textQuery, bounds) {
    const key = createHash('sha1').update(JSON.stringify({ textQuery, bounds: bounds || null, FIELD_MASK })).digest('hex');
    const cached = cacheRead(key);
    if (cached) { stats.cacheHits++; return { places: cached, complete: true, fromCache: true }; }

    const places = [];
    let pageToken = null;

    do {
      if (stats.requests >= maxRequests) { stats.budgetHit = true; return { places, complete: false }; }

      const body = { textQuery, pageSize: 20 };
      if (bounds) body.locationRestriction = { rectangle: bounds };
      if (pageToken) body.pageToken = pageToken;

      stats.requests++;
      const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      // Abort the run: a bad key or disabled API would fail every remaining query the same way
      if (data.error) throw new Error(`Places API error on "${textQuery}": ${data.error.message}`);
      if (data.places) places.push(...data.places);
      pageToken = data.nextPageToken || null;
      if (pageToken) await delay(pageDelayMs);
    } while (pageToken);

    cacheWrite(key, textQuery, places);
    return { places, complete: true };
  }

  return { searchText, stats };
}
