'use strict';
/* StudyHub Notebook — 01-base.js
   Base: utilità, database, impostazioni, stato, testo e Markdown, AI, interfaccia comune, router, immagini, tag, collegamenti, ricerca, sincronizzazione, backup.
   I moduli si caricano in ordine (vedi index.html) e condividono le stesse variabili globali. */

/* =====================================================================
   StudyHub Notebook v1.0
   Notebook di studio: importazione da testo o PDF, formattazione con AI
   (Gemini o Claude), active recall (cloze, pagina bianca, domande) e
   ripetizione dilazionata SM-2.
   ===================================================================== */

const APP_VERSION = '3.83';
// v3.60: l’app aperta dentro Affianca per mostrare il lettore PDF completo
const EMBED = /[?&]embed=1\b/.test(location.search);
const DB_NAME = 'studyhub-notebook';
const CHUNK_CHARS = 12000;          // caratteri massimi per sezione dal testo incollato
const MAX_PDF_B64 = 24 * 1024 * 1024; // ~18 MB di PDF dopo la codifica base64

// v3.74: le librerie sono dentro l’app (cartella lib): non serve internet per usarle
const LIBS = {
  pdfjs: 'lib/pdf.min.mjs',
  pdfjsWorker: 'lib/pdf.worker.min.mjs',
  pdflib: 'lib/pdf-lib.min.js',
  jszip: 'lib/jszip.min.js',
  // solo se il browser è troppo vecchio per il lettore PDF nuovo
  pdfjsOld: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfjsOldWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
};
const libUrl = p => new URL(p, document.baseURI).href;

/* ---------------------------------------------------------------------
   Utilità
   --------------------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Gomma della penna: pulsante laterale tenuto premuto (S Pen) o estremità con la gomma
// (Staedtler Noris digital, penne Wacom e Surface). Vale per tutto il tratto.
const penErases = e => e.pointerType === 'pen' && ((e.buttons & 32) === 32 || e.button === 5 || (e.buttons & 2) === 2 || e.button === 2);
// Tocco con due dita = annulla, come nelle app di appunti (utile con Apple Pencil, che non ha gomma)
function twoFingerTap(el, onTap, when = () => true) {
  let t = null;
  el.addEventListener('touchstart', e => {
    if (e.touches.length === 2 && when()) t = { at: Date.now(), pts: [...e.touches].map(x => [x.clientX, x.clientY]), moved: false };
    else if (e.touches.length > 2) t = null;
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!t) return;
    [...e.touches].forEach((x, i) => { const p = t.pts[i]; if (p && Math.hypot(x.clientX - p[0], x.clientY - p[1]) > 12) t.moved = true; });
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (!t || e.touches.length) return;
    const ok = !t.moved && Date.now() - t.at < 350;
    t = null;
    if (ok) onTap();
  }, { passive: true });
}

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
/* v3.60: più finestre dell’app insieme (il lettore PDF in Affianca, o due schede):
   ogni salvataggio avvisa le altre, che rileggono quei record e restano aggiornate,
   così nessuna sovrascrive le modifiche dell’altra con dati vecchi. */
