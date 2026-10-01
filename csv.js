// Minimal CSV read/write for scraper results (handles quotes, commas and newlines in cells).

const escapeCell = value => {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(columns, rows) {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map(c => escapeCell(row[c])).join(','));
  return lines.join('\n') + '\n';
}

// Returns an array of objects keyed by the header row
export function parseCsv(text) {
  const records = [];
  let record = [], cell = '', quoted = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { record.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      record.push(cell); cell = '';
      records.push(record); record = [];
    } else cell += ch;
  }
  if (cell !== '' || record.length) { record.push(cell); records.push(record); }

  const [header, ...body] = records;
  if (!header) return [];
  return body
    .filter(r => r.some(c => c !== ''))
    .map(r => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}
