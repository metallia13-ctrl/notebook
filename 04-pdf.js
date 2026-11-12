'use strict';
/* StudyHub Notebook — 04-pdf.js
   Lettore e libreria dei PDF.
   I moduli si caricano in ordine (vedi index.html) e condividono le stesse variabili globali. */

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
  ['hl', 'Evidenzia', '<svg viewBox="0 0 24 24"><path d="M4 20h7M14 4l6 6-8 8H6v-6z"/></svg>', 'Evidenzia: seleziona il testo e si colora da solo. Nelle pagine scansionate trascina un riquadro'],
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
  const panelTabs = [['pages', 'Pagine'], ['marks', 'Segnalibri'], ['figs', 'Figure'], ['notes', 'Note'], ['search', 'Cerca'], ['drag', 'Trascina']];
  setView(`
    <div class="pdf-app" id="pdfApp">
      <header class="pdf-bar">
        <a class="btn ghost sm pdf-back" href="${back}" aria-label="Torna alla sezione">‹</a>
        <div class="pdf-title"><b>${esc(meta.name)}</b><small>${esc(sec ? sec.title : nbById(meta.notebookId)?.name || '')}</small></div>
        <label class="pdf-pageno"><span class="sr-only">Pagina</span><input class="input" id="pdfPage" type="number" inputmode="numeric" min="1" max="${meta.pages}" value="1"><span>/ ${meta.pages}</span></label>
        <button class="btn sm pdf-bm-btn" type="button" data-pdf="bookmark" aria-pressed="false" title="Segnalibro su questa pagina (B)">${ICON_BM}<span>Segnalibro</span></button>
        <a class="btn sm ghost pdf-split-btn" href="#/split" title="Apri di fianco una sezione o un altro PDF">⇆<span>Affianca</span></a>
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
  const goTo = (n, { flash = false, y = 0 } = {}) => {
    n = Math.max(1, Math.min(meta.pages, Math.round(n) || 1));
    const el = pageEl(n);
    if (!el) return;
    // y: punto della pagina (da 0 in alto a 1 in fondo), per i segnalibri messi a metà pagina
    scroller.scrollTop = pageTop(el) + Math.max(0, Math.min(1, +y || 0)) * el.offsetHeight - (y ? 60 : 8);
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
      // senza testo è una scansione: lì gli strumenti di testo segnano un riquadro
      el.dataset.text = tc.items.some(i => String(i.str || '').trim()) ? '1' : '0';
    } catch { el.dataset.text = '0'; }
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
    <button type="button" class="rt-btn" data-ps="bm" title="Segnalibro con questo testo come nome">Segnalibro</button>
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
  let lastSelAt = 0;
  let hideTimer = null;
  const textTool = () => ['hl', 'ul', 'st'].includes(R.tool);
  const barTool = () => R.tool === 'select' || (textTool() && SelGesture.lastType !== 'mouse');
  const pdfStable = stableSelection(bar, () => { if (!barTool()) return false; const s = readSelection(); if (s) lastSel = s; lastSelAt = Date.now(); return !!s; }, {
    // nel PDF le pagine occupano tutto: la barra va in alto, sotto gli strumenti
    place: () => { const r = scroller.getBoundingClientRect(); bar.classList.add('rt-top'); bar.style.top = `${Math.round(r.top + 8)}px`; bar.style.left = `${Math.round(r.left + r.width / 2)}px`; }
  });
  addCleanup(() => pdfStable.done());
  const onSel = () => {
    if (!barTool()) return;
    const s = readSelection();
    if (s) { clearTimeout(hideTimer); lastSel = s; lastSelAt = Date.now(); pdfStable.changed(); }
    else if (!bar.hidden) { pdfStable.cancel(); clearTimeout(hideTimer); hideTimer = setTimeout(() => { bar.hidden = true; }, 600); }
    else pdfStable.cancel();
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
    if (kind === 'bm') { await addBookmark(s.firstPage, s); return; }
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
    if (R.tool !== 'select' || SelGesture.touchy()) return;
    const s = readSelection();
    if (!s) return;
    e.preventDefault();
    lastSel = s; lastSelAt = Date.now();
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
  // v3.45: con il mouse evidenzia appena rilasci; con la penna quando la alzi dopo aver
  // trascinato; col dito (pressione lunga e maniglie) non evidenzia più da solo a metà:
  // compare la barra con i colori e scegli tu quando.
  pagesEl.addEventListener('mouseup', () => { if (SelGesture.lastType !== 'mouse') return; clearTimeout(textToolTimer); textToolTimer = setTimeout(applyTextTool, 30); });
  // con la penna: se hai trascinato evidenzio subito; se hai solo tenuto premuto
  // (poi allarghi con le maniglie) aspetto che tu scelga il colore dalla barra
  let penFrom = null;
  pagesEl.addEventListener('pointerdown', e => { penFrom = e.pointerType === 'pen' ? [e.clientX, e.clientY] : null; }, true);
  pagesEl.addEventListener('pointerup', e => {
    if (e.pointerType !== 'pen' || !penFrom) return;
    const dragged = Math.hypot(e.clientX - penFrom[0], e.clientY - penFrom[1]) > 12;
    penFrom = null;
    if (!dragged) return;
    // timer a parte: il selectionchange che arriva subito dopo non deve annullarlo
    setTimeout(applyTextTool, 60);
  });
  document.addEventListener('selectionchange', () => {
    if (!['hl', 'ul', 'st'].includes(R.tool)) return;
    clearTimeout(textToolTimer);
    if (SelGesture.lastType === 'mouse') textToolTimer = setTimeout(applyTextTool, 1100);
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
    // v3.56: pagine scansionate (senza testo): Evidenzia, Sottolinea e Barra segnano un riquadro
    if (['hl', 'ul', 'st'].includes(R.tool) && el.dataset.text === '0') {
      if (e.pointerType === 'touch' && R.penSeen) { pan = { id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
      if (e.button > 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const svg = el.querySelector('svg.pdf-ann') || (drawAnnots(+el.dataset.p), el.querySelector('svg.pdf-ann'));
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('class', 'ann-area live');
      r.setAttribute('fill', pdfCol(R.color));
      svg.append(r);
      ink = { id: e.pointerId, el, occ: r, p0: pointInPage(el, e), area: R.tool };
      return;
    }
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
      if (e.button > 0 && !penErases(e)) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      if (R.tool === 'eraser' || penErases(e)) {
        // con la gomma della penna i tratti diventano “toccabili” solo per la durata del gesto
        ink = { eraser: true, id: e.pointerId, restore: R.tool !== 'eraser' ? R.tool : null };
        if (ink.restore) app.dataset.tool = 'eraser';
        eraseAt(e);
        return;
      }
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
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
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
    if (cur.eraser) { if (cur.restore) app.dataset.tool = cur.restore; return; }
    if (cur.shape) {
      cur.shape.remove();
      const [x1, y1, x2, y2] = cur.box;
      if (Math.hypot(x2 - x1, y2 - y1) > 6) addAnnots([{ id: uid(), type: 'shape', kind: R.shape, page: +cur.el.dataset.p, box: cur.box.map(v => +v.toFixed(2)), color: R.ink, w: Math.min(R.inkW, 4), created: Date.now() }]);
      return;
    }
    if (cur.occ) {
      cur.occ.remove();
      if (cur.area) { if (cur.box && cur.box[2] > 4 && cur.box[3] > 2) addAnnots([{ id: uid(), type: cur.area, color: R.color, page: +cur.el.dataset.p, rects: [cur.box], text: '', created: Date.now() }]); return; }
      if (cur.box && cur.box[2] > 6 && cur.box[3] > 4) addAnnots([{ id: uid(), type: 'occ', page: +cur.el.dataset.p, rects: [cur.box], created: Date.now() }]);
      return;
    }
    cur.path.remove();
    addAnnots([{ id: uid(), type: 'ink', page: +cur.el.dataset.p, color: R.ink, w: R.inkW, pts: cur.pts, created: Date.now() }]);
  };
  pagesEl.addEventListener('pointerup', endInk);
  pagesEl.addEventListener('pointercancel', endInk);
  pagesEl.addEventListener('contextmenu', e => { if (R.tool === 'pen' || R.tool === 'eraser') e.preventDefault(); });
  twoFingerTap(pagesEl, () => undo(), () => (R.tool === 'pen' || R.tool === 'eraser') && R.penSeen);
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
    btn.querySelector('span').textContent = has ? `Segnato (${meta.bookmarks.filter(b => b.page === R.cur).length})` : 'Segnalibro';
    btn.title = has ? 'Aggiunge un altro segnalibro in questa pagina (B); col testo selezionato, il nome è quel testo' : 'Segnalibro su questa pagina (B); col testo selezionato, il nome è quel testo';
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
  // v3.69: ogni tocco aggiunge un segnalibro (anche più d’uno nella stessa pagina), nel punto
  // in cui sei; il nome è il testo selezionato, se c’è. Niente finestra: si rinomina dal messaggio.
  const sortBm = () => meta.bookmarks.sort((x, y) => x.page - y.page || (x.y || 0) - (y.y || 0));
  const addBookmark = async (n = R.cur, sel = null) => {
    let title = '', y = 0;
    if (sel && sel.text) {
      n = sel.firstPage;
      title = sel.text.replace(/\s+/g, ' ').trim().slice(0, 120);
      const r = (sel.byPage.get(n) || [])[0];
      if (r) y = Math.max(0, Math.min(1, r[1] / sizeOf(n).height));
    } else {
      const el = pageEl(n);
      if (el) y = Math.max(0, Math.min(0.95, (scroller.scrollTop - pageTop(el)) / el.offsetHeight));
      title = await bookmarkTitle(n);
      if (meta.bookmarks.some(b => b.page === n && b.title === title)) title = `${title} (segue)`;
    }
    const b = { id: uid(), page: n, y: +y.toFixed(3), title: title || `Pagina ${n}`, created: Date.now() };
    meta.bookmarks.push(b);
    sortBm();
    saveSoon();
    refreshBm();
    toast(`Segnalibro “${b.title.slice(0, 60)}${b.title.length > 60 ? '…' : ''}” a pagina ${n}`, '', { label: 'Rinomina', fn: () => renameBookmark(b) });
  };
  const deleteBookmark = id => {
    const ex = meta.bookmarks.find(b => b.id === id);
    if (!ex) return;
    meta.bookmarks = meta.bookmarks.filter(b => b !== ex);
    markGone(meta, [ex.id]);
    saveSoon();
    refreshBm();
    toast(`Segnalibro “${ex.title.slice(0, 50)}” tolto`, '', { label: 'Annulla', fn: () => { unGone(meta, [ex.id]); meta.bookmarks.push(ex); sortBm(); saveSoon(); refreshBm(); } });
  };
  // il testo selezionato nel PDF, anche se toccando il pulsante la selezione è appena sparita
  const selForBm = () => {
    const s0 = readSelection() || (R.bmSel && Date.now() - R.bmSel.t < 5000 ? R.bmSel.s : null);
    R.bmSel = null;
    return s0;
  };
  // la selezione si legge appena tocchi il pulsante, prima che il tocco la faccia sparire
  app.addEventListener('pointerdown', e => {
    if (e.target.closest('[data-pdf="bookmark"], [data-pm="add"]')) { const s1 = readSelection(); R.bmSel = s1 ? { s: s1, t: Date.now() } : null; }
  }, true);

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
    ({ pages: drawThumbs, marks: drawMarks, figs: drawFigs, notes: drawNotes, search: drawSearch, drag: drawDrag }[R.tab] || drawMarks)();
  };

  function drawMarks() {
    panelBody.innerHTML = `
      ${meta.bookmarks.length > 3 ? `<input type="search" class="input search pdf-bm-q" id="bmQ" placeholder="Cerca tra i segnalibri e l’indice" aria-label="Cerca tra i segnalibri">` : ''}
      <button class="btn sm block" type="button" data-pm="add">Aggiungi un segnalibro qui (pagina ${R.cur})</button>
      ${meta.bookmarks.length ? `<button class="btn sm block" type="button" data-bmall>Collega i segnalibri alle sezioni</button>` : ''}
      ${meta.bookmarks.length ? `<ul class="pdf-plist">${meta.bookmarks.map(b => {
        const linked = refsOfBookmark(meta.id, b.id);
        return `
        <li class="${linked.length ? 'has-sec' : ''}"><button type="button" class="pdf-pitem ${b.page === R.cur ? 'cur' : ''}" data-go="${b.page}" data-goy="${b.y || 0}">
          <span class="pdf-bm-ic">${ICON_BM}</span><span class="pdf-pitem-t">${esc(b.title)}</span><span class="pdf-pitem-p">p. ${b.page}</span></button>
          <button type="button" class="btn sm ghost" data-bmlink="${b.id}" aria-label="Collega a una sezione" title="Collega a una sezione del notebook">🔗</button>
          <button type="button" class="btn sm ghost" data-bmren="${b.id}" aria-label="Rinomina">✎</button>
          <button type="button" class="btn sm ghost" data-bmdel="${b.id}" aria-label="Elimina">✕</button>
          ${linked.length ? `<div class="bm-secs">${linked.map(x => `<a class="bm-sec" href="#/sec/${x.id}">→ ${esc(x.title)}</a>`).join('')}</div>` : ''}</li>`;
      }).join('')}</ul>`
        : '<p class="hint">Nessun segnalibro. Seleziona un titolo o una frase e tocca “Segnalibro” (nella barra della selezione o in alto, o premi B): il nome sarà quel testo. Puoi metterne quanti vuoi nella stessa pagina.</p>'}
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
      ? `<button class="btn sm block" type="button" data-olbm>Trasforma l’indice in segnalibri</button>
        <ul class="pdf-plist outline">${flat.map(({ it, d }, i) => `<li style="--d:${d}"><button type="button" class="pdf-pitem" data-ol="${i}"><span class="pdf-pitem-t">${esc(String(it.title || '').trim() || 'Senza titolo')}</span></button></li>`).join('')}</ul>`
      : '<p class="hint">Questo PDF non ha un indice: i segnalibri li crei tu, pagina per pagina.</p>';
    const pageOf = async it => {
      let dest = it.dest;
      if (typeof dest === 'string') dest = await R.doc.getDestination(dest);
      if (!Array.isArray(dest) || !dest[0]) return null;
      const ref = dest[0];
      return (typeof ref === 'number' ? ref : await R.doc.getPageIndex(ref)) + 1;
    };
    box.onclick = async e => {
      if (e.target.closest('[data-olbm]')) {
        // l’indice interno del PDF diventa segnalibri dell’app, da collegare poi alle sezioni
        const deep = flat.some(x => x.d > 0);
        const lvl = deep ? await actionSheet('Quali voci dell’indice?', [{ key: '0', label: 'Solo i capitoli (primo livello)' }, { key: '1', label: 'Capitoli e paragrafi' }]) : '0';
        if (lvl === null || lvl === undefined) return;
        const have = new Set(meta.bookmarks.map(b => b.page));
        let n = 0;
        for (const { it, d } of flat) {
          if (d > +lvl) continue;
          let pg = null;
          try { pg = await pageOf(it); } catch { pg = null; }
          if (!pg || have.has(pg)) continue;
          have.add(pg);
          meta.bookmarks.push({ id: uid(), page: pg, title: String(it.title || '').trim().slice(0, 120) || `Pagina ${pg}`, created: Date.now() + n });
          n++;
        }
        meta.bookmarks.sort((x, y) => x.page - y.page);
        saveSoon();
        refreshBm();
        toast(n ? `${n} segnalibri creati dall’indice: ora puoi collegarli alle sezioni` : 'Le pagine dell’indice hanno già un segnalibro');
        refreshPanel('marks');
        return;
      }
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

  // v3.39: galleria delle figure del PDF, trovate pagina per pagina
  function drawFigs() {
    if (!R.figs) R.figs = { list: [], next: 1, busy: false, done: false };
    const F = R.figs;
    panelBody.innerHTML = `
      <p class="hint" id="figHint"></p>
      <div class="fig-grid" id="figGrid"></div>
      <button class="btn sm block" type="button" id="figMore" hidden>Continua a cercare</button>`;
    const grid = $('#figGrid', panelBody);
    const hint = $('#figHint', panelBody);
    const thumbIo = new IntersectionObserver(ens => ens.forEach(en => { if (en.isIntersecting) { thumbIo.unobserve(en.target); drawFigThumb(en.target); } }), { root: panelBody, rootMargin: '300px 0px' });
    R.thumbIo = thumbIo;
    const tile = (f, k) => `<button type="button" class="fig-tile" data-fig="${k}" aria-label="Figura a pagina ${f.page}"><canvas></canvas><span class="fig-p">p. ${f.page}</span></button>`;
    const addTiles = from => {
      grid.insertAdjacentHTML('beforeend', F.list.slice(from).map((f, i) => tile(f, from + i)).join(''));
      $$('.fig-tile:not([data-obs])', grid).forEach(t => { t.dataset.obs = '1'; thumbIo.observe(t); });
    };
    const paintHint = () => {
      hint.textContent = F.done
        ? (F.list.length ? `${F.list.length} figure in ${meta.pages} pagine. Tocca una figura per aggiungerla a una sezione o farne l’esercizio delle etichette.` : 'Non ho trovato figure in questo PDF: se è una scansione o le slide sono immagini intere, usa “Figura da PDF” in Modifica per ritagliarle a mano.')
        : `Cerco le figure: pagina ${Math.min(F.next, meta.pages)} di ${meta.pages}${F.list.length ? `, ${F.list.length} trovate` : ''}…`;
    };
    addTiles(0);
    paintHint();
    const scan = async () => {
      if (F.busy || F.done) return;
      F.busy = true;
      const stopAt = Math.min(meta.pages, F.next + 59);
      while (F.next <= stopAt) {
        if (R.tab !== 'figs' || !grid.isConnected) { F.busy = false; return; }
        const n = F.next++;
        try {
          const { boxes } = await findPageImages(R.doc, n);
          const before = F.list.length;
          boxes.forEach(b => F.list.push({ page: n, box: b }));
          if (F.list.length > before) addTiles(before);
        } catch { /* pagina illeggibile */ }
        if (n % 5 === 0) paintHint();
      }
      F.busy = false;
      if (F.next > meta.pages) F.done = true;
      paintHint();
      const more = $('#figMore', panelBody);
      if (more) more.hidden = F.done;
    };
    $('#figMore', panelBody).onclick = () => { $('#figMore', panelBody).hidden = true; scan(); };
    scan();
    grid.onclick = async e => {
      const t = e.target.closest('[data-fig]');
      if (!t) return;
      const f = F.list[+t.dataset.fig];
      const choice = await actionSheet(`Figura di pagina ${f.page}`, [
        { key: 'go', label: 'Vai alla pagina' },
        { key: 'add', label: 'Aggiungi a una sezione' },
        { key: 'labels', label: 'Aggiungi a una sezione e fai l’esercizio delle etichette' },
        { key: 'side', label: 'Apri la pagina di fianco' },
        { key: 'save', label: 'Scarica l’immagine' }
      ]);
      if (choice === 'go') { goTo(f.page, { flash: true }); if (window.innerWidth < 900) closePanel(); return; }
      if (choice === 'side') { Split.show({ kind: 'pdf', id: meta.id, page: f.page }); return; }
      if (!choice) return;
      const cv = await figCanvas(f, 1600);
      if (!cv) { toast('Non riesco a ritagliare questa figura', 'err'); return; }
      if (choice === 'save') { cv.toBlob(b => downloadBlob(b, `${meta.name} p${f.page}.jpg`), 'image/jpeg', 0.9); return; }
      const sec = await pickSectionSheet('Aggiungi la figura a…', meta.sectionId);
      if (!sec) return;
      const im = await saveImage(await canvasToImage(cv, 0.9), sec.notebookId);
      await appendImagesUnder(sec, 'Figure dal PDF', [imageMd(im.id, `${meta.name}, pagina ${f.page}`)]);
      if (choice === 'labels') openLabelEditor(sec, im.id);
      else toast(`Figura aggiunta a “${sec.title}”`, '', { label: 'Apri', fn: () => go(`#/sec/${sec.id}/read`) });
    };
  }
  // ritaglio di una figura dalla sua pagina, alla larghezza voluta
  async function figCanvas(f, width) {
    try {
      const page = await R.doc.getPage(f.page);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(4, Math.max(0.2, width / Math.max(1, f.box.w * base.width)));
      const vp = page.getViewport({ scale });
      const full = document.createElement('canvas');
      full.width = Math.round(vp.width);
      full.height = Math.round(vp.height);
      const ctx = full.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, full.width, full.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const sx = Math.round(f.box.x * full.width), sy = Math.round(f.box.y * full.height);
      const sw = Math.max(1, Math.round(f.box.w * full.width)), sh = Math.max(1, Math.round(f.box.h * full.height));
      const out = document.createElement('canvas');
      out.width = sw;
      out.height = sh;
      out.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
      return out;
    } catch { return null; }
  }
  async function drawFigThumb(tileEl) {
    const f = R.figs?.list[+tileEl.dataset.fig];
    if (!f) return;
    const cv = await figCanvas(f, 260);
    if (!cv || !tileEl.isConnected) return;
    $('canvas', tileEl).replaceWith(cv);
    tileEl.classList.add('ok');
  }

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
      goTo(+goB.dataset.go, { flash: true, y: +(goB.dataset.goy || 0) });
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
    if (pm) { await addBookmark(R.cur, selForBm()); return; }
    const ren = e.target.closest('[data-bmren]');
    if (ren) { const b = meta.bookmarks.find(x => x.id === ren.dataset.bmren); if (b) renameBookmark(b); return; }
    const bl = e.target.closest('[data-bmlink]');
    if (bl) {
      const b = meta.bookmarks.find(x => x.id === bl.dataset.bmlink);
      if (!b) return;
      const s2 = await pdfBmLinkSheet(meta, b);
      if (s2) { toast(`“${b.title}” collegato a “${s2.title}”`); refreshPanel('marks'); }
      return;
    }
    if (e.target.closest('[data-bmall]')) {
      const n = await pdfBmBulkSheet(meta);
      if (n) { toast(`${n} ${n === 1 ? 'segnalibro collegato' : 'segnalibri collegati'} alle sezioni`); refreshPanel('marks'); }
      return;
    }
    const del = e.target.closest('[data-bmdel]');
    if (del) { deleteBookmark(del.dataset.bmdel); return; }
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
    // il punto tra le dita, misurato prima dello zoom
    scroller.scrollTop = p.st;
    scroller.scrollLeft = p.sl;
    zoomTo(p.z0 * p.k, anchorAt(p.mx, p.my));
  };
  scroller.addEventListener('touchend', endPinch);
  scroller.addEventListener('touchcancel', endPinch);
  scroller.addEventListener('wheel', e => {
    if (!e.ctrlKey || !R.doc) return;
    e.preventDefault();
    const r = scroller.getBoundingClientRect();
    zoomTo(R.zoom * Math.exp(-e.deltaY * 0.01), anchorAt(e.clientX - r.left, e.clientY - r.top));
  }, { passive: false });
  // v3.45: lo zoom resta ancorato al punto della pagina sotto le dita o il puntatore.
  // Prima moltiplicava lo scorrimento per lo zoom, ma gli spazi tra le pagine non
  // si ingrandiscono: più si era avanti nel PDF, più si saltava di pagine.
  const anchorAt = (mx, my) => {
    const y = scroller.scrollTop + my;
    const els = pagesEl.children;
    let lo = 0, hi = els.length - 1, ans = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (els[mid].offsetTop <= y) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    const el = els[ans];
    if (!el) return null;
    return { n: +el.dataset.p, fy: (y - el.offsetTop) / Math.max(1, el.offsetHeight), fx: (scroller.scrollLeft + mx - el.offsetLeft) / Math.max(1, el.offsetWidth), mx, my };
  };
  const restoreAnchor = a => {
    const el = a && pageEl(a.n);
    if (!el) return;
    scroller.scrollTop = el.offsetTop + a.fy * el.offsetHeight - a.my;
    scroller.scrollLeft = Math.max(0, el.offsetLeft + a.fx * el.offsetWidth - a.mx);
  };
  const zoomTo = (z, anchor) => {
    const a = anchor || anchorAt(scroller.clientWidth / 2, scroller.clientHeight * 0.35);
    R.zoom = Math.max(0.5, Math.min(3, +z.toFixed(3)));
    meta.zoom = R.zoom;
    saveSoon();
    applySizes();
    restoreAnchor(a);
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
    if (act === 'bookmark') addBookmark(R.cur, selForBm());
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
    if (e.key === 'b' || e.key === 'B') { e.preventDefault(); addBookmark(R.cur, selForBm()); }
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
    // se Affianca mostrava lo stesso PDF, gli do una copia sua prima di chiudere questa
    if (PdfShared.doc === R.doc) { PdfShared.id = ''; PdfShared.doc = null; }
    if (Split.pdf && Split.pdf.shared && Split.pdf.doc === R.doc) { const it = { ...Split.item, page: Split.curPage || Split.item.page }; Split.pdf = null; setTimeout(() => Split.show(it), 0); }
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
      PdfShared.id = meta.id;
      PdfShared.doc = doc;
      if (doc.numPages !== meta.pages) { meta.pages = doc.numPages; saveSoon(); }
      const p1 = await doc.getPage(1);
      R.base = p1.getViewport({ scale: 1 });
      R.sizes[1] = { width: R.base.width, height: R.base.height };
      pagesEl.innerHTML = Array.from({ length: doc.numPages }, (_, i) => `<div class="pdf-page" data-p="${i + 1}"><span class="pdf-pn" aria-hidden="true">${i + 1}</span><span class="pdf-flag" aria-hidden="true">${ICON_BM}</span></div>`).join('');
      applySizes();
      new Set(meta.annots.map(a => a.page)).forEach(drawAnnots);
      refreshBm();
      const start = +pageParam || meta.lastPage || 1;
      const refHint = PdfRefHint.take(meta.id);
      if (refHint) setTimeout(() => toast(`${pagesTxt(refHint.from, refHint.to)}: le pagine di “${refHint.title}”`), 400);
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
      { key: 'side', label: 'Apri di fianco' },
      { key: 'figs', label: 'Galleria delle figure' },
      { key: 'rename', label: 'Rinomina' },
      { key: 'move', label: 'Sposta in un altro notebook o sezione' },
      { key: 'delete', label: 'Elimina il PDF', danger: true }
    ]);
    if (choice === 'open') go(`#/pdf/${p.id}`);
    if (choice === 'side') Split.show({ kind: 'pdf', id: p.id });
    if (choice === 'figs') { S().pdfPanel = 'figs'; Settings.save(); go(`#/pdf/${p.id}`); }
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
      : sec && pdfRefsOf(sec).length ? '' : `<div class="empty"><p>${sec ? 'Nessun PDF in questa sezione. Puoi anche collegarle le pagine di un PDF più grande dai suoi segnalibri (pannello Segnalibri del lettore, 🔗).' : 'Nessun PDF ancora. Caricane uno e scegli il notebook o la sezione a cui appartiene.'}</p></div>`}
    ${sec && pdfRefsOf(sec).length ? `<h2 class="sub">Pagine collegate da altri PDF</h2>${pdfRefsBlockHtml(sec).replace('<section class="fonti pdf-refs"', '<section class="pdf-refs pr-plain"')}` : ''}
    ${Sync.configured() ? '<p class="hint">Con la sincronizzazione attiva i PDF vanno anche su Drive e li ritrovi sugli altri dispositivi.</p>' : '<p class="hint">Attiva la sincronizzazione con Drive per ritrovare i PDF sugli altri dispositivi.</p>'}`);
  bindPdfRows($('#view'));
  if (sec) bindPdfRefsBlock($('#view'), sec);
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

