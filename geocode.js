import 'dotenv/config';
import fetch from 'node-fetch';
import { getAll, update } from './db.js';

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const delay = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const leads = await getAll('leads');
  const missing = leads.filter(l => !l.lat && l.place_id);
  console.log(`${missing.length} leads need geocoding (of ${leads.length} total)\n`);

  let ok = 0, failed = 0;

  for (const lead of missing) {
    try {
      const res = await fetch(`https://places.googleapis.com/v1/places/${lead.place_id}`, {
        headers: {
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': 'location',
        },
      });
      const data = await res.json();
      if (data.location?.latitude != null) {
        await update('leads', lead.id, { lat: data.location.latitude, lng: data.location.longitude });
        console.log(`  ✓  ${lead.name} (${data.location.latitude.toFixed(4)}, ${data.location.longitude.toFixed(4)})`);
        ok++;
      } else {
        console.log(`  ✗  ${lead.name} — no location returned`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗  ${lead.name} — ${err.message}`);
      failed++;
    }
    await delay(150);
  }

  console.log(`\n─────────────────────────────────`);
  console.log(`Done. Geocoded: ${ok} | Failed: ${failed}`);
  process.exit(0);
}

run().catch(console.error);
