'use strict';

/* =====================================================================
   StudyHub Notebook v1.0
   Notebook di studio: importazione da testo o PDF, formattazione con AI
   (Gemini o Claude), active recall (cloze, pagina bianca, domande) e
   ripetizione dilazionata SM-2.
   ===================================================================== */

const APP_VERSION = '3.30';
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
// ==termine::suggerimento==: il suggerimento è facoltativo
// nel suggerimento niente segni che romperebbero cloze, evidenziature o tabelle
const cleanHint = v => String(v || '').replace(/\s+/g, ' ').trim().replace(/==/g, '=').replace(/\{\{/g, '(').replace(/\}\}/g, ')').replace(/\|/g, '/').replace(/\*\*/g, '');
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

async function callGemini({ system, text, pdfBase64, maxTokens = 32768, signal, model: forced }) {
  const key = S().geminiKey.trim();
  const model = forced || GemQuota.main();
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
const MORE_KEYS = ['search', 'more', 'settings', 'links', 'guide', 'calendar', 'clinic', 'glossary', 'cases', 'incomplete', 'lab'];
function route() {
  cleanups.forEach(fn => { try { fn(); } catch { /* ignora */ } });
  cleanups = [];
  const back = Nav.enter();
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
    case 'studyhub': ShDock.open(); location.replace('#/notebooks'); return;
    case 'cases': return viewCases();
    case 'lab': return viewLab(p1, p2);
    case 'incomplete': return viewIncomplete();
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
  if (nb.kind === 'cases') { location.replace('#/cases'); return; }
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
const MODES = [['cloze', 'Cloze'], ['read', 'Leggi'], ['map', 'Mappe'], ['blank', 'Pagina bianca'], ['oral', 'Orale'], ['quiz', 'Domande'], ['cards', 'Flashcard'], ['video', 'Video'], ['edit', 'Modifica']];

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
  const caseSec = isCase(sec);
  const modes = caseSec ? [['case', 'Risolvi'], ...MODES] : MODES;
  if (!modes.some(([m]) => m === mode)) mode = openMode(sec);
  const nb = nbById(sec.notebookId);
  const crumb = state.fromReview
    ? '<a class="back" href="#/review">Ripasso</a>'
    : caseSec ? '<a class="back" href="#/cases">Casi clinici</a>'
    : `<a class="back" href="#/nb/${sec.notebookId}">${esc(nb ? nb.name : 'Notebook')}${groupPathText(sec) ? ` › ${esc(groupPathText(sec))}` : ''}</a>`;
  // “Torna a…”: la pagina da cui sei arrivato, se non è già quella del percorso
  const from = Nav.from();
  const crumbHref = state.fromReview ? '#/review' : caseSec ? '#/cases' : `#/nb/${sec.notebookId}`;
  const prevLabel = from && Nav.key(from) !== Nav.key(location.hash) && Nav.key(from) !== Nav.key(crumbHref) ? Nav.label(from) : '';
  const back = `<div class="back-row">${prevLabel ? `<a class="back back-prev" href="${esc(from)}" data-nav-back title="Torna alla pagina di prima">${esc(prevLabel)}</a>` : ''}${crumb}</div>`;
  const order = nb ? nbReadingOrder(nb) : [];
  const at = order.findIndex(x => x.id === sec.id);
  const prevSec = at > 0 ? order[at - 1] : null;
  const nextSec = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  setView(`
    ${back}
    <header class="sec-head">
      <h1>${esc(sec.title)}</h1>
      ${caseSec && caseMetaBits(sec).length ? `<p class="meta case-meta">${esc(caseMetaBits(sec).join(' · '))}</p>` : ''}
      <p class="meta">${esc(srsLabel(sec))}</p>
      ${sec.incomplete ? `<button class="inc-chip" type="button" data-act="inc" title="Cosa manca">⚠ Incompleta${incompleteNote(sec) ? `: ${esc(incompleteNote(sec).slice(0, 60))}${incompleteNote(sec).length > 60 ? '…' : ''}` : ''}</button>` : ''}
      ${tagChips(tagsOf(sec))}
      <div class="sec-extra">
        ${caseSec ? '<button class="btn sm" type="button" data-act="case-meta">Dati del caso</button><button class="btn sm" type="button" data-act="case-photo">＋ Foto</button><button class="btn sm" type="button" data-act="case-pdf">＋ PDF</button>' : ''}
        <a class="btn sm" href="#/pdfs/${sec.id}">PDF${pdfsOf(sec.id).length ? ` (${pdfsOf(sec.id).length})` : ''}</a>
        ${imageRefs(sec.md).some(x => imageById(x)) ? `<button class="btn sm" type="button" data-act="labels" title="Rimetti le etichette sugli schemi">Etichette${labelImages(sec).length ? ` (${labelImages(sec).length})` : ''}</button>` : ''}
        ${secLinksOf(sec).map(l => `<a class="btn sm ghost sec-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">↗ ${esc(l.title)}</a>`).join('')}
      </div>
    </header>
    <nav class="tabs" aria-label="Modalità di studio">
      ${modes.map(([m, l]) => `<a href="#/sec/${id}/${m}" class="tab ${m === mode ? 'on' : ''}" ${m === mode ? 'aria-current="page"' : ''}>${l}${m === 'video' && videosOf(sec).length ? ` (${videosOf(sec).length})` : ''}</a>`).join('')}
    </nav>
    <section id="modeBody" class="mode-body"></section>
    ${prevSec || nextSec ? `
      <nav class="sec-pager" aria-label="Sezioni vicine">
        ${prevSec ? `<a class="pg pg-prev" href="#/sec/${prevSec.id}" rel="prev"><span class="pg-k">‹ Precedente</span><span class="pg-t">${esc(prevSec.title)}</span></a>` : '<span></span>'}
        ${nextSec ? `<a class="pg pg-next" href="#/sec/${nextSec.id}" rel="next"><span class="pg-k">Successiva ›</span><span class="pg-t">${esc(nextSec.title)}</span></a>` : '<span></span>'}
      </nav>` : ''}
  `);
  on('[data-act="labels"]', 'click', () => startLabels(sec));
  on('[data-act="inc"]', 'click', async () => { if (await toggleIncomplete(sec, () => saveSection(sec), caseSec ? 'caso' : 'sezione')) route(); });
  on('[data-act="case-meta"]', 'click', async () => { if (await caseSheet(sec)) { toast('Dati del caso salvati'); route(); } });
  on('[data-act="case-photo"]', 'click', async () => { if (await addPhotosTo(sec)) route(); });
  on('[data-act="case-pdf"]', 'click', async () => { if (await addPdfTo(sec)) route(); });
  // Cambiare scheda non riempie la cronologia: il tasto Indietro torna al notebook.
  on('.tabs a', 'click', e => { e.preventDefault(); Nav.replace(e.currentTarget.getAttribute('href')); });
  const tabsEl = $('.tabs');
  const onTab = $('.tab.on', tabsEl);
  if (tabsEl && onTab) {
    const t = onTab.getBoundingClientRect(), n = tabsEl.getBoundingClientRect();
    tabsEl.scrollLeft += t.left - n.left - (n.width - t.width) / 2;
  }
  const body = $('#modeBody');
  ({ read: modeRead, map: modeMap, cloze: modeCloze, blank: modeBlank, oral: (s, b) => modeBlank(s, b, { oral: true }), quiz: modeQuiz, cards: modeCards, video: modeVideo, edit: modeEdit, case: modeCase }[mode])(sec, body);
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
        <div class="inline">
          ${sec.studyhub.status !== 'received' ? '<a class="btn sm" href="#/studyhub" data-sh-open>Apri StudyHub qui accanto</a>' : ''}
          <button class="btn ghost sm" data-act="unlink">Riporta i ripassi nel Notebook</button>
        </div>
      </div>` : !sec.srs?.due && sec.md.trim() ? `
      <div class="callout end">
        <p>Quando hai finito di studiarla, segnala a StudyHub che pianificherà i ripassi, oppure ripassala qui.</p>
        <div class="inline">
          <button class="btn primary" data-act="studied">Segna come studiata in StudyHub</button>
          <button class="btn ghost" data-act="plan">Ripassa nel Notebook</button>
        </div>
      </div>` : ''}
    ${sourcesBlockHtml(sec)}
  `;
  bindSourcesBlock(body, sec, () => saveSection(sec), isCase(sec) ? 'caso' : 'sezione');
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
  on('[data-act="studied"]', 'click', async () => { if (await markStudiedInStudyHub(sec)) route(); }, body);
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
    <p class="hint">Prova a ricordare ogni termine, poi toccalo per controllare. Segna com’è andata col pallino accanto ai titoli o toccando il margine sinistro; trascina le estremità di una linea per allungarla o accorciarla.<span class="kbd-hint"> Con la tastiera: Spazio rivela il successivo, 1-4 per valutare.</span></p>
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
    const clean = cleanHint(v);
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
  if (Voice.useGemini()) { Voice.play(text, +(S().ttsRate || 1)).catch(err => toast(err.message, 'err')); return; }
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
    <div id="rlSum"></div>
    <div id="gradeSlot"></div>`;
  const ta = $('#recall', body);
  // segni a semaforo sugli appunti del confronto, come nel Cloze
  let rl = null;
  let aiSug = null;
  const refreshSum = () => {
    if (!rl) return;
    const s = rl.summary();
    $('#rlSum', body).innerHTML = rlSummaryHtml(s);
    if (aiSug) return;
    const k = s.lines && s.cover >= 0.5 ? s.suggest : null;
    $$('#gradeSlot .gbtn', body).forEach(b => b.classList.toggle('suggested', !!k && b.classList.contains(`g-${k}`)));
    const q = $('#gradeSlot .grade-q', body);
    if (q) q.textContent = k ? 'Voto suggerito dai segni evidenziato. Quanto ricordavi?' : 'Quanto ricordavi?';
  };
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
    const cmpNotes = $('#cmp .pane .notes', body);
    setupFolds(cmpNotes, sec.id);
    gradeBar(sec, $('#gradeSlot', body), { mode: oral ? 'oral' : 'blank' });
    if (rl) rl.destroy();
    aiSug = null;
    rl = setupRateLines(cmpNotes, sec, { kind: 'recall', onChange: refreshSum });
    refreshSum();
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
        aiSug = suggested || null;
        gradeBar(sec, $('#gradeSlot', body), { mode: oral ? 'oral' : 'blank', suggested });
        refreshSum();
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
    const clean = cleanHint(v);
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
    const pdfAi = importDraft.src === 'pdf' && importDraft.split !== 'topics' && document.querySelector('input[name="pdfMode"]:checked')?.value === 'ai';
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
        <button type="button" role="tab" data-split="topics" aria-selected="${importDraft.split === 'topics'}">Per argomenti</button>
      </div>
      <div id="splitEvery" ${importDraft.split !== 'every' ? 'hidden' : ''}>
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
      <div id="splitTopics" ${importDraft.split === 'topics' ? '' : 'hidden'}></div>
      <div class="radio" id="pdfModeBox" ${importDraft.split === 'topics' ? 'hidden' : ''}>
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
      $('#splitEvery').hidden = importDraft.split !== 'every';
      $('#splitRanges').hidden = importDraft.split !== 'ranges';
      $('#splitTopics').hidden = importDraft.split !== 'topics';
      $('#pdfModeBox').hidden = importDraft.split === 'topics';
      if (importDraft.split === 'topics') showTopics();
      est();
      syncOpts();
    }));
    // Per argomenti: analisi dei titoli (una volta per PDF), poi l’elenco delle sezioni da scegliere
    const showTopics = async () => {
      const box = $('#splitTopics');
      if (p.scanned) {
        box.innerHTML = '<p class="hint">Questo PDF non ha il testo selezionabile: per dividerlo per argomenti serve un PDF con l’OCR già fatto. Puoi farlo leggere all’AI con “Ogni tot pagine” o “Intervalli scelti”.</p>';
        est();
        return;
      }
      if (!p.outline) {
        box.innerHTML = '<p class="hint" id="tpProg">Leggo i titoli del PDF…</p>';
        if (!p.outlineTask) p.outlineTask = pdfOutline(p.doc, (n, tot) => { const el = $('#tpProg'); if (el && importDraft.pdf === p) el.textContent = `Leggo i titoli del PDF: pagina ${n} di ${tot}…`; });
        try { p.outline = await p.outlineTask; } catch (err) { box.innerHTML = `<p class="hint">Non riesco a leggere il testo del PDF: ${esc(err.message)}</p>`; return; }
        if (importDraft.pdf !== p || importDraft.split !== 'topics') return;
        if (!p.outline.levels.includes(importDraft.topicLevel)) { importDraft.topicLevel = topicAutoLevel(p.outline); importDraft.topicOff = new Set(); importDraft.topicTitles = {}; }
      }
      drawTopics();
    };
    const topicList = () => (p.outline && p.outline.headings ? topicSections(p.outline, importDraft.topicLevel || 1) : []);
    const drawTopics = () => {
      const box = $('#splitTopics');
      const o = p.outline;
      if (!o.headings) {
        box.innerHTML = `<p class="hint">Non trovo titoli in questo PDF: il testo ha tutto la stessa misura, senza numeri come 3.1 né righe in maiuscolo. Prova “Usa i capitoli del PDF” in Intervalli scelti, oppure Ogni tot pagine.</p>`;
        est();
        return;
      }
      const L = importDraft.topicLevel || 1;
      const list = topicList();
      const names = { 1: 'titoli principali (capitoli)', 2: 'titoli di 2° livello (paragrafi)', 3: 'titoli di 3° livello (sottoparagrafi)' };
      const fmt = n => n.toLocaleString('it-IT');
      box.innerHTML = `
        <p class="hint">Ho pulito il testo${o.removed ? ` (tolte ${fmt(o.removed)} righe tra intestazioni, numeri di pagina e indice)` : ''} e trovato ${fmt(o.headings)} titoli. Scegli a che livello dividere: i titoli più piccoli restano dentro la sezione.</p>
        <label class="field"><span>Una sezione per ogni</span>
          <select class="input" id="tpLevel">${o.levels.map(x => `<option value="${x}" ${x === L ? 'selected' : ''}>${names[x]}: ${topicSections(o, x).length} sezioni</option>`).join('')}</select></label>
        ${L > 1 ? `<label class="check"><input type="checkbox" id="tpGroups" ${importDraft.topicGroups ? 'checked' : ''}>
          <span>Metti le sezioni nei macro-argomenti${L > 2 ? ' e sottoargomenti' : ''} presi dai titoli più grandi</span></label>` : ''}
        <div class="inline tp-bulk"><button class="btn sm ghost" type="button" data-tp-all="1">Seleziona tutte</button><button class="btn sm ghost" type="button" data-tp-all="0">Nessuna</button></div>
        <ul class="cand tp-list">${list.map((sct, i) => `
          <li><label class="check"><input type="checkbox" data-tp="${i}" ${importDraft.topicOff.has(i) ? '' : 'checked'}>
            <span>
              <input class="input tp-title" data-tpt="${i}" value="${esc(importDraft.topicTitles[i] ?? sct.title)}" aria-label="Titolo della sezione ${i + 1}">
              <span class="cand-b">${sct.from === sct.to ? `p. ${sct.from}` : `pp. ${sct.from}–${sct.to}`} · ${fmt(sct.chars)} caratteri${sct.path.length && (importDraft.topicGroups || L === 1) ? ` · in ${esc(sct.path.join(' › '))}` : ''}${sct.chars > TOPIC_BIG_CHARS ? ' · <span class="cand-dup">molto lunga: con l’AI potrebbe essere tagliata</span>' : ''}</span>
              <details class="tp-peek"><summary>Anteprima del testo</summary><div class="tp-peek-t">${esc(sct.text.slice(0, 700))}${sct.text.length > 700 ? '…' : ''}</div></details>
            </span></label></li>`).join('')}</ul>`;
      $('#tpLevel').addEventListener('change', e => { importDraft.topicLevel = +e.target.value; importDraft.topicOff = new Set(); importDraft.topicTitles = {}; drawTopics(); });
      $('#tpGroups')?.addEventListener('change', e => { importDraft.topicGroups = e.target.checked; drawTopics(); });
      $$('[data-tp]', box).forEach(c => c.addEventListener('change', () => { if (c.checked) importDraft.topicOff.delete(+c.dataset.tp); else importDraft.topicOff.add(+c.dataset.tp); est(); }));
      $$('[data-tpt]', box).forEach(inp => {
        inp.addEventListener('input', () => { importDraft.topicTitles[+inp.dataset.tpt] = inp.value; });
        inp.addEventListener('click', e => e.preventDefault());   // scrivere nel titolo non spunta la casella
      });
      $$('[data-tp-all]', box).forEach(b => b.addEventListener('click', () => {
        importDraft.topicOff = b.dataset.tpAll === '1' ? new Set() : new Set(list.map((_, i) => i));
        drawTopics();
      }));
      est();
    };
    if (importDraft.split === 'topics') showTopics();
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
    if (p && importDraft.split === 'topics') {
      if (!p.outline) return { error: p.scanned ? 'Serve un PDF con il testo selezionabile (OCR).' : 'Sto ancora leggendo i titoli del PDF…' };
      if (!p.outline.headings) return { error: 'Senza titoli non posso dividere per argomenti: scegli un altro modo.' };
      const groups = importDraft.topicGroups || (importDraft.topicLevel || 1) === 1;
      const topics = topicSections(p.outline, importDraft.topicLevel || 1)
        .map((t, i) => ({ ...t, i, title: String(importDraft.topicTitles[i] ?? t.title).trim() || t.title, path: groups ? t.path : [] }))
        .filter(t => !importDraft.topicOff.has(t.i));
      if (!topics.length) return { error: 'Scegli almeno una sezione.' };
      return { topics, count: topics.length };
    }
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
      if (r.topics) {
        job.topics = true;
        job.pdfMode = 'text';     // l’AI riceve il testo pulito della sezione, non le pagine
        job.opts.ai = $('#optAi').checked && aiOk;
        r.topics.forEach(t => job.items.push({ label: `${t.title}, ${pagesLabel(t.from, t.to).toLowerCase()}`, pages: pagesLabel(t.from, t.to), title: t.title, from: t.from, to: t.to, text: t.text, path: t.path, status: 'wait' }));
      } else if (r.ranges) {
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
    let groupId = job.groupId;
    try {
      if (it.path && it.path.length) groupId = await ensureTopicGroup(job, it.path);
      let pdfB64 = null;
      if (job.kind === 'pdf') {
        if (job.pdfMode === 'ai') pdfB64 = await subsetPdfBase64(job, it.from, it.to);
        else if (!it.text) text = await extractRange(job.pdf.doc, it.from, it.to);
      }
      if (signal.aborted) throw abortError();
      let sec;
      if (job.opts.ai) {
        const r = await aiFormatNotes({
          text, pdfBase64: pdfB64, cloze: job.opts.cloze, questions: job.opts.questions, signal,
          onWait: (ms, e) => { it.wait = `${e && e.status === 429 ? (e.tokens ? 'Limite di testo al minuto' : 'Limite di richieste al minuto') : 'Servizio occupato'}: riprovo tra ${Math.round(ms / 1000)} secondi`; renderProgress(); }
        });
        it.wait = '';
        const title = (job.kind === 'text' && job.title) || it.title ? baseTitle : (r.title || baseTitle || firstLineTitle(r.md));
        sec = newSection(job.nbId, { groupId, title, md: r.md, questions: r.questions, source });
        if (r.truncated) it.note = 'Risposta troncata: controlla la fine della sezione o usa meno pagine.';
      } else {
        if (!text.trim()) throw new Error('Nessun testo trovato in queste pagine: forse è una scansione.');
        sec = newSection(job.nbId, { groupId, title: baseTitle || firstLineTitle(text), md: basicFormat(text), source });
      }
      // per argomenti due sezioni possono condividere una pagina: le sue immagini vanno solo nella prima
      const imgFrom = job.topics ? Math.max(it.from, (job.imgUpTo || 0) + 1) : it.from;
      if (job.kind === 'pdf' && job.keepImgs && imgFrom <= it.to) {
        it.wait = 'Ritaglio le immagini…';
        renderProgress();
        try {
          job.imgUpTo = it.to;
          const extra = await pdfImagesMd(job, imgFrom, it.to, signal);
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
          const sec = newSection(job.nbId, { groupId, title: baseTitle || firstLineTitle(text), md: basicFormat(text), source });
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
      ${p === 'gemini' ? `<label class="field"><span>Modelli di riserva, separati da virgola</span>
        <input class="input" id="geminiBackup" value="${esc(st.geminiBackup ?? Settings.defaults.geminiBackup)}" list="geminiModels" spellcheck="false" placeholder="${Settings.defaults.geminiBackup}"></label>
      <p class="hint">Con la chiave gratuita ogni modello ha un numero di richieste al giorno. Quando il modello principale le finisce, l’app passa da sola a quello di riserva fino alle ${geminiResetLabel()}, quando ripartono.</p>
      <div id="gemPaused"></div>` : ''}
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
      <label class="field"><span>Indirizzo di StudyHub</span>
        <input class="input" type="url" id="stShUrl" value="${esc(st.studyhubUrl || '')}" placeholder="${SH_URL}" spellcheck="false" autocomplete="off"></label>
      <p class="hint">StudyHub si apre accanto al Notebook (sul telefono in basso) dal menu o da Altro. Gli argomenti studiati gli arrivano da soli se sta sullo stesso sito del Notebook, come metallia13-ctrl.github.io. Lascia vuoto per l’indirizzo di sempre.</p>
      <a class="btn sm" href="#/studyhub" data-sh-open>Apri StudyHub qui accanto</a>
    </section>

    <section class="block">
      <h2>Importazione</h2>
      <label class="field narrow"><span>Pagine per sezione, valore iniziale</span>
        <input class="input" type="number" id="stPer" min="1" max="30" value="${st.pagesPerSection}" inputmode="numeric"></label>
    </section>

    <section class="block">
      <h2>Lettura e aspetto</h2>
      <div class="field"><span class="lbl">Filtro luce blu</span>
        <label class="check"><input type="checkbox" id="stBlue" ${st.blueOn ? 'checked' : ''}><span>Attivo, colori più caldi per la sera</span></label>
        <label class="check"><input type="checkbox" id="stBlueAuto" ${st.blueAuto ? 'checked' : ''}><span>Automatico dalle 21 alle 7</span></label>
        <label class="field narrow"><span>Intensità</span><input type="range" id="stBlueLevel" min="10" max="70" step="5" value="${+st.blueLevel || 35}"></label>
      </div>
      <div class="field"><span class="lbl">Voce per l’ascolto</span>
        <select class="input" id="stTtsEngine">
          <option value="system" ${st.ttsEngine !== 'gemini' ? 'selected' : ''}>Voce del telefono</option>
          <option value="gemini" ${st.ttsEngine === 'gemini' ? 'selected' : ''}>Voce di Google (Gemini), più naturale</option>
        </select>
        <div class="grid2 tts-opts">
          <label class="field" id="ttsGemBox" ${st.ttsEngine === 'gemini' ? '' : 'hidden'}><span>Voce di Google</span><select class="input" id="stTtsVoice">${GEMINI_VOICES.map(([v, l]) => `<option value="${v}" ${(st.ttsVoice || 'Kore') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field" id="ttsSysBox" ${st.ttsEngine === 'gemini' ? 'hidden' : ''}><span>Voce del telefono</span><select class="input" id="stTtsSys"><option value="">Automatica</option></select></label>
          <div class="field"><span class="lbl">&nbsp;</span><button class="btn" type="button" data-act="tts-test">Prova la voce</button></div>
        </div>
        <p class="hint">La voce di Google usa la tua chiave di Gemini (la stessa dell’AI) e internet; ogni paragrafo viene preparato mentre ascolti il precedente. Se la chiave manca o finisce la quota gratuita, l’app torna alla voce del telefono. Per migliorare la voce del telefono: Impostazioni di Android → Sintesi vocale → “Servizi Google” e scarica la voce italiana di qualità alta.</p>
      </div>
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
  const blueSave = () => { st.blueOn = $('#stBlue').checked; st.blueAuto = $('#stBlueAuto').checked; st.blueLevel = +$('#stBlueLevel').value; Settings.save(); applyBlueLight(); };
  ['#stBlue', '#stBlueAuto'].forEach(id => $(id).addEventListener('change', blueSave));
  $('#stBlueLevel').addEventListener('input', blueSave);
  const fillSys = () => {
    const sel = $('#stTtsSys');
    if (!sel || !canSpeak) return;
    const vs = speechSynthesis.getVoices().filter(v => /^it/i.test(v.lang));
    sel.innerHTML = `<option value="">Automatica</option>${vs.map(v => `<option value="${esc(v.name)}" ${st.ttsSystemVoice === v.name ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}`;
  };
  fillSys();
  if (canSpeak) speechSynthesis.addEventListener?.('voiceschanged', fillSys, { once: true });
  $('#stTtsEngine').addEventListener('change', e => {
    if (e.target.value === 'gemini' && !st.geminiKey.trim()) { toast('Per la voce di Google serve la chiave di Gemini, qui sopra', 'err'); e.target.value = 'system'; return; }
    st.ttsEngine = e.target.value; Settings.save();
    $('#ttsGemBox').hidden = st.ttsEngine !== 'gemini';
    $('#ttsSysBox').hidden = st.ttsEngine === 'gemini';
  });
  $('#stTtsVoice').addEventListener('change', e => { st.ttsVoice = e.target.value; Settings.save(); });
  $('#stTtsSys')?.addEventListener('change', e => { st.ttsSystemVoice = e.target.value; Settings.save(); });
  on('[data-act="tts-test"]', 'click', async e => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = 'Preparo…';
    try {
      if (Voice.useGemini()) await Voice.play('Ciao! Questa è la voce che leggerà i tuoi appunti. La gittata cardiaca è il prodotto della frequenza per il volume sistolico.', +(st.ttsRate || 1));
      else speak('Ciao! Questa è la voce che leggerà i tuoi appunti. La gittata cardiaca è il prodotto della frequenza per il volume sistolico.');
    } catch (err) { toast(err.message, 'err'); }
    b.disabled = false;
    b.textContent = 'Prova la voce';
  });
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
  const drawPaused = () => {
    const box = $('#gemPaused');
    if (!box) return;
    const list = GemQuota.paused();
    box.innerHTML = list.length ? `<p class="hint">In pausa fino alle ${geminiResetLabel()}: ${list.map(x => `“${esc(x.model)}”${x.why === 'zero' ? ' (senza richieste gratuite)' : ''}`).join(', ')}. <button class="btn sm ghost" type="button" data-gem-retry>Riprova adesso</button></p>` : '';
    const b = $('[data-gem-retry]', box);
    if (b) b.onclick = () => { GemQuota.clear(); drawPaused(); toast('Riprovo i modelli Gemini alla prossima richiesta'); };
  };
  drawPaused();
  $('#geminiBackup').addEventListener('change', e => {
    st.geminiBackup = e.target.value.split(/[,\s]+/).map(x => x.trim().replace(/^models\//, '')).filter(Boolean).join(', ');
    e.target.value = st.geminiBackup;
    Settings.save();
    toast(st.geminiBackup ? 'Modelli di riserva salvati' : 'Nessun modello di riserva');
  });
  ['gemini', 'claude'].forEach(p => {
    $(`#${p}Key`).addEventListener('change', e => { st[p + 'Key'] = e.target.value.trim(); Settings.save(); GemQuota.clear(); toast('Chiave salvata'); });
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
      if (p === 'gemini') {
        // prova proprio il modello scelto, senza passare a quello di riserva
        await AI.withRetry(() => callGemini({ text: 'Rispondi solo con la parola: ok', maxTokens: 2000 }), { onWait: ms => { msg.textContent = `Limite al minuto: riprovo tra ${Math.round(ms / 1000)} secondi…`; } });
      } else await AI.generate({ provider: p, text: 'Rispondi solo con la parola: ok', maxTokens: 2000 });
      msg.textContent = `Connessione riuscita con ${S()[p + 'Model']}.`;
    } catch (err) {
      if (p === 'gemini' && (err.quota === 'day' || err.quota === 'zero')) { GemQuota.markOut(GemQuota.main(), err.quota); drawPaused(); }
      msg.textContent = err.message;
    }
  });
  $('#stShUrl').addEventListener('change', e => {
    const v = e.target.value.trim();
    if (v && !/^https?:\/\/\S+$/i.test(v)) { toast('Scrivi l’indirizzo completo, che inizia con https://', 'err'); return; }
    st.studyhubUrl = v;
    Settings.save();
    ShDock.reset();
    toast(v ? 'Indirizzo di StudyHub salvato' : 'Uso l’indirizzo di sempre di StudyHub');
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
  // le | delle evidenziature {{y|…}} non separano le celle
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').replace(/\{\{([uygbpovrtl])\|/g, '{{$1\u0001').split('|').map(x => x.replace(/\u0001/g, '|').trim());
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
    ShDock.refresh();
  },
  pending() { return this.read(this.OUT).length; },
  async prune() {
    const acks = new Set(this.read(this.ACK));
    if (!acks.size) return;
    const out = this.read(this.OUT);
    const done = out.filter(e => acks.has(e.id));
    if (!done.length) return;
    localStorage.setItem(this.OUT, JSON.stringify(out.filter(e => !acks.has(e.id))));
    ShDock.refresh();
    const changed = [];
    for (const ev of done) {
      if (ev.type !== 'topic-studied') continue;
      const sec = secById(ev.sectionId);
      if (sec && sec.studyhub && sec.studyhub.status !== 'received') {
        sec.studyhub = { ...sec.studyhub, status: 'received', receivedOn: todayStr() };
        await saveSection(sec);
        changed.push(sec.id);
      }
    }
    // la sezione aperta mostra subito che StudyHub l’ha ricevuta
    const h = location.hash;
    if (changed.some(id => h.startsWith(`#/sec/${id}`)) && !/\/edit/.test(h) && !$('#modalRoot').children.length) {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
      if (!typing) { const y = window.scrollY; route(); window.scrollTo(0, y); }
    }
  }
};

function deepLink(sec, mode = defaultMode(sec)) {
  return `${location.origin}${location.pathname}#/sec/${sec.id}/${mode}`;
}
// Ritorna false se scegli Annulla nella finestra di StudyHub
async function markStudiedInStudyHub(sec) {
  const nb = nbById(sec.notebookId);
  const place = await shPlaceSheet(sec);
  if (place === false) return false;
  Bridge.send({
    type: 'topic-studied',
    sectionId: sec.id,
    notebookId: sec.notebookId,
    subject: nb ? nb.name : '',
    macro: groupOf(sec)?.name || '',
    topic: sec.title,
    studiedOn: todayStr(),
    url: deepLink(sec),
    ...(place || {})
  });
  sec.studyhub = { status: 'pending', since: todayStr() };
  await saveSection(sec);
  if (ShDock.isOpen()) toast('Segnata come studiata: StudyHub pianificherà i ripassi');
  else toast('Segnata come studiata: StudyHub pianificherà i ripassi', '', { label: 'Apri StudyHub', fn: () => ShDock.open() });
  return true;
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
  const hit = sec.studyhub.status === 'received' ? shTopicOf(sec) : null;
  if (hit) {
    const t = hit.t;
    const when = t.learn && typeof t.learn.due === 'number' ? 'in apprendimento, ripetizioni nel corso della giornata'
      : t.next ? `prossimo ripasso ${fmtDue(t.next)}` : 'ripassi pianificati';
    return `In StudyHub, ${hit.name}: ${when}.`;
  }
  return sec.studyhub.status === 'received'
    ? 'StudyHub ha ricevuto l’argomento e ne pianifica i ripassi.'
    : 'In attesa che StudyHub la riceva: aprilo su questo dispositivo, anche qui accanto.';
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
    if (s && !(await markStudiedInStudyHub(s))) { btn.disabled = false; return; }
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
      <p class="lede">Tocca un argomento per aprirlo. In ogni pagina il tasto ? accanto ai titoli spiega a cosa serve.</p></div>
      <button class="btn" type="button" data-act="tutorial">Rivedi il tutorial</button></header>
    ${sec('Primi passi', `
      <ol>
        <li>Crea un <strong>notebook</strong> per ogni materia (Notebook → Nuovo notebook).</li>
        <li>In <strong>Importa</strong> incolla del testo, carica un PDF o una mappa XMind: l’app crea le sezioni.</li>
        <li>Se la materia è vasta, dividila in <strong>macro-argomenti</strong> (Nuovo macro-argomento): le sezioni dentro sono i micro-argomenti.</li>
        <li>Apri una sezione: se ha termini cloze parte da <strong>Cloze</strong>, così non vedi le risposte prima di provarci. Poi Leggi, Pagina bianca, Domande o Flashcard.</li>
        <li>Quando hai finito, scegli se far pianificare i ripassi a <strong>StudyHub</strong> o al Notebook.</li>
      </ol>
      <p>Per formattare con l’AI serve una chiave API (Impostazioni → Intelligenza artificiale). L’abbonamento Gemini dell’app non basta: la chiave si crea gratis su Google AI Studio.</p>`, true)}
    ${sec('Novità della 3.30: Medicina di laboratorio', `
      <ul>
        <li>Da Altro → <strong>Medicina di laboratorio</strong>. Ogni esame ha la sua scheda: campione e preparazione, range (anche diversi per uomini, donne o età) con la loro fonte, valori critici, cause di aumento e diminuzione, interferenze, andamento nel tempo, quando richiederlo, uso diagnostico, note, note cliniche collegate, fonti e “incompleto”.</li>
        <li><strong>Uso diagnostico</strong>: una riga per malattia e soglia con sensibilità e specificità; LR+ e LR− li calcola l’app.</li>
        <li><strong>Elenco di base</strong>: oltre 110 esami in 16 categorie, con nome, sigla, campione e unità più usate in Italia. I range li aggiungi tu dalla tua fonte, perché cambiano da laboratorio a laboratorio.</li>
        <li><strong>Compila con l’AI</strong> riempie i campi vuoti di una scheda e la segna come incompleta, da verificare.</li>
        <li><strong>Leggi un referto</strong>: scrivi esami e valori e l’app segna quelli bassi, alti o critici secondo le tue schede.</li>
        <li><strong>Calcoli</strong>: gap anionico, calcio corretto, eGFR CKD-EPI 2021, LDL di Friedewald, osmolalità e gap osmolare, sodio corretto.</li>
        <li><strong>Allenati</strong>: domande a caso dalle tue schede. Gli esami compaiono anche in Cerca e nelle note cliniche collegate.</li>
      </ul>`)}
    ${sec('Novità della 3.29: tutorial e tasti ?', `
      <ul>
        <li>Al primo avvio parte un <strong>tutorial</strong> a passi; lo rivedi da qui con “Rivedi il tutorial”.</li>
        <li>Il tasto <strong>?</strong> accanto ai titoli delle pagine, ai gruppi delle Impostazioni, alle opzioni di Importa e alle schede di una sezione spiega a cosa serve quella parte.</li>
      </ul>`)}
    ${sec('Novità della 3.28: casi clinici, fonti e “Da completare”', `
      <ul>
        <li><strong>Casi clinici</strong> (da Altro): “Nuovo caso” chiede titolo, data, dove l’hai visto (lezione, tirocinio, libro), docente, specialità e materia, e prepara lo schema: presentazione, anamnesi, esame obiettivo, esami, diagnosi differenziale, diagnosi, terapia, punti chiave. Niente dati che rendano riconoscibile il paziente.</li>
        <li>Nel caso, <strong>＋ Foto</strong> aggiunge una o più foto (sul telefono puoi scattarle al momento) in fondo, sotto “Allegati”; <strong>＋ PDF</strong> allega slide o referti. Per Word o PowerPoint salva prima in PDF.</li>
        <li>La scheda <strong>Risolvi</strong> mostra il caso una parte alla volta. Prima della diagnosi differenziale e della diagnosi ti chiede la tua ipotesi, poi la confronti. Alla fine lo valuti come una sezione, così torna nei ripassi.</li>
        <li>Nella pagina dei casi cerchi per sintomi, esami o diagnosi e filtri per specialità, materia o contesto.</li>
        <li><strong>Fonti</strong>: in fondo a ogni sezione e caso (in Leggi) e in ogni nota clinica, una per riga; i link restano cliccabili.</li>
        <li><strong>Segna incompleta</strong>: accanto alle fonti, con una nota su cosa manca. Resta segnalata in cima alla sezione e nell’elenco del notebook, e tutto finisce nella pagina <strong>Da completare</strong> (da Altro), dal più vecchio.</li>
      </ul>`)}
    ${sec('Novità della 3.27: PDF divisi per argomenti', `
      <ul>
        <li>In Importa, con un PDF che ha il testo selezionabile (anche con l’OCR fatto da te), scegli <strong>Per argomenti</strong>. L’app legge i titoli: quelli più grandi del testo, quelli numerati come 3.1 o 3.1.2 e le righe in maiuscolo.</li>
        <li>Il testo viene pulito come se l’avessi incollato tu: niente intestazioni e piè di pagina ripetuti, numeri di pagina o pagine dell’indice, e le parole spezzate a capo tornano intere.</li>
        <li>Scegli il livello (capitoli, paragrafi o sottoparagrafi): ogni titolo di quel livello diventa una sezione, i titoli più piccoli restano dentro come sottotitoli. Le parti troppo brevi si uniscono alla sezione vicina.</li>
        <li>I titoli più grandi possono diventare macro-argomenti e sottoargomenti, creati da soli (o ritrovati, se esistono già).</li>
        <li>Prima di importare vedi l’elenco: togli le sezioni che non vuoi, correggi i titoli, guarda l’anteprima del testo.</li>
        <li>Con la formattazione AI, ogni sezione manda solo il suo testo e non le pagine: richieste più leggere, che fanno scattare molto meno i limiti di Gemini.</li>
      </ul>`)}
    ${sec('Novità della 3.26: video, etichette e tasto Torna', `
      <ul>
        <li><strong>Video</strong>: ogni sezione ha la scheda Video. Incolli il link (YouTube, Vimeo, Google Drive o un file video) e lo guardi lì, con titolo e note. Nelle note i minuti scritti come 12:30 diventano pulsanti che portano a quel punto del video.</li>
        <li><strong>Etichette</strong>: tocca “Etichette” in cima a una sezione con immagini, oppure tocca un’immagine e scegli “Ritaglia le etichette”. Trascina sopra ogni scritta da staccare; se hai già un’image occlusion puoi riusarne i riquadri. Nell’esercizio le scritte spariscono e le etichette, mescolate, vanno trascinate al posto giusto (o toccate, e poi tocchi il riquadro). “Controlla” colora di verde le giuste e rimanda indietro le sbagliate; con Zoom ingrandisci gli schemi fitti.</li>
        <li><strong>Torna a…</strong>: se arrivi in una sezione da un’altra (con un collegamento, dalla ricerca o dal ripasso), in alto c’è “Torna a” con il nome della pagina di prima. Tornando, anche il notebook si riapre al punto in cui eri. In fondo a ogni sezione trovi la precedente e la successiva del notebook.</li>
        <li><strong>Gemini</strong>: quando dice che il limite è raggiunto ora spiega quale (troppe richieste in un minuto, testo troppo lungo o richieste gratuite del giorno finite) e a che ora ripartono. Finite quelle del giorno passa da solo al modello di riserva, che scegli in Impostazioni.</li>
      </ul>`)}
    ${sec('Novità della 3.25: StudyHub collegato davvero', `
      <ul>
        <li><strong>Segna come studiata in StudyHub</strong> ora chiede in quale materia e dove: dentro un argomento (per esempio un macro-argomento) oppure collegata a un argomento che hai già, come quelli importati dal programma. La materia scelta resta come proposta per le altre sezioni dello stesso notebook.</li>
        <li>StudyHub riceve l’argomento appena è aperto su questo dispositivo, anche nel pannello qui accanto, e lo mette in apprendimento. Nella sezione vedi la materia e il prossimo ripasso deciso da StudyHub.</li>
        <li>Nel pannello StudyHub parte in <strong>modalità mini</strong>, con i ripassi del giorno. “Appunti nel Notebook” apre la sezione qui a fianco: la ripassi col Cloze o a voce, la valuti e il voto arriva a StudyHub.</li>
        <li>Se ripassi in anticipo e va bene, StudyHub lo annota senza spostare il ripasso; se va male, lo anticipa.</li>
        <li>“Riporta i ripassi nel Notebook” toglie da StudyHub l’argomento creato dal Notebook; uno che c’era già resta, scollegato, con una nota.</li>
      </ul>`)}
    ${sec('Novità della 3.24: semaforo nell’orale e StudyHub qui accanto', `
      <ul>
        <li><strong>Orale e Pagina bianca</strong>: dopo “Confronta con gli appunti” segni com’è andata come nel Cloze. Il pallino accanto a ogni titolo cambia colore (verde, giallo, arancio, rosso) e colora la linea a sinistra di quel paragrafo.</li>
        <li><strong>Margini trascinabili</strong>, anche nel Cloze: trascina il pallino in cima o in fondo a una linea per allungarla o accorciarla; si aggancia al paragrafo o alla voce di elenco più vicini. Sul PC puoi anche usare le frecce su e giù.</li>
        <li>Per segnare un <strong>punto preciso</strong>, tocca il margine sinistro accanto al paragrafo e scegli il colore. Toccando una linea la ricolori o la togli; “Tutto il paragrafo” la riporta alla misura di partenza.</li>
        <li>Sotto il confronto vedi il <strong>riepilogo</strong> dei colori e, se hai segnato almeno metà degli appunti, il voto suggerito tra i quattro pulsanti. La valutazione dell’AI, se la chiedi, ha la precedenza.</li>
        <li>Le parti che restano rosse o arancio più volte finiscono nei <strong>punti deboli</strong>, insieme a quelle del Cloze.</li>
        <li><strong>StudyHub qui accanto</strong>: dal menu (sul telefono da Altro) si apre a destra, o in basso sul telefono. Trascina il bordo per allargarlo o stringerlo; con le icone in alto lo ingrandisci, lo ricarichi o lo apri a parte. Mentre è aperto qui, StudyHub è attivo su questo dispositivo: non serve aprirlo a parte perché legga gli argomenti che segni come studiati. Il numero sull’icona dice quanti aspettano.</li>
      </ul>`)}
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
    ${sec('Mappe XMind', `
      <p>Ogni sezione ha la scheda <strong>Mappe</strong>: carichi un file .xmind e lo leggi come <strong>mappa</strong> (rami colorati, zoom con due dita o Ctrl + rotellina, tocchi un nodo per chiuderne o aprirne i rami) o come <strong>elenco</strong>. <strong>Ripassa</strong> copre tutti i rami: prova a ricordarli e toccali per scoprirli. Da <strong>Altro</strong> crei le flashcard della mappa, la aggiungi agli appunti come elenco, carichi altre mappe, la rinomini o la elimini. Si salva la struttura della mappa (titoli e note, non le immagini) e si sincronizza con la sezione.</p>`)}
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
  on('[data-act="tutorial"]', 'click', openTutorial);
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
        ${ctx && ctx.sectionId ? `<button class="btn" data-lb="labels">${(labelSets(secById(ctx.sectionId) || {})[imageId]?.masks || []).length ? 'Rimetti le etichette' : 'Ritaglia le etichette'}</button>` : ''}
        <button class="btn primary" data-lb="close">Chiudi</button>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  $('[data-lb="close"]', root).onclick = close;
  const io = $('[data-lb="io"]', root);
  if (io) io.onclick = () => { close(); openOcclusionEditor({ imageId, ...ctx }); };
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
  ['studyhub', 'StudyHub', 'Il tuo planner, aperto qui accanto senza lasciare il Notebook'],
  ['calendar', 'Calendario', 'Ripassi in programma, tempo di studio, punti deboli'],
  ['clinic', 'Note cliniche', 'Quadri clinici di tutte le materie, per sintomo'],
  ['cases', 'Casi clinici', 'I casi visti a lezione e in tirocinio, con foto, PDF e modalità Risolvi'],
  ['lab', 'Medicina di laboratorio', 'Esami con range, cause e uso diagnostico; referti, calcoli e allenamento'],
  ['incomplete', 'Da completare', 'Sezioni, casi e note che hai segnato come incompleti'],
  ['glossary', 'Glossario', 'Parole particolari e il loro significato'],
  ['tag', 'Tag', 'Appunti e flashcard per etichetta'],
  ['links', 'Link utili', 'I siti che usi per studiare'],
  ['guide', 'Guida', 'Come funziona ogni parte dell’app'],
  ['settings', 'Impostazioni', 'AI, sincronizzazione, lettura, backup']
];
function viewMore() {
  setView(`
    <header class="page-head"><h1>Altro</h1>
      <label class="check blue-quick"><input type="checkbox" id="blueQuick" ${document.documentElement.classList.contains('bluelight') ? 'checked' : ''}><span>Filtro luce blu</span></label>
    </header>
    <div class="tile-grid wide-grid">
      ${MORE_ITEMS.map(([k, label, sub]) => `
        <a class="tile wide" href="#/${k}">
          <span class="tile-ic app-ic" style="--h:${hueOf(k + 'x')}">${ICONS[k]}</span>
          <span class="tile-text"><span class="tile-name">${label}</span><span class="tile-sub">${sub}</span></span>
        </a>`).join('')}
    </div>`);
  $('#blueQuick').addEventListener('change', e => { S().blueOn = e.target.checked; S().blueAuto = false; Settings.save(); applyBlueLight(); });
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
  const st = statsMerged().d;
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
  const exams = (statsMerged().exams || []).slice(-5).reverse();

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
    <p class="hint">Il tempo si conta mentre studi sezioni, flashcard e PDF, e si somma tra i tuoi dispositivi sincronizzati.</p>

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
      <label class="field"><span>Fonti, una per riga</span><textarea class="input" id="cnSrc" rows="2" placeholder="Harrison, cap. 270&#10;https://www.orpha.net/…">${esc(sourcesOf(e).join('\n'))}</textarea></label>
      <label class="check"><input type="checkbox" id="cnInc" ${e.incomplete ? 'checked' : ''}><span>Incompleta</span></label>
      <label class="field" id="cnIncBox" ${e.incomplete ? '' : 'hidden'}><span>Cosa manca? Facoltativo</span><input class="input" id="cnIncNote" value="${esc(e.incomplete?.note || '')}" placeholder="Es. manca la terapia"></label>
      <div class="modal-actions">
        ${entry ? '<button class="btn ghost danger" type="button" data-cn-act="del">Elimina</button>' : ''}
        <button class="btn ghost" type="button" data-cn-act="no">Annulla</button>
        <button class="btn primary" type="button" data-cn-act="ok">Salva</button>
      </div>`, { label: 'Nota clinica', onClose: resolve });
    bindTagField(sh.el, 'cnSyms');
    $('#cnInc', sh.el).addEventListener('change', ev => { $('#cnIncBox', sh.el).hidden = !ev.target.checked; });
    $('[data-cn-act="no"]', sh.el).onclick = () => sh.close(false);
    const del = $('[data-cn-act="del"]', sh.el);
    if (del) del.onclick = async () => { await removeRecords([{ store: 'links', rec: entry }]); toast('Nota clinica eliminata'); sh.close(true); };
    $('[data-cn-act="ok"]', sh.el).onclick = async () => {
      const title = $('#cnTitle', sh.el).value.trim();
      if (!title) { toast('Scrivi il quadro clinico'); $('#cnTitle', sh.el).focus(); return; }
      const rec = entry || { id: uid(), kind: 'clinical', notebookId: '_clinical', created: Date.now(), sectionId: prefill.sectionId || '' };
      Object.assign(rec, { title, symptoms: parseTags($('#cnSyms', sh.el).value), nbId: $('#cnNb', sh.el).value || '', body: $('#cnBody', sh.el).value.trim() });
      rec.sources = $('#cnSrc', sh.el).value.split('\n').map(x => x.trim()).filter(Boolean);
      if ($('#cnInc', sh.el).checked) rec.incomplete = { note: $('#cnIncNote', sh.el).value.trim(), since: rec.incomplete?.since || todayStr() };
      else delete rec.incomplete;
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
    ${n.incomplete ? `<p class="inc-line">⚠ Incompleta${incompleteNote(n) ? `: ${esc(incompleteNote(n))}` : ''}</p>` : ''}
    ${n.body ? `<div class="notes cn-body">${renderMd(n.body)}</div>` : ''}
    ${labExams().some(x => (x.clinic || []).includes(n.id)) ? `<div class="fonti fonti-mini"><h3>Esami di laboratorio</h3><div class="tags">${labExams().filter(x => (x.clinic || []).includes(n.id)).map(x => `<a class="tag" href="#/lab/${x.id}" data-g="lab">${esc(x.name)}</a>`).join('')}</div></div>` : ''}
    ${sourcesOf(n).length ? `<div class="fonti fonti-mini"><h3>Fonti</h3><ol class="fonti-list">${sourcesOf(n).map(t => `<li>${sourceLineHtml(t)}</li>`).join('')}</ol></div>` : ''}
    ${sec ? `<p class="source">Dalla sezione <a href="#/sec/${sec.id}" data-g="go">${esc(sec.title)}</a></p>` : ''}
    <div class="modal-actions">
      <button class="btn ghost" type="button" data-g="edit">Modifica</button>
      <button class="btn primary" type="button" data-g="close">Chiudi</button>
    </div>`, { label: n.title });
  $('[data-g="close"]', sh.el).onclick = () => sh.close();
  const go2 = $('[data-g="go"]', sh.el);
  if (go2) go2.onclick = () => sh.close();
  $$('[data-g="lab"]', sh.el).forEach(a => { a.onclick = () => sh.close(); });
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
const PDF_TOOLS = [
  ['select', 'Seleziona', '<svg viewBox="0 0 24 24"><path d="M5 3l14 8-6 2-3 6z"/></svg>', 'Seleziona il testo'],
  ['hl', 'Evidenzia', '<svg viewBox="0 0 24 24"><path d="M4 20h7M14 4l6 6-8 8H6v-6z"/></svg>', 'Evidenzia: seleziona il testo e si colora da solo'],
  ['ul', 'Sottolinea', '<svg viewBox="0 0 24 24"><path d="M7 4v6a5 5 0 0 0 10 0V4M5 20h14"/></svg>', 'Sottolinea il testo che selezioni'],
  ['st', 'Barra', '<svg viewBox="0 0 24 24"><path d="M4 12h16M8 6a4 3 0 0 1 8 0M16 18a4 3 0 0 1-8 0"/></svg>', 'Barra il testo che selezioni'],
  ['pen', 'Penna', '<svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>', 'Scrivi e disegna a mano'],
  ['shape', 'Forme', '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="10" height="10" rx="1"/><circle cx="16" cy="16" r="5"/></svg>', 'Rettangoli, cerchi, frecce e linee'],
  ['text', 'Testo', '<svg viewBox="0 0 24 24"><path d="M5 5h14M12 5v14M9 19h6"/></svg>', 'Scrivi un testo sulla pagina'],
  ['note', 'Nota', '<svg viewBox="0 0 24 24"><path d="M5 4h14v12l-5 5H5z"/><path d="M14 21v-5h5"/></svg>', 'Una nota dove tocchi'],
  ['occ', 'Occludi', '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M8 12h8"/></svg>', 'Copri etichette e valori per ripassarli'],
  ['eraser', 'Gomma', '<svg viewBox="0 0 24 24"><path d="M16 3l5 5-11 11H5l-2-2z"/><path d="M9 21h12"/></svg>', 'Cancella annotazioni']
];
function shapeSvg(a, live = false) {
  const [x1, y1, x2, y2] = a.box;
  const st = `stroke="${esc(a.color)}" stroke-width="${a.w}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const id = live ? '' : ` data-id="${a.id}"`;
  if (a.kind === 'ellipse') return `<ellipse class="ann-shape"${id} cx="${(x1 + x2) / 2}" cy="${(y1 + y2) / 2}" rx="${Math.abs(x2 - x1) / 2}" ry="${Math.abs(y2 - y1) / 2}" ${st}/>`;
  if (a.kind === 'line' || a.kind === 'arrow') {
    let head = '';
    if (a.kind === 'arrow') {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const L = 6 + a.w * 2;
      const p = k => `${(x2 - L * Math.cos(ang + k)).toFixed(2)} ${(y2 - L * Math.sin(ang + k)).toFixed(2)}`;
      head = ` M${p(0.45)} L${x2} ${y2} L${p(-0.45)}`;
    }
    return `<path class="ann-shape"${id} d="M${x1} ${y1} L${x2} ${y2}${head}" ${st}/>`;
  }
  return `<rect class="ann-shape"${id} x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}" rx="2" ${st}/>`;
}
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
        <div class="pdf-toolset" role="radiogroup" aria-label="Strumento">
          ${PDF_TOOLS.map(([k, label, icon, tip]) => `<button type="button" class="pdf-tool" data-tool="${k}" role="radio" title="${esc(tip)}">${icon}<span>${label}</span></button>`).join('')}
        </div>
        <span class="pdf-pen-opts" hidden>
          <span class="pdf-hl-colors">${PDF_COLORS.map(([k, , , n]) => `<button type="button" class="rt-dot pdf-hl-dot" data-hlc="${k}" style="--dot:${pdfCol(k)}" aria-label="${n}" title="${n}"></button>`).join('')}</span>
          <span class="pdf-ink-colors">${PEN_INKS.map(([c, n]) => `<button type="button" class="rt-dot ink-dot" data-ink="${c}" style="--ink:${c}" aria-label="Colore ${n.toLowerCase()}" title="${n}"></button>`).join('')}</span>
          <span class="pdf-shape-kinds">${[['rect', '▭', 'Rettangolo'], ['ellipse', '◯', 'Ellisse'], ['arrow', '➝', 'Freccia'], ['line', '╱', 'Linea']].map(([k, s, n]) => `<button type="button" class="btn sm ghost" data-shape="${k}" aria-label="${n}" title="${n}">${s}</button>`).join('')}</span>
          <select class="input pdf-pen-size" aria-label="Spessore"><option value="1.2">Fine</option><option value="2">Media</option><option value="3.4">Spessa</option><option value="9">Evidenziatore</option></select>
        </span>
        <span class="pdf-zoom">
          <button type="button" class="btn sm ghost" data-pdf="zoom-" aria-label="Riduci">−</button>
          <button type="button" class="btn sm ghost" data-pdf="zoom-fit" id="pdfZoom" title="Adatta alla larghezza">100%</button>
          <button type="button" class="btn sm ghost" data-pdf="zoom+" aria-label="Ingrandisci">+</button>
          <button type="button" class="btn sm ghost" data-pdf="fit-page" title="Pagina intera">⤢</button>
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
    occQuiz: false, occOpen: new Set(), shape: S().pdfShape || 'rect',
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
      if (a.type === 'st') return `<g class="ann-ul" data-id="${a.id}">${a.rects.map(r => `<rect x="${r[0]}" y="${(r[1] + r[3] * 0.52 - 0.8).toFixed(2)}" width="${r[2]}" height="1.6" fill="${pdfCol(a.color, 2)}"/>`).join('')}</g>`;
      if (a.type === 'shape') return shapeSvg(a);
      if (a.type === 'text') return `<g class="ann-text" data-id="${a.id}">${String(a.text).split('\n').map((l, k) => `<text x="${a.x}" y="${(a.y + (k + 1) * a.fs * 1.25).toFixed(2)}" font-size="${a.fs}" fill="${esc(a.color)}">${esc(l)}</text>`).join('')}</g>`;
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
    const isMark = a.type === 'hl' || a.type === 'ul' || a.type === 'st';
    const isOcc = a.type === 'occ';
    const sh = openSheet(`
      <h2>${({ hl: 'Evidenziazione', ul: 'Sottolineatura', st: 'Barrato', ink: 'Tratto a penna', occ: 'Occlusione', shape: 'Forma', text: 'Testo' })[a.type] || 'Nota'}, pagina ${a.page}</h2>
      ${isOcc ? `<p class="sheet-sub">${a.card ? 'Ha già la sua flashcard.' : 'Puoi trasformare le occlusioni di questa pagina in flashcard da ripassare con le altre.'}</p>` : ''}
      ${a.text ? `<blockquote class="pdf-quote">${esc(a.text.slice(0, 500))}</blockquote>` : ''}
      ${isMark ? `
        <div class="pdf-ann-colors" role="group" aria-label="Colore">
          ${PDF_COLORS.map(([k, , , n]) => `<button type="button" class="rt-dot pdf-hl-dot ${a.color === k ? 'on' : ''}" data-ac="${k}" style="--dot:${pdfCol(k)}" aria-label="${n}" aria-pressed="${a.color === k}"></button>`).join('')}
          <button type="button" class="btn sm ghost" data-aa="type">${a.type === 'hl' ? 'Trasforma in sottolineatura' : 'Trasforma in evidenziazione'}</button>
        </div>` : ''}
      ${a.type === 'text' ? `<label class="field"><span>Testo</span><textarea class="input card-ta" id="anText" rows="3">${esc(a.text || '')}</textarea></label>` : ''}
      ${!['ink', 'shape', 'text'].includes(a.type) ? `<label class="field"><span>${isOcc ? 'Cosa c’è sotto (facoltativo, diventa la risposta della flashcard)' : 'Nota'}</span><textarea class="input card-ta" id="anNote" rows="3" placeholder="Facoltativa">${esc(a.note || '')}</textarea></label>` : ''}
      <div class="modal-actions">
        <button class="btn ghost danger" type="button" data-aa="del">Elimina</button>
        ${a.text ? '<button class="btn ghost" type="button" data-aa="drag">Trascina</button><button class="btn ghost" type="button" data-aa="card">Flashcard</button>' : ''}
        ${isOcc ? '<button class="btn ghost" type="button" data-aa="occcards">Flashcard dalla pagina</button>' : ''}
        <button class="btn primary" type="button" data-aa="ok">Fatto</button>
      </div>`, { label: 'Annotazione', onClose: () => keepNote() });
    const keepNote = () => {
      const tx = $('#anText', sh.el);
      if (tx && meta.annots.includes(a) && tx.value.trim() && tx.value !== a.text) { a.text = tx.value.trim().slice(0, 1000); saveSoon(); drawAnnots(a.page); }
      const t = $('#anNote', sh.el); if (t && meta.annots.includes(a) && t.value.trim() !== (a.note || '')) { a.note = t.value.trim(); saveSoon(); drawAnnots(a.page); refreshPanel('notes'); } };
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
  const hitShapeText = (n, x, y) => meta.annots.filter(a => a.page === n && (a.type === 'shape' || a.type === 'text')).reverse().find(a => {
    if (a.type === 'text') {
      const lines = String(a.text).split('\n');
      const w = Math.max(...lines.map(l => l.length)) * a.fs * 0.55;
      return x >= a.x - 3 && x <= a.x + w + 3 && y >= a.y - 2 && y <= a.y + lines.length * a.fs * 1.25 + 4;
    }
    const [x1, y1, x2, y2] = a.box;
    return x >= Math.min(x1, x2) - 4 && x <= Math.max(x1, x2) + 4 && y >= Math.min(y1, y2) - 4 && y <= Math.max(y1, y2) + 4;
  });
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
    const textTool = ['hl', 'ul', 'st'].includes(t);
    const opts = $('.pdf-pen-opts', app);
    opts.hidden = !(t === 'pen' || t === 'shape' || t === 'text' || textTool);
    $('.pdf-hl-colors', opts).hidden = !textTool;
    $('.pdf-ink-colors', opts).hidden = textTool;
    $('.pdf-shape-kinds', opts).hidden = t !== 'shape';
    $('.pdf-pen-size', opts).hidden = !(t === 'pen' || t === 'shape');
    $$('[data-hlc]', opts).forEach(b => b.classList.toggle('on', b.dataset.hlc === R.color));
    $$('[data-shape]', opts).forEach(b => b.classList.toggle('on', b.dataset.shape === R.shape));
    if (t !== 'select') bar.hidden = true;
    if (!textTool && t !== 'select') document.getSelection()?.removeAllRanges();
  };
  // evidenziatore, sottolineatura e barrato: si applicano appena finisci di selezionare
  let textToolTimer = null;
  const applyTextTool = () => {
    if (!['hl', 'ul', 'st'].includes(R.tool)) return;
    const s = readSelection();
    if (!s) return;
    addAnnots(newAnnotsFromSel(s, R.tool, R.color));
    document.getSelection()?.removeAllRanges();
  };
  pagesEl.addEventListener('mouseup', () => { clearTimeout(textToolTimer); textToolTimer = setTimeout(applyTextTool, 30); });
  document.addEventListener('selectionchange', () => {
    if (!['hl', 'ul', 'st'].includes(R.tool)) return;
    clearTimeout(textToolTimer);
    textToolTimer = setTimeout(applyTextTool, 1100);
  });
  const eraseAt = e => {
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const g = hit && hit.closest && hit.closest('svg.pdf-ann [data-id], svg.pdf-occ [data-id]');
    if (g) removeAnnots([g.dataset.id]);
  };
  pagesEl.addEventListener('pointerdown', e => {
    const el = e.target.closest('.pdf-page');
    if (!el || e.target.closest('.pdf-pin')) return;
    if (e.pointerType === 'pen') R.penSeen = true;
    if (R.tool === 'shape') {
      if (e.pointerType === 'touch' && R.penSeen) { pan = { id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
      if (e.button > 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const svg = el.querySelector('svg.pdf-ann') || (drawAnnots(+el.dataset.p), el.querySelector('svg.pdf-ann'));
      const g = document.createElementNS(SVG_NS, 'g');
      svg.append(g);
      const p0 = pointInPage(el, e);
      ink = { id: e.pointerId, el, shape: g, p0, box: [...p0, ...p0] };
      return;
    }
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
    if (ink.shape) {
      ink.box = [...ink.p0, ...pointInPage(ink.el, e)];
      ink.shape.innerHTML = shapeSvg({ kind: R.shape, box: ink.box, color: R.ink, w: R.inkW, id: '' }, true);
      return;
    }
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
    if (cur.shape) {
      cur.shape.remove();
      const [x1, y1, x2, y2] = cur.box;
      if (Math.hypot(x2 - x1, y2 - y1) > 6) addAnnots([{ id: uid(), type: 'shape', kind: R.shape, page: +cur.el.dataset.p, box: cur.box.map(v => +v.toFixed(2)), color: R.ink, w: Math.min(R.inkW, 4), created: Date.now() }]);
      return;
    }
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
    if (R.tool === 'text') {
      const t = await modal({ title: 'Testo sulla pagina', input: true, multiline: true, placeholder: 'Scrivi il testo', confirm: 'Aggiungi' });
      if (t) addAnnots([{ id: uid(), type: 'text', page: n, x, y: y - 8, text: t.slice(0, 1000), color: R.ink, fs: 11, created: Date.now() }]);
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
      const a = occA || hitAnnot(n, x, y) || hitShapeText(n, x, y);
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
    const guess = await bookmarkTitle(n);
    const title = await modal({ title: `Segnalibro a pagina ${n}`, text: 'Dagli un titolo: lo ritrovi nel pannello e nella ricerca.', input: true, value: guess, confirm: 'Salva' });
    if (!title) return;
    const b = { id: uid(), page: n, title, created: Date.now() };
    meta.bookmarks.push(b);
    meta.bookmarks.sort((x, y) => x.page - y.page);
    saveSoon();
    refreshBm();
    toast(`Segnalibro “${title}” a pagina ${n}`);
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
      ${meta.bookmarks.length > 3 ? `<input type="search" class="input search pdf-bm-q" id="bmQ" placeholder="Cerca tra i segnalibri e l’indice" aria-label="Cerca tra i segnalibri">` : ''}
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
    $('#bmQ', panelBody)?.addEventListener('input', e => {
      const f = foldAccents(e.target.value.trim());
      $$('.pdf-plist li', panelBody).forEach(li => { li.hidden = !!f && !foldAccents(li.textContent).includes(f); });
    });
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
    const hlc = e.target.closest('[data-hlc]');
    if (hlc) { R.color = hlc.dataset.hlc; S().pdfColor = R.color; Settings.save(); $$('[data-hlc]', app).forEach(b => b.classList.toggle('on', b === hlc)); return; }
    const shp = e.target.closest('[data-shape]');
    if (shp) { R.shape = shp.dataset.shape; S().pdfShape = R.shape; Settings.save(); $$('[data-shape]', app).forEach(b => b.classList.toggle('on', b === shp)); return; }
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
    else if (act === 'fit-page') { const pageH = sizeOf(R.cur).height * fitScale(); zoomTo(Math.max(0.3, (scroller.clientHeight - 28) / pageH)); goTo(R.cur); }
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
// v3.24: le linee hanno i margini trascinabili (vedi setupRateLines)
function setupClozeMarks(article, sec) {
  return setupRateLines(article, sec, { kind: 'cloze' });
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
function recordCzMark(sec, key, color, label, text, histKey = 'czHist') {
  if (!sec[histKey] || typeof sec[histKey] !== 'object') sec[histKey] = {};
  const all = sec[histKey];
  const e = all[key] || (all[key] = { label: '', text: '', h: [] });
  e.label = String(label || '').slice(0, 120);
  e.text = String(text || '').slice(0, 800);
  const d = todayStr();
  const last = e.h[e.h.length - 1];
  if (last && last.d === d) last.c = color || '';
  else e.h.push({ d, c: color || '' });
  e.h = e.h.slice(-20);
  // le linee tolte da tempo non servono più: tengo lo storico leggero
  const keys = Object.keys(all);
  if (keys.length > 200) {
    keys.filter(k => k !== key && !(all[k].h || []).slice(-1)[0]?.c)
      .sort((a, b) => String((all[a].h || []).slice(-1)[0]?.d || '').localeCompare(String((all[b].h || []).slice(-1)[0]?.d || '')))
      .slice(0, keys.length - 200).forEach(k => { delete all[k]; });
  }
}
// parti rimaste rosse o arancio in almeno due letture recenti, e ancora segnate così
// v3.24: contano anche i segni della ripetizione a voce e della pagina bianca
function czWeakOf(sec) {
  const out = [];
  [['cloze', 'czHist', 'czMarks', ''], ['recall', 'rcHist', 'rcMarks', 'rc|']].forEach(([kind, hk, mk, pre]) => {
    const hist = sec[hk] && typeof sec[hk] === 'object' ? sec[hk] : {};
    const now = sec[mk] && typeof sec[mk] === 'object' ? sec[mk] : {};
    Object.entries(hist).forEach(([key, e]) => {
      const bad = (e.h || []).slice(-6).filter(x => x.c === 'r' || x.c === 'o').length;
      const cur = now[key] || (e.h || []).slice(-1)[0]?.c || '';
      out.push({ key: pre + key, kind, label: e.label, text: e.text, bad, cur });
    });
  });
  return out.filter(x => x.bad >= 2 && (x.cur === 'r' || x.cur === 'o')).sort((a, b) => b.bad - a.bad);
}
function czWeakItemHtml(sec, w, { showSec = false } = {}) {
  return `
    <li class="czw-item" data-czw="${sec.id}" data-key="${esc(w.key)}">
      <span class="czw-dot ${w.cur}" aria-hidden="true"></span>
      <span class="czw-main">
        <span class="czw-label">${showSec ? `<a href="#/sec/${sec.id}/${w.kind === 'recall' ? 'oral' : 'cloze'}">${esc(sec.title)}</a> › ` : ''}${esc(w.label || 'Paragrafo')}</span>
        <span class="czw-sub">${w.bad} ${w.bad === 1 ? 'volta' : 'volte'} in rosso o arancio ${w.kind === 'recall' ? 'nelle ultime ripetizioni' : 'nelle ultime letture'}</span>
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
  const past = (statsMerged().exams || []).filter(x => x.key === sc.key).slice(-5).reverse();
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
  pushStatsSoon(2000);
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
  if (S().ttsSystemVoice) { const chosen = vs.find(v => v.name === S().ttsSystemVoice); if (chosen) return chosen; }
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
    Voice.stop();
    const el = list[i];
    if (!el) { stop(); toast('Fine della sezione'); return; }
    mark();
    if (Voice.useGemini()) {
      const nextEl = list[i + 1];
      Voice.play(textOf(el), +(S().ttsRate || 1)).then(r => {
        if (my !== token || !playing || r === 'stopped') return;
        i++;
        speakCur();
      }).catch(err => {
        if (my !== token) return;
        toast(`${err.message} Continuo con la voce del telefono.`, 'err');
        S().ttsEngine = 'system';
        Settings.save();
        if (playing) speakCur();
      });
      if (nextEl) Voice.fetch(textOf(nextEl)).catch(() => {});
      return;
    }
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
    if (v) speakCur(); else { token++; Voice.stop(); }
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
    Voice.stop();
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

/* =====================================================================
   v3.22: scheda Mappe (XMind) nelle sezioni
   Le mappe caricate si leggono come mappa o come elenco; “Ripassa” copre
   i nodi e si scoprono toccandoli. Si salva solo la struttura della
   mappa (titoli e note), dentro la sezione, quindi si sincronizza.
   ===================================================================== */
const mapsOf = sec => (Array.isArray(sec.maps) ? sec.maps : []);
const MAP_FONT = '600 14px "Bricolage Grotesque", system-ui, sans-serif';
let mapMeasure = null;
function mapWrap(text, maxW) {
  if (!mapMeasure) mapMeasure = document.createElement('canvas').getContext('2d');
  mapMeasure.font = MAP_FONT;
  const words = String(text).split(' ');
  const lines = [];
  let cur = '';
  words.forEach(w => {
    const t = cur ? `${cur} ${w}` : w;
    if (mapMeasure.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  });
  if (cur) lines.push(cur);
  const width = Math.max(...lines.map(l => mapMeasure.measureText(l).width), 20);
  return { lines: lines.slice(0, 6), width };
}
function chooseXmindFile() {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.xmind,application/vnd.xmind.workbook,application/zip';
    inp.addEventListener('change', () => resolve(inp.files && inp.files[0] ? inp.files[0] : null), { once: true });
    inp.click();
  });
}
// toglie i campi vuoti per tenere leggero il record della sezione
const slimTopic = t => {
  const o = { t: t.title };
  if (t.notes) o.n = t.notes.slice(0, 2000);
  const kids = [...(t.children || []), ...(t.floating || [])].map(slimTopic);
  if (kids.length) o.c = kids;
  return o;
};
// ogni ramo principale ha il suo colore
const branchHue = i => (i === undefined ? 205 : (200 + i * 67) % 360);
function mapCountNodes(n) { return 1 + (n.c || []).reduce((a, c) => a + mapCountNodes(c), 0); }

function modeMap(sec, body) {
  let maps = mapsOf(sec);
  const st = S();
  let mi = Math.min(maps.length - 1, Math.max(0, maps.findIndex(m => m.id === st.mapLast)));
  let si = 0;
  let view = st.mapView || (window.innerWidth < 700 ? 'list' : 'map');
  let quiz = false;
  const shown = new Set();
  const collapsed = new Set();
  let zoom = 1;
  const draw = () => {
    maps = mapsOf(sec);
    if (mi >= maps.length) mi = Math.max(0, maps.length - 1);
    const m = maps[mi];
    if (!m) {
      body.innerHTML = `
        <div class="empty">
          <p>Carica una mappa di XMind (.xmind): la leggi qui come mappa o come elenco, la ripassi coprendo i rami e ne ricavi flashcard. Funziona con i file di XMind nuovi e con XMind 8.</p>
          <button class="btn primary" data-act="map-add">Carica una mappa</button>
        </div>`;
      on('[data-act="map-add"]', 'click', addMap, body);
      return;
    }
    const sheet = m.sheets[si] || m.sheets[0];
    const total = mapCountNodes(sheet.root) - 1;
    body.innerHTML = `
      <div class="map-bar">
        ${maps.length > 1 ? `<select class="input map-sel" data-map-sel aria-label="Mappa">${maps.map((x, k) => `<option value="${k}" ${k === mi ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : `<b class="map-name">${esc(m.name)}</b>`}
        ${m.sheets.length > 1 ? `<select class="input map-sel" data-sheet-sel aria-label="Foglio">${m.sheets.map((x, k) => `<option value="${k}" ${k === si ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>` : ''}
        <div class="seg sm" role="tablist" aria-label="Vista">
          <button type="button" data-view="map" aria-selected="${view === 'map'}">Mappa</button>
          <button type="button" data-view="list" aria-selected="${view === 'list'}">Elenco</button>
        </div>
        <button class="btn sm ${quiz ? 'primary' : ''}" data-act="map-quiz" aria-pressed="${quiz}">${quiz ? `Fine ripasso (${shown.size}/${total})` : 'Ripassa'}</button>
        ${quiz ? '<button class="btn sm ghost" data-act="map-reveal">Scopri tutto</button>' : ''}
        <button class="btn sm ghost" data-act="map-more">Altro</button>
      </div>
      <p class="hint map-hint">${quiz ? 'Prova a ricordare ogni ramo, poi toccalo per scoprirlo; toccalo di nuovo per coprirlo.' : view === 'map' ? 'Tocca un nodo per chiudere o aprire i suoi rami; il pallino indica una nota. Zoom con due dita, Ctrl + rotellina o i pulsanti.' : 'Tocca la freccetta per chiudere o aprire un ramo.'}</p>
      <div id="mapBox" class="map-box ${quiz ? 'quiz' : ''}"></div>`;
    view === 'map' ? drawSvg(sheet) : drawList(sheet);
  };
  const keyOf = path => path.join('.');
  const label = (n, key, isRoot) => (quiz && !isRoot && !shown.has(key) ? '' : n.t);
  function drawList(sheet) {
    const box = $('#mapBox', body);
    const walk = (n, path, depth) => {
      const key = keyOf(path);
      const kids = n.c || [];
      const isClosed = collapsed.has(key);
      const hidden = quiz && depth > 0 && !shown.has(key);
      return `<li class="ml-item d${Math.min(depth, 4)}" style="--h:${branchHue(path[1])}">
        <div class="ml-row">
          ${kids.length ? `<button type="button" class="fold-btn" data-mtoggle="${key}" aria-expanded="${!isClosed}" aria-label="${isClosed ? 'Espandi' : 'Riduci'}">${CHEVRON}</button>` : '<span class="ml-dot" aria-hidden="true"></span>'}
          <span class="ml-t ${hidden ? 'covered' : ''}" data-mkey="${key}" ${hidden ? 'role="button" tabindex="0" aria-label="Ramo coperto: tocca per scoprirlo"' : ''}>${esc(n.t)}</span>
          ${n.n && !hidden ? `<button type="button" class="ml-note" data-mnote="${key}" aria-label="Nota">i</button>` : ''}
        </div>
        ${kids.length && !isClosed ? `<ul>${kids.map((c, k) => walk(c, [...path, k], depth + 1)).join('')}</ul>` : ''}
      </li>`;
    };
    box.innerHTML = `<ul class="map-list">${walk(sheet.root, [0], 0)}</ul>`;
  }
  function drawSvg(sheet) {
    const box = $('#mapBox', body);
    const GAPX = 46;
    const GAPY = 12;
    // misure dei nodi
    const layout = (n, path, depth) => {
      const key = keyOf(path);
      const isRoot = depth === 0;
      const w = mapWrap(n.t, isRoot ? 240 : 200);
      const node = { n, key, depth, path, lines: w.lines, w: Math.ceil(w.width) + 24, h: w.lines.length * 19 + 14, kids: [] };
      if (!collapsed.has(key)) node.kids = (n.c || []).map((c, k) => layout(c, [...path, k], depth + 1));
      node.sub = node.kids.length ? Math.max(node.h, node.kids.reduce((a, k) => a + k.sub, 0) + GAPY * (node.kids.length - 1)) : node.h;
      return node;
    };
    const root = layout(sheet.root, [0], 0);
    const colW = [];
    const measure = (nd) => { colW[nd.depth] = Math.max(colW[nd.depth] || 0, nd.w); nd.kids.forEach(measure); };
    measure(root);
    const colX = [20];
    for (let d = 1; d < colW.length; d++) colX[d] = colX[d - 1] + colW[d - 1] + GAPX;
    const place = (nd, top) => {
      nd.x = colX[nd.depth];
      nd.y = top + nd.sub / 2 - nd.h / 2;
      let y = top + (nd.sub - (nd.kids.reduce((a, k) => a + k.sub, 0) + GAPY * Math.max(0, nd.kids.length - 1))) / 2;
      nd.kids.forEach(k => { place(k, y); y += k.sub + GAPY; });
    };
    place(root, 20);
    const W = colX[colX.length - 1] + colW[colW.length - 1] + 40;
    const H = root.sub + 40;
    const links = [];
    const nodes = [];
    const walk = nd => {
      const hue = branchHue(nd.path[1]);
      nd.kids.forEach(k => {
        const x1 = nd.x + nd.w;
        const y1 = nd.y + nd.h / 2;
        const x2 = k.x;
        const y2 = k.y + k.h / 2;
        const mx = (x1 + x2) / 2;
        links.push(`<path d="M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" style="--h:${branchHue(k.path[1])}"/>`);
        walk(k);
      });
      const isRoot = nd.depth === 0;
      const covered = quiz && !isRoot && !shown.has(nd.key);
      const kidsN = (nd.n.c || []).length;
      nodes.push(`
        <g class="mn ${isRoot ? 'root' : ''} d${Math.min(nd.depth, 3)} ${covered ? 'covered' : ''}" data-mkey="${nd.key}" style="--h:${hue}" transform="translate(${nd.x} ${nd.y})" role="button" tabindex="0" aria-label="${covered ? 'Ramo coperto' : esc(nd.n.t)}">
          <rect width="${nd.w}" height="${nd.h}" rx="${isRoot ? 14 : 10}"/>
          ${nd.lines.map((l, k) => `<text x="12" y="${21 + k * 19}">${esc(l)}</text>`).join('')}
          ${nd.n.n && !covered ? `<circle class="mn-note" data-mnote="${nd.key}" cx="${nd.w - 2}" cy="2" r="6"/>` : ''}
          ${kidsN && collapsed.has(nd.key) ? `<g class="mn-more" transform="translate(${nd.w + 6} ${nd.h / 2 - 9})"><rect width="${String(kidsN).length * 8 + 16}" height="18" rx="9"/><text x="8" y="13">+${kidsN}</text></g>` : ''}
        </g>`);
    };
    walk(root);
    box.innerHTML = `
      <div class="map-zoom"><button class="btn sm ghost" data-mz="-">−</button><button class="btn sm ghost" data-mz="0">${Math.round(zoom * 100)}%</button><button class="btn sm ghost" data-mz="+">+</button></div>
      <div class="map-scroll"><svg class="map-svg" viewBox="0 0 ${W} ${H}" width="${Math.round(W * zoom)}" height="${Math.round(H * zoom)}" role="img" aria-label="Mappa: ${esc(sheet.root.t)}"><g class="links">${links.join('')}</g>${nodes.join('')}</svg></div>`;
    const sc = $('.map-scroll', box);
    // zoom: pulsanti, Ctrl + rotellina e due dita
    const setZoom = (z, cx, cy) => {
      const svg = $('.map-svg', box);
      const old = zoom;
      zoom = Math.max(0.3, Math.min(2.5, z));
      const r = sc.getBoundingClientRect();
      const px = cx ?? r.width / 2;
      const py = cy ?? r.height / 2;
      const ax = (sc.scrollLeft + px) / old;
      const ay = (sc.scrollTop + py) / old;
      svg.setAttribute('width', Math.round(W * zoom));
      svg.setAttribute('height', Math.round(H * zoom));
      sc.scrollLeft = ax * zoom - px;
      sc.scrollTop = ay * zoom - py;
      $('[data-mz="0"]', box).textContent = `${Math.round(zoom * 100)}%`;
    };
    box.querySelector('.map-zoom').addEventListener('click', e => {
      const b = e.target.closest('[data-mz]');
      if (!b) return;
      setZoom(b.dataset.mz === '+' ? zoom * 1.2 : b.dataset.mz === '-' ? zoom / 1.2 : 1);
    });
    sc.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = sc.getBoundingClientRect();
      setZoom(zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    let pinch = null;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    sc.addEventListener('touchstart', e => { if (e.touches.length === 2) { const r = sc.getBoundingClientRect(); pinch = { d: dist(e.touches[0], e.touches[1]), z: zoom, x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top }; } }, { passive: true });
    sc.addEventListener('touchmove', e => { if (pinch && e.touches.length === 2) { e.preventDefault(); setZoom(pinch.z * dist(e.touches[0], e.touches[1]) / pinch.d, pinch.x, pinch.y); } }, { passive: false });
    sc.addEventListener('touchend', () => { pinch = null; });
  }
  const findNode = (sheet, key) => key.split('.').slice(1).reduce((n, k) => (n && n.c ? n.c[+k] : null), sheet.root);
  async function addMap() {
    const file = await chooseXmindFile();
    if (!file) return;
    try {
      toast('Leggo la mappa…');
      const sheets = await parseXmind(file);
      if (!sheets.length) throw new Error('La mappa è vuota.');
      const rec = { id: uid(), name: file.name.replace(/\.xmind$/i, ''), sheets: sheets.map(s => ({ title: s.title, root: slimTopic(s.root) })), created: Date.now() };
      sec.maps = [...mapsOf(sec), rec];
      await saveSection(sec);
      S().mapLast = rec.id;
      Settings.save();
      mi = sec.maps.length - 1;
      si = 0;
      toast(`Mappa caricata: ${rec.sheets.reduce((a, s) => a + mapCountNodes(s.root), 0)} nodi`);
      draw();
    } catch (err) {
      toast(err.message || 'Non riesco a leggere la mappa', 'err');
    }
  }
  body.addEventListener('change', e => {
    if (e.target.matches('[data-map-sel]')) { mi = +e.target.value; si = 0; collapsed.clear(); shown.clear(); S().mapLast = maps[mi].id; Settings.save(); draw(); }
    if (e.target.matches('[data-sheet-sel]')) { si = +e.target.value; collapsed.clear(); shown.clear(); draw(); }
  });
  body.addEventListener('click', async e => {
    const m = maps[mi];
    if (!m) return;
    const sheet = m.sheets[si] || m.sheets[0];
    const v = e.target.closest('[data-view]');
    if (v) { view = v.dataset.view; S().mapView = view; Settings.save(); draw(); return; }
    if (e.target.closest('[data-act="map-quiz"]')) { quiz = !quiz; shown.clear(); draw(); return; }
    if (e.target.closest('[data-act="map-reveal"]')) {
      const all = (n, p) => { shown.add(keyOf(p)); (n.c || []).forEach((c, k) => all(c, [...p, k])); };
      all(sheet.root, [0]);
      draw();
      return;
    }
    const note = e.target.closest('[data-mnote]');
    if (note) {
      const n = findNode(sheet, note.dataset.mnote);
      if (n) { const sh = openSheet(`<h2>${esc(n.t)}</h2><div class="notes">${renderMd(n.n)}</div><div class="modal-actions"><button class="btn primary" type="button" data-x>Chiudi</button></div>`, { label: n.t }); $('[data-x]', sh.el).onclick = () => sh.close(); }
      return;
    }
    const tg = e.target.closest('[data-mtoggle]');
    if (tg) { const k = tg.dataset.mtoggle; if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k); draw(); return; }
    const node = e.target.closest('[data-mkey]');
    if (node) {
      const k = node.dataset.mkey;
      if (quiz) {
        if (k === '0') return;
        if (shown.has(k)) shown.delete(k); else shown.add(k);
        draw();
        return;
      }
      if (view === 'map' && (findNode(sheet, k)?.c || []).length) { if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k); draw(); }
      return;
    }
    if (e.target.closest('[data-act="map-more"]')) {
      const choice = await actionSheet(m.name, [
        { key: 'add', label: 'Carica un’altra mappa' },
        { key: 'cards', label: 'Crea flashcard da questa mappa' },
        { key: 'notes', label: 'Aggiungi la mappa agli appunti (elenco)' },
        { key: 'fold', label: collapsed.size ? 'Apri tutti i rami' : 'Chiudi i rami dal secondo livello' },
        { key: 'rename', label: 'Rinomina' },
        { key: 'delete', label: 'Elimina la mappa', danger: true }
      ]);
      const full = t => ({ title: t.t, notes: t.n || '', children: (t.c || []).map(full), floating: [] });
      if (choice === 'add') addMap();
      if (choice === 'cards') {
        const cards = xmindCards(full(sheet.root), sec.notebookId, sec.id);
        if (!cards.length) { toast('La mappa non ha rami con sottopunti'); return; }
        const ok = await modal({ title: `Creare ${cards.length} flashcard?`, text: 'Una per ogni nodo con sottopunti: sul fronte il percorso del nodo, sul retro i suoi sottopunti.', confirm: 'Crea' });
        if (ok) { await saveCards(cards); toast(`${cards.length} flashcard create`); }
      }
      if (choice === 'notes') {
        sec.md = `${sec.md.trim()}\n\n### Mappa: ${sheet.title}\n\n${xmindToMarkdown(full(sheet.root))}\n`.trimStart();
        await saveSection(sec);
        toast('Mappa aggiunta agli appunti: la trovi in Leggi');
      }
      if (choice === 'fold') {
        if (collapsed.size) collapsed.clear();
        else (sheet.root.c || []).forEach((c, k) => { if ((c.c || []).length) collapsed.add(`0.${k}`); });
        draw();
      }
      if (choice === 'rename') {
        const name = await modal({ title: 'Rinomina la mappa', input: true, value: m.name, confirm: 'Rinomina' });
        if (name) { m.name = name; await saveSection(sec); draw(); }
      }
      if (choice === 'delete') {
        const ok = await modal({ title: 'Eliminare la mappa?', text: 'Le flashcard e gli appunti già creati dalla mappa restano.', confirm: 'Elimina', danger: true });
        if (ok) { sec.maps = mapsOf(sec).filter(x => x.id !== m.id); mi = 0; await saveSection(sec); draw(); }
      }
    }
  });
  body.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-mkey]')) { e.preventDefault(); e.target.closest('[data-mkey]').dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
  draw();
}

/* =====================================================================
   v3.23: tempo di studio sommato tra i dispositivi, voce di Google
   (Gemini), filtro luce blu, tastiera del telefono
   ===================================================================== */

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

/* ---------- Tastiera del telefono: il menu in basso si nasconde ---------- */
function watchKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  let base = window.innerHeight;
  const check = () => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    const open = typing && vv.height < base - 120;
    document.documentElement.classList.toggle('kb-open', open);
    if (!typing) base = Math.max(base, window.innerHeight);
  };
  vv.addEventListener('resize', check);
  window.addEventListener('focusin', () => setTimeout(check, 350));
  window.addEventListener('focusout', () => setTimeout(check, 200));
  window.addEventListener('orientationchange', () => { setTimeout(() => { base = window.innerHeight; check(); }, 500); });
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
  ShDock.init();
  Nav.init();
  initHelp();
  Tracker.start();
  applyBlueLight();
  watchKeyboard();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && statsPushTimer) pushStatsNow(); });
  const sharedFile = await takeSharedFile();
  const shared = sharedFile || takeSharedText();
  route();
  if (shared === 'pdf') toast('PDF ricevuto: scegli il notebook e le pagine');
  else if (shared) toast('Testo ricevuto: scegli il notebook e crea le sezioni');
  if (Sync.configured()) Sync.run({ silent: true });
}

/* =====================================================================
   v3.24: segni a semaforo con i margini delle linee trascinabili
   (Cloze, Orale e Pagina bianca) e StudyHub aperto accanto al Notebook
   ===================================================================== */
const RL_STORES = {
  cloze: { marks: 'czMarks', spans: 'czSpans', hist: 'czHist' },
  recall: { marks: 'rcMarks', spans: 'rcSpans', hist: 'rcHist' }
};
const RL_WEIGHT = { g: 1, y: 0.65, o: 0.35, r: 0 };
const RL_UNIT_SEL = 'h1,h2,h3,h4,h5,h6,p,li,tr,pre,hr,.html-embed';
const rlObj = (sec, k) => (sec[k] && typeof sec[k] === 'object' && !Array.isArray(sec[k]) ? sec[k] : (sec[k] = {}));
function rlOwnText(el) {
  if (el.tagName !== 'LI') return el.textContent.replace(/\s+/g, ' ').trim();
  let t = '';
  el.childNodes.forEach(n => { if (!(n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName))) t += n.textContent; });
  return t.replace(/\s+/g, ' ').trim();
}
// I pezzi su cui si appoggiano le linee: titoli, paragrafi, voci di elenco, righe di tabella…
function rlUnits(article) {
  const skip = el => {
    if (el.closest('.rl-layer')) return true;
    const cell = el.tagName === 'P' && el.parentElement && el.parentElement.closest('li, td, th');
    if (cell && article.contains(cell)) return true;
    const emb = el.parentElement && el.parentElement.closest('.html-embed');
    return !!(emb && article.contains(emb));
  };
  const list = [...article.querySelectorAll(RL_UNIT_SEL)].filter(el => !skip(el));
  const set = new Set(list);
  // blocchi senza pezzi riconosciuti dentro (immagini con occlusioni, riquadri…)
  for (const box of [article, ...article.querySelectorAll('.fold-body')]) {
    for (const ch of box.children) {
      if (set.has(ch) || ch.classList.contains('fold') || ch.classList.contains('rl-layer')) continue;
      if (!ch.querySelector(RL_UNIT_SEL)) { list.push(ch); set.add(ch); }
    }
  }
  list.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const seen = {};
  return list.map(el => {
    const own = rlOwnText(el);
    const base = `${el.tagName.toLowerCase()}|${own.slice(0, 48) || el.querySelector('img')?.dataset.img || ''}`;
    seen[base] = (seen[base] || 0) + 1;
    return { el, sig: `${base}#${seen[base]}`, text: own, len: Math.max(own.length, 20) };
  });
}

function setupRateLines(article, sec, { kind = 'cloze', onChange = () => {} } = {}) {
  if (!article) return null;
  const st = RL_STORES[kind] || RL_STORES.cloze;
  const marks = () => rlObj(sec, st.marks);
  const spans = () => rlObj(sec, st.spans);

  // pallino accanto a ogni titolo (o a ogni blocco, se gli appunti non hanno titoli)
  const folds = $$('.fold', article);
  const targets = folds.length
    ? folds.map(f => ({ el: f, host: f.querySelector(':scope > .fold-h'), key: f.dataset.fold, label: f.querySelector(':scope > .fold-h')?.textContent.trim() }))
    : [...article.children].filter(el => el.textContent.trim() && !el.classList.contains('rl-layer')).map((el, i) => ({ el, host: el, key: `b${i}:${el.textContent.trim().slice(0, 24)}`, label: el.textContent.trim().slice(0, 60) }));
  const tByKey = new Map(targets.map(t => [t.key, t]));
  targets.forEach(t => {
    if (!t.host) return;
    t.host.classList.add('czm-host');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'czm-btn';
    t.btn = b;
    t.host.append(b);
    b.addEventListener('click', e => {
      e.stopPropagation();
      const i = CZ_MARKS.indexOf(marks()[t.key] || '');
      setColor(t.key, i === CZ_MARKS.length - 1 ? '' : CZ_MARKS[i + 1]);
    });
  });

  const units = rlUnits(article);
  const bySig = new Map(units.map((u, i) => [u.sig, i]));
  const defCache = new Map();
  const defSpan = t => {
    if (defCache.has(t.key)) return defCache.get(t.key);
    let a = Infinity, b = -1;
    units.forEach((u, i) => { if (t.el === u.el || t.el.contains(u.el)) { if (i < a) a = i; if (i > b) b = i; } });
    const r = a <= b ? [a, b] : null;
    defCache.set(t.key, r);
    return r;
  };
  let drag = null;
  const lineList = () => Object.entries(marks()).filter(([, c]) => RL_WEIGHT[c] !== undefined).map(([key, c]) => {
    const t = tByKey.get(key);
    const sp = spans()[key];
    let a, b;
    if (drag && drag.key === key) ({ a, b } = drag);
    else if (sp && bySig.has(sp.a) && bySig.has(sp.b)) { a = bySig.get(sp.a); b = bySig.get(sp.b); }
    else if (t && defSpan(t)) [a, b] = defSpan(t);
    else return null;
    if (a > b) [a, b] = [b, a];
    return { key, c, a, b, t };
  }).filter(Boolean);

  article.classList.add('rl-host');
  const layer = document.createElement('div');
  layer.className = 'rl-layer';
  layer.innerHTML = '<div class="rl-gutter" title="Tocca per segnare com’è andato questo punto"></div>';
  article.append(layer);
  const lineEls = new Map();

  const geo = () => {
    const base = article.getBoundingClientRect().top;
    return units.map(u => {
      if (!u.el.getClientRects().length) return null;
      const r = u.el.getBoundingClientRect();
      let bottom = r.bottom;
      if (u.el.tagName === 'LI') {
        const sub = u.el.querySelector(':scope > ul, :scope > ol');
        const sr = sub && sub.getBoundingClientRect();
        if (sr && sr.height) bottom = sr.top;
      }
      return { top: r.top - base, bottom: Math.max(bottom - base, r.top - base + 8) };
    });
  };
  const nameOf = ln => (ln.t ? ln.t.label : units[ln.a]?.text.slice(0, 60)) || 'questo punto';

  const draw = () => {
    if (!article.isConnected) return;
    const g = geo();
    const segs = [];
    for (const ln of lineList()) {
      let top = Infinity, bot = -Infinity;
      for (let i = ln.a; i <= ln.b; i++) { const q = g[i]; if (!q) continue; if (q.top < top) top = q.top; if (q.bottom > bot) bot = q.bottom; }
      if (top !== Infinity) segs.push({ ...ln, top, bot });
    }
    // corsie: le linee corte vicino al testo, quelle che le contengono più fuori
    segs.sort((x, y) => (x.bot - x.top) - (y.bot - y.top));
    const lanes = [[], []];
    segs.forEach(s => {
      let l = lanes.findIndex(L => L.every(o => o.bot <= s.top + 2 || o.top >= s.bot - 2));
      if (l < 0) l = 1;
      lanes[l].push(s);
      s.lane = l;
    });
    const keep = new Set();
    segs.forEach(s => {
      keep.add(s.key);
      let el = lineEls.get(s.key);
      if (!el) {
        el = document.createElement('div');
        el.className = 'rl-line';
        el.dataset.key = s.key;
        el.innerHTML = '<button type="button" class="rl-knob rl-top"></button><button type="button" class="rl-knob rl-bot"></button>';
        layer.append(el);
        lineEls.set(s.key, el);
      }
      el.dataset.c = s.c;
      el.style.top = `${s.top}px`;
      el.style.height = `${Math.max(8, s.bot - s.top)}px`;
      el.style.setProperty('--lane', s.lane);
      const nm = nameOf(s);
      el.firstElementChild.setAttribute('aria-label', `Inizio della linea ${CZ_MARK_NAMES[s.c]} su ${nm}: trascina o usa le frecce per spostarlo, tocca per cambiare colore`);
      el.lastElementChild.setAttribute('aria-label', `Fine della linea ${CZ_MARK_NAMES[s.c]} su ${nm}: trascina o usa le frecce per spostarla`);
    });
    for (const [k, el] of lineEls) if (!keep.has(k) && !(drag && drag.key === k)) { el.remove(); lineEls.delete(k); }
    targets.forEach(paintDot);
  };
  const paintDot = t => {
    if (!t.btn) return;
    const v = marks()[t.key] || '';
    t.btn.dataset.v = v;
    t.btn.setAttribute('aria-label', v ? `Segnata: ${CZ_MARK_NAMES[v]}. Tocca per cambiare` : 'Segna com’è andata');
    t.btn.title = v ? CZ_MARK_NAMES[v] : 'Segna com’è andata: verde, giallo, arancio, rosso';
  };
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

  let saveT = 0;
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => saveSection(sec), 800); };
  const changed = () => { draw(); saveSoon(); try { onChange(); } catch { /* il riepilogo non deve bloccare i segni */ } };
  const textOf = (a, b) => units.slice(a, b + 1).map(u => u.text).filter(Boolean).join(' ').slice(0, 800);
  const setColor = (key, c) => {
    const m = marks();
    const before = lineList().find(l => l.key === key);
    if (c) m[key] = c; else { delete m[key]; delete spans()[key]; }
    const ln = lineList().find(l => l.key === key) || before;
    const t = tByKey.get(key);
    if (ln || t) recordCzMark(sec, key, c, t ? t.label : (ln ? units[ln.a]?.text.slice(0, 80) : ''), ln ? textOf(ln.a, ln.b) : (t ? t.el.textContent.replace(/\s+/g, ' ').trim() : ''), st.hist);
    changed();
  };
  const setSpan = (key, a, b) => {
    const t = tByKey.get(key);
    const d = t && defSpan(t);
    if (d && d[0] === a && d[1] === b) delete spans()[key];
    else spans()[key] = { a: units[a].sig, b: units[b].sig };
    const e = rlObj(sec, st.hist)[key];
    if (e) e.text = textOf(a, b);
    changed();
  };

  /* menu dei colori, sotto il punto toccato */
  let pop = null;
  const closePop = () => {
    if (!pop) return;
    pop.remove();
    pop = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', popKey, true);
  };
  const outside = e => { if (pop && !pop.contains(e.target)) closePop(); };
  const popKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } };
  // una riga per ricolorare la linea toccata, una per segnare solo il punto toccato
  const openPop = ({ key = null, unit = -1, y }) => {
    closePop();
    const ln = key ? lineList().find(l => l.key === key) : null;
    if (key && !ln) return;
    const point = unit >= 0 && (!ln || ln.a !== unit || ln.b !== unit);
    if (!ln && !point) return;
    const sw = (row, cur) => CZ_MARKS.map(c => `<button type="button" class="rl-sw" data-row="${row}" data-c="${c}" aria-label="${CZ_MARK_NAMES[c]}" title="${CZ_MARK_NAMES[c]}"${cur !== undefined ? ` aria-pressed="${cur === c}"` : ''}></button>`).join('');
    pop = document.createElement('div');
    pop.className = 'rl-pop';
    pop.setAttribute('role', 'group');
    pop.setAttribute('aria-label', 'Com’è andata?');
    pop.innerHTML = `
      ${ln ? `<div class="rl-row">${point ? '<span class="rl-lbl">Tutta la linea</span>' : ''}${sw('line', ln.c)}
        <button type="button" class="rl-pop-t" data-x="del">Togli</button>
        ${ln.t && spans()[key] ? '<button type="button" class="rl-pop-t" data-x="reset">Tutto il paragrafo</button>' : ''}</div>` : ''}
      ${point ? `<div class="rl-row">${ln ? '<span class="rl-lbl">Solo questo punto</span>' : ''}${sw('point')}</div>` : ''}`;
    pop.style.top = `${Math.max(0, y)}px`;
    layer.append(pop);
    pop.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.c && b.dataset.row === 'line') setColor(key, b.dataset.c);
      else if (b.dataset.c && b.dataset.row === 'point') {
        const k = `u:${uid()}`;
        spans()[k] = { a: units[unit].sig, b: units[unit].sig };
        setColor(k, b.dataset.c);
      } else if (b.dataset.x === 'del') setColor(key, '');
      else if (b.dataset.x === 'reset') { delete spans()[key]; changed(); }
      closePop();
    });
    setTimeout(() => { if (!pop) return; document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', popKey, true); });
    $('.rl-sw', pop).focus({ preventScroll: true });
  };

  /* trascinare le estremità: la linea si aggancia al paragrafo o alla voce più vicini */
  let justDragged = false;
  const nearest = (g, y, end, a, b) => {
    let best = -1, dist = Infinity;
    for (let i = 0; i < g.length; i++) {
      const q = g[i];
      if (!q || (end === 'a' ? i > b : i < a)) continue;
      const d = Math.abs((end === 'a' ? q.top : q.bottom) - y);
      if (d < dist) { dist = d; best = i; }
    }
    return best;
  };
  layer.addEventListener('pointerdown', e => {
    const k = e.target.closest('.rl-knob');
    if (!k || e.button > 0) return;
    const key = k.parentElement.dataset.key;
    const ln = lineList().find(l => l.key === key);
    if (!ln) return;
    e.preventDefault();
    closePop();
    try { k.setPointerCapture(e.pointerId); } catch { /* va bene lo stesso */ }
    drag = { id: e.pointerId, key, end: k.classList.contains('rl-top') ? 'a' : 'b', a: ln.a, b: ln.b, a0: ln.a, b0: ln.b, y0: e.clientY, moved: false, g: geo(), el: k.parentElement };
  });
  layer.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.abs(e.clientY - drag.y0) < 6) return;
    if (!drag.moved) { drag.moved = true; drag.el.classList.add('dragging'); }
    if (e.clientY < 70) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - 90) window.scrollBy(0, 12);
    const y = e.clientY - article.getBoundingClientRect().top;
    const i = nearest(drag.g, y, drag.end, drag.a, drag.b);
    if (i >= 0 && i !== drag[drag.end]) { drag[drag.end] = i; draw(); }
  });
  const endDrag = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    d.el.classList.remove('dragging');
    if (!d.moved) { draw(); return; }
    justDragged = true;
    setTimeout(() => { justDragged = false; }, 0);
    if (d.a !== d.a0 || d.b !== d.b0) setSpan(d.key, d.a, d.b); else draw();
  };
  layer.addEventListener('pointerup', endDrag);
  layer.addEventListener('pointercancel', endDrag);
  // il pezzo all’altezza toccata (il più piccolo, se più d’uno)
  const unitAt = (g, y, lo = 0, hi = units.length - 1) => {
    let best = -1, dist = Infinity;
    for (let i = lo; i <= hi; i++) {
      const q = g[i];
      if (!q) continue;
      const d = y < q.top ? q.top - y : y > q.bottom ? y - q.bottom : 0;
      if (d < dist || (d === 0 && dist === 0 && q.bottom - q.top < g[best].bottom - g[best].top)) { dist = d; best = i; }
    }
    return best;
  };
  layer.addEventListener('click', e => {
    if (justDragged) return;
    const line = e.target.closest('.rl-line');
    const onGutter = e.target.closest('.rl-gutter');
    if (!line && !onGutter) return;
    e.stopPropagation();
    const g = geo();
    const y = e.clientY - article.getBoundingClientRect().top;
    if (line) {
      const k = e.target.closest('.rl-knob');
      const ln = lineList().find(l => l.key === line.dataset.key);
      if (!ln) return;
      if (k || !e.clientY) {
        const below = k && k.classList.contains('rl-bot');
        openPop({ key: ln.key, y: below ? line.offsetTop + line.offsetHeight + 10 : line.offsetTop + 12 });
        return;
      }
      const u = unitAt(g, y, ln.a, ln.b);
      openPop({ key: ln.key, unit: u, y: (u >= 0 ? g[u].bottom : y) + 6 });
      return;
    }
    const u = unitAt(g, y);
    if (u >= 0) openPop({ unit: u, y: g[u].bottom + 6 });
  });
  // con la tastiera: frecce su e giù spostano l’estremità di un paragrafo
  layer.addEventListener('keydown', e => {
    const k = e.target.closest('.rl-knob');
    if (!k || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const key = k.parentElement.dataset.key;
    const ln = lineList().find(l => l.key === key);
    if (!ln) return;
    e.preventDefault();
    const g = geo();
    const end = k.classList.contains('rl-top') ? 'a' : 'b';
    const step = e.key === 'ArrowUp' ? -1 : 1;
    let i = ln[end] + step;
    while (i >= 0 && i < units.length && !g[i]) i += step;
    if (i < 0 || i >= units.length || (end === 'a' && i > ln.b) || (end === 'b' && i < ln.a)) return;
    setSpan(key, end === 'a' ? i : ln.a, end === 'b' ? i : ln.b);
    lineEls.get(key)?.querySelector(end === 'a' ? '.rl-top' : '.rl-bot')?.focus({ preventScroll: true });
  });

  // le linee seguono il testo quando cambia (paragrafi chiusi, immagini, larghezza)
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
  if (ro) ro.observe(article);
  window.addEventListener('resize', schedule);
  article.addEventListener('click', schedule);
  draw();
  if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(schedule).catch(() => {});

  const summary = () => {
    const lines = lineList();
    const per = new Array(units.length).fill(null);
    for (const ln of lines) {
      const size = ln.b - ln.a;
      for (let i = ln.a; i <= ln.b; i++) if (!per[i] || per[i][1] > size) per[i] = [ln.c, size];
    }
    let tot = 0, cov = 0, sc = 0;
    units.forEach((u, i) => { tot += u.len; if (per[i]) { cov += u.len; sc += u.len * RL_WEIGHT[per[i][0]]; } });
    const counts = { g: 0, y: 0, o: 0, r: 0 };
    lines.forEach(l => { counts[l.c]++; });
    const pct = cov ? Math.round((sc / cov) * 100) : null;
    return {
      lines: lines.length, counts, pct, cover: tot ? cov / tot : 0,
      suggest: pct === null ? null : pct < 35 ? 'again' : pct < 60 ? 'hard' : pct < 95 ? 'good' : 'easy'
    };
  };
  const destroy = () => {
    closePop();
    if (ro) ro.disconnect();
    window.removeEventListener('resize', schedule);
    cancelAnimationFrame(raf);
    layer.remove();
  };
  addCleanup(destroy);
  return { summary, destroy, redraw: schedule };
}

