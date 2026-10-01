# Neo O1 CRM

Sales CRM for prospecting independent pizza restaurants as Neo O1 customers.

## Stack

- **Frontend**: Single-file HTML/JS (`index.html`) served by Express
- **Backend**: Node.js/Express (`server.js`)
- **Database**: Railway Postgres (JSONB storage via `pg`)
- **Scraper**: Google Places API (New) + website POS detection (`scraper.js`)

## URLs

- **Live (shared)**: `https://gauchotech-crm-production.up.railway.app`
- **Local (Mac only)**: `http://localhost:3001` — runs as a macOS Launch Agent, auto-starts on login
- **Railway project**: `reasonable-wholeness`

## Local Setup

The CRM runs as a background service via launchd:
```
/Users/alexlecoque/Library/LaunchAgents/com.neo01.crm.plist
```
Restart it: `launchctl kickstart -k gui/$(id -u)/com.neo01.crm`

Local dev uses JSON files in `data/` (no Postgres needed). Railway deployment uses Postgres automatically when `DATABASE_URL` is set.

## Deployment

```bash
cd /Users/alexlecoque/Applications/neo01-crm
railway up --service gauchotech-crm
```

Railway project: `reasonable-wholeness` (separate from the GauchoTech Vapi server — do not touch `beneficial-compassion`).

## Scraper

Finds independent pizza shops that run Square or Clover. Searches Google Places API (New) by area, skips anything already in the CRM, follows each shop's "order online" link to detect the POS, and records the evidence URL.

**Dry run is the default** — results go to a CSV in `out/` and nothing is written to the database.

```bash
npm run scrape -- --area sfv                    # dry run → out/scrape-sfv-<timestamp>.csv
npm run scrape -- --area sfv --commit           # also write new Square/Clover leads to the database
npm run scrape -- --import out/<file>.csv       # show what a reviewed CSV would write (no Google calls)
npm run scrape -- --import out/<file>.csv --commit
```

Options: `--max-requests N` (Places request budget, default 250), `--no-cache` (search results are cached in `data/places-cache/` for 30 days, so re-runs cost no Places calls).

**Files:** `areas.js` (search areas), `places.js` (Google search, budget, cache), `filters.js` (chains, non-pizza), `match.js` (dedupe), `pos.js` (POS detection), `pipeline.js` (verdicts, planned writes), `csv.js`, `scraper.js` (CLI).

**Areas** (`areas.js`): `sfv`, `santa-barbara`, `ventura`, `san-luis-obispo`, `contra-costa`. To add one, add an entry with a label, county, locality list and optional bounding box — no code changes.

**Coverage so far:**
- [x] Santa Barbara County — ~102 leads (2026-05-04)
- [ ] San Fernando Valley
- [ ] Ventura County
- [ ] San Luis Obispo County
- [ ] Contra Costa County — was enabled in the old scraper; not recorded here whether it was run

**Dedupe:** matched against existing leads and customers by `place_id`, then phone, then name + address. Another location of a business already in the CRM (shared phone, or same name + website) is added to that lead's `locations` instead of becoming a new lead.

**CSV verdicts:** `new_target` (Square/Clover — the only rows written on `--commit`), `unknown_pos`, `excluded_pos`, `suspected_chain`, `extra_location`, `duplicate`, `excluded_chain`, `not_pizza`, `closed`. To promote a row by hand, change its verdict to `new_target` in the CSV and `--import` it.

**POS systems detected:** Square, Clover (targets); Toast, SpotOn, Adora, Lightspeed, TouchBistro, Revel (excluded). Slice, ChowNow, Olo and DoorDash Storefront are ordering layers, not POS — those shops are reported as `unknown_pos`.

**Chains filtered out automatically:** see `CHAINS` in `filters.js`. A name that appears 4+ times in one run is flagged `suspected_chain`.

## Environment Variables

| Var | Description |
|---|---|
| `GOOGLE_PLACES_API_KEY` | Google Cloud — Places API (New) must be enabled |
| `DATABASE_URL` | Railway Postgres connection string (set in `.env` for local scraper runs, auto-injected on Railway) |
| `PORT` | Defaults to 3001 locally |

**Note:** Google Places API (New) must be enabled at console.cloud.google.com for the scraper to work. Project ID: `930456486842`.

## Data Model

Leads stored as JSONB in `crm_leads` table. Key fields:

| Field | Description |
|---|---|
| `name` | Restaurant name |
| `phone` | Phone number |
| `address` | Full address |
| `city` | City |
| `county` | Santa Barbara / Ventura / San Luis Obispo / Los Angeles / Contra Costa |
| `area` | Scraper area label, e.g. San Fernando Valley |
| `website` | Website URL |
| `pos` | Detected POS system |
| `pos_evidence` | URL that identified the POS (also `pos_confidence`, `ordering_url`, `pos_checked`) |
| `stage` | prospect / contacted / demo / closed |
| `place_id` | Google Places ID (unique — prevents duplicates) |
| `locations` | Extra locations of the same business (`multi_location: true`) |

## CRM Features

- **Browse tab** — leads organized by County → City, expandable tree, stage filter
- **Pipeline tab** — Kanban board (Prospect → Contacted → Demo Scheduled → Closed / Won)
- **Customers tab** — active/pilot customers with detail view and call history
- **Call log tab** — outbound/inbound/missed call tracking

## Making UI Changes

`index.html` is plain readable HTML/CSS/JS — not minified or compiled. To change:
- **Colors/theme**: edit CSS variables at the top of `<style>`
- **Pipeline stages**: edit `STAGES` and `STAGE_LABELS` in `<script>`
- **Add a new field**: add the input to the modal HTML, read it in the save function, add it to the API POST body in `server.js`
- **Add a new tab**: add a `<button class="tab">` and a `<div class="section" id="sec-X">`, add a render function, update `showTab()`

After any change: `railway up --service gauchotech-crm` to deploy.
