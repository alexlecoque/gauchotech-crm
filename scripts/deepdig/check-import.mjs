// Read-only post-import check: total leads, leads added per area today, and that every lead added today
// has a phone number and POS evidence in its notes. Usage: node check-import.mjs <backup.json> <plan.csv ...>
process.env.CRM_DB_READONLY = '1';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const PROJECT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const db = await import(PROJECT + '/db.js');
const { parseCsv } = await import(PROJECT + '/csv.js');
const [backup, ...plans] = process.argv.slice(2);
const before = JSON.parse(readFileSync(backup, 'utf8'));
const beforeIds = new Set(before.map(l => l.id));
const leads = await db.getAll('leads');
const added = leads.filter(l => !beforeIds.has(l.id));
console.log(`leads before: ${before.length}  after: ${leads.length}  added: ${added.length}`);
const byArea = {};
for (const l of added) byArea[l.area] = (byArea[l.area] || 0) + 1;
console.log('added per area:', JSON.stringify(byArea));
const planned = new Map();
for (const f of plans) for (const r of parseCsv(readFileSync(f, 'utf8'))) if (r.verdict === 'new_target') planned.set(r.place_id, r);
let bad = 0;
for (const l of added) {
  const problems = [];
  if (!l.phone) problems.push('no phone');
  if (!/Evidence: https?:\/\//.test(l.notes || '')) problems.push('no POS evidence in notes');
  if (!['Square', 'Clover'].includes(l.pos)) problems.push(`pos=${l.pos}`);
  if (!planned.has(l.place_id)) problems.push('not in any plan');
  if (problems.length) { bad++; console.log(`  ! ${l.name} [${l.city}]: ${problems.join('; ')}`); }
}
const missing = [...planned.values()].filter(r => !leads.some(l => l.place_id === r.place_id));
for (const r of missing) console.log(`  ! planned but not in CRM: ${r.name} [${r.city}]`);
const locs = added.filter(l => l.locations?.length).map(l => `${l.name} (+${l.locations.length})`);
if (locs.length) console.log('leads with extra locations:', locs.join(', '));
console.log(bad || missing.length ? `PROBLEMS: ${bad} bad lead(s), ${missing.length} missing` : 'all added leads have a phone, Square/Clover POS and an evidence URL in notes');
process.exit(0);
