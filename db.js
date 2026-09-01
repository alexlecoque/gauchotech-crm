import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Postgres (Railway) ───────────────────────────────────────────────────
let pool = null;

if (process.env.DATABASE_URL) {
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL.trim(),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crm_leads     (id TEXT PRIMARY KEY, data JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS crm_customers (id TEXT PRIMARY KEY, data JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS crm_calls     (id TEXT PRIMARY KEY, data JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS crm_todos     (id TEXT PRIMARY KEY, data JSONB NOT NULL);
    `);
    console.log('DB: Postgres');
  } catch (err) {
    console.error('[db] Failed to initialize database:', err.message);
    process.exit(1);
  }
}

// ── JSON files (local) ───────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!pool && !existsSync(DATA_DIR)) mkdirSync(DATA_DIR);

function jsonLoad(table) {
  try { return JSON.parse(readFileSync(path.join(DATA_DIR, table + '.json'), 'utf8')); } catch { return []; }
}
function jsonSave(table, rows) {
  writeFileSync(path.join(DATA_DIR, table + '.json'), JSON.stringify(rows, null, 2));
}

// ── Unified API ──────────────────────────────────────────────────────────
export async function getAll(table) {
  if (pool) {
    const res = await pool.query(`SELECT data FROM crm_${table}`);
    return res.rows.map(r => r.data);
  }
  return jsonLoad(table);
}

export async function insert(table, row) {
  if (pool) {
    await pool.query(`INSERT INTO crm_${table} (id, data) VALUES ($1, $2)`, [row.id, row]);
  } else {
    const rows = jsonLoad(table);
    rows.push(row);
    jsonSave(table, rows);
  }
  return row;
}

export async function insertUnique(table, uniqueField, row) {
  if (pool) {
    const check = await pool.query(
      `SELECT id FROM crm_${table} WHERE data->>'${uniqueField}' = $1`,
      [row[uniqueField]]
    );
    if (check.rows.length > 0) return false;
    await pool.query(`INSERT INTO crm_${table} (id, data) VALUES ($1, $2)`, [row.id, row]);
    return true;
  } else {
    const rows = jsonLoad(table);
    if (rows.some(r => r[uniqueField] === row[uniqueField])) return false;
    rows.push(row);
    jsonSave(table, rows);
    return true;
  }
}

export async function update(table, id, changes) {
  if (pool) {
    const res = await pool.query(
      `UPDATE crm_${table} SET data = data || $1 WHERE id = $2 RETURNING data`,
      [changes, id]
    );
    return res.rows[0]?.data || null;
  } else {
    const rows = jsonLoad(table);
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) return null;
    rows[idx] = { ...rows[idx], ...changes };
    jsonSave(table, rows);
    return rows[idx];
  }
}

export async function remove(table, id) {
  if (pool) {
    await pool.query(`DELETE FROM crm_${table} WHERE id = $1`, [id]);
  } else {
    const rows = jsonLoad(table);
    jsonSave(table, rows.filter(r => r.id !== id));
  }
}
