'use strict';

/* =====================================================================
   StudyHub Notebook v1.0
   Notebook di studio: importazione da testo o PDF, formattazione con AI
   (Gemini o Claude), active recall (cloze, pagina bianca, domande) e
   ripetizione dilazionata SM-2.
   ===================================================================== */

const APP_VERSION = '2.0';
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
      const req = indexedDB.open(DB_NAME, 2);
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
    newPerDay: 20
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
const state = { notebooks: [], sections: [], cards: [], fromReview: false, cardReturn: '' };
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
  await removeRecords([{ store: 'sections', rec: sec }, ...cardsOfSection(id).map(c => ({ store: 'cards', rec: c }))]);
  delete drafts[id];
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
  const src = (md || '').replace(clozeRe(), (m, t) => `<mark class="cz">${t}</mark>`);
  let html;
  const mk = window.marked;
  if (mk && (mk.parse || typeof mk === 'function')) {
    html = mk.parse ? mk.parse(src, { gfm: true, breaks: false }) : mk(src);
  } else {
    html = src.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
      .replace(/&lt;mark class=&quot;cz&quot;&gt;/g, '<mark class="cz">').replace(/&lt;\/mark&gt;/g, '</mark>');
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

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  const box = $('#toasts');
  while (box.children.length >= 2) box.firstElementChild.remove();
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3400);
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
  const cb = $('#cardBadge');
  if (cb) {
    const c = cardCounts(state.cards);
    const n = c.l + c.r;
    cb.textContent = n;
    cb.hidden = n === 0;
  }
}

function applyTheme() {
  const t = S().theme;
  const dark = t === 'auto' ? matchMedia('(prefers-color-scheme: dark)').matches : t !== 'light';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#0d131d' : '#f6f8fb';
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
    ${nbs.length ? `
      <ul class="list">
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
    await removeRecords([
      { store: 'notebooks', rec: nb },
      ...secs.map(s => ({ store: 'sections', rec: s })),
      ...nbCards.map(c => ({ store: 'cards', rec: c }))
    ]);
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
    ${sec.md.trim() ? '<p class="hint sel-hint">Seleziona una parte del testo per trasformarla in flashcard.</p>' : ''}
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
  if (notesEl) setupSelectionBar(notesEl, sec);
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
          text: `APPUNTI ORIGINALI:\n${stripCloze(sec.md)}\n\nRICHIAMO DELLO STUDENTE:\n${val}`,
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
        const r = await AI.generate({ system: QUESTIONS_SYSTEM, text: stripCloze(sec.md), maxTokens: 6000 });
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
      <button class="btn sm" data-ins="list">Elenco</button>
      <button class="btn sm" data-ins="table">Tabella</button>
      ${AI.ready() ? `<button class="btn sm" data-act="ai-format">Riformatta con ${AI.name()}</button>` : ''}
    </div>
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
      const r = await AI.generate({ system: QUESTIONS_SYSTEM, text: stripCloze(ta.value), maxTokens: 6000 });
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
    sec.title = $('#edTitle', body).value.trim() || 'Senza titolo';
    sec.md = ta.value;
    sec.questions = parseQuestions($('#edQs', body).value);
    sec.needsFormat = false;
    await saveSection(sec);
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
      <p class="hint">Passi di apprendimento come Anki: 1 e 10 minuti, poi 1 giorno; con “Facile” 4 giorni.</p>
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
      <h2>Aspetto</h2>
      <label class="field narrow"><span>Tema</span>
        <select class="input" id="stTheme">
          <option value="dark" ${st.theme === 'dark' ? 'selected' : ''}>Scuro</option>
          <option value="light" ${st.theme === 'light' ? 'selected' : ''}>Chiaro</option>
          <option value="auto" ${st.theme === 'auto' ? 'selected' : ''}>Come il dispositivo</option>
        </select></label>
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

  on('[data-act="export"]', 'click', () => {
    const data = { app: 'studyhub-notebook', version: 2, exported: new Date().toISOString(), notebooks: state.notebooks, sections: state.sections, cards: state.cards };
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
      await DB.bulkPut('notebooks', nbs);
      await DB.bulkPut('sections', secs);
      await DB.bulkPut('cards', cards);
      state.notebooks = await DB.all('notebooks');
      state.sections = await DB.all('sections');
      state.cards = await DB.all('cards');
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
  const t = stripCloze(md || '').replace(/^\*([^*\n]+)\*\n\n/, '$1: ').replace(/[#*_`>|]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};