const Live = {
  ch: null,
  me: Math.random().toString(36).slice(2),
  STORES: new Set(['notebooks', 'sections', 'cards', 'links', 'pdfs', 'images']),
  init() {
    if (typeof BroadcastChannel === 'undefined') return;
    try { this.ch = new BroadcastChannel('nb-live'); } catch { return; }
    this.ch.onmessage = e => this.receive(e.data);
  },
  tell(store, ids, del = false) {
    if (!this.ch || !this.STORES.has(store) || !ids.length) return;
    try { this.ch.postMessage({ from: this.me, store, ids, del }); } catch { /* niente */ }
  },
  async receive(m) {
    if (!m || m.from === this.me || !this.STORES.has(m.store) || !Array.isArray(state[m.store])) return;
    const list = state[m.store];
    if (m.del) state[m.store] = list.filter(x => !m.ids.includes(x.id));
    else {
      for (const id of m.ids) {
        let rec = null;
        try { rec = await DB.run(m.store, 'readonly', tx => tx.objectStore(m.store).get(id)); } catch { rec = null; }
        if (!rec) continue;
        const cur = state[m.store].find(x => x.id === id);
        // stesso oggetto di prima, aggiornato: chi lo sta usando vede subito i dati nuovi
        if (cur) { Object.keys(cur).forEach(k => { if (!(k in rec)) delete cur[k]; }); Object.assign(cur, rec); }
        else state[m.store].push(rec);
      }
    }
    if (!EMBED) { updateBadge(); scheduleSync(); }
    window.dispatchEvent(new CustomEvent('nb-live', { detail: m }));
  }
};
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
  put(store, obj) { return this.run(store, 'readwrite', tx => tx.objectStore(store).put(obj)).then(r => { Live.tell(store, [obj.id]); return r; }); },
  del(store, id) { return this.run(store, 'readwrite', tx => tx.objectStore(store).delete(id)).then(r => { Live.tell(store, [id], true); return r; }); },
  bulkPut(store, arr) { return this.run(store, 'readwrite', tx => { const st = tx.objectStore(store); arr.forEach(o => st.put(o)); }).then(r => { Live.tell(store, arr.map(o => o.id)); return r; }); },
  removeMany(pairs) {
    const stores = [...new Set(pairs.map(p => p[0]))];
    if (!stores.length) return Promise.resolve();
    return this.run(stores, 'readwrite', tx => { pairs.forEach(([st, id]) => tx.objectStore(st).delete(id)); })
      .then(r => { stores.forEach(st => Live.tell(st, pairs.filter(p => p[0] === st).map(p => p[1]), true)); return r; });
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
    geminiBackup: 'gemini-flash-lite-latest',
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
    xmCards: true,
    studyhubUrl: ''
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
const importDraft = { nbId: '', groupId: '', src: 'text', text: '', title: '', pdf: null, split: 'every', rangesText: '', xmind: null, topicLevel: 0, topicOff: new Set(), topicTitles: {}, topicGroups: true };
let cleanups = [];

const nbById = id => state.notebooks.find(n => n.id === id);
const secById = id => state.sections.find(s => s.id === id);
const secsOf = nbId => state.sections.filter(s => s.notebookId === nbId).sort((a, b) => a.order - b.order);
const isDue = s => !s.studyhub && !!(s.srs && s.srs.due && s.srs.due <= todayStr());
const sortDue = (a, b) => (a.srs.due < b.srs.due ? -1 : a.srs.due > b.srs.due ? 1 : 0) || a.order - b.order;
// Macro-argomenti: elenco ordinato dentro il notebook, ogni sezione ne indica uno con groupId
const groupsOf = nb => (nb && Array.isArray(nb.groups) ? nb.groups : []);
const groupOf = sec => groupsOf(nbById(sec.notebookId)).find(g => g.id === sec.groupId) || null;
// un gruppo può stare dentro un macro-argomento (sottoargomento); solo due livelli
// v3.40: fino a tre livelli — macro-argomento › sottoargomento › sottoargomento
const GROUP_MAX_DEPTH = 3;
// antenati di un gruppo, dal più esterno; si ferma su catene rotte o circolari
function groupAncestors(nb, g) {
  const out = [];
  if (!g) return out;
  const all = groupsOf(nb);
  const seen = new Set([g.id]);
  let cur = g;
  while (cur && cur.parentId && out.length < GROUP_MAX_DEPTH - 1) {
    const p = all.find(x => x.id === cur.parentId);
    if (!p || seen.has(p.id)) break;
    seen.add(p.id);
    out.unshift(p);
    cur = p;
  }
  return out;
}
const groupDepth = (nb, g) => groupAncestors(nb, g).length + 1;
const groupParent = (nb, g) => { const a = groupAncestors(nb, g); return a.length ? a[a.length - 1] : null; };
const topGroups = nb => groupsOf(nb).filter(g => !groupParent(nb, g));
const subGroups = (nb, g) => (g && groupDepth(nb, g) < GROUP_MAX_DEPTH ? groupsOf(nb).filter(x => x.id !== g.id && groupParent(nb, x)?.id === g.id) : []);
// il gruppo e tutti quelli dentro, a qualunque livello
const groupTreeIds = (nb, g) => { const ids = new Set([g.id]); subGroups(nb, g).forEach(x => groupTreeIds(nb, x).forEach(i => ids.add(i))); return ids; };
// quanti livelli scende un gruppo (1 se non ha sottoargomenti)
const groupHeight = (nb, g) => 1 + Math.max(0, ...subGroups(nb, g).map(x => groupHeight(nb, x)));
const groupWord = (nb, g) => (groupDepth(nb, g) === 1 ? 'macro-argomento' : 'sottoargomento');
function groupPathOf(sec) {
  const nb = nbById(sec.notebookId);
  const g = groupOf(sec);
  if (!g) return [];
  return [...groupAncestors(nb, g), g];
}
const groupPathText = sec => groupPathOf(sec).map(g => g.name).join(' › ');
// Niente spoiler: una sezione si apre in Cloze se ha termini nascosti, altrimenti in Leggi
const openMode = s => (clozeOf(s) || ioMaskCount(s) ? 'cloze' : 'read');

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
  // "==" finito dentro l’apertura di un’evidenziatura: {{u==|testo → {{u|testo
  line = line.replace(/\{\{([uygbpovrtl])==\|/g, '{{$1|');
  let out = '';
  let open = -1;        // dove si è aperto il cloze (in out)
  let boldAt = -1;      // dove si è aperto il grassetto
  const wraps = [];     // evidenziature aperte {{x|
  let dropWrap = 0;     // chiusure }} già fatte in anticipo, da saltare più avanti
  let dropBold = false;
  let inHint = false;
  const isTable = /^\s*\|/.test(line);
  // chiude il cloze; prima chiude ciò che si era aperto dentro, così niente si accavalla
  const closeCloze = () => {
    while (wraps.length && wraps[wraps.length - 1] > open) { wraps.pop(); out += '}}'; dropWrap++; }
    if (boldAt > open) { out += '**'; boldAt = -1; dropBold = true; }
    out += '==';
    open = -1;
    inHint = false;
  };
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
      const nextOk = next && !/\s/.test(next);
      const prevOk = prev && !/\s/.test(prev);
      if (open < 0) {
        if (nextOk) { open = out.length; out += '=='; }
        else if (!prevOk) out += '=='; // "a == b": è un segno, non un cloze
        // altrimenti è una chiusura senza apertura: la tolgo
      } else if (prevOk) {
        closeCloze();
      } else if (nextOk) {
        // " ==parola" dentro un cloze aperto: il precedente non era stato chiuso
        const ws = (out.match(/\s+$/) || [''])[0];
        out = out.slice(0, out.length - ws.length);
        closeCloze();
        out += ws;
        open = out.length;
        out += '==';
      } else out += '==';
      i += 2;
      continue;
    }
    // inizio del suggerimento: ciò che si era aperto dentro il cloze si chiude prima
    if (open >= 0 && !inHint && line.startsWith('::', i)) {
      while (wraps.length && wraps[wraps.length - 1] > open) { wraps.pop(); out += '}}'; dropWrap++; }
      inHint = true;
      out += '::';
      i += 2;
      continue;
    }
    // separatore di cella: cloze ed evidenziature non passano da una cella all’altra
    if (isTable && ch === '|') {
      if (open >= 0) closeCloze();
      while (wraps.length) { wraps.pop(); out += '}}'; dropWrap++; }
      out += '|';
      i++;
      continue;
    }
    if (line.startsWith('**', i)) {
      if (boldAt < 0) {
        if (dropBold) { dropBold = false; i += 2; continue; }
        boldAt = out.length;
        out += '**';
      } else {
        if (open >= 0 && boldAt < open) closeCloze();
        boldAt = -1;
        out += '**';
      }
      i += 2;
      continue;
    }
    const w = /^\{\{[uygbpovrtl]\|/.exec(line.slice(i, i + 4));
    if (w) { wraps.push(out.length); out += w[0]; i += 4; continue; }
    if (line.startsWith('}}', i)) {
      if (wraps.length) {
        const at = wraps.pop();
        if (open >= 0 && at < open) closeCloze();
        out += '}}';
      } else if (dropWrap > 0) dropWrap--;
      // altrimenti è una chiusura senza apertura: la tolgo
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  // evidenziature rimaste aperte a fine riga
  while (wraps.length) { wraps.pop(); out += '}}'; }
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
// per le sezioni il conto si ricorda finché il testo non cambia
const clozeMemo = new WeakMap();
const clozeOf = s => { const c = clozeMemo.get(s); if (c && c.md === s.md) return c.n; const n = countCloze(s.md); clozeMemo.set(s, { md: s.md, n }); return n; };
// ==termine::suggerimento==: il suggerimento è facoltativo
// nel suggerimento niente segni che romperebbero cloze, evidenziature o tabelle
const cleanHint = v => String(v || '').replace(/\s+/g, ' ').trim().replace(/==/g, '=').replace(/\{\{/g, '(').replace(/\}\}/g, ')').replace(/\|/g, '/').replace(/\*\*/g, '');
const splitHint = t => { const i = t.indexOf('::'); return i > 0 ? [t.slice(0, i), t.slice(i + 2).trim()] : [t, '']; };
const stripCloze = md => (md || '').replace(clozeRe(), (m, t) => splitHint(t)[0]);

const PNOTE_RE = /\^\[([^\]\n]{1,2000})\]/g;
// la nota a comparsa: si apre vicino alla ⓘ; nelle sezioni si può modificare o togliere
const PNote = {
  pop: null,
  close() { if (this.pop) { this.pop.remove(); this.pop = null; } },
  open(el) {
    this.close();
    const text = decodeURIComponent(el.dataset.pn || '');
    const m = location.hash.match(/^#\/sec\/([^/]+)/);
    const sec = m && secById(m[1]);
    const art = el.closest('#view .notes, #view .wy');
    const all = art ? [...art.querySelectorAll('.pnote')] : [];
    const idx = all.indexOf(el);
    const canEdit = sec && idx >= 0 && !el.closest('[contenteditable="true"]');
    const pop = document.createElement('div');
    pop.className = 'pnote-pop';
    pop.setAttribute('role', 'dialog');
    pop.innerHTML = `<div class="notes">${renderMd(text)}</div>${canEdit ? '<div class="pnote-acts"><button type="button" class="btn sm ghost" data-pn-act="edit">Modifica</button><button type="button" class="btn sm ghost" data-pn-act="del">Togli</button></div>' : ''}`;
    document.body.append(pop);
    const r = el.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 16);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    const below = r.bottom + 8;
    pop.style.top = `${below + pop.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - pop.offsetHeight - 8) : below}px`;
    this.pop = pop;
    pop.addEventListener('click', async e => {
      const b = e.target.closest('[data-pn-act]');
      if (!b || !canEdit) return;
      // la nota numero idx della sezione, nell’ordine del testo
      let n = -1;
      const replaceNth = repl => sec.md.replace(PNOTE_RE, (mm, t) => (++n === idx ? repl(t) : mm));
      if (b.dataset.pnAct === 'edit') {
        this.close();
        const v = await modal({ title: 'Nota a comparsa', input: true, multiline: true, value: text, confirm: 'Salva' });
        if (!v || !String(v).trim()) return;
        sec.md = replaceNth(() => `^[${String(v).replace(/\]/g, ')').replace(/\n+/g, ' ').trim()}]`);
      } else {
        this.close();
        sec.md = replaceNth(() => '');
      }
      await saveSection(sec);
      const y = window.scrollY;
      route();
      window.scrollTo(0, y);
    });
  },
  init() {
    document.addEventListener('click', e => {
      const el = e.target.closest('.pnote');
      if (el) { e.preventDefault(); e.stopPropagation(); if (this.pop && this.pop.dataset.for === el.dataset.pn) { this.close(); return; } this.open(el); if (this.pop) this.pop.dataset.for = el.dataset.pn; return; }
      if (this.pop && !e.target.closest('.pnote-pop')) this.close();
    }, true);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.pop) { this.close(); e.stopPropagation(); }
      const el = e.target.closest && e.target.closest('.pnote');
      if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.open(el); }
    }, true);
    window.addEventListener('hashchange', () => this.close());
    window.addEventListener('scroll', () => this.close(), { passive: true });
  }
};
// testo della nota da chiedere e pulire (una riga, senza parentesi quadre)
async function askPnote(value = '') {
  const v = await modal({ title: 'Nota a comparsa', text: 'Compare come ⓘ dopo il testo scelto: un tocco la apre. Utile per dettagli, esempi, eccezioni.', input: true, multiline: true, value, placeholder: 'Es. eccezione: nei bambini…', confirm: 'Aggiungi' });
  return v && String(v).trim() ? String(v).replace(/\]/g, ')').replace(/\n+/g, ' ').trim() : null;
}
function renderMd(md) {
  const src = renderXrefs(extractHtmlBlocks(md || '')
    .replace(IMG_MD_RE, (m, alt, id) => `<img class="nb-img" data-img="${id}" alt="${esc(alt)}">`));
  const src2 = renderMarks(src).replace(clozeRe(), (m, t) => { const [term, hint] = splitHint(t); return `<mark class="cz"${hint ? ` data-hint="${esc(hint)}"` : ''}>${term}</mark>`; })
    // v3.57: note a comparsa, scritte ^[testo della nota]: una ⓘ che si apre con un tocco
    .replace(PNOTE_RE, (m, t) => `<span class="pnote" role="button" tabindex="0" title="Nota" data-pn="${encodeURIComponent(t)}">ⓘ</span>`);
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
  // riprova da sola i limiti al minuto e i sovraccarichi, aspettando quanto dice il servizio
  async withRetry(call, opts) {
    const waits = [15000, 40000, 60000];
    for (let i = 0; ; i++) {
      try {
        return await call();
      } catch (e) {
        const max = e.quota === 'minute' ? 3 : 2;
        if (e.retryable && i < max && !opts.signal?.aborted) {
          const ms = Math.min(120000, Math.max(e.retryAfter ? e.retryAfter * 1000 + 1500 : 0, waits[i]));
          opts.onWait && opts.onWait(ms, e);
          await sleepAbortable(ms, opts.signal);
          continue;
        }
        if (e.quota === 'minute' && e.tokens) e.message += ' Se succede ancora, importa meno pagine per volta.';
        throw e;
      }
    }
  },
  async generate(opts) {
    // offline: lo dico subito, invece di riprovare più volte
    if (navigator.onLine === false) throw apiError('Sei offline: questa funzione usa l’AI e serve internet. Il resto dell’app funziona anche così.', 0);
    const p = opts.provider || S().provider;
    if (p === 'claude') return this.withRetry(() => callClaude(opts), opts);
    // Gemini: ogni modello ha la sua quota gratuita del giorno. Finita quella del
    // modello principale, si passa al modello di riserva fino all’azzeramento.
    const chain = GemQuota.chain();
    if (!chain.length) throw apiError(GemQuota.allGoneMsg(), 429);
    let last = null;
    for (const model of chain) {
      try {
        const r = await this.withRetry(() => callGemini({ ...opts, model }), opts);
        if (model !== chain[0] || last) GemQuota.noteSwitch(GemQuota.main(), model);
        return r;
      } catch (e) {
        if (e.quota === 'day' || e.quota === 'zero') { GemQuota.markOut(model, e.quota); last = e; continue; }
        if (last && e.status === 404) break;   // il modello di riserva non esiste: vale l’errore di prima
        throw e;
      }
    }
    throw last || apiError(GemQuota.allGoneMsg(), 429);
  }
};

