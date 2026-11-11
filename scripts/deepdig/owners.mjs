// Owner research for a shop across every source we can read by script or headless Chrome:
//   1. CA ABC license (licensee + officers/members)           6. Google Maps owner replies — not exposed by the Places API (skipped)
//   2. County FBN records (San Diego portal; others blocked)    7. Instagram / Facebook bios via search snippets
//   3. CA SOS bizfile entity (+ bizprofile.net officer list)    8. Local news / blogs via web search
//   4. The shop's own site (About / Our Story / footer)         9. BBB profile (principal contacts)
//   5. Yelp via search snippets (pages block headless Chrome)  10. LinkedIn via search snippets
// Confidence: strong = official filing with an owner-type role, or 2+ independent sources agree; medium = one good
// source; weak = agent-only / social-only hints (never imported as the owner).
//
// Usage: node owners.mjs <verified.csv> <area-key> [--only name] [--fresh]     → state out/logs/owners-<area>.json
//        node owners.mjs --crm <lead-id,lead-id,...> --tag backfill           → state out/logs/owners-backfill.json (read-only CRM)
import { readFileSync } from 'node:fs';
import {
  PROJECT, get, webSearch, crawlSite, abcLookup, ownerSentences, stripTags, normName, nameKey,
  parseCsv, loadJson, saveJson, closeBrowser, renderPage, sleep,
} from './lib.mjs';
import { renderPage as renderPage3 } from './browser3.js';

const opt = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const FRESH = process.argv.includes('--fresh');