function cardRow(c) {
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
        const r = await this.post({ secret: S().syncSecret.trim(), action: 'sync', since: m.rev || 0, records: batches[i], pull: last });
        rev = r.rev;
        if (last) pulled = r.records || [];
      }
      const changed = await applyRemote(pulled);
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
    const len = JSON.stringify(r).length;
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
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      else e.stopPropagation(); // nessuna scorciatoia della pagina mentre scrivi
    };
    $('[data-cs="no"]', root).onclick = () => close(null);
    $('[data-cs="yes"]', root).onclick = save;
    const aiBtn = $('[data-cs="ai"]', root);
    if (aiBtn) aiBtn.onclick = async () => {
      if (!bEl.value.trim()) { toast('Scrivi prima la risposta'); return; }
      aiBtn.disabled = true;
      aiBtn.textContent = 'Scrivo la domanda…';
      try {
        const ctx = sec ? `ARGOMENTO: ${sec.title}\n\nCONTESTO:\n${stripCloze(sec.md).slice(0, 5000)}\n\n` : '';
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

// Barra "Crea flashcard" quando selezioni del testo negli appunti
function setupSelectionBar(container, sec) {
  const bar = document.createElement('div');
  bar.className = 'sel-bar';
  bar.hidden = true;
  bar.innerHTML = '<button class="btn primary" type="button">Crea flashcard dalla selezione</button>';
  document.body.appendChild(bar);
  const btn = $('button', bar);
  let lastText = '';
  let hideTimer = null;
  const onSel = () => {
    const sel = document.getSelection();
    const txt = sel && !sel.isCollapsed ? sel.toString().trim() : '';
    const inside = txt && sel.anchorNode && container.contains(sel.anchorNode) && container.contains(sel.focusNode);
    if (inside) {
      clearTimeout(hideTimer);
      lastText = txt;
      bar.hidden = false;
    } else if (!bar.hidden) {
      // ritardo: su Android toccare il pulsante può annullare la selezione prima del clic
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { bar.hidden = true; }, 700);
    }
  };
  document.addEventListener('selectionchange', onSel);
  btn.addEventListener('pointerdown', e => e.preventDefault());
  btn.addEventListener('click', () => {
    clearTimeout(hideTimer);
    bar.hidden = true;
    const text = lastText;
    document.getSelection()?.removeAllRanges();
    if (text) openCardSheet({ back: text, sectionId: sec.id, notebookId: sec.notebookId });
  });
  addCleanup(() => {
    clearTimeout(hideTimer);
    document.removeEventListener('selectionchange', onSel);
    bar.remove();
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
    ${cards.length ? `
      <h2 class="sub">${cards.length} ${cards.length === 1 ? 'flashcard' : 'flashcard'} in questa sezione</h2>
      <ul class="list">${cards.map(cardRow).join('')}</ul>` : ''}
  `;
  on('[data-act="new-card"]', 'click', async () => {
    const c = await openCardSheet({ sectionId: sec.id, notebookId: sec.notebookId });
    if (c) route();
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
      const r = await AI.generate({ system: CARDS_SYSTEM, text: stripCloze(sec.md), maxTokens: 8000 });
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
  setView(`
    <a class="back" href="${esc(back)}">Indietro</a>
    <header class="page-head">
      <div>
        <h1>Flashcard</h1>
        <p class="lede">${esc(nbById(c.notebookId)?.name || '')}, ${cardStatusText(c)}${c.srs.lapses ? `, sbagliata ${c.srs.lapses} ${c.srs.lapses === 1 ? 'volta' : 'volte'}` : ''}</p>
      </div>
    </header>
    <div class="form">
      <label class="field"><span>Fronte</span><textarea class="input card-ta" id="ceFront">${esc(c.front)}</textarea></label>
      <label class="field"><span>Retro</span><textarea class="input card-ta" id="ceBack">${esc(c.back)}</textarea></label>
      <label class="field"><span>Sezione collegata</span>
        <select class="input" id="ceSec">
          <option value="">Nessuna</option>
          ${secs.map(s => `<option value="${s.id}" ${s.id === c.sectionId ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}
        </select></label>
      <details class="preview" id="cePrevBox"><summary>Anteprima</summary>
        <div class="fcard"><div class="notes" id="cePrevF"></div><hr class="fsep"><div class="notes" id="cePrevB"></div></div></details>
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
  const box = $('#cePrevBox');
  const prev = () => { if (box.open) { $('#cePrevF').innerHTML = renderMd(fEl.value); $('#cePrevB').innerHTML = renderMd(bEl.value); } };
  box.addEventListener('toggle', prev);
  fEl.addEventListener('input', prev);
  bEl.addEventListener('input', prev);
  on('[data-act="save"]', 'click', async () => {
    if (!fEl.value.trim()) { toast('Il fronte non può essere vuoto'); fEl.focus(); return; }
    c.front = fEl.value.trim();
    c.back = bEl.value.trim();
    c.sectionId = $('#ceSec').value || null;
    await saveCard(c);
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
    await removeRecords([{ store: 'cards', rec: c }]);
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
    <article class="fcard study">
      <div class="notes face">${renderMd(card.front)}</div>
      ${session.revealed ? `<hr class="fsep"><div class="notes face">${renderMd(card.back)}</div>` : ''}
    </article>
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
  } finally { answering = false; }
  renderStudy();
}
async function undoAnswer() {
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
  });
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
  route();
  if (Sync.configured()) Sync.run({ silent: true });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') init();
