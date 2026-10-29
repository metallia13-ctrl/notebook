'use strict';

/* =====================================================================
   StudyHub Notebook v1.0
   Notebook di studio: importazione da testo o PDF, formattazione con AI
   (Gemini o Claude), active recall (cloze, pagina bianca, domande) e
   ripetizione dilazionata SM-2.
   ===================================================================== */

const APP_VERSION = '3.1';
const DB_NAME = 'studyhub-notebook';
const CHUNK_CHARS = 12000;          // caratteri massimi per sezione dal testo incollato
const MAX_PDF_B64 = 24 * 1024 * 1024; // ~18 MB di PDF dopo la codifica base64

const LIBS = {
  pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  pdflib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
};

/* ---------------------------------------------------------------------
   Utilità
   --------------------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayStr() { return localDateStr(new Date()); }
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDateStr(new Date(y, m - 1, d + n));
}
function dayDiff(from, to) {
  const [a1, a2, a3] = from.split('-').map(Number);
  const [b1, b2, b3] = to.split('-').map(Number);
  return Math.round((Date.UTC(b1, b2 - 1, b3) - Date.UTC(a1, a2 - 1, a3)) / 86400000);
}
function fmtDue(dateStr) {
  const d = dayDiff(todayStr(), dateStr);
  if (d < 0) return d === -1 ? 'ieri' : `${-d} giorni fa`;
  if (d === 0) return 'oggi';
  if (d === 1) return 'domani';
  if (d < 7) return `tra ${d} giorni`;
  const [y, m, dd] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}
function fmtInterval(days) {
  if (days < 30) return `${days} g`;
  if (days < 365) { const m = Math.round(days / 30); return m === 1 ? '1 mese' : `${m} mesi`; }
  const y = Math.round(days / 36.5) / 10;
  return y === 1 ? '1 anno' : `${String(y).replace('.', ',')} anni`;
}
function sleepAbortable(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
  });
}
function abortError() { const e = new Error('Interrotto'); e.name = 'AbortError'; return e; }

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Impossibile caricare ${src.split('/').pop()}. Controlla la connessione.`));
    document.head.appendChild(s);
  });
}

/* ---------------------------------------------------------------------
   Database (IndexedDB)
   --------------------------------------------------------------------- */
const DB = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('notebooks')) db.createObjectStore('notebooks', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('sections')) {
          const s = db.createObjectStore('sections', { keyPath: 'id' });
          s.createIndex('notebookId', 'notebookId');
        }
        if (!db.objectStoreNames.contains('cards')) {
          const c = db.createObjectStore('cards', { keyPath: 'id' });
          c.createIndex('notebookId', 'notebookId');
          c.createIndex('sectionId', 'sectionId');
        }
        if (!db.objectStoreNames.contains('deleted')) db.createObjectStore('deleted', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('images')) {
          const im = db.createObjectStore('images', { keyPath: 'id' });
          im.createIndex('notebookId', 'notebookId');
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        // Se un’altra scheda aggiorna il database, questa si ricarica con la versione nuova
        this.db.onversionchange = () => { this.db.close(); location.reload(); };
        resolve();
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database bloccato: chiudi le altre schede dell’app.'));
    });
  },
  run(stores, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, mode);
      let out;
      const r = fn(tx);
      if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Operazione annullata'));
    });
  },
  all(store) { return this.run(store, 'readonly', tx => tx.objectStore(store).getAll()); },
  put(store, obj) { return this.run(store, 'readwrite', tx => tx.objectStore(store).put(obj)); },
  del(store, id) { return this.run(store, 'readwrite', tx => tx.objectStore(store).delete(id)); },
  bulkPut(store, arr) { return this.run(store, 'readwrite', tx => { const st = tx.objectStore(store); arr.forEach(o => st.put(o)); }); },
  removeMany(pairs) {
    const stores = [...new Set(pairs.map(p => p[0]))];
    if (!stores.length) return Promise.resolve();
    return this.run(stores, 'readwrite', tx => { pairs.forEach(([st, id]) => tx.objectStore(st).delete(id)); });
  }
};

/* ---------------------------------------------------------------------
   Impostazioni (localStorage, solo su questo dispositivo)
   --------------------------------------------------------------------- */
const Settings = {
  KEY: 'nb-settings',
  defaults: {
    provider: 'gemini',
    geminiKey: '',
    geminiModel: 'gemini-flash-latest',
    claudeKey: '',
    claudeModel: 'claude-sonnet-5-5',
    pagesPerSection: 5,
    theme: 'dark',
    aiFormat: true,
    aiCloze: true,
    aiQuestions: true,
    syncUrl: '',
    syncSecret: '',
    newPerDay: 20,
    askNote: true,
    readFont: 'literata',
    readSize: 'm',
    readSpacing: 'normal',
    boardOpen: false
  },
  data: null,
  load() {
    try { this.data = { ...this.defaults, ...JSON.parse(localStorage.getItem(this.KEY) || '{}') }; }
    catch { this.data = { ...this.defaults }; }
  },
  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); }
    catch { toast('Impossibile salvare le impostazioni su questo dispositivo', 'err'); }
  }
};
const S = () => Settings.data;

/* ---------------------------------------------------------------------
   Stato e dati
   --------------------------------------------------------------------- */
const state = { notebooks: [], sections: [], cards: [], images: [], fromReview: false, cardReturn: '' };
const drafts = {};              // richiami "pagina bianca" non ancora valutati
let orderSeq = 0;
let importJob = null;
const importDraft = { nbId: '', src: 'text', text: '', title: '', pdf: null };
let cleanups = [];

const nbById = id => state.notebooks.find(n => n.id === id);
const secById = id => state.sections.find(s => s.id === id);
const secsOf = nbId => state.sections.filter(s => s.notebookId === nbId).sort((a, b) => a.order - b.order);
const isDue = s => !s.studyhub && !!(s.srs && s.srs.due && s.srs.due <= todayStr());
const sortDue = (a, b) => a.srs.due.localeCompare(b.srs.due) || a.order - b.order;

function newSrs() { return { ef: 2.5, interval: 0, reps: 0, due: null, history: [] }; }

function newSection(nbId, { title, md, questions, source } = {}) {
  const now = Date.now();
  return {
    id: uid(),
    notebookId: nbId,
    title: (title || '').trim() || 'Senza titolo',
    md: md || '',
    questions: questions || [],
    source: source || '',
    order: now * 1000 + (orderSeq++ % 1000),
    created: now,
    updated: now,
    srs: newSrs(),
    needsFormat: false
  };
}

async function saveSection(sec) {
  sec.updated = Date.now();
  await DB.put('sections', sec);
  const i = state.sections.findIndex(s => s.id === sec.id);
  if (i < 0) state.sections.push(sec); else state.sections[i] = sec;
  updateBadge();
  scheduleSync();
}
async function saveNotebook(nb) {
  nb.updated = Date.now();
  await DB.put('notebooks', nb);
  const i = state.notebooks.findIndex(n => n.id === nb.id);
  if (i < 0) state.notebooks.push(nb); else state.notebooks[i] = nb;
  scheduleSync();
}
async function deleteSection(id) {
  const sec = secById(id);
  if (!sec) return;
  const cards = cardsOfSection(id);
  const refs = [...imageRefs(sec.md), ...cards.flatMap(cardImageRefs)];
  await removeRecords([{ store: 'sections', rec: sec }, ...cards.map(c => ({ store: 'cards', rec: c }))]);
  delete drafts[id];
  await removeOrphanImages(refs);
}

/* ---------------------------------------------------------------------
   Ripetizione dilazionata (SM-2, quattro pulsanti come StudyHub)
   --------------------------------------------------------------------- */
const GRADES = [
  { key: 'again', label: 'Di nuovo', q: 1 },
  { key: 'hard', label: 'Difficile', q: 3 },
  { key: 'good', label: 'Bene', q: 4 },
  { key: 'easy', label: 'Facile', q: 5 }
];

function nextSrs(srs, q, mode = '') {
  const cur = srs || newSrs();
  const s = { ...cur, history: [...(cur.history || [])] };
  let interval;
  if (q < 3) {
    s.reps = 0;
    interval = 1;
  } else {
    if (s.reps === 0) interval = q === 5 ? 3 : 1;
    else if (s.reps === 1) interval = q === 3 ? 3 : q === 5 ? 8 : 6;
    else {
      const base = Math.max(1, s.interval || 1);
      interval = q === 3 ? base * 1.2 : q === 5 ? base * s.ef * 1.3 : base * s.ef;
    }
    s.reps += 1;
  }
  s.ef = Math.max(1.3, +(s.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))).toFixed(3));
  s.interval = Math.max(1, Math.round(interval));
  s.due = addDays(todayStr(), s.interval);
  s.history.push({ date: todayStr(), q, mode });
  if (s.history.length > 200) s.history = s.history.slice(-200);
  return s;
}

/* ---------------------------------------------------------------------
   Testo, Markdown e cloze
   --------------------------------------------------------------------- */
const clozeRe = () => /==(?![=\s])([^\n]*?[^\s=])==/g;
const countCloze = md => ((md || '').match(clozeRe()) || []).length;
const stripCloze = md => (md || '').replace(clozeRe(), '$1');

function renderMd(md) {
  const src = (md || '')
    .replace(IMG_MD_RE, (m, alt, id) => `<img class="nb-img" data-img="${id}" alt="${esc(alt)}">`);
  const src2 = renderMarks(src).replace(clozeRe(), (m, t) => `<mark class="cz">${t}</mark>`);
  let html;
  const mk = window.marked;
  if (mk && (mk.parse || typeof mk === 'function')) {
    html = mk.parse ? mk.parse(src2, { gfm: true, breaks: false }) : mk(src2);
  } else {
    html = src2.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
      .replace(/&lt;mark class=&quot;(cz|hl hl-[ygbpo])&quot;&gt;/g, '<mark class="$1">').replace(/&lt;\/mark&gt;/g, '</mark>')
      .replace(/&lt;u class=&quot;ul&quot;&gt;/g, '<u class="ul">').replace(/&lt;\/u&gt;/g, '</u>')
      .replace(/&lt;img class=&quot;nb-img&quot; data-img=&quot;([a-z0-9]+)&quot;[^&]*?(?:&quot;[^&]*?)*&gt;/g, '<img class="nb-img" data-img="$1" alt="">');
  }
  if (window.DOMPurify) html = window.DOMPurify.sanitize(html);
  return html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
}

function splitText(text, max = CHUNK_CHARS) {
  const paras = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  const out = [];
  let cur = '';
  for (const p of paras) {
    if (!p.trim()) continue;
    if (p.length > max) {
      if (cur) { out.push(cur); cur = ''; }
      for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max));
      continue;
    }
    if (cur && cur.length + p.length + 2 > max) { out.push(cur); cur = ''; }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const BULLET_RE = /^[•▪◦●■□➢➤►\-–*]\s+/;
const isListLine = l => /^(- |\d+\. )/.test(l);

// Formattazione di base senza AI: elenchi, righe spezzate dal PDF, titoli in maiuscolo.
function basicFormat(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const push = (line, list) => {
    const prev = out[out.length - 1];
    if (prev !== undefined && prev !== '' && !(list && isListLine(prev))) out.push('');
    out.push(line);
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    if (BULLET_RE.test(l)) { push('- ' + l.replace(BULLET_RE, ''), true); continue; }
    if (/^\d{1,2}[.)]\s+/.test(l)) { push(l.replace(/^(\d{1,2})[.)]\s+/, '$1. '), true); continue; }
    if (l.length < 80 && l === l.toUpperCase() && /[A-ZÀ-Ý]{3}/.test(l)) { push('### ' + l, false); continue; }
    const prev = out[out.length - 1];
    if (prev && !prev.startsWith('#') && !/[.:;!?]$/.test(prev) && /^[a-zà-ÿ(,]/.test(l)) {
      out[out.length - 1] = prev.endsWith('-') ? prev.slice(0, -1) + l : `${prev} ${l}`;
      continue;
    }
    push(l, false);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function firstLineTitle(text) {
  const line = (text || '').split('\n').map(l => l.trim()).find(Boolean) || 'Senza titolo';
  const clean = line.replace(/^#+\s*/, '').replace(BULLET_RE, '');
  return clean.length > 70 ? clean.slice(0, 67).trimEnd() + '…' : clean;
}

function parseQuestions(txt) {
  const out = [];
  let cur = null;
  for (const line of (txt || '').split('\n')) {
    const l = line.trim();
    let m;
    if ((m = l.match(/^(?:\d+[.)]\s*)?(?:\*\*)?D(?:omanda)?\s*[:.](?:\*\*)?\s*(.*)$/i))) {
      if (cur && cur.q) out.push(cur);
      cur = { q: m[1].trim(), a: '' };
    } else if (cur && (m = l.match(/^(?:\*\*)?R(?:isposta)?\s*[:.](?:\*\*)?\s*(.*)$/i))) {
      cur.a = cur.a ? `${cur.a}\n${m[1].trim()}` : m[1].trim();
    } else if (cur && l) {
      if (cur.a) cur.a += '\n' + l; else cur.q += ' ' + l;
    }
  }
  if (cur && cur.q) out.push(cur);
  return out.filter(x => x.q);
}
const aiText = md => stripMarks(stripCloze(md || '')).replace(IMG_MD_RE, (m, alt) => `[immagine${alt ? `: ${alt}` : ''}]`);
const serializeQs = qs => (qs || []).map(x => `D: ${x.q}\nR: ${x.a}`).join('\n\n');

function parseAiNotes(raw) {
  let text = (raw || '').trim()
    .replace(/^```(?:markdown|md)?[ \t]*\n/i, '')
    .replace(/\n```\s*$/, '');
  let title = '';
  const tm = text.match(/^\s*\**TITOLO\**\s*:\s*(.+)$/im);
  if (tm) title = tm[1].replace(/\*+/g, '').trim();
  let notes = text;
  const ai = text.indexOf('===APPUNTI===');
  if (ai >= 0) notes = text.slice(ai + 13);
  else if (tm) notes = text.replace(tm[0], '');
  let qs = '';
  const di = notes.indexOf('===DOMANDE===');
  if (di >= 0) { qs = notes.slice(di + 13); notes = notes.slice(0, di); }
  return { title, md: notes.trim(), questions: parseQuestions(qs) };
}

/* ---------------------------------------------------------------------
   AI: Gemini e Claude (chiamate dirette dal browser con la tua chiave)
   --------------------------------------------------------------------- */
function apiError(msg, status) {
  const e = new Error(msg);
  e.status = status;
  e.retryable = [429, 500, 502, 503, 504, 529].includes(status);
  return e;
}

const AI = {
  ready(p = S().provider) { return p === 'claude' ? !!S().claudeKey.trim() : !!S().geminiKey.trim(); },
  name(p = S().provider) { return p === 'claude' ? 'Claude' : 'Gemini'; },
  async generate(opts) {
    const p = opts.provider || S().provider;
    const waits = [15000, 40000];
    for (let i = 0; ; i++) {
      try {
        return p === 'claude' ? await callClaude(opts) : await callGemini(opts);
      } catch (e) {
        if (e.retryable && i < waits.length && !opts.signal?.aborted) {
          opts.onWait && opts.onWait(waits[i]);
          await sleepAbortable(waits[i], opts.signal);
          continue;
        }
        throw e;
      }
    }
  }
};

async function callGemini({ system, text, pdfBase64, maxTokens = 32768, signal }) {
  const key = S().geminiKey.trim();
  const model = (S().geminiModel || '').trim().replace(/^models\//, '') || Settings.defaults.geminiModel;
  const parts = [];
  if (pdfBase64) parts.push({ inline_data: { mime_type: 'application/pdf', data: pdfBase64 } });
  parts.push({ text });
  const body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: maxTokens } };
  if (system) body.system_instruction = { parts: [{ text: system }] };
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw apiError('Connessione a Gemini non riuscita. Controlla internet.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = data.error?.message || res.statusText;
    let msg = `Gemini: ${m}`;
    if (res.status === 400 && /api key/i.test(m)) msg = 'La chiave Gemini non è valida. Controllala in Impostazioni.';
    else if (res.status === 403) msg = 'La chiave Gemini non ha accesso a questo modello.';
    else if (res.status === 404) msg = `Il modello “${model}” non esiste più. Scegline un altro con “Carica modelli” in Impostazioni.`;
    else if (res.status === 429) msg = 'Limite di richieste Gemini raggiunto. Riprova tra qualche minuto.';
    throw apiError(msg, res.status);
  }
  const cand = data.candidates?.[0];
  if (!cand) {
    const br = data.promptFeedback?.blockReason;
    throw apiError(br ? `Gemini ha bloccato la richiesta (${br}).` : 'Gemini non ha restituito una risposta.', 0);
  }
  const out = (cand.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
  if (!out.trim()) {
    const fr = cand.finishReason;
    throw apiError(fr === 'MAX_TOKENS'
      ? 'Risposta troppo lunga: riduci le pagine per sezione.'
      : `Gemini non ha restituito testo${fr ? ` (${fr})` : ''}.`, 0);
  }
  return { text: out, truncated: cand.finishReason === 'MAX_TOKENS' };
}

async function callClaude({ system, text, pdfBase64, maxTokens = 16000, signal }) {
  const key = S().claudeKey.trim();
  const model = (S().claudeModel || '').trim() || Settings.defaults.claudeModel;
  const content = [];
  if (pdfBase64) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } });
  content.push({ type: 'text', text });
  const body = { model, max_tokens: Math.min(maxTokens, 16000), messages: [{ role: 'user', content }] };
  if (system) body.system = system;
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body),
      signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw apiError('Connessione a Claude non riuscita. Controlla internet.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = data.error?.message || res.statusText;
    let msg = `Claude: ${m}`;
    if (res.status === 401) msg = 'La chiave Claude non è valida. Controllala in Impostazioni.';
    else if (res.status === 404) msg = `Il modello “${model}” non esiste. Scegline un altro con “Carica modelli” in Impostazioni.`;
    else if (res.status === 429) msg = 'Limite di richieste Claude raggiunto. Riprova tra qualche minuto.';
    else if (res.status === 529) msg = 'Claude è sovraccarico in questo momento.';
    throw apiError(msg, res.status);
  }
  const out = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  if (!out.trim()) throw apiError('Claude non ha restituito testo.', 0);
  return { text: out, truncated: data.stop_reason === 'max_tokens' };
}

async function listModels(provider) {
  if (provider === 'claude') {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': S().claudeKey.trim(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || 'Impossibile leggere i modelli Claude');
    return (data.data || []).map(m => ({ id: m.id, label: m.display_name || m.id }));
  }
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
    headers: { 'x-goog-api-key': S().geminiKey.trim() }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || 'Impossibile leggere i modelli Gemini');
  return (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name))
    .map(m => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }));
}

/* Istruzioni per l’AI */
function formatSystem({ cloze, questions }) {
  return [
    'Sei un assistente che prepara materiale di studio per studenti di medicina.',
    'Ricevi un estratto (testo o pagine di PDF) e lo trasformi in appunti di studio in Markdown.',
    '',
    'Regole:',
    '- Mantieni TUTTE le informazioni: non riassumere, non omettere valori numerici, dosi, percentuali, criteri, classificazioni ed eccezioni.',
    '- Non aggiungere informazioni che non sono nel testo.',
    '- Usa titoli (##, ###), elenchi puntati annidati e tabelle Markdown.',
    '- Usa una tabella ogni volta che ci sono confronti o voci con le stesse caratteristiche (es. farmaci con meccanismo, indicazioni ed effetti avversi; diagnosi differenziale; classificazioni; stadiazioni).',
    '- Scrivi nella stessa lingua del testo originale.',
    '- Ignora numeri di pagina, intestazioni e piè di pagina ripetuti, didascalie senza contenuto.',
    '- Se ci sono figure o schemi con informazioni utili, descrivine il contenuto in un elenco.',
    '- Copia senza modifiche, nella stessa posizione, ogni riferimento a immagine nel formato ![testo](img:codice).',
    '- Mantieni le evidenziature e sottolineature nel formato {{lettera|testo}}, es. {{y|frase importante}}.',
    cloze
      ? '- Racchiudi tra == e == i termini chiave da memorizzare (definizioni, nomi, valori, criteri), es. ==insulina==. Al massimo uno o due per frase o per cella, mai un’intera frase.'
      : '- Non usare la sintassi ==...==.',
    '',
    'Formato della risposta, senza nessun altro testo prima o dopo:',
    'TITOLO: <titolo breve della sezione>',
    '===APPUNTI===',
    '<appunti in Markdown>',
    ...(questions ? [
      '===DOMANDE===',
      'D: <domanda>',
      'R: <risposta sintetica>',
      '(da 5 a 12 domande che coprono i concetti più importanti, utili per il richiamo attivo)'
    ] : [])
  ].join('\n');
}

const QUESTIONS_SYSTEM = [
  'Sei un tutor per studenti di medicina.',
  'Dagli appunti ricevuti genera da 5 a 12 domande per il richiamo attivo, che coprano i concetti più importanti.',
  'Preferisci domande che chiedono di spiegare, confrontare o elencare, non solo definizioni.',
  'Scrivi nella lingua degli appunti. Formato, senza altro testo:',
  'D: <domanda>',
  'R: <risposta sintetica>'
].join('\n');

const EVAL_SYSTEM = [
  'Sei un tutor per studenti di medicina. Confronta il richiamo libero dello studente con gli appunti originali.',
  'Rispondi in italiano, in Markdown, in modo conciso, con questa struttura:',
  '**Punteggio: X/100** (quanto dei contenuti importanti è stato ricordato correttamente)',
  '### Ricordato bene',
  '### Mancante (in ordine di importanza)',
  '### Errori (solo se ci sono affermazioni sbagliate)'
].join('\n');

async function aiFormatNotes({ text, pdfBase64, cloze, questions, signal, onWait }) {
  const user = pdfBase64
    ? 'Trasforma queste pagine del PDF in appunti di studio seguendo le regole.'
    : `Testo da trasformare in appunti:\n\n${text}`;
  const r = await AI.generate({ system: formatSystem({ cloze, questions }), text: user, pdfBase64, signal, onWait });
  const parsed = parseAiNotes(r.text);
  if (!parsed.md) throw new Error('L’AI non ha restituito appunti utilizzabili.');
  return { ...parsed, truncated: r.truncated };
}

/* ---------------------------------------------------------------------
   PDF
   --------------------------------------------------------------------- */
async function ensurePdfJs() {
  if (!window.pdfjsLib) {
    await loadScript(LIBS.pdfjs);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfjsWorker;
  }
}
async function ensurePdfLib() { if (!window.PDFLib) await loadScript(LIBS.pdflib); }

async function pageText(doc, n) {
  const page = await doc.getPage(n);
  const tc = await page.getTextContent();
  let s = '';
  for (const it of tc.items) {
    if (!('str' in it)) continue;
    s += it.str;
    if (it.hasEOL) s += '\n';
    else if (it.str && !it.str.endsWith(' ')) s += ' ';
  }
  return s.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ');
}
async function extractRange(doc, from, to) {
  const out = [];
  for (let p = from; p <= to; p++) out.push(await pageText(doc, p));
  return out.join('\n\n');
}
async function subsetPdfBase64(job, from, to) {
  await ensurePdfLib();
  if (!job.pdfLibDoc) job.pdfLibDoc = await window.PDFLib.PDFDocument.load(job.pdf.bytes, { ignoreEncryption: true });
  const out = await window.PDFLib.PDFDocument.create();
  const idx = [];
  for (let p = from; p <= to; p++) idx.push(p - 1);
  const pages = await out.copyPages(job.pdfLibDoc, idx);
  pages.forEach(pg => out.addPage(pg));
  const b64 = await out.saveAsBase64();
  if (b64.length > MAX_PDF_B64) throw new Error('Queste pagine pesano troppo per l’AI: riduci le pagine per sezione.');
  return b64;
}

async function openPdf(file) {
  await ensurePdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    // pdf.js trasferisce il buffer al worker: gli passo una copia per non svuotare `bytes`
    doc = await window.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new Error('Il PDF è protetto da password.');
    throw new Error('Non riesco ad aprire questo PDF.');
  }
  const sample = Math.min(3, doc.numPages);
  let chars = 0;
  for (let p = 1; p <= sample; p++) chars += (await pageText(doc, p)).replace(/\s/g, '').length;
  return {
    name: file.name,
    base: file.name.replace(/\.pdf$/i, ''),
    bytes,
    doc,
    pages: doc.numPages,
    scanned: chars / sample < 60
  };
}

/* ---------------------------------------------------------------------
   Interfaccia: componenti comuni
   --------------------------------------------------------------------- */
function setView(html) { $('#view').innerHTML = html; }
function on(sel, ev, fn, root = $('#view')) { $$(sel, root).forEach(el => el.addEventListener(ev, fn)); }
function addCleanup(fn) { cleanups.push(fn); }
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

function toast(msg, kind = '', action = null) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  if (action) {
    // un solo “Annulla” alla volta: vale per l’ultima modifica
    $$('#toasts .toast.has-act').forEach(t => t.remove());
    el.classList.add('has-act');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-act';
    b.textContent = action.label;
    b.addEventListener('click', () => { el.remove(); action.fn(); });
    el.appendChild(b);
  }
  const box = $('#toasts');
  while (box.children.length >= 2) box.firstElementChild.remove();
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, action ? 6000 : 3400);
}

