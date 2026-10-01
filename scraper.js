import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AREAS } from './areas.js';
import { createPlacesClient, MAX_RESULTS_PER_QUERY, LIST_PRICE_PER_1000 } from './places.js';
import { detectPOS } from './pos.js';
import { buildIndex } from './match.js';
import { screenPlaces, applyDetection, planWrites, CSV_COLUMNS } from './pipeline.js';
import { toCsv, parseCsv } from './csv.js';

// Usage:
//   node scraper.js --area sfv                 dry run: search, check POS, write a CSV to out/
//   node scraper.js --area sfv --commit        same, and write new leads to the database
//   node scraper.js --import out/file.csv      show what a reviewed CSV would write (no Google calls)
//   node scraper.js --import out/file.csv --commit
// Options: --max-requests N (default 250)   --no-cache (ignore saved search results)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const QUERY_DELAY_MS = 500;
const POS_CONCURRENCY = 4;
const DEFAULT_MAX_REQUESTS = 250;
// First phrasing always runs; the second only when the first hits the 60-result cap
const QUERY_PHRASES = ['pizza restaurant', 'pizzeria'];

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const COMMIT = flag('--commit');
const AREA_KEY = option('--area');
const IMPORT_FILE = option('--import');
const MAX_REQUESTS = Number(option('--max-requests')) || DEFAULT_MAX_REQUESTS;

