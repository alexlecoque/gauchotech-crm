// Last-resort page reader: load a URL in headless Chrome and return what a visitor would see.
// Used when a site refuses plain fetches (bot checks) or only renders with JavaScript.
// Needs Google Chrome on this machine and Node 22+; without either, renderPage() returns null.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9377;
// Headless Chrome announces itself in its user agent, which bot checks refuse; send the normal one
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const RENDER_GAP_MS = 1500;

const sleep = ms => new Promise(r => setTimeout(r, ms));

let chrome = null;          // child process, started on first use
let unavailable = false;
let queue = Promise.resolve();   // one page at a time

async function start() {
  if (chrome || unavailable) return;
  if (!existsSync(CHROME) || typeof WebSocket === 'undefined') { unavailable = true; return; }
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-agent=${USER_AGENT}`, '--disable-blink-features=AutomationControlled',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(os.tmpdir(), 'neo01-scraper-chrome')}`,
    '--window-size=1280,900', 'about:blank',
  ], { stdio: 'ignore' });
  // don't leave Chrome running when the scraper stops or is interrupted
  process.on('exit', closeBrowser);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { closeBrowser(); process.exit(1); });
  for (let i = 0; i < 40; i++) {
    try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); return; } catch { await sleep(250); }
  }
  closeBrowser();
  unavailable = true;
}

async function render(url, waitMs) {
  await start();
  if (unavailable) return null;

  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let id = 0;
  const pending = new Map();
  const requests = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
    if (msg.method === 'Network.requestWillBeSent' && ['XHR', 'Fetch'].includes(msg.params.type)) requests.push(msg.params.request.url);
  };
  const send = (method, params = {}) => new Promise(resolve => {
    pending.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value;

  try {
    await send('Network.enable');
    await send('Page.enable');
    await send('Page.navigate', { url });
    // A bot check shows a short interstitial first; wait until the real page has some text
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(700);
      if (((await evaluate('document.body ? document.body.innerText : ""')) || '').length > 400) { await sleep(600); break; }
    }
    return {
      finalUrl: (await evaluate('location.href')) || url,
      title: (await evaluate('document.title')) || '',
      text: (await evaluate('document.body ? document.body.innerText : ""')) || '',
      html: (await evaluate('document.documentElement.outerHTML.slice(0, 3000000)')) || '',
      requests,
    };
  } finally {
    ws.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
  }
}

// Returns { finalUrl, title, text, html, requests[] }, or null when Chrome is not available
// or the page could not be loaded.
export function renderPage(url, { waitMs = 12000 } = {}) {
  // a tab that stops answering must not hold up every page queued behind it
  const run = queue.then(() => Promise.race([render(url, waitMs), sleep(waitMs + 20000).then(() => null)])).catch(() => null);
  queue = run.then(() => sleep(RENDER_GAP_MS));
  return run;
}

export function closeBrowser() {
  chrome?.kill();
  chrome = null;
}