/* Quote gratuite di Gemini: i modelli finiti per oggi restano in pausa fino
   alla mezzanotte del Pacifico (le 9:00 in Italia, le 8:00 con l’ora legale) */
const GemQuota = {
  KEY: 'nb-gem-out',
  main() { return (S().geminiModel || '').trim().replace(/^models\//, '') || Settings.defaults.geminiModel; },
  backups() {
    return String(S().geminiBackup ?? Settings.defaults.geminiBackup).split(/[,\s]+/).map(x => x.trim().replace(/^models\//, '')).filter(Boolean);
  },
  read() {
    let o = {};
    try { o = JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch { o = {}; }
    const now = Date.now();
    for (const k of Object.keys(o)) if (!(o[k] && o[k].until > now)) delete o[k];
    return o;
  },
  chain() {
    const out = this.read();
    return [...new Set([this.main(), ...this.backups()])].filter(m => !out[m]);
  },
  markOut(model, why) {
    const o = this.read();
    // "limite 0": il modello non ha richieste gratuite, inutile riprovarlo prima di domani
    o[model] = { until: geminiResetTs(), why };
    try { localStorage.setItem(this.KEY, JSON.stringify(o)); } catch { /* solo un promemoria */ }
  },
  paused() { return Object.entries(this.read()).map(([m, v]) => ({ model: m, ...v })); },
  clear() { try { localStorage.removeItem(this.KEY); } catch { /* niente */ } },
  noteSwitch(from, to) {
    if (from === to) return;
    const k = `nb-gem-switch:${to}:${new Date(geminiResetTs()).toDateString()}`;
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch { /* niente */ }
    toast(`“${from}” ha finito le richieste gratuite di oggi: uso “${to}” fino alle ${geminiResetLabel()}`);
  },
  allGoneMsg() {
    return `Per oggi sono finite le richieste gratuite di tutti i modelli Gemini scelti (${[this.main(), ...this.backups()].join(', ')}). Ripartono alle ${geminiResetLabel()}. Intanto puoi usare Claude o aggiungere un altro modello di riserva in Impostazioni.`;
  }
};
function geminiResetTs() {
  const now = new Date();
  const la = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const off = la.getTime() - now.getTime();
  const mid = new Date(la);
  mid.setHours(24, 0, 0, 0);
  return mid.getTime() - off;
}
const geminiResetLabel = () => new Date(geminiResetTs()).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

// Legge dal 429 di Google quale limite è scattato: al minuto o al giorno, richieste o token
function geminiQuotaInfo(data) {
  const det = Array.isArray(data?.error?.details) ? data.error.details : [];
  const viol = det.filter(d => /QuotaFailure/.test(d['@type'] || '')).flatMap(d => d.violations || []);
  const ids = viol.map(v => `${v.quotaId || ''} ${v.quotaMetric || ''}`).join(' ');
  const msg = String(data?.error?.message || '');
  const valRaw = viol.map(v => v.quotaValue).find(v => v !== undefined && v !== null && v !== '');
  const msgLimit = msg.match(/limit:\s*(\d+)/i);
  const value = valRaw !== undefined ? +valRaw : msgLimit ? +msgLimit[1] : null;
  const retry = det.find(d => /RetryInfo/.test(d['@type'] || ''))?.retryDelay;
  const retryAfter = retry ? parseFloat(retry) : (msg.match(/retry in ([\d.]+)\s*s/i) || [])[1] ? parseFloat(msg.match(/retry in ([\d.]+)\s*s/i)[1]) : 0;
  const all = `${ids} ${msg}`;
  return {
    kind: /PerDay|per_day|per day|daily/i.test(all) ? 'day' : /PerMinute|per_minute|per minute/i.test(all) ? 'minute' : '',
    tokens: /token/i.test(ids || msg),
    free: /free.?tier/i.test(all),
    value: Number.isFinite(value) ? value : null,
    retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0
  };
}
function geminiQuotaError(data, model) {
  const q = geminiQuotaInfo(data);
  const free = q.free ? ' gratuite' : '';
  let e;
  if (q.value === 0) {
    e = apiError(`Con la tua chiave il modello “${model}” non ha richieste${free} a disposizione (limite 0). Scegli un altro modello in Impostazioni, per esempio un Flash.`, 429);
    e.quota = 'zero';
    e.retryable = false;
  } else if (q.kind === 'day') {
    e = apiError(`Per oggi hai usato tutte le${q.value ? ` ${q.value}` : ''} richieste${free} di “${model}”. Ripartono alle ${geminiResetLabel()}.`, 429);
    e.quota = 'day';
    e.retryable = false;
  } else if (q.kind === 'minute') {
    e = apiError(q.tokens
      ? `Testo o PDF troppo lungo per il limite${q.free ? ' gratuito' : ''} di Gemini al minuto${q.value ? ` (${q.value.toLocaleString('it-IT')} token)` : ''}.`
      : `Troppe richieste a Gemini nello stesso minuto${q.value ? ` (al massimo ${q.value})` : ''}.`, 429);
    e.quota = 'minute';
    e.tokens = q.tokens;
  } else {
    const m = String(data?.error?.message || '').split('\n')[0].slice(0, 220).replace(/[.\s]+$/, '');
    e = apiError(`Gemini ha rifiutato la richiesta per un limite di quota${m ? `: ${m}` : ''}. Controlla l’uso della chiave su Google AI Studio.`, 429);
    e.quota = 'other';
  }
  e.retryAfter = q.retryAfter;
  return e;
}

async function callGemini({ system, text, pdfBase64, audio, maxTokens = 32768, signal, model: forced }) {
  const key = S().geminiKey.trim();
  const model = forced || GemQuota.main();
  const parts = [];
  if (pdfBase64) parts.push({ inline_data: { mime_type: 'application/pdf', data: pdfBase64 } });
  // v3.62: l’audio di una risposta a voce (WAV), per trascriverla e valutarla insieme
  if (audio) parts.push({ inline_data: { mime_type: audio.mime, data: audio.data } });
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
    else if (res.status === 429) throw geminiQuotaError(data, model);
    else if (res.status === 503) msg = `Gemini è sovraccarico in questo momento (non è un limite della tua chiave)${m ? `: ${m}` : ''}.`;
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
let pdfjsLoading = null;
async function ensurePdfJs() {
  if (window.pdfjsLib) return;
  if (!pdfjsLoading) pdfjsLoading = (async () => {
    try {
      window.pdfjsLib = await import(libUrl(LIBS.pdfjs));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = libUrl(LIBS.pdfjsWorker);
    } catch (err) {
      await loadScript(LIBS.pdfjsOld);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfjsOldWorker;
    }
  })();
  try { await pdfjsLoading; } finally { if (!window.pdfjsLib) pdfjsLoading = null; }
}
async function ensurePdfLib() { if (!window.PDFLib) await loadScript(libUrl(LIBS.pdflib)); }

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
// v3.56: con una tastiera collegata al tablet, Cancella in un campo già vuoto (o con il
// cursore all’inizio) non ha niente da cancellare; Android allora lo passa al sistema,
// che lo tratta come “Indietro” e chiudeva la finestra aperta. Qui lo trattengo.
document.addEventListener('keydown', e => {
  if (e.key !== 'Backspace' || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (!t || !t.tagName) return;
  if (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|search|email|url|tel|password|number|)$/i.test(t.type || ''))) {
    let empty = false;
    try { empty = !t.value || (t.selectionStart === 0 && t.selectionEnd === 0); } catch { empty = !t.value; }
    if (empty) e.preventDefault();
  } else if (t.isContentEditable && !t.textContent.trim()) e.preventDefault();
}, true);
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
  if (clozeOf(s)) return 'cloze';
  if ((s.questions || []).length) return 'quiz';
  return 'blank';
}

function sectionRow(s, { showNb = false, review = false } = {}) {
  const bits = [];
  if (showNb) {
    const gp = groupPathText(s);
    bits.push(esc(nbById(s.notebookId)?.name || '') + (gp ? ` › ${esc(gp)}` : ''));
  }
  const cz = clozeOf(s);
  const q = (s.questions || []).length;
  if (cz) bits.push(`${cz} cloze`);
  if (q) bits.push(`${q} ${q === 1 ? 'domanda' : 'domande'}`);
  if (s.needsFormat) bits.push('da formattare');
  if (s.incomplete) bits.push('⚠ incompleta');
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
const MORE_KEYS = ['search', 'more', 'settings', 'links', 'guide', 'calendar', 'clinic', 'glossary', 'cases', 'incomplete', 'lab', 'semei', 'examq', 'micro', 'atlas', 'anat', 'pharma', 'diary', 'scores', 'viva', 'papers'];
function route() {
  cleanups.forEach(fn => { try { fn(); } catch { /* ignora */ } });
  cleanups = [];
  const back = Nav.enter();
  updateIncBadge();
  Resume.refresh();
  Pad.onRoute();
  if (Resume.pendingY !== null) setTimeout(() => Resume.restore(), 0);
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
  if (back) Nav.restore();
  switch (p0) {
    case 'nb': return viewNotebook(p1, p2);
    case 'lezioni': return viewLessons(p1);
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
    case 'clinic': return viewClinic(p1);
    case 'glossary': return viewGlossary();
    case 'tag': return viewTag(p1);
    case 'pdf': return viewPdf(p1, p2);
    case 'pdfs': return viewPdfLibrary(p1, p2);
    case 'exam': return viewExam(p1, p2);
    case 'deck': return viewDeck(p1);
    case 'card': return viewCardEditor(p1);
    case 'study': return viewStudy(p1, p2);
    case 'studyhub': ShDock.open(); location.replace('#/notebooks'); return;
    case 'cases': return viewCases();
    case 'lab': return viewLab(p1, p2);
    case 'semei': return viewSemei();
    case 'examq': return viewExamQ(p1, p2);
    case 'micro': case 'atlas': case 'anat': case 'pharma': case 'diary': return viewSpecial(p0, p1);
    case 'scores': return viewScores();
    case 'print': return viewPrint(p1, p2);
    case 'viva': return viewViva(p1, p2);
    case 'papers': return viewPapers(p1);
    case 'fs': { FullScreen.toggle(); if (history.length > 1) history.back(); else location.replace('#/notebooks'); return; }
    case 'resume': location.replace('#/notebooks'); setTimeout(() => Resume.go(), 0); return;
    case 'pad': location.replace('#/notebooks'); setTimeout(() => Pad.open(), 0); return;
    case 'split': location.replace('#/notebooks'); setTimeout(() => Split.pick(), 0); return;
    case 'incomplete': return viewIncomplete();
    default: return viewNotebooks();
  }
}

function notFound(what = 'Questa pagina') {
  setView(`<div class="empty"><p>${esc(what)} non esiste più.</p><a class="btn primary" href="#/notebooks">Torna ai notebook</a></div>`);
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
    // offline: niente errore; le modifiche restano da parte e partono appena torna la connessione
    if (navigator.onLine === false) {
      setSyncStatus('Sei offline: sincronizzo appena torna la connessione');
      if (!silent) toast('Sei offline: le modifiche sono salvate qui e le sincronizzo appena torna la connessione');
      return false;
    }
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
function scheduleSync() { if (!EMBED) Sync.schedule(); }

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
  // dall’interno verso l’esterno, finché ce ne sono: regge anche più livelli uno dentro l’altro
  for (let i = 0; i < 8; i++) {
    const next = out.replace(MARK_RE, (m, k, t) => k === 'u' ? `<u class="ul">${t}</u>` : `<mark class="hl hl-${k}">${t}</mark>`);
    if (next === out) break;
    out = next;
  }
  return out;
}
const stripMarks = md => {
  let out = md || '';
  for (let i = 0; i < 8; i++) { const next = out.replace(MARK_RE, '$2'); if (next === out) break; out = next; }
  return out;
};

/* Dal testo selezionato nella pagina al punto corrispondente del Markdown */
// Tutto ciò che nel Markdown c’è ma nel testo mostrato non si vede: grassetti, cloze (con suggerimento),
// evidenziature, tag HTML, link [testo](indirizzo), collegamenti [[Titolo|testo]], escape \*, segni di
// elenco, titoli e citazioni a inizio riga, separatori delle tabelle
const MARKUP_GAP = '(?:\\*{1,3}|_{1,2}|==|~~|`|\\{\\{[uygbpovrtl]\\||\\}\\}|<[^>\\n]{1,80}>|::(?:(?!==)[^\\n])*(?===)|\\]\\([^)\\n]*\\)|\\[\\[(?:[^\\]|\\n]*\\|)?|\\]\\]|\\[|\\\\(?=[!-/:-@\\[-`{-~])|(?:^|(?<=\\n))[ \\t]*(?:[-*+]|\\d{1,3}[.)]|#{1,6}|>)[ \\t]+|[ \\t]*\\|[ \\t]*)*';
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
// Intervalli dei segni (grassetti, evidenziature, cloze, link) per non accavallarli
function markupSpans(md) {
  const spans = [];
  let off = 0;
  for (const line of md.split('\n')) {
    const bolds = [];
    const wraps = [];
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '`') { const k = line.indexOf('`', i + 1); if (k > i) { i = k; continue; } }
      if (line.startsWith('**', i)) { if (bolds.length) spans.push([off + bolds.pop(), off + i + 2]); else bolds.push(i); i++; continue; }
      if (/^\{\{[uygbpovrtl]\|/.test(line.slice(i, i + 4))) { wraps.push(i); i += 3; continue; }
      if (line.startsWith('}}', i) && wraps.length) { spans.push([off + wraps.pop(), off + i + 2]); i++; continue; }
    }
    for (const m of line.matchAll(/\[\[[^\]\n]*\]\]|\[[^\]\n]*\]\([^)\n]*\)/g)) spans.push([off + m.index, off + m.index + m[0].length]);
    off += line.length + 1;
  }
  clozeMatches(md).forEach(m => spans.push([m.start, m.end]));
  return spans;
}
// allarga la selezione finché non taglia a metà nessun segno
function expandToBalanced(md, r0) {
  const r = { ...r0 };
  const spans = markupSpans(md);
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    for (const [a, b] of spans) {
      const cutsStart = a < r.start && b > r.start && b < r.end;
      const cutsEnd = a > r.start && a < r.end && b > r.end;
      if (cutsStart || cutsEnd) { r.start = Math.min(r.start, a); r.end = Math.max(r.end, b); changed = true; }
    }
  }
  return r;
}
// Applica (o toglie) cloze, colore o sottolineatura a un intervallo del Markdown
function applyMarkToMd(md, r0, kind) {
  // selezione su più celle di una tabella: il segno si mette cella per cella, così la tabella resta intera
  const lineStart = md.lastIndexOf('\n', r0.start - 1) + 1;
  if (/^\s*\|/.test(md.slice(lineStart, lineStart + 8)) && md.slice(r0.start, r0.end).indexOf('\n') < 0) {
    const segs = [];
    let s0 = r0.start;
    for (let i = r0.start; i < r0.end; i++) {
      if (md[i] === '|' && !/\{\{[uygbpovrtl]$/.test(md.slice(Math.max(0, i - 3), i))) { segs.push([s0, i]); s0 = i + 1; }
    }
    if (segs.length) {
      segs.push([s0, r0.end]);
      let out = md;
      for (const [a, b] of segs.reverse()) {
        let x = a;
        let y = b;
        while (x < y && /\s/.test(out[x])) x++;
        while (y > x && /\s/.test(out[y - 1])) y--;
        if (y > x) out = applyMarkToMd(out, { start: x, end: y }, kind);
      }
      return out;
    }
  }
  let r = r0;
  if (kind === 'cloze') {
    const cz = clozeMatches(md);
    // la selezione sta dentro un cloze: lo tolgo (suggerimento compreso)
    const host = cz.find(m => m.start <= r.start && r.end <= m.end);
    if (host) return md.slice(0, host.start) + splitHint(host.inner)[0] + md.slice(host.end);
    r = expandToBalanced(md, r);
    // i cloze rimasti dentro la selezione si fondono nel nuovo
    let inner = md.slice(r.start, r.end);
    cz.filter(m => m.start >= r.start && m.end <= r.end).sort((a, b) => b.start - a.start).forEach(m => {
      inner = inner.slice(0, m.start - r.start) + splitHint(m.inner)[0] + inner.slice(m.end - r.start);
    });
    return `${md.slice(0, r.start)}==${inner}==${md.slice(r.end)}`;
  }
  if (kind !== 'none') r = expandToBalanced(md, r);
  const inner = md.slice(r.start, r.end);
  const before = md.slice(0, r.start);
  const after = md.slice(r.end);
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
  // v3.69: le foto delle note cliniche
  state.links.forEach(l => (l.images || []).forEach(im => set.add(im.id)));
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
        ${ctx && ctx.sectionId ? `<button class="btn" data-lb="labels">${(labelSets(secById(ctx.sectionId) || {})[imageId]?.masks || []).length ? 'Rimetti le etichette' : 'Ritaglia le etichette'}</button>` : ''}
        ${typeof imageSourceOf === 'function' && imageSourceOf(imageId) ? '<button class="btn" data-lb="recrop">✂ Ritaglia di nuovo dal PDF</button>' : ''}
        <button class="btn primary" data-lb="close">Chiudi</button>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  $('[data-lb="close"]', root).onclick = close;
  const io = $('[data-lb="io"]', root);
  if (io) io.onclick = () => { close(); openOcclusionEditor({ imageId, ...ctx }); };
  const rc = $('[data-lb="recrop"]', root);
  if (rc) rc.onclick = async () => { close(); if (await recropImage(imageId)) { rehydrateMissing(); hydrateImages(document.body); if (location.hash.startsWith('#/sec/')) route(); } };
  const lb = $('[data-lb="labels"]', root);
  if (lb) lb.onclick = () => { const sec = secById(ctx.sectionId); close(); if (sec) startLabels(sec, imageId); };
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
// Figure da un PDF: scegli il PDF (dalla libreria o dal dispositivo), vedi tutte le
// pagine in miniatura, tocchi quella giusta e ritagli; puoi inserirne più d’una di fila.
// Restituisce un elenco di { id, caption } (vuoto se annulli).
function openPdfCropper(notebookId, { sec = null } = {}) {
  return new Promise(resolve => {
    const root = $('#modalRoot');
    let pdf = importDraft.pdf;
    let pageNo = 1;
    let rect = null;
    let task = null;
    let view = pdf ? 'pages' : 'source';
    let thumbObs = null;
    let thumbQueue = [];
    let thumbBusy = false;
    let closed = false;
    const added = [];
    const lib = [
      ...(sec ? pdfsOf(sec.id) : []),
      ...state.pdfs.filter(p => p.notebookId === notebookId && (!sec || p.sectionId !== sec.id)).sort((a, b) => b.updated - a.updated),
      ...state.pdfs.filter(p => p.notebookId !== notebookId).sort((a, b) => b.updated - a.updated)
    ].slice(0, 30);
    root.innerHTML = `
      <div class="overlay full">
        <div class="io-editor cp" role="dialog" aria-modal="true" aria-labelledby="cpTitle">
          <header class="io-head">
            <h2 id="cpTitle">Figura da un PDF</h2>
            <div class="cp-src">
              <label class="file-drop slim"><input type="file" id="cpFile" accept="application/pdf,.pdf">
                <span id="cpFileLabel">${pdf ? `${esc(pdf.name)}: tocca per sceglierne un altro` : 'Scegli un PDF dal dispositivo'}</span></label>
              ${lib.length ? '<button class="btn sm ghost" type="button" data-cp="lib">I tuoi PDF</button>' : ''}
            </div>
            <div class="cp-nav" id="cpNav" hidden>
              <button class="btn sm" data-cp="grid" type="button">‹ Tutte le pagine</button>
              <button class="btn sm" data-cp="prev" type="button" aria-label="Pagina precedente">‹</button>
              <label>Pagina <input class="input page-in" type="number" id="cpPage" min="1" value="1" inputmode="numeric"> di <span id="cpTotal"></span></label>
              <button class="btn sm" data-cp="next" type="button" aria-label="Pagina successiva">›</button>
            </div>
            <p class="hint" id="cpHint"></p>
          </header>
          <div class="io-body" id="cpBody">
            <div id="cpLib"></div>
            <div class="cp-grid" id="cpGrid" hidden></div>
            <div class="io-stage drawing crop" id="cpStage" hidden>
              <canvas id="cpCanvas"></canvas>
              <div class="io-draft" id="cpDraft" hidden></div>
              <div class="crop-rect" id="cpRect" hidden></div>
            </div>
          </div>
          <footer class="io-foot">
            <span class="hint" id="cpMsg"></span>
            <button class="btn ghost" data-cp="cancel" type="button">Annulla</button>
            <button class="btn" data-cp="more" type="button" disabled hidden>Inserisci e continua</button>
            <button class="btn primary" data-cp="ok" type="button" disabled hidden>Inserisci la figura</button>
          </footer>
        </div>
      </div>`;
    const canvas = $('#cpCanvas', root);
    const stage = $('#cpStage', root);
    const grid = $('#cpGrid', root);
    const body = $('#cpBody', root);
    const okBtn = $('[data-cp="ok"]', root);
    const moreBtn = $('[data-cp="more"]', root);
    const msg = $('#cpMsg', root);
    const hint = $('#cpHint', root);

    const libHtml = () => lib.length ? `
      <h3 class="cp-libt">I tuoi PDF</h3>
      <ul class="list cp-lib">${lib.map(p => `<li><button type="button" class="row" data-cplib="${p.id}">
        <span class="row-main"><span class="row-title">${esc(p.name)}</span>
        <span class="row-sub">${p.pages ? `${p.pages} pagine` : ''}${sec && p.sectionId === sec.id ? ' · di questa sezione' : p.notebookId === notebookId ? ' · di questo notebook' : nbById(p.notebookId) ? ` · ${esc(nbById(p.notebookId).name)}` : ''}</span></span></button></li>`).join('')}</ul>` : '<p class="hint">Scegli un PDF dal dispositivo: le slide, un capitolo, una dispensa.</p>';
    const show = v => {
      view = v;
      $('#cpLib', root).hidden = v !== 'source';
      grid.hidden = v !== 'pages';
      stage.hidden = v !== 'crop';
      $('#cpNav', root).hidden = v !== 'crop';
      okBtn.hidden = moreBtn.hidden = v !== 'crop';
      hint.textContent = v === 'source' ? '' : v === 'pages' ? 'Tocca la pagina da cui prendere la figura.' : 'Trascina sulla pagina per scegliere la parte da ritagliare.';
      if (v === 'source') $('#cpLib', root).innerHTML = libHtml();
    };
    // miniature: si disegnano quando entrano in vista, una alla volta
    const drawThumb = async btn => {
      const n = +btn.dataset.pg;
      const cv = $('canvas', btn);
      try {
        const page = await pdf.doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const w = Math.max(120, btn.clientWidth || 150) * Math.min(2, window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale: w / base.width });
        cv.width = Math.round(vp.width);
        cv.height = Math.round(vp.height);
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        btn.classList.add('ok');
      } catch { btn.classList.add('err'); }
    };
    const pump = async () => {
      if (thumbBusy || closed) return;
      thumbBusy = true;
      while (thumbQueue.length && !closed) {
        const b = thumbQueue.shift();
        if (b.isConnected && !b.classList.contains('ok')) await drawThumb(b);
      }
      thumbBusy = false;
    };
    const buildGrid = () => {
      if (thumbObs) thumbObs.disconnect();
      thumbQueue = [];
      grid.innerHTML = Array.from({ length: pdf.pages }, (_, i) => `
        <button type="button" class="cp-thumb" data-pg="${i + 1}" aria-label="Pagina ${i + 1}">
          <canvas></canvas><span class="cp-pn">${i + 1}</span>
        </button>`).join('');
      thumbObs = new IntersectionObserver(entries => {
        entries.forEach(en => { if (en.isIntersecting) { thumbObs.unobserve(en.target); thumbQueue.push(en.target); } });
        pump();
      }, { root: body, rootMargin: '400px 0px' });
      $$('.cp-thumb', grid).forEach(b => thumbObs.observe(b));
    };
    const render = async () => {
      if (!pdf) return;
      pageNo = Math.min(pdf.pages, Math.max(1, pageNo));
      $('#cpPage', root).value = pageNo;
      rect = null;
      $('#cpRect', root).hidden = true;
      okBtn.disabled = moreBtn.disabled = true;
      try {
        if (task) { task.cancel(); task = null; }
        const page = await pdf.doc.getPage(pageNo);
        const base = page.getViewport({ scale: 1 });
        const cssW = Math.max(280, Math.min(body.clientWidth - 24, 1100) || 360);
        const vp = page.getViewport({ scale: (cssW * (window.devicePixelRatio || 1)) / base.width });
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        canvas.style.width = `${cssW}px`;
        task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
        await task.promise;
        task = null;
      } catch (err) {
        if (err && err.name === 'RenderingCancelledException') return;
        msg.textContent = 'Non riesco a mostrare questa pagina.';
      }
    };
    const usePdf = p => {
      pdf = p;
      importDraft.pdf = p;
      $('#cpFileLabel', root).textContent = `${p.name}: tocca per sceglierne un altro`;
      $('#cpTotal', root).textContent = p.pages;
      buildGrid();
      show('pages');
      body.scrollTop = 0;
    };
    const openPage = n => { pageNo = n; show('crop'); body.scrollTop = 0; render(); };
    $('#cpFile', root).addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      $('#cpFileLabel', root).textContent = 'Apro il PDF…';
      try { usePdf(await openPdf(f)); }
      catch (err) { $('#cpFileLabel', root).textContent = 'Scegli un PDF dal dispositivo'; toast(err.message, 'err'); }
    });
    root.addEventListener('click', async e => {
      const lb = e.target.closest('[data-cplib]');
      if (lb) {
        const meta = pdfById(lb.dataset.cplib);
        const rec = meta && await DB.run('pdfblobs', 'readonly', tx => tx.objectStore('pdfblobs').get(meta.id));
        if (!rec || !rec.blob) { toast('Questo PDF non è ancora su questo dispositivo: aprilo una volta dalla libreria PDF per scaricarlo', 'err'); return; }
        msg.textContent = 'Apro il PDF…';
        try { usePdf(await openPdf(new File([rec.blob], `${meta.name}.pdf`, { type: 'application/pdf' }))); }
        catch (err) { toast(err.message, 'err'); }
        msg.textContent = '';
        return;
      }
      const th = e.target.closest('.cp-thumb');
      if (th) { openPage(+th.dataset.pg); return; }
    });
    $('[data-cp="grid"]', root).onclick = () => {
      show('pages');
      requestAnimationFrame(() => $(`.cp-thumb[data-pg="${pageNo}"]`, grid)?.scrollIntoView({ block: 'center' }));
    };
    $('[data-cp="prev"]', root).onclick = () => { pageNo--; render(); };
    $('[data-cp="next"]', root).onclick = () => { pageNo++; render(); };
    $('#cpPage', root).addEventListener('change', e => { pageNo = parseInt(e.target.value, 10) || 1; render(); });
    rectDrawing(stage, {
      canDraw: () => !!pdf && view === 'crop',
      onDraft: b => { const d = $('#cpDraft', root); d.hidden = !b; if (b) d.setAttribute('style', posStyle(b)); },
      onDone: b => { rect = b; const r = $('#cpRect', root); r.hidden = false; r.setAttribute('style', posStyle(b)); okBtn.disabled = moreBtn.disabled = false; }
    });
    const close = () => {
      closed = true;
      if (task) task.cancel();
      if (thumbObs) thumbObs.disconnect();
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      resolve(added);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    $('[data-cp="cancel"]', root).onclick = close;
    const libBtn = $('[data-cp="lib"]', root);
    if (libBtn) libBtn.onclick = () => { show('source'); body.scrollTop = 0; };
    const cut = async () => {
      if (!pdf || !rect) return false;
      okBtn.disabled = moreBtn.disabled = true;
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
        added.push({ id: im.id, caption: `${pdf.base}, pagina ${pageNo}` });
        msg.textContent = '';
        return true;
      } catch (err) {
        msg.textContent = '';
        okBtn.disabled = moreBtn.disabled = false;
        toast('Ritaglio non riuscito: ' + err.message, 'err');
        return false;
      }
    };
    okBtn.onclick = async () => { if (await cut()) { toast(added.length > 1 ? `${added.length} figure aggiunte` : 'Figura aggiunta'); close(); } };
    moreBtn.onclick = async () => {
      if (!(await cut())) return;
      rect = null;
      $('#cpRect', root).hidden = true;
      msg.textContent = `${added.length} ${added.length === 1 ? 'figura pronta' : 'figure pronte'}: ritagliane un’altra o scegli un’altra pagina`;
      show('pages');
      requestAnimationFrame(() => $(`.cp-thumb[data-pg="${pageNo}"]`, grid)?.scrollIntoView({ block: 'center' }));
    };
    if (pdf) { $('#cpTotal', root).textContent = pdf.pages; buildGrid(); show('pages'); }
    else show('source');
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

/* =====================================================================
   v3.6: pagina Altro, link a icone, calendario e statistiche, tag,
   collegamenti tra pagine, glossario, note cliniche, immagini
   ===================================================================== */

const ICONS = {
  scores: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  micro: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>',
  atlas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h4l2-6 3 12 3-9 2 3h6"/></svg>',
  fs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  papers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 15h7M9 18h4"/></svg>',
  viva: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v10H9l-5 4z"/><path d="M9 9h6M9 12h4"/></svg>',
  pharma: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="9" width="18" height="7" rx="3.5" transform="rotate(-35 12 12.5)"/><path d="M9.2 7.4l5.6 8"/></svg>',
  anat: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4.5" r="2.5"/><path d="M12 7v7M8 10h8M12 14l-3 7M12 14l3 7"/></svg>',
  diary: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 3v18M11 8h6M11 12h6M11 16h4"/></svg>',
  examq: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4V13M12 16.5v.2"/></svg>',
  split: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 4v16"/><path d="m6.5 10.5 2 1.5-2 1.5M17.5 10.5l-2 1.5 2 1.5"/></svg>',
  resume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/></svg>',
  pad: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/><path d="M13 20h7"/></svg>',
  semei: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v7.5a6.5 6.5 0 0 1-6.5 6.5h-.6a6 6 0 0 1-4.9-2.6l-2.7-3.9a1.5 1.5 0 0 1 2.4-1.8L8 15"/></svg>',
  lab: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6.5L4.8 18.3A1.8 1.8 0 0 0 6.4 21h11.2a1.8 1.8 0 0 0 1.6-2.7L14 9.5V3"/><path d="M7.2 15h9.6"/></svg>',
  cases: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M9 3v3h6V3"/><path d="M12 10v6M9 13h6"/></svg>',
  incomplete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5M12 17.3v.2"/></svg>',
  studyhub: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M14 4v16"/><path d="m16.2 12 1.3 1.3 2-2.6"/></svg>',
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
  const onKey = e => { if (e.key === 'Escape' && e.keyCode !== 8 && e.code !== 'Backspace' && el.isConnected) { e.stopPropagation(); close(null); } };
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
    pushStatsSoon();
    const x = this.day();
    x.t += sec;
    if (nbId) x.nb[nbId] = (x.nb[nbId] || 0) + sec;
    const keys = Object.keys(this.data.d);
    if (keys.length > 420) keys.sort().slice(0, keys.length - 400).forEach(k => delete this.data.d[k]);
    this.save();
  },
  addReview() { this.day().r += 1; this.save(); pushStatsSoon(); }
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
      <div class="actions">${studyBtns(`tag-${encodeURIComponent(t)}`, toStudy)}</div>
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
const lowerMemo = new WeakMap();
const lowerMd = s => { const c = lowerMemo.get(s); if (c && c.md === s.md) return c.l; const l = (s.md || '').toLowerCase(); lowerMemo.set(s, { md: s.md, l }); return l; };
function backlinksOf(sec) {
  const k = sec.title.trim().toLowerCase();
  if (!k) return [];
  return state.sections.filter(s => s.id !== sec.id && (s.md || '').includes('[[') && lowerMd(s).includes('[[' + k)
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
// v3.39: l’indice si costruisce a piccoli passi, lasciando respirare il telefono,
// e riprende da dove era arrivato se chiudi l’app; all’avvio non carico più tutti i testi.
const pdfTextDone = new Set();
let pdfTextKeysLoaded = false;
const PDFIDX_KEY = 'nb-pdfidx-progress';
const pdfIdxProgress = () => { try { return JSON.parse(localStorage.getItem(PDFIDX_KEY) || '{}') || {}; } catch { return {}; } };
const setPdfIdxProgress = (id, n) => { const p = pdfIdxProgress(); if (n) p[id] = n; else delete p[id]; try { localStorage.setItem(PDFIDX_KEY, JSON.stringify(p)); } catch { /* niente */ } };
async function loadPdfTextKeys() {
  if (pdfTextKeysLoaded) return;
  pdfTextKeysLoaded = true;
  const partial = pdfIdxProgress();
  try { ((await DB.run('pdftext', 'readonly', tx => tx.objectStore('pdftext').getAllKeys())) || []).forEach(k => { if (!partial[k]) pdfTextDone.add(k); }); } catch { /* archivio non ancora creato */ }
}
const idle = () => new Promise(r => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 400 }) : setTimeout(r, 30)));
const PdfIndex = {
  busy: false,
  waiting: [],
  pending() { return state.pdfs.filter(p => localPdfIds.has(p.id) && !pdfTextDone.has(p.id) && !(pdfTextLoaded && pdfText.has(p.id) && !pdfIdxProgress()[p.id])); },
  async run(onEach) {
    if (onEach) this.waiting.push(onEach);
    if (this.busy) return;
    this.busy = true;
    try {
      await loadPdfTextKeys();
      for (const meta of this.pending()) {
        try {
          await ensurePdfJs();
          const rec = await DB.run('pdfblobs', 'readonly', tx => tx.objectStore('pdfblobs').get(meta.id));
          if (!rec || !rec.blob) continue;
          const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await rec.blob.arrayBuffer()) }).promise;
          // riprendo da dove ero rimasta
          const from = pdfIdxProgress()[meta.id] || 1;
          let pages = [];
          if (from > 1) { try { pages = (await DB.run('pdftext', 'readonly', tx => tx.objectStore('pdftext').get(meta.id)))?.pages || []; } catch { pages = []; } }
          if (pages.length < from - 1) { pages = []; }
          for (let n = pages.length + 1; n <= doc.numPages; n++) {
            const tc = await (await doc.getPage(n)).getTextContent();
            pages.push(tc.items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').slice(0, 20000));
            if (n % 4 === 0) await idle();
            if (n % 40 === 0 && n < doc.numPages) { await DB.put('pdftext', { id: meta.id, pages }); setPdfIdxProgress(meta.id, n + 1); }
            if (document.hidden) await new Promise(r => setTimeout(r, 1500));
          }
          doc.destroy();
          await DB.put('pdftext', { id: meta.id, pages });
          setPdfIdxProgress(meta.id, 0);
          pdfTextDone.add(meta.id);
          if (pdfTextLoaded) pdfText.set(meta.id, pages);
        } catch { pdfTextDone.add(meta.id); }
        this.waiting.forEach(fn => fn());
      }
    } finally {
      this.busy = false;
      this.waiting = [];
    }
  }
};
async function dropPdfText(ids) {
  ids.forEach(id => { pdfText.delete(id); pdfTextDone.delete(id); setPdfIdxProgress(id, 0); });
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
    (p.bookmarks || []).filter(b => foldAccents(b.title || '').includes(f)).slice(0, 5).forEach(b => {
      pdfRows.push(`<li><a class="row" href="#/pdf/${p.id}/${b.page}"><span class="pdf-ic sm bm" aria-hidden="true">${ICON_BM}</span><span class="row-main"><span class="row-title">${foldSnippet(b.title, f)}</span><span class="row-sub">Segnalibro, ${esc(p.name)}, pagina ${b.page}</span></span></a></li>`);
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
  const lx = labExams().filter(x => foldAccents(`${x.name} ${x.abbr || ''} ${x.up || ''} ${x.down || ''} ${(x.uses || []).map(u => u.dx).join(' ')}`).includes(f)).slice(0, 20);
  if (lx.length) out.push(`<h2 class="sub">Medicina di laboratorio</h2><ul class="list">${lx.map(x => `<li><a class="row" href="#/lab/${x.id}"><span class="row-main"><span class="row-title">${foldSnippet(x.name, f)}${x.abbr ? ` <span class="lab-abbr">${esc(x.abbr)}</span>` : ''}</span><span class="row-sub">${esc(labCatName(x.cat))}</span></span></a></li>`).join('')}</ul>`);
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
  ['theme', 'readFont', 'readSize', 'readSpacing', 'pagesPerSection', 'newPerDay', 'aiCloze', 'aiQuestions', 'showImages', 'keepPdfImages', 'anki'].forEach(k => { if (st[k] !== undefined) prefs[k] = st[k]; });
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
    pdfTextDone.delete(f.id);
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

/* ---------- Tempo di studio condiviso ---------- */
const DEVICE_ID = (() => {
  try {
    let d = localStorage.getItem('nb-device');
    if (!d) { d = `d${uid()}`; localStorage.setItem('nb-device', d); }
    return d;
  } catch { return 'd-local'; }
})();
const statsRecId = `_stats_${DEVICE_ID}`;
let statsPushTimer = null;
// ogni dispositivo salva i suoi numeri in un record sincronizzato; la somma si fa leggendo
function pushStatsSoon(delay = 60000) {
  clearTimeout(statsPushTimer);
  statsPushTimer = setTimeout(pushStatsNow, delay);
}
async function pushStatsNow() {
  clearTimeout(statsPushTimer);
  statsPushTimer = null;
  const data = Stats.load();
  let rec = state.links.find(l => l.id === statsRecId);
  if (!rec) rec = { id: statsRecId, kind: 'stats', notebookId: '_stats', created: Date.now() };
  rec.d = data.d;
  rec.exams = data.exams || [];
  rec.device = navigator.userAgent.includes('Android') ? 'Android' : navigator.userAgent.includes('Windows') ? 'Windows' : 'Altro';
  await saveLink(rec);
}
function statsMerged() {
  const own = Stats.load();
  const others = state.links.filter(l => l.kind === 'stats' && l.id !== statsRecId);
  if (!others.length) return own;
  const d = {};
  const add = src => Object.entries(src || {}).forEach(([day, v]) => {
    const x = d[day] || (d[day] = { t: 0, r: 0, nb: {} });
    x.t += v.t || 0;
    x.r += v.r || 0;
    Object.entries(v.nb || {}).forEach(([id, t]) => { x.nb[id] = (x.nb[id] || 0) + t; });
  });
  add(own.d);
  others.forEach(o => add(o.d));
  const seen = new Set();
  const exams = [...(own.exams || []), ...others.flatMap(o => o.exams || [])]
    .filter(x => { const k = `${x.d}|${x.key}|${x.score}|${x.n}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.d.localeCompare(b.d));
  return { d, exams };
}

/* ---------- Voce di Google (Gemini) ---------- */
const GEMINI_VOICES = [['Kore', 'Kore, femminile e chiara'], ['Aoede', 'Aoede, femminile e calda'], ['Leda', 'Leda, femminile e giovane'], ['Zephyr', 'Zephyr, luminosa'], ['Charon', 'Charon, maschile e calma'], ['Puck', 'Puck, maschile e vivace'], ['Orus', 'Orus, maschile e decisa'], ['Fenrir', 'Fenrir, maschile e intensa']];
const Voice = {
  audio: null,
  cache: new Map(),
  useGemini() { return S().ttsEngine === 'gemini' && !!S().geminiKey.trim(); },
  wav(b64, rate) {
    const pcm = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const buf = new ArrayBuffer(44 + pcm.length);
    const v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, pcm.length, true);
    new Uint8Array(buf, 44).set(pcm);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  },
  fetch(text) {
    const voice = S().ttsVoice || 'Kore';
    const key = `${voice}|${text}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const model = (S().ttsModel || '').trim() || 'gemini-2.5-flash-preview-tts';
    const p = (async () => {
      let res;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': S().geminiKey.trim() },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
          })
        });
      } catch { throw new Error('Connessione alla voce di Google non riuscita.'); }
      if (!res.ok) throw new Error(res.status === 429 ? 'Hai finito per oggi le letture gratuite della voce di Google.' : `La voce di Google ha risposto con un errore (${res.status}).`);
      const data = await res.json();
      const part = (data.candidates?.[0]?.content?.parts || []).find(x => x.inlineData || x.inline_data);
      const inl = part && (part.inlineData || part.inline_data);
      if (!inl) throw new Error('La voce di Google non ha restituito l’audio.');
      const rate = +((inl.mimeType || inl.mime_type || '').match(/rate=(\d+)/) || [0, 24000])[1];
      return this.wav(inl.data, rate);
    })();
    this.cache.set(key, p);
    p.catch(() => this.cache.delete(key));
    if (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value);
    return p;
  },
  async play(text, rate = 1) {
    const url = await this.fetch(text);
    this.stop();
    const a = new Audio(url);
    a.playbackRate = rate;
    a.preservesPitch = true;
    this.audio = a;
    await new Promise((resolve, reject) => {
      a.onended = resolve;
      a.onerror = () => reject(new Error('Non riesco a riprodurre l’audio.'));
      a.onpause = () => { if (!a.ended) resolve('stopped'); };
      a.play().catch(reject);
    });
  },
  stop() { if (this.audio) { try { this.audio.pause(); } catch { /* già fermo */ } this.audio = null; } if (canSpeak) speechSynthesis.cancel(); }
};