function modal({ title, text = '', input = false, value = '', placeholder = '', confirm = 'Conferma', cancel = 'Annulla', danger = false }) {
  return new Promise(resolve => {
    const root = $('#modalRoot');
    const prevFocus = document.activeElement;
    root.innerHTML = `
      <div class="overlay">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">
          <h2 id="mTitle">${esc(title)}</h2>
          ${text ? `<p>${esc(text)}</p>` : ''}
          ${input ? `<input class="input" id="mInput" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">` : ''}
          <div class="modal-actions">
            <button class="btn ghost" data-m="no">${esc(cancel)}</button>
            <button class="btn ${danger ? 'danger-solid' : 'primary'}" data-m="yes">${esc(confirm)}</button>
          </div>
        </div>
      </div>`;
    const close = v => {
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(v);
    };
    const ok = () => {
      if (input) {
        const v = $('#mInput').value.trim();
        if (!v) { $('#mInput').focus(); return; }
        close(v);
      } else close(true);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ok(); }
    };
    $('[data-m="yes"]', root).onclick = ok;
    $('[data-m="no"]', root).onclick = () => close(null);
    $('.overlay', root).addEventListener('click', e => { if (e.target.classList.contains('overlay')) close(null); });
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => (input ? $('#mInput') : $('[data-m="yes"]', root))?.focus(), 30);
  });
}

function updateBadge() {
  const b = $('#dueBadge');
  if (b) {
    const n = state.sections.filter(isDue).length;
    b.textContent = n;
    b.hidden = n === 0;
  }
  const cc = cardCounts(state.cards);
  const cb = $('#cardBadge');
  if (cb) {
    const n = cc.l + cc.r;
    cb.textContent = n;
    cb.hidden = n === 0;
  }
  // Numero sull’icona dell’app installata, dove il sistema lo supporta
  if (navigator.setAppBadge) {
    const total = state.sections.filter(isDue).length + cc.l + cc.r;
    (total ? navigator.setAppBadge(total) : navigator.clearAppBadge()).catch(() => {});
  }
}

function applyTheme() {
  const t = S().theme;
  const theme = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : (['light', 'sepia'].includes(t) ? t : 'dark');
  const html = document.documentElement;
  html.dataset.theme = theme;
  html.style.setProperty('--read-font', READ_FONTS[S().readFont] || READ_FONTS.literata);
  html.style.setProperty('--read-size', READ_SIZES[S().readSize] || READ_SIZES.m);
  html.style.setProperty('--read-lh', READ_LH[S().readSpacing] || READ_LH.normal);
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = { dark: '#0d131d', light: '#f6f8fb', sepia: '#f3ead6' }[theme];
}

function statusPill(s) {
  if (!s.srs || !s.srs.due) return '<span class="pill">Nuova</span>';
  if (isDue(s)) return `<span class="pill due">${s.srs.due < todayStr() ? 'In ritardo' : 'Oggi'}</span>`;
  return `<span class="pill soft">${esc(fmtDue(s.srs.due))}</span>`;
}

function defaultMode(s) {
  if (countCloze(s.md)) return 'cloze';
  if ((s.questions || []).length) return 'quiz';
  return 'blank';
}

function sectionRow(s, { showNb = false, review = false } = {}) {
  const bits = [];
  if (showNb) bits.push(esc(nbById(s.notebookId)?.name || ''));
  const cz = countCloze(s.md);
  const q = (s.questions || []).length;
  if (cz) bits.push(`${cz} cloze`);
  if (q) bits.push(`${q} ${q === 1 ? 'domanda' : 'domande'}`);
  if (s.needsFormat) bits.push('da formattare');
  const href = review ? `#/sec/${s.id}/${defaultMode(s)}` : `#/sec/${s.id}`;
  return `
    <li data-id="${s.id}">
      <a class="row" href="${href}" ${review ? 'data-review="1"' : ''}>
        <span class="row-main">
          <span class="row-title">${esc(s.title)}</span>
          <span class="row-sub">${bits.filter(Boolean).join(', ') || 'Solo lettura'}</span>
        </span>
        ${statusPill(s)}
      </a>
    </li>`;
}

async function createNotebookFlow() {
  const name = await modal({ title: 'Nuovo notebook', input: true, placeholder: 'Es. Farmacologia', confirm: 'Crea' });
  if (!name) return null;
  const nb = { id: uid(), name, created: Date.now() };
  await saveNotebook(nb);
  toast('Notebook creato');
  return nb;
}

/* ---------------------------------------------------------------------
   Router
   --------------------------------------------------------------------- */
function route() {
  cleanups.forEach(fn => { try { fn(); } catch { /* ignora */ } });
  cleanups = [];
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, '')) || 'notebooks';
  const [p0, p1, p2] = h.split('/');
  if (p0 !== 'sec') state.fromReview = false;
  // Un’importazione finita non blocca il modulo quando ci torni
  if (p0 !== 'import' && importJob && !importJob.running) importJob = null;
  const navKey = p0 === 'nb' || p0 === 'sec' ? (state.fromReview ? 'review' : 'notebooks')
    : ['deck', 'card', 'study'].includes(p0) ? 'cards' : p0;
  $$('.nav a').forEach(a => {
    const onIt = a.dataset.nav === navKey;
    a.classList.toggle('on', onIt);
    if (onIt) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  switch (p0) {
    case 'nb': return viewNotebook(p1);
    case 'sec': return viewSection(p1, p2 || 'read');
    case 'import': return viewImport(p1);
    case 'review': return viewReview();
    case 'settings': return viewSettings();
    case 'cards': return viewCardsHome();
    case 'deck': return viewDeck(p1);
    case 'card': return viewCardEditor(p1);
    case 'study': return viewStudy(p1);
    default: return viewNotebooks();
  }
}

function notFound(what = 'Questa pagina') {
  setView(`<div class="empty"><p>${esc(what)} non esiste più.</p><a class="btn primary" href="#/notebooks">Torna ai notebook</a></div>`);
}

/* ---------------------------------------------------------------------
   Vista: elenco notebook
   --------------------------------------------------------------------- */
function viewNotebooks() {
  const nbs = [...state.notebooks].sort((a, b) => a.created - b.created);
  setView(`
    <header class="page-head">
      <h1>I tuoi notebook</h1>
      ${nbs.length ? '<button class="btn primary" data-act="new-nb">Nuovo notebook</button>' : ''}
    </header>
    ${nbs.length ? '<input type="search" class="input search" id="globalSearch" placeholder="Cerca in tutti i notebook e le flashcard" aria-label="Cerca in tutti i notebook e le flashcard"><div id="searchOut" hidden></div>' : ''}
    ${nbs.length ? `
      <ul class="list" id="nbList">
        ${nbs.map(nb => {
          const secs = secsOf(nb.id);
          const due = secs.filter(isDue).length;
          return `
            <li>
              <a class="row" href="#/nb/${nb.id}">
                <span class="row-main">
                  <span class="row-title">${esc(nb.name)}</span>
                  <span class="row-sub">${secs.length} ${secs.length === 1 ? 'sezione' : 'sezioni'}</span>
                </span>
                ${due ? `<span class="pill due">${due} da ripassare</span>` : ''}
              </a>
            </li>`;
        }).join('')}
      </ul>` : `
      <div class="empty">
        <p>Crea un notebook per ogni materia, poi importa appunti, capitoli o PDF.</p>
        <button class="btn primary" data-act="new-nb">Crea il primo notebook</button>
      </div>`}
  `);
  on('[data-act="new-nb"]', 'click', async () => {
    const nb = await createNotebookFlow();
    if (nb) go(`#/nb/${nb.id}`);
  });
  const gs = $('#globalSearch');
  if (gs) {
    let t;
    const run = () => {
      const q = gs.value.trim().toLowerCase();
      sessionStorage.setItem('nb-search', gs.value);
      const out = $('#searchOut');
      const list = $('#nbList');
      if (!out || !list) return;
      if (q.length < 2) { out.hidden = true; list.hidden = false; return; }
      out.innerHTML = searchResultsHtml(q);
      out.hidden = false;
      list.hidden = true;
    };
    gs.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 150); });
    const last = sessionStorage.getItem('nb-search');
    if (last) { gs.value = last; run(); }
  }
}

/* ---------------------------------------------------------------------
   Vista: un notebook
   --------------------------------------------------------------------- */
function viewNotebook(id) {
  const nb = nbById(id);
  if (!nb) return notFound('Questo notebook');
  const secs = secsOf(id);
  const due = secs.filter(isDue).length;
  const nbCards = cardsOf(id);
  setView(`
    <a class="back" href="#/notebooks">Tutti i notebook</a>
    <header class="page-head">
      <div>
        <h1>${esc(nb.name)}</h1>
        <p class="lede">${secs.length} ${secs.length === 1 ? 'sezione' : 'sezioni'}${due ? `, ${due} da ripassare oggi` : ''}${nbCards.length ? `, ${nbCards.length} flashcard` : ''}</p>
      </div>
      <div class="actions">
        <a class="btn primary" href="#/import/${nb.id}">Importa</a>
        ${nbCards.length ? `<a class="btn" href="#/deck/${nb.id}">Flashcard</a>` : ''}
        <button class="btn" data-act="new-sec">Scrivi una sezione</button>
        <button class="btn ghost" data-act="rename">Rinomina</button>
        <button class="btn ghost danger" data-act="delete">Elimina</button>
      </div>
    </header>
    ${secs.length > 3 ? '<input type="search" class="input search" id="secSearch" placeholder="Cerca nel notebook" aria-label="Cerca nel notebook">' : ''}
    ${secs.length ? `<ul class="list" id="secList">${secs.map(s => sectionRow(s)).join('')}</ul>
      <p class="hint" id="noMatch" hidden>Nessuna sezione contiene questo testo.</p>` : `
      <div class="empty">
        <p>Notebook vuoto. Importa testo o un PDF, oppure scrivi una sezione a mano.</p>
        <a class="btn primary" href="#/import/${nb.id}">Importa</a>
      </div>`}
  `);

  on('[data-act="new-sec"]', 'click', async () => {
    const sec = newSection(id, { title: 'Nuova sezione' });
    await saveSection(sec);
    go(`#/sec/${sec.id}/edit`);
  });
  on('[data-act="rename"]', 'click', async () => {
    const name = await modal({ title: 'Rinomina notebook', input: true, value: nb.name, confirm: 'Rinomina' });
    if (!name) return;
    nb.name = name;
    await saveNotebook(nb);
    route();
  });
  on('[data-act="delete"]', 'click', async () => {
    const ok = await modal({
      title: 'Eliminare il notebook?',
      text: `Verranno eliminate anche le sue ${secs.length} sezioni e ${nbCards.length} flashcard. L’operazione non si può annullare.`,
      confirm: 'Elimina', danger: true
    });
    if (!ok) return;
    const refs = [...secs.flatMap(x => imageRefs(x.md)), ...nbCards.flatMap(cardImageRefs), ...state.images.filter(i => i.notebookId === id).map(i => i.id)];
    await removeRecords([
      { store: 'notebooks', rec: nb },
      ...secs.map(s => ({ store: 'sections', rec: s })),
      ...nbCards.map(c => ({ store: 'cards', rec: c }))
    ]);
    await removeOrphanImages(refs);
    toast('Notebook eliminato');
    go('#/notebooks');
  });
  const search = $('#secSearch');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      $$('#secList li').forEach(li => {
        const s = secById(li.dataset.id);
        const hit = !q || (s && (s.title + '\n' + s.md).toLowerCase().includes(q));
        li.hidden = !hit;
        if (hit) shown++;
      });
      $('#noMatch').hidden = shown > 0;
    });
  }
}

/* ---------------------------------------------------------------------
   Vista: sezione con le modalità di studio
   --------------------------------------------------------------------- */
const MODES = [['read', 'Leggi'], ['cloze', 'Cloze'], ['blank', 'Pagina bianca'], ['quiz', 'Domande'], ['cards', 'Flashcard'], ['edit', 'Modifica']];

function srsLabel(s) {
  if (s.studyhub) return s.studyhub.status === 'received' ? 'Studiata, ripassi pianificati da StudyHub' : 'Studiata, in attesa di StudyHub';
  if (!s.srs || !s.srs.due) return 'Nuova, non ancora pianificata';
  const reps = s.srs.history?.length || 0;
  const tail = reps ? `, ripassata ${reps} ${reps === 1 ? 'volta' : 'volte'}` : '';
  if (s.srs.due < todayStr()) return `Ripasso in ritardo, previsto ${fmtDue(s.srs.due)}${tail}`;
  if (s.srs.due === todayStr()) return `Da ripassare oggi${tail}`;
  return `Prossimo ripasso ${fmtDue(s.srs.due)}${tail}`;
}

function viewSection(id, mode) {
  const sec = secById(id);
  if (!sec) return notFound('Questa sezione');
  if (!MODES.some(([m]) => m === mode)) mode = 'read';
  const nb = nbById(sec.notebookId);
  const back = state.fromReview
    ? '<a class="back" href="#/review">Ripasso</a>'
    : `<a class="back" href="#/nb/${sec.notebookId}">${esc(nb ? nb.name : 'Notebook')}</a>`;
  setView(`
    ${back}
    <header class="sec-head">
      <h1>${esc(sec.title)}</h1>
      <p class="meta">${esc(srsLabel(sec))}</p>
    </header>
    <nav class="tabs" aria-label="Modalità di studio">
      ${MODES.map(([m, l]) => `<a href="#/sec/${id}/${m}" class="tab ${m === mode ? 'on' : ''}" ${m === mode ? 'aria-current="page"' : ''}>${l}</a>`).join('')}
    </nav>
    <section id="modeBody" class="mode-body"></section>
  `);
  // Cambiare scheda non riempie la cronologia: il tasto Indietro torna al notebook.
  on('.tabs a', 'click', e => { e.preventDefault(); location.replace(e.currentTarget.getAttribute('href')); });
  const body = $('#modeBody');
  ({ read: modeRead, cloze: modeCloze, blank: modeBlank, quiz: modeQuiz, cards: modeCards, edit: modeEdit }[mode])(sec, body);
}

function gradeBar(sec, slot, { mode, suggested } = {}) {
  slot.innerHTML = `
    <div class="grade">
      <p class="grade-q">${suggested ? 'Valutazione suggerita evidenziata. Quanto ricordavi?' : 'Quanto ricordavi?'}</p>
      <div class="grade-btns">
        ${GRADES.map((g, i) => {
          const nx = nextSrs(sec.srs, g.q, mode);
          return `<button class="gbtn g-${g.key} ${suggested === g.key ? 'suggested' : ''}" data-q="${g.q}" aria-keyshortcuts="${i + 1}">
            <span>${g.label}</span><small>${fmtInterval(nx.interval)}</small></button>`;
        }).join('')}
      </div>
    </div>`;
  let graded = false;
  const grade = async q => {
    if (graded) return;
    graded = true;
    $$('.gbtn', slot).forEach(b => { b.disabled = true; });
    sec.srs = nextSrs(sec.srs, q, mode);
    await saveSection(sec);
    delete drafts[sec.id];
    if (sec.studyhub) {
      const g = GRADES.find(x => x.q === q);
      Bridge.send({
        type: 'topic-review', sectionId: sec.id, notebookId: sec.notebookId,
        subject: nbById(sec.notebookId)?.name || '', topic: sec.title,
        grade: g ? g.key : '', q, mode, reviewedOn: todayStr(), url: deepLink(sec)
      });
      toast('Valutazione inviata a StudyHub');
    } else {
      toast(`Prossimo ripasso ${fmtDue(sec.srs.due)}`);
    }
    afterGrade(sec);
  };
  $$('.gbtn', slot).forEach(b => b.addEventListener('click', () => grade(+b.dataset.q)));
  const onKey = e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || $('#modalRoot').children.length) return;
    const i = ['1', '2', '3', '4'].indexOf(e.key);
    if (i >= 0 && slot.isConnected) { e.preventDefault(); grade(GRADES[i].q); }
  };
  if (slot._onKey) document.removeEventListener('keydown', slot._onKey);
  slot._onKey = onKey;
  document.addEventListener('keydown', onKey);
  addCleanup(() => document.removeEventListener('keydown', onKey));
  slot.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
}

function afterGrade(sec) {
  if (state.fromReview) {
    const next = state.sections.filter(isDue).sort(sortDue)[0];
    go(next ? `#/sec/${next.id}/${defaultMode(next)}` : '#/review');
  } else {
    go(`#/sec/${sec.id}/read`);
  }
}

/* Leggi */
function modeRead(sec, body) {
  body.innerHTML = `
    ${sec.needsFormat && AI.ready() ? `
      <div class="callout">
        <p>Questa sezione è stata salvata senza formattazione AI.</p>
        <button class="btn" data-act="fmt">Formatta con ${AI.name()}</button>
      </div>` : ''}
    ${sec.md.trim() ? `<article class="notes">${renderMd(sec.md)}</article>` : `
      <div class="empty"><p>Sezione vuota.</p><a class="btn primary" href="#/sec/${sec.id}/edit">Scrivi in Modifica</a></div>`}
    ${sec.md.trim() ? '<p class="hint sel-hint">Seleziona del testo per evidenziarlo, sottolinearlo, farne un cloze o una flashcard. Sul PC puoi anche usare il tasto destro.</p>' : ''}
    ${sec.studyhub ? `
      <div class="callout end">
        <p>${esc(studyhubStatusText(sec))}</p>
        <button class="btn ghost sm" data-act="unlink">Riporta i ripassi nel Notebook</button>
      </div>` : !sec.srs?.due && sec.md.trim() ? `
      <div class="callout end">
        <p>Quando hai finito di studiarla, segnala a StudyHub che pianificherà i ripassi, oppure ripassala qui.</p>
        <div class="inline">
          <button class="btn primary" data-act="studied">Segna come studiata in StudyHub</button>
          <button class="btn ghost" data-act="plan">Ripassa nel Notebook</button>
        </div>
      </div>` : ''}
    ${sec.source ? `<p class="source">Fonte: ${esc(sec.source)}</p>` : ''}
  `;
  const notesEl = $('.notes', body);
  if (notesEl) setupReadingTools(notesEl, sec);
  on('[data-act="studied"]', 'click', async () => { await markStudiedInStudyHub(sec); route(); }, body);
  on('[data-act="unlink"]', 'click', async () => {
    const ok = await modal({ title: 'Riportare i ripassi nel Notebook?', text: 'StudyHub riceverà la richiesta di togliere l’argomento e il Notebook lo pianificherà per domani.', confirm: 'Riporta' });
    if (!ok) return;
    await unlinkFromStudyHub(sec);
    route();
  }, body);
  on('[data-act="plan"]', 'click', async () => {
    sec.srs = { ...(sec.srs || newSrs()), due: addDays(todayStr(), 1), interval: 1 };
    await saveSection(sec);
    toast('Primo ripasso nel Notebook domani');
    route();
  }, body);
  on('[data-act="fmt"]', 'click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Formattazione in corso…';
    try {
      const r = await aiFormatNotes({ text: sec.md, cloze: S().aiCloze, questions: S().aiQuestions && !(sec.questions || []).length });
      sec.md = r.md;
      if (r.questions.length && !(sec.questions || []).length) sec.questions = r.questions;
      if ((sec.title === 'Senza titolo' || !sec.title) && r.title) sec.title = r.title;
      sec.needsFormat = false;
      await saveSection(sec);
      toast('Sezione formattata');
      route();
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
      btn.textContent = `Formatta con ${AI.name()}`;
    }
  }, body);
}

/* Cloze */
function modeCloze(sec, body) {
  const n = countCloze(sec.md);
  if (!n) {
    body.innerHTML = `
      <div class="empty">
        <p>Nessun termine da nascondere. In Modifica selezioni una parola e tocchi “Cloze”.</p>
        <a class="btn primary" href="#/sec/${sec.id}/edit">Apri Modifica</a>
      </div>`;
    return;
  }
  body.innerHTML = `
    <div class="toolbar">
      <span id="czCount" aria-live="polite">0 di ${n} rivelati</span>
      <button class="btn sm" data-act="reveal-all">Rivela tutto</button>
      <button class="btn sm ghost" data-act="hide-all">Nascondi di nuovo</button>
    </div>
    <p class="hint">Prova a ricordare ogni termine, poi toccalo per controllare.<span class="kbd-hint"> Con la tastiera: Spazio rivela il successivo, 1-4 per valutare.</span></p>
    <article class="notes cloze-mode">${renderMd(sec.md)}</article>
    <div id="gradeSlot"></div>`;
  const marks = $$('mark.cz', body);
  const slot = $('#gradeSlot', body);
  const hide = m => {
    m.classList.add('hidden');
    m.classList.remove('shown');
    m.tabIndex = 0;
    m.setAttribute('role', 'button');
    m.setAttribute('aria-label', 'Termine nascosto, attiva per mostrarlo');
  };
  const reveal = m => {
    if (!m.classList.contains('hidden')) return;
    m.classList.remove('hidden');
    m.classList.add('shown');
    m.removeAttribute('aria-label');
    m.removeAttribute('role');
    m.tabIndex = -1;
    update();
  };
  const update = () => {
    const r = marks.filter(m => m.classList.contains('shown')).length;
    $('#czCount', body).textContent = `${r} di ${marks.length} rivelati`;
    if (r === marks.length && !slot.innerHTML) gradeBar(sec, slot, { mode: 'cloze' });
  };
  marks.forEach(hide);
  body.addEventListener('click', e => { const m = e.target.closest('mark.cz.hidden'); if (m) reveal(m); });
  on('[data-act="reveal-all"]', 'click', () => marks.forEach(reveal), body);
  on('[data-act="hide-all"]', 'click', () => { marks.forEach(hide); slot.innerHTML = ''; update(); }, body);
  const onKey = e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || $('#modalRoot').children.length) return;
    if (e.key !== ' ' && e.key !== 'Enter') return;
    const focused = document.activeElement?.closest?.('mark.cz.hidden');
    if (e.key === 'Enter' && !focused) return;
    const target = focused || marks.find(m => m.classList.contains('hidden'));
    if (!target) return;
    e.preventDefault();
    reveal(target);
    target.scrollIntoView({ block: 'nearest' });
    const nextHidden = marks.find(m => m.classList.contains('hidden'));
    if (nextHidden && focused) nextHidden.focus({ preventScroll: true });
  };
  document.addEventListener('keydown', onKey);
  addCleanup(() => document.removeEventListener('keydown', onKey));
}

