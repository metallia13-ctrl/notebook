'use strict';

/* =====================================================================
   StudyHub Notebook v1.0
   Notebook di studio: importazione da testo o PDF, formattazione con AI
   (Gemini o Claude), active recall (cloze, pagina bianca, domande) e
   ripetizione dilazionata SM-2.
   ===================================================================== */

const APP_VERSION = '3.19';
const DB_NAME = 'studyhub-notebook';
const CHUNK_CHARS = 12000;          // caratteri massimi per sezione dal testo incollato
const MAX_PDF_B64 = 24 * 1024 * 1024; // ~18 MB di PDF dopo la codifica base64

const LIBS = {
  pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  pdflib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
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
      const req = indexedDB.open(DB_NAME, 6);
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
        if (!db.objectStoreNames.contains('links')) db.createObjectStore('links', { keyPath: 'id' });
        // v5: PDF da leggere (metadati e annotazioni) e i loro file, solo su questo dispositivo
        if (!db.objectStoreNames.contains('pdfs')) db.createObjectStore('pdfs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('pdfblobs')) db.createObjectStore('pdfblobs', { keyPath: 'id' });
        // v6: testo dei PDF per la ricerca, solo su questo dispositivo
        if (!db.objectStoreNames.contains('pdftext')) db.createObjectStore('pdftext', { keyPath: 'id' });
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
    boardOpen: false,
    keepPdfImages: false,
    showImages: true,
    xmCards: true
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
const state = { notebooks: [], sections: [], cards: [], images: [], links: [], pdfs: [], fromReview: false, cardReturn: '' };
const drafts = {};              // richiami "pagina bianca" non ancora valutati
let orderSeq = 0;
let importJob = null;
const importDraft = { nbId: '', groupId: '', src: 'text', text: '', title: '', pdf: null, split: 'every', rangesText: '', xmind: null };
let cleanups = [];

const nbById = id => state.notebooks.find(n => n.id === id);
const secById = id => state.sections.find(s => s.id === id);
const secsOf = nbId => state.sections.filter(s => s.notebookId === nbId).sort((a, b) => a.order - b.order);
const isDue = s => !s.studyhub && !!(s.srs && s.srs.due && s.srs.due <= todayStr());
const sortDue = (a, b) => a.srs.due.localeCompare(b.srs.due) || a.order - b.order;
// Macro-argomenti: elenco ordinato dentro il notebook, ogni sezione ne indica uno con groupId
const groupsOf = nb => (nb && Array.isArray(nb.groups) ? nb.groups : []);
const groupOf = sec => groupsOf(nbById(sec.notebookId)).find(g => g.id === sec.groupId) || null;
// un gruppo può stare dentro un macro-argomento (sottoargomento); solo due livelli
const groupParent = (nb, g) => (g && g.parentId ? groupsOf(nb).find(x => x.id === g.parentId && !x.parentId) || null : null);
const topGroups = nb => groupsOf(nb).filter(g => !groupParent(nb, g));
const subGroups = (nb, g) => groupsOf(nb).filter(x => x.parentId === g.id && !groupParent(nb, g));
function groupPathOf(sec) {
  const nb = nbById(sec.notebookId);
  const g = groupOf(sec);
  if (!g) return [];
  const p = groupParent(nb, g);
  return p ? [p, g] : [g];
}
const groupPathText = sec => groupPathOf(sec).map(g => g.name).join(' › ');
// Niente spoiler: una sezione si apre in Cloze se ha termini nascosti, altrimenti in Leggi
const openMode = s => (countCloze(s.md) || ioMaskCount(s) ? 'cloze' : 'read');

function newSrs() { return { ef: 2.5, interval: 0, reps: 0, due: null, history: [] }; }

function newSection(nbId, { title, md, questions, source, groupId } = {}) {
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
    needsFormat: false,
    groupId: groupId || null      // macro-argomento del notebook; la sezione è il micro-argomento
  };
}

/* ---------------------------------------------------------------------
   Cloze rimasti aperti: un cloze che comincia dentro un grassetto o
   un’evidenziatura deve chiudersi prima che questi finiscano, altrimenti
   “mangia” il testo fino al cloze successivo e lo rompe. Qui lo chiudo
   al punto giusto; un’apertura senza chiusura viene tolta.
   --------------------------------------------------------------------- */
function repairClozeLine(line) {
  if (line.indexOf('==') < 0) return line;
  let out = '';
  let open = -1;
  let boldAt = -1;
  const wraps = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '`') {
      const k = line.indexOf('`', i + 1);
      if (k > i) { out += line.slice(i, k + 1); i = k + 1; continue; }
    }
    if (line.startsWith('==', i) && line[i + 2] !== '=' && line[i - 1] !== '=') {
      const next = line[i + 2];
      const prev = line[i - 1];
      if (open < 0 && next && !/\s/.test(next)) { open = out.length; out += '=='; i += 2; continue; }
      if (open >= 0 && prev && !/\s/.test(prev)) { out += '=='; open = -1; i += 2; continue; }
      out += '=='; i += 2; continue;
    }
    if (line.startsWith('**', i)) {
      if (boldAt < 0) boldAt = out.length;
      else {
        if (open >= 0 && boldAt < open) { out += '=='; open = -1; }
        boldAt = -1;
      }
      out += '**'; i += 2; continue;
    }
    const w = /^\{\{[uygbpovrtl]\|/.exec(line.slice(i, i + 4));
    if (w) { wraps.push(out.length); out += w[0]; i += w[0].length; continue; }
    if (line.startsWith('}}', i) && wraps.length) {
      const at = wraps.pop();
      if (open >= 0 && at < open) { out += '=='; open = -1; }
      out += '}}'; i += 2; continue;
    }
    out += ch;
    i++;
  }
  if (open >= 0) out = out.slice(0, open) + out.slice(open + 2);
  return out;
}
function repairClozes(md) {
  if (!md || md.indexOf('==') < 0) return md;
  let fence = false;
  return md.split('\n').map(l => {
    if (/^\s*```/.test(l)) { fence = !fence; return l; }
    return fence ? l : repairClozeLine(l);
  }).join('\n');
}

async function saveSection(sec) {
  if (typeof sec.md === 'string') sec.md = repairClozes(sec.md);
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
  for (const p of pdfsOf(id)) await deletePdf(p.id);
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
// ==termine::suggerimento==: il suggerimento è facoltativo
const splitHint = t => { const i = t.indexOf('::'); return i > 0 ? [t.slice(0, i), t.slice(i + 2).trim()] : [t, '']; };
const stripCloze = md => (md || '').replace(clozeRe(), (m, t) => splitHint(t)[0]);

function renderMd(md) {
  const src = renderXrefs(extractHtmlBlocks(md || '')
    .replace(IMG_MD_RE, (m, alt, id) => `<img class="nb-img" data-img="${id}" alt="${esc(alt)}">`));
  const src2 = renderMarks(src).replace(clozeRe(), (m, t) => { const [term, hint] = splitHint(t); return `<mark class="cz"${hint ? ` data-hint="${esc(hint)}"` : ''}>${term}</mark>`; });
  let html;
  const mk = window.marked;
  if (mk && (mk.parse || typeof mk === 'function')) {
    html = mk.parse ? mk.parse(src2, { gfm: true, breaks: false }) : mk(src2);
  } else {
    html = src2.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
      .replace(/&lt;mark class=&quot;(cz|hl hl-[ygbpovrtl])&quot;&gt;/g, '<mark class="$1">').replace(/&lt;\/mark&gt;/g, '</mark>')
      .replace(/&lt;u class=&quot;ul&quot;&gt;/g, '<u class="ul">').replace(/&lt;\/u&gt;/g, '</u>')
      .replace(/&lt;a class=&quot;xref&quot; href=&quot;(#\/sec\/[a-z0-9]+)&quot;&gt;(.*?)&lt;\/a&gt;/g, '<a class="xref" href="$1">$2</a>')
      .replace(/&lt;span class=&quot;xref missing&quot;[^&]*?(?:&quot;[^&]*?)*&gt;(.*?)&lt;\/span&gt;/g, '<span class="xref missing">$1</span>')
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
const aiText = md => xrefPlain(stripMarks(stripCloze(String(md || '').replace(/```html\s*\n([\s\S]*?)```/g, (m, h) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' '))))).replace(IMG_MD_RE, (m, alt) => `[immagine${alt ? `: ${alt}` : ''}]`);
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
function formatSystem({ cloze, questions } = {}) {
  return [
    promptText('format').trim(),
    '',
    'Regole tecniche, da rispettare sempre:',
    '- Copia senza modifiche, nella stessa posizione, ogni riferimento a immagine nel formato ![testo](img:codice).',
    '- Mantieni le evidenziature e sottolineature nel formato {{lettera|testo}}, es. {{y|frase importante}}.',
    '- Mantieni i collegamenti ad altre pagine nel formato [[Titolo]].',
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
    scanned: chars / sample < 25
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

function modal({ title, text = '', input = false, multiline = false, allowEmpty = false, value = '', placeholder = '', confirm = 'Conferma', cancel = 'Annulla', danger = false }) {
  return new Promise(resolve => {
    const root = $('#modalRoot');
    const prevFocus = document.activeElement;
    root.innerHTML = `
      <div class="overlay">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">
          <h2 id="mTitle">${esc(title)}</h2>
          ${text ? `<p>${esc(text)}</p>` : ''}
          ${input ? (multiline
            ? `<textarea class="input card-ta mono-ta" id="mInput" rows="9" spellcheck="false" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
            : `<input class="input" id="mInput" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">`) : ''}
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
        if (!v && !allowEmpty) { $('#mInput').focus(); return; }
        close(v);
      } else close(true);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && !(multiline && !(e.ctrlKey || e.metaKey))) { e.preventDefault(); e.stopPropagation(); ok(); }
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
  if (meta) meta.content = { dark: '#0c1020', light: '#f3f5fb', sepia: '#f2e9d5' }[theme];
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
  if (showNb) {
    const gp = groupPathText(s);
    bits.push(esc(nbById(s.notebookId)?.name || '') + (gp ? ` › ${esc(gp)}` : ''));
  }
  const cz = countCloze(s.md);
  const q = (s.questions || []).length;
  if (cz) bits.push(`${cz} cloze`);
  if (q) bits.push(`${q} ${q === 1 ? 'domanda' : 'domande'}`);
  if (s.needsFormat) bits.push('da formattare');
  const href = review ? `#/sec/${s.id}/${defaultMode(s)}` : `#/sec/${s.id}/${openMode(s)}`;
  return `
    <li data-id="${s.id}">
      <a class="row" href="${href}" ${review ? 'data-review="1"' : ''}>
        <span class="row-main">
          <span class="row-title">${esc(s.title)}</span>
          <span class="row-sub">${bits.filter(Boolean).join(', ') || 'Solo lettura'}</span>
          ${tagChips(tagsOf(s), { link: false })}
        </span>
        ${statusPill(s)}
      </a>
    </li>`;
}

// Tessera colorata del notebook: la tinta dipende dall’id, così non cambia se lo rinomini
function nbTile(nb) {
  let h = 0;
  for (const ch of String(nb.id)) h = (h * 31 + ch.codePointAt(0)) % 360;
  const first = [...(nb.name || '').trim()][0] || '?';
  return `<span class="nb-tile" style="--h:${h}" aria-hidden="true">${esc(first.toUpperCase())}</span>`;
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
const MORE_KEYS = ['search', 'more', 'settings', 'links', 'guide', 'calendar', 'clinic', 'glossary'];
function route() {
  cleanups.forEach(fn => { try { fn(); } catch { /* ignora */ } });
  cleanups = [];
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, '')) || 'notebooks';
  const [p0, p1, p2] = h.split('/');
  if (p0 !== 'sec') state.fromReview = false;
  // Un’importazione finita non blocca il modulo quando ci torni
  if (p0 !== 'import' && importJob && !importJob.running) importJob = null;
  const navKey = p0 === 'nb' || p0 === 'sec' ? (state.fromReview ? 'review' : 'notebooks')
    : p0 === 'pdf' || p0 === 'pdfs' ? 'pdfs'
    : p0 === 'tag' || p0 === 'exam' ? 'notebooks'
    : ['deck', 'card', 'study'].includes(p0) ? 'cards' : p0;
  $$('.nav a').forEach(a => {
    const onIt = a.dataset.nav === navKey || (a.dataset.nav === 'more' && MORE_KEYS.includes(navKey));
    a.classList.toggle('on', onIt);
    if (onIt) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  switch (p0) {
    case 'nb': return viewNotebook(p1);
    case 'sec': return p2 === 'pdf' ? go(`#/pdfs/${p1}`) : viewSection(p1, p2);
    case 'import': return viewImport(p1, p2);
    case 'review': return viewReview(p1 === 'exam');
    case 'settings': return viewSettings();
    case 'cards': return viewCardsHome();
    case 'links': return viewLinks();
    case 'guide': return viewGuide();
    case 'more': return viewMore();
    case 'search': return viewSearch();
    case 'calendar': return viewCalendar();
    case 'clinic': return viewClinic();
    case 'glossary': return viewGlossary();
    case 'tag': return viewTag(p1);
    case 'pdf': return viewPdf(p1, p2);
    case 'pdfs': return viewPdfLibrary(p1, p2);
    case 'exam': return viewExam(p1, p2);
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
  const dueSecs = state.sections.filter(isDue).length;
  const cc = cardCounts(state.cards);
  const cardsNow = cc.n + cc.l + cc.r;
  const todayBits = [];
  if (dueSecs) todayBits.push(`${dueSecs} ${dueSecs === 1 ? 'sezione' : 'sezioni'} da ripassare`);
  if (cardsNow) todayBits.push(`${cardsNow} flashcard da studiare`);
  setView(`
    <header class="page-head">
      <h1>I tuoi notebook</h1>
      ${nbs.length ? '<button class="btn primary" data-act="new-nb">Nuovo notebook</button>' : ''}
    </header>
    ${nbs.length && todayBits.length ? `
      <a class="today" href="${dueSecs ? '#/review' : '#/study/all'}">
        <span class="today-main">
          <span class="today-title">Oggi</span>
          <span class="today-sub">${todayBits.join(', ')}</span>
        </span>
        <span class="btn primary sm">${dueSecs ? 'Ripassa' : 'Studia'}</span>
      </a>` : ''}
    ${nbs.length ? '<input type="search" class="input search" id="globalSearch" placeholder="Cerca in appunti, flashcard, PDF, glossario…" aria-label="Cerca in appunti, flashcard, PDF, glossario e note cliniche"><div id="searchOut" hidden></div>' : ''}
    ${nbs.length ? `
      <ul class="list" id="nbList">
        ${nbs.map(nb => {
          const secs = secsOf(nb.id);
          const due = secs.filter(isDue).length;
          return `
            <li>
              <a class="row" href="#/nb/${nb.id}">
                ${nbTile(nb)}
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
        <p>Crea un notebook per ogni materia, poi importa appunti, capitoli, PDF o mappe XMind.</p>
        <button class="btn primary" data-act="new-nb">Crea il primo notebook</button>
        <a class="btn" href="#/guide">Leggi la guida</a>
      </div>`}
  `);
  on('[data-act="new-nb"]', 'click', async () => {
    const nb = await createNotebookFlow();
    if (nb) go(`#/nb/${nb.id}`);
  });
  const gs = $('#globalSearch');
  if (gs && $('#searchOut')) bindUnifiedSearch(gs, $('#searchOut'), $('#nbList'));
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
  const groups = groupsOf(nb);
  const gIds = new Set(groups.map(g => g.id));
  const loose = secs.filter(s => !gIds.has(s.groupId));
  const foldKey = `nb:${id}`;
  const closed = new Set(foldGet(foldKey));
  const lede = [
    `${secs.length} ${secs.length === 1 ? 'sezione' : 'sezioni'}`,
    topGroups(nb).length ? `${topGroups(nb).length} ${topGroups(nb).length === 1 ? 'macro-argomento' : 'macro-argomenti'}` : '',
    due ? `${due} da ripassare oggi` : '',
    nbCards.length ? `${nbCards.length} flashcard` : ''
  ].filter(Boolean).join(', ');
  const groupBlock = g => {
    const gs = secs.filter(s => s.groupId === g.id);
    const subs = groupParent(nb, g) ? [] : subGroups(nb, g);
    const all = secs.filter(s => s.groupId === g.id || subs.some(x => x.id === s.groupId));
    const gd = all.filter(isDue).length;
    const isSub = !!groupParent(nb, g);
    const meta = [
      subs.length ? `${subs.length} ${subs.length === 1 ? 'sottoargomento' : 'sottoargomenti'}` : '',
      gs.length ? `${gs.length} ${gs.length === 1 ? 'sezione' : 'sezioni'}` : ''
    ].filter(Boolean).join(', ') || 'Ancora vuoto';
    return `
      <section class="grp fold ${isSub ? 'sub-grp' : ''}" data-fold="${g.id}" data-g="${g.id}">
        <div class="grp-head">
          <button class="fold-btn" type="button" data-name="${esc(g.name)}">${CHEVRON}</button>
          <span class="grp-main">
            <h2 class="grp-title">${esc(g.name)}</h2>
            <span class="grp-meta">${meta}${gd ? `, <b>${gd} da ripassare</b>` : ''}</span>
          </span>
          <button class="btn ghost sm grp-more" type="button" data-gmenu="${g.id}" aria-label="Opzioni per ${esc(g.name)}">Opzioni</button>
        </div>
        <div class="fold-body">
          ${gs.length ? `<ul class="list sec-list">${gs.map(s => sectionRow(s)).join('')}</ul>` : ''}
          ${subs.map(groupBlock).join('')}
          ${gs.length || subs.length ? '' : `
            <div class="grp-empty">
              <button class="btn sm" type="button" data-gadd="${g.id}">Aggiungi sezioni esistenti</button>
              <a class="btn sm ghost" href="#/import/${id}/${g.id}">Importa qui</a>
            </div>`}
        </div>
      </section>`;
  };
  setView(`
    <a class="back" href="#/notebooks">Tutti i notebook</a>
    <header class="page-head">
      <div>
        <h1>${esc(nb.name)}</h1>
        <p class="lede">${lede}</p>
      </div>
      <div class="actions">
        <a class="btn primary" href="#/import/${nb.id}">Importa</a>
        ${nbCards.length ? `<a class="btn" href="#/deck/${nb.id}">Flashcard</a>` : ''}
        <button class="btn" data-act="new-sec">Scrivi una sezione</button>
        <button class="btn" data-act="new-grp">Nuovo macro-argomento</button>
        <a class="btn" href="#/pdfs/nb/${nb.id}">PDF${state.pdfs.some(p => p.notebookId === nb.id) ? ` (${state.pdfs.filter(p => p.notebookId === nb.id).length})` : ''}</a>
        ${secs.length ? `<a class="btn" href="#/exam/${nb.id}">Simulazione d’esame</a>` : ''}
        <button class="btn ghost" data-act="nb-more">Altro</button>
      </div>
    </header>
    ${secs.length > 3 ? '<input type="search" class="input search" id="secSearch" placeholder="Cerca nel notebook" aria-label="Cerca nel notebook">' : ''}
    <div id="nbBody">
      ${topGroups(nb).map(groupBlock).join('')}
      ${loose.length ? `
        <section class="grp-loose">
          ${groups.length ? '<h2 class="sub">Senza macro-argomento</h2>' : ''}
          <ul class="list sec-list">${loose.map(s => sectionRow(s)).join('')}</ul>
        </section>` : ''}
      ${!secs.length && !groups.length ? `
        <div class="empty">
          <p>Notebook vuoto. Importa testo o un PDF, oppure scrivi una sezione a mano. Con i macro-argomenti (per esempio un apparato o un capitolo) raggruppi le sezioni, che diventano i micro-argomenti.</p>
          <a class="btn primary" href="#/import/${nb.id}">Importa</a>
          <button class="btn" data-act="new-grp">Nuovo macro-argomento</button>
        </div>` : ''}
    </div>
    <p class="hint" id="noMatch" hidden>Nessuna sezione contiene questo testo.</p>
  `);

  const box = $('#nbBody');
  $$('.grp', box).forEach(g => setFold(g, closed.has(g.dataset.g)));
  const saveFolds = () => foldSet(foldKey, $$('.grp.closed', box).map(g => g.dataset.g));
  box.addEventListener('click', e => {
    const head = e.target.closest('.grp-head');
    if (!head || e.target.closest('.grp-more')) return;
    const grp = head.parentElement;
    setFold(grp, !grp.classList.contains('closed'));
    saveFolds();
  });

  const newSecIn = async groupId => {
    const sec = newSection(id, { title: 'Nuova sezione', groupId });
    await saveSection(sec);
    go(`#/sec/${sec.id}/edit`);
  };
  const addSectionsTo = async g => {
    const ids = await pickSectionsSheet(nb, g);
    if (!ids || !ids.length) return false;
    for (const sid of ids) {
      const s = secById(sid);
      if (s) { s.groupId = g.id; await saveSection(s); }
    }
    // il macro-argomento si apre per mostrare le sezioni appena aggiunte
    foldSet(foldKey, foldGet(foldKey).filter(x => x !== g.id));
    toast(`${ids.length} ${ids.length === 1 ? 'sezione spostata' : 'sezioni spostate'} in ${g.name}`);
    route();
    return true;
  };

  on('[data-act="new-sec"]', 'click', () => newSecIn(null));
  on('[data-act="new-grp"]', 'click', async () => {
    const g = await createGroupFlow(nb);
    if (!g) return;
    toast('Macro-argomento creato');
    const moved = loose.length ? await addSectionsTo(g) : false;
    if (!moved) route();
  });
  on('[data-gadd]', 'click', e => {
    const g = groups.find(x => x.id === e.currentTarget.dataset.gadd);
    if (g) addSectionsTo(g);
  });
  on('[data-gmenu]', 'click', async e => {
    const gi = groups.findIndex(x => x.id === e.currentTarget.dataset.gmenu);
    const g = groups[gi];
    if (!g) return;
    const parent = groupParent(nb, g);
    const sibs = groups.filter(x => (parent ? x.parentId === parent.id : !groupParent(nb, x)));
    const si = sibs.indexOf(g);
    const nIn = secs.filter(s => s.groupId === g.id).length;
    const kids = parent ? [] : subGroups(nb, g);
    const word = parent ? 'sottoargomento' : 'macro-argomento';
    const choice = await actionSheet(g.name, [
      { key: 'add', label: 'Aggiungi sezioni esistenti' },
      { key: 'write', label: 'Scrivi una sezione qui' },
      ...(parent ? [] : [{ key: 'sub', label: 'Nuovo sottoargomento' }]),
      { key: 'import', label: 'Importa qui' },
      { key: 'exam', label: 'Simulazione d’esame su questo argomento' },
      { key: 'rename', label: 'Rinomina' },
      { key: 'up', label: 'Sposta su', disabled: si <= 0 },
      { key: 'down', label: 'Sposta giù', disabled: si === sibs.length - 1 },
      { key: 'delete', label: `Elimina il ${word}`, danger: true }
    ]);
    if (choice === 'sub') {
      const sg = await createGroupFlow(nb, g.id);
      if (!sg) return;
      foldSet(foldKey, foldGet(foldKey).filter(x => x !== g.id));
      const moved = secs.some(s => s.groupId === g.id) ? await addSectionsTo(sg) : false;
      if (!moved) route();
      return;
    }
    if (choice === 'add') return addSectionsTo(g);
    if (choice === 'write') return newSecIn(g.id);
    if (choice === 'import') return go(`#/import/${id}/${g.id}`);
    if (choice === 'exam') { examRun = null; return go(`#/exam/${id}/${g.id}`); }
    if (choice === 'rename') {
      const name = await modal({ title: `Rinomina il ${word}`, input: true, value: g.name, confirm: 'Rinomina' });
      if (!name) return;
      g.name = name;
      await saveNotebook(nb);
      return route();
    }
    if (choice === 'up' || choice === 'down') {
      const other = sibs[si + (choice === 'up' ? -1 : 1)];
      const to = groups.indexOf(other);
      const arr = [...groups];
      [arr[gi], arr[to]] = [arr[to], arr[gi]];
      nb.groups = arr;
      await saveNotebook(nb);
      return route();
    }
    if (choice === 'delete') {
      const ok = await modal({
        title: `Eliminare il ${word}?`,
        text: [
          nIn ? `Le sue ${nIn} sezioni restano nel notebook${parent ? `, dentro ${parent.name}` : ', senza macro-argomento'}.` : 'Non perdi nessuna sezione.',
          kids.length ? `I suoi ${kids.length} sottoargomenti diventano macro-argomenti.` : ''
        ].filter(Boolean).join(' '),
        confirm: 'Elimina', danger: true
      });
      if (!ok) return;
      for (const s of secs.filter(x => x.groupId === g.id)) { s.groupId = parent ? parent.id : null; await saveSection(s); }
      kids.forEach(k => { delete k.parentId; });
      nb.groups = groups.filter(x => x.id !== g.id);
      await saveNotebook(nb);
      foldSet(foldKey, foldGet(foldKey).filter(x => x !== g.id));
      toast(parent ? 'Sottoargomento eliminato' : 'Macro-argomento eliminato');
      route();
    }
  });
  const renameNb = async () => {
    const name = await modal({ title: 'Rinomina notebook', input: true, value: nb.name, confirm: 'Rinomina' });
    if (!name) return;
    nb.name = name;
    await saveNotebook(nb);
    route();
  };
  const deleteNb = async () => {
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
    for (const p of state.pdfs.filter(x => x.notebookId === id)) await deletePdf(p.id);
    foldSet(foldKey, []);
    toast('Notebook eliminato');
    go('#/notebooks');
  };
  on('[data-act="nb-more"]', 'click', async () => {
    const choice = await actionSheet(nb.name, [
      { key: 'rename', label: 'Rinomina il notebook' },
      { key: 'delete', label: 'Elimina il notebook', danger: true }
    ]);
    if (choice === 'rename') renameNb();
    if (choice === 'delete') deleteNb();
  });
  const search = $('#secSearch');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      box.classList.toggle('searching', !!q);
      let shown = 0;
      $$('.sec-list li', box).forEach(li => {
        const s = secById(li.dataset.id);
        const hit = !q || (s && (s.title + '\n' + stripCloze(s.md)).toLowerCase().includes(q));
        li.hidden = !hit;
        if (hit) shown++;
      });
      // durante la ricerca restano visibili solo i gruppi con risultati
      $$('.grp, .grp-loose', box).forEach(g => {
        g.hidden = !!q && !$$('.sec-list li', g).some(li => !li.hidden);
      });
      $('#noMatch').hidden = shown > 0 || !q;
    });
  }
}

async function createGroupFlow(nb, parentId = null) {
  const parent = parentId ? groupsOf(nb).find(x => x.id === parentId) : null;
  const name = await modal(parent ? {
    title: 'Nuovo sottoargomento',
    text: `Dentro ${parent.name}. Raccoglie alcune sezioni del macro-argomento.`,
    input: true, placeholder: 'Es. Valvulopatie', confirm: 'Crea'
  } : {
    title: 'Nuovo macro-argomento',
    text: 'Un grande tema del notebook, per esempio un apparato o un capitolo. Dentro puoi creare sottoargomenti e metterci le sezioni.',
    input: true, placeholder: 'Es. Sistema cardiovascolare', confirm: 'Crea'
  });
  if (!name) return null;
  const g = { id: uid(), name };
  if (parent) g.parentId = parent.id;
  nb.groups = [...groupsOf(nb), g];
  await saveNotebook(nb);
  return g;
}

// Finestra con un elenco di azioni; restituisce la chiave scelta o null
function actionSheet(title, items) {
  return new Promise(resolve => {
    const root = $('#modalRoot');
    const prevFocus = document.activeElement;
    root.innerHTML = `
      <div class="overlay">
        <div class="modal sheet" role="dialog" aria-modal="true" aria-labelledby="asTitle">
          <h2 id="asTitle">${esc(title)}</h2>
          <div class="as-list">
            ${items.map(it => `<button type="button" class="as-item ${it.danger ? 'danger' : ''}" data-as="${it.key}" ${it.disabled ? 'disabled' : ''}>${esc(it.label)}</button>`).join('')}
          </div>
          <div class="modal-actions"><button class="btn ghost" type="button" data-as-close>Chiudi</button></div>
        </div>
      </div>`;
    const close = v => {
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus();
      resolve(v);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    $('.overlay', root).addEventListener('click', e => {
      if (e.target.classList.contains('overlay') || e.target.closest('[data-as-close]')) return close(null);
      const b = e.target.closest('[data-as]');
      if (b && !b.disabled) close(b.dataset.as);
    });
    setTimeout(() => $('.as-item:not(:disabled)', root)?.focus(), 30);
  });
}

// Scelta delle sezioni da mettere in un macro-argomento
function pickSectionsSheet(nb, g) {
  return new Promise(resolve => {
    const root = $('#modalRoot');
    const others = secsOf(nb.id).filter(s => s.groupId !== g.id);
    const where = s => groupPathText(s);
    root.innerHTML = `
      <div class="overlay">
        <div class="modal sheet" role="dialog" aria-modal="true" aria-labelledby="psTitle">
          <h2 id="psTitle">Aggiungi a ${esc(g.name)}</h2>
          ${others.length ? `
            <p class="sheet-sub">Scegli le sezioni da spostare in questo macro-argomento.</p>
            <ul class="cand">${others.map(s => `
              <li><label class="check"><input type="checkbox" value="${s.id}">
                <span><span class="cand-f">${esc(s.title)}</span>${where(s) ? `<span class="cand-b">Ora in ${esc(where(s))}</span>` : ''}</span></label></li>`).join('')}
            </ul>` : '<p>Tutte le sezioni del notebook sono già qui.</p>'}
          <div class="modal-actions">
            <button class="btn ghost" type="button" data-ps="no">Annulla</button>
            ${others.length ? '<button class="btn primary" type="button" data-ps="ok">Aggiungi</button>' : ''}
          </div>
        </div>
      </div>`;
    const close = v => { root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    $('.overlay', root).addEventListener('click', e => { if (e.target.classList.contains('overlay')) close(null); });
    $('[data-ps="no"]', root).onclick = () => close(null);
    const okBtn = $('[data-ps="ok"]', root);
    if (okBtn) okBtn.onclick = () => {
      const ids = $$('input:checked', root).map(i => i.value);
      if (!ids.length) { toast('Scegli almeno una sezione'); return; }
      close(ids);
    };
  });
}

/* ---------------------------------------------------------------------
   Vista: sezione con le modalità di studio
   --------------------------------------------------------------------- */
const MODES = [['cloze', 'Cloze'], ['read', 'Leggi'], ['blank', 'Pagina bianca'], ['oral', 'Orale'], ['quiz', 'Domande'], ['cards', 'Flashcard'], ['edit', 'Modifica']];

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
  // appunti già salvati con un cloze rimasto aperto: li sistemo una volta
  if (mode !== 'edit' && typeof sec.md === 'string' && repairClozes(sec.md) !== sec.md) {
    saveSection(sec).then(() => { toast('Ho chiuso un cloze rimasto aperto in questa sezione'); route(); });
    return;
  }
  if (!MODES.some(([m]) => m === mode)) mode = openMode(sec);
  const nb = nbById(sec.notebookId);
  const back = state.fromReview
    ? '<a class="back" href="#/review">Ripasso</a>'
    : `<a class="back" href="#/nb/${sec.notebookId}">${esc(nb ? nb.name : 'Notebook')}${groupPathText(sec) ? ` › ${esc(groupPathText(sec))}` : ''}</a>`;
  setView(`
    ${back}
    <header class="sec-head">
      <h1>${esc(sec.title)}</h1>
      <p class="meta">${esc(srsLabel(sec))}</p>
      ${tagChips(tagsOf(sec))}
      <div class="sec-extra">
        <a class="btn sm" href="#/pdfs/${sec.id}">PDF${pdfsOf(sec.id).length ? ` (${pdfsOf(sec.id).length})` : ''}</a>
        ${secLinksOf(sec).map(l => `<a class="btn sm ghost sec-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">↗ ${esc(l.title)}</a>`).join('')}
      </div>
    </header>
    <nav class="tabs" aria-label="Modalità di studio">
      ${MODES.map(([m, l]) => `<a href="#/sec/${id}/${m}" class="tab ${m === mode ? 'on' : ''}" ${m === mode ? 'aria-current="page"' : ''}>${l}</a>`).join('')}
    </nav>
    <section id="modeBody" class="mode-body"></section>
  `);
  // Cambiare scheda non riempie la cronologia: il tasto Indietro torna al notebook.
  on('.tabs a', 'click', e => { e.preventDefault(); location.replace(e.currentTarget.getAttribute('href')); });
  const tabsEl = $('.tabs');
  const onTab = $('.tab.on', tabsEl);
  if (tabsEl && onTab) {
    const t = onTab.getBoundingClientRect(), n = tabsEl.getBoundingClientRect();
    tabsEl.scrollLeft += t.left - n.left - (n.width - t.width) / 2;
  }
  const body = $('#modeBody');
  ({ read: modeRead, cloze: modeCloze, blank: modeBlank, oral: (s, b) => modeBlank(s, b, { oral: true }), quiz: modeQuiz, cards: modeCards, edit: modeEdit }[mode])(sec, body);
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
    Stats.addReview();
    delete drafts[sec.id];
    delete drafts['oral:' + sec.id];
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

/* ---------------------------------------------------------------------
   Paragrafi richiudibili: ogni titolo degli appunti ha una freccetta che
   riduce tutto quello che sta sotto, fino al titolo successivo dello stesso
   livello. Lo stato resta salvato su questo dispositivo.
   --------------------------------------------------------------------- */
const FOLD_KEY = 'nb-folds';
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
function foldGet(key) {
  try {
    const all = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}');
    return Array.isArray(all[key]) ? all[key] : [];
  } catch { return []; }
}
function foldSet(key, list) {
  try {
    const all = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}');
    if (list.length) all[key] = list; else delete all[key];
    localStorage.setItem(FOLD_KEY, JSON.stringify(all));
  } catch { /* è solo una preferenza di questo dispositivo */ }
}
function setFold(fold, closed) {
  fold.classList.toggle('closed', closed);
  const b = fold.querySelector(':scope > .fold-h > .fold-btn, :scope > .grp-head > .fold-btn');
  if (b) {
    b.setAttribute('aria-expanded', String(!closed));
    b.setAttribute('aria-label', `${closed ? 'Espandi' : 'Riduci'} ${b.dataset.name || ''}`.trim());
  }
}
function setupFolds(article, key) {
  const kids = [...article.children];
  if (!kids.some(el => /^H[1-4]$/.test(el.tagName))) return null;
  const closed = new Set(foldGet(key));
  const seen = {};
  const frag = document.createDocumentFragment();
  const stack = [];
  const target = () => (stack.length ? stack[stack.length - 1].body : frag);
  for (const el of kids) {
    const m = /^H([1-4])$/.exec(el.tagName);
    if (!m) { target().appendChild(el); continue; }
    const lvl = +m[1];
    while (stack.length && stack[stack.length - 1].lvl >= lvl) stack.pop();
    const name = el.textContent.replace(/\s+/g, ' ').trim();
    const short = name.slice(0, 80);
    seen[short] = (seen[short] || 0) + 1;
    const fold = document.createElement('section');
    fold.className = 'fold';
    fold.dataset.fold = `${lvl}:${short}#${seen[short]}`;
    el.classList.add('fold-h');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fold-btn';
    btn.dataset.name = name.slice(0, 60);
    btn.innerHTML = CHEVRON;
    el.prepend(btn);
    const body = document.createElement('div');
    body.className = 'fold-body';
    fold.append(el, body);
    target().appendChild(fold);
    stack.push({ lvl, body });
  }
  article.replaceChildren(frag);
  $$('.fold', article).forEach(f => {
    const empty = !f.querySelector(':scope > .fold-body').childElementCount;
    f.classList.toggle('fold-empty', empty);
    if (empty) f.querySelector(':scope > .fold-h > .fold-btn').disabled = true;
    setFold(f, !empty && closed.has(f.dataset.fold));
  });
  const save = () => foldSet(key, $$('.fold.closed', article).map(f => f.dataset.fold));
  article.addEventListener('click', e => {
    const h = e.target.closest('.fold-h');
    if (!h || !article.contains(h) || h.parentElement.classList.contains('fold-empty')) return;
    if (!e.target.closest('.fold-btn')) {
      // il titolo intero è cliccabile, tranne cloze nascosti, link e immagini
      if (e.target.closest('mark.cz, a, img, button')) return;
      const sel = document.getSelection();
      if (sel && !sel.isCollapsed) return;
    }
    const fold = h.parentElement;
    setFold(fold, !fold.classList.contains('closed'));
    save();
  });
  const live = () => $$('.fold:not(.fold-empty)', article);
  return {
    anyOpen: () => live().some(f => !f.classList.contains('closed')),
    setAll(isClosed) { live().forEach(f => setFold(f, isClosed)); save(); },
    // apre i paragrafi che contengono el (per esempio il prossimo cloze da rivelare)
    reveal(el) {
      let f = el.parentElement?.closest('.fold');
      let changed = false;
      while (f && article.contains(f)) {
        if (f.classList.contains('closed') && !f.querySelector(':scope > .fold-h')?.contains(el)) { setFold(f, false); changed = true; }
        f = f.parentElement?.closest('.fold');
      }
      if (changed) save();
    }
  };
}
// Pulsante unico "Riduci tutto / Espandi tutto"
function bindFoldAll(btn, api) {
  if (!btn) return;
  if (!api) { btn.hidden = true; return; }
  btn.hidden = false;
  const label = () => { btn.textContent = api.anyOpen() ? 'Riduci tutto' : 'Espandi tutto'; };
  label();
  btn.addEventListener('click', () => { api.setAll(api.anyOpen()); label(); });
  btn.closest('.mode-body, #view')?.addEventListener('click', e => { if (e.target.closest('.fold-h')) setTimeout(label, 0); });
}

/* Leggi */
function modeRead(sec, body) {
  body.innerHTML = `
    ${sec.needsFormat && AI.ready() ? `
      <div class="callout">
        <p>Questa sezione è stata salvata senza formattazione AI.</p>
        <button class="btn" data-act="fmt">Formatta con ${AI.name()}</button>
      </div>` : ''}
    ${sec.md.trim() ? `<div class="fold-tools"><button class="btn sm ghost ink-btn" data-act="listen" hidden>Ascolta</button><button class="btn sm ghost ink-btn" data-act="ink" hidden>Scrivi a mano</button><button class="btn sm ghost" data-act="imgs" hidden></button><button class="btn sm ghost" data-act="fold-all" hidden></button></div><article class="notes">${renderMd(sec.md)}</article>` : `
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
  if (notesEl) {
    const readFolds = setupFolds(notesEl, sec.id);
    bindFoldAll($('[data-act="fold-all"]', body), readFolds);
    bindImagesToggle($('[data-act="imgs"]', body), prepareImages(notesEl, sec).count);
    markGlossary(notesEl);
    bindGlossaryClicks(notesEl);
    setupReadingTools(notesEl, sec);
    setupNotesInk(notesEl, sec, $('[data-act="ink"]', body));
    setupListen(notesEl, $('[data-act="listen"]', body), readFolds);
    const bl = backlinksOf(sec);
    if (bl.length) notesEl.insertAdjacentHTML('afterend', `<h2 class="sub backlinks">Pagine che rimandano qui</h2><ul class="list">${bl.map(s => sectionRow(s, { showNb: true })).join('')}</ul>`);
  }
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
  const n = countCloze(sec.md) + ioMaskCount(sec);
  if (!n) {
    body.innerHTML = `
      <div class="empty">
        <p>Nessun termine da nascondere. In Modifica selezioni una parola e tocchi “Cloze”; sugli schemi tocchi l’immagine in Leggi e crei un’image occlusion.</p>
        <a class="btn primary" href="#/sec/${sec.id}/edit">Apri Modifica</a>
      </div>`;
    return;
  }
  body.innerHTML = `
    <div class="toolbar">
      <span id="czCount" aria-live="polite">0 di ${n} rivelati</span>
      <button class="btn sm" data-act="reveal-all">Rivela tutto</button>
      <button class="btn sm ghost" data-act="hide-all">Nascondi di nuovo</button>
      <button class="btn sm ghost" data-act="hints" aria-pressed="false" title="Tocca un termine per scrivere il suo suggerimento">Suggerimenti</button>
      <button class="btn sm ghost" data-act="fold-all" hidden></button>
      <button class="btn sm ghost" data-act="imgs" hidden></button>
    </div>
    <p class="hint">Prova a ricordare ogni termine, poi toccalo per controllare.<span class="kbd-hint"> Con la tastiera: Spazio rivela il successivo, 1-4 per valutare.</span></p>
    <article class="notes cloze-mode">${renderMd(sec.md)}</article>
    <div id="gradeSlot"></div>`;
  const folds = setupFolds($('.notes', body), sec.id);
  bindFoldAll($('[data-act="fold-all"]', body), folds);
  bindImagesToggle($('[data-act="imgs"]', body), prepareImages($('.notes', body), sec, { cloze: true }).count);
  setupClozeMarks($('.notes', body), sec);
  const weak = czWeakOf(sec);
  if (weak.length) {
    $('.notes', body).insertAdjacentHTML('beforebegin', `
      <details class="czw-box">
        <summary><b>Punti deboli:</b> ${weak.length === 1 ? 'una parte è rimasta' : `${weak.length} parti sono rimaste`} in rosso o arancio più volte. Conviene farne flashcard o ripassare la sezione più spesso.</summary>
        <ul class="czw-list">${weak.map(w => czWeakItemHtml(sec, w)).join('')}</ul>
      </details>`);
    bindCzWeak($('.czw-box', body));
  }
  const marks = $$('mark.cz, .cz-io', body);
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
    m.setAttribute('aria-label', 'Termine mostrato, attiva per nasconderlo di nuovo');
    update();
  };
  const update = () => {
    const r = marks.filter(m => m.classList.contains('shown')).length;
    $('#czCount', body).textContent = `${r} di ${marks.length} rivelati`;
    if (r === marks.length && !slot.innerHTML) gradeBar(sec, slot, { mode: 'cloze' });
  };
  marks.forEach(hide);
  // suggerimenti: un “?” accanto ai termini che ne hanno uno
  const article = $('.notes', body);
  $$('mark.cz[data-hint]', article).forEach(m => {
    const w = document.createElement('span');
    w.className = 'cz-hint-wrap';
    w.innerHTML = `<button type="button" class="cz-hint" aria-expanded="false" aria-label="Mostra il suggerimento">?</button><span class="cz-hint-text" hidden></span>`;
    $('.cz-hint-text', w).textContent = m.dataset.hint;
    m.after(w);
  });
  article.addEventListener('click', e => {
    const b = e.target.closest('.cz-hint');
    if (!b) return;
    const t = b.nextElementSibling;
    t.hidden = !t.hidden;
    b.setAttribute('aria-expanded', !t.hidden);
    b.classList.toggle('open', !t.hidden);
  });
  let hintEdit = false;
  const hintBtn = $('[data-act="hints"]', body);
  hintBtn.addEventListener('click', () => {
    hintEdit = !hintEdit;
    hintBtn.setAttribute('aria-pressed', hintEdit);
    hintBtn.classList.toggle('on', hintEdit);
    hintBtn.textContent = hintEdit ? 'Fine suggerimenti' : 'Suggerimenti';
    article.classList.toggle('hint-edit', hintEdit);
    if (hintEdit) toast('Tocca un termine per scrivere o cambiare il suo suggerimento');
  });
  const editHint = async m => {
    const textMarks = $$('mark.cz', article);
    const idx = textMarks.indexOf(m);
    const r = clozeMatchFor(sec.md, idx, m.textContent);
    if (!r) { toast('Non trovo questo termine negli appunti: aggiungi il suggerimento da Modifica', 'err'); return; }
    const [term, old] = splitHint(r.inner);
    const v = await modal({ title: 'Suggerimento', text: `Per “${term}”. Compare come “?” accanto al termine nascosto, e al posto dei puntini nelle flashcard. Lascia vuoto per toglierlo.`, input: true, value: old, placeholder: 'Es. ormone che abbassa la glicemia', confirm: 'Salva', allowEmpty: true });
    if (v === null) return;
    const clean = v.trim().replace(/==/g, '=').replace(/\n/g, ' ');
    sec.md = sec.md.slice(0, r.start) + `==${term}${clean ? `::${clean}` : ''}==` + sec.md.slice(r.end);
    await saveSection(sec);
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
    toast(clean ? 'Suggerimento salvato' : 'Suggerimento tolto');
  };
  body.addEventListener('click', e => {
    const m = e.target.closest('mark.cz, .cz-io');
    if (!m || !marks.includes(m)) return;
    if (hintEdit && m.matches('mark.cz')) { editHint(m); return; }
    if (m.classList.contains('hidden')) reveal(m);
    else { hide(m); update(); }
  });
  on('[data-act="reveal-all"]', 'click', () => marks.forEach(reveal), body);
  on('[data-act="hide-all"]', 'click', () => { marks.forEach(hide); slot.innerHTML = ''; update(); }, body);
  const onKey = e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || $('#modalRoot').children.length) return;
    if (e.key !== ' ' && e.key !== 'Enter') return;
    const focused = document.activeElement?.closest?.('mark.cz.hidden, .cz-io.hidden');
    if (e.key === 'Enter' && !focused) return;
    const target = focused || marks.find(m => m.classList.contains('hidden'));
    if (!target) return;
    e.preventDefault();
    if (folds) folds.reveal(target);
    reveal(target);
    target.scrollIntoView({ block: 'nearest' });
    const nextHidden = marks.find(m => m.classList.contains('hidden'));
    if (nextHidden && focused) nextHidden.focus({ preventScroll: true });
  };
  document.addEventListener('keydown', onKey);
  addCleanup(() => document.removeEventListener('keydown', onKey));
}

/* ---------------------------------------------------------------------
   Voce: dettatura in italiano (riconoscimento vocale del browser) e
   lettura ad alta voce. Su Android la trascrizione richiede internet.
   --------------------------------------------------------------------- */
const SpeechRec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
function speak(text) {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'it-IT';
  speechSynthesis.speak(u);
}
// Ogni pausa chiude una frase: il riconoscimento ripartirà da solo finché non premi Stop
function createDictation({ onText, onInterim = () => {}, onState = () => {} }) {
  if (!SpeechRec) return null;
  let rec = null;
  let want = false;
  let quick = 0;
  const run = () => {
    const startedAt = Date.now();
    rec = new SpeechRec();
    rec.lang = 'it-IT';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = e => {
      let fin = '';
      let mid = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t; else mid += t;
      }
      if (fin.trim()) onText(fin.trim());
      onInterim(mid.trim());
    };
    rec.onerror = e => {
      const msg = {
        'not-allowed': 'Consenti l’uso del microfono per rispondere a voce',
        'service-not-allowed': 'Consenti l’uso del microfono per rispondere a voce',
        'audio-capture': 'Microfono non disponibile',
        network: 'La trascrizione vocale richiede internet'
      }[e.error];
      if (msg) { want = false; toast(msg, 'err'); }
    };
    rec.onend = () => {
      onInterim('');
      // se si chiude subito più volte di fila c’è un problema: mi fermo
      quick = Date.now() - startedAt < 400 ? quick + 1 : 0;
      if (want && quick < 4) { try { run(); return; } catch { /* ripartenza non riuscita */ } }
      want = false;
      onState(false);
    };
    rec.start();
  };
  return {
    get on() { return want; },
    start() {
      if (want) return;
      want = true;
      quick = 0;
      onState(true);
      try { run(); } catch { want = false; onState(false); toast('Non riesco ad avviare il microfono', 'err'); }
    },
    stop() {
      want = false;
      try { rec && rec.stop(); } catch { /* già fermo */ }
      onState(false);
    }
  };
}
// Aggiunge una frase dettata in fondo a un campo di testo
function appendSpoken(ta, t) {
  const s = t.charAt(0).toUpperCase() + t.slice(1);
  const sep = ta.value && !/\s$/.test(ta.value) ? ' ' : '';
  ta.value += sep + s + (/[.!?;:]$/.test(s) ? '' : '.');
  ta.scrollTop = ta.scrollHeight;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/* Pagina bianca e Orale */
function modeBlank(sec, body, { oral = false } = {}) {
  const dk = oral ? `oral:${sec.id}` : sec.id;
  const headings = (sec.md.match(/^#{1,4}\s+.+$/gm) || []).map(h => stripCloze(h.replace(/^#+\s+/, '')));
  body.innerHTML = `
    <p class="hint">${oral
      ? 'Spiega la sezione ad alta voce, come all’esame. La trascrizione compare qui sotto e puoi correggerla; poi confrontala con gli appunti o falla valutare dall’AI.'
      : 'Scrivi tutto quello che ricordi di questa sezione senza guardare, poi confronta con gli appunti.'}</p>
    ${oral ? (SpeechRec ? `
      <div class="oral-box">
        <button class="mic-btn" type="button" data-act="mic" aria-pressed="false">${MIC_SVG}<span class="mic-label">Inizia a parlare</span></button>
        <p class="oral-live" aria-live="polite"></p>
      </div>` : '<div class="callout"><p>Questo browser non trascrive la voce. Usa Chrome, oppure il microfono della tastiera del telefono nel riquadro qui sotto.</p></div>') : ''}
    ${headings.length ? `
      <details class="outline">
        <summary>Mostra i titoli come traccia</summary>
        <ul>${headings.map(h => `<li>${esc(h)}</li>`).join('')}</ul>
      </details>` : ''}
    <label class="sr-only" for="recall">${oral ? 'Trascrizione di quello che dici' : 'Il tuo richiamo'}</label>
    <textarea id="recall" class="input recall ${oral ? 'oral' : ''}" placeholder="${oral ? 'La trascrizione comparirà qui' : 'Inizia a scrivere quello che ricordi'}">${esc(drafts[dk] || '')}</textarea>
    <div class="row-actions"><button class="btn primary" data-act="compare">Confronta con gli appunti</button></div>
    <div id="cmp"></div>
    <div id="gradeSlot"></div>`;
  const ta = $('#recall', body);
  ta.addEventListener('input', () => { drafts[dk] = ta.value; });
  let dict = null;
  const micBtn = $('[data-act="mic"]', body);
  if (micBtn) {
    const live = $('.oral-live', body);
    dict = createDictation({
      onText: t => appendSpoken(ta, t),
      onInterim: t => { live.textContent = t; },
      onState: onNow => {
        micBtn.setAttribute('aria-pressed', onNow);
        $('.mic-label', micBtn).textContent = onNow ? 'Stop' : (ta.value.trim() ? 'Continua a parlare' : 'Inizia a parlare');
        if (!onNow) live.textContent = '';
      }
    });
    micBtn.addEventListener('click', () => (dict.on ? dict.stop() : dict.start()));
    addCleanup(() => dict && dict.stop());
  }
  on('[data-act="compare"]', 'click', () => {
    if (dict) dict.stop();
    const val = ta.value.trim();
    if (!val) { toast(oral ? 'Parla o scrivi qualcosa prima di confrontare' : 'Scrivi qualcosa prima di confrontare'); ta.focus(); return; }
    $('#cmp', body).innerHTML = `
      <div class="compare">
        <div class="pane">
          <h2>${oral ? 'Quello che hai detto' : 'Il tuo richiamo'}</h2>
          <div class="mine">${esc(val).replace(/\n/g, '<br>')}</div>
        </div>
        <div class="pane">
          <h2>Appunti</h2>
          <article class="notes">${renderMd(sec.md)}</article>
        </div>
      </div>
      ${AI.ready() ? `<div class="row-actions"><button class="btn" data-act="ai-eval">Fatti valutare da ${AI.name()}</button></div><div id="evalOut"></div>` : ''}`;
    setupFolds($('#cmp .pane .notes', body), sec.id);
    gradeBar(sec, $('#gradeSlot', body), { mode: oral ? 'oral' : 'blank' });
    $('#cmp', body).scrollIntoView({ block: 'start', behavior: 'auto' });
    const evalBtn = $('[data-act="ai-eval"]', body);
    if (evalBtn) evalBtn.addEventListener('click', async () => {
      evalBtn.disabled = true;
      evalBtn.textContent = 'Valutazione in corso…';
      try {
        const r = await AI.generate({
          system: promptFor('eval'),
          text: `APPUNTI ORIGINALI:\n${aiText(sec.md)}\n\n${oral
            ? 'ESPOSIZIONE ORALE DELLO STUDENTE, trascritta in automatico (ignora parole storpiate e punteggiatura mancante se il senso è chiaro; in fondo aggiungi una breve sezione “### Esposizione” su ordine, chiarezza e lessico medico)'
            : 'RICHIAMO DELLO STUDENTE'}:\n${val}`,
          maxTokens: 4000
        });
        $('#evalOut', body).innerHTML = `<article class="notes eval">${renderMd(r.text)}</article>`;
        const m = r.text.match(/Punteggio\**\s*:?\s*\**\s*(\d{1,3})/i);
        let suggested;
        if (m) {
          const sc = Math.min(100, +m[1]);
          suggested = sc < 40 ? 'again' : sc < 65 ? 'hard' : sc < 90 ? 'good' : 'easy';
        }
        gradeBar(sec, $('#gradeSlot', body), { mode: oral ? 'oral' : 'blank', suggested });
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
        const r = await AI.generate({ system: promptFor('questions'), text: aiText(sec.md), maxTokens: 6000 });
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

  let dict = null;
  addCleanup(() => { if (dict) dict.stop(); if (canSpeak) speechSynthesis.cancel(); });
  const show = () => {
    if (dict) dict.stop();
    if (pos >= order.length) return finish();
    const item = qs[order[pos]];
    body.innerHTML = `
      <div class="qcard">
        <p class="qnum">Domanda ${pos + 1} di ${order.length}</p>
        <p class="q">${esc(stripCloze(item.q))}</p>
        ${canSpeak || SpeechRec ? `<div class="q-voice">
          ${canSpeak ? '<button class="btn sm ghost" type="button" data-act="speak">Ascolta</button>' : ''}
          ${SpeechRec ? `<button class="btn sm mic-sm" type="button" data-act="qmic" aria-pressed="false">${MIC_SVG}<span>Rispondi a voce</span></button>` : ''}
        </div>
        <p class="my-answer" hidden></p>` : ''}
        <div class="a" hidden><article class="notes">${renderMd(item.a || '_Nessuna risposta salvata._')}</article></div>
        <div class="qactions">
          <button class="btn primary" data-act="show">Mostra la risposta</button>
        </div>
      </div>`;
    const sp = $('[data-act="speak"]', body);
    if (sp) sp.addEventListener('click', () => speak(stripCloze(item.q)));
    const qm = $('[data-act="qmic"]', body);
    if (qm) {
      const out = $('.my-answer', body);
      let said = '';
      dict = createDictation({
        onText: t => { said = `${said} ${t}`.trim(); out.hidden = false; out.textContent = said; },
        onInterim: t => { if (t) { out.hidden = false; out.textContent = `${said} ${t}`.trim(); } },
        onState: onNow => { qm.setAttribute('aria-pressed', onNow); $('span', qm).textContent = onNow ? 'Stop' : 'Rispondi a voce'; }
      });
      qm.addEventListener('click', () => (dict.on ? dict.stop() : dict.start()));
    }
    $('[data-act="show"]', body).addEventListener('click', () => {
      if (dict) dict.stop();
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
function groupOptions(nb, selected) {
  const opt = (g, label) => `<option value="${g.id}" ${g.id === selected ? 'selected' : ''}>${esc(label)}</option>`;
  return `<option value="">Nessuno</option>${topGroups(nb).map(g => opt(g, g.name) + subGroups(nb, g).map(s => opt(s, `${g.name} › ${s.name}`)).join('')).join('')}<option value="__new">Nuovo macro-argomento…</option>`;
}
// Il menu dei macro-argomenti: la voce "Nuovo…" chiede il nome e lo crea subito
function bindGroupSelect(select, getNb, onPick = () => {}) {
  let prev = select.value;
  select.addEventListener('change', async () => {
    if (select.value !== '__new') { prev = select.value; onPick(prev); return; }
    const nb = getNb();
    const g = nb ? await createGroupFlow(nb) : null;
    const pick = g ? g.id : (groupsOf(getNb()).some(x => x.id === prev) ? prev : '');
    select.innerHTML = groupOptions(getNb(), pick);
    select.value = pick;
    prev = pick;
    onPick(pick);
  });
}

function modeEdit(sec, body) {
  const otherNbs = state.notebooks.filter(n => n.id !== sec.notebookId);
  body.innerHTML = `
    <div class="grid2 ed-head">
      <label class="field"><span>Titolo del micro-argomento</span><input class="input" id="edTitle" value="${esc(sec.title)}"></label>
      <label class="field"><span>Macro-argomento</span>
        <select class="input" id="edGroup">${groupOptions(nbById(sec.notebookId), groupOf(sec)?.id || '')}</select></label>
    </div>
    ${tagFieldHtml('edTags', tagsOf(sec))}
    <div class="edit-tools" role="toolbar" aria-label="Formattazione">
      <button class="btn sm" data-wrap="==" title="Nasconde il testo selezionato nella modalità Cloze">Cloze</button>
      <button class="btn sm" data-act="hint" title="Aggiunge un suggerimento al cloze dove si trova il cursore">Suggerimento</button>
      <button class="btn sm" data-wrap="**">Grassetto</button>
      <button class="btn sm" data-mark="u">Sottolinea</button>
      <span class="hl-pick" role="group" aria-label="Evidenzia">${HL_COLORS.map(c => `<button class="rt-dot hl-${c.key}" data-mark="${c.key}" type="button" title="Evidenzia in ${c.name.toLowerCase()}" aria-label="Evidenzia in ${c.name.toLowerCase()}"></button>`).join('')}</span>
      <button class="btn sm" data-ins="list">Elenco</button>
      <button class="btn sm" data-indent="1" title="Sposta la riga a destra (Tab)">Rientra →</button>
      <button class="btn sm" data-indent="-1" title="Sposta la riga a sinistra (Maiusc+Tab)">← Riduci rientro</button>
      <button class="btn sm" data-ins="table">Tabella</button>
      <button class="btn sm" data-act="xref" title="Inserisce un collegamento a un’altra sezione">Link a pagina</button>
      <button class="btn sm" data-act="html" title="Inserisce un blocco HTML">HTML</button>
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
    <label class="field"><span>Link a siti utili, uno per riga: Titolo | https://indirizzo</span>
      <textarea id="edLinks" class="input qs-edit links-edit" spellcheck="false" placeholder="Radiopaedia: stenosi aortica | https://radiopaedia.org/…">${esc(secLinksOf(sec).map(l => `${l.title} | ${l.url}`).join('\n'))}</textarea></label>
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
  bindGroupSelect($('#edGroup', body), () => nbById(sec.notebookId));
  if (editJump && editJump.secId === sec.id) {
    const jmp = editJump;
    editJump = null;
    setTimeout(() => jumpInTextarea($('#edMd', body), jmp), 60);
  }
  bindTagField(body, 'edTags');
  on('[data-act="hint"]', 'click', async () => {
    const { selectionStart: s0, selectionEnd: s1 } = ta;
    let r = clozeAround(ta.value, s0);
    let term = '';
    let old = '';
    if (r) [term, old] = splitHint(r.inner);
    else {
      term = ta.value.slice(s0, s1).trim();
      if (!term || /\n/.test(term)) { toast('Metti il cursore dentro un cloze (==termine==) o seleziona il testo da nascondere'); return; }
      r = { start: s0, end: s1 };
    }
    const v = await modal({ title: 'Suggerimento', text: `Per “${term}”: una domanda o un indizio che compare come “?” accanto al termine nascosto. Lascia vuoto per toglierlo.`, input: true, value: old, placeholder: 'Es. ormone che abbassa la glicemia', confirm: 'Salva', allowEmpty: true });
    if (v === null) return;
    const clean = v.trim().replace(/==/g, '=').replace(/\n/g, ' ');
    ta.focus();
    ta.setRangeText(`==${term}${clean ? `::${clean}` : ''}==`, r.start, r.end, 'end');
    refresh();
  }, body);
  on('[data-act="html"]', 'click', async () => {
    const { selectionStart: s0, selectionEnd: s1 } = ta;
    const code = await modal({ title: 'Blocco HTML', text: 'Incolla il codice HTML, anche una pagina intera con il suo stile. Si vede in un riquadro dentro gli appunti, separato dal resto dell’app.', input: true, multiline: true, placeholder: '<div>…</div>', confirm: 'Inserisci' });
    if (!code) return;
    const before = ta.value.slice(0, s0);
    const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    ta.focus();
    ta.setRangeText(`${pre}\`\`\`html\n${code.trim()}\n\`\`\`\n\n`, s0, s1, 'end');
    refresh();
  }, body);
  on('[data-act="xref"]', 'click', async () => {
    const { selectionStart: s0, selectionEnd: s1 } = ta;
    const s = await sectionPickerSheet('Collega una pagina', sec.id);
    if (!s) return;
    const label = ta.value.slice(s0, s1).trim().replace(/[\[\]|\n]/g, ' ');
    const title = s.title.replace(/[\[\]|]/g, ' ').trim();
    ta.focus();
    ta.setRangeText(`[[${title}${label && label !== title ? `|${label}` : ''}]]`, s0, s1, 'end');
    refresh();
  }, body);
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
      const r = await AI.generate({ system: promptFor('questions'), text: aiText(ta.value), maxTokens: 6000 });
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
    const oldTitle = sec.title;
    sec.title = $('#edTitle', body).value.trim() || 'Senza titolo';
    sec.tags = parseTags($('#edTags', body).value);
    const gv = $('#edGroup', body).value;
    sec.groupId = gv && gv !== '__new' ? gv : null;
    sec.md = ta.value;
    sec.questions = parseQuestions($('#edQs', body).value);
    sec.links = parseSecLinks($('#edLinks', body).value);
    sec.needsFormat = false;
    await saveSection(sec);
    await removeOrphanImages(before);
    const moved = await renameXrefs(oldTitle, sec.title, sec.id);
    toast(moved ? `Sezione salvata, collegamenti aggiornati in ${moved} ${moved === 1 ? 'sezione' : 'sezioni'}` : 'Sezione salvata');
    go(`#/sec/${sec.id}/read`);
  }, body);

  on('[data-act="move"]', 'click', async () => {
    const target = $('#mvNb', body).value;
    sec.notebookId = target;
    sec.groupId = null; // i macro-argomenti appartengono al notebook di partenza
    for (const p of pdfsOf(sec.id)) { p.notebookId = target; await savePdfMeta(p); }
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
function viewReview(onlyExam = false) {
  const t = todayStr();
  const ex = examRec();
  if (onlyExam && !ex) onlyExam = false;
  const pool = onlyExam ? state.sections.filter(s => inExam(s, ex)) : state.sections;
  const due = pool.filter(isDue).sort(sortDue);
  const upcoming = pool.filter(s => s.srs?.due && s.srs.due > t).sort(sortDue).slice(0, 12);
  const fresh = pool.filter(s => !s.studyhub && !s.srs?.due && s.md.trim()).sort((a, b) => a.order - b.order);
  const linked = state.sections.filter(s => s.studyhub).length;
  const cc = cardCounts(state.cards);
  const cardsNow = cc.n + cc.l + cc.r;
  setView(`
    <header class="page-head">
      <div>
        <h1>${onlyExam ? `Ripasso: ${esc(ex.name)}` : 'Ripasso'}</h1>
        <p class="lede">${due.length ? `${due.length} ${due.length === 1 ? 'sezione' : 'sezioni'} da ripassare oggi.` : 'Niente da ripassare oggi.'}${onlyExam ? ' <a href="#/review">Mostra tutto</a>' : ''}</p>
      </div>
      <div class="actions">
        ${due.length ? '<button class="btn primary" data-act="start">Inizia il ripasso</button>' : ''}
        ${ex ? '' : '<button class="btn ghost" data-act="exam-new">Modalità esame</button>'}
      </div>
    </header>
    ${examBannerHtml(onlyExam ? 'review-exam' : 'review')}
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
  bindExamBanner();
  on('[data-review]', 'click', () => { state.fromReview = true; });
  on('[data-act="start"]', 'click', () => {
    state.fromReview = true;
    go(`#/sec/${due[0].id}/${defaultMode(due[0])}`);
  });
}

/* ---------------------------------------------------------------------
   Vista: importazione
   --------------------------------------------------------------------- */
function viewImport(nbParam, groupParam) {
  if (importJob) return renderProgress();
  if (nbParam && nbById(nbParam) && nbParam !== importDraft.nbId) { importDraft.nbId = nbParam; importDraft.groupId = ''; }
  if (groupParam && groupsOf(nbById(nbParam)).some(g => g.id === groupParam)) importDraft.groupId = groupParam;
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
      <div class="field" id="imGroupBox"><label class="lbl" for="imGroup">Macro-argomento</label>
        <select class="input" id="imGroup"></select>
      </div>

      <div class="seg" role="tablist" aria-label="Tipo di fonte">
        <button role="tab" data-src="text" aria-selected="${importDraft.src === 'text'}">Testo</button>
        <button role="tab" data-src="pdf" aria-selected="${importDraft.src === 'pdf'}">PDF</button>
        <button role="tab" data-src="xmind" aria-selected="${importDraft.src === 'xmind'}">XMind</button>
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

      <div id="srcXmind" ${importDraft.src === 'xmind' ? '' : 'hidden'}>
        <label class="file-drop">
          <input type="file" id="xmFile">
          <span id="xmLabel">${importDraft.xmind ? `${esc(importDraft.xmind.name)}, tocca per cambiarla` : 'Scegli una mappa XMind (.xmind)'}</span>
        </label>
        <div id="xmInfo"></div>
      </div>

      <fieldset class="opts" id="aiOpts" ${importDraft.src === 'xmind' ? 'hidden' : ''}>
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

  const fillGroups = () => {
    const nb = nbById(importDraft.nbId);
    if (!groupsOf(nb).some(g => g.id === importDraft.groupId)) importDraft.groupId = '';
    $('#imGroupBox').hidden = !nb;
    $('#imGroup').innerHTML = groupOptions(nb, importDraft.groupId);
  };
  fillGroups();
  bindGroupSelect($('#imGroup'), () => nbById(importDraft.nbId), v => { importDraft.groupId = v; });
  $('#imNb').addEventListener('change', e => { importDraft.nbId = e.target.value; importDraft.groupId = ''; fillGroups(); });
  on('[data-act="new-nb"]', 'click', async () => {
    const nb = await createNotebookFlow();
    if (nb) { importDraft.nbId = nb.id; viewImport(); }
  });
  on('[data-src]', 'click', e => {
    importDraft.src = e.currentTarget.dataset.src;
    $$('[data-src]').forEach(b => b.setAttribute('aria-selected', b.dataset.src === importDraft.src));
    $('#srcText').hidden = importDraft.src !== 'text';
    $('#srcPdf').hidden = importDraft.src !== 'pdf';
    $('#srcXmind').hidden = importDraft.src !== 'xmind';
    $('#aiOpts').hidden = importDraft.src === 'xmind';
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
      <div class="seg sm split-seg" role="tablist" aria-label="Come dividere il PDF">
        <button type="button" role="tab" data-split="every" aria-selected="${importDraft.split !== 'ranges'}">Ogni tot pagine</button>
        <button type="button" role="tab" data-split="ranges" aria-selected="${importDraft.split === 'ranges'}">Intervalli scelti</button>
      </div>
      <div id="splitEvery" ${importDraft.split === 'ranges' ? 'hidden' : ''}>
        <div class="grid3">
          <label class="field"><span>Da pagina</span><input class="input" type="number" id="pFrom" min="1" max="${p.pages}" value="1" inputmode="numeric"></label>
          <label class="field"><span>A pagina</span><input class="input" type="number" id="pTo" min="1" max="${p.pages}" value="${p.pages}" inputmode="numeric"></label>
          <label class="field"><span>Pagine per sezione</span><input class="input" type="number" id="pPer" min="1" max="30" value="${per}" inputmode="numeric"></label>
        </div>
      </div>
      <div id="splitRanges" ${importDraft.split === 'ranges' ? '' : 'hidden'}>
        <label class="field"><span>Una riga per sezione: pagine e, se vuoi, il titolo</span>
          <textarea class="input ranges-ta" id="pRanges" spellcheck="false" placeholder="1-12 Introduzione&#10;13-30 Il cuore&#10;31-45">${esc(importDraft.rangesText)}</textarea></label>
        <button class="btn sm" type="button" data-act="chapters" ${p.chapters && p.chapters.length > 1 ? '' : 'hidden'}>Usa i capitoli del PDF (${p.chapters ? p.chapters.length : 0})</button>
      </div>
      <div class="radio">
        <label class="check"><input type="radio" name="pdfMode" value="text" ${preferAi ? '' : 'checked'}>
          <span>Estrai il testo dal PDF</span></label>
        <label class="check"><input type="radio" name="pdfMode" value="ai" ${preferAi ? 'checked' : ''} ${aiOk ? '' : 'disabled'}>
          <span>Fai leggere le pagine all’AI: funziona anche con scansioni, schemi e tabelle</span></label>
      </div>
      <label class="check"><input type="checkbox" id="optImgs" ${S().keepPdfImages ? 'checked' : ''}>
        <span>Mantieni le immagini del PDF nelle sezioni <small class="muted-inline" id="imgHint"></small></span></label>
      <p class="hint" id="pdfEstimate"></p>`;
    const est = () => {
      const r = readRange();
      $('#pdfEstimate').textContent = r && r.error ? r.error : r ? `Verranno create ${r.count} ${r.count === 1 ? 'sezione' : 'sezioni'}.` : (importDraft.split === 'ranges' ? 'Scrivi almeno un intervallo, per esempio 1-12.' : 'Controlla l’intervallo di pagine.');
    };
    ['#pFrom', '#pTo', '#pPer', '#pRanges'].forEach(sel => $(sel).addEventListener('input', est));
    $('#pRanges').addEventListener('input', e => { importDraft.rangesText = e.target.value; });
    $$('[data-split]').forEach(b => b.addEventListener('click', () => {
      importDraft.split = b.dataset.split;
      $$('[data-split]').forEach(x => x.setAttribute('aria-selected', x === b));
      $('#splitEvery').hidden = importDraft.split === 'ranges';
      $('#splitRanges').hidden = importDraft.split !== 'ranges';
      est();
    }));
    const chBtn = $('[data-act="chapters"]');
    chBtn.addEventListener('click', () => {
      const t = p.chapters.map(c => `${c.from === c.to ? c.from : `${c.from}-${c.to}`} ${c.title}`).join('\n');
      $('#pRanges').value = t;
      importDraft.rangesText = t;
      est();
    });
    $('#optImgs').addEventListener('change', e => { S().keepPdfImages = e.target.checked; Settings.save(); });
    $$('input[name="pdfMode"]').forEach(r => r.addEventListener('change', syncOpts));
    est();
    syncOpts();
    // capitoli e immagini: li cerco in sottofondo, solo una volta per PDF
    if (!p.chapters) pdfChapters(p.doc).then(ch => {
      p.chapters = ch;
      const b = $('[data-act="chapters"]');
      if (b && importDraft.pdf === p && ch.length > 1) { b.hidden = false; b.textContent = `Usa i capitoli del PDF (${ch.length})`; }
    });
    const showImgHint = () => {
      const h = $('#imgHint');
      if (h && p.imgSample != null) h.textContent = p.imgSample ? `(trovate nelle prime pagine: ${p.imgSample})` : '(nessuna trovata nelle prime pagine)';
    };
    if (p.imgSample == null) {
      (async () => {
        let n = 0;
        for (let i = 1; i <= Math.min(8, p.pages); i++) { try { n += (await findPageImages(p.doc, i)).boxes.length; } catch { /* pagina saltata */ } }
        p.imgSample = n;
        if (importDraft.pdf === p) showImgHint();
      })();
    } else showImgHint();
  };
  const readRange = () => {
    const p = importDraft.pdf;
    if (p && importDraft.split === 'ranges') {
      const { ranges, errors } = parseRanges($('#pRanges')?.value, p.pages);
      if (errors.length || !ranges.length) return errors.length ? { error: `Non capisco: ${errors.slice(0, 3).join(', ')}. Usa righe come “13-30 Il cuore”, con pagine tra 1 e ${p.pages}.` } : null;
      return { ranges, count: ranges.length };
    }
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

  const renderXmInfo = () => {
    const x = importDraft.xmind;
    const box = $('#xmInfo');
    if (!x) { box.innerHTML = '<p class="hint">Ogni foglio della mappa diventa una sezione con elenchi annidati. Funziona con i file di XMind nuovi e con XMind 8.</p>'; return; }
    box.innerHTML = `
      <p class="pdf-meta">${x.sheets.length} ${x.sheets.length === 1 ? 'foglio' : 'fogli'} nella mappa.</p>
      <ul class="cand">${x.sheets.map((sh, i) => `<li><label class="check"><input type="checkbox" data-sheet="${i}" checked>
        <span><span class="cand-f">${esc(sh.root.title)}</span><span class="cand-b">${countTopics(sh.root)} nodi${sh.title && sh.title !== sh.root.title ? `, foglio “${esc(sh.title)}”` : ''}</span></span></label></li>`).join('')}</ul>
      <label class="check"><input type="checkbox" id="optXmCards" ${S().xmCards ? 'checked' : ''}>
        <span>Crea le flashcard: una per ogni nodo con sottopunti</span></label>`;
    $('#optXmCards').addEventListener('change', e => { S().xmCards = e.target.checked; Settings.save(); });
  };
  $('#xmFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    $('#xmLabel').textContent = 'Leggo la mappa…';
    try {
      const sheets = await parseXmind(file);
      if (!sheets.length) throw new Error('La mappa è vuota.');
      importDraft.xmind = { name: file.name, sheets };
      $('#xmLabel').textContent = `${file.name}, tocca per cambiarla`;
    } catch (err) {
      importDraft.xmind = null;
      $('#xmLabel').textContent = 'Scegli una mappa XMind (.xmind)';
      toast(err.message, 'err');
    }
    renderXmInfo();
  });
  renderXmInfo();

  on('[data-act="start"]', 'click', () => {
    const nbId = $('#imNb').value;
    if (!nbId || !nbById(nbId)) { toast('Scegli o crea un notebook'); return; }
    const opts = { ai: $('#optAi').checked && aiOk, cloze: $('#optCloze').checked, questions: $('#optQs').checked };
    const gv = $('#imGroup').value;
    const groupId = groupsOf(nbById(nbId)).some(g => g.id === gv) ? gv : null;
    const job = { running: true, controller: new AbortController(), nbId, groupId, opts, items: [], kind: importDraft.src };
    if (job.kind === 'xmind') {
      const x = importDraft.xmind;
      if (!x) { toast('Scegli prima una mappa XMind'); return; }
      const picked = $$('[data-sheet]').filter(c => c.checked).map(c => x.sheets[+c.dataset.sheet]);
      if (!picked.length) { toast('Scegli almeno un foglio'); return; }
      job.fileName = x.name;
      job.xmCards = $('#optXmCards')?.checked;
      job.items = picked.map(sh => ({ label: sh.root.title, sheet: sh, status: 'wait' }));
    } else if (job.kind === 'text') {
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
      if (!r || r.error) { toast(r && r.error ? r.error : 'Controlla l’intervallo di pagine'); return; }
      job.pdf = importDraft.pdf;
      job.pdfMode = document.querySelector('input[name="pdfMode"]:checked')?.value === 'ai' && aiOk ? 'ai' : 'text';
      job.keepImgs = $('#optImgs').checked;
      if (job.pdfMode === 'ai') job.opts.ai = true;
      const pagesLabel = (a, b) => (a === b ? `Pagina ${a}` : `Pagine ${a}–${b}`);
      if (r.ranges) {
        r.ranges.forEach(g => job.items.push({ label: g.title ? `${g.title}, ${pagesLabel(g.from, g.to).toLowerCase()}` : pagesLabel(g.from, g.to), pages: pagesLabel(g.from, g.to), title: g.title, from: g.from, to: g.to, status: 'wait' }));
      } else {
        S().pagesPerSection = r.per;
        Settings.save();
        for (let a = r.from; a <= r.to; a += r.per) {
          const b = Math.min(r.to, a + r.per - 1);
          job.items.push({ label: pagesLabel(a, b), pages: pagesLabel(a, b), from: a, to: b, status: 'wait' });
        }
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
    if (job.kind === 'xmind') {
      try {
        const root = it.sheet.root;
        const sec = newSection(job.nbId, { groupId: job.groupId, title: root.title || it.sheet.title, md: xmindToMarkdown(root), source: `Mappa XMind ${job.fileName}` });
        await saveSection(sec);
        it.secId = sec.id;
        if (job.xmCards) {
          const cards = xmindCards(root, job.nbId, sec.id);
          if (cards.length) await saveCards(cards);
          it.note = `${cards.length} flashcard create`;
        }
        it.status = 'done';
      } catch (err) { it.status = 'error'; it.error = err.message; }
      renderProgress();
      continue;
    }
    let text = it.text || '';
    let baseTitle = '';
    let source = 'Testo incollato';
    if (job.kind === 'pdf') {
      baseTitle = it.title || `${job.pdf.base}, ${it.pages.toLowerCase()}`;
      source = `${job.pdf.name}, ${it.pages.toLowerCase()}`;
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
        const title = (job.kind === 'text' && job.title) || it.title ? baseTitle : (r.title || baseTitle || firstLineTitle(r.md));
        sec = newSection(job.nbId, { groupId: job.groupId, title, md: r.md, questions: r.questions, source });
        if (r.truncated) it.note = 'Risposta troncata: controlla la fine della sezione o usa meno pagine.';
      } else {
        if (!text.trim()) throw new Error('Nessun testo trovato in queste pagine: forse è una scansione.');
        sec = newSection(job.nbId, { groupId: job.groupId, title: baseTitle || firstLineTitle(text), md: basicFormat(text), source });
      }
      if (job.kind === 'pdf' && job.keepImgs) {
        it.wait = 'Ritaglio le immagini…';
        renderProgress();
        try {
          const extra = await pdfImagesMd(job, it.from, it.to, signal);
          sec.md += extra;
          const n = (extra.match(/\(img:/g) || []).length;
          if (n) it.note = [it.note, `${n} ${n === 1 ? 'immagine aggiunta' : 'immagini aggiunte'}`].filter(Boolean).join('. ');
        } catch { /* le immagini non bloccano la sezione */ }
        it.wait = '';
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
          const sec = newSection(job.nbId, { groupId: job.groupId, title: baseTitle || firstLineTitle(text), md: basicFormat(text), source });
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
    <ul class="list quick-links">
      <li><a class="row" href="#/guide"><span class="row-main"><span class="row-title">Guida all’uso</span><span class="row-sub">Come funziona ogni parte dell’app</span></span><span class="ext" aria-hidden="true">›</span></a></li>
      <li><a class="row" href="#/links"><span class="row-main"><span class="row-title">Link utili</span><span class="row-sub">StudyHub, Gemini, PubMed, Manuale MSD e i tuoi</span></span><span class="ext" aria-hidden="true">›</span></a></li>
    </ul>

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
    ${settingsPromptsHtml()}

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
      <div class="inline">
        <button class="btn" data-act="sync-now">Sincronizza ora</button>
        <button class="btn ghost" data-act="sync-test">Prova il collegamento</button>
      </div>
      <p class="hint" id="syStatus" aria-live="polite">${esc(syncStatusText())}</p>
      <p class="hint">La sincronizzazione parte da sola all’apertura, quando torni sull’app e qualche secondo dopo ogni modifica. I PDF si caricano su Drive a pezzi: serve lo script nella versione 2.</p>
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
      <p class="hint">Un file unico con notebook, sezioni, flashcard, immagini, PDF con annotazioni e segnalibri, glossario, note cliniche, prompt, statistiche e preferenze di lettura. Le chiavi dell’AI e la frase segreta di Drive restano fuori. Tienilo da parte prima di cambiare telefono.</p>
      <div class="inline">
        <button class="btn primary" data-act="export-full">Backup completo</button>
        <button class="btn" data-act="export-light">Backup senza i file PDF</button>
        <label class="btn">Importa un backup<input type="file" id="bkFile" accept=".nbbackup,application/octet-stream,application/json,.json" hidden></label>
      </div>
      <p class="hint" id="bkSize"></p>
      <p class="hint" id="usage"></p>
    </section>

    <section class="block">
      <h2>App sul telefono</h2>
      <p class="hint" id="installInfo">${installInfoText()}</p>
      <button class="btn primary" data-act="install" ${installPrompt ? '' : 'hidden'}>Installa l’app</button>
    </section>

    <p class="version">StudyHub Notebook ${APP_VERSION}</p>
  `);

  bindSettingsPrompts($('#view'));
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
  on('[data-act="sync-test"]', 'click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    await testSyncConnection();
    btn.disabled = false;
  });
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

  const pdfBytes = state.pdfs.filter(p => localPdfIds.has(p.id)).reduce((a, p) => a + (p.size || 0), 0);
  const imgBytes = state.images.reduce((a, i) => a + (i.size || (i.blob && i.blob.size) || 0), 0);
  $('#bkSize').textContent = `Backup completo: circa ${fmtSize(pdfBytes + imgBytes + 200000)}. Senza i file PDF: circa ${fmtSize(imgBytes + 200000)}.`;
  const runExport = async (withPdf, btn) => {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparo il file…';
    try {
      const { blob, name } = await buildBackup(withPdf);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      toast(`Backup pronto (${fmtSize(blob.size)})`);
    } catch (err) {
      toast(err.message || 'Backup non riuscito', 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };
  on('[data-act="export-full"]', 'click', e => runExport(true, e.currentTarget));
  on('[data-act="export-light"]', 'click', e => runExport(false, e.currentTarget));
  $('#bkFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bk = await readBackup(file);
      const d = bk.data;
      const nPdf = (d.pdfs || []).length;
      const nPdfFiles = bk.files.filter(f => f.kind === 'pdf').length;
      const ok = await modal({
        title: 'Importare il backup?',
        text: `${d.notebooks.length} notebook, ${d.sections.length} sezioni, ${(d.cards || []).length} flashcard${nPdf ? `, ${nPdf} PDF${nPdfFiles < nPdf ? ` (${nPdfFiles} con il file)` : ''}` : ''}. Gli elementi con lo stesso identificativo vengono sostituiti, gli altri restano.`,
        confirm: 'Importa'
      });
      if (!ok) return;
      toast('Importo il backup…');
      await restoreBackup(bk);
      toast('Backup importato');
      route();
    } catch (err) {
      toast(err.message && !err.message.startsWith('Unexpected') ? err.message : 'File non valido', 'err');
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
  const ex = examRec();
  const limit = ex && examNbIds(ex).has(nbId) ? +ex.newPerDay || 0 : +S().newPerDay || 0;
  return Math.max(0, limit - used);
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
  const t = xrefPlain(stripMarks(stripCloze(md || ''))).replace(IMG_MD_RE, '[immagine]').replace(/^\*([^*\n]+)\*\n\n/, '$1: ').replace(/[#*_`>|]/g, ' ').replace(/\s+/g, ' ').trim();
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
          <span class="row-sub spoiler">${esc(plainText(c.back, 100)) || 'Senza etichetta'}</span>
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
          <span class="row-sub spoiler" title="Risposta nascosta: aprila per vederla">${esc(plainText(c.back, 100))}</span>
          ${tagChips(tagsOf(c), { link: false })}
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
    while ((m = re.exec(text))) { const [term, hint] = splitHint(m[1]); found.push({ start: m.index, end: m.index + m[0].length, term, hint }); }
    for (const f of found) {
      const masked = s => s.replace(clozeRe(), '___');
      const front = masked(text.slice(0, f.start)) + (f.hint ? `**[${f.hint}]**` : '**[…]**') + masked(text.slice(f.end));
      out.push({ front: heading ? `*${heading}*\n\n${front}` : front, back: f.term });
    }
  }
  return out;
}


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
    macro: groupOf(sec)?.name || '',
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
const SYNC_STORES = ['notebooks', 'sections', 'cards', 'links', 'pdfs'];

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
      if (e.name === 'AbortError') throw new Error('Drive non risponde: riprova più tardi.');
      throw new Error(await diagnoseSync() || 'Connessione a Drive non riuscita.');
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
      await prunePdfBlobs();
      setTimeout(() => PdfCloud.uploadPending(), 400);
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

/* Diagnosi dei problemi più comuni con l’app web di Apps Script */
const SYNC_URL_RE = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+|macros)\/s\/[\w-]+\/exec$/;
function checkSyncUrl(url) {
  if (SYNC_URL_RE.test(url)) return '';
  if (!/^https?:\/\//.test(url)) return 'L’indirizzo deve iniziare con https:// e finire con /exec. Forse hai copiato l’ID della distribuzione invece dell’URL dell’app web.';
  if (/\/dev$/.test(url)) return 'Hai incollato l’indirizzo di prova, che finisce con /dev: serve quello dell’app web, che finisce con /exec.';
  if (/script\.google\.com\/(home|d\/)|\/edit/.test(url)) return 'Questo è l’indirizzo dell’editor dello script. Serve l’URL dell’app web: Distribuisci → Gestisci distribuzioni, copia l’URL che finisce con /exec.';
  return 'L’indirizzo non sembra quello di un’app web di Apps Script: deve finire con /exec.';
}
async function diagnoseSync() {
  const url = (S().syncUrl || '').trim();
  const bad = checkSyncUrl(url);
  if (bad) return bad;
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow' });
    const d = await r.json().catch(() => null);
    if (d && d.app === 'studyhub-notebook-sync') return '';
    if (!d) return 'Google risponde con una pagina invece che con i dati: di solito l’app web non è aperta a “Chiunque” oppure lo script non è autorizzato. In Apps Script apri Distribuisci → Gestisci distribuzioni → matita, imposta “Chi ha accesso: Chiunque” e scegli “Nuova versione”. Poi esegui una volta la funzione “autorizza” dall’editor.';
    return 'L’indirizzo risponde, ma non è lo script del Notebook: controlla di aver copiato l’URL della distribuzione giusta.';
  } catch {
    try {
      await fetch(url, { mode: 'no-cors' });
      // Google risponde ma con una pagina di accesso o di autorizzazione, che il browser blocca
      return 'Google risponde ma blocca la richiesta: l’app web non è aperta a tutti oppure lo script non è autorizzato. In Apps Script apri Distribuisci → Gestisci distribuzioni → matita, e imposta “Chi ha accesso: Chiunque” (non “Chiunque con account Google”). Poi esegui una volta la funzione “autorizza” dall’editor.';
    } catch {
      return 'Il dispositivo non raggiunge script.google.com: controlla la connessione, la VPN o eventuali blocchi pubblicità.';
    }
  }
}
async function testSyncConnection() {
  setSyncStatus('Controllo…');
  const problem = await diagnoseSync();
  if (problem) { setSyncStatus(problem); return false; }
  try {
    await Sync.post({ secret: (S().syncSecret || '').trim(), action: 'ping' });
    setSyncStatus('Collegamento riuscito: lo script risponde e la frase segreta è giusta.');
    return true;
  } catch (e) {
    setSyncStatus(e.message);
    return false;
  }
}

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
  const puts = { notebooks: [], sections: [], cards: [], links: [], pdfs: [] };
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
    if (r.store === 'pdfs' && local) {
      if (mergePdfMeta(local, normalizeRecord('pdfs', r.data), r.updated)) { puts.pdfs.push(local); changed++; }
      continue;
    }
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
          ${tagFieldHtml('csTags', tagsOf(sec))}
          <div class="modal-actions">
            <button class="btn ghost" data-cs="no" type="button">Annulla</button>
            <button class="btn primary" data-cs="yes" type="button">Crea la flashcard</button>
          </div>
        </div>
      </div>`;
    const fEl = $('#csFront', root);
    const bEl = $('#csBack', root);
    bindCardFieldTools(root, front ? [fEl, bEl] : [bEl, fEl], notebookId);
    bindTagField(root, 'csTags');
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
      const tags = parseTags($('#csTags', root)?.value || '');
      if (tags.length) card.tags = tags;
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
        const r = await AI.generate({ system: promptFor('front'), text: `${ctx}RISPOSTA DELLA FLASHCARD:\n${bEl.value.trim()}`, maxTokens: 3000 });
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
      const r = await AI.generate({ system: promptFor('cards'), text: aiText(sec.md), maxTokens: 8000 });
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
      <div class="actions">
        ${total ? '<a class="btn primary" href="#/study/all">Studia tutto</a>' : ''}
        ${examRec() ? '' : '<button class="btn ghost" data-act="exam-new">Modalità esame</button>'}
      </div>
    </header>
    ${examBannerHtml('cards')}
    ${nbs.length ? `
      <ul class="list">
        ${nbs.map(nb => {
          const cs = cardsOf(nb.id);
          return `<li><a class="row" href="#/deck/${nb.id}">
            ${nbTile(nb)}
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
  bindExamBanner();
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
      ${tagFieldHtml('ceTags', tagsOf(c))}
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
  bindTagField($('#view'), 'ceTags');
  on('[data-act="io-edit"]', 'click', () => openOcclusionEditor({ imageId: c.io.imageId, notebookId: c.notebookId, sectionId: c.sectionId, group: c.io.group }));
  on('[data-act="save"]', 'click', async () => {
    if (!isIo && !fEl.value.trim()) { toast('Il fronte non può essere vuoto'); fEl.focus(); return; }
    const before = cardImageRefs(c);
    if (!isIo) c.front = fEl.value.trim();
    c.back = bEl.value.trim();
    c.note = $('#ceNote').value.trim();
    c.tags = parseTags($('#ceTags').value);
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
  if (scope.startsWith('tag-')) { const t = scope.slice(4); return state.cards.filter(c => tagsOf(c).includes(t) && !c.suspended); }
  if (scope === 'exam') { const ex = examRec(); return ex ? state.cards.filter(c => !c.suspended && inExam(c, ex)) : []; }
  return state.cards.filter(c => c.notebookId === scope && !c.suspended);
}
function scopeTitle(scope) {
  if (scope === 'all') return 'Tutte le flashcard';
  if (scope.startsWith('sec-')) return secById(scope.slice(4))?.title || 'Sezione';
  if (scope.startsWith('tag-')) return `#${scope.slice(4)}`;
  if (scope === 'exam') return `Esame: ${examRec()?.name || ''}`;
  return nbById(scope)?.name || 'Flashcard';
}
function scopeBack(scope) {
  if (scope === 'all') return '#/cards';
  if (scope.startsWith('sec-')) return `#/sec/${scope.slice(4)}/cards`;
  if (scope.startsWith('tag-')) return `#/tag/${encodeURIComponent(scope.slice(4))}`;
  if (scope === 'exam') return '#/cards';
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
    ${(() => {
      // Con l’occlusione, o con la lavagna aperta, “Mostra la risposta” sta sulla riga della lavagna
      const inline = card.type === 'occlusion' || S().boardOpen;
      const grades = session.revealed ? `
        <div class="study-actions"><div class="grade-btns">
          ${CARD_GRADES.map((g, i) => `<button class="gbtn g-${g.key}" data-g="${g.key}" aria-keyshortcuts="${i + 1}">
            <span>${g.label}</span><small>${fmtCardNext(scheduleCard(card.srs, g.key, now, true), now)}</small></button>`).join('')}
        </div></div>` : '';
      const board = `
        <div class="board">
          <div class="board-row">
            <button class="btn sm ghost board-toggle" data-act="board" aria-expanded="${S().boardOpen}">${S().boardOpen ? (inline ? 'Chiudi lavagna' : 'Chiudi la lavagna') : inline ? 'Lavagna' : 'Lavagna: scrivi la risposta a mano'}</button>
            ${inline && !session.revealed ? '<button class="btn primary reveal-inline" data-act="reveal" aria-keyshortcuts="Space">Mostra la risposta</button>' : ''}
          </div>
          ${S().boardOpen ? `<div class="board-wrap">${penToolsHtml({ colors: false })}<canvas class="board-canvas" id="boardCanvas" aria-label="Lavagna per scrivere la risposta"></canvas></div>` : ''}
        </div>`;
      if (inline) return grades + board;
      return board + (session.revealed ? grades : '<div class="study-actions"><button class="btn primary block big" data-act="reveal" aria-keyshortcuts="Space">Mostra la risposta</button></div>');
    })()}
    <div class="study-tools">
      <button class="btn sm ghost" data-act="undo" ${session.undo.length ? '' : 'disabled'}>Annulla l’ultima</button>
      <a class="btn sm ghost" href="#/card/${card.id}">Modifica</a>
      <button class="btn sm ghost" data-act="suspend">Sospendi</button>
    </div>
    ${sec && session.revealed ? `<p class="source">Dalla sezione <a href="#/sec/${sec.id}/read">${esc(sec.title)}</a></p>` : ''}
    ${session.revealed && card.pdf && pdfById(card.pdf.id) ? `<p class="source">Dal PDF <a href="#/pdf/${card.pdf.id}/${card.pdf.page}">${esc(pdfById(card.pdf.id).name)}, pagina ${card.pdf.page}</a></p>` : ''}
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
    const newLeech = c.srs.lapses >= LEECH && !tagsOf(c).includes(LEECH_TAG);
    if (newLeech) c.tags = [...tagsOf(c), LEECH_TAG];
    await saveCard(c);
    Stats.addReview();
    if (newLeech) toast(`Questa flashcard l’hai sbagliata ${c.srs.lapses} volte: prova a riscriverla più semplice o a spezzarla in due`, '', { label: 'Modifica', fn: () => go(`#/card/${c.id}`) });
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
   PDF: intervalli di pagine scelti da te, capitoli del PDF, immagini
   --------------------------------------------------------------------- */
// "1-12 Introduzione" su ogni riga; anche "1-12, 13-30" su una riga sola
function parseRanges(text, pages) {
  const ranges = [];
  const errors = [];
  const tokens = [];
  (text || '').split(/[\n;]+/).map(l => l.trim()).filter(Boolean).forEach(line => {
    if (/^[\d\s,–—-]+$/.test(line)) line.split(',').map(x => x.trim()).filter(Boolean).forEach(x => tokens.push(x));
    else tokens.push(line);
  });
  for (const tok of tokens) {
    const m = tok.match(/^(?:p(?:ag(?:ine|ina)?)?\.?\s*)?(\d+)\s*(?:[-–—]\s*(\d+))?\s*[:.)-]?\s*(.*)$/i);
    if (!m) { errors.push(tok); continue; }
    const a = +m[1];
    const b = m[2] ? +m[2] : a;
    if (a < 1 || b < a || b > pages) { errors.push(tok); continue; }
    ranges.push({ from: a, to: b, title: m[3].trim() });
  }
  return { ranges, errors };
}

// Capitoli dai segnalibri del PDF (indice laterale), se ci sono
async function pdfChapters(doc) {
  let outline;
  try { outline = await doc.getOutline(); } catch { return []; }
  if (!outline || !outline.length) return [];
  // se c’è una sola voce principale (es. il titolo del libro) uso i suoi capitoli
  let items = outline;
  if (items.length === 1 && items[0].items && items[0].items.length > 1) items = items[0].items;
  const out = [];
  for (const it of items) {
    try {
      let dest = it.dest;
      if (typeof dest === 'string') dest = await doc.getDestination(dest);
      if (!Array.isArray(dest) || !dest[0]) continue;
      const ref = dest[0];
      const idx = typeof ref === 'number' ? ref : await doc.getPageIndex(ref);
      out.push({ title: String(it.title || '').replace(/\s+/g, ' ').trim(), page: idx + 1 });
    } catch { /* voce senza destinazione */ }
  }
  out.sort((a, b) => a.page - b.page);
  const uniq = out.filter((c, i) => i === 0 || c.page !== out[i - 1].page);
  return uniq.map((c, i) => ({ from: c.page, to: i + 1 < uniq.length ? Math.max(c.page, uniq[i + 1].page - 1) : doc.numPages, title: c.title }));
}

// Posizione delle immagini in una pagina, lette dalle istruzioni di disegno del PDF
async function findPageImages(doc, pageNo) {
  const OPS = window.pdfjsLib.OPS;
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
  ];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const boxes = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args[0]) && args[0].length === 6) ctm = mul(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintJpegXObject) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => {
        const px = ctm[0] * x + ctm[2] * y + ctm[4];
        const py = ctm[1] * x + ctm[3] * y + ctm[5];
        return vp.convertToViewportPoint(px, py);
      });
      const xs = pts.map(p => p[0]);
      const ys = pts.map(p => p[1]);
      const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(vp.width, Math.max(...xs));
      const y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(vp.height, Math.max(...ys));
      if (x1 > x0 && y1 > y0) boxes.push({ x: x0 / vp.width, y: y0 / vp.height, w: (x1 - x0) / vp.width, h: (y1 - y0) / vp.height });
    }
  }
  // via icone e loghi minuscoli e le pagine scansionate (un’unica immagine a tutta pagina)
  const useful = boxes.filter(b => b.w * b.h >= 0.02 && b.w * b.h <= 0.9 && b.w > 0.08 && b.h > 0.05);
  const merged = [];
  for (const b of useful.sort((a, c) => c.w * c.h - a.w * a.h)) {
    const dup = merged.some(m => {
      const ix = Math.max(0, Math.min(m.x + m.w, b.x + b.w) - Math.max(m.x, b.x));
      const iy = Math.max(0, Math.min(m.y + m.h, b.y + b.h) - Math.max(m.y, b.y));
      return ix * iy > 0.6 * b.w * b.h;
    });
    if (!dup) merged.push(b);
  }
  return { page, boxes: merged.slice(0, 8).sort((a, c) => a.y - c.y || a.x - c.x) };
}

// Ritaglia le immagini di un intervallo di pagine e le salva; restituisce il Markdown da aggiungere
async function pdfImagesMd(job, from, to, signal) {
  const lines = [];
  for (let p = from; p <= to; p++) {
    if (signal && signal.aborted) break;
    let found;
    try { found = await findPageImages(job.pdf.doc, p); } catch { continue; }
    if (!found.boxes.length) continue;
    const base = found.page.getViewport({ scale: 1 });
    const scale = Math.min(3, 1800 / base.width);
    const vp = found.page.getViewport({ scale });
    const full = document.createElement('canvas');
    full.width = Math.round(vp.width);
    full.height = Math.round(vp.height);
    const ctx = full.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, full.width, full.height);
    try { await found.page.render({ canvasContext: ctx, viewport: vp }).promise; } catch { continue; }
    let n = 0;
    for (const b of found.boxes) {
      const sw = Math.max(1, Math.round(b.w * full.width));
      const sh = Math.max(1, Math.round(b.h * full.height));
      const k = Math.min(1, 1600 / Math.max(sw, sh));
      const out = document.createElement('canvas');
      out.width = Math.round(sw * k);
      out.height = Math.round(sh * k);
      out.getContext('2d').drawImage(full, Math.round(b.x * full.width), Math.round(b.y * full.height), sw, sh, 0, 0, out.width, out.height);
      try {
        const im = await saveImage(await canvasToImage(out, 0.86), job.nbId);
        n++;
        lines.push(imageMd(im.id, `Pagina ${p}${found.boxes.length > 1 ? `, figura ${n}` : ''}`));
      } catch { /* immagine saltata */ }
    }
    full.width = 0; full.height = 0; // libera memoria sul telefono
  }
  return lines.length ? `\n\n### Immagini dal PDF\n\n${lines.join('\n\n')}` : '';
}

/* ---------------------------------------------------------------------
   Mappe XMind (.xmind): file nuovi (content.json) e XMind 8 (content.xml)
   --------------------------------------------------------------------- */
async function ensureJSZip() { if (!window.JSZip) await loadScript(LIBS.jszip); }

async function parseXmind(file) {
  await ensureJSZip();
  let zip;
  try { zip = await window.JSZip.loadAsync(file); }
  catch { throw new Error('Il file non è una mappa XMind valida.'); }
  const json = zip.file('content.json');
  if (json) {
    const data = JSON.parse(await json.async('string'));
    const sheets = Array.isArray(data) ? data : (data.sheets || []);
    return sheets.filter(s => s && s.rootTopic).map(s => ({ title: s.title || s.rootTopic.title || 'Mappa', root: jsonTopic(s.rootTopic) }));
  }
  const xml = zip.file('content.xml');
  if (xml) {
    const doc = new DOMParser().parseFromString(await xml.async('string'), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Non riesco a leggere questa mappa XMind.');
    const kids = (el, name) => [...el.children].filter(c => c.localName === name);
    const sheets = [...doc.getElementsByTagNameNS('*', 'sheet')];
    return sheets.map(sh => {
      const topic = kids(sh, 'topic')[0];
      return topic ? { title: kids(sh, 'title')[0]?.textContent || 'Mappa', root: xmlTopic(topic, kids) } : null;
    }).filter(Boolean);
  }
  throw new Error('Il file non contiene una mappa XMind riconoscibile.');
}
function cleanTitle(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
function jsonTopic(t) {
  const notes = t.notes?.plain?.content || (t.notes?.realHTML?.content || '').replace(/<[^>]+>/g, ' ');
  return {
    title: cleanTitle(t.title) || '(senza titolo)',
    notes: String(notes || '').trim(),
    children: (t.children?.attached || []).map(jsonTopic),
    floating: (t.children?.detached || []).map(jsonTopic)
  };
}
function xmlTopic(el, kids) {
  const children = [];
  const floating = [];
  kids(el, 'children').forEach(ch => kids(ch, 'topics').forEach(ts => {
    const list = kids(ts, 'topic').map(t => xmlTopic(t, kids));
    if (ts.getAttribute('type') === 'detached') floating.push(...list); else children.push(...list);
  }));
  const notesEl = kids(el, 'notes')[0];
  const plain = notesEl ? kids(notesEl, 'plain')[0] : null;
  return { title: cleanTitle(kids(el, 'title')[0]?.textContent) || '(senza titolo)', notes: (plain?.textContent || '').trim(), children, floating };
}
const mdInline = t => cleanTitle(t).replace(/^(\d+)\.\s/, '$1\\. ').replace(/^([#>*+-])\s/, '\\$1 ');
function countTopics(t) { return 1 + t.children.reduce((a, c) => a + countTopics(c), 0) + t.floating.reduce((a, c) => a + countTopics(c), 0); }
function xmindToMarkdown(root) {
  const out = [];
  if (root.notes) out.push(...root.notes.split('\n').filter(l => l.trim()).map(l => `*${mdInline(l)}*`), '');
  const walk = (t, depth) => {
    const pad = '  '.repeat(depth);
    out.push(`${pad}- ${mdInline(t.title)}`);
    if (t.notes) t.notes.split('\n').filter(l => l.trim()).forEach(l => out.push(`${pad}  - *${mdInline(l)}*`));
    t.children.forEach(c => walk(c, depth + 1));
  };
  root.children.forEach(c => walk(c, 0));
  if (root.floating.length) {
    out.push('', '### Argomenti liberi', '');
    root.floating.forEach(c => walk(c, 0));
  }
  return out.join('\n');
}
// Una flashcard per ogni nodo con sottopunti: “elenca i sottopunti di…”
function xmindCards(root, nbId, secId) {
  const cards = [];
  const walk = (t, path) => {
    const here = [...path, t.title];
    if (t.children.length) {
      const back = t.children.map(c => `- ${mdInline(c.title)}`).join('\n');
      cards.push(newCard(nbId, { front: `**${here.map(mdInline).join(' › ')}**\n\n*Quali sono i sottopunti?*`, back, sectionId: secId }));
    }
    t.children.forEach(c => walk(c, here));
  };
  walk(root, []);
  root.floating.forEach(f => walk(f, [root.title]));
  return cards;
}

/* ---------------------------------------------------------------------
   Link utili (modificabili, sincronizzati)
   --------------------------------------------------------------------- */
const DEFAULT_LINKS = [
  ['def-studyhub', 'Le tue app', 'StudyHub', 'https://metallia13-ctrl.github.io/Study-hub/', 'Il tuo planner di studio'],
  ['def-gemini', 'Le tue app', 'Gemini', 'https://gemini.google.com/', ''],
  ['def-notebooklm', 'Le tue app', 'NotebookLM', 'https://notebooklm.google.com/', 'Per riassumere e formattare le fonti'],
  ['def-drive', 'Le tue app', 'Google Drive', 'https://drive.google.com/', 'Qui c’è la cartella della sincronizzazione'],
  ['def-pubmed', 'Medicina', 'PubMed', 'https://pubmed.ncbi.nlm.nih.gov/', 'Articoli scientifici'],
  ['def-msd', 'Medicina', 'Manuale MSD, versione per professionisti', 'https://www.msdmanuals.com/it-it/professionale', 'Clinica in italiano'],
  ['def-medscape', 'Medicina', 'Medscape Reference', 'https://reference.medscape.com/', 'Malattie e farmaci, in inglese'],
  ['def-radiopaedia', 'Medicina', 'Radiopaedia', 'https://radiopaedia.org/', 'Casi e immagini radiologiche'],
  ['def-teachme', 'Medicina', 'TeachMeAnatomy', 'https://teachmeanatomy.info/', 'Anatomia illustrata'],
  ['def-aifa', 'Medicina', 'Banca dati farmaci AIFA', 'https://medicinali.aifa.gov.it/', 'Schede tecniche e foglietti illustrativi'],
  ['def-aistudio', 'Impostazioni dell’app', 'Google AI Studio', 'https://aistudio.google.com/', 'Dove si crea la chiave API di Gemini'],
  ['def-appsscript', 'Impostazioni dell’app', 'Google Apps Script', 'https://script.google.com/', 'Lo script della sincronizzazione']
];
async function ensureDefaultLinks() {
  if (localStorage.getItem('nb-links-seeded')) return;
  const tombs = new Set((await DB.all('deleted')).map(t => t.id));
  const recs = DEFAULT_LINKS
    .filter(([id]) => !state.links.some(l => l.id === id) && !tombs.has(`links:${id}`))
    .map(([id, group, title, url, note], i) => ({ id, notebookId: '_links', group, title, url, note, order: i, created: 1, updated: 1 }));
  if (recs.length) { await DB.bulkPut('links', recs); state.links.push(...recs); }
  localStorage.setItem('nb-links-seeded', '1');
}
async function saveLink(l) {
  l.updated = Date.now();
  await DB.put('links', l);
  const i = state.links.findIndex(x => x.id === l.id);
  if (i < 0) state.links.push(l); else state.links[i] = l;
  scheduleSync();
}
const linkHost = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

function viewLinks() {
  const groups = [];
  [...linksOnly()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.created - b.created).forEach(l => {
    let g = groups.find(x => x.name === (l.group || 'Altri'));
    if (!g) { g = { name: l.group || 'Altri', items: [] }; groups.push(g); }
    g.items.push(l);
  });
  setView(`
    <header class="page-head">
      <div><h1>Link utili</h1><p class="lede">${linksEditing ? 'Tocca un’icona per modificarla o eliminarla.' : 'Tocca un’icona per aprire il sito in una nuova scheda.'}</p></div>
      <div class="actions">
        <button class="btn ${linksEditing ? 'primary' : ''}" data-act="edit-links">${linksEditing ? 'Fatto' : 'Modifica'}</button>
        <button class="btn" data-act="add-link">Aggiungi</button>
      </div>
    </header>
    <div class="${linksEditing ? 'links-editing' : ''}" id="linkTiles">
      ${groups.length ? groups.map(g => `<h2 class="sub">${esc(g.name)}</h2><div class="tile-grid icons">${g.items.map(linkTile).join('')}</div>`).join('') : '<div class="empty"><p>Nessun link salvato.</p></div>'}
    </div>
  `);
  $$('.tile-fav').forEach(img => {
    const ok = () => img.classList.add('ok');
    const fail = () => img.remove();
    img.addEventListener('load', () => (img.naturalWidth > 1 ? ok() : fail()));
    img.addEventListener('error', fail);
    if (img.complete) (img.naturalWidth > 1 ? ok() : fail());
  });
  on('[data-act="edit-links"]', 'click', () => { linksEditing = !linksEditing; route(); });
  on('[data-act="add-link"]', 'click', async () => { if (await linkSheet()) route(); });
  $('#linkTiles').addEventListener('click', async e => {
    const t = e.target.closest('.tile[data-id]');
    if (!t || !linksEditing) return;
    e.preventDefault();
    if (await linkSheet(state.links.find(l => l.id === t.dataset.id))) route();
  });
}

function linkSheet(link = null) {
  return new Promise(resolve => {
    const root = $('#modalRoot');
    const groups = [...new Set(linksOnly().map(l => l.group).filter(Boolean))];
    root.innerHTML = `
      <div class="overlay">
        <div class="modal sheet" role="dialog" aria-modal="true" aria-labelledby="lkTitle">
          <h2 id="lkTitle">${link ? 'Modifica il link' : 'Nuovo link'}</h2>
          <label class="field"><span>Nome</span><input class="input" id="lkName" value="${esc(link?.title || '')}" placeholder="Es. Atlante di istologia"></label>
          <label class="field"><span>Indirizzo</span><input class="input" id="lkUrl" type="url" inputmode="url" value="${esc(link?.url || '')}" placeholder="https://…" spellcheck="false"></label>
          <label class="field"><span>Gruppo</span><input class="input" id="lkGroup" list="lkGroups" value="${esc(link?.group || groups[0] || '')}" placeholder="Es. Anatomia">
            <datalist id="lkGroups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist></label>
          <label class="field"><span>Nota, facoltativa</span><input class="input" id="lkNote" value="${esc(link?.note || '')}"></label>
          <div class="modal-actions">
            ${link ? '<button class="btn ghost danger" data-lk="del" type="button">Elimina</button>' : ''}
            <button class="btn ghost" data-lk="no" type="button">Annulla</button>
            <button class="btn primary" data-lk="ok" type="button">Salva</button>
          </div>
        </div>
      </div>`;
    const close = v => { root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(false); } };
    document.addEventListener('keydown', onKey, true);
    $('[data-lk="no"]', root).onclick = () => close(false);
    const del = $('[data-lk="del"]', root);
    if (del) del.onclick = async () => { await removeRecords([{ store: 'links', rec: link }]); toast('Link eliminato'); close(true); };
    $('[data-lk="ok"]', root).onclick = async () => {
      const title = $('#lkName', root).value.trim();
      let url = $('#lkUrl', root).value.trim();
      if (!title) { toast('Scrivi un nome'); $('#lkName', root).focus(); return; }
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      try { new URL(url); } catch { toast('Indirizzo non valido'); $('#lkUrl', root).focus(); return; }
      const now = Date.now();
      const rec = link || { id: uid(), notebookId: '_links', order: linksOnly().length, created: now };
      Object.assign(rec, { title, url, group: $('#lkGroup', root).value.trim() || 'Altri', note: $('#lkNote', root).value.trim() });
      await saveLink(rec);
      toast('Link salvato');
      close(true);
    };
    setTimeout(() => $('#lkName', root).focus(), 40);
  });
}

/* ---------------------------------------------------------------------
   Guida all’uso
   --------------------------------------------------------------------- */
function viewGuide() {
  const sec = (title, body, open = false) => `<details class="guide" ${open ? 'open' : ''}><summary>${title}</summary><div class="notes guide-body">${body}</div></details>`;
  setView(`
    <header class="page-head"><div><h1>Guida all’uso</h1>
      <p class="lede">Tocca un argomento per aprirlo.</p></div></header>
    ${sec('Primi passi', `
      <ol>
        <li>Crea un <strong>notebook</strong> per ogni materia (Notebook → Nuovo notebook).</li>
        <li>In <strong>Importa</strong> incolla del testo, carica un PDF o una mappa XMind: l’app crea le sezioni.</li>
        <li>Se la materia è vasta, dividila in <strong>macro-argomenti</strong> (Nuovo macro-argomento): le sezioni dentro sono i micro-argomenti.</li>
        <li>Apri una sezione: se ha termini cloze parte da <strong>Cloze</strong>, così non vedi le risposte prima di provarci. Poi Leggi, Pagina bianca, Domande o Flashcard.</li>
        <li>Quando hai finito, scegli se far pianificare i ripassi a <strong>StudyHub</strong> o al Notebook.</li>
      </ol>
      <p>Per formattare con l’AI serve una chiave API (Impostazioni → Intelligenza artificiale). L’abbonamento Gemini dell’app non basta: la chiave si crea gratis su Google AI Studio.</p>`, true)}
    ${sec('Importare testo, PDF e mappe', `
      <ul>
        <li><strong>Testo</strong>: incollalo; se è lungo viene diviso in più sezioni.</li>
        <li><strong>PDF</strong>: dividilo ogni tot pagine oppure negli <strong>intervalli che scegli tu</strong>, una riga per sezione, per esempio <code>1-12 Introduzione</code>. Se il PDF ha l’indice nei segnalibri, “Usa i capitoli del PDF” li compila da solo.</li>
        <li><strong>Estrai il testo</strong> va bene per i PDF in cui il testo si può selezionare; <strong>fai leggere all’AI</strong> funziona anche con scansioni e schemi.</li>
        <li><strong>Mantieni le immagini</strong> ritaglia le figure del PDF e le aggiunge in fondo alla sezione. Gli schemi disegnati come linee, non come immagini, non vengono riconosciuti: per quelli usa “Figura da PDF” in Modifica.</li>
        <li><strong>XMind</strong>: ogni foglio della mappa diventa una sezione con elenchi annidati; se vuoi, ogni nodo con sottopunti diventa una flashcard.</li>
        <li>Da altre app puoi usare <strong>Condividi → Notebook</strong> per mandare testo o PDF.</li>
      </ul>`)}
    ${sec('Lettore PDF', `
      <ul>
        <li>I <strong>PDF</strong> (voce del menu, pulsante “PDF” nel notebook e nella sezione) possono stare in una sezione oppure valere per <strong>tutto il notebook</strong>, come un manuale della materia: quando carichi un PDF scegli “Tutto il notebook” o una sezione, e da Opzioni puoi spostarlo. Con la sincronizzazione attiva il file va su Drive (a pezzi da 3 MB, nella cartella “pdf”) e sugli altri dispositivi si scarica la prima volta che lo apri. Annotazioni, segnalibri e Trascina si sincronizzano come il resto.</li>
        <li><strong>Segnalibri</strong>: tocca “Segnalibro” in alto, o premi B, per segnare la pagina che stai leggendo. Il nome si prende dalla prima riga della pagina e puoi cambiarlo. Li ritrovi nel pannello, insieme all’indice del PDF se ce l’ha.</li>
        <li><strong>Seleziona</strong> del testo per evidenziarlo in cinque colori, sottolinearlo, aggiungere una nota, crearne una flashcard o mandarlo a <strong>Trascina</strong>. Sul PC funziona anche il tasto destro.</li>
        <li>Tocca un’evidenziazione per cambiarne il colore, trasformarla in sottolineatura, aggiungere una nota o eliminarla.</li>
        <li><strong>Occlusione</strong>: trascina sulle pagine per coprire etichette, valori o parti di uno schema. “Ripassa le occlusioni” le rende piene: tocchi un riquadro per scoprirlo e di nuovo per ricoprirlo. Toccando un riquadro fuori dal ripasso scrivi cosa c’è sotto, lo elimini o crei le flashcard della pagina (una per riquadro, con la pagina come immagine).</li>
        <li><strong>Penna</strong> per scrivere sulle pagine, anche come evidenziatore a mano libera; <strong>Gomma</strong> cancella penna ed evidenziazioni; <strong>Nota</strong> mette un appunto dove tocchi. Col pennino, il dito continua a scorrere le pagine.</li>
        <li>Il <strong>pannello</strong> ha miniature delle pagine, segnalibri e indice, tutte le note, la ricerca nel testo e Trascina.</li>
        <li><strong>Trascina</strong>: ogni brano che ci mandi diventa una bozza di flashcard con il testo sul retro. Scrivi la domanda (o falla proporre all’AI), riordina con la maniglia ⠿ e crea le flashcard. Sul PC puoi anche trascinare il testo selezionato direttamente nel pannello.</li>
        <li>Le flashcard nate dal PDF, dopo la risposta, hanno il link alla pagina da cui vengono.</li>
      </ul>`)}
    ${sec('Novità: calendario, tag, glossario, note cliniche', `
      <ul>
        <li><strong>Backup completo</strong> (Impostazioni → Backup): un file .nbbackup con tutto, compresi i PDF con annotazioni e segnalibri, statistiche e preferenze di lettura. “Backup senza i file PDF” è più leggero e tiene comunque le annotazioni. Per ripristinare usa “Importa un backup”; funzionano anche i vecchi backup .json.</li>
        <li><strong>Calendario</strong> (su telefono in Altro): ripassi in programma giorno per giorno, tempo di studio, giorni di fila e <strong>punti deboli</strong>, cioè le sezioni e le flashcard che sbagli più spesso. Il tempo si conta su questo dispositivo.</li>
        <li><strong>Tag</strong>: aggiungili in Modifica e nelle flashcard, separati da virgole. Toccane uno per vedere tutto ciò che lo usa e studiare solo quelle flashcard. Nella ricerca scrivi <code>#</code> per cercare tra i tag.</li>
        <li><strong>Collegamenti tra pagine</strong>: in Modifica tocca “Link a pagina”, oppure scrivi <code>[[Titolo della sezione]]</code>. Con del testo selezionato il link usa quel testo. In fondo a Leggi trovi le pagine che rimandano a quella aperta. Se rinomini una sezione, i collegamenti si aggiornano.</li>
        <li><strong>Glossario</strong>: aggiungi parole da Altro → Glossario o selezionandole mentre leggi. In Leggi la prima volta che compaiono sono sottolineate a puntini: toccale per il significato.</li>
        <li><strong>Note cliniche</strong>: quadro clinico, sintomi e segni, materia e note. Selezionando del testo in Leggi e toccando “Nota clinica” la crei già collegata alla sezione. Si cercano per sintomo, anche combinandone più di uno.</li>
        <li><strong>Immagini</strong>: in Leggi e Cloze “Nascondi le immagini” le riduce a un riquadro da toccare. In Cloze, gli schemi con image occlusion hanno i riquadri coperti come i termini: toccali per scoprirli.</li>
        <li><strong>Link utili</strong> sono icone: “Modifica” per cambiarli.</li>
      </ul>`)}
    ${sec('Suggerimenti nei cloze', `
      <p>Un cloze può avere un suggerimento: una domanda o un indizio che compare come <strong>?</strong> accanto al termine nascosto; toccandolo lo leggi. In Cloze tocca <strong>Suggerimenti</strong> e poi un termine per scriverlo; in Modifica metti il cursore dentro il cloze e tocca <strong>Suggerimento</strong> (nel testo diventa <code>==termine::suggerimento==</code>). Nelle flashcard create dai cloze il suggerimento compare al posto dei puntini.</p>`)}
    ${sec('Modalità esame, zoom e modalità notte', `
      <ul>
        <li><strong>Modalità esame</strong> (Flashcard o Ripasso): scegli i notebook dell’esame (o un tag come #esame-fisiologia), la data e quante flashcard nuove al giorno. In cima a Flashcard e Ripasso compare l’esame con il conto alla rovescia, “Studia l’esame” (solo le sue flashcard, con il limite alzato) e “Sezioni dell’esame”. Vale su tutti i dispositivi; “Termina” la spegne.</li>
        <li><strong>PDF</strong>: zoom con due dita sul telefono e sul tablet, Ctrl + rotellina o pizzico sul touchpad del PC. <strong>Notte</strong> scurisce le pagine per leggere la sera; annotazioni e penna restano visibili.</li>
      </ul>`)}
    ${sec('Ascolto, previsione e sanguisughe', `
      <ul>
        <li><strong>Ascolta</strong> (in Leggi): il telefono legge la sezione paragrafo per paragrafo, evidenziando quello in corso. Puoi mettere in pausa, andare avanti o indietro, cambiare velocità e toccare un paragrafo per ripartire da lì. Lo schermo resta acceso mentre ascolti.</li>
        <li><strong>Prossimi 30 giorni</strong> (Calendario): quanti ripassi hai in programma ogni giorno e qual è il giorno più carico.</li>
        <li><strong>Sanguisughe</strong>: una flashcard sbagliata ${LEECH} volte prende il tag #${LEECH_TAG} e compare nei punti deboli, con il consiglio di riscriverla o spezzarla.</li>
      </ul>`)}
    ${sec('Ricerca unica', `
      <p>La ricerca nella pagina iniziale (e “Cerca ovunque” in Altro) trova insieme appunti, flashcard, il testo delle pagine dei PDF, le tue note ed evidenziazioni nei PDF, il glossario e le note cliniche. Toccando un risultato di un PDF si apre alla pagina giusta, con la parola evidenziata. Il testo di ogni PDF si legge una volta sola e resta sul dispositivo; i PDF scansionati o scritti a mano non hanno testo da cercare.</p>`)}
    ${sec('Simulazione d’esame e punti deboli del Cloze', `
      <ul>
        <li><strong>Simulazione d’esame</strong>: dal notebook (pulsante in alto) o da Opzioni di un macro-argomento. Scegli quante domande, se metterci un tempo limite e da dove pescare (domande, frasi con cloze, flashcard). Le domande arrivano a turno da tutte le sezioni; alla fine vedi il punteggio sezione per sezione e puoi mettere da ripassare oggi quelle andate peggio. Non cambia i ripassi programmati.</li>
        <li><strong>Punti deboli del Cloze</strong>: l’app ricorda il colore che dai a ogni parte, giorno per giorno. Se una parte resta rossa o arancio in almeno due letture, in cima al Cloze e nel Calendario ti propone di farne una flashcard o di ripassare la sezione prima (intervalli dimezzati).</li>
      </ul>`)}
    ${sec('Novità della 3.10', `
      <ul>
        <li><strong>Tre livelli</strong>: macro-argomento › sottoargomento › sezione. Da “Opzioni” di un macro-argomento scegli “Nuovo sottoargomento”.</li>
        <li><strong>HTML negli appunti</strong>: in Modifica il pulsante “HTML” inserisce un blocco (anche una pagina intera con il suo stile), che si vede in un riquadro isolato.</li>
        <li><strong>Link a siti</strong>: in Modifica, campo “Link a siti utili”, uno per riga (Titolo | indirizzo). Compaiono sotto il titolo della sezione.</li>
        <li><strong>Modifica qui</strong>: in Leggi, col tasto destro su una parola (o selezionando del testo) apri Modifica con il cursore già in quel punto.</li>
        <li><strong>Scrivi a mano</strong> in Leggi: penna in cinque colori, evidenziatore, gomma e annulla. I tratti si salvano e seguono il paragrafo su cui li hai fatti.</li>
        <li><strong>Cloze</strong>: un secondo tocco nasconde di nuovo il termine. Il pallino a destra di ogni titolo colora la riga a sinistra (verde, giallo, arancio, rosso) per ricordare com’è andata.</li>
        <li><strong>PDF</strong> ha la sua voce nel menu; dalla sezione ci arrivi con il pulsante “PDF” sotto il titolo. Le annotazioni fatte su dispositivi diversi ora si sommano invece di sovrascriversi.</li>
      </ul>`)}
    ${sec('Macro e micro-argomenti', `
      <ul>
        <li>Nel notebook tocca <strong>Nuovo macro-argomento</strong> e scegli le sezioni da metterci dentro.</li>
        <li>Da <strong>Opzioni</strong> del macro-argomento aggiungi sezioni, ne scrivi una nuova, importi direttamente lì, lo rinomini, lo sposti su o giù o lo elimini (le sezioni restano nel notebook).</li>
        <li>In Modifica e in Importa scegli il macro-argomento dal menu.</li>
        <li>Tocca il nome di un macro-argomento per ridurlo o espanderlo.</li>
      </ul>`)}
    ${sec('Leggere ed evidenziare', `
      <ul>
        <li>Ogni titolo degli appunti ha una <strong>freccetta</strong>: toccala, o tocca il titolo, per ridurre il paragrafo. “Riduci tutto” chiude tutti i paragrafi; l’app ricorda quali hai chiuso.</li>
        <li>Seleziona del testo: compare una barra con <strong>Cloze</strong>, cinque colori di evidenziatore, <u>sottolineatura</u>, ✕ per togliere la formattazione e <strong>Flashcard</strong>. Sul PC c’è anche il menu del tasto destro.</li>
        <li>Dopo ogni modifica puoi toccare <strong>Annulla</strong> nell’avviso in basso.</li>
        <li>Tocca un’immagine per vederla a schermo intero o creare un’image occlusion.</li>
        <li>In Impostazioni → Lettura e aspetto scegli tema (anche “Carta”, più riposante), carattere, dimensione e interlinea.</li>
      </ul>`)}
    ${sec('Modificare gli appunti', `
      <ul>
        <li>Gli appunti sono in Markdown: <code>**grassetto**</code>, <code>==cloze==</code>, <code>- elenco</code>, tabelle con <code>|</code>.</li>
        <li>Negli elenchi, <strong>Invio</strong> crea una nuova voce; Invio su una voce vuota torna indietro di un livello. Usa <strong>Rientra</strong> e <strong>Riduci rientro</strong> (sul PC Tab e Maiusc+Tab).</li>
        <li>Puoi aggiungere immagini dalla galleria o dalla fotocamera, ritagliare una figura da un PDF o <strong>scrivere a mano</strong>.</li>
        <li>Sul PC puoi incollare direttamente uno screenshot nel testo.</li>
      </ul>`)}
    ${sec('Modalità di studio', `
      <ul>
        <li><strong>Cloze</strong>: i termini evidenziati per il cloze sono coperti; toccali per controllare.</li>
        <li><strong>Pagina bianca</strong>: scrivi tutto quello che ricordi, poi confronta; l’AI può darti un punteggio e dirti cosa manca.</li>
        <li><strong>Orale</strong>: come all’esame, spieghi la sezione ad alta voce. Il telefono trascrive (serve internet), tu correggi se serve, poi confronti con gli appunti o ti fai valutare dall’AI, che commenta anche ordine e chiarezza dell’esposizione.</li>
        <li>In <strong>Domande</strong> puoi farti leggere la domanda (“Ascolta”) e rispondere a voce prima di vedere la soluzione.</li>
        <li><strong>Domande</strong>: rispondi a mente, poi segna se la sapevi.</li>
        <li>Alla fine valuti con <strong>Di nuovo, Difficile, Bene, Facile</strong>: il prossimo ripasso si calcola da qui.</li>
      </ul>`)}
    ${sec('Flashcard', `
      <ul>
        <li>Si creano dalla selezione in Leggi, dalla scheda Flashcard della sezione (dai cloze, dalle domande o con l’AI) o da Flashcard → notebook → Nuova flashcard.</li>
        <li>Nel fronte e nel retro puoi usare elenchi puntati, grassetto, evidenziatore, immagini e scrittura a mano.</li>
        <li>Il ripasso segue l’algoritmo di <strong>Anki</strong>: passi di 1 e 10 minuti, poi i giorni crescono in base alle tue risposte.</li>
        <li>Con <strong>Lavagna</strong> scrivi la risposta a mano prima di girare la carta.</li>
        <li>Quando premi “Di nuovo” puoi scrivere perché hai sbagliato: la nota comparirà al ripasso successivo.</li>
        <li>Negli elenchi la risposta è sfocata: la vedi aprendo la flashcard.</li>
        <li><strong>Image occlusion</strong>: copri le etichette di uno schema, ogni riquadro diventa una carta.</li>
      </ul>`)}
    ${sec('Pennino e tablet', `
      <ul>
        <li>Lo spessore segue la pressione del pennino.</li>
        <li>Quando l’app riconosce il pennino ignora il palmo appoggiato sullo schermo.</li>
        <li>Il tasto gomma del pennino cancella.</li>
      </ul>`)}
    ${sec('Prompt per l’AI', `
      <p>In Impostazioni → Prompt per l’AI trovi le istruzioni che l’app dà all’AI per formattare gli appunti, creare flashcard e domande, proporre il fronte di una flashcard e valutare la pagina bianca. Puoi cambiarle e tornare all’originale quando vuoi. Le parti tecniche (cloze, immagini, formato della risposta) si aggiungono da sole, così l’app continua a leggere bene le risposte.</p>
      <p>“Copia il prompt completo” lo copia pronto da incollare in Gemini o NotebookLM. Le flashcard nel formato <code>D:</code> / <code>R:</code> che ottieni puoi incollarle nel riquadro Domande di una sezione (Modifica), poi crearle dalla scheda Flashcard con “Dalle domande”.</p>`)}
    ${sec('Sincronizzazione con Drive', `
      <ol>
        <li>Su script.google.com crea un nuovo progetto e incolla <code>sync-notebook.gs</code>; cambia la frase segreta.</li>
        <li>Esegui la funzione <code>autorizza</code> e consenti l’accesso a Drive.</li>
        <li>Distribuisci come app web con accesso “Chiunque” e copia l’indirizzo che finisce con <code>/exec</code>.</li>
        <li>Incollalo in Impostazioni con la frase segreta e premi “Prova il collegamento”.</li>
      </ol>
      <p>La sincronizzazione parte da sola all’apertura e dopo ogni modifica. Per ogni elemento vince la modifica più recente.</p>`)}
    ${sec('StudyHub', `
      <p>Quando hai appreso tutte le flashcard di una sezione, o premi “Segna come studiata in StudyHub”, l’argomento viene passato a StudyHub che ne pianifica i ripassi. Le sezioni gestite da StudyHub non compaiono nel Ripasso del Notebook.</p>`)}
    ${sec('Scorciatoie da tastiera', `
      <ul>
        <li><strong>Spazio</strong>: mostra la risposta, oppure rivela il prossimo cloze.</li>
        <li><strong>1, 2, 3, 4</strong>: Di nuovo, Difficile, Bene, Facile.</li>
        <li><strong>Ctrl+Z</strong>: annulla l’ultima risposta o l’ultimo tratto a mano.</li>
        <li><strong>Tab / Maiusc+Tab</strong>: rientro negli elenchi.</li>
        <li><strong>Esc</strong>: chiude le finestre.</li>
      </ul>`)}
    ${sec('Backup e sicurezza dei dati', `
      <p>I dati sono salvati nel browser di ogni dispositivo e, se la attivi, su Drive. In Impostazioni → Backup puoi esportare un file con tutto. Le chiavi API restano solo sul dispositivo.</p>`)}
  `);
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
  { key: 'o', name: 'Arancio' },
  { key: 'r', name: 'Rosso' },
  { key: 'v', name: 'Viola' },
  { key: 't', name: 'Turchese' },
  { key: 'l', name: 'Lime' }
];
const MARK_RE = /\{\{([uygbpovrtl])\|((?:(?!\{\{|\}\})[^\n])*)\}\}/g;
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
// Tutto ciò che nel Markdown c’è ma nel testo mostrato non si vede: grassetti, cloze (con suggerimento),
// evidenziature, tag HTML, link [testo](indirizzo), collegamenti [[Titolo|testo]], escape \*, segni di
// elenco, titoli e citazioni a inizio riga, separatori delle tabelle
const MARKUP_GAP = '(?:\\*{1,3}|_{1,2}|==|~~|`|\\{\\{[uygbpovrtl]\\||\\}\\}|<[^>\\n]{1,80}>|::[^=\\n]*(?===)|\\]\\([^)\\n]*\\)|\\[\\[(?:[^\\]|\\n]*\\|)?|\\]\\]|\\[|\\\\(?=[!-/:-@\\[-`{-~])|(?:^|(?<=\\n))[ \\t]*(?:[-*+]|\\d{1,3}[.)]|#{1,6}|>)[ \\t]+|[ \\t]*\\|[ \\t]*)*';
// caratteri che nel Markdown possono essere scritti come entità HTML
const CHAR_ALT = { '&': '(?:&|&amp;)', '<': '(?:<|&lt;)', '>': '(?:>|&gt;)', '"': '(?:"|&quot;)', '\u00a0': '(?:\u00a0|&nbsp;| )', '’': '(?:’|\')', '‘': '(?:‘|\')', '“': '(?:“|")', '”': '(?:”|")' };
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function countOccurrences(hay, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}
function findSourceRange(md, selText, occurrence) {
  const t = selText.replace(/[\s\u00a0]+/g, ' ').trim();
  if (!t || t.length > 3000) return null;
  const parts = [...t].map(ch => (ch === ' ' ? '\\s+' : CHAR_ALT[ch] || escRe(ch)));
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
    const hm = md.slice(r.end).match(/^::[^=\n]*==/);
    if (md.slice(r.end, r.end + 2) === '==') r.end += 2;
    else if (hm) r.end += hm[0].length;
    else if (md.slice(r.start - 2, r.start) === '==') r.start -= 2;
  }
  // non spezzare i collegamenti [[Titolo|testo]] e i link [testo](indirizzo)
  const xo = (slice().match(/\[\[/g) || []).length;
  const xc = (slice().match(/\]\]/g) || []).length;
  if (xc > xo) { const i = md.lastIndexOf('[[', r.start); if (i >= 0) r.start = i; }
  if (xo > xc) { const i = md.indexOf(']]', r.end); if (i >= 0) r.end = i + 2; }
  const lk = slice().match(/^[^[]*\]\([^)\n]*\)/);
  if (lk) { const i = md.lastIndexOf('[', r.start); if (i >= 0 && md.slice(i, r.start).indexOf('\n') < 0) r.start = i; }
  const opens = (slice().match(/\{\{[uygbpovrtl]\|/g) || []).length;
  const closes = (slice().match(/\}\}/g) || []).length;
  if (opens > closes && md.slice(r.end, r.end + 2) === '}}') r.end += 2;
  if (closes > opens && /\{\{[uygbpovrtl]\|$/.test(md.slice(r.start - 4, r.start))) r.start -= 4;
  return r;
}

// Applica (o toglie) cloze, colore o sottolineatura a un intervallo del Markdown
function applyMarkToMd(md, r, kind) {
  const inner = md.slice(r.start, r.end);
  const before = md.slice(0, r.start);
  const after = md.slice(r.end);
  if (kind === 'cloze') {
    if (before.endsWith('==') && after.startsWith('==')) return before.slice(0, -2) + inner + after.slice(2);
    const hm = after.match(/^::[^\n=]*==/);
    if (before.endsWith('==') && hm) return before.slice(0, -2) + inner + after.slice(hm[0].length);
    return `${before}==${inner}==${after}`;
  }
  const wrap = before.match(/\{\{([uygbpovrtl])\|$/);
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
  const already = core.match(/^\{\{([uygbpovrtl])\|([\s\S]*)\}\}$/);
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
    <button type="button" class="rt-btn" data-rt="gloss" title="Aggiungi al glossario">Glossario</button>
    <button type="button" class="rt-btn" data-rt="clin" title="Crea una nota clinica">Nota clinica</button>
    <button type="button" class="rt-btn rt-card" data-rt="card">Flashcard</button>
    <button type="button" class="rt-btn" data-rt="edit" title="Apre Modifica con il cursore in questo punto">Modifica qui</button>`;
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
    if (kind === 'gloss') {
      if (await glossarySheet(null, { term: c.text.slice(0, 80), nbId: sec.notebookId })) { const y = window.scrollY; route(); window.scrollTo(0, y); }
      return;
    }
    if (kind === 'clin') {
      await clinicSheet(null, { title: sec.title, body: c.listText || c.text, nbId: sec.notebookId, sectionId: sec.id });
      return;
    }
    if (kind === 'edit') {
      const r0 = findSourceRange(sec.md, c.text, c.occurrence);
      editJump = { secId: sec.id, start: r0 ? r0.start : -1, end: r0 ? r0.end : -1, text: c.text };
      go(`#/sec/${sec.id}/edit`);
      return;
    }
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
    let c = capture();
    if (!c && !e.target.closest('a, img, button, input, textarea')) {
      // nessuna selezione: prendo la parola sotto il puntatore
      const pos = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      if (pos && container.contains(pos.startContainer)) {
        const sel = document.getSelection();
        sel.removeAllRanges();
        sel.addRange(pos);
        try { sel.modify('move', 'backward', 'word'); sel.modify('extend', 'forward', 'word'); } catch { /* browser senza modify */ }
        c = capture();
      }
    }
    if (!c) return; // menu normale del browser
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
  if (q.startsWith('#')) {
    const t = normTag(q);
    const tags = allTags().filter(([x]) => !t || x.includes(t));
    return tags.length
      ? `<h2 class="sub">Tag</h2><div class="tag-cloud big">${tags.map(([x, n]) => `<a class="tag" href="#/tag/${encodeURIComponent(x)}">#${esc(x)} <small>${n}</small></a>`).join('')}</div>`
      : '<p class="hint">Nessun tag trovato.</p>';
  }
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
        <span class="row-sub spoiler">${searchSnippet(c.back, q) || '&nbsp;'}</span>
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
/* =====================================================================
   v3.6: pagina Altro, link a icone, calendario e statistiche, tag,
   collegamenti tra pagine, glossario, note cliniche, immagini
   ===================================================================== */

const ICONS = {
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  clinic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/></svg>',
  glossary: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M9 9h6M9 13h4"/></svg>',
  tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>',
  links: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>',
  guide: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4"/><path d="M12 16.8v.2"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
};
const hueOf = str => { let h = 0; for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
const foldAccents = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const fmtMin = sec => {
  const m = Math.round((sec || 0) / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
};

// Finestra generica: restituisce l’elemento e la funzione per chiuderla
function openSheet(inner, { label = '', onClose = () => {} } = {}) {
  const root = $('#modalRoot');
  const prevFocus = document.activeElement;
  root.innerHTML = `<div class="overlay"><div class="modal sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">${inner}</div></div>`;
  const el = $('.modal', root);
  let closed = false;
  const onKey = e => { if (e.key === 'Escape' && el.isConnected) { e.stopPropagation(); close(null); } };
  const close = v => {
    if (closed) return;
    closed = true;
    if (el.isConnected) root.innerHTML = '';
    document.removeEventListener('keydown', onKey, true);
    if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus({ preventScroll: true });
    onClose(v);
  };
  document.addEventListener('keydown', onKey, true);
  $('.overlay', root).addEventListener('click', e => { if (e.target.classList.contains('overlay')) close(null); });
  return { el, close };
}

/* ---------- Pagina "Altro" ---------- */
const MORE_ITEMS = [
  ['search', 'Cerca ovunque', 'Appunti, flashcard, testo dei PDF, glossario, note cliniche'],
  ['calendar', 'Calendario', 'Ripassi in programma, tempo di studio, punti deboli'],
  ['clinic', 'Note cliniche', 'Quadri clinici di tutte le materie, per sintomo'],
  ['glossary', 'Glossario', 'Parole particolari e il loro significato'],
  ['tag', 'Tag', 'Appunti e flashcard per etichetta'],
  ['links', 'Link utili', 'I siti che usi per studiare'],
  ['guide', 'Guida', 'Come funziona ogni parte dell’app'],
  ['settings', 'Impostazioni', 'AI, sincronizzazione, lettura, backup']
];
function viewMore() {
  setView(`
    <header class="page-head"><h1>Altro</h1></header>
    <div class="tile-grid wide-grid">
      ${MORE_ITEMS.map(([k, label, sub]) => `
        <a class="tile wide" href="#/${k}">
          <span class="tile-ic app-ic" style="--h:${hueOf(k + 'x')}">${ICONS[k]}</span>
          <span class="tile-text"><span class="tile-name">${label}</span><span class="tile-sub">${sub}</span></span>
        </a>`).join('')}
    </div>`);
}

/* ---------- Link utili come icone ---------- */
const linksOnly = () => state.links.filter(l => !l.kind);
let linksEditing = false;
const faviconUrl = url => { const h = linkHost(url); return h && /\./.test(h) ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(h)}&sz=64` : ''; };
function linkTile(l) {
  const first = [...(l.title || '?').trim()][0] || '?';
  const fav = faviconUrl(l.url);
  return `
    <a class="tile" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" data-id="${l.id}" title="${esc(l.note || linkHost(l.url))}">
      <span class="tile-ic" style="--h:${hueOf(l.id)}">
        <span class="tile-letter">${esc(first.toUpperCase())}</span>
        ${fav ? `<img class="tile-fav" alt="" referrerpolicy="no-referrer" src="${esc(fav)}">` : ''}
        <span class="tile-edit" aria-hidden="true">✎</span>
      </span>
      <span class="tile-name">${esc(l.title)}</span>
    </a>`;
}

/* ---------- Statistiche e tempo di studio (solo su questo dispositivo) ---------- */
const Stats = {
  KEY: 'nb-stats',
  data: null,
  load() {
    if (this.data) return this.data;
    try { this.data = JSON.parse(localStorage.getItem(this.KEY) || '{}'); } catch { this.data = {}; }
    if (!this.data.d || typeof this.data.d !== 'object') this.data.d = {};
    return this.data;
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch { /* spazio pieno */ } },
  day(d = todayStr()) {
    const all = this.load().d;
    if (!all[d]) all[d] = { t: 0, r: 0, nb: {} };
    return all[d];
  },
  addTime(sec, nbId) {
    const x = this.day();
    x.t += sec;
    if (nbId) x.nb[nbId] = (x.nb[nbId] || 0) + sec;
    const keys = Object.keys(this.data.d);
    if (keys.length > 420) keys.sort().slice(0, keys.length - 400).forEach(k => delete this.data.d[k]);
    this.save();
  },
  addReview() { this.day().r += 1; this.save(); }
};
// Conta il tempo passato su sezioni (tranne Modifica) e flashcard, solo se stai usando l’app
const Tracker = {
  last: Date.now(),
  start() {
    const mark = () => { this.last = Date.now(); };
    ['pointerdown', 'keydown', 'scroll', 'wheel'].forEach(ev => window.addEventListener(ev, mark, { passive: true, capture: true }));
    setInterval(() => this.tick(), 15000);
  },
  context() {
    const [p0, p1, p2] = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/');
    if (p0 === 'sec' && p2 !== 'edit') return secById(p1)?.notebookId || '';
    if (p0 === 'pdf') return pdfById(p1)?.notebookId || '';
    if (p0 === 'study') {
      if (!p1 || p1 === 'all' || p1.startsWith('tag-')) return '';
      if (p1.startsWith('sec-')) return secById(p1.slice(4))?.notebookId || '';
      return p1;
    }
    return null;
  },
  tick() {
    if (document.visibilityState !== 'visible' || Date.now() - this.last > 120000) return;
    const nb = this.context();
    if (nb !== null) Stats.addTime(15, nb);
  }
};

/* ---------- Calendario ---------- */
let calMonth = '';
let calDay = '';
function dueIndex() {
  const today = todayStr();
  const map = {};
  const slot = d => (map[d] || (map[d] = { secs: [], cards: 0, cardNb: {} }));
  for (const s of state.sections) {
    if (s.studyhub || !s.srs?.due) continue;
    slot(s.srs.due < today ? today : s.srs.due).secs.push(s);
  }
  for (const c of state.cards) {
    if (c.suspended || !c.srs || c.srs.state === 'new' || !c.srs.due) continue;
    let d = localDateStr(new Date(c.srs.due));
    if (d < today) d = today;
    const x = slot(d);
    x.cards++;
    x.cardNb[c.notebookId] = (x.cardNb[c.notebookId] || 0) + 1;
  }
  return map;
}
function weakSections() {
  return state.sections
    .map(s => {
      const h = (s.srs?.history || []).slice(-6);
      const again = h.filter(x => x.q < 3).length;
      const hard = h.filter(x => x.q === 3).length;
      return { s, again, hard, score: again * 2 + hard };
    })
    .filter(x => x.score >= 2)
    .sort((a, b) => b.score - a.score || a.s.title.localeCompare(b.s.title))
    .slice(0, 8);
}
function weakCards() {
  return state.cards
    .filter(c => !c.suspended && c.srs && !isLeech(c) && (c.srs.lapses >= 2 || (c.srs.state === 'review' && c.srs.ease < 2)))
    .sort((a, b) => (b.srs.lapses || 0) - (a.srs.lapses || 0) || a.srs.ease - b.srs.ease)
    .slice(0, 10);
}
function viewCalendar() {
  const today = todayStr();
  if (!calMonth) calMonth = today.slice(0, 7);
  if (!calDay) calDay = today;
  const [y, m] = calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const pad = (first.getDay() + 6) % 7;
  const days = new Date(y, m, 0).getDate();
  const idx = dueIndex();
  const st = Stats.load().d;
  const monthName = first.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const cells = [];
  for (let i = 0; i < pad; i++) cells.push('<span class="cal-cell pad" aria-hidden="true"></span>');
  for (let d = 1; d <= days; d++) {
    const ds = `${calMonth}-${String(d).padStart(2, '0')}`;
    const x = idx[ds];
    const n = x ? x.secs.length + x.cards : 0;
    const past = ds < today;
    const secs = st[ds]?.t || 0;
    cells.push(`
      <button type="button" class="cal-cell ${ds === today ? 'is-today' : ''} ${ds === calDay ? 'sel' : ''} ${past ? 'past' : ''}" data-day="${ds}"
        aria-label="${d} ${monthName}${!past && n ? `, ${n} da ripassare` : ''}${past && secs ? `, ${fmtMin(secs)} di studio` : ''}" ${ds === calDay ? 'aria-pressed="true"' : ''}>
        <span class="cal-n">${d}</span>
        ${!past && n ? `<span class="cal-due" style="--load:${Math.min(1, 0.25 + n / 50).toFixed(2)}">${n}</span>` : ''}
        ${past && secs >= 60 ? `<span class="cal-min">${Math.round(secs / 60)}′</span>` : ''}
      </button>`);
  }
  // giorno scelto
  const x = idx[calDay];
  const dayLabel = new Date(calDay + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  let dayHtml;
  if (calDay < today) {
    const s = st[calDay];
    dayHtml = s && (s.t || s.r)
      ? `<p>${s.t ? `Hai studiato ${fmtMin(s.t)}` : 'Hai studiato'}${s.r ? ` e dato ${s.r} ${s.r === 1 ? 'valutazione' : 'valutazioni'}` : ''}.</p>`
      : '<p class="hint">Nessuna attività registrata su questo dispositivo.</p>';
  } else if (x) {
    const nbRows = Object.entries(x.cardNb).map(([id, k]) => `
      <li><a class="row" href="${calDay === today ? `#/study/${id}` : `#/deck/${id}`}">
        <span class="row-main"><span class="row-title">${esc(nbById(id)?.name || 'Notebook')}</span><span class="row-sub">${k} flashcard</span></span>
        ${calDay === today ? '<span class="pill due">Studia</span>' : ''}</a></li>`).join('');
    dayHtml = `
      ${x.secs.length ? `<ul class="list">${x.secs.sort(sortDue).map(s => sectionRow(s, { showNb: true, review: calDay === today })).join('')}</ul>` : ''}
      ${nbRows ? `<ul class="list cal-cards">${nbRows}</ul>` : ''}`;
  } else {
    dayHtml = '<p class="hint">Niente in programma.</p>';
  }
  // ultimi 14 giorni
  const bars = [];
  let maxT = 60;
  for (let i = 13; i >= 0; i--) { const d = addDays(today, -i); maxT = Math.max(maxT, st[d]?.t || 0); bars.push(d); }
  const sumDays = n => { let t = 0; for (let i = 0; i < n; i++) t += st[addDays(today, -i)]?.t || 0; return t; };
  let streak = 0;
  for (let i = (st[today]?.t || st[today]?.r) ? 0 : 1; i < 400; i++) {
    const s = st[addDays(today, -i)];
    if (s && (s.t || s.r)) streak++; else break;
  }
  const perNb = {};
  for (let i = 0; i < 30; i++) Object.entries(st[addDays(today, -i)]?.nb || {}).forEach(([id, t]) => { perNb[id] = (perNb[id] || 0) + t; });
  const nbList = Object.entries(perNb).filter(([id]) => nbById(id)).sort((a, b) => b[1] - a[1]);
  const nbMax = nbList.length ? nbList[0][1] : 1;
  const ws = weakSections();
  const wc = weakCards();
  const leeches = state.cards.filter(c => !c.suspended && isLeech(c)).sort((a, b) => (b.srs?.lapses || 0) - (a.srs?.lapses || 0));
  const czAll = state.sections.flatMap(s => czWeakOf(s).map(w => ({ s, w }))).sort((a, b) => b.w.bad - a.w.bad);
  const exams = (Stats.load().exams || []).slice(-5).reverse();

  setView(`
    <header class="page-head"><div><h1>Calendario</h1>
      <p class="lede">Ripassi in programma e tempo di studio. Le sezioni affidate a StudyHub le pianifica StudyHub.</p></div></header>
    <section class="cal" aria-label="Calendario dei ripassi">
      <div class="cal-head">
        <button class="btn sm ghost" data-cal="-1" aria-label="Mese precedente">‹</button>
        <h2 class="cal-title">${esc(monthName)}</h2>
        <button class="btn sm ghost" data-cal="1" aria-label="Mese successivo">›</button>
        ${calMonth !== today.slice(0, 7) ? '<button class="btn sm" data-cal="0">Oggi</button>' : ''}
      </div>
      <div class="cal-grid">
        ${['L', 'M', 'M', 'G', 'V', 'S', 'D'].map(d => `<span class="cal-dow" aria-hidden="true">${d}</span>`).join('')}
        ${cells.join('')}
      </div>
    </section>
    <h2 class="sub cal-day-title">${esc(dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1))}</h2>
    ${dayHtml}

    ${forecastHtml(idx)}

    <h2 class="sub">Tempo di studio</h2>
    <div class="stat-row">
      <div class="stat"><b>${fmtMin(st[today]?.t)}</b><span>oggi</span></div>
      <div class="stat"><b>${fmtMin(sumDays(7))}</b><span>ultimi 7 giorni</span></div>
      <div class="stat"><b>${fmtMin(sumDays(30))}</b><span>ultimi 30 giorni</span></div>
      <div class="stat"><b>${streak}</b><span>${streak === 1 ? 'giorno di fila' : 'giorni di fila'}</span></div>
    </div>
    <div class="bars" role="img" aria-label="Minuti di studio negli ultimi 14 giorni">
      ${bars.map(d => { const t = st[d]?.t || 0; return `<span class="bar ${d === today ? 'is-today' : ''}" style="--v:${(t / maxT).toFixed(3)}" title="${esc(d)}: ${fmtMin(t)}"><i></i><small>${new Date(d + 'T12:00').toLocaleDateString('it-IT', { weekday: 'narrow' })}</small></span>`; }).join('')}
    </div>
    ${nbList.length ? `
      <ul class="nb-time">${nbList.map(([id, t]) => `
        <li><span class="nb-time-name">${esc(nbById(id).name)}</span><span class="nb-time-bar" style="--v:${(t / nbMax).toFixed(3)}"><i></i></span><span class="nb-time-v">${fmtMin(t)}</span></li>`).join('')}
      </ul>` : ''}
    <p class="hint">Il tempo si conta mentre studi sezioni e flashcard e resta su questo dispositivo.</p>

    <h2 class="sub">Punti deboli</h2>
    ${ws.length || wc.length ? `
      ${ws.length ? `<ul class="list">${ws.map(({ s, again, hard }) => `
        <li><a class="row" href="#/sec/${s.id}">
          <span class="row-main"><span class="row-title">${esc(s.title)}</span>
          <span class="row-sub">${esc(nbById(s.notebookId)?.name || '')}: ${again ? `${again} volte “Di nuovo”` : ''}${again && hard ? ', ' : ''}${hard ? `${hard} volte “Difficile”` : ''} negli ultimi ripassi</span></span>
        </a></li>`).join('')}</ul>` : ''}
      ${wc.length ? `<h3 class="sub3">Flashcard sbagliate più spesso</h3><ul class="list">${wc.map(cardRow).join('')}</ul>` : ''}` : ''}
    ${leeches.length ? `<h3 class="sub3">Flashcard sanguisuga (sbagliate ${LEECH} volte o più)</h3>
      <p class="hint">Ti fanno perdere tempo a ogni ripasso. Riscrivile più semplici, spezzale in due, aggiungi un’immagine o una nota sull’errore; se non servono più, sospendile. Hanno il tag <a href="#/tag/${LEECH_TAG}">#${LEECH_TAG}</a>.</p>
      <ul class="list">${leeches.slice(0, 20).map(cardRow).join('')}</ul>` : ''}
    ${czAll.length ? `<h3 class="sub3">Parti rimaste in rosso o arancio nel Cloze</h3><ul class="czw-list" id="czwAll">${czAll.slice(0, 20).map(({ s, w }) => czWeakItemHtml(s, w, { showSec: true })).join('')}</ul>` : ''}
    ${!ws.length && !wc.length && !czAll.length && !leeches.length ? '<p class="hint">Ancora nessuno: compariranno le sezioni, le flashcard e le parti del Cloze che sbagli più spesso.</p>' : ''}
    ${exams.length ? `<h2 class="sub">Simulazioni d’esame</h2><ul class="list">${exams.map(x => `<li class="row"><span class="row-main"><span class="row-title">${esc(x.name)}: ${x.score}%</span><span class="row-sub">${esc(new Date(x.d + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }))}, ${x.n} domande</span></span></li>`).join('')}</ul>` : ''}
  `);
  on('[data-cal]', 'click', e => {
    const v = +e.currentTarget.dataset.cal;
    if (!v) { calMonth = today.slice(0, 7); calDay = today; }
    else { const d = new Date(y, m - 1 + v, 1); calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
    viewCalendar();
  });
  on('[data-fc]', 'click', e => {
    calDay = e.currentTarget.dataset.fc;
    calMonth = calDay.slice(0, 7);
    viewCalendar();
    $('.cal-day-title')?.scrollIntoView({ block: 'start' });
  });
  const czBox = $('#czwAll');
  if (czBox) bindCzWeak(czBox);
  on('[data-day]', 'click', e => { calDay = e.currentTarget.dataset.day; viewCalendar(); $('.cal-day-title')?.scrollIntoView({ block: 'nearest' }); });
  on('[data-review]', 'click', () => { state.fromReview = true; });
}

/* ---------- Tag ---------- */
const normTag = t => String(t || '').trim().replace(/^#+/, '').replace(/[\/\\]/g, '-').replace(/\s+/g, ' ').toLowerCase().slice(0, 40);
const parseTags = s => [...new Set(String(s || '').split(/[,;\n]/).map(normTag).filter(Boolean))];
const tagsOf = x => (x && Array.isArray(x.tags) ? x.tags : []);
function allTags() {
  const n = new Map();
  [...state.sections, ...state.cards].forEach(x => tagsOf(x).forEach(t => n.set(t, (n.get(t) || 0) + 1)));
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function tagChips(tags, { link = true } = {}) {
  if (!tags.length) return '';
  return `<span class="tags">${tags.map(t => link
    ? `<a class="tag" href="#/tag/${encodeURIComponent(t)}">#${esc(t)}</a>`
    : `<span class="tag">#${esc(t)}</span>`).join('')}</span>`;
}
function tagFieldHtml(id, tags) {
  const known = allTags().map(([t]) => t).filter(t => !tags.includes(t)).slice(0, 14);
  return `
    <label class="field tag-field"><span>Tag, separati da virgole</span>
      <input class="input" id="${id}" value="${esc(tags.join(', '))}" placeholder="Es. alta resa, da rivedere" autocomplete="off" autocapitalize="off"></label>
    ${known.length ? `<div class="tag-suggest" data-for="${id}"><span class="hint">Già usati:</span>${known.map(t => `<button type="button" class="tag" data-addtag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}`;
}
function bindTagField(root, id) {
  const inp = root.querySelector('#' + id);
  $$(`[data-for="${id}"] [data-addtag]`, root).forEach(b => b.addEventListener('click', () => {
    const cur = parseTags(inp.value);
    if (!cur.includes(b.dataset.addtag)) cur.push(b.dataset.addtag);
    inp.value = cur.join(', ');
    b.remove();
  }));
}
function viewTag(name) {
  const t = normTag(name || '');
  if (!t) {
    const tags = allTags();
    setView(`
      <header class="page-head"><div><h1>Tag</h1><p class="lede">${tags.length ? 'Tocca un tag per vedere appunti e flashcard che lo usano.' : 'Aggiungi tag alle sezioni (in Modifica) e alle flashcard: qui li ritrovi tutti.'}</p></div></header>
      ${tags.length ? `<div class="tag-cloud big">${tags.map(([x, n]) => `<a class="tag" href="#/tag/${encodeURIComponent(x)}">#${esc(x)} <small>${n}</small></a>`).join('')}</div>` : ''}`);
    return;
  }
  const secs = state.sections.filter(s => tagsOf(s).includes(t)).sort((a, b) => a.title.localeCompare(b.title));
  const cards = state.cards.filter(c => tagsOf(c).includes(t));
  const toStudy = cardCounts(cards.filter(c => !c.suspended));
  setView(`
    <a class="back" href="#/tag">Tutti i tag</a>
    <header class="page-head">
      <div><h1>#${esc(t)}</h1><p class="lede">${secs.length} ${secs.length === 1 ? 'sezione' : 'sezioni'}, ${cards.length} flashcard</p></div>
      ${toStudy.n + toStudy.l + toStudy.r ? `<a class="btn primary" href="#/study/tag-${encodeURIComponent(t)}">Studia queste flashcard</a>` : ''}
    </header>
    ${secs.length ? `<h2 class="sub">Sezioni</h2><ul class="list">${secs.map(s => sectionRow(s, { showNb: true })).join('')}</ul>` : ''}
    ${cards.length ? `<h2 class="sub">Flashcard</h2><ul class="list">${cards.slice(0, 300).map(cardRow).join('')}</ul>` : ''}
    ${!secs.length && !cards.length ? '<div class="empty"><p>Nessun elemento usa più questo tag.</p></div>' : ''}`);
}

/* ---------- Collegamenti tra pagine: [[Titolo]] o [[Titolo|testo]] ---------- */
const XREF_RE = /\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+?))?\]\]/g;
const secByTitle = t => { const k = String(t || '').trim().toLowerCase(); return k ? state.sections.find(s => s.title.trim().toLowerCase() === k) : null; };
function renderXrefs(src) {
  return src.replace(XREF_RE, (m, t, label) => {
    const s = secByTitle(t);
    const txt = esc((label || t).trim());
    return s ? `<a class="xref" href="#/sec/${s.id}">${txt}</a>` : `<span class="xref missing" title="Nessuna sezione con questo titolo">${txt}</span>`;
  });
}
const xrefPlain = s => String(s || '').replace(XREF_RE, (m, t, label) => (label || t).trim());
function backlinksOf(sec) {
  const k = sec.title.trim().toLowerCase();
  if (!k) return [];
  return state.sections.filter(s => s.id !== sec.id && (s.md || '').toLowerCase().includes('[[' + k)
    && [...s.md.matchAll(XREF_RE)].some(m => m[1].trim().toLowerCase() === k));
}
async function renameXrefs(oldTitle, newTitle, skipId) {
  const k = oldTitle.trim().toLowerCase();
  if (!k || k === newTitle.trim().toLowerCase()) return 0;
  let n = 0;
  for (const s of state.sections) {
    if (s.id === skipId || !(s.md || '').toLowerCase().includes('[[' + k)) continue;
    const md = s.md.replace(XREF_RE, (m, t, label) => (t.trim().toLowerCase() === k ? `[[${newTitle}${label ? `|${label}` : ''}]]` : m));
    if (md !== s.md) { s.md = md; await saveSection(s); n++; }
  }
  return n;
}
function sectionPickerSheet(title = 'Collega una pagina', exceptId = null) {
  return new Promise(resolve => {
    const all = state.sections.filter(s => s.id !== exceptId).sort((a, b) => a.title.localeCompare(b.title));
    const where = s => [nbById(s.notebookId)?.name, groupPathText(s)].filter(Boolean).join(' › ');
    const sh = openSheet(`
      <h2>${esc(title)}</h2>
      <input type="search" class="input search" id="spQ" placeholder="Cerca una sezione" aria-label="Cerca una sezione">
      <ul class="list pick-list" id="spList"></ul>
      <div class="modal-actions"><button class="btn ghost" type="button" data-sp="no">Annulla</button></div>`, { label: title, onClose: resolve });
    const list = $('#spList', sh.el);
    const draw = q => {
      const f = foldAccents(q.trim());
      const hits = all.filter(s => !f || foldAccents(s.title + ' ' + where(s)).includes(f)).slice(0, 80);
      list.innerHTML = hits.map(s => `<li><button type="button" class="row" data-pick="${s.id}"><span class="row-main"><span class="row-title">${esc(s.title)}</span><span class="row-sub">${esc(where(s))}</span></span></button></li>`).join('')
        || '<li class="row muted">Nessuna sezione trovata.</li>';
    };
    draw('');
    $('#spQ', sh.el).addEventListener('input', e => draw(e.target.value));
    list.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) sh.close(secById(b.dataset.pick)); });
    $('[data-sp="no"]', sh.el).onclick = () => sh.close(null);
    setTimeout(() => $('#spQ', sh.el)?.focus(), 40);
  });
}

/* ---------- Glossario e note cliniche (salvati con i link, così si sincronizzano) ---------- */
const glossary = () => state.links.filter(l => l.kind === 'glossary').sort((a, b) => a.term.localeCompare(b.term, 'it', { sensitivity: 'base' }));
const clinicalNotes = () => state.links.filter(l => l.kind === 'clinical');
const nbSelectHtml = (id, selected) => `<select class="input" id="${id}"><option value="">Nessuna in particolare</option>${state.notebooks.map(n => `<option value="${n.id}" ${n.id === selected ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select>`;

function glossarySheet(entry = null, prefill = {}) {
  return new Promise(resolve => {
    const e = entry || {};
    const sh = openSheet(`
      <h2>${entry ? 'Modifica la parola' : 'Nuova parola nel glossario'}</h2>
      <label class="field"><span>Parola</span><input class="input" id="glTerm" value="${esc(e.term || prefill.term || '')}" placeholder="Es. Anasarca" autocomplete="off"></label>
      <label class="field"><span>Significato</span><textarea class="input card-ta" id="glDef" rows="4" placeholder="Edema generalizzato del sottocutaneo…">${esc(e.def || prefill.def || '')}</textarea></label>
      <label class="field"><span>Materia</span>${nbSelectHtml('glNb', e.nbId || prefill.nbId || '')}</label>
      <div class="modal-actions">
        ${entry ? '<button class="btn ghost danger" type="button" data-gl-act="del">Elimina</button>' : ''}
        <button class="btn ghost" type="button" data-gl-act="no">Annulla</button>
        <button class="btn primary" type="button" data-gl-act="ok">Salva</button>
      </div>`, { label: 'Glossario', onClose: resolve });
    $('[data-gl-act="no"]', sh.el).onclick = () => sh.close(false);
    const del = $('[data-gl-act="del"]', sh.el);
    if (del) del.onclick = async () => { await removeRecords([{ store: 'links', rec: entry }]); toast('Parola eliminata'); sh.close(true); };
    $('[data-gl-act="ok"]', sh.el).onclick = async () => {
      const term = $('#glTerm', sh.el).value.trim();
      const def = $('#glDef', sh.el).value.trim();
      if (!term) { toast('Scrivi la parola'); $('#glTerm', sh.el).focus(); return; }
      if (!def) { toast('Scrivi il significato'); $('#glDef', sh.el).focus(); return; }
      const dup = glossary().find(g => g.id !== e.id && g.term.trim().toLowerCase() === term.toLowerCase());
      if (dup) { toast(`“${dup.term}” è già nel glossario`); return; }
      const rec = entry || { id: uid(), kind: 'glossary', notebookId: '_glossary', created: Date.now() };
      Object.assign(rec, { term, def, nbId: $('#glNb', sh.el).value || '' });
      await saveLink(rec);
      toast(entry ? 'Parola aggiornata' : 'Aggiunta al glossario');
      sh.close(true);
    };
    setTimeout(() => $(e.term || prefill.term ? '#glDef' : '#glTerm', sh.el)?.focus(), 40);
  });
}
function showGlossaryEntry(id) {
  const g = state.links.find(l => l.id === id);
  if (!g) return;
  const sh = openSheet(`
    <h2>${esc(g.term)}</h2>
    ${g.nbId && nbById(g.nbId) ? `<p class="sheet-sub">${esc(nbById(g.nbId).name)}</p>` : ''}
    <div class="notes gl-def-full">${renderMd(g.def)}</div>
    <div class="modal-actions">
      <button class="btn ghost" type="button" data-g="edit">Modifica</button>
      <button class="btn primary" type="button" data-g="close">Chiudi</button>
    </div>`, { label: g.term });
  $('[data-g="close"]', sh.el).onclick = () => sh.close();
  $('[data-g="edit"]', sh.el).onclick = async () => { sh.close(); if (await glossarySheet(g)) { const y = scrollY; route(); scrollTo(0, y); } };
}
// Sottolinea a puntini la prima occorrenza di ogni parola del glossario
function markGlossary(root) {
  const list = glossary().filter(g => g.term.trim().length > 1);
  if (!list.length || !root) return;
  const byKey = new Map(list.map(g => [g.term.trim().toLowerCase(), g]));
  const pattern = [...byKey.keys()].sort((a, b) => b.length - a.length).map(escRe).join('|');
  let re;
  try { re = new RegExp(`(?<![\\p{L}\\p{N}])(${pattern})(?![\\p{L}\\p{N}])`, 'giu'); } catch { return; }
  const done = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement.closest('a, code, pre, mark.cz, .gl, button, .img-box') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    re.lastIndex = 0;
    let m;
    let last = 0;
    let hit = false;
    const frag = document.createDocumentFragment();
    while ((m = re.exec(text))) {
      const key = m[1].toLowerCase();
      if (done.has(key) || !byKey.has(key)) continue;
      done.add(key);
      hit = true;
      frag.append(text.slice(last, m.index));
      const span = document.createElement('span');
      span.className = 'gl';
      span.dataset.gl = byKey.get(key).id;
      span.tabIndex = 0;
      span.setAttribute('role', 'button');
      span.textContent = m[1];
      frag.append(span);
      last = m.index + m[1].length;
    }
    if (hit) { frag.append(text.slice(last)); node.replaceWith(frag); }
    if (done.size === byKey.size) break;
  }
}
function bindGlossaryClicks(root) {
  root.addEventListener('click', e => {
    const g = e.target.closest('.gl');
    if (!g) return;
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return;
    showGlossaryEntry(g.dataset.gl);
  });
  root.addEventListener('keydown', e => { const g = e.target.closest?.('.gl'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showGlossaryEntry(g.dataset.gl); } });
}
let glossaryQuery = '';
function viewGlossary() {
  const list = glossary();
  setView(`
    <header class="page-head">
      <div><h1>Glossario</h1><p class="lede">${list.length ? `${list.length} ${list.length === 1 ? 'parola' : 'parole'}. Negli appunti, in Leggi, le trovi sottolineate a puntini: toccale per il significato.` : 'Le parole particolari e il loro significato, tutte in un posto.'}</p></div>
      <button class="btn primary" data-act="add-gl">Aggiungi una parola</button>
    </header>
    ${list.length ? `<input type="search" class="input search" id="glQ" placeholder="Cerca una parola o un significato" aria-label="Cerca nel glossario" value="${esc(glossaryQuery)}"><div id="glList"></div>` : `
      <div class="empty"><p>Puoi aggiungere una parola da qui o selezionandola mentre leggi gli appunti.</p><button class="btn primary" data-act="add-gl">Aggiungi una parola</button></div>`}`);
  const draw = () => {
    const box = $('#glList');
    if (!box) return;
    const f = foldAccents(glossaryQuery.trim());
    const hits = list.filter(g => !f || foldAccents(g.term + ' ' + g.def).includes(f));
    const groups = [];
    hits.forEach(g => {
      const L = foldAccents(g.term).charAt(0).toUpperCase() || '#';
      let grp = groups.find(x => x.L === L);
      if (!grp) { grp = { L, items: [] }; groups.push(grp); }
      grp.items.push(g);
    });
    box.innerHTML = groups.map(grp => `
      <h2 class="sub gl-letter">${esc(grp.L)}</h2>
      <ul class="list">${grp.items.map(g => `
        <li><button type="button" class="row" data-gl-edit="${g.id}"><span class="row-main">
          <span class="row-title">${esc(g.term)}</span>
          <span class="row-sub gl-def">${esc(plainText(g.def, 180))}</span>
          ${g.nbId && nbById(g.nbId) ? `<span class="row-sub gl-nb">${esc(nbById(g.nbId).name)}</span>` : ''}
        </span></button></li>`).join('')}</ul>`).join('') || '<p class="hint">Nessuna parola trovata.</p>';
  };
  draw();
  $('#glQ')?.addEventListener('input', e => { glossaryQuery = e.target.value; draw(); });
  on('[data-act="add-gl"]', 'click', async () => { if (await glossarySheet()) route(); });
  $('#glList')?.addEventListener('click', async e => {
    const b = e.target.closest('[data-gl-edit]');
    if (b && await glossarySheet(state.links.find(l => l.id === b.dataset.glEdit))) route();
  });
}

/* Note cliniche */
let clinicQuery = '';
const clinicSyms = new Set();
function clinicSheet(entry = null, prefill = {}) {
  return new Promise(resolve => {
    const e = entry || {};
    const syms = e.symptoms || prefill.symptoms || [];
    const known = [...new Set(clinicalNotes().flatMap(n => n.symptoms || []))].filter(s => !syms.includes(s)).slice(0, 16);
    const sec = secById(e.sectionId || prefill.sectionId);
    const sh = openSheet(`
      <h2>${entry ? 'Modifica la nota clinica' : 'Nuova nota clinica'}</h2>
      ${sec ? `<p class="sheet-sub">Collegata a ${esc(sec.title)}</p>` : ''}
      <label class="field"><span>Quadro clinico o malattia</span><input class="input" id="cnTitle" value="${esc(e.title || prefill.title || '')}" placeholder="Es. Scompenso cardiaco sinistro"></label>
      <label class="field"><span>Sintomi e segni, separati da virgole</span><input class="input" id="cnSyms" value="${esc(syms.join(', '))}" placeholder="Es. dispnea, ortopnea, rantoli" autocomplete="off" autocapitalize="off"></label>
      ${known.length ? `<div class="tag-suggest" data-for="cnSyms"><span class="hint">Già usati:</span>${known.map(t => `<button type="button" class="tag" data-addtag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      <label class="field"><span>Materia</span>${nbSelectHtml('cnNb', e.nbId || prefill.nbId || '')}</label>
      <label class="field"><span>Note: diagnosi, esami, terapia…</span><textarea class="input card-ta" id="cnBody" rows="6">${esc(e.body || prefill.body || '')}</textarea></label>
      <div class="modal-actions">
        ${entry ? '<button class="btn ghost danger" type="button" data-cn-act="del">Elimina</button>' : ''}
        <button class="btn ghost" type="button" data-cn-act="no">Annulla</button>
        <button class="btn primary" type="button" data-cn-act="ok">Salva</button>
      </div>`, { label: 'Nota clinica', onClose: resolve });
    bindTagField(sh.el, 'cnSyms');
    $('[data-cn-act="no"]', sh.el).onclick = () => sh.close(false);
    const del = $('[data-cn-act="del"]', sh.el);
    if (del) del.onclick = async () => { await removeRecords([{ store: 'links', rec: entry }]); toast('Nota clinica eliminata'); sh.close(true); };
    $('[data-cn-act="ok"]', sh.el).onclick = async () => {
      const title = $('#cnTitle', sh.el).value.trim();
      if (!title) { toast('Scrivi il quadro clinico'); $('#cnTitle', sh.el).focus(); return; }
      const rec = entry || { id: uid(), kind: 'clinical', notebookId: '_clinical', created: Date.now(), sectionId: prefill.sectionId || '' };
      Object.assign(rec, { title, symptoms: parseTags($('#cnSyms', sh.el).value), nbId: $('#cnNb', sh.el).value || '', body: $('#cnBody', sh.el).value.trim() });
      await saveLink(rec);
      toast(entry ? 'Nota clinica aggiornata' : 'Nota clinica salvata');
      sh.close(true);
    };
    setTimeout(() => $(e.title || prefill.title ? '#cnSyms' : '#cnTitle', sh.el)?.focus(), 40);
  });
}
function showClinicNote(id) {
  const n = state.links.find(l => l.id === id);
  if (!n) return;
  const sec = secById(n.sectionId);
  const sh = openSheet(`
    <h2>${esc(n.title)}</h2>
    ${n.nbId && nbById(n.nbId) ? `<p class="sheet-sub">${esc(nbById(n.nbId).name)}</p>` : ''}
    ${(n.symptoms || []).length ? `<div class="tags sym-tags">${n.symptoms.map(s => `<span class="tag sym">${esc(s)}</span>`).join('')}</div>` : ''}
    ${n.body ? `<div class="notes cn-body">${renderMd(n.body)}</div>` : ''}
    ${sec ? `<p class="source">Dalla sezione <a href="#/sec/${sec.id}" data-g="go">${esc(sec.title)}</a></p>` : ''}
    <div class="modal-actions">
      <button class="btn ghost" type="button" data-g="edit">Modifica</button>
      <button class="btn primary" type="button" data-g="close">Chiudi</button>
    </div>`, { label: n.title });
  $('[data-g="close"]', sh.el).onclick = () => sh.close();
  const go2 = $('[data-g="go"]', sh.el);
  if (go2) go2.onclick = () => sh.close();
  $('[data-g="edit"]', sh.el).onclick = async () => { sh.close(); if (await clinicSheet(n)) route(); };
}
function viewClinic() {
  const notes = clinicalNotes();
  const symCount = new Map();
  notes.forEach(n => (n.symptoms || []).forEach(s => symCount.set(s, (symCount.get(s) || 0) + 1)));
  [...clinicSyms].forEach(s => { if (!symCount.has(s)) clinicSyms.delete(s); });
  const topSyms = [...symCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40);
  setView(`
    <header class="page-head">
      <div><h1>Note cliniche</h1><p class="lede">I quadri clinici di tutte le materie, cercabili per sintomo.</p></div>
      <button class="btn primary" data-act="add-cn">Nuova nota clinica</button>
    </header>
    ${notes.length ? `
      <input type="search" class="input search" id="cnQ" placeholder="Cerca un sintomo, un segno o una malattia" aria-label="Cerca nelle note cliniche" value="${esc(clinicQuery)}">
      ${topSyms.length ? `<div class="tag-cloud" id="cnSym" aria-label="Filtra per sintomo">${topSyms.map(([s, n]) => `<button type="button" class="tag sym ${clinicSyms.has(s) ? 'on' : ''}" data-sym="${esc(s)}" aria-pressed="${clinicSyms.has(s)}">${esc(s)} <small>${n}</small></button>`).join('')}</div>` : ''}
      <div id="cnList"></div>` : `
      <div class="empty"><p>Scrivi una nota da qui, oppure seleziona del testo mentre leggi una sezione e tocca “Nota clinica”.</p><button class="btn primary" data-act="add-cn">Nuova nota clinica</button></div>`}`);
  const draw = () => {
    const box = $('#cnList');
    if (!box) return;
    const tokens = foldAccents(clinicQuery).split(/[\s,]+/).filter(Boolean);
    const scored = notes.map(n => {
      const syms = (n.symptoms || []).map(foldAccents);
      if ([...clinicSyms].some(s => !(n.symptoms || []).includes(s))) return null;
      let score = 0;
      for (const t of tokens) {
        let best = 0;
        if (syms.some(s => s === t)) best = 4;
        else if (syms.some(s => s.includes(t))) best = 3;
        else if (foldAccents(n.title).includes(t)) best = 2;
        else if (foldAccents(n.body).includes(t)) best = 1;
        if (!best) return null;
        score += best;
      }
      return { n, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.n.title.localeCompare(b.n.title));
    box.innerHTML = scored.length ? `<ul class="list">${scored.map(({ n }) => `
      <li><button type="button" class="row" data-cn="${n.id}"><span class="row-main">
        <span class="row-title">${esc(n.title)}</span>
        ${n.nbId && nbById(n.nbId) ? `<span class="row-sub">${esc(nbById(n.nbId).name)}</span>` : ''}
        ${(n.symptoms || []).length ? `<span class="tags">${n.symptoms.map(s => `<span class="tag sym ${tokens.some(t => foldAccents(s).includes(t)) || clinicSyms.has(s) ? 'on' : ''}">${esc(s)}</span>`).join('')}</span>` : ''}
      </span></button></li>`).join('')}</ul>` : '<p class="hint">Nessuna nota corrisponde alla ricerca.</p>';
  };
  draw();
  $('#cnQ')?.addEventListener('input', e => { clinicQuery = e.target.value; draw(); });
  on('[data-sym]', 'click', e => {
    const s = e.currentTarget.dataset.sym;
    if (clinicSyms.has(s)) clinicSyms.delete(s); else clinicSyms.add(s);
    e.currentTarget.classList.toggle('on', clinicSyms.has(s));
    e.currentTarget.setAttribute('aria-pressed', clinicSyms.has(s));
    draw();
  });
  on('[data-act="add-cn"]', 'click', async () => { if (await clinicSheet()) route(); });
  $('#cnList')?.addEventListener('click', e => { const b = e.target.closest('[data-cn]'); if (b) showClinicNote(b.dataset.cn); });
}

/* ---------- Immagini negli appunti: mostra o nascondi, cloze sugli schemi ---------- */
function sectionMasks(sec) {
  const map = new Map();
  if (!/\(img:/.test(sec.md || '')) return map;
  const ids = new Set(imageRefs(sec.md));
  for (const c of state.cards) {
    if (c.type !== 'occlusion' || !c.io || !ids.has(c.io.imageId)) continue;
    const list = map.get(c.io.imageId) || [];
    for (const m of c.io.masks || []) if (!list.some(x => x.id === m.id)) list.push(m);
    map.set(c.io.imageId, list);
  }
  return map;
}
const ioMaskCount = sec => (S().showImages === false ? 0 : [...sectionMasks(sec).values()].reduce((a, l) => a + l.length, 0));
function prepareImages(article, sec, { cloze = false } = {}) {
  const imgs = article ? $$('img', article).filter(i => !i.closest('.html-embed, .img-box')) : [];
  if (!imgs.length) return { count: 0, masks: [] };
  const show = S().showImages !== false;
  article.classList.toggle('imgs-off', !show);
  const maskMap = cloze && show ? sectionMasks(sec) : new Map();
  const masks = [];
  imgs.forEach(img => {
    const box = document.createElement('span');
    box.className = 'img-box';
    img.replaceWith(box);
    const ph = document.createElement('button');
    ph.type = 'button';
    ph.className = 'img-ph';
    ph.setAttribute('aria-label', 'Immagine nascosta: tocca per vederla');
    ph.addEventListener('click', () => box.classList.add('img-on'));
    box.append(ph, img);
    const ms = maskMap.get(img.dataset.img);
    if (ms && ms.length) {
      box.classList.add('io', 'io-notes');
      ms.forEach(m => {
        const d = document.createElement('span');
        d.className = 'io-mask cz-io';
        d.setAttribute('style', posStyle(m));
        box.append(d);
        masks.push(d);
      });
    }
  });
  return { count: imgs.length, masks };
}
function bindImagesToggle(btn, count) {
  if (!btn) return;
  if (!count) { btn.hidden = true; return; }
  btn.hidden = false;
  btn.textContent = S().showImages === false ? 'Mostra immagini' : 'Nascondi immagini';
  btn.addEventListener('click', () => {
    S().showImages = S().showImages === false;
    Settings.save();
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
  });
}

/* =====================================================================
   v3.7: lettore PDF con evidenziatore, sottolineatura, penna, note,
   segnalibri, ricerca, miniature e pannello “Trascina” per le flashcard.
   Il file del PDF resta su questo dispositivo (archivio pdfblobs); le
   annotazioni stanno nel record del PDF (archivio pdfs).
   ===================================================================== */
const PDF_COLORS = [
  ['y', '#ffd84d', '#c27c00', 'Giallo'],
  ['g', '#7ee08a', '#15803d', 'Verde'],
  ['b', '#7cc7ff', '#1d4ed8', 'Azzurro'],
  ['p', '#ff9ad5', '#be185d', 'Rosa'],
  ['o', '#ffb066', '#c2410c', 'Arancio'],
  ['r', '#ff8a8a', '#dc2626', 'Rosso'],
  ['v', '#c4a7ff', '#7c3aed', 'Viola'],
  ['t', '#5eead4', '#0f766e', 'Turchese'],
  ['l', '#c6f36b', '#4d7c0f', 'Lime']
];
const PEN_INKS = [['#111111', 'Nero'], ['#1d4ed8', 'Blu'], ['#dc2626', 'Rosso'], ['#15803d', 'Verde']];
const pdfCol = (k, i = 1) => (PDF_COLORS.find(c => c[0] === k) || PDF_COLORS[0])[i];
const pdfById = id => state.pdfs.find(p => p.id === id);
const pdfsOf = secId => state.pdfs.filter(p => p.sectionId === secId).sort((a, b) => a.created - b.created);
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_BM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>';
const ICON_PANEL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M15 4v16"/></svg>';

async function savePdfMeta(meta) {
  meta.updated = Date.now();
  await DB.put('pdfs', meta);
  const i = state.pdfs.findIndex(x => x.id === meta.id);
  if (i < 0) state.pdfs.push(meta); else state.pdfs[i] = meta;
  scheduleSync();
}
async function deletePdf(id) {
  const meta = pdfById(id);
  if (meta) await removeRecords([{ store: 'pdfs', rec: meta }]);
  await DB.removeMany([['pdfblobs', id]]);
  localPdfIds.delete(id);
  await dropPdfText([id]);
}
function choosePdfFile() {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/pdf,.pdf';
    inp.addEventListener('change', () => resolve(inp.files && inp.files[0] ? inp.files[0] : null), { once: true });
    inp.click();
  });
}
// target: una sezione oppure { notebookId, sectionId } (sectionId vuoto = PDF di tutto il notebook)
async function storePdfFile(file, target) {
  const sec = target && 'md' in target ? target : null;
  const notebookId = sec ? sec.notebookId : target.notebookId;
  const sectionId = sec ? sec.id : (target.sectionId || null);
  await ensurePdfJs();
  let pages;
  try {
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    pages = doc.numPages;
    doc.destroy();
  } catch (e) {
    throw new Error(e && e.name === 'PasswordException' ? 'Il PDF è protetto da password.' : 'Non riesco ad aprire questo PDF.');
  }
  const now = Date.now();
  const meta = {
    id: uid(), notebookId, sectionId,
    name: (file.name || 'Documento').replace(/\.pdf$/i, ''), size: file.size || 0, pages,
    annots: [], bookmarks: [], drafts: [], lastPage: 1, zoom: 1, uploaded: false, created: now, updated: now
  };
  await DB.put('pdfblobs', { id: meta.id, blob: file });
  localPdfIds.add(meta.id);
  await savePdfMeta(meta);
  setTimeout(() => PdfCloud.uploadPending(), 300);
  setTimeout(() => PdfIndex.run(), 1500);
  return meta;
}
const fmtSize = b => (b > 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);

/* Scheda "PDF" della sezione */
// Livello di testo: compatibile con pdf.js 3 (renderTextLayer) e successivi (TextLayer)
async function renderTextLayerCompat(textContent, container, viewport) {
  const L = window.pdfjsLib;
  container.style.setProperty('--scale-factor', viewport.scale);
  container.style.setProperty('--user-unit', 1);
  container.style.setProperty('--total-scale-factor', viewport.scale);
  if (L.TextLayer) {
    await new L.TextLayer({ textContentSource: textContent, container, viewport }).render();
  } else {
    await L.renderTextLayer({ textContentSource: textContent, container, viewport, textDivs: [] }).promise;
  }
}
// Unisce i rettangoli della selezione riga per riga
function mergeRects(list) {
  const rs = list.map(r => [...r]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out = [];
  for (const r of rs) {
    const last = out.find(o => {
      const top = Math.max(o[1], r[1]);
      const bot = Math.min(o[1] + o[3], r[1] + r[3]);
      const sameLine = bot - top > Math.min(o[3], r[3]) * 0.5;
      const near = r[0] <= o[0] + o[2] + 4 && r[0] + r[2] >= o[0] - 4;
      return sameLine && near;
    });
    if (last) {
      const x1 = Math.min(last[0], r[0]);
      const y1 = Math.min(last[1], r[1]);
      const x2 = Math.max(last[0] + last[2], r[0] + r[2]);
      const y2 = Math.max(last[1] + last[3], r[1] + r[3]);
      last.splice(0, 4, x1, y1, x2 - x1, y2 - y1);
    } else out.push(r);
  }
  return out.map(r => r.map(v => +v.toFixed(2)));
}
const inkPath = pts => {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0][0]} ${pts[0][1]}l0.01 0`;
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = ((pts[i][0] + pts[i + 1][0]) / 2).toFixed(2);
    const my = ((pts[i][1] + pts[i + 1][1]) / 2).toFixed(2);
    d += `Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
  }
  const l = pts[pts.length - 1];
  return `${d}L${l[0]} ${l[1]}`;
};

function viewPdf(id, pageParam) {
  const meta = pdfById(id);
  if (!meta) return notFound('Questo PDF');
  meta.annots = meta.annots || [];
  meta.bookmarks = meta.bookmarks || [];
  meta.drafts = meta.drafts || [];
  const sec = secById(meta.sectionId);
  const back = sec ? `#/pdfs/${sec.id}` : nbById(meta.notebookId) ? `#/pdfs/nb/${meta.notebookId}` : '#/pdfs';
  const panelTabs = [['pages', 'Pagine'], ['marks', 'Segnalibri'], ['notes', 'Note'], ['search', 'Cerca'], ['drag', 'Trascina']];
  setView(`
    <div class="pdf-app" id="pdfApp">
      <header class="pdf-bar">
        <a class="btn ghost sm pdf-back" href="${back}" aria-label="Torna alla sezione">‹</a>
        <div class="pdf-title"><b>${esc(meta.name)}</b><small>${esc(sec ? sec.title : nbById(meta.notebookId)?.name || '')}</small></div>
        <label class="pdf-pageno"><span class="sr-only">Pagina</span><input class="input" id="pdfPage" type="number" inputmode="numeric" min="1" max="${meta.pages}" value="1"><span>/ ${meta.pages}</span></label>
        <button class="btn sm pdf-bm-btn" type="button" data-pdf="bookmark" aria-pressed="false" title="Segnalibro su questa pagina (B)">${ICON_BM}<span>Segnalibro</span></button>
        <button class="btn sm ghost pdf-panel-btn" type="button" data-pdf="panel" aria-expanded="false" title="Pannello laterale">${ICON_PANEL}<span>Pannello</span></button>
      </header>
      <div class="pdf-tools" role="toolbar" aria-label="Strumenti">
        <div class="seg sm pdf-seg" role="radiogroup" aria-label="Strumento">
          <button type="button" data-tool="select" role="radio">Seleziona</button>
          <button type="button" data-tool="pen" role="radio">Penna</button>
          <button type="button" data-tool="eraser" role="radio">Gomma</button>
          <button type="button" data-tool="note" role="radio">Nota</button>
          <button type="button" data-tool="occ" role="radio" title="Disegna riquadri che coprono etichette e valori">Occlusione</button>
        </div>
        <span class="pdf-pen-opts" hidden>
          ${PEN_INKS.map(([c, n]) => `<button type="button" class="rt-dot ink-dot" data-ink="${c}" style="--ink:${c}" aria-label="Penna ${n.toLowerCase()}" title="${n}"></button>`).join('')}
          <select class="input pdf-pen-size" aria-label="Spessore"><option value="1.2">Fine</option><option value="2">Media</option><option value="3.4">Spessa</option><option value="9">Evidenziatore</option></select>
        </span>
        <span class="pdf-zoom">
          <button type="button" class="btn sm ghost" data-pdf="zoom-" aria-label="Riduci">−</button>
          <button type="button" class="btn sm ghost" data-pdf="zoom-fit" id="pdfZoom" title="Adatta alla larghezza">100%</button>
          <button type="button" class="btn sm ghost" data-pdf="zoom+" aria-label="Ingrandisci">+</button>
        </span>
        <button type="button" class="btn sm ghost pdf-night-btn" data-pdf="night" aria-pressed="false" title="Pagine scure per leggere la sera">Notte</button>
        <button type="button" class="btn sm occ-quiz-btn" data-pdf="occ-quiz" aria-pressed="false" hidden>Ripassa le occlusioni</button>
        <button type="button" class="btn sm ghost" data-pdf="undo" title="Annulla l’ultima annotazione (Ctrl+Z)">Annulla</button>
      </div>
      <div class="pdf-main">
        <div class="pdf-scroll" id="pdfScroll" tabindex="-1"><div class="pdf-pages" id="pdfPages"><p class="hint pdf-loading">Apro il PDF…</p></div></div>
        <aside class="pdf-panel" id="pdfPanel" hidden aria-label="Pannello del PDF">
          <div class="pdf-tabs" role="tablist">
            ${panelTabs.map(([k, l]) => `<button type="button" role="tab" data-ptab="${k}">${l}</button>`).join('')}
            <button type="button" class="btn sm ghost pdf-panel-x" data-pdf="panel" aria-label="Chiudi il pannello">✕</button>
          </div>
          <div class="pdf-panel-body" id="pdfPanelBody"></div>
        </aside>
      </div>
    </div>`);

  const app = $('#pdfApp');
  const scroller = $('#pdfScroll');
  const pagesEl = $('#pdfPages');
  const panel = $('#pdfPanel');
  const panelBody = $('#pdfPanelBody');
  document.documentElement.classList.add('pdf-open');
  const R = {
    doc: null, base: null, sizes: [], scale: 1, zoom: meta.zoom || 1, cur: 1,
    occQuiz: false, occOpen: new Set(),
    tool: 'select', color: S().pdfColor || 'y', ink: S().pdfInk || '#1d4ed8', inkW: +(S().pdfInkW || 2),
    undo: [], rendered: new Map(), textCache: new Map(), hit: null, penSeen: false,
    destroyed: false, tab: S().pdfPanel || '', searchToken: 0, outline: null, thumbIo: null
  };

  // ---------- salvataggio
  let saveTimer = null;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => savePdfMeta(meta), 700); };
  const saveNow = () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; savePdfMeta(meta); } };

  // ---------- geometria delle pagine
  const pageEl = n => pagesEl.querySelector(`.pdf-page[data-p="${n}"]`);
  const sizeOf = n => R.sizes[n] || R.base;
  const fitScale = () => {
    const avail = Math.max(200, scroller.clientWidth - (window.innerWidth < 600 ? 12 : 40));
    return Math.min(avail / R.base.width, 2.2);
  };
  const applySizes = () => {
    R.scale = fitScale() * R.zoom;
    $$('.pdf-page', pagesEl).forEach(el => {
      const sz = sizeOf(+el.dataset.p);
      el.style.width = `${Math.round(sz.width * R.scale)}px`;
      el.style.height = `${Math.round(sz.height * R.scale)}px`;
    });
    $('#pdfZoom').textContent = `${Math.round(R.zoom * 100)}%`;
  };
  const pageTop = el => el.offsetTop;
  const findCurrent = () => {
    const els = pagesEl.children;
    const y = scroller.scrollTop + scroller.clientHeight * 0.35;
    let lo = 0, hi = els.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pageTop(els[mid]) <= y) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans + 1;
  };
  const goTo = (n, { flash = false } = {}) => {
    n = Math.max(1, Math.min(meta.pages, Math.round(n) || 1));
    const el = pageEl(n);
    if (!el) return;
    scroller.scrollTop = pageTop(el) - 8;
    if (flash) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    onScroll();
  };

  // ---------- disegno delle pagine (solo quelle vicine allo schermo)
  const renderPage = async n => {
    const el = pageEl(n);
    if (!el || !R.doc) return;
    const key = R.scale.toFixed(4);
    if (el.dataset.scale === key) return;
    el.dataset.scale = key;
    let page;
    try { page = await R.doc.getPage(n); } catch { return; }
    if (R.destroyed || el.dataset.scale !== key) return;
    const base = page.getViewport({ scale: 1 });
    if (!R.sizes[n] || Math.abs(R.sizes[n].width - base.width) > 0.5 || Math.abs(R.sizes[n].height - base.height) > 0.5) {
      R.sizes[n] = { width: base.width, height: base.height };
      el.style.width = `${Math.round(base.width * R.scale)}px`;
      el.style.height = `${Math.round(base.height * R.scale)}px`;
    }
    const vp = page.getViewport({ scale: R.scale });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-canvas';
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    const task = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
    try { await task.promise; } catch { return; }
    if (R.destroyed || el.dataset.scale !== key) return;
    const tl = document.createElement('div');
    tl.className = 'textLayer';
    try {
      const tc = await page.getTextContent();
      if (!R.textCache.has(n)) R.textCache.set(n, tc.items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join(''));
      await renderTextLayerCompat(tc, tl, vp);
    } catch { /* pagina senza testo */ }
    if (R.destroyed || el.dataset.scale !== key) return;
    el.querySelectorAll('.pdf-canvas, .textLayer').forEach(x => x.remove());
    el.prepend(canvas);
    el.append(tl);
    el.classList.add('ready');
    drawAnnots(n);
    applyHit(n);
    R.rendered.set(n, true);
  };
  const releasePage = n => {
    const el = pageEl(n);
    if (!el) return;
    el.querySelectorAll('.pdf-canvas, .textLayer').forEach(x => x.remove());
    el.classList.remove('ready');
    delete el.dataset.scale;
    R.rendered.delete(n);
  };
  const renderAround = () => {
    if (!R.doc) return;
    const first = findCurrent();
    const want = new Set();
    for (let n = first - 1; n <= meta.pages; n++) {
      const el = pageEl(n);
      if (!el) continue;
      if (pageTop(el) > scroller.scrollTop + scroller.clientHeight * 2.2) break;
      want.add(n);
    }
    want.forEach(n => renderPage(n));
    [...R.rendered.keys()].forEach(n => { if (Math.abs(n - first) > 6 && !want.has(n)) releasePage(n); });
  };

  // ---------- annotazioni
  const drawAnnots = n => {
    const el = pageEl(n);
    if (!el) return;
    const sz = sizeOf(n);
    let svg = el.querySelector('svg.pdf-ann');
    if (!svg) {
      svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'pdf-ann');
      svg.setAttribute('preserveAspectRatio', 'none');
      el.append(svg);
    }
    svg.setAttribute('viewBox', `0 0 ${sz.width} ${sz.height}`);
    const anns = meta.annots.filter(a => a.page === n);
    svg.innerHTML = anns.map(a => {
      if (a.type === 'hl') return `<g class="ann-hl" data-id="${a.id}">${a.rects.map(r => `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="1.5" fill="${pdfCol(a.color)}"/>`).join('')}</g>`;
      if (a.type === 'ul') return `<g class="ann-ul" data-id="${a.id}">${a.rects.map(r => `<rect x="${r[0]}" y="${(r[1] + r[3] - 1.6).toFixed(2)}" width="${r[2]}" height="1.6" fill="${pdfCol(a.color, 2)}"/>`).join('')}</g>`;
      if (a.type === 'ink') return `<path class="ann-ink ${a.w >= 6 ? 'marker' : ''}" data-id="${a.id}" d="${inkPath(a.pts)}" stroke="${esc(a.color)}" stroke-width="${a.w}"/>`;
      return '';
    }).join('');
    let occ = el.querySelector('svg.pdf-occ');
    if (!occ) {
      occ = document.createElementNS(SVG_NS, 'svg');
      occ.setAttribute('class', 'pdf-occ');
      occ.setAttribute('preserveAspectRatio', 'none');
      el.append(occ);
    }
    occ.setAttribute('viewBox', `0 0 ${sz.width} ${sz.height}`);
    occ.innerHTML = anns.filter(a => a.type === 'occ').map(a => {
      const r = a.rects[0];
      return `<rect class="ann-occ ${R.occOpen.has(a.id) ? 'open' : ''}" data-id="${a.id}" x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="2"/>`;
    }).join('');
    refreshOccBtn();
    let pins = el.querySelector('.pdf-pins');
    if (!pins) { pins = document.createElement('div'); pins.className = 'pdf-pins'; el.append(pins); }
    pins.innerHTML = anns.filter(a => a.type === 'note' || (a.note && a.rects && a.type !== 'occ')).map(a => {
      const pos = a.type === 'note' ? [a.x, a.y] : (() => { const r = a.rects[a.rects.length - 1]; return [r[0] + r[2], r[1]]; })();
      return `<button type="button" class="pdf-pin" data-ann="${a.id}" style="left:${(pos[0] / sz.width * 100).toFixed(3)}%;top:${(pos[1] / sz.height * 100).toFixed(3)}%" aria-label="Nota: ${esc((a.note || '').slice(0, 60))}">✎</button>`;
    }).join('');
    el.classList.toggle('bm', meta.bookmarks.some(b => b.page === n));
  };
  const redrawPages = pages => [...new Set(pages)].forEach(drawAnnots);
  function refreshOccBtn() {
    const b = $('[data-pdf="occ-quiz"]', app);
    if (!b) return;
    const has = meta.annots.some(a => a.type === 'occ');
    b.hidden = !has && !R.occQuiz;
    b.setAttribute('aria-pressed', R.occQuiz);
    b.classList.toggle('primary', R.occQuiz);
    b.textContent = R.occQuiz ? 'Fine ripasso' : 'Ripassa le occlusioni';
  }
  const setOccQuiz = v => {
    R.occQuiz = v;
    R.occOpen.clear();
    app.classList.toggle('occ-quiz', v);
    if (v && R.tool !== 'select') setTool('select');
    redrawPages(meta.annots.filter(a => a.type === 'occ').map(a => a.page));
    refreshOccBtn();
    if (v) toast('Tocca un riquadro per scoprirlo, toccalo di nuovo per coprirlo');
  };
  // Flashcard di image occlusion da una pagina: la pagina diventa un’immagine
  const occCards = async n => {
    const occs = meta.annots.filter(a => a.page === n && a.type === 'occ' && !a.card);
    if (!occs.length) { toast('Su questa pagina non ci sono occlusioni nuove'); return; }
    try {
      const page = await R.doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, 1400 / base.width) });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise(res => c.toBlob(res, 'image/webp', 0.85));
      const im = await saveImage({ blob, w: c.width, h: c.height }, meta.notebookId);
      const group = uid();
      const masks = occs.map(a => { const r = a.rects[0]; return { id: a.id, x: r[0] / base.width, y: r[1] / base.height, w: r[2] / base.width, h: r[3] / base.height }; });
      const tags = tagsOf(secById(meta.sectionId));
      const cards = occs.map(a => {
        const card = newCard(meta.notebookId, { front: '', back: a.note || '', sectionId: meta.sectionId });
        card.type = 'occlusion';
        card.io = { group, imageId: im.id, masks, maskId: a.id };
        card.pdf = { id: meta.id, page: n };
        if (tags.length) card.tags = [...tags];
        a.card = group;
        return card;
      });
      await saveCards(cards);
      saveSoon();
      toast(cards.length === 1 ? 'Flashcard creata' : `${cards.length} flashcard create, una per riquadro`);
    } catch (err) {
      toast('Non riesco a creare le flashcard da questa pagina', 'err');
    }
  };
  const addAnnots = list => {
    if (!list.length) return;
    meta.annots.push(...list);
    R.undo.push({ add: list.map(a => a.id) });
    saveSoon();
    redrawPages(list.map(a => a.page));
    refreshPanel('notes');
  };
  const removeAnnots = ids => {
    const gone = meta.annots.filter(a => ids.includes(a.id));
    if (!gone.length) return;
    meta.annots = meta.annots.filter(a => !ids.includes(a.id));
    markGone(meta, ids);
    R.undo.push({ del: gone });
    saveSoon();
    redrawPages(gone.map(a => a.page));
    refreshPanel('notes');
  };
  const undo = () => {
    const u = R.undo.pop();
    if (!u) { toast('Niente da annullare'); return; }
    if (u.add) {
      const gone = meta.annots.filter(a => u.add.includes(a.id));
      meta.annots = meta.annots.filter(a => !u.add.includes(a.id));
      markGone(meta, u.add);
      redrawPages(gone.map(a => a.page));
    } else if (u.del) {
      meta.annots.push(...u.del);
      unGone(meta, u.del.map(a => a.id));
      redrawPages(u.del.map(a => a.page));
    }
    saveSoon();
    refreshPanel('notes');
  };

  // ---------- selezione del testo
  const readSelection = () => {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!pagesEl.contains(range.commonAncestorContainer)) return null;
    const text = sel.toString().replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    if (!text) return null;
    const pgs = $$('.pdf-page.ready', pagesEl).filter(p => range.intersectsNode(p)).map(p => ({ n: +p.dataset.p, r: p.getBoundingClientRect() }));
    const byPage = new Map();
    for (const cr of range.getClientRects()) {
      if (cr.width < 1 || cr.height < 2) continue;
      const cx = cr.left + cr.width / 2;
      const cy = cr.top + cr.height / 2;
      const pg = pgs.find(({ r }) => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom);
      if (!pg) continue;
      const sz = sizeOf(pg.n);
      const k = sz.width / pg.r.width;
      if (!byPage.has(pg.n)) byPage.set(pg.n, []);
      byPage.get(pg.n).push([(cr.left - pg.r.left) * k, (cr.top - pg.r.top) * k, cr.width * k, cr.height * k]);
    }
    if (!byPage.size) return null;
    for (const [n, list] of byPage) byPage.set(n, mergeRects(list));
    return { text, byPage, firstPage: Math.min(...byPage.keys()) };
  };
  const selHtml = () => `
    ${PDF_COLORS.map(([k, , , n]) => `<button type="button" class="rt-dot pdf-hl-dot" data-ps="hl" data-c="${k}" style="--dot:${pdfCol(k)}" aria-label="Evidenzia in ${n.toLowerCase()}" title="Evidenzia in ${n.toLowerCase()}"></button>`).join('')}
    <button type="button" class="rt-btn rt-u" data-ps="ul" title="Sottolinea" aria-label="Sottolinea">S</button>
    <button type="button" class="rt-btn" data-ps="note">Nota</button>
    <button type="button" class="rt-btn rt-drag" data-ps="drag" title="Aggiunge il testo al pannello Trascina">Trascina</button>
    <button type="button" class="rt-btn rt-card" data-ps="card">Flashcard</button>
    <button type="button" class="rt-btn" data-ps="copy">Copia</button>`;
  const bar = document.createElement('div');
  bar.className = 'sel-bar rt-bar pdf-selbar';
  bar.hidden = true;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Strumenti per il testo selezionato');
  bar.innerHTML = selHtml();
  const menu = document.createElement('div');
  menu.className = 'rt-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.innerHTML = selHtml();
  document.body.append(bar, menu);
  let lastSel = null;
  let hideTimer = null;
  const onSel = () => {
    if (R.tool !== 'select') return;
    const s = readSelection();
    if (s) { clearTimeout(hideTimer); lastSel = s; bar.hidden = false; }
    else if (!bar.hidden) { clearTimeout(hideTimer); hideTimer = setTimeout(() => { bar.hidden = true; }, 600); }
  };
  const newAnnotsFromSel = (s, type, color) => [...s.byPage.entries()].map(([n, rects], i) => ({
    id: uid(), type, color, page: n, rects, text: i === 0 ? s.text.slice(0, 2000) : '', created: Date.now()
  }));
  const addDraft = (text, page) => {
    meta.drafts.push({ id: uid(), front: '', back: text.slice(0, 4000), page: page || R.cur });
    saveSoon();
    openPanel('drag');
    refreshPanel('drag');
  };
  const selAction = async kind => {
    const s = lastSel;
    bar.hidden = true;
    menu.hidden = true;
    if (!s) return;
    if (kind !== 'copy') document.getSelection()?.removeAllRanges();
    if (kind === 'hl' || kind === 'ul') { addAnnots(newAnnotsFromSel(s, kind, R.color)); return; }
    if (kind === 'copy') {
      try { await navigator.clipboard.writeText(s.text); toast('Testo copiato'); } catch { toast('Copia non riuscita', 'err'); }
      return;
    }
    if (kind === 'drag') { addDraft(s.text, s.firstPage); toast('Aggiunto a Trascina'); return; }
    if (kind === 'card') {
      const card = await openCardSheet({ back: s.text, sectionId: meta.sectionId, notebookId: meta.notebookId });
      if (card) { card.pdf = { id: meta.id, page: s.firstPage }; await saveCard(card); }
      return;
    }
    if (kind === 'note') {
      const rects = s.byPage.get(s.firstPage);
      const r = rects[rects.length - 1];
      const text = await noteSheet('', s.text);
      if (text === null) return;
      addAnnots([{ id: uid(), type: 'note', page: s.firstPage, x: r[0] + r[2], y: r[1], note: text, text: s.text.slice(0, 2000), created: Date.now() }]);
    }
  };
  [bar, menu].forEach(el => {
    el.addEventListener('pointerdown', e => e.preventDefault());
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-ps]');
      if (!b) return;
      if (b.dataset.c) { R.color = b.dataset.c; S().pdfColor = R.color; Settings.save(); }
      selAction(b.dataset.ps);
    });
  });
  const onContext = e => {
    if (R.tool !== 'select') return;
    const s = readSelection();
    if (!s) return;
    e.preventDefault();
    lastSel = s;
    bar.hidden = true;
    menu.hidden = false;
    const w = menu.offsetWidth || 300;
    const h = menu.offsetHeight || 60;
    menu.style.left = `${Math.max(8, Math.min(e.clientX, window.innerWidth - w - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(e.clientY, window.innerHeight - h - 8))}px`;
  };
  const onDocDown = e => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; };

  // ---------- finestre per note e annotazioni
  function noteSheet(value = '', quote = '') {
    return new Promise(resolve => {
      const sh = openSheet(`
        <h2>Nota</h2>
        ${quote ? `<blockquote class="pdf-quote">${esc(quote.slice(0, 400))}</blockquote>` : ''}
        <textarea class="input card-ta" id="pnText" rows="4" placeholder="Scrivi la nota">${esc(value)}</textarea>
        <div class="modal-actions">
          <button class="btn ghost" type="button" data-pn="no">Annulla</button>
          <button class="btn primary" type="button" data-pn="ok">Salva</button>
        </div>`, { label: 'Nota', onClose: resolve });
      $('[data-pn="no"]', sh.el).onclick = () => sh.close(null);
      $('[data-pn="ok"]', sh.el).onclick = () => sh.close($('#pnText', sh.el).value.trim());
      setTimeout(() => $('#pnText', sh.el)?.focus(), 40);
    });
  }
  const annotSheet = a => {
    const isMark = a.type === 'hl' || a.type === 'ul';
    const isOcc = a.type === 'occ';
    const sh = openSheet(`
      <h2>${a.type === 'hl' ? 'Evidenziazione' : a.type === 'ul' ? 'Sottolineatura' : a.type === 'ink' ? 'Tratto a penna' : isOcc ? 'Occlusione' : 'Nota'}, pagina ${a.page}</h2>
      ${isOcc ? `<p class="sheet-sub">${a.card ? 'Ha già la sua flashcard.' : 'Puoi trasformare le occlusioni di questa pagina in flashcard da ripassare con le altre.'}</p>` : ''}
      ${a.text ? `<blockquote class="pdf-quote">${esc(a.text.slice(0, 500))}</blockquote>` : ''}
      ${isMark ? `
        <div class="pdf-ann-colors" role="group" aria-label="Colore">
          ${PDF_COLORS.map(([k, , , n]) => `<button type="button" class="rt-dot pdf-hl-dot ${a.color === k ? 'on' : ''}" data-ac="${k}" style="--dot:${pdfCol(k)}" aria-label="${n}" aria-pressed="${a.color === k}"></button>`).join('')}
          <button type="button" class="btn sm ghost" data-aa="type">${a.type === 'hl' ? 'Trasforma in sottolineatura' : 'Trasforma in evidenziazione'}</button>
        </div>` : ''}
      ${a.type !== 'ink' ? `<label class="field"><span>${isOcc ? 'Cosa c’è sotto (facoltativo, diventa la risposta della flashcard)' : 'Nota'}</span><textarea class="input card-ta" id="anNote" rows="3" placeholder="Facoltativa">${esc(a.note || '')}</textarea></label>` : ''}
      <div class="modal-actions">
        <button class="btn ghost danger" type="button" data-aa="del">Elimina</button>
        ${a.text ? '<button class="btn ghost" type="button" data-aa="drag">Trascina</button><button class="btn ghost" type="button" data-aa="card">Flashcard</button>' : ''}
        ${isOcc ? '<button class="btn ghost" type="button" data-aa="occcards">Flashcard dalla pagina</button>' : ''}
        <button class="btn primary" type="button" data-aa="ok">Fatto</button>
      </div>`, { label: 'Annotazione', onClose: () => keepNote() });
    const keepNote = () => { const t = $('#anNote', sh.el); if (t && meta.annots.includes(a) && t.value.trim() !== (a.note || '')) { a.note = t.value.trim(); saveSoon(); drawAnnots(a.page); refreshPanel('notes'); } };
    sh.el.addEventListener('click', async e => {
      const c = e.target.closest('[data-ac]');
      if (c) {
        a.color = c.dataset.ac;
        $$('[data-ac]', sh.el).forEach(x => { x.classList.toggle('on', x === c); x.setAttribute('aria-pressed', x === c); });
        saveSoon(); drawAnnots(a.page); refreshPanel('notes');
        return;
      }
      const b = e.target.closest('[data-aa]');
      if (!b) return;
      const act = b.dataset.aa;
      if (act === 'type') { a.type = a.type === 'hl' ? 'ul' : 'hl'; saveSoon(); drawAnnots(a.page); refreshPanel('notes'); b.textContent = a.type === 'hl' ? 'Trasforma in sottolineatura' : 'Trasforma in evidenziazione'; return; }
      if (act === 'del') { sh.close(); removeAnnots([a.id]); toast('Annotazione eliminata', '', { label: 'Annulla', fn: undo }); return; }
      keepNote();
      sh.close();
      if (act === 'drag') { addDraft(a.text, a.page); toast('Aggiunto a Trascina'); }
      if (act === 'occcards') await occCards(a.page);
      if (act === 'card') {
        const card = await openCardSheet({ back: a.text, sectionId: meta.sectionId, notebookId: meta.notebookId });
        if (card) { card.pdf = { id: meta.id, page: a.page }; await saveCard(card); }
      }
    });
  };
  const pointInPage = (el, e) => {
    const r = el.getBoundingClientRect();
    const sz = sizeOf(+el.dataset.p);
    return [+((e.clientX - r.left) / r.width * sz.width).toFixed(2), +((e.clientY - r.top) / r.height * sz.height).toFixed(2)];
  };
  const hitAnnot = (n, x, y) => {
    const anns = meta.annots.filter(a => a.page === n && a.rects);
    for (let i = anns.length - 1; i >= 0; i--) {
      if (anns[i].rects.some(r => x >= r[0] - 1 && x <= r[0] + r[2] + 1 && y >= r[1] - 1 && y <= r[1] + r[3] + 2)) return anns[i];
    }
    return null;
  };

  // ---------- penna, gomma, note
  let ink = null;
  let pan = null;
  const setTool = t => {
    R.tool = t;
    app.dataset.tool = t;
    $$('button[data-tool]', app).forEach(b => { b.setAttribute('aria-checked', b.dataset.tool === t); b.setAttribute('aria-selected', b.dataset.tool === t); });
    $('.pdf-pen-opts', app).hidden = t !== 'pen';
    if (t !== 'select') { bar.hidden = true; document.getSelection()?.removeAllRanges(); }
  };
  const eraseAt = e => {
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const g = hit && hit.closest && hit.closest('svg.pdf-ann [data-id], svg.pdf-occ [data-id]');
    if (g) removeAnnots([g.dataset.id]);
  };
  pagesEl.addEventListener('pointerdown', e => {
    const el = e.target.closest('.pdf-page');
    if (!el || e.target.closest('.pdf-pin')) return;
    if (e.pointerType === 'pen') R.penSeen = true;
    if (R.tool === 'occ') {
      if (e.pointerType === 'touch' && R.penSeen) { pan = { id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
      if (e.button > 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const svg = el.querySelector('svg.pdf-occ') || (drawAnnots(+el.dataset.p), el.querySelector('svg.pdf-occ'));
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('class', 'ann-occ live');
      svg.append(r);
      ink = { id: e.pointerId, el, occ: r, p0: pointInPage(el, e) };
      return;
    }
    if (R.tool === 'pen' || R.tool === 'eraser') {
      if (e.pointerType === 'touch' && R.penSeen) { pan = { id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
      if (e.button > 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      if (R.tool === 'eraser') { ink = { eraser: true, id: e.pointerId }; eraseAt(e); return; }
      const svg = el.querySelector('svg.pdf-ann') || (drawAnnots(+el.dataset.p), el.querySelector('svg.pdf-ann'));
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', `ann-ink live ${R.inkW >= 6 ? 'marker' : ''}`);
      path.setAttribute('stroke', R.ink);
      path.setAttribute('stroke-width', R.inkW);
      svg.append(path);
      ink = { id: e.pointerId, el, path, pts: [pointInPage(el, e)] };
      path.setAttribute('d', inkPath(ink.pts));
    }
  });
  pagesEl.addEventListener('pointermove', e => {
    if (pan && e.pointerId === pan.id) { scroller.scrollBy(pan.x - e.clientX, pan.y - e.clientY); pan.x = e.clientX; pan.y = e.clientY; return; }
    if (!ink || e.pointerId !== ink.id) return;
    if (ink.eraser) { eraseAt(e); return; }
    if (ink.occ) {
      const [x, y] = pointInPage(ink.el, e);
      const [x0, y0] = ink.p0;
      ink.box = [Math.min(x, x0), Math.min(y, y0), Math.abs(x - x0), Math.abs(y - y0)].map(v => +v.toFixed(2));
      ['x', 'y', 'width', 'height'].forEach((k, i) => ink.occ.setAttribute(k, ink.box[i]));
      return;
    }
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs) {
      const p = pointInPage(ink.el, ev);
      const l = ink.pts[ink.pts.length - 1];
      if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.7) ink.pts.push(p);
    }
    ink.path.setAttribute('d', inkPath(ink.pts));
  });
  const endInk = e => {
    if (pan && e.pointerId === pan.id) { pan = null; return; }
    if (!ink || e.pointerId !== ink.id) return;
    const cur = ink;
    ink = null;
    if (cur.eraser) return;
    if (cur.occ) {
      cur.occ.remove();
      if (cur.box && cur.box[2] > 6 && cur.box[3] > 4) addAnnots([{ id: uid(), type: 'occ', page: +cur.el.dataset.p, rects: [cur.box], created: Date.now() }]);
      return;
    }
    cur.path.remove();
    addAnnots([{ id: uid(), type: 'ink', page: +cur.el.dataset.p, color: R.ink, w: R.inkW, pts: cur.pts, created: Date.now() }]);
  };
  pagesEl.addEventListener('pointerup', endInk);
  pagesEl.addEventListener('pointercancel', endInk);
  pagesEl.addEventListener('click', async e => {
    const pin = e.target.closest('.pdf-pin');
    if (pin) { const a = meta.annots.find(x => x.id === pin.dataset.ann); if (a) annotSheet(a); return; }
    const el = e.target.closest('.pdf-page');
    if (!el) return;
    const n = +el.dataset.p;
    const [x, y] = pointInPage(el, e);
    if (R.tool === 'note') {
      const text = await noteSheet('');
      if (text) addAnnots([{ id: uid(), type: 'note', page: n, x, y, note: text, created: Date.now() }]);
      return;
    }
    if (R.tool === 'select') {
      const sel = document.getSelection();
      if (sel && !sel.isCollapsed) return;
      const occA = meta.annots.filter(o => o.page === n && o.type === 'occ').reverse().find(o => { const r = o.rects[0]; return x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]; });
      if (R.occQuiz) {
        if (occA) { if (R.occOpen.has(occA.id)) R.occOpen.delete(occA.id); else R.occOpen.add(occA.id); drawAnnots(n); }
        return;
      }
      const a = occA || hitAnnot(n, x, y);
      if (a) annotSheet(a);
    }
  });

  // ---------- segnalibri
  const bookmarkTitle = async n => {
    try {
      let t = R.textCache.get(n);
      if (t == null) { const p = await R.doc.getPage(n); const tc = await p.getTextContent(); t = tc.items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join(''); R.textCache.set(n, t); }
      const line = t.split('\n').map(x => x.replace(/\s+/g, ' ').trim()).find(x => x.length > 3 && !/^\d+$/.test(x));
      return line ? line.slice(0, 70) : `Pagina ${n}`;
    } catch { return `Pagina ${n}`; }
  };
  const refreshBm = () => {
    const has = meta.bookmarks.some(b => b.page === R.cur);
    const btn = $('[data-pdf="bookmark"]', app);
    btn.setAttribute('aria-pressed', has);
    btn.classList.toggle('on', has);
    btn.querySelector('span').textContent = has ? 'Segnato' : 'Segnalibro';
    $$('.pdf-page', pagesEl).forEach(el => el.classList.toggle('bm', meta.bookmarks.some(b => b.page === +el.dataset.p)));
    refreshPanel('marks');
    refreshPanel('pages');
  };
  const renameBookmark = async b => {
    const t = await modal({ title: 'Nome del segnalibro', input: true, value: b.title, confirm: 'Salva' });
    if (!t) return;
    b.title = t;
    saveSoon();
    refreshPanel('marks');
  };
  const toggleBookmark = async (n = R.cur) => {
    const ex = meta.bookmarks.find(b => b.page === n);
    if (ex) {
      meta.bookmarks = meta.bookmarks.filter(b => b !== ex);
      markGone(meta, [ex.id]);
      saveSoon();
      refreshBm();
      toast(`Segnalibro di pagina ${n} tolto`, '', { label: 'Annulla', fn: () => { unGone(meta, [ex.id]); meta.bookmarks.push(ex); meta.bookmarks.sort((a, b) => a.page - b.page); saveSoon(); refreshBm(); } });
      return;
    }
    const b = { id: uid(), page: n, title: await bookmarkTitle(n), created: Date.now() };
    meta.bookmarks.push(b);
    meta.bookmarks.sort((x, y) => x.page - y.page);
    saveSoon();
    refreshBm();
    toast(`Segnalibro a pagina ${n}`, '', { label: 'Rinomina', fn: () => renameBookmark(b) });
  };

  // ---------- pannello laterale
  const openPanel = tab => {
    R.tab = tab || R.tab || 'marks';
    S().pdfPanel = R.tab;
    Settings.save();
    panel.hidden = false;
    app.classList.add('panel-open');
    $('[data-pdf="panel"]', app).setAttribute('aria-expanded', 'true');
    $$('[data-ptab]', panel).forEach(b => b.setAttribute('aria-selected', b.dataset.ptab === R.tab));
    drawPanel();
    if (R.doc && window.innerWidth >= 900) zoomTo(R.zoom);
  };
  const closePanel = () => {
    panel.hidden = true;
    app.classList.remove('panel-open');
    $('[data-pdf="panel"]', app).setAttribute('aria-expanded', 'false');
    S().pdfPanel = '';
    Settings.save();
    R.thumbIo?.disconnect();
    if (R.doc && window.innerWidth >= 900) zoomTo(R.zoom);
  };
  const refreshPanel = tab => { if (!panel.hidden && R.tab === tab) drawPanel(); };
  const drawPanel = () => {
    R.thumbIo?.disconnect();
    if (!R.doc && R.tab !== 'drag' && R.tab !== 'marks' && R.tab !== 'notes') { panelBody.innerHTML = '<p class="hint">Apro il PDF…</p>'; return; }
    ({ pages: drawThumbs, marks: drawMarks, notes: drawNotes, search: drawSearch, drag: drawDrag }[R.tab] || drawMarks)();
  };

  function drawMarks() {
    panelBody.innerHTML = `
      <button class="btn sm block" type="button" data-pm="add">${meta.bookmarks.some(b => b.page === R.cur) ? `Togli il segnalibro da pagina ${R.cur}` : `Segnalibro su pagina ${R.cur}`}</button>
      ${meta.bookmarks.length ? `<ul class="pdf-plist">${meta.bookmarks.map(b => `
        <li><button type="button" class="pdf-pitem ${b.page === R.cur ? 'cur' : ''}" data-go="${b.page}">
          <span class="pdf-bm-ic">${ICON_BM}</span><span class="pdf-pitem-t">${esc(b.title)}</span><span class="pdf-pitem-p">p. ${b.page}</span></button>
          <button type="button" class="btn sm ghost" data-bmren="${b.id}" aria-label="Rinomina">✎</button>
          <button type="button" class="btn sm ghost" data-bmdel="${b.id}" aria-label="Elimina">✕</button></li>`).join('')}</ul>`
        : '<p class="hint">Nessun segnalibro. Toccando “Segnalibro” in alto, o premendo B, segni la pagina che stai leggendo.</p>'}
      <h3 class="sub3">Indice del PDF</h3>
      <div id="pdfOutline"><p class="hint">Carico l’indice…</p></div>`;
    drawOutline();
  }
  async function drawOutline() {
    const box = $('#pdfOutline', panelBody);
    if (!box || !R.doc) return;
    if (!R.outline) {
      try { R.outline = (await R.doc.getOutline()) || []; } catch { R.outline = []; }
    }
    if (!box.isConnected) return;
    const flat = [];
    const walk = (items, d) => items.forEach(it => { if (flat.length < 400) { flat.push({ it, d }); if (d < 2 && it.items?.length) walk(it.items, d + 1); } });
    walk(R.outline, 0);
    box.innerHTML = flat.length
      ? `<ul class="pdf-plist outline">${flat.map(({ it, d }, i) => `<li style="--d:${d}"><button type="button" class="pdf-pitem" data-ol="${i}"><span class="pdf-pitem-t">${esc(String(it.title || '').trim() || 'Senza titolo')}</span></button></li>`).join('')}</ul>`
      : '<p class="hint">Questo PDF non ha un indice.</p>';
    box.onclick = async e => {
      const b = e.target.closest('[data-ol]');
      if (!b) return;
      try {
        let dest = flat[+b.dataset.ol].it.dest;
        if (typeof dest === 'string') dest = await R.doc.getDestination(dest);
        if (!Array.isArray(dest) || !dest[0]) return;
        const ref = dest[0];
        const idx = typeof ref === 'number' ? ref : await R.doc.getPageIndex(ref);
        goTo(idx + 1, { flash: true });
        if (window.innerWidth < 900) closePanel();
      } catch { toast('Questa voce non porta a una pagina'); }
    };
  }
  function drawNotes() {
    const list = [...meta.annots].filter(a => a.type !== 'ink').sort((a, b) => a.page - b.page || (a.rects?.[0]?.[1] ?? a.y ?? 0) - (b.rects?.[0]?.[1] ?? b.y ?? 0));
    const inks = meta.annots.filter(a => a.type === 'ink').length;
    panelBody.innerHTML = list.length || inks ? `
      <ul class="pdf-plist">${list.map(a => `
        <li><button type="button" class="pdf-pitem note-item" data-go="${a.page}" data-annid="${a.id}">
          <span class="pdf-swatch ${a.type}" style="--dot:${a.type === 'note' ? 'var(--accent)' : a.type === 'occ' ? '#f5cf86' : pdfCol(a.color, a.type === 'ul' ? 2 : 1)}"></span>
          <span class="pdf-pitem-t">${a.type === 'occ' ? 'Occlusione' : ''}${a.text ? esc(a.text.slice(0, 160)) : ''}${a.note ? `<em>${esc(a.note.slice(0, 160))}</em>` : ''}${!a.text && !a.note && a.type !== 'occ' ? '<em>Senza testo</em>' : ''}</span>
          <span class="pdf-pitem-p">p. ${a.page}</span></button></li>`).join('')}</ul>
      ${inks ? `<p class="hint">${inks} ${inks === 1 ? 'tratto' : 'tratti'} a penna.</p>` : ''}`
      : '<p class="hint">Le evidenziazioni, le sottolineature e le note compaiono qui, in ordine di pagina.</p>';
  }
  let searchQ = '';
  let searchRes = [];
  function drawSearch() {
    panelBody.innerHTML = `
      <form class="pdf-search" id="pdfSearchForm"><input type="search" class="input" id="pdfQ" placeholder="Cerca nel PDF" value="${esc(searchQ)}" aria-label="Cerca nel PDF"></form>
      <p class="hint" id="pdfSearchInfo">${searchRes.length ? `${searchRes.length}${searchRes.length >= 300 ? '+' : ''} risultati` : searchQ ? 'Nessun risultato.' : 'Cerca una parola in tutte le pagine.'}</p>
      <ul class="pdf-plist" id="pdfSearchList">${searchRes.map((r, i) => `<li><button type="button" class="pdf-pitem" data-sr="${i}"><span class="pdf-pitem-t">${r.html}</span><span class="pdf-pitem-p">p. ${r.n}</span></button></li>`).join('')}</ul>`;
    $('#pdfSearchForm', panelBody).addEventListener('submit', e => { e.preventDefault(); runSearch($('#pdfQ', panelBody).value); });
    if (!searchQ) setTimeout(() => $('#pdfQ', panelBody)?.focus(), 30);
  }
  const pageText = async n => {
    if (R.textCache.has(n)) return R.textCache.get(n);
    const p = await R.doc.getPage(n);
    const tc = await p.getTextContent();
    const t = tc.items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join('');
    R.textCache.set(n, t);
    return t;
  };
  async function runSearch(q) {
    searchQ = q.trim();
    searchRes = [];
    const f = foldAccents(searchQ);
    const token = ++R.searchToken;
    if (f.length < 2) { drawSearch(); return; }
    drawSearch();
    const info = () => $('#pdfSearchInfo', panelBody);
    for (let n = 1; n <= meta.pages; n++) {
      if (token !== R.searchToken || R.destroyed) return;
      let t;
      try { t = await pageText(n); } catch { continue; }
      const ft = foldAccents(t);
      let i = ft.indexOf(f);
      while (i >= 0 && searchRes.length < 300) {
        const a = Math.max(0, i - 50);
        const b = Math.min(t.length, i + f.length + 60);
        searchRes.push({ n, html: `${a ? '…' : ''}${esc(t.slice(a, i))}<mark class="hit">${esc(t.slice(i, i + f.length))}</mark>${esc(t.slice(i + f.length, b))}…` });
        i = ft.indexOf(f, i + f.length);
      }
      if (n % 15 === 0 && info()) info().textContent = `Cerco… pagina ${n} di ${meta.pages}`;
      if (searchRes.length >= 300) break;
    }
    if (token === R.searchToken && R.tab === 'search' && !panel.hidden) drawSearch();
  }
  const applyHit = n => {
    if (!R.hit || R.hit.n !== n) return;
    const el = pageEl(n);
    const f = foldAccents(R.hit.q);
    const spans = $$('.textLayer span', el).filter(s => foldAccents(s.textContent).includes(f));
    spans.forEach(s => s.classList.add('pdf-hit'));
    if (spans[0]) {
      const r = spans[0].getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      scroller.scrollTop += r.top - sr.top - scroller.clientHeight * 0.3;
    }
    R.hit = null;
  };
  function drawThumbs() {
    panelBody.innerHTML = `<div class="pdf-thumbs">${Array.from({ length: meta.pages }, (_, i) => {
      const n = i + 1;
      const sz = sizeOf(n) || { width: 1, height: 1.4 };
      return `<button type="button" class="pdf-thumb ${n === R.cur ? 'cur' : ''} ${meta.bookmarks.some(b => b.page === n) ? 'bm' : ''}" data-go="${n}" data-thumb="${n}" style="aspect-ratio:${sz.width}/${sz.height}" aria-label="Pagina ${n}"><span>${n}</span></button>`;
    }).join('')}</div>`;
    R.thumbIo = new IntersectionObserver(entries => entries.forEach(async en => {
      if (!en.isIntersecting) return;
      const b = en.target;
      R.thumbIo?.unobserve(b);
      try {
        const page = await R.doc.getPage(+b.dataset.thumb);
        const vp = page.getViewport({ scale: 160 / page.getViewport({ scale: 1 }).width });
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        await page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: vp }).promise;
        if (b.isConnected) b.prepend(c);
      } catch { /* miniatura non disponibile */ }
    }), { root: panelBody, rootMargin: '300px' });
    $$('.pdf-thumb', panelBody).forEach(b => R.thumbIo.observe(b));
    $('.pdf-thumb.cur', panelBody)?.scrollIntoView({ block: 'center' });
  }

  // Trascina: bozze di flashcard
  function drawDrag() {
    const d = meta.drafts;
    const missing = d.filter(x => !x.front.trim()).length;
    const ready = d.filter(x => x.front.trim() && x.back.trim()).length;
    panelBody.innerHTML = `
      <p class="hint">Seleziona del testo nel PDF e tocca <b>Trascina</b>, oppure trascinalo qui col mouse. Scrivi la domanda sul fronte e crea le flashcard. Riordinale tenendo premuta la maniglia ⠿.</p>
      <ol class="drag-list" id="dragList">${d.map(x => `
        <li class="drag-item" data-d="${x.id}">
          <span class="drag-handle" role="button" tabindex="0" aria-label="Sposta: usa le frecce su e giù">⠿</span>
          <div class="drag-fields">
            <textarea class="input" data-f="front" rows="2" placeholder="Fronte: la domanda">${esc(x.front)}</textarea>
            <textarea class="input" data-f="back" rows="3" placeholder="Retro: la risposta">${esc(x.back)}</textarea>
            <div class="drag-acts">
              <button type="button" class="btn sm ghost" data-go="${x.page}">Pagina ${x.page}</button>
              <button type="button" class="btn sm ghost danger" data-ddel="${x.id}">Elimina</button>
              <button type="button" class="btn sm" data-dmake="${x.id}">Crea</button>
            </div>
          </div>
        </li>`).join('')}</ol>
      <div class="drop-zone" id="dropZone">${d.length ? 'Trascina qui altro testo' : 'Trascina qui il testo dal PDF'}</div>
      ${d.length ? `
        <div class="drag-foot">
          ${AI.ready() ? `<button type="button" class="btn sm" data-dai ${missing ? '' : 'hidden'}>Proponi ${missing === 1 ? 'la domanda' : `le ${missing} domande`} con ${AI.name()}</button>` : ''}
          <button type="button" class="btn primary" data-dall ${ready ? '' : 'disabled'}>Crea ${ready === 1 ? 'la flashcard pronta' : `le ${ready} flashcard pronte`}</button>
        </div>` : ''}`;
  }
  const makeCards = async list => {
    const tags = tagsOf(secById(meta.sectionId));
    const cards = list.map(x => {
      const c = newCard(meta.notebookId, { front: x.front.trim(), back: x.back.trim(), sectionId: meta.sectionId });
      c.pdf = { id: meta.id, page: x.page };
      if (tags.length) c.tags = [...tags];
      return c;
    });
    await saveCards(cards);
    meta.drafts = meta.drafts.filter(x => !list.includes(x));
    markGone(meta, list.map(x => x.id));
    saveSoon();
    drawDrag();
    toast(cards.length === 1 ? 'Flashcard creata' : `${cards.length} flashcard create`);
  };
  // aggiorna i pulsanti in fondo senza ricrearli (un clic in corso non va perso)
  const updateDragFoot = () => {
    const missing = meta.drafts.filter(x => !x.front.trim()).length;
    const ready = meta.drafts.filter(x => x.front.trim() && x.back.trim()).length;
    const all = $('[data-dall]', panelBody);
    if (all) { all.disabled = !ready; all.textContent = `Crea ${ready === 1 ? 'la flashcard pronta' : `le ${ready} flashcard pronte`}`; }
    const ai = $('[data-dai]', panelBody);
    if (ai && !ai.disabled) { ai.hidden = !missing; ai.textContent = `Proponi ${missing === 1 ? 'la domanda' : `le ${missing} domande`} con ${AI.name()}`; }
  };
  panelBody.addEventListener('input', e => {
    const t = e.target.closest('.drag-item textarea');
    if (!t) return;
    const x = meta.drafts.find(d => d.id === t.closest('.drag-item').dataset.d);
    if (x) { x[t.dataset.f] = t.value; saveSoon(); updateDragFoot(); }
  });
  panelBody.addEventListener('click', async e => {
    const goB = e.target.closest('[data-go]');
    if (goB) {
      goTo(+goB.dataset.go, { flash: true });
      if (window.innerWidth < 900 && R.tab !== 'drag') closePanel();
      return;
    }
    const srB = e.target.closest('[data-sr]');
    if (srB) {
      const r = searchRes[+srB.dataset.sr];
      R.hit = { n: r.n, q: searchQ };
      const el = pageEl(r.n);
      goTo(r.n);
      if (el && el.dataset.scale === R.scale.toFixed(4) && el.classList.contains('ready')) applyHit(r.n);
      if (window.innerWidth < 900) closePanel();
      return;
    }
    const pm = e.target.closest('[data-pm]');
    if (pm) { await toggleBookmark(); return; }
    const ren = e.target.closest('[data-bmren]');
    if (ren) { const b = meta.bookmarks.find(x => x.id === ren.dataset.bmren); if (b) renameBookmark(b); return; }
    const del = e.target.closest('[data-bmdel]');
    if (del) { const b = meta.bookmarks.find(x => x.id === del.dataset.bmdel); if (b) toggleBookmark(b.page); return; }
    const dd = e.target.closest('[data-ddel]');
    if (dd) { meta.drafts = meta.drafts.filter(x => x.id !== dd.dataset.ddel); markGone(meta, [dd.dataset.ddel]); saveSoon(); drawDrag(); return; }
    const dm = e.target.closest('[data-dmake]');
    if (dm) {
      const x = meta.drafts.find(d => d.id === dm.dataset.dmake);
      if (!x) return;
      if (!x.front.trim()) { toast('Scrivi la domanda sul fronte'); $(`[data-d="${x.id}"] [data-f="front"]`, panelBody)?.focus(); return; }
      if (!x.back.trim()) { toast('Scrivi la risposta sul retro'); return; }
      await makeCards([x]);
      return;
    }
    if (e.target.closest('[data-dall]')) {
      const list = meta.drafts.filter(x => x.front.trim() && x.back.trim());
      if (list.length) await makeCards(list);
      return;
    }
    const ai = e.target.closest('[data-dai]');
    if (ai) {
      ai.disabled = true;
      const todo = meta.drafts.filter(x => !x.front.trim() && x.back.trim());
      let done = 0;
      for (const x of todo) {
        ai.textContent = `Scrivo le domande… ${done + 1} di ${todo.length}`;
        try {
          const ctx = sec ? `ARGOMENTO: ${sec.title}\n\n` : '';
          const r = await AI.generate({ system: promptFor('front'), text: `${ctx}RISPOSTA DELLA FLASHCARD:\n${x.back.trim()}`, maxTokens: 3000 });
          x.front = r.text.trim().split('\n').find(l => l.trim())?.replace(/^(D|Domanda)\s*:\s*/i, '').trim() || x.front;
          done++;
        } catch (err) { toast(err.message, 'err'); break; }
        if (R.destroyed) return;
      }
      saveSoon();
      if (R.tab === 'drag' && !panel.hidden) drawDrag();
    }
  });
  // riordino con la maniglia (dito, pennino o mouse)
  panelBody.addEventListener('pointerdown', e => {
    const h = e.target.closest('.drag-handle');
    if (!h) return;
    e.preventDefault();
    const li = h.closest('.drag-item');
    const list = li.parentElement;
    li.classList.add('dragging');
    h.setPointerCapture(e.pointerId);
    const move = ev => {
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.drag-item');
      if (over && over !== li && over.parentElement === list) {
        const r = over.getBoundingClientRect();
        list.insertBefore(li, ev.clientY > r.top + r.height / 2 ? over.nextSibling : over);
      }
      const pr = panelBody.getBoundingClientRect();
      if (ev.clientY < pr.top + 40) panelBody.scrollTop -= 12;
      else if (ev.clientY > pr.bottom - 40) panelBody.scrollTop += 12;
    };
    const up = () => {
      li.classList.remove('dragging');
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      h.removeEventListener('pointercancel', up);
      const order = $$('.drag-item', list).map(x => x.dataset.d);
      meta.drafts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      saveSoon();
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  });
  panelBody.addEventListener('keydown', e => {
    const h = e.target.closest('.drag-handle');
    if (!h || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const i = meta.drafts.findIndex(x => x.id === h.closest('.drag-item').dataset.d);
    const j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (i < 0 || j < 0 || j >= meta.drafts.length) return;
    [meta.drafts[i], meta.drafts[j]] = [meta.drafts[j], meta.drafts[i]];
    saveSoon();
    drawDrag();
    $(`[data-d="${meta.drafts[j].id}"] .drag-handle`, panelBody)?.focus();
  });
  // testo trascinato col mouse dal PDF (o da un’altra app)
  panel.addEventListener('dragover', e => {
    if (R.tab !== 'drag' || e.target.closest('textarea')) return;
    e.preventDefault();
    panel.classList.add('drop-on');
  });
  panel.addEventListener('dragleave', e => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('drop-on'); });
  panel.addEventListener('drop', e => {
    panel.classList.remove('drop-on');
    if (R.tab !== 'drag' || e.target.closest('textarea')) return;
    const t = (e.dataTransfer.getData('text/plain') || '').replace(/[ \t]+/g, ' ').trim();
    if (!t) return;
    e.preventDefault();
    addDraft(t, R.cur);
  });
  // apre il pannello Trascina quando inizi a trascinare testo dal PDF
  pagesEl.addEventListener('dragstart', () => { if (panel.hidden || R.tab !== 'drag') openPanel('drag'); });

  // ---------- barra in alto e scorrimento
  let scrollRaf = 0;
  let renderTimer = null;
  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      if (!R.doc) return;
      const n = findCurrent();
      if (n !== R.cur) {
        R.cur = n;
        const inp = $('#pdfPage');
        if (document.activeElement !== inp) inp.value = n;
        meta.lastPage = n;
        saveSoon();
        refreshBm();
        if (!panel.hidden && R.tab === 'pages') $$('.pdf-thumb', panelBody).forEach(b => b.classList.toggle('cur', +b.dataset.thumb === n));
      }
      clearTimeout(renderTimer);
      renderTimer = setTimeout(renderAround, 60);
    });
  }
  scroller.addEventListener('scroll', onScroll, { passive: true });
  const setNight = v => {
    app.classList.toggle('pdf-night', v);
    const b = $('[data-pdf="night"]', app);
    b.setAttribute('aria-pressed', v);
    b.classList.toggle('on', v);
    S().pdfNight = v;
    Settings.save();
  };
  // zoom con due dita (telefono e tablet) e con Ctrl + rotellina o pizzico sul touchpad (PC)
  let pinch = null;
  const tdist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  scroller.addEventListener('touchstart', e => {
    if (e.touches.length !== 2 || !R.doc || (R.tool !== 'select' && !R.penSeen)) return;
    const [a, b] = e.touches;
    const r = scroller.getBoundingClientRect();
    pinch = { d0: tdist(a, b), mx: (a.clientX + b.clientX) / 2 - r.left, my: (a.clientY + b.clientY) / 2 - r.top, z0: R.zoom, sl: scroller.scrollLeft, st: scroller.scrollTop, k: 1 };
    if (ink) { ink.path?.remove(); ink.occ?.remove(); ink = null; }
  }, { passive: true });
  scroller.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = e.touches;
    pinch.k = Math.max(0.5 / pinch.z0, Math.min(3 / pinch.z0, tdist(a, b) / pinch.d0));
    pagesEl.style.transformOrigin = `${pinch.sl + pinch.mx}px ${pinch.st + pinch.my}px`;
    pagesEl.style.transform = `scale(${pinch.k})`;
  }, { passive: false });
  const endPinch = e => {
    if (!pinch || e.touches.length >= 2) return;
    const p = pinch;
    pinch = null;
    pagesEl.style.transform = '';
    pagesEl.style.transformOrigin = '';
    if (Math.abs(p.k - 1) < 0.03) return;
    zoomTo(p.z0 * p.k);
    const k2 = R.zoom / p.z0;
    scroller.scrollLeft = (p.sl + p.mx) * k2 - p.mx;
    scroller.scrollTop = (p.st + p.my) * k2 - p.my;
    renderAround();
  };
  scroller.addEventListener('touchend', endPinch);
  scroller.addEventListener('touchcancel', endPinch);
  scroller.addEventListener('wheel', e => {
    if (!e.ctrlKey || !R.doc) return;
    e.preventDefault();
    const r = scroller.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const cx = scroller.scrollLeft + mx;
    const cy = scroller.scrollTop + my;
    const z0 = R.zoom;
    zoomTo(z0 * Math.exp(-e.deltaY * 0.01));
    const k2 = R.zoom / z0;
    scroller.scrollLeft = cx * k2 - mx;
    scroller.scrollTop = cy * k2 - my;
  }, { passive: false });
  const zoomTo = z => {
    const keep = R.cur;
    const el = pageEl(keep);
    const frac = el ? (scroller.scrollTop - pageTop(el)) / el.offsetHeight : 0;
    R.zoom = Math.max(0.5, Math.min(3, +z.toFixed(3)));
    meta.zoom = R.zoom;
    saveSoon();
    applySizes();
    const el2 = pageEl(keep);
    if (el2) scroller.scrollTop = pageTop(el2) + frac * el2.offsetHeight;
    renderAround();
  };
  app.addEventListener('click', e => {
    const t = e.target.closest('button[data-tool]');
    if (t) { setTool(t.dataset.tool); return; }
    const inkB = e.target.closest('[data-ink]');
    if (inkB) { R.ink = inkB.dataset.ink; S().pdfInk = R.ink; Settings.save(); $$('[data-ink]', app).forEach(b => b.classList.toggle('on', b === inkB)); return; }
    const p = e.target.closest('[data-pdf]');
    if (!p) return;
    const act = p.dataset.pdf;
    if (act === 'bookmark') toggleBookmark();
    else if (act === 'panel') { if (panel.hidden) openPanel(); else closePanel(); }
    else if (act === 'zoom+') zoomTo(R.zoom * 1.2);
    else if (act === 'zoom-') zoomTo(R.zoom / 1.2);
    else if (act === 'zoom-fit') zoomTo(1);
    else if (act === 'undo') undo();
    else if (act === 'occ-quiz') setOccQuiz(!R.occQuiz);
    else if (act === 'night') setNight(!app.classList.contains('pdf-night'));
  });
  panel.addEventListener('click', e => { const b = e.target.closest('[data-ptab]'); if (b) openPanel(b.dataset.ptab); });
  $('.pdf-pen-size', app).value = String(R.inkW);
  $('.pdf-pen-size', app).addEventListener('change', e => { R.inkW = +e.target.value; S().pdfInkW = R.inkW; Settings.save(); });
  $$('[data-ink]', app).forEach(b => b.classList.toggle('on', b.dataset.ink === R.ink));
  $('#pdfPage').addEventListener('change', e => goTo(+e.target.value, { flash: true }));
  $('#pdfPage').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); goTo(+e.target.value, { flash: true }); e.target.blur(); } });
  const onKey = e => {
    if ($('#modalRoot').children.length) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'b' || e.key === 'B') { e.preventDefault(); toggleBookmark(); }
    else if (e.key === 'Escape') { if (!menu.hidden) menu.hidden = true; else if (!panel.hidden) closePanel(); }
  };
  let resizeTimer = null;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (R.doc) zoomTo(R.zoom); }, 200);
  };
  document.addEventListener('selectionchange', onSel);
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDocDown, true);
  pagesEl.addEventListener('contextmenu', onContext);
  window.addEventListener('resize', onResize);
  addCleanup(() => {
    R.destroyed = true;
    clearTimeout(hideTimer);
    clearTimeout(renderTimer);
    clearTimeout(resizeTimer);
    saveNow();
    document.documentElement.classList.remove('pdf-open');
    document.removeEventListener('selectionchange', onSel);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onDocDown, true);
    window.removeEventListener('resize', onResize);
    R.thumbIo?.disconnect();
    bar.remove();
    menu.remove();
    try { R.doc?.destroy(); } catch { /* già chiuso */ }
  });
  setTool('select');
  if (S().pdfNight) setNight(true);
  if (R.tab) openPanel(R.tab);

  // ---------- apertura del file
  (async () => {
    try {
      await ensurePdfJs();
      const rec = await DB.run('pdfblobs', 'readonly', tx => tx.objectStore('pdfblobs').get(id));
      let blob = rec && rec.blob;
      if (!blob) {
        if (!meta.uploaded || !Sync.configured()) throw new Error(pdfCloudText(meta) || 'Il file di questo PDF non è su questo dispositivo.');
        pagesEl.innerHTML = '<p class="hint pdf-loading" id="pdfDl">Scarico il PDF da Drive…</p>';
        blob = await PdfCloud.download(meta, f => { const el = $('#pdfDl'); if (el) el.textContent = `Scarico il PDF da Drive, ${Math.round(f * 100)}%…`; });
        if (R.destroyed) return;
      }
      const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      if (R.destroyed) { doc.destroy(); return; }
      R.doc = doc;
      if (doc.numPages !== meta.pages) { meta.pages = doc.numPages; saveSoon(); }
      const p1 = await doc.getPage(1);
      R.base = p1.getViewport({ scale: 1 });
      R.sizes[1] = { width: R.base.width, height: R.base.height };
      pagesEl.innerHTML = Array.from({ length: doc.numPages }, (_, i) => `<div class="pdf-page" data-p="${i + 1}"><span class="pdf-pn" aria-hidden="true">${i + 1}</span><span class="pdf-flag" aria-hidden="true">${ICON_BM}</span></div>`).join('');
      applySizes();
      new Set(meta.annots.map(a => a.page)).forEach(drawAnnots);
      refreshBm();
      const start = +pageParam || meta.lastPage || 1;
      if (pdfPendingHit && pdfPendingHit.id === meta.id) { R.hit = { n: pdfPendingHit.n, q: pdfPendingHit.q }; pdfPendingHit = null; }
      R.cur = 0;
      goTo(start);
      renderAround();
      if (!panel.hidden) drawPanel();
    } catch (err) {
      pagesEl.innerHTML = `<div class="empty"><p>${esc(err.message || 'Non riesco ad aprire il PDF.')}</p><a class="btn" href="${back}">Torna indietro</a></div>`;
    }
  })();
}

/* =====================================================================
   v3.8: PDF sincronizzati su Drive (a pezzi, tramite lo script) e
   prompt dell’AI modificabili nelle Impostazioni
   ===================================================================== */
const PDF_CHUNK = 3 * 1024 * 1024;
const localPdfIds = new Set();      // PDF il cui file è su questo dispositivo
async function loadLocalPdfIds() {
  try {
    const keys = await DB.run('pdfblobs', 'readonly', tx => tx.objectStore('pdfblobs').getAllKeys());
    (keys || []).forEach(k => localPdfIds.add(k));
  } catch { /* archivio non disponibile */ }
}
// i file dei PDF eliminati su un altro dispositivo
async function prunePdfBlobs() {
  const gone = [...localPdfIds].filter(id => !pdfById(id));
  if (!gone.length) return;
  await DB.removeMany(gone.map(id => ['pdfblobs', id]));
  gone.forEach(id => localPdfIds.delete(id));
  await dropPdfText(gone);
}
const PdfCloud = {
  busy: false,
  progress: {},
  error: '',
  async uploadPending() {
    if (this.busy || !Sync.configured() || navigator.onLine === false) return;
    this.busy = true;
    try {
      for (const m of [...state.pdfs]) {
        if (m.uploaded || !localPdfIds.has(m.id)) continue;
        await this.upload(m);
      }
      this.error = '';
    } catch (e) {
      this.error = e.message || 'Caricamento del PDF non riuscito';
      Object.keys(this.progress).forEach(id => { delete this.progress[id]; this.paint(id); });
    } finally {
      this.busy = false;
    }
  },
  async upload(meta) {
    const rec = await DB.run('pdfblobs', 'readonly', tx => tx.objectStore('pdfblobs').get(meta.id));
    if (!rec || !rec.blob) return;
    const blob = rec.blob;
    const total = Math.max(1, Math.ceil(blob.size / PDF_CHUNK));
    const secret = S().syncSecret.trim();
    const info = await Sync.post({ secret, action: 'pdf-info', id: meta.id });
    if (info.exists === undefined) throw new Error('Per sincronizzare i PDF aggiorna lo script su Google Apps Script alla versione 2.');
    const have = new Set(info.exists && info.total === total && info.size === blob.size ? info.parts || [] : []);
    for (let i = 0; i < total; i++) {
      if (!pdfById(meta.id)) return; // eliminato nel frattempo
      this.progress[meta.id] = i / total;
      this.paint(meta.id);
      if (have.has(i)) continue;
      const data = await blobToBase64(blob.slice(i * PDF_CHUNK, (i + 1) * PDF_CHUNK));
      await Sync.post({ secret, action: 'pdf-up', id: meta.id, part: i, total, size: blob.size, name: meta.name, notebookId: meta.notebookId, data });
    }
    delete this.progress[meta.id];
    const cur = pdfById(meta.id);
    if (cur) { cur.uploaded = true; await savePdfMeta(cur); }
    this.paint(meta.id);
  },
  async download(meta, onProgress = () => {}) {
    const secret = S().syncSecret.trim();
    const parts = [];
    let total = 1;
    for (let i = 0; i < total; i++) {
      const r = await Sync.post({ secret, action: 'pdf-down', id: meta.id, part: i });
      if (r.total === undefined) throw new Error('Per sincronizzare i PDF aggiorna lo script su Google Apps Script alla versione 2.');
      total = r.total;
      parts.push(base64ToBlob(r.data, 'application/octet-stream'));
      onProgress((i + 1) / total);
    }
    const blob = new Blob(parts, { type: 'application/pdf' });
    await DB.put('pdfblobs', { id: meta.id, blob });
    localPdfIds.add(meta.id);
    setTimeout(() => PdfIndex.run(), 2000);
    return blob;
  },
  paint(id) {
    const el = document.querySelector(`[data-pdf-status="${id}"]`);
    if (el) el.textContent = pdfCloudText(pdfById(id));
  }
};
function pdfCloudText(p) {
  if (!p) return '';
  if (p.id in PdfCloud.progress) return `Caricamento su Drive, ${Math.round(PdfCloud.progress[p.id] * 100)}%`;
  const local = localPdfIds.has(p.id);
  if (!Sync.configured()) return local ? '' : 'Il file è su un altro dispositivo: attiva la sincronizzazione per scaricarlo';
  if (p.uploaded) return local ? 'Anche su Drive' : 'Su Drive: si scarica quando lo apri';
  if (local) return PdfCloud.error ? `Non ancora su Drive: ${PdfCloud.error}` : 'In attesa del caricamento su Drive';
  return 'Il file non è ancora su Drive: aprilo sul dispositivo dove l’hai caricato';
}

/* ---------- Prompt dell’AI ---------- */
const PROMPT_DEFAULTS = {
  format: [
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
    '- Se ci sono figure o schemi con informazioni utili, descrivine il contenuto in un elenco.'
  ].join('\n'),
  cards: [
    'Sei un tutor per studenti di medicina. Dagli appunti ricevuti crea flashcard per la memorizzazione.',
    'Ogni flashcard ha una domanda breve e precisa e una risposta breve (una parola, un valore, un elenco corto).',
    'Copri i concetti, i valori numerici, le classificazioni e i confronti più importanti. Da 8 a 25 flashcard.',
    'Scrivi nella lingua degli appunti.'
  ].join('\n'),
  questions: [
    'Sei un tutor per studenti di medicina.',
    'Dagli appunti ricevuti genera da 5 a 12 domande per il richiamo attivo, che coprano i concetti più importanti.',
    'Preferisci domande che chiedono di spiegare, confrontare o elencare, non solo definizioni.',
    'Scrivi nella lingua degli appunti.'
  ].join('\n'),
  front: 'Scrivi una sola domanda breve e precisa per una flashcard la cui risposta è il testo indicato. Usa la lingua del testo.',
  eval: [
    'Sei un tutor per studenti di medicina. Confronta il richiamo libero dello studente con gli appunti originali.',
    'Rispondi in italiano, in Markdown, in modo conciso, con questa struttura:',
    '**Punteggio: X/100** (quanto dei contenuti importanti è stato ricordato correttamente)',
    '### Ricordato bene',
    '### Mancante (in ordine di importanza)',
    '### Errori (solo se ci sono affermazioni sbagliate)'
  ].join('\n')
};
const PROMPT_INFO = [
  ['format', 'Formattazione degli appunti', 'In Importa e in “Riformatta”. Le regole su cloze, immagini ed evidenziature e il formato della risposta si aggiungono da sole.'],
  ['cards', 'Flashcard dagli appunti', 'Nella scheda Flashcard di una sezione, con “Genera con l’AI”. Il formato D:/R: si aggiunge da solo.'],
  ['questions', 'Domande per il richiamo', 'In Importa e nella scheda Domande. Il formato D:/R: si aggiunge da solo.'],
  ['front', 'Domanda di una flashcard', 'Quando l’AI propone il fronte a partire dalla risposta, anche in Trascina.'],
  ['eval', 'Valutazione della pagina bianca', 'Quando l’AI confronta il tuo richiamo con gli appunti. La riga del punteggio serve per suggerire il voto.']
];
const QA_FORMAT = 'Formato della risposta, senza altro testo prima o dopo:\nD: <domanda>\nR: <risposta>';
const promptsRec = () => state.links.find(l => l.kind === 'prompts');
function promptText(key) {
  const v = promptsRec()?.data?.[key];
  return typeof v === 'string' && v.trim() ? v : PROMPT_DEFAULTS[key];
}
const promptCustom = key => { const v = promptsRec()?.data?.[key]; return typeof v === 'string' && !!v.trim() && v.trim() !== PROMPT_DEFAULTS[key].trim(); };
async function setPrompt(key, value) {
  const rec = promptsRec() || { id: '_prompts', kind: 'prompts', notebookId: '_prompts', data: {}, created: Date.now() };
  rec.data = { ...(rec.data || {}) };
  if (!value.trim() || value.trim() === PROMPT_DEFAULTS[key].trim()) delete rec.data[key];
  else rec.data[key] = value;
  await saveLink(rec);
}
// il prompt completo, come lo riceve l’AI
function promptFor(key, opts = {}) {
  const base = promptText(key).trim();
  if (key === 'format') return formatSystem(opts);
  if (key === 'cards' || key === 'questions') return `${base}\n\n${QA_FORMAT}`;
  if (key === 'front') return `${base}\nRispondi solo con la domanda, senza virgolette.`;
  if (key === 'eval') return /punteggio/i.test(base) ? base : `${base}\n\nInizia la risposta con la riga **Punteggio: X/100**.`;
  return base;
}
function settingsPromptsHtml() {
  return `
    <section class="block" id="aiPrompts">
      <h2>Prompt per l’AI</h2>
      <p class="hint">Le istruzioni che l’app dà all’AI. Cambiale come vuoi: si salvano da sole e valgono su tutti i tuoi dispositivi sincronizzati. Con “Copia” prendi il prompt completo da incollare in Gemini o NotebookLM.</p>
      ${PROMPT_INFO.map(([k, title, desc]) => `
        <details class="prompt-box" data-pk="${k}">
          <summary><span class="prompt-title">${title}</span><span class="pill soft prompt-flag" ${promptCustom(k) ? '' : 'hidden'}>Personalizzato</span></summary>
          <p class="hint">${desc}</p>
          <label class="sr-only" for="pr-${k}">${title}</label>
          <textarea class="input prompt-ta" id="pr-${k}" rows="9" spellcheck="false">${esc(promptText(k))}</textarea>
          <div class="inline prompt-acts">
            <button class="btn sm" type="button" data-pcopy="${k}">Copia il prompt completo</button>
            <button class="btn sm ghost" type="button" data-preset="${k}">Ripristina l’originale</button>
            <span class="hint prompt-saved" aria-live="polite"></span>
          </div>
        </details>`).join('')}
    </section>`;
}
function bindSettingsPrompts(root) {
  const box = $('#aiPrompts', root);
  if (!box) return;
  const timers = {};
  const flag = k => { const f = $(`[data-pk="${k}"] .prompt-flag`, box); if (f) f.hidden = !promptCustom(k); };
  const saved = (k, text) => { const s = $(`[data-pk="${k}"] .prompt-saved`, box); if (s) { s.textContent = text; clearTimeout(timers[k + 's']); timers[k + 's'] = setTimeout(() => { s.textContent = ''; }, 2000); } };
  box.addEventListener('input', e => {
    const ta = e.target.closest('.prompt-ta');
    if (!ta) return;
    const k = ta.closest('[data-pk]').dataset.pk;
    clearTimeout(timers[k]);
    timers[k] = setTimeout(async () => { await setPrompt(k, ta.value); flag(k); saved(k, 'Salvato'); }, 700);
  });
  box.addEventListener('click', async e => {
    const c = e.target.closest('[data-pcopy]');
    if (c) {
      const k = c.dataset.pcopy;
      const ta = $(`#pr-${k}`, box);
      clearTimeout(timers[k]);
      await setPrompt(k, ta.value);
      flag(k);
      const st = S();
      const full = promptFor(k, { cloze: st.aiCloze, questions: st.aiQuestions });
      try { await navigator.clipboard.writeText(full); toast('Prompt copiato'); }
      catch { toast('Copia non riuscita: seleziona il testo e copialo a mano', 'err'); }
      return;
    }
    const r = e.target.closest('[data-preset]');
    if (r) {
      const k = r.dataset.preset;
      const ok = await modal({ title: 'Ripristinare il prompt originale?', text: 'Le tue modifiche a questo prompt si perdono.', confirm: 'Ripristina' });
      if (!ok) return;
      clearTimeout(timers[k]);
      await setPrompt(k, '');
      $(`#pr-${k}`, box).value = PROMPT_DEFAULTS[k];
      flag(k);
      saved(k, 'Ripristinato');
    }
  });
}

/* =====================================================================
   v3.10: link nelle sezioni, blocchi HTML, “Modifica qui”, scrittura a
   mano in Leggi, segni colorati in Cloze, libreria dei PDF, annotazioni
   dei PDF unite tra dispositivi
   ===================================================================== */
let editJump = null;

/* ---------- Link a siti dentro una sezione ---------- */
const secLinksOf = sec => (Array.isArray(sec.links) ? sec.links.filter(l => l && l.url) : []);
function parseSecLinks(text) {
  return String(text || '').split('\n').map(line => {
    const t = line.trim();
    if (!t) return null;
    const i = t.lastIndexOf('|');
    let title = i >= 0 ? t.slice(0, i).trim() : '';
    let url = (i >= 0 ? t.slice(i + 1) : t).trim();
    if (!/^https?:\/\//i.test(url)) {
      if (!/^[\w-]+(\.[\w-]+)+/.test(url)) return null;
      url = `https://${url}`;
    }
    try { url = new URL(url).href; } catch { return null; }
    return { title: title || linkHost(url), url };
  }).filter(Boolean).slice(0, 30);
}

/* ---------- Blocchi HTML: ```html … ``` diventa un riquadro isolato ---------- */
function extractHtmlBlocks(md) {
  return md.replace(/^```html[ \t]*\n([\s\S]*?)\n?```[ \t]*$/gim, (m, code) => {
    const b64 = btoa(unescape(encodeURIComponent(code)));
    return `\n<div class="html-embed" data-html="${b64}"></div>\n`;
  });
}
const EMBED_RESIZE = `<script>(function(){function s(){parent.postMessage({nbEmbedH:Math.ceil(document.documentElement.scrollHeight)},'*')}new ResizeObserver(s).observe(document.documentElement);addEventListener('load',s);s();})();<\/script>`;
function hydrateHtmlBlocks(root) {
  const list = root.matches && root.matches('.html-embed') ? [root] : [...root.querySelectorAll('.html-embed:not(.ready)')];
  list.forEach(box => {
    if (box.classList.contains('ready')) return;
    box.classList.add('ready');
    let code = '';
    try { code = decodeURIComponent(escape(atob(box.dataset.html || ''))); } catch { return; }
    const fr = document.createElement('iframe');
    fr.className = 'html-frame';
    fr.setAttribute('sandbox', 'allow-scripts allow-popups allow-forms');
    fr.setAttribute('title', 'Contenuto HTML');
    fr.setAttribute('loading', 'lazy');
    const dark = document.documentElement.dataset.theme === 'dark';
    fr.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>html{color-scheme:${dark ? 'dark' : 'light'}}body{margin:0;padding:12px;font-family:system-ui,sans-serif;line-height:1.5;${dark ? 'color:#e9ecf7;' : ''}}img{max-width:100%}</style></head><body>${code}${EMBED_RESIZE}</body></html>`;
    box.append(fr);
  });
}
window.addEventListener('message', e => {
  const h = e.data && e.data.nbEmbedH;
  if (!h) return;
  document.querySelectorAll('iframe.html-frame').forEach(fr => {
    if (fr.contentWindow === e.source) fr.style.height = `${Math.min(Math.max(h, 40), 4000)}px`;
  });
});

/* ---------- Modifica qui: porta il cursore nel punto scelto ---------- */
function jumpInTextarea(ta, jmp) {
  if (!ta) return;
  let { start, end } = jmp;
  if (start < 0 && jmp.text) {
    const i = ta.value.toLowerCase().indexOf(jmp.text.trim().toLowerCase().slice(0, 60));
    if (i >= 0) { start = i; end = i + Math.min(jmp.text.trim().length, 60); }
  }
  if (start < 0) { ta.focus(); toast('Non trovo il punto esatto: cercalo nel testo'); return; }
  // misuro dove cade il punto con una copia invisibile del campo
  const cs = getComputedStyle(ta);
  const mirror = document.createElement('div');
  ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'boxSizing', 'tabSize'].forEach(p => { mirror.style[p] = cs[p]; });
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: `${ta.clientWidth}px`, top: '0', left: '-9999px' });
  mirror.textContent = ta.value.slice(0, start);
  const mark = document.createElement('span');
  mark.textContent = '|';
  mirror.append(mark);
  document.body.append(mirror);
  const y = mark.offsetTop;
  mirror.remove();
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(start, end);
  ta.scrollTop = Math.max(0, y - ta.clientHeight / 3);
  const r = ta.getBoundingClientRect();
  const caretY = r.top + (y - ta.scrollTop);
  window.scrollBy(0, caretY - window.innerHeight * 0.35);
}

/* ---------- Scrittura a mano in Leggi ---------- */
const inkBlocksOf = article => $$(':scope > :not(.fold):not(svg), .fold-body > :not(.fold), .fold > .fold-h', article);
function setupNotesInk(article, sec, btn) {
  if (!article || !btn) return;
  btn.hidden = false;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'notes-ink');
  article.classList.add('ink-host');
  article.append(svg);
  const data = () => (sec.ink && Array.isArray(sec.ink.strokes) ? sec.ink : (sec.ink = { w: 0, strokes: [] }));
  let on = false;
  let tool = 'pen';
  let color = S().inkColor || '#e5484d';
  let size = +(S().inkSize || 2.5);
  let penSeen = false;
  let cur = null;
  let pan = null;
  const undoStack = [];
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => saveSection(sec), 900); };
  const blockTop = (el, ar) => el.getBoundingClientRect().top - ar.top;
  const draw = () => {
    const ar = article.getBoundingClientRect();
    const W = article.clientWidth;
    svg.setAttribute('viewBox', `0 0 ${W} ${article.scrollHeight}`);
    svg.style.height = `${article.scrollHeight}px`;
    const d = data();
    if (!d.strokes.length) { svg.innerHTML = ''; return; }
    const k = d.w ? W / d.w : 1;
    const blocks = inkBlocksOf(article);
    svg.innerHTML = d.strokes.map(s => {
      const b = blocks[s.b];
      if (!b || !b.offsetParent) return '';
      const top = blockTop(b, ar);
      const pts = s.p.map(([x, y]) => [+(x * k).toFixed(1), +(top + y * k).toFixed(1)]);
      return `<path data-id="${s.id}" d="${inkPath(pts)}" stroke="${esc(s.c)}" stroke-width="${(s.s * k).toFixed(2)}" class="${s.s >= 8 ? 'marker' : ''}"/>`;
    }).join('');
  };
  const ro = new ResizeObserver(() => draw());
  ro.observe(article);
  addCleanup(() => { ro.disconnect(); clearTimeout(saveT); if (saveT) saveSection(sec); bar.remove(); });
  // barra degli strumenti
  const bar = document.createElement('div');
  bar.className = 'ink-bar';
  bar.hidden = true;
  bar.innerHTML = `
    ${['#e5484d', '#1d4ed8', '#15803d', '#111111', '#f59e0b'].map(c => `<button type="button" class="rt-dot ink-dot" data-ic="${c}" style="--ink:${c}" aria-label="Colore"></button>`).join('')}
    <select class="input ink-size" aria-label="Spessore"><option value="1.5">Fine</option><option value="2.5">Media</option><option value="4">Spessa</option><option value="12">Evidenziatore</option></select>
    <button type="button" class="btn sm ghost" data-it="eraser" aria-pressed="false">Gomma</button>
    <button type="button" class="btn sm ghost" data-it="undo">Annulla</button>
    <button type="button" class="btn sm primary" data-it="done">Fine</button>`;
  document.body.append(bar);
  $('.ink-size', bar).value = String(size);
  const paintTools = () => {
    $$('[data-ic]', bar).forEach(b => b.classList.toggle('on', tool === 'pen' && b.dataset.ic === color));
    $('[data-it="eraser"]', bar).setAttribute('aria-pressed', tool === 'eraser');
  };
  paintTools();
  const setOn = v => {
    on = v;
    article.classList.toggle('inking', on);
    article.dataset.inkTool = tool;
    bar.hidden = !on;
    btn.textContent = on ? 'Scrittura a mano attiva' : 'Scrivi a mano';
    btn.classList.toggle('on', on);
    if (on && !data().w) data().w = article.clientWidth;
  };
  btn.addEventListener('click', () => setOn(!on));
  bar.addEventListener('click', e => {
    const c = e.target.closest('[data-ic]');
    if (c) { color = c.dataset.ic; tool = 'pen'; S().inkColor = color; Settings.save(); article.dataset.inkTool = tool; paintTools(); return; }
    const t = e.target.closest('[data-it]');
    if (!t) return;
    if (t.dataset.it === 'eraser') { tool = tool === 'eraser' ? 'pen' : 'eraser'; article.dataset.inkTool = tool; paintTools(); }
    if (t.dataset.it === 'done') setOn(false);
    if (t.dataset.it === 'undo') {
      const u = undoStack.pop();
      if (!u) { toast('Niente da annullare'); return; }
      const d = data();
      if (u.add) d.strokes = d.strokes.filter(s => s.id !== u.add);
      if (u.del) d.strokes.push(u.del);
      draw(); save();
    }
  });
  $('.ink-size', bar).addEventListener('change', e => { size = +e.target.value; S().inkSize = size; Settings.save(); });
  const toLocal = e => {
    const ar = article.getBoundingClientRect();
    return [e.clientX - ar.left, e.clientY - ar.top];
  };
  const erase = e => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const p = el && el.closest && el.closest('svg.notes-ink path[data-id]');
    if (!p) return;
    const d = data();
    const s = d.strokes.find(x => x.id === p.dataset.id);
    if (!s) return;
    d.strokes = d.strokes.filter(x => x !== s);
    undoStack.push({ del: s });
    draw(); save();
  };
  article.addEventListener('pointerdown', e => {
    if (!on) return;
    if (e.pointerType === 'pen') penSeen = true;
    if (e.pointerType === 'touch' && penSeen) { pan = { id: e.pointerId, y: e.clientY }; return; }
    if (e.button > 0) return;
    e.preventDefault();
    article.setPointerCapture(e.pointerId);
    if (tool === 'eraser') { cur = { id: e.pointerId, eraser: true }; erase(e); return; }
    const [x, y] = toLocal(e);
    // ancoro il tratto al blocco di testo sotto il primo punto, così segue il testo
    const blocks = inkBlocksOf(article);
    const ar = article.getBoundingClientRect();
    let bi = 0;
    for (let i = 0; i < blocks.length; i++) { if (!blocks[i].offsetParent) continue; if (blockTop(blocks[i], ar) <= y) bi = i; else break; }
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', size);
    if (size >= 8) path.setAttribute('class', 'marker');
    svg.append(path);
    cur = { id: e.pointerId, path, pts: [[x, y]], bi, top: blocks[bi] ? blockTop(blocks[bi], ar) : 0 };
    path.setAttribute('d', inkPath(cur.pts));
  });
  article.addEventListener('pointermove', e => {
    if (pan && e.pointerId === pan.id) { window.scrollBy(0, pan.y - e.clientY); pan.y = e.clientY; return; }
    if (!cur || e.pointerId !== cur.id) return;
    if (cur.eraser) { erase(e); return; }
    for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) {
      const p = toLocal(ev);
      const l = cur.pts[cur.pts.length - 1];
      if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 1) cur.pts.push(p);
    }
    cur.path.setAttribute('d', inkPath(cur.pts));
  });
  const end = e => {
    if (pan && e.pointerId === pan.id) { pan = null; return; }
    if (!cur || e.pointerId !== cur.id) return;
    const c = cur;
    cur = null;
    if (c.eraser) return;
    const d = data();
    const k = d.w / article.clientWidth;
    const s = { id: uid(), c: color, s: +(size * k).toFixed(2), b: c.bi, p: c.pts.map(([x, y]) => [+(x * k).toFixed(1), +((y - c.top) * k).toFixed(1)]) };
    d.strokes.push(s);
    undoStack.push({ add: s.id });
    draw(); save();
  };
  article.addEventListener('pointerup', end);
  article.addEventListener('pointercancel', end);
  draw();
}

/* ---------- Cloze: riga colorata per ricordare com’è andata ---------- */
const CZ_MARKS = ['g', 'y', 'o', 'r'];
const CZ_MARK_NAMES = { g: 'andata bene', y: 'qualche dubbio', o: 'da rivedere', r: 'non la sapevo' };
function setupClozeMarks(article, sec) {
  if (!article) return;
  const folds = $$('.fold', article);
  const targets = folds.length
    ? folds.map(f => ({ el: f, host: f.querySelector(':scope > .fold-h'), key: f.dataset.fold, label: f.querySelector(':scope > .fold-h')?.textContent.trim() }))
    : [...article.children].filter(el => el.textContent.trim()).map((el, i) => ({ el, host: el, key: `b${i}:${el.textContent.trim().slice(0, 24)}`, label: el.textContent.trim().slice(0, 60) }));
  const marks = () => (sec.czMarks && typeof sec.czMarks === 'object' ? sec.czMarks : (sec.czMarks = {}));
  const paint = t => {
    const v = marks()[t.key] || '';
    CZ_MARKS.forEach(c => t.el.classList.toggle(`czm-${c}`, v === c));
    const b = t.btn;
    b.dataset.v = v;
    b.setAttribute('aria-label', v ? `Segnata: ${CZ_MARK_NAMES[v]}. Tocca per cambiare` : 'Segna com’è andata');
    b.title = v ? CZ_MARK_NAMES[v] : 'Segna com’è andata: verde, giallo, arancio, rosso';
  };
  targets.forEach(t => {
    if (!t.host) return;
    t.el.classList.add('czm-block');
    t.host.classList.add('czm-host');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'czm-btn';
    t.btn = b;
    t.host.append(b);
    paint(t);
    b.addEventListener('click', e => {
      e.stopPropagation();
      const m = marks();
      const i = CZ_MARKS.indexOf(m[t.key] || '');
      const next = i === CZ_MARKS.length - 1 ? '' : CZ_MARKS[i + 1];
      if (next) m[t.key] = next; else delete m[t.key];
      recordCzMark(sec, t.key, next, t.label, t.el.textContent.replace(/\s+/g, ' ').trim());
      paint(t);
      clearTimeout(setupClozeMarks.t);
      setupClozeMarks.t = setTimeout(() => saveSection(sec), 800);
    });
  });
}

/* ---------- Libreria dei PDF ---------- */
function pdfRowHtml(p, { where = false } = {}) {
  const nAnn = (p.annots || []).length;
  const s = secById(p.sectionId);
  const place = s ? [nbById(s.notebookId)?.name, groupPathText(s), s.title].filter(Boolean).join(' › ') : `${nbById(p.notebookId)?.name || ''}, tutta la materia`;
  return `
    <li class="pdf-row">
      <a class="row" href="#/pdf/${p.id}">
        <span class="pdf-ic" aria-hidden="true">PDF</span>
        <span class="row-main"><span class="row-title">${esc(p.name)}</span>
        ${where && place ? `<span class="row-sub">${esc(place)}</span>` : ''}
        <span class="row-sub">${p.pages} ${p.pages === 1 ? 'pagina' : 'pagine'}, ${fmtSize(p.size)}${p.lastPage > 1 ? `, eri a pagina ${p.lastPage}` : ''}${(p.bookmarks || []).length ? `, ${p.bookmarks.length} ${p.bookmarks.length === 1 ? 'segnalibro' : 'segnalibri'}` : ''}${nAnn ? `, ${nAnn} ${nAnn === 1 ? 'annotazione' : 'annotazioni'}` : ''}</span>
        <span class="row-sub pdf-cloud" data-pdf-status="${p.id}">${esc(pdfCloudText(p))}</span></span>
      </a>
      <button class="btn sm ghost" type="button" data-pdf-more="${p.id}" aria-label="Opzioni per ${esc(p.name)}">Opzioni</button>
    </li>`;
}
function bindPdfRows(root) {
  on('[data-pdf-more]', 'click', async e => {
    const p = pdfById(e.currentTarget.dataset.pdfMore);
    if (!p) return;
    const choice = await actionSheet(p.name, [
      { key: 'open', label: 'Apri' },
      { key: 'rename', label: 'Rinomina' },
      { key: 'move', label: 'Sposta in un altro notebook o sezione' },
      { key: 'delete', label: 'Elimina il PDF', danger: true }
    ]);
    if (choice === 'open') go(`#/pdf/${p.id}`);
    if (choice === 'rename') {
      const name = await modal({ title: 'Rinomina il PDF', input: true, value: p.name, confirm: 'Rinomina' });
      if (name) { p.name = name; await savePdfMeta(p); route(); }
    }
    if (choice === 'move') {
      const t = await pdfTargetSheet('Dove lo sposto?');
      if (t) { p.sectionId = t.sectionId; p.notebookId = t.notebookId; await savePdfMeta(p); toast(`Spostato in ${t.label}`); route(); }
    }
    if (choice === 'delete') {
      const ok = await modal({ title: 'Eliminare il PDF?', text: 'Si perdono anche evidenziazioni, note e segnalibri, su tutti i dispositivi. Le flashcard già create restano.', confirm: 'Elimina', danger: true });
      if (ok) { await deletePdf(p.id); toast('PDF eliminato'); route(); }
    }
  }, root);
}
async function uploadPdfInto(target, btn) {
  const file = await choosePdfFile();
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { toast('Scegli un file PDF', 'err'); return; }
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Carico il PDF…'; }
  try {
    const meta = await storePdfFile(file, target);
    go(`#/pdf/${meta.id}`);
  } catch (err) {
    toast(err.message, 'err');
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}
// Scelta di dove mettere un PDF: un notebook intero o una sua sezione
function pdfTargetSheet(title = 'Dove metto il PDF?', preset = null) {
  return new Promise(resolve => {
    const nbs = [...state.notebooks].sort((a, b) => a.created - b.created);
    if (!nbs.length) { toast('Crea prima un notebook'); resolve(null); return; }
    let nbId = preset && nbById(preset) ? preset : nbs[0].id;
    const sh = openSheet(`
      <h2>${esc(title)}</h2>
      <label class="field"><span>Notebook</span><select class="input" id="ptNb">${nbs.map(n => `<option value="${n.id}" ${n.id === nbId ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></label>
      <ul class="list pick-list" id="ptList"></ul>
      <div class="modal-actions"><button class="btn ghost" type="button" data-pt="no">Annulla</button></div>`, { label: title, onClose: resolve });
    const draw = () => {
      const nb = nbById(nbId);
      const secs = secsOf(nbId).sort((a, b) => (groupPathText(a) + a.title).localeCompare(groupPathText(b) + b.title));
      $('#ptList', sh.el).innerHTML = `
        <li><button type="button" class="row pt-all" data-pt-sec=""><span class="row-main"><span class="row-title">Tutto il notebook</span><span class="row-sub">Per i PDF che riguardano tutta la materia di ${esc(nb.name)}</span></span></button></li>
        ${secs.map(s => `<li><button type="button" class="row" data-pt-sec="${s.id}"><span class="row-main"><span class="row-title">${esc(s.title)}</span>${groupPathText(s) ? `<span class="row-sub">${esc(groupPathText(s))}</span>` : ''}</span></button></li>`).join('')}`;
    };
    draw();
    $('#ptNb', sh.el).addEventListener('change', e => { nbId = e.target.value; draw(); });
    $('#ptList', sh.el).addEventListener('click', e => {
      const b = e.target.closest('[data-pt-sec]');
      if (!b) return;
      const s = b.dataset.ptSec ? secById(b.dataset.ptSec) : null;
      sh.close({ notebookId: nbId, sectionId: s ? s.id : null, label: s ? s.title : nbById(nbId).name });
    });
    $('[data-pt="no"]', sh.el).onclick = () => sh.close(null);
  });
}
// #/pdfs (tutti), #/pdfs/<sezione>, #/pdfs/nb/<notebook>
function viewPdfLibrary(p1, p2) {
  const nb = p1 === 'nb' ? nbById(p2) : null;
  const sec = !nb && p1 ? secById(p1) : null;
  if ((p1 === 'nb' && !nb) || (p1 && p1 !== 'nb' && !sec)) return notFound(p1 === 'nb' ? 'Questo notebook' : 'Questa sezione');
  const all = [...state.pdfs].sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const list = sec ? pdfsOf(sec.id) : nb ? all.filter(p => p.notebookId === nb.id).sort((a, b) => (a.sectionId ? 1 : 0) - (b.sectionId ? 1 : 0)) : all;
  const nbWide = nb ? list.filter(p => !p.sectionId) : [];
  const inSecs = nb ? list.filter(p => p.sectionId) : [];
  setView(`
    ${sec ? `<a class="back" href="#/sec/${sec.id}">${esc(sec.title)}</a>` : nb ? `<a class="back" href="#/nb/${nb.id}">${esc(nb.name)}</a>` : ''}
    <header class="page-head">
      <div><h1>PDF</h1><p class="lede">${sec ? `I PDF di ${esc(sec.title)}.` : nb ? `I PDF di ${esc(nb.name)}: quelli di tutta la materia e quelli delle sue sezioni.` : 'Tutti i tuoi PDF: appunti scritti a mano, slide, capitoli. Ognuno sta in un notebook o in una sua sezione.'}</p></div>
      <button class="btn primary" type="button" data-act="pdf-add">Carica un PDF</button>
    </header>
    ${!sec && !nb && list.length > 5 ? '<input type="search" class="input search" id="pdfQ" placeholder="Cerca un PDF" aria-label="Cerca un PDF">' : ''}
    ${nb ? `
      ${nbWide.length ? `<h2 class="sub">Di tutta la materia</h2><ul class="list pdf-list">${nbWide.map(p => pdfRowHtml(p)).join('')}</ul>` : ''}
      ${inSecs.length ? `<h2 class="sub">Nelle sezioni</h2><ul class="list pdf-list">${inSecs.map(p => pdfRowHtml(p, { where: true })).join('')}</ul>` : ''}
      ${!list.length ? '<div class="empty"><p>Nessun PDF in questo notebook.</p></div>' : ''}`
    : list.length ? `<ul class="list pdf-list" id="pdfList">${list.map(p => pdfRowHtml(p, { where: !sec })).join('')}</ul>`
      : `<div class="empty"><p>${sec ? 'Nessun PDF in questa sezione.' : 'Nessun PDF ancora. Caricane uno e scegli il notebook o la sezione a cui appartiene.'}</p></div>`}
    ${Sync.configured() ? '<p class="hint">Con la sincronizzazione attiva i PDF vanno anche su Drive e li ritrovi sugli altri dispositivi.</p>' : '<p class="hint">Attiva la sincronizzazione con Drive per ritrovare i PDF sugli altri dispositivi.</p>'}`);
  bindPdfRows($('#view'));
  on('[data-act="pdf-add"]', 'click', async e => {
    const btn = e.currentTarget;
    const target = sec ? { notebookId: sec.notebookId, sectionId: sec.id } : await pdfTargetSheet('Dove metto il PDF?', nb ? nb.id : null);
    if (target) uploadPdfInto(target, btn);
  });
  $('#pdfQ')?.addEventListener('input', e => {
    const f = foldAccents(e.target.value.trim());
    $$('#pdfList > li').forEach(li => {
      const p = pdfById(li.querySelector('[data-pdf-more]').dataset.pdfMore);
      const s = p && secById(p.sectionId);
      li.hidden = !!f && !foldAccents(`${p?.name} ${s?.title || ''} ${nbById(p?.notebookId)?.name || ''}`).includes(f);
    });
  });
}

/* ---------- PDF: annotazioni unite tra dispositivi ---------- */
const markGone = (meta, ids) => { meta.gone = [...new Set([...(meta.gone || []), ...ids])].slice(-3000); };
const unGone = (meta, ids) => { if (meta.gone) meta.gone = meta.gone.filter(x => !ids.includes(x)); };
function mergePdfMeta(local, remote, rUpdated) {
  const ids = a => (a || []).map(x => x && x.id).join(',');
  const before = [ids(local.annots), ids(local.bookmarks), ids(local.drafts), local.name, local.sectionId, local.uploaded].join('|');
  const gone = new Set([...(local.gone || []), ...(remote.gone || [])]);
  const remoteNewer = (rUpdated || 0) > (local.updated || 0);
  const mergeArr = (a, b) => {
    const m = new Map();
    (remoteNewer ? [...(a || []), ...(b || [])] : [...(b || []), ...(a || [])]).forEach(x => { if (x && x.id) m.set(x.id, x); });
    return [...m.values()].filter(x => !gone.has(x.id));
  };
  const annots = mergeArr(local.annots, remote.annots);
  const bookmarks = mergeArr(local.bookmarks, remote.bookmarks).sort((x, y) => x.page - y.page);
  const drafts = mergeArr(local.drafts, remote.drafts);
  if (remoteNewer) {
    ['name', 'lastPage', 'zoom', 'pages', 'notebookId', 'sectionId', 'size'].forEach(k => { if (remote[k] !== undefined) local[k] = remote[k]; });
  }
  local.uploaded = !!(local.uploaded || remote.uploaded);
  local.annots = annots;
  local.bookmarks = bookmarks;
  local.drafts = drafts;
  local.gone = [...gone].slice(-3000);
  const after = [ids(annots), ids(bookmarks), ids(drafts), local.name, local.sectionId, local.uploaded].join('|');
  const sameAsRemote = after === [ids(remote.annots), ids(remote.bookmarks), ids(remote.drafts), remote.name, remote.sectionId, !!remote.uploaded].join('|');
  if (remoteNewer) { local.updated = sameAsRemote ? rUpdated : Date.now(); return true; }
  if (after === before) return false;
  local.updated = Date.now();
  return true;
}

/* =====================================================================
   v3.12: simulazione d’esame e punti deboli dai segni colorati del Cloze
   ===================================================================== */
const shuffleArr = a => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [r[i], r[k]] = [r[k], r[i]]; } return r; };
async function boostSection(sec) {
  if (sec.studyhub) { toast('Questa sezione la pianifica StudyHub: segnala lì che vuoi rivederla prima', 'err'); return false; }
  sec.srs = { ...sec.srs, due: todayStr(), interval: Math.max(1, Math.round((sec.srs?.interval || 1) / 2)) };
  await saveSection(sec);
  updateBadge();
  return true;
}

/* ---------- Cloze: storico dei segni e punti deboli ---------- */
function recordCzMark(sec, key, color, label, text) {
  if (!sec.czHist || typeof sec.czHist !== 'object') sec.czHist = {};
  const e = sec.czHist[key] || (sec.czHist[key] = { label: '', text: '', h: [] });
  e.label = String(label || '').slice(0, 120);
  e.text = String(text || '').slice(0, 800);
  const d = todayStr();
  const last = e.h[e.h.length - 1];
  if (last && last.d === d) last.c = color || '';
  else e.h.push({ d, c: color || '' });
  e.h = e.h.slice(-20);
}
// parti rimaste rosse o arancio in almeno due letture recenti, e ancora segnate così
function czWeakOf(sec) {
  const hist = sec.czHist && typeof sec.czHist === 'object' ? sec.czHist : {};
  const now = sec.czMarks || {};
  return Object.entries(hist).map(([key, e]) => {
    const bad = (e.h || []).slice(-6).filter(x => x.c === 'r' || x.c === 'o').length;
    const cur = now[key] || (e.h || []).slice(-1)[0]?.c || '';
    return { key, label: e.label, text: e.text, bad, cur };
  }).filter(x => x.bad >= 2 && (x.cur === 'r' || x.cur === 'o')).sort((a, b) => b.bad - a.bad);
}
function czWeakItemHtml(sec, w, { showSec = false } = {}) {
  return `
    <li class="czw-item" data-czw="${sec.id}" data-key="${esc(w.key)}">
      <span class="czw-dot ${w.cur}" aria-hidden="true"></span>
      <span class="czw-main">
        <span class="czw-label">${showSec ? `<a href="#/sec/${sec.id}/cloze">${esc(sec.title)}</a> › ` : ''}${esc(w.label || 'Paragrafo')}</span>
        <span class="czw-sub">${w.bad} ${w.bad === 1 ? 'volta' : 'volte'} in rosso o arancio nelle ultime letture</span>
      </span>
      <span class="czw-acts">
        <button type="button" class="btn sm" data-czw-act="card">Crea flashcard</button>
        <button type="button" class="btn sm ghost" data-czw-act="boost">Ripassa prima</button>
      </span>
    </li>`;
}
function bindCzWeak(root) {
  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-czw-act]');
    if (!b) return;
    const li = b.closest('[data-czw]');
    const sec = secById(li.dataset.czw);
    if (!sec) return;
    const w = czWeakOf(sec).find(x => x.key === li.dataset.key) || { label: '', text: '' };
    if (b.dataset.czwAct === 'card') {
      const body = w.text && w.label && w.text.startsWith(w.label) ? w.text.slice(w.label.length).trim() : w.text;
      await openCardSheet({ front: w.label ? `Spiega: ${w.label}` : '', back: body || w.text || '', sectionId: sec.id, notebookId: sec.notebookId });
    } else if (await boostSection(sec)) {
      toast(`${sec.title} è da ripassare oggi, con intervalli più brevi`);
    }
  });
}

/* ---------- Simulazione d’esame ---------- */
let examRun = null;
let examTimer = null;
let examStepOff = null;
function examScope(nbId, gid) {
  const nb = nbById(nbId);
  if (!nb) return null;
  const g = gid ? groupsOf(nb).find(x => x.id === gid) : null;
  const ids = g ? new Set([g.id, ...subGroups(nb, g).map(x => x.id)]) : null;
  const secs = secsOf(nb.id).filter(s => !ids || ids.has(s.groupId));
  return { nb, g, secs, key: `${nb.id}/${g ? g.id : ''}`, name: g ? `${nb.name} › ${g.name}` : nb.name };
}
function examPool(sc, types) {
  const bySec = new Map();
  const add = (sid, it) => { if (!bySec.has(sid)) bySec.set(sid, []); bySec.get(sid).push(it); };
  const secIds = new Set(sc.secs.map(s => s.id));
  for (const s of sc.secs) {
    if (types.q) (s.questions || []).forEach(q => { if (q.q) add(s.id, { t: 'q', sid: s.id, q: q.q, a: q.a || '' }); });
    if (types.c) clozeCardsFromMd(s.md).forEach(c => add(s.id, { t: 'c', sid: s.id, q: c.front, a: c.back }));
  }
  if (types.f) state.cards.filter(c => !c.suspended && secIds.has(c.sectionId)).forEach(c => add(c.sectionId, { t: 'f', sid: c.sectionId, cid: c.id }));
  return bySec;
}
// pesca a turno da ogni sezione, così l’esame copre tutto il programma
function examSample(bySec, n) {
  const lists = shuffleArr([...bySec.values()].map(shuffleArr));
  const out = [];
  while (out.length < n && lists.some(l => l.length)) lists.forEach(l => { if (l.length && out.length < n) out.push(l.pop()); });
  return shuffleArr(out);
}
const fmtClock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function viewExam(nbId, gid) {
  const sc = examScope(nbId, gid);
  if (!sc) return notFound('Questo notebook');
  if (examRun && examRun.key === sc.key) return examRun.done ? examResults(sc) : examStep(sc);
  const st = S();
  const types = st.examTypes || { q: true, c: true, f: true };
  const pool = examPool(sc, { q: true, c: true, f: true });
  const counts = { q: 0, c: 0, f: 0 };
  pool.forEach(l => l.forEach(it => { counts[it.t]++; }));
  const past = (Stats.load().exams || []).filter(x => x.key === sc.key).slice(-5).reverse();
  setView(`
    <a class="back" href="#/nb/${sc.nb.id}">${esc(sc.nb.name)}</a>
    <header class="page-head"><div><h1>Simulazione d’esame</h1>
      <p class="lede">${esc(sc.name)}: ${sc.secs.length} ${sc.secs.length === 1 ? 'sezione' : 'sezioni'}. Domande pescate a caso da tutto il programma, senza toccare i ripassi programmati.</p></div></header>
    ${counts.q + counts.c + counts.f ? `
    <section class="block exam-setup">
      <div class="field"><span class="lbl">Cosa includere</span>
        <label class="check"><input type="checkbox" id="exQ" ${types.q ? 'checked' : ''} ${counts.q ? '' : 'disabled'}><span>Domande per il richiamo (${counts.q})</span></label>
        <label class="check"><input type="checkbox" id="exC" ${types.c ? 'checked' : ''} ${counts.c ? '' : 'disabled'}><span>Frasi con cloze (${counts.c})</span></label>
        <label class="check"><input type="checkbox" id="exF" ${types.f ? 'checked' : ''} ${counts.f ? '' : 'disabled'}><span>Flashcard (${counts.f})</span></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Quante domande</span><select class="input" id="exN">${[10, 20, 30, 50].map(n => `<option value="${n}" ${n === (st.examN || 20) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field"><span>Tempo</span><select class="input" id="exT">${[[0, 'Senza limite'], [10, '10 minuti'], [20, '20 minuti'], [30, '30 minuti'], [60, '1 ora']].map(([v, l]) => `<option value="${v}" ${v === (st.examT ?? 0) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <button class="btn primary big" data-act="ex-start">Inizia la simulazione</button>
    </section>` : '<div class="empty"><p>Qui non ci sono ancora domande, cloze o flashcard da cui pescare.</p></div>'}
    ${past.length ? `<h2 class="sub">Ultime simulazioni</h2><ul class="list">${past.map(x => `<li class="row"><span class="row-main"><span class="row-title">${x.score}%</span><span class="row-sub">${esc(new Date(x.d + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }))}, ${x.n} domande</span></span></li>`).join('')}</ul>` : ''}`);
  on('[data-act="ex-start"]', 'click', () => {
    const t = { q: $('#exQ').checked, c: $('#exC').checked, f: $('#exF').checked };
    if (!t.q && !t.c && !t.f) { toast('Scegli almeno un tipo di domanda'); return; }
    const n = +$('#exN').value;
    const mins = +$('#exT').value;
    Object.assign(S(), { examTypes: t, examN: n, examT: mins });
    Settings.save();
    const items = examSample(examPool(sc, t), n);
    if (!items.length) { toast('Nessuna domanda con queste scelte'); return; }
    examRun = { key: sc.key, items, i: 0, res: [], revealed: false, start: Date.now(), limit: mins * 60000, done: false };
    examStep(sc);
  });
}
function examStep(sc) {
  if (examStepOff) examStepOff();
  const run = examRun;
  if (run.i >= run.items.length) return examFinish(sc);
  const it = run.items[run.i];
  const card = it.t === 'f' ? state.cards.find(c => c.id === it.cid) : null;
  if (it.t === 'f' && !card) { run.i++; return examStep(sc); }
  const s = secById(it.sid);
  const label = { q: 'Domanda', c: 'Completa', f: 'Flashcard' }[it.t];
  setView(`
    <div class="exam-head">
      <a class="back" href="#/nb/${sc.nb.id}">${esc(sc.name)}</a>
      <span class="exam-pos">${run.i + 1} di ${run.items.length}</span>
      ${run.limit ? `<span class="exam-clock" id="exClock">${fmtClock(run.limit - (Date.now() - run.start))}</span>` : ''}
    </div>
    <div class="exam-bar"><i style="width:${(run.i / run.items.length * 100).toFixed(1)}%"></i></div>
    <article class="qcard exam-card">
      <p class="qnum">${label}</p>
      ${card ? `<div class="fcard-in">${cardFaceHtml(card, run.revealed)}</div>` : `<div class="q notes">${renderMd(it.q)}</div>`}
      ${!card && SpeechRec && !run.revealed ? `<div class="q-voice"><button class="btn sm mic-sm" type="button" data-act="qmic" aria-pressed="false">${MIC_SVG}<span>Rispondi a voce</span></button></div><p class="my-answer" hidden></p>` : ''}
      ${run.revealed && !card ? `<div class="a"><article class="notes">${renderMd(it.a || '_Nessuna risposta salvata._')}</article></div>` : ''}
      ${run.revealed && s ? `<p class="source">Da <a href="#/sec/${s.id}/read">${esc(s.title)}</a></p>` : ''}
    </article>
    <div class="exam-acts">
      ${run.revealed ? `
        <button class="btn wrong" data-ex="0">Sbagliata</button>
        <button class="btn" data-ex="0.5">In parte</button>
        <button class="btn right" data-ex="1">Giusta</button>` : '<button class="btn primary big" data-act="ex-show">Mostra la risposta</button>'}
    </div>
    <p class="hint exam-hint">Spazio mostra la risposta, 1, 2 e 3 per valutarti. <button class="link-btn" data-act="ex-stop">Termina ora</button></p>`);
  let dict = null;
  const qm = $('[data-act="qmic"]');
  if (qm) {
    const out = $('.my-answer');
    let said = '';
    dict = createDictation({
      onText: t => { said = `${said} ${t}`.trim(); out.hidden = false; out.textContent = said; },
      onInterim: t => { if (t) { out.hidden = false; out.textContent = `${said} ${t}`.trim(); } },
      onState: v => { qm.setAttribute('aria-pressed', v); $('span', qm).textContent = v ? 'Stop' : 'Rispondi a voce'; }
    });
    qm.addEventListener('click', () => (dict.on ? dict.stop() : dict.start()));
  }
  const show = () => { if (dict) dict.stop(); run.revealed = true; examStep(sc); };
  const grade = v => { run.res.push({ sid: it.sid, v }); run.i++; run.revealed = false; examStep(sc); };
  on('[data-act="ex-show"]', 'click', show);
  on('[data-ex]', 'click', e => grade(+e.currentTarget.dataset.ex));
  on('[data-act="ex-stop"]', 'click', async () => {
    const ok = await modal({ title: 'Terminare la simulazione?', text: 'Le domande a cui non hai risposto non contano nel punteggio.', confirm: 'Termina' });
    if (ok) examFinish(sc);
  });
  const onKey = e => {
    if ($('#modalRoot').children.length || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    if (!run.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); show(); }
    else if (run.revealed && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); grade([0, 0.5, 1][+e.key - 1]); }
  };
  document.addEventListener('keydown', onKey);
  clearInterval(examTimer);
  if (run.limit) {
    examTimer = setInterval(() => {
      const left = run.limit - (Date.now() - run.start);
      const c = $('#exClock');
      if (c) { c.textContent = fmtClock(left); c.classList.toggle('low', left < 60000); }
      if (left <= 0) { clearInterval(examTimer); toast('Tempo scaduto'); examFinish(sc); }
    }, 1000);
  }
  examStepOff = () => { document.removeEventListener('keydown', onKey); clearInterval(examTimer); if (dict) dict.stop(); examStepOff = null; };
  addCleanup(() => examStepOff && examStepOff());
  $('[data-act="ex-show"]')?.focus({ preventScroll: true });
}
function examFinish(sc) {
  const run = examRun;
  if (!run || run.done) return examResults(sc);
  run.done = true;
  run.end = Date.now();
  const n = run.res.length;
  const score = n ? Math.round(run.res.reduce((a, r) => a + r.v, 0) / n * 100) : 0;
  run.score = score;
  const st = Stats.load();
  st.exams = [...(st.exams || []), { d: todayStr(), key: sc.key, name: sc.name, n, score }].slice(-60);
  Stats.save();
  if (n) Stats.addReview();
  examResults(sc);
}
function examResults(sc) {
  if (examStepOff) examStepOff();
  const run = examRun;
  const per = new Map();
  run.res.forEach(r => { const p = per.get(r.sid) || { ok: 0, n: 0 }; p.ok += r.v; p.n++; per.set(r.sid, p); });
  const rows = [...per.entries()].map(([sid, p]) => ({ s: secById(sid), pct: Math.round(p.ok / p.n * 100), n: p.n })).filter(x => x.s).sort((a, b) => a.pct - b.pct);
  const mins = Math.max(1, Math.round(((run.end || Date.now()) - run.start) / 60000));
  setView(`
    <a class="back" href="#/nb/${sc.nb.id}">${esc(sc.nb.name)}</a>
    <header class="page-head"><div><h1>Risultato</h1><p class="lede">${esc(sc.name)}: ${run.res.length} di ${run.items.length} domande in ${mins} min.</p></div></header>
    <div class="exam-score ${run.score >= 80 ? 'good' : run.score >= 60 ? 'mid' : 'low'}"><b>${run.score}%</b><span>${run.score >= 80 ? 'Pronta per l’esame su questa parte' : run.score >= 60 ? 'Buona base, qualche punto da rinforzare' : 'Da ripassare prima dell’esame'}</span></div>
    ${rows.length ? `
      <h2 class="sub">Sezione per sezione</h2>
      <ul class="exam-rows">${rows.map(x => `
        <li><label class="check"><input type="checkbox" data-boost="${x.s.id}" ${x.pct < 60 && !x.s.studyhub ? 'checked' : ''} ${x.s.studyhub ? 'disabled' : ''}>
          <span class="exam-row-t"><a href="#/sec/${x.s.id}">${esc(x.s.title)}</a><small>${x.n} ${x.n === 1 ? 'domanda' : 'domande'}${x.s.studyhub ? ', pianificata da StudyHub' : ''}</small></span></label>
          <span class="exam-row-bar ${x.pct >= 80 ? 'good' : x.pct >= 60 ? 'mid' : 'low'}" style="--v:${x.pct / 100}"><i></i></span><b>${x.pct}%</b></li>`).join('')}</ul>
      <button class="btn" data-act="ex-boost">Metti da ripassare oggi le sezioni selezionate</button>` : ''}
    <div class="row-actions exam-end">
      <button class="btn primary" data-act="ex-again">Nuova simulazione</button>
      <a class="btn ghost" href="#/nb/${sc.nb.id}">Torna al notebook</a>
    </div>`);
  on('[data-act="ex-again"]', 'click', () => { examRun = null; viewExam(sc.nb.id, sc.g ? sc.g.id : ''); });
  on('[data-act="ex-boost"]', 'click', async () => {
    const ids = $$('[data-boost]:checked').map(i => i.dataset.boost);
    if (!ids.length) { toast('Seleziona almeno una sezione'); return; }
    let k = 0;
    for (const id of ids) { const s = secById(id); if (s && await boostSection(s)) k++; }
    toast(`${k} ${k === 1 ? 'sezione da ripassare' : 'sezioni da ripassare'} oggi`);
  });
}

/* =====================================================================
   v3.13: ricerca unica (appunti, flashcard, PDF, glossario, note cliniche)
   Il testo dei PDF si estrae una volta e resta su questo dispositivo.
   ===================================================================== */
const pdfText = new Map();
let pdfTextLoaded = false;
async function loadPdfText() {
  if (pdfTextLoaded) return;
  pdfTextLoaded = true;
  try { (await DB.all('pdftext')).forEach(r => pdfText.set(r.id, r.pages || [])); } catch { /* archivio non ancora creato */ }
}
const PdfIndex = {
  busy: false,
  waiting: [],
  pending() { return state.pdfs.filter(p => localPdfIds.has(p.id) && !pdfText.has(p.id)); },
  async run(onEach) {
    if (onEach) this.waiting.push(onEach);
    if (this.busy) return;
    this.busy = true;
    try {
      await loadPdfText();
      for (const meta of this.pending()) {
        try {
          await ensurePdfJs();
          const rec = await DB.run('pdfblobs', 'readonly', tx => tx.objectStore('pdfblobs').get(meta.id));
          if (!rec || !rec.blob) continue;
          const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await rec.blob.arrayBuffer()) }).promise;
          const pages = [];
          for (let n = 1; n <= doc.numPages; n++) {
            const tc = await (await doc.getPage(n)).getTextContent();
            pages.push(tc.items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').slice(0, 20000));
          }
          doc.destroy();
          await DB.put('pdftext', { id: meta.id, pages });
          pdfText.set(meta.id, pages);
        } catch { pdfText.set(meta.id, []); }
        this.waiting.forEach(fn => fn());
      }
    } finally {
      this.busy = false;
      this.waiting = [];
    }
  }
};
async function dropPdfText(ids) {
  ids.forEach(id => pdfText.delete(id));
  try { await DB.removeMany(ids.map(id => ['pdftext', id])); } catch { /* già rimosso */ }
}
let pdfPendingHit = null;
function foldSnippet(text, f, len = 70) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const i = foldAccents(t).indexOf(f);
  if (i < 0) return esc(t.slice(0, 120));
  const a = Math.max(0, i - len);
  const b = Math.min(t.length, i + f.length + len);
  return `${a ? '…' : ''}${esc(t.slice(a, i))}<mark class="hit">${esc(t.slice(i, i + f.length))}</mark>${esc(t.slice(i + f.length, b))}${b < t.length ? '…' : ''}`;
}
function moreSearchHtml(q) {
  const f = foldAccents(q);
  if (f.length < 2) return '';
  const out = [];
  // PDF: nome, testo delle pagine, note ed evidenziazioni
  const pdfRows = [];
  for (const p of state.pdfs) {
    const s = secById(p.sectionId);
    const where = esc([s ? nbById(s.notebookId)?.name : '', s ? s.title : ''].filter(Boolean).join(' › '));
    if (foldAccents(p.name).includes(f)) pdfRows.push(`<li><a class="row" href="#/pdf/${p.id}"><span class="pdf-ic sm" aria-hidden="true">PDF</span><span class="row-main"><span class="row-title">${foldSnippet(p.name, f)}</span><span class="row-sub">${where}</span></span></a></li>`);
    let k = 0;
    (pdfText.get(p.id) || []).forEach((t, i) => {
      if (k >= 3 || !foldAccents(t).includes(f)) return;
      k++;
      pdfRows.push(`<li><a class="row" href="#/pdf/${p.id}/${i + 1}" data-hitq="${esc(q)}" data-hitpdf="${p.id}" data-hitp="${i + 1}"><span class="pdf-ic sm" aria-hidden="true">${i + 1}</span><span class="row-main"><span class="row-title">${esc(p.name)}, pagina ${i + 1}</span><span class="row-sub">${foldSnippet(t, f)}</span></span></a></li>`);
    });
    (p.annots || []).filter(a => foldAccents(`${a.text || ''} ${a.note || ''}`).includes(f)).slice(0, 3).forEach(a => {
      pdfRows.push(`<li><a class="row" href="#/pdf/${p.id}/${a.page}"><span class="pdf-ic sm note" aria-hidden="true">✎</span><span class="row-main"><span class="row-title">${esc(p.name)}, pagina ${a.page}: ${a.note ? 'nota' : 'evidenziazione'}</span><span class="row-sub">${foldSnippet(`${a.note || ''} ${a.text || ''}`, f)}</span></span></a></li>`);
    });
    if (pdfRows.length >= 40) break;
  }
  if (pdfRows.length) out.push(`<h2 class="sub">PDF</h2><ul class="list">${pdfRows.join('')}</ul>`);
  const gl = glossary().filter(g => foldAccents(`${g.term} ${g.def}`).includes(f)).slice(0, 20);
  if (gl.length) out.push(`<h2 class="sub">Glossario</h2><ul class="list">${gl.map(g => `<li><button type="button" class="row" data-sgl="${g.id}"><span class="row-main"><span class="row-title">${foldSnippet(g.term, f)}</span><span class="row-sub">${foldSnippet(plainText(g.def, 1e9), f, 50)}</span></span></button></li>`).join('')}</ul>`);
  const cn = clinicalNotes().filter(n => foldAccents(`${n.title} ${(n.symptoms || []).join(' ')} ${n.body || ''}`).includes(f)).slice(0, 20);
  if (cn.length) out.push(`<h2 class="sub">Note cliniche</h2><ul class="list">${cn.map(n => `<li><button type="button" class="row" data-scn="${n.id}"><span class="row-main"><span class="row-title">${foldSnippet(n.title, f)}</span>${(n.symptoms || []).length ? `<span class="tags">${n.symptoms.map(s => `<span class="tag sym ${foldAccents(s).includes(f) ? 'on' : ''}">${esc(s)}</span>`).join('')}</span>` : ''}</span></button></li>`).join('')}</ul>`);
  const todo = PdfIndex.pending().length;
  if (todo) out.push(`<p class="hint">Sto leggendo il testo di ${todo} PDF per poterlo cercare…</p>`);
  return out.join('');
}
// collega un campo di ricerca ai risultati (pagina iniziale e pagina Cerca)
function bindUnifiedSearch(input, out, toHide) {
  let t;
  const run = () => {
    const q = input.value.trim().toLowerCase();
    sessionStorage.setItem('nb-search', input.value);
    if (q.length < 2) { out.hidden = true; if (toHide) toHide.hidden = false; return; }
    const base = searchResultsHtml(q);
    const more = q.startsWith('#') ? '' : moreSearchHtml(q);
    out.innerHTML = more && base.includes('Nessun risultato') ? more : base + more;
    out.hidden = false;
    if (toHide) toHide.hidden = true;
    if (!q.startsWith('#') && PdfIndex.pending().length) PdfIndex.run(() => { if (input.isConnected && input.value.trim().toLowerCase() === q) run(); });
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 180); });
  out.addEventListener('click', e => {
    const g = e.target.closest('[data-sgl]');
    if (g) { showGlossaryEntry(g.dataset.sgl); return; }
    const c = e.target.closest('[data-scn]');
    if (c) { showClinicNote(c.dataset.scn); return; }
    const h = e.target.closest('[data-hitq]');
    if (h) pdfPendingHit = { id: h.dataset.hitpdf, n: +h.dataset.hitp, q: h.dataset.hitq };
  });
  loadPdfText().then(() => { const last = sessionStorage.getItem('nb-search'); if (last && !input.value) input.value = last; if (input.value) run(); });
}
function viewSearch() {
  setView(`
    <header class="page-head"><div><h1>Cerca</h1><p class="lede">In appunti, flashcard, testo dei PDF, glossario e note cliniche. Con <code>#</code> cerchi tra i tag.</p></div></header>
    <input type="search" class="input search" id="allSearch" placeholder="Cosa cerchi?" aria-label="Cerca ovunque" autofocus>
    <div id="allOut" hidden></div>`);
  bindUnifiedSearch($('#allSearch'), $('#allOut'), null);
  setTimeout(() => $('#allSearch')?.focus(), 50);
}

/* =====================================================================
   v3.14: backup completo
   Formato .nbbackup: "NBBK1\n" + lunghezza dell’intestazione (12 cifre) +
   "\n" + intestazione JSON + i file (immagini e PDF) uno dopo l’altro,
   così anche PDF grandi si salvano e si ripristinano senza convertirli.
   Si importano ancora i vecchi backup .json.
   ===================================================================== */
const BK_MAGIC = 'NBBK1\n';
async function buildBackup(withPdf) {
  const files = [];
  const parts = [];
  let off = 0;
  const addFile = (kind, id, blob) => {
    files.push({ kind, id, mime: blob.type || (kind === 'pdf' ? 'application/pdf' : 'image/webp'), size: blob.size, off });
    parts.push(blob);
    off += blob.size;
  };
  const images = [];
  for (const im of state.images) {
    if (!im.blob) continue;
    const { blob, ...meta } = im;
    images.push(meta);
    addFile('image', im.id, blob);
  }
  if (withPdf) {
    for (const p of state.pdfs) {
      const rec = await DB.run('pdfblobs', 'readonly', tx => tx.objectStore('pdfblobs').get(p.id));
      if (rec && rec.blob) addFile('pdf', p.id, rec.blob);
    }
  }
  let folds = {};
  try { folds = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'); } catch { /* niente */ }
  const st = S();
  const prefs = {};
  ['theme', 'readFont', 'readSize', 'readSpacing', 'pagesPerSection', 'newPerDay', 'aiCloze', 'aiQuestions', 'showImages', 'keepPdfImages'].forEach(k => { if (st[k] !== undefined) prefs[k] = st[k]; });
  const header = {
    app: 'studyhub-notebook', version: 5, exported: new Date().toISOString(), appVersion: APP_VERSION,
    notebooks: state.notebooks, sections: state.sections, cards: state.cards, links: state.links,
    pdfs: state.pdfs, images, stats: Stats.load(), folds, prefs, files
  };
  const hb = new TextEncoder().encode(JSON.stringify(header));
  const blob = new Blob([BK_MAGIC, String(hb.length).padStart(12, '0') + '\n', hb, ...parts], { type: 'application/octet-stream' });
  return { blob, name: `notebook-${withPdf ? 'completo' : 'senza-pdf'}-${todayStr()}.nbbackup` };
}
async function readBackup(file) {
  const head = await file.slice(0, 19).text();
  if (head.startsWith(BK_MAGIC)) {
    const len = parseInt(head.slice(6, 18), 10);
    if (!(len > 0)) throw new Error('Backup danneggiato');
    const data = JSON.parse(await file.slice(19, 19 + len).text());
    if (data.app !== 'studyhub-notebook') throw new Error('Questo file non è un backup del Notebook.');
    return { data, files: Array.isArray(data.files) ? data.files : [], file, base: 19 + len };
  }
  const data = JSON.parse(await file.text());
  if (data.app !== 'studyhub-notebook' || !Array.isArray(data.notebooks) || !Array.isArray(data.sections)) throw new Error('Questo file non è un backup del Notebook.');
  return { data, files: [], file: null, base: 0 };
}
async function restoreBackup(bk) {
  const d = bk.data;
  const now = Date.now();
  const nbs = (d.notebooks || []).filter(n => n && n.id).map(n => ({ ...n, updated: now }));
  const secs = (d.sections || []).filter(s => s && s.id && s.notebookId).map(s => ({ ...normalizeRecord('sections', s), updated: now }));
  const cards = (Array.isArray(d.cards) ? d.cards : []).filter(c => c && c.id && c.notebookId).map(c => ({ ...normalizeRecord('cards', c), updated: now }));
  // link utili, glossario, note cliniche e prompt stanno tutti nell’archivio dei link
  const links = (Array.isArray(d.links) ? d.links : []).filter(l => l && l.id && (l.url || l.kind)).map(l => ({ ...l, notebookId: l.notebookId || '_links', updated: now }));
  const pdfs = (Array.isArray(d.pdfs) ? d.pdfs : []).filter(p => p && p.id).map(p => ({ ...p, updated: now }));
  // immagini: vecchio formato in base64, nuovo formato come file
  const fileOf = (kind, id) => bk.files.find(f => f.kind === kind && f.id === id);
  const slice = f => bk.file.slice(bk.base + f.off, bk.base + f.off + f.size, f.mime);
  const images = (Array.isArray(d.images) ? d.images : []).filter(i => i && i.id).map(({ data: b64, ...meta }) => {
    if (b64) return { ...meta, blob: base64ToBlob(b64, meta.mime), updated: now };
    const f = bk.file && fileOf('image', meta.id);
    return f ? { ...meta, blob: slice(f), updated: now } : null;
  }).filter(Boolean);
  await DB.bulkPut('images', images);
  images.forEach(i => forgetImageUrl(i.id));
  await DB.bulkPut('links', links);
  await DB.bulkPut('notebooks', nbs);
  await DB.bulkPut('sections', secs);
  await DB.bulkPut('cards', cards);
  await DB.bulkPut('pdfs', pdfs);
  for (const f of bk.files.filter(x => x.kind === 'pdf')) {
    await DB.put('pdfblobs', { id: f.id, blob: slice(f) });
    localPdfIds.add(f.id);
    pdfText.delete(f.id);
  }
  // statistiche: per ogni giorno tengo il valore più alto
  if (d.stats && d.stats.d) {
    const st = Stats.load();
    Object.entries(d.stats.d).forEach(([day, v]) => {
      const cur = st.d[day];
      if (!cur) { st.d[day] = v; return; }
      cur.t = Math.max(cur.t || 0, v.t || 0);
      cur.r = Math.max(cur.r || 0, v.r || 0);
      Object.entries(v.nb || {}).forEach(([id, t]) => { cur.nb[id] = Math.max(cur.nb[id] || 0, t); });
    });
    const seen = new Set((st.exams || []).map(x => `${x.d}|${x.key}|${x.score}|${x.n}`));
    st.exams = [...(st.exams || []), ...(d.stats.exams || []).filter(x => !seen.has(`${x.d}|${x.key}|${x.score}|${x.n}`))].slice(-60);
    Stats.save();
  }
  if (d.folds && typeof d.folds === 'object') {
    try { localStorage.setItem(FOLD_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'), ...d.folds })); } catch { /* niente */ }
  }
  if (d.prefs && typeof d.prefs === 'object') { Object.assign(S(), d.prefs); Settings.save(); applyTheme(); }
  state.notebooks = await DB.all('notebooks');
  state.sections = await DB.all('sections');
  state.cards = await DB.all('cards');
  state.images = await DB.all('images');
  state.links = await DB.all('links');
  state.pdfs = await DB.all('pdfs');
  updateBadge();
  scheduleSync();
  setTimeout(() => { PdfCloud.uploadPending(); PdfIndex.run(); }, 1500);
}

/* =====================================================================
   v3.15: ascolto delle sezioni, previsione dei ripassi, sanguisughe
   ===================================================================== */
const LEECH = 6;
const LEECH_TAG = 'sanguisuga';
const isLeech = c => (c.srs && c.srs.lapses >= LEECH) || tagsOf(c).includes(LEECH_TAG);

/* ---------- Ascolto: il telefono legge la sezione ---------- */
function pickItalianVoice() {
  const vs = canSpeak ? speechSynthesis.getVoices() : [];
  return vs.find(v => /^it[-_]IT/i.test(v.lang) && /google/i.test(v.name)) || vs.find(v => /^it/i.test(v.lang)) || null;
}
function setupListen(article, btn, folds) {
  if (!article || !btn || !canSpeak) return;
  btn.hidden = false;
  const blocks = () => $$('h1, h2, h3, h4, p, li, tr, blockquote, pre', article).filter(el => {
    if (el.closest('.html-embed, .img-box, pre code') && el.tagName !== 'PRE') return false;
    if (el.tagName === 'LI' && el.querySelector('li')) return !!el.firstChild?.textContent?.trim();
    if (el.tagName === 'P' && el.closest('li, blockquote')) return false;
    return el.textContent.trim().length > 0;
  });
  const textOf = el => {
    if (el.tagName === 'TR') return [...el.children].map(td => td.textContent.trim()).filter(Boolean).join('; ');
    if (el.tagName === 'LI') { const c = el.cloneNode(true); c.querySelectorAll('ul, ol').forEach(x => x.remove()); return c.textContent.trim(); }
    const c = el.cloneNode(true);
    c.querySelectorAll('button, .czm-btn').forEach(x => x.remove());
    return c.textContent.replace(/\s+/g, ' ').trim();
  };
  let list = [];
  let i = 0;
  let playing = false;
  let wake = null;
  let token = 0;
  const bar = document.createElement('div');
  bar.className = 'ink-bar tts-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Ascolto');
  bar.innerHTML = `
    <button type="button" class="btn sm ghost" data-tts="prev" aria-label="Paragrafo precedente">⏮</button>
    <button type="button" class="btn sm primary tts-play" data-tts="play">Pausa</button>
    <button type="button" class="btn sm ghost" data-tts="next" aria-label="Paragrafo successivo">⏭</button>
    <select class="input ink-size" data-tts-rate aria-label="Velocità">${[0.8, 1, 1.2, 1.4, 1.7].map(r => `<option value="${r}">${String(r).replace('.', ',')}×</option>`).join('')}</select>
    <span class="tts-pos" aria-live="polite"></span>
    <button type="button" class="btn sm ghost" data-tts="stop">Chiudi</button>`;
  document.body.append(bar);
  $('[data-tts-rate]', bar).value = String(S().ttsRate || 1);
  const mark = () => {
    $$('.tts-cur', article).forEach(x => x.classList.remove('tts-cur'));
    const el = list[i];
    if (!el) return;
    if (folds) folds.reveal(el);
    el.classList.add('tts-cur');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    $('.tts-pos', bar).textContent = `${i + 1}/${list.length}`;
  };
  const speakCur = () => {
    const my = ++token;
    speechSynthesis.cancel();
    const el = list[i];
    if (!el) { stop(); toast('Fine della sezione'); return; }
    mark();
    const u = new SpeechSynthesisUtterance(textOf(el));
    u.lang = 'it-IT';
    const v = pickItalianVoice();
    if (v) u.voice = v;
    u.rate = +(S().ttsRate || 1);
    u.onend = () => { if (my !== token || !playing) return; i++; speakCur(); };
    u.onerror = e => { if (my === token && e.error !== 'interrupted' && e.error !== 'canceled') { i++; if (playing) speakCur(); } };
    speechSynthesis.speak(u);
  };
  const keepAwake = async on => {
    try {
      if (on && !wake && navigator.wakeLock) wake = await navigator.wakeLock.request('screen');
      if (!on && wake) { await wake.release(); wake = null; }
    } catch { wake = null; }
  };
  const setPlay = v => {
    playing = v;
    $('.tts-play', bar).textContent = v ? 'Pausa' : 'Riprendi';
    keepAwake(v);
    if (v) speakCur(); else { token++; speechSynthesis.cancel(); }
  };
  const start = from => {
    list = blocks();
    if (!list.length) { toast('Niente da leggere in questa sezione'); return; }
    i = Math.max(0, list.indexOf(from));
    bar.hidden = false;
    btn.classList.add('on');
    article.classList.add('tts-on');
    setPlay(true);
  };
  function stop() {
    playing = false;
    token++;
    speechSynthesis.cancel();
    keepAwake(false);
    bar.hidden = true;
    btn.classList.remove('on');
    article.classList.remove('tts-on');
    $$('.tts-cur', article).forEach(x => x.classList.remove('tts-cur'));
  }
  btn.addEventListener('click', () => (bar.hidden ? start(null) : stop()));
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-tts]');
    if (!b) return;
    const a = b.dataset.tts;
    if (a === 'play') setPlay(!playing);
    if (a === 'stop') stop();
    if (a === 'prev' || a === 'next') { i = Math.max(0, Math.min(list.length - 1, i + (a === 'next' ? 1 : -1))); if (playing) speakCur(); else mark(); }
  });
  $('[data-tts-rate]', bar).addEventListener('change', e => { S().ttsRate = +e.target.value; Settings.save(); if (playing) speakCur(); });
  // con l’ascolto aperto, toccando un paragrafo si riparte da lì
  article.addEventListener('click', e => {
    if (bar.hidden || e.target.closest('a, button, .gl, img, mark.cz, .notes-ink')) return;
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return;
    const el = list.find(x => x.contains(e.target));
    if (el) { i = list.indexOf(el); if (playing) speakCur(); else mark(); }
  });
  const onVis = () => { if (document.visibilityState === 'visible' && playing) keepAwake(true); };
  document.addEventListener('visibilitychange', onVis);
  addCleanup(() => { stop(); bar.remove(); document.removeEventListener('visibilitychange', onVis); });
}

/* ---------- Previsione dei ripassi (30 giorni) ---------- */
function forecastHtml(idx) {
  const today = todayStr();
  const days = Array.from({ length: 30 }, (_, k) => addDays(today, k));
  const vals = days.map(d => { const x = idx[d]; return x ? x.secs.length + x.cards : 0; });
  const max = Math.max(1, ...vals);
  const total = vals.reduce((a, b) => a + b, 0);
  const peak = vals.indexOf(max);
  const week = vals.slice(0, 7).reduce((a, b) => a + b, 0);
  return `
    <h2 class="sub">Prossimi 30 giorni</h2>
    <p class="hint fc-sum">${total ? `${total} ripassi in programma, ${week} nei prossimi 7 giorni.${max > 1 ? ` Il giorno più carico è ${peak === 0 ? 'oggi' : new Date(days[peak] + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })} con ${max}.` : ''}` : 'Nessun ripasso in programma nei prossimi 30 giorni.'} Tocca una colonna per vedere il giorno.</p>
    <div class="bars fc-bars" role="img" aria-label="Ripassi in programma nei prossimi 30 giorni">
      ${days.map((d, k) => `<button type="button" class="bar fc-bar ${k === 0 ? 'is-today' : ''} ${vals[k] === max && max > 1 ? 'peak' : ''}" data-fc="${d}" style="--v:${(vals[k] / max).toFixed(3)}" title="${esc(d)}: ${vals[k]}" aria-label="${new Date(d + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}: ${vals[k]} ripassi"><i></i><small>${k % 7 === 0 ? new Date(d + 'T12:00').getDate() : ''}</small></button>`).join('')}
    </div>`;
}

/* =====================================================================
   v3.16: modalità esame
   Un esame attivo raccoglie alcuni notebook (e/o un tag), alza il limite
   di flashcard nuove per quei notebook e ha il suo pulsante di studio.
   Si salva con i link, quindi vale su tutti i dispositivi.
   ===================================================================== */
const examRec = () => state.links.find(l => l.kind === 'exam' && l.active);
const examNbIds = ex => new Set((ex && ex.nbIds) || []);
function inExam(x, ex = examRec()) {
  if (!ex) return false;
  if (examNbIds(ex).has(x.notebookId)) return true;
  if (ex.tag) {
    if (tagsOf(x).includes(ex.tag)) return true;
    const s = x.sectionId ? secById(x.sectionId) : null;
    if (s && tagsOf(s).includes(ex.tag)) return true;
  }
  return false;
}
const examDaysLeft = ex => (ex && ex.date ? Math.round((new Date(ex.date + 'T12:00') - new Date(todayStr() + 'T12:00')) / 86400000) : null);
function examBannerHtml(where) {
  const ex = examRec();
  if (!ex) return '';
  const cc = cardCounts(state.cards.filter(c => inExam(c, ex)));
  const nCards = cc.n + cc.l + cc.r;
  const nSecs = state.sections.filter(s => inExam(s, ex) && isDue(s)).length;
  const left = examDaysLeft(ex);
  return `
    <div class="exam-mode">
      <div class="exam-mode-main">
        <b>Modalità esame: ${esc(ex.name)}</b>
        <span>${left === null ? '' : left > 1 ? `tra ${left} giorni, ` : left === 1 ? 'domani, ' : left === 0 ? 'oggi, ' : 'data passata, '}${nCards} flashcard e ${nSecs} ${nSecs === 1 ? 'sezione' : 'sezioni'} da fare</span>
      </div>
      <div class="exam-mode-acts">
        ${nCards ? '<a class="btn sm primary" href="#/study/exam">Studia l’esame</a>' : ''}
        ${where !== 'review-exam' && nSecs ? '<a class="btn sm" href="#/review/exam">Sezioni dell’esame</a>' : ''}
        <button class="btn sm ghost" type="button" data-act="exam-edit">Modifica</button>
      </div>
    </div>`;
}
function bindExamBanner() {
  on('[data-act="exam-edit"]', 'click', async () => { if (await examModeSheet()) route(); });
  on('[data-act="exam-new"]', 'click', async () => { if (await examModeSheet()) route(); });
}
function examModeSheet() {
  return new Promise(resolve => {
    const ex = examRec();
    const e = ex || {};
    const nbs = [...state.notebooks].sort((a, b) => a.created - b.created);
    const sel = examNbIds(e);
    const sh = openSheet(`
      <h2>${ex ? 'Modalità esame' : 'Attiva la modalità esame'}</h2>
      <p class="sheet-sub">Studi solo le materie dell’esame, con più flashcard nuove al giorno.</p>
      <div class="grid2">
        <label class="field"><span>Esame</span><input class="input" id="exName" value="${esc(e.name || '')}" placeholder="Es. Fisiologia I"></label>
        <label class="field"><span>Data (facoltativa)</span><input class="input" type="date" id="exDate" value="${esc(e.date || '')}"></label>
      </div>
      <div class="field"><span class="lbl">Notebook dell’esame</span>
        ${nbs.map(nb => `<label class="check"><input type="checkbox" value="${nb.id}" ${sel.has(nb.id) ? 'checked' : ''}><span>${esc(nb.name)}</span></label>`).join('') || '<p class="hint">Nessun notebook.</p>'}
      </div>
      <div class="grid2">
        <label class="field"><span>Oppure anche un tag</span><input class="input" id="exTag" value="${esc(e.tag ? `#${e.tag}` : '')}" placeholder="#esame-fisiologia" autocapitalize="off"></label>
        <label class="field"><span>Flashcard nuove al giorno</span><input class="input" type="number" id="exNew" min="0" max="500" inputmode="numeric" value="${e.newPerDay ?? Math.max(50, +S().newPerDay || 20)}"></label>
      </div>
      <div class="modal-actions">
        ${ex ? '<button class="btn ghost danger" type="button" data-ex-act="end">Termina la modalità esame</button>' : ''}
        <button class="btn ghost" type="button" data-ex-act="no">Annulla</button>
        <button class="btn primary" type="button" data-ex-act="ok">${ex ? 'Salva' : 'Attiva'}</button>
      </div>`, { label: 'Modalità esame', onClose: resolve });
    $('[data-ex-act="no"]', sh.el).onclick = () => sh.close(false);
    const end = $('[data-ex-act="end"]', sh.el);
    if (end) end.onclick = async () => { ex.active = false; await saveLink(ex); toast('Modalità esame terminata'); sh.close(true); };
    $('[data-ex-act="ok"]', sh.el).onclick = async () => {
      const name = $('#exName', sh.el).value.trim();
      const nbIds = $$('.check input:checked', sh.el).map(i => i.value);
      const tag = normTag($('#exTag', sh.el).value);
      if (!name) { toast('Scrivi il nome dell’esame'); $('#exName', sh.el).focus(); return; }
      if (!nbIds.length && !tag) { toast('Scegli almeno un notebook o un tag'); return; }
      const rec = ex || { id: '_exam', kind: 'exam', notebookId: '_exam', created: Date.now() };
      Object.assign(rec, { name, date: $('#exDate', sh.el).value || '', nbIds, tag, newPerDay: Math.max(0, Math.min(500, Math.round(+$('#exNew', sh.el).value || 0))), active: true });
      await saveLink(rec);
      toast(ex ? 'Modalità esame aggiornata' : `Modalità esame attiva: ${name}`);
      sh.close(true);
    };
  });
}

/* ---------- Suggerimenti dei cloze: trovare il cloze giusto nel testo ---------- */
function clozeMatches(md) {
  const fences = [...md.matchAll(/^```html[ \t]*\n[\s\S]*?\n?```[ \t]*$/gim)].map(m => [m.index, m.index + m[0].length]);
  return [...md.matchAll(clozeRe())]
    .filter(m => !fences.some(([a, b]) => m.index >= a && m.index < b))
    .map(m => ({ start: m.index, end: m.index + m[0].length, inner: m[1] }));
}
// l’n-esimo cloze degli appunti, controllando che il testo coincida
function clozeMatchFor(md, idx, shown) {
  const list = clozeMatches(md);
  const plain = s => stripMarks(splitHint(s)[0]).replace(/[*_`~]/g, '').trim();
  const want = String(shown || '').trim();
  if (list[idx] && plain(list[idx].inner) === want) return list[idx];
  return list.find(x => plain(x.inner) === want) || null;
}
function clozeAround(text, pos) {
  return clozeMatches(text).find(x => pos >= x.start && pos <= x.end) || null;
}

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
    state.links = await DB.all('links');
    state.pdfs = await DB.all('pdfs');
    await loadLocalPdfIds();
    await ensureDefaultLinks();
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
  const obs = new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { hydrateImages(n); hydrateHtmlBlocks(n); } })));
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
  Tracker.start();
  const sharedFile = await takeSharedFile();
  const shared = sharedFile || takeSharedText();
  route();
  if (shared === 'pdf') toast('PDF ricevuto: scegli il notebook e le pagine');
  else if (shared) toast('Testo ricevuto: scegli il notebook e crea le sezioni');
  if (Sync.configured()) Sync.run({ silent: true });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') init();