function rlSummaryHtml(s) {
  if (!s || !s.lines) return '<p class="hint rl-help">Segna com’è andata: tocca il pallino accanto a un titolo, oppure il margine sinistro accanto a un punto preciso. Trascina i pallini alle estremità di una linea per allungarla o accorciarla.</p>';
  const chips = CZ_MARKS.filter(c => s.counts[c]).map(c => `<span class="rl-chip" title="${CZ_MARK_NAMES[c]}"><i class="rl-dot" data-c="${c}" aria-hidden="true"></i>${s.counts[c]}<span class="sr-only"> ${CZ_MARK_NAMES[c]}</span></span>`).join('');
  const g = GRADES.find(x => x.key === s.suggest);
  const tail = s.cover < 0.5
    ? `Hai segnato il ${Math.round(s.cover * 100)}% degli appunti: segna anche il resto per avere un voto suggerito.`
    : `Dai segni: ${s.pct}%, voto suggerito “${g ? g.label : ''}”.`;
  return `<div class="rl-sum">${chips}<span class="rl-sum-t">${tail}</span></div>`;
}



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
    if (p[0] === 'nb') { const n = nbById(p[1]); return n ? `Torna a ${n.name}` : 'Indietro'; }
    const names = { lab: 'Medicina di laboratorio', cases: 'Casi clinici', incomplete: 'Da completare', review: 'Ripasso', search: 'Cerca', calendar: 'Calendario', clinic: 'Note cliniche', glossary: 'Glossario', cards: 'Flashcard', pdfs: 'PDF', pdf: 'PDF', notebooks: 'Notebook', tag: p[1] ? `#${p[1]}` : 'Tag', exam: 'Simulazione' };
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
  topGroups(nb).forEach(g => {
    add(secs.filter(s => s.groupId === g.id));
    subGroups(nb, g).forEach(sg => add(secs.filter(s => s.groupId === sg.id)));
  });
  add(secs);
  return out;
}