/* Pagina bianca */
function modeBlank(sec, body) {
  const headings = (sec.md.match(/^#{1,4}\s+.+$/gm) || []).map(h => stripCloze(h.replace(/^#+\s+/, '')));
  body.innerHTML = `
    <p class="hint">Scrivi tutto quello che ricordi di questa sezione senza guardare, poi confronta con gli appunti.</p>
    ${headings.length ? `
      <details class="outline">
        <summary>Mostra i titoli come traccia</summary>
        <ul>${headings.map(h => `<li>${esc(h)}</li>`).join('')}</ul>
      </details>` : ''}
    <label class="sr-only" for="recall">Il tuo richiamo</label>
    <textarea id="recall" class="input recall" placeholder="Inizia a scrivere quello che ricordi">${esc(drafts[sec.id] || '')}</textarea>
    <div class="row-actions"><button class="btn primary" data-act="compare">Confronta con gli appunti</button></div>
    <div id="cmp"></div>
    <div id="gradeSlot"></div>`;
  const ta = $('#recall', body);
  ta.addEventListener('input', () => { drafts[sec.id] = ta.value; });
  on('[data-act="compare"]', 'click', () => {
    const val = ta.value.trim();
    if (!val) { toast('Scrivi qualcosa prima di confrontare'); ta.focus(); return; }
    $('#cmp', body).innerHTML = `
      <div class="compare">
        <div class="pane">
          <h2>Il tuo richiamo</h2>
          <div class="mine">${esc(val).replace(/\n/g, '<br>')}</div>
        </div>
        <div class="pane">
          <h2>Appunti</h2>
          <article class="notes">${renderMd(sec.md)}</article>
        </div>
      </div>
      ${AI.ready() ? `<div class="row-actions"><button class="btn" data-act="ai-eval">Fatti valutare da ${AI.name()}</button></div><div id="evalOut"></div>` : ''}`;
    gradeBar(sec, $('#gradeSlot', body), { mode: 'blank' });
    $('#cmp', body).scrollIntoView({ block: 'start', behavior: 'auto' });
    const evalBtn = $('[data-act="ai-eval"]', body);
    if (evalBtn) evalBtn.addEventListener('click', async () => {
      evalBtn.disabled = true;
      evalBtn.textContent = 'Valutazione in corso…';
      try {
        const r = await AI.generate({
          system: EVAL_SYSTEM,
          text: `APPUNTI ORIGINALI:\n${aiText(sec.md)}\n\nRICHIAMO DELLO STUDENTE:\n${val}`,
          maxTokens: 4000
        });
        $('#evalOut', body).innerHTML = `<article class="notes eval">${renderMd(r.text)}</article>`;
        const m = r.text.match(/Punteggio\**\s*:?\s*\**\s*(\d{1,3})/i);
        let suggested;
        if (m) {
          const sc = Math.min(100, +m[1]);
          suggested = sc < 40 ? 'again' : sc < 65 ? 'hard' : sc < 90 ? 'good' : 'easy';
        }
        gradeBar(sec, $('#gradeSlot', body), { mode: 'blank', suggested });
        evalBtn.remove();
      } catch (err) {
        toast(err.message, 'err');
        evalBtn.disabled = false;
        evalBtn.textContent = `Fatti valutare da ${AI.name()}`;
      }
    });
  }, body);
}

/* Domande */
function modeQuiz(sec, body) {
  const qs = sec.questions || [];
  if (!qs.length) {
    body.innerHTML = `
      <div class="empty">
        <p>Nessuna domanda per questa sezione.</p>
        ${AI.ready() ? `<button class="btn primary" data-act="gen">Genera domande con ${AI.name()}</button>` : ''}
        <a class="btn" href="#/sec/${sec.id}/edit">Scrivile in Modifica</a>
      </div>`;
    on('[data-act="gen"]', 'click', async e => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Genero le domande…';
      try {
        const r = await AI.generate({ system: QUESTIONS_SYSTEM, text: aiText(sec.md), maxTokens: 6000 });
        const parsed = parseQuestions(r.text);
        if (!parsed.length) throw new Error('Nessuna domanda riconosciuta nella risposta.');
        sec.questions = parsed;
        await saveSection(sec);
        route();
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
        btn.textContent = `Genera domande con ${AI.name()}`;
      }
    }, body);
    return;
  }
  const order = qs.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  let pos = 0;
  let right = 0;

  const show = () => {
    if (pos >= order.length) return finish();
    const item = qs[order[pos]];
    body.innerHTML = `
      <div class="qcard">
        <p class="qnum">Domanda ${pos + 1} di ${order.length}</p>
        <p class="q">${esc(stripCloze(item.q))}</p>
        <div class="a" hidden><article class="notes">${renderMd(item.a || '_Nessuna risposta salvata._')}</article></div>
        <div class="qactions">
          <button class="btn primary" data-act="show">Mostra la risposta</button>
        </div>
      </div>`;
    $('[data-act="show"]', body).addEventListener('click', () => {
      $('.a', body).hidden = false;
      $('.qactions', body).innerHTML = `
        <button class="btn wrong" data-r="0">Non la sapevo</button>
        <button class="btn right" data-r="1">La sapevo</button>`;
      $$('[data-r]', body).forEach(b => b.addEventListener('click', () => {
        right += +b.dataset.r;
        pos++;
        show();
      }));
      $('[data-r="1"]', body).focus();
    });
    $('[data-act="show"]', body).focus({ preventScroll: true });
  };
  const finish = () => {
    const pct = right / order.length;
    const suggested = pct < 0.5 ? 'again' : pct < 0.7 ? 'hard' : pct < 0.9 ? 'good' : 'easy';
    body.innerHTML = `
      <div class="qcard done">
        <p class="score">${right} su ${order.length}</p>
        <p class="hint">risposte che sapevi</p>
        <button class="btn ghost" data-act="again">Rifai le domande</button>
      </div>
      <div id="gradeSlot"></div>`;
    on('[data-act="again"]', 'click', () => modeQuiz(sec, body), body);
    gradeBar(sec, $('#gradeSlot', body), { mode: 'quiz', suggested });
  };
  show();
}

/* Modifica */
function modeEdit(sec, body) {
  const otherNbs = state.notebooks.filter(n => n.id !== sec.notebookId);
  body.innerHTML = `
    <label class="field"><span>Titolo</span><input class="input" id="edTitle" value="${esc(sec.title)}"></label>
    <div class="edit-tools" role="toolbar" aria-label="Formattazione">
      <button class="btn sm" data-wrap="==" title="Nasconde il testo selezionato nella modalità Cloze">Cloze</button>
      <button class="btn sm" data-wrap="**">Grassetto</button>
      <button class="btn sm" data-mark="u">Sottolinea</button>
      <span class="hl-pick" role="group" aria-label="Evidenzia">${HL_COLORS.map(c => `<button class="rt-dot hl-${c.key}" data-mark="${c.key}" type="button" title="Evidenzia in ${c.name.toLowerCase()}" aria-label="Evidenzia in ${c.name.toLowerCase()}"></button>`).join('')}</span>
      <button class="btn sm" data-ins="list">Elenco</button>
      <button class="btn sm" data-indent="1" title="Sposta la riga a destra (Tab)">Rientra →</button>
      <button class="btn sm" data-indent="-1" title="Sposta la riga a sinistra (Maiusc+Tab)">← Riduci rientro</button>
      <button class="btn sm" data-ins="table">Tabella</button>
      <button class="btn sm" data-act="img">Immagine</button>
      <button class="btn sm" data-act="pdf-fig">Figura da PDF</button>
      <button class="btn sm" data-act="hw">Scrivi a mano</button>
      ${AI.ready() ? `<button class="btn sm" data-act="ai-format">Riformatta con ${AI.name()}</button>` : ''}
    </div>
    <p class="hint edit-hint">Negli elenchi, Invio crea una nuova voce e Invio su una voce vuota torna indietro di un livello.</p>
    <label class="sr-only" for="edMd">Testo della sezione in Markdown</label>
    <textarea id="edMd" class="input md-edit" spellcheck="false">${esc(sec.md)}</textarea>
    <details class="preview" id="prevBox"><summary>Anteprima</summary><article class="notes" id="edPrev"></article></details>
    <label class="field"><span>Domande per il richiamo, una riga “D:” e una “R:” per domanda</span>
      <textarea id="edQs" class="input qs-edit" spellcheck="false">${esc(serializeQs(sec.questions))}</textarea></label>
    ${AI.ready() ? `<button class="btn sm" data-act="ai-qs">Aggiungi domande con ${AI.name()}</button>` : ''}
    ${otherNbs.length ? `
      <details class="move">
        <summary>Sposta in un altro notebook</summary>
        <div class="inline">
          <select class="input" id="mvNb" aria-label="Notebook di destinazione">${otherNbs.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join('')}</select>
          <button class="btn sm" data-act="move">Sposta</button>
        </div>
      </details>` : ''}
    <div class="save-bar">
      <button class="btn primary" data-act="save">Salva</button>
      <a class="btn ghost" href="#/sec/${sec.id}/read">Annulla</a>
      <button class="btn ghost danger push" data-act="del">Elimina sezione</button>
    </div>`;
  const ta = $('#edMd', body);
  const prev = $('#edPrev', body);
  const prevBox = $('#prevBox', body);
  let timer;
  const refresh = () => { if (prevBox.open) prev.innerHTML = renderMd(ta.value); };
  prevBox.addEventListener('toggle', refresh);
  ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refresh, 250); });
  setupListEditing(ta);
  on('[data-indent]', 'click', e => { ta.focus(); indentLines(ta, +e.currentTarget.dataset.indent); }, body);
  on('[data-mark]', 'click', e => { if (wrapSelectionInTextarea(ta, `{{${e.currentTarget.dataset.mark}|`, '}}')) refresh(); }, body);
  on('[data-act="hw"]', 'click', async () => {
    const im = await openHandwritingPad(sec.notebookId);
    if (im) insertAtCursor(ta, `\n\n${imageMd(im.id)}\n\n`);
  }, body);
  on('[data-act="img"]', 'click', async () => {
    const im = await addImageFromDevice(sec.notebookId);
    if (im) insertAtCursor(ta, `\n\n${imageMd(im.id)}\n\n`);
  }, body);
  on('[data-act="pdf-fig"]', 'click', async () => {
    const r = await openPdfCropper(sec.notebookId);
    if (r) insertAtCursor(ta, `\n\n${imageMd(r.id, r.caption)}\n\n`);
  }, body);
  // Immagini incollate (es. uno screenshot su Windows)
  ta.addEventListener('paste', async e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    try {
      const im = await saveImage(await compressImage(item.getAsFile()), sec.notebookId);
      insertAtCursor(ta, `\n\n${imageMd(im.id)}\n\n`);
      toast('Immagine incollata');
    } catch (err) { toast(err.message, 'err'); }
  });

  // Evita che i pulsanti tolgano la selezione dal testo
  $$('.edit-tools button', body).forEach(b => b.addEventListener('pointerdown', e => e.preventDefault()));
  on('[data-wrap]', 'click', e => {
    const w = e.currentTarget.dataset.wrap;
    const { selectionStart: s, selectionEnd: en, value: v } = ta;
    if (s === en) { toast('Seleziona prima il testo'); ta.focus(); return; }
    const sel = v.slice(s, en);
    const lead = sel.match(/^\s*/)[0];
    const trail = sel.match(/\s*$/)[0];
    const core = sel.trim();
    const wrapped = core.startsWith(w) && core.endsWith(w) && core.length > w.length * 2;
    const next = wrapped ? core.slice(w.length, -w.length) : w + core + w;
    ta.focus();
    ta.setRangeText(lead + next + trail, s, en, 'select');
    refresh();
  }, body);
  on('[data-ins]', 'click', e => {
    const kind = e.currentTarget.dataset.ins;
    const snippet = kind === 'table'
      ? '\n\n| Voce | Caratteristica | Note |\n|---|---|---|\n|  |  |  |\n'
      : '\n- ';
    ta.focus();
    ta.setRangeText(snippet, ta.selectionStart, ta.selectionEnd, 'end');
    refresh();
  }, body);

  on('[data-act="ai-format"]', 'click', async e => {
    const btn = e.currentTarget;
    if (!ta.value.trim()) { toast('Non c’è testo da riformattare'); return; }
    const ok = await modal({ title: 'Riformattare la sezione?', text: 'Il testo attuale viene sostituito dalla versione riformattata. Potrai controllarla prima di salvare.', confirm: 'Riformatta' });
    if (!ok) return;
    btn.disabled = true;
    btn.textContent = 'Riformattazione…';
    try {
      const r = await aiFormatNotes({ text: ta.value, cloze: S().aiCloze, questions: false });
      ta.value = r.md;
      if (r.truncated) toast('Risposta troncata: controlla la fine del testo', 'err');
      else toast('Fatto. Controlla e salva.');
      refresh();
    } catch (err) {
      toast(err.message, 'err');
    }
    btn.disabled = false;
    btn.textContent = `Riformatta con ${AI.name()}`;
  }, body);

  on('[data-act="ai-qs"]', 'click', async e => {
    const btn = e.currentTarget;
    if (!ta.value.trim()) { toast('Scrivi prima gli appunti'); return; }
    btn.disabled = true;
    btn.textContent = 'Genero le domande…';
    try {
      const r = await AI.generate({ system: QUESTIONS_SYSTEM, text: aiText(ta.value), maxTokens: 6000 });
      const parsed = parseQuestions(r.text);
      if (!parsed.length) throw new Error('Nessuna domanda riconosciuta nella risposta.');
      const box = $('#edQs', body);
      box.value = [box.value.trim(), serializeQs(parsed)].filter(Boolean).join('\n\n');
      toast(`${parsed.length} domande aggiunte. Salva per tenerle.`);
    } catch (err) {
      toast(err.message, 'err');
    }
    btn.disabled = false;
    btn.textContent = `Aggiungi domande con ${AI.name()}`;
  }, body);

  on('[data-act="save"]', 'click', async () => {
    const before = imageRefs(sec.md);
    sec.title = $('#edTitle', body).value.trim() || 'Senza titolo';
    sec.md = ta.value;
    sec.questions = parseQuestions($('#edQs', body).value);
    sec.needsFormat = false;
    await saveSection(sec);
    await removeOrphanImages(before);
    toast('Sezione salvata');
    go(`#/sec/${sec.id}/read`);
  }, body);

  on('[data-act="move"]', 'click', async () => {
    const target = $('#mvNb', body).value;
    sec.notebookId = target;
    await saveSection(sec);
    const cards = cardsOfSection(sec.id);
    cards.forEach(c => { c.notebookId = target; });
    if (cards.length) await saveCards(cards);
    toast(`Spostata in ${nbById(target)?.name || 'altro notebook'}`);
    go(`#/sec/${sec.id}/read`);
  }, body);

  on('[data-act="del"]', 'click', async () => {
    const nCards = cardsOfSection(sec.id).length;
    const ok = await modal({ title: 'Eliminare la sezione?', text: `${nCards ? `Verranno eliminate anche le sue ${nCards} flashcard. ` : ''}L’operazione non si può annullare.`, confirm: 'Elimina', danger: true });
    if (!ok) return;
    const nbId = sec.notebookId;
    await deleteSection(sec.id);
    toast('Sezione eliminata');
    go(`#/nb/${nbId}`);
  }, body);
}

/* ---------------------------------------------------------------------
   Vista: ripasso
   --------------------------------------------------------------------- */
function viewReview() {
  const t = todayStr();
  const due = state.sections.filter(isDue).sort(sortDue);
  const upcoming = state.sections.filter(s => s.srs?.due && s.srs.due > t).sort(sortDue).slice(0, 12);
  const fresh = state.sections.filter(s => !s.studyhub && !s.srs?.due && s.md.trim()).sort((a, b) => a.order - b.order);
  const linked = state.sections.filter(s => s.studyhub).length;
  const cc = cardCounts(state.cards);
  const cardsNow = cc.n + cc.l + cc.r;
  setView(`
    <header class="page-head">
      <div>
        <h1>Ripasso</h1>
        <p class="lede">${due.length ? `${due.length} ${due.length === 1 ? 'sezione' : 'sezioni'} da ripassare oggi.` : 'Niente da ripassare oggi.'}</p>
      </div>
      ${due.length ? '<button class="btn primary" data-act="start">Inizia il ripasso</button>' : ''}
    </header>
    ${cardsNow ? `
      <div class="callout">
        <p>Hai anche ${cardsNow} flashcard da studiare.</p>
        <a class="btn sm" href="#/study/all">Studia le flashcard</a>
      </div>` : ''}
    ${due.length ? `<ul class="list">${due.map(s => sectionRow(s, { showNb: true, review: true })).join('')}</ul>` : ''}
    ${linked ? `<p class="hint">${linked} ${linked === 1 ? 'sezione è pianificata' : 'sezioni sono pianificate'} da StudyHub e non compaiono qui.</p>` : ''}
    ${upcoming.length ? `<h2 class="sub">In arrivo</h2><ul class="list">${upcoming.map(s => sectionRow(s, { showNb: true })).join('')}</ul>` : ''}
    ${fresh.length ? `
      <details class="fresh">
        <summary>${fresh.length} ${fresh.length === 1 ? 'sezione mai pianificata' : 'sezioni mai pianificate'}</summary>
        <p class="hint">Aprile e usa “Pianifica il primo ripasso” quando le hai studiate.</p>
        <ul class="list">${fresh.map(s => sectionRow(s, { showNb: true })).join('')}</ul>
      </details>` : ''}
    ${!state.sections.length ? `
      <div class="empty">
        <p>Importa del materiale e pianifica il primo ripasso: le sezioni da rivedere compariranno qui.</p>
        <a class="btn primary" href="#/import">Importa</a>
      </div>` : ''}
  `);
  on('[data-review]', 'click', () => { state.fromReview = true; });
  on('[data-act="start"]', 'click', () => {
    state.fromReview = true;
    go(`#/sec/${due[0].id}/${defaultMode(due[0])}`);
  });
}

/* ---------------------------------------------------------------------
   Vista: importazione
   --------------------------------------------------------------------- */
function viewImport(nbParam) {
  if (importJob) return renderProgress();
  if (nbParam && nbById(nbParam)) importDraft.nbId = nbParam;
  if (!nbById(importDraft.nbId)) importDraft.nbId = state.notebooks[0]?.id || '';
  const aiOk = AI.ready();
  const st = S();
  setView(`
    <header class="page-head"><h1>Importa</h1></header>
    <div class="form">
      <div class="field"><label class="lbl" for="imNb">Notebook</label>
        <div class="inline">
          <select class="input" id="imNb">
            ${state.notebooks.length
              ? state.notebooks.map(nb => `<option value="${nb.id}" ${nb.id === importDraft.nbId ? 'selected' : ''}>${esc(nb.name)}</option>`).join('')
              : '<option value="">Crea prima un notebook</option>'}
          </select>
          <button class="btn sm" data-act="new-nb" type="button">Nuovo</button>
        </div>
      </div>

      <div class="seg" role="tablist" aria-label="Tipo di fonte">
        <button role="tab" data-src="text" aria-selected="${importDraft.src === 'text'}">Testo</button>
        <button role="tab" data-src="pdf" aria-selected="${importDraft.src === 'pdf'}">PDF</button>
      </div>

      <div id="srcText" ${importDraft.src === 'text' ? '' : 'hidden'}>
        <label class="field"><span>Titolo, facoltativo</span>
          <input class="input" id="imTitle" value="${esc(importDraft.title)}" placeholder="${aiOk ? 'Se lo lasci vuoto lo propone l’AI' : 'Altrimenti uso la prima riga'}"></label>
        <label class="field"><span>Testo</span>
          <textarea class="input paste" id="imText" placeholder="Incolla appunti, capitoli o testo da NotebookLM">${esc(importDraft.text)}</textarea></label>
        <p class="hint" id="textInfo"></p>
      </div>

      <div id="srcPdf" ${importDraft.src === 'pdf' ? '' : 'hidden'}>
        <label class="file-drop">
          <input type="file" id="imFile" accept="application/pdf,.pdf">
          <span id="fileLabel">${importDraft.pdf ? `${esc(importDraft.pdf.name)}, tocca per cambiarlo` : 'Scegli un PDF'}</span>
        </label>
        <div id="pdfInfo"></div>
      </div>

      <fieldset class="opts">
        <legend>Elaborazione</legend>
        <label class="check"><input type="checkbox" id="optAi" ${aiOk && st.aiFormat ? 'checked' : ''} ${aiOk ? '' : 'disabled'}>
          <span>Formatta con ${AI.name()} in elenchi puntati e tabelle</span></label>
        <label class="check"><input type="checkbox" id="optCloze" ${st.aiCloze ? 'checked' : ''}>
          <span>Segna i termini chiave per il cloze</span></label>
        <label class="check"><input type="checkbox" id="optQs" ${st.aiQuestions ? 'checked' : ''}>
          <span>Genera le domande per il richiamo</span></label>
        ${aiOk ? '' : '<p class="hint">Per usare l’AI aggiungi una chiave API in <a href="#/settings">Impostazioni</a>. Senza AI il testo viene salvato con una formattazione di base.</p>'}
      </fieldset>

      <button class="btn primary block" data-act="start">Crea le sezioni</button>
    </div>
  `);

  const syncOpts = () => {
    const ai = $('#optAi').checked && aiOk;
    const pdfAi = importDraft.src === 'pdf' && document.querySelector('input[name="pdfMode"]:checked')?.value === 'ai';
    const aiOn = ai || pdfAi;
    $('#optCloze').disabled = !aiOn;
    $('#optQs').disabled = !aiOn;
  };

  $('#imNb').addEventListener('change', e => { importDraft.nbId = e.target.value; });
  on('[data-act="new-nb"]', 'click', async () => {
    const nb = await createNotebookFlow();
    if (nb) { importDraft.nbId = nb.id; viewImport(); }
  });
  on('[data-src]', 'click', e => {
    importDraft.src = e.currentTarget.dataset.src;
    $$('[data-src]').forEach(b => b.setAttribute('aria-selected', b.dataset.src === importDraft.src));
    $('#srcText').hidden = importDraft.src !== 'text';
    $('#srcPdf').hidden = importDraft.src !== 'pdf';
    syncOpts();
  });

  const textInfo = () => {
    const t = $('#imText').value;
    importDraft.text = t;
    const n = t.trim() ? splitText(t.trim()).length : 0;
    $('#textInfo').textContent = n > 1 ? `Testo lungo: verrà diviso in ${n} sezioni.` : '';
  };
  $('#imText').addEventListener('input', textInfo);
  $('#imTitle').addEventListener('input', e => { importDraft.title = e.target.value; });
  textInfo();

  $('#optAi').addEventListener('change', e => { S().aiFormat = e.target.checked; Settings.save(); syncOpts(); });
  $('#optCloze').addEventListener('change', e => { S().aiCloze = e.target.checked; Settings.save(); });
  $('#optQs').addEventListener('change', e => { S().aiQuestions = e.target.checked; Settings.save(); });

  const renderPdfInfo = () => {
    const p = importDraft.pdf;
    const box = $('#pdfInfo');
    if (!p) { box.innerHTML = ''; return; }
    const per = Math.max(1, +S().pagesPerSection || 5);
    const preferAi = p.scanned && aiOk;
    box.innerHTML = `
      <p class="pdf-meta">${p.pages} ${p.pages === 1 ? 'pagina' : 'pagine'}. ${p.scanned
        ? (aiOk ? 'Sembra un PDF scansionato: conviene farlo leggere all’AI.' : 'Sembra un PDF scansionato: senza AI non riesco a leggerne il testo.')
        : 'Il testo è selezionabile.'}</p>
      <div class="grid3">
        <label class="field"><span>Da pagina</span><input class="input" type="number" id="pFrom" min="1" max="${p.pages}" value="1" inputmode="numeric"></label>
        <label class="field"><span>A pagina</span><input class="input" type="number" id="pTo" min="1" max="${p.pages}" value="${p.pages}" inputmode="numeric"></label>
        <label class="field"><span>Pagine per sezione</span><input class="input" type="number" id="pPer" min="1" max="30" value="${per}" inputmode="numeric"></label>
      </div>
      <div class="radio">
        <label class="check"><input type="radio" name="pdfMode" value="text" ${preferAi ? '' : 'checked'}>
          <span>Estrai il testo dal PDF</span></label>
        <label class="check"><input type="radio" name="pdfMode" value="ai" ${preferAi ? 'checked' : ''} ${aiOk ? '' : 'disabled'}>
          <span>Fai leggere le pagine all’AI: funziona anche con scansioni, schemi e tabelle</span></label>
      </div>
      <p class="hint" id="pdfEstimate"></p>`;
    const est = () => {
      const r = readRange();
      $('#pdfEstimate').textContent = r ? `Verranno create ${r.count} ${r.count === 1 ? 'sezione' : 'sezioni'}.` : 'Controlla l’intervallo di pagine.';
    };
    ['#pFrom', '#pTo', '#pPer'].forEach(sel => $(sel).addEventListener('input', est));
    $$('input[name="pdfMode"]').forEach(r => r.addEventListener('change', syncOpts));
    est();
    syncOpts();
  };
  const readRange = () => {
    const p = importDraft.pdf;
    const from = parseInt($('#pFrom')?.value, 10);
    const to = parseInt($('#pTo')?.value, 10);
    const per = parseInt($('#pPer')?.value, 10);
    if (!p || !(from >= 1) || !(to >= from) || to > p.pages || !(per >= 1)) return null;
    return { from, to, per, count: Math.ceil((to - from + 1) / per) };
  };

  $('#imFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    $('#fileLabel').textContent = 'Apro il PDF…';
    try {
      importDraft.pdf = await openPdf(file);
      $('#fileLabel').textContent = `${file.name}, tocca per cambiarlo`;
    } catch (err) {
      importDraft.pdf = null;
      $('#fileLabel').textContent = 'Scegli un PDF';
      toast(err.message, 'err');
    }
    renderPdfInfo();
  });
  renderPdfInfo();
  syncOpts();

  on('[data-act="start"]', 'click', () => {
    const nbId = $('#imNb').value;
    if (!nbId || !nbById(nbId)) { toast('Scegli o crea un notebook'); return; }
    const opts = { ai: $('#optAi').checked && aiOk, cloze: $('#optCloze').checked, questions: $('#optQs').checked };
    const job = { running: true, controller: new AbortController(), nbId, opts, items: [], kind: importDraft.src };
    if (job.kind === 'text') {
      const text = $('#imText').value.trim();
      if (!text) { toast('Incolla prima del testo'); return; }
      const chunks = splitText(text);
      job.title = $('#imTitle').value.trim();
      job.items = chunks.map((c, i) => ({
        label: chunks.length > 1 ? `Parte ${i + 1} di ${chunks.length}` : 'Testo incollato',
        text: c, idx: i, status: 'wait'
      }));
    } else {
      if (!importDraft.pdf) { toast('Scegli prima un PDF'); return; }
      const r = readRange();
      if (!r) { toast('Controlla l’intervallo di pagine'); return; }
      S().pagesPerSection = r.per;
      Settings.save();
      job.pdf = importDraft.pdf;
      job.pdfMode = document.querySelector('input[name="pdfMode"]:checked')?.value === 'ai' && aiOk ? 'ai' : 'text';
      if (job.pdfMode === 'ai') job.opts.ai = true;
      for (let a = r.from; a <= r.to; a += r.per) {
        const b = Math.min(r.to, a + r.per - 1);
        job.items.push({ label: a === b ? `Pagina ${a}` : `Pagine ${a}–${b}`, from: a, to: b, status: 'wait' });
      }
    }
    importJob = job;
    if (job.kind === 'text') { importDraft.text = ''; importDraft.title = ''; }
    renderProgress();
    runImport(job);
  });
}

