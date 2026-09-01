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

Pulls pizza restaurants from Google Places API (New), detects POS system from website, writes directly to Railway Postgres.

```bash
npm run scrape
```

**Coverage so far:**
- [x] Santa Barbara County — ~102 leads (2026-05-04)
- [ ] Ventura County — uncomment queries in `scraper.js`
- [ ] San Luis Obispo County — uncomment queries in `scraper.js`

**To expand to new counties:** open `scraper.js` and uncomment the relevant city queries. Re-running is safe — duplicates are skipped by `place_id`.

**POS systems detected:** Square, Toast, Clover, Slice, Lightspeed, TouchBistro, Revel, Chownow, Olo

**Chains filtered out automatically:** Domino's, Pizza Hut, Papa John's, Little Caesars, Papa Murphy's, Round Table, Sbarro, CiCi's

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
| `county` | Santa Barbara / Ventura / San Luis Obispo |
| `website` | Website URL |
| `pos` | Detected POS system |
| `stage` | prospect / contacted / demo / closed |
| `place_id` | Google Places ID (unique — prevents duplicates) |

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
