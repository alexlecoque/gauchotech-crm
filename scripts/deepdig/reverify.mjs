// Step 4: pick N random targets across the night's import plans and re-verify them from scratch
// (fresh process, no caches): Google status today + POS page match via detectPOS on the website, then the evidence URL.
// Usage: node reverify.mjs <N> <plan.csv> [plan.csv ...]
import { readFileSync } from 'node:fs';
import { PROJECT, parseCsv, placeDetails, closeBrowser, saveJson, today } from './lib.mjs';
const { detectPOS } = await import(PROJECT + '/pos.js');

const [n, ...files] = process.argv.slice(2);
const TARGET = new Set(['Square', 'Clover']);
const verifiedWhere = where => /address\/phone match|name and city match|own website is a Square Online site/.test(where || '');
const all = [];
for (const f of files) for (const r of parseCsv(readFileSync(f, 'utf8'))) if (r.verdict === 'new_target') all.push({ ...r, _file: f });
// deterministic-but-random sample: seeded shuffle
let seed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, '')) % 9973;
const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
const sample = [...all].sort(() => rand() - 0.5).slice(0, Number(n));
console.log(`${all.length} planned target(s) across ${files.length} plan(s); re-verifying ${sample.length}`);

const results = [];
for (const r of sample) {
  const shop = { name: r.name, address: r.address, city: r.city, zip: r.zip, phone: r.phone, website: r.website };
  const d = await placeDetails(r.place_id);
  let det = r.website ? await detectPOS(r.website, { shop }) : null;
  let via = 'website';
  if (!(det && TARGET.has(det.pos) && verifiedWhere(det.evidenceWhere)) && r.pos_evidence) {
    const det2 = await detectPOS(r.pos_evidence, { shop });
    if (det2 && TARGET.has(det2.pos) && verifiedWhere(det2.evidenceWhere)) { det = det2; via = 'evidence URL'; }
  }
  const posOk = det && TARGET.has(det.pos) && verifiedWhere(det.evidenceWhere);
  const samePos = posOk && det.pos === r.pos;
  const open = d.businessStatus === 'OPERATIONAL';
  const pass = open && posOk && samePos;
  results.push({ name: r.name, city: r.city, plan: r._file.split('/').pop(), planned: `${r.pos} ${r.pos_confidence}`, google: d.businessStatus, live: det ? `${det.pos || 'none'} ${det.confidence || ''} via ${via}` : 'no check', where: (det?.evidenceWhere || '').slice(0, 160), pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${r.name} [${r.city}] planned ${r.pos}/${r.pos_confidence} → Google ${d.businessStatus}, live ${det?.pos || 'none'} ${det?.confidence || ''} (${via})`);
}
saveJson(`${PROJECT}/out/logs/reverify-${today()}.json`, results);
closeBrowser();
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
process.exit(0);