function renderProgress() {
  const job = importJob;
  if (!job || !location.hash.startsWith('#/import')) return;
  const done = job.items.filter(i => i.status === 'done' || i.status === 'error' || i.status === 'skip').length;
  const label = { wait: 'In attesa', work: 'In corso', done: 'Fatto', error: 'Errore', skip: 'Saltata' };
  setView(`
    <header class="page-head">
      <div>
        <h1>${job.running ? 'Importazione in corso' : 'Importazione finita'}</h1>
        <p class="lede">${done} di ${job.items.length} completate${job.running ? '. Puoi restare qui o continuare a studiare: le sezioni si salvano man mano.' : '.'}</p>
      </div>
    </header>
    <ol class="progress">
      ${job.items.map(it => `
        <li class="st-${it.status}">
          <span class="dot" aria-hidden="true"></span>
          <span class="p-main">
            <span class="p-label">${esc(it.label)}</span>
            <span class="p-status">${it.wait ? esc(it.wait) : label[it.status]}</span>
            ${it.error ? `<small class="p-err">${esc(it.error)}</small>` : ''}
            ${it.note ? `<small class="p-note">${esc(it.note)}</small>` : ''}
          </span>
          ${it.secId && secById(it.secId) ? `<a class="btn sm" href="#/sec/${it.secId}">Apri</a>` : ''}
        </li>`).join('')}
    </ol>
    <div class="row-actions">
      ${job.running
        ? '<button class="btn ghost danger" data-act="cancel">Interrompi</button>'
        : `<a class="btn primary" href="#/nb/${job.nbId}">Vai al notebook</a><button class="btn" data-act="again">Nuova importazione</button>`}
    </div>
  `);
  on('[data-act="cancel"]', 'click', () => { job.controller.abort(); toast('Importazione interrotta'); });
  on('[data-act="again"]', 'click', () => { importJob = null; viewImport(); });
}

async function runImport(job) {
  const { signal } = job.controller;
  for (let i = 0; i < job.items.length; i++) {
    const it = job.items[i];
    if (signal.aborted) { it.status = 'skip'; continue; }
    it.status = 'work';
    renderProgress();
    let text = it.text || '';
    let baseTitle = '';
    let source = 'Testo incollato';
    if (job.kind === 'pdf') {
      baseTitle = `${job.pdf.base}, ${it.label.toLowerCase()}`;
      source = `${job.pdf.name}, ${it.label.toLowerCase()}`;
    } else if (job.title) {
      baseTitle = job.items.length > 1 ? `${job.title} (${i + 1})` : job.title;
    }
    try {
      let pdfB64 = null;
      if (job.kind === 'pdf') {
        if (job.pdfMode === 'ai') pdfB64 = await subsetPdfBase64(job, it.from, it.to);
        else text = await extractRange(job.pdf.doc, it.from, it.to);
      }
      if (signal.aborted) throw abortError();
      let sec;
      if (job.opts.ai) {
        const r = await aiFormatNotes({
          text, pdfBase64: pdfB64, cloze: job.opts.cloze, questions: job.opts.questions, signal,
          onWait: ms => { it.wait = `Limite raggiunto, riprovo tra ${Math.round(ms / 1000)} secondi`; renderProgress(); }
        });
        it.wait = '';
        const title = job.kind === 'text' && job.title ? baseTitle : (r.title || baseTitle || firstLineTitle(r.md));
        sec = newSection(job.nbId, { title, md: r.md, questions: r.questions, source });
        if (r.truncated) it.note = 'Risposta troncata: controlla la fine della sezione o usa meno pagine.';
      } else {
        if (!text.trim()) throw new Error('Nessun testo trovato in queste pagine: forse è una scansione.');
        sec = newSection(job.nbId, { title: baseTitle || firstLineTitle(text), md: basicFormat(text), source });
      }
      await saveSection(sec);
      it.status = 'done';
      it.secId = sec.id;
    } catch (err) {
      it.wait = '';
      if (err.name === 'AbortError') { it.status = 'skip'; renderProgress(); continue; }
      it.status = 'error';
      it.error = err.message;
      // Non perdere nulla: salva il testo grezzo da formattare più tardi
      try {
        if (!text.trim() && job.kind === 'pdf') text = await extractRange(job.pdf.doc, it.from, it.to);
        if (text.trim()) {
          const sec = newSection(job.nbId, { title: baseTitle || firstLineTitle(text), md: basicFormat(text), source });
          sec.needsFormat = true;
          await saveSection(sec);
          it.secId = sec.id;
          it.note = 'Salvata senza formattazione AI: potrai formattarla dalla sezione.';
        }
      } catch { /* nessun testo recuperabile */ }
    }
    renderProgress();
  }
  job.running = false;
  renderProgress();
  if (!location.hash.startsWith('#/import')) {
    const ok = job.items.filter(i => i.status === 'done').length;
    toast(`Importazione finita: ${ok} ${ok === 1 ? 'sezione creata' : 'sezioni create'}`);
  }
}

/* ---------------------------------------------------------------------
   Vista: impostazioni
   --------------------------------------------------------------------- */
function viewSettings() {
  const st = S();
  const keyField = (p, label) => `
    <div class="provider" id="box-${p}">
      <h3>${label}</h3>
      <div class="field"><label class="lbl" for="${p}Key">Chiave API</label>
        <div class="inline">
          <input class="input" type="password" id="${p}Key" value="${esc(st[p + 'Key'])}" autocomplete="off" spellcheck="false" placeholder="Incolla la chiave">
          <button class="btn sm" type="button" data-toggle="${p}Key">Mostra</button>
        </div></div>
      <label class="field"><span>Modello</span>
        <input class="input" id="${p}Model" value="${esc(st[p + 'Model'])}" list="${p}Models" spellcheck="false">
        <datalist id="${p}Models"></datalist></label>
      <div class="inline">
        <button class="btn sm" data-list="${p}">Carica modelli</button>
        <button class="btn sm" data-test="${p}">Prova la connessione</button>
      </div>
      <p class="hint" id="${p}Msg" aria-live="polite"></p>
    </div>`;
  setView(`
    <header class="page-head"><h1>Impostazioni</h1></header>

    <section class="block">
      <h2>Intelligenza artificiale</h2>
      <label class="field"><span>Servizio da usare</span>
        <select class="input" id="stProv">
          <option value="gemini" ${st.provider === 'gemini' ? 'selected' : ''}>Gemini</option>
          <option value="claude" ${st.provider === 'claude' ? 'selected' : ''}>Claude</option>
        </select></label>
      <p class="hint">L’abbonamento Google AI Pro vale nell’app Gemini, non nelle app esterne: qui serve una chiave API. La crei con lo stesso account Google su <a href="https://aistudio.google.com/" target="_blank" rel="noopener">Google AI Studio</a>. Per Claude la chiave si crea nella console di Anthropic.</p>
      ${keyField('gemini', 'Gemini')}
      ${keyField('claude', 'Claude')}
      <p class="hint">Le chiavi restano salvate solo su questo dispositivo: non sono nel codice su GitHub e non finiscono nel backup.</p>
    </section>

    <section class="block">
      <h2>Sincronizzazione con Google Drive</h2>
      <p class="hint">Serve lo script “sync-notebook.gs”: crealo su script.google.com, distribuiscilo come app web e incolla qui il suo indirizzo e la frase segreta che hai scritto nello script.</p>
      <label class="field"><span>Indirizzo dell’app web, finisce con /exec</span>
        <input class="input" id="syUrl" value="${esc(st.syncUrl)}" placeholder="https://script.google.com/macros/s/…/exec" spellcheck="false" autocomplete="off"></label>
      <div class="field"><label class="lbl" for="sySecret">Frase segreta</label>
        <div class="inline">
          <input class="input" type="password" id="sySecret" value="${esc(st.syncSecret)}" autocomplete="off" spellcheck="false">
          <button class="btn sm" type="button" data-toggle="sySecret">Mostra</button>
        </div></div>
      <div class="inline"><button class="btn" data-act="sync-now">Sincronizza ora</button></div>
      <p class="hint" id="syStatus" aria-live="polite">${esc(syncStatusText())}</p>
      <p class="hint">La sincronizzazione parte da sola all’apertura, quando torni sull’app e qualche secondo dopo ogni modifica.</p>
    </section>

    <section class="block">
      <h2>Flashcard</h2>
      <label class="field narrow"><span>Nuove flashcard al giorno per notebook</span>
        <input class="input" type="number" id="stNew" min="0" max="500" value="${st.newPerDay}" inputmode="numeric"></label>
      <label class="check"><input type="checkbox" id="stAskNote" ${st.askNote ? 'checked' : ''}>
        <span>Quando premi “Di nuovo”, chiedimi una nota sul perché</span></label>
      <p class="hint">Passi di apprendimento come Anki: 1 e 10 minuti, poi 1 giorno; con “Facile” 4 giorni.</p>
    </section>

    <section class="block">
      <h2>Immagini</h2>
      <p class="hint" id="imgInfo"></p>
      <button class="btn sm" data-act="img-clean" hidden>Elimina le immagini non usate</button>
    </section>

    <section class="block">
      <h2>StudyHub</h2>
      <p class="hint" id="bridgeInfo">${Bridge.pending() ? `${Bridge.pending()} ${Bridge.pending() === 1 ? 'aggiornamento attende' : 'aggiornamenti attendono'} che StudyHub li legga su questo dispositivo.` : 'Nessun aggiornamento in attesa per StudyHub.'}</p>
    </section>

    <section class="block">
      <h2>Importazione</h2>
      <label class="field narrow"><span>Pagine per sezione, valore iniziale</span>
        <input class="input" type="number" id="stPer" min="1" max="30" value="${st.pagesPerSection}" inputmode="numeric"></label>
    </section>

    <section class="block">
      <h2>Lettura e aspetto</h2>
      <div class="grid2">
        <label class="field"><span>Tema</span>
          <select class="input" id="stTheme">
            <option value="dark" ${st.theme === 'dark' ? 'selected' : ''}>Scuro</option>
            <option value="sepia" ${st.theme === 'sepia' ? 'selected' : ''}>Carta, toni caldi</option>
            <option value="light" ${st.theme === 'light' ? 'selected' : ''}>Chiaro</option>
            <option value="auto" ${st.theme === 'auto' ? 'selected' : ''}>Come il dispositivo</option>
          </select></label>
        <label class="field"><span>Carattere degli appunti</span>
          <select class="input" id="stFont">
            <option value="literata" ${st.readFont === 'literata' ? 'selected' : ''}>Literata, con grazie</option>
            <option value="atkinson" ${st.readFont === 'atkinson' ? 'selected' : ''}>Atkinson Hyperlegible, alta leggibilità</option>
            <option value="system" ${st.readFont === 'system' ? 'selected' : ''}>Carattere del sistema</option>
          </select></label>
        <label class="field"><span>Dimensione</span>
          <select class="input" id="stSize">
            <option value="s" ${st.readSize === 's' ? 'selected' : ''}>Piccola</option>
            <option value="m" ${st.readSize === 'm' ? 'selected' : ''}>Media</option>
            <option value="l" ${st.readSize === 'l' ? 'selected' : ''}>Grande</option>
            <option value="xl" ${st.readSize === 'xl' ? 'selected' : ''}>Molto grande</option>
          </select></label>
        <label class="field"><span>Interlinea</span>
          <select class="input" id="stSpacing">
            <option value="normal" ${st.readSpacing === 'normal' ? 'selected' : ''}>Normale</option>
            <option value="wide" ${st.readSpacing === 'wide' ? 'selected' : ''}>Ampia</option>
          </select></label>
      </div>
      <article class="notes read-sample"><p>Il <strong>ventricolo sinistro</strong> pompa il sangue nell’aorta. {{y|La gittata}} dipende da precarico, postcarico e contrattilità.</p></article>
      <p class="hint">Il tema “Carta” e l’interlinea ampia affaticano meno la vista nelle sessioni lunghe.</p>
    </section>

    <section class="block">
      <h2>Backup</h2>
      <p class="hint">Un file con tutti i notebook, le sezioni e le flashcard: utile come copia di sicurezza, anche se usi la sincronizzazione.</p>
      <div class="inline">
        <button class="btn" data-act="export">Esporta backup</button>
        <label class="btn">Importa backup<input type="file" id="bkFile" accept="application/json,.json" hidden></label>
      </div>
      <p class="hint" id="usage"></p>
    </section>

    <section class="block">
      <h2>App sul telefono</h2>
      <p class="hint" id="installInfo">${installInfoText()}</p>
      <button class="btn primary" data-act="install" ${installPrompt ? '' : 'hidden'}>Installa l’app</button>
    </section>

    <p class="version">StudyHub Notebook ${APP_VERSION}</p>
  `);

  $('#stProv').addEventListener('change', e => { st.provider = e.target.value; Settings.save(); toast(`Uso ${AI.name()}`); });
  $('#syUrl').addEventListener('change', e => {
    st.syncUrl = e.target.value.trim();
    Settings.save();
    setSyncStatus();
    if (Sync.configured()) Sync.run();
  });
  $('#sySecret').addEventListener('change', e => {
    st.syncSecret = e.target.value.trim();
    Settings.save();
    setSyncStatus();
    if (Sync.configured()) Sync.run();
  });
  on('[data-act="sync-now"]', 'click', () => Sync.run());
  $('#stAskNote').addEventListener('change', e => { st.askNote = e.target.checked; Settings.save(); });
  const imgInfo = () => {
    const used = referencedImages();
    const unused = state.images.filter(i => !used.has(i.id));
    const size = state.images.reduce((a, i) => a + (i.size || 0), 0);
    $('#imgInfo').textContent = state.images.length
      ? `${state.images.length} ${state.images.length === 1 ? 'immagine' : 'immagini'}, ${fmtMB(size)}.${unused.length ? ` ${unused.length} non ${unused.length === 1 ? 'è usata' : 'sono usate'} in nessuna sezione o flashcard.` : ''}`
      : 'Nessuna immagine salvata.';
    $('[data-act="img-clean"]').hidden = !unused.length;
    return unused;
  };
  imgInfo();
  on('[data-act="img-clean"]', 'click', async () => {
    const unused = imgInfo();
    const ok = await modal({ title: 'Eliminare le immagini non usate?', text: `${unused.length} ${unused.length === 1 ? 'immagine' : 'immagini'} non ${unused.length === 1 ? 'compare' : 'compaiono'} in nessuna sezione o flashcard.`, confirm: 'Elimina', danger: true });
    if (!ok) return;
    const n = await removeOrphanImages(unused.map(i => i.id));
    toast(`${n} ${n === 1 ? 'immagine eliminata' : 'immagini eliminate'}`);
    imgInfo();
  });
  on('[data-act="install"]', 'click', async e => {
    const btn = e.currentTarget;
    if (!installPrompt) return;
    installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    btn.hidden = true;
    if (choice && choice.outcome === 'accepted') toast('App installata');
  });
  $('#stNew').addEventListener('change', e => {
    const v = Math.min(500, Math.max(0, parseInt(e.target.value, 10) || 0));
    e.target.value = v;
    st.newPerDay = v;
    Settings.save();
    updateBadge();
  });
  ['gemini', 'claude'].forEach(p => {
    $(`#${p}Key`).addEventListener('change', e => { st[p + 'Key'] = e.target.value.trim(); Settings.save(); toast('Chiave salvata'); });
    $(`#${p}Model`).addEventListener('change', e => {
      st[p + 'Model'] = e.target.value.trim().replace(/^models\//, '') || Settings.defaults[p + 'Model'];
      e.target.value = st[p + 'Model'];
      Settings.save();
      toast('Modello salvato');
    });
  });
  on('[data-toggle]', 'click', e => {
    const inp = $('#' + e.currentTarget.dataset.toggle);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Nascondi' : 'Mostra';
  });
  on('[data-list]', 'click', async e => {
    const p = e.currentTarget.dataset.list;
    const msg = $(`#${p}Msg`);
    if (!AI.ready(p)) { msg.textContent = 'Inserisci prima la chiave.'; return; }
    msg.textContent = 'Carico i modelli…';
    try {
      const models = await listModels(p);
      $(`#${p}Models`).innerHTML = models.map(m => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
      msg.textContent = `${models.length} modelli disponibili: tocca il campo Modello per sceglierne uno.`;
    } catch (err) {
      msg.textContent = err.message;
    }
  });
  on('[data-test]', 'click', async e => {
    const p = e.currentTarget.dataset.test;
    const msg = $(`#${p}Msg`);
    if (!AI.ready(p)) { msg.textContent = 'Inserisci prima la chiave.'; return; }
    msg.textContent = 'Provo…';
    try {
      await AI.generate({ provider: p, text: 'Rispondi solo con la parola: ok', maxTokens: 2000 });
      msg.textContent = `Connessione riuscita con ${S()[p + 'Model']}.`;
    } catch (err) {
      msg.textContent = err.message;
    }
  });
  $('#stPer').addEventListener('change', e => {
    const v = Math.min(30, Math.max(1, parseInt(e.target.value, 10) || 5));
    e.target.value = v;
    st.pagesPerSection = v;
    Settings.save();
  });
  $('#stTheme').addEventListener('change', e => { st.theme = e.target.value; Settings.save(); applyTheme(); });
  [['#stFont', 'readFont'], ['#stSize', 'readSize'], ['#stSpacing', 'readSpacing']].forEach(([sel, key]) => {
    $(sel).addEventListener('change', e => { st[key] = e.target.value; Settings.save(); applyTheme(); });
  });
  const sample = $('.read-sample p');
  if (sample) sample.innerHTML = renderMarks(sample.innerHTML);

  on('[data-act="export"]', 'click', async () => {
    const images = [];
    for (const im of state.images) {
      if (!im.blob) continue;
      const { blob, ...meta } = im;
      images.push({ ...meta, data: await blobToBase64(blob) });
    }
    const data = { app: 'studyhub-notebook', version: 3, exported: new Date().toISOString(), notebooks: state.notebooks, sections: state.sections, cards: state.cards, images };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `notebook-backup-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('#bkFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'studyhub-notebook' || !Array.isArray(data.notebooks) || !Array.isArray(data.sections)) throw new Error('Questo file non è un backup del Notebook.');
      const ok = await modal({
        title: 'Importare il backup?',
        text: `${data.notebooks.length} notebook, ${data.sections.length} sezioni e ${(data.cards || []).length} flashcard. Gli elementi con lo stesso identificativo vengono sostituiti, gli altri restano.`,
        confirm: 'Importa'
      });
      if (!ok) return;
      const now = Date.now();
      const secs = data.sections.filter(s => s && s.id && s.notebookId).map(s => ({ ...normalizeRecord('sections', s), updated: now }));
      const nbs = data.notebooks.filter(n => n && n.id).map(n => ({ ...n, updated: now }));
      const cards = (Array.isArray(data.cards) ? data.cards : []).filter(c => c && c.id && c.notebookId).map(c => ({ ...normalizeRecord('cards', c), updated: now }));
      const images = (Array.isArray(data.images) ? data.images : []).filter(i => i && i.id && i.data).map(({ data: b64, ...meta }) => ({ ...meta, blob: base64ToBlob(b64, meta.mime), updated: now }));
      await DB.bulkPut('images', images);
      images.forEach(i => forgetImageUrl(i.id));
      await DB.bulkPut('notebooks', nbs);
      await DB.bulkPut('sections', secs);
      await DB.bulkPut('cards', cards);
      state.notebooks = await DB.all('notebooks');
      state.sections = await DB.all('sections');
      state.cards = await DB.all('cards');
      state.images = await DB.all('images');
      updateBadge();
      scheduleSync();
      toast('Backup importato');
    } catch (err) {
      toast(err.message.startsWith('Unexpected') ? 'File non valido' : err.message, 'err');
    }
  });
  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then(({ usage }) => {
      const el = $('#usage');
      if (el && usage != null) el.textContent = `Spazio usato da questo sito: ${(usage / 1048576).toFixed(1).replace('.', ',')} MB.`;
    }).catch(() => {});
  }
}

/* ---------------------------------------------------------------------
   Flashcard: algoritmo di Anki (passi di apprendimento + SM-2 modificato)
   --------------------------------------------------------------------- */
const ANKI = {
  learnSteps: [1, 10],     // minuti
  relearnSteps: [10],      // minuti
  gradIvl: 1,              // giorni, dopo l'ultimo passo con "Bene"
  easyIvl: 4,              // giorni, con "Facile" su una carta nuova
  startEase: 2.5,
  easyBonus: 1.3,
  hardMult: 1.2,
  lapseMult: 0,            // nuovo intervallo dopo un errore: 0% → 1 giorno
  minEase: 1.3,
  maxIvl: 36500
};
const LEARN_AHEAD = 20 * 60000;
const CARD_GRADES = [
  { key: 'again', label: 'Di nuovo' },
  { key: 'hard', label: 'Difficile' },
  { key: 'good', label: 'Bene' },
  { key: 'easy', label: 'Facile' }
];

function newCardSrs() {
  return { state: 'new', step: 0, due: 0, interval: 0, ease: ANKI.startEase, reps: 0, lapses: 0, introduced: '', history: [] };
}
function newCard(nbId, { front = '', back = '', sectionId = null } = {}) {
  const now = Date.now();
  return {
    id: uid(), notebookId: nbId, sectionId: sectionId || null,
    front, back, suspended: false,
    order: now * 1000 + (orderSeq++ % 1000),
    created: now, updated: now,
    srs: newCardSrs()
  };
}
function dayStartMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}
function fuzzIvl(ivl) {
  if (ivl < 3) return ivl;
  const f = Math.max(1, Math.round(ivl * 0.05));
  return ivl + Math.round((Math.random() * 2 - 1) * f);
}

// Restituisce il nuovo stato della carta dopo la risposta (preview = senza casualità e senza storico)
function scheduleCard(prev, grade, now = Date.now(), preview = false) {
  const s = { ...newCardSrs(), ...(prev || {}), history: [...((prev && prev.history) || [])] };
  const inMin = m => now + m * 60000;
  const toReview = ivl => {
    s.state = 'review';
    s.step = 0;
    s.interval = Math.min(ANKI.maxIvl, Math.max(1, Math.round(ivl)));
    s.due = dayStartMs(addDays(localDateStr(new Date(now)), s.interval));
  };
  if (s.state === 'new') { s.state = 'learning'; s.step = 0; s.introduced = localDateStr(new Date(now)); }
  if (s.state === 'learning' || s.state === 'relearning') {
    const relearn = s.state === 'relearning';
    const steps = relearn ? ANKI.relearnSteps : ANKI.learnSteps;
    if (grade === 'again') { s.step = 0; s.due = inMin(steps[0]); }
    else if (grade === 'hard') {
      const cur = steps[Math.min(s.step, steps.length - 1)];
      s.due = inMin(s.step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : cur);
    } else if (grade === 'good') {
      s.step += 1;
      if (s.step >= steps.length) toReview(relearn ? s.interval : ANKI.gradIvl);
      else s.due = inMin(steps[s.step]);
    } else toReview(relearn ? s.interval + 1 : ANKI.easyIvl);
  } else {
    const delay = Math.max(0, dayDiff(localDateStr(new Date(s.due)), localDateStr(new Date(now))));
    const ivl = Math.max(1, s.interval);
    const fz = v => (preview ? v : fuzzIvl(v));
    if (grade === 'again') {
      s.lapses += 1;
      s.ease = Math.max(ANKI.minEase, s.ease - 0.2);
      s.interval = Math.max(1, Math.round(ivl * ANKI.lapseMult));
      s.state = 'relearning';
      s.step = 0;
      s.due = inMin(ANKI.relearnSteps[0]);
    } else {
      const hardIvl = Math.max(ivl + 1, ivl * ANKI.hardMult);
      const goodIvl = Math.max(hardIvl + 1, (ivl + delay / 2) * s.ease);
      const easyIvl = Math.max(goodIvl + 1, (ivl + delay) * s.ease * ANKI.easyBonus);
      if (grade === 'hard') { s.ease = Math.max(ANKI.minEase, s.ease - 0.15); toReview(fz(hardIvl)); }
      else if (grade === 'good') toReview(fz(goodIvl));
      else { s.ease += 0.15; toReview(fz(easyIvl)); }
    }
  }
  s.ease = Math.round(s.ease * 100) / 100;
  s.reps += 1;
  if (!preview) {
    s.history.push({ at: now, g: grade });
    if (s.history.length > 100) s.history = s.history.slice(-100);
  }
  return s;
}

function fmtCardNext(srs, now = Date.now()) {
  if (srs.state === 'review') return fmtInterval(srs.interval);
  const m = Math.round((srs.due - now) / 60000);
  return m < 1 ? '<1 min' : `${m} min`;
}

const cardById = id => state.cards.find(c => c.id === id);
const cardsOf = nbId => state.cards.filter(c => c.notebookId === nbId).sort((a, b) => a.order - b.order);
const cardsOfSection = secId => state.cards.filter(c => c.sectionId === secId).sort((a, b) => a.order - b.order);

function newLeftToday(nbId) {
  const t = todayStr();
  const used = state.cards.filter(c => c.notebookId === nbId && c.srs.introduced === t).length;
  return Math.max(0, (+S().newPerDay || 0) - used);
}
function cardCounts(list, { limitNew = true } = {}) {
  const now = Date.now();
  let n = 0, l = 0, r = 0;
  const newBy = {};
  for (const c of list) {
    if (c.suspended) continue;
    const s = c.srs;
    if (s.state === 'new') { newBy[c.notebookId] = (newBy[c.notebookId] || 0) + 1; }
    else if (s.state === 'review') { if (s.due <= now) r++; }
    else if (s.due <= now + LEARN_AHEAD) l++;
  }
  for (const nb in newBy) n += limitNew ? Math.min(newBy[nb], newLeftToday(nb)) : newBy[nb];
  return { n, l, r };
}
function countsHtml({ n, l, r }) {
  return `<span class="counts" aria-label="${n} nuove, ${l} in apprendimento, ${r} da ripassare">
    <span class="c-new" title="Nuove">${n}</span><span class="c-lrn" title="In apprendimento">${l}</span><span class="c-rev" title="Da ripassare">${r}</span></span>`;
}
const COUNTS_LEGEND = '<p class="legend"><span class="c-new">Nuove</span><span class="c-lrn">In apprendimento</span><span class="c-rev">Da ripassare</span></p>';

function cardStatusText(c) {
  if (c.suspended) return 'sospesa';
  const s = c.srs;
  if (s.state === 'new') return 'nuova';
  if (s.state !== 'review') return 'in apprendimento';
  return s.due <= Date.now() ? 'da ripassare oggi' : `prossimo ripasso ${fmtDue(localDateStr(new Date(s.due)))}`;
}
function cardPill(c) {
  if (c.suspended) return '<span class="pill">Sospesa</span>';
  const s = c.srs;
  if (s.state === 'new') return '<span class="pill">Nuova</span>';
  if (s.state !== 'review') return '<span class="pill lrn">Apprendimento</span>';
  if (s.due <= Date.now()) return '<span class="pill due">Oggi</span>';
  return `<span class="pill soft">${esc(fmtDue(localDateStr(new Date(s.due))))}</span>`;
}
const plainText = (md, max = 140) => {
  const t = stripMarks(stripCloze(md || '')).replace(IMG_MD_RE, '[immagine]').replace(/^\*([^*\n]+)\*\n\n/, '$1: ').replace(/[#*_`>|]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};
function cardRow(c) {
  if (c.type === 'occlusion') {
    const n = c.io.masks.findIndex(m => m.id === c.io.maskId) + 1;
    return `
    <li data-id="${c.id}">
      <a class="row" href="#/card/${c.id}">
        <span class="row-main">
          <span class="row-title">Occlusione, riquadro ${n} di ${c.io.masks.length}</span>
          <span class="row-sub">${esc(plainText(c.back, 100)) || 'Senza etichetta'}</span>
        </span>
        ${cardPill(c)}
      </a>
    </li>`;
  }
  return `
    <li data-id="${c.id}">
      <a class="row" href="#/card/${c.id}">
        <span class="row-main">
          <span class="row-title">${esc(plainText(c.front)) || '<em>Fronte vuoto</em>'}</span>
          <span class="row-sub">${esc(plainText(c.back, 100))}</span>
        </span>
        ${cardPill(c)}
      </a>
    </li>`;
}

async function saveCard(card) {
  card.updated = Date.now();
  await DB.put('cards', card);
  const i = state.cards.findIndex(c => c.id === card.id);
  if (i < 0) state.cards.push(card); else state.cards[i] = card;
  updateBadge();
  scheduleSync();
}
async function saveCards(cards) {
  const now = Date.now();
  cards.forEach(c => { c.updated = now; });
  await DB.bulkPut('cards', cards);
  cards.forEach(card => {
    const i = state.cards.findIndex(c => c.id === card.id);
    if (i < 0) state.cards.push(card); else state.cards[i] = card;
  });
  updateBadge();
  scheduleSync();
}

function sectionLearned(secId) {
  const cards = cardsOfSection(secId).filter(c => !c.suspended);
  return cards.length > 0 && cards.every(c => c.srs.state === 'review');
}

// Flashcard dai termini ==cloze==: una carta per termine, con la riga (o la riga di tabella) come contesto
function clozeCardsFromMd(md) {
  const lines = (md || '').split('\n');
  const out = [];
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());
  const isSep = l => /^[\s|:-]+$/.test(l) && /-{2,}/.test(l);
  let heading = '';
  let header = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6}\s/.test(l)) { heading = stripCloze(l.replace(/^#+\s+/, '')).trim(); header = null; continue; }
    const isRow = /^\s*\|/.test(l);
    if (!isRow) header = null;
    if (isRow && i + 1 < lines.length && isSep(lines[i + 1])) { header = cells(l).map(stripCloze); continue; }
    if (isRow && isSep(l)) continue;
    let text;
    if (isRow) {
      const cs = cells(l);
      text = cs.map((v, k) => (header && header[k] ? `${header[k]}: ${v}` : v)).filter(v => v.trim()).join('; ');
    } else {
      text = l.replace(/^\s*([-*+]|\d+\.)\s+/, '').trim();
    }
    text = stripMarks(text);
    if (!text) continue;
    const re = clozeRe();
    const found = [];
    let m;
    while ((m = re.exec(text))) found.push({ start: m.index, end: m.index + m[0].length, term: m[1] });
    for (const f of found) {
      const front = stripCloze(text.slice(0, f.start) + '**[…]**' + text.slice(f.end));
      out.push({ front: heading ? `*${heading}*\n\n${front}` : front, back: f.term });
    }
  }
  return out;
}

const CARDS_SYSTEM = [
  'Sei un tutor per studenti di medicina. Dagli appunti ricevuti crea flashcard per la memorizzazione.',
  'Ogni flashcard ha una domanda breve e precisa e una risposta breve (una parola, un valore, un elenco corto).',
  'Copri i concetti, i valori numerici, le classificazioni e i confronti più importanti. Da 8 a 25 flashcard.',
  'Scrivi nella lingua degli appunti. Formato, senza altro testo:',
  'D: <domanda>',
  'R: <risposta>'
].join('\n');
const FRONT_SYSTEM = 'Scrivi una sola domanda breve e precisa per una flashcard la cui risposta è il testo indicato. Usa la lingua del testo. Rispondi solo con la domanda, senza virgolette.';

/* ---------------------------------------------------------------------
   Collegamento con StudyHub (stesso dominio: localStorage condiviso)
   Il Notebook scrive gli eventi in "shb-notebook-out"; StudyHub li legge,
   li applica e scrive gli id elaborati in "shb-studyhub-ack".
   --------------------------------------------------------------------- */
const Bridge = {
  OUT: 'shb-notebook-out',
  ACK: 'shb-studyhub-ack',
  read(key) { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } },
  send(ev) {
    const out = this.read(this.OUT);
    out.push({ id: uid(), at: new Date().toISOString(), source: 'notebook', version: 1, ...ev });
    try { localStorage.setItem(this.OUT, JSON.stringify(out)); }
    catch { toast('Impossibile salvare l’evento per StudyHub', 'err'); }
  },
  pending() { return this.read(this.OUT).length; },
  async prune() {
    const acks = new Set(this.read(this.ACK));
    if (!acks.size) return;
    const out = this.read(this.OUT);
    const done = out.filter(e => acks.has(e.id));
    if (!done.length) return;
    localStorage.setItem(this.OUT, JSON.stringify(out.filter(e => !acks.has(e.id))));
    for (const ev of done) {
      if (ev.type !== 'topic-studied') continue;
      const sec = secById(ev.sectionId);
      if (sec && sec.studyhub && sec.studyhub.status !== 'received') {
        sec.studyhub = { ...sec.studyhub, status: 'received', receivedOn: todayStr() };
        await saveSection(sec);
      }
    }
  }
};

function deepLink(sec, mode = defaultMode(sec)) {
  return `${location.origin}${location.pathname}#/sec/${sec.id}/${mode}`;
}
async function markStudiedInStudyHub(sec) {
  const nb = nbById(sec.notebookId);
  Bridge.send({
    type: 'topic-studied',
    sectionId: sec.id,
    notebookId: sec.notebookId,
    subject: nb ? nb.name : '',
    topic: sec.title,
    studiedOn: todayStr(),
    url: deepLink(sec)
  });
  sec.studyhub = { status: 'pending', since: todayStr() };
  await saveSection(sec);
  toast('Segnata come studiata: StudyHub pianificherà i ripassi');
}
async function unlinkFromStudyHub(sec) {
  Bridge.send({ type: 'topic-unlinked', sectionId: sec.id, notebookId: sec.notebookId, subject: nbById(sec.notebookId)?.name || '', topic: sec.title });
  delete sec.studyhub;
  sec.srs = { ...(sec.srs || newSrs()), due: addDays(todayStr(), 1), interval: Math.max(1, sec.srs?.interval || 1) };
  await saveSection(sec);
  toast('I ripassi tornano nel Notebook');
}
function studyhubStatusText(sec) {
  if (!sec.studyhub) return '';
  return sec.studyhub.status === 'received'
    ? 'StudyHub ha ricevuto l’argomento e ne pianifica i ripassi.'
    : 'In attesa che StudyHub la riceva: apri StudyHub su questo dispositivo.';
}

/* ---------------------------------------------------------------------
   Sincronizzazione con Google Drive (tramite il tuo script Apps Script)
   --------------------------------------------------------------------- */
const SYNC_STORES = ['notebooks', 'sections', 'cards'];

const Sync = {
  META: 'nb-sync-meta',
  busy: false,
  again: false,
  timer: null,
  errShown: false,
  meta() { try { return JSON.parse(localStorage.getItem(this.META) || '{}'); } catch { return {}; } },
  saveMeta(m) { try { localStorage.setItem(this.META, JSON.stringify(m)); } catch { /* spazio pieno */ } },
  configured() { return !!((S().syncUrl || '').trim() && (S().syncSecret || '').trim()); },
  schedule(ms = 8000) {
    if (!this.configured()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.run({ silent: true }); }, ms);
  },
  async post(body) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 150000);
    let res;
    try {
      res = await fetch(S().syncUrl.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: ctl.signal,
        redirect: 'follow'
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'Drive non risponde: riprova più tardi.' : 'Connessione a Drive non riuscita. Controlla internet.');
    } finally { clearTimeout(t); }
    const txt = await res.text();
    let data;
    try { data = JSON.parse(txt); }
    catch { throw new Error('Risposta non valida: controlla l’indirizzo e che l’app web sia distribuita con accesso “Chiunque”.'); }
    if (!data.ok) throw new Error(data.error || 'Errore di sincronizzazione');
    return data;
  },
  async run({ silent = false } = {}) {
    if (!this.configured()) { if (!silent) toast('Configura prima la sincronizzazione in Impostazioni', 'err'); return false; }
    if (this.busy) { this.again = true; return false; }
    this.busy = true;
    clearTimeout(this.timer);
    this.timer = null;
    setSyncStatus('Sincronizzazione in corso…');
    const m = this.meta();
    const url = S().syncUrl.trim();
    if (m.url !== url) { m.url = url; m.rev = 0; m.lastPush = 0; }
    const startedAt = Date.now();
    try {
      const changes = await collectChanges(m.lastPush || 0);
      const batches = chunkRecords(changes, 2500000);
      let pulled = [];
      let rev = m.rev || 0;
      for (let i = 0; i < batches.length; i++) {
        const last = i === batches.length - 1;
        if (batches.length > 1) setSyncStatus(`Invio dei dati ${i + 1} di ${batches.length}…`);
        // le immagini si leggono solo al momento dell’invio, un gruppo alla volta
        for (const rec of batches[i]) {
          if (rec.store === 'images' && !rec.deleted && !rec.data) {
            const im = imageById(rec.id);
            if (im && im.blob) rec.data = await blobToBase64(im.blob);
          }
        }
        const payload = batches[i].map(({ _est, ...rec }) => rec);
        const r = await this.post({ secret: S().syncSecret.trim(), action: 'sync', since: m.rev || 0, records: payload, pull: last });
        batches[i].forEach(rec => { delete rec.data; });
        rev = r.rev;
        if (last) pulled = r.records || [];
      }
      let changed = await applyRemote(pulled);
      const imgChanged = await syncImages(pulled.filter(x => x.store === 'images'));
      if (imgChanged) rehydrateMissing();
      changed += imgChanged;
      m.rev = rev;
      m.lastPush = startedAt;
      m.lastSync = Date.now();
      m.error = '';
      this.saveMeta(m);
      this.errShown = false;
      setSyncStatus();
      if (changed) refreshAfterSync();
      if (!silent) toast(changed ? `Sincronizzato: ${changed} ${changed === 1 ? 'elemento aggiornato' : 'elementi aggiornati'}` : 'Sincronizzato');
      return true;
    } catch (e) {
      m.error = e.message;
      this.saveMeta(m);
      setSyncStatus();
      if (!silent || !this.errShown) { toast(e.message, 'err'); this.errShown = true; }
      return false;
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; this.schedule(1500); }
    }
  }
};
function scheduleSync() { Sync.schedule(); }

