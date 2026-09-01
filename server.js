import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAll, insert, update, remove } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => new Date().toISOString().slice(0, 10);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── LEADS ──────────────────────────────────────────────────────────────────
app.get('/api/leads', async (req, res) => {
  const rows = await getAll('leads');
  res.json(rows.sort((a, b) => (b.added || '').localeCompare(a.added || '')));
});

app.post('/api/leads', async (req, res) => {
  const { name, owner, role, phone, address, city, website, pos, stage, notes } = req.body;
  const row = { id: uid(), name, owner: owner||'', role: role||'', phone: phone||null, address: address||null, city: city||null, website: website||null, pos: pos||null, stage: stage||'prospect', notes: notes||'', added: today() };
  res.json(await insert('leads', row));
});

app.put('/api/leads/:id', async (req, res) => {
  const { name, owner, role, phone, address, city, website, pos, stage, notes } = req.body;
  const updated = await update('leads', req.params.id, { name, owner: owner||'', role: role||'', phone: phone||null, address: address||null, city: city||null, website: website||null, pos: pos||null, stage, notes: notes||'' });
  res.json(updated);
});

app.delete('/api/leads/:id', async (req, res) => {
  await remove('leads', req.params.id);
  res.json({ ok: true });
});

// ── CUSTOMERS ──────────────────────────────────────────────────────────────
app.get('/api/customers', async (req, res) => {
  const rows = await getAll('customers');
  res.json(rows.sort((a, b) => (b.since || '').localeCompare(a.since || '')));
});

app.post('/api/customers', async (req, res) => {
  const { name, owner, phone, city, status, monthlyCalls, squareId, notes } = req.body;
  const row = { id: uid(), name, owner: owner||'', phone: phone||null, city: city||null, status: status||'pilot', monthlyCalls: monthlyCalls||null, squareId: squareId||null, notes: notes||'', since: today() };
  res.json(await insert('customers', row));
});

app.delete('/api/customers/:id', async (req, res) => {
  await remove('customers', req.params.id);
  res.json({ ok: true });
});

// ── CALLS ──────────────────────────────────────────────────────────────────
app.get('/api/calls', async (req, res) => {
  const rows = await getAll('calls');
  res.json(rows.sort((a, b) => (b.date || '').localeCompare(a.date || '')));
});

app.post('/api/calls', async (req, res) => {
  const { restaurant, contact, date, direction, duration, outcome } = req.body;
  const row = { id: uid(), restaurant, contact: contact||'', date: date||null, direction: direction||'outbound', duration: duration||null, outcome: outcome||'' };
  res.json(await insert('calls', row));
});

app.delete('/api/calls/:id', async (req, res) => {
  await remove('calls', req.params.id);
  res.json({ ok: true });
});

// ── TODOS ──────────────────────────────────────────────────────────────────
app.get('/api/todos', async (req, res) => {
  const rows = await getAll('todos');
  res.json(rows.sort((a, b) => (a.added || '').localeCompare(b.added || '')));
});

app.post('/api/todos', async (req, res) => {
  const { text, dueDate } = req.body;
  const row = { id: uid(), text, done: false, dueDate: dueDate || null, added: today() };
  res.json(await insert('todos', row));
});

app.put('/api/todos/:id', async (req, res) => {
  const { text, done, dueDate } = req.body;
  res.json(await update('todos', req.params.id, { text, done, dueDate: dueDate || null }));
});

app.delete('/api/todos/:id', async (req, res) => {
  await remove('todos', req.params.id);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Neo O1 CRM running at http://localhost:${PORT}`));
