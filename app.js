'use strict';

/* =====================================================================
   StudyHub Notebook v1.0
   Notebook di studio: importazione da testo o PDF, formattazione con AI
   (Gemini o Claude), active recall (cloze, pagina bianca, domande) e
   ripetizione dilazionata SM-2.
   ===================================================================== */

const APP_VERSION = '1.0';
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
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('notebooks')) db.createObjectStore('notebooks', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('sections')) {
          const s = db.createObjectStore('sections', { keyPath: 'id' });
          s.createIndex('notebookId', 'notebookId');
        }
      };
      req.onsuccess = () => { this.db = req.result; resolve(); };
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
  deleteNotebook(nbId, secIds) {
    return this.run(['notebooks', 'sections'], 'readwrite', tx => {
      tx.objectStore('notebooks').delete(nbId);
      const st = tx.objectStore('sections');
      secIds.forEach(id => st.delete(id));
    });
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
    aiQuestions: true
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
const state = { notebooks: [], sections: [], fromReview: false };
const drafts = {};              // richiami "pagina bianca" non ancora valutati
let orderSeq = 0;
let importJob = null;
const importDraft = { nbId: '', src: 'text', text: '', title: '', pdf: null };
let cleanups = [];

const nbById = id => state.notebooks.find(n => n.id === id);
const secById = id => state.sections.find(s => s.id === id);
const secsOf = nbId => state.sections.filter(s => s.notebookId === nbId).sort((a, b) => a.order - b.order);
const isDue = s => !!(s.srs && s.srs.due && s.srs.due <= todayStr());
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
}
async function saveNotebook(nb) {
  await DB.put('notebooks', nb);
  const i = state.notebooks.findIndex(n => n.id === nb.id);
  if (i < 0) state.notebooks.push(nb); else state.notebooks[i] = nb;
}
async function deleteSection(id) {
  await DB.del('sections', id);
  state.sections = state.sections.filter(s => s.id !== id);
  delete drafts[id];
  updateBadge();
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
  if (!b) return;
  const n = state.sections.filter(isDue).length;
  b.textContent = n;
  b.hidden = n === 0;
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
  const navKey = p0 === 'nb' || p0 === 'sec' ? (state.fromReview ? 'review' : 'notebooks') : p0;
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
  setView(`
    <a class="back" href="#/notebooks">Tutti i notebook</a>
    <header class="page-head">
      <div>
        <h1>${esc(nb.name)}</h1>
        <p class="lede">${secs.length} ${secs.length === 1 ? 'sezione' : 'sezioni'}${due ? `, ${due} da ripassare oggi` : ''}</p>
      </div>
      <div class="actions">
        <a class="btn primary" href="#/import/${nb.id}">Importa</a>
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
      text: `Verranno eliminate anche le sue ${secs.length} sezioni. L’operazione non si può annullare.`,
      confirm: 'Elimina', danger: true
    });
    if (!ok) return;
    await DB.deleteNotebook(id, secs.map(s => s.id));
    state.notebooks = state.notebooks.filter(n => n.id !== id);
    state.sections = state.sections.filter(s => s.notebookId !== id);
    updateBadge();
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
const MODES = [['read', 'Leggi'], ['cloze', 'Cloze'], ['blank', 'Pagina bianca'], ['quiz', 'Domande'], ['edit', 'Modifica']];

function srsLabel(s) {
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
  ({ read: modeRead, cloze: modeCloze, blank: modeBlank, quiz: modeQuiz, edit: modeEdit }[mode])(sec, body);
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
    toast(`Prossimo ripasso ${fmtDue(sec.srs.due)}`);
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
    ${!sec.srs?.due && sec.md.trim() ? `
      <div class="callout end">
        <p>Quando hai finito di studiarla, pianifica il primo ripasso per domani.</p>
        <button class="btn primary" data-act="plan">Pianifica il primo ripasso</button>
      </div>` : ''}
    ${sec.source ? `<p class="source">Fonte: ${esc(sec.source)}</p>` : ''}
  `;
  on('[data-act="plan"]', 'click', async () => {
    sec.srs = { ...(sec.srs || newSrs()), due: addDays(todayStr(), 1), interval: 1 };
    await saveSection(sec);
    toast('Primo ripasso domani');
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
    toast(`Spostata in ${nbById(target)?.name || 'altro notebook'}`);
    go(`#/sec/${sec.id}/read`);
  }, body);

  on('[data-act="del"]', 'click', async () => {
    const ok = await modal({ title: 'Eliminare la sezione?', text: 'L’operazione non si può annullare.', confirm: 'Elimina', danger: true });
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
  const fresh = state.sections.filter(s => !s.srs?.due && s.md.trim()).sort((a, b) => a.order - b.order);
  setView(`
    <header class="page-head">
      <div>
        <h1>Ripasso</h1>
        <p class="lede">${due.length ? `${due.length} ${due.length === 1 ? 'sezione' : 'sezioni'} da ripassare oggi.` : 'Niente da ripassare oggi.'}</p>
      </div>
      ${due.length ? '<button class="btn primary" data-act="start">Inizia il ripasso</button>' : ''}
    </header>
    ${due.length ? `<ul class="list">${due.map(s => sectionRow(s, { showNb: true, review: true })).join('')}</ul>` : ''}
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
      <p class="hint">I notebook sono salvati in questo browser. Esporta un backup per spostarli su un altro dispositivo o per sicurezza.</p>
      <div class="inline">
        <button class="btn" data-act="export">Esporta backup</button>
        <label class="btn">Importa backup<input type="file" id="bkFile" accept="application/json,.json" hidden></label>
      </div>
      <p class="hint" id="usage"></p>
    </section>

    <p class="version">StudyHub Notebook ${APP_VERSION}</p>
  `);

  $('#stProv').addEventListener('change', e => { st.provider = e.target.value; Settings.save(); toast(`Uso ${AI.name()}`); });
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
    const data = { app: 'studyhub-notebook', version: 1, exported: new Date().toISOString(), notebooks: state.notebooks, sections: state.sections };
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
        text: `${data.notebooks.length} notebook e ${data.sections.length} sezioni. Gli elementi con lo stesso identificativo vengono sostituiti, gli altri restano.`,
        confirm: 'Importa'
      });
      if (!ok) return;
      const secs = data.sections.filter(s => s && s.id && s.notebookId).map(s => ({ ...newSection(s.notebookId), ...s, srs: { ...newSrs(), ...(s.srs || {}) } }));
      const nbs = data.notebooks.filter(n => n && n.id);
      await DB.bulkPut('notebooks', nbs);
      await DB.bulkPut('sections', secs);
      state.notebooks = await DB.all('notebooks');
      state.sections = await DB.all('sections');
      updateBadge();
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
  } catch (err) {
    setView(`<div class="empty"><p>Non riesco ad aprire l’archivio del browser: ${esc(err.message || err)}. In navigazione privata potrebbe non essere disponibile.</p></div>`);
    return;
  }
  // Chiede al browser di non cancellare i dati quando lo spazio scarseggia
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  updateBadge();
  window.addEventListener('hashchange', route);
  route();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') init();
