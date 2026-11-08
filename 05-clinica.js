'use strict';
/* StudyHub Notebook — 05-clinica.js
   Materie cliniche: glossario e note cliniche, diagnosi differenziale, sezioni speciali (microbiologia, atlanti, farmacologia, diario), score, domande d’esame, semeiotica, laboratorio, casi clinici.
   I moduli si caricano in ordine (vedi index.html) e condividono le stesse variabili globali. */

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
// v3.54: note cliniche più ricche. Tutti i campi sono facoltativi: le note di prima
// restano come sono (il testo libero è il campo “Note”).
const CN_DX_KINDS = [['', '—'], ['clinica', 'Clinica'], ['laboratorio', 'Di laboratorio'], ['strumentale', 'Strumentale (imaging)'], ['istologica', 'Istologica'], ['mista', 'Clinica e strumentale']];
const cnVal = (n, k) => String((n && n[k]) || '').trim();
const cnFilled = (n, keys) => keys.some(k => cnVal(n, k));
function cnSearchLinks(title) {
  const q = encodeURIComponent(title);
  return [
    ['Orphanet', `https://www.google.com/search?q=site%3Aorpha.net+${q}`],
    ['MSD Manuals', `https://www.google.com/search?q=site%3Amsdmanuals.com%2Fit-it+${q}`],
    ['PubMed', `https://pubmed.ncbi.nlm.nih.gov/?term=${q}`],
    ['Linee guida', `https://www.google.com/search?q=linee+guida+${q}`]
  ];
}
/* ---------- v3.58: algoritmi nelle note cliniche ----------
   Si scrivono come un elenco con i rientri (un passo per riga, i rami rientrati
   sotto); “Sì: …”, “No: …” o “Se …: …” all’inizio di un ramo diventano
   l’etichetta della freccia. L’app li disegna come diagramma dall’alto in basso. */
function algoTree(md, title) {
  const tree = mdToMapTree(md, title || 'Algoritmo');
  // un solo passo di partenza: è lui la cima del diagramma
  if (tree.c && tree.c.length === 1 && !tree.n) return tree.c[0];
  return tree;
}
function algoSvg(md, title) {
  const root = algoTree(md, title);
  if (!root || !root.t) return '';
  const GX = 22, GY = 58, MAXW = 170;
  const lay = (n, depth) => {
    let t = String(n.t || '').trim();
    let edge = '';
    const m = t.match(/^((?:sì|si|no|se [^:]{1,40}|[<>≤≥=][^:]{0,20}|[^:]{1,32}))\s*:\s*(.+)$/i);
    if (depth > 0 && m && m[1].length <= 42) { edge = m[1].trim(); t = m[2].trim(); }
    const w = mapWrap(t || ' ', MAXW);
    const node = { t, edge, q: /\?\s*$/.test(t), lines: w.lines, w: Math.ceil(w.width) + 22, h: w.lines.length * 18 + 14, depth, kids: (n.c || []).map(k => lay(k, depth + 1)) };
    node.sub = node.kids.length ? Math.max(node.w, node.kids.reduce((a, k) => a + k.sub, 0) + GX * (node.kids.length - 1)) : node.w;
    return node;
  };
  const r = lay(root, 0);
  const rowH = [];
  const meas = n => { rowH[n.depth] = Math.max(rowH[n.depth] || 0, n.h); n.kids.forEach(meas); };
  meas(r);
  const rowY = [16];
  for (let d = 1; d < rowH.length; d++) rowY[d] = rowY[d - 1] + rowH[d - 1] + GY;
  const place = (n, left) => {
    n.x = left + n.sub / 2 - n.w / 2;
    n.y = rowY[n.depth];
    let x = left + (n.sub - (n.kids.reduce((a, k) => a + k.sub, 0) + GX * Math.max(0, n.kids.length - 1))) / 2;
    n.kids.forEach(k => { place(k, x); x += k.sub + GX; });
  };
  place(r, 16);
  const W = r.sub + 32, H = rowY[rowY.length - 1] + rowH[rowH.length - 1] + 20;
  const links = [], boxes = [];
  const walk = n => {
    n.kids.forEach(k => {
      const x1 = n.x + n.w / 2, y1 = n.y + n.h, x2 = k.x + k.w / 2, y2 = k.y;
      const my = (y1 + y2) / 2;
      links.push(`<path d="M${x1} ${y1}C${x1} ${my} ${x2} ${my} ${x2} ${y2 - 6}" marker-end="url(#algoArrow)"/>`);
      // l’etichetta sta subito sopra il riquadro a cui porta, larga al massimo quanto il suo spazio
      if (k.edge) {
        const room = Math.max(40, k.sub + GX - 6);
        let lab = k.edge;
        while (lab.length > 3 && lab.length * 6.6 + 16 > room) lab = lab.slice(0, -1);
        if (lab !== k.edge) lab = `${lab.trim()}…`;
        const lw = Math.min(room, lab.length * 6.6 + 16);
        links.push(`<g class="al-edge" transform="translate(${x2} ${y2 - 22})"><title>${esc(k.edge)}</title><rect x="${-lw / 2}" y="-10" width="${lw}" height="20" rx="10"/><text text-anchor="middle" y="4">${esc(lab)}</text></g>`);
      }
      walk(k);
    });
    boxes.push(`<g class="al-node ${n.q ? 'q' : ''} ${n.kids.length ? '' : 'end'} ${n.depth === 0 ? 'al-top' : ''}" transform="translate(${n.x} ${n.y})"><rect width="${n.w}" height="${n.h}" rx="${n.q ? 14 : 8}"/>${n.lines.map((l, i) => `<text x="${n.w / 2}" text-anchor="middle" y="${20 + i * 18}">${esc(l)}</text>`).join('')}</g>`);
  };
  walk(r);
  return `<div class="algo-scroll" data-w="${W}" title="Tocca per ingrandire o rimpicciolire"><svg class="algo-svg" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-width:${W}px;min-width:${Math.round(W * 0.62)}px" role="img" aria-label="Algoritmo: ${esc(r.t)}"><defs><marker id="algoArrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs><g class="al-links">${links.join('')}</g>${boxes.join('')}</svg></div>`;
}
const ALGO_EXAMPLE = `- Sospetta embolia polmonare: Wells
  - Probabilità bassa o intermedia: D-dimero
    - Negativo: embolia esclusa
    - Positivo: angio-TC
  - Probabilità alta: angio-TC
    - Positiva: terapia anticoagulante
    - Negativa: cerca altre cause`;

