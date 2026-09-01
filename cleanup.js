import 'dotenv/config';
import fetch from 'node-fetch';
import { getAll, remove } from './db.js';

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const DELAY_MS = 150;
const DELETE_MODE = process.argv.includes('--delete');

const delay = ms => new Promise(r => setTimeout(r, ms));

async function fetchTypes(placeId) {
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'types',
      },
    });
    const data = await res.json();
    if (data.error) { console.error(`  API error for ${placeId}: ${data.error.message}`); return []; }
    return data.types || [];
  } catch (e) {
    console.error(`  Fetch failed for ${placeId}: ${e.message}`);
    return [];
  }
}

function isPizzaByName(name) {
  return name.toLowerCase().includes('pizza');
}

async function run() {
  const leads = await getAll('leads');
  console.log(`Checking ${leads.length} leads against Google Places types...\n`);

  const toDelete = [];
  const kept = [];

  for (const lead of leads) {
    const types = await fetchTypes(lead.place_id);
    const hasPizzaType = types.includes('pizza_restaurant');
    const hasPizzaName = isPizzaByName(lead.name);

    if (hasPizzaType || hasPizzaName) {
      kept.push({ lead, types, reason: hasPizzaType ? 'pizza_restaurant type' : 'pizza in name' });
    } else {
      toDelete.push({ lead, types });
    }

    await delay(DELAY_MS);
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`KEEP (${kept.length}):`);
  for (const { lead, reason } of kept) {
    console.log(`  ✓ ${lead.name}  [${reason}]`);
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`DELETE CANDIDATES (${toDelete.length}):`);
  for (const { lead, types } of toDelete) {
    const typeStr = types.filter(t => !['establishment', 'point_of_interest', 'food', 'restaurant'].includes(t)).join(', ');
    console.log(`  ✗ ${lead.name}  [${typeStr || 'no specific type'}]`);
  }

  console.log(`\n${'─'.repeat(50)}`);
  if (!DELETE_MODE) {
    console.log(`Dry run — ${toDelete.length} leads would be deleted. Run with --delete to apply.`);
    return;
  }

  console.log(`Deleting ${toDelete.length} leads...`);
  for (const { lead } of toDelete) {
    await remove('leads', lead.id);
    console.log(`  Deleted: ${lead.name}`);
  }
  console.log(`Done. ${toDelete.length} leads removed, ${kept.length} kept.`);
}

run().catch(console.error);