/* ---------- Filtro luce blu ---------- */
function applyBlueLight() {
  const st = S();
  let on = !!st.blueOn;
  if (st.blueAuto) {
    const h = new Date().getHours();
    on = h >= 21 || h < 7;
  }
  document.documentElement.classList.toggle('bluelight', on);
  document.documentElement.style.setProperty('--blue-level', String((+st.blueLevel || 35) / 100));
}
setInterval(applyBlueLight, 60000);

/* ---------------------------------------------------------------------
   Navigazione: “Torna a…”, posizione di scorrimento, ordine di lettura
   Ogni voce della cronologia ricorda da quale pagina sei arrivato; tornando
   indietro la pagina si riapre dove l’avevi lasciata.
   --------------------------------------------------------------------- */
const Nav = {
  cur: null,
  ys: new Map(),
  seq: 0,
  key(h) {
    const p = String(h || '').replace(/^#\/?/, '').split('/');
    return p[0] === 'sec' ? `sec/${p[1]}` : p.filter(Boolean).join('/') || 'notebooks';
  },
  // da chiamare all’inizio di route(): dice se è un ritorno su una pagina già vista
  enter() {
    if (this.cur) this.ys.set(this.cur.k, window.scrollY);
    if (this.cur && /^#\/sec\//.test(this.cur.hash)) Resume.save(this.cur.hash, window.scrollY);
    const st = history.state;
    let back = true;
    if (!st || !st.nbk) {
      back = false;
      const from = this.cur && this.key(this.cur.hash) !== this.key(location.hash) ? this.cur.hash : (this.cur ? this.cur.from : null);
      try { history.replaceState({ ...(st || {}), nbk: `${Date.now().toString(36)}-${++this.seq}`, from: from || null }, ''); } catch { /* niente */ }
    }
    const s2 = history.state || {};
    this.cur = { k: s2.nbk, hash: location.hash || '#/notebooks', from: s2.from || null };
    if (this.fresh) { this.fresh = false; return false; }
    return back && this.ys.has(this.cur.k);
  },
  restore() {
    const y = this.ys.get(this.cur.k) || 0;
    if (!y) return;
    // le pagine si completano in un attimo: riprovo finché c’è abbastanza altezza
    let tries = 0;
    const go = () => {
      window.scrollTo(0, y);
      if (Math.abs(window.scrollY - y) > 4 && ++tries < 12) setTimeout(go, 60);
    };
    requestAnimationFrame(go);
  },
  from() { return history.state && history.state.from || null; },
  // cambia l’indirizzo senza nuova voce (le schede di una sezione), tenendo “da dove vieni”
  replace(hash) {
    try { history.replaceState(history.state, '', hash); } catch { location.replace(hash); return; }
    if (this.cur) this.cur.hash = hash;
    this.fresh = true;   // un’altra scheda parte dall’alto
    route();
  },
  label(h) {
    const p = String(h || '').replace(/^#\/?/, '').split('/');
    if (p[0] === 'sec') { const s = secById(p[1]); return s ? `Torna a “${s.title}”` : 'Indietro'; }
    if (p[0] === 'nb') { const n = nbById(p[1]); const g = n && p[2] ? groupsOf(n).find(x => x.id === p[2]) : null; return g ? `Torna a ${g.name}` : n ? `Torna a ${n.name}` : 'Indietro'; }
    const names = { scores: 'Score clinici', viva: 'Interrogazione', papers: 'Articoli', micro: 'Microbiologia', pharma: 'Farmacologia', anat: 'Atlante di anatomia', atlas: 'Atlante diagnostico', diary: 'Diario di tirocinio', examq: 'Domande d’esame', semei: 'Semeiotica', lab: 'Medicina di laboratorio', cases: 'Casi clinici', incomplete: 'Da completare', review: 'Ripasso', search: 'Cerca', calendar: 'Calendario', clinic: 'Note cliniche', glossary: 'Glossario', cards: 'Flashcard', pdfs: 'PDF', pdf: 'PDF', notebooks: 'Notebook', tag: p[1] ? `#${p[1]}` : 'Tag', exam: 'Simulazione' };
    return names[p[0]] ? `Torna a ${names[p[0]]}` : 'Indietro';
  },
  init() {
    // “Torna a…” e i link del percorso: se portano alla pagina di prima, si torna indietro davvero
    document.addEventListener('click', e => {
      const a = e.target.closest('a.back');
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button > 0) return;
      const from = this.from();
      if (!from || this.key(a.getAttribute('href')) !== this.key(from)) return;
      e.preventDefault();
      history.back();
    });
  }
};
// sezioni del notebook nell’ordine in cui le vedi: macro-argomenti, sottoargomenti, poi le sciolte
function nbReadingOrder(nb) {
  const secs = secsOf(nb.id);
  const out = [];
  const seen = new Set();
  const add = list => list.forEach(s => { if (!seen.has(s.id)) { seen.add(s.id); out.push(s); } });
  const walk = g => { add(secs.filter(s => s.groupId === g.id)); subGroups(nb, g).forEach(walk); };
  topGroups(nb).forEach(walk);
  add(secs);
  return out;
}

/* ---------- Fonti: una per riga, i link diventano cliccabili ---------- */
const sourcesOf = r => (Array.isArray(r.sources) ? r.sources : (r.source ? [r.source] : [])).filter(x => String(x || '').trim());
function sourceLineHtml(t) {
  const re = /https?:\/\/[^\s<>"')\]]+/g;
  let out = '', last = 0, m;
  const s = String(t);
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index));
    let host = m[0];
    try { const u = new URL(m[0]); host = u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? '/…' : ''); } catch { /* resta il testo */ }
    out += `<a href="${esc(m[0])}" target="_blank" rel="noopener noreferrer" title="${esc(m[0])}">${esc(host)} ↗</a>`;
    last = m.index + m[0].length;
  }
  return out + esc(s.slice(last));
}
function editSourcesSheet(list) {
  return new Promise(resolve => {
    const sh = openSheet(`
      <h2>Fonti</h2>
      <p class="sheet-sub">Una per riga: libro e capitolo, slide della lezione, linea guida, sito. I link restano cliccabili.</p>
      <label class="field"><span>Fonti</span>
        <textarea class="input" id="srcTa" rows="6" placeholder="Harrison, 21ª ed., cap. 270&#10;Slide della lezione del 12 novembre&#10;https://www.orpha.net/…">${esc(list.join('\n'))}</textarea></label>
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-src-act="no">Annulla</button>
        <button class="btn primary" type="button" data-src-act="ok">Salva</button>
      </div>`, { label: 'Fonti', onClose: v => resolve(v === undefined ? null : v) });
    $('[data-src-act="no"]', sh.el).onclick = () => sh.close(null);
    $('[data-src-act="ok"]', sh.el).onclick = () => sh.close($('#srcTa', sh.el).value.split('\n').map(x => x.trim()).filter(Boolean));
    setTimeout(() => $('#srcTa', sh.el)?.focus(), 40);
  });
}
// risultato: { note } per segnarla, false per toglierla, null se annulli
function incompleteSheet(rec, what = 'sezione') {
  return new Promise(resolve => {
    const cur = rec.incomplete;
    const sh = openSheet(`
      <h2>${cur ? `${what === 'caso' ? 'Caso incompleto' : what === 'esame' ? 'Esame incompleto' : what === 'nota' ? 'Nota incompleta' : 'Sezione incompleta'}` : 'Segna come incompleta'}</h2>
      <p class="sheet-sub">Resta segnalata qui e nella pagina “Da completare” finché non la segni come completa.</p>
      <label class="field"><span>Cosa manca? Facoltativo</span>
        <textarea class="input" id="incTa" rows="3" placeholder="Es. letto solo il Robbins, manca la terapia">${esc(cur?.note || '')}</textarea></label>
      <div class="modal-actions">
        ${cur ? '<button class="btn ghost" type="button" data-inc="done">È completa</button>' : '<button class="btn ghost" type="button" data-inc="no">Annulla</button>'}
        <button class="btn primary" type="button" data-inc="ok">${cur ? 'Salva' : 'Segna incompleta'}</button>
      </div>`, { label: 'Incompleta', onClose: v => resolve(v === undefined ? null : v) });
    $('[data-inc="no"]', sh.el)?.addEventListener('click', () => sh.close(null));
    $('[data-inc="done"]', sh.el)?.addEventListener('click', () => sh.close(false));
    $('[data-inc="ok"]', sh.el).onclick = () => sh.close({ note: $('#incTa', sh.el).value.trim() });
    setTimeout(() => $('#incTa', sh.el)?.focus(), 40);
  });
}
async function toggleIncomplete(rec, save, what) {
  const r = await incompleteSheet(rec, what);
  if (r === null) return false;
  if (r === false) { delete rec.incomplete; toast('Segnata come completa'); }
  else { rec.incomplete = { note: r.note, since: rec.incomplete?.since || todayStr() }; toast('Segnata come incompleta'); }
  await save();
  return true;
}
const incompleteNote = r => (r.incomplete && r.incomplete.note ? r.incomplete.note : '');
// riquadro in fondo: fonti e stato di completezza
function sourcesBlockHtml(rec) {
  const list = sourcesOf(rec);
  return `
    <section class="fonti" aria-label="Fonti">
      <div class="fonti-head">
        <h3>Fonti</h3>
        <div class="inline">
          <button class="btn sm ghost" type="button" data-fonti="edit">${list.length ? 'Modifica' : 'Aggiungi una fonte'}</button>
          <button class="btn sm ghost ${rec.incomplete ? 'inc-on' : ''}" type="button" data-fonti="inc">${rec.incomplete ? '⚠ Incompleta' : 'Segna incompleta'}</button>
        </div>
      </div>
      ${list.length ? `<ol class="fonti-list">${list.map(t => `<li>${sourceLineHtml(t)}</li>`).join('')}</ol>` : '<p class="hint">Nessuna fonte. Aggiungila per ricordarti da dove viene e cosa hai già letto.</p>'}
      ${rec.incomplete ? `<p class="inc-line">⚠ Incompleta${incompleteNote(rec) ? `: ${esc(incompleteNote(rec))}` : ''} <span class="muted-inline">(dal ${esc(fmtDay(rec.incomplete.since))})</span></p>` : ''}
    </section>`;
}
function bindSourcesBlock(root, rec, save, what) {
  $('[data-fonti="edit"]', root)?.addEventListener('click', async () => {
    const list = await editSourcesSheet(sourcesOf(rec));
    if (!list) return;
    rec.sources = list;
    delete rec.source;
    await save();
    toast(list.length ? 'Fonti salvate' : 'Fonti tolte');
    route();
  });
  $('[data-fonti="inc"]', root)?.addEventListener('click', async () => { if (await toggleIncomplete(rec, save, what)) route(); });
}
function fmtDay(d) {
  if (!d) return '';
  const [y, m, dd] = String(d).split('-').map(Number);
  if (!y) return String(d);
  return new Date(y, m - 1, dd).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