/* =====================================================================
   v3.30: Medicina di laboratorio
   Schede degli esami (range, valori critici, cause, uso diagnostico con
   sensibilità, specificità e rapporti di verosimiglianza), lettura di un
   referto, calcoli di tutti i giorni e un piccolo allenamento.
   Ogni esame è un record { kind: 'lab' } nei link: si sincronizza e va nel backup.
   ===================================================================== */
const LAB_CATS = [
  ['ema', 'Ematologia'], ['coag', 'Coagulazione'], ['elet', 'Elettroliti e acido-base'], ['rene', 'Rene e urine'],
  ['fega', 'Fegato e vie biliari'], ['panc', 'Pancreas'], ['cuor', 'Cuore e muscolo'], ['meta', 'Metabolismo'],
  ['ferr', 'Ferro e vitamine'], ['endo', 'Endocrinologia'], ['infi', 'Infiammazione e immunologia'], ['tumo', 'Marcatori tumorali'],
  ['micr', 'Microbiologia e sierologia'], ['liqu', 'Liquidi biologici'], ['farm', 'Farmaci e tossicologia'], ['altr', 'Altro']
];
const labCatName = k => (LAB_CATS.find(c => c[0] === k) || LAB_CATS[LAB_CATS.length - 1])[1];
const labExams = () => state.links.filter(l => l.kind === 'lab').sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }));
const labById = id => state.links.find(l => l.kind === 'lab' && l.id === id);
const labNum = v => { const n = parseFloat(String(v ?? '').trim().replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const labFmt = (n, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? '–' : n.toLocaleString('it-IT', { maximumFractionDigits: d }));
const labLines = t => String(t || '').split('\n').map(x => x.replace(/^\s*[-•·*]\s*/, '').trim()).filter(Boolean);
function labRangeText(r, unit = '') {
  const lo = String(r.low ?? '').trim(), hi = String(r.high ?? '').trim();
  const core = lo && hi ? `${lo} – ${hi}` : hi ? `< ${hi}` : lo ? `> ${lo}` : '';
  return core ? `${core}${unit ? ` ${unit}` : ''}` : '';
}
const labHasRange = x => (x.ranges || []).some(r => String(r.low ?? '').trim() || String(r.high ?? '').trim());
// il range da usare per una persona: quello del suo sesso se c’è, altrimenti il primo
function labPickRange(x, sex) {
  const rows = (x.ranges || []).filter(r => labNum(r.low) !== null || labNum(r.high) !== null);
  if (!rows.length) return null;
  const re = sex === 'F' ? /donn|femmin|\bf\b/i : sex === 'M' ? /uomin|maschi|\bm\b/i : null;
  return (re && rows.find(r => re.test(r.who || ''))) || rows.find(r => !/donn|femmin|uomin|maschi|bambin|neonat|gravid/i.test(r.who || '')) || rows[0];
}

// Elenco di base: nomi, sigle, campione e unità più usate in Italia. Niente range:
// quelli li prendi dal tuo libro o dal tuo laboratorio.
const LAB_BASE = [
  ['ema', 'Emoglobina', 'Hb', 'Sangue intero (EDTA)', 'g/dL'], ['ema', 'Ematocrito', 'Ht', 'Sangue intero (EDTA)', '%'],
  ['ema', 'Globuli rossi', 'GR', 'Sangue intero (EDTA)', '×10⁶/µL'], ['ema', 'Volume corpuscolare medio', 'MCV', 'Sangue intero (EDTA)', 'fL'],
  ['ema', 'Contenuto emoglobinico medio', 'MCH', 'Sangue intero (EDTA)', 'pg'], ['ema', 'Concentrazione emoglobinica media', 'MCHC', 'Sangue intero (EDTA)', 'g/dL'],
  ['ema', 'Ampiezza di distribuzione dei globuli rossi', 'RDW', 'Sangue intero (EDTA)', '%'], ['ema', 'Globuli bianchi', 'GB', 'Sangue intero (EDTA)', '×10³/µL'],
  ['ema', 'Neutrofili', 'NEU', 'Sangue intero (EDTA)', '×10³/µL'], ['ema', 'Linfociti', 'LYM', 'Sangue intero (EDTA)', '×10³/µL'],
  ['ema', 'Monociti', 'MONO', 'Sangue intero (EDTA)', '×10³/µL'], ['ema', 'Eosinofili', 'EOS', 'Sangue intero (EDTA)', '×10³/µL'],
  ['ema', 'Basofili', 'BASO', 'Sangue intero (EDTA)', '×10³/µL'], ['ema', 'Piastrine', 'PLT', 'Sangue intero (EDTA)', '×10³/µL'],
  ['ema', 'Reticolociti', 'RET', 'Sangue intero (EDTA)', '%'], ['ema', 'Velocità di eritrosedimentazione', 'VES', 'Sangue intero (citrato)', 'mm/h'],
  ['coag', 'Tempo di protrombina', 'PT', 'Plasma (citrato)', 's'], ['coag', 'International Normalized Ratio', 'INR', 'Plasma (citrato)', ''],
  ['coag', 'Tempo di tromboplastina parziale attivata', 'aPTT', 'Plasma (citrato)', 's'], ['coag', 'Fibrinogeno', '', 'Plasma (citrato)', 'mg/dL'],
  ['coag', 'D-dimero', '', 'Plasma (citrato)', ''], ['coag', 'Antitrombina', 'AT', 'Plasma (citrato)', '%'],
  ['elet', 'Sodio', 'Na⁺', 'Siero', 'mEq/L'], ['elet', 'Potassio', 'K⁺', 'Siero', 'mEq/L'], ['elet', 'Cloro', 'Cl⁻', 'Siero', 'mEq/L'],
  ['elet', 'Calcio totale', 'Ca', 'Siero', 'mg/dL'], ['elet', 'Calcio ionizzato', 'Ca²⁺', 'Sangue intero (eparina)', 'mmol/L'],
  ['elet', 'Magnesio', 'Mg', 'Siero', 'mg/dL'], ['elet', 'Fosforo', 'P', 'Siero', 'mg/dL'], ['elet', 'Bicarbonati', 'HCO₃⁻', 'Siero o sangue arterioso', 'mEq/L'],
  ['elet', 'Osmolalità plasmatica', '', 'Siero', 'mOsm/kg'], ['elet', 'pH arterioso', 'pH', 'Sangue arterioso (eparina)', ''],
  ['elet', 'Pressione parziale di CO₂', 'pCO₂', 'Sangue arterioso (eparina)', 'mmHg'], ['elet', 'Pressione parziale di O₂', 'pO₂', 'Sangue arterioso (eparina)', 'mmHg'],
  ['elet', 'Eccesso di basi', 'BE', 'Sangue arterioso (eparina)', 'mEq/L'], ['elet', 'Lattati', '', 'Sangue arterioso o venoso', 'mmol/L'],
  ['rene', 'Creatinina', 'Crea', 'Siero', 'mg/dL'], ['rene', 'Filtrato glomerulare stimato', 'eGFR', 'Calcolato', 'mL/min/1,73 m²'],
  ['rene', 'Azotemia (urea)', 'Urea', 'Siero', 'mg/dL'], ['rene', 'Acido urico', 'UA', 'Siero', 'mg/dL'], ['rene', 'Esame delle urine', '', 'Urine (mitto intermedio)', ''],
  ['rene', 'Proteinuria delle 24 ore', '', 'Urine delle 24 ore', 'mg/24 h'], ['rene', 'Rapporto albumina/creatinina urinario', 'ACR', 'Urine (spot)', 'mg/g'],
  ['fega', 'Aspartato aminotransferasi', 'AST', 'Siero', 'U/L'], ['fega', 'Alanina aminotransferasi', 'ALT', 'Siero', 'U/L'],
  ['fega', 'Gamma-glutamiltransferasi', 'GGT', 'Siero', 'U/L'], ['fega', 'Fosfatasi alcalina', 'ALP', 'Siero', 'U/L'],
  ['fega', 'Bilirubina totale', '', 'Siero', 'mg/dL'], ['fega', 'Bilirubina diretta', '', 'Siero', 'mg/dL'], ['fega', 'Albumina', 'Alb', 'Siero', 'g/dL'],
  ['fega', 'Proteine totali', '', 'Siero', 'g/dL'], ['fega', 'Lattato deidrogenasi', 'LDH', 'Siero', 'U/L'], ['fega', 'Ammoniemia', 'NH₃', 'Plasma (EDTA, in ghiaccio)', ''],
  ['panc', 'Amilasi', '', 'Siero', 'U/L'], ['panc', 'Lipasi', '', 'Siero', 'U/L'],
  ['cuor', 'Troponina ad alta sensibilità', 'hs-cTn', 'Siero o plasma', 'ng/L'], ['cuor', 'Creatinchinasi', 'CK', 'Siero', 'U/L'],
  ['cuor', 'Creatinchinasi MB', 'CK-MB', 'Siero', 'ng/mL'], ['cuor', 'Peptide natriuretico di tipo B', 'BNP', 'Plasma (EDTA)', 'pg/mL'],
  ['cuor', 'NT-proBNP', 'NT-proBNP', 'Siero o plasma', 'pg/mL'], ['cuor', 'Mioglobina', '', 'Siero', 'ng/mL'],
  ['meta', 'Glicemia', 'Glu', 'Plasma (fluoruro) o siero', 'mg/dL'], ['meta', 'Emoglobina glicata', 'HbA1c', 'Sangue intero (EDTA)', 'mmol/mol'],
  ['meta', 'Colesterolo totale', 'CT', 'Siero', 'mg/dL'], ['meta', 'Colesterolo HDL', 'HDL', 'Siero', 'mg/dL'], ['meta', 'Colesterolo LDL', 'LDL', 'Siero', 'mg/dL'],
  ['meta', 'Trigliceridi', 'TG', 'Siero', 'mg/dL'], ['meta', 'Lipoproteina(a)', 'Lp(a)', 'Siero', ''], ['meta', 'Insulina', '', 'Siero', 'µU/mL'], ['meta', 'Peptide C', '', 'Siero', 'ng/mL'],
  ['ferr', 'Sideremia', 'Fe', 'Siero', 'µg/dL'], ['ferr', 'Ferritina', '', 'Siero', 'ng/mL'], ['ferr', 'Transferrina', '', 'Siero', 'mg/dL'],
  ['ferr', 'Saturazione della transferrina', 'TSAT', 'Calcolato', '%'], ['ferr', 'Vitamina B12', 'B12', 'Siero', 'pg/mL'], ['ferr', 'Folati', '', 'Siero', 'ng/mL'],
  ['ferr', '25-idrossivitamina D', '25(OH)D', 'Siero', 'ng/mL'],
  ['endo', 'Tireotropina', 'TSH', 'Siero', 'mUI/L'], ['endo', 'Tiroxina libera', 'FT4', 'Siero', ''], ['endo', 'Triiodotironina libera', 'FT3', 'Siero', ''],
  ['endo', 'Anticorpi anti-tireoperossidasi', 'Anti-TPO', 'Siero', 'UI/mL'], ['endo', 'Cortisolo', '', 'Siero', 'µg/dL'], ['endo', 'ACTH', 'ACTH', 'Plasma (EDTA, in ghiaccio)', 'pg/mL'],
  ['endo', 'Prolattina', 'PRL', 'Siero', 'ng/mL'], ['endo', 'Paratormone', 'PTH', 'Plasma o siero', 'pg/mL'], ['endo', 'Beta-hCG', 'β-hCG', 'Siero o urine', 'mUI/mL'],
  ['infi', 'Proteina C reattiva', 'PCR', 'Siero', ''], ['infi', 'Procalcitonina', 'PCT', 'Siero', 'ng/mL'], ['infi', 'Elettroforesi delle proteine sieriche', '', 'Siero', '%'],
  ['infi', 'Immunoglobuline G, A, M', 'IgG IgA IgM', 'Siero', 'mg/dL'], ['infi', 'Complemento C3 e C4', 'C3 C4', 'Siero', 'mg/dL'],
  ['infi', 'Anticorpi antinucleo', 'ANA', 'Siero', 'titolo'], ['infi', 'Anticorpi anti-citoplasma dei neutrofili', 'ANCA', 'Siero', ''],
  ['infi', 'Fattore reumatoide', 'FR', 'Siero', 'UI/mL'], ['infi', 'Anticorpi anti-peptidi citrullinati', 'Anti-CCP', 'Siero', 'U/mL'],
  ['tumo', 'Antigene prostatico specifico', 'PSA', 'Siero', 'ng/mL'], ['tumo', 'Antigene carcinoembrionario', 'CEA', 'Siero', 'ng/mL'],
  ['tumo', 'CA 19-9', 'CA 19-9', 'Siero', 'U/mL'], ['tumo', 'CA 125', 'CA 125', 'Siero', 'U/mL'], ['tumo', 'CA 15-3', 'CA 15-3', 'Siero', 'U/mL'], ['tumo', 'Alfa-fetoproteina', 'AFP', 'Siero', 'ng/mL'],
  ['micr', 'Emocoltura', '', 'Sangue (flaconi aerobi e anaerobi)', ''], ['micr', 'Urinocoltura', '', 'Urine (mitto intermedio)', 'UFC/mL'],
  ['micr', 'Antigene di superficie dell’epatite B', 'HBsAg', 'Siero', ''], ['micr', 'Anticorpi anti-HCV', 'Anti-HCV', 'Siero', ''], ['micr', 'Test combinato HIV antigene/anticorpi', 'HIV Ag/Ab', 'Siero', ''],
  ['liqu', 'Esame del liquor', '', 'Liquor', ''], ['liqu', 'Esame del liquido pleurico', '', 'Liquido pleurico', ''], ['liqu', 'Esame del liquido ascitico', '', 'Liquido ascitico', ''], ['liqu', 'Esame del liquido sinoviale', '', 'Liquido sinoviale', ''],
  ['farm', 'Digossinemia', '', 'Siero', 'ng/mL'], ['farm', 'Litiemia', 'Li', 'Siero', 'mEq/L'], ['farm', 'Vancomicina (valle)', '', 'Siero', 'mg/L'], ['farm', 'Etanolemia', '', 'Sangue', 'g/L'], ['farm', 'Carbossiemoglobina', 'COHb', 'Sangue intero (eparina)', '%']
];

let labQuery = '';
const labCatFilter = new Set();
function labTabs(cur) {
  const t = [['', 'Esami'], ['ref', 'Leggi un referto'], ['calc', 'Calcoli'], ['quiz', 'Allenati']];
  return `<nav class="tabs lab-tabs" aria-label="Medicina di laboratorio">${t.map(([k, l]) => `<a href="#/lab${k ? `/${k}` : ''}" class="tab ${cur === k ? 'on' : ''}" ${cur === k ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
}
function viewLab(p1, p2) {
  if (p1 === 'ref') return viewLabRef();
  if (p1 === 'calc') return viewLabCalc();
  if (p1 === 'quiz') return viewLabQuiz();
  if (p1 === 'new') return viewLabEdit(null);
  if (p1) return p2 === 'edit' ? viewLabEdit(p1) : viewLabExam(p1);
  const all = labExams();
  const counts = new Map();
  all.forEach(x => counts.set(x.cat || 'altr', (counts.get(x.cat || 'altr') || 0) + 1));
  [...labCatFilter].forEach(k => { if (!counts.has(k)) labCatFilter.delete(k); });
  setView(`
    <header class="page-head">
      <div><h1>Medicina di laboratorio</h1><p class="lede">${all.length ? `${all.length} esami. ` : ''}Per ogni esame: range, valori critici, cause di aumento e diminuzione, uso diagnostico.</p></div>
      <a class="btn primary" href="#/lab/new">Nuovo esame</a>
    </header>
    ${labTabs('')}
    ${all.length ? `
      <input type="search" class="input search" id="labQ" placeholder="Cerca un esame, una sigla o una causa" aria-label="Cerca negli esami" value="${esc(labQuery)}">
      <div class="tag-cloud" aria-label="Filtra per categoria">${LAB_CATS.filter(([k]) => counts.has(k)).map(([k, l]) => `<button type="button" class="tag ${labCatFilter.has(k) ? 'on' : ''}" data-lc="${k}" aria-pressed="${labCatFilter.has(k)}">${l} <span class="muted-inline">${counts.get(k)}</span></button>`).join('')}</div>
      <div id="labList"></div>
      <p class="hint">Mancano esami? <button class="btn sm ghost" type="button" data-act="lab-base">Aggiungi dall’elenco di base</button></p>` : `
      <div class="empty">
        <p>Ancora nessun esame. Puoi partire dall’<strong>elenco di base</strong>, con nome, sigla, campione e unità di oltre 110 esami divisi per categoria, e poi completare ognuno con il tuo libro; oppure crearli uno per uno.</p>
        <div class="inline" style="justify-content:center"><button class="btn primary" type="button" data-act="lab-base">Aggiungi l’elenco di base</button><a class="btn" href="#/lab/new">Nuovo esame</a></div>
      </div>`}
  `);
  on('[data-act="lab-base"]', 'click', labBaseFlow);
  const draw = () => {
    const box = $('#labList');
    if (!box) return;
    const toks = foldAccents(labQuery).split(/\s+/).filter(Boolean);
    const list = all.filter(x => (!labCatFilter.size || labCatFilter.has(x.cat || 'altr')) && (!toks.length || toks.every(t => foldAccents(`${x.name} ${x.abbr || ''} ${x.up || ''} ${x.down || ''} ${(x.uses || []).map(u => u.dx).join(' ')} ${x.notes || ''}`).includes(t))));
    const byCat = new Map();
    list.forEach(x => { const k = x.cat || 'altr'; if (!byCat.has(k)) byCat.set(k, []); byCat.get(k).push(x); });
    box.innerHTML = list.length ? LAB_CATS.filter(([k]) => byCat.has(k)).map(([k, l]) => `
      <h2 class="sub">${l}</h2>
      <ul class="list">${byCat.get(k).map(x => {
        const r = labPickRange(x);
        const bits = [r ? labRangeText(r, x.unit) : 'senza range', x.sample || ''].filter(Boolean);
        return `<li><a class="row" href="#/lab/${x.id}">
          <span class="row-main">
            <span class="row-title">${esc(x.name)}${x.abbr ? ` <span class="lab-abbr">${esc(x.abbr)}</span>` : ''}</span>
            <span class="row-sub">${esc(bits.join(' · '))}${x.incomplete ? ' · ⚠ incompleto' : ''}</span>
          </span>
          ${labHasRange(x) ? '' : '<span class="pill soft">da completare</span>'}
        </a></li>`;
      }).join('')}</ul>`).join('') : '<p class="hint">Nessun esame corrisponde.</p>';
  };
  draw();
  $('#labQ')?.addEventListener('input', e => { labQuery = e.target.value; draw(); });
  on('[data-lc]', 'click', e => {
    const k = e.currentTarget.dataset.lc;
    if (labCatFilter.has(k)) labCatFilter.delete(k); else labCatFilter.add(k);
    e.currentTarget.classList.toggle('on', labCatFilter.has(k));
    e.currentTarget.setAttribute('aria-pressed', labCatFilter.has(k));
    draw();
  });
}
async function labBaseFlow() {
  const have = new Set(labExams().map(x => foldAccents(x.name)));
  const sh = openSheet(`
    <h2>Elenco di base</h2>
    <p class="sheet-sub">Nome, sigla, campione e unità più usate in Italia, senza range: quelli li aggiungi tu dalla tua fonte, perché cambiano da laboratorio a laboratorio. Controlla anche le unità sul tuo referto. Gli esami che hai già non vengono doppiati.</p>
    <div class="lab-base-cats">${LAB_CATS.filter(([k]) => LAB_BASE.some(b => b[0] === k)).map(([k, l]) => {
      const n = LAB_BASE.filter(b => b[0] === k && !have.has(foldAccents(b[1]))).length;
      return `<label class="check"><input type="checkbox" data-bc="${k}" ${n ? 'checked' : 'disabled'}><span>${l} <span class="muted-inline">${n ? `${n} da aggiungere` : 'già tutti presenti'}</span></span></label>`;
    }).join('')}</div>
    <div class="modal-actions">
      <button class="btn ghost" type="button" data-bb="no">Annulla</button>
      <button class="btn primary" type="button" data-bb="ok">Aggiungi</button>
    </div>`, { label: 'Elenco di base' });
  $('[data-bb="no"]', sh.el).onclick = () => sh.close();
  $('[data-bb="ok"]', sh.el).onclick = async () => {
    const cats = new Set($$('[data-bc]:checked', sh.el).map(c => c.dataset.bc));
    const now = Date.now();
    const add = LAB_BASE.filter(b => cats.has(b[0]) && !have.has(foldAccents(b[1])));
    for (const [i, [cat, name, abbr, sample, unit]] of add.entries()) {
      await saveLink({ id: uid(), kind: 'lab', notebookId: '_lab', created: now + i, name, abbr, cat, sample, unit, ranges: [], uses: [] });
    }
    sh.close();
    toast(add.length ? `${add.length} esami aggiunti` : 'Nessun esame nuovo');
    route();
  };
}

function viewLabExam(id) {
  const x = labById(id);
  if (!x) return notFound('Questo esame');
  const ranges = (x.ranges || []).filter(r => labRangeText(r) || r.note);
  const up = labLines(x.up), down = labLines(x.down);
  const uses = (x.uses || []).filter(u => u.dx);
  const linked = (x.clinic || []).map(cid => state.links.find(l => l.id === cid && l.kind === 'clinical')).filter(Boolean);
  const siF = labNum(x.siFactor);
  const block = (title, html) => html ? `<section class="lab-block"><h2 class="sub">${title}</h2>${html}</section>` : '';
  const lr = u => {
    const se = labNum(u.sens), sp = labNum(u.spec);
    if (se === null || sp === null) return ['–', '–'];
    const s = se / 100, p = sp / 100;
    return [p >= 1 ? '∞' : labFmt(s / (1 - p), 1), p <= 0 ? '–' : labFmt((1 - s) / p, 2)];
  };
  setView(`
    <div class="back-row"><a class="back" href="#/lab">Medicina di laboratorio</a></div>
    <header class="sec-head">
      <h1>${esc(x.name)}${x.abbr ? ` <span class="lab-abbr big">${esc(x.abbr)}</span>` : ''}</h1>
      <p class="meta">${esc([labCatName(x.cat), x.sample, x.unit ? `unità: ${x.unit}` : ''].filter(Boolean).join(' · '))}</p>
      ${x.incomplete ? `<button class="inc-chip" type="button" data-act="inc">⚠ Incompleto${incompleteNote(x) ? `: ${esc(incompleteNote(x).slice(0, 70))}` : ''}</button>` : ''}
      <div class="sec-extra"><a class="btn sm" href="#/lab/${x.id}/edit">Modifica</a></div>
    </header>
    <div class="notes lab-notes">
      ${block('Valori di riferimento', ranges.length ? `
        <div class="table-wrap"><table><thead><tr><th>Per chi</th><th>Range</th><th>Note</th></tr></thead><tbody>
          ${ranges.map(r => `<tr><td>${esc(r.who || 'Adulti')}</td><td class="num">${esc(labRangeText(r, x.unit) || '–')}</td><td>${esc(r.note || '')}</td></tr>`).join('')}
        </tbody></table></div>
        ${x.siUnit && siF ? `<p class="hint">In unità SI: moltiplica per ${labFmt(siF, 4)} per avere ${esc(x.siUnit)}${ranges[0] && labNum(ranges[0].low) !== null && labNum(ranges[0].high) !== null ? ` (${labFmt(labNum(ranges[0].low) * siF)} – ${labFmt(labNum(ranges[0].high) * siF)} ${esc(x.siUnit)})` : ''}.</p>` : ''}
        ${x.rangeSrc ? `<p class="hint">Range da: ${esc(x.rangeSrc)}. I range cambiano da laboratorio a laboratorio: vale sempre quello stampato sul referto.</p>` : '<p class="hint">I range cambiano da laboratorio a laboratorio: vale sempre quello stampato sul referto.</p>'}`
        : '<p class="hint">Range non ancora inseriti. <a href="#/lab/' + x.id + '/edit">Aggiungili</a> dalla tua fonte.</p>')}
      ${block('Valori critici', labNum(x.crit?.low) !== null || labNum(x.crit?.high) !== null ? `<p>${labNum(x.crit?.low) !== null ? `Sotto <strong>${esc(x.crit.low)}</strong>` : ''}${labNum(x.crit?.low) !== null && labNum(x.crit?.high) !== null ? ' oppure ' : ''}${labNum(x.crit?.high) !== null ? `sopra <strong>${esc(x.crit.high)}</strong>` : ''} ${esc(x.unit || '')}: da comunicare subito al medico.</p>` : '')}
      ${block('Prelievo e preparazione', x.prep ? `<p>${esc(x.prep)}</p>` : '')}
      ${up.length || down.length ? `<section class="lab-block"><div class="lab-two">
        ${up.length ? `<div><h2 class="sub">↑ Cause di aumento</h2><ul>${up.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
        ${down.length ? `<div><h2 class="sub">↓ Cause di diminuzione</h2><ul>${down.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
      </div></section>` : ''}
      ${block('Interferenze e falsi risultati', x.interf ? `<p>${esc(x.interf).replace(/\n/g, '<br>')}</p>` : '')}
      ${block('Andamento nel tempo', x.kinetics ? `<p>${esc(x.kinetics).replace(/\n/g, '<br>')}</p>` : '')}
      ${block('Quando richiederlo', x.when ? `<p>${esc(x.when).replace(/\n/g, '<br>')}</p>` : '')}
      ${block('Uso diagnostico', uses.length ? `
        <div class="table-wrap"><table><thead><tr><th>Per diagnosticare</th><th>Soglia</th><th>Sens.</th><th>Spec.</th><th>LR+</th><th>LR−</th></tr></thead><tbody>
          ${uses.map(u => { const [p, n] = lr(u); return `<tr><td>${esc(u.dx)}</td><td>${esc(u.cut || '–')}</td><td class="num">${labNum(u.sens) !== null ? `${labFmt(labNum(u.sens), 1)}%` : '–'}</td><td class="num">${labNum(u.spec) !== null ? `${labFmt(labNum(u.spec), 1)}%` : '–'}</td><td class="num">${p}</td><td class="num">${n}</td></tr>`; }).join('')}
        </tbody></table></div>
        <p class="hint">LR+ = sensibilità / (1 − specificità): sopra 10 un risultato positivo conferma molto. LR− = (1 − sensibilità) / specificità: sotto 0,1 un risultato negativo esclude molto. Valgono per quella malattia e quella soglia.</p>` : '')}
      ${block('Note', x.notes ? renderMd(x.notes) : '')}
      ${block('Note cliniche collegate', linked.length ? `<div class="tags">${linked.map(n => `<button type="button" class="tag sym" data-lcn="${n.id}">${esc(n.title)}</button>`).join('')}</div>` : '')}
    </div>
    ${sourcesBlockHtml(x)}
  `);
  on('[data-lcn]', 'click', e => showClinicNote(e.currentTarget.dataset.lcn));
  on('[data-act="inc"]', 'click', async () => { if (await toggleIncomplete(x, () => saveLink(x), 'esame')) route(); });
  bindSourcesBlock($('#view'), x, () => saveLink(x), 'esame');
}

function viewLabEdit(id) {
  const x = id ? labById(id) : { id: uid(), kind: 'lab', notebookId: '_lab', created: Date.now(), name: '', cat: 'altr', ranges: [], uses: [] };
  if (!x) return notFound('Questo esame');
  const isNew = !id;
  const ranges = (x.ranges && x.ranges.length ? x.ranges : [{ who: 'Adulti', low: '', high: '', note: '' }]).map(r => ({ ...r }));
  const uses = (x.uses || []).map(u => ({ ...u }));
  let clinic = new Set(x.clinic || []);
  const rangeRow = (r, i) => `
    <div class="lab-row" data-ri="${i}">
      <input class="input" data-rf="who" value="${esc(r.who || '')}" placeholder="Per chi (es. Adulti, Uomini, Donne)" aria-label="Per chi">
      <input class="input num" data-rf="low" value="${esc(r.low ?? '')}" placeholder="Min" inputmode="decimal" aria-label="Valore minimo">
      <input class="input num" data-rf="high" value="${esc(r.high ?? '')}" placeholder="Max" inputmode="decimal" aria-label="Valore massimo">
      <input class="input" data-rf="note" value="${esc(r.note || '')}" placeholder="Nota (es. a digiuno)" aria-label="Nota">
      <button class="btn sm ghost" type="button" data-rdel="${i}" aria-label="Togli questa riga">✕</button>
    </div>`;
  const useRow = (u, i) => `
    <div class="lab-row use" data-ui="${i}">
      <input class="input" data-uf="dx" value="${esc(u.dx || '')}" placeholder="Malattia o condizione" aria-label="Malattia o condizione">
      <input class="input" data-uf="cut" value="${esc(u.cut || '')}" placeholder="Soglia" aria-label="Soglia">
      <input class="input num" data-uf="sens" value="${esc(u.sens ?? '')}" placeholder="Sens. %" inputmode="decimal" aria-label="Sensibilità in percentuale">
      <input class="input num" data-uf="spec" value="${esc(u.spec ?? '')}" placeholder="Spec. %" inputmode="decimal" aria-label="Specificità in percentuale">
      <button class="btn sm ghost" type="button" data-udel="${i}" aria-label="Togli questa riga">✕</button>
    </div>`;
  const notes = clinicalNotes().sort((a, b) => a.title.localeCompare(b.title, 'it'));
  setView(`
    <div class="back-row"><a class="back" href="${isNew ? '#/lab' : `#/lab/${x.id}`}">${isNew ? 'Medicina di laboratorio' : esc(x.name)}</a></div>
    <header class="page-head"><div><h1>${isNew ? 'Nuovo esame' : 'Modifica esame'}</h1></div>
      ${AI.ready() ? `<button class="btn" type="button" data-act="lab-ai">Compila con ${AI.name()}</button>` : ''}</header>
    <form id="labForm" class="lab-form" autocomplete="off">
      <label class="field"><span>Nome dell’esame</span><input class="input" id="lxName" value="${esc(x.name || '')}" required placeholder="Es. Troponina ad alta sensibilità"></label>
      <div class="grid2">
        <label class="field"><span>Sigla</span><input class="input" id="lxAbbr" value="${esc(x.abbr || '')}" placeholder="Es. hs-cTn"></label>
        <label class="field"><span>Categoria</span><select class="input" id="lxCat">${LAB_CATS.map(([k, l]) => `<option value="${k}" ${x.cat === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Campione</span><input class="input" id="lxSample" value="${esc(x.sample || '')}" placeholder="Es. Siero, plasma (citrato), urine"></label>
        <label class="field"><span>Unità di misura</span><input class="input" id="lxUnit" value="${esc(x.unit || '')}" placeholder="Es. mg/dL"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Unità SI, facoltativa</span><input class="input" id="lxSiUnit" value="${esc(x.siUnit || '')}" placeholder="Es. µmol/L"></label>
        <label class="field"><span>Fattore di conversione verso SI</span><input class="input" id="lxSiF" value="${esc(x.siFactor ?? '')}" inputmode="decimal" placeholder="Es. 88,4"></label>
      </div>
      <label class="field"><span>Prelievo e preparazione</span><input class="input" id="lxPrep" value="${esc(x.prep || '')}" placeholder="Es. a digiuno da 8 ore, provetta in ghiaccio"></label>

      <h2 class="sub">Valori di riferimento</h2>
      <div id="lxRanges">${ranges.map(rangeRow).join('')}</div>
      <button class="btn sm ghost" type="button" data-act="r-add">+ Altra riga (uomini, donne, età…)</button>
      <label class="field"><span>Da dove vengono i range</span><input class="input" id="lxRangeSrc" value="${esc(x.rangeSrc || '')}" placeholder="Es. Harrison, oppure il laboratorio del policlinico"></label>
      <div class="grid2">
        <label class="field"><span>Valore critico basso</span><input class="input" id="lxCritLo" value="${esc(x.crit?.low ?? '')}" inputmode="decimal"></label>
        <label class="field"><span>Valore critico alto</span><input class="input" id="lxCritHi" value="${esc(x.crit?.high ?? '')}" inputmode="decimal"></label>
      </div>

      <div class="grid2">
        <label class="field"><span>↑ Cause di aumento, una per riga</span><textarea class="input" id="lxUp" rows="6">${esc(x.up || '')}</textarea></label>
        <label class="field"><span>↓ Cause di diminuzione, una per riga</span><textarea class="input" id="lxDown" rows="6">${esc(x.down || '')}</textarea></label>
      </div>
      <label class="field"><span>Interferenze e falsi positivi o negativi</span><textarea class="input" id="lxInterf" rows="3">${esc(x.interf || '')}</textarea></label>
      <label class="field"><span>Andamento nel tempo</span><textarea class="input" id="lxKin" rows="2" placeholder="Es. sale dopo 3 ore, picco a 24, resta alta 10-14 giorni">${esc(x.kinetics || '')}</textarea></label>
      <label class="field"><span>Quando richiederlo</span><textarea class="input" id="lxWhen" rows="2">${esc(x.when || '')}</textarea></label>

      <h2 class="sub">Uso diagnostico</h2>
      <p class="hint">Sensibilità e specificità dipendono dalla malattia e dalla soglia: una riga per ogni uso. LR+ e LR− li calcolo io.</p>
      <div id="lxUses">${uses.map(useRow).join('')}</div>
      <button class="btn sm ghost" type="button" data-act="u-add">+ Aggiungi un uso diagnostico</button>

      <label class="field"><span>Note, anche in Markdown</span><textarea class="input" id="lxNotes" rows="4">${esc(x.notes || '')}</textarea></label>

      ${notes.length ? `<h2 class="sub">Note cliniche collegate</h2>
        <input class="input" id="lxCnQ" placeholder="Cerca una nota clinica" aria-label="Cerca una nota clinica">
        <div class="lab-cn" id="lxCn">${notes.map(n => `<label class="check" data-cnt="${esc(foldAccents(n.title))}"><input type="checkbox" value="${n.id}" ${clinic.has(n.id) ? 'checked' : ''}><span>${esc(n.title)}</span></label>`).join('')}</div>` : ''}

      <label class="field"><span>Fonti, una per riga</span><textarea class="input" id="lxSrc" rows="2">${esc(sourcesOf(x).join('\n'))}</textarea></label>
      <label class="check"><input type="checkbox" id="lxInc" ${x.incomplete ? 'checked' : ''}><span>Incompleto</span></label>
      <label class="field" id="lxIncBox" ${x.incomplete ? '' : 'hidden'}><span>Cosa manca? Facoltativo</span><input class="input" id="lxIncNote" value="${esc(x.incomplete?.note || '')}"></label>

      <div class="save-row">
        ${isNew ? '' : '<button class="btn ghost danger" type="button" data-act="lab-del">Elimina</button>'}
        <a class="btn ghost" href="${isNew ? '#/lab' : `#/lab/${x.id}`}">Annulla</a>
        <button class="btn primary" type="submit">Salva</button>
      </div>
    </form>
  `);
  const form = $('#labForm');
  const readRows = () => {
    $$('[data-ri]', form).forEach(row => { const r = ranges[+row.dataset.ri]; $$('[data-rf]', row).forEach(i => { r[i.dataset.rf] = i.value.trim(); }); });
    $$('[data-ui]', form).forEach(row => { const u = uses[+row.dataset.ui]; $$('[data-uf]', row).forEach(i => { u[i.dataset.uf] = i.value.trim(); }); });
  };
  const redraw = () => { $('#lxRanges').innerHTML = ranges.map(rangeRow).join(''); $('#lxUses').innerHTML = uses.map(useRow).join(''); };
  form.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'r-add') { readRows(); ranges.push({ who: '', low: '', high: '', note: '' }); redraw(); $$('[data-ri]', form).pop()?.querySelector('input')?.focus(); }
    else if (b.dataset.act === 'u-add') { readRows(); uses.push({ dx: '', cut: '', sens: '', spec: '' }); redraw(); $$('[data-ui]', form).pop()?.querySelector('input')?.focus(); }
    else if (b.dataset.rdel !== undefined) { readRows(); ranges.splice(+b.dataset.rdel, 1); redraw(); }
    else if (b.dataset.udel !== undefined) { readRows(); uses.splice(+b.dataset.udel, 1); redraw(); }
  });
  $('#lxInc').addEventListener('change', e => { $('#lxIncBox').hidden = !e.target.checked; });
  $('#lxCnQ')?.addEventListener('input', e => {
    const q = foldAccents(e.target.value.trim());
    $$('[data-cnt]', form).forEach(l => { l.hidden = !!q && !l.dataset.cnt.includes(q) && !l.querySelector('input').checked; });
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    readRows();
    const name = $('#lxName').value.trim();
    if (!name) { toast('Scrivi il nome dell’esame'); $('#lxName').focus(); return; }
    const dup = labExams().find(o => o.id !== x.id && foldAccents(o.name) === foldAccents(name));
    if (dup && !(await modal({ title: 'Esame già presente', text: `Hai già una scheda “${dup.name}”. Salvarne un’altra con lo stesso nome?`, confirm: 'Salva lo stesso' }))) return;
    Object.assign(x, {
      name, abbr: $('#lxAbbr').value.trim(), cat: $('#lxCat').value, sample: $('#lxSample').value.trim(), unit: $('#lxUnit').value.trim(),
      siUnit: $('#lxSiUnit').value.trim(), siFactor: $('#lxSiF').value.trim(), prep: $('#lxPrep').value.trim(),
      ranges: ranges.filter(r => r.who || r.low || r.high || r.note), rangeSrc: $('#lxRangeSrc').value.trim(),
      crit: { low: $('#lxCritLo').value.trim(), high: $('#lxCritHi').value.trim() },
      up: $('#lxUp').value.trim(), down: $('#lxDown').value.trim(), interf: $('#lxInterf').value.trim(), kinetics: $('#lxKin').value.trim(), when: $('#lxWhen').value.trim(),
      uses: uses.filter(u => u.dx), notes: $('#lxNotes').value.trim(),
      clinic: $$('#lxCn input:checked', form).map(c => c.value),
      sources: $('#lxSrc').value.split('\n').map(t => t.trim()).filter(Boolean)
    });
    if ($('#lxInc').checked) x.incomplete = { note: $('#lxIncNote').value.trim(), since: x.incomplete?.since || todayStr() };
    else delete x.incomplete;
    await saveLink(x);
    toast('Esame salvato');
    go(`#/lab/${x.id}`);
  });
  on('[data-act="lab-del"]', 'click', async () => {
    if (!(await modal({ title: 'Eliminare l’esame?', text: `La scheda “${x.name}” sparisce su tutti i tuoi dispositivi.`, confirm: 'Elimina', danger: true }))) return;
    await removeRecords([{ store: 'links', rec: x }]);
    toast('Esame eliminato');
    go('#/lab');
  });
  on('[data-act="lab-ai"]', 'click', async e => {
    const btn = e.currentTarget;
    const name = $('#lxName').value.trim();
    if (!name) { toast('Scrivi prima il nome dell’esame'); $('#lxName').focus(); return; }
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Compilo…';
    try {
      readRows();
      const d = await labAiFill(name, $('#lxAbbr').value.trim());
      const setIf = (sel, v) => { const el = $(sel); if (el && !el.value.trim() && v !== undefined && v !== null && String(v).trim()) el.value = Array.isArray(v) ? v.join('\n') : String(v); };
      setIf('#lxAbbr', d.abbr); setIf('#lxSample', d.sample); setIf('#lxUnit', d.unit); setIf('#lxSiUnit', d.siUnit); setIf('#lxSiF', d.siFactor);
      setIf('#lxPrep', d.prep); setIf('#lxUp', d.up); setIf('#lxDown', d.down); setIf('#lxInterf', d.interf); setIf('#lxKin', d.kinetics); setIf('#lxWhen', d.when); setIf('#lxNotes', d.notes);
      setIf('#lxCritLo', d.crit?.low); setIf('#lxCritHi', d.crit?.high);
      if (d.cat && LAB_CATS.some(c => c[0] === d.cat) && (isNew || !x.cat || x.cat === 'altr')) $('#lxCat').value = d.cat;
      const emptyRanges = !ranges.some(r => r.low || r.high);
      if (emptyRanges && Array.isArray(d.ranges) && d.ranges.length) { ranges.splice(0, ranges.length, ...d.ranges.map(r => ({ who: String(r.who || ''), low: String(r.low ?? ''), high: String(r.high ?? ''), note: String(r.note || '') }))); }
      if (!uses.length && Array.isArray(d.uses)) uses.push(...d.uses.filter(u => u && u.dx).map(u => ({ dx: String(u.dx), cut: String(u.cut ?? ''), sens: String(u.sens ?? ''), spec: String(u.spec ?? '') })));
      redraw();
      const src = $('#lxSrc');
      const line = `Compilato con ${AI.name()} il ${fmtDay(todayStr())}: da verificare`;
      if (!src.value.includes('Compilato con')) src.value = `${src.value.trim()}${src.value.trim() ? '\n' : ''}${line}`;
      $('#lxInc').checked = true;
      $('#lxIncBox').hidden = false;
      if (!$('#lxIncNote').value.trim()) $('#lxIncNote').value = 'Compilato con l’AI: controlla valori, cause e sensibilità sulla tua fonte';
      toast('Campi vuoti compilati: controllali prima di salvare');
    } catch (err) { toast(err.message || 'Non sono riuscita a compilarlo', 'err'); }
    finally { btn.disabled = false; btn.textContent = label; }
  });
}
async function labAiFill(name, abbr) {
  const cats = LAB_CATS.map(([k, l]) => `${k} = ${l}`).join('; ');
  const system = `Sei un docente italiano di medicina di laboratorio e prepari schede di studio per una studentessa di medicina.
Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo e senza blocchi di codice, con questi campi:
{"abbr": "", "cat": "", "sample": "", "prep": "", "unit": "", "siUnit": "", "siFactor": null,
 "ranges": [{"who": "Adulti", "low": "", "high": "", "note": ""}], "crit": {"low": "", "high": ""},
 "up": ["cause di aumento"], "down": ["cause di diminuzione"], "interf": "", "kinetics": "", "when": "",
 "uses": [{"dx": "", "cut": "", "sens": 0, "spec": 0}], "notes": ""}
Regole: scrivi in italiano; categoria "cat" scelta tra: ${cats}. Unità convenzionali usate nei laboratori italiani; "siFactor" è il numero per cui moltiplicare il valore convenzionale per avere l’unità SI. Range dell’adulto come nei testi di riferimento, con righe separate per uomini e donne se diversi. Numeri con il punto decimale. Nelle "uses" metti solo usi diagnostici ben documentati, con sensibilità e specificità in percentuale; se non sei sicuro lascia la lista vuota. "notes" breve, in Markdown. Se un campo non si applica lascialo vuoto.`;
  const r = await AI.generate({ system, text: `Esame: ${name}${abbr ? ` (${abbr})` : ''}`, maxTokens: 4000 });
  const t = String(r.text || '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('La risposta dell’AI non è nel formato atteso: riprova.');
  try { return JSON.parse(t.slice(a, b + 1)); }
  catch { throw new Error('La risposta dell’AI non è nel formato atteso: riprova.'); }
}

/* ---------- Leggi un referto ---------- */
const labRef = { sex: '', rows: [{ id: '', v: '' }] };
function viewLabRef() {
  const all = labExams().filter(labHasRange);
  setView(`
    <header class="page-head"><div><h1>Leggi un referto</h1><p class="lede">Scrivi i valori di un referto (anche di un caso clinico): segno quelli fuori range in base alle tue schede.</p></div></header>
    ${labTabs('ref')}
    ${all.length ? `
      <div class="grid2 lab-ref-head">
        <label class="field"><span>Sesso, per i range diversi</span><select class="input" id="refSex"><option value="">Non indicato</option><option value="F" ${labRef.sex === 'F' ? 'selected' : ''}>Donna</option><option value="M" ${labRef.sex === 'M' ? 'selected' : ''}>Uomo</option></select></label>
      </div>
      <datalist id="refExams">${all.map(x => `<option value="${esc(x.name)}">${x.abbr ? esc(x.abbr) : ''}</option>`).join('')}</datalist>
      <div id="refRows"></div>
      <div class="inline"><button class="btn sm" type="button" data-act="ref-add">+ Altro valore</button><button class="btn sm ghost" type="button" data-act="ref-clear">Svuota</button></div>
      <p class="hint">Uso le schede con i range compilati (${all.length}). Il range che vale è sempre quello stampato sul referto: questo è un esercizio di lettura.</p>`
      : '<div class="empty"><p>Per leggere un referto servono esami con i range compilati. Aggiungili nella scheda Esami.</p><a class="btn primary" href="#/lab">Vai agli esami</a></div>'}
  `);
  if (!all.length) return;
  const find = v => { const f = foldAccents(v.trim()); return all.find(x => foldAccents(x.name) === f || (x.abbr && foldAccents(x.abbr) === f)); };
  const verdict = (x, v) => {
    const n = labNum(v);
    if (n === null || !x) return { cls: '', text: '' };
    const r = labPickRange(x, labRef.sex);
    const lo = labNum(r?.low), hi = labNum(r?.high);
    const cl = labNum(x.crit?.low), ch = labNum(x.crit?.high);
    const rng = r ? `range ${labRangeText(r, x.unit)}${r.who ? ` (${r.who})` : ''}` : '';
    if (cl !== null && n < cl) return { cls: 'crit', text: `Critico basso · ${rng}` };
    if (ch !== null && n > ch) return { cls: 'crit', text: `Critico alto · ${rng}` };
    if (lo !== null && n < lo) return { cls: 'low', text: `↓ Basso · ${rng}` };
    if (hi !== null && n > hi) return { cls: 'high', text: `↑ Alto · ${rng}` };
    return { cls: 'ok', text: `Nella norma · ${rng}` };
  };
  // le righe si ridisegnano solo quando ne aggiungi o togli una; scrivendo cambia solo l’esito
  const outHtml = (r, x) => {
    const vd = verdict(x, r.v);
    return { cls: vd.cls, html: x ? `${esc(vd.text)}${vd.text ? ` · <a href="#/lab/${x.id}">scheda</a>` : ''}` : (r.name ? 'Esame non trovato tra quelli con range' : '') };
  };
  const updateRow = i => {
    const row = $(`[data-rr="${i}"]`);
    const r = labRef.rows[i];
    if (!row || !r) return;
    const x = all.find(e => e.id === r.id);
    const o = outHtml(r, x);
    row.className = `ref-row ${o.cls}`;
    $('.ref-out', row).innerHTML = o.html;
    $('.ref-unit', row).textContent = x?.unit || '';
  };
  const draw = () => {
    $('#refRows').innerHTML = labRef.rows.map((r, i) => {
      const x = all.find(e => e.id === r.id);
      const o = outHtml(r, x);
      return `<div class="ref-row ${o.cls}" data-rr="${i}">
        <input class="input" list="refExams" data-rk="name" value="${esc(x ? x.name : r.name || '')}" placeholder="Esame" aria-label="Esame">
        <span class="ref-val"><input class="input num" data-rk="v" value="${esc(r.v)}" inputmode="decimal" placeholder="Valore" aria-label="Valore"><span class="ref-unit">${esc(x?.unit || '')}</span></span>
        <span class="ref-out">${o.html}</span>
        <button class="btn sm ghost" type="button" data-rdel="${i}" aria-label="Togli">✕</button>
      </div>`;
    }).join('');
  };
  draw();
  $('#refSex').addEventListener('change', e => { labRef.sex = e.target.value; labRef.rows.forEach((_, i) => updateRow(i)); });
  const onEdit = e => {
    const row = e.target.closest('[data-rr]');
    if (!row || !e.target.dataset.rk) return;
    const i = +row.dataset.rr;
    const r = labRef.rows[i];
    if (e.target.dataset.rk === 'name') { const x = find(e.target.value); r.id = x ? x.id : ''; r.name = e.target.value; }
    else r.v = e.target.value;
    updateRow(i);
  };
  $('#refRows').addEventListener('input', onEdit);
  $('#refRows').addEventListener('change', e => {
    onEdit(e);
    if (e.target.dataset.rk === 'name' && labRef.rows[+e.target.closest('[data-rr]').dataset.rr].id) e.target.closest('[data-rr]').querySelector('[data-rk="v"]')?.focus();
  });
  $('#refRows').addEventListener('click', e => { const b = e.target.closest('[data-rdel]'); if (!b) return; labRef.rows.splice(+b.dataset.rdel, 1); if (!labRef.rows.length) labRef.rows.push({ id: '', v: '' }); draw(); });
  on('[data-act="ref-add"]', 'click', () => { labRef.rows.push({ id: '', v: '' }); draw(); $$('[data-rk="name"]').pop()?.focus(); });
  on('[data-act="ref-clear"]', 'click', () => { labRef.rows = [{ id: '', v: '' }]; draw(); });
}

/* ---------- Calcoli ---------- */
const LAB_CALCS = [
  { id: 'ag', title: 'Gap anionico', f: [['na', 'Na⁺', 'mEq/L'], ['cl', 'Cl⁻', 'mEq/L'], ['hco3', 'HCO₃⁻', 'mEq/L'], ['alb', 'Albumina (facoltativa)', 'g/dL']],
    run: v => {
      if ([v.na, v.cl, v.hco3].some(x => x === null)) return null;
      const ag = v.na - (v.cl + v.hco3);
      return `Gap anionico <strong>${labFmt(ag, 1)}</strong> mEq/L${v.alb !== null ? `; corretto per l’albumina <strong>${labFmt(ag + 2.5 * (4 - v.alb), 1)}</strong> mEq/L` : ''}.`;
    }, note: 'Na⁺ − (Cl⁻ + HCO₃⁻). Correzione: + 2,5 per ogni g/dL di albumina sotto 4. Il valore normale dipende dal metodo del laboratorio.' },
  { id: 'ca', title: 'Calcio corretto per l’albumina', f: [['ca', 'Calcio totale', 'mg/dL'], ['alb', 'Albumina', 'g/dL']],
    run: v => (v.ca === null || v.alb === null ? null : `Calcio corretto <strong>${labFmt(v.ca + 0.8 * (4 - v.alb), 2)}</strong> mg/dL.`),
    note: 'Ca + 0,8 × (4 − albumina). È una stima: se serve precisione si misura il calcio ionizzato.' },
  { id: 'egfr', title: 'eGFR CKD-EPI 2021', f: [['cr', 'Creatinina', 'mg/dL'], ['age', 'Età', 'anni'], ['sex', 'Sesso', 'sex']],
    run: v => {
      if (v.cr === null || v.age === null || !v.sex) return null;
      const f = v.sex === 'F', k = f ? 0.7 : 0.9, a = f ? -0.241 : -0.302;
      const g = 142 * Math.min(v.cr / k, 1) ** a * Math.max(v.cr / k, 1) ** -1.2 * 0.9938 ** v.age * (f ? 1.012 : 1);
      return `eGFR <strong>${labFmt(g, 0)}</strong> mL/min/1,73 m².`;
    }, note: 'Equazione CKD-EPI 2021 con la sola creatinina, senza correzione per etnia. Vale per adulti con creatinina stabile.' },
  { id: 'ldl', title: 'LDL calcolato (Friedewald)', f: [['tc', 'Colesterolo totale', 'mg/dL'], ['hdl', 'HDL', 'mg/dL'], ['tg', 'Trigliceridi', 'mg/dL']],
    run: v => {
      if ([v.tc, v.hdl, v.tg].some(x => x === null)) return null;
      return v.tg >= 400 ? 'Con trigliceridi da 400 mg/dL in su la formula non è affidabile: serve il dosaggio diretto.' : `LDL <strong>${labFmt(v.tc - v.hdl - v.tg / 5, 0)}</strong> mg/dL.`;
    }, note: 'Totale − HDL − trigliceridi/5, in mg/dL. Non vale con trigliceridi da 400 mg/dL in su.' },
  { id: 'osm', title: 'Osmolalità calcolata e gap osmolare', f: [['na', 'Na⁺', 'mEq/L'], ['glu', 'Glicemia', 'mg/dL'], ['urea', 'Azotemia (urea)', 'mg/dL'], ['meas', 'Osmolalità misurata (facoltativa)', 'mOsm/kg']],
    run: v => {
      if ([v.na, v.glu, v.urea].some(x => x === null)) return null;
      const c = 2 * v.na + v.glu / 18 + v.urea / 6;
      return `Osmolalità calcolata <strong>${labFmt(c, 0)}</strong> mOsm/kg${v.meas !== null ? `; gap osmolare <strong>${labFmt(v.meas - c, 0)}</strong>` : ''}.`;
    }, note: '2 × Na + glicemia/18 + urea/6 (con l’azotemia come urea; con il BUN si divide per 2,8). Un gap alto fa pensare a sostanze osmoticamente attive come alcoli e glicoli.' },
  { id: 'nacorr', title: 'Sodio corretto per la glicemia', f: [['na', 'Na⁺', 'mEq/L'], ['glu', 'Glicemia', 'mg/dL']],
    run: v => {
      if (v.na === null || v.glu === null) return null;
      const d = Math.max(0, v.glu - 100) / 100;
      return `Sodio corretto <strong>${labFmt(v.na + 1.6 * d, 1)}</strong> mEq/L con il fattore 1,6; <strong>${labFmt(v.na + 2.4 * d, 1)}</strong> con 2,4.`;
    }, note: 'Per ogni 100 mg/dL di glicemia sopra 100 si aggiunge 1,6 (Katz) o 2,4 (Hillier) al sodio misurato.' }
];
function viewLabCalc() {
  setView(`
    <header class="page-head"><div><h1>Calcoli di laboratorio</h1><p class="lede">I conti di tutti i giorni, con la formula sotto. Strumenti di studio: in reparto si ricontrolla sempre.</p></div></header>
    ${labTabs('calc')}
    <div class="lab-calcs">${LAB_CALCS.map(c => `
      <section class="lab-calc" data-calc="${c.id}">
        <h2 class="sub">${c.title}</h2>
        <div class="lab-calc-f">${c.f.map(([k, l, u]) => u === 'sex'
          ? `<label class="field"><span>${l}</span><select class="input" data-k="${k}"><option value="">–</option><option value="F">Donna</option><option value="M">Uomo</option></select></label>`
          : `<label class="field"><span>${l}${u ? ` <span class="muted-inline">${u}</span>` : ''}</span><input class="input num" data-k="${k}" inputmode="decimal"></label>`).join('')}</div>
        <p class="lab-calc-out" aria-live="polite"></p>
        <p class="hint">${c.note}</p>
      </section>`).join('')}</div>
  `);
  $$('.lab-calc').forEach(box => {
    const c = LAB_CALCS.find(x => x.id === box.dataset.calc);
    const upd = () => {
      const v = {};
      $$('[data-k]', box).forEach(i => { v[i.dataset.k] = i.tagName === 'SELECT' ? i.value : labNum(i.value); });
      const out = c.run(v);
      $('.lab-calc-out', box).innerHTML = out || '';
    };
    box.addEventListener('input', upd);
    box.addEventListener('change', upd);
  });
}

/* ---------- Allenati: domande dalle tue schede ---------- */
function labQuizItems() {
  const items = [];
  labExams().forEach(x => {
    if (labHasRange(x)) items.push({ x, q: `Valori di riferimento di <strong>${esc(x.name)}</strong>${x.abbr ? ` (${esc(x.abbr)})` : ''}?`, a: (x.ranges || []).filter(r => labRangeText(r)).map(r => `${esc(r.who || 'Adulti')}: <strong>${esc(labRangeText(r, x.unit))}</strong>${r.note ? ` <span class="muted-inline">${esc(r.note)}</span>` : ''}`).join('<br>') });
    if (labLines(x.up).length) items.push({ x, q: `Cause di <strong>aumento</strong> di ${esc(x.name)}?`, a: `<ul>${labLines(x.up).map(t => `<li>${esc(t)}</li>`).join('')}</ul>` });
    if (labLines(x.down).length) items.push({ x, q: `Cause di <strong>diminuzione</strong> di ${esc(x.name)}?`, a: `<ul>${labLines(x.down).map(t => `<li>${esc(t)}</li>`).join('')}</ul>` });
    (x.uses || []).filter(u => u.dx).forEach(u => items.push({ x, q: `Quale esame chiedi per <strong>${esc(u.dx)}</strong>, e quanto è affidabile?`, a: `<strong>${esc(x.name)}</strong>${u.cut ? `, soglia ${esc(u.cut)}` : ''}${labNum(u.sens) !== null ? ` · sensibilità ${labFmt(labNum(u.sens), 1)}%` : ''}${labNum(u.spec) !== null ? ` · specificità ${labFmt(labNum(u.spec), 1)}%` : ''}` }));
    if (x.sample && x.prep) items.push({ x, q: `Su che campione si dosa <strong>${esc(x.name)}</strong>${x.prep ? ', e come ci si prepara' : ''}?`, a: `${esc(x.sample)}${x.prep ? `<br>${esc(x.prep)}` : ''}` });
  });
  return items;
}
function viewLabQuiz() {
  const items = labQuizItems();
  setView(`
    <header class="page-head"><div><h1>Allenati</h1><p class="lede">Domande pescate a caso dalle tue schede: rispondi a mente o a voce, poi scopri la risposta.</p></div></header>
    ${labTabs('quiz')}
    ${items.length ? '<div id="lqz"></div>' : '<div class="empty"><p>Le domande nascono dalle schede compilate: range, cause, usi diagnostici. Completa qualche esame e torna qui.</p><a class="btn primary" href="#/lab">Vai agli esami</a></div>'}
  `);
  if (!items.length) return;
  let order = items.map((_, i) => i).sort(() => Math.random() - 0.5);
  let at = 0, shown = false, ok = 0, done = 0;
  const draw = () => {
    if (at >= order.length) { order = order.sort(() => Math.random() - 0.5); at = 0; }
    const it = items[order[at]];
    $('#lqz').innerHTML = `
      <div class="lab-q">
        <p class="hint">${labCatName(it.x.cat)} · domanda ${done + 1}${done ? ` · sapute ${ok} su ${done}` : ''}</p>
        <p class="lab-q-t">${it.q}</p>
        ${shown ? `<div class="lab-q-a notes">${it.a}</div>
          <div class="inline"><button class="btn" type="button" data-qz="no">Non la sapevo</button><button class="btn primary" type="button" data-qz="yes">La sapevo</button><a class="btn ghost" href="#/lab/${it.x.id}">Apri la scheda</a></div>`
        : '<button class="btn primary" type="button" data-qz="show">Mostra la risposta</button>'}
      </div>`;
  };
  $('#lqz').addEventListener('click', e => {
    const b = e.target.closest('[data-qz]');
    if (!b) return;
    if (b.dataset.qz === 'show') shown = true;
    else { if (b.dataset.qz === 'yes') ok++; done++; at++; shown = false; }
    draw();
  });
  draw();
}

/* =====================================================================
   v3.29: tutorial a passi al primo avvio e tasti “?” che spiegano ogni parte
   ===================================================================== */
const TUT_KEY = 'nb-tutorial-done';
const TUTORIAL = [
  { icon: '👋', title: 'Benvenuta nel Notebook', html: `Qui trasformi appunti, PDF e slide in materiale da <b>ripassare attivamente</b>: cloze, domande, flashcard, ripetizione a voce.<br><br>Ti bastano due minuti per il giro completo.` },
  { icon: '📲', title: 'Mettilo sulla schermata Home', html: `Così si apre come una vera app e i dati restano al sicuro.<br><br><b>Android:</b> Altro → Impostazioni → <b>Installa l’app</b>, oppure in Chrome menu <b>⋮</b> → <b>Installa app</b>.<br><b>iPhone:</b> in <b>Safari</b> tasto <b>Condividi</b> → <b>Aggiungi alla schermata Home</b>.` },
  { icon: '📒', title: '1. Notebook e argomenti', html: `Crea un <b>notebook</b> per ogni materia.<br><br>Dentro puoi dividerlo in <b>macro-argomenti</b> e <b>sottoargomenti</b>; le <b>sezioni</b> sono i singoli argomenti che studi e ripassi.` },
  { icon: '📥', title: '2. Importa', html: `In <b>Importa</b> incolli un testo, carichi un PDF o una mappa XMind e l’app crea le sezioni.<br><br>Un PDF lo dividi ogni tot pagine, a intervalli scelti o <b>per argomenti</b>, leggendo i titoli. Con una chiave AI (Impostazioni) i testi vengono anche formattati, con cloze e domande.` },
  { icon: '🧠', title: '3. Studia una sezione', html: `In alto trovi le schede:<br><br><b>Cloze</b> nasconde i termini chiave · <b>Leggi</b> · <b>Mappe</b> · <b>Pagina bianca</b> e <b>Orale</b>: ripeti e confronta, segnando col semaforo · <b>Domande</b> · <b>Flashcard</b> · <b>Video</b> · <b>Modifica</b>.<br><br>Seleziona del testo in Leggi per evidenziarlo o farne un cloze o una flashcard.` },
  { icon: '🔁', title: '4. Ripassa', html: `Finita una sezione, scegli in fondo:<br><br><b>Segna come studiata in StudyHub</b>: i ripassi li pianifica StudyHub.<br><b>Ripassa nel Notebook</b>: li trovi nella scheda Ripasso.<br><br>Dopo ogni prova tocca <b>Di nuovo</b>, <b>Difficile</b>, <b>Bene</b> o <b>Facile</b>: l’app decide quando riproportela.` },
  { icon: '🩺', title: '5. Gli strumenti clinici', html: `In <b>Altro</b> trovi le <b>Note cliniche</b> (i quadri clinici, cercabili per sintomo), i <b>Casi clinici</b> (con foto, PDF e la modalità Risolvi), la <b>Medicina di laboratorio</b> (esami, referti e calcoli) e il <b>Glossario</b>.<br><br>Sulle immagini puoi creare un’<b>image occlusion</b> o l’esercizio delle <b>etichette</b> da rimettere al posto giusto.` },
  { icon: '📚', title: '6. Fonti e incompleti', html: `In fondo a ogni sezione (in Leggi) aggiungi le <b>fonti</b>.<br><br>Non hai finito, per esempio hai letto una sola fonte? Tocca <b>Segna incompleta</b>: la ritrovi in Altro → <b>Da completare</b>.` },
  { icon: '💾', title: '7. I tuoi dati', html: `Restano su questo dispositivo. Con la <b>sincronizzazione su Google Drive</b> li hai uguali su telefono e computer.<br><br>Ogni tanto fai comunque un <b>backup</b>: Impostazioni → Backup.` },
  { icon: '✨', title: 'Ultimi consigli', html: `Il tasto <span class="help-btn demo" aria-hidden="true">?</span> accanto ai titoli spiega a cosa serve ogni parte.<br><br>Dal menu apri <b>StudyHub</b> qui accanto. La guida completa è in Altro → <b>Guida</b>, dove puoi anche rivedere questo tutorial.` }
];
function openTutorial() {
  let i = 0;
  const sh = openSheet('<div id="tutBox"></div>', { label: 'Tutorial', onClose: () => { try { localStorage.setItem(TUT_KEY, '1'); } catch { /* niente */ } } });
  sh.el.classList.add('tut');
  const draw = () => {
    const s = TUTORIAL[i], last = i === TUTORIAL.length - 1;
    $('#tutBox', sh.el).innerHTML = `
      <div class="tut-icon" aria-hidden="true">${s.icon}</div>
      <h2 class="tut-title">${s.title}</h2>
      <div class="tut-text">${s.html}</div>
      <div class="tut-dots" aria-label="Passo ${i + 1} di ${TUTORIAL.length}">${TUTORIAL.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div>
      <div class="modal-actions">
        ${i ? '<button class="btn ghost" type="button" data-tut="-1">Indietro</button>' : '<button class="btn ghost" type="button" data-tut="skip">Salta</button>'}
        <button class="btn primary" type="button" data-tut="${last ? 'end' : '1'}">${last ? 'Inizia' : 'Avanti'}</button>
      </div>`;
    $('[data-tut]:last-child', sh.el)?.focus({ preventScroll: true });
  };
  sh.el.addEventListener('click', e => {
    const b = e.target.closest('[data-tut]');
    if (!b) return;
    const v = b.dataset.tut;
    if (v === 'skip' || v === 'end') { sh.close(true); return; }
    i = Math.max(0, Math.min(TUTORIAL.length - 1, i + +v));
    draw();
  });
  sh.el.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' && i < TUTORIAL.length - 1) { i++; draw(); }
    else if (e.key === 'ArrowLeft' && i > 0) { i--; draw(); }
  });
  draw();
}

const HELP = {
  // Impostazioni
  ai: { t: 'Intelligenza artificiale', b: `Serve per: formattare testi e PDF importati, aggiungere cloze e domande, valutare la Pagina bianca e l’Orale, creare flashcard, leggere ad alta voce con la voce di Google.<br><br><b>Senza chiave l’app funziona lo stesso</b>: importa con una formattazione di base e tutti gli esercizi restano.<br><br><b>Gemini</b> ha un piano gratuito con un numero di richieste al giorno per ogni modello. <b>Claude</b> si paga a consumo con crediti prepagati.` },
  apikey: { t: 'Chiave API', b: `È la “password” che permette all’app di usare l’AI con il tuo account.<br><br>Gemini: si crea gratis su <b>Google AI Studio</b>. Claude: su <b>platform.claude.com</b>, con credito caricato.<br><br>Resta <b>solo su questo dispositivo</b>: non va su GitHub, nella sincronizzazione né nel backup. Su un altro dispositivo va incollata di nuovo. “Prova la connessione” controlla che funzioni.` },
  model: { t: 'Modello', b: `Quale modello di AI usare. Se non sai, lascia quello proposto.<br><br>I modelli “flash” sono veloci e hanno più richieste gratuite; quelli “pro” ragionano meglio ma con la chiave gratuita possono avere poche richieste o nessuna.` },
  backupModels: { t: 'Modelli di riserva', b: `Con la chiave gratuita ogni modello ha un suo numero di richieste al giorno. Quando il modello principale le finisce, l’app passa da sola al primo modello di riserva, fino all’azzeramento del giorno dopo (verso le 8 o le 9 del mattino).<br><br>Puoi scriverne più d’uno, separati da virgola. Lascia vuoto per non usarne.` },
  prompts: { t: 'Prompt per l’AI', b: `Sono le istruzioni che l’app dà all’AI per ogni lavoro: formattare, creare flashcard, valutare l’orale…<br><br>Puoi riscriverle a tuo gusto (per esempio “usa più tabelle” o “domande da esame orale”). “Ripristina” torna al testo di partenza.` },
  sync: { t: 'Sincronizzazione con Google Drive', b: `Tiene uguali i dati su telefono e computer, salvandoli in una cartella del tuo Google Drive tramite il tuo script di Apps Script.<br><br>Su ogni dispositivo servono lo stesso <b>indirizzo dell’app web</b> (finisce con /exec) e la stessa <b>frase segreta</b>.<br><br>Le chiavi dell’AI non vengono sincronizzate. Se usi un solo dispositivo, basta il backup.` },
  cardsSet: { t: 'Flashcard', b: `<b>Nuove al giorno</b>: quante flashcard mai viste ti propone ogni giorno per ogni notebook, così il ripasso non esplode.<br><br>La <b>nota del “Di nuovo”</b> ti chiede perché hai sbagliato: ti aiuta a riconoscere gli errori che ripeti.` },
  images: { t: 'Immagini', b: `Quante immagini hai salvato e quanto spazio occupano.<br><br>“Elimina le immagini non usate” toglie quelle che non compaiono più in nessuna sezione o flashcard.` },
  studyhub: { t: 'StudyHub', b: `Il collegamento con il tuo planner. Quando segni una sezione come studiata, StudyHub la riceve e ne pianifica i ripassi; i voti dati qui gli arrivano.<br><br>Dal menu puoi aprire StudyHub <b>qui accanto</b> (in basso sul telefono). Lascia vuoto l’indirizzo per usare quello di sempre.` },
  importSet: { t: 'Importazione', b: `Il numero di pagine per sezione proposto quando importi un PDF “ogni tot pagine”. Lo puoi sempre cambiare al momento.` },
  look: { t: 'Lettura e aspetto', b: `Tema chiaro o scuro, carattere, dimensione e interlinea degli appunti.<br><br>Il <b>filtro luce blu</b> rende i colori più caldi la sera. La <b>voce per l’ascolto</b> legge le sezioni ad alta voce.` },
  tts: { t: 'Voce per l’ascolto', b: `<b>Voce del telefono</b>: gratuita, funziona anche senza internet.<br><b>Voce di Google</b>: più naturale, usa la chiave di Gemini e ha un suo limite giornaliero.<br><br>“Prova la voce” ti fa sentire come suona.` },
  backup: { t: 'Backup', b: `Un unico file con tutti i tuoi dati: notebook, sezioni, flashcard, immagini, PDF, glossario, note e casi clinici.<br><br>Conservalo su Drive o mandatelo per email, una volta a settimana o prima di cambiare telefono. “Importa un backup” riporta tutto com’era.<br><br>Le chiavi dell’AI e la frase segreta restano fuori.` },
  install: { t: 'App sul telefono', b: `Installata, si apre dall’icona come una vera app, a schermo intero, e il browser difficilmente ne cancella i dati.<br><br><b>Android:</b> tasto Installa qui, oppure in Chrome menu ⋮ → Installa app.<br><b>iPhone:</b> in Safari, Condividi → Aggiungi alla schermata Home.` },
  // Importa
  importSrc: { t: 'Cosa importare', b: `<b>Testo</b>: incolli appunti, capitoli o testo da NotebookLM; se è lungo viene diviso in più sezioni.<br><b>PDF</b>: libri, dispense, slide.<br><b>XMind</b>: ogni foglio della mappa diventa una sezione con elenchi annidati.` },
  importGroup: { t: 'Macro-argomento', b: `Dove finiscono le sezioni create. Lascia vuoto per metterle nel notebook senza un macro-argomento.<br><br>Con “Per argomenti” l’app può anche creare da sola macro-argomenti e sottoargomenti dai titoli del PDF.` },
  split: { t: 'Come dividere il PDF', b: `<b>Ogni tot pagine</b>: blocchi uguali, per esempio 5 pagine per sezione.<br><b>Intervalli scelti</b>: scrivi una riga per sezione, come “13-30 Il cuore”, oppure usa i capitoli del PDF se ci sono.<br><b>Per argomenti</b>: l’app legge i titoli (più grandi, numerati come 3.1 o in maiuscolo) e crea una sezione per argomento, pulendo il testo. Serve un PDF con il testo selezionabile, anche con l’OCR fatto da te.` },
  pdfMode: { t: 'Testo o lettura dell’AI', b: `<b>Estrai il testo</b>: gratis, veloce, senza limiti. Serve un PDF con il testo selezionabile.<br><br><b>Fai leggere le pagine all’AI</b>: funziona anche con scansioni, schemi e tabelle, ma ogni richiesta è più pesante e con Gemini gratuito i limiti scattano prima.` },
  aiOpts: { t: 'Elaborazione', b: `<b>Formatta con l’AI</b>: riordina il testo in titoli, elenchi puntati e tabelle.<br><b>Cloze</b>: segna i termini chiave da nascondere nella scheda Cloze.<br><b>Domande</b>: prepara le domande per il richiamo nella scheda Domande.<br><br>Senza AI il testo viene salvato con una formattazione di base.` },
  keepImgs: { t: 'Immagini del PDF', b: `Ritaglia le figure delle pagine importate e le mette in fondo a ogni sezione. Poi puoi usarle per l’image occlusion o le etichette.` },
  // Sezione
  modes: { t: 'Le schede della sezione', b: `<b>Cloze</b>: i termini chiave sono nascosti, toccali per scoprirli.<br><b>Leggi</b>: gli appunti; selezionando il testo evidenzi o crei cloze e flashcard.<br><b>Mappe</b>: gli appunti come mappa concettuale.<br><b>Pagina bianca</b>: scrivi tutto quello che ricordi, poi confronti.<br><b>Orale</b>: ripeti a voce come all’esame, poi confronti.<br><b>Domande</b>, <b>Flashcard</b>, <b>Video</b>, <b>Modifica</b>.<br><br>Nei casi clinici c’è anche <b>Risolvi</b>: il caso si scopre una parte alla volta.<br><br>Quando confronti, segna col semaforo: tocca il pallino accanto ai titoli o il margine sinistro.` },
  // Pagine
  notebooks: { t: 'I tuoi notebook', b: `Un notebook per ogni materia. Toccane uno per vedere macro-argomenti e sezioni; da qui ne crei di nuovi.` },
  notebook: { t: 'Il notebook', b: `Le sezioni divise in <b>macro-argomenti</b> e <b>sottoargomenti</b>. Il menu “⋯” di un gruppo serve per aggiungere sezioni, crearne di nuove, importare lì o fare una simulazione d’esame.<br><br>Accanto a ogni sezione vedi a che punto sono i ripassi.` },
  review: { t: 'Ripasso', b: `Le sezioni da ripassare oggi nel Notebook (quelle mandate a StudyHub le pianifica StudyHub).<br><br>Dopo ogni prova valuta con Di nuovo, Difficile, Bene o Facile: l’app decide quando riproportela.` },
  cardsPage: { t: 'Flashcard', b: `Le flashcard da ripassare di tutti i notebook. Gira la carta, poi valuta quanto la sapevi.<br><br>Le crei selezionando il testo in Leggi, con l’AI o a mano.` },
  pdfs: { t: 'PDF', b: `La tua libreria di PDF, collegati ai notebook o alle singole sezioni. Nel lettore puoi evidenziare, scrivere a mano, mettere segnalibri e trascinare parti negli appunti.` },
  importPage: { t: 'Importa', b: `Da qui crei le sezioni a partire da testo, PDF o mappe XMind. Scegli prima il notebook e, se vuoi, il macro-argomento.` },
  clinic: { t: 'Note cliniche', b: `I quadri clinici di tutte le materie, cercabili per sintomo: tocca più sintomi per restringere.<br><br>Ogni nota ha fonti e può essere segnata come incompleta. Puoi crearla anche selezionando del testo in Leggi.` },
  cases: { t: 'Casi clinici', b: `I casi visti a lezione, in tirocinio o sui libri. Ognuno è una sezione con i dati del caso, foto e PDF allegati e la modalità <b>Risolvi</b>.<br><br>Cerca per sintomi, esami o diagnosi e filtra per specialità, materia o contesto. Niente dati che rendano riconoscibile il paziente.` },
  incomplete: { t: 'Da completare', b: `Tutto quello che hai segnato come incompleto, dal più vecchio: sezioni, casi e note cliniche, con la nota su cosa manca.<br><br>“Completa” toglie la segnalazione.` },
  glossary: { t: 'Glossario', b: `I termini di tutte le materie con la loro definizione. Puoi aggiungerli da qui o selezionando una parola mentre leggi.` },
  calendar: { t: 'Calendario', b: `I ripassi in programma giorno per giorno, il tempo di studio e i punti deboli, cioè le parti che nel Cloze o nell’Orale sono rimaste più volte rosse o arancio.` },
  search: { t: 'Cerca', b: `Cerca in tutto: appunti, flashcard, testo dei PDF, glossario e note cliniche.` },
  links: { t: 'Link utili', b: `I siti che usi di più, a portata di tocco. Tieni premuto o usa Modifica per cambiarli.` },
  exam: { t: 'Simulazione d’esame', b: `Domande, cloze e flashcard pescati a caso dagli argomenti scelti, come in un esame. Alla fine vedi il risultato e cosa ripassare.` },
  lab: { t: 'Medicina di laboratorio', b: `Una scheda per ogni esame: campione e preparazione, range (anche diversi per uomini e donne), valori critici, cause di aumento e diminuzione, interferenze, andamento nel tempo, uso diagnostico con sensibilità e specificità (LR+ e LR− li calcola l’app), note, collegamenti alle note cliniche e fonti.<br><br>L’<b>elenco di base</b> crea le schede di oltre 110 esami con nome, sigla, campione e unità: i range li aggiungi tu, perché cambiano da laboratorio a laboratorio.<br><br>Con una chiave AI, “Compila con l’AI” riempie i campi vuoti e segna l’esame come incompleto, da verificare.` },
  labRef: { t: 'Leggi un referto', b: `Scrivi esame e valore (anche la sigla): l’app usa i range delle tue schede e segna in giallo i valori bassi o alti e in rosso quelli critici. Indica il sesso per i range diversi.<br><br>È un esercizio di lettura: in un referto vero vale sempre il range stampato dal laboratorio.` },
  labCalc: { t: 'Calcoli di laboratorio', b: `Gap anionico (anche corretto per l’albumina), calcio corretto, eGFR con la CKD-EPI 2021, LDL di Friedewald, osmolalità calcolata e gap osmolare, sodio corretto per la glicemia. Sotto ogni calcolo c’è la formula.<br><br>Le unità sono quelle convenzionali (mg/dL, mEq/L) dei referti italiani.` },
  labQuiz: { t: 'Allenati', b: `Domande pescate a caso dalle tue schede: range, cause di aumento e diminuzione, quale esame chiedere per una malattia, campione e preparazione. Più schede completi, più domande ci sono.` },
  labEdit: { t: 'Scheda dell’esame', b: `Compila quello che ti serve: i campi vuoti non compaiono nella scheda.<br><br><b>Range</b>: una riga per popolazione (adulti, uomini, donne, bambini); con solo il massimo scrivi “< max”, con solo il minimo “> min”.<br><b>Uso diagnostico</b>: una riga per malattia e soglia, con sensibilità e specificità in percentuale.<br><b>Fattore SI</b>: il numero per cui moltiplicare per passare all’unità SI (per esempio 88,4 per la creatinina da mg/dL a µmol/L).` },
  settings: { t: 'Impostazioni', b: `Ogni gruppo ha il suo tasto ? con la spiegazione. Quelle che cambi qui valgono su questo dispositivo; prompt e preferenze di lettura si sincronizzano.` }
};
function helpBtn(key) {
  const h = HELP[key];
  return h ? `<button type="button" class="help-btn" data-help="${key}" aria-label="Aiuto: ${esc(h.t)}" title="Cos’è?">?</button>` : '';
}
function showHelp(key) {
  const h = HELP[key];
  if (!h) return;
  const sh = openSheet(`
    <h2>${esc(h.t)}</h2>
    <div class="help-body">${h.b}</div>
    <div class="modal-actions"><button class="btn primary" type="button" data-help-close>Ho capito</button></div>`, { label: h.t });
  $('[data-help-close]', sh.el).onclick = () => sh.close();
}
// Dove compaiono i “?”: cerco i titoli e le etichette già presenti nella pagina
const HELP_SPOTS = [
  { sel: '.page-head h1', text: 'I tuoi notebook', key: 'notebooks' },
  { sel: '.page-head h1', hash: /^#\/nb\//, key: 'notebook' },
  { sel: '.page-head h1', text: 'Ripasso', key: 'review' },
  { sel: '.page-head h1', text: 'Flashcard', key: 'cardsPage' },
  { sel: '.page-head h1', text: 'PDF', key: 'pdfs' },
  { sel: '.page-head h1', text: 'Importa', key: 'importPage' },
  { sel: '.page-head h1', text: 'Note cliniche', key: 'clinic' },
  { sel: '.page-head h1', text: 'Casi clinici', key: 'cases' },
  { sel: '.page-head h1', text: 'Da completare', key: 'incomplete' },
  { sel: '.page-head h1', text: 'Glossario', key: 'glossary' },
  { sel: '.page-head h1', text: 'Calendario', key: 'calendar' },
  { sel: '.page-head h1', text: 'Cerca', key: 'search' },
  { sel: '.page-head h1', text: 'Link utili', key: 'links' },
  { sel: '.page-head h1', text: 'Simulazione d’esame', key: 'exam' },
  { sel: '.page-head h1', text: 'Impostazioni', key: 'settings' },
  { sel: '.page-head h1', text: 'Medicina di laboratorio', key: 'lab' },
  { sel: '.page-head h1', text: 'Leggi un referto', key: 'labRef' },
  { sel: '.page-head h1', text: 'Calcoli di laboratorio', key: 'labCalc' },
  { sel: '.page-head h1', text: 'Allenati', key: 'labQuiz', hash: /^#\/lab/ },
  { sel: '.page-head h1', text: 'Nuovo esame', key: 'labEdit' },
  { sel: '.page-head h1', text: 'Modifica esame', key: 'labEdit' },
  { sel: 'h2', text: 'Intelligenza artificiale', key: 'ai', hash: /^#\/settings/ },
  { sel: 'h2', text: 'Prompt per l’AI', key: 'prompts', hash: /^#\/settings/ },
  { sel: 'h2', text: 'Sincronizzazione con Google Drive', key: 'sync', hash: /^#\/settings/ },
  { sel: 'h2', text: 'Flashcard', key: 'cardsSet', hash: /^#\/settings/ },
  { sel: 'h2', text: 'Immagini', key: 'images', hash: /^#\/settings/ },
  { sel: 'h2', text: 'StudyHub', key: 'studyhub', hash: /^#\/settings/ },
  { sel: 'h2', text: 'Importazione', key: 'importSet', hash: /^#\/settings/ },
  { sel: 'h2', text: 'Lettura e aspetto', key: 'look', hash: /^#\/settings/ },
  { sel: 'h2', text: 'Backup', key: 'backup', hash: /^#\/settings/ },
  { sel: 'h2', text: 'App sul telefono', key: 'install', hash: /^#\/settings/ },
  { sel: '.provider label.lbl', text: 'Chiave API', key: 'apikey' },
  { sel: '.provider .field > span', text: 'Modello', key: 'model' },
  { sel: '.field > span', text: 'Modelli di riserva', key: 'backupModels' },
  { sel: '.field > span.lbl', text: 'Voce per l’ascolto', key: 'tts' },
  { sel: '#imGroupBox > label.lbl', text: 'Macro-argomento', key: 'importGroup' },
  { sel: '.opts > legend', text: 'Elaborazione', key: 'aiOpts' },
  { after: '.seg[aria-label="Tipo di fonte"]', key: 'importSrc' },
  { after: '.split-seg', key: 'split' },
  { after: '#pdfModeBox', key: 'pdfMode', inside: true },
  { after: '#optImgs', key: 'keepImgs', label: true },
  { after: '.sec-extra', key: 'modes', inside: true }
];
function decorateHelp(root = $('#view')) {
  if (!root) return;
  const h = location.hash || '#/notebooks';
  for (const sp of HELP_SPOTS) {
    if (sp.hash && !sp.hash.test(h)) continue;
    if (sp.sel) {
      $$(sp.sel, root).forEach(el => {
        if (el.querySelector('.help-btn')) return;
        const txt = el.textContent.replace(/\s+/g, ' ').trim();
        if (sp.text && !txt.startsWith(sp.text)) return;
        el.insertAdjacentHTML('beforeend', helpBtn(sp.key));
      });
    } else {
      $$(sp.after, root).forEach(el => {
        if (sp.label) {
          const lab = el.closest('label');
          const span = lab && $('span', lab);
          if (span && !span.querySelector('.help-btn')) span.insertAdjacentHTML('beforeend', helpBtn(sp.key));
          return;
        }
        if (sp.inside) { if (!$(`:scope > .help-btn[data-help="${sp.key}"]`, el)) el.insertAdjacentHTML('beforeend', helpBtn(sp.key)); return; }
        const nx = el.nextElementSibling;
        if (nx && nx.matches(`.help-btn[data-help="${sp.key}"]`)) return;
        el.insertAdjacentHTML('afterend', helpBtn(sp.key));
      });
    }
  }
}
function initHelp() {
  // in cattura: il “?” dentro un’etichetta o una riga non spunta caselle e non apre la pagina
  document.addEventListener('click', e => {
    const b = e.target.closest('.help-btn[data-help]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    showHelp(b.dataset.help);
  }, true);
  const view = $('#view');
  if (view) {
    let raf = 0;
    new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; decorateHelp(view); }); }).observe(view, { childList: true, subtree: true });
    decorateHelp(view);
  }
  try {
    if (!localStorage.getItem(TUT_KEY)) setTimeout(() => { if (!$('#modalRoot').children.length) openTutorial(); }, 700);
  } catch { /* niente */ }
}

/* =====================================================================
   v3.28: casi clinici, fonti in fondo, segnalazione “incompleta”
   ===================================================================== */

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

/* ---------- Pagina “Da completare” ---------- */
function viewIncomplete() {
  const cnb = casesNb();
  const secs = state.sections.filter(s => s.incomplete);
  const cases = secs.filter(s => cnb && s.notebookId === cnb.id);
  const others = secs.filter(s => !cnb || s.notebookId !== cnb.id);
  const notes = clinicalNotes().filter(n => n.incomplete);
  const labs = labExams().filter(x => x.incomplete);
  const total = secs.length + notes.length + labs.length;
  const byNb = new Map();
  others.forEach(s => { const k = s.notebookId; if (!byNb.has(k)) byNb.set(k, []); byNb.get(k).push(s); });
  const since = r => r.incomplete?.since || '9999';
  const item = (title, href, rec, kind, id) => `
    <li class="inc-item">
      <a class="row" href="${href}" ${kind === 'note' ? `data-inc-note="${id}"` : ''}>
        <span class="row-main">
          <span class="row-title">${esc(title)}</span>
          <span class="row-sub">${incompleteNote(rec) ? esc(incompleteNote(rec)) : 'Senza nota'} · dal ${esc(fmtDay(rec.incomplete.since))}</span>
        </span>
      </a>
      <button class="btn sm ghost" type="button" data-inc-done="${kind}:${id}">Completa</button>
    </li>`;
  setView(`
    <header class="page-head">
      <div><h1>Da completare</h1><p class="lede">${total ? `${total} ${total === 1 ? 'elemento segnato come incompleto' : 'elementi segnati come incompleti'}, dal più vecchio.` : 'Niente da completare.'}</p></div>
    </header>
    ${total ? '' : '<div class="empty"><p>Quando una sezione, un caso o una nota clinica non è finita (per esempio hai letto solo una delle fonti), toccale “Segna incompleta” in fondo: la ritrovi qui.</p></div>'}
    ${cases.length ? `<h2 class="sub">Casi clinici</h2><ul class="list">${cases.sort((a, b) => since(a).localeCompare(since(b))).map(s => item(s.title, `#/sec/${s.id}/read`, s, 'sec', s.id)).join('')}</ul>` : ''}
    ${[...byNb.entries()].map(([nbId, list]) => `
      <h2 class="sub">${esc(nbById(nbId)?.name || 'Notebook')}</h2>
      <ul class="list">${list.sort((a, b) => since(a).localeCompare(since(b))).map(s => item(s.title, `#/sec/${s.id}/read`, s, 'sec', s.id)).join('')}</ul>`).join('')}
    ${notes.length ? `<h2 class="sub">Note cliniche</h2><ul class="list">${notes.sort((a, b) => since(a).localeCompare(since(b))).map(n => item(n.title, '#/clinic', n, 'note', n.id)).join('')}</ul>` : ''}
    ${labs.length ? `<h2 class="sub">Medicina di laboratorio</h2><ul class="list">${labs.sort((a, b) => since(a).localeCompare(since(b))).map(x => item(x.name, `#/lab/${x.id}`, x, 'lab', x.id)).join('')}</ul>` : ''}
  `);
  on('[data-inc-note]', 'click', e => { e.preventDefault(); showClinicNote(e.currentTarget.dataset.incNote); });
  on('[data-inc-done]', 'click', async e => {
    const [kind, id] = e.currentTarget.dataset.incDone.split(':');
    if (kind === 'sec') { const s = secById(id); if (s) { delete s.incomplete; await saveSection(s); } }
    else { const n = state.links.find(l => l.id === id); if (n) { delete n.incomplete; await saveLink(n); } }
    toast(kind === 'lab' ? 'Segnato come completo' : 'Segnata come completa');
    route();
  });
}

/* ---------- Casi clinici ----------
   Ogni caso è una sezione del notebook “Casi clinici”: ha quindi tutto quello
   delle sezioni (Leggi, Cloze, Orale, Domande, flashcard, PDF, video, etichette)
   più i dati del caso, gli allegati e la modalità Risolvi. */
const CASE_PARTS = ['Presentazione', 'Anamnesi', 'Esame obiettivo', 'Esami di laboratorio', 'Esami strumentali', 'Diagnosi differenziale', 'Diagnosi', 'Terapia e decorso', 'Punti chiave'];
const CASE_CTX = { lezione: 'Lezione', tirocinio: 'Tirocinio', libro: 'Libro o sito', altro: 'Altro' };
const casesNb = () => state.notebooks.find(n => n.kind === 'cases');
async function ensureCasesNb() {
  let nb = casesNb();
  if (!nb) {
    nb = { id: uid(), name: 'Casi clinici', kind: 'cases', created: Date.now() };
    await saveNotebook(nb);
  }
  return nb;
}
const isCase = sec => !!sec && !!casesNb() && sec.notebookId === casesNb().id;
const caseOf = sec => (sec.case && typeof sec.case === 'object' ? sec.case : (sec.case = {}));
let casesQuery = '';
const casesFilter = new Set();
function caseMetaBits(sec, { short = false } = {}) {
  const c = caseOf(sec);
  const bits = [];
  if (c.date) bits.push(fmtDay(c.date));
  if (c.ctx) bits.push(`${CASE_CTX[c.ctx] || c.ctx}${c.who ? ` (${c.who})` : ''}`);
  else if (c.who) bits.push(c.who);
  if (c.spec) bits.push(c.spec);
  if (!short && c.nbId && nbById(c.nbId)) bits.push(nbById(c.nbId).name);
  return bits;
}
function caseSheet(sec = null) {
  return new Promise(resolve => {
    const c = sec ? caseOf(sec) : { date: todayStr(), ctx: 'lezione' };
    const cnb = casesNb();
    const specs = [...new Set((cnb ? secsOf(cnb.id) : []).map(s => s.case?.spec).filter(Boolean))].sort();
    const nbs = state.notebooks.filter(n => n.kind !== 'cases');
    const sh = openSheet(`
      <h2>${sec ? 'Dati del caso' : 'Nuovo caso clinico'}</h2>
      <p class="sheet-sub">Niente nomi, date di nascita o altri dati che rendano riconoscibile il paziente, nemmeno nelle foto.</p>
      <label class="field"><span>Titolo</span><input class="input" id="csTitle" value="${esc(sec?.title || '')}" placeholder="Es. Donna, 34 anni, febbre e artralgie"></label>
      <div class="grid2">
        <label class="field"><span>Data</span><input class="input" type="date" id="csDate" value="${esc(c.date || '')}"></label>
        <label class="field"><span>Dove l’hai visto</span><select class="input" id="csCtx">${Object.entries(CASE_CTX).map(([k, l]) => `<option value="${k}" ${c.ctx === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Docente, corso o reparto, facoltativo</span><input class="input" id="csWho" value="${esc(c.who || '')}" placeholder="Es. prof.ssa Rossi, Medicina interna"></label>
      <div class="grid2">
        <label class="field"><span>Specialità</span><input class="input" id="csSpec" value="${esc(c.spec || '')}" list="csSpecs" placeholder="Es. Cardiologia"><datalist id="csSpecs">${specs.map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
        <label class="field"><span>Materia</span><select class="input" id="csNb"><option value="">Nessuna in particolare</option>${nbs.map(n => `<option value="${n.id}" ${n.id === c.nbId ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></label>
      </div>
      ${sec ? '' : `<label class="check"><input type="checkbox" id="csTpl" checked><span>Prepara lo schema: ${CASE_PARTS.join(', ')}</span></label>`}
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-cs="no">Annulla</button>
        <button class="btn primary" type="button" data-cs="ok">${sec ? 'Salva' : 'Crea il caso'}</button>
      </div>`, { label: sec ? 'Dati del caso' : 'Nuovo caso clinico', onClose: v => resolve(v || null) });
    $('[data-cs="no"]', sh.el).onclick = () => sh.close(null);
    $('[data-cs="ok"]', sh.el).onclick = async () => {
      const title = $('#csTitle', sh.el).value.trim();
      if (!title) { toast('Scrivi un titolo per il caso'); $('#csTitle', sh.el).focus(); return; }
      const data = { date: $('#csDate', sh.el).value || '', ctx: $('#csCtx', sh.el).value, who: $('#csWho', sh.el).value.trim(), spec: $('#csSpec', sh.el).value.trim(), nbId: $('#csNb', sh.el).value || '' };
      let s = sec;
      if (!s) {
        const nb = await ensureCasesNb();
        const tpl = $('#csTpl', sh.el)?.checked;
        s = newSection(nb.id, { title, md: tpl ? CASE_PARTS.map(p => `## ${p}\n\n`).join('') : '' });
      } else s.title = title;
      s.case = { ...caseOf(s), ...data };
      await saveSection(s);
      sh.close(s);
    };
    setTimeout(() => $(sec ? '#csWho' : '#csTitle', sh.el)?.focus(), 40);
  });
}
async function newCaseFlow() {
  const s = await caseSheet();
  if (s) { toast('Caso creato: scrivilo o aggiungi foto e PDF'); go(`#/sec/${s.id}/edit`); }
}
function viewCases() {
  const cnb = casesNb();
  const all = cnb ? secsOf(cnb.id) : [];
  const facets = new Map();
  all.forEach(s => {
    const c = s.case || {};
    if (c.spec) facets.set(`spec:${c.spec}`, c.spec);
    if (c.nbId && nbById(c.nbId)) facets.set(`nb:${c.nbId}`, nbById(c.nbId).name);
    if (c.ctx) facets.set(`ctx:${c.ctx}`, CASE_CTX[c.ctx] || c.ctx);
  });
  [...casesFilter].forEach(k => { if (!facets.has(k)) casesFilter.delete(k); });
  setView(`
    <header class="page-head">
      <div><h1>Casi clinici</h1><p class="lede">${all.length ? `${all.length} ${all.length === 1 ? 'caso' : 'casi'}. ` : ''}Quelli visti a lezione, in tirocinio o sui libri, con foto e PDF allegati. In ogni caso trovi la modalità Risolvi.</p></div>
      <button class="btn primary" data-act="new-case">Nuovo caso</button>
    </header>
    ${all.length ? `
      <input type="search" class="input search" id="csQ" placeholder="Cerca nei casi: sintomi, diagnosi, esami…" aria-label="Cerca nei casi" value="${esc(casesQuery)}">
      ${facets.size ? `<div class="tag-cloud" aria-label="Filtra i casi">${[...facets.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k, l]) => `<button type="button" class="tag ${casesFilter.has(k) ? 'on' : ''}" data-cf="${esc(k)}" aria-pressed="${casesFilter.has(k)}">${esc(l)}</button>`).join('')}</div>` : ''}
      <ul class="list" id="csList"></ul>` : `
      <div class="empty"><p>Ancora nessun caso. Creane uno durante la lezione: scrivi la presentazione, scatta le foto delle slide o degli esami e allega il PDF.</p><button class="btn primary" data-act="new-case">Nuovo caso</button></div>`}
  `);
  on('[data-act="new-case"]', 'click', newCaseFlow);
  const draw = () => {
    const box = $('#csList');
    if (!box) return;
    const toks = foldAccents(casesQuery).split(/\s+/).filter(Boolean);
    const list = all.filter(s => {
      const c = s.case || {};
      for (const k of casesFilter) {
        const [t, v] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
        if ((t === 'spec' && c.spec !== v) || (t === 'nb' && c.nbId !== v) || (t === 'ctx' && c.ctx !== v)) return false;
      }
      if (!toks.length) return true;
      const hay = foldAccents(`${s.title} ${s.md} ${c.spec || ''} ${c.who || ''} ${tagsOf(s).join(' ')}`);
      return toks.every(t => hay.includes(t));
    }).sort((a, b) => String(b.case?.date || '').localeCompare(String(a.case?.date || '')) || b.created - a.created);
    box.innerHTML = list.length ? list.map(s => {
      const nImg = imageRefs(s.md).length, nPdf = pdfsOf(s.id).length;
      const extra = [nImg ? `${nImg} ${nImg === 1 ? 'foto' : 'foto'}` : '', nPdf ? `${nPdf} PDF` : '', s.incomplete ? '⚠ incompleto' : ''].filter(Boolean);
      return `
        <li><a class="row" href="#/sec/${s.id}/read">
          <span class="row-main">
            <span class="row-title">${esc(s.title)}</span>
            <span class="row-sub">${esc([...caseMetaBits(s), ...extra].join(' · ') || 'Senza dati')}</span>
          </span>
          ${statusPill(s)}
        </a></li>`;
    }).join('') : '<li class="hint">Nessun caso corrisponde.</li>';
  };
  draw();
  $('#csQ')?.addEventListener('input', e => { casesQuery = e.target.value; draw(); });
  on('[data-cf]', 'click', e => {
    const k = e.currentTarget.dataset.cf;
    if (casesFilter.has(k)) casesFilter.delete(k); else casesFilter.add(k);
    e.currentTarget.classList.toggle('on', casesFilter.has(k));
    e.currentTarget.setAttribute('aria-pressed', casesFilter.has(k));
    draw();
  });
}

// Foto dal telefono (anche scattate al momento) o dal PC, in fondo al caso sotto “Allegati”
function chooseImageFiles() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve([...(input.files || [])]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}
async function addPhotosTo(sec) {
  const files = await chooseImageFiles();
  if (!files.length) return false;
  const ids = [];
  for (const f of files) {
    try { ids.push((await saveImage(await compressImage(f), sec.notebookId)).id); }
    catch (err) { toast(`${f.name}: ${err.message}`, 'err'); }
  }
  if (!ids.length) return false;
  const block = ids.map(id => imageMd(id, 'Foto')).join('\n\n');
  let md = String(sec.md || '').replace(/\s+$/, '');
  if (/^##\s+Allegati\s*$/m.test(md)) {
    // dopo l’ultimo contenuto della parte “Allegati”, prima di un eventuale titolo successivo
    const lines = md.split('\n');
    const at = lines.findIndex(l => /^##\s+Allegati\s*$/.test(l));
    let end = lines.length;
    for (let i = at + 1; i < lines.length; i++) if (/^#{1,2}\s/.test(lines[i])) { end = i; break; }
    lines.splice(end, 0, '', block, '');
    md = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  } else md = `${md}${md ? '\n\n' : ''}## Allegati\n\n${block}`;
  sec.md = md + '\n';
  await saveSection(sec);
  toast(ids.length === 1 ? 'Foto aggiunta' : `${ids.length} foto aggiunte`);
  return true;
}
async function addPdfTo(sec) {
  const f = await choosePdfFile();
  if (!f) return false;
  try {
    await storePdfFile(f, sec);
    toast('PDF allegato al caso');
    return true;
  } catch (err) { toast(err.message || 'Non riesco ad allegare il PDF', 'err'); return false; }
}

// Modalità Risolvi: il caso si scopre una parte alla volta; prima della diagnosi scrivi la tua ipotesi
function caseParts(md) {
  const lines = String(md || '').split('\n');
  const parts = [];
  let cur = { title: '', lines: [] };
  for (const l of lines) {
    const m = l.match(/^##\s+(.+?)\s*$/);
    if (m) { parts.push(cur); cur = { title: m[1], lines: [] }; } else cur.lines.push(l);
  }
  parts.push(cur);
  return parts.map(p => ({ title: p.title, md: p.lines.join('\n').trim() })).filter(p => p.md);
}
function modeCase(sec, body) {
  const parts = caseParts(sec.md).filter(p => !/^allegati$/i.test(p.title));
  if (!parts.length) {
    body.innerHTML = `<div class="empty"><p>Il caso è ancora vuoto: scrivilo in Modifica, una parte per titolo (Anamnesi, Esame obiettivo, Diagnosi…).</p><a class="btn primary" href="#/sec/${sec.id}/edit">Scrivi il caso</a></div>`;
    return;
  }
  const isDx = t => /diagnosi|conclusion/i.test(t) && !/differenzial/i.test(t);
  const isDdx = t => /differenzial/i.test(t);
  let shown = 1;
  let guess = '';
  let ddxGuess = '';
  const allegati = caseParts(sec.md).find(p => /^allegati$/i.test(p.title));
  const draw = () => {
    const next = parts[shown];
    const needDdx = next && isDdx(next.title) && !ddxGuess;
    const needDx = next && isDx(next.title) && !guess;
    body.innerHTML = `
      <p class="hint">Leggi una parte alla volta e ragiona prima di andare avanti. Prima della diagnosi ti chiedo la tua ipotesi.</p>
      <article class="notes case-run">${parts.slice(0, shown).map((p, i) => `
        <section class="case-part">${p.title ? `<h2>${esc(p.title)}</h2>` : ''}${renderMd(p.md)}
          ${isDdx(p.title) && ddxGuess && ddxGuess !== '—' ? `<p class="case-guess">La tua diagnosi differenziale: ${esc(ddxGuess)}</p>` : ''}
          ${isDx(p.title) && guess && guess !== '—' ? `<p class="case-guess">La tua ipotesi: ${esc(guess)}</p>` : ''}
        </section>`).join('')}</article>
      ${allegati && shown === 1 ? '<p class="hint">Le foto e i file del caso sono in fondo, in Leggi: qui li tengo nascosti per non anticipare la soluzione.</p>' : ''}
      ${next ? `
        <div class="case-next">
          ${needDdx || needDx ? `
            <label class="field"><span>${needDdx ? 'Prima di guardare: quali diagnosi metteresti in differenziale?' : 'Prima di guardare: qual è la tua diagnosi?'}</span>
              <textarea class="input" id="caseGuess" rows="2" placeholder="${needDdx ? 'Es. pericardite, IMA, dissecazione aortica' : 'Es. endocardite infettiva'}"></textarea></label>
            <div class="inline"><button class="btn primary" type="button" data-case="guess">Confronta con “${esc(next.title)}”</button><button class="btn ghost" type="button" data-case="skip">Salta e mostra</button></div>`
            : `<button class="btn primary" type="button" data-case="next">Mostra: ${esc(next.title || 'il resto')}</button>`}
          <span class="hint case-left">${parts.length - shown} ${parts.length - shown === 1 ? 'parte da scoprire' : 'parti da scoprire'}</span>
        </div>` : '<div id="gradeSlot"></div>'}`;
    hydrateImages(body);
    const notesEl = $('.notes', body);
    if (notesEl) prepareImages(notesEl, sec);
    if (!next) gradeBar(sec, $('#gradeSlot', body), { mode: 'case' });
  };
  body.addEventListener('click', e => {
    const b = e.target.closest('[data-case]');
    if (!b) return;
    const next = parts[shown];
    if (b.dataset.case === 'guess') {
      const v = $('#caseGuess', body)?.value.trim() || '';
      if (!v) { toast('Scrivi la tua ipotesi, oppure tocca Salta'); return; }
      if (isDdx(next.title)) ddxGuess = v; else guess = v;
    } else if (b.dataset.case === 'skip') {
      if (isDdx(next.title)) ddxGuess = '—'; else guess = '—';
    }
    shown = Math.min(parts.length, shown + 1);
    draw();
    $$('.case-part', body).pop()?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  draw();
}

/* =====================================================================
   v3.26: video nelle sezioni ed esercizio “rimetti le etichette” sugli schemi
   ===================================================================== */

/* ---------- Video: link a YouTube, Vimeo, Google Drive o file video ---------- */
function parseVideoTime(v) {
  if (!v) return 0;
  const t = String(v).trim();
  if (/^\d+$/.test(t)) return +t;
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  const c = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (c) return (+c[1] || 0) * 3600 + (+c[2]) * 60 + (+c[3]);
  return 0;
}
const fmtVideoTime = s => {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
function videoInfo(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const start = parseVideoTime(u.searchParams.get('t') || u.searchParams.get('start') || (u.hash.match(/t=([^&]+)/) || [])[1]);
  let m;
  if (host === 'youtu.be' && (m = u.pathname.match(/^\/([\w-]{6,})/))) return { kind: 'youtube', id: m[1], start, url: u.href };
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    const id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/) || [])[1];
    if (id) return { kind: 'youtube', id, start, url: u.href };
  }
  if (/(^|\.)vimeo\.com$/.test(host) && (m = u.pathname.match(/\/(?:video\/)?(\d{5,})(?:\/([0-9a-f]{6,}))?/))) {
    return { kind: 'vimeo', id: m[1], hash: m[2] || u.searchParams.get('h') || '', start, url: u.href };
  }
  if (host === 'drive.google.com' && (m = u.pathname.match(/\/file\/d\/([\w-]+)/))) return { kind: 'drive', id: m[1], start, url: u.href };
  if (/\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(u.pathname)) return { kind: 'file', start, url: u.href };
  return { kind: 'link', start: 0, url: u.href };
}
function videoEmbedSrc(v, at = null) {
  const info = videoInfo(v.url);
  if (!info) return '';
  const s = at !== null ? at : (v.start || info.start || 0);
  if (info.kind === 'youtube') return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(info.id)}?rel=0&playsinline=1&enablejsapi=1&autoplay=1${s ? `&start=${Math.floor(s)}` : ''}`;
  if (info.kind === 'vimeo') return `https://player.vimeo.com/video/${info.id}?autoplay=1${info.hash ? `&h=${info.hash}` : ''}${s ? `#t=${Math.floor(s)}s` : ''}`;
  if (info.kind === 'drive') return `https://drive.google.com/file/d/${encodeURIComponent(info.id)}/preview`;
  return '';
}
const videoKindName = k => ({ youtube: 'YouTube', vimeo: 'Vimeo', drive: 'Google Drive', file: 'Video', link: 'Link' }[k] || 'Video');
// minuti scritti nelle note (“12:30 valvole”) diventano salti nel video
function videoNoteHtml(note) {
  const re = /(^|[\s(])((?:\d{1,2}:)?\d{1,2}:\d{2})(?=[\s).,;:!?]|$)/g;
  return esc(note || '').replace(re, (all, pre, t) => `${pre}<button type="button" class="vid-ts" data-ts="${parseVideoTime(t)}">${t}</button>`).replace(/\n/g, '<br>');
}
async function videoTitleGuess(url) {
  const info = videoInfo(url);
  if (!info) return '';
  const api = info.kind === 'youtube' ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(info.url)}`
    : info.kind === 'vimeo' ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(info.url)}` : '';
  if (!api) return '';
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch(api, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return '';
    const d = await res.json();
    return String(d.title || '').trim().slice(0, 140);
  } catch { return ''; }
}
const videosOf = sec => (Array.isArray(sec.videos) ? sec.videos : (sec.videos = []));

function modeVideo(sec, body) {
  const list = videosOf(sec);
  const card = (v, i) => {
    const info = videoInfo(v.url) || { kind: 'link' };
    const embed = videoEmbedSrc(v) || info.kind === 'file';
    const thumb = info.kind === 'youtube' ? `<img class="vid-thumb" src="https://i.ytimg.com/vi/${encodeURIComponent(info.id)}/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
    return `
      <li class="vid" data-v="${esc(v.id)}">
        ${embed ? `<div class="vid-frame">
          <button type="button" class="vid-play" data-play aria-label="Guarda ${esc(v.title || 'il video')}">${thumb}<span class="vid-play-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></span></button>
        </div>` : ''}
        <div class="vid-meta">
          <div class="vid-top">
            <input class="input vid-title" value="${esc(v.title || '')}" placeholder="Titolo del video" aria-label="Titolo del video" data-f="title">
            <span class="vid-kind">${videoKindName(info.kind)}${v.start ? ` · da ${fmtVideoTime(v.start)}` : ''}</span>
          </div>
          <div class="vid-note-view" ${v.note ? '' : 'hidden'}>${videoNoteHtml(v.note)}</div>
          <textarea class="input vid-note" rows="2" placeholder="Note: cosa ricordare, minuti importanti (per esempio 12:30 valvole)" aria-label="Note sul video" data-f="note">${esc(v.note || '')}</textarea>
          <div class="vid-acts">
            <a class="btn sm ghost" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">Apri ↗</a>
            <button class="btn sm ghost" type="button" data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="Sposta su">↑</button>
            <button class="btn sm ghost" type="button" data-mv="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Sposta giù">↓</button>
            <button class="btn sm ghost danger" type="button" data-del>Elimina</button>
          </div>
        </div>
      </li>`;
  };
  const draw = () => {
    body.innerHTML = `
      <form class="vid-add" id="vidAdd">
        <label class="field"><span>Aggiungi un video</span>
          <div class="inline">
            <input class="input" type="url" id="vidUrl" placeholder="Incolla il link (YouTube, Vimeo, Google Drive…)" autocomplete="off" spellcheck="false" required>
            <button class="btn primary" type="submit">Aggiungi</button>
          </div></label>
      </form>
      ${list.length ? `<ul class="vid-list">${list.map(card).join('')}</ul>`
        : '<div class="empty"><p>Nessun video in questa sezione. Incolla il link di una lezione o di una spiegazione che ti è servita: lo guardi qui, con le tue note e i minuti importanti.</p></div>'}
      <p class="hint">YouTube, Vimeo e Google Drive si guardano qui; gli altri link si aprono a parte. Nelle note, i minuti scritti come 12:30 diventano pulsanti per saltare a quel punto.</p>`;
  };
  draw();
  const countTab = () => { const t = $('.tabs .tab.on'); if (t) t.textContent = list.length ? `Video (${list.length})` : 'Video'; };
  let saveT = 0;
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => saveSection(sec), 600); };
  addCleanup(() => { if (saveT) { clearTimeout(saveT); saveSection(sec); } });
  const vOf = el => list.find(x => x.id === el.closest('[data-v]')?.dataset.v);
  body.addEventListener('submit', async e => {
    if (e.target.id !== 'vidAdd') return;
    e.preventDefault();
    const inp = $('#vidUrl', body);
    const url = inp.value.trim();
    const info = videoInfo(url);
    if (!info) { toast('Questo non sembra un link valido: deve iniziare con https://', 'err'); return; }
    if (list.some(x => x.url === info.url)) { toast('Questo video c’è già'); return; }
    const v = { id: uid(), url: info.url, title: '', note: '', start: info.start || 0, added: Date.now() };
    list.push(v);
    await saveSection(sec);
    draw();
    countTab();
    toast('Video aggiunto');
    const title = await videoTitleGuess(info.url);
    if (title && !v.title) {
      v.title = title;
      await saveSection(sec);
      const f = $(`[data-v="${v.id}"] .vid-title`, body);
      if (f && !f.value) f.value = title;
    }
  });
  body.addEventListener('input', e => {
    const f = e.target.dataset.f;
    const v = f && vOf(e.target);
    if (!v) return;
    v[f] = e.target.value;
    if (f === 'note') {
      const view = $('.vid-note-view', e.target.closest('.vid'));
      view.innerHTML = videoNoteHtml(v.note);
      view.hidden = !v.note.trim();
    }
    saveSoon();
  });
  body.addEventListener('click', async e => {
    const li = e.target.closest('.vid');
    if (!li) return;
    const v = vOf(li);
    if (!v) return;
    const frame = $('.vid-frame', li);
    const play = at => {
      if (!frame) { window.open(v.url, '_blank', 'noopener'); return; }
      const info = videoInfo(v.url);
      if (info && info.kind === 'file') {
        let vid = $('video', frame);
        if (!vid) {
          frame.innerHTML = `<video controls playsinline preload="metadata" src="${esc(v.url)}"></video>`;
          vid = $('video', frame);
        }
        vid.currentTime = at !== null ? at : (v.start || 0);
        vid.play().catch(() => {});
        return;
      }
      const ifr = $('iframe', frame);
      if (ifr && at !== null && info.kind === 'youtube') {
        // salto senza ricaricare: il player di YouTube accetta comandi
        ifr.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [at, true] }), '*');
        ifr.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
        return;
      }
      frame.innerHTML = `<iframe src="${esc(videoEmbedSrc(v, at))}" title="${esc(v.title || 'Video')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    };
    if (e.target.closest('[data-play]')) { play(null); return; }
    const ts = e.target.closest('[data-ts]');
    if (ts) { play(+ts.dataset.ts); frame?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    const mv = e.target.closest('[data-mv]');
    if (mv) {
      const i = list.indexOf(v), j = i + +mv.dataset.mv;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      await saveSection(sec);
      draw();
      return;
    }
    if (e.target.closest('[data-del]')) {
      if (!(await modal({ title: 'Eliminare il video?', text: `“${v.title || v.url}” e le sue note spariscono da questa sezione.`, confirm: 'Elimina', danger: true }))) return;
      list.splice(list.indexOf(v), 1);
      await saveSection(sec);
      draw();
      countTab();
    }
  });
}

/* ---------- Etichette da rimettere al loro posto ----------
   Ritagli le scritte di uno schema; nell’esercizio restano dei riquadri vuoti
   e le etichette, mescolate, vanno trascinate (o toccate) al posto giusto.
   Dati nella sezione: sec.labels[imageId] = { masks:[{id,x,y,w,h}], best, log } */
const labelSets = sec => (sec.labels && typeof sec.labels === 'object' && !Array.isArray(sec.labels) ? sec.labels : (sec.labels = {}));
const labelImages = sec => Object.keys(labelSets(sec)).filter(id => imageById(id) && (labelSets(sec)[id].masks || []).length);
function cropStyle(m) {
  const px = m.w >= 1 ? 0 : (m.x / (1 - m.w)) * 100;
  const py = m.h >= 1 ? 0 : (m.y / (1 - m.h)) * 100;
  return `background-size:${(100 / m.w).toFixed(3)}% ${(100 / m.h).toFixed(3)}%;background-position:${px.toFixed(3)}% ${py.toFixed(3)}%`;
}

function openLabelEditor(sec, imageId) {
  return new Promise(resolve => {
    const im = imageById(imageId);
    if (!im) { toast('Immagine non disponibile su questo dispositivo', 'err'); resolve(false); return; }
    const set = labelSets(sec)[imageId] || {};
    let masks = (set.masks || []).map(m => ({ ...m }));
    const occ = sectionMasks(sec).get(imageId) || [];
    let sel = null;
    let mode = 'draw';
    const root = $('#modalRoot');
    root.innerHTML = `
      <div class="overlay full">
        <div class="io-editor" role="dialog" aria-modal="true" aria-labelledby="lbTitle">
          <header class="io-head">
            <h2 id="lbTitle">Ritaglia le etichette</h2>
            <p class="hint">Trascina sopra ogni scritta da staccare: ogni riquadro diventa un’etichetta da rimettere al suo posto. Tocca un riquadro per selezionarlo.</p>
            <div class="inline">
              <div class="seg sm" role="tablist" aria-label="Modalità">
                <button role="tab" data-mode="draw" aria-selected="true">Disegna</button>
                <button role="tab" data-mode="scroll" aria-selected="false">Scorri</button>
              </div>
              ${occ.length ? `<button class="btn sm ghost" type="button" data-lb="occ">Usa i ${occ.length} riquadri dell’occlusione</button>` : ''}
            </div>
          </header>
          <div class="io-body">
            <div class="io io-stage drawing" id="lbStage" style="aspect-ratio:${im.w}/${im.h}">
              <img class="nb-img" data-img="${im.id}" alt="" draggable="false">
              <div id="lbMasks"></div>
              <div class="io-draft" id="lbDraft" hidden></div>
            </div>
          </div>
          <div class="io-sel" id="lbSel" hidden>
            <button class="btn sm ghost danger" data-lb="del" type="button">Elimina il riquadro</button>
          </div>
          <footer class="io-foot">
            <span class="hint" id="lbCount"></span>
            <button class="btn ghost" data-lb="cancel" type="button">Annulla</button>
            <button class="btn" data-lb="save" type="button">Salva</button>
            <button class="btn primary" data-lb="try" type="button">Salva e prova</button>
          </footer>
        </div>
      </div>`;
    const stage = $('#lbStage', root);
    const draft = $('#lbDraft', root);
    const draw = () => {
      $('#lbMasks', root).innerHTML = masks.map((m, i) =>
        `<div class="io-mask edit lb-cut ${sel === m.id ? 'sel' : ''}" data-m="${m.id}" style="${posStyle(m)}"><span>${i + 1}</span></div>`).join('');
      $('#lbCount', root).textContent = masks.length ? `${masks.length} ${masks.length === 1 ? 'etichetta' : 'etichette'}` : '';
      $('#lbSel', root).hidden = !sel;
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
      onDone: b => { const m = { id: uid(), ...b }; masks.push(m); sel = m.id; draw(); }
    });
    $$('[data-mode]', root).forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.mode;
      $$('[data-mode]', root).forEach(x => x.setAttribute('aria-selected', x.dataset.mode === mode));
      stage.classList.toggle('drawing', mode === 'draw');
    }));
    const close = v => { root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(false); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); masks = masks.filter(m => m.id !== sel); sel = null; draw(); }
    };
    document.addEventListener('keydown', onKey, true);
    const occBtn = $('[data-lb="occ"]', root);
    if (occBtn) occBtn.onclick = () => {
      const have = new Set(masks.map(m => `${m.x.toFixed(3)}:${m.y.toFixed(3)}`));
      occ.forEach(m => { if (!have.has(`${m.x.toFixed(3)}:${m.y.toFixed(3)}`)) masks.push({ id: uid(), x: m.x, y: m.y, w: m.w, h: m.h }); });
      draw();
    };
    $('[data-lb="del"]', root).onclick = () => { masks = masks.filter(m => m.id !== sel); sel = null; draw(); };
    $('[data-lb="cancel"]', root).onclick = () => close(false);
    const save = async () => {
      const sets = labelSets(sec);
      if (!masks.length) {
        if (sets[imageId]) { delete sets[imageId]; await saveSection(sec); toast('Etichette tolte da questa immagine'); }
        return false;
      }
      if (masks.length < 2) { toast('Servono almeno due etichette da scambiare'); return null; }
      sets[imageId] = {
        ...(sets[imageId] || {}),
        masks: masks.map(m => ({ id: m.id, x: +m.x.toFixed(4), y: +m.y.toFixed(4), w: +m.w.toFixed(4), h: +m.h.toFixed(4) })),
        edited: Date.now()
      };
      await saveSection(sec);
      return true;
    };
    $('[data-lb="save"]', root).onclick = async () => {
      const ok = await save();
      if (ok === null) return;
      close(ok);
      if (ok) toast(`${masks.length} etichette salvate`);
      route();
    };
    $('[data-lb="try"]', root).onclick = async () => {
      const ok = await save();
      if (ok === null) return;
      close(ok);
      if (ok) openLabelQuiz(sec, imageId);
      else route();
    };
    draw();
  });
}

function openLabelQuiz(sec, imageId) {
  const im = imageById(imageId);
  const set = labelSets(sec)[imageId];
  if (!im || !set || !(set.masks || []).length) { toast('Ritaglia prima le etichette di questa immagine'); return; }
  const masks = set.masks;
  const url = imageUrl(imageId);
  const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  let order = shuffle(masks.map(m => m.id));
  if (masks.length > 1 && order.every((id, i) => id === masks[i].id)) order.push(order.shift());
  const placed = {};          // slot -> piece
  let picked = null;          // etichetta toccata, in attesa del riquadro
  let checked = false;
  let firstScore = null;
  let zoom = 1;
  const started = Date.now();
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="overlay full">
      <div class="io-editor lq" role="dialog" aria-modal="true" aria-labelledby="lqTitle">
        <header class="io-head">
          <h2 id="lqTitle">Rimetti le etichette</h2>
          <p class="hint">Trascina ogni etichetta nel riquadro giusto, oppure toccala e poi tocca il riquadro. Quando hai finito, controlla.</p>
        </header>
        <div class="io-body lq-body" id="lqBody">
          <div class="io lq-stage" id="lqStage" style="aspect-ratio:${im.w}/${im.h}">
            <img class="nb-img" data-img="${im.id}" alt="Schema con le etichette tolte" draggable="false">
            ${masks.map((m, i) => `<button type="button" class="lq-slot" data-s="${m.id}" style="${posStyle(m)}" aria-label="Riquadro ${i + 1}, vuoto"></button>`).join('')}
          </div>
        </div>
        <div class="lq-tray" id="lqTray" aria-label="Etichette da sistemare"></div>
        <footer class="io-foot">
          <span class="hint" id="lqMsg" aria-live="polite"></span>
          <button class="btn sm ghost" type="button" data-q="zoom" aria-label="Ingrandisci lo schema">Zoom 1×</button>
          <button class="btn ghost" type="button" data-q="edit">Ritagli</button>
          <button class="btn ghost" type="button" data-q="show">Soluzione</button>
          <button class="btn ghost" type="button" data-q="again">Ricomincia</button>
          <button class="btn primary" type="button" data-q="check">Controlla</button>
          <button class="btn ghost" type="button" data-q="close">Chiudi</button>
        </footer>
      </div>
    </div>`;
  const stage = $('#lqStage', root);
  const tray = $('#lqTray', root);
  const bodyEl = $('#lqBody', root);
  const msg = $('#lqMsg', root);
  const byId = id => masks.find(m => m.id === id);
  // nel riquadro l’etichetta resta della sua misura, centrata: niente deformazioni che suggeriscano la risposta
  const pieceHtml = (id, where, slotId) => {
    const m = byId(id);
    const sl = slotId ? byId(slotId) : null;
    const fit = sl ? ` style="width:${((m.w / sl.w) * 100).toFixed(2)}%;height:${((m.h / sl.h) * 100).toFixed(2)}%"` : '';
    return `<span class="lq-piece ${picked === id ? 'picked' : ''}" data-p="${id}" data-where="${where}"${fit} role="button" tabindex="0" aria-label="Etichetta${where === 'tray' ? '' : ' nel riquadro'}"><span class="lq-crop" style="background-image:url('${url}');${cropStyle(m)}"></span></span>`;
  };
  const sizeTray = () => {
    const w = stage.getBoundingClientRect().width;
    $$('.lq-piece', tray).forEach(p => {
      const m = byId(p.dataset.p);
      p.style.width = `${Math.max(36, m.w * w)}px`;
      p.style.height = `${Math.max(18, m.h * w * (im.h / im.w))}px`;
    });
  };
  const draw = () => {
    const inSlots = new Set(Object.values(placed));
    tray.innerHTML = order.filter(id => !inSlots.has(id)).map(id => pieceHtml(id, 'tray')).join('') || '<p class="hint lq-done">Tutte le etichette sono al loro posto.</p>';
    $$('.lq-slot', stage).forEach((s, i) => {
      const p = placed[s.dataset.s];
      s.innerHTML = p ? pieceHtml(p, 'slot', s.dataset.s) : '';
      s.classList.toggle('filled', !!p);
      s.classList.toggle('target', !!picked && !p);
      s.classList.remove('ok', 'bad');
      if (checked && p) s.classList.add(p === s.dataset.s ? 'ok' : 'bad');
      s.setAttribute('aria-label', `Riquadro ${i + 1}${p ? (checked ? (p === s.dataset.s ? ', giusto' : ', sbagliato') : ', occupato') : ', vuoto'}`);
    });
    sizeTray();
    const n = Object.keys(placed).length;
    if (!checked) msg.textContent = `${n} di ${masks.length} sistemate`;
  };
  const place = (pid, sid) => {
    checked = false;
    for (const k of Object.keys(placed)) if (placed[k] === pid) delete placed[k];
    if (sid) placed[sid] = pid;   // chi c’era torna tra le etichette
    picked = null;
    draw();
  };
  const unplace = pid => { for (const k of Object.keys(placed)) if (placed[k] === pid) delete placed[k]; checked = false; };

  /* trascinamento con dito o mouse; un tocco senza movimento seleziona */
  let drag = null;
  root.addEventListener('pointerdown', e => {
    const p = e.target.closest('.lq-piece');
    if (!p || e.button > 0) return;
    e.preventDefault();
    const r = p.getBoundingClientRect();
    drag = { id: e.pointerId, pid: p.dataset.p, el: p, x0: e.clientX, y0: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, ghost: null };
    try { p.setPointerCapture(e.pointerId); } catch { /* va bene lo stesso */ }
  });
  root.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
      const g = drag.el.cloneNode(true);
      g.className = 'lq-piece lq-ghost';
      g.style.width = `${drag.w}px`;
      g.style.height = `${drag.h}px`;
      document.body.append(g);
      drag.ghost = g;
      drag.el.classList.add('lifting');
    }
    drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px, ${e.clientY - drag.dy}px)`;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.lq-slot');
    $$('.lq-slot.hover', stage).forEach(s => { if (s !== over) s.classList.remove('hover'); });
    if (over) over.classList.add('hover');
    // vicino ai bordi lo schema scorre da solo
    const br = bodyEl.getBoundingClientRect();
    if (e.clientY < br.top + 40) bodyEl.scrollBy(0, -14);
    else if (e.clientY > br.bottom - 40 && e.clientY < br.bottom + 10) bodyEl.scrollBy(0, 14);
    if (e.clientX < br.left + 30) bodyEl.scrollBy(-14, 0);
    else if (e.clientX > br.right - 30) bodyEl.scrollBy(14, 0);
  });
  const endDrag = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    $$('.lq-slot.hover', stage).forEach(s => s.classList.remove('hover'));
    if (!d.ghost) {   // tocco: seleziona o deseleziona
      picked = picked === d.pid ? null : d.pid;
      draw();
      return;
    }
    d.ghost.remove();
    d.el.classList.remove('lifting');
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.lq-slot');
    if (over) place(d.pid, over.dataset.s);
    else { unplace(d.pid); picked = null; draw(); }
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', e => { if (drag && drag.ghost) drag.ghost.remove(); if (drag) drag.el.classList.remove('lifting'); drag = null; draw(); });
  root.addEventListener('click', e => {
    const s = e.target.closest('.lq-slot');
    if (s && picked && !e.target.closest('.lq-piece')) { place(picked, s.dataset.s); return; }
  });
  root.addEventListener('keydown', e => {
    const p = e.target.closest('.lq-piece');
    if (p && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); picked = picked === p.dataset.p ? null : p.dataset.p; draw(); $(`.lq-piece[data-p="${p.dataset.p}"]`, root)?.focus(); }
  });

  let logged = false;
  const finish = async ok => {
    if (firstScore === null) firstScore = ok;
    if (ok < masks.length || logged) return;
    logged = true;
    const sets = labelSets(sec);
    const st = sets[imageId] || (sets[imageId] = { masks });
    const log = Array.isArray(st.log) ? st.log : [];
    log.push({ d: todayStr(), ok: firstScore, n: masks.length, s: Math.round((Date.now() - started) / 1000) });
    st.log = log.slice(-20);
    st.best = Math.max(st.best || 0, firstScore / masks.length);
    await saveSection(sec);
  };
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', sizeTray); route(); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', sizeTray);
  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    const q = b.dataset.q;
    if (q === 'close') close();
    else if (q === 'edit') { root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', sizeTray); openLabelEditor(sec, imageId); }
    else if (q === 'zoom') {
      zoom = zoom === 1 ? 1.5 : zoom === 1.5 ? 2 : 1;
      stage.style.width = `${zoom * 100}%`;
      stage.style.maxWidth = zoom === 1 ? '' : 'none';
      b.textContent = `Zoom ${zoom}×`;
      requestAnimationFrame(sizeTray);
    } else if (q === 'again') {
      Object.keys(placed).forEach(k => delete placed[k]);
      order = shuffle(masks.map(m => m.id));
      checked = false;
      picked = null;
      firstScore = null;
      logged = false;
      draw();
    } else if (q === 'show') {
      masks.forEach(m => { placed[m.id] = m.id; });
      checked = true;
      picked = null;
      if (firstScore === null) firstScore = 0;
      draw();
      msg.textContent = 'Ecco la soluzione: Ricomincia per riprovare.';
    } else if (q === 'check') {
      const n = Object.keys(placed).length;
      if (!n) { msg.textContent = 'Sistema almeno un’etichetta, poi controlla.'; return; }
      checked = true;
      picked = null;
      const ok = masks.filter(m => placed[m.id] === m.id).length;
      draw();
      if (ok === masks.length) {
        msg.textContent = firstScore === null || firstScore === masks.length ? 'Tutte giuste al primo colpo!' : `Tutte giuste! Al primo controllo erano ${firstScore} su ${masks.length}.`;
        await finish(ok);
        return;
      }
      if (firstScore === null && n === masks.length) firstScore = ok;
      msg.textContent = `${ok} giuste su ${masks.length}${n < masks.length ? ` (${masks.length - n} ancora da sistemare)` : ''}. Le rosse tornano tra le etichette.`;
      setTimeout(() => {
        if (!checked) return;
        for (const k of Object.keys(placed)) if (placed[k] !== k) delete placed[k];
        checked = false;
        draw();
        msg.textContent = `${ok} giuste su ${masks.length}: sistema le altre.`;
      }, 1400);
    }
  });
  hydrateImages(root);
  draw();
  // la prima misura arriva quando l’immagine ha preso posto
  requestAnimationFrame(sizeTray);
}

// Dal pulsante della sezione o dall’immagine a schermo intero
async function startLabels(sec, imageId = null) {
  let id = imageId;
  if (!id) {
    const ids = labelImages(sec);
    if (!ids.length) {
      const all = imageRefs(sec.md).filter(x => imageById(x));
      if (!all.length) { toast('In questa sezione non ci sono immagini'); return; }
      id = all.length === 1 ? all[0] : await pickImage(all, sec.notebookId);
      if (id) openLabelEditor(sec, id);
      return;
    }
    id = ids.length === 1 ? ids[0] : await pickImage(ids, sec.notebookId);
  }
  if (!id) return;
  if ((labelSets(sec)[id]?.masks || []).length) openLabelQuiz(sec, id); else openLabelEditor(sec, id);
}

/* =====================================================================
   v3.27: PDF con OCR in testo pulito, diviso per argomenti
   Dal livello di testo del PDF ricostruisco le righe con la loro misura:
   i titoli sono più grandi del testo, numerati (3.1, 3.1.2) o in maiuscolo.
   Tolgo intestazioni e piè di pagina ripetuti, numeri di pagina e indice,
   riunisco le parole spezzate a capo; poi divido ai titoli del livello scelto.
   ===================================================================== */
const TOPIC_MIN_CHARS = 500;
const TOPIC_BIG_CHARS = 60000;

async function pdfPageLines(doc, n) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const lines = [];
  let cur = null;
  const close = () => { if (cur && cur.text.trim()) lines.push(cur); cur = null; };
  for (const it of tc.items) {
    if (!('str' in it)) continue;
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    const size = Math.hypot(tr[2], tr[3]) || it.height || 0;
    const y = vp.height - tr[5];
    const x = tr[4];
    if (cur && Math.abs(y - cur.y) > Math.max(2, Math.min(size, cur.max) * 0.45)) close();
    if (!it.str.trim()) { if (it.hasEOL) close(); else if (cur && !cur.text.endsWith(' ')) cur.text += ' '; continue; }
    if (!cur) cur = { text: '', y, x, page: n, ph: vp.height, w: [], max: size, endX: null };
    else if (cur.endX !== null && x - cur.endX > size * 0.18 && !cur.text.endsWith(' ')) cur.text += ' ';
    cur.text += it.str;
    cur.w.push([size, it.str.replace(/\s/g, '').length]);
    cur.max = Math.max(cur.max, size);
    cur.endX = x + (it.width || 0);
    if (it.hasEOL) close();
  }
  close();
  return lines.map(l => {
    // misura “di riga”: quella che copre più caratteri
    const by = new Map();
    l.w.forEach(([s, c]) => { const k = Math.round(s * 2) / 2; by.set(k, (by.get(k) || 0) + c); });
    const size = [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
    return { text: l.text.replace(/\s+/g, ' ').trim(), y: l.y, x: l.x, page: n, ph: l.ph, size };
  }).filter(l => l.text);
}

const TOPIC_NUM_RE = /^((?:\d{1,2}|[IVXLC]{1,6})(?:\.\d{1,2}){0,3})[.)]?\s+(.+)$/;
const TOPIC_SKIP_RE = /^(fig(ura)?|tab(ella)?|box|grafico|schema|nota|immagine)\b[\s.\d:]/i;

async function pdfOutline(doc, onProgress = () => {}) {
  const pages = doc.numPages;
  const all = [];
  for (let n = 1; n <= pages; n++) {
    try { all.push(await pdfPageLines(doc, n)); } catch { all.push([]); }
    if (n % 5 === 0 || n === pages) onProgress(n, pages);
  }
  // indice: pagine dove molte righe finiscono con un numero di pagina
  const tocPages = new Set();
  all.forEach((ls, i) => {
    if (ls.length < 6) return;
    const withNum = ls.filter(l => /(\.{2,}|…|\s)\s*\d{1,4}$/.test(l.text) && /[a-zà-ÿ]/i.test(l.text)).length;
    if (withNum / ls.length > 0.4) tocPages.add(i + 1);
  });
  // intestazioni e piè di pagina ripetuti
  const norm = t => foldAccents(t).replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const edge = l => l.y < l.ph * 0.1 || l.y > l.ph * 0.9;
  const counts = new Map();
  all.forEach(ls => {
    const seen = new Set();
    ls.filter(edge).forEach(l => { const k = norm(l.text); if (!seen.has(k)) { seen.add(k); counts.set(k, (counts.get(k) || 0) + 1); } });
  });
  const minRep = Math.max(3, Math.ceil(pages * 0.3));
  const running = new Set([...counts.entries()].filter(([, c]) => c >= minRep).map(([k]) => k));
  let removed = 0;
  const lines = [];
  all.forEach((ls, i) => {
    if (tocPages.has(i + 1)) { removed += ls.length; return; }
    ls.forEach(l => {
      if (edge(l) && (running.has(norm(l.text)) || /^(pag(ina|\.)?\s*)?\d{1,4}(\s*(di|\/)\s*\d{1,4})?$/i.test(l.text))) { removed++; return; }
      lines.push(l);
    });
  });
  // misura del testo normale: la più frequente sulle righe lunghe
  const by = new Map();
  lines.filter(l => l.text.length > 30).forEach(l => by.set(l.size, (by.get(l.size) || 0) + l.text.length));
  const body = [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  // candidati titolo
  const letters = t => (t.match(/[a-zà-ÿ]/gi) || []).length;
  lines.forEach(l => {
    const t = l.text;
    if (t.length < 2 || t.length > 140 || letters(t) < 2 || TOPIC_SKIP_RE.test(t) || /^[\d\s.,;:%()+\-–/]+$/.test(t)) return;
    const num = t.match(TOPIC_NUM_RE);
    if (l.size >= body * 1.15 && !/[,;]$/.test(t) && t.length <= 120) { l.kind = 'size'; return; }
    if (num && t.length < 110 && !/[.;:,]$/.test(t) && l.size >= body * 0.95 && /^[A-ZÀ-Ý«"“(]/.test(num[2])) {
      l.kind = 'num';
      l.depth = num[1].split('.').filter(Boolean).length;
      return;
    }
    const lt = letters(t);
    if (lt >= 6 && t.length <= 90 && t === t.toUpperCase() && /[A-ZÀ-Ý]{3}/.test(t) && (t.split(/\s+/).length >= 2 || lt >= 8) && !/[.;,]$/.test(t)) l.kind = 'caps';
  });
  // titoli su due righe: stessa misura, uno sotto l’altro
  for (let i = lines.length - 1; i > 0; i--) {
    const a = lines[i - 1], b = lines[i];
    if (a.kind && b.kind === a.kind && a.kind !== 'num' && b.page === a.page && Math.abs(a.size - b.size) < 0.6 && b.y - a.y < a.size * 1.9 && (a.text + b.text).length < 160) {
      a.text = `${a.text} ${b.text}`;
      lines.splice(i, 1);
    }
  }
  // livelli: misure dei titoli raggruppate dalla più grande; poi numeri e maiuscolo
  const sizes = [...new Set(lines.filter(l => l.kind === 'size').map(l => l.size))].sort((a, b) => b - a);
  const clusters = [];
  sizes.forEach(s => { const c = clusters[clusters.length - 1]; if (c && s >= c[0] * 0.92) c.push(s); else clusters.push([s]); });
  // una misura usata una volta sola (copertina, titolo del libro) non fa livello se ce ne sono altre
  const useCount = s => lines.filter(l => l.kind === 'size' && l.size === s).length;
  while (clusters.length > 1 && clusters[0].reduce((a, s) => a + useCount(s), 0) === 1) {
    const [only] = clusters.shift();
    lines.forEach(l => { if (l.kind === 'size' && l.size === only) l.kind = 'cover'; });
  }
  const sizeLevel = s => { const i = clusters.findIndex(c => c.includes(s)); return i < 0 ? 3 : Math.min(3, i + 1); };
  const k = Math.min(3, clusters.length);
  lines.forEach(l => {
    if (l.kind === 'size') l.level = sizeLevel(l.size);
    else if (l.kind === 'num') l.level = Math.min(3, k ? Math.max(l.depth, k + 1) : l.depth);
    else if (l.kind === 'caps') l.level = Math.min(3, k + 1);
  });
  const levels = [1, 2, 3].filter(L => lines.some(l => l.level === L));
  return { lines, body, levels, removed, tocPages: [...tocPages], headings: lines.filter(l => l.level).length };
}

// Le sezioni al livello scelto; `path` sono i titoli sopra (macro-argomento, sottoargomento)
function topicSections(outline, S) {
  const out = [];
  const parents = {};
  let cur = null;
  let last = null;
  const open = (title, path, line, intro = false) => {
    cur = { title: title.slice(0, 140), path: path.filter(Boolean), text: '', from: line.page, to: line.page, intro };
    out.push(cur);
    last = null;
  };
  const add = l => {
    if (!cur) open(out.length ? 'Senza titolo' : 'Inizio', [], l);
    let sep = '';
    if (last) {
      const gap = l.page !== last.page || l.y - last.y > Math.max(last.size, l.size) * 1.55 || l.y < last.y;
      if (/[a-zà-ÿ]-$/.test(cur.text) && /^[a-zà-ÿ]/.test(l.text) && !gap) { cur.text = cur.text.slice(0, -1); sep = ''; }
      else sep = gap ? '\n\n' : '\n';
    }
    cur.text += sep + l.text;
    cur.to = l.page;
    last = l;
  };
  for (const l of outline.lines) {
    if (!l.level) { if (l.kind !== 'cover') add(l); continue; }
    const title = l.text.replace(/\s+/g, ' ').trim();
    if (l.level < S) {
      parents[l.level] = title;
      for (let L = l.level + 1; L <= 3; L++) delete parents[L];
      open(title, [1, 2].filter(L => L <= l.level && L < S).map(L => parents[L]), l, true);
    } else if (l.level === S) {
      open(title, [1, 2].filter(L => L < S).map(L => parents[L]), l);
    } else {
      if (!cur) open(title, [1, 2].filter(L => L < S).map(L => parents[L]), l);
      else { cur.text += `${cur.text ? '\n\n' : ''}${'#'.repeat(Math.min(4, 2 + l.level - S))} ${title}\n\n`; last = null; cur.to = l.page; }
    }
  }
  out.forEach(s => {
    s.text = s.text.replace(/\n{3,}/g, '\n\n').trim();
    s.chars = s.text.replace(/\s/g, '').length;
  });
  // introduzioni vuote via; quelle brevi si uniscono alla sezione accanto dello stesso gruppo
  let list = out.filter(s => s.chars >= 40 || !s.intro);
  const same = (a, b) => a && b && a.path.join('\u0001') === b.path.join('\u0001');
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.chars >= TOPIC_MIN_CHARS || list.length < 2) continue;
    const prev = list[i - 1], next = list[i + 1];
    if (same(prev, s) && !s.intro) {
      prev.text += `\n\n### ${s.title}\n\n${s.text}`; prev.to = s.to; prev.chars += s.chars;
      list.splice(i--, 1);
    } else if (same(next, s) || (s.intro && next)) {
      next.text = `${s.intro ? '' : `### ${s.title}\n\n`}${s.text}\n\n${next.text}`.trim(); next.from = s.from; next.chars += s.chars;
      list.splice(i--, 1);
    }
  }
  // titolo grande con il suo testo: se sotto ha altre sezioni è la loro introduzione,
  // altrimenti un gruppo con una sola sezione omonima non serve e la sezione sale di un livello
  const key = p => p.join('\u0001');
  list.forEach(s => {
    if (!s.intro || !s.path.length || s.path[s.path.length - 1] !== s.title) return;
    const kids = list.some(o => o !== s && key(o.path) === key(s.path));
    if (kids) s.title = `${s.title}: introduzione`;
    else s.path = s.path.slice(0, -1);
  });
  return list.filter(s => s.chars > 0);
}

// il livello che dà sezioni né troppo corte né troppe
// scende di livello solo se divide davvero di più (almeno una volta e mezzo le sezioni)
function topicAutoLevel(outline) {
  let pick = outline.levels[0] || 1;
  let n = topicSections(outline, pick).length;
  for (const L of outline.levels.slice(1)) {
    const secs = topicSections(outline, L);
    const med = secs.map(s => s.chars).sort((a, b) => a - b)[Math.floor(secs.length / 2)] || 0;
    if (secs.length <= 80 && med >= 1200 && secs.length >= n * 1.5) { pick = L; n = secs.length; }
  }
  return pick;
}

// Crea (o ritrova) macro-argomento e sottoargomento per una sezione
async function ensureTopicGroup(job, path) {
  if (!path || !path.length) return job.groupId;
  const nb = nbById(job.nbId);
  if (!nb) return job.groupId;
  const base = job.groupId ? groupsOf(nb).find(g => g.id === job.groupId) : null;
  if (base && groupParent(nb, base)) return base.id;          // dentro un sottoargomento non si scende oltre
  const same = (a, b) => foldAccents(a).trim() === foldAccents(b).trim();
  const find = (name, parentId) => groupsOf(nb).find(g => same(g.name, name) && (g.parentId || null) === (parentId || null));
  const make = (name, parentId) => {
    const g = { id: uid(), name: name.slice(0, 120) };
    if (parentId) g.parentId = parentId;
    nb.groups = [...groupsOf(nb), g];
    job.groupsChanged = true;
    return g;
  };
  let target;
  if (base) {
    const name = path[path.length - 1];
    target = find(name, base.id) || make(name, base.id);
  } else {
    const macro = find(path[0], null) || make(path[0], null);
    target = path[1] ? (find(path[1], macro.id) || make(path[1], macro.id)) : macro;
  }
  if (job.groupsChanged) { await saveNotebook(nb); job.groupsChanged = false; }
  return target.id;
}

/* ---------- Scelta di materia e posizione in StudyHub ----------
   StudyHub sta sullo stesso sito: i suoi dati si leggono dal localStorage. */
const SH_DATA_KEY = 'multiSubjectDataV6';
function shData() {
  try {
    const d = JSON.parse(localStorage.getItem(SH_DATA_KEY) || 'null');
    return d && d.subjects && typeof d.subjects === 'object' ? d : null;
  } catch { return null; }
}
const shNorm = x => foldAccents(String(x || '')).trim();
function shTopicOf(sec) {
  const d = shData();
  if (!d) return null;
  for (const [name, sub] of Object.entries(d.subjects)) {
    const t = (sub && Array.isArray(sub.topics) ? sub.topics : []).find(x => x && x.nb && x.nb.sec === sec.id);
    if (t) return { t, name };
  }
  return null;
}
// argomenti in ordine di albero, con la profondità
function shTree(sub) {
  const list = (sub && Array.isArray(sub.topics) ? sub.topics : []).filter(t => t && t.id && t.name);
  const ids = new Set(list.map(t => t.id));
  const kids = {};
  list.forEach(t => { const p = t.parent && ids.has(t.parent) && t.parent !== t.id ? t.parent : ''; (kids[p] = kids[p] || []).push(t); });
  const out = [];
  const seen = new Set();
  const walk = (p, depth) => (kids[p] || []).forEach(t => { if (seen.has(t.id)) return; seen.add(t.id); out.push({ t, depth, kids: !!(kids[t.id] || []).length }); walk(t.id, depth + 1); });
  walk('', 0);
  return out;
}
function shPlaceSheet(sec) {
  return new Promise(resolve => {
    const d = shData();
    const subs = d ? Object.keys(d.subjects) : [];
    if (!subs.length) { resolve(null); return; }   // StudyHub non ancora aperto qui: decide lui dal nome
    const nb = nbById(sec.notebookId);
    const macro = groupOf(sec)?.name || '';
    const remembered = nb && nb.shSubject && subs.includes(nb.shSubject) ? nb.shSubject : null;
    let subName = remembered || subs.find(n => shNorm(n) === shNorm(nb?.name)) || (nb ? '' : subs[0]);
    const newName = (nb?.name || 'Notebook').trim();
    const ind = n => '\u00a0\u00a0\u00a0'.repeat(n);
    const sh = openSheet(`
      <h2>Segna come studiata in StudyHub</h2>
      <p class="hint">“${esc(sec.title)}” entra in StudyHub, che da oggi ne pianifica i ripassi.</p>
      <label class="field"><span>Materia in StudyHub</span>
        <select class="input" id="shSub">
          ${subs.map(n => `<option value="${esc(n)}" ${n === subName ? 'selected' : ''}>${esc(n)}</option>`).join('')}
          ${subs.some(n => shNorm(n) === shNorm(newName)) ? '' : `<option value="" ${subName ? '' : 'selected'}>Nuova materia: ${esc(newName)}</option>`}
        </select></label>
      <label class="field"><span>Dove</span><select class="input" id="shPos"></select></label>
      <p class="hint" id="shPosHint"></p>
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-sh-pick="no">Annulla</button>
        <button class="btn primary" type="button" data-sh-pick="ok">Segna come studiata</button>
      </div>`, { label: 'Segna come studiata in StudyHub', onClose: v => resolve(v === undefined || v === null ? false : v) });
    const pos = $('#shPos', sh.el);
    const hint = $('#shPosHint', sh.el);
    const draw = () => {
      const sub = subName ? d.subjects[subName] : null;
      const tree = shTree(sub);
      const free = tree.filter(x => !x.kids && !(x.t.nb && x.t.nb.sec && x.t.nb.sec !== sec.id));
      const same = free.find(x => shNorm(x.t.name) === shNorm(sec.title));
      const macroHit = tree.find(x => shNorm(x.t.name) === shNorm(macro));
      const pick = same ? `link:${same.t.id}` : macroHit ? `new:${macroHit.t.id}` : 'new:';
      pos.innerHTML = `
        <optgroup label="Argomento nuovo">
          <option value="new:">Tra gli argomenti principali</option>
          ${tree.map(x => `<option value="new:${esc(x.t.id)}">${ind(x.depth)}Dentro “${esc(x.t.name)}”</option>`).join('')}
        </optgroup>
        ${free.length ? `<optgroup label="Argomento che c’è già">
          ${free.map(x => `<option value="link:${esc(x.t.id)}">${ind(x.depth)}${esc(x.t.name)}${x.t.status === 'todo' ? ' (da studiare)' : ''}</option>`).join('')}
        </optgroup>` : ''}`;
      pos.value = pick;
      showHint();
    };
    const showHint = () => {
      hint.textContent = pos.value.startsWith('link:')
        ? 'Lo colleghi a un argomento che hai già: se era da studiare parte oggi, se lo ripassi già resta com’è.'
        : `Crea in StudyHub l’argomento “${sec.title}”.`;
    };
    draw();
    $('#shSub', sh.el).addEventListener('change', e => { subName = e.target.value; draw(); });
    pos.addEventListener('change', showHint);
    $('[data-sh-pick="no"]', sh.el).onclick = () => sh.close(false);
    $('[data-sh-pick="ok"]', sh.el).onclick = async () => {
      const [kind, id] = pos.value.split(':');
      const chosen = subName || newName;
      if (nb && nb.shSubject !== chosen) { nb.shSubject = chosen; await saveNotebook(nb); }
      sh.close(kind === 'link'
        ? { shSubject: chosen, shPlace: 'link', shTopicId: id }
        : { shSubject: chosen, shPlace: 'new', shParentId: id || '' });
    };
  });
}

/* ---------- StudyHub accanto al Notebook ---------- */
const SH_URL = 'https://metallia13-ctrl.github.io/Study-hub/';
const SH_ICONS = {
  size: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
  small: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7"/></svg>',
  reload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>',
  ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
};
const ShDock = {
  KEY: 'nb-sh-dock',
  el: null,
  frame: null,
  src: '',
  prefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch { p = {}; }
    return { w: 420, h: 0.55, open: false, ...p };
  },
  setPrefs(ch) {
    const p = { ...this.prefs(), ...ch };
    try { localStorage.setItem(this.KEY, JSON.stringify(p)); } catch { /* solo una preferenza */ }
    return p;
  },
  url() { const u = String(S().studyhubUrl || '').trim(); return /^https?:\/\/\S+$/i.test(u) ? u : SH_URL; },
  wide: () => matchMedia('(min-width: 900px)').matches,
  isOpen() { return document.body.classList.contains('sh-open'); },
  sameOrigin() { try { return new URL(this.url(), location.href).origin === location.origin; } catch { return false; } },
  maxW() { return Math.max(300, Math.min(1000, window.innerWidth - 232 - 380)); },
  maxH() { return Math.max(240, window.innerHeight - 96 - 24); },
  build() {
    if (this.el) return this.el;
    const el = document.createElement('aside');
    el.className = 'sh-dock';
    el.id = 'shDock';
    el.setAttribute('aria-label', 'StudyHub');
    el.hidden = true;
    el.innerHTML = `
      <div class="sh-grip" role="separator" tabindex="0" aria-label="Trascina per cambiare la dimensione di StudyHub; anche con le frecce"></div>
      <header class="sh-head">
        <span class="sh-title">StudyHub</span>
        <span class="sh-pend" hidden></span>
        <span class="sh-acts">
          <button type="button" class="sh-ic" data-sh="size"></button>
          <button type="button" class="sh-ic" data-sh="reload" aria-label="Ricarica StudyHub" title="Ricarica">${SH_ICONS.reload}</button>
          <a class="sh-ic" data-sh="ext" target="_blank" rel="noopener" aria-label="Apri StudyHub in una scheda a parte" title="Apri a parte">${SH_ICONS.ext}</a>
          <button type="button" class="sh-ic" data-sh="close" aria-label="Chiudi StudyHub" title="Chiudi">${SH_ICONS.close}</button>
        </span>
      </header>
      <div class="sh-body"><p class="sh-msg">Apro StudyHub…</p></div>`;
    document.body.append(el);
    this.el = el;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-sh]');
      if (!b) return;
      const act = b.dataset.sh;
      if (act === 'close') this.close();
      else if (act === 'reload') this.load(true);
      else if (act === 'size') this.toggleSize();
    });
    this.bindGrip($('.sh-grip', el));
    return el;
  },
  bindGrip(grip) {
    let d = null;
    grip.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      e.preventDefault();
      try { grip.setPointerCapture(e.pointerId); } catch { /* va bene lo stesso */ }
      const p = this.prefs();
      d = { id: e.pointerId, x: e.clientX, y: e.clientY, w: this.curW(p), h: this.curH(p) };
      this.el.classList.add('resizing');
    });
    grip.addEventListener('pointermove', e => {
      if (!d || e.pointerId !== d.id) return;
      if (this.wide()) this.apply({ w: d.w - (e.clientX - d.x) });
      else this.apply({ hPx: d.h - (e.clientY - d.y) });
    });
    const end = e => {
      if (!d || e.pointerId !== d.id) return;
      d = null;
      this.el.classList.remove('resizing');
      this.savePos();
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('keydown', e => {
      const p = this.prefs();
      const wide = this.wide();
      const dir = { ArrowLeft: 1, ArrowRight: -1, ArrowUp: 1, ArrowDown: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      if (wide) this.apply({ w: this.curW(p) + dir * 32 }); else this.apply({ hPx: this.curH(p) + dir * 40 });
      this.savePos();
    });
  },
  curW(p = this.prefs()) { return Math.round(Math.min(this.maxW(), Math.max(300, +p.w || 420))); },
  curH(p = this.prefs()) { return Math.round(Math.min(this.maxH(), Math.max(220, (+p.h || 0.55) * this.maxH()))); },
  apply({ w, hPx } = {}) {
    const p = this.prefs();
    const ww = w === undefined ? this.curW(p) : Math.round(Math.min(this.maxW(), Math.max(300, w)));
    const hh = hPx === undefined ? this.curH(p) : Math.round(Math.min(this.maxH(), Math.max(220, hPx)));
    const root = document.documentElement.style;
    root.setProperty('--sh-w', `${ww}px`);
    root.setProperty('--sh-h', `${hh}px`);
    this._w = ww;
    this._h = hh;
    if (this.el) {
      const big = this.wide() ? ww >= this.maxW() - 4 : hh >= this.maxH() - 4;
      const b = $('[data-sh="size"]', this.el);
      b.innerHTML = big ? SH_ICONS.small : SH_ICONS.size;
      b.setAttribute('aria-label', big ? 'Rimpicciolisci StudyHub' : 'Ingrandisci StudyHub');
      b.title = big ? 'Più piccolo' : 'Più grande';
    }
  },
  savePos() {
    if (this.wide()) this.setPrefs({ w: this._w }); else this.setPrefs({ h: +(this._h / this.maxH()).toFixed(3) });
  },
  toggleSize() {
    const p = this.prefs();
    if (this.wide()) {
      const big = this.curW(p) >= this.maxW() - 4;
      this.apply({ w: big ? 380 : this.maxW() });
    } else {
      const big = this.curH(p) >= this.maxH() - 4;
      this.apply({ hPx: big ? this.maxH() * 0.5 : this.maxH() });
    }
    this.savePos();
  },
  load(force = false) {
    const body = $('.sh-body', this.el);
    const url = this.url();
    $('[data-sh="ext"]', this.el).href = url;
    if (this.frame && this.src === url && !force) return;
    const msg = $('.sh-msg', body);
    msg.hidden = false;
    msg.textContent = 'Apro StudyHub…';
    if (!this.frame) {
      this.frame = document.createElement('iframe');
      this.frame.className = 'sh-frame';
      this.frame.title = 'StudyHub';
      this.frame.setAttribute('allow', 'autoplay; fullscreen; clipboard-read; clipboard-write; screen-wake-lock');
      body.append(this.frame);
    }
    this.src = url;
    let ok = false;
    clearTimeout(this.slowT);
    this.frame.onload = () => { ok = true; msg.hidden = true; };
    this.slowT = setTimeout(() => {
      if (ok) return;
      msg.innerHTML = `StudyHub non risponde. Controlla la connessione, poi tocca Ricarica, oppure <a href="${esc(url)}" target="_blank" rel="noopener">aprilo a parte</a>.`;
    }, 15000);
    this.frame.src = url;
  },
  open() {
    this.build();
    this.el.hidden = false;
    document.body.classList.add('sh-open');
    this.apply();
    this.load();
    this.setPrefs({ open: true });
    this.refresh();
    if (!this.sameOrigin() && !this.warned) { this.warned = true; toast('StudyHub è su un altro sito: lo vedi qui, ma gli argomenti studiati non gli arrivano in automatico', 'err'); }
  },
  close() {
    if (!this.el) return;
    this.el.hidden = true;
    document.body.classList.remove('sh-open');
    this.setPrefs({ open: false });
    this.refresh();
  },
  toggle() { if (this.isOpen()) this.close(); else this.open(); },
  reset() {
    if (this.frame) { this.frame.remove(); this.frame = null; this.src = ''; }
    if (this.isOpen()) this.load();
  },
  // numero di argomenti che StudyHub non ha ancora letto, nel menu e nel pannello
  refresh() {
    const n = Bridge.pending();
    const badge = $('#shBadge');
    if (badge) { badge.hidden = !n; badge.textContent = n; }
    $$('[data-sh-toggle]').forEach(a => { a.classList.toggle('sh-on', this.isOpen()); a.setAttribute('aria-pressed', String(this.isOpen())); });
    if (this.el) {
      const p = $('.sh-pend', this.el);
      p.hidden = !n;
      p.textContent = n ? `${n} da leggere` : '';
      p.title = n ? `${n} ${n === 1 ? 'aggiornamento attende' : 'aggiornamenti attendono'} che StudyHub li legga` : '';
    }
  },
  init() {
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href="#/studyhub"]');
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      if (a.hasAttribute('data-sh-open')) this.open(); else this.toggle();
    });
    window.addEventListener('resize', () => { if (this.isOpen()) this.apply(); });
    window.addEventListener('storage', e => { if (e.key === Bridge.OUT || e.key === Bridge.ACK) this.refresh(); });
    this.refresh();
    // sul PC riapre il pannello se l’avevi lasciato aperto
    if (this.prefs().open && this.wide()) this.open();
  }
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') init();
