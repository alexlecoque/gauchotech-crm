# Deep-dig toolkit

Second pass over a scraper dry run: finds the POS of the `unknown_pos` shops, verifies every Square/Clover target
live, researches owners, estimates volume and writes the import plan. Everything is resumable (state JSON under
`out/logs/`) and runs from the repo root.

```
npm run scrape -- --area <key> --max-requests 300 --no-cache        # 1. dry run → out/scrape-<key>-<stamp>.csv
scripts/deepdig/area2.sh <key> out/scrape-<key>-<stamp>.csv          # 2. dig unknowns, re-dig targets, verify live, research owners
python3 scripts/deepdig/review.py <key> out/<...>-verified.csv       # 3. print the review table, write out/logs/overrides-<key>.json
node scripts/deepdig/plan.mjs out/<...>-verified.csv <key> out/logs/overrides-<key>.json [earlier plans…]   # 4. import plan + side CSVs
node scripts/deepdig/reverify.mjs 10 out/import-plan-*.csv           # 5. re-verify N random targets from scratch (REVERIFY_SEED=n for another sample)
node scripts/deepdig/backup.mjs <tag>                                # 6. read-only JSON dump of every lead (before any --commit)
npm run scrape -- --import out/import-plan-<key>-<stamp>.csv --commit
node scripts/deepdig/check-import.mjs out/crm-leads-backup-before-<tag>-<stamp>.json out/import-plan-*.csv
node scripts/deepdig/count.mjs                                       # read-only lead count per area
node scripts/deepdig/owners.mjs --crm <lead-id,…> --tag backfill     # owner dig for existing leads (read-only CRM)
node scripts/deepdig/fill-owners.mjs out/logs/owners-backfill.json [--commit]   # fill ONLY blank owner/role fields
```

Files:
- `lib.mjs` — polite fetch, web search (DuckDuckGo rendered in headless Chrome first, Yahoo as fallback; the DDG
  html/lite endpoints block this IP and Bing ignores all but the first word of a quoted query), site crawl with link
  hubs and order links, Toast slug probe, ABC license lookup with officer/member parsing, Place Details, Places request
  counter (`out/logs/places-requests.json`).
- `dig.mjs` — per unknown shop: crawl → 3 searches (name + city + square / clover / toasttab) → candidate POS pages
  verified through `detectPOS(url, { shop })` (address/phone/name+city must match; collapsed-dash Clover slugs tried)
  → Toast slug probe. Writes `<csv>-deepdig.csv`, state `out/logs/dig-<key>.json`.
- `verify.mjs` — per Square/Clover target: Place Details today, POS page live, closed/for-sale/franchise flags, ABC +
  site + search owner hints, volume from review count/recency. Writes `<csv>-verified.csv`, state `out/logs/verify-<key>.json`.
- `plan.mjs` — applies `out/logs/overrides-<key>.json` (per place_id: icp_fit, owner_name/role/confidence/source_url,
  volume_*, extra_note, drop_reason, force_weak, merge_into, keep…), drops foreign-city rows, dedupes against earlier
  plans, writes `out/import-plan-<key>-<stamp>.csv` plus `<key>-weak-hints-`, `<key>-unknown-icp-fit-`, `<key>-other-shops-`.
- `owners.mjs` — owner research per Square/Clover target: ABC licence members, CA SOS entity (bizfile API called from
  inside the page in headless Chrome) with officers from bizprofile.net, LA County health-permit holder + FBN
  registrants (public ArcGIS feature services), San Diego County FBN portal, the shop's own site, five web searches
  (owner / news / LinkedIn / social / Yelp snippets), the promising pages themselves, BBB. `decide()` grades each
  person strong (official filing with an owner-type role, or 2+ independent sources), medium (one good source) or
  weak (never imported); registered agents, directory sites and filings that are not at the shop's address or named
  after it stay weak. State `out/logs/owners-<key>.json`; `plan.mjs` fills the owner columns from it. `--fresh`
  recomputes decisions from the cached evidence.
- `fill-owners.mjs` — writes strong/medium results into existing leads' blank `owner` / `role` fields only (never
  overwrites), appends a dated research note, dry run unless `--commit`.
- `reverify.mjs`, `backup.mjs`, `count.mjs`, `check-import.mjs`, `review.py` — see the commands above.
- `browser2.js` / `browser3.js` — copies of `browser.js` on their own debugging ports (`DIG_PORT`, default 9411; Toast
  renders use `DIG_PORT + 50`) so the dig can run beside a scraper run; the render loop waits until the page text
  stops growing (Toast shows its cookie banner before the menu).