function clinicSheet(entry = null, prefill = {}) {
  return new Promise(resolve => {
    const e = entry || {};
    const syms = e.symptoms || prefill.symptoms || [];
    const all = clinicalNotes();
    const known = [...new Set(all.flatMap(n => n.symptoms || []))].filter(s => !syms.includes(s)).slice(0, 16);
    const specs = [...new Set(all.map(n => n.specialty).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
    const sec = secById(e.sectionId || prefill.sectionId);
    let ddx = [...(e.ddx || [])];
    const ta = (id, label, val, rows = 2, ph = '') => `<label class="field"><span>${label}</span><textarea class="input" id="${id}" rows="${rows}" placeholder="${esc(ph)}">${esc(val || '')}</textarea></label>`;
    const inp = (id, label, val, ph = '') => `<label class="field"><span>${label}</span><input class="input" id="${id}" value="${esc(val || '')}" placeholder="${esc(ph)}"></label>`;
    const group = (title, keys, html) => `<details class="cn-group" ${cnFilled(e, keys) ? 'open' : ''}><summary>${title}</summary>${html}</details>`;
    const sh = openSheet(`
      <h2>${entry ? 'Modifica la nota clinica' : 'Nuova nota clinica'}</h2>
      ${sec ? `<p class="sheet-sub">Collegata a ${esc(sec.title)}</p>` : ''}
      <label class="field"><span>Quadro clinico o malattia</span><input class="input" id="cnTitle" value="${esc(e.title || prefill.title || '')}" placeholder="Es. Scompenso cardiaco sinistro"></label>
      <label class="field"><span>Sintomi e segni, separati da virgole</span><input class="input" id="cnSyms" value="${esc(syms.join(', '))}" placeholder="Es. dispnea, ortopnea, rantoli" autocomplete="off" autocapitalize="off"></label>
      ${known.length ? `<div class="tag-suggest" data-for="cnSyms"><span class="hint">Già usati:</span>${known.map(t => `<button type="button" class="tag" data-addtag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      <div class="grid2">
        <label class="field"><span>Materia</span>${nbSelectHtml('cnNb', e.nbId || prefill.nbId || '')}</label>
        <label class="field"><span>Specialità di riferimento</span><input class="input" id="cnSpec" value="${esc(e.specialty || '')}" list="cnSpecs" placeholder="Es. Cardiologia"><datalist id="cnSpecs">${specs.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
      </div>
      <p class="hint">Gli altri campi sono tutti facoltativi: aprili quando ti servono.</p>
      ${group('Epidemiologia', ['incidence', 'prevalence', 'epiAge', 'risk'], `
        <div class="grid2">${inp('cnInc1', 'Incidenza', e.incidence, 'Es. 1-2 casi ogni 1000 all’anno')}${inp('cnPrev', 'Prevalenza', e.prevalence, 'Es. 1-2% degli adulti')}</div>
        ${inp('cnAge', 'Età e sesso più colpiti', e.epiAge, 'Es. oltre i 65 anni, più negli uomini')}
        ${ta('cnRisk', 'Fattori di rischio', e.risk, 2)}
        ${inp('cnExempt', 'Codice di esenzione o malattia rara', e.exempt, 'Es. 0A02, RF0100')}`)}
      ${group('Diagnosi', ['dxKind', 'dxCriteria', 'dxFirst', 'dxSecond', 'dxGold'], `
        <label class="field"><span>La diagnosi è</span><select class="input" id="cnDxKind">${CN_DX_KINDS.map(([k, l]) => `<option value="${k}" ${e.dxKind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${ta('cnCrit', 'Criteri diagnostici', e.dxCriteria, 3, 'Es. criteri di Framingham: …')}
        <div class="grid2">${ta('cnFirst', 'Esami di primo livello', e.dxFirst, 2, 'Es. ECG, BNP, Rx torace')}${ta('cnSecond', 'Esami di secondo livello', e.dxSecond, 2, 'Es. ecocardiogramma')}</div>
        ${inp('cnGold', 'Esame di riferimento (gold standard)', e.dxGold)}`)}
      ${group('Diagnosi differenziale', ['ddxText'], `
        <div class="tags" id="cnDdx"></div>
        <input type="search" class="input" id="cnDdxQ" placeholder="＋ Collega un’altra nota clinica: scrivi il nome" autocomplete="off">
        <ul class="list pick-list sp-link-res" id="cnDdxRes"></ul>
        ${ta('cnDdxText', 'Come distinguerle, o altre diagnosi da considerare', e.ddxText, 2)}`)}
      ${group('Decorso', ['complications', 'prognosis', 'staging'], `
        ${ta('cnCompl', 'Complicanze', e.complications, 2)}
        ${ta('cnStage', 'Stadiazione o classificazione', e.staging, 2, 'Es. classi NYHA')}
        ${ta('cnProg', 'Prognosi', e.prognosis, 2)}`)}
      ${group('Terapia', ['therapy'], ta('cnTher', 'Terapia, anche in Markdown', e.therapy, 4, 'Es. - prima linea: …'))}
      <details class="cn-group" ${(e.algos || []).length ? 'open' : ''}><summary>Algoritmi</summary>
        <p class="hint">Un passo per riga con il trattino; i rami vanno rientrati sotto il passo da cui partono. “Sì: …”, “No: …” o “Se …: …” all’inizio di un ramo diventano l’etichetta della freccia; una domanda (con il ?) diventa un rombo arrotondato.</p>
        <div id="cnAlgos"></div>
        <button class="btn sm ghost" type="button" data-algo-add>＋ Aggiungi un algoritmo</button>
      </details>
      ${group('Note', ['body'], ta('cnBody', 'Note libere', e.body || prefill.body, 4))}
      ${group('Link e fonti', ['links'], `
        ${ta('cnLinks', 'Link utili, uno per riga (anche “Nome | indirizzo”)', (e.links || []).join('\n'), 2, 'Orphanet | https://www.orpha.net/…')}
        <label class="field"><span>Fonti, una per riga</span><textarea class="input" id="cnSrc" rows="2" placeholder="Harrison, cap. 270">${esc(sourcesOf(e).join('\n'))}</textarea></label>`)}
      <label class="check"><input type="checkbox" id="cnIncChk" ${e.incomplete ? 'checked' : ''}><span>Incompleta</span></label>
      <label class="field" id="cnIncBox" ${e.incomplete ? '' : 'hidden'}><span>Cosa manca? Facoltativo</span><input class="input" id="cnIncNote" value="${esc(e.incomplete?.note || '')}" placeholder="Es. manca la terapia"></label>
      <div class="modal-actions">
        ${entry ? '<button class="btn ghost danger" type="button" data-cn-act="del">Elimina</button>' : ''}
        <button class="btn ghost" type="button" data-cn-act="no">Annulla</button>
        <button class="btn primary" type="button" data-cn-act="ok">Salva</button>
      </div>`, { label: 'Nota clinica', onClose: resolve });
    bindTagField(sh.el, 'cnSyms');
    let algos = (e.algos || []).map(a => ({ ...a }));
    const drawAlgos = () => {
      $('#cnAlgos', sh.el).innerHTML = algos.map((a, i) => `<div class="cn-algo" data-ai="${i}">
        <div class="cn-algo-head"><input class="input" data-af="t" value="${esc(a.t || '')}" placeholder="Titolo, es. Algoritmo diagnostico" aria-label="Titolo dell’algoritmo"><button class="btn sm ghost" type="button" data-algo-del="${i}" aria-label="Togli l’algoritmo">✕</button></div>
        <textarea class="input algo-ta" data-af="md" rows="7" spellcheck="false" placeholder="${esc(ALGO_EXAMPLE)}">${esc(a.md || '')}</textarea>
        <div class="algo-prev" aria-live="polite">${a.md ? algoSvg(a.md, a.t) : ''}</div></div>`).join('');
    };
    const readAlgos = () => $$('.cn-algo', sh.el).forEach(box => { const a = algos[+box.dataset.ai]; $$('[data-af]', box).forEach(i => { a[i.dataset.af] = i.value; }); });
    drawAlgos();
    $('#cnAlgos', sh.el).addEventListener('input', ev => {
      const box = ev.target.closest('.cn-algo');
      if (!box) return;
      readAlgos();
      const a = algos[+box.dataset.ai];
      clearTimeout(box._t);
      box._t = setTimeout(() => { $('.algo-prev', box).innerHTML = a.md.trim() ? algoSvg(a.md, a.t) : ''; }, 250);
    });
    // nell’area dell’algoritmo, Tab rientra di un livello (Maiusc+Tab torna indietro)
    $('#cnAlgos', sh.el).addEventListener('keydown', ev => {
      if (ev.key !== 'Tab' || !ev.target.classList.contains('algo-ta')) return;
      ev.preventDefault();
      const ta = ev.target, s0 = ta.selectionStart, e0 = ta.selectionEnd;
      const start = ta.value.lastIndexOf('\n', s0 - 1) + 1;
      const end = ta.value.indexOf('\n', e0); const stop = end < 0 ? ta.value.length : end;
      const block = ta.value.slice(start, stop);
      const out = ev.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ');
      ta.setRangeText(out, start, stop, 'select');
      if (s0 === e0) { const d = out.length - block.length; ta.setSelectionRange(Math.max(start, s0 + (ev.shiftKey ? Math.max(d, -2) : 2)), Math.max(start, s0 + (ev.shiftKey ? Math.max(d, -2) : 2))); }
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    sh.el.addEventListener('click', ev => {
      if (ev.target.closest('[data-algo-add]')) { readAlgos(); algos.push({ t: algos.length ? '' : 'Algoritmo diagnostico', md: '' }); drawAlgos(); $$('.cn-algo .algo-ta', sh.el).pop()?.focus(); return; }
      const d = ev.target.closest('[data-algo-del]');
      if (d) { readAlgos(); algos.splice(+d.dataset.algoDel, 1); drawAlgos(); }
    });
    const drawDdx = () => {
      $('#cnDdx', sh.el).innerHTML = ddx.map(id => all.find(n => n.id === id)).filter(Boolean).map(n => `<span class="tag">${esc(n.title)} <button type="button" class="tag-x" data-unddx="${n.id}" aria-label="Togli ${esc(n.title)}">×</button></span>`).join('') || '<span class="hint">Nessuna nota collegata.</span>';
    };
    drawDdx();
    $('#cnDdxQ', sh.el).addEventListener('input', ev => {
      const f = foldAccents(ev.target.value.trim());
      const hits = f ? all.filter(n => n.id !== e.id && !ddx.includes(n.id) && foldAccents(`${n.title} ${(n.symptoms || []).join(' ')}`).includes(f)).slice(0, 8) : [];
      $('#cnDdxRes', sh.el).innerHTML = hits.map(n => `<li><button type="button" class="row" data-addddx="${n.id}"><span class="row-main"><span class="row-title">${esc(n.title)}</span><span class="row-sub">${esc((n.symptoms || []).slice(0, 5).join(', '))}</span></span></button></li>`).join('') || (f ? '<li class="hint">Nessuna nota con questo nome: creala dopo e collegala.</li>' : '');
    });
    sh.el.addEventListener('click', ev => {
      const a = ev.target.closest('[data-addddx]');
      if (a) { ddx.push(a.dataset.addddx); drawDdx(); $('#cnDdxQ', sh.el).value = ''; $('#cnDdxRes', sh.el).innerHTML = ''; return; }
      const r = ev.target.closest('[data-unddx]');
      if (r) { ddx = ddx.filter(x => x !== r.dataset.unddx); drawDdx(); }
    });
    $('#cnIncChk', sh.el).addEventListener('change', ev => { $('#cnIncBox', sh.el).hidden = !ev.target.checked; });
    $('[data-cn-act="no"]', sh.el).onclick = () => sh.close(false);
    const del = $('[data-cn-act="del"]', sh.el);
    if (del) del.onclick = async () => {
      if (!(await modal({ title: 'Eliminare la nota clinica?', text: `“${entry.title}” sparisce su tutti i tuoi dispositivi.`, confirm: 'Elimina', danger: true }))) return;
      await removeRecords([{ store: 'links', rec: entry }]);
      toast('Nota clinica eliminata');
      sh.close(true);
    };
    $('[data-cn-act="ok"]', sh.el).onclick = async () => {
      const title = $('#cnTitle', sh.el).value.trim();
      if (!title) { toast('Scrivi il quadro clinico'); $('#cnTitle', sh.el).focus(); return; }
      const rec = entry || { id: uid(), kind: 'clinical', notebookId: '_clinical', created: Date.now(), sectionId: prefill.sectionId || '' };
      const v = id => $(id, sh.el).value.trim();
      Object.assign(rec, {
        title, symptoms: parseTags($('#cnSyms', sh.el).value), nbId: $('#cnNb', sh.el).value || '', specialty: v('#cnSpec'),
        incidence: v('#cnInc1'), prevalence: v('#cnPrev'), epiAge: v('#cnAge'), risk: v('#cnRisk'), exempt: v('#cnExempt'),
        dxKind: $('#cnDxKind', sh.el).value, dxCriteria: v('#cnCrit'), dxFirst: v('#cnFirst'), dxSecond: v('#cnSecond'), dxGold: v('#cnGold'),
        ddx, ddxText: v('#cnDdxText'),
        complications: v('#cnCompl'), staging: v('#cnStage'), prognosis: v('#cnProg'),
        therapy: v('#cnTher'), body: v('#cnBody'),
        algos: ($$('.cn-algo', sh.el).forEach(box => { const a = algos[+box.dataset.ai]; $$('[data-af]', box).forEach(i => { a[i.dataset.af] = i.value; }); }), algos.filter(a => String(a.md || '').trim()).map(a => ({ t: String(a.t || '').trim(), md: a.md }))),
        links: $('#cnLinks', sh.el).value.split('\n').map(x => x.trim()).filter(Boolean)
      });
      rec.sources = $('#cnSrc', sh.el).value.split('\n').map(x => x.trim()).filter(Boolean);
      if ($('#cnIncChk', sh.el).checked) rec.incomplete = { note: v('#cnIncNote'), since: rec.incomplete?.since || todayStr() };
      else delete rec.incomplete;
      await saveLink(rec);
      // la diagnosi differenziale vale nei due sensi: la aggiungo anche alle note collegate
      for (const id of ddx) {
        const o = all.find(n => n.id === id);
        if (o && !(o.ddx || []).includes(rec.id)) { o.ddx = [...(o.ddx || []), rec.id]; await saveLink(o); }
      }
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
  const md = k => (cnVal(n, k) ? renderMd(n[k]) : '');
  const row = (label, html) => (html ? `<div class="cn-row"><h3>${label}</h3><div class="notes">${html}</div></div>` : '');
  const ddxNotes = (n.ddx || []).map(x => state.links.find(l => l.id === x && l.kind === 'clinical')).filter(Boolean);
  const mine = new Set((n.symptoms || []).map(foldAccents));
  const linkHtml = t => { const m = t.match(/^(.*?)\s*\|\s*(https?:\/\/\S+)$/); return m ? `<a href="${esc(m[2])}" target="_blank" rel="noopener">${esc(m[1] || m[2])}</a>` : sourceLineHtml(t); };
  const epi = [['Incidenza', n.incidence], ['Prevalenza', n.prevalence], ['Chi colpisce', n.epiAge], ['Esenzione', n.exempt]].filter(x => cnVal({ v: x[1] }, 'v'));
  const sh = openSheet(`
    <h2>${esc(n.title)}</h2>
    <p class="sheet-sub">${esc([n.specialty, n.nbId && nbById(n.nbId) ? nbById(n.nbId).name : ''].filter(Boolean).join(' · '))}</p>
    ${(n.symptoms || []).length ? `<div class="tags sym-tags">${n.symptoms.map(s => `<span class="tag sym">${esc(s)}</span>`).join('')}</div>` : ''}
    ${n.incomplete ? `<p class="inc-line">⚠ Incompleta${incompleteNote(n) ? `: ${esc(incompleteNote(n))}` : ''}</p>` : ''}
    <div class="cn-view">
      ${epi.length || cnVal(n, 'risk') ? `<div class="cn-row"><h3>Epidemiologia</h3>${epi.length ? `<dl class="cn-dl">${epi.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}${cnVal(n, 'risk') ? `<div class="notes"><p><strong>Fattori di rischio</strong></p>${renderMd(n.risk)}</div>` : ''}</div>` : ''}
      ${cnFilled(n, ['dxKind', 'dxCriteria', 'dxFirst', 'dxSecond', 'dxGold']) ? `<div class="cn-row"><h3>Diagnosi${n.dxKind ? ` <span class="pill soft">${esc(CN_DX_KINDS.find(k => k[0] === n.dxKind)?.[1] || '')}</span>` : ''}</h3>
        ${cnVal(n, 'dxCriteria') ? `<div class="notes"><p><strong>Criteri</strong></p>${md('dxCriteria')}</div>` : ''}
        ${cnVal(n, 'dxFirst') || cnVal(n, 'dxSecond') ? `<div class="grid2 cn-exams">${cnVal(n, 'dxFirst') ? `<div class="notes"><p><strong>Primo livello</strong></p>${md('dxFirst')}</div>` : ''}${cnVal(n, 'dxSecond') ? `<div class="notes"><p><strong>Secondo livello</strong></p>${md('dxSecond')}</div>` : ''}</div>` : ''}
        ${cnVal(n, 'dxGold') ? `<p><strong>Esame di riferimento:</strong> ${esc(n.dxGold)}</p>` : ''}</div>` : ''}
      ${ddxNotes.length || cnVal(n, 'ddxText') ? `<div class="cn-row"><h3>Diagnosi differenziale</h3>
        ${ddxNotes.length ? `<ul class="cn-ddx">${ddxNotes.map(o => { const shared = (o.symptoms || []).filter(s => mine.has(foldAccents(s))); const only = (o.symptoms || []).filter(s => !mine.has(foldAccents(s))); return `<li><button type="button" class="link-btn" data-cnopen="${o.id}">${esc(o.title)}</button>${shared.length ? `<small> · in comune: ${esc(shared.join(', '))}</small>` : ''}${only.length ? `<small> · solo lì: ${esc(only.slice(0, 4).join(', '))}</small>` : ''}</li>`; }).join('')}</ul>` : ''}
        ${md('ddxText') ? `<div class="notes">${md('ddxText')}</div>` : ''}</div>` : ''}
      ${row('Complicanze', md('complications'))}
      ${row('Stadiazione', md('staging'))}
      ${row('Prognosi', md('prognosis'))}
      ${row('Terapia', md('therapy'))}
      ${(n.algos || []).map(a => `<div class="cn-row"><h3>${esc(a.t || 'Algoritmo')}</h3>${algoSvg(a.md, a.t)}</div>`).join('')}
      ${row('Note', md('body'))}
    </div>
    ${labExams().some(x => (x.clinic || []).includes(n.id)) ? `<div class="fonti fonti-mini"><h3>Esami di laboratorio</h3><div class="tags">${labExams().filter(x => (x.clinic || []).includes(n.id)).map(x => `<a class="tag" href="#/lab/${x.id}" data-g="lab">${esc(x.name)}</a>`).join('')}</div></div>` : ''}
    ${(n.links || []).length ? `<div class="fonti fonti-mini"><h3>Link</h3><ul class="fonti-list">${n.links.map(t => `<li>${linkHtml(t)}</li>`).join('')}</ul></div>` : ''}
    <div class="fonti fonti-mini"><h3>Cerca su</h3><div class="inline">${cnSearchLinks(n.title).map(([l, u]) => `<a class="btn sm ghost" href="${u}" target="_blank" rel="noopener">${l}</a>`).join('')}</div></div>
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
  $$('[data-cnopen]', sh.el).forEach(b => { b.onclick = () => { sh.close(); setTimeout(() => showClinicNote(b.dataset.cnopen), 0); }; });
  // un tocco sul diagramma lo mostra a grandezza piena (si scorre), un altro lo rimette nella finestra
  $$('.algo-scroll', sh.el).forEach(box => box.addEventListener('click', () => {
    const svg = $('svg', box);
    const big = box.classList.toggle('big');
    svg.style.width = big ? `${box.dataset.w}px` : '100%';
    svg.style.maxWidth = big ? 'none' : `${box.dataset.w}px`;
  }));
  $('[data-g="edit"]', sh.el).onclick = async () => { sh.close(); if (await clinicSheet(n)) route(); };
}
let clinicSpec = '';
function viewClinic(p1) {
  if (p1 === 'quiz') return viewClinicQuiz();
  const notes = clinicalNotes();
  const symCount = new Map();
  notes.forEach(n => (n.symptoms || []).forEach(s => symCount.set(s, (symCount.get(s) || 0) + 1)));
  [...clinicSyms].forEach(s => { if (!symCount.has(s)) clinicSyms.delete(s); });
  const topSyms = [...symCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40);
  const specs = [...new Set(notes.map(n => n.specialty).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  if (clinicSpec && !specs.includes(clinicSpec)) clinicSpec = '';
  setView(`
    <header class="page-head">
      <div><h1>Note cliniche</h1><p class="lede">I quadri clinici di tutte le materie. Scrivi più sintomi separati da virgole: in cima le malattie che ne hanno di più.</p></div>
      <button class="btn primary" data-act="add-cn">Nuova nota clinica</button>
    </header>
    <nav class="tabs" aria-label="Note cliniche"><a href="#/clinic" class="tab on" aria-current="page">Note${notes.length ? ` (${notes.length})` : ''}</a><a href="#/clinic/quiz" class="tab">Diagnosi differenziale</a></nav>
    ${notes.length ? `
      <input type="search" class="input search" id="cnQ" placeholder="Es. febbre, tosse, dolore toracico" aria-label="Cerca nelle note cliniche" value="${esc(clinicQuery)}">
      ${specs.length ? `<div class="tag-cloud" aria-label="Specialità">${specs.map(x => `<button type="button" class="tag ${clinicSpec === x ? 'on' : ''}" data-spec="${esc(x)}" aria-pressed="${clinicSpec === x}">${esc(x)}</button>`).join('')}</div>` : ''}
      ${topSyms.length ? `<div class="tag-cloud" id="cnSym" aria-label="Aggiungi un sintomo alla ricerca">${topSyms.map(([s, n]) => `<button type="button" class="tag sym ${clinicSyms.has(s) ? 'on' : ''}" data-sym="${esc(s)}" aria-pressed="${clinicSyms.has(s)}">${esc(s)} <small>${n}</small></button>`).join('')}</div>` : ''}
      <div id="cnList"></div>` : `
      <div class="empty"><p>Scrivi una nota da qui, oppure seleziona del testo mentre leggi una sezione e tocca “Nota clinica”.</p><button class="btn primary" data-act="add-cn">Nuova nota clinica</button></div>`}`);
  const draw = () => {
    const box = $('#cnList');
    if (!box) return;
    // ogni sintomo scritto (o toccato) conta: in cima le note che ne hanno di più
    const phrases = [...new Set([...clinicQuery.split(',').map(x => foldAccents(x).trim()).filter(Boolean), ...[...clinicSyms].map(foldAccents)])];
    const scored = notes.filter(n => !clinicSpec || n.specialty === clinicSpec).map(n => {
      const syms = (n.symptoms || []).map(foldAccents);
      const text = foldAccents([n.body, n.dxCriteria, n.therapy, n.complications, n.ddxText].filter(Boolean).join(' '));
      let score = 0, hit = 0;
      for (const t of phrases) {
        const best = syms.includes(t) ? 4 : syms.some(s => s.includes(t) || t.includes(s)) ? 3 : foldAccents(n.title).includes(t) ? 2.5 : text.includes(t) ? 1 : 0;
        if (best) { hit++; score += best; }
      }
      return phrases.length && !hit ? null : { n, score, hit };
    }).filter(Boolean).sort((a, b) => b.hit - a.hit || b.score - a.score || a.n.title.localeCompare(b.n.title));
    const many = phrases.length > 1;
    box.innerHTML = scored.length ? `<ul class="list">${scored.map(({ n, hit }) => `
      <li><button type="button" class="row" data-cn="${n.id}"><span class="row-main">
        <span class="row-title">${esc(n.title)}${many ? ` <span class="pill ${hit === phrases.length ? 'due' : 'soft'}">${hit}/${phrases.length}</span>` : ''}</span>
        ${[n.specialty, n.nbId && nbById(n.nbId) ? nbById(n.nbId).name : ''].filter(Boolean).length ? `<span class="row-sub">${esc([n.specialty, n.nbId && nbById(n.nbId) ? nbById(n.nbId).name : ''].filter(Boolean).join(' · '))}</span>` : ''}
        ${(n.symptoms || []).length ? `<span class="tags">${n.symptoms.map(s => `<span class="tag sym ${phrases.some(t => { const f = foldAccents(s); return f === t || f.includes(t) || t.includes(f); }) ? 'on' : ''}">${esc(s)}</span>`).join('')}</span>` : ''}
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
  on('[data-spec]', 'click', e => { const x = e.currentTarget.dataset.spec; clinicSpec = clinicSpec === x ? '' : x; $$('[data-spec]').forEach(b => { b.classList.toggle('on', b.dataset.spec === clinicSpec); b.setAttribute('aria-pressed', b.dataset.spec === clinicSpec); }); draw(); });
  on('[data-act="add-cn"]', 'click', async () => { if (await clinicSheet()) route(); });
  $('#cnList')?.addEventListener('click', e => { const b = e.target.closest('[data-cn]'); if (b) showClinicNote(b.dataset.cn); });
}

/* ---------- Allenamento di diagnosi differenziale ----------
   Dai sintomi alla malattia, con distrattori scelti tra le note che hanno
   sintomi in comune; dopo la risposta vedi cosa distingue le opzioni. */
const ddxState = { mode: 'guess', spec: '', ok: 0, done: 0 };
const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
function viewClinicQuiz() {
  const notes = clinicalNotes().filter(n => (n.symptoms || []).length >= 2);
  const specs = [...new Set(notes.map(n => n.specialty).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  const withDdx = clinicalNotes().filter(n => (n.ddx || []).some(id => clinicalNotes().some(o => o.id === id)));
  setView(`
    <header class="page-head"><div><h1>Diagnosi differenziale</h1><p class="lede">Allenati a ragionare come al letto del paziente, con le tue note cliniche.</p></div></header>
    <nav class="tabs" aria-label="Note cliniche"><a href="#/clinic" class="tab">Note (${clinicalNotes().length})</a><a href="#/clinic/quiz" class="tab on" aria-current="page">Diagnosi differenziale</a></nav>
    <div class="pc-tools">
      <div class="seg" role="radiogroup" aria-label="Esercizio">
        <button type="button" role="radio" data-dm="guess" aria-checked="${ddxState.mode === 'guess'}">Dai sintomi alla diagnosi</button>
        <button type="button" role="radio" data-dm="ddx" aria-checked="${ddxState.mode === 'ddx'}" ${withDdx.length ? '' : 'disabled title="Collega prima delle note nella loro diagnosi differenziale"'}>Cosa entra in diagnosi differenziale</button>
      </div>
      ${specs.length ? `<label class="field"><span>Specialità</span><select class="input" id="dxSpec"><option value="">Tutte</option>${specs.map(x => `<option ${ddxState.spec === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>` : ''}
    </div>
    <div id="dxBox"></div>
  `);
  $$('[data-dm]').forEach(b => b.addEventListener('click', () => { if (b.disabled) return; ddxState.mode = b.dataset.dm; route(); }));
  $('#dxSpec')?.addEventListener('change', e => { ddxState.spec = e.target.value; next(); });
  const box = $('#dxBox');
  const pool = () => notes.filter(n => !ddxState.spec || n.specialty === ddxState.spec);
  const score = () => (ddxState.done ? `<p class="hint">Finora: ${ddxState.ok} su ${ddxState.done}.</p>` : '');
  const next = () => {
    if (ddxState.mode === 'ddx') return nextDdx();
    const p = pool();
    if (p.length < 4) { box.innerHTML = `<div class="empty"><p>Servono almeno 4 note cliniche con 2 o più sintomi${ddxState.spec ? ' in questa specialità' : ''} (ora ${p.length}). Più note scrivi, più l’esercizio è difficile.</p><a class="btn primary" href="#/clinic">Vai alle note</a></div>`; return; }
    // scelgo una nota e i sintomi da mostrare in modo che, tra le opzioni, solo lei li spieghi tutti
    const symSet = n => new Set((n.symptoms || []).map(foldAccents));
    let target = null, shown = [], others = [];
    for (const cand of shuffle(p)) {
      const k = Math.min(cand.symptoms.length, Math.max(2, Math.min(4, Math.ceil(cand.symptoms.length * 0.7))));
      let pick = shuffle(cand.symptoms).slice(0, k);
      // se qualche altra nota ha tutti questi sintomi, ne aggiungo finché non è più così (o li ho usati tutti)
      const coversAll = (n, list) => list.every(s => symSet(n).has(foldAccents(s)));
      for (const extra of shuffle(cand.symptoms.filter(s => !pick.includes(s)))) {
        if (!p.some(n => n.id !== cand.id && coversAll(n, pick))) break;
        pick.push(extra);
      }
      const fs = new Set(pick.map(foldAccents));
      const valid = p.filter(n => n.id !== cand.id && !coversAll(n, pick))
        .map(n => ({ n, common: (n.symptoms || []).filter(x => fs.has(foldAccents(x))).length + ((cand.ddx || []).includes(n.id) ? 2 : 0) }))
        .sort((a, b) => b.common - a.common || Math.random() - 0.5).slice(0, 3).map(x => x.n);
      if (valid.length === 3) { target = cand; shown = pick; others = valid; break; }
    }
    if (!target) { box.innerHTML = '<div class="empty"><p>Le note hanno sintomi troppo simili per fare domande giuste: aggiungi a ogni nota i segni che la distinguono dalle altre.</p><a class="btn primary" href="#/clinic">Vai alle note</a></div>'; return; }
    const fs = new Set(shown.map(foldAccents));
    const opts = shuffle([target, ...others]);
    box.innerHTML = `
      <div class="lab-q">
        <p class="hint">Un paziente si presenta con:</p>
        <div class="tags dx-syms">${shown.map(s => `<span class="tag sym on">${esc(s)}</span>`).join('')}</div>
        <p class="lab-q-t">Qual è la diagnosi più probabile?</p>
        <div class="dx-opts">${opts.map(o => `<button type="button" class="btn dx-opt" data-dxo="${o.id}">${esc(o.title)}</button>`).join('')}</div>
        <div id="dxWhy"></div>
        ${score()}
      </div>`;
    box.querySelector('.dx-opts').addEventListener('click', e => {
      const b = e.target.closest('[data-dxo]');
      if (!b || box.querySelector('.dx-opts').dataset.done) return;
      box.querySelector('.dx-opts').dataset.done = '1';
      const right = b.dataset.dxo === target.id;
      ddxState.done++;
      if (right) ddxState.ok++;
      $$('[data-dxo]', box).forEach(x => { x.disabled = true; x.classList.toggle('ok', x.dataset.dxo === target.id); x.classList.toggle('ko', x === b && !right); });
      const why = opts.map(o => {
        const os = new Set((o.symptoms || []).map(foldAccents));
        const fits = shown.filter(s => os.has(foldAccents(s)));
        const miss = shown.filter(s => !os.has(foldAccents(s)));
        return `<li><button type="button" class="link-btn" data-cnopen="${o.id}">${esc(o.title)}</button>${o.id === target.id ? ' ✓' : ''}: ${fits.length ? `spiega ${esc(fits.join(', '))}` : 'non spiega nessuno dei sintomi'}${miss.length ? `; non spiega ${esc(miss.join(', '))}` : ''}.</li>`;
      }).join('');
      const rest = target.symptoms.filter(s => !fs.has(foldAccents(s)));
      $('#dxWhy', box).innerHTML = `<p class="dx-res ${right ? 'ok' : 'ko'}">${right ? 'Giusto!' : `No: era ${esc(target.title)}.`}${rest.length ? ` Altri suoi segni: ${esc(rest.join(', '))}.` : ''}</p><ul class="cn-ddx">${why}</ul>
        <div class="inline"><button class="btn primary" type="button" data-dxn>Un altro</button><button class="btn ghost" type="button" data-cnopen="${target.id}">Apri la nota</button></div>`;
      $('[data-dxn]', box).onclick = next;
      $$('[data-cnopen]', box).forEach(x => { x.onclick = () => showClinicNote(x.dataset.cnopen); });
    });
  };
  const nextDdx = () => {
    const all = clinicalNotes();
    const p = withDdx.filter(n => !ddxState.spec || n.specialty === ddxState.spec);
    if (!p.length) { box.innerHTML = '<div class="empty"><p>Nessuna nota ha ancora la diagnosi differenziale collegata. Aprine una, tocca Modifica → Diagnosi differenziale e collega le note che entrano in DDx.</p></div>'; return; }
    const target = p[Math.floor(Math.random() * p.length)];
    const right = (target.ddx || []).map(id => all.find(o => o.id === id)).filter(Boolean);
    const wrong = shuffle(all.filter(o => o.id !== target.id && !right.includes(o))).slice(0, Math.max(2, 6 - right.length));
    const opts = shuffle([...right, ...wrong]).slice(0, Math.max(right.length + 2, 6));
    const picked = new Set();
    box.innerHTML = `
      <div class="lab-q">
        <p class="lab-q-t">Quali entrano nella diagnosi differenziale di <strong>${esc(target.title)}</strong>?</p>
        ${(target.symptoms || []).length ? `<div class="tags dx-syms">${target.symptoms.map(s => `<span class="tag sym">${esc(s)}</span>`).join('')}</div>` : ''}
        <p class="hint">Scegline una o più, poi controlla.</p>
        <div class="dx-opts">${opts.map(o => `<button type="button" class="btn dx-opt" data-dxp="${o.id}" aria-pressed="false">${esc(o.title)}</button>`).join('')}</div>
        <div class="inline"><button class="btn primary" type="button" data-dxc>Controlla</button></div>
        <div id="dxWhy"></div>
        ${score()}
      </div>`;
    box.querySelector('.dx-opts').addEventListener('click', e => {
      const b = e.target.closest('[data-dxp]');
      if (!b || b.disabled) return;
      if (picked.has(b.dataset.dxp)) picked.delete(b.dataset.dxp); else picked.add(b.dataset.dxp);
      b.setAttribute('aria-pressed', String(picked.has(b.dataset.dxp)));
    });
    $('[data-dxc]', box).onclick = () => {
      const ids = new Set(right.map(o => o.id));
      const good = [...picked].filter(x => ids.has(x)).length, bad = [...picked].filter(x => !ids.has(x)).length;
      const full = good === ids.size && !bad;
      ddxState.done++;
      if (full) ddxState.ok++;
      $$('[data-dxp]', box).forEach(x => { x.disabled = true; x.classList.toggle('ok', ids.has(x.dataset.dxp)); x.classList.toggle('ko', picked.has(x.dataset.dxp) && !ids.has(x.dataset.dxp)); });
      $('[data-dxc]', box).remove();
      $('#dxWhy', box).innerHTML = `<p class="dx-res ${full ? 'ok' : 'ko'}">${full ? 'Tutte giuste!' : `Ne hai prese ${good} su ${ids.size}${bad ? `, più ${bad} che non ${bad === 1 ? 'c’entra' : 'c’entrano'}` : ''}.`}</p>
        ${cnVal(target, 'ddxText') ? `<div class="notes">${renderMd(target.ddxText)}</div>` : ''}
        <div class="inline"><button class="btn primary" type="button" data-dxn>Un altro</button><button class="btn ghost" type="button" data-cnopen="${target.id}">Apri la nota</button></div>`;
      $('[data-dxn]', box).onclick = next;
      $$('[data-cnopen]', box).forEach(x => { x.onclick = () => showClinicNote(x.dataset.cnopen); });
    };
  };
  next();
}

/* =====================================================================
   v3.46: Microbiologia, Atlante (ECG, emogas, Rx), Diario di tirocinio
   Come la semeiotica: ogni scheda è una sezione di un notebook speciale,
   con tutte le modalità di studio, foto con etichette, video, fonti.
   Partono vuoti: i contenuti li scrivi tu.
   ===================================================================== */
const SPECIALS = {
  micro: {
    kind: 'micro', route: 'micro', name: 'Microbiologia', noun: 'microrganismo', links: true,
    lede: 'Una scheda per ogni microrganismo: caratteristiche, virulenza, malattie, diagnosi e terapia. Le malattie infettive restano nelle note cliniche.',
    typeLabel: 'Tipo', types: { batterio: 'Batterio', virus: 'Virus', fungo: 'Fungo', parassita: 'Parassita', prione: 'Prione' },
    groupLabel: 'Gruppo', groupPh: 'Es. Cocchi Gram+, Herpesviridae',
    namePh: 'Es. Staphylococcus aureus',
    parts: () => ['Caratteristiche', 'Habitat e trasmissione', 'Fattori di virulenza', 'Malattie', 'Diagnosi di laboratorio', 'Terapia e resistenze', 'Prevenzione', 'Note']
  },
  atlas: {
    kind: 'atlas', route: 'atlas', name: 'Atlante diagnostico', noun: 'tracciato o immagine', links: true,
    lede: 'ECG, emogasanalisi, Rx torace e altre immagini da imparare a leggere: carica la foto, segna le etichette, scrivi l’interpretazione.',
    typeLabel: 'Esame', types: { ecg: 'ECG', ega: 'Emogasanalisi', rx: 'Rx torace', eco: 'Ecografia', tc: 'TC o RM', altro: 'Altro' },
    groupLabel: 'Quadro', groupPh: 'Es. Blocchi di branca, Acidosi metabolica',
    namePh: 'Es. Blocco di branca sinistra',
    parts: t => ({
      ecg: ['Tracciato', 'Ritmo e frequenza', 'Asse', 'Onde, intervalli e segmenti', 'Interpretazione', 'Quadro clinico', 'Note'],
      ega: ['Valori', 'Disturbo primario', 'Compenso', 'Gap anionico', 'Interpretazione', 'Cause possibili', 'Note'],
      rx: ['Immagine', 'Proiezione e qualità', 'Reperti', 'Interpretazione', 'Diagnosi differenziale', 'Note']
    }[t] || ['Immagine', 'Reperti', 'Interpretazione', 'Note'])
  },
  anat: {
    kind: 'anat', route: 'anat', name: 'Atlante di anatomia', noun: 'immagine', links: true, grid: true,
    lede: 'Le tavole e le immagini di anatomia che usi di più: carica la figura, segna le strutture con le etichette, aggiungi tag e collegamenti alle sezioni del notebook.',
    typeLabel: 'Apparato', types: { osteo: 'Osteologia', artro: 'Artrologia', mio: 'Miologia', cardio: 'Cardiovascolare', resp: 'Respiratorio', dig: 'Digerente', uro: 'Urinario', gen: 'Genitale', snc: 'Sistema nervoso centrale', snp: 'Sistema nervoso periferico', sensi: 'Organi di senso', endo: 'Endocrino', linfo: 'Linfatico', cute: 'Tegumentario', topo: 'Anatomia topografica', altro: 'Altro' },
    groupLabel: 'Regione', groupPh: 'Es. Arto superiore, Mediastino',
    namePh: 'Es. Plesso brachiale',
    parts: () => ['Immagine', 'Strutture', 'Rapporti', 'Vascolarizzazione e innervazione', 'Correlazioni cliniche', 'Note']
  },
  pharma: {
    kind: 'pharma', route: 'pharma', name: 'Farmacologia', noun: 'farmaco', links: true,
    lede: 'Una scheda per ogni farmaco, raggruppati per classe, con i titoli pronti. Nella scheda Confronta i farmaci di una classe diventano una tabella, titolo per titolo.',
    typeLabel: 'Area', types: { cardio: 'Cardiovascolare', snc: 'Sistema nervoso', anti: 'Antimicrobici', analg: 'Analgesici e antinfiammatori', endo: 'Endocrino e metabolismo', resp: 'Respiratorio', gi: 'Gastrointestinale', emato: 'Sangue e coagulazione', onco: 'Oncologia e immunologia', anest: 'Anestesia', altro: 'Altro' },
    groupLabel: 'Classe', groupPh: 'Es. Beta-bloccanti, ACE-inibitori',
    namePh: 'Es. Metoprololo',
    parts: () => ['Meccanismo d’azione', 'Farmacocinetica', 'Indicazioni', 'Effetti avversi', 'Controindicazioni', 'Interazioni', 'Monitoraggio', 'Gravidanza e allattamento', 'Sovradosaggio e antidoto', 'Note']
  },
  diary: {
    kind: 'diary', route: 'diary', name: 'Diario di tirocinio', noun: 'giornata',
    lede: 'Una pagina per ogni giornata di tirocinio: reparto, tutor, casi visti, procedure e cosa hai imparato. Le procedure si sommano da sole.',
    namePh: 'Es. Medicina interna, primo giorno',
    parts: () => ['Cosa ho visto', 'Casi', 'Cosa ho imparato', 'Da approfondire']
  }
};
const specialNb = kind => state.notebooks.find(n => n.kind === kind);
async function ensureSpecialNb(cfg) {
  let nb = specialNb(cfg.kind);
  if (!nb) { nb = { id: uid(), name: cfg.name, kind: cfg.kind, created: Date.now() }; await saveNotebook(nb); }
  return nb;
}
const specialOf = sec => { if (!sec) return null; const nb = nbById(sec.notebookId); return nb && SPECIALS[nb.kind] ? SPECIALS[nb.kind] : null; };
const spData = sec => (sec.sp && typeof sec.sp === 'object' ? sec.sp : (sec.sp = {}));
function specialMetaBits(sec) {
  const cfg = specialOf(sec);
  if (!cfg) return [];
  const d = spData(sec);
  if (cfg.kind === 'diary') {
    const procs = (d.procs || []).reduce((a, p) => a + (+p.c || 0), 0);
    return [d.date ? fmtDay(d.date) : '', d.ward, d.tutor ? `tutor ${d.tutor}` : '', procs ? `${procs} procedure` : ''].filter(Boolean);
  }
  return [d.proto ? '★ prototipo' : '', cfg.types[d.type], d.group].filter(Boolean);
}
const PROC_KINDS = [['eseguita', 'Eseguita da me'], ['assistita', 'Assistita'], ['osservata', 'Osservata']];
function specialSheet(cfg, sec = null) {
  return new Promise(resolve => {
    const d = sec ? { ...spData(sec) } : (cfg.kind === 'diary' ? { date: todayStr(), procs: [] } : { type: Object.keys(cfg.types)[0], group: '' });
    const nb = specialNb(cfg.kind);
    const others = nb ? secsOf(nb.id) : [];
    const used = k => [...new Set(others.map(s => s.sp?.[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
    const procNames = [...new Set(others.flatMap(s => (s.sp?.procs || []).map(p => p.n)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
    let procs = (d.procs || []).map(p => ({ ...p }));
    let links = [...(d.links || [])];
    const isDiary = cfg.kind === 'diary';
    const sh = openSheet(`
      <h2>${sec ? (isDiary ? 'Dati della giornata' : 'Dati della scheda') : (isDiary ? 'Nuova giornata di tirocinio' : `Nuova scheda: ${cfg.noun}`)}</h2>
      <label class="field"><span>${isDiary ? 'Titolo' : 'Nome'}</span><input class="input" id="spTitle" value="${esc(sec?.title || (isDiary ? `Tirocinio ${fmtDay(d.date)}` : ''))}" placeholder="${esc(cfg.namePh)}"></label>
      ${isDiary ? `
        <div class="grid2">
          <label class="field"><span>Data</span><input class="input" type="date" id="spDate" value="${esc(d.date || todayStr())}"></label>
          <label class="field"><span>Reparto</span><input class="input" id="spWard" value="${esc(d.ward || '')}" list="spWards" placeholder="Es. Medicina interna"><datalist id="spWards">${used('ward').map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
        </div>
        <label class="field"><span>Tutor</span><input class="input" id="spTutor" value="${esc(d.tutor || '')}" list="spTutors"><datalist id="spTutors">${used('tutor').map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
        <div class="field"><span class="lbl">Procedure</span><div id="spProcs"></div><button class="btn sm ghost" type="button" data-sx="proc">+ Aggiungi una procedura</button>
          <datalist id="spProcNames">${procNames.map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>` : `
        <div class="grid2">
          <label class="field"><span>${cfg.typeLabel}</span><select class="input" id="spType">${Object.entries(cfg.types).map(([k, l]) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span>${cfg.groupLabel}</span><input class="input" id="spGroup" value="${esc(d.group || '')}" list="spGroups" placeholder="${esc(cfg.groupPh)}"><datalist id="spGroups">${used('group').map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
        </div>`}
      ${cfg.kind === 'pharma' ? `<label class="check"><input type="checkbox" id="spProto" ${d.proto ? 'checked' : ''}><span>Prototipo della classe (nel confronto va per primo)</span></label>` : ''}
      <label class="field"><span>Tag, separati da virgole</span><input class="input" id="spTags" value="${esc(tagsOf(sec || {}).join(', '))}" placeholder="Es. esame, da ripassare" list="spTagList"><datalist id="spTagList">${[...new Set(others.flatMap(x => tagsOf(x)))].map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
      ${cfg.links ? `<div class="field"><span class="lbl">Collegata a</span><div class="tags" id="spLinks"></div>
        <input type="search" class="input" id="spLinkQ" placeholder="＋ Collega una sezione: scrivi il titolo" aria-label="Collega una sezione del notebook" autocomplete="off">
        <ul class="list pick-list sp-link-res" id="spLinkRes"></ul></div>` : ''}
      ${sec ? '' : `<label class="check"><input type="checkbox" id="spTpl" checked><span id="spTplTxt"></span></label>`}
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-sx="no">Annulla</button>
        <button class="btn primary" type="button" data-sx="ok">${sec ? 'Salva' : 'Crea'}</button>
      </div>`, { label: cfg.name, onClose: v => resolve(v || null) });
    const tplTxt = () => { const t = $('#spTplTxt', sh.el); if (t) t.textContent = `Prepara i titoli: ${cfg.parts($('#spType', sh.el)?.value).join(', ')}`; };
    tplTxt();
    $('#spType', sh.el)?.addEventListener('change', tplTxt);
    const drawProcs = () => {
      const box = $('#spProcs', sh.el);
      if (!box) return;
      box.innerHTML = procs.map((p, i) => `<div class="sp-proc" data-pi="${i}">
        <input class="input" data-pf="n" value="${esc(p.n || '')}" list="spProcNames" placeholder="Es. Prelievo venoso" aria-label="Procedura">
        <select class="input" data-pf="k" aria-label="Come">${PROC_KINDS.map(([k, l]) => `<option value="${k}" ${p.k === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input class="input num" data-pf="c" type="number" min="1" value="${esc(p.c || 1)}" inputmode="numeric" aria-label="Quante volte">
        <button class="btn sm ghost" type="button" data-pdel="${i}" aria-label="Togli">✕</button></div>`).join('') || '<p class="hint">Nessuna procedura in questa giornata.</p>';
    };
    const readProcs = () => $$('.sp-proc', sh.el).forEach(row => { const p = procs[+row.dataset.pi]; $$('[data-pf]', row).forEach(i => { p[i.dataset.pf] = i.dataset.pf === 'c' ? Math.max(1, +i.value || 1) : i.value.trim(); }); });
    drawProcs();
    const drawLinks = () => {
      const box = $('#spLinks', sh.el);
      if (!box) return;
      box.innerHTML = links.map(secById).filter(Boolean).map(x => `<span class="tag">${esc(x.title)} <button type="button" class="tag-x" data-unlink="${x.id}" aria-label="Scollega ${esc(x.title)}">×</button></span>`).join('') || '<span class="hint">Nessuna</span>';
    };
    drawLinks();
    $('#spLinkQ', sh.el)?.addEventListener('input', e => {
      const f = foldAccents(e.target.value.trim());
      const where = x => [nbById(x.notebookId)?.name, groupPathText(x)].filter(Boolean).join(' › ');
      const hits = f ? state.sections.filter(x => x.id !== sec?.id && !links.includes(x.id) && !SPECIALS[nbById(x.notebookId)?.kind] && foldAccents(`${x.title} ${where(x)}`).includes(f)).slice(0, 8) : [];
      $('#spLinkRes', sh.el).innerHTML = hits.map(x => `<li><button type="button" class="row" data-linkto="${x.id}"><span class="row-main"><span class="row-title">${esc(x.title)}</span><span class="row-sub">${esc(where(x))}</span></span></button></li>`).join('') || (f ? '<li class="hint">Nessuna sezione con questo titolo.</li>' : '');
    });
    // il titolo proposto segue la data finché non lo cambi tu
    const dateIn = $('#spDate', sh.el);
    if (dateIn && !sec) {
      let auto = $('#spTitle', sh.el).value;
      dateIn.addEventListener('change', () => { const t = $('#spTitle', sh.el); if (t.value === auto) { auto = `Tirocinio ${fmtDay(dateIn.value || todayStr())}`; t.value = auto; } });
    }
    sh.el.addEventListener('click', async e => {
      const del = e.target.closest('[data-pdel]');
      if (del) { readProcs(); procs.splice(+del.dataset.pdel, 1); drawProcs(); return; }
      const ul = e.target.closest('[data-unlink]');
      if (ul) { links = links.filter(x => x !== ul.dataset.unlink); drawLinks(); return; }
      const lr = e.target.closest('[data-linkto]');
      if (lr) { if (!links.includes(lr.dataset.linkto)) links.push(lr.dataset.linkto); drawLinks(); $('#spLinkQ', sh.el).value = ''; $('#spLinkRes', sh.el).innerHTML = ''; return; }
      const b = e.target.closest('[data-sx]');
      if (!b) return;
      if (b.dataset.sx === 'no') { sh.close(null); return; }
      if (b.dataset.sx === 'proc') { readProcs(); procs.push({ n: '', k: 'eseguita', c: 1 }); drawProcs(); $$('.sp-proc [data-pf="n"]', sh.el).pop()?.focus(); return; }
      if (b.dataset.sx === 'ok') {
        const title = $('#spTitle', sh.el).value.trim();
        if (!title) { toast('Scrivi il nome'); $('#spTitle', sh.el).focus(); return; }
        readProcs();
        const data = isDiary
          ? { date: $('#spDate', sh.el).value || todayStr(), ward: $('#spWard', sh.el).value.trim(), tutor: $('#spTutor', sh.el).value.trim(), procs: procs.filter(p => p.n) }
          : { type: $('#spType', sh.el).value, group: $('#spGroup', sh.el).value.trim(), links, ...(cfg.kind === 'pharma' ? { proto: !!$('#spProto', sh.el)?.checked } : {}) };
        let s = sec;
        if (!s) {
          const nbx = await ensureSpecialNb(cfg);
          const tpl = $('#spTpl', sh.el)?.checked;
          s = newSection(nbx.id, { title, md: tpl ? cfg.parts(data.type).map(p => `## ${p}\n\n`).join('') : '' });
        } else s.title = title;
        s.sp = { ...spData(s), ...data };
        s.tags = parseTags($('#spTags', sh.el).value);
        await saveSection(s);
        sh.close(s);
      }
    });
    setTimeout(() => $('#spTitle', sh.el)?.focus(), 40);
  });
}
const spState = {};
function viewSpecial(kind, p1) {
  const cfg = SPECIALS[kind];
  const nb = specialNb(kind);
  const all = nb ? secsOf(nb.id) : [];
  const st = spState[kind] || (spState[kind] = { q: '', type: '', group: '', tag: '' });
  const allTags = [...new Set(all.flatMap(x => tagsOf(x)))].sort((a, b) => a.localeCompare(b, 'it'));
  if (st.tag && !allTags.includes(st.tag)) st.tag = '';
  const isDiary = kind === 'diary';
  if (isDiary && p1 === 'procs') return viewDiaryProcs(cfg, all);
  if (kind === 'pharma' && p1 === 'compare') return viewPharmaCompare(cfg, all);
  setView(`
    <header class="page-head">
      <div><h1>${cfg.name}</h1><p class="lede">${cfg.lede}</p></div>
      <button class="btn primary" type="button" data-act="sp-new">${isDiary ? 'Nuova giornata' : 'Nuova scheda'}</button>
    </header>
    ${isDiary ? `<nav class="tabs" aria-label="Diario"><a href="#/diary" class="tab on" aria-current="page">Giornate${all.length ? ` (${all.length})` : ''}</a><a href="#/diary/procs" class="tab">Procedure</a></nav>` : ''}
    ${kind === 'pharma' ? `<nav class="tabs" aria-label="Farmacologia"><a href="#/pharma" class="tab on" aria-current="page">Farmaci${all.length ? ` (${all.length})` : ''}</a><a href="#/pharma/compare" class="tab">Confronta</a></nav>` : ''}
    ${all.length ? `
      <div class="inline semei-tools">
        <input type="search" class="input search" id="spQ" placeholder="Cerca" aria-label="Cerca" value="${esc(st.q)}">
        ${isDiary ? '' : '<button class="btn" type="button" data-act="sp-random" title="Apre una scheda a caso in modalità Orale">Esercitati</button>'}
      </div>
      ${isDiary ? '' : `<div class="tag-cloud" aria-label="Filtra">${Object.entries(cfg.types).filter(([k]) => all.some(s => s.sp?.type === k)).map(([k, l]) => `<button type="button" class="tag ${st.type === k ? 'on' : ''}" data-spt="${k}" aria-pressed="${st.type === k}">${l}</button>`).join('')}</div>`}
      ${allTags.length ? `<div class="tag-cloud sp-tags" aria-label="Filtra per tag">${allTags.map(t => `<button type="button" class="tag ${st.tag === t ? 'on' : ''}" data-sptag="${esc(t)}" aria-pressed="${st.tag === t}">#${esc(t)}</button>`).join('')}</div>` : ''}
      <div id="spList"></div>` : `
      <div class="empty"><p>${isDiary ? 'Ancora nessuna giornata. Creane una al termine di ogni turno: bastano pochi minuti, e alla fine del tirocinio hai l’elenco di casi e procedure.' : `Ancora nessuna scheda. Creane una per ogni ${cfg.noun}: i titoli sono già pronti, poi aggiungi foto (anche come esercizio delle etichette) e video.`}</p>
        <button class="btn primary" type="button" data-act="sp-new">${isDiary ? 'Nuova giornata' : 'Nuova scheda'}</button></div>`}
  `);
  on('[data-act="sp-new"]', 'click', async () => { const s = await specialSheet(cfg); if (s) { toast(isDiary ? 'Giornata creata' : 'Scheda creata'); go(`#/sec/${s.id}/edit`); } });
  const filtered = () => {
    const toks = foldAccents(st.q).split(/\s+/).filter(Boolean);
    return all.filter(s => (!st.type || s.sp?.type === st.type) && (!st.tag || tagsOf(s).includes(st.tag)) && (!toks.length || toks.every(t => foldAccents(`${s.title} ${s.md} ${Object.values(s.sp || {}).filter(v => typeof v === 'string').join(' ')} ${(s.sp?.procs || []).map(p => p.n).join(' ')} ${tagsOf(s).join(' ')}`).includes(t))));
  };
  const draw = () => {
    const box = $('#spList');
    if (!box) return;
    const list = filtered();
    const groups = new Map();
    const keyOf = s => (isDiary ? (s.sp?.date || '').slice(0, 7) : (s.sp?.group || 'Senza gruppo'));
    list.sort((a, b) => (isDiary ? String(b.sp?.date || '').localeCompare(String(a.sp?.date || '')) : (!!b.sp?.proto - !!a.sp?.proto) || a.title.localeCompare(b.title, 'it')));
    list.forEach(s => { const k = keyOf(s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); });
    const label = k => (isDiary ? (k ? new Date(`${k}-01T12:00`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) : 'Senza data') : k);
    const keys = [...groups.keys()].sort((a, b) => (isDiary ? b.localeCompare(a) : (a === 'Senza gruppo') - (b === 'Senza gruppo') || a.localeCompare(b, 'it')));
    box.innerHTML = list.length ? keys.map(k => cfg.grid ? `<h2 class="sub">${esc(label(k))}</h2><div class="anat-grid">${groups.get(k).map(s => {
      const im = imageRefs(s.md)[0];
      return `<a class="anat-card" href="#/sec/${s.id}/read">${im ? `<img class="nb-img" data-img="${im}" alt="">` : '<span class="anat-none">Nessuna immagine</span>'}<span class="anat-t">${esc(s.title)}</span><span class="anat-s">${esc([cfg.types[s.sp?.type], ...tagsOf(s).map(t => `#${t}`)].filter(Boolean).join(' · '))}</span></a>`;
    }).join('')}</div>` : `<h2 class="sub">${esc(label(k))}</h2><ul class="list">${groups.get(k).map(s => {
      const nImg = imageRefs(s.md).length;
      const bits = [...specialMetaBits(s), nImg ? `${nImg} foto` : '', ...tagsOf(s).map(t => `#${t}`), s.incomplete ? '⚠ incompleta' : ''].filter(Boolean);
      return `<li><a class="row" href="#/sec/${s.id}/read"><span class="row-main"><span class="row-title">${esc(s.title)}</span><span class="row-sub">${esc(bits.join(' · '))}</span></span>${isDiary ? '' : statusPill(s)}</a></li>`;
    }).join('')}</ul>`).join('') : '<p class="hint">Niente corrisponde.</p>';
  };
  draw();
  $('#spQ')?.addEventListener('input', e => { st.q = e.target.value; draw(); });
  on('[data-sptag]', 'click', e => { const k = e.currentTarget.dataset.sptag; st.tag = st.tag === k ? '' : k; $$('[data-sptag]').forEach(b => { b.classList.toggle('on', b.dataset.sptag === st.tag); b.setAttribute('aria-pressed', b.dataset.sptag === st.tag); }); draw(); });
  on('[data-spt]', 'click', e => { const k = e.currentTarget.dataset.spt; st.type = st.type === k ? '' : k; $$('[data-spt]').forEach(b => { b.classList.toggle('on', b.dataset.spt === st.type); b.setAttribute('aria-pressed', b.dataset.spt === st.type); }); draw(); });
  on('[data-act="sp-random"]', 'click', () => {
    const list = filtered().filter(s => String(s.md || '').replace(/^##.*$/gm, '').trim());
    if (!list.length) { toast('Nessuna scheda scritta tra quelle filtrate'); return; }
    go(`#/sec/${list[Math.floor(Math.random() * list.length)].id}/oral`);
  });
}
// Confronto tra farmaci: righe = i titoli delle schede, colonne = i farmaci scelti.
// Il contenuto viene dagli appunti stessi, senza scriverlo due volte.
function mdSectionsOf(md) {
  const out = new Map();
  let cur = null, buf = [];
  const push = () => { if (cur !== null) { const t = buf.join('\n').trim(); if (t) out.set(cur.key, { title: cur.title, md: t }); } };
  String(md || '').split('\n').forEach(line => {
    const h = line.match(/^#{1,2}\s+(.+?)\s*$/);
    if (h) { push(); cur = { key: foldAccents(h[1]).replace(/[^a-z0-9]+/g, ' ').trim(), title: h[1].trim() }; buf = []; }
    else if (cur) buf.push(line);
  });
  push();
  return out;
}
const pharmaCmp = { cls: '', picked: null, quiz: false, shown: new Set() };
function viewPharmaCompare(cfg, all) {
  const classes = [...new Set(all.map(s => s.sp?.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  if (!pharmaCmp.cls && classes.length) pharmaCmp.cls = classes[0];
  const inCls = c => all.filter(s => (s.sp?.group || '') === c).sort((a, b) => (!!b.sp?.proto - !!a.sp?.proto) || a.title.localeCompare(b.title, 'it'));
  if (!pharmaCmp.picked || ![...pharmaCmp.picked].every(id => all.some(s => s.id === id))) pharmaCmp.picked = new Set(inCls(pharmaCmp.cls).map(s => s.id));
  setView(`
    <header class="page-head"><div><h1>${cfg.name}</h1><p class="lede">I farmaci uno accanto all’altro, titolo per titolo: le righe sono i titoli delle schede (meccanismo, effetti avversi…), le colonne i farmaci.</p></div></header>
    <nav class="tabs" aria-label="Farmacologia"><a href="#/pharma" class="tab">Farmaci (${all.length})</a><a href="#/pharma/compare" class="tab on" aria-current="page">Confronta</a></nav>
    ${all.length < 2 ? '<div class="empty"><p>Servono almeno due schede di farmaci per confrontarli. Creale nella scheda Farmaci, con la stessa classe.</p><a class="btn primary" href="#/pharma">Vai ai farmaci</a></div>' : `
      <div class="pc-tools">
        <label class="field"><span>Classe</span><select class="input" id="pcCls">${classes.map(c => `<option ${c === pharmaCmp.cls ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__any" ${pharmaCmp.cls === '__any' ? 'selected' : ''}>Farmaci scelti da me</option></select></label>
        <label class="check"><input type="checkbox" id="pcQuiz" ${pharmaCmp.quiz ? 'checked' : ''}><span>Ripassa: copri le celle, tocca per scoprirle</span></label>
      </div>
      <div class="tag-cloud pc-pick" aria-label="Farmaci nel confronto">${(pharmaCmp.cls === '__any' ? all.slice().sort((a, b) => a.title.localeCompare(b.title, 'it')) : inCls(pharmaCmp.cls)).map(s => `<button type="button" class="tag ${pharmaCmp.picked.has(s.id) ? 'on' : ''}" data-pcp="${s.id}" aria-pressed="${pharmaCmp.picked.has(s.id)}">${s.sp?.proto ? '★ ' : ''}${esc(s.title)}</button>`).join('')}</div>
      <div id="pcTable"></div>`}
  `);
  if (all.length < 2) return;
  const draw = () => {
    const drugs = all.filter(s => pharmaCmp.picked.has(s.id)).sort((a, b) => (!!b.sp?.proto - !!a.sp?.proto) || a.title.localeCompare(b.title, 'it'));
    const box = $('#pcTable');
    if (drugs.length < 1) { box.innerHTML = '<p class="hint">Scegli almeno un farmaco qui sopra.</p>'; return; }
    const secs = drugs.map(d => mdSectionsOf(d.md));
    // prima i titoli del modello, poi gli altri titoli presenti nelle schede
    const keys = cfg.parts().map(t => foldAccents(t).replace(/[^a-z0-9]+/g, ' ').trim());
    const extra = [];
    secs.forEach(m => m.forEach((v, k) => { if (!keys.includes(k) && !extra.includes(k)) extra.push(k); }));
    const rows = [...keys, ...extra].filter(k => secs.some(m => m.has(k)));
    const titleOf = k => { for (const m of secs) if (m.has(k)) return m.get(k).title; return cfg.parts().find(t => foldAccents(t).replace(/[^a-z0-9]+/g, ' ').trim() === k) || k; };
    box.innerHTML = rows.length ? `<div class="notes pc-wrap"><div class="table-wrap"><table class="pc-table ${pharmaCmp.quiz ? 'quiz' : ''}">
      <thead><tr><th></th>${drugs.map(d => `<th><a href="#/sec/${d.id}/read">${d.sp?.proto ? '★ ' : ''}${esc(d.title)}</a></th>`).join('')}</tr></thead>
      <tbody>${rows.map(k => `<tr><th scope="row">${esc(titleOf(k))}</th>${secs.map((m, i) => { const v = m.get(k); const cid = `${drugs[i].id}|${k}`; return `<td class="${v && pharmaCmp.quiz && !pharmaCmp.shown.has(cid) ? 'covered' : ''}" data-cell="${esc(cid)}">${v ? renderMd(v.md) : '<span class="muted-inline">—</span>'}</td>`; }).join('')}</tr>`).join('')}</tbody>
    </table></div></div>
    <p class="hint">Le celle vengono dagli appunti di ogni scheda: per cambiarle modifica la scheda del farmaco. Una riga per ogni titolo, nell’ordine del modello.</p>` : '<p class="hint">Le schede scelte non hanno ancora testo sotto i titoli.</p>';
  };
  draw();
  $('#pcCls').addEventListener('change', e => { pharmaCmp.cls = e.target.value; pharmaCmp.picked = new Set(pharmaCmp.cls === '__any' ? [] : inCls(pharmaCmp.cls).map(s => s.id)); pharmaCmp.shown.clear(); route(); });
  $('#pcQuiz').addEventListener('change', e => { pharmaCmp.quiz = e.target.checked; pharmaCmp.shown.clear(); draw(); });
  on('[data-pcp]', 'click', e => { const id = e.currentTarget.dataset.pcp; if (pharmaCmp.picked.has(id)) pharmaCmp.picked.delete(id); else pharmaCmp.picked.add(id); e.currentTarget.classList.toggle('on', pharmaCmp.picked.has(id)); e.currentTarget.setAttribute('aria-pressed', pharmaCmp.picked.has(id)); draw(); });
  $('#pcTable').addEventListener('click', e => {
    const td = e.target.closest('td[data-cell]');
    if (!td || !pharmaCmp.quiz) return;
    if (pharmaCmp.shown.has(td.dataset.cell)) pharmaCmp.shown.delete(td.dataset.cell); else pharmaCmp.shown.add(td.dataset.cell);
    td.classList.toggle('covered', !pharmaCmp.shown.has(td.dataset.cell) && !td.querySelector('.muted-inline'));
  });
}
// Totale delle procedure del tirocinio, per reparto e per modo
function viewDiaryProcs(cfg, all) {
  const tot = new Map();
  all.forEach(s => (s.sp?.procs || []).forEach(p => {
    const k = foldAccents(p.n).trim();
    if (!k) return;
    const r = tot.get(k) || { n: p.n, eseguita: 0, assistita: 0, osservata: 0, wards: new Set(), last: '' };
    r[p.k || 'eseguita'] += +p.c || 1;
    if (s.sp?.ward) r.wards.add(s.sp.ward);
    if ((s.sp?.date || '') > r.last) r.last = s.sp.date;
    tot.set(k, r);
  }));
  const rows = [...tot.values()].sort((a, b) => (b.eseguita + b.assistita + b.osservata) - (a.eseguita + a.assistita + a.osservata));
  setView(`
    <header class="page-head"><div><h1>${cfg.name}</h1><p class="lede">Tutte le procedure delle tue giornate, sommate.</p></div></header>
    <nav class="tabs" aria-label="Diario"><a href="#/diary" class="tab">Giornate (${all.length})</a><a href="#/diary/procs" class="tab on" aria-current="page">Procedure</a></nav>
    ${rows.length ? `<div class="notes"><div class="table-wrap"><table><thead><tr><th>Procedura</th><th>Eseguite</th><th>Assistite</th><th>Osservate</th><th>Reparti</th><th>Ultima</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.n)}</td><td class="num">${r.eseguita || ''}</td><td class="num">${r.assistita || ''}</td><td class="num">${r.osservata || ''}</td><td>${esc([...r.wards].join(', '))}</td><td>${r.last ? esc(fmtDay(r.last)) : ''}</td></tr>`).join('')}
    </tbody></table></div></div>
    <p class="hint">Le procedure si aggiungono nei dati di ogni giornata (“Dati della giornata”).</p>` : '<div class="empty"><p>Ancora nessuna procedura. Aggiungile nei dati di una giornata: nome, se l’hai eseguita, assistita o osservata, e quante volte.</p></div>'}
  `);
}

/* ---------- Score clinici ----------
   Strumenti di studio: punteggi e soglie come nelle linee guida citate sotto ogni
   score (fonte: Claude, da verificare). In reparto si ricontrolla sempre. */
const yes = (k, label, pts = 1) => ({ k, label, type: 'check', pts });
const opt = (k, label, opts) => ({ k, label, type: 'select', opts });
const SCORES = [
  { id: 'cha2ds2vasc', title: 'CHA₂DS₂-VASc', cat: 'Cardiologia', what: 'Rischio di ictus nella fibrillazione atriale',
    items: [yes('c', 'Scompenso cardiaco o disfunzione ventricolare sinistra'), yes('h', 'Ipertensione'), opt('a', 'Età', [['Sotto i 65 anni', 0], ['65–74 anni', 1], ['75 anni o più', 2]]), yes('d', 'Diabete'), yes('s', 'Ictus, TIA o tromboembolia precedenti', 2), yes('v', 'Malattia vascolare (infarto, arteriopatia periferica, placca aortica)'), yes('f', 'Sesso femminile')],
    read: (n, v) => { const m = n - (v.f ? 1 : 0); return m >= 2 ? 'Anticoagulante orale raccomandato.' : m === 1 ? 'Anticoagulante da considerare.' : 'Rischio basso: di solito nessun anticoagulante.'; },
    src: 'ESC 2020. Le linee guida ESC 2024 usano CHA₂DS₂-VA, senza il punto per il sesso: le soglie qui sopra lo tolgono già dal calcolo.' },
  { id: 'hasbled', title: 'HAS-BLED', cat: 'Cardiologia', what: 'Rischio di sanguinamento in terapia anticoagulante',
    items: [yes('h', 'Ipertensione non controllata (sistolica oltre 160 mmHg)'), yes('r', 'Funzione renale alterata (dialisi, trapianto, creatinina ≥ 2,26 mg/dL)'), yes('l', 'Funzione epatica alterata (cirrosi o bilirubina > 2× e transaminasi > 3×)'), yes('s', 'Ictus precedente'), yes('b', 'Sanguinamento maggiore precedente o predisposizione'), yes('i', 'INR labile'), yes('e', 'Età sopra i 65 anni'), yes('d', 'Farmaci (antiaggreganti, FANS)'), yes('a', 'Alcol (8 o più unità a settimana)')],
    read: n => (n >= 3 ? 'Rischio alto: correggi i fattori modificabili e controlla più spesso. Non è da solo un motivo per non anticoagulare.' : 'Rischio basso o intermedio.'),
    src: 'Pisters 2010, ripreso da ESC.' },
  { id: 'wellsep', title: 'Wells per embolia polmonare', cat: 'Emergenza', what: 'Probabilità clinica di embolia polmonare',
    items: [yes('dvt', 'Segni e sintomi di trombosi venosa profonda', 3), yes('alt', 'L’embolia è la diagnosi più probabile', 3), yes('hr', 'Frequenza cardiaca sopra 100', 1.5), yes('imm', 'Immobilizzazione 3 o più giorni o chirurgia nelle 4 settimane', 1.5), yes('prev', 'Embolia o trombosi precedenti', 1.5), yes('hem', 'Emottisi'), yes('ca', 'Tumore attivo')],
    read: n => `${n > 4 ? 'Embolia probabile: angio-TC.' : 'Embolia improbabile: D-dimero, se negativo la esclude.'} In tre classi: ${n < 2 ? 'bassa' : n <= 6 ? 'intermedia' : 'alta'} probabilità.`,
    src: 'Wells 2000; classi a due livelli (soglia 4) e a tre livelli (2 e 6).' },
  { id: 'wellstvp', title: 'Wells per trombosi venosa profonda', cat: 'Emergenza', what: 'Probabilità clinica di TVP',
    items: [yes('ca', 'Tumore attivo'), yes('par', 'Paralisi, paresi o gesso recente all’arto inferiore'), yes('bed', 'Allettamento 3 o più giorni o chirurgia maggiore nelle 12 settimane'), yes('ten', 'Dolorabilità lungo il decorso delle vene profonde'), yes('leg', 'Edema di tutta la gamba'), yes('calf', 'Polpaccio più grande di 3 cm rispetto all’altro'), yes('pit', 'Edema improntabile solo nella gamba sintomatica'), yes('col', 'Circoli collaterali superficiali (non varici)'), yes('prev', 'TVP precedente'), yes('alt', 'Diagnosi alternativa almeno altrettanto probabile', -2)],
    read: n => (n >= 2 ? 'TVP probabile: ecografia.' : 'TVP improbabile: D-dimero, se negativo la esclude.'),
    src: 'Wells 2003, versione a due livelli.' },
  { id: 'curb65', title: 'CURB-65', cat: 'Pneumologia', what: 'Gravità della polmonite acquisita in comunità',
    items: [yes('c', 'Confusione di nuova insorgenza'), yes('u', 'Urea sopra 7 mmol/L (azotemia sopra circa 42 mg/dL)'), yes('r', 'Frequenza respiratoria 30 o più'), yes('b', 'Pressione sistolica sotto 90 o diastolica 60 o meno'), yes('a', 'Età 65 anni o più')],
    read: n => (n <= 1 ? 'Rischio basso: di solito terapia a domicilio.' : n === 2 ? 'Rischio intermedio: valuta il ricovero.' : `Polmonite grave: ricovero${n >= 4 ? ', valuta la terapia intensiva' : ''}.`),
    src: 'British Thoracic Society (Lim 2003).' },
  { id: 'qsofa', title: 'qSOFA', cat: 'Emergenza', what: 'Sospetto di sepsi fuori dalla terapia intensiva',
    items: [yes('r', 'Frequenza respiratoria 22 o più'), yes('m', 'Alterazione dello stato mentale (GCS sotto 15)'), yes('b', 'Pressione sistolica 100 o meno')],
    read: n => (n >= 2 ? 'Rischio alto di esito sfavorevole: cerca disfunzioni d’organo (SOFA) e tratta come possibile sepsi.' : 'Rischio più basso, ma non esclude la sepsi.'),
    src: 'Sepsis-3 (Singer 2016). Le linee guida Surviving Sepsis 2021 sconsigliano di usarlo da solo come screening.' },
  { id: 'news2', title: 'NEWS2', cat: 'Emergenza', what: 'Allerta per il peggioramento clinico',
    items: [
      opt('rr', 'Frequenza respiratoria', [['12–20', 0], ['9–11', 1], ['21–24', 2], ['8 o meno', 3], ['25 o più', 3]]),
      opt('spo2', 'SpO₂ (scala 1)', [['96% o più', 0], ['94–95%', 1], ['92–93%', 2], ['91% o meno', 3]]),
      opt('o2', 'Ossigeno', [['Aria ambiente', 0], ['Ossigeno', 2]]),
      opt('sbp', 'Pressione sistolica', [['111–219', 0], ['101–110', 1], ['91–100', 2], ['90 o meno', 3], ['220 o più', 3]]),
      opt('hr', 'Frequenza cardiaca', [['51–90', 0], ['41–50', 1], ['91–110', 1], ['111–130', 2], ['40 o meno', 3], ['131 o più', 3]]),
      opt('cons', 'Coscienza', [['Vigile', 0], ['Nuova confusione, risponde alla voce, al dolore o non risponde', 3]]),
      opt('t', 'Temperatura', [['36,1–38,0 °C', 0], ['35,1–36,0 °C', 1], ['38,1–39,0 °C', 1], ['39,1 °C o più', 2], ['35,0 °C o meno', 3]])
    ],
    read: (n, v, it) => (n >= 7 ? 'Rischio alto: valutazione urgente da un team di emergenza.' : n >= 5 ? 'Rischio medio: valutazione urgente del medico.' : it.some(x => x.p === 3) ? 'Un parametro a 3: valutazione urgente del medico.' : 'Rischio basso: monitoraggio di routine.'),
    src: 'Royal College of Physicians 2017.' },
  { id: 'gcs', title: 'Glasgow Coma Scale', cat: 'Neurologia', what: 'Livello di coscienza',
    items: [
      opt('e', 'Apertura degli occhi', [['Spontanea', 4], ['Alla voce', 3], ['Al dolore', 2], ['Nessuna', 1]]),
      opt('v', 'Risposta verbale', [['Orientata', 5], ['Confusa', 4], ['Parole inappropriate', 3], ['Suoni incomprensibili', 2], ['Nessuna', 1]]),
      opt('m', 'Risposta motoria', [['Esegue i comandi', 6], ['Localizza il dolore', 5], ['Retrae al dolore', 4], ['Flessione anomala (decorticazione)', 3], ['Estensione (decerebrazione)', 2], ['Nessuna', 1]])
    ],
    read: n => (n <= 8 ? 'Trauma cranico grave; con 8 o meno si protegge di solito la via aerea.' : n <= 12 ? 'Compromissione moderata.' : 'Compromissione lieve o assente.'),
    src: 'Teasdale e Jennett 1974. Si riporta anche per componenti, per esempio E4 V5 M6.' },
  { id: 'childpugh', title: 'Child-Pugh', cat: 'Epatologia', what: 'Gravità della cirrosi',
    items: [
      opt('bil', 'Bilirubina', [['Sotto 2 mg/dL', 1], ['2–3 mg/dL', 2], ['Sopra 3 mg/dL', 3]]),
      opt('alb', 'Albumina', [['Sopra 3,5 g/dL', 1], ['2,8–3,5 g/dL', 2], ['Sotto 2,8 g/dL', 3]]),
      opt('inr', 'INR', [['Sotto 1,7', 1], ['1,7–2,3', 2], ['Sopra 2,3', 3]]),
      opt('asc', 'Ascite', [['Assente', 1], ['Lieve', 2], ['Moderata o grave', 3]]),
      opt('enc', 'Encefalopatia', [['Assente', 1], ['Grado I–II', 2], ['Grado III–IV', 3]])
    ],
    read: n => `Classe ${n <= 6 ? 'A' : n <= 9 ? 'B' : 'C'} (A 5–6, B 7–9, C 10–15).`,
    src: 'Pugh 1973.' },
  { id: 'meld', title: 'MELD e MELD-Na', cat: 'Epatologia', what: 'Gravità della malattia epatica terminale',
    items: [{ k: 'bil', label: 'Bilirubina', type: 'num', unit: 'mg/dL' }, { k: 'inr', label: 'INR', type: 'num', unit: '' }, { k: 'cr', label: 'Creatinina', type: 'num', unit: 'mg/dL' }, { k: 'na', label: 'Sodio, per il MELD-Na', type: 'num', unit: 'mEq/L' }, yes('dial', 'Dialisi almeno 2 volte nell’ultima settimana', 0)],
    calc: v => {
      if ([v.bil, v.inr, v.cr].some(x => x === null)) return null;
      const lo = x => Math.max(1, x);
      const cr = v.dial ? 4 : Math.min(4, lo(v.cr));
      const m = Math.round(10 * (0.957 * Math.log(cr) + 0.378 * Math.log(lo(v.bil)) + 1.12 * Math.log(lo(v.inr)) + 0.643));
      let out = `MELD <strong>${m}</strong>`;
      if (v.na !== null) {
        const na = Math.max(125, Math.min(137, v.na));
        const mn = m > 11 ? Math.round(m + 1.32 * (137 - na) - 0.033 * m * (137 - na)) : m;
        out += ` · MELD-Na <strong>${mn}</strong>`;
      }
      return `${out}.`;
    },
    src: 'Formula UNOS: i valori sotto 1 contano come 1, la creatinina al massimo 4; il sodio tra 125 e 137 e la correzione solo con MELD sopra 11.' }
];
const scoreState = { q: '', cat: '' };
function viewScores() {
  const cats = [...new Set(SCORES.map(s => s.cat))];
  setView(`
    <header class="page-head"><div><h1>Score clinici</h1><p class="lede">I punteggi più usati in reparto, con le soglie sotto. Strumenti di studio: la fonte sono io, Claude, sulle linee guida citate; verifica sempre.</p></div>
      <a class="btn" href="#/lab/calc">Calcoli di laboratorio</a></header>
    <input type="search" class="input search" id="scQ" placeholder="Cerca uno score" aria-label="Cerca uno score" value="${esc(scoreState.q)}">
    <div class="tag-cloud">${cats.map(c => `<button type="button" class="tag ${scoreState.cat === c ? 'on' : ''}" data-scc="${esc(c)}" aria-pressed="${scoreState.cat === c}">${esc(c)}</button>`).join('')}</div>
    <div class="lab-calcs sc-list" id="scList"></div>
  `);
  const card = s => `
    <section class="lab-calc sc" data-sc="${s.id}">
      <h2 class="sub">${s.title}</h2>
      <p class="hint sc-what">${s.what}</p>
      <div class="sc-items">${s.items.map(it => it.type === 'check'
        ? `<label class="check sc-chk"><input type="checkbox" data-k="${it.k}"><span>${esc(it.label)}${it.pts !== 1 && it.pts ? ` <span class="muted-inline">${it.pts > 0 ? '+' : ''}${String(it.pts).replace('.', ',')}</span>` : ''}</span></label>`
        : it.type === 'select'
          ? `<label class="field"><span>${esc(it.label)}</span><select class="input" data-k="${it.k}">${it.opts.map(([l, p], i) => `<option value="${i}">${esc(l)} (${p})</option>`).join('')}</select></label>`
          : `<label class="field"><span>${esc(it.label)}${it.unit ? ` <span class="muted-inline">${it.unit}</span>` : ''}</span><input class="input num" data-k="${it.k}" inputmode="decimal"></label>`).join('')}</div>
      <p class="lab-calc-out sc-out" aria-live="polite"></p>
      <p class="hint">Fonte: Claude, da ${esc(s.src)}</p>
    </section>`;
  const draw = () => {
    const f = foldAccents(scoreState.q);
    const list = SCORES.filter(s => (!scoreState.cat || s.cat === scoreState.cat) && (!f || foldAccents(`${s.title} ${s.what} ${s.cat}`).includes(f)));
    $('#scList').innerHTML = list.map(card).join('') || '<p class="hint">Nessuno score corrisponde.</p>';
    $$('.sc', $('#scList')).forEach(box => {
      const s = SCORES.find(x => x.id === box.dataset.sc);
      const upd = () => {
        const v = {};
        const parts = [];
        s.items.forEach(it => {
          const el = $(`[data-k="${it.k}"]`, box);
          if (it.type === 'check') { v[it.k] = el.checked; if (el.checked) parts.push({ k: it.k, p: it.pts }); }
          else if (it.type === 'select') { const [, p] = it.opts[+el.value]; v[it.k] = p; parts.push({ k: it.k, p }); }
          else v[it.k] = labNum(el.value);
        });
        let html;
        if (s.calc) html = s.calc(v);
        else {
          const n = parts.reduce((a, x) => a + x.p, 0);
          html = `Punteggio <strong>${String(n).replace('.', ',')}</strong>. ${s.read(n, v, parts)}`;
        }
        $('.sc-out', box).innerHTML = html || '';
      };
      box.addEventListener('input', upd);
      box.addEventListener('change', upd);
      if (!s.calc) upd();
    });
  };
  draw();
  $('#scQ').addEventListener('input', e => { scoreState.q = e.target.value; draw(); });
  on('[data-scc]', 'click', e => { const c = e.currentTarget.dataset.scc; scoreState.cat = scoreState.cat === c ? '' : c; $$('[data-scc]').forEach(b => { b.classList.toggle('on', b.dataset.scc === scoreState.cat); b.setAttribute('aria-pressed', b.dataset.scc === scoreState.cat); }); draw(); });
}

/* =====================================================================
   v3.39: Banca delle domande d’esame
   Le domande uscite agli esami, con materia, docente, anno e argomento;
   le stesse domande uscite più volte si sommano (frequenza). Si caricano da
   un foglio Excel (.xlsx) o CSV, si ripassano e compaiono nella loro sezione.
   Record nei link: { kind: 'examq' } → si sincronizzano e vanno nel backup.
   ===================================================================== */
const examQs = () => state.links.filter(l => l.kind === 'examq');
const eqKey = (q, nbId) => `${nbId || ''}|${foldAccents(q).replace(/[^a-z0-9]+/g, ' ').trim()}`;
const eqFreq = x => Math.max(1, (x.occ || []).length);
const eqOfSec = id => examQs().filter(x => (x.secIds || []).includes(id));
function eqSubject(x) { return nbById(x.notebookId)?.name || x.subject || 'Senza materia'; }
function eqMeta(x) {
  const occ = x.occ || [];
  const profs = [...new Set(occ.map(o => o.prof).filter(Boolean))];
  const years = [...new Set(occ.map(o => o.year || (o.date || '').slice(0, 4)).filter(Boolean))].sort();
  return [eqFreq(x) > 1 ? `uscita ${eqFreq(x)} volte` : 'uscita 1 volta', profs.slice(0, 2).join(', '), years.slice(-3).join(', ')].filter(Boolean).join(' · ');
}

/* ---------- Lettura di fogli Excel (.xlsx) e CSV, senza librerie esterne oltre a JSZip ---------- */
async function readSheetFile(file) {
  const name = file.name.toLowerCase();
  if (/\.(csv|tsv|txt)$/.test(name)) return parseCsv(await file.text());
  if (/\.xls$/.test(name)) throw new Error('I file .xls vecchi non si leggono qui: in Excel scegli Salva con nome → Cartella di lavoro Excel (.xlsx), oppure CSV.');
  if (/\.ods$/.test(name)) throw new Error('I file .ods non si leggono qui: salvali come .xlsx o CSV.');
  await ensureJSZip();
  let zip;
  try { zip = await window.JSZip.loadAsync(file); } catch { throw new Error('Il file non sembra un foglio Excel (.xlsx).'); }
  const xml = async p => { const f = zip.file(p); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
  const wb = await xml('xl/workbook.xml');
  if (!wb) throw new Error('Il file non sembra un foglio Excel (.xlsx).');
  const rels = await xml('xl/_rels/workbook.xml.rels');
  const sheetsEl = [...wb.getElementsByTagName('sheet')];
  const relTarget = rid => { const r = rels && [...rels.getElementsByTagName('Relationship')].find(x => x.getAttribute('Id') === rid); const t = r?.getAttribute('Target') || ''; return t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`; };
  const ss = await xml('xl/sharedStrings.xml');
  const strings = ss ? [...ss.getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
  const colIdx = ref => { const m = String(ref).match(/^([A-Z]+)/); let n = 0; for (const ch of m ? m[1] : 'A') n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const out = [];
  for (const sh of sheetsEl) {
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const doc = await xml(relTarget(rid));
    if (!doc) continue;
    const rows = [];
    [...doc.getElementsByTagName('row')].forEach(r => {
      const row = [];
      [...r.getElementsByTagName('c')].forEach(c => {
        const t = c.getAttribute('t');
        const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
        let val;
        if (t === 's') val = strings[+v] ?? '';
        else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
        else if (t === 'b') val = v === '1' ? 'VERO' : 'FALSO';
        else val = v;
        row[colIdx(c.getAttribute('r'))] = String(val ?? '');
      });
      rows.push(Array.from(row, x => x ?? ''));
    });
    out.push({ name: sh.getAttribute('name') || `Foglio ${out.length + 1}`, rows: rows.filter(r => r.some(x => String(x).trim())) });
  }
  return out;
}
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split('\n')[0] || '';
  const delim = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return [{ name: 'CSV', rows: rows.filter(r => r.some(x => String(x).trim())) }];
}
// Un .xlsx minimo: una riga di intestazione e i dati, celle di testo
async function writeXlsx(rows, sheetName = 'Domande') {
  await ensureJSZip();
  const x = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const col = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${col(ci)}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${x(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const zip = new window.JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${x(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  zip.file('xl/worksheets/sheet1.xml', sheet);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const EQ_HEAD = ['Domanda', 'Risposta', 'Materia', 'Argomento', 'Docente', 'Anno', 'Data', 'Fonte', 'Tag'];
const EQ_FIELDS = [
  ['q', 'Domanda', /domand|quesit|question/i],
  ['a', 'Risposta', /rispost|answer|soluzion/i],
  ['subject', 'Materia', /materi|esame|corso|insegnam|subject/i],
  ['topic', 'Argomento', /argoment|sezion|capitol|topic/i],
  ['prof', 'Docente', /docent|prof|commission|esaminat/i],
  ['year', 'Anno', /^anno|year/i],
  ['date', 'Data o appello', /data|appell|session|date/i],
  ['src', 'Fonte', /fonte|source|riferit|studente/i],
  ['tags', 'Tag', /tag|etichett/i]
];
// numeri di Excel che sono date (giorni dal 1900)
const xlDate = v => { const n = +v; if (!/^\d{5}(\.\d+)?$/.test(String(v)) || n < 20000 || n > 80000) return String(v || '').trim(); const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return d.toISOString().slice(0, 10); };

/* ---------- Pagina delle domande d’esame ---------- */
const eqState = { q: '', nb: '', prof: '', year: '', sort: 'freq' };
function eqFiltered() {
  const toks = foldAccents(eqState.q).split(/\s+/).filter(Boolean);
  let list = examQs().filter(x => (!eqState.nb || x.notebookId === eqState.nb || (eqState.nb === '_none' && !x.notebookId))
    && (!eqState.prof || (x.occ || []).some(o => o.prof === eqState.prof))
    && (!eqState.year || (x.occ || []).some(o => (o.year || (o.date || '').slice(0, 4)) === eqState.year))
    && (!toks.length || toks.every(t => foldAccents(`${x.q} ${x.a || ''} ${(x.tags || []).join(' ')} ${(x.secIds || []).map(id => secById(id)?.title || '').join(' ')}`).includes(t))));
  const last = x => (x.occ || []).map(o => o.date || o.year || '').sort().pop() || '';
  const bad = x => (x.stats?.ko || 0) - (x.stats?.ok || 0) * 0.5;
  list.sort(eqState.sort === 'recent' ? (a, b) => last(b).localeCompare(last(a)) || eqFreq(b) - eqFreq(a)
    : eqState.sort === 'wrong' ? (a, b) => bad(b) - bad(a) || eqFreq(b) - eqFreq(a)
    : eqState.sort === 'new' ? (a, b) => (b.created || 0) - (a.created || 0)
    : (a, b) => eqFreq(b) - eqFreq(a) || last(b).localeCompare(last(a)));
  return list;
}
function viewExamQ(p1) {
  if (p1 === 'quiz') return viewExamQuiz();
  const all = examQs();
  const nbs = [...new Set(all.map(x => x.notebookId).filter(Boolean))].map(nbById).filter(Boolean);
  const profs = [...new Set(all.flatMap(x => (x.occ || []).map(o => o.prof)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  const years = [...new Set(all.flatMap(x => (x.occ || []).map(o => o.year || (o.date || '').slice(0, 4))).filter(Boolean))].sort().reverse();
  setView(`
    <header class="page-head">
      <div><h1>Domande d’esame</h1><p class="lede">${all.length ? `${all.length} domande. ` : ''}Quelle uscite agli esami: si sommano quando escono di nuovo, così vedi cosa chiedono di più.</p></div>
      <div class="inline">
        <button class="btn primary" type="button" data-act="eq-new">Nuova domanda</button>
        <button class="btn" type="button" data-act="eq-import">Importa da Excel</button>
      </div>
    </header>
    ${all.length ? `
      <div class="eq-tools">
        <input type="search" class="input search" id="eqQ" placeholder="Cerca nelle domande e nelle risposte" aria-label="Cerca nelle domande" value="${esc(eqState.q)}">
        <div class="eq-filters">
          <select class="input" id="eqNb" aria-label="Materia"><option value="">Tutte le materie</option>${nbs.map(n => `<option value="${n.id}" ${eqState.nb === n.id ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}${all.some(x => !x.notebookId) ? `<option value="_none" ${eqState.nb === '_none' ? 'selected' : ''}>Senza notebook</option>` : ''}</select>
          ${profs.length ? `<select class="input" id="eqProf" aria-label="Docente"><option value="">Tutti i docenti</option>${profs.map(p => `<option ${eqState.prof === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>` : ''}
          ${years.length ? `<select class="input" id="eqYear" aria-label="Anno"><option value="">Tutti gli anni</option>${years.map(y => `<option ${eqState.year === y ? 'selected' : ''}>${esc(y)}</option>`).join('')}</select>` : ''}
          <select class="input" id="eqSort" aria-label="Ordine">${[['freq', 'Le più frequenti'], ['recent', 'Uscite di recente'], ['wrong', 'Quelle che sbagli'], ['new', 'Aggiunte di recente']].map(([k, l]) => `<option value="${k}" ${eqState.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <div class="inline"><a class="btn" href="#/examq/quiz" id="eqQuizBtn">Allenati su queste</a><button class="btn ghost" type="button" data-act="eq-export">Scarica in Excel</button></div>
      </div>
      <ul class="list eq-list" id="eqList"></ul>` : `
      <div class="empty">
        <p>Raccogli qui le domande uscite agli esami (anche quelle che ti raccontano i compagni): materia, docente, anno, argomento. Puoi scriverle una per una o caricarle tutte da un foglio Excel o Google Fogli.</p>
        <div class="inline" style="justify-content:center"><button class="btn primary" type="button" data-act="eq-import">Importa da Excel</button><button class="btn" type="button" data-act="eq-template">Scarica il modello</button></div>
      </div>`}
  `);
  const draw = () => {
    const box = $('#eqList');
    if (!box) return;
    const list = eqFiltered();
    $('#eqQuizBtn').textContent = `Allenati su queste (${list.length})`;
    box.innerHTML = list.slice(0, 400).map(x => `
      <li><button type="button" class="row" data-eq="${x.id}">
        <span class="eq-n" title="Volte che è uscita">${eqFreq(x)}×</span>
        <span class="row-main">
          <span class="row-title eq-q">${esc(x.q)}</span>
          <span class="row-sub">${esc([eqSubject(x), eqMeta(x)].join(' · '))}${(x.secIds || []).length ? ` · ${esc((x.secIds || []).map(id => secById(id)?.title).filter(Boolean).slice(0, 2).join(', '))}` : ''}</span>
        </span>
        ${x.stats && (x.stats.ok || x.stats.ko) ? `<span class="eq-st" title="La sapevo / non la sapevo">✓${x.stats.ok || 0} ✗${x.stats.ko || 0}</span>` : ''}
      </button></li>`).join('') || '<li class="hint">Nessuna domanda corrisponde.</li>';
  };
  draw();
  $('#eqQ')?.addEventListener('input', e => { eqState.q = e.target.value; draw(); });
  [['#eqNb', 'nb'], ['#eqProf', 'prof'], ['#eqYear', 'year'], ['#eqSort', 'sort']].forEach(([sel, k]) => $(sel)?.addEventListener('change', e => { eqState[k] = e.target.value; draw(); }));
  on('[data-act="eq-new"]', 'click', async () => { if (await eqSheet(null)) route(); });
  on('[data-act="eq-import"]', 'click', eqImportFlow);
  on('[data-act="eq-template"]', 'click', async () => { downloadBlob(await writeXlsx([EQ_HEAD, ['Descrivi il ciclo cardiaco', 'Sistole e diastole…', 'Fisiologia', 'Ciclo cardiaco', 'prof. Rossi', '2025', '2025-06-12', 'Racconto di un compagno', 'orale']]), 'Modello domande d’esame.xlsx'); toast('Modello scaricato: compila una domanda per riga'); });
  on('[data-act="eq-export"]', 'click', async () => {
    const rows = [EQ_HEAD];
    eqFiltered().forEach(x => {
      const occ = x.occ && x.occ.length ? x.occ : [{}];
      occ.forEach(o => rows.push([x.q, x.a || '', eqSubject(x), (x.secIds || []).map(id => secById(id)?.title).filter(Boolean).join('; '), o.prof || '', o.year || '', o.date || '', o.src || '', (x.tags || []).join(', ')]));
    });
    downloadBlob(await writeXlsx(rows), `Domande d’esame ${todayStr()}.xlsx`);
    toast('File Excel pronto: una riga per ogni volta che una domanda è uscita');
  });
  $('#eqList')?.addEventListener('click', async e => {
    const b = e.target.closest('[data-eq]');
    if (!b) return;
    const x = examQs().find(r => r.id === b.dataset.eq);
    if (x && await eqSheet(x)) route();
  });
}
// Scheda di una domanda: si vede e si modifica nello stesso foglio
function eqSheet(x, preset = {}) {
  return new Promise(resolve => {
    const isNew = !x;
    const r = x || { id: uid(), kind: 'examq', notebookId: preset.notebookId || '', q: '', a: '', secIds: preset.secIds || [], occ: [{ prof: '', year: String(new Date().getFullYear()), date: '', src: '' }], tags: [], created: Date.now() };
    const nbs = state.notebooks.filter(n => !n.kind);
    const secsOfNb = id => state.sections.filter(s => s.notebookId === id).sort((a, b) => a.title.localeCompare(b.title, 'it'));
    let occ = (r.occ || []).map(o => ({ ...o }));
    let secIds = [...(r.secIds || [])];
    const sh = openSheet(`
      <h2>${isNew ? 'Nuova domanda d’esame' : 'Domanda d’esame'}</h2>
      <label class="field"><span>Domanda</span><textarea class="input" id="eqQt" rows="3">${esc(r.q)}</textarea></label>
      <label class="field"><span>Risposta o traccia, facoltativa</span><textarea class="input" id="eqAt" rows="4" placeholder="Anche in elenco: i punti da toccare">${esc(r.a || '')}</textarea></label>
      <div class="grid2">
        <label class="field"><span>Materia (notebook)</span><select class="input" id="eqNbS"><option value="">Nessuno</option>${nbs.map(n => `<option value="${n.id}" ${n.id === r.notebookId ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Tag</span><input class="input" id="eqTags" value="${esc((r.tags || []).join(', '))}" placeholder="Es. orale, scritto"></label>
      </div>
      <div class="field"><span class="lbl">Argomenti collegati</span><div class="tags" id="eqSecs"></div>
        <select class="input" id="eqSecAdd" aria-label="Collega un argomento"></select></div>
      <div class="field"><span class="lbl">Quando è uscita</span><div id="eqOcc"></div><button class="btn sm ghost" type="button" data-eqx="occ">+ È uscita un’altra volta</button></div>
      ${!isNew && (r.stats?.ok || r.stats?.ko) ? `<p class="hint">Nell’allenamento: la sapevi ${r.stats.ok || 0} volte, non la sapevi ${r.stats.ko || 0}.</p>` : ''}
      <div class="modal-actions">
        ${isNew ? '' : '<button class="btn ghost danger" type="button" data-eqx="del">Elimina</button>'}
        <button class="btn ghost" type="button" data-eqx="no">Annulla</button>
        <button class="btn primary" type="button" data-eqx="ok">Salva</button>
      </div>`, { label: 'Domanda d’esame', onClose: v => resolve(!!v) });
    const drawSecs = () => {
      const nbId = $('#eqNbS', sh.el).value;
      $('#eqSecs', sh.el).innerHTML = secIds.map(id => secById(id)).filter(Boolean).map(s => `<span class="tag">${esc(s.title)} <button type="button" class="tag-x" data-eqsec="${s.id}" aria-label="Scollega ${esc(s.title)}">×</button></span>`).join('') || '<span class="hint">Nessuno</span>';
      $('#eqSecAdd', sh.el).innerHTML = `<option value="">${nbId ? '+ Collega un argomento' : 'Scegli prima la materia'}</option>${nbId ? secsOfNb(nbId).filter(s => !secIds.includes(s.id)).map(s => `<option value="${s.id}">${esc(s.title)}${groupPathText(s) ? ` · ${esc(groupPathText(s))}` : ''}</option>`).join('') : ''}`;
    };
    const drawOcc = () => {
      $('#eqOcc', sh.el).innerHTML = occ.map((o, i) => `<div class="eq-occ" data-oi="${i}">
        <input class="input" data-of="prof" value="${esc(o.prof || '')}" placeholder="Docente" aria-label="Docente">
        <input class="input" data-of="year" value="${esc(o.year || '')}" placeholder="Anno" inputmode="numeric" aria-label="Anno">
        <input class="input" data-of="date" value="${esc(o.date || '')}" placeholder="Data o appello" aria-label="Data o appello">
        <input class="input" data-of="src" value="${esc(o.src || '')}" placeholder="Fonte (es. un compagno)" aria-label="Fonte">
        <button class="btn sm ghost" type="button" data-odel="${i}" aria-label="Togli">✕</button></div>`).join('') || '<p class="hint">Aggiungi almeno una volta in cui è uscita.</p>';
    };
    const readOcc = () => $$('.eq-occ', sh.el).forEach(row => { const o = occ[+row.dataset.oi]; $$('[data-of]', row).forEach(i => { o[i.dataset.of] = i.value.trim(); }); });
    drawSecs(); drawOcc();
    $('#eqNbS', sh.el).addEventListener('change', drawSecs);
    $('#eqSecAdd', sh.el).addEventListener('change', e => { if (e.target.value) { secIds.push(e.target.value); drawSecs(); } });
    sh.el.addEventListener('click', async e => {
      const sx = e.target.closest('[data-eqsec]');
      if (sx) { secIds = secIds.filter(id => id !== sx.dataset.eqsec); drawSecs(); return; }
      const od = e.target.closest('[data-odel]');
      if (od) { readOcc(); occ.splice(+od.dataset.odel, 1); drawOcc(); return; }
      const b = e.target.closest('[data-eqx]');
      if (!b) return;
      const k = b.dataset.eqx;
      if (k === 'no') sh.close(false);
      if (k === 'occ') { readOcc(); occ.push({ prof: occ[occ.length - 1]?.prof || '', year: String(new Date().getFullYear()), date: '', src: '' }); drawOcc(); }
      if (k === 'del') {
        if (!(await modal({ title: 'Eliminare la domanda?', text: 'Sparisce dalla banca su tutti i tuoi dispositivi.', confirm: 'Elimina', danger: true }))) return;
        await removeRecords([{ store: 'links', rec: r }]);
        sh.close(true);
      }
      if (k === 'ok') {
        readOcc();
        const q = $('#eqQt', sh.el).value.trim();
        if (!q) { toast('Scrivi la domanda'); $('#eqQt', sh.el).focus(); return; }
        Object.assign(r, { q, a: $('#eqAt', sh.el).value.trim(), notebookId: $('#eqNbS', sh.el).value, secIds, tags: parseTags($('#eqTags', sh.el).value), occ: occ.filter(o => o.prof || o.year || o.date || o.src).length ? occ.filter(o => o.prof || o.year || o.date || o.src) : [{}] });
        await saveLink(r);
        toast(isNew ? 'Domanda aggiunta' : 'Domanda salvata');
        sh.close(true);
      }
    });
    setTimeout(() => (isNew ? $('#eqQt', sh.el) : null)?.focus(), 40);
  });
}

/* ---------- Importazione da Excel o CSV ---------- */
async function eqImportFlow() {
  const file = await new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';
    inp.addEventListener('change', () => res(inp.files && inp.files[0] ? inp.files[0] : null), { once: true });
    inp.click();
  });
  if (!file) return;
  let sheets;
  try { sheets = await readSheetFile(file); } catch (err) { toast(err.message || 'Non riesco a leggere il file', 'err'); return; }
  sheets = sheets.filter(s => s.rows.length);
  if (!sheets.length) { toast('Il foglio è vuoto'); return; }
  const nbs = state.notebooks.filter(n => !n.kind);
  let si = 0;
  const sh = openSheet(`
    <h2>Importa le domande</h2>
    <p class="sheet-sub">${esc(file.name)}: dimmi in quali colonne sono domanda, risposta e gli altri dati. Le domande già presenti (stesso testo e stessa materia) si sommano: aumenta il numero di volte che sono uscite.</p>
    ${sheets.length > 1 ? `<label class="field"><span>Foglio</span><select class="input" id="imSheet">${sheets.map((s, i) => `<option value="${i}">${esc(s.name)} (${s.rows.length} righe)</option>`).join('')}</select></label>` : ''}
    <label class="check"><input type="checkbox" id="imHead" checked><span>La prima riga contiene i titoli delle colonne</span></label>
    <div class="eq-map" id="imMap"></div>
    <div class="grid2">
      <label class="field"><span>Materia per le righe senza</span><select class="input" id="imNb"><option value="">Nessuna</option>${nbs.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join('')}</select></label>
      <label class="check eq-auto"><input type="checkbox" id="imAuto" checked><span>Collega gli argomenti cercando i titoli delle sezioni nel testo della domanda</span></label>
    </div>
    <div id="imPrev" class="eq-prev"></div>
    <div class="modal-actions">
      <button class="btn ghost" type="button" data-im="no">Annulla</button>
      <button class="btn primary" type="button" data-im="ok">Importa</button>
    </div>`, { label: 'Importa le domande' });
  const cols = () => {
    const s = sheets[si];
    const head = $('#imHead', sh.el).checked;
    const w = Math.max(...s.rows.map(r => r.length));
    return Array.from({ length: w }, (_, i) => (head ? String(s.rows[0][i] || '').trim() : '') || `Colonna ${String.fromCharCode(65 + (i % 26))}`);
  };
  const drawMap = () => {
    const names = cols();
    const head = $('#imHead', sh.el).checked;
    const used = new Set();
    $('#imMap', sh.el).innerHTML = EQ_FIELDS.map(([k, label, re]) => {
      let pick = head ? names.findIndex((n, i) => re.test(n) && !used.has(i)) : -1;
      if (k === 'q' && pick < 0) pick = 0;
      if (pick >= 0) used.add(pick);
      return `<label class="field"><span>${label}${k === 'q' ? '' : ' <span class="muted-inline">facoltativa</span>'}</span><select class="input" data-map="${k}"><option value="-1">—</option>${names.map((n, i) => `<option value="${i}" ${i === pick ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
    }).join('');
    drawPrev();
  };
  const mapping = () => Object.fromEntries($$('[data-map]', sh.el).map(s => [s.dataset.map, +s.value]));
  const rowsOut = () => {
    const s = sheets[si];
    const m = mapping();
    const body = $('#imHead', sh.el).checked ? s.rows.slice(1) : s.rows;
    const get = (r, k) => (m[k] >= 0 ? String(r[m[k]] ?? '').trim() : '');
    return body.map(r => ({ q: get(r, 'q'), a: get(r, 'a'), subject: get(r, 'subject'), topic: get(r, 'topic'), prof: get(r, 'prof'), year: get(r, 'year').replace(/\.0+$/, ''), date: xlDate(get(r, 'date')), src: get(r, 'src'), tags: parseTags(get(r, 'tags')) })).filter(x => x.q);
  };
  const resolveNb = (subject, fallback) => {
    if (!subject) return fallback;
    const f = foldAccents(subject).trim();
    return (nbs.find(n => foldAccents(n.name).trim() === f) || nbs.find(n => { const t = foldAccents(n.name); return t.length > 3 && (t.includes(f) || f.includes(t)); }))?.id || '';
  };
  const linkSecs = (row, nbId) => {
    const out = new Set();
    if (row.topic) row.topic.split(/[;|]/).map(t => t.trim()).filter(Boolean).forEach(t => { const s = guessSection(t, nbId || null); if (s) out.add(s.id); });
    if ($('#imAuto', sh.el).checked && nbId) {
      const fq = ` ${foldAccents(row.q).replace(/[^a-z0-9]+/g, ' ')} `;
      state.sections.filter(s => s.notebookId === nbId).forEach(s => {
        const t = foldAccents(s.title).replace(/[^a-z0-9]+/g, ' ').trim();
        if (t.length > 4 && fq.includes(` ${t} `) && out.size < 3) out.add(s.id);
      });
    }
    return [...out];
  };
  const drawPrev = () => {
    const rows = rowsOut();
    const fb = $('#imNb', sh.el).value;
    const have = new Set(examQs().map(x => eqKey(x.q, x.notebookId)));
    const keys = rows.map(r => eqKey(r.q, resolveNb(r.subject, fb)));
    const dupOld = keys.filter(k => have.has(k)).length;
    const uniq = new Set(keys).size;
    const linked = rows.slice(0, 200).filter(r => linkSecs(r, resolveNb(r.subject, fb)).length).length;
    $('#imPrev', sh.el).innerHTML = rows.length ? `
      <p class="hint"><strong>${rows.length}</strong> righe con una domanda: ${uniq} domande diverse${dupOld ? `, di cui ${new Set(keys.filter(k => have.has(k))).size} già nella banca (si sommano)` : ''}${uniq < rows.length ? `; ${rows.length - uniq} righe ripetono una domanda e ne aumentano la frequenza` : ''}. ${linked ? `Argomento trovato per ${linked}${rows.length > 200 ? ' delle prime 200' : ''}.` : ''}</p>
      <div class="table-wrap"><table class="eq-ptable"><thead><tr><th>Domanda</th><th>Materia</th><th>Docente</th><th>Anno</th></tr></thead><tbody>
        ${rows.slice(0, 6).map(r => `<tr><td>${esc(r.q.slice(0, 120))}</td><td>${esc(nbById(resolveNb(r.subject, fb))?.name || r.subject || '—')}</td><td>${esc(r.prof || '—')}</td><td>${esc(r.year || (r.date || '').slice(0, 4) || '—')}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="hint">Nessuna riga con la domanda: controlla la colonna scelta.</p>';
  };
  drawMap();
  sh.el.addEventListener('change', e => {
    if (e.target.id === 'imSheet') { si = +e.target.value; drawMap(); }
    else if (e.target.id === 'imHead') drawMap();
    else drawPrev();
  });
  $('[data-im="no"]', sh.el).onclick = () => sh.close();
  $('[data-im="ok"]', sh.el).onclick = async () => {
    const rows = rowsOut();
    if (!rows.length) { toast('Nessuna domanda da importare'); return; }
    const fb = $('#imNb', sh.el).value;
    const byKey = new Map(examQs().map(x => [eqKey(x.q, x.notebookId), x]));
    const touched = new Set();
    let added = 0, merged = 0;
    for (const r of rows) {
      const nbId = resolveNb(r.subject, fb);
      const key = eqKey(r.q, nbId);
      let x = byKey.get(key);
      const o = { prof: r.prof, year: r.year || (r.date || '').slice(0, 4), date: r.date, src: r.src };
      if (!x) {
        x = { id: uid(), kind: 'examq', notebookId: nbId, subject: nbId ? '' : r.subject, q: r.q, a: r.a, secIds: [], occ: [], tags: [], created: Date.now() + added };
        byKey.set(key, x);
        added++;
      } else if (!touched.has(x.id)) merged++;
      if (!x.a && r.a) x.a = r.a;
      x.occ = [...(x.occ || []).filter(v => v.prof || v.year || v.date || v.src), o];
      x.secIds = [...new Set([...(x.secIds || []), ...linkSecs(r, nbId)])];
      x.tags = [...new Set([...(x.tags || []), ...r.tags])];
      touched.add(x.id);
    }
    for (const id of touched) await saveLink([...byKey.values()].find(x => x.id === id));
    sh.close();
    toast(`${added} domande nuove${merged ? `, ${merged} già presenti aggiornate` : ''}`);
    go('#/examq');
    route();
  };
}

/* ---------- Allenamento ---------- */
function viewExamQuiz() {
  const list = eqFiltered();
  setView(`
    <div class="back-row"><a class="back" href="#/examq">Domande d’esame</a></div>
    <header class="page-head"><div><h1>Allenati sulle domande d’esame</h1><p class="lede">${list.length} domande, ${eqState.sort === 'freq' ? 'dalle più frequenti' : eqState.sort === 'wrong' ? 'da quelle che sbagli di più' : 'nell’ordine scelto'}. Rispondi a voce o per iscritto, poi guarda la traccia.</p></div></header>
    ${list.length ? '<div id="eqz"></div>' : '<div class="empty"><p>Nessuna domanda con i filtri scelti.</p><a class="btn primary" href="#/examq">Torna all’elenco</a></div>'}
  `);
  if (!list.length) return;
  let i = 0, shown = false, ok = 0, done = 0;
  const draw = () => {
    if (i >= list.length) {
      $('#eqz').innerHTML = `<div class="lab-q"><p class="lab-q-t">Finito: ne sapevi ${ok} su ${done}.</p><div class="inline"><button class="btn primary" type="button" data-qz="again">Ricomincia</button><a class="btn" href="#/examq">Torna all’elenco</a></div></div>`;
      return;
    }
    const x = list[i];
    const secs = (x.secIds || []).map(secById).filter(Boolean);
    $('#eqz').innerHTML = `
      <div class="lab-q">
        <p class="hint">${i + 1} di ${list.length} · ${esc(eqSubject(x))} · ${esc(eqMeta(x))}</p>
        <p class="lab-q-t">${esc(x.q)}</p>
        ${shown ? `<div class="lab-q-a notes">${x.a ? renderMd(x.a) : '<p class="hint">Nessuna traccia di risposta: aggiungila dalla scheda della domanda, oppure apri l’argomento.</p>'}</div>
          ${secs.length ? `<p class="hint">Argomento: ${secs.map(s => `<a href="#/sec/${s.id}/read">${esc(s.title)}</a>`).join(', ')}</p>` : ''}
          <div class="inline"><button class="btn" type="button" data-qz="no">Non la sapevo</button><button class="btn primary" type="button" data-qz="yes">La sapevo</button></div>`
        : '<button class="btn primary" type="button" data-qz="show">Mostra la traccia</button>'}
      </div>`;
  };
  $('#eqz').addEventListener('click', async e => {
    const b = e.target.closest('[data-qz]');
    if (!b) return;
    if (b.dataset.qz === 'again') { i = 0; ok = 0; done = 0; shown = false; draw(); return; }
    if (b.dataset.qz === 'show') { shown = true; draw(); return; }
    const x = list[i];
    x.stats = { ok: (x.stats?.ok || 0) + (b.dataset.qz === 'yes' ? 1 : 0), ko: (x.stats?.ko || 0) + (b.dataset.qz === 'no' ? 1 : 0), last: todayStr() };
    if (b.dataset.qz === 'yes') ok++;
    done++;
    i++;
    shown = false;
    saveLink(x);
    draw();
  });
  draw();
}
// Nella sezione, in fondo a Leggi
function eqSecBlockHtml(sec) {
  const list = eqOfSec(sec.id).sort((a, b) => eqFreq(b) - eqFreq(a));
  if (!list.length) return '';
  return `<section class="fonti eq-sec" aria-label="Domande d’esame su questo argomento">
    <div class="fonti-head"><h3>Domande d’esame (${list.length})</h3><a class="btn sm ghost" href="#/examq">Tutte</a></div>
    <ol class="fonti-list">${list.slice(0, 12).map(x => `<li><button type="button" class="link-btn" data-eqopen="${x.id}">${esc(x.q)}</button> <span class="muted-inline">${eqFreq(x)}×${(x.occ || []).map(o => o.prof).filter(Boolean)[0] ? ` · ${esc((x.occ || []).map(o => o.prof).filter(Boolean)[0])}` : ''}</span></li>`).join('')}</ol>
  </section>`;
}

/* =====================================================================
   v3.31: Semeiotica (vuota, la riempi tu)
   Come i casi clinici, ogni scheda è una sezione del notebook “Semeiotica”:
   ha Leggi, Cloze, Orale col semaforo, Flashcard, Video, foto con etichette
   e image occlusion, fonti e “incompleta”. In più tipo, ambito e distretto.
   ===================================================================== */
const SEMEI_TYPES = {
  manovra: { label: 'Manovra', parts: ['Come si esegue', 'Reperto normale', 'Reperto patologico e significato', 'Note'] },
  segno: { label: 'Segno', parts: ['Come si evoca', 'Cosa significa', 'In quali malattie', 'Note'] },
  repere: { label: 'Punto di repere', parts: ['Dove si trova', 'Come si trova', 'A cosa serve', 'Note'] }
};
const SEMEI_AREAS = { clinica: 'Clinica', chirurgica: 'Chirurgica' };
const semeiNb = () => state.notebooks.find(n => n.kind === 'semei');
async function ensureSemeiNb() {
  let nb = semeiNb();
  if (!nb) {
    nb = { id: uid(), name: 'Semeiotica', kind: 'semei', created: Date.now() };
    await saveNotebook(nb);
  }
  return nb;
}
const isSemei = sec => !!sec && !!semeiNb() && sec.notebookId === semeiNb().id;
const semeiOf = sec => (sec.semei && typeof sec.semei === 'object' ? sec.semei : (sec.semei = {}));
function semeiMetaBits(sec) {
  const m = semeiOf(sec);
  return [SEMEI_TYPES[m.type]?.label, SEMEI_AREAS[m.area], m.district].filter(Boolean);
}
let semeiQuery = '';
let semeiArea = '';
const semeiFilter = new Set();
function semeiSheet(sec = null, preset = {}) {
  return new Promise(resolve => {
    const m = sec ? semeiOf(sec) : { type: 'manovra', area: preset.area || 'clinica', district: preset.district || '' };
    const snb = semeiNb();
    const districts = [...new Set((snb ? secsOf(snb.id) : []).map(s => s.semei?.district).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
    const sh = openSheet(`
      <h2>${sec ? 'Dati della scheda' : 'Nuova scheda di semeiotica'}</h2>
      <label class="field"><span>Nome</span><input class="input" id="smTitle" value="${esc(sec?.title || '')}" placeholder="Es. Manovra di Giordano"></label>
      <div class="grid2">
        <label class="field"><span>Tipo</span><select class="input" id="smType">${Object.entries(SEMEI_TYPES).map(([k, t]) => `<option value="${k}" ${m.type === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
        <label class="field"><span>Ambito</span><select class="input" id="smArea">${Object.entries(SEMEI_AREAS).map(([k, l]) => `<option value="${k}" ${m.area === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Distretto o apparato</span><input class="input" id="smDistrict" value="${esc(m.district || '')}" list="smDistricts" placeholder="Es. Addome"><datalist id="smDistricts">${districts.map(d => `<option value="${esc(d)}">`).join('')}</datalist></label>
      ${sec ? '' : '<label class="check"><input type="checkbox" id="smTpl" checked><span id="smTplTxt"></span></label>'}
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-sm="no">Annulla</button>
        <button class="btn primary" type="button" data-sm="ok">${sec ? 'Salva' : 'Crea la scheda'}</button>
      </div>`, { label: sec ? 'Dati della scheda' : 'Nuova scheda di semeiotica', onClose: v => resolve(v || null) });
    const tplTxt = () => { const t = $('#smTplTxt', sh.el); if (t) t.textContent = `Prepara i titoli: ${SEMEI_TYPES[$('#smType', sh.el).value].parts.join(', ')}`; };
    tplTxt();
    $('#smType', sh.el).addEventListener('change', tplTxt);
    $('[data-sm="no"]', sh.el).onclick = () => sh.close(null);
    $('[data-sm="ok"]', sh.el).onclick = async () => {
      const title = $('#smTitle', sh.el).value.trim();
      if (!title) { toast('Scrivi il nome'); $('#smTitle', sh.el).focus(); return; }
      const data = { type: $('#smType', sh.el).value, area: $('#smArea', sh.el).value, district: $('#smDistrict', sh.el).value.trim() };
      let s = sec;
      if (!s) {
        const nb = await ensureSemeiNb();
        const tpl = $('#smTpl', sh.el)?.checked;
        s = newSection(nb.id, { title, md: tpl ? SEMEI_TYPES[data.type].parts.map(p => `## ${p}\n\n`).join('') : '' });
      } else s.title = title;
      s.semei = { ...semeiOf(s), ...data };
      await saveSection(s);
      sh.close(s);
    };
    setTimeout(() => $('#smTitle', sh.el)?.focus(), 40);
  });
}
async function newSemeiFlow(preset) {
  const s = await semeiSheet(null, preset);
  if (s) { toast('Scheda creata: scrivila o aggiungi foto e video'); go(`#/sec/${s.id}/edit`); }
}
function viewSemei() {
  const snb = semeiNb();
  const all = snb ? secsOf(snb.id) : [];
  const inArea = all.filter(s => !semeiArea || s.semei?.area === semeiArea);
  const facets = new Map();
  inArea.forEach(s => {
    const m = s.semei || {};
    if (m.type && SEMEI_TYPES[m.type]) facets.set(`type:${m.type}`, SEMEI_TYPES[m.type].label);
    if (m.district) facets.set(`dist:${m.district}`, m.district);
  });
  [...semeiFilter].forEach(k => { if (!facets.has(k)) semeiFilter.delete(k); });
  const areaCount = k => all.filter(s => s.semei?.area === k).length;
  setView(`
    <header class="page-head">
      <div><h1>Semeiotica</h1><p class="lede">Manovre, segni e punti di repere, divisi tra semeiotica clinica e chirurgica, con foto, video e descrizione dei passaggi.</p></div>
      <button class="btn primary" type="button" data-act="new-semei">Nuova scheda</button>
    </header>
    <nav class="tabs" aria-label="Ambito">
      <a href="#/semei" class="tab ${!semeiArea ? 'on' : ''}" data-area="">Tutte${all.length ? ` (${all.length})` : ''}</a>
      ${Object.entries(SEMEI_AREAS).map(([k, l]) => `<a href="#/semei" class="tab ${semeiArea === k ? 'on' : ''}" data-area="${k}">${l}${areaCount(k) ? ` (${areaCount(k)})` : ''}</a>`).join('')}
    </nav>
    ${all.length ? `
      <div class="inline semei-tools">
        <input type="search" class="input search" id="smQ" placeholder="Cerca una manovra, un segno, un distretto…" aria-label="Cerca nella semeiotica" value="${esc(semeiQuery)}">
        <button class="btn" type="button" data-act="semei-random" title="Apre una scheda a caso tra quelle filtrate, nella modalità Orale">Esercitati</button>
      </div>
      ${facets.size ? `<div class="tag-cloud" aria-label="Filtra">${[...facets.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0) || a[1].localeCompare(b[1], 'it')).map(([k, l]) => `<button type="button" class="tag ${semeiFilter.has(k) ? 'on' : ''}" data-sf="${esc(k)}" aria-pressed="${semeiFilter.has(k)}">${esc(l)}</button>`).join('')}</div>` : ''}
      <div id="smList"></div>` : `
      <div class="empty"><p>Ancora nessuna scheda. Creane una per ogni manovra, segno o punto di repere: scegli tipo, ambito (clinica o chirurgica) e distretto, poi scrivi i passaggi e aggiungi foto e video.</p><button class="btn primary" type="button" data-act="new-semei">Nuova scheda</button></div>`}
  `);
  on('[data-act="new-semei"]', 'click', () => newSemeiFlow({ area: semeiArea || 'clinica' }));
  on('[data-area]', 'click', e => { e.preventDefault(); semeiArea = e.currentTarget.dataset.area; route(); });
  const filtered = () => {
    const toks = foldAccents(semeiQuery).split(/\s+/).filter(Boolean);
    return inArea.filter(s => {
      const m = s.semei || {};
      for (const k of semeiFilter) {
        const t = k.slice(0, k.indexOf(':')), v = k.slice(k.indexOf(':') + 1);
        if ((t === 'type' && m.type !== v) || (t === 'dist' && m.district !== v)) return false;
      }
      return !toks.length || toks.every(t => foldAccents(`${s.title} ${s.md} ${m.district || ''} ${tagsOf(s).join(' ')}`).includes(t));
    });
  };
  const draw = () => {
    const box = $('#smList');
    if (!box) return;
    const list = filtered().sort((a, b) => a.title.localeCompare(b.title, 'it'));
    const byDist = new Map();
    list.forEach(s => { const k = s.semei?.district || 'Senza distretto'; if (!byDist.has(k)) byDist.set(k, []); byDist.get(k).push(s); });
    box.innerHTML = list.length ? [...byDist.entries()].sort((a, b) => (a[0] === 'Senza distretto') - (b[0] === 'Senza distretto') || a[0].localeCompare(b[0], 'it')).map(([d, secs]) => `
      <h2 class="sub">${esc(d)}</h2>
      <ul class="list">${secs.map(s => {
        const m = s.semei || {};
        const nImg = imageRefs(s.md).length, nVid = (s.videos || []).length;
        const bits = [SEMEI_TYPES[m.type]?.label, !semeiArea ? SEMEI_AREAS[m.area] : '', nImg ? `${nImg} foto` : '', nVid ? `${nVid} video` : '', s.incomplete ? '⚠ incompleta' : ''].filter(Boolean);
        return `<li><a class="row" href="#/sec/${s.id}/read"><span class="row-main"><span class="row-title">${esc(s.title)}</span><span class="row-sub">${esc(bits.join(' · '))}</span></span>${statusPill(s)}</a></li>`;
      }).join('')}</ul>`).join('') : '<p class="hint">Nessuna scheda corrisponde.</p>';
  };
  draw();
  $('#smQ')?.addEventListener('input', e => { semeiQuery = e.target.value; draw(); });
  on('[data-sf]', 'click', e => {
    const k = e.currentTarget.dataset.sf;
    if (semeiFilter.has(k)) semeiFilter.delete(k); else semeiFilter.add(k);
    e.currentTarget.classList.toggle('on', semeiFilter.has(k));
    e.currentTarget.setAttribute('aria-pressed', semeiFilter.has(k));
    draw();
  });
  on('[data-act="semei-random"]', 'click', () => {
    const list = filtered().filter(s => String(s.md || '').replace(/^##.*$/gm, '').trim());
    if (!list.length) { toast('Nessuna scheda scritta tra quelle filtrate'); return; }
    const s = list[Math.floor(Math.random() * list.length)];
    go(`#/sec/${s.id}/oral`);
  });
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
// le categorie nuove create da te si salvano col loro nome
const labCatName = k => (LAB_CATS.find(c => c[0] === k) || [k, String(k || '').startsWith('c:') ? String(k).slice(2) : 'Altro'])[1];
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

/* ---------- Dati di partenza degli esami, scritti da Claude ----------
   Valori indicativi dell’adulto come nei testi di riferimento, in unità
   convenzionali. Ogni laboratorio ha i suoi: tutto è modificabile e vale
   sempre il range stampato sul referto.
   r: righe di range [per chi, min, max, nota] · c: valori critici [basso, alto]
   u: cause di aumento · d: cause di diminuzione · p: prelievo e preparazione
   k: andamento nel tempo · w: quando richiederlo · n: note · si: [unità SI, fattore] */
const LAB_SOURCE_CLAUDE = 'Claude (AI di Anthropic): valori indicativi da testi di riferimento, da verificare sul tuo libro e sul referto del laboratorio';
const LAB_DATA = {
  'Emoglobina': { r: [['Uomini', '13', '17', ''], ['Donne', '12', '15,5', '']], c: ['7', '20'], si: ['g/L', '10'],
    u: 'Policitemia vera\nPoliglobulia secondaria: ipossia cronica (BPCO, cardiopatie cianogene, apnee notturne), alta quota, fumo\nProduzione inappropriata di eritropoietina (tumori renali, epatocarcinoma)\nEmoconcentrazione da disidratazione\nTestosterone o eritropoietina esogeni',
    d: 'Anemia da carenza di ferro, B12 o folati\nPerdite ematiche acute o croniche\nEmolisi\nAnemia delle malattie croniche\nInsufficienza renale cronica\nInsufficienza midollare, mielodisplasie, infiltrazione midollare\nEmodiluizione, gravidanza (fisiologica)',
    w: 'Sospetta anemia o poliglobulia, sanguinamento, controllo di terapie' },
  'Ematocrito': { r: [['Uomini', '40', '50', ''], ['Donne', '36', '46', '']], u: 'Le stesse dell’emoglobina alta, in particolare disidratazione e policitemia', d: 'Le stesse dell’emoglobina bassa; emodiluizione' },
  'Globuli rossi': { r: [['Uomini', '4,5', '5,9', ''], ['Donne', '4', '5,2', '']], u: 'Policitemia vera e poliglobulie secondarie\nTrait talassemico (molti globuli rossi piccoli con emoglobina normale o poco ridotta)\nDisidratazione', d: 'Anemie\nEmodiluizione' },
  'Volume corpuscolare medio': { r: [['Adulti', '80', '100', '']],
    u: 'Carenza di B12 o folati (anemia megaloblastica)\nAlcol\nEpatopatia\nIpotiroidismo\nMielodisplasie\nReticolocitosi (emolisi, emorragia)\nFarmaci: idrossiurea, metotrexato, zidovudina',
    d: 'Carenza di ferro\nTalassemie\nAnemia delle malattie croniche (talvolta)\nAnemia sideroblastica',
    n: 'Insieme all’RDW orienta: microcitosi con RDW alto fa pensare a carenza di ferro, con RDW normale a talassemia.' },
  'Contenuto emoglobinico medio': { r: [['Adulti', '27', '33', '']], u: 'Macrocitosi', d: 'Carenza di ferro, talassemie (ipocromia)' },
  'Concentrazione emoglobinica media': { r: [['Adulti', '32', '36', '']], u: 'Sferocitosi ereditaria\nAgglutinine fredde e lipemia (falsi aumenti)', d: 'Carenza di ferro, talassemie' },
  'Ampiezza di distribuzione dei globuli rossi': { r: [['Adulti', '11,5', '14,5', '']], u: 'Carenza di ferro, B12 o folati\nAnemie miste\nDopo trasfusione o terapia marziale\nMielodisplasie', d: 'Non ha significato clinico' },
  'Globuli bianchi': { r: [['Adulti', '4', '10', '']], c: ['2', '30'],
    u: 'Infezioni batteriche\nInfiammazione, traumi, ustioni, chirurgia\nCorticosteroidi, stress, esercizio intenso\nFumo\nLeucemie e sindromi mieloproliferative\nNecrosi tissutale (infarto)',
    d: 'Infezioni virali, sepsi grave\nFarmaci (chemioterapici, antitiroidei, clozapina e molti altri)\nInsufficienza o infiltrazione midollare\nCarenza di B12 o folati\nIpersplenismo\nMalattie autoimmuni (LES)' },
  'Neutrofili': { r: [['Adulti', '1,8', '7,5', '']], c: ['0,5', ''],
    u: 'Infezioni batteriche\nInfiammazione acuta, necrosi\nCorticosteroidi\nLeucemia mieloide cronica e altre neoplasie mieloproliferative',
    d: 'Farmaci (chemioterapici, metamizolo, antitiroidei, clozapina)\nInfezioni virali, sepsi grave\nAplasia o infiltrazione midollare\nNeutropenia etnica benigna\nIpersplenismo, autoimmunità',
    n: 'Sotto 0,5 ×10³/µL (neutropenia grave) il rischio di infezioni è alto: una febbre in questa situazione è un’urgenza.' },
  'Linfociti': { r: [['Adulti', '1', '4', '']], u: 'Infezioni virali (mononucleosi, CMV, pertosse)\nLeucemia linfatica cronica e linfomi', d: 'Corticosteroidi, immunosoppressori\nHIV\nStress acuto, sepsi\nLinfomi, chemioterapia, radioterapia' },
  'Monociti': { r: [['Adulti', '0,2', '0,8', '']], u: 'Infezioni croniche (tubercolosi, endocardite)\nFase di recupero di una neutropenia\nMalattie infiammatorie croniche intestinali\nLeucemia mielomonocitica cronica', d: 'Aplasia midollare\nCorticosteroidi\nLeucemia a cellule capellute' },
  'Eosinofili': { r: [['Adulti', '0', '0,5', '']], u: 'Allergie, asma, dermatite atopica\nParassitosi (soprattutto elminti)\nFarmaci (anche reazione DRESS)\nVasculiti (granulomatosi eosinofila con poliangioite)\nInsufficienza surrenalica\nNeoplasie ematologiche, sindrome ipereosinofila', d: 'Corticosteroidi\nStress acuto, sindrome di Cushing' },
  'Basofili': { r: [['Adulti', '0', '0,1', '']], u: 'Leucemia mieloide cronica e altre neoplasie mieloproliferative\nAllergie\nIpotiroidismo', d: 'Non ha significato clinico' },
  'Piastrine': { r: [['Adulti', '150', '400', '']], c: ['20', '1000'],
    u: 'Trombocitosi reattiva: infezioni, infiammazione, carenza di ferro, emorragie, dopo splenectomia, tumori\nTrombocitemia essenziale e altre neoplasie mieloproliferative',
    d: 'Ridotta produzione: aplasia, infiltrazione midollare, chemioterapia, alcol, carenza di B12 o folati\nAumentata distruzione: trombocitopenia immune, farmaci (eparina: HIT), CID, porpora trombotica trombocitopenica, sindrome emolitico-uremica\nSequestro splenico (ipertensione portale)\nPseudopiastrinopenia da EDTA (aggregati in provetta)',
    n: 'Una piastrinopenia isolata e inattesa va ricontrollata su provetta al citrato per escludere la pseudopiastrinopenia da EDTA.' },
  'Reticolociti': { r: [['Adulti', '0,5', '2,5', '']], u: 'Emolisi\nPerdita ematica acuta (dopo 3-5 giorni)\nRisposta alla terapia con ferro, B12 o folati', d: 'Carenze di ferro, B12 o folati non trattate\nAplasia midollare, aplasia eritroide (parvovirus B19)\nInsufficienza renale (poca eritropoietina)\nAnemia delle malattie croniche',
    n: 'Dicono se il midollo risponde all’anemia: anemia con reticolociti alti è periferica (emolisi, emorragia), con reticolociti bassi è da ridotta produzione.' },
  'Velocità di eritrosedimentazione': { r: [['Uomini', '', '15', 'sotto i 50 anni; con l’età si alza (circa età/2)'], ['Donne', '', '20', 'sotto i 50 anni; con l’età si alza (circa (età+10)/2)']],
    u: 'Infezioni e infiammazioni\nArterite a cellule giganti e polimialgia reumatica (spesso oltre 50-100)\nMieloma e gammopatie\nTumori\nAnemia, gravidanza, età avanzata, insufficienza renale', d: 'Policitemia\nAnemia falciforme, sferocitosi\nIpofibrinogenemia\nInsufficienza cardiaca grave',
    k: 'Lenta: sale in giorni e scende in settimane, più lenta della PCR.' },
  'Tempo di protrombina': { r: [['Adulti', '11', '13,5', 'secondi; molti laboratori lo esprimono come INR o come percentuale di attività']],
    u: 'Terapia con antagonisti della vitamina K (warfarin)\nCarenza di vitamina K (malassorbimento, antibiotici, ittero ostruttivo)\nEpatopatia grave\nCoagulazione intravascolare disseminata\nCarenza dei fattori VII, X, V, II, fibrinogeno', d: 'Non ha significato clinico' },
  'International Normalized Ratio': { r: [['Senza terapia', '0,8', '1,2', '']], c: ['', '5'],
    u: 'Warfarin e altri antagonisti della vitamina K\nCarenza di vitamina K\nInsufficienza epatica\nCID', d: 'Non ha significato clinico',
    n: 'In terapia con warfarin l’obiettivo è di solito 2-3 (2,5-3,5 per alcune protesi valvolari meccaniche). Serve a confrontare i PT di laboratori diversi.' },
  'Tempo di tromboplastina parziale attivata': { r: [['Adulti', '25', '35', 'secondi; spesso espresso come rapporto (ratio 0,8-1,2)']],
    u: 'Eparina non frazionata\nEmofilia A e B (fattori VIII, IX), carenza di fattore XI o XII\nMalattia di von Willebrand (a volte)\nLupus anticoagulant (allunga in vitro, ma dà trombosi)\nCID, epatopatia grave', d: 'Non ha significato clinico',
    n: 'Allungato con PT normale: pensa a eparina, carenze della via intrinseca o lupus anticoagulant; il test di miscela distingue una carenza (si corregge) da un inibitore (non si corregge).' },
  'Fibrinogeno': { r: [['Adulti', '200', '400', '']], c: ['100', ''], si: ['g/L', '0,01'],
    u: 'Infiammazione e infezioni (proteina di fase acuta)\nGravidanza, tumori, fumo', d: 'Coagulazione intravascolare disseminata\nEpatopatia grave\nFibrinolisi, terapia trombolitica\nDifetti congeniti (afibrinogenemia, disfibrinogenemia)\nEmorragie massive con diluizione' },
  'D-dimero': { r: [['Adulti', '', '500', 'ng/mL FEU; oltre i 50 anni si usa il limite età × 10']],
    u: 'Tromboembolismo venoso (trombosi venosa profonda, embolia polmonare)\nCID\nChirurgia e traumi recenti\nInfezioni, tumori, gravidanza, età avanzata\nDissecazione aortica',
    n: 'Molto sensibile e poco specifico: serve soprattutto a escludere un tromboembolismo quando la probabilità clinica (score di Wells) è bassa o intermedia. Un valore alto da solo non fa diagnosi.' },
  'Antitrombina': { r: [['Adulti', '80', '120', '']], d: 'Deficit congenito (trombofilia)\nConsumo: CID, trombosi estese\nEpatopatia (ridotta sintesi)\nSindrome nefrosica (perdita urinaria)\nTerapia con eparina prolungata, L-asparaginasi', n: 'Una carenza riduce l’effetto dell’eparina (resistenza all’eparina).' },
  'Sodio': { r: [['Adulti', '135', '145', '']], c: ['120', '160'],
    u: 'Perdita di acqua libera: scarso accesso all’acqua, sudorazione, diarrea osmotica\nDiabete insipido centrale o nefrogenico\nDiuresi osmotica (iperglicemia)\nApporto eccessivo di sodio (soluzioni ipertoniche, bicarbonato)',
    d: 'SIADH (tumori, malattie polmonari e del sistema nervoso, farmaci)\nDiuretici tiazidici\nInsufficienza cardiaca, cirrosi, sindrome nefrosica\nIpotiroidismo grave, insufficienza surrenalica\nPolidipsia primaria, ridotto apporto di soluti\nPseudoiponatriemia (iperlipidemia, paraproteine) e iponatriemia da iperglicemia',
    n: 'Correggere un’iponatriemia cronica troppo in fretta (più di circa 8-10 mEq/L in 24 ore) espone alla sindrome da demielinizzazione osmotica. Con iperglicemia calcola il sodio corretto (scheda Calcoli).' },
  'Potassio': { r: [['Adulti', '3,5', '5', '']], c: ['2,5', '6,5'],
    u: 'Insufficienza renale acuta o cronica\nFarmaci: ACE-inibitori, sartani, spironolattone, FANS, eparina, trimetoprim\nInsufficienza surrenalica (ipoaldosteronismo)\nAcidosi, deficit di insulina\nLisi tissutale: rabdomiolisi, emolisi, lisi tumorale\nPseudoiperkaliemia: prelievo emolizzato, leucocitosi o piastrinosi estreme',
    d: 'Perdite gastrointestinali (vomito, diarrea)\nDiuretici dell’ansa e tiazidici\nIperaldosteronismo, sindrome di Cushing\nAlcalosi, insulina, beta-2-agonisti\nIpomagnesemia\nScarso apporto',
    n: 'Valori critici possono dare aritmie gravi: con potassio alto controlla subito l’ECG (onde T appuntite, QRS largo). Un campione emolizzato dà falsi aumenti.' },
  'Cloro': { r: [['Adulti', '98', '107', '']], u: 'Acidosi metabolica ipercloremica (diarrea, acidosi tubulare renale)\nInfusione abbondante di fisiologica\nDisidratazione', d: 'Vomito e aspirazione gastrica (alcalosi metabolica)\nDiuretici\nIperidratazione\nAcidosi respiratoria compensata' },
  'Calcio totale': { r: [['Adulti', '8,5', '10,5', '']], c: ['6,5', '13'], si: ['mmol/L', '0,2495'],
    u: 'Iperparatiroidismo primario (più frequente negli ambulatori)\nTumori: PTHrP, metastasi ossee, mieloma (più frequente in ospedale)\nIntossicazione da vitamina D, granulomatosi (sarcoidosi)\nTiazidici, litio\nImmobilizzazione, ipertiroidismo',
    d: 'Ipoalbuminemia (calcio totale basso, ionizzato normale)\nIpoparatiroidismo (anche dopo tiroidectomia)\nCarenza di vitamina D, insufficienza renale cronica\nIpomagnesemia\nPancreatite acuta\nTrasfusioni massive (citrato)',
    n: 'Con albumina bassa usa il calcio corretto (scheda Calcoli) o dosa il calcio ionizzato.' },
  'Calcio ionizzato': { r: [['Adulti', '1,12', '1,32', '']], u: 'Le stesse del calcio totale alto', d: 'Ipoparatiroidismo, carenza di vitamina D\nAlcalosi (il calcio si lega di più all’albumina)\nTrasfusioni massive (citrato), sepsi, pancreatite', n: 'È la frazione attiva: non risente dell’albumina ma risente del pH.' },
  'Magnesio': { r: [['Adulti', '1,7', '2,4', '']], c: ['1', ''], si: ['mmol/L', '0,4114'], u: 'Insufficienza renale\nSomministrazione eccessiva (solfato di magnesio in ostetricia, lassativi, antiacidi)', d: 'Alcolismo, malnutrizione\nDiarrea, malassorbimento\nDiuretici, inibitori di pompa protonica per lungo tempo\nCisplatino, aminoglicosidi, amfotericina\nChetoacidosi diabetica in trattamento', n: 'Una ipomagnesemia rende difficile correggere l’ipokaliemia e l’ipocalcemia.' },
  'Fosforo': { r: [['Adulti', '2,5', '4,5', '']], c: ['1', ''], si: ['mmol/L', '0,3229'], u: 'Insufficienza renale\nIpoparatiroidismo\nLisi tumorale, rabdomiolisi\nEccesso di vitamina D', d: 'Iperparatiroidismo primario\nSindrome da rialimentazione (refeeding)\nAlcolismo, malnutrizione\nCarenza di vitamina D\nChetoacidosi in trattamento con insulina\nTubulopatie (sindrome di Fanconi)' },
  'Bicarbonati': { r: [['Adulti', '22', '28', '']], c: ['10', '40'], u: 'Alcalosi metabolica: vomito, diuretici, iperaldosteronismo\nCompenso di un’acidosi respiratoria cronica (BPCO)', d: 'Acidosi metabolica: chetoacidosi, acidosi lattica, insufficienza renale, diarrea, acidosi tubulare renale, intossicazioni\nCompenso di un’alcalosi respiratoria' },
  'Osmolalità plasmatica': { r: [['Adulti', '275', '295', '']], u: 'Ipernatriemia\nIperglicemia\nUremia\nAlcoli e glicoli (etanolo, metanolo, glicole etilenico): gap osmolare aumentato\nMannitolo', d: 'Iponatriemia ipotonica (SIADH, polidipsia, scompenso)' },
  'pH arterioso': { r: [['Adulti', '7,35', '7,45', '']], c: ['7,2', '7,6'], u: 'Alcalosi metabolica (vomito, diuretici)\nAlcalosi respiratoria (iperventilazione: ansia, ipossia, embolia polmonare, sepsi iniziale, salicilati)', d: 'Acidosi metabolica (chetoacidosi, acidosi lattica, insufficienza renale, diarrea)\nAcidosi respiratoria (ipoventilazione: BPCO, sedativi, malattie neuromuscolari)', n: 'Leggi l’emogas in ordine: pH, poi pCO₂ e bicarbonati per capire il disturbo primario, poi il compenso atteso e il gap anionico.' },
  'Pressione parziale di CO₂': { r: [['Adulti', '35', '45', '']], c: ['20', '70'], u: 'Ipoventilazione: BPCO riacutizzata, sedativi e oppioidi, malattie neuromuscolari, obesità-ipoventilazione\nCompenso di un’alcalosi metabolica', d: 'Iperventilazione: ansia, dolore, ipossiemia, embolia polmonare, sepsi, salicilati\nCompenso di un’acidosi metabolica' },
  'Pressione parziale di O₂': { r: [['Adulti in aria ambiente', '80', '100', 'si riduce con l’età']], c: ['40', ''], d: 'Ipoventilazione\nAlterazione ventilazione/perfusione (polmonite, BPCO, asma, embolia polmonare)\nShunt (ARDS, atelettasia, cardiopatie)\nDisturbo della diffusione (fibrosi polmonare)\nBassa FiO₂ (alta quota)', u: 'Ossigenoterapia', n: 'Con ossigeno valuta il rapporto pO₂/FiO₂ (normale circa 400-500; sotto 300 indica insufficienza respiratoria in ARDS).' },
  'Eccesso di basi': { r: [['Adulti', '-2', '2', '']], u: 'Alcalosi metabolica', d: 'Acidosi metabolica' },
  'Lattati': { r: [['Adulti', '0,5', '2', '']], c: ['', '4'], u: 'Ipoperfusione: shock settico, cardiogeno, ipovolemico\nIpossia grave\nIschemia intestinale\nConvulsioni, esercizio intenso\nInsufficienza epatica\nMetformina, intossicazioni (cianuro, alcoli), tiamina carente', n: 'Nella sepsi un lattato oltre 2 mmol/L indica ipoperfusione; oltre 4 è un segno di gravità. Si ripete per vedere se scende con la terapia.' },
  'Creatinina': { r: [['Uomini', '0,7', '1,2', ''], ['Donne', '0,5', '1', '']], si: ['µmol/L', '88,4'],
    u: 'Insufficienza renale acuta o cronica\nRiduzione della perfusione renale: disidratazione, scompenso\nOstruzione delle vie urinarie\nGrande massa muscolare, dieta ricca di carne\nRabdomiolisi\nFarmaci che ne riducono la secrezione tubulare (trimetoprim, cimetidina)',
    d: 'Ridotta massa muscolare (anziani, malnutrizione, amputazioni)\nGravidanza (aumento del filtrato)\nEpatopatia grave',
    n: 'Sale solo quando il filtrato è già calato molto: per stimare la funzione renale usa l’eGFR (scheda Calcoli).' },
  'Filtrato glomerulare stimato': { r: [['Adulti', '90', '', 'tra 60 e 89 è normale se non ci sono segni di danno renale']], d: 'Malattia renale cronica (sotto 60 per più di 3 mesi)\nInsufficienza renale acuta (la stima non è affidabile se la creatinina non è stabile)\nEtà avanzata', n: 'Classi della malattia renale cronica: G1 ≥90, G2 60-89, G3a 45-59, G3b 30-44, G4 15-29, G5 <15 mL/min/1,73 m².' },
  'Azotemia (urea)': { r: [['Adulti', '15', '50', 'come urea; come BUN circa 7-20 mg/dL']], si: ['mmol/L', '0,1665'], u: 'Insufficienza renale\nDisidratazione, scompenso (azotemia prerenale: rapporto urea/creatinina alto)\nEmorragia digestiva alta\nDieta iperproteica, catabolismo, corticosteroidi', d: 'Insufficienza epatica grave\nMalnutrizione, dieta povera di proteine\nGravidanza, iperidratazione\nSIADH' },
  'Acido urico': { r: [['Uomini', '3,5', '7,2', ''], ['Donne', '2,6', '6', '']], si: ['µmol/L', '59,48'], u: 'Gotta e iperuricemia primaria\nInsufficienza renale\nDiuretici, basse dosi di aspirina, ciclosporina\nAlcol, dieta ricca di purine e fruttosio\nLisi tumorale, malattie mieloproliferative, psoriasi\nSindrome metabolica, preeclampsia', d: 'Allopurinolo, febuxostat, uricosurici\nSIADH\nSindrome di Fanconi\nGravidanza', n: 'Durante un attacco acuto di gotta l’uricemia può essere normale.' },
  'Esame delle urine': { r: [['Peso specifico', '1,005', '1,030', ''], ['pH', '4,5', '8', '']],
    n: 'Normalmente sono **negativi**: proteine, glucosio, corpi chetonici, emoglobina, nitriti, esterasi leucocitaria, bilirubina. Nel sedimento: pochi leucociti ed emazie (fino a circa 2-5 per campo), nessun cilindro patologico.\n\n- **Nitriti ed esterasi** positivi: infezione delle vie urinarie\n- **Cilindri ematici**: glomerulonefrite\n- **Cilindri granulosi "a fango"**: necrosi tubulare acuta\n- **Emoglobina positiva senza emazie**: emoglobinuria o mioglobinuria (rabdomiolisi)' },
  'Proteinuria delle 24 ore': { r: [['Adulti', '', '150', '']], u: 'Glomerulopatie (oltre 3,5 g/24 h: range nefrosico)\nNefropatia diabetica e ipertensiva\nMieloma (catene leggere: non sempre viste dallo stick)\nFebbre, esercizio intenso, ortostatismo (transitoria)\nInfezioni urinarie' },
  'Rapporto albumina/creatinina urinario': { r: [['Adulti', '', '30', '']], u: 'Danno renale iniziale: diabete, ipertensione\nGlomerulopatie\nEsercizio, febbre, infezioni urinarie (transitorio)', n: 'Classi: A1 sotto 30, A2 30-300, A3 oltre 300 mg/g. Va confermato su 2 campioni su 3 in 3-6 mesi.' },
  'Aspartato aminotransferasi': { r: [['Adulti', '10', '40', '']], u: 'Epatiti virali, tossiche (paracetamolo) e ischemiche\nEpatopatia alcolica (AST/ALT oltre 2)\nSteatosi epatica\nDanno muscolare: rabdomiolisi, miositi, esercizio intenso\nInfarto miocardico\nEmolisi', n: 'Non è specifica del fegato: si trova anche nel muscolo e nei globuli rossi.' },
  'Alanina aminotransferasi': { r: [['Uomini', '10', '50', ''], ['Donne', '10', '35', '']], u: 'Epatiti virali acute e croniche\nSteatosi epatica (MASLD)\nFarmaci e tossici (paracetamolo, amiodarone, statine, antitubercolari)\nEpatite ischemica (valori altissimi)\nEpatite autoimmune, malattia di Wilson, emocromatosi\nCeliachia', n: 'È più specifica del fegato rispetto all’AST. Valori oltre 1000 U/L fanno pensare a epatite virale acuta, tossica (paracetamolo) o ischemica.' },
  'Gamma-glutamiltransferasi': { r: [['Uomini', '', '60', ''], ['Donne', '', '40', '']], u: 'Alcol\nColestasi intra ed extraepatica\nSteatosi epatica\nFarmaci induttori enzimatici (antiepilettici)\nObesità', n: 'Se la fosfatasi alcalina è alta, una GGT alta dice che l’origine è epatobiliare e non ossea.' },
  'Fosfatasi alcalina': { r: [['Adulti', '40', '130', 'più alta nell’adolescenza e in gravidanza']], u: 'Colestasi: calcolosi del coledoco, tumori della testa del pancreas, colangite biliare primitiva, colangite sclerosante\nInfiltrazione epatica (metastasi, granulomi)\nMalattie dell’osso: malattia di Paget, metastasi ossee, osteomalacia, fratture in guarigione\nCrescita, gravidanza (placenta)', d: 'Ipofosfatasia\nMalnutrizione, carenza di zinco' },
  'Bilirubina totale': { r: [['Adulti', '0,3', '1,2', '']], si: ['µmol/L', '17,1'], u: 'Indiretta (non coniugata): emolisi, sindrome di Gilbert, eritropoiesi inefficace\nDiretta (coniugata): epatiti, cirrosi, colestasi, ostruzione delle vie biliari, sindromi di Dubin-Johnson e Rotor', n: 'L’ittero si vede di solito oltre 2,5-3 mg/dL.' },
  'Bilirubina diretta': { r: [['Adulti', '0', '0,3', '']], si: ['µmol/L', '17,1'], u: 'Ostruzione delle vie biliari (calcoli, tumori)\nEpatiti, cirrosi\nColestasi da farmaci, sepsi, nutrizione parenterale\nColangite biliare primitiva e sclerosante' },
  'Albumina': { r: [['Adulti', '3,5', '5', '']], si: ['g/L', '10'], u: 'Disidratazione (emoconcentrazione)', d: 'Insufficienza epatica\nSindrome nefrosica\nMalnutrizione, malassorbimento, enteropatie protidodisperdenti\nInfiammazione (proteina di fase acuta negativa)\nUstioni, iperidratazione' },
  'Proteine totali': { r: [['Adulti', '6,4', '8,3', '']], si: ['g/L', '10'], u: 'Mieloma e gammopatie monoclonali\nInfiammazione cronica (gamma policlonali)\nDisidratazione', d: 'Sindrome nefrosica\nInsufficienza epatica\nMalnutrizione\nIperidratazione' },
  'Lattato deidrogenasi': { r: [['Adulti', '135', '225', 'cambia molto con il metodo']], u: 'Emolisi (anche del campione)\nLinfomi e altri tumori\nInfarto (miocardico, polmonare, renale, intestinale)\nDanno muscolare ed epatico\nPolmonite da Pneumocystis\nAnemia megaloblastica', n: 'Poco specifica: utile soprattutto come indice di emolisi e di massa tumorale (linfomi).' },
  'Ammoniemia': { r: [['Adulti', '', '50', 'µmol/L; alcuni laboratori usano µg/dL']], u: 'Insufficienza epatica, encefalopatia epatica\nShunt porto-sistemico\nAcido valproico\nDifetti del ciclo dell’urea\nEmorragia digestiva\nErrori di prelievo: laccio a lungo, campione non in ghiaccio o analizzato tardi', p: 'Prelievo senza laccio prolungato, provetta in ghiaccio e analisi entro 30 minuti.', n: 'Il valore non è proporzionale alla gravità dell’encefalopatia epatica, che si diagnostica in clinica.' },
  'Amilasi': { r: [['Adulti', '30', '110', '']], u: 'Pancreatite acuta\nOstruzione o perforazione intestinale, ischemia mesenterica\nParotite e malattie delle ghiandole salivari\nInsufficienza renale\nGravidanza ectopica rotta\nMacroamilasemia', k: 'Sale in 6-12 ore e torna normale in 3-5 giorni, prima della lipasi.' },
  'Lipasi': { r: [['Adulti', '', '60', 'il limite cambia molto con il metodo']], u: 'Pancreatite acuta (oltre 3 volte il limite superiore è un criterio diagnostico)\nInsufficienza renale\nPatologie intestinali acute (occlusione, perforazione, ischemia)\nChetoacidosi diabetica', k: 'Sale in 4-8 ore, picco a 24 ore, resta alta 8-14 giorni.', n: 'È più specifica dell’amilasi per il pancreas. Il valore non indica la gravità della pancreatite.' },
  'Troponina ad alta sensibilità': { r: [['hs-cTnT', '', '14', '99° percentile'], ['hs-cTnI, uomini', '', '34', '99° percentile, metodo Abbott'], ['hs-cTnI, donne', '', '16', '99° percentile, metodo Abbott']],
    u: 'Infarto miocardico\nMiocardite, pericardite con coinvolgimento miocardico\nEmbolia polmonare\nScompenso cardiaco, tachiaritmie, crisi ipertensive\nSepsi, shock\nInsufficienza renale cronica (valori stabili moderatamente alti)\nCardiomiopatia takotsubo, contusione cardiaca, cardioversione, chemioterapia cardiotossica',
    k: 'Si alza in 1-3 ore dall’inizio dell’ischemia, picco a 12-48 ore, resta alta fino a 10-14 giorni.',
    w: 'Dolore toracico con sospetto di sindrome coronarica acuta, con prelievi ripetuti (per esempio a 0 e 1-2 ore).',
    n: 'I limiti cambiano con il kit: usa sempre quello del tuo laboratorio. Per l’infarto conta la **variazione** tra due prelievi, non un singolo valore.' },
  'Creatinchinasi': { r: [['Uomini', '40', '200', ''], ['Donne', '25', '170', '']], u: 'Rabdomiolisi (anche oltre 5 volte il limite, spesso migliaia)\nTraumi muscolari, iniezioni intramuscolari, esercizio intenso, crisi convulsive\nMiositi, distrofie muscolari\nIpotiroidismo\nStatine\nInfarto miocardico\nIpertermia maligna, sindrome maligna da neurolettici', d: 'Ridotta massa muscolare' },
  'Creatinchinasi MB': { r: [['Adulti', '', '5', 'ng/mL (dosaggio in massa)']], u: 'Infarto miocardico\nMiocardite, chirurgia cardiaca\nDanno muscolare scheletrico esteso', k: 'Sale in 3-6 ore, picco a 12-24 ore, torna normale in 48-72 ore: utile per riconoscere un reinfarto.', n: 'Oggi è quasi sostituita dalla troponina ad alta sensibilità.' },
  'Peptide natriuretico di tipo B': { r: [['Esclusione di scompenso acuto', '', '100', '']], u: 'Scompenso cardiaco\nSindrome coronarica acuta, embolia polmonare, ipertensione polmonare\nFibrillazione atriale\nInsufficienza renale\nEtà avanzata, sepsi', d: 'Obesità (valori più bassi a parità di scompenso)\nTerapia con sacubitril/valsartan aumenta il BNP ma non l’NT-proBNP', n: 'Serve soprattutto a escludere lo scompenso: sotto la soglia è molto improbabile.' },
  'NT-proBNP': { r: [['Esclusione di scompenso acuto', '', '300', ''], ['Esclusione di scompenso cronico', '', '125', '']], u: 'Le stesse del BNP; risente di più della funzione renale', n: 'Nella dispnea acuta le soglie per *confermare* lo scompenso salgono con l’età (circa 450 sotto i 50 anni, 900 tra 50 e 75, 1800 oltre i 75 pg/mL).' },
  'Mioglobina': { r: [['Uomini', '28', '72', ''], ['Donne', '25', '58', '']], u: 'Rabdomiolisi (può causare insufficienza renale acuta)\nDanno muscolare e traumi\nInfarto miocardico (molto precoce e poco specifica)\nInsufficienza renale', k: 'Sale in 1-3 ore e scende in 24 ore.' },
  'Glicemia': { r: [['A digiuno', '70', '99', '']], c: ['40', '450'], si: ['mmol/L', '0,0555'], p: 'A digiuno da almeno 8 ore.',
    u: 'Diabete mellito (a digiuno ≥126 in due occasioni, o ≥200 casuale con sintomi)\nAlterata glicemia a digiuno (100-125)\nStress acuto, infezioni, infarto, ictus\nCorticosteroidi, tiazidici\nSindrome di Cushing, feocromocitoma, acromegalia\nPancreatite, tumori del pancreas',
    d: 'Eccesso di insulina o sulfaniluree\nAlcol\nInsufficienza epatica o renale, sepsi\nInsufficienza surrenalica\nInsulinoma\nDigiuno prolungato, malnutrizione\nCampione lasciato a lungo senza fluoruro (le cellule consumano glucosio)' },
  'Emoglobina glicata': { r: [['Adulti', '', '39', 'mmol/mol (5,7%)']], u: 'Diabete mellito (≥48 mmol/mol, cioè 6,5%)\nPrediabete (39-47 mmol/mol)\nCarenza di ferro, splenectomia (falsi aumenti)', d: 'Emolisi, perdite ematiche, trasfusioni recenti, gravidanza (falsi cali)\nEmoglobinopatie (dipende dal metodo)', n: 'Riflette la glicemia media degli ultimi 2-3 mesi. Nei diabetici l’obiettivo è di solito sotto 53 mmol/mol (7%), da personalizzare.' },
  'Colesterolo totale': { r: [['Desiderabile', '', '200', '']], si: ['mmol/L', '0,02586'], u: 'Ipercolesterolemie familiari e poligeniche\nIpotiroidismo\nSindrome nefrosica\nColestasi\nGravidanza\nFarmaci (corticosteroidi, ciclosporina)', d: 'Ipertiroidismo\nMalnutrizione, malassorbimento\nInsufficienza epatica\nStatine e altri ipolipemizzanti\nInfiammazione acuta' },
  'Colesterolo HDL': { r: [['Uomini', '40', '', 'valore desiderabile'], ['Donne', '50', '', 'valore desiderabile']], si: ['mmol/L', '0,02586'], u: 'Attività fisica, moderato consumo di alcol, estrogeni', d: 'Sindrome metabolica, diabete di tipo 2, obesità\nFumo, sedentarietà\nIpertrigliceridemia\nAndrogeni e progestinici' },
  'Colesterolo LDL': { r: [['Rischio cardiovascolare basso', '', '116', 'obiettivo'], ['Rischio moderato', '', '100', 'obiettivo'], ['Rischio alto', '', '70', 'obiettivo'], ['Rischio molto alto', '', '55', 'obiettivo']], si: ['mmol/L', '0,02586'], u: 'Le stesse del colesterolo totale; ipercolesterolemia familiare (spesso oltre 190)', n: 'Gli obiettivi dipendono dal rischio cardiovascolare (linee guida europee ESC/EAS 2019). Si calcola con la formula di Friedewald (scheda Calcoli) o si misura direttamente.' },
  'Trigliceridi': { r: [['A digiuno', '', '150', '']], si: ['mmol/L', '0,01129'], p: 'Preferibilmente a digiuno da 12 ore.', u: 'Obesità, sindrome metabolica, diabete scompensato\nAlcol\nIpotiroidismo, sindrome nefrosica, insufficienza renale\nFarmaci: estrogeni orali, corticosteroidi, retinoidi, antiretrovirali, tamoxifene\nIpertrigliceridemie familiari\nPasto recente', d: 'Malnutrizione, malassorbimento\nIpertiroidismo', n: 'Oltre 1000 mg/dL c’è rischio di pancreatite acuta.' },
  'Lipoproteina(a)': { r: [['Adulti', '', '50', 'mg/dL (circa 125 nmol/L)']], u: 'Soprattutto genetica, da misurare almeno una volta nella vita\nSindrome nefrosica, insufficienza renale cronica\nMenopausa', n: 'Fattore di rischio cardiovascolare indipendente; varia poco con la dieta e con le statine.' },
  'Insulina': { r: [['A digiuno', '2', '25', '']], p: 'A digiuno.', u: 'Insulino-resistenza: obesità, sindrome metabolica, sindrome dell’ovaio policistico, diabete di tipo 2 iniziale\nInsulinoma\nInsulina esogena', d: 'Diabete di tipo 1\nDiabete di tipo 2 avanzato\nIpopituitarismo', n: 'Nell’ipoglicemia, insulina alta con peptide C basso fa pensare a insulina esogena; entrambi alti a insulinoma o sulfaniluree.' },
  'Peptide C': { r: [['A digiuno', '0,8', '3,1', '']], si: ['nmol/L', '0,331'], u: 'Insulinoma\nSulfaniluree\nInsulino-resistenza\nInsufficienza renale', d: 'Diabete di tipo 1\nInsulina esogena (somministrazione fittizia)\nDiabete di tipo 2 avanzato' },
  'Sideremia': { r: [['Uomini', '65', '175', ''], ['Donne', '50', '170', '']], si: ['µmol/L', '0,179'], p: 'Al mattino, a digiuno: varia molto durante la giornata.', u: 'Emocromatosi\nEmolisi, eritropoiesi inefficace (talassemie)\nTrasfusioni ripetute, terapia marziale\nEpatite acuta', d: 'Carenza di ferro\nInfiammazione cronica (anemia delle malattie croniche)\nPerdite ematiche', n: 'Da sola dice poco: va letta con ferritina e saturazione della transferrina.' },
  'Ferritina': { r: [['Uomini', '30', '400', ''], ['Donne', '15', '150', '']], u: 'Infiammazione e infezioni (proteina di fase acuta)\nEmocromatosi e sovraccarico di ferro (trasfusioni)\nEpatopatie, alcol\nTumori, linfomi\nSindrome metabolica\nMalattia di Still, sindrome emofagocitica (valori altissimi)', d: 'Carenza di ferro (il segno più specifico)', n: 'Sotto 30 ng/mL indica carenza di ferro quasi sempre; con infiammazione la carenza può esserci anche con ferritina fino a 100.' },
  'Transferrina': { r: [['Adulti', '200', '360', '']], si: ['g/L', '0,01'], u: 'Carenza di ferro\nGravidanza, estrogeni', d: 'Infiammazione cronica\nMalnutrizione\nSindrome nefrosica, insufficienza epatica\nSovraccarico di ferro' },
  'Saturazione della transferrina': { r: [['Adulti', '20', '45', '']], u: 'Emocromatosi (oltre 45% a digiuno fa sospettarla)\nEmolisi, trasfusioni, terapia marziale', d: 'Carenza di ferro\nAnemia delle malattie croniche', n: 'Si calcola: sideremia (µg/dL) / transferrina (mg/dL) × 70,9.' },
  'Vitamina B12': { r: [['Adulti', '200', '900', '']], si: ['pmol/L', '0,738'], u: 'Malattie mieloproliferative\nEpatopatie\nTumori\nIntegrazione', d: 'Anemia perniciosa (gastrite autoimmune)\nGastrectomia, chirurgia bariatrica\nMalattie dell’ileo terminale (Crohn, resezione)\nDieta vegana senza integrazione\nMetformina e inibitori di pompa protonica a lungo\nPancreatite cronica, sovracrescita batterica, botriocefalo', n: 'Nei valori al limite (200-300) aiutano omocisteina e acido metilmalonico, che salgono nella carenza vera.' },
  'Folati': { r: [['Adulti', '4', '', '']], si: ['nmol/L', '2,266'], d: 'Dieta povera di verdure, alcolismo\nMalassorbimento (celiachia)\nAumentato fabbisogno: gravidanza, emolisi\nFarmaci: metotrexato, trimetoprim, fenitoina' },
  '25-idrossivitamina D': { r: [['Adulti', '30', '100', 'tra 20 e 30 insufficienza, sotto 20 carenza']], si: ['nmol/L', '2,496'], u: 'Integrazione eccessiva (tossicità oltre 150)', d: 'Poca esposizione al sole, pelle scura, inverno\nMalassorbimento, obesità\nInsufficienza epatica o renale\nFarmaci antiepilettici, corticosteroidi', n: 'Le soglie cambiano tra società scientifiche: alcune considerano sufficiente già 20 ng/mL.' },
  'Tireotropina': { r: [['Adulti', '0,4', '4', '']], u: 'Ipotiroidismo primario (tiroidite di Hashimoto, dopo tiroidectomia o radioiodio, amiodarone, litio)\nIpotiroidismo subclinico\nFase di recupero da malattia acuta\nTumori ipofisari secernenti TSH (rari)', d: 'Ipertiroidismo primario (malattia di Basedow-Graves, gozzo nodulare tossico, tiroiditi)\nEccesso di levotiroxina\nIpotiroidismo centrale (con FT4 basso)\nCorticosteroidi, dopamina, malattia acuta grave\nPrimo trimestre di gravidanza', n: 'È il primo esame della funzione tiroidea; si completa con FT4 se è alterato.' },
  'Tiroxina libera': { r: [['Adulti', '8', '18', 'pg/mL (circa 0,8-1,8 ng/dL)']], si: ['pmol/L', '1,287'], u: 'Ipertiroidismo\nEccesso di levotiroxina\nAmiodarone\nEparina (falso aumento in vitro)', d: 'Ipotiroidismo primario e centrale\nMalattia acuta grave (sindrome del malato eutiroideo)' },
  'Triiodotironina libera': { r: [['Adulti', '2', '4,4', 'pg/mL']], si: ['pmol/L', '1,536'], u: 'Ipertiroidismo (anche T3-tossicosi isolata)', d: 'Malattia acuta grave e digiuno (sindrome del malato eutiroideo: T3 basso)\nIpotiroidismo avanzato\nAmiodarone, corticosteroidi, propranololo' },
  'Anticorpi anti-tireoperossidasi': { r: [['Adulti', '', '35', 'il limite cambia con il kit']], u: 'Tiroidite di Hashimoto\nMalattia di Basedow-Graves\nTiroidite post-partum\nSoggetti sani, soprattutto donne anziane (positività a basso titolo)' },
  'Cortisolo': { r: [['Al mattino (ore 8)', '5', '25', '']], si: ['nmol/L', '27,59'], p: 'Prelievo alle 8 del mattino: il cortisolo ha un ritmo circadiano.', u: 'Sindrome di Cushing (si studia con cortisolo libero urinario, test di soppressione con desametasone, cortisolo salivare notturno)\nStress acuto, malattia grave\nEstrogeni e gravidanza (aumento della proteina di trasporto)\nDepressione, alcolismo', d: 'Insufficienza surrenalica primaria (malattia di Addison) e secondaria\nSospensione brusca di corticosteroidi', n: 'Un cortisolo delle 8 sotto 3-5 µg/dL rende molto probabile un’insufficienza surrenalica; la conferma è il test con ACTH.' },
  'ACTH': { r: [['Al mattino (ore 8)', '7', '63', '']], p: 'Al mattino, provetta con EDTA in ghiaccio, centrifugata subito.', u: 'Malattia di Addison (con cortisolo basso)\nMalattia di Cushing ipofisaria e produzione ectopica (con cortisolo alto)\nStress', d: 'Insufficienza surrenalica secondaria\nSindrome di Cushing surrenalica (tumore del surrene)\nTerapia con corticosteroidi' },
  'Prolattina': { r: [['Uomini', '2', '18', ''], ['Donne non in gravidanza', '3', '29', '']], si: ['mUI/L', '21,2'], p: 'Al mattino, a riposo, lontano da stress e visite al seno.', u: 'Gravidanza e allattamento\nProlattinoma (spesso oltre 200 ng/mL)\nFarmaci: antipsicotici, metoclopramide, domperidone, antidepressivi, estrogeni\nCompressione del peduncolo ipofisario\nIpotiroidismo primario, insufficienza renale, cirrosi\nStress, sonno, macroprolattina', d: 'Ipopituitarismo\nAgonisti dopaminergici' },
  'Paratormone': { r: [['Adulti', '15', '65', '']], si: ['pmol/L', '0,106'], u: 'Iperparatiroidismo primario (con calcio alto)\nIperparatiroidismo secondario: carenza di vitamina D, insufficienza renale cronica, malassorbimento (con calcio normale o basso)\nIperparatiroidismo terziario\nLitio', d: 'Ipoparatiroidismo (dopo chirurgia del collo, autoimmune)\nIpercalcemia non paratiroidea (tumori, vitamina D, sarcoidosi)\nIpomagnesemia grave', n: 'Si legge sempre insieme al calcio.' },
  'Beta-hCG': { r: [['Donne non in gravidanza', '', '5', '']], u: 'Gravidanza (raddoppia ogni 48-72 ore all’inizio)\nGravidanza ectopica (sale meno del previsto)\nMola idatiforme e coriocarcinoma (valori molto alti)\nTumori a cellule germinali del testicolo e dell’ovaio', n: 'In ogni donna in età fertile si esclude una gravidanza prima di farmaci teratogeni, radiografie o interventi.' },
  'Proteina C reattiva': { r: [['Adulti', '', '5', 'mg/L; molti laboratori italiani la danno in mg/dL: < 0,5']],
    u: 'Infezioni batteriche (spesso oltre 100 mg/L)\nInfiammazione: artrite reumatoide, vasculiti, malattie infiammatorie intestinali\nTraumi, chirurgia, ustioni\nTumori\nInfarto, pancreatite\nInfezioni virali (di solito aumenti modesti)', k: 'Sale in 6-8 ore, picco a 48 ore, si dimezza in circa 19 ore quando lo stimolo cessa: è utile per seguire la risposta alla terapia.', n: 'Il lupus spesso ha PCR normale anche in fase attiva, salvo infezioni o sierositi.' },
  'Procalcitonina': { r: [['Adulti', '', '0,05', 'sani']], u: 'Infezioni batteriche sistemiche e sepsi (oltre 0,5, molto probabile oltre 2 ng/mL)\nTraumi gravi, ustioni, chirurgia maggiore\nShock cardiogeno\nCarcinoma midollare della tiroide', k: 'Sale in 3-6 ore, picco a 12-24 ore.', n: 'Aiuta a distinguere un’infezione batterica da una virale e a decidere quando sospendere gli antibiotici; non sostituisce il giudizio clinico.' },
  'Elettroforesi delle proteine sieriche': { r: [['Albumina', '55', '68', ''], ['Alfa-1', '1,5', '4', ''], ['Alfa-2', '7', '13', ''], ['Beta', '8', '14', ''], ['Gamma', '11', '19', '']],
    n: '- **Picco monoclonale** (stretto, di solito in gamma): gammopatia monoclonale, mieloma, macroglobulinemia di Waldenström; si completa con immunofissazione e catene leggere libere\n- **Gamma alte e larghe** (policlonali): infiammazione cronica, epatopatie croniche, malattie autoimmuni, HIV\n- **Alfa-2 alte**: infiammazione acuta, sindrome nefrosica\n- **Albumina bassa con alfa-2 alte**: sindrome nefrosica\n- **Gamma basse**: immunodeficienze, chemioterapia, catene leggere del mieloma' },
  'Immunoglobuline G, A, M': { r: [['IgG', '700', '1600', ''], ['IgA', '70', '400', ''], ['IgM', '40', '230', '']], si: ['g/L', '0,01'], u: 'Infiammazione cronica, epatopatie, malattie autoimmuni (aumento policlonale)\nMieloma (IgG o IgA monoclonali), Waldenström (IgM)\nIgA alte: cirrosi alcolica, celiachia\nIgM alte: infezioni acute recenti, colangite biliare primitiva', d: 'Immunodeficienze primarie (deficit selettivo di IgA, immunodeficienza comune variabile)\nImmunodeficienze secondarie: leucemia linfatica cronica, mieloma (le altre classi), sindrome nefrosica, immunosoppressori, rituximab', n: 'Il deficit selettivo di IgA dà falsi negativi agli anticorpi di classe IgA della celiachia.' },
  'Complemento C3 e C4': { r: [['C3', '90', '180', ''], ['C4', '10', '40', '']], u: 'Infiammazione (proteine di fase acuta)', d: 'Lupus eritematoso sistemico in fase attiva (consumo)\nGlomerulonefriti: post-infettiva e membranoproliferativa (C3 basso)\nCrioglobulinemia (C4 molto basso)\nDeficit ereditari (C4 basso nell’angioedema ereditario)\nSepsi, insufficienza epatica' },
  'Anticorpi antinucleo': { n: 'Si considerano negativi sotto 1:80 (immunofluorescenza su cellule HEp-2), ma il limite dipende dal laboratorio.\n\n- **Positivi**: lupus (quasi sempre), sclerosi sistemica, sindrome di Sjögren, connettiviti miste, polimiositi, epatite autoimmune, farmaci, infezioni, tumori\n- **A basso titolo** anche in molti sani, soprattutto donne e anziani\n- Il **pattern** orienta: omogeneo (lupus, da farmaci), centromerico (sclerosi sistemica limitata), nucleolare (sclerosi sistemica), speckled (Sjögren, connettivite mista)\n- Se positivi si completano con anti-dsDNA ed ENA.' },
  'Anticorpi anti-citoplasma dei neutrofili': { n: '- **c-ANCA / anti-PR3**: granulomatosi con poliangioite\n- **p-ANCA / anti-MPO**: poliangioite microscopica, granulomatosi eosinofila con poliangioite, glomerulonefrite pauci-immune\n- p-ANCA atipici anche in colite ulcerosa, colangite sclerosante, epatite autoimmune\n- Normalmente **negativi**.' },
  'Fattore reumatoide': { r: [['Adulti', '', '14', 'il limite cambia con il kit']], u: 'Artrite reumatoide (circa 70-80% dei casi, poco specifico)\nSindrome di Sjögren, crioglobulinemia (HCV)\nAltre connettiviti\nInfezioni croniche (endocardite, epatite C, tubercolosi)\nEtà avanzata, sani' },
  'Anticorpi anti-peptidi citrullinati': { r: [['Adulti', '', '20', 'il limite cambia con il kit']], u: 'Artrite reumatoide (molto specifici, presenti anche anni prima dei sintomi)', n: 'Più specifici del fattore reumatoide; positivi indicano anche una malattia più aggressiva.' },
  'Antigene prostatico specifico': { r: [['Uomini', '', '4', 'il limite sale con l’età']], u: 'Carcinoma della prostata\nIpertrofia prostatica benigna\nProstatite, infezioni urinarie\nRitenzione urinaria, cateterismo, biopsia, esplorazione rettale ed eiaculazione recenti', d: 'Inibitori della 5-alfa-reduttasi (finasteride, dutasteride: dimezzano il PSA)', n: 'Non è specifico del tumore: si valuta con velocità di aumento, PSA libero/totale, risonanza e biopsia. Lo screening va discusso con il paziente.' },
  'Antigene carcinoembrionario': { r: [['Non fumatori', '', '3', ''], ['Fumatori', '', '5', '']], u: 'Carcinoma del colon-retto (follow-up) e altri adenocarcinomi (pancreas, stomaco, polmone, mammella)\nFumo\nCirrosi, pancreatite, malattie infiammatorie intestinali, BPCO', n: 'Non serve per lo screening: si usa per il follow-up dopo terapia.' },
  'CA 19-9': { r: [['Adulti', '', '37', '']], u: 'Carcinoma del pancreas e delle vie biliari\nAltri tumori gastrointestinali\nColestasi e colangite (anche benigne), pancreatite', n: 'Non si alza nelle persone Lewis-negative (circa 5-10%). Si usa per il follow-up, non per lo screening.' },
  'CA 125': { r: [['Adulti', '', '35', '']], u: 'Carcinoma ovarico\nEndometriosi, mestruazioni, gravidanza, malattia infiammatoria pelvica\nCirrosi con ascite, versamenti pleurici e pericardici\nScompenso cardiaco, altri tumori', n: 'Poco specifico in premenopausa.' },
  'CA 15-3': { r: [['Adulti', '', '30', '']], u: 'Carcinoma della mammella (soprattutto metastatico)\nEpatopatie, altre neoplasie', n: 'Usato per il follow-up della malattia avanzata.' },
  'Alfa-fetoproteina': { r: [['Adulti, non in gravidanza', '', '10', '']], u: 'Epatocarcinoma\nTumori a cellule germinali non seminomatosi\nEpatiti e cirrosi (aumenti modesti)\nGravidanza', n: 'Nella sorveglianza dei cirrotici si affianca all’ecografia.' },
  'Emocoltura': { p: 'Almeno 2 set (aerobi e anaerobi) da sedi diverse, prima degli antibiotici, con antisepsi accurata della cute.', n: 'Normalmente **negativa**.\n\n- Un germe cutaneo (stafilococchi coagulasi-negativi, corinebatteri) in un solo set di solito è una **contaminazione**.\n- Lo stesso germe in più set, o germi tipicamente patogeni (S. aureus, E. coli, Candida), indicano una batteriemia vera.\n- S. aureus nel sangue richiede di cercare un’endocardite.' },
  'Urinocoltura': { p: 'Urine del mattino, mitto intermedio dopo lavaggio dei genitali; consegna entro 1-2 ore o conservazione in frigo.', n: 'Carica significativa di solito **≥ 100.000 UFC/mL**; con sintomi, nei maschi o con catetere possono contare cariche più basse.\n\n- Più germi diversi: spesso contaminazione.\n- La batteriuria senza sintomi si tratta solo in gravidanza e prima di interventi urologici.' },
  'Antigene di superficie dell’epatite B': { n: 'Normalmente **negativo**.\n\n- **Positivo**: infezione da HBV in corso, acuta o cronica (cronica se positivo oltre 6 mesi).\n- Si completa con anti-HBc (IgM per l’acuta), HBeAg, anti-HBe, HBV-DNA.\n- **Anti-HBs** positivo da solo = vaccinazione; con anti-HBc = infezione guarita.' },
  'Anticorpi anti-HCV': { n: 'Normalmente **negativi**.\n\n- **Positivi**: contatto con HCV, infezione in corso o guarita.\n- Per sapere se è in corso si dosa l’**HCV-RNA**.\n- Gli anticorpi restano positivi anche dopo la guarigione e dopo la terapia.' },
  'Test combinato HIV antigene/anticorpi': { n: 'Normalmente **negativo**.\n\n- Il test di quarta generazione rileva antigene p24 e anticorpi: si positivizza circa 2-6 settimane dopo il contagio (periodo finestra).\n- Un risultato positivo va sempre confermato con un test di conferma e con HIV-RNA.' },
  'Esame del liquor': { r: [['Proteine', '15', '45', 'mg/dL'], ['Glucosio', '50', '80', 'mg/dL, circa 2/3 della glicemia'], ['Leucociti', '', '5', 'cellule/µL']],
    n: '- **Meningite batterica**: molti neutrofili, proteine alte, glucosio basso (rapporto liquor/sangue sotto 0,4)\n- **Meningite virale**: linfociti, proteine poco aumentate, glucosio normale\n- **Tubercolare o fungina**: linfociti, proteine molto alte, glucosio basso\n- **Guillain-Barré**: proteine alte con cellule normali (dissociazione albumino-citologica)\n- **Sclerosi multipla**: bande oligoclonali\n- Si fa la TC prima della puntura se ci sono segni di ipertensione endocranica o deficit focali.' },
  'Esame del liquido pleurico': { n: '**Criteri di Light**: è un **essudato** se c’è almeno uno di questi:\n- proteine pleuriche / sieriche > 0,5\n- LDH pleurico / sierico > 0,6\n- LDH pleurico > 2/3 del limite superiore dell’LDH sierico\n\n- **Trasudato**: scompenso cardiaco, cirrosi, sindrome nefrosica\n- **Essudato**: polmonite (parapneumonico), tubercolosi, tumori, embolia polmonare, connettiviti\n- pH sotto 7,2 o glucosio basso in un versamento parapneumonico indicano la necessità di drenaggio.' },
  'Esame del liquido ascitico': { n: '- **SAAG** (albumina sierica − albumina ascitica) ≥ 1,1 g/dL: ascite da **ipertensione portale** (cirrosi, scompenso cardiaco, Budd-Chiari); sotto 1,1: carcinosi peritoneale, tubercolosi, pancreatite, sindrome nefrosica\n- **Neutrofili ≥ 250/µL**: peritonite batterica spontanea, da trattare subito\n- Proteine alte con SAAG alto: ascite cardiaca\n- Si fanno sempre coltura (nei flaconi da emocoltura), conta cellulare, albumina e proteine.' },
  'Esame del liquido sinoviale': { r: [['Leucociti, normale', '', '200', 'cellule/µL']], n: 'Indicativamente:\n- **Non infiammatorio** (artrosi): 200-2.000 leucociti/µL\n- **Infiammatorio** (artrite reumatoide, gotta, condrocalcinosi): 2.000-50.000\n- **Settico**: spesso oltre 50.000, con molti neutrofili\n\nI **cristalli** al microscopio a luce polarizzata: aghiformi a birifrangenza negativa nella gotta, romboidali a birifrangenza debolmente positiva nella condrocalcinosi. Sempre coltura e Gram.' },
  'Digossinemia': { r: [['Intervallo terapeutico', '0,5', '2', 'nello scompenso si punta a 0,5-0,9']], c: ['', '2'], si: ['nmol/L', '1,281'], p: 'Almeno 6-8 ore dopo l’ultima dose.', u: 'Insufficienza renale\nInterazioni: amiodarone, verapamil, chinidina, claritromicina\nAnziani, basso peso', n: 'La tossicità (nausea, disturbi visivi, aritmie) aumenta con ipokaliemia, ipomagnesemia e ipercalcemia, anche con livelli nel range.' },
  'Litiemia': { r: [['Intervallo terapeutico', '0,6', '1,2', 'mantenimento di solito 0,6-1']], c: ['', '2'], p: 'Circa 12 ore dopo l’ultima dose.', u: 'Disidratazione, diete povere di sale\nInsufficienza renale\nInterazioni: tiazidici, ACE-inibitori, sartani, FANS', n: 'Tossicità già oltre 1,5 mEq/L: tremore grossolano, atassia, confusione, aritmie. Si controllano anche funzione renale e tiroidea.' },
  'Vancomicina (valle)': { r: [['Valle', '10', '20', 'mg/L; oggi si preferisce il monitoraggio dell’AUC (400-600)']], p: 'Prima della dose successiva, di solito dalla quarta dose.', n: 'Livelli alti aumentano il rischio di danno renale, soprattutto con altri nefrotossici.' },
  'Etanolemia': { r: [['Limite per la guida in Italia', '', '0,5', 'g/L; zero per neopatentati e conducenti professionali']], u: 'Assunzione di alcol', n: 'Indicativamente: oltre 1,5-2 g/L ebbrezza marcata, oltre 3-4 g/L rischio di coma e morte nei non abituati. Con un gap osmolare aumentato e acidosi pensa anche a metanolo e glicole etilenico.' },
  'Carbossiemoglobina': { r: [['Non fumatori', '', '3', ''], ['Fumatori', '', '10', '']], u: 'Intossicazione da monossido di carbonio (stufe, bracieri, incendi)\nFumo', n: 'Il saturimetro comune non distingue la carbossiemoglobina: la saturazione sembra normale. Serve l’emogas con co-ossimetria. Terapia: ossigeno ad alto flusso, camera iperbarica nei casi gravi.' }
};
// Applica i dati di partenza a una scheda: riempie solo i campi vuoti
function labApplyBase(x, { onlyEmpty = true } = {}) {
  const d = LAB_DATA[x.name];
  if (!d) return false;
  let changed = false;
  const set = (k, v) => { if (v === undefined || v === null || v === '') return; if (onlyEmpty && String(x[k] ?? '').trim()) return; x[k] = v; changed = true; };
  if (d.r && !labHasRange(x)) { x.ranges = d.r.map(([who, low, high, note]) => ({ who, low, high, note })); changed = true; }
  if (d.c && !(String(x.crit?.low ?? '').trim() || String(x.crit?.high ?? '').trim())) { x.crit = { low: d.c[0] || '', high: d.c[1] || '' }; changed = true; }
  set('up', d.u); set('down', d.d); set('prep', d.p); set('kinetics', d.k); set('when', d.w); set('notes', d.n);
  if (d.si) { set('siUnit', d.si[0]); set('siFactor', d.si[1]); }
  if (d.r) set('rangeSrc', 'valori indicativi di Claude, da confrontare con il tuo laboratorio');
  if (changed) {
    const src = sourcesOf(x);
    if (!src.some(t => t.startsWith('Claude'))) { x.sources = [...src, LAB_SOURCE_CLAUDE]; delete x.source; }
  }
  return changed;
}

function updateIncBadge() {
  const b = document.getElementById('incBadge');
  if (!b) return;
  const n = state.sections.filter(x => x.incomplete).length + state.links.filter(l => (l.kind === 'clinical' || l.kind === 'lab') && l.incomplete).length;
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : String(n);
}
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
      <div class="tag-cloud" aria-label="Filtra per categoria">${[...LAB_CATS.filter(([k]) => counts.has(k)), ...[...counts.keys()].filter(k => !LAB_CATS.some(c => c[0] === k)).map(k => [k, labCatName(k)])].map(([k, l]) => `<button type="button" class="tag ${labCatFilter.has(k) ? 'on' : ''}" data-lc="${k}" aria-pressed="${labCatFilter.has(k)}">${l} <span class="muted-inline">${counts.get(k)}</span></button>`).join('')}</div>
      <div id="labList"></div>
      <p class="hint">Mancano esami? <button class="btn sm ghost" type="button" data-act="lab-base">Aggiungi dall’elenco di base</button>
        ${all.some(x => { const d = LAB_DATA[x.name]; return d && ((d.r && !labHasRange(x)) || (d.u && !String(x.up || '').trim()) || (d.n && !String(x.notes || '').trim())); }) ? `<br>Alcune schede dell’elenco di base sono ancora vuote. <button class="btn sm ghost" type="button" data-act="lab-fill">Completale con i dati di Claude</button>` : ''}</p>` : `
      <div class="empty">
        <p>Ancora nessun esame. Puoi partire dall’<strong>elenco di base</strong>: oltre 110 esami divisi per categoria, già compilati da me (Claude) con range indicativi, cause e note, tutti modificabili; oppure crearli uno per uno.</p>
        <div class="inline" style="justify-content:center"><button class="btn primary" type="button" data-act="lab-base">Aggiungi l’elenco di base</button><a class="btn" href="#/lab/new">Nuovo esame</a></div>
      </div>`}
  `);
  on('[data-act="lab-base"]', 'click', labBaseFlow);
  on('[data-act="lab-fill"]', 'click', async () => {
    const list = labExams().filter(x => LAB_DATA[x.name]);
    if (!(await modal({ title: 'Completare le schede?', text: 'Riempio solo i campi vuoti delle schede dell’elenco di base, con i miei valori indicativi e me (Claude) come fonte. Quello che hai già scritto non cambia.', confirm: 'Completa' }))) return;
    let n = 0;
    for (const x of list) if (labApplyBase(x)) { await saveLink(x); n++; }
    toast(n ? `${n} schede completate` : 'Niente da completare');
    route();
  });
  const draw = () => {
    const box = $('#labList');
    if (!box) return;
    const toks = foldAccents(labQuery).split(/\s+/).filter(Boolean);
    const list = all.filter(x => (!labCatFilter.size || labCatFilter.has(x.cat || 'altr')) && (!toks.length || toks.every(t => foldAccents(`${x.name} ${x.abbr || ''} ${x.up || ''} ${x.down || ''} ${(x.uses || []).map(u => u.dx).join(' ')} ${x.notes || ''}`).includes(t))));
    const byCat = new Map();
    list.forEach(x => { const k = x.cat || 'altr'; if (!byCat.has(k)) byCat.set(k, []); byCat.get(k).push(x); });
    const cats = [...LAB_CATS.filter(([k]) => byCat.has(k)), ...[...byCat.keys()].filter(k => !LAB_CATS.some(c => c[0] === k)).sort().map(k => [k, labCatName(k)])];
    box.innerHTML = list.length ? cats.map(([k, l]) => `
      <h2 class="sub">${l}</h2>
      <ul class="list">${byCat.get(k).map(x => {
        const r = labPickRange(x);
        const bits = [r ? labRangeText(r, x.unit) : (String(x.notes || '').trim() ? 'esame qualitativo, vedi la scheda' : 'senza range'), x.sample || ''].filter(Boolean);
        return `<li><a class="row" href="#/lab/${x.id}">
          <span class="row-main">
            <span class="row-title">${esc(x.name)}${x.abbr ? ` <span class="lab-abbr">${esc(x.abbr)}</span>` : ''}</span>
            <span class="row-sub">${esc(bits.join(' · '))}${x.incomplete ? ' · ⚠ incompleto' : ''}</span>
          </span>
          ${labHasRange(x) || String(x.notes || '').trim() ? '' : '<span class="pill soft">da completare</span>'}
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
    <p class="sheet-sub">Schede già compilate da me, Claude: campione, unità, range indicativi dell’adulto, valori critici, cause di aumento e diminuzione, note. La fonte di ogni scheda sono io: confronta i valori con il tuo libro e con il referto del tuo laboratorio, e cambia tutto quello che vuoi. Gli esami che hai già non vengono doppiati.</p>
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
      const rec = { id: uid(), kind: 'lab', notebookId: '_lab', created: now + i, name, abbr, cat, sample, unit, ranges: [], uses: [] };
      labApplyBase(rec);
      await saveLink(rec);
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
        <label class="field"><span>Categoria</span><select class="input" id="lxCat">${[...LAB_CATS, ...[...new Set(labExams().map(e => e.cat).filter(c => c && !LAB_CATS.some(k => k[0] === c)))].map(c => [c, labCatName(c)])].map(([k, l]) => `<option value="${esc(k)}" ${x.cat === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}<option value="__new">＋ Nuova categoria…</option></select></label>
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
  let lastCat = $('#lxCat').value;
  $('#lxCat').addEventListener('change', async e => {
    if (e.target.value !== '__new') { lastCat = e.target.value; return; }
    const name = await modal({ title: 'Nuova categoria', text: 'Per esempio “Gravidanza” o “Genetica”.', input: true, placeholder: 'Nome della categoria', confirm: 'Crea' });
    if (!name || !String(name).trim()) { e.target.value = lastCat; return; }
    const k = `c:${String(name).trim()}`;
    if (!$(`#lxCat option[value="${CSS.escape(k)}"]`)) e.target.insertAdjacentHTML('beforeend', `<option value="${esc(k)}">${esc(String(name).trim())}</option>`);
    const nw = $('#lxCat option[value="__new"]');
    e.target.append(nw);
    e.target.value = k;
    lastCat = k;
  });
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
   v3.28: casi clinici, fonti in fondo, segnalazione “incompleta”
   ===================================================================== */

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