async function collectChanges(since) {
  const out = [];
  for (const store of SYNC_STORES) {
    for (const r of state[store]) {
      if (since === 0 || (r.updated || 0) > since) {
        out.push({ store, id: r.id, updated: r.updated || r.created || 1, notebookId: store === 'notebooks' ? r.id : r.notebookId, data: r });
      }
    }
  }
  for (const im of state.images) {
    if (since === 0 || (im.updated || 0) > since) {
      out.push({
        store: 'images', id: im.id, updated: im.updated || im.created || 1, notebookId: im.notebookId,
        meta: { mime: im.mime, w: im.w, h: im.h, size: im.size, created: im.created },
        _est: Math.ceil((im.size || 0) * 1.4) + 300
      });
    }
  }
  const dels = await DB.all('deleted');
  for (const t of dels) {
    if (since === 0 || t.updated > since) out.push({ store: t.store, id: t.recId, updated: t.updated, notebookId: t.notebookId, deleted: true });
  }
  return out;
}
function chunkRecords(records, maxChars) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const r of records) {
    const len = r._est || JSON.stringify(r).length;
    if (cur.length && size + len > maxChars) { out.push(cur); cur = []; size = 0; }
    cur.push(r);
    size += len;
  }
  out.push(cur);
  return out;
}
function normalizeRecord(store, d) {
  if (store === 'sections') return { ...newSection(d.notebookId), ...d, srs: { ...newSrs(), ...(d.srs || {}) } };
  if (store === 'cards') return { ...newCard(d.notebookId), ...d, srs: { ...newCardSrs(), ...(d.srs || {}) } };
  return { ...d };
}
async function applyRemote(records) {
  if (!records.length) return 0;
  const tombs = new Map((await DB.all('deleted')).map(t => [t.id, t]));
  const puts = { notebooks: [], sections: [], cards: [] };
  const dels = [];
  let changed = 0;
  for (const r of records) {
    if (!SYNC_STORES.includes(r.store) || !r.id) continue;
    const arr = state[r.store];
    const i = arr.findIndex(x => x.id === r.id);
    const local = i >= 0 ? arr[i] : null;
    if (r.deleted) {
      if (local && (local.updated || 0) <= r.updated) { arr.splice(i, 1); dels.push([r.store, r.id]); changed++; }
      continue;
    }
    if (!r.data) continue;
    const tomb = tombs.get(`${r.store}:${r.id}`);
    if (tomb && tomb.updated >= (r.updated || 0)) continue;
    if (!local || (r.updated || 0) > (local.updated || 0)) {
      const rec = normalizeRecord(r.store, r.data);
      rec.updated = r.updated;
      if (i >= 0) arr[i] = rec; else arr.push(rec);
      puts[r.store].push(rec);
      changed++;
    }
  }
  for (const st of SYNC_STORES) if (puts[st].length) await DB.bulkPut(st, puts[st]);
  if (dels.length) await DB.removeMany(dels);
  updateBadge();
  return changed;
}
async function syncImages(recs) {
  if (!recs.length) return 0;
  const tombs = new Map((await DB.all('deleted')).map(t => [t.id, t]));
  const need = [];
  let changed = 0;
  for (const r of recs) {
    const local = imageById(r.id);
    if (r.deleted) {
      if (local && (local.updated || 0) <= r.updated) {
        await DB.removeMany([['images', r.id]]);
        state.images = state.images.filter(i => i.id !== r.id);
        forgetImageUrl(r.id);
        changed++;
      }
      continue;
    }
    const t = tombs.get(`images:${r.id}`);
    if (t && t.updated >= (r.updated || 0)) continue;
    if (!local || (r.updated || 0) > (local.updated || 0)) need.push(r);
  }
  let queue = need.map(r => r.id);
  const total = queue.length;
  while (queue.length) {
    setSyncStatus(`Scarico le immagini: ${total - queue.length} di ${total}…`);
    const ids = queue.slice(0, 25);
    const res = await Sync.post({ secret: S().syncSecret.trim(), action: 'images', ids });
    const got = res.images || [];
    const recsIn = got.map(g => {
      const info = need.find(r => r.id === g.id) || {};
      const meta = g.meta || info.meta || {};
      return {
        id: g.id, notebookId: g.notebookId || info.notebookId, mime: g.mime || meta.mime,
        w: meta.w, h: meta.h, size: meta.size, created: meta.created || Date.now(),
        updated: g.updated || info.updated, blob: base64ToBlob(g.data, g.mime || meta.mime)
      };
    });
    if (recsIn.length) {
      await DB.bulkPut('images', recsIn);
      recsIn.forEach(rec => {
        forgetImageUrl(rec.id);
        const k = state.images.findIndex(x => x.id === rec.id);
        if (k < 0) state.images.push(rec); else state.images[k] = rec;
      });
      changed += recsIn.length;
    }
    const done = new Set([...got.map(g => g.id), ...(res.missing || [])]);
    if (!done.size) break;
    queue = queue.filter(id => !done.has(id));
  }
  return changed;
}

function refreshAfterSync() {
  const h = location.hash || '#/notebooks';
  if (/^#\/(notebooks|nb\/|review|cards|deck\/)/.test(h) || h === '#/' || h === '') route();
  else toast('Dati aggiornati da un altro dispositivo');
}
function syncStatusText() {
  if (!Sync.configured()) return 'Non configurata: i dati restano solo su questo dispositivo.';
  const m = Sync.meta();
  if (m.error) return `Ultimo tentativo non riuscito: ${m.error}`;
  if (!m.lastSync) return 'Configurata, mai sincronizzata.';
  const d = new Date(m.lastSync);
  return `Ultima sincronizzazione: ${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} alle ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}.`;
}
function setSyncStatus(text) {
  const el = $('#syStatus');
  if (el) el.textContent = text || syncStatusText();
}

/* ---------------------------------------------------------------------
   Creazione di flashcard (anche dal testo selezionato)
   --------------------------------------------------------------------- */
function openCardSheet({ front = '', back = '', sectionId = null, notebookId, heading = 'Nuova flashcard' }) {
  return new Promise(resolve => {
    const root = $('#modalRoot');
    const prevFocus = document.activeElement;
    const sec = sectionId ? secById(sectionId) : null;
    root.innerHTML = `
      <div class="overlay">
        <div class="modal sheet" role="dialog" aria-modal="true" aria-labelledby="csTitle">
          <h2 id="csTitle">${esc(heading)}</h2>
          ${sec ? `<p class="sheet-sub">Dalla sezione ${esc(sec.title)}</p>` : ''}
          ${cardFieldToolsHtml()}
          <label class="field"><span>Fronte, la domanda</span>
            <textarea class="input card-ta" id="csFront" rows="3">${esc(front)}</textarea></label>
          ${AI.ready() ? `<button class="btn sm" data-cs="ai" type="button">Proponi la domanda con ${AI.name()}</button>` : ''}
          <label class="field"><span>Retro, la risposta</span>
            <textarea class="input card-ta" id="csBack" rows="5">${esc(back)}</textarea></label>
          <div class="modal-actions">
            <button class="btn ghost" data-cs="no" type="button">Annulla</button>
            <button class="btn primary" data-cs="yes" type="button">Crea la flashcard</button>
          </div>
        </div>
      </div>`;
    const fEl = $('#csFront', root);
    const bEl = $('#csBack', root);
    bindCardFieldTools(root, front ? [fEl, bEl] : [bEl, fEl], notebookId);
    const close = v => {
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      resolve(v);
    };
    const save = async () => {
      if (!fEl.value.trim()) { toast('Scrivi la domanda sul fronte'); fEl.focus(); return; }
      if (!bEl.value.trim()) { toast('Scrivi la risposta sul retro'); bEl.focus(); return; }
      const card = newCard(notebookId, { front: fEl.value.trim(), back: bEl.value.trim(), sectionId });
      await saveCard(card);
      toast('Flashcard creata');
      close(card);
    };
    const onKey = e => {
      if (!fEl.isConnected) return; // è aperta la scrittura a mano
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
    };
    $('[data-cs="no"]', root).onclick = () => close(null);
    $('[data-cs="yes"]', root).onclick = save;
    const aiBtn = $('[data-cs="ai"]', root);
    if (aiBtn) aiBtn.onclick = async () => {
      if (!bEl.value.trim()) { toast('Scrivi prima la risposta'); return; }
      aiBtn.disabled = true;
      aiBtn.textContent = 'Scrivo la domanda…';
      try {
        const ctx = sec ? `ARGOMENTO: ${sec.title}\n\nCONTESTO:\n${aiText(sec.md).slice(0, 5000)}\n\n` : '';
        const r = await AI.generate({ system: FRONT_SYSTEM, text: `${ctx}RISPOSTA DELLA FLASHCARD:\n${bEl.value.trim()}`, maxTokens: 3000 });
        fEl.value = r.text.trim().split('\n').find(l => l.trim())?.replace(/^(D|Domanda)\s*:\s*/i, '').trim() || fEl.value;
      } catch (err) { toast(err.message, 'err'); }
      aiBtn.disabled = false;
      aiBtn.textContent = `Proponi la domanda con ${AI.name()}`;
    };
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => (front ? bEl : fEl).focus(), 40);
  });
}

/* Scheda "Flashcard" di una sezione */
function modeCards(sec, body) {
  const cards = cardsOfSection(sec.id);
  const czCount = clozeCardsFromMd(sec.md).length;
  const qs = sec.questions || [];
  body.innerHTML = `
    <div class="row-actions">
      ${cards.length ? `<a class="btn primary" href="#/study/sec-${sec.id}">Studia queste flashcard</a>` : ''}
      <button class="btn" data-act="new-card">Nuova flashcard</button>
    </div>
    <p class="hint">Puoi anche selezionare del testo in Leggi e toccare “Crea flashcard dalla selezione”.</p>
    ${czCount || qs.length || AI.ready() ? `
      <h2 class="sub">Crea in blocco</h2>
      <div class="row-actions">
        ${czCount ? `<button class="btn sm" data-gen="cloze">Dai termini cloze (${czCount})</button>` : ''}
        ${qs.length ? `<button class="btn sm" data-gen="qs">Dalle domande (${qs.length})</button>` : ''}
        ${AI.ready() ? `<button class="btn sm" data-gen="ai">Genera con ${AI.name()}</button>` : ''}
      </div>
      <div id="genOut"></div>` : ''}
    <h2 class="sub">Image occlusion</h2>
    <p class="hint">Copri le etichette di uno schema: ogni riquadro diventa una flashcard. Puoi anche toccare un’immagine in Leggi.</p>
    <div class="row-actions"><button class="btn sm" data-act="io-new">Scegli l’immagine</button></div>
    ${cards.length ? `
      <h2 class="sub">${cards.length} ${cards.length === 1 ? 'flashcard' : 'flashcard'} in questa sezione</h2>
      <ul class="list">${cards.map(cardRow).join('')}</ul>` : ''}
  `;
  on('[data-act="new-card"]', 'click', async () => {
    const c = await openCardSheet({ sectionId: sec.id, notebookId: sec.notebookId });
    if (c) route();
  }, body);
  on('[data-act="io-new"]', 'click', async () => {
    const id = await pickImage(imageRefs(sec.md), sec.notebookId);
    if (id) openOcclusionEditor({ imageId: id, notebookId: sec.notebookId, sectionId: sec.id });
  }, body);

  const showCandidates = list => {
    const existing = new Set(cardsOfSection(sec.id).map(c => c.front.trim().toLowerCase()));
    const out = $('#genOut', body);
    if (!list.length) { out.innerHTML = '<p class="hint">Nessuna flashcard trovata.</p>'; return; }
    out.innerHTML = `
      <ul class="cand">
        ${list.map((c, i) => {
          const dup = existing.has(c.front.trim().toLowerCase());
          return `<li><label class="check">
            <input type="checkbox" data-i="${i}" ${dup ? '' : 'checked'}>
            <span><span class="cand-f">${esc(plainText(c.front, 220))}</span><span class="cand-b">${esc(plainText(c.back, 160))}</span>${dup ? '<small class="cand-dup">Già presente</small>' : ''}</span>
          </label></li>`;
        }).join('')}
      </ul>
      <div class="row-actions"><button class="btn primary" data-act="save-cand">Crea le flashcard selezionate</button></div>`;
    $('[data-act="save-cand"]', out).addEventListener('click', async () => {
      const picked = $$('input[data-i]:checked', out).map(x => list[+x.dataset.i]);
      if (!picked.length) { toast('Seleziona almeno una flashcard'); return; }
      await saveCards(picked.map(c => newCard(sec.notebookId, { front: c.front, back: c.back, sectionId: sec.id })));
      toast(`${picked.length} flashcard create`);
      route();
    });
  };
  on('[data-gen]', 'click', async e => {
    const kind = e.currentTarget.dataset.gen;
    if (kind === 'cloze') return showCandidates(clozeCardsFromMd(sec.md));
    if (kind === 'qs') return showCandidates(qs.map(q => ({ front: q.q, back: q.a || '' })).filter(c => c.back));
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Genero le flashcard…';
    try {
      const r = await AI.generate({ system: CARDS_SYSTEM, text: aiText(sec.md), maxTokens: 8000 });
      showCandidates(parseQuestions(r.text).map(q => ({ front: q.q, back: q.a })).filter(c => c.back));
    } catch (err) { toast(err.message, 'err'); }
    btn.disabled = false;
    btn.textContent = `Genera con ${AI.name()}`;
  }, body);
}

