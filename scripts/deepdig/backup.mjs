// Read-only dump of every CRM lead to out/<name>.json
process.env.CRM_DB_READONLY = '1';
import { fileURLToPath } from 'node:url';
const PROJECT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
process.chdir(PROJECT);
const db = await import(PROJECT + '/db.js');
const { writeFileSync } = await import('node:fs');
const leads = await db.getAll('leads');
const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
const file = `out/crm-leads-backup-before-${process.argv[2]}-${stamp}.json`;
writeFileSync(file, JSON.stringify(leads, null, 2));
console.log(`${leads.length} leads → ${file}`);
process.exit(0);