const delay = ms => new Promise(r => setTimeout(r, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => new Date().toISOString().slice(0, 10);

function usage(message) {
  if (message) console.error(message + '\n');
  console.error('Usage: node scraper.js --area <key> [--commit] [--max-requests N] [--no-cache]');
  console.error('       node scraper.js --import <file.csv> [--commit]');
  console.error('\nAreas: ' + Object.entries(AREAS).map(([k, a]) => `${k} (${a.label})`).join(', '));
  console.error('Dry run is the default: results go to a CSV in out/ and nothing is written to the database.');
  process.exit(1);
}

if (!IMPORT_FILE && !AREA_KEY) usage();
if (AREA_KEY && !AREAS[AREA_KEY]) usage(`Unknown area "${AREA_KEY}".`);
if (!IMPORT_FILE && !API_KEY) usage('GOOGLE_PLACES_API_KEY is not set.');

// Dry run loads the database module read-only, so no code path here can write
if (!COMMIT) process.env.CRM_DB_READONLY = '1';
const db = await import('./db.js');

async function mapLimit(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

async function loadExisting() {
  const leads = await db.getAll('leads');
  const customers = await db.getAll('customers');
  console.log(`Mode: ${COMMIT ? 'COMMIT — new leads will be written to the database' : 'dry run — nothing is written to the database'}`);
  console.log(`Existing CRM: ${leads.length} leads, ${customers.length} customers`);
  if (!process.env.DATABASE_URL) {
    console.log('  ! DATABASE_URL is not set — comparing against local data/ files, not the live CRM');
  }
  return { leads, index: buildIndex(leads, customers) };
}

async function searchArea(area, client) {
  const found = new Map();   // place id → { place, query, locality }

  search:
  for (const locality of area.localities) {
    for (const phrase of QUERY_PHRASES) {
      const query = `${phrase} in ${locality} ${area.state}`;
      const { places, complete, fromCache } = await client.searchText(query, area.bounds);
      let fresh = 0;
      for (const place of places) {
        if (found.has(place.id)) continue;
        found.set(place.id, { place, query, locality });
        fresh++;
      }
      console.log(`  ${query}: ${places.length} result(s), ${fresh} new${fromCache ? ' (cached)' : ''}`);

      if (client.stats.budgetHit) {
        console.log(`\n  ! Request budget of ${MAX_REQUESTS} reached — stopping the search early. Results below are partial.`);
        break search;
      }
      if (!complete || places.length < MAX_RESULTS_PER_QUERY) break;
      if (!fromCache) await delay(QUERY_DELAY_MS);
    }
  }

  return [...found.values()];
}

function printPlan(plan) {
  const verb = COMMIT ? 'Writing' : 'Would write';
  console.log(`\n${verb}: ${plan.inserts.length} new lead(s), ${plan.locationAdds.length} existing lead(s) gaining locations, ${plan.backfills.length} place_id backfill(s)`);
  if (plan.skipped.length) console.log(`  ${plan.skipped.length} target(s) skipped — already in the CRM`);
  for (const lead of plan.inserts) {
    const extra = lead.locations ? ` (+${lead.locations.length} location(s))` : '';
    console.log(`  + ${lead.name} [${lead.pos}]${extra} — ${lead.city}`);
  }
}

async function applyPlan(plan) {
  let added = 0;
  for (const lead of plan.inserts) {
    if (await db.insertUnique('leads', 'place_id', lead)) added++;
  }
  for (const { lead, locations } of plan.locationAdds) {
    await db.update('leads', lead.id, { multi_location: true, locations });
  }
  for (const { lead, place_id } of plan.backfills) {
    await db.update('leads', lead.id, { place_id });
  }
  console.log(`\nDatabase updated: ${added} lead(s) added, ${plan.locationAdds.length} lead(s) updated with locations, ${plan.backfills.length} place_id(s) backfilled.`);
}

async function scrape() {
  const area = AREAS[AREA_KEY];
  const { leads, index } = await loadExisting();

  const client = createPlacesClient({
    apiKey: API_KEY,
    maxRequests: MAX_REQUESTS,
    cacheDir: path.join(__dirname, 'data', 'places-cache'),
    useCache: !flag('--no-cache'),
  });

  console.log(`\nSearching ${area.label} (${area.localities.length} localities, budget ${MAX_REQUESTS} requests)`);
  const found = await searchArea(area, client);

  const { rows, groups } = screenPlaces(found, area, index);
  console.log(`\n${found.length} unique place(s) found. Checking POS for ${groups.length} new shop(s)...`);

  await mapLimit(groups, POS_CONCURRENCY, async group => {
    const website = group.primary.website || group.members.find(m => m.website)?.website || null;
    applyDetection(group, await detectPOS(website));
    const { name, verdict, pos, ordering_provider } = group.primary;
    console.log(`  ${verdict.padEnd(15)} ${name}${pos ? ` [${pos}]` : ordering_provider ? ` [via ${ordering_provider}]` : ''}`);
  });

  const outDir = path.join(__dirname, 'out');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const csvPath = path.join(outDir, `scrape-${AREA_KEY}-${stamp}.csv`);
  writeFileSync(csvPath, toCsv(CSV_COLUMNS, rows));

  const counts = {};
  for (const row of rows) counts[row.verdict] = (counts[row.verdict] || 0) + 1;
  console.log(`\n─────────────────────────────────`);
  for (const [verdict, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${verdict}`);
  }
  const { requests, cacheHits } = client.stats;
  console.log(`\nPlaces API requests: ${requests} (${cacheHits} quer${cacheHits === 1 ? 'y' : 'ies'} served from cache) — about $${(requests * LIST_PRICE_PER_1000 / 1000).toFixed(2)} at list price`);
  console.log(`CSV: ${csvPath}`);

  const plan = planWrites(rows, leads, index, today(), uid);
  printPlan(plan);
  if (COMMIT) await applyPlan(plan);
  else console.log('\nDry run — review the CSV, then re-run with --commit or use --import <csv> --commit.');
}

async function importCsv() {
  const rows = parseCsv(readFileSync(IMPORT_FILE, 'utf8'));
  if (!rows.length || !('verdict' in rows[0]) || !('place_id' in rows[0])) {
    usage(`${IMPORT_FILE} does not look like a scraper CSV (needs verdict and place_id columns).`);
  }
  const { leads, index } = await loadExisting();
  console.log(`\nImporting ${IMPORT_FILE}: ${rows.length} row(s), ${rows.filter(r => r.verdict === 'new_target').length} marked new_target`);

  const plan = planWrites(rows, leads, index, today(), uid);
  printPlan(plan);
  if (COMMIT) await applyPlan(plan);
  else console.log('\nDry run — add --commit to write these to the database.');
}

(IMPORT_FILE ? importCsv() : scrape())
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