/* ---------------------------------------------------------------------
   Viste delle flashcard
   --------------------------------------------------------------------- */
function viewCardsHome() {
  const nbs = [...state.notebooks].sort((a, b) => a.created - b.created);
  const all = cardCounts(state.cards);
  const total = all.n + all.l + all.r;
  setView(`
    <header class="page-head">
      <div>
        <h1>Flashcard</h1>
        <p class="lede">${state.cards.length ? (total ? `${total} da studiare adesso.` : 'Niente da studiare adesso.') : 'Nessuna flashcard ancora.'}</p>
      </div>
      ${total ? '<a class="btn primary" href="#/study/all">Studia tutto</a>' : ''}
    </header>
    ${nbs.length ? `
      <ul class="list">
        ${nbs.map(nb => {
          const cs = cardsOf(nb.id);
          return `<li><a class="row" href="#/deck/${nb.id}">
            <span class="row-main"><span class="row-title">${esc(nb.name)}</span>
            <span class="row-sub">${cs.length ? `${cs.length} flashcard` : 'Nessuna flashcard'}</span></span>
            ${cs.length ? countsHtml(cardCounts(cs)) : ''}
          </a></li>`;
        }).join('')}
      </ul>
      ${state.cards.length ? COUNTS_LEGEND : ''}
      ${!state.cards.length ? '<p class="hint">Crea le flashcard da una sezione: seleziona del testo in Leggi, oppure apri la scheda Flashcard della sezione.</p>' : ''}` : `
      <div class="empty"><p>Crea prima un notebook e importa del materiale.</p><a class="btn primary" href="#/notebooks">Vai ai notebook</a></div>`}
  `);
}

function viewDeck(nbId) {
  const nb = nbById(nbId);
  if (!nb) return notFound('Questo notebook');
  const cards = cardsOf(nbId);
  const cnt = cardCounts(cards);
  const LIMIT = 300;
  setView(`
    <a class="back" href="#/cards">Flashcard</a>
    <header class="page-head">
      <div>
        <h1>${esc(nb.name)}</h1>
        <p class="lede">${cards.length} flashcard</p>
      </div>
      <div class="actions">
        ${cnt.n + cnt.l + cnt.r ? `<a class="btn primary" href="#/study/${nb.id}">Studia</a>` : ''}
        <button class="btn" data-act="new-card">Nuova flashcard</button>
        <a class="btn ghost" href="#/nb/${nb.id}">Apri il notebook</a>
      </div>
    </header>
    ${cards.length ? `
      <div class="deck-counts">${countsHtml(cnt)}</div>
      ${COUNTS_LEGEND}
      ${cards.length > 5 ? '<input type="search" class="input search" id="cardSearch" placeholder="Cerca tra le flashcard" aria-label="Cerca tra le flashcard">' : ''}
      <ul class="list" id="cardList">${cards.slice(0, LIMIT).map(cardRow).join('')}</ul>
      ${cards.length > LIMIT ? `<p class="hint" id="moreHint">Mostro le prime ${LIMIT}: usa la ricerca per trovare le altre.</p>` : ''}` : `
      <div class="empty"><p>Nessuna flashcard in questo notebook. Selezionando del testo in una sezione puoi crearne una in un attimo.</p></div>`}
  `);
  on('[data-act="new-card"]', 'click', async () => {
    const c = await openCardSheet({ notebookId: nb.id });
    if (c) route();
  });
  const search = $('#cardSearch');
  if (search) search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    const list = q ? cards.filter(c => (c.front + '\n' + c.back).toLowerCase().includes(q)) : cards;
    $('#cardList').innerHTML = list.slice(0, LIMIT).map(cardRow).join('') || '<li class="row muted">Nessuna flashcard contiene questo testo.</li>';
  });
}

function viewCardEditor(id) {
  const c = cardById(id);
  if (!c) return notFound('Questa flashcard');
  const back = state.cardReturn && state.cardReturn !== location.hash ? state.cardReturn : `#/deck/${c.notebookId}`;
  const secs = secsOf(c.notebookId);
  const isIo = c.type === 'occlusion';
  setView(`
    <a class="back" href="${esc(back)}">Indietro</a>
    <header class="page-head">
      <div>
        <h1>${isIo ? 'Flashcard a occlusione' : 'Flashcard'}</h1>
        <p class="lede">${esc(nbById(c.notebookId)?.name || '')}, ${cardStatusText(c)}${c.srs.lapses ? `, sbagliata ${c.srs.lapses} ${c.srs.lapses === 1 ? 'volta' : 'volte'}` : ''}</p>
      </div>
    </header>
    <div class="form">
      ${isIo ? `
        <div class="fcard io-preview">${occlusionHtml(c, false)}</div>
        <div class="row-actions"><button class="btn" data-act="io-edit">Modifica i riquadri</button></div>
        <label class="field"><span>Etichetta del riquadro, compare sul retro</span><textarea class="input card-ta" id="ceBack">${esc(c.back)}</textarea></label>` : `
        ${cardFieldToolsHtml()}
        <label class="field"><span>Fronte</span><textarea class="input card-ta" id="ceFront">${esc(c.front)}</textarea></label>
        <label class="field"><span>Retro</span><textarea class="input card-ta" id="ceBack">${esc(c.back)}</textarea></label>`}
      <label class="field"><span>Nota sull’errore, compare dopo la risposta</span>
        <input class="input" id="ceNote" value="${esc(c.note || '')}" placeholder="Es. confondo beta1 e beta2"></label>
      <label class="field"><span>Sezione collegata</span>
        <select class="input" id="ceSec">
          <option value="">Nessuna</option>
          ${secs.map(s => `<option value="${s.id}" ${s.id === c.sectionId ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}
        </select></label>
      ${isIo ? '' : `<details class="preview" id="cePrevBox"><summary>Anteprima</summary>
        <div class="fcard"><div class="notes" id="cePrevF"></div><hr class="fsep"><div class="notes" id="cePrevB"></div></div></details>`}
      <div class="save-bar">
        <button class="btn primary" data-act="save">Salva</button>
        <button class="btn ghost" data-act="suspend">${c.suspended ? 'Riattiva' : 'Sospendi'}</button>
        <button class="btn ghost" data-act="reset">Ricomincia da capo</button>
        <button class="btn ghost danger push" data-act="del">Elimina</button>
      </div>
    </div>
  `);
  const fEl = $('#ceFront');
  const bEl = $('#ceBack');
  if (fEl) bindCardFieldTools($('#view'), [fEl, bEl], c.notebookId);
  const box = $('#cePrevBox');
  if (box) {
    const prev = () => { if (box.open) { $('#cePrevF').innerHTML = renderMd(fEl.value); $('#cePrevB').innerHTML = renderMd(bEl.value); } };
    box.addEventListener('toggle', prev);
    fEl.addEventListener('input', prev);
    bEl.addEventListener('input', prev);
  }
  on('[data-act="io-edit"]', 'click', () => openOcclusionEditor({ imageId: c.io.imageId, notebookId: c.notebookId, sectionId: c.sectionId, group: c.io.group }));
  on('[data-act="save"]', 'click', async () => {
    if (!isIo && !fEl.value.trim()) { toast('Il fronte non può essere vuoto'); fEl.focus(); return; }
    const before = cardImageRefs(c);
    if (!isIo) c.front = fEl.value.trim();
    c.back = bEl.value.trim();
    c.note = $('#ceNote').value.trim();
    c.sectionId = $('#ceSec').value || null;
    await saveCard(c);
    await removeOrphanImages(before);
    toast('Flashcard salvata');
    go(back);
  });
  on('[data-act="suspend"]', 'click', async () => {
    c.suspended = !c.suspended;
    await saveCard(c);
    toast(c.suspended ? 'Flashcard sospesa: non comparirà nei ripassi' : 'Flashcard riattivata');
    if (session && session.current === c.id && c.suspended) session.current = null;
    route();
  });
  on('[data-act="reset"]', 'click', async () => {
    const ok = await modal({ title: 'Ricominciare da capo?', text: 'La flashcard torna nuova e perde lo storico dei ripassi.', confirm: 'Ricomincia' });
    if (!ok) return;
    c.srs = newCardSrs();
    await saveCard(c);
    toast('La flashcard è di nuovo nuova');
    route();
  });
  on('[data-act="del"]', 'click', async () => {
    const ok = await modal({ title: 'Eliminare la flashcard?', text: 'L’operazione non si può annullare.', confirm: 'Elimina', danger: true });
    if (!ok) return;
    if (session && session.current === c.id) session.current = null;
    const refs = cardImageRefs(c);
    await removeRecords([{ store: 'cards', rec: c }]);
    await removeOrphanImages(refs);
    toast('Flashcard eliminata');
    go(back);
  });
}

/* Sessione di studio stile Anki */
let session = null;

function scopeCards(scope) {
  if (scope === 'all') return state.cards.filter(c => !c.suspended);
  if (scope.startsWith('sec-')) { const id = scope.slice(4); return state.cards.filter(c => c.sectionId === id && !c.suspended); }
  return state.cards.filter(c => c.notebookId === scope && !c.suspended);
}
function scopeTitle(scope) {
  if (scope === 'all') return 'Tutte le flashcard';
  if (scope.startsWith('sec-')) return secById(scope.slice(4))?.title || 'Sezione';
  return nbById(scope)?.name || 'Flashcard';
}
function scopeBack(scope) {
  if (scope === 'all') return '#/cards';
  if (scope.startsWith('sec-')) return `#/sec/${scope.slice(4)}/cards`;
  return `#/deck/${scope}`;
}
function startSession(scope) {
  const now = Date.now();
  const cards = scopeCards(scope);
  const reviews = cards.filter(c => c.srs.state === 'review' && c.srs.due <= now).sort((a, b) => a.srs.due - b.srs.due || a.order - b.order);
  let news = cards.filter(c => c.srs.state === 'new').sort((a, b) => a.order - b.order);
  if (!scope.startsWith('sec-')) {
    // limite giornaliero di nuove per notebook (in una sola sezione studi tutto)
    const left = {};
    news = news.filter(c => {
      if (!(c.notebookId in left)) left[c.notebookId] = newLeftToday(c.notebookId);
      if (left[c.notebookId] > 0) { left[c.notebookId]--; return true; }
      return false;
    });
  }
  session = { scope, queue: [...reviews, ...news].map(c => c.id), done: 0, undo: [], learned: [], current: null, revealed: false };
}
function pickNext() {
  const now = Date.now();
  const learning = scopeCards(session.scope)
    .filter(c => c.srs.state === 'learning' || c.srs.state === 'relearning')
    .sort((a, b) => a.srs.due - b.srs.due);
  if (learning.length && learning[0].srs.due <= now) return learning[0];
  while (session.queue.length) {
    const c = cardById(session.queue[0]);
    if (c && !c.suspended && (c.srs.state === 'new' || (c.srs.state === 'review' && c.srs.due <= now))) return c;
    session.queue.shift();
  }
  if (learning.length && learning[0].srs.due <= now + LEARN_AHEAD) return learning[0];
  return null;
}
function sessionCounts() {
  const now = Date.now();
  let n = 0, r = 0;
  for (const id of session.queue) {
    const c = cardById(id);
    if (!c || c.suspended) continue;
    if (c.srs.state === 'new') n++;
    else if (c.srs.state === 'review' && c.srs.due <= now) r++;
  }
  const l = scopeCards(session.scope).filter(c => (c.srs.state === 'learning' || c.srs.state === 'relearning') && c.srs.due <= now + LEARN_AHEAD).length;
  return { n, l, r };
}

function viewStudy(scope) {
  if (!scope) scope = 'all';
  if (!session || session.scope !== scope) startSession(scope);
  renderStudy();
}

function resetCleanups() {
  cleanups.forEach(fn => { try { fn(); } catch { /* ignora */ } });
  cleanups = [];
}

function renderStudy() {
  resetCleanups();
  if (session.notePending) return renderNotePrompt();
  const sc = session.scope;
  let card = session.current ? cardById(session.current) : null;
  if (card && card.suspended) card = null;
  if (!card) { card = pickNext(); session.current = card ? card.id : null; session.revealed = false; }
  if (!card) return renderStudyDone();
  const sec = card.sectionId ? secById(card.sectionId) : null;
  const now = Date.now();
  setView(`
    <a class="back" href="${scopeBack(sc)}">${esc(sc === 'all' ? 'Flashcard' : scopeTitle(sc))}</a>
    <header class="study-head">
      <h1>${esc(scopeTitle(sc))}</h1>
      ${countsHtml(sessionCounts())}
    </header>
    <article class="fcard study ${card.type === 'occlusion' ? 'is-io' : ''}">
      ${cardFaceHtml(card, session.revealed)}
      ${session.revealed && card.note ? `<p class="card-note"><strong>La tua nota sull’errore:</strong> ${esc(card.note)}</p>` : ''}
    </article>
    <div class="board">
      <button class="btn sm ghost board-toggle" data-act="board" aria-expanded="${S().boardOpen}">${S().boardOpen ? 'Chiudi la lavagna' : 'Lavagna: scrivi la risposta a mano'}</button>
      ${S().boardOpen ? `<div class="board-wrap">${penToolsHtml({ colors: false })}<canvas class="board-canvas" id="boardCanvas" aria-label="Lavagna per scrivere la risposta"></canvas></div>` : ''}
    </div>
    <div class="study-actions">
      ${session.revealed ? `
        <div class="grade-btns">
          ${CARD_GRADES.map((g, i) => `<button class="gbtn g-${g.key}" data-g="${g.key}" aria-keyshortcuts="${i + 1}">
            <span>${g.label}</span><small>${fmtCardNext(scheduleCard(card.srs, g.key, now, true), now)}</small></button>`).join('')}
        </div>` : '<button class="btn primary block big" data-act="reveal" aria-keyshortcuts="Space">Mostra la risposta</button>'}
    </div>
    <div class="study-tools">
      <button class="btn sm ghost" data-act="undo" ${session.undo.length ? '' : 'disabled'}>Annulla l’ultima</button>
      <a class="btn sm ghost" href="#/card/${card.id}">Modifica</a>
      <button class="btn sm ghost" data-act="suspend">Sospendi</button>
    </div>
    ${sec ? `<p class="source">Dalla sezione <a href="#/sec/${sec.id}/read">${esc(sec.title)}</a></p>` : ''}
    <p class="hint kbd-hint">Spazio mostra la risposta, 1-4 per valutare, Ctrl+Z annulla.</p>
  `);
  on('[data-act="reveal"]', 'click', () => { session.revealed = true; renderStudy(); });
  on('[data-act="board"]', 'click', () => { S().boardOpen = !S().boardOpen; Settings.save(); renderStudy(); });
  const boardCanvas = $('#boardCanvas');
  if (boardCanvas) {
    if (session.boardCard !== card.id) { session.boardCard = card.id; session.board = []; }
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#e7edf5';
    const pad = createPad(boardCanvas, { strokes: session.board, color: ink, size: 2.4, onChange: st => { session.board = st; } });
    bindPenTools($('.board-wrap'), pad);
    addCleanup(() => pad.destroy());
  }
  on('[data-g]', 'click', e => answerCard(e.currentTarget.dataset.g));
  on('[data-act="undo"]', 'click', undoAnswer);
  on('[data-act="suspend"]', 'click', async () => {
    card.suspended = true;
    await saveCard(card);
    session.current = null;
    toast('Flashcard sospesa');
    renderStudy();
  });
  const onKey = e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || $('#modalRoot').children.length) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoAnswer(); return; }
    if (!session.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); session.revealed = true; renderStudy(); return; }
    const i = ['1', '2', '3', '4'].indexOf(e.key);
    if (session.revealed && i >= 0) { e.preventDefault(); answerCard(CARD_GRADES[i].key); }
  };
  document.addEventListener('keydown', onKey);
  addCleanup(() => document.removeEventListener('keydown', onKey));
}

let answering = false;
async function answerCard(grade) {
  if (answering) return;
  const c = cardById(session.current);
  if (!c) return;
  answering = true;
  try {
    const prev = JSON.parse(JSON.stringify(c.srs));
    const wasLearned = c.sectionId ? sectionLearned(c.sectionId) : true;
    c.srs = scheduleCard(c.srs, grade);
    await saveCard(c);
    session.undo.push({ id: c.id, prev, inQueue: session.queue.includes(c.id) });
    if (session.undo.length > 30) session.undo.shift();
    session.queue = session.queue.filter(id => id !== c.id);
    session.done += 1;
    if (c.sectionId && !wasLearned && sectionLearned(c.sectionId)) {
      const sec = secById(c.sectionId);
      if (sec && !sec.studyhub && !session.learned.includes(sec.id)) session.learned.push(sec.id);
    }
    session.current = null;
    session.revealed = false;
    if (grade === 'again' && S().askNote) session.notePending = c.id;
  } finally { answering = false; }
  renderStudy();
}
function renderNotePrompt() {
  const c = cardById(session.notePending);
  if (!c) { session.notePending = null; return renderStudy(); }
  setView(`
    <a class="back" href="${scopeBack(session.scope)}">${esc(session.scope === 'all' ? 'Flashcard' : scopeTitle(session.scope))}</a>
    <header class="page-head"><div><h1>Perché l’hai sbagliata?</h1>
      <p class="lede">Una riga basta: la ritroverai dopo la risposta, al prossimo ripasso.</p></div></header>
    <div class="fcard note-card">${c.type === 'occlusion' ? occlusionHtml(c, true) : `<div class="notes">${renderMd(c.front)}</div>`}</div>
    <label class="sr-only" for="noteIn">Nota sull’errore</label>
    <input class="input note-in" id="noteIn" value="${esc(c.note || '')}" placeholder="Es. confondo beta1 e beta2" autocomplete="off">
    <div class="row-actions">
      <button class="btn primary" data-act="note-save">Salva la nota</button>
      <button class="btn ghost" data-act="note-skip">Salta</button>
    </div>
    <p class="hint">Puoi disattivare questa domanda in Impostazioni.</p>
  `);
  const input = $('#noteIn');
  const finish = async save => {
    session.notePending = null;
    if (save) {
      const v = input.value.trim();
      if (v !== (c.note || '')) { c.note = v; await saveCard(c); }
    }
    renderStudy();
  };
  on('[data-act="note-save"]', 'click', () => finish(true));
  on('[data-act="note-skip"]', 'click', () => finish(false));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  setTimeout(() => input.focus({ preventScroll: true }), 50);
}

async function undoAnswer() {
  if (session.notePending) session.notePending = null;
  const last = session.undo.pop();
  if (!last) return;
  const c = cardById(last.id);
  if (!c) return;
  c.srs = last.prev;
  await saveCard(c);
  if (last.inQueue && !session.queue.includes(c.id)) session.queue.unshift(c.id);
  if (c.sectionId && !sectionLearned(c.sectionId)) session.learned = session.learned.filter(id => id !== c.sectionId);
  session.done = Math.max(0, session.done - 1);
  session.current = c.id;
  session.revealed = false;
  renderStudy();
}

function renderStudyDone() {
  resetCleanups();
  const sc = session.scope;
  const now = Date.now();
  const later = scopeCards(sc).filter(c => (c.srs.state === 'learning' || c.srs.state === 'relearning')).sort((a, b) => a.srs.due - b.srs.due);
  const learned = session.learned.map(secById).filter(s => s && !s.studyhub);
  const nextMin = later.length ? Math.max(1, Math.round((later[0].srs.due - now) / 60000)) : 0;
  setView(`
    <a class="back" href="${scopeBack(sc)}">${esc(sc === 'all' ? 'Flashcard' : scopeTitle(sc))}</a>
    <header class="page-head">
      <div>
        <h1>Hai finito per ora</h1>
        <p class="lede">${session.done ? `${session.done} ${session.done === 1 ? 'risposta' : 'risposte'} in questa sessione.` : 'Non ci sono flashcard da studiare adesso.'}</p>
      </div>
    </header>
    ${later.length ? `<p>${later.length} ${later.length === 1 ? 'flashcard in apprendimento torna' : 'flashcard in apprendimento tornano'} tra ${nextMin} ${nextMin === 1 ? 'minuto' : 'minuti'}.</p>` : ''}
    ${learned.map(s => `
      <div class="callout learned" data-sec="${s.id}">
        <p>Hai appreso <strong>${esc(s.title)}</strong>. Vuoi segnarla come studiata in StudyHub? StudyHub pianificherà i ripassi successivi.</p>
        <div class="inline">
          <button class="btn primary sm" data-sh="${s.id}">Segna come studiata</button>
          <button class="btn ghost sm" data-skip="${s.id}">Non ora</button>
        </div>
      </div>`).join('')}
    <div class="row-actions">
      ${later.length ? '<button class="btn" data-act="continue">Continua lo stesso</button>' : ''}
      <a class="btn ${learned.length ? 'ghost' : 'primary'}" href="${scopeBack(sc)}">Torna indietro</a>
    </div>
  `);
  on('[data-sh]', 'click', async e => {
    const btn = e.currentTarget;
    const id = btn.dataset.sh;
    btn.disabled = true;
    const s = secById(id);
    if (s) await markStudiedInStudyHub(s);
    session.learned = session.learned.filter(x => x !== id);
    btn.closest('.learned')?.remove();
  });
  on('[data-skip]', 'click', e => {
    session.learned = session.learned.filter(id => id !== e.currentTarget.dataset.skip);
    e.currentTarget.closest('.learned').remove();
  });
  on('[data-act="continue"]', 'click', () => {
    // studia in anticipo le carte in apprendimento
    session.current = later[0].id;
    session.revealed = false;
    renderStudy();
  });
}

/* Eliminazione con traccia per la sincronizzazione */
async function removeRecords(list) {
  if (!list.length) return;
  const now = Date.now();
  const tombs = list.map(({ store, rec }) => ({
    id: `${store}:${rec.id}`, store, recId: rec.id,
    notebookId: store === 'notebooks' ? rec.id : rec.notebookId, updated: now
  }));
  await DB.removeMany(list.map(({ store, rec }) => [store, rec.id]));
  await DB.bulkPut('deleted', tombs);
  list.forEach(({ store, rec }) => { state[store] = state[store].filter(x => x.id !== rec.id); });
  updateBadge();
  scheduleSync();
}

/* ---------------------------------------------------------------------
   Evidenziatore a colori e sottolineatura
   Nel testo: {{y|testo}} giallo, {{g|…}} verde, {{b|…}} azzurro,
   {{p|…}} rosa, {{o|…}} arancio, {{u|…}} sottolineato
   --------------------------------------------------------------------- */
const HL_COLORS = [
  { key: 'y', name: 'Giallo' },
  { key: 'g', name: 'Verde' },
  { key: 'b', name: 'Azzurro' },
  { key: 'p', name: 'Rosa' },
  { key: 'o', name: 'Arancio' }
];
const MARK_RE = /\{\{([uygbpo])\|((?:(?!\{\{|\}\})[^\n])*)\}\}/g;
function renderMarks(src) {
  let out = src;
  // due passaggi: gestisce anche un sottolineato dentro un’evidenziatura
  for (let i = 0; i < 2; i++) {
    out = out.replace(MARK_RE, (m, k, t) => k === 'u' ? `<u class="ul">${t}</u>` : `<mark class="hl hl-${k}">${t}</mark>`);
  }
  return out;
}
const stripMarks = md => {
  let out = md || '';
  for (let i = 0; i < 2; i++) out = out.replace(MARK_RE, '$2');
  return out;
};

