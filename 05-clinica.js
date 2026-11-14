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
    // nota nuova da un PDF: fonte e articolo già pronti, e i loro gruppi aperti
    if (!entry && (prefill.sources || []).length) e.srcPre = '1';
    if (!entry && (prefill.papers || []).length) e.papers = prefill.papers.slice();
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
      <details class="cn-group" ${(e.papers || []).length ? 'open' : ''}><summary>Articoli</summary>
        <div class="tags" id="cnPapers"></div>
        <input type="search" class="input" id="cnPpQ" placeholder="＋ Collega un articolo della bibliografia: scrivi titolo, autore o tag" autocomplete="off">
        <ul class="list pick-list sp-link-res" id="cnPpRes"></ul>
        <p class="hint">Gli articoli si aggiungono in Articoli (dal DOI o dal PDF); qui li colleghi alla nota.</p>
      </details>
      <details class="cn-group" ${(e.images || []).length ? 'open' : ''}><summary>Immagini</summary>
        <p class="hint">Algoritmi, tabelle o schemi trovati in giro, anche screenshot dai social: caricali qui. La fonte di ogni immagine la puoi aggiungere anche dopo.</p>
        <div class="cn-imgs" id="cnImgs"></div>
        <button class="btn sm ghost" type="button" data-cnimg-add>＋ Aggiungi foto</button>
      </details>
      ${group('Note', ['body'], ta('cnBody', 'Note libere', e.body || prefill.body, 4))}
      ${group('Link e fonti', ['links', 'srcPre'], `
        ${ta('cnLinks', 'Link utili, uno per riga (anche “Nome | indirizzo”)', (e.links || []).join('\n'), 2, 'Orphanet | https://www.orpha.net/…')}
        <label class="field"><span>Fonti, una per riga</span><textarea class="input" id="cnSrc" rows="2" placeholder="Harrison, cap. 270">${esc((sourcesOf(e).length ? sourcesOf(e) : prefill.sources || []).join('\n'))}</textarea></label>`)}
      <label class="check"><input type="checkbox" id="cnIncChk" ${e.incomplete ? 'checked' : ''}><span>Incompleta</span></label>
      <label class="field" id="cnIncBox" ${e.incomplete ? '' : 'hidden'}><span>Cosa manca? Facoltativo</span><input class="input" id="cnIncNote" value="${esc(e.incomplete?.note || '')}" placeholder="Es. manca la terapia"></label>
      <div class="modal-actions">
        ${entry ? '<button class="btn ghost danger" type="button" data-cn-act="del">Elimina</button>' : ''}
        <button class="btn ghost" type="button" data-cn-act="no">Annulla</button>
        <button class="btn primary" type="button" data-cn-act="ok">Salva</button>
      </div>`, { label: 'Nota clinica', onClose: resolve });
    bindTagField(sh.el, 'cnSyms');
    // v3.70: articoli collegati
    let pps = [...(e.papers || prefill.papers || [])].filter(id => paperById(id));
    const drawPps = () => { $('#cnPapers', sh.el).innerHTML = pps.map(paperById).filter(Boolean).map(p => `<span class="tag">${esc(p.title.slice(0, 70))}${p.title.length > 70 ? '…' : ''} <button type="button" class="tag-x" data-unpp="${p.id}" aria-label="Scollega">×</button></span>`).join('') || '<span class="hint">Nessun articolo collegato.</span>'; };
    drawPps();
    $('#cnPpQ', sh.el).addEventListener('input', ev => {
      const f = foldAccents(ev.target.value.trim());
      const hits = f ? papers().filter(p => !pps.includes(p.id) && foldAccents(`${p.title} ${p.authors} ${tagsOf(p).join(' ')} ${p.year}`).includes(f)).slice(0, 8) : [];
      $('#cnPpRes', sh.el).innerHTML = hits.map(p => `<li><button type="button" class="row" data-addpp="${p.id}"><span class="row-main"><span class="row-title">${esc(p.title)}</span><span class="row-sub">${esc([authorsShort(p), p.journal, p.year].filter(Boolean).join(' · '))}</span></span></button></li>`).join('') || (f ? '<li class="hint">Nessun articolo trovato.</li>' : '');
    });
    sh.el.addEventListener('click', ev => {
      const a = ev.target.closest('[data-addpp]');
      if (a) { pps.push(a.dataset.addpp); drawPps(); $('#cnPpQ', sh.el).value = ''; $('#cnPpRes', sh.el).innerHTML = ''; return; }
      const u = ev.target.closest('[data-unpp]');
      if (u) { pps = pps.filter(x => x !== u.dataset.unpp); drawPps(); }
    });
    // v3.69: immagini della nota, ognuna con didascalia e fonte
    let imgs = (e.images || []).map(x => ({ ...x }));
    const readImgs = () => $$('.cn-img', sh.el).forEach(box => { const x = imgs[+box.dataset.ii]; if (!x) return; x.cap = $('[data-icap]', box).value.trim(); x.src = $('[data-isrc]', box).value.trim(); });
    const drawImgs = () => {
      $('#cnImgs', sh.el).innerHTML = imgs.map((x, i) => `<div class="cn-img" data-ii="${i}">
        <img class="nb-img" data-img="${esc(x.id)}" alt="">
        <div class="cn-img-f">
          <input class="input" data-icap value="${esc(x.cap || '')}" placeholder="Didascalia, es. Algoritmo della sincope" aria-label="Didascalia">
          <input class="input" data-isrc value="${esc(x.src || '')}" placeholder="Fonte: link, account o libro (anche dopo)" aria-label="Fonte">
        </div>
        <button class="btn sm ghost" type="button" data-idel="${i}" aria-label="Togli l’immagine">✕</button></div>`).join('');
    };
    drawImgs();
    sh.el.addEventListener('click', async ev => {
      if (ev.target.closest('[data-cnimg-add]')) {
        const files = await chooseImageFiles();
        if (!files.length) return;
        readImgs();
        for (const f of files) {
          try { imgs.push({ id: (await saveImage(await compressImage(f, { max: 2200, quality: 0.86 }), '_clinical')).id, cap: '', src: '' }); }
          catch (err) { toast(`${f.name}: ${err.message}`, 'err'); }
        }
        drawImgs();
        return;
      }
      const d = ev.target.closest('[data-idel]');
      if (d) { readImgs(); imgs.splice(+d.dataset.idel, 1); drawImgs(); }
    });
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
        images: (readImgs(), imgs.map(x => ({ id: x.id, cap: x.cap || '', src: x.src || '' }))),
        papers: pps,
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
      ${(n.papers || []).map(paperById).filter(Boolean).length ? `<div class="cn-row"><h3>Articoli</h3><ul class="cn-papers">${(n.papers || []).map(paperById).filter(Boolean).map(p => `<li><a href="#/papers/${p.id}" data-g="pp">${p.star ? '★ ' : ''}${esc(p.title)}</a><small> · ${esc([authorsShort(p, 1), p.journal, p.year].filter(Boolean).join(' · '))}${p.status === 'read' ? '' : ` · ${esc(PAPER_STATUS.find(s => s[0] === (p.status || 'todo'))[1].toLowerCase())}`}</small></li>`).join('')}</ul></div>` : ''}
      ${(n.images || []).length ? `<div class="cn-row"><h3>Immagini</h3><div class="cn-gal">${n.images.map(x => `<figure class="cn-fig"><img class="nb-img" data-img="${esc(x.id)}" alt="${esc(x.cap || '')}" title="Tocca per ingrandire">${x.cap || x.src ? `<figcaption>${esc(x.cap || '')}${x.src ? `<span class="cn-src">Fonte: ${/^https?:\/\//.test(x.src) ? `<a href="${esc(x.src)}" target="_blank" rel="noopener">${esc(x.src.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</a>` : esc(x.src)}</span>` : '<span class="cn-src muted-inline">fonte da aggiungere</span>'}</figcaption>` : ''}</figure>`).join('')}</div></div>` : ''}
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
  $$('[data-g="lab"], [data-g="pp"]', sh.el).forEach(a => { a.onclick = () => sh.close(); });
  $$('[data-cnopen]', sh.el).forEach(b => { b.onclick = () => { sh.close(); setTimeout(() => showClinicNote(b.dataset.cnopen), 0); }; });
  // un tocco su un’immagine la ingrandisce dentro la nota, un altro la rimpicciolisce
  $$('.cn-fig img', sh.el).forEach(img => img.addEventListener('click', () => img.closest('.cn-fig').classList.toggle('big')));
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
  if ((kind === 'anat' || kind === 'atlas') && p1 === 'quiz') return viewImageQuiz(kind);
  setView(`
    <header class="page-head">
      <div><h1>${cfg.name}</h1><p class="lede">${cfg.lede}</p></div>
      <button class="btn primary" type="button" data-act="sp-new">${isDiary ? 'Nuova giornata' : 'Nuova scheda'}</button>
    </header>
    ${isDiary ? `<nav class="tabs" aria-label="Diario"><a href="#/diary" class="tab on" aria-current="page">Giornate${all.length ? ` (${all.length})` : ''}</a><a href="#/diary/procs" class="tab">Procedure</a></nav>` : ''}
    ${kind === 'anat' || kind === 'atlas' ? `<nav class="tabs" aria-label="${esc(cfg.name)}"><a href="#/${cfg.route}" class="tab on" aria-current="page">Schede${all.length ? ` (${all.length})` : ''}</a><a href="#/${cfg.route}/quiz" class="tab">Indovina dall’immagine</a></nav>` : ''}
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
/* ---------- v3.75: il modello delle domande d’esame ----------
   Come il foglio “Database Singole Domande” dei file di Gemini: una riga per ogni
   domanda uscita (data dell’appello, anno, studente, testo originale, argomento
   normalizzato, macro-categoria). L’argomento normalizzato è la domanda della banca:
   le formulazioni diverse si sommano e restano come varianti (occ[].text); la
   macro-categoria è la parte del programma (x.cat), usata dalla struttura dell’esame. */
const EQ_HEAD = ['Data Appello', 'Anno', 'Studente (Telegram)', 'Domanda Originale (Testo Esatto)', 'Argomento Normalizzato', 'Macro-Categoria', 'Risposta (facoltativa)'];
const EQ_FIELDS = [
  ['q', 'Argomento (raggruppa le domande uguali)', [/argoment\w*\s+normalizz|normalizzat/i, /domand|quesit|question/i, /argoment/i]],
  ['orig', 'Testo originale della domanda', [/originale|testo esatto|formulazion|variant/i]],
  ['cat', 'Macro-categoria (parte del programma)', [/macro|categor/i]],
  ['a', 'Risposta', [/rispost|answer|soluzion/i]],
  ['subject', 'Materia', [/materi|insegnam|corso|subject/i]],
  ['topic', 'Sezione del notebook', [/sezion|capitol|topic/i]],
  ['prof', 'Docente', [/docent|^prof|commission|esaminat/i]],
  ['year', 'Anno', [/^\s*anno\b|year/i]],
  ['date', 'Data dell’appello', [/data|appell|session|date/i]],
  ['src', 'Studente o fonte', [/studente|telegram|fonte|source|riferit/i]],
  ['tags', 'Tag', [/^\s*tag|etichett/i]]
];
const GEMINI_PROMPT = `Analizza i messaggi del gruppo Telegram che ti allego, in cui gli studenti raccontano le domande uscite all’esame di [MATERIA] con [DOCENTE].
Crea un file Excel (.xlsx). Nella prima riga scrivi il titolo così: “[MATERIA IN MAIUSCOLO] ([DOCENTE]) — DOMANDE D’ESAME”.
Poi un foglio chiamato “Database Singole Domande” con una riga per ogni singola domanda raccontata e queste colonne, con questi titoli esatti:
Data Appello | Anno | Studente (Telegram) | Domanda Originale (Testo Esatto) | Argomento Normalizzato | Macro-Categoria
- Data Appello: la data dell’esame in formato GG/MM/AAAA (se manca, quella del messaggio).
- Studente (Telegram): il nome di chi racconta.
- Domanda Originale: il testo come l’ha scritto lo studente.
- Argomento Normalizzato: lo stesso nome per le domande uguali scritte in modi diversi (per esempio “archicorteccia” e “archipallio” → “Formazione dell’ippocampo”).
- Macro-Categoria: la parte del programma (per esempio “Tronco encefalico e nervi cranici”), sempre con gli stessi nomi.
Non inventare domande: solo quelle raccontate nei messaggi.`;
// numeri di Excel che sono date (giorni dal 1900)
const xlDate = v => { const n = +v; if (!/^\d{5}(\.\d+)?$/.test(String(v)) || n < 20000 || n > 80000) return String(v || '').trim(); const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return d.toISOString().slice(0, 10); };
// date italiane (27/04/2026) o di Excel → 2026-04-27
function eqDate(v) {
  const s = xlDate(v);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return s;
}
const eqDateIt = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d || '');
const eqYear = o => o.year || (o.date || '').slice(0, 4);
const eqCat = x => x.cat || (x.tags || [])[0] || 'Senza categoria';
// le formulazioni con cui è stata raccontata (senza doppioni)
function eqVariants(x) {
  const seen = new Map();
  (x.occ || []).forEach(o => { const t = String(o.text || '').trim(); if (t && !seen.has(foldAccents(t))) seen.set(foldAccents(t), t); });
  return [...seen.values()];
}
// materia: il notebook, se c’è, o il nome scritto nel file
const eqSubjKey = x => x.notebookId || `subj:${foldAccents(x.subject || '').trim()}`;
const eqSubjLabel = key => (key.startsWith('subj:') ? (examQs().find(x => eqSubjKey(x) === key)?.subject || 'Senza materia') : nbById(key)?.name || 'Senza materia');
const eqOfSubj = key => examQs().filter(x => eqSubjKey(x) === key);
const eqStructOf = key => state.links.find(l => l.kind === 'examstruct' && l.subjKey === key) || null;
// gli esami veri: le domande fatte a uno studente in un giorno
function eqRealExams(key) {
  const g = new Map();
  eqOfSubj(key).forEach(x => (x.occ || []).forEach(o => {
    if (!o.date || !o.src) return;
    const k = `${o.date}|${foldAccents(o.src)}`;
    if (!g.has(k)) g.set(k, { date: o.date, src: o.src, items: [] });
    const e = g.get(k);
    if (!e.items.some(i => i.x === x)) e.items.push({ x, text: o.text || '' });
  }));
  return [...g.values()].sort((a, b) => b.date.localeCompare(a.date));
}
function eqTypicalCount(key) {
  const n = eqRealExams(key).map(e => e.items.length).filter(k => k > 0).sort((a, b) => a - b);
  return n.length ? { n: n[Math.floor(n.length / 2)], exams: n.length } : { n: 3, exams: 0 };
}
function eqMeta(x) {
  const occ = x.occ || [];
  const profs = [...new Set(occ.map(o => o.prof).filter(Boolean))];
  const byYear = {};
  occ.forEach(o => { const y = eqYear(o); if (y) byYear[y] = (byYear[y] || 0) + 1; });
  const years = Object.keys(byYear).sort().slice(-3).map(y => `${y}: ${byYear[y]}`);
  return [eqFreq(x) > 1 ? `uscita ${eqFreq(x)} volte` : 'uscita 1 volta', years.join(', '), profs.slice(0, 1).join('')].filter(Boolean).join(' · ');
}

/* ---------- Pagina delle domande d’esame ---------- */
const eqState = { q: '', nb: '', prof: '', year: '', cat: '', sort: 'freq' };
function eqFiltered() {
  const toks = foldAccents(eqState.q).split(/\s+/).filter(Boolean);
  let list = examQs().filter(x => (!eqState.nb || eqSubjKey(x) === eqState.nb)
    && (!eqState.cat || eqCat(x) === eqState.cat)
    && (!eqState.prof || (x.occ || []).some(o => o.prof === eqState.prof))
    && (!eqState.year || (x.occ || []).some(o => eqYear(o) === eqState.year))
    && (!toks.length || toks.every(t => foldAccents(`${x.q} ${x.a || ''} ${eqCat(x)} ${(x.tags || []).join(' ')} ${eqVariants(x).join(' ')} ${(x.secIds || []).map(id => secById(id)?.title || '').join(' ')}`).includes(t))));
  const last = x => (x.occ || []).map(o => o.date || o.year || '').sort().pop() || '';
  const bad = x => (x.stats?.ko || 0) - (x.stats?.ok || 0) * 0.5;
  list.sort(eqState.sort === 'recent' ? (a, b) => last(b).localeCompare(last(a)) || eqFreq(b) - eqFreq(a)
    : eqState.sort === 'wrong' ? (a, b) => bad(b) - bad(a) || eqFreq(b) - eqFreq(a)
    : eqState.sort === 'new' ? (a, b) => (b.created || 0) - (a.created || 0)
    : (a, b) => eqFreq(b) - eqFreq(a) || last(b).localeCompare(last(a)));
  return list;
}
// la materia su cui lavorare (struttura, simulazione): quella scelta, l’unica, o la chiedo
async function eqPickSubject(title) {
  if (eqState.nb) return eqState.nb;
  const keys = [...new Set(examQs().map(eqSubjKey))];
  if (keys.length === 1) return keys[0];
  if (!keys.length) { toast('Importa prima le domande d’esame'); return null; }
  return actionSheet(title, keys.map(k => ({ key: k, label: `${eqSubjLabel(k)} · ${eqOfSubj(k).length} argomenti` })));
}
function viewExamQ(p1, p2) {
  if (p1 === 'quiz') return viewExamQuiz();
  if (p1 === 'sim') return viewExamSim(decodeURIComponent(p2 || ''), false);
  if (p1 === 'real') return viewExamSim(decodeURIComponent(p2 || ''), true);
  if (p1 === 'prep') return viewExamPrep(decodeURIComponent(p2 || ''));
  const all = examQs();
  const subj = [...new Set(all.map(eqSubjKey))];
  const inSubj = eqState.nb ? all.filter(x => eqSubjKey(x) === eqState.nb) : all;
  const cats = [...new Set(inSubj.map(eqCat))].sort((a, b) => a.localeCompare(b, 'it'));
  if (eqState.cat && !cats.includes(eqState.cat)) eqState.cat = '';
  const profs = [...new Set(all.flatMap(x => (x.occ || []).map(o => o.prof)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  const years = [...new Set(all.flatMap(x => (x.occ || []).map(eqYear)).filter(Boolean))].sort().reverse();
  const st = eqState.nb ? eqStructOf(eqState.nb) : null;
  setView(`
    <header class="page-head">
      <div><h1>Domande d’esame</h1><p class="lede">${all.length ? `${all.length} argomenti, ${all.reduce((a, x) => a + eqFreq(x), 0)} domande raccontate. ` : ''}Quelle uscite agli esami: le stesse domande si sommano, così vedi cosa chiedono di più.</p></div>
      <div class="inline">
        ${all.length ? '<button class="btn primary" type="button" data-act="eq-sim">Simulazione d’esame</button><button class="btn" type="button" data-act="eq-oral">Esame orale</button><button class="btn" type="button" data-act="eq-prep">Preparazione all’esame</button>' : ''}
        <button class="btn" type="button" data-act="eq-import">Importa da Excel</button>
        <button class="btn ghost" type="button" data-act="eq-new">Nuova domanda</button>
      </div>
    </header>
    ${all.length ? `
      <div class="eq-tools">
        <input type="search" class="input search" id="eqQ" placeholder="Cerca negli argomenti, nelle formulazioni e nelle risposte" aria-label="Cerca nelle domande" value="${esc(eqState.q)}">
        <div class="eq-filters">
          <select class="input" id="eqNb" aria-label="Materia"><option value="">Tutte le materie</option>${subj.map(k => `<option value="${esc(k)}" ${eqState.nb === k ? 'selected' : ''}>${esc(eqSubjLabel(k))}</option>`).join('')}</select>
          ${cats.length > 1 ? `<select class="input" id="eqCat" aria-label="Categoria"><option value="">Tutte le categorie</option>${cats.map(c => `<option ${eqState.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
          ${profs.length > 1 ? `<select class="input" id="eqProf" aria-label="Docente"><option value="">Tutti i docenti</option>${profs.map(p => `<option ${eqState.prof === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>` : ''}
          ${years.length ? `<select class="input" id="eqYear" aria-label="Anno"><option value="">Tutti gli anni</option>${years.map(y => `<option ${eqState.year === y ? 'selected' : ''}>${esc(y)}</option>`).join('')}</select>` : ''}
          <select class="input" id="eqSort" aria-label="Ordine">${[['freq', 'Le più frequenti'], ['recent', 'Uscite di recente'], ['wrong', 'Quelle che sbagli'], ['new', 'Aggiunte di recente']].map(([k, l]) => `<option value="${k}" ${eqState.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <div class="inline">
          <a class="btn" href="#/examq/quiz" id="eqQuizBtn">Allenati su queste</a>
          <button class="btn ghost" type="button" data-act="eq-struct">${st ? 'Struttura dell’esame' : 'Imposta la struttura dell’esame'}</button>
          <button class="btn ghost" type="button" data-act="eq-real">Un appello vero</button>
          <button class="btn ghost" type="button" data-act="eq-export">Scarica in Excel</button>
        </div>
        ${st ? `<p class="hint eq-st-sum">${esc(eqSubjLabel(eqState.nb))}: ${st.parts.map(p => `${esc(p.name)} (${p.n})`).join(' · ')}${st.notes ? ` · ${esc(st.notes.slice(0, 120))}` : ''}</p>` : ''}
      </div>
      <ul class="list eq-list" id="eqList"></ul>` : `
      <div class="empty">
        <p>Raccogli qui le domande uscite agli esami. Il modo più veloce: fai analizzare a Gemini i messaggi del gruppo Telegram e importa il file Excel che ti dà (il modello e il prompt sono qui sotto). Puoi anche scriverle una per una.</p>
        <div class="inline" style="justify-content:center"><button class="btn primary" type="button" data-act="eq-import">Importa da Excel</button><button class="btn" type="button" data-act="eq-template">Scarica il modello</button><button class="btn" type="button" data-act="eq-prompt">Copia il prompt per Gemini</button></div>
      </div>`}
  `);
  const draw = () => {
    const box = $('#eqList');
    if (!box) return;
    const list = eqFiltered();
    $('#eqQuizBtn').textContent = `Allenati su queste (${list.length})`;
    box.innerHTML = list.slice(0, 400).map(x => {
      const vars = eqVariants(x);
      return `
      <li><button type="button" class="row" data-eq="${x.id}">
        <span class="eq-n" title="Volte che è uscita">${eqFreq(x)}×</span>
        <span class="row-main">
          <span class="row-title eq-q">${esc(x.q)}</span>
          <span class="row-sub">${esc([eqState.nb ? '' : eqSubject(x), eqCat(x) !== 'Senza categoria' ? eqCat(x) : '', eqMeta(x)].filter(Boolean).join(' · '))}${(x.secIds || []).length ? ` · ${esc((x.secIds || []).map(id => secById(id)?.title).filter(Boolean).slice(0, 2).join(', '))}` : ''}</span>
          ${vars.length > 1 || (vars[0] && foldAccents(vars[0]) !== foldAccents(x.q)) ? `<span class="row-sub eq-vars">Chiesta come: ${esc(vars.slice(0, 5).join(' • '))}${vars.length > 5 ? ` • … (${vars.length})` : ''}</span>` : ''}
        </span>
        ${x.stats && (x.stats.ok || x.stats.ko) ? `<span class="eq-st" title="La sapevo / non la sapevo">✓${x.stats.ok || 0} ✗${x.stats.ko || 0}</span>` : ''}
      </button></li>`;
    }).join('') || '<li class="hint">Nessuna domanda corrisponde.</li>';
  };
  draw();
  $('#eqQ')?.addEventListener('input', e => { eqState.q = e.target.value; draw(); });
  $('#eqNb')?.addEventListener('change', e => { eqState.nb = e.target.value; eqState.cat = ''; route(); });
  [['#eqCat', 'cat'], ['#eqProf', 'prof'], ['#eqYear', 'year'], ['#eqSort', 'sort']].forEach(([sel, k]) => $(sel)?.addEventListener('change', e => { eqState[k] = e.target.value; draw(); }));
  on('[data-act="eq-new"]', 'click', async () => { if (await eqSheet(null)) route(); });
  on('[data-act="eq-import"]', 'click', eqImportFlow);
  on('[data-act="eq-template"]', 'click', eqTemplate);
  on('[data-act="eq-prompt"]', 'click', eqCopyPrompt);
  on('[data-act="eq-sim"]', 'click', async () => { const k = await eqPickSubject('Simulazione: quale materia?'); if (k) go(`#/examq/sim/${encodeURIComponent(k)}`); });
  on('[data-act="eq-oral"]', 'click', async () => { const k = await eqPickSubject('Esame orale: quale materia?'); if (k) go(`#/viva/exam/${encodeURIComponent(k)}`); });
  on('[data-act="eq-prep"]', 'click', async () => { const k = await eqPickSubject('Preparazione: quale materia?'); if (k) go(`#/examq/prep/${encodeURIComponent(k)}`); });
  on('[data-act="eq-real"]', 'click', async () => { const k = await eqPickSubject('Un appello vero: quale materia?'); if (k) go(`#/examq/real/${encodeURIComponent(k)}`); });
  on('[data-act="eq-struct"]', 'click', async () => { const k = await eqPickSubject('Struttura dell’esame: quale materia?'); if (k && await eqStructSheet(k)) route(); });
  on('[data-act="eq-export"]', 'click', async () => {
    const list = eqFiltered();
    const sk = eqState.nb || (list[0] ? eqSubjKey(list[0]) : '');
    const prof = (list.flatMap(x => (x.occ || []).map(o => o.prof)).find(Boolean)) || '';
    const rows = [[`${(eqState.nb ? eqSubjLabel(sk) : 'Domande d’esame').toUpperCase()}${prof ? ` (${prof})` : ''} — esportato dal Notebook il ${eqDateIt(todayStr())}`], [], [...EQ_HEAD, 'Docente', 'Materia', 'Sezioni']];
    list.forEach(x => {
      const occ = x.occ && x.occ.length ? x.occ : [{}];
      occ.forEach(o => rows.push([eqDateIt(o.date || ''), eqYear(o), o.src || '', o.text || x.q, x.q, eqCat(x) === 'Senza categoria' ? '' : eqCat(x), x.a || '', o.prof || '', eqSubject(x), (x.secIds || []).map(id => secById(id)?.title).filter(Boolean).join('; ')]));
    });
    downloadBlob(await writeXlsx(rows, 'Database Singole Domande'), `Domande d’esame ${todayStr()}.xlsx`);
    toast('File Excel pronto: una riga per ogni volta che una domanda è uscita, come il modello');
  });
  $('#eqList')?.addEventListener('click', async e => {
    const b = e.target.closest('[data-eq]');
    if (!b) return;
    const x = examQs().find(r => r.id === b.dataset.eq);
    if (x && await eqSheet(x)) route();
  });
}
async function eqTemplate() {
  downloadBlob(await writeXlsx([
    ['NEUROANATOMIA (PROF.SSA ROSSI) — DOMANDE D’ESAME'],
    [],
    EQ_HEAD,
    ['27/04/2026', '2026', 'Giulia', 'archicorteccia', 'Formazione dell’ippocampo', 'Sistema limbico e rinencefalo', ''],
    ['27/04/2026', '2026', 'Giulia', 'via gustativa', 'Via gustativa', 'Sensi speciali', ''],
    ['19/03/2026', '2026', 'Marco', 'archipallio e giro dentato', 'Formazione dell’ippocampo', 'Sistema limbico e rinencefalo', 'Corno d’Ammone, giro dentato, subicolo…']
  ], 'Database Singole Domande'), 'Modello domande d’esame.xlsx');
  toast('Modello scaricato: una riga per ogni domanda uscita, come i file di Gemini');
}
async function eqCopyPrompt() {
  try { await navigator.clipboard.writeText(GEMINI_PROMPT); toast('Prompt copiato: incollalo in Gemini con i messaggi di Telegram, e sostituisci materia e docente'); }
  catch { await modal({ title: 'Prompt per Gemini', text: GEMINI_PROMPT, confirm: 'Chiudi' }); }
}

// Scheda di una domanda: si vede e si modifica nello stesso foglio
function eqSheet(x, preset = {}) {
  return new Promise(resolve => {
    const isNew = !x;
    const r = x || { id: uid(), kind: 'examq', notebookId: preset.notebookId || '', q: '', a: '', secIds: preset.secIds || [], occ: [{ prof: '', year: String(new Date().getFullYear()), date: '', src: '', text: '' }], tags: [], created: Date.now() };
    const nbs = state.notebooks.filter(n => !n.kind);
    const secsOfNb = id => state.sections.filter(s => s.notebookId === id).sort((a, b) => a.title.localeCompare(b.title, 'it'));
    const catsAll = [...new Set(examQs().map(y => y.cat).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
    let occ = (r.occ || []).map(o => ({ ...o }));
    let secIds = [...(r.secIds || [])];
    const vars = eqVariants(r);
    const sh = openSheet(`
      <h2>${isNew ? 'Nuova domanda d’esame' : 'Domanda d’esame'}</h2>
      <label class="field"><span>Argomento o domanda</span><textarea class="input" id="eqQt" rows="2">${esc(r.q)}</textarea></label>
      ${vars.length ? `<div class="field"><span class="lbl">Come l’hanno raccontata (${vars.length})</span><p class="eq-varlist">${vars.map(v => `<span class="tag">${esc(v)}</span>`).join(' ')}</p></div>` : ''}
      <label class="field"><span>Risposta o traccia, facoltativa</span><textarea class="input" id="eqAt" rows="4" placeholder="Anche in elenco: i punti da toccare">${esc(r.a || '')}</textarea></label>
      <div class="grid2">
        <label class="field"><span>Materia (notebook)</span><select class="input" id="eqNbS"><option value="">${r.subject ? esc(r.subject) : 'Nessuno'}</option>${nbs.map(n => `<option value="${n.id}" ${n.id === r.notebookId ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Macro-categoria (parte del programma)</span><input class="input" id="eqCatI" value="${esc(r.cat || '')}" list="eqCatList" placeholder="Es. Tronco encefalico e nervi cranici"><datalist id="eqCatList">${catsAll.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      </div>
      <label class="field"><span>Tag</span><input class="input" id="eqTags" value="${esc((r.tags || []).join(', '))}" placeholder="Es. orale, scritto"></label>
      <div class="field"><span class="lbl">Sezioni collegate</span><div class="tags" id="eqSecs"></div>
        <select class="input" id="eqSecAdd" aria-label="Collega una sezione"></select></div>
      <details class="eq-occ-box" ${isNew ? 'open' : ''}><summary>Quando è uscita (${occ.filter(o => o.date || o.year || o.src).length || 0})</summary><div id="eqOcc"></div><button class="btn sm ghost" type="button" data-eqx="occ">+ È uscita un’altra volta</button></details>
      ${!isNew && (r.stats?.ok || r.stats?.ko) ? `<p class="hint">Nell’allenamento: la sapevi ${r.stats.ok || 0} volte, non la sapevi ${r.stats.ko || 0}.</p>` : ''}
      <div class="modal-actions">
        ${isNew ? '' : '<button class="btn ghost danger" type="button" data-eqx="del">Elimina</button>'}
        <button class="btn ghost" type="button" data-eqx="no">Annulla</button>
        <button class="btn primary" type="button" data-eqx="ok">Salva</button>
      </div>`, { label: 'Domanda d’esame', onClose: v => resolve(!!v) });
    const drawSecs = () => {
      const nbId = $('#eqNbS', sh.el).value;
      $('#eqSecs', sh.el).innerHTML = secIds.map(id => secById(id)).filter(Boolean).map(s => `<span class="tag">${esc(s.title)} <button type="button" class="tag-x" data-eqsec="${s.id}" aria-label="Scollega ${esc(s.title)}">×</button></span>`).join('') || '<span class="hint">Nessuna</span>';
      $('#eqSecAdd', sh.el).innerHTML = `<option value="">${nbId ? '+ Collega una sezione' : 'Scegli prima la materia'}</option>${nbId ? secsOfNb(nbId).filter(s => !secIds.includes(s.id)).map(s => `<option value="${s.id}">${esc(s.title)}${groupPathText(s) ? ` · ${esc(groupPathText(s))}` : ''}</option>`).join('') : ''}`;
    };
    const drawOcc = () => {
      $('#eqOcc', sh.el).innerHTML = occ.map((o, i) => `<div class="eq-occ" data-oi="${i}">
        <input class="input" data-of="date" value="${esc(eqDateIt(o.date || ''))}" placeholder="Data (GG/MM/AAAA)" aria-label="Data dell’appello">
        <input class="input" data-of="src" value="${esc(o.src || '')}" placeholder="Studente o fonte" aria-label="Studente o fonte">
        <input class="input" data-of="text" value="${esc(o.text || '')}" placeholder="Com’è stata chiesta" aria-label="Testo originale">
        <input class="input" data-of="prof" value="${esc(o.prof || '')}" placeholder="Docente" aria-label="Docente">
        <button class="btn sm ghost" type="button" data-odel="${i}" aria-label="Togli">✕</button></div>`).join('') || '<p class="hint">Aggiungi almeno una volta in cui è uscita.</p>';
    };
    const readOcc = () => $$('.eq-occ', sh.el).forEach(row => {
      const o = occ[+row.dataset.oi];
      $$('[data-of]', row).forEach(i => { o[i.dataset.of] = i.value.trim(); });
      o.date = eqDate(o.date);
      if (/^\d{4}-/.test(o.date)) o.year = o.date.slice(0, 4);
    });
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
      if (k === 'occ') { readOcc(); occ.push({ prof: occ[occ.length - 1]?.prof || '', year: String(new Date().getFullYear()), date: '', src: '', text: '' }); drawOcc(); }
      if (k === 'del') {
        if (!(await modal({ title: 'Eliminare la domanda?', text: 'Sparisce dalla banca su tutti i tuoi dispositivi.', confirm: 'Elimina', danger: true }))) return;
        await removeRecords([{ store: 'links', rec: r }]);
        sh.close(true);
      }
      if (k === 'ok') {
        readOcc();
        const q = $('#eqQt', sh.el).value.trim();
        if (!q) { toast('Scrivi la domanda'); $('#eqQt', sh.el).focus(); return; }
        const keep = occ.filter(o => o.prof || o.year || o.date || o.src || o.text);
        Object.assign(r, { q, a: $('#eqAt', sh.el).value.trim(), notebookId: $('#eqNbS', sh.el).value || (r.subject ? '' : ''), cat: $('#eqCatI', sh.el).value.trim(), secIds, tags: parseTags($('#eqTags', sh.el).value), occ: keep.length ? keep : [{}] });
        await saveLink(r);
        toast(isNew ? 'Domanda aggiunta' : 'Domanda salvata');
        sh.close(true);
      }
    });
    setTimeout(() => (isNew ? $('#eqQt', sh.el) : null)?.focus(), 40);
  });
}

/* ---------- Importazione da Excel o CSV (anche i file di Gemini) ---------- */
// la riga dei titoli: quella (tra le prime) che somiglia di più ai titoli attesi
function eqFindHeader(rows) {
  let best = -1, score = 1;
  rows.slice(0, 15).forEach((r, i) => {
    const cells = r.map(c => String(c || '').trim()).filter(Boolean);
    if (cells.length < 2) return;
    const sc = EQ_FIELDS.filter(([, , res]) => cells.some(c => c.length < 60 && res.some(re => re.test(c)))).length;
    if (sc > score) { score = sc; best = i; }
  });
  return best;
}
// “NEUROANATOMIA (PROF.SSA SERRA) — …” → materia e docente
function eqTitleInfo(rows, headAt, fileName) {
  const t = rows.slice(0, Math.max(0, headAt)).map(r => r.find(c => String(c || '').trim())).find(Boolean) || '';
  const m = String(t).match(/^\s*([^(—–\-]+?)\s*\(([^)]*)\)/);
  const nice = s => s.toLowerCase().replace(/(^|[\s'’])(\p{L})/gu, (a, b, c) => b + c.toUpperCase()).replace(/\bProf\.?ssa\b/i, 'Prof.ssa').replace(/\bProf\b\.?/i, 'Prof.');
  if (m) return { subject: nice(m[1].trim()), prof: /prof|dott|doc/i.test(m[2]) ? nice(m[2].trim()) : '' };
  const f = String(fileName || '').replace(/\.[a-z]+$/i, '').split(/[_\s-]+/).filter(x => !/^\d+$/.test(x));
  return { subject: f[0] ? nice(f[0]) : '', prof: f[1] ? `Prof. ${nice(f[1])}` : '' };
}
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
  // il foglio con le singole domande, se c’è (nei file di Gemini è il quarto)
  let si = Math.max(0, sheets.findIndex(s => /database|singol/i.test(s.name)));
  if (!/database|singol/i.test(sheets[si].name)) si = sheets.reduce((b, s, i) => (s.rows.length > sheets[b].rows.length ? i : b), 0);
  const resolveNb = (subject, fallback) => {
    if (!subject) return fallback;
    const f = foldAccents(subject).trim();
    return (nbs.find(n => foldAccents(n.name).trim() === f) || nbs.find(n => { const t = foldAccents(n.name); return t.length > 3 && (t.includes(f) || f.includes(t)); }))?.id || '';
  };
  const sh = openSheet(`
    <h2>Importa le domande</h2>
    <p class="sheet-sub">${esc(file.name)}. Le domande con lo stesso argomento si sommano; reimportando un file aggiornato, quelle già contate (stessa data, studente e testo) non si contano di nuovo.</p>
    ${sheets.length > 1 ? `<label class="field"><span>Foglio</span><select class="input" id="imSheet">${sheets.map((s, i) => `<option value="${i}" ${i === si ? 'selected' : ''}>${esc(s.name)} (${s.rows.length} righe)</option>`).join('')}</select></label>` : ''}
    <p class="hint" id="imHeadInfo"></p>
    <div class="grid2">
      <label class="field"><span>Materia</span><select class="input" id="imNb"></select></label>
      <label class="field"><span>Docente</span><input class="input" id="imProf" placeholder="Es. Prof.ssa Serra"></label>
    </div>
    <label class="field" id="imNewNbBox" hidden><span>Nome della materia (se non è un notebook)</span><input class="input" id="imSubj"></label>
    <details class="eq-mapbox"><summary>Colonne</summary><div class="eq-map" id="imMap"></div></details>
    <label class="check eq-auto"><input type="checkbox" id="imAuto" checked><span>Collega le sezioni del notebook cercando i loro titoli negli argomenti</span></label>
    <div id="imPrev" class="eq-prev"></div>
    <div class="modal-actions">
      <button class="btn ghost" type="button" data-im="no">Annulla</button>
      <button class="btn primary" type="button" data-im="ok">Importa</button>
    </div>`, { label: 'Importa le domande' });
  let headAt = 0;
  const cols = () => {
    const s = sheets[si];
    const w = Math.max(...s.rows.map(r => r.length));
    return Array.from({ length: w }, (_, i) => (headAt >= 0 ? String(s.rows[headAt]?.[i] || '').trim() : '') || `Colonna ${String.fromCharCode(65 + (i % 26))}`);
  };
  const setup = () => {
    const s = sheets[si];
    headAt = eqFindHeader(s.rows);
    const info = eqTitleInfo(s.rows, headAt, file.name);
    $('#imHeadInfo', sh.el).textContent = headAt >= 0 ? `Ho trovato i titoli delle colonne${info.subject ? `; dal titolo: ${info.subject}${info.prof ? `, ${info.prof}` : ''}` : ''}.` : 'Non trovo la riga dei titoli: scegli le colonne qui sotto.';
    const nbGuess = resolveNb(info.subject, '');
    $('#imNb', sh.el).innerHTML = `<option value="">${info.subject ? `Non è un notebook: “${esc(info.subject)}”` : 'Nessuna'}</option>${nbs.map(n => `<option value="${n.id}" ${n.id === nbGuess ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}`;
    $('#imSubj', sh.el).value = info.subject;
    $('#imNewNbBox', sh.el).hidden = !!nbGuess;
    if (!$('#imProf', sh.el).value) $('#imProf', sh.el).value = info.prof;
    const names = cols();
    const used = new Set();
    $('#imMap', sh.el).innerHTML = EQ_FIELDS.map(([k, label, res]) => {
      let pick = -1;
      if (headAt >= 0) for (const re of res) { pick = names.findIndex((n, i) => n.length < 80 && re.test(n) && !used.has(i)); if (pick >= 0) break; }
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
    const body = s.rows.slice(headAt + 1);
    const get = (r, k) => (m[k] >= 0 ? String(r[m[k]] ?? '').trim() : '');
    return body.map(r => {
      const date = eqDate(get(r, 'date'));
      const orig = get(r, 'orig');
      return { q: get(r, 'q') || orig, orig, cat: get(r, 'cat'), a: get(r, 'a'), subject: get(r, 'subject'), topic: get(r, 'topic'), prof: get(r, 'prof'), year: (get(r, 'year').replace(/\.0+$/, '') || (/^\d{4}-/.test(date) ? date.slice(0, 4) : '')), date, src: get(r, 'src'), tags: parseTags(get(r, 'tags')) };
    }).filter(x => x.q && !/^(rank|totale|data appello)$/i.test(x.q));
  };
  const nbOf = r => resolveNb(r.subject, $('#imNb', sh.el).value);
  const subjOf = r => (nbOf(r) ? '' : r.subject || $('#imSubj', sh.el).value.trim());
  const linkSecs = (row, nbId) => {
    const out = new Set();
    if (row.topic) row.topic.split(/[;|]/).map(t => t.trim()).filter(Boolean).forEach(t => { const s = guessSection(t, nbId || null); if (s) out.add(s.id); });
    if ($('#imAuto', sh.el).checked && nbId) {
      const fq = ` ${foldAccents(`${row.q} ${row.orig}`).replace(/[^a-z0-9]+/g, ' ')} `;
      state.sections.filter(s => s.notebookId === nbId).forEach(s => {
        const t = foldAccents(s.title).replace(/[^a-z0-9]+/g, ' ').trim();
        if (t.length > 4 && fq.includes(` ${t} `) && out.size < 3) out.add(s.id);
      });
    }
    return [...out];
  };
  const keyOf = r => { const nb = nbOf(r); return eqKey(r.q, nb || `subj:${foldAccents(subjOf(r))}`); };
  const bankKey = x => eqKey(x.q, x.notebookId || `subj:${foldAccents(x.subject || '')}`);
  const drawPrev = () => {
    const rows = rowsOut();
    const have = new Set(examQs().map(bankKey));
    const keys = rows.map(keyOf);
    const uniq = new Set(keys).size;
    const cats = new Set(rows.map(r => r.cat).filter(Boolean));
    const exams = new Set(rows.filter(r => r.date && r.src).map(r => `${r.date}|${r.src}`)).size;
    $('#imPrev', sh.el).innerHTML = rows.length ? `
      <p class="hint"><strong>${rows.length}</strong> domande raccontate su <strong>${uniq}</strong> argomenti${cats.size ? `, in ${cats.size} macro-categorie` : ''}${exams ? `, da ${exams} esami (studente e giorno)` : ''}${keys.some(k => have.has(k)) ? `; ${new Set(keys.filter(k => have.has(k))).size} argomenti sono già nella banca e si aggiornano` : ''}.</p>
      <div class="table-wrap"><table class="eq-ptable"><thead><tr><th>Argomento</th><th>Come è stata chiesta</th><th>Categoria</th><th>Data</th></tr></thead><tbody>
        ${rows.slice(0, 6).map(r => `<tr><td>${esc(r.q.slice(0, 90))}</td><td>${esc((r.orig || '—').slice(0, 60))}</td><td>${esc(r.cat || '—')}</td><td>${esc(eqDateIt(r.date) || r.year || '—')}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="hint">Nessuna riga con la domanda: controlla le colonne.</p>';
  };
  setup();
  sh.el.addEventListener('change', e => {
    if (e.target.id === 'imSheet') { si = +e.target.value; setup(); return; }
    if (e.target.id === 'imNb') $('#imNewNbBox', sh.el).hidden = !!e.target.value;
    drawPrev();
  });
  $('#imSubj', sh.el).addEventListener('input', drawPrev);
  $('[data-im="no"]', sh.el).onclick = () => sh.close();
  $('[data-im="ok"]', sh.el).onclick = async () => {
    const rows = rowsOut();
    if (!rows.length) { toast('Nessuna domanda da importare'); return; }
    const profDef = $('#imProf', sh.el).value.trim();
    const byKey = new Map(examQs().map(x => [bankKey(x), x]));
    const touched = new Set();
    let added = 0, merged = 0, newOcc = 0, skipped = 0;
    const oKey = o => `${o.date || ''}|${foldAccents(o.src || '')}|${foldAccents(o.text || '')}`;
    for (const r of rows) {
      const nbId = nbOf(r);
      const subject = subjOf(r);
      const key = keyOf(r);
      let x = byKey.get(key);
      if (!x) {
        x = { id: uid(), kind: 'examq', notebookId: nbId, subject: nbId ? '' : subject, q: r.q, a: r.a, cat: r.cat, secIds: [], occ: [], tags: [], created: Date.now() + added };
        byKey.set(key, x);
        added++;
      } else if (!touched.has(x.id)) merged++;
      if (!x.a && r.a) x.a = r.a;
      if (r.cat) x.cat = r.cat;
      const o = { prof: r.prof || profDef, year: r.year, date: r.date, src: r.src, text: r.orig && foldAccents(r.orig) !== foldAccents(r.q) ? r.orig : (r.orig || '') };
      const old = (x.occ || []).filter(v => v.prof || v.year || v.date || v.src || v.text);
      // la stessa domanda dello stesso studente nello stesso giorno: già contata
      if ((o.date || o.src) && old.some(v => oKey(v) === oKey(o))) skipped++;
      else { x.occ = [...old, o]; newOcc++; }
      x.secIds = [...new Set([...(x.secIds || []), ...linkSecs(r, nbId)])];
      x.tags = [...new Set([...(x.tags || []), ...r.tags])];
      touched.add(x.id);
    }
    const recs = [...byKey.values()].filter(x => touched.has(x.id));
    for (const x of recs) await saveLink(x);
    sh.close();
    toast(`${added} argomenti nuovi${merged ? `, ${merged} aggiornati` : ''}; ${newOcc} domande aggiunte${skipped ? `, ${skipped} già presenti` : ''}`);
    const first = recs[0];
    if (first) { eqState.nb = eqSubjKey(first); eqState.cat = ''; }
    go('#/examq');
    route();
    // la prima volta, propongo la struttura dell’esame
    const askedKey = 'nb-eq-struct-asked';
    let asked = [];
    try { asked = JSON.parse(localStorage.getItem(askedKey) || '[]'); } catch { asked = []; }
    // la proposta compare una volta sola per materia
    if (first && !eqStructOf(eqSubjKey(first)) && !asked.includes(eqSubjKey(first)) && (() => { try { localStorage.setItem(askedKey, JSON.stringify([...asked, eqSubjKey(first)].slice(-50))); } catch { /* niente */ } return true; })()) setTimeout(async () => { if (await modal({ title: 'Struttura dell’esame', text: `Vuoi dire all’app com’è fatto l’esame di ${eqSubjLabel(eqSubjKey(first))} (quante domande, da quali parti del programma)? Serve per la simulazione.`, confirm: 'Sì, adesso' })) { if (await eqStructSheet(eqSubjKey(first))) route(); } }, 400);
  };
}

/* ---------- Struttura dell’esame ----------
   Record { kind: 'examstruct', subjKey, prof, parts: [{ id, name, n }], map: { categoria: idParte | 'any' | 'off' },
   weight: 'freq' | 'equal', recent: true, notes } */
function eqStructSheet(key) {
  return new Promise(resolve => {
    const qs = eqOfSubj(key);
    const cats = [...new Set(qs.map(eqCat))].map(c => ({ c, n: qs.filter(x => eqCat(x) === c).reduce((a, x) => a + eqFreq(x), 0) })).sort((a, b) => b.n - a.n);
    const typ = eqTypicalCount(key);
    const old = eqStructOf(key);
    const st = old ? JSON.parse(JSON.stringify(old)) : {
      id: uid(), kind: 'examstruct', notebookId: '_examstruct', subjKey: key,
      prof: (qs.flatMap(x => (x.occ || []).map(o => o.prof)).find(Boolean)) || '',
      parts: Array.from({ length: typ.n }, (_, i) => ({ id: uid(), name: `Parte ${i + 1}`, n: 1 })),
      map: {}, weight: 'freq', recent: true, notes: '', created: Date.now()
    };
    const sh = openSheet(`
      <h2>Struttura dell’esame</h2>
      <p class="sheet-sub">${esc(eqSubjLabel(key))}. ${typ.exams ? `Negli esami raccolti, di solito <strong>${typ.n} domande</strong> per studente (${typ.exams} esami).` : 'Dimmi com’è fatto l’esame: la simulazione farà lo stesso.'}</p>
      <label class="field"><span>Docente</span><input class="input" id="esProf" value="${esc(st.prof || '')}"></label>
      <div class="field"><span class="lbl">Parti dell’esame</span><div id="esParts"></div><button class="btn sm ghost" type="button" data-es="addpart">+ Aggiungi una parte</button></div>
      <div class="field"><span class="lbl">Da quale parte esce ogni macro-categoria</span>
        <p class="hint">Per esempio, se chiede una domanda sul tronco, una sulle vie e una sul telencefalo, metti le categorie nella parte giusta. “Qualsiasi parte”: può uscire in tutte; “Esclusa”: non la chiede.</p>
        <div class="es-map" id="esMap"></div></div>
      <div class="field"><span class="lbl">Scelta delle domande</span>
        <label class="check"><input type="radio" name="esW" value="freq" ${st.weight !== 'equal' ? 'checked' : ''}><span>Più probabili quelle uscite più spesso</span></label>
        <label class="check"><input type="radio" name="esW" value="equal" ${st.weight === 'equal' ? 'checked' : ''}><span>Tutte con la stessa probabilità</span></label>
        <label class="check"><input type="checkbox" id="esRecent" ${st.recent !== false ? 'checked' : ''}><span>Contano di più gli appelli dell’ultimo anno</span></label>
      </div>
      <label class="field"><span>Note sull’esame</span><textarea class="input" id="esNotes" rows="3" placeholder="Es. chiede sempre le vie annesse; vuole il disegno">${esc(st.notes || '')}</textarea></label>
      <div class="modal-actions"><button class="btn ghost" type="button" data-es="no">Annulla</button><button class="btn primary" type="button" data-es="ok">Salva</button></div>`, { label: 'Struttura dell’esame', onClose: v => resolve(!!v) });
    const readParts = () => $$('.es-part', sh.el).forEach(row => { const p = st.parts.find(x => x.id === row.dataset.pid); if (!p) return; p.name = $('[data-pn]', row).value.trim() || p.name; p.n = Math.max(1, +$('[data-pc]', row).value || 1); });
    const readMap = () => $$('[data-mc]', sh.el).forEach(s => { st.map[s.dataset.mc] = s.value; });
    const draw = () => {
      $('#esParts', sh.el).innerHTML = st.parts.map((p, i) => `<div class="es-part inline" data-pid="${p.id}">
        <input class="input" data-pn value="${esc(p.name)}" aria-label="Nome della parte ${i + 1}">
        <label class="es-n"><select class="input" data-pc aria-label="Domande">${[1, 2, 3, 4, 5].map(n => `<option ${p.n === n ? 'selected' : ''}>${n}</option>`).join('')}</select><span>${p.n === 1 ? 'domanda' : 'domande'}</span></label>
        ${st.parts.length > 1 ? `<button class="btn sm ghost" type="button" data-es-del="${p.id}" aria-label="Togli la parte">✕</button>` : ''}</div>`).join('');
      $('#esMap', sh.el).innerHTML = cats.map(({ c, n }) => {
        const v = st.map[c] || 'any';
        return `<label class="es-row"><span>${esc(c)} <small>${n}</small></span><select class="input" data-mc="${esc(c)}">${st.parts.map(p => `<option value="${p.id}" ${v === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="any" ${v === 'any' ? 'selected' : ''}>Qualsiasi parte</option><option value="off" ${v === 'off' ? 'selected' : ''}>Esclusa</option></select></label>`;
      }).join('') || '<p class="hint">Le domande non hanno macro-categorie: importa un file con la colonna Macro-Categoria, o scrivila nelle domande.</p>';
    };
    draw();
    // il nome di una parte si aggiorna mentre scrivi, senza ridisegnare (il campo resta sotto il dito)
    sh.el.addEventListener('input', e => {
      const row = e.target.closest('.es-part');
      if (!row || !e.target.matches('[data-pn]')) return;
      const p = st.parts.find(x => x.id === row.dataset.pid);
      if (!p) return;
      p.name = e.target.value.trim() || p.name;
      $$(`option[value="${p.id}"]`, sh.el).forEach(o => { o.textContent = p.name; });
    });
    sh.el.addEventListener('change', e => { if (e.target.matches('[data-pc]')) { readParts(); readMap(); draw(); } });
    sh.el.addEventListener('click', async e => {
      const d = e.target.closest('[data-es-del]');
      if (d) { readParts(); readMap(); st.parts = st.parts.filter(p => p.id !== d.dataset.esDel); Object.keys(st.map).forEach(k => { if (st.map[k] === d.dataset.esDel) st.map[k] = 'any'; }); draw(); return; }
      const b = e.target.closest('[data-es]');
      if (!b) return;
      if (b.dataset.es === 'addpart') { readParts(); readMap(); st.parts.push({ id: uid(), name: `Parte ${st.parts.length + 1}`, n: 1 }); draw(); return; }
      if (b.dataset.es === 'no') { sh.close(false); return; }
      if (b.dataset.es === 'ok') {
        readParts(); readMap();
        st.prof = $('#esProf', sh.el).value.trim();
        st.weight = $('input[name="esW"]:checked', sh.el).value;
        st.recent = $('#esRecent', sh.el).checked;
        st.notes = $('#esNotes', sh.el).value.trim();
        st.updated = Date.now();
        await saveLink(st);
        toast('Struttura dell’esame salvata: la simulazione la segue');
        sh.close(true);
      }
    });
  });
}
// estrae le domande di una simulazione seguendo la struttura
function eqDrawExam(key) {
  const qs = eqOfSubj(key);
  const st = eqStructOf(key) || { parts: [{ id: 'all', name: 'Domande', n: eqTypicalCount(key).n }], map: {}, weight: 'freq', recent: true };
  const lastYear = Math.max(0, ...qs.flatMap(x => (x.occ || []).map(o => +eqYear(o) || 0)));
  const w = x => {
    if (st.weight === 'equal') return 1;
    return (x.occ || []).reduce((a, o) => a + (st.recent !== false && lastYear && +eqYear(o) === lastYear ? 2 : 1), 0) || 1;
  };
  const picked = new Set();
  const out = [];
  st.parts.forEach(p => {
    const own = qs.filter(x => st.map[eqCat(x)] === p.id);
    const anyCat = qs.filter(x => !st.map[eqCat(x)] || st.map[eqCat(x)] === 'any');
    // una parte senza categorie sue pesca tra quelle “qualsiasi”
    let pool = (own.length ? own : anyCat).filter(x => !picked.has(x.id));
    if (!pool.length) pool = anyCat.filter(x => !picked.has(x.id));
    for (let k = 0; k < p.n && pool.length; k++) {
      const tot = pool.reduce((a, x) => a + w(x), 0);
      let r = Math.random() * tot;
      const x = pool.find(y => (r -= w(y)) <= 0) || pool[pool.length - 1];
      picked.add(x.id);
      out.push({ x, part: p.name });
      pool = pool.filter(y => y !== x);
    }
  });
  return { st, items: out };
}
function viewExamSim(key, real) {
  if (!key || !eqOfSubj(key).length) { setView('<div class="empty"><p>Nessuna domanda per questa materia.</p><a class="btn primary" href="#/examq">Domande d’esame</a></div>'); return; }
  let exam;
  const make = () => {
    if (real) {
      const all = eqRealExams(key).filter(e => e.items.length > 1);
      if (!all.length) return null;
      const e = all[Math.floor(Math.random() * all.length)];
      return { title: `Appello del ${eqDateIt(e.date)}, raccontato da ${e.src}`, items: e.items.map(i => ({ x: i.x, part: eqCat(i.x), asked: i.text })) };
    }
    const d = eqDrawExam(key);
    return { title: d.st.prof ? `Come ${d.st.prof}` : '', notes: d.st.notes, items: d.items, noStruct: !eqStructOf(key) };
  };
  exam = make();
  if (!exam || !exam.items.length) {
    setView(`<div class="back-row"><a class="back" href="#/examq">Domande d’esame</a></div><div class="empty"><p>${real ? 'Negli appelli raccolti mancano data e studente: servono per ricostruire un esame vero.' : 'Non riesco a comporre un esame con la struttura scelta.'}</p><a class="btn primary" href="#/examq">Torna</a></div>`);
    return;
  }
  const res = {};
  const render = () => {
    const done = exam.items.filter((_, i) => res[i]).length;
    setView(`
      <div class="back-row"><a class="back" href="#/examq">Domande d’esame</a></div>
      <header class="page-head"><div><h1>${real ? 'Un appello vero' : 'Simulazione d’esame'}</h1><p class="lede">${esc(eqSubjLabel(key))}${exam.title ? ` · ${esc(exam.title)}` : ''}</p></div></header>
      ${exam.noStruct ? '<p class="hint warn-hint">Non hai ancora impostato la struttura dell’esame: ho scelto le domande da tutto il programma. Impostala da Domande d’esame → Struttura dell’esame.</p>' : ''}
      ${exam.notes ? `<p class="hint">Note: ${esc(exam.notes)}</p>` : ''}
      <ol class="es-exam">${exam.items.map((it, i) => {
        const vars = eqVariants(it.x);
        const secs = (it.x.secIds || []).map(secById).filter(Boolean);
        return `<li class="es-q ${res[i] ? `r-${res[i]}` : ''}">
          <p class="es-part-l">${esc(it.part || '')}</p>
          <p class="lab-q-t">${esc(it.asked && real ? it.asked : it.x.q)}</p>
          ${real && it.asked && foldAccents(it.asked) !== foldAccents(it.x.q) ? `<p class="hint">Argomento: ${esc(it.x.q)}</p>` : ''}
          <details class="es-more" data-i="${i}"><summary>Traccia e dettagli</summary>
            <p class="hint">${esc(eqMeta(it.x))}</p>
            ${vars.length ? `<p class="hint">Chiesta anche come: ${esc(vars.slice(0, 8).join(' • '))}</p>` : ''}
            ${it.x.a ? `<div class="notes">${renderMd(it.x.a)}</div>` : ''}
            ${secs.length ? `<p class="hint">Da ripassare: ${secs.map(s => `<a href="#/sec/${s.id}/read">${esc(s.title)}</a>`).join(', ')}</p>` : ''}
          </details>
          <div class="inline es-grade">${res[i] ? `<span class="pill ${res[i] === 'ok' ? 'soft' : 'due'}">${res[i] === 'ok' ? 'La sapevo' : 'Non la sapevo'}</span>` : `<button class="btn sm" type="button" data-esg="ko:${i}">Non la sapevo</button><button class="btn sm primary" type="button" data-esg="ok:${i}">La sapevo</button>`}</div>
        </li>`;
      }).join('')}</ol>
      ${done === exam.items.length ? `<p class="lab-q-t">Risultato: ne sapevi ${exam.items.filter((_, i) => res[i] === 'ok').length} su ${exam.items.length}.</p>` : ''}
      <div class="inline"><button class="btn primary" type="button" data-act="es-oral">Fai questo esame a voce</button><button class="btn" type="button" data-act="es-again">${real ? 'Un altro appello' : 'Nuova simulazione'}</button><a class="btn ghost" href="#/examq/${real ? 'sim' : 'real'}/${encodeURIComponent(key)}">${real ? 'Simulazione con la struttura' : 'Un appello vero'}</a></div>`);
    on('[data-act="es-again"]', 'click', () => { exam = make(); Object.keys(res).forEach(k => delete res[k]); render(); });
    on('[data-act="es-oral"]', 'click', () => { vivaState.pendingExam = { key, real, title: exam.title, items: exam.items }; vivaState.s = null; go(`#/viva/exam/${encodeURIComponent(key)}`); });
    on('[data-esg]', 'click', async e => {
      const [v, i] = e.currentTarget.dataset.esg.split(':');
      res[i] = v;
      const x = exam.items[+i].x;
      x.stats = { ok: (x.stats?.ok || 0) + (v === 'ok' ? 1 : 0), ko: (x.stats?.ko || 0) + (v === 'ko' ? 1 : 0), last: todayStr() };
      await saveLink(x);
      render();
    });
  };
  render();
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
    const vars = eqVariants(x);
    $('#eqz').innerHTML = `
      <div class="lab-q">
        <p class="hint">${i + 1} di ${list.length} · ${esc(eqSubject(x))}${eqCat(x) !== 'Senza categoria' ? ` · ${esc(eqCat(x))}` : ''} · ${esc(eqMeta(x))}</p>
        <p class="lab-q-t">${esc(x.q)}</p>
        ${shown ? `${vars.length ? `<p class="hint">Chiesta anche come: ${esc(vars.slice(0, 8).join(' • '))}</p>` : ''}
          <div class="lab-q-a notes">${x.a ? renderMd(x.a) : '<p class="hint">Nessuna traccia di risposta: aggiungila dalla scheda della domanda, oppure apri l’argomento.</p>'}</div>
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
/* =====================================================================
   v3.85: Preparazione all’esame
   La data dell’esame (record { kind: 'examprep', subjKey, date }) e, per ogni
   argomento della banca delle domande, una priorità: quanto esce (più peso
   all’ultimo anno) per quanto sei indietro (sezione mai studiata, ripasso in
   ritardo, voti dell’interrogazione, “non la sapevo”, flashcard non fatte).
   ===================================================================== */
const eqPrepOf = key => state.links.find(l => l.kind === 'examprep' && l.subjKey === key) || null;
const EQ_STOP = new Set('della delle dello degli dalla dalle dallo dagli nella nelle nello negli sulla sulle sullo sugli alla alle allo agli come cosa sono essere loro anche quale quali quando dove perché perche tra fra con per dei del gli una uno sua suo suoi sue questo questa questi queste quello quella parli parlare descriva descrivere spieghi spiegare tipo tipi generale generali principali'.split(' '));
const eqStems = t => [...new Set(foldAccents(t).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 4 && !EQ_STOP.has(w)).map(w => w.slice(0, 6)))];
// le sezioni che parlano di un argomento: quelle collegate, altrimenti le più simili per titolo e titoletti
function eqGuessSecs(x, max = 2) {
  const linked = (x.secIds || []).map(secById).filter(Boolean);
  if (linked.length) return { secs: linked, guessed: false };
  if (!x.notebookId) return { secs: [], guessed: true };
  const main = eqStems(x.q);
  const extra = eqStems(`${eqVariants(x).join(' ')}`).filter(s => !main.includes(s));
  if (!main.length && !extra.length) return { secs: [], guessed: true };
  // conta quanta parte del titolo della sezione compare nell’argomento (un titolo corto e preciso vince)
  const all = new Set([...main, ...extra]);
  const scored = secsOf(x.notebookId).map(s => {
    const title = eqStems(s.title);
    if (!title.length) return { s, sc: 0 };
    const hitMain = title.filter(t => main.includes(t)).length;
    const hitAll = title.filter(t => all.has(t)).length;
    const cover = (hitMain + (hitAll - hitMain) * 0.5) / title.length;
    return { s, sc: hitMain ? cover + hitMain * 0.05 : 0, ok: hitMain && (cover >= 0.6 || hitMain >= 3) };
  }).filter(o => o.ok).sort((a, b) => b.sc - a.sc);
  return { secs: scored.slice(0, max).map(o => o.s), guessed: true };
}
// peso di un argomento: le volte che è uscito, con l’ultimo anno che conta il doppio
function eqWeightFn(key) {
  const qs = eqOfSubj(key);
  const st = eqStructOf(key);
  const lastYear = Math.max(0, ...qs.flatMap(x => (x.occ || []).map(o => +eqYear(o) || 0)));
  return x => (x.occ || []).reduce((a, o) => a + (st?.recent !== false && lastYear && +eqYear(o) === lastYear ? 2 : 1), 0) || 1;
}
// quanto sei pronta su un argomento (0–1) e perché
function eqReadiness(x, secs) {
  const why = [];
  let r = 0.15, known = false;
  const today = todayStr();
  secs.forEach(s => {
    const hist = s.srs?.history || [];
    if (s.studyhub || hist.length) {
      known = true;
      let v = 0.5;
      const last = hist[hist.length - 1];
      if (last) { v += last.q >= 4 ? 0.2 : last.q < 3 ? -0.2 : 0; }
      if (!s.studyhub && s.srs?.due && s.srs.due < today) { v -= 0.15; why.push({ t: `ripasso in ritardo (${s.title})`, bad: true }); }
      const vh = s.vivaHist || [];
      const lv = vh[vh.length - 1];
      if (lv) { v += lv.v >= 24 ? 0.2 : lv.v < 18 ? -0.2 : 0.05; why.push({ t: `all’interrogazione ${lv.v}/30`, bad: lv.v < 18 }); }
      const cards = cardsOfSection(s.id);
      if (cards.length) {
        const fresh = cards.filter(c => !c.srs || c.srs.state === 'new').length;
        if (fresh / cards.length > 0.5) { v -= 0.1; why.push({ t: `${fresh} flashcard mai fatte`, bad: true }); }
      }
      r = Math.max(r, Math.min(1, Math.max(0, v)));
    }
  });
  if (secs.length && !known) why.unshift({ t: 'mai studiata', bad: true });
  if (!secs.length) why.unshift({ t: 'nessuna sezione collegata', bad: true });
  const ok = x.stats?.ok || 0, ko = x.stats?.ko || 0;
  if (ok + ko) {
    const ratio = ok / (ok + ko);
    r = known ? r * 0.6 + ratio * 0.4 : Math.max(r, ratio * 0.6);
    why.push({ t: ko > ok ? `la sbagli (✓${ok} ✗${ko})` : `la sai (✓${ok} ✗${ko})`, bad: ko > ok });
  }
  return { r: Math.max(0, Math.min(1, r)), why, known: known || ok + ko > 0 };
}
function eqPriorities(key) {
  const st = eqStructOf(key);
  const w = eqWeightFn(key);
  const qs = eqOfSubj(key).filter(x => !st || st.map?.[eqCat(x)] !== 'off');
  const maxW = Math.max(1, ...qs.map(w));
  return qs.map(x => {
    const g = eqGuessSecs(x);
    const rd = eqReadiness(x, g.secs);
    const imp = w(x) / maxW;
    return { x, secs: g.secs, guessed: g.guessed, ...rd, imp, p: imp * (1 - rd.r) };
  }).sort((a, b) => b.p - a.p || eqFreq(b.x) - eqFreq(a.x));
}
function viewExamPrep(key) {
  if (!key || !eqOfSubj(key).length) { setView('<div class="empty"><p>Nessuna domanda per questa materia.</p><a class="btn primary" href="#/examq">Domande d’esame</a></div>'); return; }
  const prep = eqPrepOf(key);
  const date = prep?.date || '';
  const days = date ? dayDiff(todayStr(), date) : null;
  const list = eqPriorities(key);
  const ready = list.filter(o => o.r >= 0.7).length;
  const never = list.filter(o => !o.known && o.secs.length).length;
  const nosec = list.filter(o => !o.known && !o.secs.length).length;
  const todo = list.length - ready;
  const perDay = days && days > 0 ? Math.ceil(todo / Math.max(1, days - Math.min(3, Math.floor(days / 5)))) : 0;
  const lvl = o => (o.r >= 0.7 ? 'ok' : o.r >= 0.4 ? 'mid' : 'ko');
  let showAll = false;
  const render = () => {
    const shown = showAll ? list : list.slice(0, 40);
    setView(`
      <div class="back-row"><a class="back" href="#/examq">Domande d’esame</a></div>
      <header class="page-head"><div><h1>Preparazione all’esame</h1><p class="lede">${esc(eqSubjLabel(key))}: gli argomenti che escono di più, a partire da quelli su cui sei più indietro.</p></div>
        <div class="inline"><a class="btn primary" href="#/viva/exam/${encodeURIComponent(key)}">Esame orale</a></div></header>
      <div class="prep-top">
        <div class="prep-count ${days === null ? '' : days < 0 ? 'past' : days <= 7 ? 'near' : ''}">
          ${days === null ? '<b>?</b><span>Quando hai l’esame?</span>' : days < 0 ? `<b>✓</b><span>Esame del ${eqDateIt(date)} passato</span>` : days === 0 ? '<b>Oggi</b><span>In bocca al lupo!</span>' : `<b>${days}</b><span>${days === 1 ? 'giorno' : 'giorni'} all’esame del ${eqDateIt(date)}</span>`}
          <label class="field prep-date"><span>Data dell’esame</span><input class="input" type="date" id="prepDate" value="${esc(date)}"></label>
        </div>
        <ul class="prep-stats">
          <li><b>${ready}</b> ${ready === 1 ? 'argomento pronto' : 'argomenti pronti'}</li>
          <li><b>${todo - never - nosec}</b> da rivedere</li>
          <li><b>${never}</b> ${never === 1 ? 'mai studiato' : 'mai studiati'}</li>
          ${nosec ? `<li><b>${nosec}</b> senza una sezione collegata (tocca ✎ per collegarla)</li>` : ''}
          ${perDay ? `<li class="prep-plan">Per arrivarci con qualche giorno di margine: circa <b>${perDay}</b> ${perDay === 1 ? 'argomento' : 'argomenti'} al giorno, in quest’ordine.</li>` : ''}
        </ul>
      </div>
      <p class="hint">La priorità mette insieme quanto esce un argomento (gli appelli dell’ultimo anno contano il doppio) e quanto sei indietro: sezione mai studiata, ripasso in ritardo, voti dell’interrogazione, domande segnate “non la sapevo”, flashcard mai fatte. Le sezioni segnate “trovata dal titolo” le ho abbinate io: se sbaglio, tocca ✎ e collega quella giusta.</p>
      <ol class="prep-list">${shown.map(o => `
        <li class="prep-row lv-${lvl(o)}">
          <span class="prep-bar" title="Pronta al ${Math.round(o.r * 100)}%"><i style="height:${Math.max(6, Math.round(o.r * 100))}%"></i></span>
          <div class="prep-main">
            <p class="prep-q"><span class="eq-n" title="Volte che è uscita">${eqFreq(o.x)}×</span> ${esc(o.x.q)}</p>
            <p class="prep-why">${eqCat(o.x) !== 'Senza categoria' ? `<span class="muted-inline">${esc(eqCat(o.x))}</span> ` : ''}${o.why.map(w => `<span class="chip ${w.bad ? 'bad' : 'good'}">${esc(w.t)}</span>`).join(' ')}</p>
            ${o.secs.length ? `<p class="prep-secs">${o.secs.map(s => `<a href="#/sec/${s.id}/read">${esc(s.title)}</a>`).join(', ')}${o.guessed ? ' <small class="muted-inline">(trovata dal titolo)</small>' : ''}</p>` : ''}
          </div>
          <div class="prep-acts">
            <a class="btn sm" href="#/viva/examq/${o.x.id}" title="Il professore ti fa questa domanda">Interrogami</a>
            <button class="btn sm ghost" type="button" data-prep-edit="${o.x.id}" aria-label="Modifica la domanda e le sezioni collegate">✎</button>
          </div>
        </li>`).join('')}</ol>
      ${!showAll && list.length > 40 ? `<button class="btn ghost" type="button" data-act="prep-all">Mostra tutti (${list.length})</button>` : ''}`);
    $('#prepDate').addEventListener('change', async e => {
      const v = e.target.value;
      const rec = eqPrepOf(key) || { id: uid(), kind: 'examprep', notebookId: '_examprep', subjKey: key, created: Date.now() };
      rec.date = v;
      await saveLink(rec);
      route();
    });
    on('[data-act="prep-all"]', 'click', () => { showAll = true; render(); });
    $('.prep-list')?.addEventListener('click', async e => {
      const b = e.target.closest('[data-prep-edit]');
      if (!b) return;
      const x = examQs().find(r => r.id === b.dataset.prepEdit);
      if (x && await eqSheet(x)) route();
    });
  };
  render();
}
// in cima alla pagina del notebook: quanto manca all’esame
function eqPrepBanner(nbId) {
  const p = eqPrepOf(nbId);
  if (!p || !p.date || !eqOfSubj(nbId).length) return '';
  const d = dayDiff(todayStr(), p.date);
  if (d < 0 || d > 60) return '';
  return `<a class="prep-banner" href="#/examq/prep/${encodeURIComponent(nbId)}"><b>${d === 0 ? 'Esame oggi' : `${d} ${d === 1 ? 'giorno' : 'giorni'} all’esame`}</b><span>Preparazione: cosa ripassare prima</span></a>`;
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

/* =====================================================================
   v3.61: Interrogazione con l’AI
   Un professore fa una domanda dagli appunti, ascolta la risposta (a voce o
   scritta), dà un voto indicativo e fa una domanda di approfondimento.
   Pensata per chi tentenna: misura quanto ci metti a partire, le pause lunghe
   e gli intercalari, e su richiesta mostra la traccia per partire.
   ===================================================================== */
const VIVA_FILLERS = /\b(e+h*m+|e+hh+|mm+h*|cioè|cioe|praticamente|diciamo|tipo|insomma|niente|allora|ecco|vabbè|cosa)\b/gi;
const vivaJson = t => { const m = String(t || '').match(/\{[\s\S]*\}/); if (!m) throw new Error('Risposta dell’AI non leggibile: riprova'); return JSON.parse(m[0]); };
const VIVA_SYS_Q = `Sei un professore universitario di medicina che interroga uno studente a un esame orale in Italia.
Ti do gli APPUNTI dello studente su un argomento. Fai UNA sola domanda aperta d’esame, come la faresti all’inizio dell’interrogazione: chiara, breve (una frase), su un punto importante degli appunti. Evita le domande già fatte che ti elenco.
Prepara anche una “traccia”: da 4 a 6 voci brevissime (2-5 parole) che una buona risposta dovrebbe toccare, in ordine logico, SENZA dare le risposte (per esempio “definizione”, “meccanismo patogenetico”, “quadro clinico”, “diagnosi”, “terapia di prima linea”).
Rispondi SOLO con JSON valido, senza altro testo: {"domanda": "...", "traccia": ["...", "..."]}`;
const VIVA_SYS_E = `Sei un professore universitario di medicina, giusto ma esigente, a un esame orale in Italia.
Ti do gli APPUNTI dello studente, la DOMANDA e la RISPOSTA dello studente, trascritta in automatico dalla voce (ignora parole storpiate, punteggiatura mancante e ripetizioni se il senso è chiaro).
Valuta solo il contenuto rispetto agli appunti e alle conoscenze mediche corrette, non lo stile.
Rispondi SOLO con JSON valido, senza altro testo:
{"voto": numero da 0 a 30 (18 è la sufficienza), "giudizio": "una frase, come la direbbe il professore", "bene": ["punti detti correttamente"], "mancava": ["punti importanti non detti"], "errori": ["affermazioni sbagliate o imprecise, con la correzione"], "approfondimento": "una domanda di approfondimento sullo stesso argomento, su un punto debole o per andare più a fondo; stringa vuota se ti chiedo di non farne", "modello": "una risposta modello di 4-7 frasi, scorrevole, come la direbbe uno studente preparato all’orale, con un ordine chiaro"}
Liste brevi (al massimo 5 voci ciascuna), in italiano.`;

// v3.62: con Gemini la risposta si registra e Gemini la trascrive (con i termini degli
// appunti) e la valuta nella stessa richiesta; inizio e pause si misurano dal suono
const VIVA_AUDIO_NOTE = `
Oltre al testo ti do l’AUDIO della risposta dello studente, in italiano. Prima trascrivilo fedelmente nel campo "trascrizione": in italiano, scrivendo correttamente i termini medici e anatomici (aiutati con l’elenco TERMINI DEGLI APPUNTI), comprese le esitazioni come “ehm” se ci sono. Poi valuta il contenuto della trascrizione. Nel JSON aggiungi quindi il campo "trascrizione".`;
const VoiceCapture = {
  async start(onLevel) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const st = { stream, ctx, src, proc, chunks: [], rate: ctx.sampleRate, first: 0, lastVoice: 0, pauses: 0, floor: 1, n: 0 };
    proc.onaudioprocess = e => {
      const d = e.inputBuffer.getChannelData(0);
      st.chunks.push(new Float32Array(d));
      let sum = 0;
      for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      const rms = Math.sqrt(sum / d.length);
      st.n++;
      // il primo mezzo secondo dà il rumore di fondo; voce = ben sopra quel livello
      if (st.n <= 5) st.floor = Math.min(st.floor, rms || 1);
      const thr = Math.max(0.012, st.floor * 3);
      const now = Date.now();
      if (st.n > 3 && rms > thr) {
        if (!st.first) st.first = now;
        else if (st.lastVoice && now - st.lastVoice > 3000) st.pauses++;
        st.lastVoice = now;
      }
      if (onLevel) onLevel(Math.min(1, rms / Math.max(thr * 4, 0.05)), rms > thr);
    };
    src.connect(proc);
    proc.connect(ctx.destination);
    return st;
  },
  async stop(st) {
    try { st.proc.disconnect(); st.src.disconnect(); } catch { /* già scollegato */ }
    st.stream.getTracks().forEach(t => t.stop());
    try { await st.ctx.close(); } catch { /* già chiuso */ }
    // WAV a 16 kHz, un canale: basta per la voce e Gemini lo legge sempre
    const total = st.chunks.reduce((a, c) => a + c.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    st.chunks.forEach(c => { all.set(c, o); o += c.length; });
    const ratio = st.rate / 16000;
    const len = Math.floor(total / ratio);
    const buf = new ArrayBuffer(44 + len * 2);
    const v = new DataView(buf);
    const w = (p, s) => [...s].forEach((ch, i) => v.setUint8(p + i, ch.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, len * 2, true);
    for (let i = 0; i < len; i++) {
      const a = Math.floor(i * ratio), b = Math.min(total, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let k = a; k < b; k++) sum += all[k];
      v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sum / Math.max(1, b - a))) * 0x7fff, true);
    }
    const data = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(new Blob([buf], { type: 'audio/wav' })); });
    return { data, seconds: len / 16000 };
  }
};
const vivaState = { setup: { n: 3, follow: 1, voice: true, asr: '' }, s: null };
function vivaScope(kind, id) {
  if (kind === 'sec') { const s = secById(id); return s ? { title: s.title, secs: [s] } : null; }
  if (kind === 'grp') {
    for (const nb of state.notebooks) {
      const g = groupsOf(nb).find(x => x.id === id);
      if (g) { const tree = groupTreeIds(nb, g); return { title: g.name, secs: secsOf(nb.id).filter(s => tree.has(s.groupId)) }; }
    }
    return null;
  }
  if (kind === 'nb') { const nb = nbById(id); return nb ? { title: nb.name, secs: secsOf(nb.id) } : null; }
  // v3.85: esame orale con le domande vere (una materia intera o una sola domanda)
  if (kind === 'exam') { const key = decodeURIComponent(id || ''); return eqOfSubj(key).length ? { title: eqSubjLabel(key), exam: true, key } : null; }
  if (kind === 'examq') { const x = examQs().find(r => r.id === id); return x ? { title: eqSubjLabel(eqSubjKey(x)), exam: true, key: eqSubjKey(x), one: x } : null; }
  return null;
}
function viewViva(kind, id) {
  const st = vivaState;
  if (!kind) return vivaPicker();
  const sc = vivaScope(kind, id);
  if (!sc) return notFound('Questo argomento');
  const usable = (sc.secs || []).filter(s => aiText(s.md || '').length > 150);
  if (!st.s || st.s.key !== `${kind}/${id}`) st.s = null;
  if (!AI.ready()) {
    setView(`<header class="page-head"><div><h1>Interrogazione</h1><p class="lede">${esc(sc.title)}</p></div></header>
      <div class="empty"><p>L’interrogazione usa l’AI (Gemini o Claude) per fare le domande e valutare le risposte. Aggiungi la chiave in Impostazioni → Intelligenza artificiale: con Gemini è gratuita.</p><a class="btn primary" href="#/settings">Vai alle impostazioni</a></div>`);
    return;
  }
  if (sc.exam) { if (!st.s) return vivaSetupExam(kind, id, sc); vivaRender(); return; }
  if (!usable.length) {
    setView(`<header class="page-head"><div><h1>Interrogazione</h1><p class="lede">${esc(sc.title)}</p></div></header><div class="empty"><p>Qui non ci sono ancora appunti abbastanza lunghi da cui fare domande.</p></div>`);
    return;
  }
  if (!st.s) return vivaSetup(kind, id, sc, usable);
  vivaRender();
}
function vivaPicker() {
  const nbs = state.notebooks.filter(n => !n.kind && secsOf(n.id).length);
  setView(`
    <header class="page-head"><div><h1>Interrogazione</h1><p class="lede">Un professore (l’AI) ti fa domande dai tuoi appunti, ascolta la risposta a voce, ti dà un voto indicativo e fa l’approfondimento, come all’orale.</p></div></header>
    ${nbs.length ? `<ul class="list">${nbs.map(nb => `<li><a class="row" href="#/viva/nb/${nb.id}"><span class="row-main"><span class="row-title">${esc(nb.name)}</span><span class="row-sub">${secsOf(nb.id).length} sezioni${topGroups(nb).length ? ` · ${topGroups(nb).length} cartelle: puoi anche scegliere una cartella o una sezione dalla sua pagina (pulsante Interrogami)` : ''}</span></span></a></li>`).join('')}</ul>` : '<div class="empty"><p>Crea prima un notebook con degli appunti.</p></div>'}`);
}
function vivaSetup(kind, id, sc, usable) {
  const su = vivaState.setup;
  setView(`
    <header class="page-head"><div><h1>Interrogazione</h1><p class="lede">${esc(sc.title)} · ${usable.length} ${usable.length === 1 ? 'sezione' : 'sezioni'} da cui fare domande</p></div></header>
    <div class="viva-card">
      <p>Il professore ti fa una domanda presa dai tuoi appunti${su.voice ? ' e la legge ad alta voce' : ''}. Rispondi a voce (o scrivendo), poi tocca <b>Ho finito</b>: ricevi un voto indicativo, cosa mancava e una risposta modello, e poi una domanda di approfondimento.</p>
      <p class="hint">Se tendi a bloccarti: parti sempre da una frase sicura (“La … è …”), poi segui un ordine fisso (definizione, cause, meccanismo, clinica, diagnosi, terapia). Se non ti viene niente, “Aiutami a partire” mostra la traccia dei punti da toccare.</p>
      <div class="grid2">
        <label class="field"><span>Domande principali</span><select class="input" id="vvN">${[1, 2, 3, 5, 8].map(n => `<option ${su.n === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field"><span>Approfondimenti per domanda</span><select class="input" id="vvF">${[0, 1, 2].map(n => `<option ${su.follow === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <label class="check"><input type="checkbox" id="vvVoice" ${su.voice ? 'checked' : ''}><span>Leggi le domande ad alta voce</span></label>
      ${S().geminiKey.trim() ? `<label class="field"><span>Riconoscimento della voce (in italiano)</span><select class="input" id="vvAsr">
        <option value="gemini" ${(su.asr || 'gemini') === 'gemini' ? 'selected' : ''}>Gemini: più preciso con i termini medici (la risposta si legge dopo)</option>
        ${SpeechRec ? `<option value="chrome" ${su.asr === 'chrome' ? 'selected' : ''}>Chrome: la risposta si scrive mentre parli</option>` : ''}
      </select></label>` : ''}
      ${SpeechRec ? '' : '<p class="hint warn-hint">Questo browser non trascrive la voce: risponderai scrivendo. Con Chrome sul tablet o sul telefono puoi rispondere a voce.</p>'}
      <div class="actions"><button class="btn primary big" type="button" data-act="vv-start">Inizia l’interrogazione</button></div>
    </div>`);
  on('[data-act="vv-start"]', 'click', () => {
    su.n = +$('#vvN').value; su.follow = +$('#vvF').value; su.voice = $('#vvVoice').checked;
    su.asr = $('#vvAsr') ? $('#vvAsr').value : 'chrome';
    vivaState.s = { key: `${kind}/${id}`, title: sc.title, pool: shuffle(usable.map(s => s.id)), asked: [], items: [], qi: 0, phase: 'ask', cur: null };
    vivaNext();
  });
}
/* ---------- v3.85: esame orale con le domande vere ---------- */
const VIVA_SYS_EXQ = `Sei il professore universitario di medicina che interroga all’esame orale, in Italia. Ti do le domande estratte per questo esame: per ciascuna l’argomento, la parte del programma e come l’hanno raccontata gli studenti dopo gli appelli veri.
Per ciascuna, nello stesso ordine, formula la domanda come la faresti tu all’orale: una frase sola, naturale e diretta (per esempio “Mi parli della…”, “Come è organizzata…”), fedele all’argomento e al modo in cui è stata chiesta davvero, senza aggiungere argomenti diversi.
Prepara anche una “traccia”: da 4 a 6 voci brevissime (2-5 parole) che una buona risposta dovrebbe toccare, in ordine logico, SENZA dare le risposte.
Rispondi SOLO con JSON valido, senza altro testo: {"domande": [{"domanda": "...", "traccia": ["...", "..."]}]}`;
// gli appunti su cui il professore valuta: le sezioni collegate (o trovate dal titolo) e la traccia salvata
function eqCtx(x) {
  const g = eqGuessSecs(x, 2);
  let md = g.secs.map(s => `## ${s.title}\n${s.md || ''}`).join('\n\n');
  if (x.a) md += `\n\n## Traccia di risposta salvata\n${x.a}`;
  return { title: g.secs[0]?.title || '', md, secIds: g.secs.map(s => s.id) };
}
function vivaCtx(c) {
  if (c.ctx) return c.ctx;
  const sec = secById(c.secId);
  return { title: sec ? sec.title : '', md: sec ? sec.md : '', secIds: sec ? [sec.id] : [] };
}
const vivaTotal = s => (s.exam ? s.exam.items.length : vivaState.setup.n);
const eqDefaultAsk = it => it.asked || `Mi parli di questo argomento: ${it.x.q}`;
function vivaSetupExam(kind, id, sc) {
  const su = vivaState.setup;
  const key = sc.key;
  const st = eqStructOf(key);
  const pend = vivaState.pendingExam && vivaState.pendingExam.key === key && !sc.one ? vivaState.pendingExam : null;
  const reals = eqRealExams(key).filter(e => e.items.length > 1);
  const typ = eqTypicalCount(key);
  const nStruct = st ? st.parts.reduce((a, p) => a + p.n, 0) : typ.n;
  setView(`
    <div class="back-row"><a class="back" href="${sc.one ? `#/examq/prep/${encodeURIComponent(key)}` : '#/examq'}">${sc.one ? 'Preparazione all’esame' : 'Domande d’esame'}</a></div>
    <header class="page-head"><div><h1>Esame orale</h1><p class="lede">${esc(sc.title)}${st?.prof ? ` · come ${esc(st.prof)}` : ''}</p></div></header>
    <div class="viva-card">
      <p>${sc.one ? `Il professore ti fa questa domanda d’esame: <b>${esc(sc.one.q)}</b>.` : 'Il professore ti fa le domande uscite davvero agli appelli, come all’esame.'} Rispondi a voce, poi tocca <b>Ho finito</b>: voto indicativo, cosa mancava, risposta modello e, se vuoi, l’approfondimento. Alla fine hai il voto dell’esame e cosa ripassare.</p>
      <p class="hint">Valuta sui tuoi appunti: le sezioni collegate alla domanda o, se non ne ha, quelle con il titolo più simile. Senza appunti, sulle conoscenze mediche standard.</p>
      ${sc.one ? '' : pend ? `<p class="hint"><b>${pend.items.length} domande</b>: quelle della ${pend.real ? 'simulazione dall’appello vero' : 'simulazione'} che avevi aperto.</p>` : `
        <div class="field"><span class="lbl">Domande</span>
          <label class="check"><input type="radio" name="vxSrc" value="struct" checked><span>${st ? `Con la struttura dell’esame: ${st.parts.map(p => `${esc(p.name)} (${p.n})`).join(', ')}` : `Da tutto il programma, ${nStruct} come negli esami raccolti (puoi impostare la struttura da Domande d’esame)`}</span></label>
          ${reals.length ? `<label class="check"><input type="radio" name="vxSrc" value="real"><span>Un appello vero, con le domande fatte a uno studente (${reals.length} raccolti)</span></label>` : ''}
        </div>`}
      <div class="grid2">
        <label class="field"><span>Approfondimenti per domanda</span><select class="input" id="vvF">${[0, 1, 2].map(n => `<option ${su.follow === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <label class="check"><input type="checkbox" id="vvVoice" ${su.voice ? 'checked' : ''}><span>Leggi le domande ad alta voce</span></label>
      ${S().geminiKey.trim() ? `<label class="field"><span>Riconoscimento della voce (in italiano)</span><select class="input" id="vvAsr">
        <option value="gemini" ${(su.asr || 'gemini') === 'gemini' ? 'selected' : ''}>Gemini: più preciso con i termini medici (la risposta si legge dopo)</option>
        ${SpeechRec ? `<option value="chrome" ${su.asr === 'chrome' ? 'selected' : ''}>Chrome: la risposta si scrive mentre parli</option>` : ''}
      </select></label>` : ''}
      ${SpeechRec ? '' : '<p class="hint warn-hint">Questo browser non trascrive la voce: risponderai scrivendo. Con Chrome sul tablet o sul telefono puoi rispondere a voce.</p>'}
      <div class="actions"><button class="btn primary big" type="button" data-act="vx-start">Inizia l’esame</button></div>
    </div>`);
  on('[data-act="vx-start"]', 'click', () => {
    su.follow = +$('#vvF').value; su.voice = $('#vvVoice').checked;
    su.asr = $('#vvAsr') ? $('#vvAsr').value : 'chrome';
    let items, real = false, title = '';
    if (sc.one) items = [{ x: sc.one, part: eqCat(sc.one) !== 'Senza categoria' ? eqCat(sc.one) : '' }];
    else if (pend) { items = pend.items; real = pend.real; title = pend.title; }
    else if ($('input[name="vxSrc"]:checked')?.value === 'real' && reals.length) {
      const e = reals[Math.floor(Math.random() * reals.length)];
      real = true; title = `Appello del ${eqDateIt(e.date)}, raccontato da ${e.src}`;
      items = e.items.map(i => ({ x: i.x, part: eqCat(i.x) !== 'Senza categoria' ? eqCat(i.x) : '', asked: i.text }));
    } else items = eqDrawExam(key).items;
    if (!items.length) { toast('Non riesco a comporre un esame con queste domande'); return; }
    // senza struttura la “parte” è la macro-categoria della domanda
    const catOf = x => (eqCat(x) !== 'Senza categoria' ? eqCat(x) : '');
    items = items.map(it => ({ ...it, part: !st || !it.part || it.part === 'Domande' ? catOf(it.x) : it.part }));
    vivaState.pendingExam = null;
    vivaState.s = { key: `${kind}/${id}`, title: sc.one ? sc.one.q : `${sc.title}${title ? ` · ${title}` : ''}`, exam: { key, items, real, prof: st?.prof || '', notes: st?.notes || '', label: sc.title, one: !!sc.one }, pool: [], asked: [], items: [], qi: 0, phase: 'ask', cur: null };
    vivaNext();
  });
}
async function vivaExamQuestions(ex) {
  try {
    const text = `MATERIA: ${ex.label}${ex.prof ? ` (docente: ${ex.prof})` : ''}${ex.notes ? `\nNOTE SULL’ESAME: ${ex.notes}` : ''}\n\nDOMANDE:\n${ex.items.map((it, i) => {
      const vars = eqVariants(it.x).filter(v => foldAccents(v) !== foldAccents(it.x.q)).slice(0, 4);
      return `${i + 1}. Argomento: ${it.x.q}${it.part ? ` · Parte: ${it.part}` : ''}${vars.length ? ` · Raccontata come: ${vars.join(' | ')}` : ''}${it.asked ? ` · Questa volta chiesta così: ${it.asked}` : ''}`;
    }).join('\n')}`;
    const r = await AI.generate({ system: VIVA_SYS_EXQ, text, maxTokens: 2500 });
    const j = vivaJson(r.text);
    return Array.isArray(j.domande) ? j.domande : [];
  } catch (err) {
    if (/offline/i.test(err.message || '')) throw err;
    return [];
  }
}
async function vivaNext(follow = null) {
  const s = vivaState.s;
  if (!s) return;
  if (!follow && s.items.length >= vivaTotal(s)) { s.phase = 'end'; vivaRender(); return; }
  s.phase = 'loading';
  vivaRender();
  try {
    if (follow) {
      s.cur = { secId: follow.secId, ctx: follow.ctx, eqId: follow.eqId, part: follow.part, q: follow.q, traccia: [], follow: follow.depth, parent: follow.parent, t0: 0, tFirst: 0, last: 0, pauses: 0, text: '' };
    } else if (s.exam) {
      const idx = s.items.length;
      const it = s.exam.items[idx];
      if (!s.exam.qs) s.exam.qs = await vivaExamQuestions(s.exam);
      const g = s.exam.qs[idx] || {};
      const ctx = eqCtx(it.x);
      s.cur = { secId: ctx.secIds[0] || null, ctx, eqId: it.x.id, part: it.part || '', q: String(g.domanda || eqDefaultAsk(it)).trim(), traccia: (g.traccia || []).map(String).slice(0, 6), follow: 0, t0: 0, tFirst: 0, last: 0, pauses: 0, text: '' };
    } else {
      const secId = s.pool[s.items.length % s.pool.length];
      const sec = secById(secId);
      const r = await AI.generate({ system: VIVA_SYS_Q, text: `APPUNTI (sezione “${sec.title}”):\n${aiText(sec.md).slice(0, 14000)}\n\nDOMANDE GIÀ FATTE:\n${s.asked.map(q => `- ${q}`).join('\n') || '(nessuna)'}`, maxTokens: 1500 });
      const j = vivaJson(r.text);
      s.cur = { secId, q: String(j.domanda || '').trim(), traccia: (j.traccia || []).map(String).slice(0, 6), follow: 0, t0: 0, tFirst: 0, last: 0, pauses: 0, text: '' };
    }
    s.asked.push(s.cur.q);
    s.phase = 'ask';
    vivaRender();
    if (vivaState.setup.voice) speak(s.cur.q);
  } catch (err) {
    s.phase = 'error';
    s.err = err.message || String(err);
    vivaRender();
  }
}
function vivaRender() {
  // il contatore dei secondi vale solo per la schermata della domanda
  clearInterval(vivaState.tick);
  if (vivaState.dict) { try { vivaState.dict.stop(); } catch { /* già fermo */ } vivaState.dict = null; }
  const s = vivaState.s;
  const su = vivaState.setup;
  const head = `<header class="page-head"><div><h1>${s.exam ? 'Esame orale' : 'Interrogazione'}</h1><p class="lede">${esc(s.title)}${vivaTotal(s) > 1 ? ` · domanda ${Math.min(s.items.length + 1, vivaTotal(s))} di ${vivaTotal(s)}` : ''}</p></div>
    <button class="btn ghost" type="button" data-act="vv-stop">Termina</button></header>`;
  if (s.phase === 'loading') { setView(`${head}<div class="viva-card"><p class="viva-wait">Il professore sta pensando alla domanda…</p></div>`); bindStop(); return; }
  if (s.phase === 'error') { setView(`${head}<div class="viva-card"><p class="err-line">${esc(s.err)}</p><div class="actions"><button class="btn primary" type="button" data-act="vv-retry">Riprova</button></div></div>`); bindStop(); on('[data-act="vv-retry"]', 'click', () => vivaNext()); return; }
  if (s.phase === 'end') return vivaSummary();
  const c = s.cur;
  const sec = secById(c.secId);
  const ctx = vivaCtx(c);
  if (s.phase === 'ask') {
    const gem = su.asr === 'gemini' && !!S().geminiKey.trim();
    setView(`${head}
      <div class="viva-card">
        <p class="viva-from">${c.follow ? 'Approfondimento' : 'Domanda'}${c.part || ctx.title ? ` · ${esc(c.part || ctx.title)}` : ''}</p>
        <p class="viva-q">${esc(c.q)}</p>
        <div class="inline viva-qacts">
          ${canSpeak || Voice.useGemini() ? '<button class="btn sm ghost" type="button" data-act="vv-say">Rileggi la domanda</button>' : ''}
          ${c.traccia.length ? '<button class="btn sm ghost" type="button" data-act="vv-help">Aiutami a partire</button>' : ''}
        </div>
        <ol class="viva-trace" hidden>${c.traccia.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
        <div class="viva-meter" aria-live="polite"><span class="vm-t">0:00</span><span class="vm-first"></span><span class="vm-p"></span></div>
        ${gem ? `<button class="btn primary big mic-big" type="button" data-act="vv-rec" aria-pressed="false">${MIC_SVG}<span>${c.audio ? 'Registra di nuovo' : 'Registra la risposta'}</span></button>
          <div class="vv-level" aria-hidden="true"><i></i></div>
          <p class="hint">${c.audio ? `Registrazione pronta (${fmtT(c.audio.seconds)}): tocca “Ho finito”.` : 'Parla come all’esame; quando hai finito tocca di nuovo il pulsante o direttamente “Ho finito”. Gemini trascrive la risposta riconoscendo i termini dei tuoi appunti.'}</p>`
          : SpeechRec ? `<button class="btn primary big mic-big" type="button" data-act="vv-mic" aria-pressed="false">${MIC_SVG}<span>Rispondi a voce</span></button>` : ''}
        <label class="field"><span>${gem ? 'Oppure scrivi la risposta' : SpeechRec ? 'La tua risposta (si scrive da sola mentre parli; puoi correggerla)' : 'La tua risposta'}</span><textarea class="input" id="vvAns" rows="${gem ? 3 : 6}">${esc(c.text)}</textarea></label>
        <p class="viva-interim hint"></p>
        <div class="actions"><button class="btn primary" type="button" data-act="vv-done">Ho finito</button><button class="btn ghost" type="button" data-act="vv-skip">Non lo so</button></div>
      </div>`);
    bindStop();
    const ta = $('#vvAns');
    const meter = () => {
      const now = Date.now();
      if (!c.t0 || !$('.vm-t')) { clearInterval(vivaState.tick); return; }
      $('.vm-t').textContent = fmtT((now - c.t0) / 1000);
      $('.vm-first').textContent = c.tFirst ? `partita dopo ${Math.round((c.tFirst - c.t0) / 1000)} s` : `in attesa… ${Math.round((now - c.t0) / 1000)} s`;
      $('.vm-p').textContent = c.pauses ? `${c.pauses} ${c.pauses === 1 ? 'pausa lunga' : 'pause lunghe'}` : '';
    };
    c.t0 = c.t0 || Date.now();
    vivaState.tick = setInterval(meter, 500);
    addCleanup(() => clearInterval(vivaState.tick));
    const heard = () => {
      const now = Date.now();
      if (!c.tFirst) c.tFirst = now;
      else if (c.last && now - c.last > 3500) c.pauses++;
      c.last = now;
    };
    let dict = null;
    const micBtn = $('[data-act="vv-mic"]');
    if (micBtn) {
      dict = createDictation({
        vocab: vocabFrom(ctx.md || ''),
        onText: t => { heard(); ta.value = `${ta.value.trim()} ${t}`.trim(); c.text = ta.value; },
        onInterim: t => { if (t) heard(); $('.viva-interim').textContent = t; },
        onState: on2 => { micBtn.setAttribute('aria-pressed', String(on2)); $('span', micBtn).textContent = on2 ? 'Sto ascoltando… tocca per fermare' : 'Rispondi a voce'; micBtn.classList.toggle('on', on2); }
      });
      micBtn.addEventListener('click', () => { if (micBtn.getAttribute('aria-pressed') === 'true') dict.stop(); else { if (canSpeak) speechSynthesis.cancel(); dict.start(); } });
      vivaState.dict = dict;
      addCleanup(() => dict && dict.stop());
    }
    ta.addEventListener('input', () => { if (!c.tFirst && ta.value.trim()) c.tFirst = Date.now(); c.text = ta.value; });
    // registrazione per Gemini
    const recBtn = $('[data-act="vv-rec"]');
    const stopRec = async () => {
      const cap = vivaState.cap;
      if (!cap) return;
      vivaState.cap = null;
      clearTimeout(vivaState.capT);
      const a = await VoiceCapture.stop(cap);
      if (cap.first) { c.tFirst = cap.first; c.pauses = cap.pauses; }
      c.tSpeechEnd = cap.lastVoice || Date.now();
      if (a.seconds >= 1) c.audio = { mime: 'audio/wav', data: a.data, seconds: a.seconds };
    };
    if (recBtn) {
      recBtn.addEventListener('click', async () => {
        if (vivaState.cap) { await stopRec(); vivaRender(); return; }
        if (canSpeak) speechSynthesis.cancel();
        try {
          const lv = $('.vv-level i');
          vivaState.cap = await VoiceCapture.start((x, voice) => { if (lv) { lv.style.width = `${Math.round(x * 100)}%`; lv.classList.toggle('on', voice); } });
          c.audio = null;
          c.pauses = 0;
          recBtn.setAttribute('aria-pressed', 'true');
          recBtn.classList.add('on');
          $('span', recBtn).textContent = 'Sto registrando… tocca per fermare';
          // al massimo 5 minuti per risposta
          vivaState.capT = setTimeout(() => { if (vivaState.cap) stopRec().then(vivaRender); }, 300000);
        } catch { toast('Serve il permesso del microfono: consentilo nelle impostazioni del browser', 'err'); }
      });
      addCleanup(() => { if (vivaState.cap) { VoiceCapture.stop(vivaState.cap).catch(() => {}); vivaState.cap = null; } });
    }
    on('[data-act="vv-say"]', 'click', () => speak(c.q));
    on('[data-act="vv-help"]', 'click', e => { $('.viva-trace').hidden = false; c.helped = true; e.currentTarget.remove(); });
    const finish = async skip => {
      if (dict) dict.stop();
      if (vivaState.cap) await stopRec();
      c.text = skip ? '' : ta.value.trim();
      c.tEnd = c.audio && c.tSpeechEnd ? c.tSpeechEnd : Date.now();
      const useAudio = !skip && c.audio && gem && !c.text;
      if (!skip && !c.text && !useAudio) { toast('Rispondi a voce o scrivi la risposta, oppure tocca “Non lo so”'); return; }
      s.phase = 'eval';
      setView(`${head}<div class="viva-card"><p class="viva-wait">Il professore sta valutando la risposta…</p></div>`);
      bindStop();
      try {
        const left = su.follow - (c.follow || 0);
        const terms = useAudio ? [...vocabFrom(ctx.md || '').values()].filter(t => t.length >= 6).slice(0, 250).join(', ') : '';
        const r = await AI.generate({
          ...(useAudio ? { provider: 'gemini', audio: { mime: c.audio.mime, data: c.audio.data } } : {}),
          system: useAudio ? VIVA_SYS_E + VIVA_AUDIO_NOTE : VIVA_SYS_E,
          text: `${s.exam ? `ESAME: ${s.exam.label}${s.exam.prof ? `, docente ${s.exam.prof}` : ''}.${s.exam.notes ? ` Note sull’esame: ${s.exam.notes}` : ''}\n\n` : ''}${ctx.md && aiText(ctx.md).trim() ? `APPUNTI (${s.exam ? 'sezioni' : 'sezione'} “${ctx.title}”):\n${aiText(ctx.md).slice(0, 14000)}` : `APPUNTI: nessun appunto su questo argomento. Valuta con le conoscenze mediche corrette per l’esame universitario di ${s.exam ? s.exam.label : 'medicina'}.`}\n\n${useAudio ? `TERMINI DEGLI APPUNTI: ${terms}\n\n` : ''}DOMANDA: ${c.q}\n\nRISPOSTA DELLO STUDENTE:\n${useAudio ? '(nell’audio allegato)' : c.text || '(lo studente ha detto di non saperlo)'}\n\n${left > 0 ? 'Fai una domanda di approfondimento.' : 'Non fare domande di approfondimento: "approfondimento" deve essere una stringa vuota.'}`,
          maxTokens: 3500
        });
        c.ev = vivaJson(r.text);
        if (useAudio) { c.text = String(c.ev.trascrizione || '').trim(); c.audio = null; }
        c.ev.voto = Math.max(0, Math.min(30, Math.round(+c.ev.voto || 0)));
        c.left = left;
        if (!c.follow) s.items.push(c); else (c.parent.followups = c.parent.followups || []).push(c);
        s.phase = 'result';
        // storico per la sezione: data e voto
        if (sec) { sec.vivaHist = [...(sec.vivaHist || []), { d: todayStr(), v: c.ev.voto }].slice(-30); saveSection(sec); }
        // all’esame orale il voto finisce anche nelle statistiche della domanda (sufficiente = la sapevo)
        if (s.exam && !c.follow && c.eqId) {
          const x = examQs().find(r => r.id === c.eqId);
          if (x) { const okv = c.ev.voto >= 18; x.stats = { ok: (x.stats?.ok || 0) + (okv ? 1 : 0), ko: (x.stats?.ko || 0) + (okv ? 0 : 1), last: todayStr() }; saveLink(x); }
        }
        vivaRender();
      } catch (err) { s.phase = 'ask'; toast(err.message || 'Valutazione non riuscita', 'err'); vivaRender(); }
    };
    on('[data-act="vv-done"]', 'click', () => finish(false));
    on('[data-act="vv-skip"]', 'click', () => finish(true));
    return;
  }
  if (s.phase === 'result') {
    const e = c.ev;
    const fl = vivaFluency(c);
    const list = (t, arr, cls) => (arr && arr.length ? `<div class="viva-l ${cls}"><h3>${t}</h3><ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
    const parent = c.follow ? c.parent : c;
    const canFollow = e.approfondimento && String(e.approfondimento).trim() && c.left > 0;
    setView(`${head}
      <div class="viva-card">
        <p class="viva-from">${c.follow ? 'Approfondimento' : 'Domanda'}</p>
        <p class="viva-q sm">${esc(c.q)}</p>
        <div class="viva-score ${e.voto >= 27 ? 'top' : e.voto >= 18 ? 'ok' : 'ko'}"><b>${e.voto}</b><span>/30 indicativo</span></div>
        <p class="viva-judge">“${esc(e.giudizio || '')}”</p>
        ${c.text ? `<details class="viva-said"><summary>Cosa ha capito il professore della tua risposta</summary><p>${esc(c.text)}</p></details>` : ''}
        ${list('Detto bene', e.bene, 'ok')}${list('Mancava', e.mancava, 'miss')}${list('Da correggere', e.errori, 'err')}
        <div class="viva-l flu"><h3>Come l’hai detto</h3><ul>${fl.map(x => `<li>${x}</li>`).join('')}</ul></div>
        ${e.modello ? `<details class="viva-model"><summary>Risposta modello</summary><p>${esc(e.modello)}</p>${canSpeak || Voice.useGemini() ? '<button class="btn sm ghost" type="button" data-act="vv-model">Ascoltala</button>' : ''}</details>` : ''}
        <div class="actions">
          ${canFollow ? `<button class="btn primary" type="button" data-act="vv-follow">Approfondimento: rispondi</button>` : ''}
          <button class="btn ${canFollow ? '' : 'primary'}" type="button" data-act="vv-next">${s.items.length >= vivaTotal(s) ? 'Vedi il riepilogo' : 'Prossima domanda'}</button>
          ${c.secId ? `<a class="btn ghost" href="#/sec/${c.secId}/read">Apri la sezione</a>` : ''}
        </div>
      </div>`);
    bindStop();
    on('[data-act="vv-model"]', 'click', () => speak(e.modello));
    on('[data-act="vv-follow"]', 'click', () => vivaNext({ secId: c.secId, ctx: c.ctx, eqId: c.eqId, part: c.part, q: String(e.approfondimento).trim(), depth: (c.follow || 0) + 1, parent }));
    on('[data-act="vv-next"]', 'click', () => vivaNext());
  }
}
function bindStop() { on('[data-act="vv-stop"]', 'click', () => { const s = vivaState.s; if (s && s.items.length) { s.phase = 'end'; vivaRender(); } else { vivaState.s = null; history.back(); } }); }
function vivaFluency(c) {
  const out = [];
  const secs = Math.max(1, ((c.tEnd || Date.now()) - (c.t0 || Date.now())) / 1000);
  const words = (c.text.match(/\S+/g) || []).length;
  const start = c.tFirst ? Math.round((c.tFirst - c.t0) / 1000) : null;
  const fillers = (c.text.match(VIVA_FILLERS) || []).length;
  if (!c.text) { out.push('Hai detto di non saperlo: all’esame prova comunque a partire da quello che sai (una definizione, un collegamento), è meglio del silenzio.'); return out; }
  if (start !== null) out.push(start <= 5 ? `Sei partita subito (${start} s): bene.` : start <= 12 ? `Ci hai messo ${start} s a partire: prova ad attaccare subito con una frase sicura, anche solo la definizione.` : `Ci hai messo ${start} s a partire: all’orale sembra incertezza anche quando sai. Allenati a dire subito la prima frase (“La … è …”), poi segui la traccia.`);
  out.push(`${fmtT(secs)} di risposta, circa ${words} parole${secs > 20 ? ` (${Math.round(words / (secs / 60))} al minuto)` : ''}.`);
  if (c.pauses) out.push(`${c.pauses} ${c.pauses === 1 ? 'pausa lunga' : 'pause lunghe'} (oltre 3 secondi): ${c.pauses > 2 ? 'quando ti fermi, riparti dal punto successivo della traccia invece di cercare la parola perfetta.' : 'va bene, ma prova a collegare i punti con frasi ponte (“questo porta a…”, “di conseguenza…”).'}`);
  if (fillers > 2) out.push(`${fillers} intercalari (ehm, cioè, praticamente…): una breve pausa silenziosa suona più sicura.`);
  if (c.helped) out.push('Hai usato la traccia: la prossima volta prova a ricostruirla da sola prima di guardarla.');
  return out;
}
function vivaSummary() {
  const s = vivaState.s;
  const all = s.items.flatMap(i => [i, ...(i.followups || [])]);
  const avg = all.length ? Math.round(all.reduce((a, i) => a + i.ev.voto, 0) / all.length) : 0;
  const starts = all.filter(i => i.text && i.tFirst).map(i => (i.tFirst - i.t0) / 1000);
  const avgStart = starts.length ? Math.round(starts.reduce((a, b) => a + b, 0) / starts.length) : null;
  const pauses = all.reduce((a, i) => a + (i.pauses || 0), 0);
  const miss = all.flatMap(i => (i.ev.mancava || []).map(m => ({ m, sec: i.secId, label: secById(i.secId)?.title || (s.exam ? examQs().find(r => r.id === i.eqId)?.q : '') || '' })));
  setView(`
    <header class="page-head"><div><h1>${s.exam ? 'Fine dell’esame' : 'Fine dell’interrogazione'}</h1><p class="lede">${esc(s.title)}</p></div></header>
    <div class="viva-card">
      <div class="viva-score ${avg >= 27 ? 'top' : avg >= 18 ? 'ok' : 'ko'}"><b>${avg}</b><span>/30 indicativo${s.exam ? ' per l’esame' : ''}, media di ${all.length} ${all.length === 1 ? 'risposta' : 'risposte'}</span></div>
      <ul class="viva-sum">
        ${avgStart !== null ? `<li>In media sei partita dopo <b>${avgStart} s</b>${avgStart > 8 ? ': è il punto da allenare, prima ancora del contenuto.' : '.'}</li>` : ''}
        <li>${pauses ? `<b>${pauses}</b> ${pauses === 1 ? 'pausa lunga' : 'pause lunghe'} in tutto.` : 'Nessuna pausa lunga.'}</li>
      </ul>
      <h3 class="sub3">Domande</h3>
      <ol class="viva-qs">${s.items.map(i => `<li><b>${i.ev.voto}/30</b> · ${i.part ? `<small class="muted-inline">${esc(i.part)}</small> ` : ''}${esc(i.q)}${(i.followups || []).map(f => `<br><small>↳ ${f.ev.voto}/30 · ${esc(f.q)}</small>`).join('')}</li>`).join('')}</ol>
      ${miss.length ? `<h3 class="sub3">Da ripassare</h3><ul class="viva-miss">${miss.slice(0, 15).map(x => `<li>${x.sec && secById(x.sec) ? `<a href="#/sec/${x.sec}/read">${esc(x.label)}</a>` : `<b>${esc(x.label)}</b>`}: ${esc(x.m)}</li>`).join('')}</ul>` : ''}
      <div class="actions"><button class="btn primary" type="button" data-act="vv-again">${s.exam ? (s.exam.one ? 'Rifalla' : 'Un altro esame') : 'Un’altra interrogazione'}</button>${s.exam ? `<a class="btn ghost" href="#/examq/prep/${encodeURIComponent(s.exam.key)}">Preparazione all’esame</a>` : '<a class="btn ghost" href="#/viva">Cambia argomento</a>'}</div>
    </div>`);
  on('[data-act="vv-again"]', 'click', () => { vivaState.s = null; route(); });
}

/* ---------- Indovina dall’immagine (atlanti) ---------- */
const imgQuiz = { ok: 0, done: 0 };
function viewImageQuiz(kind) {
  const cfg = SPECIALS[kind];
  const nb = specialNb(kind);
  const all = (nb ? secsOf(nb.id) : []).filter(s => imageRefs(s.md).length);
  setView(`
    <header class="page-head"><div><h1>${cfg.name}</h1><p class="lede">Indovina dall’immagine: guarda e scegli la risposta giusta.</p></div></header>
    <nav class="tabs" aria-label="${esc(cfg.name)}"><a href="#/${cfg.route}" class="tab">Schede</a><a href="#/${cfg.route}/quiz" class="tab on" aria-current="page">Indovina dall’immagine</a></nav>
    <div id="iqBox"></div>`);
  const box = $('#iqBox');
  const next = () => {
    if (all.length < 4) { box.innerHTML = `<div class="empty"><p>Servono almeno 4 schede con un’immagine (ora ${all.length}). Aggiungi le immagini con ＋ Foto nelle schede.</p></div>`; return; }
    const target = all[Math.floor(Math.random() * all.length)];
    const imgs = imageRefs(target.md);
    const im = imgs[Math.floor(Math.random() * imgs.length)];
    // le opzioni sbagliate, prima dallo stesso tipo (ECG con ECG, apparato con apparato)
    const same = shuffle(all.filter(s => s.id !== target.id && s.sp?.type === target.sp?.type));
    const rest = shuffle(all.filter(s => s.id !== target.id && s.sp?.type !== target.sp?.type));
    const opts = shuffle([target, ...[...same, ...rest].slice(0, 3)]);
    box.innerHTML = `
      <div class="lab-q iq">
        <div class="iq-img"><img class="nb-img" data-img="${im}" alt="Immagine da riconoscere"></div>
        <p class="lab-q-t">Che cos’è?</p>
        <div class="dx-opts">${opts.map(o => `<button type="button" class="btn dx-opt" data-iq="${o.id}">${esc(o.title)}</button>`).join('')}</div>
        <div id="iqWhy"></div>
        ${imgQuiz.done ? `<p class="hint">Finora: ${imgQuiz.ok} su ${imgQuiz.done}.</p>` : ''}
      </div>`;
    box.querySelector('.dx-opts').addEventListener('click', e => {
      const b = e.target.closest('[data-iq]');
      if (!b || box.querySelector('.dx-opts').dataset.done) return;
      box.querySelector('.dx-opts').dataset.done = '1';
      const right = b.dataset.iq === target.id;
      imgQuiz.done++;
      if (right) imgQuiz.ok++;
      $$('[data-iq]', box).forEach(x => { x.disabled = true; x.classList.toggle('ok', x.dataset.iq === target.id); x.classList.toggle('ko', x === b && !right); });
      const bits = specialMetaBits(target);
      $('#iqWhy', box).innerHTML = `<p class="dx-res ${right ? 'ok' : 'ko'}">${right ? 'Giusto!' : `No: è ${esc(target.title)}.`}${bits.length ? ` <span class="muted-inline">${esc(bits.join(' · '))}</span>` : ''}</p>
        <div class="inline"><button class="btn primary" type="button" data-iqn>Un’altra</button><a class="btn ghost" href="#/sec/${target.id}/read">Apri la scheda</a></div>`;
      $('[data-iqn]', box).onclick = next;
    });
  };
  next();
}

/* =====================================================================
   v3.70: Articoli — una bibliografia
   Ogni articolo è un record (kind 'paper') con i dati bibliografici, lo stato di
   lettura, i tag, la sintesi e il PDF (nella libreria, notebook “Articoli”). I dati si
   compilano dal DOI con Crossref. Le note cliniche li collegano (n.papers).
   ===================================================================== */
const PAPER_TYPES = [['guide', 'Linee guida'], ['sr', 'Review sistematica o meta-analisi'], ['review', 'Review narrativa'], ['rct', 'Trial randomizzato'], ['obs', 'Studio osservazionale'], ['case', 'Case report'], ['other', 'Altro']];
const PAPER_STATUS = [['todo', 'Da leggere'], ['reading', 'In lettura'], ['read', 'Letto']];
const papers = () => state.links.filter(l => l.kind === 'paper');
const paperById = id => state.links.find(l => l.id === id && l.kind === 'paper');
const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;
const cleanDoi = t => { const m = String(t || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').match(DOI_RE); return m ? m[1].replace(/[.,;)\]]+$/, '') : ''; };
async function papersNb() {
  let nb = state.notebooks.find(n => n.kind === 'papers');
  if (!nb) { nb = { id: uid(), name: 'Articoli', kind: 'papers', created: Date.now() }; await saveNotebook(nb); }
  return nb;
}
// i dati di un articolo dal suo DOI (Crossref, gratuito e senza chiave)
async function crossrefLookup(doi) {
  if (navigator.onLine === false) throw new Error('Sei offline: i dati dal DOI arrivano con internet');
  const r = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status === 404 ? 'DOI non trovato' : 'Il registro degli articoli non risponde: riprova più tardi');
  const m = (await r.json()).message || {};
  const year = (m.issued?.['date-parts']?.[0]?.[0]) || (m.published?.['date-parts']?.[0]?.[0]) || '';
  const tp = String(m.type || '');
  return {
    title: String((m.title || [])[0] || '').replace(/\s+/g, ' ').trim(),
    authors: (m.author || []).map(a => [a.family, a.given].filter(Boolean).join(' ') || a.name || '').filter(Boolean).join('; '),
    journal: String((m['container-title'] || [])[0] || (m['short-container-title'] || [])[0] || ''),
    year: year ? String(year) : '',
    volume: String(m.volume || ''), issue: String(m.issue || ''), pages: String(m.page || ''),
    url: String(m.URL || ''),
    guessType: /book/.test(tp) ? 'other' : ''
  };
}
// il DOI scritto nelle prime pagine del PDF (e il titolo nei metadati, se c’è)
async function doiFromPdf(file) {
  try {
    await ensurePdfJs();
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    let doi = '', title = '';
    try { title = String((await doc.getMetadata())?.info?.Title || '').trim(); } catch { /* niente */ }
    for (let n = 1; n <= Math.min(2, doc.numPages) && !doi; n++) doi = cleanDoi(await pageText(doc, n));
    doc.destroy();
    return { doi, title: /^(untitled|microsoft word|document)/i.test(title) ? '' : title };
  } catch { return { doi: '', title: '' }; }
}
// “Smolen JS, Aletaha D, McInnes IB, et al.” e la citazione completa (stile Vancouver)
function authorsShort(p, max = 3) {
  const list = String(p.authors || '').split(/\s*;\s*/).filter(Boolean).map(a => { const [fam, ...g] = a.split(' '); return `${fam} ${g.map(x => x[0]).join('').toUpperCase()}`.trim(); });
  return list.length > max ? `${list.slice(0, max).join(', ')}, et al.` : list.join(', ');
}
function citation(p) {
  const au = authorsShort(p, 6);
  const parts = [au ? `${au.replace(/\.$/, '')}.` : '', p.title ? `${p.title.replace(/\.$/, '')}.` : '', p.journal ? `${p.journal}.` : ''];
  let det = p.year || '';
  if (p.volume) det += `;${p.volume}`;
  if (p.issue) det += `(${p.issue})`;
  if (p.pages) det += `:${p.pages}`;
  if (det) parts.push(`${det}.`);
  if (p.doi) parts.push(`doi:${p.doi}`);
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
function risOf(list) {
  const ty = { guide: 'JOUR', sr: 'JOUR', review: 'JOUR', rct: 'JOUR', obs: 'JOUR', case: 'JOUR', other: 'GEN' };
  return list.map(p => {
    const L = [`TY  - ${ty[p.ptype] || 'JOUR'}`, `TI  - ${p.title || ''}`];
    String(p.authors || '').split(/\s*;\s*/).filter(Boolean).forEach(a => { const [fam, ...g] = a.split(' '); L.push(`AU  - ${fam}, ${g.join(' ')}`); });
    if (p.journal) L.push(`JO  - ${p.journal}`);
    if (p.year) L.push(`PY  - ${p.year}`);
    if (p.volume) L.push(`VL  - ${p.volume}`);
    if (p.issue) L.push(`IS  - ${p.issue}`);
    if (p.pages) { const [sp, ep] = p.pages.split(/[-–]/); L.push(`SP  - ${sp}`); if (ep) L.push(`EP  - ${ep}`); }
    if (p.doi) L.push(`DO  - ${p.doi}`);
    if (p.url) L.push(`UR  - ${p.url}`);
    tagsOf(p).forEach(t => L.push(`KW  - ${t}`));
    if (p.summary) L.push(`N1  - ${p.summary.replace(/\n+/g, ' ')}`);
    L.push('ER  - ');
    return L.join('\r\n');
  }).join('\r\n\r\n');
}
// scheda per un articolo nuovo o da modificare
function paperSheet(p = null, prefill = {}) {
  return new Promise(resolve => {
    const e = p ? { ...p } : { status: 'todo', ptype: '', ...prefill };
    let pdfFile = null;
    const usedTags = [...new Set(papers().flatMap(x => tagsOf(x)))].sort((a, b) => a.localeCompare(b, 'it'));
    const inp = (id, label, val, ph = '', extra = '') => `<label class="field"><span>${label}</span><input class="input" id="${id}" value="${esc(val || '')}" placeholder="${esc(ph)}" ${extra}></label>`;
    const sh = openSheet(`
      <h2>${p ? 'Modifica l’articolo' : 'Nuovo articolo'}</h2>
      <div class="pp-doi">
        ${inp('ppDoi', 'DOI o link dell’articolo', e.doi || '', 'Es. 10.1016/S0140-6736(16)30173-8', 'autocomplete="off" autocapitalize="off"')}
        <button class="btn" type="button" data-pp="look">Compila dal DOI</button>
      </div>
      <div class="pp-pdf"><button class="btn ghost" type="button" data-pp="pdf">${p && p.pdfId ? 'Sostituisci il PDF' : '＋ Carica il PDF'}</button><span class="hint" id="ppPdfInfo">${p && p.pdfId ? 'PDF già caricato.' : 'Se il PDF contiene il DOI, i dati si compilano da soli.'}</span></div>
      <p class="hint" id="ppMsg" aria-live="polite"></p>
      ${inp('ppTitle', 'Titolo', e.title)}
      ${inp('ppAuthors', 'Autori, separati da punto e virgola', e.authors, 'Es. Smolen JS; Aletaha D')}
      <div class="grid2">${inp('ppJournal', 'Rivista', e.journal)}${inp('ppYear', 'Anno', e.year, '', 'inputmode="numeric"')}</div>
      <div class="grid3">${inp('ppVol', 'Volume', e.volume)}${inp('ppIssue', 'Numero', e.issue)}${inp('ppPages', 'Pagine', e.pages)}</div>
      <div class="grid2">
        <label class="field"><span>Tipo</span><select class="input" id="ppType"><option value="">—</option>${PAPER_TYPES.map(([k, l]) => `<option value="${k}" ${e.ptype === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Stato</span><select class="input" id="ppStatus">${PAPER_STATUS.map(([k, l]) => `<option value="${k}" ${e.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <label class="check"><input type="checkbox" id="ppStar" ${e.star ? 'checked' : ''}><span>★ Importante</span></label>
      <label class="field"><span>Tag, separati da virgole (es. la malattia)</span><input class="input" id="ppTags" value="${esc(tagsOf(e).join(', '))}" list="ppTagList" placeholder="Es. artrite reumatoide, terapia"><datalist id="ppTagList">${usedTags.map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
      <label class="field"><span>Sintesi: cosa dice, in due o tre righe</span><textarea class="input" id="ppSum" rows="3">${esc(e.summary || '')}</textarea></label>
      <label class="field"><span>Punti chiave, uno per riga</span><textarea class="input" id="ppKey" rows="4" placeholder="Es. - target: remissione o bassa attività">${esc(e.keys || '')}</textarea></label>
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-pp="no">Annulla</button>
        <button class="btn primary" type="button" data-pp="ok">Salva</button>
      </div>`, { label: 'Articolo', onClose: v => resolve(v || null) });
    const msg = t => { $('#ppMsg', sh.el).textContent = t; };
    const fill = (d, force = false) => {
      const map = { ppTitle: d.title, ppAuthors: d.authors, ppJournal: d.journal, ppYear: d.year, ppVol: d.volume, ppIssue: d.issue, ppPages: d.pages };
      Object.entries(map).forEach(([id, v]) => { const el = $(`#${id}`, sh.el); if (v && (force || !el.value.trim())) el.value = v; });
      if (d.url) e.url = d.url;
    };
    const look = async (doi, quiet = false) => {
      if (!doi) { if (!quiet) msg('Scrivi un DOI valido (inizia con 10.)'); return false; }
      $('#ppDoi', sh.el).value = doi;
      msg('Cerco i dati dell’articolo…');
      try { fill(await crossrefLookup(doi), !p); msg('Dati compilati dal DOI: controllali.'); return true; }
      catch (err) { msg(`${err.message}. Puoi scrivere i dati a mano.`); return false; }
    };
    $('[data-pp="look"]', sh.el).onclick = () => look(cleanDoi($('#ppDoi', sh.el).value));
    $('#ppDoi', sh.el).addEventListener('paste', () => setTimeout(() => { const d = cleanDoi($('#ppDoi', sh.el).value); if (d && !$('#ppTitle', sh.el).value.trim()) look(d, true); }, 30));
    $('[data-pp="pdf"]', sh.el).onclick = () => {
      const fi = document.createElement('input');
      fi.type = 'file';
      fi.accept = 'application/pdf,.pdf';
      fi.onchange = async () => {
        const f = fi.files[0];
        if (!f) return;
        pdfFile = f;
        $('#ppPdfInfo', sh.el).textContent = `${f.name} (${fmtSize(f.size)}) sarà salvato con l’articolo.`;
        const got = await doiFromPdf(f);
        if (got.title && !$('#ppTitle', sh.el).value.trim()) $('#ppTitle', sh.el).value = got.title;
        if (got.doi && !$('#ppDoi', sh.el).value.trim()) await look(got.doi, true);
        else if (!got.doi) msg('Nel PDF non ho trovato il DOI: incollalo sopra, oppure scrivi i dati a mano.');
      };
      fi.click();
    };
    $('[data-pp="no"]', sh.el).onclick = () => sh.close(null);
    $('[data-pp="ok"]', sh.el).onclick = async () => {
      const v = id => $(`#${id}`, sh.el).value.trim();
      const title = v('ppTitle');
      if (!title) { toast('Scrivi il titolo, o compila i dati dal DOI'); return; }
      const rec = p || { id: uid(), kind: 'paper', notebookId: '_papers', created: Date.now() };
      const doi = cleanDoi(v('ppDoi'));
      Object.assign(rec, {
        title, authors: v('ppAuthors'), journal: v('ppJournal'), year: v('ppYear'), volume: v('ppVol'), issue: v('ppIssue'), pages: v('ppPages'),
        doi, url: doi ? `https://doi.org/${doi}` : (/^https?:\/\//.test(v('ppDoi')) ? v('ppDoi') : (e.url || rec.url || '')),
        ptype: $('#ppType', sh.el).value, status: $('#ppStatus', sh.el).value, star: $('#ppStar', sh.el).checked,
        tags: parseTags(v('ppTags')), summary: $('#ppSum', sh.el).value.trim(), keys: $('#ppKey', sh.el).value.trim(), updated: Date.now()
      });
      if (pdfFile) {
        msg('Salvo il PDF…');
        try {
          const nb = await papersNb();
          const meta = await storePdfFile(pdfFile, { notebookId: nb.id });
          meta.name = title.slice(0, 120);
          meta.paperId = rec.id;
          await savePdfMeta(meta);
          rec.pdfId = meta.id;
        } catch (err) { toast(err.message || 'Non riesco a salvare il PDF', 'err'); return; }
      }
      await saveLink(rec);
      toast(p ? 'Articolo aggiornato' : 'Articolo salvato');
      sh.close(rec);
    };
    setTimeout(() => $('#ppDoi', sh.el)?.focus(), 40);
  });
}
const paperState = { q: '', status: '', type: '', tag: '', star: false, sort: 'new' };
function viewPapers(id) {
  if (id) return viewPaper(id);
  const all = papers();
  const st = paperState;
  const tags = [...new Set(all.flatMap(p => tagsOf(p)))].sort((a, b) => a.localeCompare(b, 'it'));
  const cnt = k => all.filter(p => (p.status || 'todo') === k).length;
  setView(`
    <header class="page-head">
      <div><h1>Articoli</h1><p class="lede">${all.length ? `${all.length} ${all.length === 1 ? 'articolo' : 'articoli'} · ${cnt('todo')} da leggere · ${cnt('read')} letti` : 'La tua bibliografia: articoli, linee guida e review, con sintesi, tag e collegamenti alle note cliniche.'}</p></div>
      <div class="actions"><button class="btn primary" type="button" data-act="pp-new">Nuovo articolo</button>${all.length ? '<button class="btn ghost" type="button" data-act="pp-ris" title="Per Zotero, Mendeley, EndNote">Esporta (RIS)</button>' : ''}</div>
    </header>
    ${all.length ? `
      <input type="search" class="input search" id="ppQ" placeholder="Cerca per titolo, autore, rivista, tag, sintesi" aria-label="Cerca negli articoli" value="${esc(st.q)}">
      <div class="tag-cloud">
        ${PAPER_STATUS.map(([k, l]) => `<button type="button" class="tag ${st.status === k ? 'on' : ''}" data-pps="${k}" aria-pressed="${st.status === k}">${l} <small>${cnt(k)}</small></button>`).join('')}
        <button type="button" class="tag ${st.star ? 'on' : ''}" data-ppstar aria-pressed="${st.star}">★ Importanti</button>
      </div>
      <div class="tag-cloud">${PAPER_TYPES.filter(([k]) => all.some(p => p.ptype === k)).map(([k, l]) => `<button type="button" class="tag ${st.type === k ? 'on' : ''}" data-ppt="${k}" aria-pressed="${st.type === k}">${l}</button>`).join('')}</div>
      ${tags.length ? `<div class="tag-cloud">${tags.map(t => `<button type="button" class="tag ${st.tag === t ? 'on' : ''}" data-pptag="${esc(t)}" aria-pressed="${st.tag === t}">#${esc(t)}</button>`).join('')}</div>` : ''}
      <label class="field pp-sort"><span>Ordina</span><select class="input" id="ppSort">${[['new', 'Aggiunti di recente'], ['year', 'Anno, i più recenti'], ['title', 'Titolo']].map(([k, l]) => `<option value="${k}" ${st.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <ul class="list" id="ppList"></ul>` : `
      <div class="empty"><p>Incolla il DOI di un articolo, o carica il suo PDF: titolo, autori, rivista e anno si compilano da soli. Poi aggiungi tag (per esempio la malattia), stato di lettura e la tua sintesi.</p><button class="btn primary" type="button" data-act="pp-new">Nuovo articolo</button></div>`}`);
  const filtered = () => {
    const f = foldAccents(st.q);
    let list = all.filter(p => (!st.status || (p.status || 'todo') === st.status) && (!st.type || p.ptype === st.type) && (!st.tag || tagsOf(p).includes(st.tag)) && (!st.star || p.star)
      && (!f || foldAccents(`${p.title} ${p.authors} ${p.journal} ${p.year} ${tagsOf(p).join(' ')} ${p.summary} ${p.keys}`).includes(f)));
    list = list.sort(st.sort === 'year' ? (a, b) => (+b.year || 0) - (+a.year || 0) : st.sort === 'title' ? (a, b) => a.title.localeCompare(b.title, 'it') : (a, b) => (b.created || 0) - (a.created || 0));
    return list;
  };
  const draw = () => {
    const box = $('#ppList');
    if (!box) return;
    const list = filtered();
    box.innerHTML = list.map(p => `<li><a class="row pp-row" href="#/papers/${p.id}"><span class="row-main">
      <span class="row-title">${p.star ? '<span class="pp-star">★</span> ' : ''}${esc(p.title)}</span>
      <span class="row-sub">${esc([authorsShort(p), p.journal, p.year].filter(Boolean).join(' · '))}</span>
      <span class="tags">${p.ptype ? `<span class="tag">${esc(PAPER_TYPES.find(t => t[0] === p.ptype)?.[1] || '')}</span>` : ''}${tagsOf(p).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}${p.pdfId ? '<span class="tag">PDF</span>' : ''}</span>
    </span><span class="pill ${p.status === 'read' ? 'soft' : p.status === 'reading' ? 'due' : ''}">${esc(PAPER_STATUS.find(s => s[0] === (p.status || 'todo'))[1])}</span></a></li>`).join('') || '<li class="hint">Nessun articolo corrisponde.</li>';
  };
  draw();
  $('#ppQ')?.addEventListener('input', e => { st.q = e.target.value; draw(); });
  $('#ppSort')?.addEventListener('change', e => { st.sort = e.target.value; draw(); });
  const chip = (sel, key, get) => on(sel, 'click', e => { const v = get(e.currentTarget); st[key] = st[key] === v ? (typeof v === 'boolean' ? false : '') : v; route(); });
  chip('[data-pps]', 'status', b => b.dataset.pps);
  chip('[data-ppt]', 'type', b => b.dataset.ppt);
  chip('[data-pptag]', 'tag', b => b.dataset.pptag);
  on('[data-ppstar]', 'click', () => { st.star = !st.star; route(); });
  on('[data-act="pp-new"]', 'click', async () => { const p = await paperSheet(); if (p) go(`#/papers/${p.id}`); });
  on('[data-act="pp-ris"]', 'click', () => {
    const list = filtered();
    downloadBlob(new Blob([risOf(list)], { type: 'application/x-research-info-systems' }), `articoli-${todayStr()}.ris`);
    toast(`${list.length} articoli esportati: aprili con Zotero, Mendeley o EndNote`);
  });
}
function viewPaper(id) {
  const p = paperById(id);
  if (!p) return notFound('Questo articolo');
  const notes = clinicalNotes().filter(n => (n.papers || []).includes(p.id));
  const pdf = p.pdfId ? pdfById(p.pdfId) : null;
  const tl = PAPER_TYPES.find(t => t[0] === p.ptype)?.[1];
  setView(`<div id="ppDetail">
    <a class="back" href="#/papers">Articoli</a>
    <header class="page-head pp-head">
      <div>
        <h1>${p.star ? '<span class="pp-star">★</span> ' : ''}${esc(p.title)}</h1>
        <p class="lede">${esc(String(p.authors || '').split(/\s*;\s*/).filter(Boolean).join(', '))}</p>
        <p class="meta">${esc([p.journal, [p.year, p.volume && `vol. ${p.volume}`, p.issue && `n. ${p.issue}`, p.pages && `pp. ${p.pages}`].filter(Boolean).join(', '), tl].filter(Boolean).join(' · '))}</p>
      </div>
    </header>
    <div class="row-actions">
      ${pdf ? `<a class="btn primary" href="#/pdf/${pdf.id}">Apri il PDF</a><button class="btn" type="button" data-act="pp-split">⇆ Affianca</button>` : '<button class="btn primary" type="button" data-act="pp-edit">＋ Carica il PDF</button>'}
      ${p.url ? `<a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener">Apri online</a>` : ''}
      <a class="btn ghost" href="https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(p.doi || p.title)}" target="_blank" rel="noopener">PubMed</a>
      <button class="btn ghost" type="button" data-act="pp-cite">Copia la citazione</button>
      <button class="btn ghost" type="button" data-act="pp-edit">Modifica</button>
      ${pdf ? '<button class="btn ghost" type="button" data-act="pp-ai">✨ Sintesi con l’AI</button>' : ''}
    </div>
    <div class="pp-status inline">
      <div class="seg" role="radiogroup" aria-label="Stato">${PAPER_STATUS.map(([k, l]) => `<button type="button" role="radio" data-ppset="${k}" aria-checked="${(p.status || 'todo') === k}">${l}</button>`).join('')}</div>
      <button type="button" class="btn sm ${p.star ? 'primary' : 'ghost'}" data-act="pp-star" aria-pressed="${!!p.star}">★ ${p.star ? 'Importante' : 'Segna importante'}</button>
    </div>
    ${tagsOf(p).length ? `<div class="tags">${tagsOf(p).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="notes pp-body">
      ${p.summary ? `<h2>Sintesi</h2>${renderMd(p.summary)}` : '<p class="hint">Nessuna sintesi: in Modifica scrivi in due o tre righe cosa dice.</p>'}
      ${p.keys ? `<h2>Punti chiave</h2>${renderMd(p.keys.split('\n').map(l => (l.trim() && !/^\s*[-*\d]/.test(l) ? `- ${l.trim()}` : l)).join('\n'))}` : ''}
    </div>
    <div class="fonti">
      <h3>Note cliniche collegate</h3>
      <div class="tags">${notes.map(n => `<button type="button" class="tag" data-cnopen="${n.id}">${esc(n.title)} <span class="tag-x" data-ppunl="${n.id}" role="button" aria-label="Scollega">×</span></button>`).join('') || '<span class="hint">Nessuna.</span>'}</div>
      <input type="search" class="input" id="ppCnQ" placeholder="＋ Collega a una nota clinica: scrivi il nome" autocomplete="off">
      <ul class="list pick-list sp-link-res" id="ppCnRes"></ul>
    </div>
    <p class="hint pp-cite">${esc(citation(p))}</p>
    <div class="row-actions"><button class="btn ghost danger" type="button" data-act="pp-del">Elimina l’articolo</button></div>
    </div>`);
  on('[data-act="pp-edit"]', 'click', async () => { if (await paperSheet(p)) route(); });
  on('[data-act="pp-split"]', 'click', () => Split.show({ kind: 'pdf', id: pdf.id, page: pdf.lastPage || 1 }));
  on('[data-act="pp-ai"]', 'click', async () => { if (await paperAiSummary(p)) route(); });
  on('[data-act="pp-cite"]', 'click', async () => { try { await navigator.clipboard.writeText(citation(p)); toast('Citazione copiata'); } catch { toast('Non riesco a copiare: selezionala qui sotto', 'err'); } });
  on('[data-act="pp-star"]', 'click', async () => { p.star = !p.star; await saveLink(p); route(); });
  on('[data-ppset]', 'click', async e => { p.status = e.currentTarget.dataset.ppset; if (p.status === 'read' && !p.readOn) p.readOn = todayStr(); await saveLink(p); route(); });
  on('[data-act="pp-del"]', 'click', async () => {
    const ok = await modal({ title: 'Eliminare l’articolo?', text: pdf ? 'Sparisce dalla bibliografia e dalle note cliniche collegate. Il PDF resta nella libreria: se non ti serve, eliminalo da lì.' : 'Sparisce dalla bibliografia e dalle note cliniche collegate.', confirm: 'Elimina', danger: true });
    if (!ok) return;
    for (const n of notes) { n.papers = n.papers.filter(x => x !== p.id); await saveLink(n); }
    await removeRecords([{ store: 'links', rec: p }]);
    toast('Articolo eliminato');
    go('#/papers');
  });
  // l’ascoltatore sta sulla pagina dell’articolo, che sparisce quando cambi pagina
  $('#ppDetail').addEventListener('click', async e => {
    const un = e.target.closest('[data-ppunl]');
    if (un) { e.stopPropagation(); const n = clinicalNotes().find(x => x.id === un.dataset.ppunl); if (n) { n.papers = (n.papers || []).filter(x => x !== p.id); await saveLink(n); route(); } return; }
    const o = e.target.closest('[data-cnopen]');
    if (o) { showClinicNote(o.dataset.cnopen); return; }
    const add = e.target.closest('[data-pplink]');
    if (add) { const n = clinicalNotes().find(x => x.id === add.dataset.pplink); if (n) { n.papers = [...new Set([...(n.papers || []), p.id])]; await saveLink(n); toast(`Collegato a “${n.title}”`); route(); } }
  });
  $('#ppCnQ').addEventListener('input', e => {
    const f = foldAccents(e.target.value.trim());
    const hits = f ? clinicalNotes().filter(n => !(n.papers || []).includes(p.id) && foldAccents(n.title).includes(f)).slice(0, 8) : [];
    $('#ppCnRes').innerHTML = hits.map(n => `<li><button type="button" class="row" data-pplink="${n.id}"><span class="row-main"><span class="row-title">${esc(n.title)}</span></span></button></li>`).join('') || (f ? '<li class="hint">Nessuna nota clinica con questo nome.</li>' : '');
  });
}

/* ---------- v3.72: dal PDF a una nota clinica che c’è già ---------- */
const CN_FIELDS = [['body', 'Note'], ['dxCriteria', 'Diagnosi: criteri'], ['dxFirst', 'Esami di primo livello'], ['dxSecond', 'Esami di secondo livello'], ['therapy', 'Terapia'], ['complications', 'Complicanze'], ['prognosis', 'Prognosi'], ['staging', 'Stadiazione o classificazione'], ['risk', 'Fattori di rischio'], ['ddxText', 'Diagnosi differenziale']];
function addToClinicNoteSheet(text, { source = '', paperId = '' } = {}) {
  return new Promise(resolve => {
    const all = clinicalNotes().slice().sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));
    if (!all.length) { toast('Non hai ancora note cliniche: creane una con “Nuova nota clinica”'); resolve(false); return; }
    let picked = null;
    const sh = openSheet(`
      <h2>Aggiungi a una nota clinica</h2>
      <blockquote class="pdf-quote">${esc(text.slice(0, 500))}${text.length > 500 ? '…' : ''}</blockquote>
      <input type="search" class="input" id="acQ" placeholder="Cerca la nota: scrivi il nome della malattia" autocomplete="off">
      <ul class="list pick-list sp-link-res" id="acList"></ul>
      <label class="field"><span>Dove</span><select class="input" id="acField">${CN_FIELDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      ${source ? `<label class="check"><input type="checkbox" id="acSrc" checked><span>Aggiungi la fonte: ${esc(source.slice(0, 120))}</span></label>` : ''}
      <div class="modal-actions"><button class="btn ghost" type="button" data-ac="no">Annulla</button><button class="btn primary" type="button" data-ac="ok">Aggiungi</button></div>`, { label: 'Aggiungi a una nota clinica', onClose: v => resolve(v || false) });
    const draw = () => {
      const f = foldAccents($('#acQ', sh.el).value.trim());
      const list = all.filter(n => !f || foldAccents(`${n.title} ${(n.symptoms || []).join(' ')}`).includes(f)).slice(0, f ? 30 : 8);
      $('#acList', sh.el).innerHTML = list.map(n => `<li><button type="button" class="row ${picked === n ? 'on' : ''}" data-acn="${n.id}"><span class="row-main"><span class="row-title">${esc(n.title)}</span>${n.specialty ? `<span class="row-sub">${esc(n.specialty)}</span>` : ''}</span></button></li>`).join('') || '<li class="hint">Nessuna nota con questo nome.</li>';
    };
    draw();
    $('#acQ', sh.el).addEventListener('input', draw);
    sh.el.addEventListener('click', e => { const b = e.target.closest('[data-acn]'); if (b) { picked = all.find(n => n.id === b.dataset.acn); draw(); } });
    $('[data-ac="no"]', sh.el).onclick = () => sh.close(false);
    $('[data-ac="ok"]', sh.el).onclick = async () => {
      if (!picked) { toast('Tocca la nota a cui aggiungerlo'); return; }
      const k = $('#acField', sh.el).value;
      // come voce di elenco, così le aggiunte successive restano in ordine
      const add = /^\s*-\s/.test(text) ? text.trim() : `- ${text.replace(/\s*\n\s*/g, ' ').trim()}`;
      picked[k] = `${String(picked[k] || '').trimEnd()}${picked[k] ? '\n' : ''}${add}`;
      if (source && $('#acSrc', sh.el)?.checked) picked.sources = [...new Set([...sourcesOf(picked), source])];
      if (paperId) picked.papers = [...new Set([...(picked.papers || []), paperId])];
      picked.updated = Date.now();
      await saveLink(picked);
      const n = picked;
      toast(`Aggiunto a “${n.title}” › ${CN_FIELDS.find(f => f[0] === k)[1]}`, '', { label: 'Apri', fn: () => showClinicNote(n.id) });
      sh.close(true);
    };
    setTimeout(() => $('#acQ', sh.el)?.focus(), 40);
  });
}

/* ---------- v3.72: sintesi di un articolo con l’AI ---------- */
const PAPER_AI_SYS = `Sei un medico specialista che aiuta una studentessa di medicina a schedare un articolo scientifico per la sua bibliografia.
Leggi l’ARTICOLO e rispondi SOLO con JSON valido, in italiano, senza altro testo:
{"sintesi": "2-3 frasi: la domanda o lo scopo, come è stato fatto lo studio (se è uno studio), il messaggio principale", "punti": ["da 5 a 8 punti chiave brevi, con i numeri importanti se ci sono (percentuali, rischi, criteri, dosi)"], "tipo": "uno tra guide, sr, review, rct, obs, case, other (linee guida, review sistematica o meta-analisi, review narrativa, trial randomizzato, studio osservazionale, case report, altro)", "tag": ["da 2 a 4 tag brevi in minuscolo: le malattie o i temi principali"]}`;
const blobToB64 = blob => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
async function paperAiSummary(p) {
  if (!AI.ready()) { toast('Serve la chiave di Gemini o di Claude in Impostazioni'); return false; }
  const meta = p.pdfId ? pdfById(p.pdfId) : null;
  if (!meta) { toast('Carica prima il PDF dell’articolo (Modifica → Carica il PDF)'); return false; }
  const rec = await DB.run('pdfblobs', 'readonly', tx => tx.objectStore('pdfblobs').get(meta.id));
  if (!rec || !rec.blob) { toast('Il PDF non è su questo dispositivo: aprilo una volta dalla libreria', 'err'); return false; }
  const wait = toast('L’AI sta leggendo l’articolo… (può volerci un minuto)');
  let j;
  try {
    let opts;
    if (rec.blob.size < 15 * 1048576) opts = { pdfBase64: await blobToB64(rec.blob), text: `Titolo: ${p.title}` };
    else {
      // PDF molto grande: le prime pagine come testo
      await ensurePdfJs();
      const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await rec.blob.arrayBuffer()) }).promise;
      let t = '';
      for (let n = 1; n <= Math.min(doc.numPages, 15) && t.length < 60000; n++) t += `\n${await pageText(doc, n)}`;
      doc.destroy();
      opts = { text: `Titolo: ${p.title}\n\nARTICOLO:\n${t.slice(0, 60000)}` };
    }
    const r = await AI.generate({ system: PAPER_AI_SYS, maxTokens: 3000, ...opts });
    const m = String(r.text || '').match(/\{[\s\S]*\}/);
    j = JSON.parse(m ? m[0] : '{}');
  } catch (err) { toast(err.message || 'La sintesi non è riuscita: riprova', 'err'); return false; }
  finally { if (wait && wait.remove) wait.remove(); }
  return new Promise(resolve => {
    const sh = openSheet(`
      <h2>Sintesi proposta dall’AI</h2>
      <p class="hint">Controlla e correggi: viene salvata solo quando tocchi Salva.</p>
      <label class="field"><span>Sintesi</span><textarea class="input" id="paSum" rows="4">${esc(String(j.sintesi || ''))}</textarea></label>
      <label class="field"><span>Punti chiave, uno per riga</span><textarea class="input" id="paKey" rows="7">${esc((j.punti || []).map(x => `- ${String(x).replace(/^[-•]\s*/, '')}`).join('\n'))}</textarea></label>
      <div class="grid2">
        <label class="field"><span>Tipo</span><select class="input" id="paType"><option value="">—</option>${PAPER_TYPES.map(([k, l]) => `<option value="${k}" ${(p.ptype || j.tipo) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Tag</span><input class="input" id="paTags" value="${esc([...new Set([...tagsOf(p), ...(j.tag || []).map(t => String(t).toLowerCase().trim())])].join(', '))}"></label>
      </div>
      ${p.summary || p.keys ? '<p class="hint warn-hint">L’articolo ha già una sintesi o dei punti chiave: salvando li sostituisci.</p>' : ''}
      <div class="modal-actions"><button class="btn ghost" type="button" data-pa="no">Annulla</button><button class="btn primary" type="button" data-pa="ok">Salva</button></div>`, { label: 'Sintesi con l’AI', onClose: v => resolve(!!v) });
    $('[data-pa="no"]', sh.el).onclick = () => sh.close(false);
    $('[data-pa="ok"]', sh.el).onclick = async () => {
      p.summary = $('#paSum', sh.el).value.trim();
      p.keys = $('#paKey', sh.el).value.trim();
      p.ptype = $('#paType', sh.el).value || p.ptype;
      p.tags = parseTags($('#paTags', sh.el).value);
      p.aiSummary = todayStr();
      await saveLink(p);
      toast('Sintesi salvata');
      sh.close(true);
    };
  });
}

/* ---------- v3.80: un ritaglio dal PDF nell’atlante ----------
   Nuova scheda (nome, apparato o esame, regione o quadro, tag) oppure una scheda
   che c’è già; l’immagine va sotto “Immagine” (o “Immagini”), la fonte è il PDF e la pagina. */
function saveCropToAtlas(kind, canvas, source, origin = null) {
  const cfg = SPECIALS[kind];
  const nbx = specialNb(kind);
  const others = nbx ? secsOf(nbx.id) : [];
  const groups = [...new Set(others.map(s => s.sp?.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  const last = S()[`cropType_${kind}`] || Object.keys(cfg.types)[0];
  const preview = canvas.toDataURL('image/jpeg', 0.7);
  return new Promise(resolve => {
    let mode = 'new', picked = null;
    const sh = openSheet(`
      <h2>${esc(cfg.name)}</h2>
      <img class="crop-prev" src="${preview}" alt="Il ritaglio">
      <div class="seg" role="tablist" aria-label="Dove">
        <button type="button" data-cm="new" aria-selected="true">Nuova scheda</button>
        <button type="button" data-cm="add" aria-selected="false" ${others.length ? '' : 'disabled'}>Aggiungi a una scheda</button>
      </div>
      <div class="cm-new">
        <label class="field"><span>Nome</span><input class="input" id="cpTitle" placeholder="${esc(cfg.namePh || '')}"></label>
        <div class="grid2">
          <label class="field"><span>${esc(cfg.typeLabel)}</span><select class="input" id="cpType">${Object.entries(cfg.types).map(([k, l]) => `<option value="${k}" ${k === last ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <label class="field"><span>${esc(cfg.groupLabel || 'Gruppo')}</span><input class="input" id="cpGroup" list="cpGroups" placeholder="${esc(cfg.groupPh || '')}"><datalist id="cpGroups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist></label>
        </div>
        <label class="field"><span>Tag, separati da virgole</span><input class="input" id="cpTags" placeholder="Es. esame, da ripassare"></label>
      </div>
      <div class="cm-add" hidden>
        <input type="search" class="input" id="cpQ" placeholder="Cerca la scheda" autocomplete="off">
        <ul class="list pick-list" id="cpList"></ul>
      </div>
      <p class="hint">Fonte: ${esc(source)}</p>
      <label class="check"><input type="checkbox" id="cpLab"><span>Poi segna le strutture con le etichette</span></label>
      <div class="modal-actions"><button class="btn ghost" type="button" data-cp="no">Annulla</button><button class="btn primary" type="button" data-cp="ok">Salva nell’atlante</button></div>`, { label: cfg.name, onClose: v => resolve(v || null) });
    const drawList = () => {
      const f = foldAccents($('#cpQ', sh.el).value.trim());
      const list = others.filter(s => !f || foldAccents(`${s.title} ${s.sp?.group || ''} ${tagsOf(s).join(' ')}`).includes(f)).sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0)).slice(0, 30);
      $('#cpList', sh.el).innerHTML = list.map(s => `<li><button type="button" class="row ${picked === s ? 'on' : ''}" data-cps="${s.id}"><span class="row-main"><span class="row-title">${esc(s.title)}</span><span class="row-sub">${esc(specialMetaBits(s).join(' · '))}</span></span></button></li>`).join('') || '<li class="hint">Nessuna scheda trovata.</li>';
    };
    sh.el.addEventListener('click', async e => {
      const m = e.target.closest('[data-cm]');
      if (m && !m.disabled) {
        mode = m.dataset.cm;
        $$('[data-cm]', sh.el).forEach(b => b.setAttribute('aria-selected', String(b === m)));
        $('.cm-new', sh.el).hidden = mode !== 'new';
        $('.cm-add', sh.el).hidden = mode !== 'add';
        if (mode === 'add') { drawList(); $('#cpQ', sh.el).focus(); }
        return;
      }
      const ps = e.target.closest('[data-cps]');
      if (ps) { picked = others.find(s => s.id === ps.dataset.cps); drawList(); return; }
      const b = e.target.closest('[data-cp]');
      if (!b) return;
      if (b.dataset.cp === 'no') { sh.close(null); return; }
      let sec;
      if (mode === 'new') {
        const title = $('#cpTitle', sh.el).value.trim();
        if (!title) { toast('Scrivi il nome della scheda'); $('#cpTitle', sh.el).focus(); return; }
        const type = $('#cpType', sh.el).value;
        S()[`cropType_${kind}`] = type;
        Settings.save();
        const nb = await ensureSpecialNb(cfg);
        const parts = cfg.parts(type);
        sec = newSection(nb.id, { title, md: parts.map((p, i) => `## ${p}\n\n`).join('') });
        sec.sp = { type, group: $('#cpGroup', sh.el).value.trim(), links: [] };
        sec.tags = parseTags($('#cpTags', sh.el).value);
        const im = await saveImage(await canvasToImage(canvas, 0.9), nb.id);
        if (origin) await setImageSource(im, origin.pdf, origin.page, origin.box);
        // l’immagine sotto la prima parte (Immagine, Tracciato…)
        sec.md = sec.md.replace(`## ${parts[0]}\n\n`, `## ${parts[0]}\n\n${imageMd(im.id, source)}\n\n`);
        sec.sources = [source];
        await saveSection(sec);
        const lab = $('#cpLab', sh.el)?.checked;
        sh.close(sec);
        toast(`Scheda “${title}” nell’${cfg.name.toLowerCase()}`, '', { label: 'Apri', fn: () => go(`#/sec/${sec.id}/read`) });
        // dopo che la scheda si è chiusa, se no la chiusura toglierebbe anche l’editor
        if (lab) setTimeout(() => openLabelEditor(sec, im.id), 400);
        return;
      }
      if (!picked) { toast('Tocca la scheda a cui aggiungerlo'); return; }
      sec = picked;
      const im = await saveImage(await canvasToImage(canvas, 0.9), sec.notebookId);
      if (origin) await setImageSource(im, origin.pdf, origin.page, origin.box);
      const head = (cfg.parts(sec.sp?.type)[0]) || 'Immagini';
      await appendImagesUnder(sec, head, [imageMd(im.id, source)]);
      sec.sources = [...new Set([...sourcesOf(sec), source])];
      await saveSection(sec);
      const lab = $('#cpLab', sh.el)?.checked;
      sh.close(sec);
      toast(`Immagine aggiunta a “${sec.title}”`, '', { label: 'Apri', fn: () => go(`#/sec/${sec.id}/read`) });
      if (lab) setTimeout(() => openLabelEditor(sec, im.id), 400);
    });
    $('#cpQ', sh.el).addEventListener('input', drawList);
    setTimeout(() => $('#cpTitle', sh.el)?.focus(), 40);
  });
}