// ── name hygiene ────────────────────────────────────────────────────────
const AGENT_SERVICES = /legalzoom|registered agent|incorp services|corporate creations|ct corporation|c t corporation|paracorp|cogency|northwest registered|united states corporation agents|inc\.? services|agents inc|law (?:group|office|firm)|cpa|accountanc|tax service|bookkeep|bizfilings|zenbusiness|harbor compliance|swyft|rocket lawyer|corporation service company|national registered|registered agents? (?:inc|llc)/i;
const NOT_PERSON = /\b(pizza|pizzeria|restaurant|cafe|kitchen|grill|taproom|tap|brewing|brewery|grotto|liquor|cantina|bistro|eatery|diner|lounge|tavern|pub|wings|subs|burgers|tacos|sushi|ramen|bbq|catering|bakery|coffee|donuts|kabob|halal|llc|inc|corp|corporation|company|co|trust|dated|county|beach|city|street|avenue|blvd|group|holdings|enterprises|ventures|foods|food|bros|brothers|famous|original|best|new york|california|italian|brick|oven|slice|the|and|of|owner|manager|reviews|yelp|google|facebook|instagram|linkedin|menu|order|online|delivery|north|south|east|west|san|los|la|santa|el|del|mission|valley|park|hills|heights|village|center|plaza|market|bar|bakery|deli|catering|express|house|place|shop|store|team|staff|family|guest|customer|business|april|march|june|july|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const TITLE_WORDS = /^(mr|mrs|ms|dr|chef|owner|founder|manager|president|ceo)\.?$/i;
export function cleanPerson(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/\s+/g, ' ').replace(/[“”"()]/g, '').trim();
  // "LAST, FIRST MIDDLE" → "First Middle Last"
  if (/^[A-Z' -]+,\s*[A-Z' .-]+$/.test(s)) { const [last, first] = s.split(',').map(x => x.trim()); s = `${first} ${last}`; }
  s = s.split(' ').filter(w => !TITLE_WORDS.test(w)).join(' ');
  const words = s.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 4) return null;
  if (AGENT_SERVICES.test(s) || NOT_PERSON.test(s)) return null;
  if (!words.every(w => /^[A-Za-z][A-Za-z'.-]*$/.test(w))) return null;
  if (words.some(w => /['’]s$/i.test(w) || /^(new|experience|franchise|at|in|on|from|with|about|meet|our|your|their|his|her|cybo|yelp|llc|inc|says|said|st|ave|blvd|rd|what|heart|love|thank|thanks|great|good|best|welcome|home|contact|hours|open|closed|check|visit|call|today|terrible|service|very|really|super|just|also|here|there|this|that|these|those|happy|hour|free|order|online|menu|photos|reviews|review|read|more|see|view|get|join|follow|like|share|now|then|when|where|why|how|who|dear|hey|hello|hi|yes|no|not)$/i.test(w))) return null;
  const tc = w => w.length <= 2 && /^[A-Z]\.?$/.test(w) ? w : w.charAt(0).toUpperCase() + (w.slice(1) === w.slice(1).toUpperCase() ? w.slice(1).toLowerCase() : w.slice(1));
  const name = words.map(w => w.split('-').map(tc).join('-')).join(' ');
  // drop a lone middle initial for matching, keep it for display
  return name;
}
const NICK = { mike: 'michael', leo: 'leonardo', leon: 'leonardo', mikey: 'michael', tony: 'anthony', bill: 'william', billy: 'william', will: 'william', bob: 'robert', bobby: 'robert', rob: 'robert', jim: 'james', jimmy: 'james', joe: 'joseph', joey: 'joseph', dave: 'david', tom: 'thomas', tommy: 'thomas', chris: 'christopher', nick: 'nicholas', nicky: 'nicholas', alex: 'alexander', sam: 'samuel', sammy: 'samuel', dan: 'daniel', danny: 'daniel', rick: 'richard', rich: 'richard', ricky: 'richard', ed: 'edward', eddie: 'edward', steve: 'steven', matt: 'matthew', andy: 'andrew', pete: 'peter', frank: 'francis', frankie: 'francis', vinny: 'vincent', vince: 'vincent', sal: 'salvatore', ben: 'benjamin', jon: 'jonathan', jake: 'jacob', jeff: 'jeffrey', greg: 'gregory', ron: 'ronald', ronnie: 'ronald', don: 'donald', ken: 'kenneth', kenny: 'kenneth', larry: 'lawrence', jerry: 'gerald', ray: 'raymond', lou: 'louis', louie: 'louis', tim: 'timothy', pat: 'patrick', ted: 'theodore', al: 'albert', johnny: 'john', jack: 'john', charlie: 'charles', chuck: 'charles', fred: 'frederick', hank: 'henry', manny: 'manuel', pepe: 'jose', paco: 'francisco', chuy: 'jesus', memo: 'guillermo', nacho: 'ignacio', lupe: 'guadalupe', toni: 'antonia', liz: 'elizabeth', beth: 'elizabeth', kate: 'katherine', katie: 'katherine', cathy: 'catherine', maggie: 'margaret', peggy: 'margaret', sue: 'susan', jen: 'jennifer', jenny: 'jennifer', debbie: 'deborah', deb: 'deborah', patty: 'patricia', trish: 'patricia', vicky: 'victoria', chrissy: 'christine', gabe: 'gabriel', gabby: 'gabriela', alejandro: 'alex', jose: 'jose' };
export const personKey = name => { const w = String(name || '').toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(x => x.length > 1); if (!w.length) return ''; const first = NICK[w[0]] || w[0]; return `${first} ${w[w.length - 1]}`; };
const OWNER_ROLE = /owner|ceo|chief executive|president|managing member|general partner|proprietor|founder|registrant|principal|member|manager|partner|director|chairman/i;
const rankOne = r => /owner|proprietor|registrant/i.test(r) ? 0 : /vice president|secretary|treasurer|cfo|chief financial|asst/i.test(r) ? 6 : /ceo|chief executive|president|founder|managing member|general partner/i.test(r) ? 1 : /member|partner|principal/i.test(r) ? 2 : /manager/i.test(r) ? 3 : /director|chairman/i.test(r) ? 4 : 5;
const roleRank = r => Math.min(...String(r || '').split('/').map(x => rankOne(x.trim())));
const niceRole = r => {
  r = String(r || '').replace(/\s+/g, ' ').trim();
  if (!r) return '';
  if (/managing member/i.test(r)) return 'Managing Member';
  if (/chief executive|^ceo$/i.test(r)) return 'CEO';
  if (/president/i.test(r)) return r.replace(/\//g, ' / ').split(' / ').map(x => x.trim()).filter(Boolean).map(x => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase()).join(' / ');
  if (/co-?owner/i.test(r)) return 'Co-owner';
  if (/owner/i.test(r)) return 'Owner';
  if (/founder/i.test(r)) return 'Founder';
  if (/general partner/i.test(r)) return 'General Partner';
  if (/registrant/i.test(r)) return 'Registrant (FBN)';
  if (/member/i.test(r)) return 'Member';
  if (/manager/i.test(r)) return 'Manager';
  if (/licensee/i.test(r)) return 'Licensee (ABC)';
  return r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();
};

// ── 1. ABC ──────────────────────────────────────────────────────────────
const GENERIC = new Set(['pizza', 'pizzeria', 'restaurant', 'the', 'and', 'of', 'italian', 'kitchen', 'cafe', 'grill', 'new', 'york', 'style', 'inc', 'llc', 'corp', 'co', 'company', 'house', 'shop', 'bar', 'deli', 'giant', 'best', 'original', 'famous', 'brothers', 'bros']);
const nameOverlap = (a, b) => { const wa = nameKey(a).split(' ').filter(w => w.length >= 3 && !GENERIC.has(w)); const wb = new Set(nameKey(b).split(' ')); return wa.some(w => wb.has(w)); };
function abcCandidates(abc, shop) {
  const out = [];
  for (const h of abc || []) {
    if (!(h.matched === 'address' || h.matched === 'name')) continue;
    // same address but a DBA / licensee that shares no name word with the shop: another business in the building (food hall, sister concept)
    // a name-only hit must really be this shop: same name key, or the full (2+ word) shop key inside the DBA and the license in the shop's city
    const shopKey = nameKey(shop.name), dbaKey = nameKey(h.dba || '');
    const keyIncludes = (a, b) => (` ${a} `).includes(` ${b} `);
    const nameOk = h.matched === 'name' && (dbaKey === shopKey || (shopKey.split(' ').length >= 2 && keyIncludes(dbaKey, shopKey) && sameCity(h.address, shop)));
    const sameBiz = h.matched === 'address' ? (nameOverlap(h.dba || '', shop.name) || nameOverlap(h.licensee || '', shop.name)) : nameOk;
    const flag = sameBiz ? {} : { official: false, weak: true };
    const why = sameBiz ? '' : ' — same address, different DBA; not proof';
    for (const m of h.members || []) {
      const mm = m.match(/^(OFFICER|MEMBER|STOCKHOLDER|LICENSEE|GENERAL PARTNER|LIMITED PARTNER|OWNER|TRUSTEE):\s*(.+?)(?:\s*\(([^)]+)\))?$/);
      if (!mm) continue;
      const [, kind, who, role] = mm;
      if (kind === 'LICENSEE' && /\b(LLC|INC|CORP|CORPORATION|CO|LP|LLP|TRUST)\b/i.test(who)) continue;
      const name = cleanPerson(who);
      if (!name) continue;
      out.push({ name, role: niceRole(role || (kind === 'LICENSEE' ? 'owner' : kind === 'STOCKHOLDER' ? 'stockholder' : kind)), source: 'abc', official: true, ...flag, url: h.url, note: `ABC license ${h.license} (${h.dba || h.licensee})${why}` });
    }
    // a sole-proprietor licensee is the owner
    if (!(h.members || []).some(m => /^OFFICER|^MEMBER/.test(m)) && h.licensee && /^[A-Z' -]+,\s*[A-Z' .-]+$/.test(h.licensee.trim()) && !/\b(LLC|INC|CORP|CORPORATION|CO|LP|LLP|TRUST)\b/i.test(h.licensee)) {
      const name = cleanPerson(h.licensee);
      if (name) out.push({ name, role: 'Owner', source: 'abc', official: true, ...flag, url: h.url, note: `ABC licensee is a person (license ${h.license})${why}` });
    }
  }
  return out;
}

// ── 3. SOS bizfile (+ bizprofile.net officers) ──────────────────────────
const SOS_URL = 'https://bizfileonline.sos.ca.gov/search/business';
const sosBody = q => JSON.stringify({ SEARCH_VALUE: q, SEARCH_FILTER_TYPE_ID: '0', SEARCH_TYPE_ID: '1', FILING_TYPE_ID: '', STATUS_ID: '', FILING_DATE: { start: null, end: null }, CORPORATION_BANKRUPTCY_YN: false, CORPORATION_LEGAL_PROCEEDINGS_YN: false, OFFICER_OBJECT: { FIRST_NAME: '', MIDDLE_NAME: '', LAST_NAME: '' }, NUMBER_OF_FEMALE_DIRECTORS: '99', NUMBER_OF_UNDERREPRESENTED_DIRECTORS: '99', COMPENSATION_FROM: '', COMPENSATION_TO: '', SHARES_YN: false, OPTIONS_YN: false, BANKRUPTCY_YN: false, FRAUD_YN: false, LOANS_YN: false, AUDITOR_NAME: '' });
async function sosSearch(q) {
  const p = await renderPage3(SOS_URL, { waitMs: 8000, script: `fetch('/api/Records/businesssearch',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(sosBody(q))}}).then(r=>r.text()).catch(e=>'ERR '+e)` });
  try { return Object.values(JSON.parse(p?.scriptResult || '{}').rows || {}); } catch { return []; }
}
async function sosDetail(id) {
  const p = await renderPage3(SOS_URL, { waitMs: 6000, script: `fetch('/api/FilingDetail/business/${id}/false').then(r=>r.text()).catch(e=>'ERR '+e)` });
  try { const j = JSON.parse(p?.scriptResult || '{}'); const o = {}; for (const d of j.DRAWER_DETAIL_LIST || []) o[d.LABEL] = d.VALUE; return o; } catch { return {}; }
}
const streetKey = address => { const m = normName(String(address || '').split('\n')[0].split(',')[0]).match(/^(\d+)\s+(\S+)/); return m ? `${m[1]} ${m[2]}` : ''; };
const sameCity = (addr, shop) => normName(addr || '').includes(normName(shop.city)) || (/Los Angeles/i.test(shop.county || '') && /los angeles/i.test(normName(addr || '')) && !/\b(long beach|torrance|whittier|downey|norwalk|pasadena|glendale|burbank)\b/i.test(shop.city || ''));
const cityOfAddress = addr => (String(addr || '').replace(/\n/g, ', ').match(/,\s*([A-Za-z .'-]+?)\s*,\s*CA\b/i) || [])[1] || '';
const entitySlug = name => String(name || '').replace(/,?\s*\b(inc|llc|l\.l\.c|corp|corporation|co|ltd|lp|llp|a california (?:limited liability company|corporation))\b\.?\s*$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export async function bizprofileOfficers(entityName, city) {
  const tryUrl = async url => {
    const r = await get(url);
    if (r.status !== 200) return null;
    const t = stripTags(r.html);
    if (!t.toLowerCase().includes(entitySlug(entityName).split('-').slice(0, 2).join(' '))) return null;
    const people = [];
    for (const m of t.matchAll(/([A-Z][A-Za-z'.-]+(?: [A-Z][A-Za-z'.-]+){1,3}) from [A-Za-z .]+?,? [A-Z]{2},? (?:holding the position of|serving as the|serving as|as the|as) (?:the )?([A-Za-z /]+?)[;.]/g)) people.push({ name: m[1], role: m[2].trim() });
    for (const m of t.matchAll(/(Chief Executive Officer|President|Secretary|Chief Financial Officer|Director|Manager|Member|Managing Member)\s*[:\-]\s*([A-Z][A-Za-z'.-]+(?: [A-Z][A-Za-z'.-]+){1,3})/g)) people.push({ name: m[2], role: m[1] });
    const agent = (t.match(/([A-Z][A-Za-z'.-]+(?: [A-Z][A-Za-z'.-]+){1,3}) acts as the registered agent/) || [])[1];
    return { url, people, agent, text: t.slice(0, 600) };
  };
  const guess = `https://www.bizprofile.net/ca/${String(city || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}/${entitySlug(entityName)}`;
  let r = await tryUrl(guess);
  if (r) return r;
  const s = await webSearch(`site:bizprofile.net "${entityName.replace(/[,.]/g, '')}"`);
  const hit = s.results.find(x => /bizprofile\.net\/ca\//.test(x.url));
  if (hit) r = await tryUrl(hit.url);
  return r;
}
async function sosEntities(shop, abc) {
  const names = new Map([[shop.name, false]]);   // query → reached only via another DBA at the address?
  for (const h of abc || []) if (h.licensee && /\b(LLC|INC|CORP|CORPORATION|CO|LP|LLP)\b/i.test(h.licensee) && (h.matched === 'address' || h.matched === 'name')) {
    const otherDba = !(h.matched === 'name' || nameOverlap(h.dba || '', shop.name) || nameOverlap(h.licensee || '', shop.name));
    names.set(h.licensee.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim(), otherDba);
  }
  const shopStreet = streetKey(shop.address);
  const entities = [];
  for (const [q, otherDba] of [...names.entries()].slice(0, 3)) {
    const rows = await sosSearch(q.replace(/[’']/g, ''));
    for (const row of rows.slice(0, 6)) {
      const title = (row.TITLE || [''])[0].replace(/\s*\(\d+\)\s*$/, '');
      const byName = nameKey(title) && nameKey(shop.name) && (nameKey(title).includes(nameKey(shop.name)) || nameKey(shop.name).includes(nameKey(title)) || nameKey(title) === nameKey(q));
      if (!byName && row.STATUS !== 'Active') continue;
      const d = await sosDetail(row.ID);
      const addr = d['Principal Address'] || '';
      const byAddress = shopStreet && streetKey(addr) === shopStreet;
      const inCity = sameCity(addr, shop);
      if (!(byAddress || (byName && (inCity || row.STATUS === 'Active')))) continue;
      const agent = (d.Agent || '').split('\n');
      const agentName = agent[0] === 'Individual' ? cleanPerson(agent[1]) : null;
      const exact = nameKey(title) === nameKey(shop.name) && nameKey(shop.name).split(' ').some(w => w.length >= 3 && !GENERIC.has(w));
      const ent = { id: row.ID, name: title, status: row.STATUS, type: row.ENTITY_TYPE, address: addr.replace(/\n/g, ', '), exact, agentName, agentIsService: agent[0] !== 'Individual' || AGENT_SERVICES.test(agent[1] || ''), match: byAddress ? 'address' : otherDba ? 'other-dba' : inCity ? 'name+city' : exact && row.STATUS === 'Active' ? 'name+exact' : 'name', url: 'https://bizfileonline.sos.ca.gov/search/business', people: [] };
      entities.push(ent);
      if (row.STATUS === 'Active' || entities.length === 1) {
        const bp = await bizprofileOfficers(title, cityOfAddress(addr) || shop.city);
        if (bp) { ent.bizprofile = bp.url; ent.people = bp.people; }
      }
      if (entities.length >= 3) break;
    }
    if (entities.some(e => e.match === 'address')) break;
  }
  return { entities };
}
function sosCandidates(sos, shop) {
  const out = [];
  for (const ent of sos?.entities || []) {
    // only an entity at the shop's address, or one named after the shop in the shop's city, proves anything
    if (ent.match === 'name' && shop && sameCity(ent.address, shop)) ent.match = 'name+city';
    if (ent.match === 'name' && shop && ent.status === 'Active' && nameKey(ent.name) === nameKey(shop.name) && nameKey(shop.name).split(' ').some(w => w.length >= 3 && !GENERIC.has(w))) ent.match = 'name+exact';
    const proven = ent.match === 'address' || ent.match === 'name+city' || ent.match === 'name+exact';
    const flag = proven ? {} : { official: false, weak: true };
    const how = ent.match === 'name+exact' ? ' (entity named exactly after the shop)' : '';
    const why = proven ? how : ent.match === 'other-dba' ? ' — entity of another DBA at the same address; not proof' : ' — matched by name only, principal address elsewhere; not proof';
    if (ent.agentName && !ent.agentIsService) out.push({ name: ent.agentName, role: 'Registered agent (individual)', source: 'sos-agent', official: false, weak: true, url: ent.url, note: `agent for ${ent.name} (${ent.status})` });
    for (const p of ent.people || []) { const name = cleanPerson(p.name); if (name) out.push({ name, role: niceRole(p.role), source: 'sos-officer', official: true, ...flag, url: ent.bizprofile || ent.url, note: `${ent.name} officer list (SOS Statement of Information via bizprofile.net; ${ent.match} match)${why}` }); }
  }
  return out;
}

// ── 2. County FBN (San Diego portal; other counties need an interactive session) ──
let sdAccepted = false;
const sdAccept = () => renderPage3('https://arcc-acclaim.sdcounty.ca.gov/search/Disclaimer?st=/fbn/SearchTypeFBNByName', { waitMs: 6000, script: `(async()=>{const b=document.getElementById('btnButton');if(b){b.click();await new Promise(r=>setTimeout(r,7000));}return location.href})()` });
async function sdFbn(shop) {
  if (!/San Diego/i.test(shop.county || '')) return null;
  if (!sdAccepted) { await sdAccept(); sdAccepted = true; }
  const words = String(shop.name).replace(/[’']/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const q = words.slice(0, 3).join(' ');
  const key = nameKey(shop.name).split(' ').slice(0, 2).join(' ');
  const script = `(async()=>{await new Promise(r=>setTimeout(r,3000)); if(document.getElementById('btnButton')) return 'DISCLAIMER';
const inp=document.querySelector('#SearchOnName'); if(!inp) return 'NO INPUT';
const dr=document.querySelector('#EventDateRange'); if(dr){dr.value='Custom'; dr.dispatchEvent(new Event('change',{bubbles:true}));}
const from=document.querySelector('#DateFrom'); if(from){from.value='1/1/1990'; from.dispatchEvent(new Event('change',{bubbles:true}));}
inp.focus(); inp.value=${JSON.stringify(q)}; inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true}));
const btn=[...document.querySelectorAll('button,input[type=submit],input[type=button],a')].find(e=>/^\\s*search\\s*$/i.test((e.textContent||e.value||'')));
if(btn) btn.click(); else if(inp.form) inp.form.requestSubmit();
await new Promise(r=>setTimeout(r,8000));
const lis=[...document.querySelectorAll('li')].filter(l=>{const t=(l.querySelector('.t-in')?.textContent||'').toUpperCase().replace(/[’'.,-]/g,'').replace(/\\s+/g,' '); return /\\(\\d+\\)/.test(t) && ${JSON.stringify(words.slice(0, 2).join(' '))}.split(' ').every(w=>t.includes(w));});
const names=lis.map(l=>l.querySelector('.t-in').textContent.trim());
if(!lis.length) return 'NO MATCH | '+[...document.querySelectorAll('li .t-in')].map(e=>e.textContent.trim()).slice(0,40).join(' ; ');
for(const l of lis.slice(0,6)){const cb=l.querySelector('input[type=checkbox]'); if(cb&&!cb.checked) cb.click(); await new Promise(r=>setTimeout(r,300));}
const done=[...document.querySelectorAll('button,input[type=button],input[type=submit],a')].filter(e=>e.offsetParent!==null).find(e=>/^done$/i.test((e.textContent||e.value||'').trim()));
if(done) done.click(); await new Promise(r=>setTimeout(r,9000));
const rows=[...document.querySelectorAll('tr')].map(t=>[...t.querySelectorAll('td')].map(c=>c.innerText.replace(/\\s+/g,' ').trim())).filter(c=>c.length>=6&&/FICTITIOUS|FBN|STATEMENT/i.test(c.join(' ')));
return JSON.stringify({names, rows: rows.slice(0,40)});})()`;
  let p = await renderPage3('https://arcc-acclaim.sdcounty.ca.gov/fbn/SearchTypeFBNByName', { waitMs: 8000, script });
  if (p?.scriptResult === 'DISCLAIMER') { await sdAccept(); p = await renderPage3('https://arcc-acclaim.sdcounty.ca.gov/fbn/SearchTypeFBNByName', { waitMs: 8000, script }); }
  const raw = String(p?.scriptResult || '');
  let parsed = null; try { parsed = JSON.parse(raw); } catch {}
  return { query: q, names: parsed?.names || [], rows: parsed?.rows || [], registrants: fbnRegistrants(parsed?.rows || [], q), raw: parsed ? '' : raw.slice(0, 500) };
}
export function fbnRegistrants(rows, q) {
  const registrants = [];
  // FBN statements expire after five years and ownership changes: keep only the newest current filing
  const dated = (rows || []).map(r => { const c = r.length >= 7 ? r : ['', ...r]; const m = (c[4] || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return { r, when: m ? `${m[3]}-${m[1]}-${m[2]}` : '', doc: c[6] }; }).filter(x => x.when && x.when >= new Date(Date.now() - 5 * 365.25 * 86400000).toISOString().slice(0, 10)).sort((a, b) => b.when.localeCompare(a.when));
  // the newest current filing that names a person (a newer filing by the owner's corporation does not change who the owner is)
  const persons = x => { const c = x.r.length >= 7 ? x.r : ['', ...x.r]; const rel = c[3] || ''; return rel && !/\b(INC|LLC|CORP|CORPORATION|CO|LP|LLP|TRUST|PIZZA|PIZZERIA|RESTAURANT|KITCHEN|GRILL|CAFE)\b/i.test(rel) && rel.split(/\s+/).length >= 2 && rel.split(/\s+/).length <= 4; };
  const newestDoc = dated.find(persons)?.doc;
  for (const r of dated.filter(x => x.doc === newestDoc).map(x => x.r)) {
    // columns: cart, row, searched name, related name, file date, doc type, document #
    const [, , searched, related, date, type, doc] = r.length >= 7 ? r : ['', ...r];
    if (!related || /\b(INC|LLC|CORP|CORPORATION|CO|LP|LLP|TRUST|PIZZA|PIZZERIA|RESTAURANT|KITCHEN|GRILL|CAFE)\b/i.test(related)) continue;
    const w = related.split(/\s+/);
    if (w.length < 2 || w.length > 4) continue;
    // the index lists LAST FIRST MIDDLE; with four words assume two surnames first (SOTO RODRIGUEZ JUAN CARLOS)
    const name = cleanPerson(w.length === 4 ? `${w[2]} ${w[3]} ${w[0]} ${w[1]}` : `${w.slice(1).join(' ')} ${w[0]}`);
    if (name) registrants.push({ name, searched, date, type, doc });
  }
  return registrants;
}

// ── 9. BBB ──────────────────────────────────────────────────────────────
async function bbb(shop) {
  const u = `https://www.bbb.org/search?find_country=USA&find_text=${encodeURIComponent(shop.name)}&find_loc=${encodeURIComponent(shop.city + ', CA')}`;
  const p = await renderPage3(u, { waitMs: 12000 });
  if (!p?.html) return { error: 'no render' };
  const key = nameKey(shop.name);
  const links = [...p.html.matchAll(/<a[^>]+href="(https:\/\/www\.bbb\.org\/us\/ca\/[^"]+\/profile\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => ({ url: m[1].split('#')[0], text: stripTags(m[2]) }));
  const hit = links.find(l => nameKey(l.text) && (nameKey(l.text).includes(key) || key.includes(nameKey(l.text))));
  if (!hit) return { searched: u, profile: null, people: [] };
  const prof = await renderPage3(hit.url, { waitMs: 12000 });
  const text = String(prof?.text || '').replace(/\s+/g, ' ');
  const people = [];
  const block = (text.match(/(?:Principal Contacts|Business Management|Customer Contacts)(.{0,400})/) || [])[1] || '';
  for (const m of block.matchAll(/((?:Mr\.|Mrs\.|Ms\.|Dr\.)?\s*[A-Z][A-Za-z'.-]+(?: [A-Z][A-Za-z'.-]+){1,2}),\s*([A-Za-z /&-]{2,40}?)(?=\s(?:Mr\.|Mrs\.|Ms\.|Dr\.|[A-Z][a-z]+ [A-Z][a-z]+,)|$|\s{2})/g)) { const name = cleanPerson(m[1]); if (name) people.push({ name, role: m[2].trim() }); }
  const addrOk = (shop.address || '').split(' ')[0] && text.includes((shop.address || '').split(' ')[0]);
  return { searched: u, profile: hit.url, people, addrOk, block: block.slice(0, 300) };
}

// ── 4/5/7/8/10. text mining ─────────────────────────────────────────────
// case-insensitive on the first letter only, so the name capture after it keeps its capital-letter test
const ci = s => s.replace(/\b([a-z])/g, (m, c) => `[${c.toUpperCase()}${c}]`);
const ROLE_WORDS = ci('(?:co-?owner|owner|proprietor|founder|co-?founder|chef-owner|chef\\/owner|owner\\/operator|managing partner|general manager|manager|operator)');
const VERBS = ci('(?:owned|founded|opened|started|run|operated)');
export function minePeople(text, source, url) {
  const out = [];
  const t = String(text || '').replace(/\s+/g, ' ');
  const NAME = "([A-Z][a-z'’-]+(?: (?:[A-Z]\\.|[A-Z][a-z'’-]+)){1,2})";
  const pats = [
    new RegExp(`${ROLE_WORDS}s?,? ${NAME}`, 'g'),                                  // "owner John Smith"
    new RegExp(`${NAME},? (?:the |is |was |and |a )?(?:(?:its|the|their|his|her|our) )?${ROLE_WORDS}`, 'g'),   // "John Smith, owner"
    new RegExp(`${VERBS} (?:and operated )?by ${NAME}`, 'g'),
    new RegExp(`${NAME} (?:who )?(?:owns|opened|founded|started|runs|took over|bought)`, 'g'),
    new RegExp(`${NAME} - ${ROLE_WORDS}`, 'g'),                                   // LinkedIn titles "John Smith - Owner - Shop"
  ];
  for (const re of pats) for (const m of t.matchAll(re)) {
    const name = cleanPerson(m[1]);
    if (!name) continue;
    const ctx = t.slice(Math.max(0, m.index - 90), m.index + m[0].length + 90);
    const role = (ctx.match(new RegExp(ROLE_WORDS, 'i')) || ['owner'])[0];
    out.push({ name, role: niceRole(role), source, url, note: ctx.trim() });
  }
  return out;
}

// ── put it together ─────────────────────────────────────────────────────
export function decide(cands, shop) {
  const groups = new Map();
  for (const c of cands) {
    const k = personKey(c.name);
    if (!k) continue;
    const g = groups.get(k) || { key: k, names: [], roles: [], sources: new Set(), official: false, weakOnly: true, items: [] };
    g.names.push(c.name); g.roles.push(c.role); g.sources.add(c.source); g.items.push(c);
    if (c.official) g.official = true;
    if (!c.weak) g.weakOnly = false;
    groups.set(k, g);
  }
  const scored = [...groups.values()].map(g => {
    const bestRole = g.roles.filter(Boolean).sort((a, b) => roleRank(a) - roleRank(b))[0] || '';
    const independent = new Set([...g.sources].map(s => s.replace(/^(sos-officer|abc|fbn)$/, 'official').replace(/^(search-.*)$/, 'web')));
    const bestPart = String(bestRole).split('/').map(x => x.trim()).sort((a, b) => rankOne(a) - rankOne(b))[0] || '';
    const ownerish = OWNER_ROLE.test(bestPart) && !/vice president|secretary|treasurer|cfo|chief financial|asst/i.test(bestPart);
    let confidence = 'weak';
    if (g.official && ownerish) confidence = 'strong';
    else if (independent.size >= 2 && !g.weakOnly) confidence = 'strong';
    else if (!g.weakOnly && (g.official || [...g.sources].some(s => ['site', 'bbb', 'search-news', 'search-linkedin', 'search-owner'].includes(s)))) confidence = 'medium';
    // a name that is the shop's own name words (e.g. "Pizza Pete") is not a person
    if (nameKey(shop.name).includes(nameKey(g.names[0]))) confidence = 'weak';
    const informal = g.items.find(i => ['site', 'search-owner', 'search-news', 'search-linkedin', 'bbb'].includes(i.source));
    const display = informal ? informal.name : g.names.sort((a, b) => b.length - a.length)[0];
    // among official sources the address-verified ABC license is the most current, then a current FBN, then the SOS officer list
    const prio = Math.min(...g.items.map(i => i.official && !i.weak ? ({ abc: 0, fbn: 1, 'sos-officer': 2 }[i.source] ?? 3) : 4));
    return { name: display, role: niceRole(bestRole) || 'Owner', confidence, sources: [...g.sources], urls: [...new Set(g.items.map(i => i.url).filter(Boolean))].slice(0, 3), notes: g.items.map(i => i.note).filter(Boolean).slice(0, 3), rank: roleRank(bestRole), prio, official: g.official };
  });
  const order = { strong: 0, medium: 1, weak: 2 };
  scored.sort((a, b) => order[a.confidence] - order[b.confidence] || a.prio - b.prio || a.rank - b.rank || b.sources.length - a.sources.length);
  const best = scored.find(s => s.confidence !== 'weak') || null;
  return { best, all: scored.slice(0, 8) };
}

export async function ownerDig(shop, { prior = {} } = {}) {
  const s = prior;
  const cands = [];
  // 1. ABC (reuse verify state when present)
  if (!s.abc) s.abc = await abcLookup(shop).catch(e => ({ error: e.message }));
  const abc = Array.isArray(s.abc) ? s.abc : [];
  cands.push(...abcCandidates(abc, shop));
  // 3. SOS + bizprofile
  if (!s.sos || !s.sos.entities?.every(e => 'people' in e)) s.sos = await sosEntities(shop, abc).catch(e => ({ error: e.message, entities: [] }));
  for (const ent of s.sos.entities || []) if (!ent.address && !ent.addrRetried) {
    ent.addrRetried = true;
    const d = await sosDetail(ent.id).catch(() => ({}));
    const addr = (d['Principal Address'] || '').replace(/\n/g, ', ');
    if (addr) { ent.address = addr; if (streetKey(addr) === streetKey(shop.address)) ent.match = 'address'; else if (sameCity(addr, shop) && ent.match === 'name') ent.match = 'name+city'; }
  }
  for (const ent of s.sos.entities || []) if (!ent.people?.length && !ent.bizprofile && !ent.retried) { ent.retried = true; const bp = await bizprofileOfficers(ent.name, cityOfAddress(ent.address) || shop.city).catch(() => null); if (bp) { ent.bizprofile = bp.url; ent.people = bp.people; } }
  cands.push(...sosCandidates(s.sos, shop));
  // 2. County FBN (San Diego only)
  if (s.fbn === undefined) s.fbn = await sdFbn(shop).catch(e => ({ error: e.message }));
  if (s.fbn?.rows) s.fbn.registrants = fbnRegistrants(s.fbn.rows, s.fbn.query);
  for (const r of s.fbn?.registrants || []) cands.push({ name: r.name, role: 'Registrant (FBN)', source: 'fbn', official: true, url: 'https://arcc-acclaim.sdcounty.ca.gov/fbn/SearchTypeFBNByName', note: `San Diego County FBN ${r.doc} (${r.date}) for "${r.searched}"` });
  // 4. own site: About / Our Story pages
  if (!s.site) {
    const c = await crawlSite(shop.website, { maxPages: 15 });
    s.site = { pages: c.pages, sentences: ownerSentences(c.text), social: c.social.slice(0, 6), text: c.text.slice(0, 12000) };
  }
  cands.push(...minePeople(s.site.text, 'site', shop.website));
  // 5/7/8/10. searches
  if (!s.searches) {
    const qs = {
      'search-owner': `"${shop.name}" ${shop.city} owner`,
      'search-news': `"${shop.name}" ${shop.city} pizza owner interview`,
      'search-linkedin': `site:linkedin.com "${shop.name}" owner`,
      'search-social': `"${shop.name}" ${shop.city} instagram owner`,
      'search-yelp': `site:yelp.com "${shop.name}" ${shop.city} owner`,
    };
    s.searches = {};
    for (const [k, q] of Object.entries(qs)) {
      const r = await webSearch(q);
      s.searches[k] = { q, engine: r.engine, results: r.results.slice(0, 8).map(x => ({ url: x.url, title: x.title.slice(0, 140), snippet: x.snippet.slice(0, 300) })) };
    }
  }
  const DIRECTORY = /cybo\.com|mapquest|yellowpages|manta\.com|buzzfile|dnb\.com|bizapedia|opencorporates|naicslist|bizprofile|chamberofcommerce|zoominfo|rocketreach|signalhire|apollo\.io|allbiz|localstack|merchantcircle|birdeye|restaurantji|menupix|zmenu|foursquare|tripadvisor|doordash|ubereats|grubhub|slicelife|toasttab|square\.site|clover\.com/;
  const shopHost = (() => { try { return new URL(shop.website).hostname.replace(/^www\./, ''); } catch { return null; } })();
  for (const [k, v] of Object.entries(s.searches)) for (const x of v.results) {
    // only results that name the shop and its city (or live on the shop's own site)
    const blob = `${x.title} ${x.snippet}`;
    const own = shopHost && x.url.includes(shopHost);
    const named = nameKey(blob).includes(nameKey(shop.name));
    const placed = normName(blob).includes(normName(shop.city)) || /los angeles|\bla\b/i.test(blob) && /Los Angeles/i.test(shop.county || '');
    if (!own && !(named && placed)) continue;
    const weak = !own && DIRECTORY.test(x.url);
    cands.push(...minePeople(blob, k, x.url).map(c => weak ? { ...c, weak: true, note: `${c.note} [directory site]` } : c));
  }
  // 8. read the promising pages themselves (own-site About/Our Story pages, local news, blogs): snippets cut names off
  if (!s.pages) {
    const SOCIAL_HOST = /facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|youtube\.com|yelp\.com|linkedin\.com|nextdoor\.com/;
    const seen = new Set(), picks = [];
    for (const k of ['search-owner', 'search-news', 'search-social']) for (const x of s.searches[k]?.results || []) {
      const own = shopHost && x.url.includes(shopHost);
      const blob = `${x.title} ${x.snippet}`;
      const named = nameKey(blob).includes(nameKey(shop.name));
      const story = /our story|about|owner|founder|family|spotlight|interview|meet|history|profile|opens|opened|behind/i.test(blob);
      if (seen.has(x.url) || SOCIAL_HOST.test(x.url) || DIRECTORY.test(x.url)) continue;
      if (own || (named && story)) { seen.add(x.url); picks.push({ url: x.url, kind: own ? 'site' : 'search-news' }); }
      if (picks.length >= 5) break;
    }
    s.pages = [];
    for (const p of picks) {
      const r = await get(p.url);
      let text = stripTags(r.html).slice(0, 40000), how = 'fetch';
      // bot walls (Cloudflare "Just a moment") and JS-only sites: read through headless Chrome
      if (r.status >= 400 || /just a moment|enable javascript/i.test(text) || text.length < 1500) {
        const rp = await renderPage3(p.url, { waitMs: 12000 });
        if (rp?.text && rp.text.length > text.length) { text = rp.text.replace(/\s+/g, ' ').slice(0, 40000); how = 'chrome'; }
      }
      s.pages.push({ url: p.url, kind: p.kind, status: r.status, how, chars: text.length, sentences: ownerSentences(text).slice(0, 4), text: text.slice(0, 15000) });
    }
  }
  for (const p of s.pages) {
    if (!p.text) continue;
    // a page must name the shop (own-site pages always do); news pages must also place it
    if (p.kind !== 'site' && !(nameKey(p.text).includes(nameKey(shop.name)) && normName(p.text).includes(normName(shop.city)))) continue;
    cands.push(...minePeople(p.text, p.kind, p.url));
  }
  // 9. BBB
  if (!s.bbb) s.bbb = await bbb(shop).catch(e => ({ error: e.message }));
  for (const p of s.bbb?.people || []) cands.push({ name: p.name, role: niceRole(p.role), source: 'bbb', url: s.bbb.profile, note: `BBB profile ${s.bbb.addrOk ? '(address matches)' : '(address not checked)'}` });
  s.candidates = cands;
  s.decision = decide(cands, shop);
  s.dug_at = new Date().toISOString();
  return s;
}

// ── CLI ─────────────────────────────────────────────────────────────────
if (process.argv[1] && /owners\.mjs$/.test(process.argv[1])) {
  const crm = opt('--crm');
  let shops = [], STATE, verifyState = {};
  if (crm) {
    process.env.CRM_DB_READONLY = '1';
    const db = await import(PROJECT + '/db.js');
    const ids = new Set(crm.split(','));
    shops = (await db.getAll('leads')).filter(l => ids.has(l.id)).map(l => ({ id: l.id, place_id: l.place_id, name: l.name, address: l.address, city: l.city, county: l.county, zip: l.zip, phone: l.phone, website: l.website }));
    STATE = `${PROJECT}/out/logs/owners-${opt('--tag') || 'backfill'}.json`;
  } else {
    const [file, area] = process.argv.slice(2);
    const rows = parseCsv(readFileSync(file, 'utf8'));
    shops = rows.filter(r => r.verdict === 'new_target' && ['Square', 'Clover'].includes(r.pos)).map(r => ({ place_id: r.place_id, name: r.name, address: r.address, city: r.city, county: r.county, zip: r.zip, phone: r.phone, website: r.website }));
    STATE = `${PROJECT}/out/logs/owners-${area}.json`;
    verifyState = loadJson(`${PROJECT}/out/logs/verify-${area}.json`, {});
  }
  const ONLY = opt('--only');
  if (ONLY) shops = shops.filter(s => s.name.toLowerCase().includes(ONLY.toLowerCase()));
  const state = loadJson(STATE, {});
  console.log(`${shops.length} shop(s) for owner research (${Object.keys(state).length} in state)`);
  let hits = 0;
  for (const shop of shops) {
    const key = shop.place_id || shop.id;
    if (state[key]?.decision && !FRESH) { if (state[key].decision.best) hits++; continue; }
    const prior = state[key] || {};
    const v = verifyState[shop.place_id];
    if (v?.owner?.abc && !prior.abc) prior.abc = v.owner.abc;
    try {
      state[key] = await ownerDig(shop, { prior });
      const b = state[key].decision.best;
      if (b) hits++;
      console.log(`  ${b ? b.confidence.padEnd(6) : 'none  '} ${shop.name} [${shop.city}] ${b ? `→ ${b.name} (${b.role}; ${b.sources.join('+')})` : `— ${state[key].decision.all.slice(0, 3).map(a => `${a.name}/${a.confidence}/${a.sources.join('+')}`).join(', ') || 'no names'}`}`);
    } catch (e) { console.error(`  ! ${shop.name}: ${e.message}`); }
    saveJson(STATE, state);
  }
  saveJson(STATE, state);
  console.log(`\nowners found (strong/medium): ${hits}/${shops.length} → ${STATE}`);
  closeBrowser();
  process.exit(0);
}