/* Dal testo selezionato nella pagina al punto corrispondente del Markdown */
const MARKUP_GAP = '(?:\\*{1,3}|_{1,2}|==|~~|`|\\{\\{[uygbpo]\\||\\}\\}|<[^>\\n]{1,40}>)*';
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function countOccurrences(hay, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}
function findSourceRange(md, selText, occurrence) {
  const t = selText.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 3000) return null;
  const parts = [...t].map(ch => (ch === ' ' ? '\\s+' : escRe(ch)));
  let re;
  try { re = new RegExp(parts.join(MARKUP_GAP), 'g'); } catch { return null; }
  const found = [];
  let m;
  while ((m = re.exec(md))) {
    found.push({ start: m.index, end: m.index + m[0].length });
    if (!m[0].length) re.lastIndex++;
  }
  if (!found.length) return null;
  const r = { ...found[Math.min(occurrence, found.length - 1)] };
  // non spezzare grassetti, cloze o evidenziature a metà
  const slice = () => md.slice(r.start, r.end);
  if ((slice().match(/\*\*/g) || []).length % 2) {
    if (md.slice(r.end, r.end + 2) === '**') r.end += 2; else if (md.slice(r.start - 2, r.start) === '**') r.start -= 2;
  }
  if ((slice().match(/==/g) || []).length % 2) {
    if (md.slice(r.end, r.end + 2) === '==') r.end += 2; else if (md.slice(r.start - 2, r.start) === '==') r.start -= 2;
  }
  const opens = (slice().match(/\{\{[uygbpo]\|/g) || []).length;
  const closes = (slice().match(/\}\}/g) || []).length;
  if (opens > closes && md.slice(r.end, r.end + 2) === '}}') r.end += 2;
  if (closes > opens && /\{\{[uygbpo]\|$/.test(md.slice(r.start - 4, r.start))) r.start -= 4;
  return r;
}

// Applica (o toglie) cloze, colore o sottolineatura a un intervallo del Markdown
function applyMarkToMd(md, r, kind) {
  const inner = md.slice(r.start, r.end);
  const before = md.slice(0, r.start);
  const after = md.slice(r.end);
  if (kind === 'cloze') {
    if (before.endsWith('==') && after.startsWith('==')) return before.slice(0, -2) + inner + after.slice(2);
    return `${before}==${inner}==${after}`;
  }
  const wrap = before.match(/\{\{([uygbpo])\|$/);
  if (wrap && after.startsWith('}}')) {
    // stesso tipo: toglie; colore diverso: cambia colore
    if (wrap[1] === kind || kind === 'none') return before.slice(0, -4) + inner + after.slice(2);
    if (kind !== 'u' && wrap[1] !== 'u') return `${before.slice(0, -4)}{{${kind}|${inner}}}${after.slice(2)}`;
  }
  if (kind === 'none') return stripMarksInRange(md, r);
  return `${before}{{${kind}|${inner}}}${after}`;
}
function stripMarksInRange(md, r) {
  return md.slice(0, r.start) + stripMarks(md.slice(r.start, r.end)) + md.slice(r.end);
}
function wrapSelectionInTextarea(ta, open, close) {
  const { selectionStart: s, selectionEnd: en, value: v } = ta;
  if (s === en) { toast('Seleziona prima il testo'); ta.focus(); return false; }
  const sel = v.slice(s, en);
  const lead = sel.match(/^\s*/)[0];
  const trail = sel.match(/\s*$/)[0];
  const core = sel.trim();
  let next;
  const already = core.match(/^\{\{([uygbpo])\|([\s\S]*)\}\}$/);
  if (open.startsWith('{{') && already) {
    const k = open.slice(2, 3);
    next = already[1] === k ? already[2] : `${open}${already[2]}${close}`;
  } else if (core.startsWith(open) && core.endsWith(close) && core.length > open.length + close.length) {
    next = core.slice(open.length, -close.length);
  } else next = open + core + close;
  ta.focus();
  ta.setRangeText(lead + next + trail, s, en, 'select');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/* ---------------------------------------------------------------------
   Strumenti sul testo selezionato in Leggi: barra (telefono) e menu del tasto destro (PC)
   --------------------------------------------------------------------- */
function readingToolsHtml() {
  return `
    <button type="button" class="rt-btn" data-rt="cloze" title="Nascondi nel Cloze">Cloze</button>
    <span class="rt-colors" role="group" aria-label="Evidenzia">
      ${HL_COLORS.map(c => `<button type="button" class="rt-dot hl-${c.key}" data-rt="${c.key}" title="Evidenzia in ${c.name.toLowerCase()}" aria-label="Evidenzia in ${c.name.toLowerCase()}"></button>`).join('')}
    </span>
    <button type="button" class="rt-btn rt-u" data-rt="u" title="Sottolinea" aria-label="Sottolinea">S</button>
    <button type="button" class="rt-btn" data-rt="none" title="Togli evidenziatura e sottolineatura" aria-label="Togli evidenziatura e sottolineatura">✕</button>
    <button type="button" class="rt-btn rt-card" data-rt="card">Flashcard</button>`;
}

function setupReadingTools(container, sec) {
  const bar = document.createElement('div');
  bar.className = 'sel-bar rt-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Strumenti per il testo selezionato');
  bar.innerHTML = readingToolsHtml();
  document.body.appendChild(bar);
  const menu = document.createElement('div');
  menu.className = 'rt-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.innerHTML = readingToolsHtml();
  document.body.appendChild(menu);

  let last = null; // { text, occurrence, listText }
  let hideTimer = null;
  const capture = () => {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const pre = document.createRange();
    pre.setStart(container, 0);
    pre.setEnd(range.startContainer, range.startOffset);
    const norm = s => s.replace(/\s+/g, ' ');
    const occurrence = countOccurrences(norm(pre.toString()), norm(text).trim());
    // elenco puntato se la selezione prende più voci
    const lis = $$('li', container).filter(li => range.intersectsNode(li) && !li.querySelector('li'));
    const listText = lis.length > 1 ? lis.map(li => '- ' + li.textContent.trim()).join('\n') : '';
    return { text: text.trim(), occurrence, listText };
  };
  const onSel = () => {
    const c = capture();
    if (c) { clearTimeout(hideTimer); last = c; bar.hidden = false; }
    else if (!bar.hidden) { clearTimeout(hideTimer); hideTimer = setTimeout(() => { bar.hidden = true; }, 700); }
  };
  const closeMenu = () => { menu.hidden = true; };
  const act = async kind => {
    clearTimeout(hideTimer);
    bar.hidden = true;
    closeMenu();
    const c = last;
    if (!c) return;
    document.getSelection()?.removeAllRanges();
    if (kind === 'card') {
      const back = c.listText || c.text;
      const card = await openCardSheet({ back, sectionId: sec.id, notebookId: sec.notebookId });
      if (card) route();
      return;
    }
    const r = findSourceRange(sec.md, c.text, c.occurrence);
    if (!r) { toast('Non riesco a trovare questo testo negli appunti: selezionalo dentro una sola riga o cella', 'err'); return; }
    if (kind === 'cloze' && /\n\s*\n/.test(sec.md.slice(r.start, r.end))) { toast('Per il cloze seleziona testo di un solo paragrafo', 'err'); return; }
    const prevMd = sec.md;
    const next = applyMarkToMd(sec.md, r, kind);
    if (next === prevMd) return;
    sec.md = next;
    await saveSection(sec);
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
    toast(kind === 'cloze' ? 'Cloze aggiornato' : kind === 'none' ? 'Formattazione tolta' : 'Fatto', '', {
      label: 'Annulla',
      fn: async () => {
        if (sec.md !== next) { toast('Non posso annullare: gli appunti sono cambiati nel frattempo', 'err'); return; }
        sec.md = prevMd;
        await saveSection(sec);
        const yy = window.scrollY;
        route();
        window.scrollTo(0, yy);
      }
    });
  };
  [bar, menu].forEach(el => {
    el.addEventListener('pointerdown', e => e.preventDefault()); // la selezione resta
    el.addEventListener('click', e => { const b = e.target.closest('[data-rt]'); if (b) act(b.dataset.rt); });
  });
  const onContext = e => {
    const c = capture();
    if (!c) return; // nessuna selezione: menu normale del browser
    e.preventDefault();
    last = c;
    bar.hidden = true;
    menu.hidden = false;
    const w = menu.offsetWidth || 280;
    const h = menu.offsetHeight || 60;
    menu.style.left = `${Math.max(8, Math.min(e.clientX, window.innerWidth - w - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(e.clientY, window.innerHeight - h - 8))}px`;
  };
  const onDocDown = e => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); };
  const onKey = e => { if (e.key === 'Escape') closeMenu(); };
  document.addEventListener('selectionchange', onSel);
  container.addEventListener('contextmenu', onContext);
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', closeMenu, { passive: true });
  addCleanup(() => {
    clearTimeout(hideTimer);
    document.removeEventListener('selectionchange', onSel);
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', closeMenu);
    bar.remove();
    menu.remove();
  });
}

/* ---------------------------------------------------------------------
   Scrittura a mano: dito, mouse o pennino (con pressione e scarto del palmo)
   --------------------------------------------------------------------- */
function createPad(canvas, { strokes = [], color = '#111111', size = 2.6, onChange = () => {} } = {}) {
  const ctx = canvas.getContext('2d');
  const state2 = { strokes, color, size, tool: 'pen', penSeen: false };
  let cur = null;
  let pid = null;
  const dpr = () => window.devicePixelRatio || 1;
  const widthAt = (s, p) => {
    const base = s.erase ? s.size * 5 : s.size;
    return p.t === 'pen' ? base * (0.35 + (p.p || 0.5) * 1.3) : base;
  };
  const drawSeg = (s, a, b) => {
    ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = (widthAt(s, a) + widthAt(s, b)) / 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  const drawStroke = s => {
    const pts = s.points;
    if (pts.length === 1) drawSeg(s, pts[0], { ...pts[0], x: pts[0].x + 0.01 });
    for (let i = 1; i < pts.length; i++) drawSeg(s, pts[i - 1], pts[i]);
  };
  const redraw = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    state2.strokes.forEach(drawStroke);
    ctx.globalCompositeOperation = 'source-over';
  };
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    canvas.width = Math.round(r.width * dpr());
    canvas.height = Math.round(r.height * dpr());
    redraw();
  };
  const pt = e => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure, t: e.pointerType };
  };
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'pen') state2.penSeen = true;
    if (state2.penSeen && e.pointerType === 'touch') return; // il palmo appoggiato non disegna
    if (cur) return;
    e.preventDefault();
    pid = e.pointerId;
    try { canvas.setPointerCapture(pid); } catch { /* ignora */ }
    const eraser = state2.tool === 'eraser' || (e.buttons & 32) === 32;
    cur = { color: state2.color, size: state2.size, erase: eraser, points: [pt(e)] };
    drawStroke(cur);
  });
  canvas.addEventListener('pointermove', e => {
    if (!cur || e.pointerId !== pid) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = pt(ev);
      const prev = cur.points[cur.points.length - 1];
      if (Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) < 0.6) continue;
      cur.points.push(p);
      drawSeg(cur, prev, p);
    }
  });
  const end = e => {
    if (!cur || e.pointerId !== pid) return;
    state2.strokes.push(cur);
    cur = null;
    pid = null;
    ctx.globalCompositeOperation = 'source-over';
    onChange(state2.strokes);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  return {
    setTool(t) { state2.tool = t; },
    setColor(c) { state2.color = c; },
    setSize(s) { state2.size = s; },
    undo() { state2.strokes.pop(); redraw(); onChange(state2.strokes); },
    clear() { state2.strokes.length = 0; redraw(); onChange(state2.strokes); },
    isEmpty() { return !state2.strokes.some(s => !s.erase); },
    redraw,
    destroy() { ro.disconnect(); },
    // immagine ritagliata intorno al disegno, su fondo bianco
    toCanvas(scale = 2) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      state2.strokes.filter(s => !s.erase).forEach(s => s.points.forEach(p => {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }));
      if (!isFinite(x0)) return null;
      const pad = 16;
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round((x1 - x0) * scale));
      out.height = Math.max(1, Math.round((y1 - y0) * scale));
      const o = out.getContext('2d');
      const layer = document.createElement('canvas');
      layer.width = out.width; layer.height = out.height;
      const l = layer.getContext('2d');
      l.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
      const saved = ctx;
      state2.strokes.forEach(s => {
        const pts = s.points;
        l.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
        l.strokeStyle = s.color; l.lineCap = 'round'; l.lineJoin = 'round';
        for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
          const a = pts[i], b = pts[i + 1] || { ...a, x: a.x + 0.01 };
          l.lineWidth = (widthAt(s, a) + widthAt(s, b)) / 2;
          l.beginPath(); l.moveTo(a.x, a.y); l.lineTo(b.x, b.y); l.stroke();
        }
      });
      void saved;
      o.fillStyle = '#ffffff';
      o.fillRect(0, 0, out.width, out.height);
      o.drawImage(layer, 0, 0);
      return out;
    }
  };
}

const PEN_COLORS = [['#111111', 'Nero'], ['#1d4ed8', 'Blu'], ['#dc2626', 'Rosso'], ['#15803d', 'Verde']];
const PEN_SIZES = [[1.8, 'Fine'], [2.8, 'Media'], [4.5, 'Spessa']];

