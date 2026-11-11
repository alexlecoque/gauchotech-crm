// Fill ONLY blank owner / role fields of existing leads from an owner-dig state file (strong or medium results).
// Never overwrites a non-empty value. Dry run by default; --commit writes. Usage: node fill-owners.mjs <owners-state.json> [--commit]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const PROJECT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const COMMIT = process.argv.includes('--commit');
if (!COMMIT) process.env.CRM_DB_READONLY = '1';
const db = await import(PROJECT + '/db.js');
const state = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const leads = await db.getAll('leads');
let changed = 0, skipped = 0;
for (const [id, s] of Object.entries(state)) {
  const lead = leads.find(l => l.id === id);
  const best = s.decision?.best;
  if (!lead) { console.log(`  ? ${id}: lead not found`); continue; }
  if (!best || !['strong', 'medium'].includes(best.confidence)) { console.log(`  - ${lead.name} [${lead.city}]: no strong/medium owner (${(s.decision?.all || []).slice(0, 2).map(a => `${a.name}/${a.confidence}`).join(', ') || 'no names'})`); skipped++; continue; }
  const changes = {};
  if (!lead.owner) changes.owner = best.name;
  if (!lead.role) changes.role = best.role;
  if (!Object.keys(changes).length) { console.log(`  = ${lead.name}: owner already set (${lead.owner}), left untouched`); skipped++; continue; }
  const stampNote = `Owner research ${new Date().toISOString().slice(0, 10)}: ${best.name} — ${best.role} (${best.confidence}, ${best.sources.join('+')}${best.urls[0] ? `; ${best.urls[0]}` : ''}).`;
  if (lead.notes && !lead.notes.includes(stampNote)) changes.notes = `${lead.notes} ${stampNote}`;
  console.log(`  ${COMMIT ? '✓' : '→'} ${lead.name} [${lead.city}]: ${JSON.stringify({ owner: changes.owner, role: changes.role })} (${best.confidence}, ${best.sources.join('+')})`);
  if (COMMIT) await db.update('leads', id, changes);
  changed++;
}
console.log(`${COMMIT ? 'updated' : 'would update'} ${changed} lead(s), ${skipped} left as is`);
process.exit(0);
