process.env.CRM_DB_READONLY = '1';
import { fileURLToPath } from 'node:url';
const PROJECT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const db = await import(PROJECT + '/db.js');
const leads = await db.getAll('leads');
const by = {};
for (const l of leads) by[l.area || l.county || '?'] = (by[l.area || l.county || '?'] || 0) + 1;
console.log('TOTAL', leads.length); console.log(JSON.stringify(by));
process.exit(0);