function penToolsHtml({ colors = true } = {}) {
  return `
    <div class="pen-tools" role="toolbar" aria-label="Strumenti di scrittura">
      <span class="seg sm" role="group" aria-label="Strumento">
        <button type="button" data-tool="pen" aria-pressed="true">Penna</button>
        <button type="button" data-tool="eraser" aria-pressed="false">Gomma</button>
      </span>
      ${colors ? `<span class="pen-colors" role="group" aria-label="Colore">${PEN_COLORS.map(([c, n], i) => `<button type="button" class="pen-dot" data-color="${c}" style="background:${c}" aria-label="${n}" aria-pressed="${i === 0}"></button>`).join('')}</span>` : ''}
      <select class="input pen-size" aria-label="Spessore">${PEN_SIZES.map(([v, n], i) => `<option value="${v}" ${i === 1 ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button type="button" class="btn sm ghost" data-pen="undo">Annulla</button>
      <button type="button" class="btn sm ghost" data-pen="clear">Cancella tutto</button>
    </div>`;
}
function bindPenTools(root, pad) {
  $$('[data-tool]', root).forEach(b => b.addEventListener('click', () => {
    pad.setTool(b.dataset.tool);
    $$('[data-tool]', root).forEach(x => x.setAttribute('aria-pressed', x === b));
  }));
  $$('[data-color]', root).forEach(b => b.addEventListener('click', () => {
    pad.setColor(b.dataset.color);
    pad.setTool('pen');
    $$('[data-tool]', root).forEach(x => x.setAttribute('aria-pressed', x.dataset.tool === 'pen'));
    $$('[data-color]', root).forEach(x => x.setAttribute('aria-pressed', x === b));
  }));
  const size = $('.pen-size', root);
  if (size) size.addEventListener('change', () => pad.setSize(+size.value));
  $('[data-pen="undo"]', root).addEventListener('click', () => pad.undo());
  $('[data-pen="clear"]', root).addEventListener('click', () => pad.clear());
}

/* Scrivi a mano e inserisci come immagine (sezioni e flashcard) */
function openHandwritingPad(notebookId) {
  return new Promise(resolve => {
    const root = $('#modalRoot');
    root.innerHTML = `
      <div class="overlay full">
        <div class="io-editor hw" role="dialog" aria-modal="true" aria-labelledby="hwTitle">
          <header class="io-head">
            <h2 id="hwTitle">Scrivi a mano</h2>
            <p class="hint">Con il pennino il palmo appoggiato viene ignorato. Il tasto gomma del pennino cancella.</p>
            ${penToolsHtml()}
          </header>
          <div class="hw-body"><canvas class="hw-canvas" id="hwCanvas"></canvas></div>
          <footer class="io-foot">
            <span class="hint"></span>
            <button class="btn ghost" data-hw="no" type="button">Annulla</button>
            <button class="btn primary" data-hw="ok" type="button">Inserisci</button>
          </footer>
        </div>
      </div>`;
    const pad = createPad($('#hwCanvas', root));
    bindPenTools(root, pad);
    const close = v => { pad.destroy(); root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); pad.undo(); }
    };
    document.addEventListener('keydown', onKey, true);
    $('[data-hw="no"]', root).onclick = () => close(null);
    $('[data-hw="ok"]', root).onclick = async () => {
      if (pad.isEmpty()) { toast('Scrivi qualcosa prima di inserire'); return; }
      try {
        const c = pad.toCanvas(2);
        let w = c.width, h = c.height;
        let src = c;
        if (Math.max(w, h) > 1600) {
          const k = 1600 / Math.max(w, h);
          src = document.createElement('canvas');
          src.width = Math.round(w * k); src.height = Math.round(h * k);
          src.getContext('2d').drawImage(c, 0, 0, src.width, src.height);
        }
        const im = await saveImage(await canvasToImage(src, 0.9), notebookId);
        close(im);
      } catch (err) { toast(err.message, 'err'); }
    };
  });
}

/* Barra per i campi delle flashcard: elenchi, rientri, immagine, scrittura a mano */
function cardFieldToolsHtml() {
  return `
    <div class="edit-tools card-tools" role="toolbar" aria-label="Formattazione della flashcard">
      <button class="btn sm" type="button" data-ct="list">Elenco</button>
      <button class="btn sm" type="button" data-ct="in" title="Rientra (Tab)" aria-label="Rientra">→</button>
      <button class="btn sm" type="button" data-ct="out" title="Riduci rientro (Maiusc+Tab)" aria-label="Riduci rientro">←</button>
      <button class="btn sm" type="button" data-ct="bold" title="Grassetto" aria-label="Grassetto"><strong>G</strong></button>
      <button class="btn sm" type="button" data-ct="hl">Evidenzia</button>
      <button class="btn sm" type="button" data-ct="img">Immagine</button>
      <button class="btn sm" type="button" data-ct="hw">A mano</button>
    </div>`;
}
function bindCardFieldTools(root, fields, notebookId) {
  let last = fields[fields.length - 1];
  fields.forEach(f => { f.addEventListener('focus', () => { last = f; }); setupListEditing(f); });
  $$('[data-ct]', root).forEach(b => b.addEventListener('pointerdown', e => {
    if (!['img', 'hw'].includes(b.dataset.ct)) e.preventDefault();
  }));
  $$('[data-ct]', root).forEach(b => b.addEventListener('click', async () => {
    const ta = last;
    const k = b.dataset.ct;
    if (k === 'list') {
      const v = ta.value;
      const s = ta.selectionStart;
      const atLineStart = s === 0 || v[s - 1] === '\n';
      insertAtCursor(ta, atLineStart ? '- ' : '\n- ');
    } else if (k === 'in' || k === 'out') { ta.focus(); indentLines(ta, k === 'in' ? 1 : -1); }
    else if (k === 'bold') wrapSelectionInTextarea(ta, '**', '**');
    else if (k === 'hl') wrapSelectionInTextarea(ta, '{{y|', '}}');
    else if (k === 'img') { const im = await addImageFromDevice(notebookId); if (im) insertAtCursor(ta, `\n${imageMd(im.id)}\n`); }
    else if (k === 'hw') { const im = await openHandwritingPadNested(notebookId); if (im) insertAtCursor(ta, `\n${imageMd(im.id)}\n`); }
  }));
}
// La finestra della flashcard usa lo stesso contenitore: la nascondo mentre scrivi a mano
async function openHandwritingPadNested(notebookId) {
  const root = $('#modalRoot');
  const keep = [...root.childNodes];
  keep.forEach(n => n.remove());
  const im = await openHandwritingPad(notebookId);
  root.innerHTML = '';
  keep.forEach(n => root.appendChild(n));
  return im;
}

/* ---------------------------------------------------------------------
   Lettura: carattere, dimensione, interlinea e tema
   --------------------------------------------------------------------- */
const READ_FONTS = {
  literata: '"Literata", Georgia, serif',
  atkinson: '"Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
};
const READ_SIZES = { s: '0.98rem', m: '1.06rem', l: '1.16rem', xl: '1.3rem' };
const READ_LH = { normal: '1.65', wide: '1.85' };

/* ---------------------------------------------------------------------
   Immagini: salvate nel database del browser, compresse, sincronizzate a parte
   Nel testo: ![didascalia](img:ID)
   --------------------------------------------------------------------- */
const IMG_MD_RE = /!\[([^\]\n]*)\]\(img:([a-z0-9]+)\)/g;
const IMG_REF_RE = /\(img:([a-z0-9]+)\)/g;
const imgUrls = new Map();
const imageById = id => state.images.find(i => i.id === id);
const MISSING_IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="100%" height="100%" rx="10" fill="#1b2535"/><text x="50%" y="54%" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#8b9ab0">Immagine non ancora scaricata</text></svg>');

function imageUrl(id) {
  if (imgUrls.has(id)) return imgUrls.get(id);
  const im = imageById(id);
  if (!im || !im.blob) return null;
  const u = URL.createObjectURL(im.blob);
  imgUrls.set(id, u);
  return u;
}
function forgetImageUrl(id) {
  const u = imgUrls.get(id);
  if (u) { URL.revokeObjectURL(u); imgUrls.delete(id); }
}
function hydrateImages(root) {
  if (!root || !root.querySelectorAll) return;
  const list = root.matches && root.matches('img[data-img]') ? [root] : $$('img[data-img]', root);
  list.forEach(img => {
    if (img.dataset.state === 'ok') return;
    const u = imageUrl(img.dataset.img);
    if (u) { img.src = u; img.dataset.state = 'ok'; }
    else if (img.dataset.state !== 'missing') { img.src = MISSING_IMG; img.dataset.state = 'missing'; }
  });
}
function rehydrateMissing() {
  $$('img[data-img][data-state="missing"]').forEach(img => { img.dataset.state = ''; hydrateImages(img); });
}
const imageRefs = text => { const out = []; let m; const re = new RegExp(IMG_REF_RE.source, 'g'); while ((m = re.exec(text || ''))) out.push(m[1]); return out; };
const cardImageRefs = c => [...imageRefs(c.front), ...imageRefs(c.back), ...(c.io ? [c.io.imageId] : [])];
function referencedImages() {
  const set = new Set();
  state.sections.forEach(s => imageRefs(s.md).forEach(id => set.add(id)));
  state.cards.forEach(c => cardImageRefs(c).forEach(id => set.add(id)));
  return set;
}
async function removeOrphanImages(candidates) {
  const used = referencedImages();
  const gone = [...new Set(candidates)].filter(id => !used.has(id)).map(imageById).filter(Boolean);
  if (!gone.length) return 0;
  gone.forEach(im => forgetImageUrl(im.id));
  await removeRecords(gone.map(im => ({ store: 'images', rec: im })));
  return gone.length;
}

async function compressImage(blob, { max = 1600, quality = 0.82 } = {}) {
  let bmp;
  try { bmp = await createImageBitmap(blob); }
  catch { throw new Error('Formato di immagine non supportato.'); }
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  return canvasToImage(c, quality);
}
async function canvasToImage(canvas, quality = 0.85) {
  let out = await new Promise(r => canvas.toBlob(r, 'image/webp', quality));
  if (!out || out.type !== 'image/webp') out = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
  if (!out) throw new Error('Non riesco a elaborare l’immagine.');
  return { blob: out, w: canvas.width, h: canvas.height };
}
async function saveImage({ blob, w, h }, notebookId) {
  const now = Date.now();
  const im = { id: uid(), notebookId, mime: blob.type, w, h, size: blob.size, blob, created: now, updated: now };
  await DB.put('images', im);
  state.images.push(im);
  scheduleSync();
  return im;
}
function chooseImageFile() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}
async function addImageFromDevice(notebookId) {
  const file = await chooseImageFile();
  if (!file) return null;
  try {
    const im = await saveImage(await compressImage(file), notebookId);
    toast('Immagine aggiunta');
    return im;
  } catch (err) { toast(err.message, 'err'); return null; }
}
const imageMd = (id, alt = '') => `![${alt}](img:${id})`;

function insertAtCursor(ta, text) {
  // se non hai ancora toccato il campo, aggiungo in fondo invece che all’inizio
  if (!ta.dataset.touched) ta.setSelectionRange(ta.value.length, ta.value.length);
  const s = ta.selectionStart ?? ta.value.length;
  const e = ta.selectionEnd ?? s;
  ta.focus();
  ta.setRangeText(text, s, e, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'image/webp' });
}
const fmtMB = bytes => `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB`;

/* Immagine a schermo intero, con la scorciatoia per l’image occlusion */
function currentSectionContext() {
  const m = location.hash.match(/^#\/sec\/([^/]+)/);
  const sec = m ? secById(m[1]) : null;
  return sec ? { notebookId: sec.notebookId, sectionId: sec.id } : null;
}
function openLightbox(imageId) {
  if (!imageById(imageId)) return;
  const ctx = currentSectionContext();
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="overlay full lightbox" role="dialog" aria-modal="true" aria-label="Immagine">
      <div class="lb-img"><img class="nb-img" data-img="${imageId}" alt=""></div>
      <div class="lb-actions">
        ${ctx ? '<button class="btn" data-lb="io">Crea image occlusion</button>' : ''}
        <button class="btn primary" data-lb="close">Chiudi</button>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  $('[data-lb="close"]', root).onclick = close;
  const io = $('[data-lb="io"]', root);
  if (io) io.onclick = () => { close(); openOcclusionEditor({ imageId, ...ctx }); };
}

/* Scelta di un’immagine della sezione o caricamento di una nuova */
function pickImage(candidates, notebookId) {
  return new Promise(resolve => {
    const ids = [...new Set(candidates)].filter(id => imageById(id));
    if (!ids.length) { addImageFromDevice(notebookId).then(im => resolve(im ? im.id : null)); return; }
    const root = $('#modalRoot');
    root.innerHTML = `
      <div class="overlay">
        <div class="modal sheet" role="dialog" aria-modal="true" aria-labelledby="pkTitle">
          <h2 id="pkTitle">Scegli l’immagine</h2>
          <div class="pick-grid">
            ${ids.map(id => `<button class="pick" data-pick="${id}" type="button"><img class="nb-img" data-img="${id}" alt="Immagine della sezione"></button>`).join('')}
          </div>
          <div class="modal-actions">
            <button class="btn ghost" data-pk="no" type="button">Annulla</button>
            <button class="btn" data-pk="new" type="button">Carica un’altra immagine</button>
          </div>
        </div>
      </div>`;
    const close = v => { root.innerHTML = ''; resolve(v); };
    $$('[data-pick]', root).forEach(b => b.addEventListener('click', () => close(b.dataset.pick)));
    $('[data-pk="no"]', root).onclick = () => close(null);
    $('[data-pk="new"]', root).onclick = async () => { root.innerHTML = ''; const im = await addImageFromDevice(notebookId); resolve(im ? im.id : null); };
  });
}

/* Disegno di riquadri con dito o mouse, in coordinate relative (0-1) */
function rectDrawing(stage, { canDraw, onDraft, onDone }) {
  let start = null;
  let pid = null;
  const rel = e => {
    const r = stage.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const box = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  stage.addEventListener('pointerdown', e => {
    if (!canDraw() || e.target.closest('.io-mask')) return;
    e.preventDefault();
    start = rel(e);
    pid = e.pointerId;
    try { stage.setPointerCapture(pid); } catch { /* ignora */ }
  });
  stage.addEventListener('pointermove', e => { if (start && e.pointerId === pid) onDraft(box(start, rel(e))); });
  stage.addEventListener('pointerup', e => {
    if (!start || e.pointerId !== pid) return;
    const b = box(start, rel(e));
    start = null;
    onDraft(null);
    if (b.w > 0.015 && b.h > 0.01) onDone(b);
  });
  stage.addEventListener('pointercancel', () => { start = null; onDraft(null); });
}
const posStyle = m => `left:${(m.x * 100).toFixed(3)}%;top:${(m.y * 100).toFixed(3)}%;width:${(m.w * 100).toFixed(3)}%;height:${(m.h * 100).toFixed(3)}%`;

/* Image occlusion: ogni riquadro diventa una flashcard ("nascondi tutto, indovina uno") */
function occlusionHtml(card, revealed) {
  const io = card.io;
  const im = imageById(io.imageId);
  const masks = io.masks.map(m => {
    const target = m.id === io.maskId;
    if (target && revealed) return `<div class="io-mask io-open" style="${posStyle(m)}"></div>`;
    return `<div class="io-mask ${target ? 'io-target' : ''}" style="${posStyle(m)}">${target ? '<span>?</span>' : ''}</div>`;
  }).join('');
  return `<div class="io" ${im ? `style="aspect-ratio:${im.w}/${im.h}"` : ''}><img class="nb-img" data-img="${io.imageId}" alt="Immagine con riquadri" draggable="false">${masks}</div>`;
}
function cardFaceHtml(card, revealed) {
  if (card.type === 'occlusion') {
    return occlusionHtml(card, revealed) + (revealed && card.back.trim() ? `<div class="notes face io-label">${renderMd(card.back)}</div>` : '');
  }
  return `<div class="notes face">${renderMd(card.front)}</div>${revealed ? `<hr class="fsep"><div class="notes face">${renderMd(card.back)}</div>` : ''}`;
}

function openOcclusionEditor({ imageId, notebookId, sectionId = null, group = null }) {
  return new Promise(resolve => {
    const im = imageById(imageId);
    if (!im) { toast('Immagine non disponibile su questo dispositivo', 'err'); resolve(false); return; }
    const groupCards = group ? state.cards.filter(c => c.io && c.io.group === group) : [];
    let masks = group && groupCards.length
      ? groupCards[0].io.masks.map(m => ({ ...m, label: groupCards.find(c => c.io.maskId === m.id)?.back || '' }))
      : [];
    let sel = null;
    let mode = 'draw';
    const root = $('#modalRoot');
    root.innerHTML = `
      <div class="overlay full">
        <div class="io-editor" role="dialog" aria-modal="true" aria-labelledby="ioTitle">
          <header class="io-head">
            <h2 id="ioTitle">Image occlusion</h2>
            <p class="hint">Trascina sull’immagine per coprire ogni etichetta da ricordare: ogni riquadro diventa una flashcard. Tocca un riquadro per selezionarlo.</p>
            <div class="seg sm" role="tablist" aria-label="Modalità">
              <button role="tab" data-mode="draw" aria-selected="true">Disegna</button>
              <button role="tab" data-mode="scroll" aria-selected="false">Scorri</button>
            </div>
          </header>
          <div class="io-body">
            <div class="io io-stage drawing" id="ioStage" style="aspect-ratio:${im.w}/${im.h}">
              <img class="nb-img" data-img="${im.id}" alt="" draggable="false">
              <div id="ioMasks"></div>
              <div class="io-draft" id="ioDraft" hidden></div>
            </div>
          </div>
          <div class="io-sel" id="ioSel" hidden>
            <label class="field"><span>Etichetta del riquadro, facoltativa: compare sul retro</span>
              <input class="input" id="ioLabel" autocomplete="off"></label>
            <button class="btn sm ghost danger" data-io="del" type="button">Elimina il riquadro</button>
          </div>
          <footer class="io-foot">
            <span class="hint" id="ioCount"></span>
            <button class="btn ghost" data-io="cancel" type="button">Annulla</button>
            <button class="btn primary" data-io="save" type="button">${group ? 'Salva' : 'Crea le flashcard'}</button>
          </footer>
        </div>
      </div>`;
    const stage = $('#ioStage', root);
    const draft = $('#ioDraft', root);
    const selBox = $('#ioSel', root);
    const label = $('#ioLabel', root);
    const draw = () => {
      $('#ioMasks', root).innerHTML = masks.map((m, i) =>
        `<div class="io-mask edit ${sel === m.id ? 'sel' : ''}" data-m="${m.id}" style="${posStyle(m)}"><span>${i + 1}</span></div>`).join('');
      $('#ioCount', root).textContent = masks.length ? `${masks.length} ${masks.length === 1 ? 'riquadro' : 'riquadri'}` : '';
      const m = masks.find(x => x.id === sel);
      selBox.hidden = !m;
      if (m && document.activeElement !== label) label.value = m.label || '';
    };
    stage.addEventListener('pointerdown', e => {
      const el = e.target.closest('.io-mask');
      if (!el) { if (sel) { sel = null; draw(); } return; }
      e.preventDefault();
      sel = el.dataset.m;
      draw();
    });
    rectDrawing(stage, {
      canDraw: () => mode === 'draw',
      onDraft: b => { draft.hidden = !b; if (b) draft.setAttribute('style', posStyle(b)); },
      onDone: b => { const m = { id: uid(), ...b, label: '' }; masks.push(m); sel = m.id; draw(); }
    });
    label.addEventListener('input', () => { const m = masks.find(x => x.id === sel); if (m) m.label = label.value; });
    $$('[data-mode]', root).forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.mode;
      $$('[data-mode]', root).forEach(x => x.setAttribute('aria-selected', x.dataset.mode === mode));
      stage.classList.toggle('drawing', mode === 'draw');
    }));
    const close = v => { root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(false); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel && document.activeElement !== label) {
        e.preventDefault(); masks = masks.filter(m => m.id !== sel); sel = null; draw();
      }
    };
    document.addEventListener('keydown', onKey, true);
    $('[data-io="del"]', root).onclick = () => { masks = masks.filter(m => m.id !== sel); sel = null; draw(); };
    $('[data-io="cancel"]', root).onclick = () => close(false);
    $('[data-io="save"]', root).onclick = async () => {
      if (!masks.length) { toast('Disegna almeno un riquadro'); return; }
      const geo = masks.map(m => ({ id: m.id, x: +m.x.toFixed(4), y: +m.y.toFixed(4), w: +m.w.toFixed(4), h: +m.h.toFixed(4) }));
      if (!group || !groupCards.length) {
        const g = uid();
        const cards = masks.map(m => {
          const c = newCard(notebookId, { front: '', back: (m.label || '').trim(), sectionId });
          c.type = 'occlusion';
          c.io = { group: g, imageId, masks: geo, maskId: m.id };
          return c;
        });
        await saveCards(cards);
        toast(`${cards.length} flashcard create`);
      } else {
        const keep = [];
        for (const m of masks) {
          let c = groupCards.find(x => x.io.maskId === m.id);
          if (!c) { c = newCard(notebookId, { front: '', back: '', sectionId: groupCards[0].sectionId }); c.type = 'occlusion'; }
          c.io = { group, imageId, masks: geo, maskId: m.id };
          c.back = (m.label || '').trim();
          keep.push(c);
        }
        await saveCards(keep);
        const removed = groupCards.filter(c => !masks.some(m => m.id === c.io.maskId));
        if (removed.length) await removeRecords(removed.map(c => ({ store: 'cards', rec: c })));
        toast('Riquadri salvati');
      }
      close(true);
      route();
    };
    draw();
  });
}

/* Ritaglio di una figura da una pagina di PDF */
function openPdfCropper(notebookId) {
  return new Promise(resolve => {
    const root = $('#modalRoot');
    let pdf = importDraft.pdf;
    let pageNo = 1;
    let rect = null;
    let task = null;
    root.innerHTML = `
      <div class="overlay full">
        <div class="io-editor" role="dialog" aria-modal="true" aria-labelledby="cpTitle">
          <header class="io-head">
            <h2 id="cpTitle">Figura da un PDF</h2>
            <label class="file-drop slim"><input type="file" id="cpFile" accept="application/pdf,.pdf">
              <span id="cpFileLabel">${pdf ? `${esc(pdf.name)}, tocca per cambiarlo` : 'Scegli il PDF'}</span></label>
            <div class="cp-nav" id="cpNav" ${pdf ? '' : 'hidden'}>
              <button class="btn sm" data-cp="prev" type="button" aria-label="Pagina precedente">‹</button>
              <label>Pagina <input class="input page-in" type="number" id="cpPage" min="1" value="1" inputmode="numeric"> di <span id="cpTotal">${pdf ? pdf.pages : ''}</span></label>
              <button class="btn sm" data-cp="next" type="button" aria-label="Pagina successiva">›</button>
            </div>
            <p class="hint">Trascina sulla pagina per scegliere la parte da ritagliare.</p>
          </header>
          <div class="io-body">
            <div class="io-stage drawing crop" id="cpStage">
              <canvas id="cpCanvas"></canvas>
              <div class="io-draft" id="cpDraft" hidden></div>
              <div class="crop-rect" id="cpRect" hidden></div>
            </div>
          </div>
          <footer class="io-foot">
            <span class="hint" id="cpMsg"></span>
            <button class="btn ghost" data-cp="cancel" type="button">Annulla</button>
            <button class="btn primary" data-cp="ok" type="button" disabled>Inserisci la figura</button>
          </footer>
        </div>
      </div>`;
    const canvas = $('#cpCanvas', root);
    const stage = $('#cpStage', root);
    const okBtn = $('[data-cp="ok"]', root);
    const msg = $('#cpMsg', root);
    const render = async () => {
      if (!pdf) return;
      pageNo = Math.min(pdf.pages, Math.max(1, pageNo));
      $('#cpPage', root).value = pageNo;
      rect = null;
      $('#cpRect', root).hidden = true;
      okBtn.disabled = true;
      try {
        if (task) { task.cancel(); task = null; }
        const page = await pdf.doc.getPage(pageNo);
        const base = page.getViewport({ scale: 1 });
        const cssW = Math.max(280, stage.clientWidth || 360);
        const vp = page.getViewport({ scale: (cssW * (window.devicePixelRatio || 1)) / base.width });
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
        await task.promise;
        task = null;
      } catch (err) {
        if (err && err.name === 'RenderingCancelledException') return;
        msg.textContent = 'Non riesco a mostrare questa pagina.';
      }
    };
    $('#cpFile', root).addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      $('#cpFileLabel', root).textContent = 'Apro il PDF…';
      try {
        pdf = await openPdf(f);
        importDraft.pdf = pdf;
        $('#cpFileLabel', root).textContent = `${f.name}, tocca per cambiarlo`;
        $('#cpTotal', root).textContent = pdf.pages;
        $('#cpNav', root).hidden = false;
        pageNo = 1;
        render();
      } catch (err) { $('#cpFileLabel', root).textContent = 'Scegli il PDF'; toast(err.message, 'err'); }
    });
    $('[data-cp="prev"]', root).onclick = () => { pageNo--; render(); };
    $('[data-cp="next"]', root).onclick = () => { pageNo++; render(); };
    $('#cpPage', root).addEventListener('change', e => { pageNo = parseInt(e.target.value, 10) || 1; render(); });
    rectDrawing(stage, {
      canDraw: () => !!pdf,
      onDraft: b => { const d = $('#cpDraft', root); d.hidden = !b; if (b) d.setAttribute('style', posStyle(b)); },
      onDone: b => { rect = b; const r = $('#cpRect', root); r.hidden = false; r.setAttribute('style', posStyle(b)); okBtn.disabled = false; }
    });
    const close = v => { if (task) task.cancel(); root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    $('[data-cp="cancel"]', root).onclick = () => close(null);
    okBtn.onclick = async () => {
      if (!pdf || !rect) return;
      okBtn.disabled = true;
      msg.textContent = 'Ritaglio…';
      try {
        const page = await pdf.doc.getPage(pageNo);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(4, Math.max(1.5, 1600 / Math.max(1, rect.w * base.width)));
        const vp = page.getViewport({ scale });
        const full = document.createElement('canvas');
        full.width = Math.round(vp.width);
        full.height = Math.round(vp.height);
        const fctx = full.getContext('2d');
        fctx.fillStyle = '#ffffff';
        fctx.fillRect(0, 0, full.width, full.height);
        await page.render({ canvasContext: fctx, viewport: vp }).promise;
        const sx = Math.round(rect.x * full.width), sy = Math.round(rect.y * full.height);
        const sw = Math.max(1, Math.round(rect.w * full.width)), sh = Math.max(1, Math.round(rect.h * full.height));
        const out = document.createElement('canvas');
        const k = Math.min(1, 1600 / Math.max(sw, sh));
        out.width = Math.round(sw * k);
        out.height = Math.round(sh * k);
        out.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, out.width, out.height);
        const im = await saveImage(await canvasToImage(out, 0.9), notebookId);
        toast('Figura aggiunta');
        close({ id: im.id, caption: `${pdf.base}, pagina ${pageNo}` });
      } catch (err) {
        msg.textContent = '';
        okBtn.disabled = false;
        toast('Ritaglio non riuscito: ' + err.message, 'err');
      }
    };
    if (pdf) requestAnimationFrame(render);
  });
}

/* ---------------------------------------------------------------------
   Elenchi puntati in Modifica: rientro, riduzione, continuazione con Invio
   --------------------------------------------------------------------- */
const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;
function lineStart(v, pos) { return v.lastIndexOf('\n', pos - 1) + 1; }
function lineEnd(v, pos) { const e = v.indexOf('\n', pos); return e < 0 ? v.length : e; }
function indentLines(ta, dir) {
  const v = ta.value;
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const ls = lineStart(v, s);
  const endPos = e > s && v[e - 1] === '\n' ? e - 1 : e;
  const le = lineEnd(v, Math.max(endPos, s));
  const prevLine = ls > 0 ? v.slice(lineStart(v, ls - 1), ls - 1) : '';
  const prevOrdered = /^\s*\d+[.)]\s/.test(prevLine);
  const lines = v.slice(ls, le).split('\n');
  let first = 0;
  let total = 0;
  const out = lines.map((l, i) => {
    const lead = l.match(/^ */)[0].length;
    if (dir > 0) {
      if (!l.trim()) return l;
      const step = i === 0 && prevOrdered ? 3 : 2;
      if (i === 0) first = step;
      total += step;
      return ' '.repeat(step) + l;
    }
    const step = lead >= 3 && lead % 3 === 0 && lead % 2 !== 0 ? 3 : 2;
    const rm = Math.min(lead, step);
    if (i === 0) first = -rm;
    total -= rm;
    return l.slice(rm);
  });
  ta.setRangeText(out.join('\n'), ls, le, 'preserve');
  const ns = Math.max(ls, s + first);
  ta.setSelectionRange(ns, s === e ? ns : Math.max(ns, e + total));
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
function setupListEditing(ta) {
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); indentLines(ta, e.shiftKey ? -1 : 1); }
  });
  // "beforeinput" funziona anche con la tastiera di Android
  ta.addEventListener('beforeinput', e => {
    if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
    const { selectionStart: s, selectionEnd: en, value: v } = ta;
    if (s !== en) return;
    const ls = lineStart(v, s);
    const le = lineEnd(v, s);
    const m = v.slice(ls, s).match(LIST_RE);
    const full = v.slice(ls, le).match(LIST_RE);
    if (!m || !full) return;
    e.preventDefault();
    if (!full[4].trim()) {
      // voce vuota: un livello indietro, o fuori dall’elenco se è già al primo livello
      if (full[1].length) indentLines(ta, -1);
      // riga vuota in più: senza, Markdown attaccherebbe il testo seguente all’ultima voce
      else { ta.setRangeText('\n', ls, le, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
      return;
    }
    let marker = m[2];
    const num = marker.match(/^(\d+)([.)])$/);
    if (num) marker = `${parseInt(num[1], 10) + 1}${num[2]}`;
    ta.setRangeText(`\n${m[1]}${marker}${m[3]}`, s, s, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/* ---------------------------------------------------------------------
   Ricerca in tutti i notebook
   --------------------------------------------------------------------- */
function searchSnippet(text, q) {
  const t = plainText(text, 1e9);
  const i = t.toLowerCase().indexOf(q);
  if (i < 0) return esc(t.slice(0, 120)) + (t.length > 120 ? '…' : '');
  const a = Math.max(0, i - 60);
  const b = Math.min(t.length, i + q.length + 80);
  return `${a > 0 ? '…' : ''}${esc(t.slice(a, i))}<mark class="hit">${esc(t.slice(i, i + q.length))}</mark>${esc(t.slice(i + q.length, b))}${b < t.length ? '…' : ''}`;
}
function searchResultsHtml(q) {
  const secs = state.sections.filter(s => (s.title + '\n' + stripCloze(s.md)).toLowerCase().includes(q)).slice(0, 60);
  const cards = state.cards.filter(c => (c.front + '\n' + c.back).toLowerCase().includes(q)).slice(0, 60);
  if (!secs.length && !cards.length) return '<p class="hint">Nessun risultato.</p>';
  return `
    ${secs.length ? `<h2 class="sub">Sezioni</h2><ul class="list">${secs.map(s => `
      <li><a class="row" href="#/sec/${s.id}/read"><span class="row-main">
        <span class="row-title">${esc(s.title)}</span>
        <span class="row-sub">${esc(nbById(s.notebookId)?.name || '')}: ${searchSnippet(s.md, q)}</span>
      </span></a></li>`).join('')}</ul>` : ''}
    ${cards.length ? `<h2 class="sub">Flashcard</h2><ul class="list">${cards.map(c => `
      <li><a class="row" href="#/card/${c.id}"><span class="row-main">
        <span class="row-title">${c.type === 'occlusion' ? 'Image occlusion' : searchSnippet(c.front, q)}</span>
        <span class="row-sub">${searchSnippet(c.back, q) || '&nbsp;'}</span>
      </span></a></li>`).join('')}</ul>` : ''}`;
}

/* ---------------------------------------------------------------------
   PDF o testo condivisi da altre app (menu Condividi di Android)
   --------------------------------------------------------------------- */
async function takeSharedFile() {
  const q = new URLSearchParams(location.search);
  if (!q.has('shared') || !('caches' in window)) return false;
  history.replaceState(null, '', location.pathname + '#/import');
  try {
    const cache = await caches.open('nb-share');
    const scope = new URL('./', location.href).href;
    const metaRes = await cache.match(scope + '__share/meta');
    if (!metaRes) return false;
    const meta = await metaRes.json();
    const fileRes = meta.file ? await cache.match(scope + '__share/file') : null;
    await cache.delete(scope + '__share/meta');
    await cache.delete(scope + '__share/file');
    importJob = importJob && importJob.running ? importJob : null;
    if (fileRes) {
      const blob = await fileRes.blob();
      const file = new File([blob], meta.file.name || 'condiviso.pdf', { type: meta.file.type || 'application/pdf' });
      importDraft.src = 'pdf';
      importDraft.pdf = await openPdf(file);
      return 'pdf';
    }
    const body = [meta.text, meta.url && !String(meta.text || '').includes(meta.url) ? meta.url : ''].filter(Boolean).join('\n\n').trim();
    if (!body) return false;
    importDraft.src = 'text';
    importDraft.text = importDraft.text ? `${importDraft.text}\n\n${body}` : body;
    if (meta.title && !importDraft.title) importDraft.title = meta.title;
    return 'text';
  } catch (err) {
    toast('Non riesco a leggere il file condiviso: ' + err.message, 'err');
    return false;
  }
}

/* ---------------------------------------------------------------------
   App installabile (PWA) e condivisione verso il Notebook
   --------------------------------------------------------------------- */
let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function installInfoText() {
  if (isStandalone()) return 'Stai usando l’app installata. Funziona anche offline per leggere e ripassare; AI e sincronizzazione richiedono internet.';
  if (installPrompt) return 'Installala per aprirla dall’icona come un’app, usarla offline e condividerci testo dalle altre app.';
  return 'Su Android: apri il menu ⋮ di Chrome e scegli “Installa app” o “Aggiungi a schermata Home”.';
}

function setupPwa() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* senza service worker l’app funziona comunque online */ });
  }
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
    const btn = $('[data-act="install"]');
    if (btn) btn.hidden = false;
    const info = $('#installInfo');
    if (info) info.textContent = installInfoText();
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; toast('App installata'); });
}

// Testo condiviso da un’altra app (menu Condividi di Android) → modulo Importa
function takeSharedText() {
  const q = new URLSearchParams(location.search);
  if (!q.has('text') && !q.has('title') && !q.has('url')) return false;
  const title = (q.get('title') || '').trim();
  const text = (q.get('text') || '').trim();
  const url = (q.get('url') || '').trim();
  const body = [text, url && !text.includes(url) ? url : ''].filter(Boolean).join('\n\n');
  history.replaceState(null, '', location.pathname + '#/import');
  if (!body) return false;
  importJob = importJob && importJob.running ? importJob : null;
  importDraft.src = 'text';
  importDraft.text = importDraft.text ? `${importDraft.text}\n\n${body}` : body;
  if (title && !importDraft.title) importDraft.title = title;
  return true;
}

/* ---------------------------------------------------------------------
   Avvio
   --------------------------------------------------------------------- */
async function init() {
  Settings.load();
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (S().theme === 'auto') applyTheme(); });
  try {
    await DB.open();
    state.notebooks = await DB.all('notebooks');
    state.sections = await DB.all('sections');
    state.cards = await DB.all('cards');
    state.images = await DB.all('images');
  } catch (err) {
    setView(`<div class="empty"><p>Non riesco ad aprire l’archivio del browser: ${esc(err.message || err)}. In navigazione privata potrebbe non essere disponibile.</p></div>`);
    return;
  }
  // Chiede al browser di non cancellare i dati quando lo spazio scarseggia
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  // I notebook della v1 non avevano la data di modifica: serve alla sincronizzazione
  const fix = state.notebooks.filter(n => !n.updated);
  if (fix.length) { fix.forEach(n => { n.updated = n.created || Date.now(); }); await DB.bulkPut('notebooks', fix); }
  await Bridge.prune();
  updateBadge();
  window.addEventListener('hashchange', route);
  // Ricorda da dove apri una flashcard, per tornarci dopo averla modificata
  $('#view').addEventListener('click', e => {
    const a = e.target.closest('a[href^="#/card/"]');
    if (a) state.cardReturn = location.hash;
    const img = e.target.closest('img.nb-img');
    if (img && !img.closest('.io') && img.dataset.state === 'ok') openLightbox(img.dataset.img);
  });
  document.addEventListener('focusin', e => { if (e.target.tagName === 'TEXTAREA') e.target.dataset.touched = '1'; });
  // Mostra le immagini appena compaiono nella pagina o nelle finestre
  const obs = new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) hydrateImages(n); })));
  obs.observe($('#view'), { childList: true, subtree: true });
  obs.observe($('#modalRoot'), { childList: true, subtree: true });
  // StudyHub conferma la ricezione scrivendo nel localStorage condiviso
  window.addEventListener('storage', e => { if (e.key === Bridge.ACK) Bridge.prune(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      Bridge.prune();
      updateBadge();
      if (Sync.configured() && Date.now() - (Sync.meta().lastSync || 0) > 60000) Sync.run({ silent: true });
    } else if (Sync.timer) {
      Sync.run({ silent: true }); // modifiche in sospeso: prova a inviarle subito
    }
  });
  window.addEventListener('online', () => { if (Sync.configured()) Sync.schedule(1000); });
  setupPwa();
  const sharedFile = await takeSharedFile();
  const shared = sharedFile || takeSharedText();
  route();
  if (shared === 'pdf') toast('PDF ricevuto: scegli il notebook e le pagine');
  else if (shared) toast('Testo ricevuto: scegli il notebook e crea le sezioni');
  if (Sync.configured()) Sync.run({ silent: true });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') init();
