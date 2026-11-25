'use strict';
/* StudyHub Notebook — 02-notebook.js
   Notebook e sezioni: elenchi, modalità di studio (Cloze, Leggi, Orale, Pagina bianca, Domande, Mappe, Video, Audio, Modifica), importazione, scrittura a mano, etichette.
   I moduli si caricano in ordine (vedi index.html) e condividono le stesse variabili globali. */

/* ---------------------------------------------------------------------
   Vista: elenco notebook
   --------------------------------------------------------------------- */
/* v3.94: “Adesso”: una sola cosa da fare, con il tempo che serve. “Altro” passa alla successiva. */
let nowSkip = 0;
function nextActions() {
  const out = [];
  const mins = m => { const n = Math.max(1, Math.round(m)); return n >= 60 ? `circa ${Math.floor(n / 60)} h ${n % 60 ? `${n % 60} min` : ''}`.trim() : `circa ${n} min`; };
  const cc = cardCounts(state.cards);
  if (cc.l) out.push({ t: cc.l === 1 ? 'Riprendi la flashcard che è tornata' : `Riprendi le ${cc.l} flashcard che sono tornate`, s: `In apprendimento · ${mins(cc.l * 0.3)}`, href: '#/study/all/ripassa', go: 'Inizia' });
  const due = state.sections.filter(isDue);
  if (due.length) {
    const n = Math.min(due.length, 5);
    out.push({ t: due.length === 1 ? `Ripassa “${due[0].title}”` : `Ripassa ${n === due.length ? `${n} sezioni` : `le prime ${n} sezioni di ${due.length}`}`, s: `In scadenza oggi · ${mins(n * 4)}`, href: '#/review', go: 'Inizia' });
  }
  if (cc.r) { const n = Math.min(cc.r, 40); out.push({ t: `Ripassa ${n === cc.r ? n : `${n} di ${cc.r}`} flashcard`, s: `In scadenza · ${mins(n * 0.25)}`, href: '#/study/all/ripassa', go: 'Inizia' }); }
  // l’esame più vicino: l’argomento che conta di più e su cui sei meno pronta
  const today = todayStr();
  const preps = state.links.filter(l => l.kind === 'examprep' && l.date && l.date >= today && dayDiff(today, l.date) <= 60 && eqOfSubj(l.subjKey).length)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const p of preps.slice(0, 2)) {
    const top = eqPriorities(p.subjKey).find(o => o.r < 0.7);
    if (!top) continue;
    const d = dayDiff(today, p.date);
    const when = `${eqSubjLabel(p.subjKey)}, ${d === 0 ? 'esame oggi' : `esame tra ${d} ${d === 1 ? 'giorno' : 'giorni'}`}`;
    const sec = top.secs[0];
    const fresh = sec && !(sec.srs?.history || []).length && !sec.studyhub;
    if (sec && fresh) out.push({ t: `Studia “${sec.title}”`, s: `${when}: esce spesso e non l’hai ancora studiata · ${mins(aiText(sec.md || '').split(/\s+/).length / 150 + 2)}`, href: `#/sec/${sec.id}/read`, go: 'Apri' });
    else out.push({ t: `Fatti interrogare: ${top.x.q.length > 70 ? `${top.x.q.slice(0, 69)}…` : top.x.q}`, s: `${when}: è l’argomento su cui sei più indietro · ${mins(6)}`, href: `#/viva/examq/${top.x.id}`, go: 'Inizia' });
  }
  const r = Resume.target();
  if (r) out.push({ t: `Continua “${r.sec.title}”`, s: 'Da dove eri rimasta', href: '#/resume', go: 'Riprendi' });
  const ib = inboxItems().length;
  if (ib) out.push({ t: ib === 1 ? 'Sistema l’appunto preso al volo' : `Sistema i ${ib} appunti presi al volo`, s: `Da sistemare · ${mins(ib)}`, href: '#/inbox', go: 'Apri' });
  if (cc.n) { const n = Math.min(cc.n, 20); out.push({ t: n === 1 ? 'Studia la flashcard nuova' : `Studia ${n} flashcard nuove`, s: `Nuove di oggi · ${mins(n * 0.5)}`, href: '#/study/all', go: 'Inizia' }); }
  return out;
}
function nowCardHtml() {
  const list = nextActions();
  if (!list.length) return state.sections.length ? '<div class="now-card done"><span class="now-main"><span class="now-k">Adesso</span><span class="now-t">Per oggi sei a posto</span><span class="now-s">Niente in scadenza: puoi fermarti, oppure studiare qualcosa di nuovo.</span></span></div>' : '';
  const a = list[nowSkip % list.length];
  return `<div class="now-card">
    <span class="now-main"><span class="now-k">Adesso${list.length > 1 ? ` · ${(nowSkip % list.length) + 1} di ${list.length}` : ''}</span><span class="now-t">${esc(a.t)}</span><span class="now-s">${esc(a.s)}</span></span>
    <span class="now-acts">${list.length > 1 ? '<button class="btn sm ghost" type="button" data-act="now-next" title="Proponimi un’altra cosa">Altro</button>' : ''}<a class="btn primary" href="${a.href}">${a.go}</a></span>
  </div>`;
}
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
    ${DataGuard.bannerHtml()}
    ${Resume.target() ? `<a class="resume-card" href="#/resume"><span class="resume-ic" aria-hidden="true">↺</span><span class="row-main"><span class="row-sub">Riprendi da dove eri</span><span class="row-title">${esc(Resume.target().sec.title)}</span></span></a>` : ''}
    ${nbs.length ? nowCardHtml() : ''}
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
  on('[data-act="now-next"]', 'click', () => { nowSkip++; const y = window.scrollY; viewNotebooks(); window.scrollTo(0, y); });
  const gs = $('#globalSearch');
  if (gs && $('#searchOut')) bindUnifiedSearch(gs, $('#searchOut'), $('#nbList'));
}

/* ---------------------------------------------------------------------
   Vista: un notebook
   --------------------------------------------------------------------- */
// v3.57: il primo livello (i macro-argomenti) è fatto di cartelle: le apri e dentro trovi
// le sezioni e i sottoargomenti. “#/nb/<id>/<cartella>” è la pagina di una cartella.
// v4.03: come le cartelle del computer: ogni cartella può contenere sezioni (i file) e altre
// cartelle, senza limite di livelli; si entra con un tocco e il percorso in alto riporta indietro.
const FOLDER_SVG = '<svg class="fc-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.2h7A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>';
function viewNotebook(id, folderId = '') {
  const nb = nbById(id);
  if (!nb) return notFound('Questo notebook');
  if (nb.kind === 'cases') { location.replace('#/cases'); return; }
  if (nb.kind === 'semei') { location.replace('#/semei'); return; }
  if (SPECIALS[nb.kind]) { location.replace(`#/${SPECIALS[nb.kind].route}`); return; }
  if (nb.kind === 'papers') { location.replace('#/papers'); return; }
  const secs = secsOf(id);
  const due = secs.filter(isDue).length;
  const nbCards = cardsOf(id);
  const groups = groupsOf(nb);
  const gIds = new Set(groups.map(g => g.id));
  const loose = secs.filter(s => !gIds.has(s.groupId));
  const folder = folderId ? groups.find(g => g.id === folderId) || null : null;
  if (folderId && !folder) { location.replace(`#/nb/${id}`); return; }
  const foldKey = `nb:${id}`;
  const closed = new Set(foldGet(foldKey));
  const nWord = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const lede = [
    nWord(secs.length, 'sezione', 'sezioni'),
    groups.length ? nWord(groups.length, 'cartella', 'cartelle') : '',
    due ? `${due} da ripassare oggi` : '',
    nbCards.length ? `${nbCards.length} flashcard` : ''
  ].filter(Boolean).join(', ');
  const folderCard = g => {
    const tree = groupTreeIds(nb, g);
    const all = secs.filter(s => tree.has(s.groupId));
    const subs = subGroups(nb, g);
    const gd = all.filter(isDue).length;
    const meta = [all.length ? nWord(all.length, 'sezione', 'sezioni') : (subs.length ? '' : 'Vuota'), subs.length ? nWord(subs.length, 'cartella', 'cartelle') : ''].filter(Boolean).join(' · ');
    return `<div class="folder-card" role="link" tabindex="0" data-open="${g.id}" aria-label="Apri la cartella ${esc(g.name)}">
      <div class="fc-top">
        ${FOLDER_SVG}
        <span class="fc-right">
          ${gd ? `<span class="pill due" title="${gd === 1 ? '1 sezione da ripassare oggi' : `${gd} sezioni da ripassare oggi`}">${gd}</span>` : ''}
          <button class="btn ghost sm grp-more" type="button" data-gmenu="${g.id}" aria-label="Opzioni per ${esc(g.name)}">⋯</button>
        </span>
      </div>
      <div class="fc-main">
        <span class="fc-name">${esc(g.name)}</span>
        <span class="fc-meta">${meta}</span>
      </div>
    </div>`;
  };
  if (folder) {
    // pagina della cartella: prima le cartelle che contiene, poi le sue sezioni
    const tree = groupTreeIds(nb, folder);
    const fsecs = secs.filter(s => tree.has(s.groupId));
    const own = secs.filter(s => s.groupId === folder.id);
    const subs = subGroups(nb, folder);
    const fdue = fsecs.filter(isDue).length;
    const anc = groupAncestors(nb, folder);
    const crumbs = [`<a href="#/nb/${id}">${esc(nb.name)}</a>`, ...anc.map(a => `<a href="#/nb/${id}/${a.id}">${esc(a.name)}</a>`)].join('<span class="fp-sep" aria-hidden="true">›</span>');
    setView(`
      <nav class="back folder-path" aria-label="Percorso">${crumbs}</nav>
      <header class="page-head nb-head">
        <div class="nb-head-info">
          <h1 class="folder-h1">${FOLDER_SVG}<span>${esc(folder.name)}</span></h1>
          <p class="lede">${[nWord(fsecs.length, 'sezione', 'sezioni'), subs.length ? nWord(subs.length, 'cartella', 'cartelle') : '', fdue ? `${fdue} da ripassare oggi` : ''].filter(Boolean).join(' · ')}</p>
        </div>
        <div class="nb-actbar">
          <div class="nb-actgrp">
            <button class="btn primary" data-act="new-sec-here">＋ Nuova sezione</button>
            <button class="btn" data-act="new-sub-here">＋ Cartella</button>
            <button class="btn" data-act="html-here" title="Carica uno o più file HTML: ognuno diventa una sezione">＋ Mappa HTML</button>
            <a class="btn" href="#/import/${id}/${folder.id}">Importa</a>
          </div>
          <div class="nb-actgrp is-study">
            ${fsecs.length ? `<a class="btn" href="#/viva/grp/${folder.id}">Interrogami</a><a class="btn" href="#/dquiz/grp/${folder.id}" title="Quiz di discriminazione su tutte le sezioni della cartella">Quiz</a>` : ''}
            ${clipsForGroup(folder).length ? `<a class="btn" href="#/raccolta/g/${folder.id}">📌 Raccolta (${clipsForGroup(folder).length})</a>` : ''}
            <button class="btn ghost" type="button" data-gmenu="${folder.id}">Opzioni ⋯</button>
          </div>
        </div>
      </header>
      ${fsecs.length > 3 ? '<input type="search" class="input search" id="secSearch" placeholder="Cerca in questa cartella…" aria-label="Cerca in questa cartella">' : ''}
      <div id="nbFound" hidden></div>
      <div id="nbBody">
        ${subs.length ? `<section class="nb-blk"><h2 class="sub nb-sub">Cartelle <span class="muted-inline">(${subs.length})</span></h2><div class="folder-grid">${subs.map(folderCard).join('')}</div></section>` : ''}
        ${own.length ? `<section class="grp-loose nb-blk">${subs.length ? `<h2 class="sub nb-sub">Sezioni <span class="muted-inline">(${own.length})</span></h2>` : ''}<ul class="list sec-list">${own.map(s => sectionRow(s)).join('')}</ul></section>` : ''}
        ${own.length || subs.length ? '' : `
          <div class="empty">
            <p>Cartella vuota. Scrivi una sezione, carica una mappa HTML, importa qui un testo o un PDF, crea un’altra cartella dentro, oppure sposta qui sezioni che hai già.</p>
            <button class="btn" type="button" data-gadd="${folder.id}">Aggiungi sezioni esistenti</button>
          </div>`}
      </div>
      <p class="hint" id="noMatch" hidden>Nessuna sezione contiene questo testo.</p>
    `);
  } else setView(`
    <a class="back" href="#/notebooks">Tutti i notebook</a>
    <header class="page-head nb-head">
      <div class="nb-head-info">
        <h1>${esc(nb.name)}</h1>
        <p class="lede">${lede}</p>
      </div>
      <div class="nb-actbar">
        <div class="nb-actgrp">
          <a class="btn primary" href="#/import/${nb.id}">Importa</a>
          <button class="btn" data-act="new-sec">＋ Nuova sezione</button>
          <button class="btn" data-act="new-grp">＋ Cartella</button>
          <button class="btn" data-act="html-here" title="Carica uno o più file HTML: ognuno diventa una sezione">＋ Mappa HTML</button>
        </div>
        <div class="nb-actgrp is-study">
          ${nbCards.length ? `<a class="btn" href="#/deck/${nb.id}">Flashcard</a>` : ''}
          <a class="btn" href="#/pdfs/nb/${nb.id}">PDF${state.pdfs.some(p => p.notebookId === nb.id) ? ` (${state.pdfs.filter(p => p.notebookId === nb.id).length})` : ''}</a>
          <a class="btn" href="#/lezioni/${nb.id}">Lezioni${(nb.audios || []).length ? ` (${nb.audios.length})` : ''}</a>
          ${clipsForNb(nb).length ? `<a class="btn" href="#/raccolta/nb/${nb.id}">📌 Raccolta (${clipsForNb(nb).length})</a>` : ''}
          ${secs.length ? `<a class="btn" href="#/dquiz/nb/${nb.id}" title="Quiz di discriminazione scegliendo sezioni e paragrafi">Quiz</a><a class="btn" href="#/exam/${nb.id}">Simulazione</a>` : ''}
          <button class="btn ghost" data-act="nb-more">Altro ⋯</button>
        </div>
      </div>
    </header>
    ${typeof eqPrepBanner === 'function' ? eqPrepBanner(nb.id) : ''}
    ${secs.length > 3 ? '<input type="search" class="input search" id="secSearch" placeholder="Cerca nel notebook…" aria-label="Cerca nel notebook">' : ''}
    <div id="nbFound" hidden></div>
    <div id="nbBody">
      ${topGroups(nb).length ? `<section class="nb-blk"><h2 class="sub nb-sub">Cartelle <span class="muted-inline">(${topGroups(nb).length})</span></h2><div class="folder-grid">${topGroups(nb).map(folderCard).join('')}</div></section>` : ''}
      ${loose.length ? `
        <section class="grp-loose nb-blk">
          ${groups.length ? `<h2 class="sub nb-sub">Sezioni <span class="muted-inline">(${loose.length})</span></h2>` : ''}
          <ul class="list sec-list">${loose.map(s => sectionRow(s)).join('')}</ul>
        </section>` : ''}
      ${!secs.length && !groups.length ? `
        <div class="empty">
          <p>Notebook vuoto. Importa testo o un PDF, carica una mappa HTML, oppure scrivi una sezione a mano. Con le cartelle raggruppi le sezioni come sul computer: dentro una cartella puoi metterne altre, quante vuoi.</p>
          <a class="btn primary" href="#/import/${nb.id}">Importa</a>
          <button class="btn" data-act="new-grp">Nuova cartella</button>
        </div>` : ''}
    </div>
    <p class="hint" id="noMatch" hidden>Nessuna sezione contiene questo testo.</p>
  `);

  const box = $('#nbBody');
  // cartelle: un tocco le apre (non sul pulsante delle opzioni)
  box.addEventListener('click', e => {
    const fc = e.target.closest('[data-open]');
    if (!fc || e.target.closest('[data-gmenu]')) return;
    go(`#/nb/${id}/${fc.dataset.open}`);
  });
  box.addEventListener('keydown', e => { const fc = e.target.closest('[data-open]'); if (fc && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(`#/nb/${id}/${fc.dataset.open}`); } });
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
    toast(`${ids.length} ${ids.length === 1 ? 'sezione spostata' : 'sezioni spostate'} in ${g.name}`);
    route();
    return true;
  };

  on('[data-act="new-sec"]', 'click', () => newSecIn(null));
  on('[data-act="new-sec-here"]', 'click', () => newSecIn(folder.id));
  on('[data-act="html-here"]', 'click', () => addHtmlSections(nb, folder ? folder.id : null));
  on('[data-act="new-sub-here"]', 'click', async () => { const g = await createGroupFlow(nb, folder.id); if (g) { toast('Cartella creata'); route(); } });
  on('[data-act="new-grp"]', 'click', async () => {
    const g = await createGroupFlow(nb);
    if (!g) return;
    toast('Cartella creata');
    const moved = loose.length ? await addSectionsTo(g) : false;
    if (!moved) route();
  });
  on('[data-gadd]', 'click', e => {
    const g = groups.find(x => x.id === e.currentTarget.dataset.gadd);
    if (g) addSectionsTo(g);
  });
  on('[data-gmenu]', 'click', async e => {
    e.stopPropagation();
    const gi = groups.findIndex(x => x.id === e.currentTarget.dataset.gmenu);
    const g = groups[gi];
    if (!g) return;
    const parent = groupParent(nb, g);
    const sibs = groups.filter(x => (groupParent(nb, x)?.id || null) === (parent ? parent.id : null));
    const si = sibs.indexOf(g);
    const nIn = secs.filter(s => s.groupId === g.id).length;
    const kids = subGroups(nb, g);
    const choice = await actionSheet(g.name, [
      ...(folder && folder.id === g.id ? [] : [{ key: 'open', label: 'Apri' }]),
      { key: 'add', label: 'Aggiungi sezioni esistenti' },
      { key: 'write', label: 'Scrivi una sezione qui' },
      { key: 'sub', label: 'Nuova cartella qui dentro' },
      { key: 'html', label: 'Carica una mappa HTML qui' },
      { key: 'import', label: 'Importa qui' },
      ...(secs.length >= 2 ? [{ key: 'merge', label: '🔀 Unisci sezioni (con AI o manuale)' }] : []),
      { key: 'exam', label: 'Simulazione d’esame su questa cartella' },
      { key: 'listen', label: 'Ascolta in sequenza' },
      { key: 'rename', label: 'Rinomina' },
      { key: 'move', label: 'Sposta in un’altra cartella' },
      { key: 'up', label: 'Sposta su', disabled: si <= 0 },
      { key: 'down', label: 'Sposta giù', disabled: si === sibs.length - 1 },
      { key: 'delete', label: 'Elimina la cartella', danger: true }
    ]);
    if (choice === 'open') return go(`#/nb/${id}/${g.id}`);
    if (choice === 'sub') {
      const sg = await createGroupFlow(nb, g.id);
      if (!sg) return;
      toast('Cartella creata');
      const moved = secs.some(s => s.groupId === g.id) ? await addSectionsTo(sg) : false;
      if (!moved) route();
      return;
    }
    if (choice === 'add') return addSectionsTo(g);
    if (choice === 'write') return newSecIn(g.id);
    if (choice === 'html') return addHtmlSections(nb, g.id);
    if (choice === 'import') return go(`#/import/${id}/${g.id}`);
    if (choice === 'merge') return mergeSectionsFlow({ nb, folder: g });
    if (choice === 'exam') { examRun = null; return go(`#/exam/${id}/${g.id}`); }
    if (choice === 'listen') {
      const ids = groupTreeIds(nb, g);
      return Playlist.start(nbReadingOrder(nb).filter(s => ids.has(s.groupId)), g.name);
    }
    if (choice === 'move') {
      // può andare in qualunque cartella che non sia lei stessa o una di quelle che contiene
      const own = groupTreeIds(nb, g);
      const pathName = x => [...groupAncestors(nb, x), x].map(y => y.name).join(' › ');
      const cands = groups.filter(x => !own.has(x.id) && x.id !== parent?.id)
        .sort((a, b) => pathName(a).localeCompare(pathName(b), 'it', { numeric: true }));
      const opts = [
        ...(parent ? [{ key: '__top', label: `Direttamente nel notebook ${nb.name}` }] : []),
        ...cands.map(x => ({ key: x.id, label: pathName(x) }))
      ];
      if (!opts.length) { toast('Non c’è un’altra cartella in cui spostarla'); return; }
      const to = await actionSheet(`Sposta “${g.name}” in…`, opts);
      if (!to) return;
      if (to === '__top') delete g.parentId; else g.parentId = to;
      await saveNotebook(nb);
      toast(to === '__top' ? `Ora è direttamente in ${nb.name}` : `Spostata in ${groups.find(x => x.id === to)?.name}`);
      return route();
    }
    if (choice === 'rename') {
      const name = await modal({ title: 'Rinomina la cartella', input: true, value: g.name, confirm: 'Rinomina' });
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
      const where = parent ? `nella cartella ${parent.name}` : 'direttamente nel notebook';
      const ok = await modal({
        title: 'Eliminare la cartella?',
        text: [
          nIn ? `${nIn === 1 ? 'La sua sezione passa' : `Le sue ${nIn} sezioni passano`} ${where}.` : 'Non perdi nessuna sezione.',
          kids.length ? `${kids.length === 1 ? 'La cartella che contiene passa' : `Le ${kids.length} cartelle che contiene passano`} ${where}, con tutto quello che ${kids.length === 1 ? 'ha' : 'hanno'} dentro.` : ''
        ].filter(Boolean).join(' '),
        confirm: 'Elimina', danger: true
      });
      if (!ok) return;
      for (const s of secs.filter(x => x.groupId === g.id)) { s.groupId = parent ? parent.id : null; await saveSection(s); }
      kids.forEach(k => { if (parent) k.parentId = parent.id; else delete k.parentId; });
      nb.groups = groups.filter(x => x.id !== g.id);
      await saveNotebook(nb);
      foldSet(foldKey, foldGet(foldKey).filter(x => x !== g.id));
      toast('Cartella eliminata');
      // se eri dentro la cartella eliminata, torni a quella che la conteneva
      if (folder && folder.id === g.id) return go(parent ? `#/nb/${id}/${parent.id}` : `#/nb/${id}`);
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
      { key: 'listen', label: 'Ascolta tutto il notebook' },
      { key: 'print', label: 'Stampa o salva in PDF' },
      { key: 'graph', label: 'Mappa dei collegamenti (sezioni, lezioni, domande d’esame)' },
      ...(secs.length >= 2 ? [{ key: 'merge', label: '🔀 Unisci più sezioni (con AI o manuale)' }] : []),
      { key: 'compare', label: 'Tabella di confronto tra sezioni' },
      { key: 'ask', label: 'Chiedi alle fonti di questo notebook' },
      { key: 'formato', label: 'Controlla il formato degli appunti' },
      { key: 'viva', label: 'Interrogazione con l’AI su tutto il notebook' },
      { key: 'rename', label: 'Rinomina il notebook' },
      { key: 'delete', label: 'Elimina il notebook', danger: true }
    ]);
    if (choice === 'listen') Playlist.start(nbReadingOrder(nb), nb.name);
    if (choice === 'graph') go(`#/graph/${nb.id}`);
    if (choice === 'merge') mergeSectionsFlow({ nb });
    if (choice === 'compare') compareFlow(nb);
    if (choice === 'ask') go(`#/ask/${nb.id}`);
    if (choice === 'formato') go(`#/formato/${nb.id}`);
    if (choice === 'print') go(`#/print/nb/${nb.id}`);
    if (choice === 'viva') go(`#/viva/nb/${nb.id}`);
    if (choice === 'rename') renameNb();
    if (choice === 'delete') deleteNb();
  });
  const search = $('#secSearch');
  if (search) {
    // si cerca in tutto quello che sta qui dentro, a qualunque livello: cartelle per nome, sezioni per titolo e testo
    const tree = folder ? groupTreeIds(nb, folder) : null;
    const pool = tree ? secs.filter(s => tree.has(s.groupId)) : secs;
    const gPool = tree ? groups.filter(g => tree.has(g.id) && g.id !== folder.id) : groups;
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      const found = $('#nbFound');
      box.hidden = !!q;
      found.hidden = !q;
      if (!q) { $('#noMatch').hidden = true; return; }
      const gHits = gPool.filter(g => matchTokens(g.name, q));
      const hits = pool.filter(s => matchTokens(`${s.title}\n${groupPathText(s)}\n${stripCloze(s.md)}\n${htmlsOf(s).map(h => h.name).join('\n')}`, q));
      found.innerHTML = (gHits.length ? `<div class="folder-grid">${gHits.slice(0, 60).map(g => folderCard(g).replace(/<button[\s\S]*?<\/button>/, '')).join('')}</div>` : '')
        + (hits.length ? `<ul class="list sec-list">${hits.slice(0, 200).map(s => sectionRow(s, { showNb: true })).join('')}</ul>` : '');
      $('#noMatch').hidden = hits.length + gHits.length > 0;
    });
    const found = $('#nbFound');
    found.addEventListener('click', e => {
      const fc = e.target.closest('[data-open]');
      if (fc && !e.target.closest('[data-gmenu]')) go(`#/nb/${id}/${fc.dataset.open}`);
    });
  }
}

async function createGroupFlow(nb, parentId = null) {
  const parent = parentId ? groupsOf(nb).find(x => x.id === parentId) : null;
  const name = await modal(parent ? {
    title: 'Nuova cartella',
    text: `Dentro ${[...groupAncestors(nb, parent), parent].map(x => x.name).join(' › ')}. Ci metti sezioni, mappe HTML e altre cartelle, quante vuoi.`,
    input: true, placeholder: 'Es. Valvulopatie', confirm: 'Crea'
  } : {
    title: 'Nuova cartella',
    text: 'Per esempio un apparato o un capitolo. Dentro ci metti sezioni, mappe HTML e altre cartelle, quante vuoi, come sul computer.',
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

// Scelta delle sezioni da mettere in un macro-argomento (con barra di ricerca)
function pickSectionsSheet(nb, g) {
  return new Promise(resolve => {
    const root = $('#modalRoot');
    const others = secsOf(nb.id).filter(s => s.groupId !== g.id);
    const where = s => groupPathText(s);
    const picked = new Set();
    root.innerHTML = `
      <div class="overlay">
        <div class="modal sheet" role="dialog" aria-modal="true" aria-labelledby="psTitle">
          <h2 id="psTitle">Aggiungi a ${esc(g.name)}</h2>
          ${others.length ? `
            <p class="sheet-sub">Scegli le sezioni da spostare qui.</p>
            <input type="search" class="input search" id="psFilterQ" placeholder="Cerca per titolo o cartella…" aria-label="Cerca tra le sezioni">
            <ul class="cand pick-list" id="psCandList"></ul>` : '<p>Tutte le sezioni del notebook sono già qui.</p>'}
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
    const listEl = $('#psCandList', root);
    const qEl = $('#psFilterQ', root);
    const updateBtn = () => { if (okBtn) okBtn.textContent = picked.size ? `Aggiungi (${picked.size})` : 'Aggiungi'; };
    const draw = () => {
      if (!listEl) return;
      const q = qEl ? qEl.value : '';
      const vis = others.filter(s => matchTokens(`${s.title} ${where(s)}`, q));
      listEl.innerHTML = vis.map(s => `
        <li><label class="check"><input type="checkbox" value="${s.id}" ${picked.has(s.id) ? 'checked' : ''}>
          <span><span class="cand-f">${esc(s.title)}</span>${where(s) ? `<span class="cand-b">Ora in ${esc(where(s))}</span>` : ''}</span></label></li>`).join('')
        || '<li class="hint">Nessuna sezione trovata.</li>';
      updateBtn();
    };
    if (others.length) {
      draw();
      qEl?.addEventListener('input', draw);
      listEl.addEventListener('change', e => {
        const inp = e.target.closest('input[type="checkbox"]');
        if (!inp) return;
        if (inp.checked) picked.add(inp.value); else picked.delete(inp.value);
        updateBtn();
      });
      setTimeout(() => qEl?.focus(), 40);
    }
    if (okBtn) okBtn.onclick = () => {
      const ids = [...picked];
      if (!ids.length) { toast('Scegli almeno una sezione'); return; }
      close(ids);
    };
  });
}

/* ---------------------------------------------------------------------
   Vista: sezione con le modalità di studio
   --------------------------------------------------------------------- */
const MODES = [['cloze', 'Cloze'], ['read', 'Leggi'], ['map', 'Mappe'], ['html', 'Mappe HTML'], ['papers', 'Articoli'], ['blank', 'Pagina bianca'], ['oral', 'Orale'], ['quiz', 'Domande'], ['dquiz', 'Quiz'], ['cards', 'Flashcard'], ['video', 'Video'], ['audio', 'Audio'], ['edit', 'Modifica']];

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
  // appunti già salvati con un cloze rimasto aperto o tabelle spezzate da NotebookLM: li sistemo una volta
  if (mode !== 'edit' && typeof sec.md === 'string') {
    const fixedCloze = repairClozes(sec.md);
    const fixedTbl = cleanSimpleTex(repairMarkdownTables(fixedCloze));
    if (fixedTbl !== sec.md) {
      const msg = fixedCloze !== sec.md ? 'Ho chiuso un cloze rimasto aperto in questa sezione' : 'Ho sistemato automaticamente le tabelle in questa sezione';
      saveSection(sec).then(() => { toast(msg); route(); });
      return;
    }
  }
  const caseSec = isCase(sec);
  const semSec = isSemei(sec);
  const spCfg = specialOf(sec);
  const modes = caseSec ? [['case', 'Risolvi'], ...MODES] : MODES;
  if (!modes.some(([m]) => m === mode)) mode = openMode(sec);
  const nb = nbById(sec.notebookId);
  const crumb = state.fromReview
    ? '<a class="back" href="#/review">Ripasso</a>'
    : caseSec ? '<a class="back" href="#/cases">Casi clinici</a>'
    : semSec ? '<a class="back" href="#/semei">Semeiotica</a>'
    : spCfg ? `<a class="back" href="#/${spCfg.route}">${esc(spCfg.name)}</a>`
    : `<a class="back" href="#/nb/${sec.notebookId}${groupOf(sec) ? `/${groupOf(sec).id}` : ''}">${esc(nb ? nb.name : 'Notebook')}${groupPathText(sec) ? ` › ${esc(groupPathText(sec))}` : ''}</a>`;
  // “Torna a…”: la pagina da cui sei arrivato, se non è già quella del percorso
  const from = Nav.from();
  const crumbHref = state.fromReview ? '#/review' : caseSec ? '#/cases' : semSec ? '#/semei' : spCfg ? `#/${spCfg.route}` : `#/nb/${sec.notebookId}${groupOf(sec) ? `/${groupOf(sec).id}` : ''}`;
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
      ${semSec && semeiMetaBits(sec).length ? `<p class="meta case-meta">${esc(semeiMetaBits(sec).join(' · '))}</p>` : ''}
      ${spCfg && specialMetaBits(sec).length ? `<p class="meta case-meta">${esc(specialMetaBits(sec).join(' · '))}</p>` : ''}
      ${spCfg && (sec.sp?.links || []).map(secById).filter(Boolean).length ? `<p class="meta sp-linked">Collegata a: ${(sec.sp.links || []).map(secById).filter(Boolean).map(x => `<a href="#/sec/${x.id}/read">${esc(x.title)}</a>`).join(', ')}</p>` : ''}
      <p class="meta">${esc(srsLabel(sec))}</p>
      ${sec.incomplete ? `<button class="inc-chip" type="button" data-act="inc" title="Cosa manca">⚠ Incompleta${incompleteNote(sec) ? `: ${esc(incompleteNote(sec).slice(0, 60))}${incompleteNote(sec).length > 60 ? '…' : ''}` : ''}</button>` : ''}
      ${tagChips(tagsOf(sec))}
      <div class="sec-extra">
        ${caseSec ? '<button class="btn sm" type="button" data-act="case-meta">Dati del caso</button><button class="btn sm" type="button" data-act="case-photo">＋ Foto</button><button class="btn sm" type="button" data-act="case-pdf">＋ PDF</button>' : ''}
        ${semSec ? '<button class="btn sm" type="button" data-act="semei-meta">Dati della scheda</button><button class="btn sm" type="button" data-act="case-photo">＋ Foto</button>' : ''}
        ${spCfg ? `<button class="btn sm" type="button" data-act="sp-meta">${spCfg.kind === 'diary' ? 'Dati della giornata' : 'Dati della scheda'}</button><button class="btn sm" type="button" data-act="case-photo">＋ Foto</button>` : ''}
        <a class="btn sm" href="#/pdfs/${sec.id}">PDF${pdfsOf(sec.id).length + pdfRefsOf(sec).length ? ` (${pdfsOf(sec.id).length + pdfRefsOf(sec).length})` : ''}</a>
        ${clipsForSec(sec).length ? `<a class="btn sm" href="#/raccolta/sec/${sec.id}" title="Dalla Raccolta: elementi con un tag uguale al titolo o ai tag della sezione">📌 Raccolta (${clipsForSec(sec).length})</a>` : ''}
        <a class="btn sm" href="#/split" title="Apri di fianco un’altra sezione o un PDF">⇆ Affianca</a>
        ${sec.md.trim() ? `<a class="btn sm" href="#/print/sec/${sec.id}" title="Stampa la sezione o salvala in PDF">Stampa</a>` : ''}
        ${sec.md.trim().length > 150 ? `<a class="btn sm" href="#/viva/sec/${sec.id}" title="Il professore (l’AI) ti interroga su questa sezione">Interrogami</a>` : ''}
        ${Focus.on() ? '' : '<button class="btn sm" type="button" data-act="focus" title="Un obiettivo e un timer: il menu sparisce finché non hai finito">🎯 Fuoco</button>'}
        ${nb && secsOf(nb.id).length >= 2 ? '<button class="btn sm" type="button" data-act="merge-sec" title="Unisci questa sezione con una o più sezioni doppie o correlate">🔀 Unisci</button>' : ''}
        ${(sec.studyhub || sec.srs?.due || (sec.srs?.history && sec.srs.history.length) || addReviewsOf(sec).length || sec.md.trim()) ? '<button class="btn sm" type="button" data-act="srs-manage" title="Gestisci il ripasso o crea un ripasso a parte per nuove aggiunte">↺ Ripasso</button>' : ''}
        ${imageRefs(sec.md).some(x => imageById(x)) ? `<button class="btn sm" type="button" data-act="labels" title="Rimetti le etichette sugli schemi">Etichette${labelImages(sec).length ? ` (${labelImages(sec).length})` : ''}</button>` : ''}
        ${secLinksOf(sec).map(l => `<a class="btn sm ghost sec-link" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">↗ ${esc(l.title)}</a>`).join('')}
      </div>
    </header>
    ${(() => {
      const ord = typeof TabCfg !== 'undefined' ? TabCfg.ordered(modes) : modes;
      const moreSet = typeof TabCfg !== 'undefined' ? TabCfg.moreSet() : new Set();
      let vis = ord.filter(([m]) => !moreSet.has(m));
      let hid = ord.filter(([m]) => moreSet.has(m));
      if (!vis.length) { vis = ord; hid = []; }
      const tabLabel = (m, l) => `${l}${m === 'video' && videosOf(sec).length ? ` (${videosOf(sec).length})` : ''}${m === 'html' && htmlsOf(sec).length ? ` (${htmlsOf(sec).length})` : ''}${m === 'papers' && papersOfSec(sec).length ? ` (${papersOfSec(sec).length})` : ''}`;
      const activeHid = hid.find(([m]) => m === mode);
      return `<nav class="tabs" aria-label="Modalità di studio">
        ${vis.map(([m, l]) => `<a href="#/sec/${id}/${m}" class="tab ${m === mode ? 'on' : ''}" ${m === mode ? 'aria-current="page"' : ''}>${tabLabel(m, l)}</a>`).join('')}
        ${hid.length ? `<button type="button" class="tab tab-more${activeHid ? ' on' : ''}" data-act="tab-more">${activeHid ? `${tabLabel(activeHid[0], activeHid[1])} ▾` : `Altro (${hid.length}) ▾`}</button>` : ''}
        <button type="button" class="tab tab-cfg" data-act="tab-cfg" title="Personalizza ordine e schede visibili" aria-label="Personalizza schede">⚙</button>
      </nav>`;
    })()}
    <section id="modeBody" class="mode-body"></section>
    ${prevSec || nextSec ? `
      <nav class="sec-pager" aria-label="Sezioni vicine">
        ${prevSec ? `<a class="pg pg-prev" href="#/sec/${prevSec.id}" rel="prev"><span class="pg-k">‹ Precedente</span><span class="pg-t">${esc(prevSec.title)}</span></a>` : '<span></span>'}
        ${nextSec ? `<a class="pg pg-next" href="#/sec/${nextSec.id}" rel="next"><span class="pg-k">Successiva ›</span><span class="pg-t">${esc(nextSec.title)}</span></a>` : '<span></span>'}
      </nav>` : ''}
  `);
  on('[data-act="merge-sec"]', 'click', () => mergeSectionsFlow({ nb, primarySec: sec }));
  on('[data-act="srs-manage"]', 'click', () => resetSectionReview(sec));
  on('[data-act="labels"]', 'click', () => startLabels(sec));
  on('[data-act="focus"]', 'click', () => Focus.start(sec.id));
  if (mode !== 'edit') { Resume.save(location.hash || `#/sec/${sec.id}/${mode}`, window.scrollY); Resume.refresh(); }
  on('[data-act="inc"]', 'click', async () => { if (await toggleIncomplete(sec, () => saveSection(sec), caseSec ? 'caso' : 'sezione')) route(); });
  on('[data-act="case-meta"]', 'click', async () => { if (await caseSheet(sec)) { toast('Dati del caso salvati'); route(); } });
  on('[data-act="semei-meta"]', 'click', async () => { if (await semeiSheet(sec)) { toast('Dati della scheda salvati'); route(); } });
  on('[data-act="sp-meta"]', 'click', async () => { if (await specialSheet(spCfg, sec)) { toast('Dati salvati'); route(); } });
  on('[data-act="case-photo"]', 'click', async () => { if (await addPhotosTo(sec)) route(); });
  on('[data-act="case-pdf"]', 'click', async () => { if (await addPdfTo(sec)) route(); });
  // Cambiare scheda non riempie la cronologia: il tasto Indietro torna al notebook.
  on('.tabs a', 'click', e => { e.preventDefault(); Nav.replace(e.currentTarget.getAttribute('href')); });
  on('[data-act="tab-cfg"]', 'click', () => { sessionStorage.setItem('nb-set-tab', 'tabs'); go('#/settings'); });
  on('[data-act="tab-more"]', 'click', async () => {
    const ord = typeof TabCfg !== 'undefined' ? TabCfg.ordered(modes) : modes;
    const moreSet = typeof TabCfg !== 'undefined' ? TabCfg.moreSet() : new Set();
    const hid = ord.filter(([m]) => moreSet.has(m));
    const ch = await actionSheet('Altre schede', hid.map(([m, l]) => ({ key: m, label: l + (m === mode ? ' (attiva)' : '') })));
    if (ch) Nav.replace(`#/sec/${id}/${ch}`);
  });
  const tabsEl = $('.tabs');
  const onTab = $('.tab.on', tabsEl);
  if (tabsEl && onTab) {
    const t = onTab.getBoundingClientRect(), n = tabsEl.getBoundingClientRect();
    tabsEl.scrollLeft += t.left - n.left - (n.width - t.width) / 2;
  }
  const body = $('#modeBody');
  ({ read: modeRead, map: modeMap, cloze: modeCloze, blank: modeBlank, oral: (s, b) => modeBlank(s, b, { oral: true }), quiz: modeQuiz, dquiz: modeDiscQuiz, cards: modeCards, video: modeVideo, audio: modeAudio, html: modeHtml, papers: modePapers, edit: modeEdit, case: modeCase }[mode])(sec, body);
}

async function undoSectionReview(secId, snapshot = null) {
  const sec = secById(secId);
  if (!sec) return;
  if (snapshot) {
    sec.srs = JSON.parse(JSON.stringify(snapshot));
  } else {
    const cur = sec.srs || newSrs();
    const hist = Array.isArray(cur.history) ? cur.history.slice(0, -1) : [];
    if (cur.prev) {
      sec.srs = { ...newSrs(), ...cur.prev, history: hist };
    } else {
      sec.srs = { ...newSrs(), history: hist };
    }
  }
  await saveSection(sec);
  toast('Ultimo ripasso annullato');
  route();
}

async function resetSectionReview(sec) {
  const canUndo = !sec.studyhub && !!(sec.srs?.prev || (sec.srs?.history && sec.srs.history.length));
  const hasSrs = !!(sec.studyhub || sec.srs?.due || (sec.srs?.history && sec.srs.history.length));
  const ch = await actionSheet('Gestisci ripasso', [
    ...(sec.md.trim() ? [{ key: 'addon', label: '✨ Ripasso a parte per nuove aggiunte…' }] : []),
    ...(canUndo ? [{ key: 'undo', label: 'Annulla l’ultimo ripasso' }] : []),
    ...(hasSrs ? [{ key: 'relearn', label: 'Rimetti in primo apprendimento (ripasso domani)' }] : []),
    ...(hasSrs ? [{ key: 'reset', label: 'Togli dal ripasso (torna “Nuova”)', danger: true }] : [])
  ]);
  if (!ch) return;
  if (ch === 'addon') {
    if (await openAddonPickerSheet(sec)) route();
    return;
  }
  if (ch === 'undo') {
    await undoSectionReview(sec.id);
    return;
  }
  if (ch === 'relearn') {
    const ok = await modal({
      title: 'Rimettere in primo apprendimento?',
      text: 'L’argomento riparte da zero con facilità normale (nessuna penalità): l’app fissa il primo ripasso per domani e ricalcola gli intervalli dalle prossime risposte.',
      confirm: 'Rimetti in apprendimento'
    });
    if (!ok) return;
    if (sec.studyhub) {
      Bridge.send({ type: 'topic-unlinked', sectionId: sec.id, notebookId: sec.notebookId, subject: nbById(sec.notebookId)?.name || '', topic: sec.title });
      delete sec.studyhub;
    }
    sec.srs = { ef: 2.5, interval: 1, reps: 0, due: addDays(todayStr(), 1), history: [] };
    await saveSection(sec);
    toast('Rimessa in primo apprendimento: primo ripasso domani');
    route();
    return;
  }
  if (ch === 'reset') {
    const ok = await modal({
      title: 'Togliere dal ripasso?',
      text: 'La sezione torna “Nuova” (non pianificata) e lo storico dei ripassi viene azzerato. Potrai pianificarla di nuovo quando vuoi.',
      confirm: 'Togli dal ripasso',
      danger: true
    });
    if (!ok) return;
    if (sec.studyhub) {
      Bridge.send({ type: 'topic-unlinked', sectionId: sec.id, notebookId: sec.notebookId, subject: nbById(sec.notebookId)?.name || '', topic: sec.title });
      delete sec.studyhub;
    }
    sec.srs = newSrs();
    await saveSection(sec);
    toast('Sezione tolta dal ripasso (torna Nuova)');
    route();
  }
}

function gradeBar(sec, slot, { mode, suggested } = {}) {
  slot.innerHTML = `
    <div class="grade">
      <p class="grade-q"><span>${suggested ? 'Valutazione suggerita evidenziata. Quanto ricordavi?' : 'Quanto ricordavi?'}</span>${typeof helpBtn === 'function' ? helpBtn('srsAlgo') : ''}</p>
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
    const prevSrs = sec.srs ? JSON.parse(JSON.stringify(sec.srs)) : newSrs();
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
      toast(sec.srs.interval === 0 ? 'Resta nei ripassi di oggi' : `Prossimo ripasso ${fmtDue(sec.srs.due)}`, '', {
        label: 'Annulla',
        fn: () => undoSectionReview(sec.id, prevSrs)
      });
    }
    afterGrade(sec, q);
  };
  $$('.gbtn', slot).forEach(b => b.addEventListener('click', () => grade(+b.dataset.q)));
  const onKey = e => {
    if (isTyping() || $('#modalRoot').children.length) return;
    const i = ['1', '2', '3', '4'].indexOf(e.key);
    if (i >= 0 && slot.isConnected) { e.preventDefault(); grade(GRADES[i].q); }
  };
  if (slot._onKey) document.removeEventListener('keydown', slot._onKey);
  slot._onKey = onKey;
  document.addEventListener('keydown', onKey);
  addCleanup(() => document.removeEventListener('keydown', onKey));
  slot.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
}

function afterGrade(sec, q = 4) {
  if (state.fromReview) {
    const due = state.sections.filter(isDue).sort(sortDue);
    const next = due.find(s => s.id !== sec.id) || (q < 3 ? null : due[0]);
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
    ${addonBannerHtml(sec)}
    ${sec.md.trim() ? `
      <div class="fp-new-banner" id="fpNewBanner" hidden></div>
      <div class="fp-strip" role="toolbar" aria-label="Prima sessione di studio">
        <button class="btn sm fp-go" type="button" data-act="fp-start" title="Studia un blocco alla volta: Leggi, Copri e ripeti, Verifica + coda finale">▶ Prima passata</button>
        <button class="btn sm ghost" type="button" data-act="fp-peek" aria-pressed="false" title="Copre al volo i dettagli negli elenchi e nelle tabelle senza modificare il testo">🙈 Oscura dettagli</button>
        <button class="btn sm ghost" type="button" data-act="fp-pretest" title="3–5 domande veloci prima di leggere per attivare la memoria">⚡ Pre-test</button>
        ${typeof helpBtn === 'function' ? helpBtn('firstPass') : ''}
      </div>
      <div class="fp-radar" id="fpRadar" hidden></div>
      <div class="pk-bar" id="pkBar" hidden></div>
      <div class="fold-tools"><button class="btn sm ghost ink-btn" data-act="listen" hidden>Ascolta</button><button class="btn sm ghost" data-act="listen-on" hidden title="Legge questa sezione e poi le successive del notebook">Ascolta da qui in poi</button><button class="btn sm ghost ink-btn" data-act="ink" hidden>Scrivi a mano</button><button class="btn sm ghost" data-act="imgs" hidden></button><button class="btn sm ghost" data-act="fold-all" hidden></button></div><article class="notes">${renderMd(sec.md)}</article>` : `
      <div class="empty"><p>Sezione vuota.</p><a class="btn primary" href="#/sec/${sec.id}/edit">Scrivi in Modifica</a></div>`}
    ${sec.md.trim() ? '<p class="hint sel-hint">Seleziona del testo per evidenziarlo, sottolinearlo, farne un cloze o una flashcard. Sul PC puoi anche usare il tasto destro.</p>' : ''}
    ${sec.studyhub ? `
      <div class="callout end">
        <p>${esc(studyhubStatusText(sec))}</p>
        <div class="inline">
          ${sec.studyhub.status !== 'received' ? '<a class="btn sm" href="#/studyhub" data-sh-open>Apri StudyHub qui accanto</a>' : ''}
          <button class="btn ghost sm" data-act="sh-relink">Cambia materia o argomento</button>
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
    ${pdfRefsBlockHtml(sec)}
    ${eqSecBlockHtml(sec)}
    ${lessonBlockHtml(sec)}
    ${sourcesBlockHtml(sec)}
  `;
  bindAddonBanner(body, sec);
  bindLessonBlock(body, sec);
  bindSourcesBlock(body, sec, () => saveSection(sec), isCase(sec) ? 'caso' : 'sezione');
  $$('[data-eqopen]', body).forEach(b => b.addEventListener('click', async () => { const x = examQs().find(r => r.id === b.dataset.eqopen); if (x && await eqSheet(x)) route(); }));
  bindPdfRefsBlock(body, sec);
  const notesEl = $('.notes', body);
  if (notesEl) {
    const readFolds = setupFolds(notesEl, sec.id);
    bindFoldAll($('[data-act="fold-all"]', body), readFolds);
    bindImagesToggle($('[data-act="imgs"]', body), prepareImages(notesEl, sec).count);
    if (typeof attachInlineAtlasAnn === 'function') attachInlineAtlasAnn(notesEl, sec);
    markGlossary(notesEl);
    bindGlossaryClicks(notesEl);
    setupReadingTools(notesEl, sec);
    linkStamps(notesEl, sec);
    setupNotesInk(notesEl, sec, $('[data-act="ink"]', body));
    setupListen(notesEl, $('[data-act="listen"]', body), readFolds);
    setupFirstPassControls(sec, body, notesEl);
    const lo = $('[data-act="listen-on"]', body);
    if (lo && (canSpeak || Voice.useGemini())) {
      lo.hidden = false;
      lo.addEventListener('click', () => {
        const nb = nbById(sec.notebookId);
        const order = nb ? nbReadingOrder(nb) : [sec];
        Playlist.start(order.slice(Math.max(0, order.indexOf(sec))), nb ? nb.name : '');
      });
    }
    const bl = [...backlinksOf(sec), ...state.sections.filter(x => x.id !== sec.id && (x.sp?.links || []).includes(sec.id))].filter((x, i, a) => a.indexOf(x) === i);
    if (bl.length) notesEl.insertAdjacentHTML('afterend', `<h2 class="sub backlinks">Pagine che rimandano qui</h2><ul class="list">${bl.map(s => sectionRow(s, { showNb: true })).join('')}</ul>`);
  }
  on('[data-act="studied"]', 'click', async () => { if (await markStudiedInStudyHub(sec)) route(); }, body);
  on('[data-act="sh-relink"]', 'click', async () => { if (await markStudiedInStudyHub(sec, { relink: true })) route(); }, body);
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
  const hasTbl = /\n\s*\|[^\n]+\|\s*\n\s*\|[\s:|-]+\|/.test('\n' + (sec.md || ''));
  if (!n && !hasTbl) {
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
  setupReadingTools($('.notes', body), sec);
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
  // v4.09: cloze per colonna nelle tabelle Markdown
  const article = $('.notes', body);
  $$('table', article).forEach(tbl => {
    const ths = $$('thead th', tbl);
    if (!ths.length) return;
    ths.forEach((th, colIdx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tbl-col-btn';
      btn.title = 'Nascondi o mostra questa colonna per esercitarti';
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = '🙈';
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const hideCol = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', String(hideCol));
        btn.textContent = hideCol ? '👁' : '🙈';
        $$('tbody tr', tbl).forEach(tr => {
          const td = tr.children[colIdx];
          if (!td) return;
          if (hideCol) {
            td.classList.add('tbl-cell-hide');
            td.classList.remove('shown');
            td.tabIndex = 0;
            td.setAttribute('role', 'button');
          } else {
            td.classList.remove('tbl-cell-hide', 'shown');
            td.removeAttribute('tabindex');
            td.removeAttribute('role');
          }
        });
      });
      th.append(btn);
    });
    tbl.addEventListener('click', e => {
      const td = e.target.closest('td.tbl-cell-hide');
      if (td) td.classList.toggle('shown');
    });
    tbl.addEventListener('keydown', e => {
      const td = e.target.closest('td.tbl-cell-hide');
      if (td && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); td.classList.toggle('shown'); }
    });
  });
  // suggerimenti: un “?” accanto ai termini che ne hanno uno
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
    if (isTyping() || $('#modalRoot').children.length) return;
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
// v3.62: il vocabolario degli appunti aiuta il riconoscimento di Chrome con i termini
// medici: tra le trascrizioni proposte sceglie quella con più parole degli appunti, e
// corregge una parola quasi uguale a un termine lungo degli appunti (es. “purchinie” → “Purkinje”)
function vocabFrom(md) {
  const v = new Map();
  (String(md || '').match(/[A-Za-zÀ-ÿ]{5,}/g) || []).forEach(w => { const f = foldAccents(w).toLowerCase(); if (!v.has(f)) v.set(f, w); });
  return v;
}
function editDist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
function fixWithVocab(text, vocab) {
  if (!vocab || !vocab.size) return text;
  const long = [...vocab.keys()].filter(k => k.length >= 7);
  return text.replace(/[A-Za-zÀ-ÿ]{6,}/g, w => {
    const f = foldAccents(w).toLowerCase();
    if (vocab.has(f)) return w;
    const max = f.length >= 9 ? 2 : 1;
    let best = null, bd = max + 1;
    for (const k of long) { if (k[0] !== f[0]) continue; const d = editDist(f, k, max); if (d < bd) { bd = d; best = k; } }
    return best ? vocab.get(best) : w;
  });
}
const vocabScore = (t, vocab) => (String(t).match(/[A-Za-zÀ-ÿ]{5,}/g) || []).filter(w => vocab.has(foldAccents(w).toLowerCase())).length;
// Ogni pausa chiude una frase: il riconoscimento ripartirà da solo finché non premi Stop
function createDictation({ onText, onInterim = () => {}, onState = () => {}, vocab = null }) {
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
    rec.maxAlternatives = vocab && vocab.size ? 5 : 1;
    rec.onresult = e => {
      let fin = '';
      let mid = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        let t = e.results[i][0].transcript;
        if (e.results[i].isFinal && vocab && vocab.size) {
          // la trascrizione con più termini degli appunti (a parità, quella che Chrome preferisce)
          let bs = vocabScore(t, vocab);
          for (let k = 1; k < e.results[i].length; k++) { const alt = e.results[i][k].transcript; const sc = vocabScore(alt, vocab); if (sc > bs) { bs = sc; t = alt; } }
          t = fixWithVocab(t, vocab);
        }
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
    ${oral ? outlinePanelHtml(sec) : ''}
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
  if (oral) bindOutlinePanel(body, sec);
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
      vocab: vocabFrom(sec.md),
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
  addCleanup(() => { if (dict) dict.stop(); if (canSpeak && !Playlist.active()) speechSynthesis.cancel(); });
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
        vocab: vocabFrom(sec.md),
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
  const walk = (g, prefix) => opt(g, prefix + g.name) + subGroups(nb, g).map(x => walk(x, `${prefix}${g.name} › `)).join('');
  return `<option value="">Nessuna (direttamente nel notebook)</option>${topGroups(nb).map(g => walk(g, '')).join('')}<option value="__new">Nuova cartella…</option>`;
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

/* =====================================================================
   v3.94: Riformatta con uno schema fisso
   Ogni tipo di argomento ha sempre gli stessi titoli, nello stesso ordine:
   la sezione si riordina lì dentro senza aggiungere né togliere contenuti,
   e la controlli (prima/dopo, con l’avviso se manca qualcosa) prima di usarla.
   ===================================================================== */
const FMT_SCHEMAS = [
  { id: 'malattia', name: 'Malattia', heads: ['Definizione', 'Epidemiologia', 'Eziologia e fattori di rischio', 'Patogenesi', 'Clinica', 'Diagnosi', 'Diagnosi differenziale', 'Terapia', 'Complicanze e prognosi'] },
  { id: 'farmaco', name: 'Farmaco o classe di farmaci', heads: ['Classe', 'Meccanismo d’azione', 'Farmacocinetica', 'Indicazioni', 'Effetti avversi', 'Controindicazioni e interazioni', 'Note pratiche'] },
  { id: 'anatomia', name: 'Struttura anatomica', heads: ['Sede e limiti', 'Morfologia e suddivisione', 'Rapporti', 'Vascolarizzazione', 'Innervazione e connessioni', 'Funzione', 'Correlazioni cliniche'] },
  { id: 'via', name: 'Via nervosa', heads: ['Funzione', 'Origine e recettori', 'Primo neurone', 'Secondo neurone', 'Terzo neurone', 'Decussazione', 'Terminazione', 'Lesioni e clinica'] },
  { id: 'fisio', name: 'Meccanismo fisiologico', heads: ['A cosa serve', 'Strutture coinvolte', 'Come funziona, passo per passo', 'Regolazione', 'Valori e numeri da sapere', 'Quando si altera'] }
];
const schemasRec = () => state.links.find(l => l.kind === 'schemas') || null;
const mySchemas = () => (schemasRec()?.list || []).filter(x => x && x.id && x.name && (x.heads || []).length);
const allSchemas = () => [...FMT_SCHEMAS, ...mySchemas().map(x => ({ ...x, mine: true }))];
async function saveMySchemas(list) {
  const rec = schemasRec() || { id: '_schemas', kind: 'schemas', notebookId: '_schemas', list: [], created: Date.now() };
  rec.list = list;
  await saveLink(rec);
}
const ED_HL_COLORS = [
  { key: 'c', name: 'Giallo crema', pastel: true },
  { key: 'a', name: 'Pesca pastello', pastel: true },
  { key: 'f', name: 'Rosa pastello', pastel: true },
  { key: 'i', name: 'Lilla pastello', pastel: true },
  { key: 's', name: 'Azzurro nuvola', pastel: true },
  { key: 'm', name: 'Verde menta', pastel: true },
  ...HL_COLORS
];

function mergeSystem({ keepHeads = false, extra = '', hasSecond = false, srcCount = 0 } = {}) {
  const extraBlock = extra.trim() ? `\n\nINDICAZIONI SPECIFICHE DELLA STUDENTESSA (seguile con priorità):\n- ${extra.trim()}` : '';
  const srcDesc = srcCount > 2 ? ` provenienti da ${srcCount} sezioni/fonti diverse` : (hasSecond || srcCount === 2 ? ' provenienti da due fonti/sezioni diverse' : ' (spesso incollati in modo disordinato da più fonti)');
  return `Riordini e fondi appunti di uno studente di medicina${srcDesc}.

OBIETTIVO PRINCIPALE — FUSIONE E DEDUPLICAZIONE SENZA PERDITA DI DETTAGLI:
- Individua argomenti, strutture, cellule, vie o concetti ripetuti in più punti del testo e accorpali in UN UNICO paragrafo o elenco puntato coerente, eliminando le ripetizioni identiche.
- NON perdere nessun dettaglio unico: ogni numero, sinonimo, nucleo, recettore, eccezione, esempio o nota clinica presente in una qualunque delle fonti deve comparire nel testo finale.
- Se due fonti danno sfumature leggermente diverse o complementari sullo stesso punto, integrale entrambe chiaramente (non tagliare né appiattire).
- NON aggiungere nozioni esterne che non siano presenti nei testi forniti.

STRUTTURA E FORMATTAZIONE:
- Titoli: ${keepHeads ? 'mantieni il più possibile i titoli ("## ", "### ") già presenti negli appunti, accorpando i duplicati sotto il titolo esistente più appropriato; aggiungi sottotitoli "### " solo se serve chiarezza.' : 'organizza il materiale in una gerarchia logica e chiara con titoli "## " e sottotitoli "### " (dal generale al particolare: definizione/struttura, suddivisione, connessioni/meccanismi, funzione, clinica).'}
- Dentro ogni sezione: elenchi puntati brevi e gerarchici (con sottopunti rientrati di 2 spazi); usa una tabella Markdown quando 3 o più elementi hanno le stesse caratteristiche confrontabili; grassetto solo sui termini chiave.
- Se gli appunti iniziano con un titolo "# ", mantienilo come prima riga.
- Copia senza modifiche, attaccata alla stessa informazione, ogni marcatura speciale: ==testo== (con eventuale ::suggerimento, non aggiungerne e non toglierne), {{lettera|testo}}, [[Titolo]], ![testo](img:codice), ^[nota], i minuti come "⏱ 0:00 (nome)", i link [fonte, p. N](#/pdf/...) e eventuali blocchi \`\`\`html.

Rispondi SOLO con gli appunti fusi in Markdown, senza commenti prima o dopo.${extraBlock}${styleRulesBlock()}`;
}

function schemaSystem(sc, missing, extra = '') {
  const extraBlock = extra.trim() ? `\n\nINDICAZIONI SPECIFICHE DELLA STUDENTESSA:\n- ${extra.trim()}` : '';
  return `Riorganizzi e fondi gli appunti di uno studente di medicina dentro uno schema fisso, SENZA aggiungere nozioni esterne e SENZA perdere dettagli.

SCHEMA: questi titoli di secondo livello ("## "), in questo ordine esatto, scritti esattamente così:
${sc.heads.map(h => `## ${h}`).join('\n')}

Regole:
- Usa SOLO le informazioni presenti negli appunti: non aggiungere nozioni esterne, non riassumere togliendo dettagli, numeri, sinonimi o esempi.
- Se lo stesso argomento compare ripetuto in più punti (es. da due fonti diverse), fondilo in un unico elenco/paragrafo coerente eliminando le ripetizioni identiche ma conservando tutti i dettagli unici.
- Quello che non rientra in nessuna voce va in fondo, sotto "## Altro" (se non c’è niente, non mettere "## Altro").
- Voce per cui negli appunti non c’è niente: ${missing ? 'tieni il titolo e sotto scrivi solo "*(manca negli appunti)*".' : 'non mettere il titolo.'}
- Dentro ogni voce: elenchi puntati brevi, con i sottopunti rientrati; una tabella Markdown quando 3 o più elementi hanno le stesse caratteristiche (classificazioni, confronti); grassetto solo sui termini chiave. Puoi usare titoli "### " dentro una voce.
- La prima riga resta il titolo "# " degli appunti, uguale (se presente).
- Copia senza modifiche, attaccata alla stessa informazione, ogni marcatura speciale: ==testo== (non aggiungerne e non toglierne), {{lettera|testo}}, [[Titolo]], ![testo](img:codice), ^[nota], i minuti come "⏱ 0:00 (nome)", i link [fonte, p. N](#/pdf/...) e qualsiasi altra sintassi che non riconosci.

Rispondi SOLO con gli appunti in Markdown, senza nessun altro testo prima o dopo.${extraBlock}${styleRulesBlock()}`;
}

// cosa è cambiato davvero: parole sparite, conteggio parole, cloze e immagini
function reformatCheck(before, after) {
  const words = t => (foldAccents(aiText(stripCloze(String(t || '')))).match(/[a-z0-9]{5,}/g) || []);
  const allW = t => (aiText(stripCloze(String(t || ''))).match(/[A-Za-zÀ-ÿ0-9]+/g) || []).length;
  const aft = new Set(words(after).map(w => w.slice(0, 7)));
  const lostMap = new Map();
  (aiText(stripCloze(before)).match(/[A-Za-zÀ-ÿ0-9]{5,}/g) || []).forEach(w => { const k = foldAccents(w).toLowerCase().slice(0, 7); if (!aft.has(k) && !lostMap.has(k)) lostMap.set(k, w.toLowerCase()); });
  const bef = new Set(words(before).map(w => w.slice(0, 7)));
  const skip = new Set(words('manca negli appunti altro').map(w => w.slice(0, 7)));
  const added = [...new Set(words(after).map(w => w.slice(0, 7)))].filter(k => !bef.has(k) && !skip.has(k));
  const count = (t, re) => (String(t).match(re) || []).length;
  return {
    lost: [...lostMap.values()], total: bef.size, added: added.length,
    wordsBefore: allW(before), wordsAfter: allW(after),
    cloze: [count(before, /==[^=\n]+==/g), count(after, /==[^=\n]+==/g)],
    imgs: [imageRefs(before).length, imageRefs(after).length]
  };
}

// v4.30: Fondi fonti e riordina / Riformatta con uno schema → anteprima Prima / Dopo / Codice
function reformatFlow(sec, text, { startMode = null } = {}) {
  return new Promise(resolve => {
    let done = false;
    let savedExtra = '';
    let savedSrc2 = '';
    const ctl = new AbortController();
    const pick = () => {
      const last = startMode || S().fmtSchema || 'merge';
      const list = allSchemas();
      const validIds = new Set(['merge', 'generic', ...list.map(x => x.id)]);
      const picked = validIds.has(last) ? last : 'merge';
      const sh = openSheet(`
        <div class="sch-head-row">
          <h2>✨ Fondi fonti e riformatta</h2>
          ${typeof helpBtn === 'function' ? helpBtn('aiMerge') : ''}
        </div>
        <p class="sheet-sub">Riordina appunti disordinati da più fonti rimuovendo i doppioni senza perdere dettagli, oppure organizza tutto sotto uno schema fisso. Controlli sempre il risultato prima di applicarlo.</p>
        <div class="sch-list" role="radiogroup" aria-label="Modalità">
          <label class="sch-opt sch-opt-hi">
            <input type="radio" name="sch" value="merge" ${picked === 'merge' ? 'checked' : ''}>
            <span><b>🔀 Fondi più fonti e riordina</b><small>Accorpa gli argomenti ripetuti (es. da libro + slide), toglie i duplicati e conserva tutti i dettagli unici</small></span>
          </label>
          ${list.map(sc => `<label class="sch-opt"><input type="radio" name="sch" value="${esc(sc.id)}" ${picked === sc.id ? 'checked' : ''}><span><b>${esc(sc.name)}</b>${sc.mine ? ' <small class="muted-inline">(tuo)</small>' : ''}<small>${esc(sc.heads.join(' · '))}</small></span>${sc.mine ? `<button type="button" class="btn sm ghost" data-sch="edit:${esc(sc.id)}" aria-label="Modifica lo schema ${esc(sc.name)}">✎</button>` : ''}</label>`).join('')}
          <label class="sch-opt"><input type="radio" name="sch" value="generic" ${picked === 'generic' ? 'checked' : ''}><span><b>Solo elenchi e tabelle</b><small>Riordina come nell’importazione, applicando le tue regole di formattazione</small></span></label>
        </div>
        <div class="sch-opts-ctx">
          <label class="check" id="schKeepWrap"><input type="checkbox" id="schKeep" ${S().fmtKeepHeads ? 'checked' : ''}><span>Mantieni il più possibile i titoli che ho già (accorpa solo i doppioni)</span></label>
          <label class="check" id="schMissWrap"><input type="checkbox" id="schMiss" ${S().fmtMissing !== false ? 'checked' : ''}><span>Segna le voci dello schema che mancano negli appunti</span></label>
        </div>
        <label class="field sch-extra-f"><span>Indicazioni extra <small class="muted-inline">(facoltativo)</small></span>
          <input class="input" id="schExtra" value="${esc(savedExtra)}" placeholder="Es. Unisci le due parti sulle cellule del bulbo; metti le fibre in tabella"></label>
        <details class="sch-src2" ${savedSrc2 ? 'open' : ''}>
          <summary>＋ Incolla una seconda fonte da fondere qui dentro <span class="muted-inline">(facoltativo)</span></summary>
          <textarea class="input sch-src2-ta" id="schSrc2" rows="5" placeholder="Incolla qui appunti da un’altra fonte (slide, libro, NotebookLM…): verranno fusi con quelli già presenti senza duplicati.">${esc(savedSrc2)}</textarea>
        </details>
        <p class="err-line" id="schErr" hidden></p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" data-sch="new">+ Il mio schema</button>
          <button class="btn ghost" type="button" data-sch="no">Annulla</button>
          <button class="btn primary" type="button" data-sch="go">Avvia AI</button>
        </div>`, { label: 'Fondi fonti e riformatta', onClose: () => { if (!done) { done = true; ctl.abort(); resolve(null); } } });

      const syncCtx = () => {
        const id = $('input[name="sch"]:checked', sh.el)?.value || 'merge';
        $('#schKeepWrap', sh.el).hidden = id !== 'merge';
        $('#schMissWrap', sh.el).hidden = id === 'merge' || id === 'generic';
        const goBtn = $('[data-sch="go"]', sh.el);
        if (goBtn && !goBtn.disabled) goBtn.textContent = id === 'merge' ? '🔀 Fondi e riordina' : '✨ Riformatta';
      };
      syncCtx();
      sh.el.addEventListener('change', e => { if (e.target.name === 'sch') syncCtx(); });

      sh.el.addEventListener('click', async e => {
        const b = e.target.closest('[data-sch]');
        if (!b) return;
        const k = b.dataset.sch;
        if (k === 'no') { sh.close(null); return; }
        if (k === 'new' || k.startsWith('edit:')) {
          e.preventDefault();
          savedExtra = $('#schExtra', sh.el)?.value || '';
          savedSrc2 = $('#schSrc2', sh.el)?.value || '';
          done = true; sh.close(null); done = false;
          editSchema(k === 'new' ? null : mySchemas().find(x => x.id === k.slice(5)));
          return;
        }
        if (k !== 'go') return;
        const id = $('input[name="sch"]:checked', sh.el)?.value || 'merge';
        const missing = $('#schMiss', sh.el).checked;
        const keepHeads = $('#schKeep', sh.el).checked;
        savedExtra = ($('#schExtra', sh.el)?.value || '').trim();
        savedSrc2 = ($('#schSrc2', sh.el)?.value || '').trim();
        S().fmtSchema = id; S().fmtMissing = missing; S().fmtKeepHeads = keepHeads; Settings.save();
        const sc = allSchemas().find(x => x.id === id);
        const hasSecond = !!savedSrc2;
        const payloadText = hasSecond
          ? `FONTE 1 (appunti attuali della sezione “${sec.title}”):\n\n${text}\n\n---\n\nFONTE 2 (seconda fonte da integrare e fondere senza duplicati):\n\n${savedSrc2}`
          : `APPUNTI DA RIORDINARE E FONDERE (sezione “${sec.title}”):\n\n${text}`;
        const combinedBefore = hasSecond ? `${text}\n\n${savedSrc2}` : text;

        b.disabled = true;
        b.textContent = id === 'merge' ? 'Fondo e riordino… (può servire un minuto)' : 'Riformatto… (può servire un minuto)';
        $('#schErr', sh.el).hidden = true;
        try {
          let md, truncated = false;
          if (id === 'merge') {
            const r = await AI.generate({ system: mergeSystem({ keepHeads, extra: savedExtra, hasSecond }), text: payloadText, signal: ctl.signal });
            md = String(r.text || '').trim().replace(/^```(?:markdown|md)?[ \t]*\n/i, '').replace(/\n```\s*$/, '').trim();
            truncated = !!r.truncated;
          } else if (sc) {
            const r = await AI.generate({ system: schemaSystem(sc, missing, savedExtra), text: payloadText, signal: ctl.signal });
            md = String(r.text || '').trim().replace(/^```(?:markdown|md)?[ \t]*\n/i, '').replace(/\n```\s*$/, '').trim();
            truncated = !!r.truncated;
          } else {
            const srcForGeneric = savedExtra ? `${payloadText}\n\nINDICAZIONI EXTRA: ${savedExtra}` : payloadText;
            const r = await aiFormatNotes({ text: srcForGeneric, cloze: S().aiCloze, questions: false, signal: ctl.signal });
            md = r.md; truncated = !!r.truncated;
          }
          if (!md) throw new Error('L’AI non ha restituito appunti utilizzabili.');
          if (done) return;
          done = true; sh.close(null); done = false;
          preview(md, sc, truncated, id, combinedBefore);
        } catch (err) {
          if (err.name === 'AbortError' || !sh.el.isConnected) return;
          const el = $('#schErr', sh.el); el.textContent = err.message || 'Non riuscito'; el.hidden = false;
          b.disabled = false;
          syncCtx();
        }
      });
    };
    const editSchema = cur => {
      const sh = openSheet(`
        <h2>${cur ? 'Modifica lo schema' : 'Il mio schema'}</h2>
        <p class="sheet-sub">I titoli sotto cui vuoi sempre trovare questo tipo di argomento, nell’ordine che preferisci. Vale su tutti i tuoi dispositivi.</p>
        <label class="field"><span>Nome</span><input class="input" id="msName" value="${esc(cur?.name || '')}" placeholder="Es. Sindrome, Nervo cranico, Esame diagnostico"></label>
        <label class="field"><span>Titoli, uno per riga</span><textarea class="input" id="msHeads" rows="8" placeholder="Origine apparente&#10;Nuclei&#10;Decorso&#10;Rami&#10;Territorio&#10;Lesioni">${esc((cur?.heads || []).join('\n'))}</textarea></label>
        <div class="modal-actions">
          ${cur ? '<button class="btn ghost danger" type="button" data-ms="del">Elimina</button>' : ''}
          <button class="btn ghost" type="button" data-ms="no">Indietro</button>
          <button class="btn primary" type="button" data-ms="ok">Salva lo schema</button>
        </div>`, { label: 'Il mio schema', onClose: () => { if (!done) pick(); } });
      sh.el.addEventListener('click', async e => {
        const b = e.target.closest('[data-ms]');
        if (!b) return;
        if (b.dataset.ms === 'no') { sh.close(null); return; }
        if (b.dataset.ms === 'del') { await saveMySchemas(mySchemas().filter(x => x.id !== cur.id)); toast('Schema eliminato'); sh.close(null); return; }
        const name = $('#msName', sh.el).value.trim();
        const heads = $('#msHeads', sh.el).value.split('\n').map(l => l.replace(/^[#\-•*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 20);
        if (!name || heads.length < 2) { toast('Servono un nome e almeno due titoli'); return; }
        const list = mySchemas();
        const id = cur ? cur.id : `my-${uid()}`;
        const item = { id, name, heads };
        await saveMySchemas(cur ? list.map(x => (x.id === id ? item : x)) : [...list, item]);
        S().fmtSchema = id; Settings.save();
        toast('Schema salvato');
        sh.close(null);
      });
    };
    const preview = (md, sc, truncated, modeId, combinedBefore) => {
      const ck = reformatCheck(combinedBefore, md);
      const diffPct = ck.wordsBefore ? Math.round(((ck.wordsAfter - ck.wordsBefore) / ck.wordsBefore) * 100) : 0;
      const diffTxt = diffPct < 0 ? `${diffPct}% ridondanze rimosse` : diffPct > 0 ? `+${diffPct}%` : 'invariato';
      const warn = [];
      if (truncated) warn.push('La risposta dell’AI è stata troncata: manca la fine. Meglio non usarla.');
      if (ck.lost.length > Math.max(4, ck.total * 0.05)) warn.push(`${ck.lost.length} parole dei tuoi appunti non compaiono più (per esempio: ${ck.lost.slice(0, 8).join(', ')}). Controlla che non sia sparito un dettaglio unico.`);
      if (ck.added > Math.max(10, ck.total * 0.09)) warn.push(`Ci sono circa ${ck.added} parole che nei tuoi appunti non c’erano: controlla che l’AI non abbia aggiunto nozioni.`);
      if (ck.cloze[1] !== ck.cloze[0]) warn.push(`I cloze erano ${ck.cloze[0]}, ora sono ${ck.cloze[1]}.`);
      if (ck.imgs[1] < ck.imgs[0]) warn.push(`Mancano ${ck.imgs[0] - ck.imgs[1]} immagini.`);
      const note = !warn.some(w => w.includes('non compaiono più')) && ck.lost.length ? `Parole riscritte o non ritrovate tali e quali: ${ck.lost.slice(0, 10).join(', ')}. Dai un’occhiata.` : '';
      const modeLbl = modeId === 'merge' ? '🔀 Fusione e riordino' : sc ? `schema “${sc.name}”` : 'elenchi e tabelle';
      const sh = openSheet(`
        <h2>Controlla prima di applicare</h2>
        <p class="sheet-sub">${esc(sec.title)} · ${esc(modeLbl)}</p>
        <div class="sch-stats">
          <span>Parole: <b>${ck.wordsBefore}</b> → <b>${ck.wordsAfter}</b> (${esc(diffTxt)})</span>
          ${ck.cloze[0] || ck.cloze[1] ? `<span>Cloze: <b>${ck.cloze[0]}</b> → <b>${ck.cloze[1]}</b></span>` : ''}
          ${ck.imgs[0] ? `<span>Immagini: <b>${ck.imgs[1]}/${ck.imgs[0]}</b></span>` : ''}
        </div>
        ${warn.length ? `<ul class="sch-warn">${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : note ? '' : '<p class="sch-ok">Tutti i concetti unici, i cloze e le immagini risultano conservati.</p>'}
        ${note ? `<p class="sch-note">${esc(note)}</p>` : ''}
        <div class="seg sm" role="tablist">
          <button type="button" class="seg-btn on" data-pv="after" role="tab" aria-selected="true">Dopo</button>
          <button type="button" class="seg-btn" data-pv="before" role="tab" aria-selected="false">Prima</button>
          <button type="button" class="seg-btn" data-pv="code" role="tab" aria-selected="false">Codice</button>
        </div>
        <div class="sch-prev notes" id="schPrev">${renderMd(md)}</div>
        <div class="modal-actions">
          <button class="btn ghost" type="button" data-pv="no">Lascia com’era</button>
          <button class="btn" type="button" data-pv="back">Cambia opzioni</button>
          <button class="btn primary" type="button" data-pv="ok">Usa questa versione</button>
        </div>`, { label: 'Anteprima della riformattazione', onClose: () => { if (!done) { done = true; resolve(null); } } });
      const prevEl = $('#schPrev', sh.el);
      hydrateImages(prevEl);
      sh.el.addEventListener('click', e => {
        const b = e.target.closest('[data-pv]');
        if (!b) return;
        const k = b.dataset.pv;
        if (k === 'after' || k === 'before' || k === 'code') {
          $$('.seg-btn', sh.el).forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); });
          if (k === 'code') {
            prevEl.innerHTML = `<pre class="sch-code">${esc(md)}</pre>`;
          } else {
            prevEl.innerHTML = renderMd(k === 'after' ? md : combinedBefore);
            hydrateImages(prevEl);
          }
        } else if (k === 'no') sh.close(null);
        else if (k === 'back') { done = true; sh.close(null); done = false; pick(); }
        else if (k === 'ok') { done = true; sh.close(null); resolve(md); }
      });
    };
    pick();
  });
}

/* ---------- v4.30: Struttura e gestione paragrafi in Markdown ---------- */
function parseMdHeadings(md) {
  const src = String(md || '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const offsets = [];
  let pos = 0;
  for (const l of lines) { offsets.push(pos); pos += l.length + 1; }

  const list = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = l.match(/^(#{1,4})\s+(.+?)\s*#*$/);
    if (m) {
      const rawTitle = m[2].trim();
      const title = stripMarks(stripCloze(rawTitle)).replace(/\*\*|__|`/g, '').trim() || rawTitle;
      list.push({ line: i, level: m[1].length, rawTitle, title, charOffset: offsets[i] });
    }
  }
  for (let k = 0; k < list.length; k++) {
    let end = lines.length;
    for (let j = k + 1; j < list.length; j++) {
      if (list[j].level <= list[k].level) { end = list[j].line; break; }
    }
    list[k].endLine = end;
    let bodyLines = 0;
    for (let ln = list[k].line + 1; ln < end; ln++) {
      if (lines[ln].trim() && !/^#{1,6}\s/.test(lines[ln])) bodyLines++;
    }
    list[k].bodyLines = bodyLines;
    // verifica se esiste un paragrafo fratello precedente/successivo nello stesso genitore
    let prevPeer = -1;
    for (let j = k - 1; j >= 0; j--) {
      if (list[j].level < list[k].level) break;
      if (list[j].level === list[k].level) { prevPeer = j; break; }
    }
    let nextPeer = -1;
    for (let j = k + 1; j < list.length; j++) {
      if (list[j].level < list[k].level) break;
      if (list[j].level === list[k].level) { nextPeer = j; break; }
    }
    list[k].prevPeer = prevPeer;
    list[k].nextPeer = nextPeer;
  }
  return { lines, list };
}

function cleanMdSpacing(lines) {
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '') + (lines.some(l => l.trim()) ? '\n' : '');
}

function moveMdHeading(md, idx, dir) {
  const { lines, list } = parseMdHeadings(md);
  const cur = list[idx];
  if (!cur) return null;
  const peerIdx = dir < 0 ? cur.prevPeer : cur.nextPeer;
  if (peerIdx < 0) return null;
  const a = dir < 0 ? list[peerIdx] : cur;
  const b = dir < 0 ? cur : list[peerIdx];
  const before = lines.slice(0, a.line);
  const segA = lines.slice(a.line, a.endLine);
  const segB = lines.slice(b.line, b.endLine);
  const after = lines.slice(b.endLine);
  const trimBlank = arr => {
    const r = [...arr];
    while (r.length && !r[0].trim()) r.shift();
    while (r.length && !r[r.length - 1].trim()) r.pop();
    return r;
  };
  const parts = [trimBlank(before), trimBlank(segB), trimBlank(segA), trimBlank(after)].filter(p => p.length);
  return parts.map(p => p.join('\n')).join('\n\n') + '\n';
}

function shiftMdHeadingLevel(md, idx, delta) {
  const { lines, list } = parseMdHeadings(md);
  const cur = list[idx];
  if (!cur) return null;
  const nextLvl = Math.max(2, Math.min(4, cur.level + delta));
  if (nextLvl === cur.level) return null;
  lines[cur.line] = `${'#'.repeat(nextLvl)} ${cur.rawTitle}`;
  return cleanMdSpacing(lines);
}

function renameMdHeading(md, idx, newTitle) {
  const { lines, list } = parseMdHeadings(md);
  const cur = list[idx];
  const clean = String(newTitle || '').replace(/\n+/g, ' ').trim();
  if (!cur || !clean) return null;
  lines[cur.line] = `${'#'.repeat(cur.level)} ${clean}`;
  return cleanMdSpacing(lines);
}

function mergeMdHeadingUp(md, idx) {
  const { lines, list } = parseMdHeadings(md);
  const cur = list[idx];
  if (!cur || idx === 0) return null;
  lines.splice(cur.line, 1);
  return cleanMdSpacing(lines);
}

function deleteMdHeading(md, idx) {
  const { lines, list } = parseMdHeadings(md);
  const cur = list[idx];
  if (!cur) return null;
  lines.splice(cur.line, cur.endLine - cur.line);
  return cleanMdSpacing(lines);
}


/* =====================================================================
   v4.40: Unione di 2 o più sezioni (con AI o manuale) + Ripasso a parte
   per le nuove aggiunte (senza toccare il ripasso principale).
   ===================================================================== */
function addonStatusPill(a) {
  if (!a || !a.srs || !a.srs.due) return '<span class="pill">Nuovo</span>';
  if (isAddonDue(a)) return `<span class="pill due">${a.srs.due < todayStr() ? 'In ritardo' : 'Oggi'}</span>`;
  return `<span class="pill soft">${esc(fmtDue(a.srs.due))}</span>`;
}

function addonBannerHtml(sec) {
  const list = addReviewsOf(sec);
  if (!list.length) return '';
  return `
    <div class="addon-box" id="addonBox">
      <div class="addon-box-h">
        <strong>✨ Nuove aggiunte — ripasso a parte</strong>
        <button type="button" class="btn sm ghost" data-addon-new>＋ Aggiungi</button>
      </div>
      <ul class="addon-list">${list.map(a => {
        const reps = a.srs?.history?.length || 0;
        const when = a.srs?.due ? (a.srs.due < todayStr() ? `in ritardo (${fmtDue(a.srs.due)})` : a.srs.due === todayStr() ? 'da ripassare oggi' : `prossimo ripasso ${fmtDue(a.srs.due)}`) : 'non pianificato';
        const pts = Array.isArray(a.parts) && a.parts.length ? a.parts.join(' · ') : '';
        return `<li class="addon-item" data-aid="${esc(a.id)}">
          <div class="addon-main">
            <div class="addon-t">${esc(a.title || 'Nuove aggiunte')} ${addonStatusPill(a)}</div>
            <div class="addon-s">${esc([pts, when, reps ? `ripassato ${reps} ${reps === 1 ? 'volta' : 'volte'}` : ''].filter(Boolean).join(' · '))}</div>
          </div>
          <div class="inline">
            <a class="btn sm primary" href="#/sec/${sec.id}/addon/${a.id}">▶ Ripassa</a>
            <button type="button" class="btn sm ghost" data-addon-edit="${esc(a.id)}" title="Scegli quali paragrafi includere">✎</button>
            <button type="button" class="btn sm ghost" data-addon-done="${esc(a.id)}" title="Segna come integrato nel ripasso principale e rimuovi il ripasso a parte">✓ Integrato</button>
          </div>
        </li>`;
      }).join('')}</ul>
    </div>`;
}

function bindAddonBanner(root, sec) {
  const box = $('#addonBox', root);
  if (!box) return;
  box.addEventListener('click', async e => {
    if (e.target.closest('[data-addon-new]')) {
      if (await openAddonPickerSheet(sec)) route();
      return;
    }
    const ed = e.target.closest('[data-addon-edit]');
    if (ed) {
      const a = addReviewsOf(sec).find(x => x.id === ed.dataset.addonEdit);
      if (a && await openAddonPickerSheet(sec, { existing: a })) route();
      return;
    }
    const dn = e.target.closest('[data-addon-done]');
    if (dn) {
      const a = addReviewsOf(sec).find(x => x.id === dn.dataset.addonDone);
      if (!a) return;
      const ok = await modal({
        title: 'Segnare le nuove aggiunte come integrate?',
        text: `Il ripasso a parte “${a.title}” viene chiuso; il testo resta normalmente nella sezione e continuerà nel ripasso principale.`,
        confirm: 'Segna integrato'
      });
      if (!ok) return;
      sec.addReviews = addReviewsOf(sec).filter(x => x.id !== a.id);
      await saveSection(sec);
      toast('Nuove aggiunte integrate nel ripasso principale');
      route();
    }
  });
}

// Calcola quali paragrafi di `mergedMd` contengono novità rispetto a `baseMd`
function analyzeNewParts(baseMd, mergedMd) {
  const parts = splitMdParts(mergedMd);
  const normW = t => (foldAccents(aiText(stripCloze(String(t || '')))).match(/[a-z0-9]{4,}/g) || []).map(w => w.slice(0, 8));
  const baseWords = new Set(normW(baseMd));
  const baseHeads = new Set(splitMdParts(baseMd).map(p => foldAccents(p.title)));
  return parts.map(p => {
    const ws = normW(p.md);
    const uniq = [...new Set(ws)];
    const novel = uniq.filter(w => !baseWords.has(w)).length;
    const ratio = uniq.length ? novel / uniq.length : 0;
    const isNewHead = p.level > 0 && !baseHeads.has(foldAccents(p.title));
    const suggested = baseMd ? (ratio >= 0.28 || (isNewHead && ratio >= 0.16)) : false;
    return { ...p, novelPct: Math.round(ratio * 100), isNewHead, suggested };
  });
}

// Finestra per creare o modificare un ripasso a parte sui paragrafi scelti di una sezione
function openAddonPickerSheet(sec, { existing = null } = {}) {
  return new Promise(resolve => {
    const parts = splitMdParts(sec.md);
    const preTitles = new Set((existing?.parts || []).map(t => foldAccents(t)));
    const picked = new Set(existing ? parts.filter(p => preTitles.has(foldAccents(p.title))).map(p => p.idx) : []);
    if (existing && !picked.size && parts.length) picked.add(parts.length - 1);
    const sh = openSheet(`
      <h2>${existing ? 'Modifica ripasso nuove aggiunte' : '✨ Ripasso a parte per nuove aggiunte'}</h2>
      <p class="sheet-sub">${esc(sec.title)}: scegli i paragrafi nuovi da ripassare con un calendario separato, senza modificare il ripasso della sezione principale.</p>
      <label class="field"><span>Etichetta del ripasso a parte</span>
        <input class="input" id="adTitle" value="${esc(existing?.title || `Nuove aggiunte (${new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })})`)}" placeholder="Es. Nuove aggiunte (da Cervelletto)"></label>
      ${existing ? '' : `
      <div class="field"><span class="lbl">Primo ripasso</span>
        <div class="inline">
          <label class="check"><input type="radio" name="adWhen" value="tomorrow" checked><span>Domani</span></label>
          <label class="check"><input type="radio" name="adWhen" value="today"><span>Subito oggi</span></label>
        </div>
      </div>`}
      <div class="inline" style="margin:6px 0">
        <button type="button" class="btn sm ghost" data-adp="all">Seleziona tutti</button>
        <button type="button" class="btn sm ghost" data-adp="none">Nessuno</button>
      </div>
      <ul class="cand pick-list" id="adPartList">${parts.map(p => `
        <li><label class="check"><input type="checkbox" value="${p.idx}" ${picked.has(p.idx) ? 'checked' : ''}>
          <span><span class="cand-f">${esc(p.title)}</span><span class="cand-b">${esc(aiText(p.md).replace(/\s+/g, ' ').trim().slice(0, 120))}</span></span>
        </label></li>`).join('')}</ul>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-ad="no">Annulla</button>
        <button type="button" class="btn primary" data-ad="ok">${existing ? 'Salva' : 'Crea ripasso a parte'}</button>
      </div>`, { label: 'Ripasso nuove aggiunte', onClose: v => resolve(!!v) });

    sh.el.addEventListener('change', e => {
      const cb = e.target.closest('#adPartList input[type="checkbox"]');
      if (!cb) return;
      if (cb.checked) picked.add(+cb.value); else picked.delete(+cb.value);
    });
    sh.el.addEventListener('click', async e => {
      const pb = e.target.closest('[data-adp]');
      if (pb) {
        const on = pb.dataset.adp === 'all';
        picked.clear();
        $$('#adPartList input[type="checkbox"]', sh.el).forEach(cb => { cb.checked = on; if (on) picked.add(+cb.value); });
        return;
      }
      const b = e.target.closest('[data-ad]');
      if (!b) return;
      if (b.dataset.ad === 'no') { sh.close(false); return; }
      const chosen = parts.filter(p => picked.has(p.idx));
      if (!chosen.length) { toast('Seleziona almeno un paragrafo'); return; }
      const title = $('#adTitle', sh.el).value.trim() || 'Nuove aggiunte';
      const md = chosen.map(p => p.md).join('\n\n');
      const partTitles = chosen.map(p => p.title);
      sec.addReviews = addReviewsOf(sec).slice();
      if (existing) {
        const cur = sec.addReviews.find(x => x.id === existing.id);
        if (cur) Object.assign(cur, { title, parts: partTitles, md, updated: Date.now() });
      } else {
        const when = $('input[name="adWhen"]:checked', sh.el)?.value === 'today' ? todayStr() : addDays(todayStr(), 1);
        sec.addReviews.push({
          id: uid(),
          title,
          parts: partTitles,
          md,
          created: Date.now(),
          srs: { ef: 2.5, interval: when === todayStr() ? 0 : 1, reps: 0, due: when, history: [] }
        });
      }
      await saveSection(sec);
      toast(existing ? 'Ripasso nuove aggiunte aggiornato' : 'Ripasso a parte creato (ripasso principale invariato)');
      sh.close(true);
    });
  });
}

// Vista dedicata allo studio/ripasso di un pacchetto di nuove aggiunte (#/sec/<secId>/addon/<addonId>)
function viewAddonReview(secId, addonId) {
  const sec = secById(secId);
  if (!sec) return notFound('Questa sezione');
  const addon = addReviewsOf(sec).find(x => x.id === addonId);
  if (!addon) return notFound('Questo ripasso delle nuove aggiunte');
  const nb = nbById(sec.notebookId);
  const hasCloze = countCloze(addon.md) > 0;
  let tab = hasCloze ? 'cloze' : 'read';

  const statusTxt = () => {
    const s = addon.srs;
    const reps = s?.history?.length || 0;
    const tail = reps ? ` · ripassato ${reps} ${reps === 1 ? 'volta' : 'volte'}` : '';
    if (!s || !s.due) return 'Non pianificato';
    if (s.due < todayStr()) return `In ritardo (${fmtDue(s.due)})${tail}`;
    if (s.due === todayStr()) return `Da ripassare oggi${tail}`;
    return `Prossimo ripasso ${fmtDue(s.due)}${tail}`;
  };

  setView(`
    <div class="back-row">
      <a class="back" href="#/sec/${sec.id}/read">Torna a “${esc(sec.title)}”</a>
      <a class="back" href="#/review">Ripasso</a>
    </div>
    <header class="sec-head">
      <p class="meta">✨ Ripasso a parte · ${esc([nb?.name, groupPathText(sec)].filter(Boolean).join(' › '))}</p>
      <h1>${esc(addon.title || 'Nuove aggiunte')}</h1>
      <p class="meta">Sezione: <b>${esc(sec.title)}</b> · ${esc(statusTxt())} <span class="muted-inline">(il ripasso principale resta separato)</span></p>
      <div class="sec-extra">
        <button type="button" class="btn sm" data-ar="edit">✎ Modifica paragrafi</button>
        <button type="button" class="btn sm ghost" data-ar="done">✓ Segna integrato nel ripasso principale</button>
      </div>
    </header>
    <nav class="tabs" aria-label="Modalità di studio nuove aggiunte" id="arTabs">
      ${hasCloze ? '<button type="button" class="tab on" data-artab="cloze">Cloze</button>' : ''}
      <button type="button" class="tab ${hasCloze ? '' : 'on'}" data-artab="read">Leggi</button>
      <button type="button" class="tab" data-artab="blank">Pagina bianca</button>
      <button type="button" class="tab" data-artab="oral">Orale</button>
    </nav>
    <section id="arBody" class="mode-body"></section>
    <div id="arGradeSlot"></div>
  `);

  const paintGrade = () => {
    const slot = $('#arGradeSlot');
    slot.innerHTML = `
      <div class="grade">
        <p class="grade-q"><span>Quanto ricordavi di queste nuove aggiunte?</span></p>
        <div class="grade-btns">
          ${GRADES.map((g, i) => {
            const nx = nextSrs(addon.srs, g.q, `addon:${tab}`);
            return `<button class="gbtn g-${g.key}" data-aq="${g.q}" aria-keyshortcuts="${i + 1}">
              <span>${g.label}</span><small>${fmtInterval(nx.interval)}</small></button>`;
          }).join('')}
        </div>
      </div>`;
    let graded = false;
    const grade = async q => {
      if (graded) return;
      graded = true;
      $$('.gbtn', slot).forEach(b => { b.disabled = true; });
      const prev = addon.srs ? JSON.parse(JSON.stringify(addon.srs)) : newSrs();
      addon.srs = nextSrs(addon.srs, q, `addon:${tab}`);
      await saveSection(sec);
      Stats.addReview();
      toast(addon.srs.interval === 0 ? 'Resta nei ripassi di oggi' : `Prossimo ripasso nuove aggiunte ${fmtDue(addon.srs.due)}`, '', {
        label: 'Annulla',
        fn: async () => { addon.srs = prev; await saveSection(sec); toast('Valutazione annullata'); route(); }
      });
      go(state.fromReview ? '#/review' : `#/sec/${sec.id}/read`);
    };
    $$('.gbtn', slot).forEach(b => b.addEventListener('click', () => grade(+b.dataset.aq)));
  };

  const renderTab = () => {
    $$('[data-artab]').forEach(b => b.classList.toggle('on', b.dataset.artab === tab));
    const body = $('#arBody');
    if (tab === 'cloze') {
      body.innerHTML = `
        <div class="toolbar">
          <span id="arCzCnt">0 rivelati</span>
          <button class="btn sm" type="button" data-arcz="all">Rivela tutto</button>
          <button class="btn sm ghost" type="button" data-arcz="hide">Nascondi di nuovo</button>
        </div>
        <article class="notes cloze-mode">${renderMd(addon.md)}</article>`;
      const art = $('.notes', body);
      hydrateImages(art);
      const marks = $$('mark.cz', art);
      const upd = () => { const r = marks.filter(m => m.classList.contains('rev')).length; $('#arCzCnt', body).textContent = `${r} di ${marks.length} rivelati`; };
      upd();
      marks.forEach(m => { m.tabIndex = 0; m.addEventListener('click', () => { m.classList.toggle('rev'); upd(); }); });
      $('[data-arcz="all"]', body).onclick = () => { marks.forEach(m => m.classList.add('rev')); upd(); };
      $('[data-arcz="hide"]', body).onclick = () => { marks.forEach(m => m.classList.remove('rev')); upd(); };
    } else if (tab === 'read') {
      body.innerHTML = `<article class="notes">${renderMd(addon.md)}</article>`;
      hydrateImages($('.notes', body));
    } else if (tab === 'blank') {
      body.innerHTML = `
        <p class="hint">Scrivi quello che ricordi delle sole nuove aggiunte, poi confronta con il testo.</p>
        <textarea class="input" rows="8" id="arBlankTa" placeholder="Scrivi qui tutto ciò che ricordi…"></textarea>
        <div class="inline" style="margin:10px 0"><button type="button" class="btn primary" data-ar-cmp>Confronta con gli appunti</button></div>
        <article class="notes" id="arRef" hidden>${renderMd(addon.md)}</article>`;
      hydrateImages($('#arRef', body));
      $('[data-ar-cmp]', body).onclick = () => { $('#arRef', body).hidden = false; };
    } else {
      body.innerHTML = `
        <p class="hint">Ripeti a voce alta le nuove aggiunte, poi scopri il testo per verificare.</p>
        <div class="inline" style="margin:10px 0"><button type="button" class="btn primary" data-ar-show>Mostra gli appunti</button></div>
        <article class="notes" id="arRef" hidden>${renderMd(addon.md)}</article>`;
      hydrateImages($('#arRef', body));
      $('[data-ar-show]', body).onclick = e => { $('#arRef', body).hidden = false; e.currentTarget.hidden = true; };
    }
    paintGrade();
  };

  renderTab();
  $('#arTabs').addEventListener('click', e => { const b = e.target.closest('[data-artab]'); if (b) { tab = b.dataset.artab; renderTab(); } });
  on('[data-ar="edit"]', 'click', async () => { if (await openAddonPickerSheet(sec, { existing: addon })) route(); });
  on('[data-ar="done"]', 'click', async () => {
    const ok = await modal({
      title: 'Integrare nel ripasso principale?',
      text: 'Questo ripasso a parte verrà rimosso. Il testo resta nella sezione e prosegue nel ripasso principale.',
      confirm: 'Segna integrato'
    });
    if (!ok) return;
    sec.addReviews = addReviewsOf(sec).filter(x => x.id !== addon.id);
    await saveSection(sec);
    toast('Nuove aggiunte integrate nel ripasso principale');
    go(`#/sec/${sec.id}/read`);
  });
}

// Rileva coppie di sezioni con titoli molto simili (possibili doppioni)
function findSimilarSectionPairs(secs) {
  const stop = new Set(['della', 'dello', 'delle', 'degli', 'nella', 'nelle', 'sugli', 'sulla', 'sul', 'nel', 'nei', 'con', 'per', 'tra', 'fra', 'uno', 'una', 'che', 'del', 'dei', 'dal', 'alla', 'alle', 'agli', 'anatomia', 'fisiologia', 'istologia', 'patologia', 'clinica', 'unita']);
  const toks = s => new Set((foldAccents(s.title.replace(/^\[unita\]\s*/i, '')).match(/[a-z0-9]{4,}/g) || []).filter(w => !stop.has(w)).map(w => w.slice(0, 7)));
  const items = secs.filter(s => !/^\[unita\]/i.test(s.title)).map(s => ({ s, t: toks(s), norm: foldAccents(s.title) }));
  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (!a.t.size || !b.t.size) continue;
      let inter = 0;
      a.t.forEach(w => { if (b.t.has(w)) inter++; });
      const union = a.t.size + b.t.size - inter;
      const jac = union ? inter / union : 0;
      const sub = a.norm.length >= 6 && b.norm.length >= 6 && (a.norm.includes(b.norm) || b.norm.includes(a.norm));
      if (sub || (inter >= 2 && jac >= 0.42) || jac >= 0.55) {
        pairs.push({ a: a.s, b: b.s, score: sub ? 1 : jac });
      }
    }
  }
  return pairs.sort((x, y) => y.score - x.score).slice(0, 6);
}

// Trasferisce tutti gli allegati e collegamenti dalle sezioni secondarie alla destinazione
async function transferSectionExtras(target, secondaries, { deleteSecondaries = false } = {}) {
  const secIdsMoved = new Set(secondaries.map(s => s.id));
  const stats = { cards: 0, questions: 0, maps: 0, htmls: 0, pdfs: 0, padPages: 0 };

  // 1. Domande di richiamo (deduplicate)
  const qSeen = new Set((target.questions || []).map(q => foldAccents(q.q)));
  target.questions = [...(target.questions || [])];
  for (const s of secondaries) {
    for (const q of (s.questions || [])) {
      const k = foldAccents(q.q);
      if (k && !qSeen.has(k)) { qSeen.add(k); target.questions.push({ ...q }); stats.questions++; }
    }
  }

  // 2. Tag
  target.tags = [...new Set([...tagsOf(target), ...secondaries.flatMap(tagsOf)])];

  // 3. Fonti
  const srcList = [...sourcesOf(target)];
  const srcSeen = new Set(srcList.map(x => foldAccents(x)));
  for (const s of secondaries) {
    for (const src of sourcesOf(s)) {
      const k = foldAccents(src);
      if (k && !srcSeen.has(k)) { srcSeen.add(k); srcList.push(src); }
    }
  }
  if (srcList.length) target.sources = srcList;

  // 4. Link esterni
  const lnkList = [...secLinksOf(target)];
  const lnkSeen = new Set(lnkList.map(l => l.url));
  for (const s of secondaries) {
    for (const l of secLinksOf(s)) {
      if (l.url && !lnkSeen.has(l.url)) { lnkSeen.add(l.url); lnkList.push({ ...l }); }
    }
  }
  if (lnkList.length) target.links = lnkList;

  // 5. Video
  const vidList = [...(Array.isArray(target.videos) ? target.videos : [])];
  const vidSeen = new Set(vidList.map(v => v.url || v.id));
  for (const s of secondaries) {
    for (const v of (Array.isArray(s.videos) ? s.videos : [])) {
      const k = v.url || v.id;
      if (k && !vidSeen.has(k)) { vidSeen.add(k); vidList.push({ ...v }); }
    }
  }
  if (vidList.length) target.videos = vidList;

  // 6. Mappe mentali
  const mapList = [...mapsOf(target)];
  const mapSeen = new Set(mapList.map(m => m.id));
  for (const s of secondaries) {
    for (const m of mapsOf(s)) {
      if (!mapSeen.has(m.id)) { mapSeen.add(m.id); mapList.push(JSON.parse(JSON.stringify(m))); stats.maps++; }
    }
  }
  if (mapList.length) target.maps = mapList;

  // 7. Mappe HTML
  const htmlList = [...htmlsOf(target)];
  const htmlSeen = new Set(htmlList.map(h => h.id));
  for (const s of secondaries) {
    for (const h of htmlsOf(s)) {
      if (!htmlSeen.has(h.id)) { htmlSeen.add(h.id); htmlList.push({ ...h }); stats.htmls++; }
    }
  }
  if (htmlList.length) target.htmls = htmlList;

  // 8. Etichette sugli schemi
  const tLabels = { ...(target.labels && typeof target.labels === 'object' ? target.labels : {}) };
  for (const s of secondaries) {
    if (s.labels && typeof s.labels === 'object') {
      for (const [imgId, val] of Object.entries(s.labels)) {
        if (!tLabels[imgId] || ((val?.masks || []).length > (tLabels[imgId]?.masks || []).length)) {
          tLabels[imgId] = JSON.parse(JSON.stringify(val));
        }
      }
    }
  }
  if (Object.keys(tLabels).length) target.labels = tLabels;

  // 9. Riferimenti PDF
  const refList = [...(Array.isArray(target.pdfRefs) ? target.pdfRefs : [])];
  const refSeen = new Set(refList.map(r => `${r.pdfId}:${r.from}-${r.to}:${r.bmId || ''}`));
  for (const s of secondaries) {
    for (const r of (Array.isArray(s.pdfRefs) ? s.pdfRefs : [])) {
      const k = `${r.pdfId}:${r.from}-${r.to}:${r.bmId || ''}`;
      if (!refSeen.has(k)) { refSeen.add(k); refList.push({ ...r }); }
    }
  }
  if (refList.length) target.pdfRefs = refList;

  // 10. Flashcard delle sezioni secondarie → spostate sulla destinazione (storico Anki salvo; eliminare poi [Unita] è sicuro)
  for (const c of state.cards.filter(x => secIdsMoved.has(x.sectionId))) {
    c.sectionId = target.id;
    c.notebookId = target.notebookId;
    await saveCard(c);
    stats.cards++;
  }

  // 11. PDF collegati alle sezioni secondarie
  for (const p of state.pdfs.filter(x => secIdsMoved.has(x.sectionId))) {
    p.sectionId = target.id;
    p.notebookId = target.notebookId;
    await savePdfMeta(p);
    stats.pdfs++;
  }

  // 12. Domande d'esame collegate alle sezioni secondarie
  if (typeof examQs === 'function') {
    for (const eq of examQs()) {
      if (!Array.isArray(eq.secIds) || !eq.secIds.some(id => secIdsMoved.has(id))) continue;
      const nextIds = deleteSecondaries
        ? [...new Set(eq.secIds.map(id => (secIdsMoved.has(id) ? target.id : id)))]
        : [...new Set([...eq.secIds, target.id])];
      eq.secIds = nextIds;
      await saveLink(eq);
    }
  }

  // 13. Lezioni audio del notebook
  const nb = nbById(target.notebookId);
  if (nb && Array.isArray(nb.audios) && nb.audios.length) {
    let nbDirty = false;
    const updArr = arr => {
      if (!Array.isArray(arr) || !arr.some(id => secIdsMoved.has(id))) return arr;
      nbDirty = true;
      return deleteSecondaries
        ? [...new Set(arr.map(id => (secIdsMoved.has(id) ? target.id : id)))]
        : [...new Set([...arr, target.id])];
    };
    nb.audios.forEach(a => {
      a.secIds = updArr(a.secIds);
      (a.marks || []).forEach(m => { m.secIds = updArr(m.secIds); });
    });
    if (nbDirty) await saveNotebook(nb);
  }

  // 14. Fogli del Blocco note (PadDB)
  if (typeof PadDB !== 'undefined') {
    try {
      const dstKey = `sec:${target.id}`;
      let dstPad = await PadDB.get(dstKey);
      let padChanged = false;
      for (const s of secondaries) {
        const srcPad = await PadDB.get(`sec:${s.id}`);
        const pages = (srcPad?.pages || []).filter(pg => pg && pg.strokes && pg.strokes.length);
        if (!pages.length) continue;
        if (!dstPad) dstPad = { pages: [], bg: srcPad.bg || 'lines', title: target.title, t: Date.now() };
        dstPad.pages = [...(dstPad.pages || []).filter(pg => pg && pg.strokes && pg.strokes.length), ...pages.map(pg => JSON.parse(JSON.stringify(pg)))];
        stats.padPages += pages.length;
        padChanged = true;
        if (deleteSecondaries) await PadDB.del(`sec:${s.id}`);
      }
      if (padChanged && dstPad) {
        dstPad.title = target.title;
        dstPad.t = Date.now();
        await PadDB.put(dstKey, dstPad);
      }
    } catch { /* ignora eventuali errori PadDB */ }
  }

  // 15. Ripassi a parte già esistenti sulle secondarie
  const tAddons = [...addReviewsOf(target)];
  for (const s of secondaries) {
    for (const a of addReviewsOf(s)) {
      if (!tAddons.some(x => x.id === a.id)) tAddons.push(JSON.parse(JSON.stringify(a)));
    }
  }
  if (tAddons.length) target.addReviews = tAddons;

  return stats;
}

// Flusso completo per unire 2 o più sezioni (AI merge, schema o accoda manuale)
function mergeSectionsFlow({ nb, folder = null, primarySec = null } = {}) {
  if (!nb) return;
  const allSecs = secsOf(nb.id).sort((a, b) => a.title.localeCompare(b.title, 'it'));
  if (allSecs.length < 2) { toast('Servono almeno due sezioni in questo notebook per unirle'); return; }
  const folderTree = folder ? groupTreeIds(nb, folder) : null;
  let scopeOnlyFolder = !!folderTree && allSecs.filter(s => folderTree.has(s.groupId)).length >= 2;

  const picked = new Set(primarySec ? [primarySec.id] : []);
  let destId = primarySec ? primarySec.id : '';
  let mergeMode = AI.ready() ? 'merge' : 'manual';
  let schemaId = '';
  let keepHeads = !!S().fmtKeepHeads;
  let extra = '';
  let deleteSecondaries = false; // disattiva di default per sicurezza
  let customTitle = primarySec ? primarySec.title : '';
  let titleTouched = false;
  let qText = '';

  const wordCount = md => (aiText(stripCloze(md || '')).match(/[A-Za-zÀ-ÿ0-9]+/g) || []).length;
  const ctl = new AbortController();
  let done = false;

  const openStep1 = () => {
    const poolBase = () => scopeOnlyFolder ? allSecs.filter(s => folderTree.has(s.groupId)) : allSecs;
    const dupPairs = findSimilarSectionPairs(poolBase());
    const schemas = allSchemas();

    const sh = openSheet(`
      <h2>🔀 Unisci più sezioni</h2>
      <p class="sheet-sub">${esc(nb.name)}${folder ? ` › ${esc(folder.name)}` : ''}: seleziona 2 o più sezioni da fondere in un’unica sezione ordinata, trasferendo anche flashcard, domande, mappe, PDF e appunti a mano.</p>
      ${dupPairs.length ? `
        <div class="mg-dups">
          <span class="lbl">Possibili sezioni doppie rilevate (tocca per selezionarle):</span>
          <div class="tag-cloud">${dupPairs.map((p, i) => `<button type="button" class="tag" data-mgdup="${i}">${esc(p.a.title)} ↔ ${esc(p.b.title)}</button>`).join('')}</div>
        </div>` : ''}
      <div class="mg-bar">
        <input type="search" class="input search" id="mgQ" placeholder="Cerca sezioni per titolo o cartella…" aria-label="Cerca sezioni" value="${esc(qText)}">
        ${folderTree ? `<label class="check mg-scope"><input type="checkbox" id="mgFolderOnly" ${scopeOnlyFolder ? 'checked' : ''}><span>Solo in “${esc(folder.name)}”</span></label>` : ''}
      </div>
      <ul class="cand pick-list mg-list" id="mgList"></ul>
      <div class="mg-cfg" id="mgCfg">
        <div class="grid2">
          <label class="field"><span>Sezione principale (mantiene il suo ripasso)</span>
            <select class="input" id="mgDest"></select></label>
          <label class="field"><span>Titolo finale</span>
            <input class="input" id="mgTitle" value="${esc(customTitle)}" placeholder="Titolo della sezione unita"></label>
        </div>
        <div class="field"><span class="lbl">Come unire i testi</span>
          <div class="sch-list" role="radiogroup" aria-label="Modalità di fusione">
            <label class="sch-opt ${AI.ready() ? 'sch-opt-hi' : ''}">
              <input type="radio" name="mgMode" value="merge" ${mergeMode === 'merge' ? 'checked' : ''} ${AI.ready() ? '' : 'disabled'}>
              <span><b>🔀 Fondi con ${AI.name()} e rimuovi doppioni</b><small>${AI.ready() ? 'Accorpa i concetti ripetuti senza perdere nessun dettaglio unico, conservando cloze, evidenziatori e immagini' : 'Serve una chiave AI in Impostazioni'}</small></span>
            </label>
            ${AI.ready() && schemas.length ? `
            <label class="sch-opt">
              <input type="radio" name="mgMode" value="schema" ${mergeMode === 'schema' ? 'checked' : ''}>
              <span><b>📋 Fondi con ${AI.name()} dentro uno schema fisso</b><small>Riordina tutte le sezioni scelte sotto i titoli di uno schema</small></span>
            </label>` : ''}
            <label class="sch-opt">
              <input type="radio" name="mgMode" value="manual" ${mergeMode === 'manual' ? 'checked' : ''}>
              <span><b>📎 Accoda senza AI (manuale)</b><small>Unisce subito i testi sotto i rispettivi titoli e sposta tutti gli allegati, senza consumare quota AI</small></span>
            </label>
          </div>
        </div>
        <div id="mgAiOpts" ${mergeMode === 'manual' ? 'hidden' : ''}>
          ${schemas.length ? `<label class="field" id="mgSchemaWrap" ${mergeMode === 'schema' ? '' : 'hidden'}><span>Schema</span>
            <select class="input" id="mgSchema">${schemas.map(sc => `<option value="${esc(sc.id)}" ${(schemaId || schemas[0].id) === sc.id ? 'selected' : ''}>${esc(sc.name)}</option>`).join('')}</select></label>` : ''}
          <label class="check" id="mgKeepWrap" ${mergeMode === 'merge' ? '' : 'hidden'}><input type="checkbox" id="mgKeep" ${keepHeads ? 'checked' : ''}><span>Mantieni il più possibile i titoli esistenti</span></label>
          <label class="field"><span>Indicazioni extra per l’AI <small class="muted-inline">(facoltativo)</small></span>
            <input class="input" id="mgExtra" value="${esc(extra)}" placeholder="Es. Dai priorità alle definizioni della prima sezione; metti le vie in tabella"></label>
        </div>
        <div class="mg-safe">
          <label class="check"><input type="checkbox" id="mgDelSec" ${deleteSecondaries ? 'checked' : ''}><span>Elimina subito le sezioni secondarie dopo l’unione</span></label>
          <p class="hint">Lasciandola disattiva (consigliato), le sezioni secondarie restano intatte con prefisso <b>[Unita]</b> nel titolo, mentre flashcard e PDF vengono spostati nella sezione finale: quando sei sicura, potrai eliminare le <b>[Unita]</b> senza perdere nulla.</p>
        </div>
      </div>
      <p class="err-line" id="mgErr" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-mg="no">Annulla</button>
        <button type="button" class="btn primary" data-mg="go" disabled>Continua</button>
      </div>`, { label: 'Unisci sezioni', onClose: () => { if (!done) { done = true; ctl.abort(); } } });

    const listEl = $('#mgList', sh.el);
    const destEl = $('#mgDest', sh.el);
    const titleEl = $('#mgTitle', sh.el);
    const goBtn = $('[data-mg="go"]', sh.el);

    const syncDest = () => {
      const sel = allSecs.filter(s => picked.has(s.id));
      if (destId !== '__new' && !picked.has(destId)) destId = sel[0]?.id || '';
      destEl.innerHTML = [
        ...sel.map(s => `<option value="${s.id}" ${s.id === destId ? 'selected' : ''}>${esc(s.title)}${s.studyhub || s.srs?.due ? ' (con ripasso)' : ''}</option>`),
        '<option value="__new"' + (destId === '__new' ? ' selected' : '') + '>＋ Crea una nuova sezione (tieni tutte le originali con [Unita])</option>'
      ].join('');
      if (!titleTouched) {
        const dSec = secById(destId);
        customTitle = dSec ? dSec.title : (sel[0]?.title || '');
        titleEl.value = customTitle;
      }
      goBtn.disabled = sel.length < 2;
      goBtn.textContent = sel.length < 2
        ? 'Scegli almeno 2 sezioni'
        : mergeMode === 'manual' ? `📎 Anteprima unione (${sel.length} sezioni)` : `🔀 Fondi con ${AI.name()} (${sel.length} sezioni)`;
    };

    const drawList = () => {
      const pool = poolBase();
      const vis = pool.filter(s => picked.has(s.id) || matchTokens(`${s.title} ${groupPathText(s)}`, qText));
      vis.sort((a, b) => (picked.has(b.id) - picked.has(a.id)) || a.title.localeCompare(b.title, 'it'));
      listEl.innerHTML = vis.map(s => {
        const gp = groupPathText(s);
        const wc = wordCount(s.md);
        const bits = [gp, `${wc} parole`];
        const nc = cardsOfSection(s.id).length;
        if (nc) bits.push(`${nc} flashcard`);
        if ((s.questions || []).length) bits.push(`${s.questions.length} dom.`);
        if (mapsOf(s).length) bits.push(`${mapsOf(s).length} mappe`);
        return `<li><label class="check"><input type="checkbox" value="${s.id}" ${picked.has(s.id) ? 'checked' : ''}>
          <span><span class="cand-f">${esc(s.title)}${primarySec && s.id === primarySec.id ? ' <small class="pill soft">corrente</small>' : ''}</span>
          <span class="cand-b">${esc(bits.filter(Boolean).join(' · '))}</span></span></label></li>`;
      }).join('') || '<li class="hint">Nessuna sezione trovata.</li>';
      syncDest();
    };

    const syncMode = () => {
      mergeMode = $('input[name="mgMode"]:checked', sh.el)?.value || 'manual';
      $('#mgAiOpts', sh.el).hidden = mergeMode === 'manual';
      const sw = $('#mgSchemaWrap', sh.el);
      if (sw) sw.hidden = mergeMode !== 'schema';
      $('#mgKeepWrap', sh.el).hidden = mergeMode !== 'merge';
      syncDest();
    };

    drawList();
    syncMode();

    $('#mgQ', sh.el).addEventListener('input', e => { qText = e.target.value; drawList(); });
    $('#mgFolderOnly', sh.el)?.addEventListener('change', e => { scopeOnlyFolder = e.target.checked; drawList(); });
    listEl.addEventListener('change', e => {
      const cb = e.target.closest('input[type="checkbox"]');
      if (!cb) return;
      if (cb.checked) picked.add(cb.value); else picked.delete(cb.value);
      syncDest();
    });
    destEl.addEventListener('change', e => {
      destId = e.target.value;
      if (!titleTouched && destId !== '__new') {
        const s = secById(destId);
        if (s) { customTitle = s.title; titleEl.value = customTitle; }
      }
    });
    titleEl.addEventListener('input', e => { customTitle = e.target.value; titleTouched = true; });
    sh.el.addEventListener('change', e => {
      if (e.target.name === 'mgMode') syncMode();
      if (e.target.id === 'mgKeep') keepHeads = e.target.checked;
      if (e.target.id === 'mgSchema') schemaId = e.target.value;
      if (e.target.id === 'mgDelSec') deleteSecondaries = e.target.checked;
    });
    $('#mgExtra', sh.el)?.addEventListener('input', e => { extra = e.target.value; });

    sh.el.addEventListener('click', async e => {
      const dup = e.target.closest('[data-mgdup]');
      if (dup) {
        const p = dupPairs[+dup.dataset.mgdup];
        if (!p) return;
        picked.clear();
        picked.add(p.a.id);
        picked.add(p.b.id);
        destId = p.a.id;
        titleTouched = false;
        drawList();
        toast(`Selezionate: “${p.a.title}” e “${p.b.title}”`);
        return;
      }
      const b = e.target.closest('[data-mg]');
      if (!b) return;
      if (b.dataset.mg === 'no') { sh.close(null); return; }
      const sel = allSecs.filter(s => picked.has(s.id));
      if (sel.length < 2) { toast('Scegli almeno 2 sezioni'); return; }
      const primary = destId === '__new' ? null : secById(destId);
      const ordered = primary ? [primary, ...sel.filter(s => s.id !== primary.id)] : sel;
      const finalTitle = (titleEl.value.trim() || ordered[0].title);
      const combinedBefore = ordered.map(s => `## ${s.title}\n\n${(s.md || '').trim()}`).join('\n\n');

      if (mergeMode === 'manual') {
        const manualMd = primary
          ? [
              (primary.md || '').trim(),
              ...ordered.slice(1).map(s => `## ${s.title}\n\n${(s.md || '').trim()}`)
            ].filter(Boolean).join('\n\n---\n\n')
          : ordered.map(s => `## ${s.title}\n\n${(s.md || '').trim()}`).join('\n\n---\n\n');
        done = true; sh.close(null); done = false;
        openStep2({ ordered, primary, finalTitle, md: cleanSimpleTex(repairMarkdownTables(manualMd)), combinedBefore, truncated: false, modeLbl: '📎 Accoda senza AI' });
        return;
      }

      const payloadText = ordered.map((s, idx) => `FONTE ${idx + 1} (sezione “${s.title}”${idx === 0 && primary ? ' — sezione principale' : ''}):\n\n${(s.md || '').trim()}`).join('\n\n---\n\n');
      const sc = mergeMode === 'schema' ? schemas.find(x => x.id === ($('#mgSchema', sh.el)?.value || schemaId)) : null;
      S().fmtKeepHeads = keepHeads; Settings.save();

      goBtn.disabled = true;
      goBtn.textContent = `Fondo ${ordered.length} sezioni con ${AI.name()}… (può servire un minuto)`;
      $('#mgErr', sh.el).hidden = true;
      try {
        const sys = mergeMode === 'schema' && sc
          ? schemaSystem(sc, S().fmtMissing !== false, extra)
          : mergeSystem({ keepHeads, extra, hasSecond: true, srcCount: ordered.length });
        const r = await AI.generate({ system: sys, text: payloadText, signal: ctl.signal });
        let md = String(r.text || '').trim().replace(/^```(?:markdown|md)?[ \t]*\n/i, '').replace(/\n```\s*$/, '').trim();
        md = cleanSimpleTex(repairMarkdownTables(md));
        if (!md) throw new Error('L’AI non ha restituito appunti utilizzabili.');
        if (done) return;
        done = true; sh.close(null); done = false;
        openStep2({
          ordered, primary, finalTitle, md, combinedBefore, truncated: !!r.truncated,
          modeLbl: sc ? `📋 Schema “${sc.name}”` : `🔀 Fusione AI (${ordered.length} sezioni)`
        });
      } catch (err) {
        if (err.name === 'AbortError' || !sh.el.isConnected) return;
        const el = $('#mgErr', sh.el); el.textContent = err.message || 'Fusione non riuscita'; el.hidden = false;
        goBtn.disabled = false;
        syncDest();
      }
    });
  };

  const openStep2 = ({ ordered, primary, finalTitle, md: initialMd, combinedBefore, truncated, modeLbl }) => {
    let curMd = initialMd;
    const secondaries = primary ? ordered.slice(1) : ordered;
    const ck = reformatCheck(combinedBefore, curMd);
    const diffPct = ck.wordsBefore ? Math.round(((ck.wordsAfter - ck.wordsBefore) / ck.wordsBefore) * 100) : 0;
    const diffTxt = diffPct < 0 ? `${diffPct}% ridondanze rimosse` : diffPct > 0 ? `+${diffPct}%` : 'invariato';
    const warn = [];
    if (truncated) warn.push('La risposta dell’AI è stata troncata: controlla la fine prima di applicare.');
    if (ck.lost.length > Math.max(5, ck.total * 0.06)) warn.push(`${ck.lost.length} parole non compaiono più tali e quali (es.: ${ck.lost.slice(0, 8).join(', ')}). Controlla che non manchi nessun dettaglio.`);
    if (ck.cloze[1] !== ck.cloze[0]) warn.push(`I cloze erano ${ck.cloze[0]}, ora sono ${ck.cloze[1]}.`);
    if (ck.imgs[1] < ck.imgs[0]) warn.push(`Mancano ${ck.imgs[0] - ck.imgs[1]} immagini: controlla nella scheda Codice.`);

    const primaryBaseMd = primary ? (primary.md || '') : '';
    const analyzed = analyzeNewParts(primaryBaseMd, curMd);
    const hasPrimaryReview = !!(primary && (primary.studyhub || primary.srs?.due || (primary.srs?.history && primary.srs.history.length)));
    let createAddon = !!primary && (hasPrimaryReview || analyzed.some(p => p.suggested));
    const addonPicked = new Set(analyzed.filter(p => p.suggested).map(p => p.idx));
    if (createAddon && !addonPicked.size && analyzed.length > 1) addonPicked.add(analyzed.length - 1);
    const defaultAddonTitle = `Nuove aggiunte (da ${secondaries.map(s => s.title).join(', ').slice(0, 55)})`;

    const sh = openSheet(`
      <h2>Controlla la fusione prima di applicare</h2>
      <p class="sheet-sub">${esc(finalTitle)} · ${esc(modeLbl)}</p>
      <div class="sch-stats">
        <span>Parole: <b>${ck.wordsBefore}</b> → <b>${ck.wordsAfter}</b> (${esc(diffTxt)})</span>
        ${ck.cloze[0] || ck.cloze[1] ? `<span>Cloze: <b>${ck.cloze[0]}</b> → <b>${ck.cloze[1]}</b></span>` : ''}
        ${ck.imgs[0] ? `<span>Immagini: <b>${ck.imgs[1]}/${ck.imgs[0]}</b></span>` : ''}
      </div>
      ${warn.length ? `<ul class="sch-warn">${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="sch-ok">Tutti i concetti unici, i cloze e le immagini risultano conservati.</p>'}
      <div class="seg sm" role="tablist">
        <button type="button" class="seg-btn on" data-mpv="after" role="tab" aria-selected="true">Dopo</button>
        <button type="button" class="seg-btn" data-mpv="before" role="tab" aria-selected="false">Prima (${ordered.length} sezioni)</button>
        <button type="button" class="seg-btn" data-mpv="code" role="tab" aria-selected="false">Codice (modificabile)</button>
      </div>
      <div class="sch-prev notes" id="mgPrev">${renderMd(curMd)}</div>
      ${primary ? `
      <div class="mg-addon-cfg">
        <label class="check"><input type="checkbox" id="mgAddonOn" ${createAddon ? 'checked' : ''}><span><b>✨ Crea un ripasso a parte per le nuove aggiunte</b> <small class="muted-inline">(il ripasso della sezione principale resta invariato)</small></span></label>
        <div id="mgAddonBox" ${createAddon ? '' : 'hidden'}>
          <div class="grid2" style="margin-top:8px">
            <label class="field"><span>Etichetta</span><input class="input" id="mgAddonTitle" value="${esc(defaultAddonTitle)}"></label>
            <label class="field"><span>Primo ripasso nuove aggiunte</span>
              <select class="input" id="mgAddonWhen"><option value="tomorrow" selected>Domani</option><option value="today">Subito oggi</option></select></label>
          </div>
          <div class="inline" style="margin:4px 0 6px">
            <span class="hint" style="margin:0">Paragrafi inclusi nel ripasso a parte:</span>
            <button type="button" class="btn sm ghost" data-mgap="new">Solo novità</button>
            <button type="button" class="btn sm ghost" data-mgap="all">Tutti</button>
            <button type="button" class="btn sm ghost" data-mgap="none">Nessuno</button>
          </div>
          <ul class="cand pick-list mg-part-list" id="mgAddonParts">${analyzed.map(p => `
            <li><label class="check"><input type="checkbox" value="${p.idx}" ${addonPicked.has(p.idx) ? 'checked' : ''}>
              <span><span class="cand-f">${esc(p.title)} ${p.suggested ? `<span class="pill due">+${p.novelPct}% novità</span>` : (p.novelPct >= 10 ? `<span class="pill soft">+${p.novelPct}%</span>` : '')}</span>
              <span class="cand-b">${esc(aiText(p.md).replace(/\s+/g, ' ').trim().slice(0, 110))}</span></span>
            </label></li>`).join('')}</ul>
        </div>
      </div>` : ''}
      <div class="mg-safe-summary">
        <label class="check"><input type="checkbox" id="mgDel2" ${deleteSecondaries ? 'checked' : ''}><span>Elimina ${secondaries.length === 1 ? 'la sezione secondaria' : `le ${secondaries.length} sezioni secondarie`} dopo l’unione</span></label>
        <p class="hint" id="mgDelHint">${deleteSecondaries ? 'Le sezioni secondarie verranno eliminate (flashcard, PDF, domande, mappe e blocchi note vengono comunque trasferiti prima).' : 'Le sezioni secondarie restano intatte con prefisso <b>[Unita]</b> nel titolo (flashcard e PDF sono già spostati nella sezione finale, quindi potrai eliminare le [Unita] senza rischi).'}</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-mpv="no">Annulla</button>
        <button type="button" class="btn" data-mpv="back">Indietro</button>
        <button type="button" class="btn primary" data-mpv="ok">Applica fusione</button>
      </div>`, { label: 'Anteprima fusione sezioni', onClose: () => { if (!done) { done = true; } } });

    const prevEl = $('#mgPrev', sh.el);
    hydrateImages(prevEl);

    $('#mgAddonOn', sh.el)?.addEventListener('change', e => {
      createAddon = e.target.checked;
      $('#mgAddonBox', sh.el).hidden = !createAddon;
    });
    $('#mgAddonParts', sh.el)?.addEventListener('change', e => {
      const cb = e.target.closest('input[type="checkbox"]');
      if (!cb) return;
      if (cb.checked) addonPicked.add(+cb.value); else addonPicked.delete(+cb.value);
    });
    $('#mgDel2', sh.el).addEventListener('change', e => {
      deleteSecondaries = e.target.checked;
      $('#mgDelHint', sh.el).innerHTML = deleteSecondaries
        ? 'Le sezioni secondarie verranno eliminate (flashcard, PDF, domande, mappe e blocchi note vengono comunque trasferiti prima).'
        : 'Le sezioni secondarie restano intatte con prefisso <b>[Unita]</b> nel titolo (flashcard e PDF sono già spostati nella sezione finale, quindi potrai eliminare le [Unita] senza rischi).';
    });

    sh.el.addEventListener('click', async e => {
      const ap = e.target.closest('[data-mgap]');
      if (ap) {
        const k = ap.dataset.mgap;
        addonPicked.clear();
        $$('#mgAddonParts input[type="checkbox"]', sh.el).forEach(cb => {
          const p = analyzed[+cb.value];
          const on = k === 'all' ? true : k === 'new' ? !!p?.suggested : false;
          cb.checked = on;
          if (on) addonPicked.add(+cb.value);
        });
        return;
      }
      const b = e.target.closest('[data-mpv]');
      if (!b) return;
      const k = b.dataset.mpv;
      if (k === 'after' || k === 'before' || k === 'code') {
        const taCode = $('#mgCodeTa', prevEl);
        if (taCode) curMd = taCode.value;
        $$('.seg-btn', sh.el).forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); });
        if (k === 'code') {
          prevEl.innerHTML = `<textarea class="input mono-ta" id="mgCodeTa" rows="16">${esc(curMd)}</textarea>`;
        } else {
          prevEl.innerHTML = renderMd(k === 'after' ? curMd : combinedBefore);
          hydrateImages(prevEl);
        }
        return;
      }
      if (k === 'no') { sh.close(null); return; }
      if (k === 'back') { done = true; sh.close(null); done = false; openStep1(); return; }
      if (k === 'ok') {
        const taCode = $('#mgCodeTa', prevEl);
        if (taCode) curMd = taCode.value;
        b.disabled = true;
        b.textContent = 'Applico la fusione…';
        let target = primary;
        if (!target) {
          target = newSection(nb.id, { title: finalTitle, md: curMd, groupId: folder ? folder.id : (ordered[0].groupId || null) });
        } else {
          target.title = finalTitle;
          target.md = curMd;
        }
        const secToMerge = primary ? ordered.slice(1) : ordered;
        const stats = await transferSectionExtras(target, secToMerge, { deleteSecondaries });

        let addonCreated = false;
        if (primary && createAddon && addonPicked.size) {
          const curParts = splitMdParts(curMd);
          const chosen = analyzed.filter(p => addonPicked.has(p.idx)).map(p => curParts[p.idx] || p);
          if (chosen.length) {
            const when = $('#mgAddonWhen', sh.el)?.value === 'today' ? todayStr() : addDays(todayStr(), 1);
            const adTitle = $('#mgAddonTitle', sh.el)?.value.trim() || defaultAddonTitle;
            target.addReviews = addReviewsOf(target).slice();
            target.addReviews.push({
              id: uid(),
              title: adTitle,
              parts: chosen.map(p => p.title),
              md: chosen.map(p => p.md).join('\n\n'),
              created: Date.now(),
              srs: { ef: 2.5, interval: when === todayStr() ? 0 : 1, reps: 0, due: when, history: [] }
            });
            addonCreated = true;
          }
        }

        await saveSection(target);

        for (const s of secToMerge) {
          if (deleteSecondaries) {
            await deleteSection(s.id);
          } else {
            if (!/^\[Unita\]\s*/i.test(s.title)) {
              s.title = `[Unita] ${s.title}`;
              await saveSection(s);
            }
          }
        }

        const movedBits = [
          stats.cards ? `${stats.cards} flashcard` : '',
          stats.questions ? `${stats.questions} domande` : '',
          stats.maps ? `${stats.maps} mappe` : '',
          stats.pdfs ? `${stats.pdfs} PDF` : '',
          stats.padPages ? `${stats.padPages} fogli blocco note` : ''
        ].filter(Boolean);

        done = true;
        sh.close(null);
        toast(`Sezioni unite in “${target.title}”${movedBits.length ? ` (+${movedBits.join(', ')})` : ''}${addonCreated ? ' · ripasso a parte creato' : ''}${deleteSecondaries ? '' : ' · originali segnate [Unita]'}`);
        go(`#/sec/${target.id}/read`);
      }
    });
  };

  openStep1();
}

function modeEdit(sec, body, opts = {}) {
  const edMd0 = sec.md; // com’era quando hai aperto Modifica
  const otherNbs = state.notebooks.filter(n => n.id !== sec.notebookId);
  const savedView = (() => {
    try {
      const v = localStorage.getItem('nb-ed-view');
      if (v === 'wy' || v === 'code' || v === 'split') return v;
      return localStorage.getItem('nb-code-open') === '1' ? 'split' : 'wy';
    } catch { return 'wy'; }
  })();
  const qCount = (sec.questions || []).length;
  const lCount = secLinksOf(sec).length;
  const curGrpName = groupOf(sec)?.name || 'Nessuna cartella';
  const curTags = tagsOf(sec);

  body.innerHTML = `
    <div class="ed-top">
      <label class="field ed-title-f">
        <span>Titolo del micro-argomento</span>
        <input class="input" id="edTitle" value="${esc(sec.title)}">
      </label>
      <details class="ed-meta" id="edMeta">
        <summary>
          <span>Cartella e tag</span>
          <small class="muted-inline" id="edMetaSum">${esc(curGrpName)}${curTags.length ? ` · ${curTags.length} tag` : ''}</small>
        </summary>
        <div class="ed-meta-body">
          <label class="field"><span>Cartella</span>
            <select class="input" id="edGroup">${groupOptions(nbById(sec.notebookId), groupOf(sec)?.id || '')}</select></label>
          ${tagFieldHtml('edTags', curTags)}
        </div>
      </details>
    </div>

    <div class="edit-tools ed-v2" role="toolbar" aria-label="Strumenti dell’editor">
      <div class="ed-row">
        <span class="ed-grp" role="group" aria-label="Annulla e ripeti">
          <button class="btn sm ghost" type="button" data-ed="undo" title="Annulla ultima modifica" disabled>↶</button>
          <button class="btn sm ghost" type="button" data-ed="redo" title="Ripeti modifica" disabled>↷</button>
        </span>
        <span class="ed-grp" role="group" aria-label="Cloze e note">
          <button class="btn sm" type="button" data-wrap="==" title="Nasconde il testo selezionato nella modalità Cloze">Cloze</button>
          <button class="btn sm ghost" type="button" data-act="hint" title="Aggiunge un suggerimento al cloze dove si trova il cursore">? Indizio</button>
          <button class="btn sm ghost" type="button" data-act="pnote" title="Una nota che compare come ⓘ dove hai il cursore">ⓘ</button>
        </span>
        <span class="ed-grp" role="group" aria-label="Stile del testo">
          <button class="btn sm" type="button" data-wrap="**" title="Grassetto"><strong>G</strong></button>
          <button class="btn sm" type="button" data-mark="u" title="Sottolinea"><u>S</u></button>
          <button class="btn sm" type="button" data-ed="hl-pop" aria-expanded="false" title="Evidenzia con Stabilo Pastello o colori classici">🖍 ▾</button>
        </span>
        <span class="ed-grp" role="group" aria-label="Elenchi e rientri">
          <button class="btn sm" type="button" data-ins="list" title="Elenco puntato">• Elenco</button>
          <button class="btn sm ghost" type="button" data-ins="olist" title="Elenco numerato">1.</button>
          <button class="btn sm ghost" type="button" data-indent="1" title="Sposta a destra (Tab)">→</button>
          <button class="btn sm ghost" type="button" data-indent="-1" title="Riduci rientro (Maiusc+Tab)">←</button>
        </span>
      </div>
      <div class="ed-row ed-row-2">
        <button class="btn sm" type="button" data-ed="outline" aria-expanded="false" title="Vedi, sposta, rinomina o unisci i paragrafi della sezione">📑 Paragrafi <span class="ed-pcnt" id="edPcnt"></span></button>
        <button class="btn sm ghost" type="button" data-ed="find" aria-expanded="false" title="Trova e sostituisci (Ctrl+F)">🔍 Trova</button>
        <button class="btn sm ghost" type="button" data-ed="ins-pop" aria-expanded="false" title="Inserisci tabella, immagine, figura da PDF, link o HTML">＋ Inserisci ▾</button>
        ${AI.ready() ? '<button class="btn sm ed-ai-btn" type="button" data-act="ai-format" title="Fondi testi da più fonti eliminando i doppioni, oppure applica uno schema fisso">✨ Fondi / Riformatta</button>' : ''}
        <div class="seg sm ed-vseg" role="tablist" aria-label="Vista editor">
          <button type="button" role="tab" data-edview="wy" aria-selected="${savedView === 'wy'}">Anteprima</button>
          <button type="button" role="tab" data-edview="code" aria-selected="${savedView === 'code'}">Codice</button>
          <button type="button" role="tab" data-edview="split" aria-selected="${savedView === 'split'}">Entrambi</button>
        </div>
        ${typeof helpBtn === 'function' ? helpBtn('editor') : ''}
      </div>
    </div>

    <div class="ed-pop" id="edHlPop" hidden role="dialog" aria-label="Colori evidenziatore">
      <div class="ed-pop-lbl">Stabilo Pastello</div>
      <div class="ed-pop-dots">
        ${ED_HL_COLORS.filter(c => c.pastel).map(c => `<button class="rt-dot hl-${c.key}" data-mark="${c.key}" type="button" title="${esc(c.name)}" aria-label="${esc(c.name)}"></button>`).join('')}
      </div>
      <div class="ed-pop-lbl">Classici</div>
      <div class="ed-pop-dots">
        ${ED_HL_COLORS.filter(c => !c.pastel).map(c => `<button class="rt-dot hl-${c.key}" data-mark="${c.key}" type="button" title="${esc(c.name)}" aria-label="${esc(c.name)}"></button>`).join('')}
        <button class="btn sm ghost ed-pop-clear" data-mark="none" type="button" title="Togli evidenziazione">✕ Togli</button>
      </div>
    </div>

    <div class="ed-pop ed-menu-pop" id="edInsPop" hidden role="menu" aria-label="Inserisci nella sezione">
      <button class="ed-mitem" type="button" data-ins="table">▦ Tabella</button>
      <button class="ed-mitem" type="button" data-act="xref">🔗 Link a pagina</button>
      <button class="ed-mitem" type="button" data-act="img">🖼 Immagine</button>
      <button class="ed-mitem" type="button" data-act="pdf-fig">📄 Figura da PDF</button>
      <button class="ed-mitem" type="button" data-act="hw">✍️ Scrivi a mano</button>
      <button class="ed-mitem" type="button" data-act="html">&lt;/&gt; Blocco HTML</button>
    </div>

    <section class="ed-outline" id="edOutline" hidden aria-label="Gestione dei paragrafi"></section>

    <div class="ed-find" id="edFind" hidden role="search" aria-label="Trova e sostituisci">
      <div class="ed-find-row">
        <input class="input sm" id="edFindQ" placeholder="Trova nel testo…" autocomplete="off">
        <span class="ed-find-cnt" id="edFindCnt"></span>
        <button class="btn sm ghost" type="button" data-fnd="prev" title="Precedente">↑</button>
        <button class="btn sm ghost" type="button" data-fnd="next" title="Successivo">↓</button>
        <button class="btn sm ghost" type="button" data-fnd="close" aria-label="Chiudi cerca">✕</button>
      </div>
      <div class="ed-find-row">
        <input class="input sm" id="edReplQ" placeholder="Sostituisci con…" autocomplete="off">
        <button class="btn sm ghost" type="button" data-fnd="one">Sostituisci</button>
        <button class="btn sm" type="button" data-fnd="all">Sostituisci tutto</button>
      </div>
    </div>

    <div class="ed-workspace view-${savedView}" id="edWork">
      <div class="wy-wrap" id="edWyWrap">
        <div class="ed-blkbar" id="edBlkBar" role="toolbar" aria-label="Blocco attivo">
          <span class="ed-blk-tag" id="edBlkTag">Paragrafo</span>
          <span class="ed-blk-types" role="group" aria-label="Tipo di blocco">
            <button class="btn sm ghost" type="button" data-btype="p" title="Testo normale">T</button>
            <button class="btn sm ghost" type="button" data-btype="h2" title="Titolo paragrafo (##)">H2</button>
            <button class="btn sm ghost" type="button" data-btype="h3" title="Sottotitolo (###)">H3</button>
            <button class="btn sm ghost" type="button" data-btype="h4" title="Sottotitolo 4 (####)">H4</button>
          </span>
          <span class="ed-blk-acts" role="group" aria-label="Azioni sul blocco">
            <button class="btn sm ghost" type="button" data-bact="up" title="Sposta questo blocco su">↑</button>
            <button class="btn sm ghost" type="button" data-bact="down" title="Sposta questo blocco giù">↓</button>
            <button class="btn sm ghost" type="button" data-bact="add-p" title="Nuovo paragrafo sotto">＋ ¶</button>
            <button class="btn sm ghost" type="button" data-bact="add-h2" title="Nuovo titolo H2 sotto">＋ H2</button>
            <button class="btn sm ghost danger" type="button" data-bact="del" title="Elimina questo blocco">🗑</button>
          </span>
        </div>
        <article class="notes wy" id="edWy" aria-label="Anteprima modificabile della sezione"></article>
        <div class="ed-wy-foot">
          <button class="btn sm ghost" type="button" data-bact="end-p">＋ Paragrafo in fondo</button>
          <button class="btn sm ghost" type="button" data-bact="end-h2">＋ Titolo H2 in fondo</button>
        </div>
      </div>

      <div class="ed-code-pane" id="edCodePane">
        <div class="ed-code-head">
          <span>Codice Markdown</span>
          <small class="muted-inline">Tab rientra · Invio continua l’elenco</small>
        </div>
        <label class="sr-only" for="edMd">Testo della sezione in Markdown</label>
        <textarea id="edMd" class="input md-edit" spellcheck="false">${esc(sec.md)}</textarea>
      </div>
    </div>

    <details class="ed-extra" id="edExtra">
      <summary>
        <span>Domande per il richiamo e link utili</span>
        <small class="muted-inline" id="edExtraSum">${qCount ? `${qCount} domande` : 'nessuna domanda'}${lCount ? ` · ${lCount} link` : ''}</small>
      </summary>
      <div class="ed-extra-body">
        <label class="field"><span>Domande per il richiamo, una riga “D:” e una “R:” per domanda</span>
          <textarea id="edQs" class="input qs-edit" spellcheck="false">${esc(serializeQs(sec.questions))}</textarea></label>
        ${AI.ready() ? `<button class="btn sm" type="button" data-act="ai-qs">Aggiungi domande con ${AI.name()}</button>` : ''}
        <label class="field"><span>Link a siti utili, uno per riga: Titolo | https://indirizzo</span>
          <textarea id="edLinks" class="input qs-edit links-edit" spellcheck="false" placeholder="Radiopaedia: stenosi aortica | https://radiopaedia.org/…">${esc(secLinksOf(sec).map(l => `${l.title} | ${l.url}`).join('\n'))}</textarea></label>
      </div>
    </details>

    ${otherNbs.length && !opts.onDone ? `
      <details class="move">
        <summary>Sposta in un altro notebook</summary>
        <div class="inline">
          <select class="input" id="mvNb" aria-label="Notebook di destinazione">${otherNbs.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join('')}</select>
          <button class="btn sm" data-act="move">Sposta</button>
        </div>
      </details>` : ''}
    <div class="save-bar">
      <button class="btn primary" id="edSaveBtn" data-act="save" title="Salva (Ctrl+S)">Salva</button>
      ${opts.onDone ? '<button class="btn ghost" type="button" data-act="ed-cancel">Chiudi senza salvare</button>' : `<a class="btn ghost" href="#/sec/${sec.id}/read">Annulla</a>
      <button class="btn ghost danger push" data-act="del">Elimina sezione</button>`}
    </div>`;

  const ta = $('#edMd', body);
  const workEl = $('#edWork', body);
  const outlineEl = $('#edOutline', body);
  const findEl = $('#edFind', body);
  const hlPop = $('#edHlPop', body);
  const insPop = $('#edInsPop', body);
  const saveBtn = $('#edSaveBtn', body);
  const blkTag = $('#edBlkTag', body);

  // ---------- Cronologia Undo / Redo ----------
  let hist = [ta.value];
  let hi = 0;
  let histT = 0;
  const syncUndoBtns = () => {
    const u = $('[data-ed="undo"]', body), r = $('[data-ed="redo"]', body);
    if (u) u.disabled = hi <= 0;
    if (r) r.disabled = hi >= hist.length - 1;
  };
  const syncDirty = () => {
    if (!saveBtn) return;
    const dirtyNow = ta.value !== edMd0
      || $('#edTitle', body).value.trim() !== sec.title
      || $('#edQs', body).value !== serializeQs(sec.questions);
    saveBtn.textContent = dirtyNow ? 'Salva •' : 'Salva';
  };
  const pushHist = (force = false) => {
    clearTimeout(histT);
    histT = 0;
    const v = ta.value;
    if (!force && v === hist[hi]) { syncDirty(); return; }
    if (v === hist[hi]) { syncDirty(); return; }
    hist = hist.slice(0, hi + 1);
    hist.push(v);
    if (hist.length > 45) hist.shift();
    hi = hist.length - 1;
    syncUndoBtns();
    syncDirty();
  };
  const pushHistSoon = () => {
    syncDirty();
    clearTimeout(histT);
    histT = setTimeout(() => pushHist(false), 650);
  };
  const applyValue = (nextMd, { record = true, focusOffset = null } = {}) => {
    if (record) pushHist(true);
    ta.value = nextMd;
    if (record) pushHist(true);
    wy.render();
    renderOutline();
    syncDirty();
    if (focusOffset !== null) {
      if (viewMode === 'code') jumpInTextarea(ta, { start: focusOffset, end: focusOffset });
      else wy.focusCharOffset(focusOffset);
    }
  };
  const doUndo = () => {
    wy.flush();
    pushHist(false);
    if (hi <= 0) return;
    hi--;
    ta.value = hist[hi];
    wy.render();
    renderOutline();
    syncUndoBtns();
    syncDirty();
  };
  const doRedo = () => {
    if (hi >= hist.length - 1) return;
    hi++;
    ta.value = hist[hi];
    wy.render();
    renderOutline();
    syncUndoBtns();
    syncDirty();
  };

  // ---------- Selettore vista Anteprima / Codice / Entrambi ----------
  let viewMode = savedView;
  const setViewMode = m => {
    wy.flush();
    viewMode = m;
    workEl.classList.remove('view-wy', 'view-code', 'view-split');
    workEl.classList.add(`view-${m}`);
    $$('[data-edview]', body).forEach(b => b.setAttribute('aria-selected', String(b.dataset.edview === m)));
    try { localStorage.setItem('nb-ed-view', m); localStorage.setItem('nb-code-open', m === 'wy' ? '0' : '1'); } catch { /* niente */ }
    if (m !== 'code') wy.render();
  };
  $$('[data-edview]', body).forEach(b => b.addEventListener('click', () => setViewMode(b.dataset.edview)));

  // ---------- Popover Evidenziatore e menu Inserisci ----------
  const closePops = () => {
    hlPop.hidden = true;
    insPop.hidden = true;
    $('[data-ed="hl-pop"]', body)?.setAttribute('aria-expanded', 'false');
    $('[data-ed="ins-pop"]', body)?.setAttribute('aria-expanded', 'false');
  };
  const openPopNear = (pop, btn) => {
    const wasOpen = !pop.hidden;
    closePops();
    if (wasOpen) return;
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const pw = pop.offsetWidth || 240;
    const left = Math.max(8, Math.min(vw - pw - 8, r.left));
    const top = Math.min(window.innerHeight - (pop.offsetHeight || 160) - 8, r.bottom + 6);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.max(8, Math.round(top))}px`;
  };
  const onDocPopDown = e => {
    if (hlPop.hidden && insPop.hidden) return;
    if (e.target.closest('#edHlPop, #edInsPop, [data-ed="hl-pop"], [data-ed="ins-pop"]')) return;
    closePops();
  };
  document.addEventListener('pointerdown', onDocPopDown, true);
  addCleanup(() => document.removeEventListener('pointerdown', onDocPopDown, true));

  // ---------- Gestione Paragrafi (📑 Paragrafi) ----------
  const renderOutline = () => {
    const { list } = parseMdHeadings(ta.value);
    const cntEl = $('#edPcnt', body);
    if (cntEl) cntEl.textContent = list.length ? `(${list.length})` : '';
    if (outlineEl.hidden) return;
    outlineEl.innerHTML = `
      <div class="ed-ol-head">
        <strong>Struttura paragrafi</strong>
        <span class="ed-ol-hacts">
          <button type="button" class="btn sm ghost" data-ol="add-h2">＋ Titolo H2</button>
          <button type="button" class="btn sm ghost" data-ol="add-h3">＋ Sottotitolo H3</button>
          <button type="button" class="btn sm ghost" data-ol="close" aria-label="Chiudi struttura">✕</button>
        </span>
      </div>
      ${list.length ? `
        <ul class="ed-ol-list">
          ${list.map((h, i) => `
            <li class="ed-ol-row lv-${h.level}">
              <button type="button" class="ed-ol-go" data-ol-go="${i}" title="Vai al paragrafo">
                <span class="ed-ol-lv">H${h.level}</span>
                <span class="ed-ol-t">${esc(h.title)}</span>
                <small class="ed-ol-n">${h.bodyLines ? `${h.bodyLines}` : 'vuoto'}</small>
              </button>
              <span class="ed-ol-ctl">
                <button type="button" class="btn sm ghost" data-ol-act="up:${i}" ${h.prevPeer < 0 ? 'disabled' : ''} title="Sposta l’intero paragrafo su">↑</button>
                <button type="button" class="btn sm ghost" data-ol-act="down:${i}" ${h.nextPeer < 0 ? 'disabled' : ''} title="Sposta l’intero paragrafo giù">↓</button>
                <button type="button" class="btn sm ghost" data-ol-act="prom:${i}" ${h.level <= 2 ? 'disabled' : ''} title="Alza livello titolo (es. H3 → H2)">←</button>
                <button type="button" class="btn sm ghost" data-ol-act="dem:${i}" ${h.level >= 4 ? 'disabled' : ''} title="Abbassa livello titolo (es. H2 → H3)">→</button>
                <button type="button" class="btn sm ghost" data-ol-act="ren:${i}" title="Rinomina titolo">✎</button>
                ${i > 0 ? `<button type="button" class="btn sm ghost" data-ol-act="merge:${i}" title="Unisci il contenuto nel paragrafo sopra (toglie questo titolo)">🔗</button>` : ''}
                <button type="button" class="btn sm ghost danger" data-ol-act="del:${i}" title="Elimina paragrafo (annullabile con ↶)">🗑</button>
              </span>
            </li>`).join('')}
        </ul>` : '<p class="hint ed-ol-empty">Nessun titolo ancora: usa <strong>＋ Titolo H2</strong> qui sopra oppure <strong>H2 / H3</strong> nella barra del blocco per organizzare i paragrafi.</p>'}`;
  };

  outlineEl.addEventListener('click', async e => {
    const goBtn = e.target.closest('[data-ol-go]');
    if (goBtn) {
      wy.flush();
      const { list } = parseMdHeadings(ta.value);
      const h = list[+goBtn.dataset.olGo];
      if (!h) return;
      if (viewMode === 'code') jumpInTextarea(ta, { start: h.charOffset, end: h.charOffset + h.rawTitle.length + h.level + 1 });
      else wy.focusCharOffset(h.charOffset);
      return;
    }
    const ol = e.target.closest('[data-ol]')?.dataset.ol;
    if (ol) {
      if (ol === 'close') { outlineEl.hidden = true; $('[data-ed="outline"]', body)?.setAttribute('aria-expanded', 'false'); return; }
      const lvl = ol === 'add-h3' ? 3 : 2;
      const t = await modal({ title: lvl === 3 ? 'Nuovo sottotitolo (H3)' : 'Nuovo paragrafo (H2)', input: true, placeholder: 'Es. Connessioni efferenti', confirm: 'Aggiungi' });
      if (!t || !t.trim()) return;
      wy.flush();
      const baseMd = ta.value.trimEnd();
      const add = `${baseMd ? `${baseMd}\n\n` : ''}${'#'.repeat(lvl)} ${t.trim()}\n\n- `;
      applyValue(add, { focusOffset: add.length });
      return;
    }
    const actBtn = e.target.closest('[data-ol-act]');
    if (!actBtn || actBtn.disabled) return;
    wy.flush();
    const [kind, rawIdx] = actBtn.dataset.olAct.split(':');
    const idx = +rawIdx;
    let next = null;
    if (kind === 'up') next = moveMdHeading(ta.value, idx, -1);
    else if (kind === 'down') next = moveMdHeading(ta.value, idx, 1);
    else if (kind === 'prom') next = shiftMdHeadingLevel(ta.value, idx, -1);
    else if (kind === 'dem') next = shiftMdHeadingLevel(ta.value, idx, 1);
    else if (kind === 'merge') {
      next = mergeMdHeadingUp(ta.value, idx);
      if (next !== null) toast('Paragrafo unito in quello sopra', '', { label: 'Annulla', fn: doUndo });
    } else if (kind === 'del') {
      next = deleteMdHeading(ta.value, idx);
      if (next !== null) toast('Paragrafo eliminato', '', { label: 'Annulla', fn: doUndo });
    } else if (kind === 'ren') {
      const { list } = parseMdHeadings(ta.value);
      const cur = list[idx];
      if (!cur) return;
      const v = await modal({ title: 'Rinomina paragrafo', input: true, value: cur.rawTitle, confirm: 'Salva' });
      if (!v || !v.trim()) return;
      next = renameMdHeading(ta.value, idx, v);
    }
    if (next !== null) applyValue(next);
  });

  // ---------- Trova e sostituisci ----------
  let findMatches = [];
  let findIdx = -1;
  const computeMatches = () => {
    const q = ($('#edFindQ', body)?.value || '');
    findMatches = [];
    if (!q) { $('#edFindCnt', body).textContent = ''; findIdx = -1; return; }
    const hay = ta.value.toLowerCase();
    const needle = q.toLowerCase();
    let i = hay.indexOf(needle);
    while (i >= 0) {
      findMatches.push([i, i + q.length]);
      i = hay.indexOf(needle, i + Math.max(1, needle.length));
    }
    if (!findMatches.length) { findIdx = -1; $('#edFindCnt', body).textContent = '0 trovati'; }
    else {
      if (findIdx < 0 || findIdx >= findMatches.length) findIdx = 0;
      $('#edFindCnt', body).textContent = `${findIdx + 1}/${findMatches.length}`;
    }
  };
  const jumpFind = dir => {
    wy.flush();
    computeMatches();
    if (!findMatches.length) return;
    findIdx = (findIdx + dir + findMatches.length) % findMatches.length;
    $('#edFindCnt', body).textContent = `${findIdx + 1}/${findMatches.length}`;
    const [a, b] = findMatches[findIdx];
    if (viewMode === 'wy') {
      wy.focusCharOffset(a);
    } else {
      jumpInTextarea(ta, { start: a, end: b });
    }
  };
  const toggleFind = forceOpen => {
    const open = forceOpen === undefined ? findEl.hidden : forceOpen;
    findEl.hidden = !open;
    $('[data-ed="find"]', body)?.setAttribute('aria-expanded', String(open));
    if (open) {
      wy.flush();
      const inp = $('#edFindQ', body);
      inp.focus();
      inp.select();
      computeMatches();
    }
  };
  $('#edFindQ', body).addEventListener('input', () => { findIdx = -1; computeMatches(); });
  $('#edFindQ', body).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); jumpFind(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); toggleFind(false); }
  });
  findEl.addEventListener('click', e => {
    const f = e.target.closest('[data-fnd]')?.dataset.fnd;
    if (!f) return;
    if (f === 'close') { toggleFind(false); return; }
    if (f === 'prev') { jumpFind(-1); return; }
    if (f === 'next') { jumpFind(1); return; }
    const q = $('#edFindQ', body).value;
    const rep = $('#edReplQ', body).value;
    if (!q) { toast('Scrivi prima cosa cercare'); return; }
    wy.flush();
    computeMatches();
    if (!findMatches.length) { toast('Nessuna corrispondenza trovata'); return; }
    if (f === 'one') {
      const idx = findIdx >= 0 ? findIdx : 0;
      const [a, b] = findMatches[idx];
      const next = ta.value.slice(0, a) + rep + ta.value.slice(b);
      applyValue(next, { focusOffset: a + rep.length });
      computeMatches();
      toast('Sostituito');
    } else if (f === 'all') {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const count = findMatches.length;
      const next = ta.value.replace(re, () => rep);
      applyValue(next);
      computeMatches();
      toast(`${count} ${count === 1 ? 'occorrenza sostituita' : 'occorrenze sostituite'}`, '', { label: 'Annulla', fn: doUndo });
    }
  });

  // ---------- Aggiornamento Barra Blocco Attivo ----------
  const paintBlkBar = info => {
    if (!blkTag) return;
    const labels = { p: 'Paragrafo', h1: 'Titolo H1', h2: 'Titolo H2', h3: 'Titolo H3', h4: 'Titolo H4', list: 'Elenco', table: 'Tabella', blockquote: 'Citazione', code: 'Codice / HTML', lock: 'Immagine / HTML' };
    blkTag.textContent = labels[info?.kind] || 'Blocco';
    $$('[data-btype]', body).forEach(b => b.classList.toggle('on', b.dataset.btype === info?.kind));
    const u = $('[data-bact="up"]', body), d = $('[data-bact="down"]', body);
    if (u) u.disabled = !info?.canUp;
    if (d) d.disabled = !info?.canDown;
  };

  // ---------- Inizializzazione WYSIWYG ----------
  const wy = setupWysiwyg($('#edWy', body), ta, $('.edit-tools', body), {
    extraBars: [hlPop, insPop],
    onContentChange: () => { pushHistSoon(); renderOutline(); },
    onBeforeMutate: () => pushHist(true),
    onAfterMutate: () => { pushHist(true); renderOutline(); },
    onActiveChange: paintBlkBar
  });

  // la barra degli strumenti resta in alto sotto le schede mentre scorri
  const tabsEl = $('#view .tabs');
  const setTop = () => document.documentElement.style.setProperty('--tabs-h', `${tabsEl ? tabsEl.offsetHeight : 0}px`);
  setTop();
  window.addEventListener('resize', setTop);
  addCleanup(() => window.removeEventListener('resize', setTop));

  const refresh = () => { wy.render(); renderOutline(); syncDirty(); };
  setupListEditing(ta);
  ta.addEventListener('input', () => { pushHistSoon(); renderOutline(); });

  // Aggiorna riepilogo Cartella/Tag e Domande/Link
  const syncMetaSum = () => {
    const gSel = $('#edGroup', body);
    const gName = gSel?.selectedOptions?.[0]?.textContent || 'Nessuna cartella';
    const ts = parseTags($('#edTags', body)?.value || '');
    const el = $('#edMetaSum', body);
    if (el) el.textContent = `${gName}${ts.length ? ` · ${ts.length} tag` : ''}`;
  };
  const syncExtraSum = () => {
    const qn = parseQuestions($('#edQs', body)?.value || '').length;
    const ln = parseSecLinks($('#edLinks', body)?.value || '').length;
    const el = $('#edExtraSum', body);
    if (el) el.textContent = `${qn ? `${qn} ${qn === 1 ? 'domanda' : 'domande'}` : 'nessuna domanda'}${ln ? ` · ${ln} link` : ''}`;
    syncDirty();
  };
  $('#edTitle', body).addEventListener('input', syncDirty);
  $('#edGroup', body).addEventListener('change', syncMetaSum);
  $('#edTags', body)?.addEventListener('change', syncMetaSum);
  $('#edQs', body).addEventListener('input', syncExtraSum);
  $('#edLinks', body).addEventListener('input', syncExtraSum);

  bindGroupSelect($('#edGroup', body), () => { syncMetaSum(); return nbById(sec.notebookId); });
  if (opts.onDone) on('[data-act="ed-cancel"]', 'click', () => opts.onDone(), body);
  if (editJump && editJump.secId === sec.id) {
    const jmp = editJump;
    editJump = null;
    setTimeout(() => wy.jump(jmp), 80);
  }
  bindTagField(body, 'edTags');

  // Evita che i pulsanti tolgano la selezione dal testo
  $$('.edit-tools button, #edHlPop button, #edBlkBar button', body).forEach(b => b.addEventListener('pointerdown', e => e.preventDefault()));

  // Comandi toolbar speciali (undo/redo, outline, find, popovers)
  on('[data-ed]', 'click', e => {
    const k = e.currentTarget.dataset.ed;
    if (k === 'undo') { doUndo(); return; }
    if (k === 'redo') { doRedo(); return; }
    if (k === 'outline') {
      wy.flush();
      outlineEl.hidden = !outlineEl.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!outlineEl.hidden));
      if (!outlineEl.hidden) renderOutline();
      return;
    }
    if (k === 'find') { toggleFind(); return; }
    if (k === 'hl-pop') { openPopNear(hlPop, e.currentTarget); return; }
    if (k === 'ins-pop') { openPopNear(insPop, e.currentTarget); return; }
  }, body);

  // Comandi Barra Blocco Attivo (T/H2/H3/H4, ↑/↓, ＋¶, ＋H2, 🗑)
  on('[data-btype]', 'click', e => {
    wy.setBlockType(e.currentTarget.dataset.btype);
  }, body);
  on('[data-bact]', 'click', e => {
    const a = e.currentTarget.dataset.bact;
    if (a === 'up') wy.moveBlock(-1);
    else if (a === 'down') wy.moveBlock(1);
    else if (a === 'add-p') wy.insertBlockAfter('p', false);
    else if (a === 'add-h2') wy.insertBlockAfter('h2', false);
    else if (a === 'end-p') wy.insertBlockAfter('p', true);
    else if (a === 'end-h2') wy.insertBlockAfter('h2', true);
    else if (a === 'del') {
      if (wy.deleteBlock()) toast('Blocco eliminato', '', { label: 'Annulla', fn: doUndo });
    }
  }, body);

  // Scorciatoie Ctrl+S (Salva) e Ctrl+F (Trova)
  const onEdKey = e => {
    if ($('#modalRoot').children.length) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); $('[data-act="save"]', body)?.click(); }
      else if (k === 'f') { e.preventDefault(); toggleFind(true); }
    }
  };
  document.addEventListener('keydown', onEdKey);
  addCleanup(() => document.removeEventListener('keydown', onEdKey));

  // ---------- Azioni testo & inserimento (quando il focus è nel codice o dopo il pass-through da WYSIWYG) ----------
  on('[data-act="pnote"]', 'click', async () => {
    const note = await askPnote();
    if (note) { pushHist(true); insertAtCursor(ta, `^[${note}]`); pushHist(true); refresh(); }
  }, body);
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
    pushHist(true);
    ta.focus();
    ta.setRangeText(`==${term}${clean ? `::${clean}` : ''}==`, r.start, r.end, 'end');
    pushHist(true);
    refresh();
  }, body);
  on('[data-act="html"]', 'click', async () => {
    closePops();
    const { selectionStart: s0, selectionEnd: s1 } = ta;
    const code = await modal({ title: 'Blocco HTML', text: 'Incolla il codice HTML, anche una pagina intera con il suo stile. Si vede in un riquadro dentro gli appunti, separato dal resto dell’app.', input: true, multiline: true, placeholder: '<div>…</div>', confirm: 'Inserisci' });
    if (!code) return;
    const before = ta.value.slice(0, s0);
    const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    pushHist(true);
    ta.focus();
    ta.setRangeText(`${pre}\`\`\`html\n${code.trim()}\n\`\`\`\n\n`, s0, s1, 'end');
    pushHist(true);
    refresh();
  }, body);
  on('[data-act="xref"]', 'click', async () => {
    closePops();
    const { selectionStart: s0, selectionEnd: s1 } = ta;
    const s = await sectionPickerSheet('Collega una pagina', sec.id);
    if (!s) return;
    const label = ta.value.slice(s0, s1).trim().replace(/[\[\]|\n]/g, ' ');
    const title = s.title.replace(/[\[\]|]/g, ' ').trim();
    pushHist(true);
    ta.focus();
    ta.setRangeText(`[[${title}${label && label !== title ? `|${label}` : ''}]]`, s0, s1, 'end');
    pushHist(true);
    refresh();
  }, body);
  on('[data-indent]', 'click', e => { pushHist(true); ta.focus(); indentLines(ta, +e.currentTarget.dataset.indent); pushHist(true); refresh(); }, body);
  on('[data-mark]', 'click', e => {
    const k = e.currentTarget.dataset.mark;
    closePops();
    pushHist(true);
    if (k === 'none') {
      const { selectionStart: s, selectionEnd: en, value: v } = ta;
      if (s === en) { toast('Seleziona prima il testo'); ta.focus(); return; }
      const cleaned = stripMarks(v.slice(s, en));
      ta.focus();
      ta.setRangeText(cleaned, s, en, 'select');
      pushHist(true);
      refresh();
      return;
    }
    if (wrapSelectionInTextarea(ta, `{{${k}|`, '}}')) { pushHist(true); refresh(); }
  }, body);
  on('[data-act="hw"]', 'click', async () => {
    closePops();
    const im = await openHandwritingPad(sec.notebookId);
    if (im) { pushHist(true); insertAtCursor(ta, `\n\n${imageMd(im.id)}\n\n`); pushHist(true); refresh(); }
  }, body);
  on('[data-act="img"]', 'click', async () => {
    closePops();
    const im = await addImageFromDevice(sec.notebookId);
    if (im) { pushHist(true); insertAtCursor(ta, `\n\n${imageMd(im.id)}\n\n`); pushHist(true); refresh(); }
  }, body);
  on('[data-act="pdf-fig"]', 'click', async () => {
    closePops();
    const list = await openPdfCropper(sec.notebookId, { sec });
    if (list.length) { pushHist(true); insertAtCursor(ta, `\n\n${list.map(r => imageMd(r.id, r.caption)).join('\n\n')}\n\n`); pushHist(true); refresh(); }
  }, body);
  // Immagini incollate (es. uno screenshot su Windows) e tabelle da NotebookLM/Gemini
  ta.addEventListener('paste', async e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      try {
        const im = await saveImage(await compressImage(item.getAsFile()), sec.notebookId);
        pushHist(true);
        insertAtCursor(ta, `\n\n${imageMd(im.id)}\n\n`);
        pushHist(true);
        refresh();
        toast('Immagine incollata');
      } catch (err) { toast(err.message, 'err'); }
      return;
    }
    const norm = normalizePastedMarkdown(e.clipboardData);
    if (norm !== null) {
      e.preventDefault();
      pushHist(true);
      insertAtCursor(ta, norm);
      pushHist(true);
      refresh();
      toast('Tabella sistemata automaticamente');
    }
  });

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
    pushHist(true);
    ta.focus();
    ta.setRangeText(lead + next + trail, s, en, 'select');
    pushHist(true);
    refresh();
  }, body);
  on('[data-ins]', 'click', e => {
    const kind = e.currentTarget.dataset.ins;
    closePops();
    pushHist(true);
    ta.focus();
    if (kind === 'list' || kind === 'olist') {
      toggleListLines(ta, kind === 'olist');
      pushHist(true);
      refresh();
      return;
    }
    const snippet = '\n\n| Voce | Caratteristica | Note |\n|---|---|---|\n|  |  |  |\n';
    const pos = ta.selectionEnd ?? ta.value.length;
    ta.setRangeText(snippet, pos, pos, 'end');
    pushHist(true);
    refresh();
  }, body);

  on('[data-act="ai-format"]', 'click', async () => {
    if (!ta.value.trim()) { toast('Non c’è testo da riformattare'); return; }
    wy.flush();
    const md = await reformatFlow(sec, ta.value);
    if (!md || !ta.isConnected) return;
    applyValue(md);
    toast('Fatto: controlla e poi Salva la sezione', '', { label: 'Annulla', fn: doUndo });
  }, body);

  // v3.95: arrivi qui da “Formato degli appunti”: la riformattazione si apre da sola
  if (state.autoReformat === sec.id) { state.autoReformat = null; setTimeout(() => $('[data-act="ai-format"]', body)?.click(), 60); }

  on('[data-act="ai-qs"]', 'click', async e => {
    const btn = e.currentTarget;
    wy.flush();
    if (!ta.value.trim()) { toast('Scrivi prima gli appunti'); return; }
    btn.disabled = true;
    btn.textContent = 'Genero le domande…';
    try {
      const r = await AI.generate({ system: promptFor('questions'), text: aiText(ta.value), maxTokens: 6000 });
      const parsed = parseQuestions(r.text);
      if (!parsed.length) throw new Error('Nessuna domanda riconosciuta nella risposta.');
      const box = $('#edQs', body);
      box.value = [box.value.trim(), serializeQs(parsed)].filter(Boolean).join('\n\n');
      syncExtraSum();
      toast(`${parsed.length} domande aggiunte. Salva per tenerle.`);
    } catch (err) {
      toast(err.message, 'err');
    }
    btn.disabled = false;
    btn.textContent = `Aggiungi domande con ${AI.name()}`;
  }, body);

  on('[data-act="save"]', 'click', async () => {
    wy.flush();
    const before = imageRefs(sec.md);
    const oldTitle = sec.title;
    sec.title = $('#edTitle', body).value.trim() || 'Senza titolo';
    sec.tags = parseTags($('#edTags', body).value);
    const gv = $('#edGroup', body).value;
    sec.groupId = gv && gv !== '__new' ? gv : null;
    // v3.91: se mentre scrivevi la sezione è stata aggiornata da un altro dispositivo, le due versioni si uniscono
    if (sec.md !== edMd0 && ta.value !== sec.md) {
      const mg = mergeText3(edMd0, ta.value, sec.md);
      sec.md = mg.text;
      toast(mg.conflicts ? 'Questa sezione era stata modificata anche su un altro dispositivo: ho unito le due versioni; dove toccavano le stesse righe le trovi entrambe, segnate con ⚠️' : 'Questa sezione era stata modificata anche su un altro dispositivo: ho unito le due versioni');
    } else sec.md = ta.value;
    sec.questions = parseQuestions($('#edQs', body).value);
    sec.links = parseSecLinks($('#edLinks', body).value);
    sec.needsFormat = false;
    await saveSection(sec);
    await removeOrphanImages(before);
    const moved = await renameXrefs(oldTitle, sec.title, sec.id);
    toast(moved ? `Sezione salvata, collegamenti aggiornati in ${moved} ${moved === 1 ? 'sezione' : 'sezioni'}` : 'Sezione salvata');
    if (opts.onDone) { opts.onDone(); return; }
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
    go(`#/nb/${target}`);
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

  renderOutline();
  syncUndoBtns();
  syncDirty();
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
      <div class="field" id="imGroupBox"><label class="lbl" for="imGroup">Cartella</label>
        <select class="input" id="imGroup"></select>
      </div>

      <div class="seg" role="tablist" aria-label="Tipo di fonte">
        <button role="tab" data-src="text" aria-selected="${importDraft.src === 'text'}">Testo</button>
        <button role="tab" data-src="pdf" aria-selected="${importDraft.src === 'pdf'}">PDF</button>
        <button role="tab" data-src="xmind" aria-selected="${importDraft.src === 'xmind'}">XMind</button>
        <button role="tab" data-src="office" aria-selected="${importDraft.src === 'office'}">Word, PPT, foto</button>
      </div>

      <div id="srcOffice" ${importDraft.src === 'office' ? '' : 'hidden'}>
        <label class="file-drop">
          <input type="file" id="ofFile" multiple accept=".docx,.pptx,.doc,.ppt,image/*,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation">
          <span id="ofLabel">Scegli un file Word (.docx), una presentazione (.pptx) o delle foto</span>
        </label>
        <label class="check"><input type="checkbox" id="ofKeep" ${S().ofKeepPhotos !== false ? 'checked' : ''}><span>Con le foto: aggiungi anche le foto alla sezione, sotto la trascrizione</span></label>
        <p class="hint">Word e PowerPoint: titoli, elenchi, tabelle e note delle diapositive diventano testo (le immagini delle diapositive no). Foto di lavagne, appunti a mano o pagine di libro: le trascrive l’AI, fino a 10 per volta. Il testo passa nella scheda Testo: lo controlli e poi crei le sezioni, con la formattazione che scegli sotto.</p>
        <p class="err-line" id="ofErr" hidden></p>
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

      <fieldset class="opts" id="aiOpts" ${importDraft.src === 'xmind' || importDraft.src === 'office' ? 'hidden' : ''}>
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
    $('#srcOffice').hidden = importDraft.src !== 'office';
    $('#aiOpts').hidden = importDraft.src === 'xmind' || importDraft.src === 'office';
    syncOpts();
  });

  const textInfo = () => {
    const t = $('#imText').value;
    importDraft.text = t;
    const n = t.trim() ? splitText(t.trim()).length : 0;
    $('#textInfo').textContent = n > 1 ? `Testo lungo: verrà diviso in ${n} sezioni.` : '';
  };
  $('#imText').addEventListener('input', textInfo);
  $('#imText').addEventListener('paste', e => {
    const norm = normalizePastedMarkdown(e.clipboardData);
    if (norm === null) return;
    e.preventDefault();
    insertAtCursor(e.currentTarget, norm);
    textInfo();
    toast('Tabella sistemata automaticamente');
  });
  // v3.95: Word, PowerPoint e foto → testo
  $('#ofKeep').addEventListener('change', e => { S().ofKeepPhotos = e.target.checked; Settings.save(); });
  $('#ofFile').addEventListener('change', async e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const lab = $('#ofLabel'), err = $('#ofErr');
    err.hidden = true;
    lab.textContent = files.some(f => /^image\//.test(f.type)) ? `Leggo ${files.length === 1 ? 'la foto' : `${files.length} file`} con ${AI.name()}…` : 'Leggo il file…';
    try {
      const r = await importOfficeFiles(files, { keepPhotos: $('#ofKeep').checked });
      if (!r.text.trim()) throw new Error('Non ho trovato testo in questo file.');
      importDraft.text = importDraft.text.trim() ? `${importDraft.text.trim()}\n\n${r.text}` : r.text;
      if (r.title && !importDraft.title) importDraft.title = r.title;
      importDraft.src = 'text';
      viewImport();
      toast('Testo estratto: controllalo qui e poi crea le sezioni');
    } catch (ex) {
      if (!lab.isConnected) return;
      lab.textContent = 'Scegli un file Word (.docx), una presentazione (.pptx) o delle foto';
      err.textContent = ex.message || 'Non riuscito'; err.hidden = false;
    }
  });
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
          <span>Metti le sezioni in cartelle${L > 2 ? ' e sottocartelle' : ''} prese dai titoli più grandi</span></label>` : ''}
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
async function ensureJSZip() { if (!window.JSZip) await loadScript(libUrl(LIBS.jszip)); }

async function parseXmind(file) {
  await ensureJSZip();
  let zip;
  try { zip = await window.JSZip.loadAsync(file); }
  catch { throw new Error('Il file non è una mappa XMind valida.'); }
  const json = zip.file('content.json');
  if (json) {
    const data = JSON.parse(await json.async('string'));
    const sheets = Array.isArray(data) ? data : (data.sheets || []);
    return sheets.filter(s => s && s.rootTopic).map(s => ({ title: s.title || s.rootTopic.title || 'Mappa', root: jsonTopic(s.rootTopic), rels: (s.relationships || []).filter(r => r.end1Id && r.end2Id).map(r => ({ id: uid(), from: String(r.end1Id), to: String(r.end2Id), t: cleanTitle(r.title) })) }));
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
    id: t.id || '',
    title: cleanTitle(t.title) || '(senza titolo)',
    notes: String(notes || '').trim(),
    sums: (t.summaries || []).map(x => { const m = String(x.range || '').match(/\((\d+)\s*,\s*(\d+)\)/); const top = (t.children?.summary || []).find(y => y.id === x.topicId); return m ? { a: +m[1], b: +m[2], t: cleanTitle(top?.title) } : null; }).filter(Boolean),
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
   Strumenti sul testo selezionato in Leggi: barra (telefono) e menu del tasto destro (PC)
   --------------------------------------------------------------------- */
function readingToolsHtml() {
  return `
    <button type="button" class="rt-btn rt-pend" data-rt="clearpend" hidden title="Lascia perdere le parti tenute da parte">✕ <span class="rt-pend-n"></span></button>
    <button type="button" class="rt-btn rt-add" data-rt="add" title="Tiene da parte questa selezione: selezionane un’altra e poi scegli Cloze o un colore per tutte. Al computer: tieni premuto Ctrl (⌘ sul Mac) mentre selezioni">＋ Altra parte</button>
    <button type="button" class="rt-btn rt-edit" data-rt="edit" title="Apre Modifica con il cursore su questo testo">✎ Modifica</button>
    <button type="button" class="rt-btn" data-rt="move" title="Sposta il paragrafo, il titolo o le voci selezionate in un’altra sezione">↗ Sposta</button>
    <button type="button" class="rt-btn" data-rt="pnote" title="Aggiunge una nota che compare come ⓘ dopo il testo scelto">ⓘ Nota</button>
    <button type="button" class="rt-btn" data-rt="cloze" title="Nascondi nel Cloze">Cloze</button>
    <span class="rt-colors" role="group" aria-label="Evidenzia">
      ${HL_COLORS.map(c => `<button type="button" class="rt-dot hl-${c.key}" data-rt="${c.key}" title="Evidenzia in ${c.name.toLowerCase()}" aria-label="Evidenzia in ${c.name.toLowerCase()}"></button>`).join('')}
    </span>
    <button type="button" class="rt-btn rt-u" data-rt="u" title="Sottolinea" aria-label="Sottolinea">S</button>
    <button type="button" class="rt-btn" data-rt="none" title="Togli evidenziatura e sottolineatura" aria-label="Togli evidenziatura e sottolineatura">✕</button>
    <button type="button" class="rt-btn" data-rt="gloss" title="Aggiungi al glossario">Glossario</button>
    <button type="button" class="rt-btn" data-rt="clin" title="Crea una nota clinica">Nota clinica</button>
    <button type="button" class="rt-btn rt-card" data-rt="card">Flashcard</button>`;
}

/* =====================================================================
   v3.44: spostare un paragrafo in un’altra sezione
   Dal testo selezionato trovo il blocco intero negli appunti: un titolo con
   tutto quello che contiene, le voci di elenco toccate (con le loro sottovoci),
   un paragrafo, una tabella. Lo tolgo da qui e lo metto nella sezione scelta.
   ===================================================================== */
const mvIsList = l => /^\s*([-*+]|\d+[.)])\s/.test(l);
const indentOf = l => (l.match(/^\s*/)[0].replace(/\t/g, '  ')).length;
const headingLevel = l => { const m = l.match(/^(#{1,6})\s/); return m ? m[1].length : 0; };
function moveRangeOf(md, start, end) {
  const lines = md.split('\n');
  const offs = [];
  let o = 0;
  lines.forEach(l => { offs.push(o); o += l.length + 1; });
  const lineAt = pos => { let i = 0; while (i + 1 < offs.length && offs[i + 1] <= pos) i++; return i; };
  let a = lineAt(start), b = lineAt(Math.max(start, end - 1));
  // dentro un blocco di codice: lo prendo tutto
  const fenceOpen = i => lines.slice(0, i).filter(l => /^\s*```/.test(l)).length % 2 === 1;
  const blank = i => !lines[i] || !lines[i].trim();
  if (fenceOpen(a) || /^\s*```/.test(lines[a])) { let k = a; while (k > 0 && !/^\s*```/.test(lines[k])) k--; a = k; }
  if (fenceOpen(b + 1) || (/^\s*```/.test(lines[b]) && fenceOpen(b))) { let k = b + 1; while (k < lines.length && !/^\s*```/.test(lines[k])) k++; b = Math.min(lines.length - 1, k); }
  const hl = headingLevel(lines[a]);
  if (hl) {
    // un titolo porta con sé tutto fino al titolo successivo dello stesso livello o superiore
    let k = a + 1;
    while (k < lines.length) { const h = headingLevel(lines[k]); if (h && h <= hl && !fenceOpen(k)) break; k++; }
    b = Math.max(b, k - 1);
  } else {
    // inizio: la voce di elenco o il paragrafo dove comincia la selezione
    let k = a;
    while (k > 0 && !blank(k - 1) && !mvIsList(lines[k]) && !headingLevel(lines[k - 1]) && !/^\|/.test(lines[k])) k--;
    if (/^\|/.test(lines[a])) { k = a; while (k > 0 && /^\|/.test(lines[k - 1])) k--; }
    a = k;
  }
  // fine: la voce (con le sottovoci), il paragrafo o la tabella dove finisce
  if (/^\|/.test(lines[b])) { while (b + 1 < lines.length && /^\|/.test(lines[b + 1])) b++; }
  else {
    let s = b;
    while (s > a && !mvIsList(lines[s]) && !blank(s - 1)) s--;
    if (mvIsList(lines[s])) {
      const ind = indentOf(lines[s]);
      let k = s + 1;
      while (k < lines.length && !blank(k) && (mvIsList(lines[k]) ? indentOf(lines[k]) > ind : indentOf(lines[k]) > ind || !headingLevel(lines[k]) && !mvIsList(lines[k]) && indentOf(lines[k]) > 0)) k++;
      b = Math.max(b, k - 1);
    } else if (!hl) {
      while (b + 1 < lines.length && !blank(b + 1) && !headingLevel(lines[b + 1]) && !mvIsList(lines[b + 1])) b++;
    }
  }
  const from = offs[a];
  const to = b + 1 < offs.length ? offs[b + 1] : md.length;
  let text = md.slice(from, to).replace(/\s+$/, '');
  // voci di elenco annidate: le riporto a sinistra, così nell’altra sezione sono un elenco normale
  const ls = text.split('\n');
  const minInd = Math.min(...ls.filter(l => l.trim()).map(indentOf));
  if (minInd > 0 && mvIsList(ls[0])) text = ls.map(l => l.replace(new RegExp(`^ {0,${minInd}}`), '')).join('\n');
  return { from, to, text, heading: hl ? lines[a].replace(/^#+\s*/, '') : '' };
}
const joinMd = (left, right) => {
  const l = left.replace(/\s+$/, ''), r = right.replace(/^\s+/, '');
  return l && r ? `${l}\n\n${r}` : (l || r);
};
// dove inserire nella sezione di arrivo: all’inizio, in fondo, o dentro un titolo
function headingsOf(md) {
  const out = [];
  let fence = false;
  let o = 0;
  md.split('\n').forEach(l => {
    if (/^\s*```/.test(l)) fence = !fence;
    const h = !fence && headingLevel(l);
    if (h) out.push({ level: h, title: l.replace(/^#+\s*/, '').trim(), at: o });
    o += l.length + 1;
  });
  return out;
}
function insertInto(md, text, where) {
  if (where === 'start') return joinMd(text, md);
  if (where === 'end' || !where) return joinMd(md, text);
  const hs = headingsOf(md);
  const i = hs.findIndex(h => String(h.at) === String(where));
  if (i < 0) return joinMd(md, text);
  const h = hs[i];
  const next = hs.slice(i + 1).find(x => x.level <= h.level);
  const cut = next ? next.at : md.length;
  // i titoli spostati scendono sotto il titolo scelto
  const top = Math.min(...text.split('\n').map(headingLevel).filter(Boolean), 99);
  const shift = top < 99 && top <= h.level ? h.level + 1 - top : 0;
  const body = shift ? text.split('\n').map(l => { const lv = headingLevel(l); return lv ? `${'#'.repeat(Math.min(6, lv + shift))}${l.slice(lv)}` : l; }).join('\n') : text;
  return joinMd(joinMd(md.slice(0, cut), body), md.slice(cut));
}
async function moveBlockFlow(sec, selText, occurrence) {
  const r0 = findSourceRange(sec.md, selText, occurrence);
  if (!r0) { toast('Non ritrovo il testo selezionato negli appunti: prova a selezionarne un pezzo più corto', 'err'); return false; }
  const blk = moveRangeOf(sec.md, r0.start, r0.end);
  if (!blk.text.trim()) return false;
  const others = state.sections.filter(s => s.id !== sec.id)
    .sort((a, b) => (b.notebookId === sec.notebookId) - (a.notebookId === sec.notebookId) || (b.updated || 0) - (a.updated || 0));
  const where = s => [nbById(s.notebookId)?.name, groupPathText(s)].filter(Boolean).join(' › ');
  return new Promise(resolve => {
    let target = null;
    const sh = openSheet(`
      <h2>Sposta in un’altra sezione</h2>
      <p class="sheet-sub">${blk.heading ? `Il titolo “${esc(blk.heading)}” con tutto quello che contiene.` : 'Il blocco intero dove hai selezionato: il paragrafo, le voci di elenco con le loro sottovoci, la tabella.'}</p>
      <div class="mv-prev notes">${renderMd(blk.text)}</div>
      <div id="mvPick">
        <input type="search" class="input search" id="mvQ" placeholder="Cerca la sezione di arrivo" aria-label="Cerca la sezione di arrivo">
        <ul class="list pick-list" id="mvList"></ul>
        ${newSecFormHtml(sec.notebookId, sec.groupId || '')}
      </div>
      <div id="mvWhere" hidden>
        <p class="mv-to"></p>
        <label class="field"><span>Dove</span><select class="input" id="mvPos"></select></label>
        <label class="check"><input type="checkbox" id="mvCopy"><span>Lasciane una copia anche qui</span></label>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-mv="no">Annulla</button>
        <button class="btn ghost" type="button" data-mv="back" hidden>Cambia sezione</button>
        <button class="btn primary" type="button" data-mv="ok" hidden>Sposta</button>
      </div>`, { label: 'Sposta in un’altra sezione', onClose: v => resolve(!!v) });
    const draw = () => {
      const q = $('#mvQ', sh.el).value;
      $('#mvList', sh.el).innerHTML = others.filter(s => matchTokens(`${s.title} ${where(s)}`, q)).slice(0, 60)
        .map(s => `<li><button type="button" class="row" data-mvs="${s.id}"><span class="row-main"><span class="row-title">${esc(s.title)}</span><span class="row-sub">${esc(where(s))}</span></span></button></li>`).join('') || '<li class="hint">Nessuna sezione trovata.</li>';
    };
    draw();
    $('#mvQ', sh.el).addEventListener('input', draw);
    const pick = s => {
      target = s;
      $('#mvPick', sh.el).hidden = true;
      $('#mvWhere', sh.el).hidden = false;
      $('[data-mv="ok"]', sh.el).hidden = false;
      $('[data-mv="back"]', sh.el).hidden = false;
      $('.mv-to', sh.el).innerHTML = `In <strong>${esc(s.title)}</strong> <span class="muted-inline">${esc(where(s))}</span>`;
      const hs = headingsOf(s.md || '');
      $('#mvPos', sh.el).innerHTML = `<option value="end">In fondo</option><option value="start">All’inizio</option>${hs.map(h => `<option value="${h.at}">${'\u00a0\u00a0'.repeat(h.level - 1)}Dentro “${esc(h.title)}”</option>`).join('')}`;
      // se esiste un titolo con lo stesso nome, lo propongo
      const same = blk.heading && hs.find(h => foldAccents(h.title) === foldAccents(blk.heading));
      if (same) $('#mvPos', sh.el).value = String(same.at);
    };
    $('#mvList', sh.el).addEventListener('click', e => { const b = e.target.closest('[data-mvs]'); if (b) pick(secById(b.dataset.mvs)); });
    bindNewSecForm(sh.el, s => { $('.ns-form', sh.el).hidden = true; pick(s); });
    $('[data-mv="no"]', sh.el).onclick = () => sh.close(false);
    $('[data-mv="back"]', sh.el).onclick = () => { $('#mvPick', sh.el).hidden = false; $('#mvWhere', sh.el).hidden = true; $('[data-mv="ok"]', sh.el).hidden = true; $('[data-mv="back"]', sh.el).hidden = true; };
    $('[data-mv="ok"]', sh.el).onclick = async () => {
      if (!target) return;
      const copy = $('#mvCopy', sh.el).checked;
      const before = { src: sec.md, dst: target.md };
      target.md = `${insertInto(target.md || '', blk.text, $('#mvPos', sh.el).value).replace(/\s+$/, '')}\n`;
      if (!copy) sec.md = `${joinMd(sec.md.slice(0, blk.from), sec.md.slice(blk.to)).replace(/\s+$/, '')}\n`;
      await saveSection(target);
      if (!copy) await saveSection(sec);
      sh.close(true);
      const tgt = target;
      toast(`${copy ? 'Copiato' : 'Spostato'} in “${tgt.title}”`, '', { label: 'Annulla', fn: async () => { tgt.md = before.dst; sec.md = before.src; await saveSection(tgt); await saveSection(sec); toast('Spostamento annullato'); route(); } });
      route();
    };
    setTimeout(() => $('#mvQ', sh.el)?.focus(), 40);
  });
}

/* v3.41: la barra della selezione compare solo a selezione finita.
   Se compariva mentre trascinavi la penna o il dito, la punta ci passava sopra
   e il browser allungava la selezione fino in fondo alla pagina. */
const SelGesture = {
  down: false,
  lastType: 'mouse',
  subs: new Set(),
  // il menu “tasto destro” dell’app è per il mouse: con penna e dita c’è già la barra
  touchy() { return this.lastType === 'pen' || this.lastType === 'touch'; },
  init() {
    document.addEventListener('pointerdown', e => {
      this.lastType = e.pointerType || 'mouse';
      if (e.target.closest && e.target.closest('.rt-bar, .rt-menu')) return;
      this.down = true;
    }, true);
    const up = () => { if (!this.down) return; this.down = false; this.subs.forEach(f => f()); };
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
  }
};
// v3.42: la barra va di lato, nello spazio libero accanto al testo, all’altezza della
// selezione; se di lato non c’è posto, in alto sotto le schede. Mai sopra il testo.
function placeSelBar(bar, container) {
  bar.classList.remove('rt-side', 'rt-top', 'rt-left', 'rt-right');
  document.querySelectorAll('.rt-menu').forEach(m => { m.hidden = true; });
  bar.style.left = bar.style.top = '';
  const art = container.getBoundingClientRect();
  const leftEdge = window.innerWidth >= 900 && !document.body.classList.contains('nav-hidden') ? 232 : 0;
  let rightEdge = window.innerWidth;
  ['.split-dock', '.pad-dock', '.sh-dock'].forEach(sel => {
    const d = document.querySelector(sel);
    if (!d || d.hidden) return;
    const r = d.getBoundingClientRect();
    if (r.height > window.innerHeight * 0.5 && r.left > art.left) rightEdge = Math.min(rightEdge, r.left);
  });
  const W = 112;
  const spaceR = rightEdge - art.right - 8;
  const spaceL = art.left - leftEdge - 8;
  const sel = document.getSelection();
  const rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
  const tabs = document.querySelector('#view .tabs');
  const topMin = Math.max(8, tabs ? tabs.getBoundingClientRect().bottom + 8 : 8);
  if (Math.max(spaceR, spaceL) >= W) {
    // prima a sinistra, dove resta spazio anche con la barra laterale aperta
    bar.classList.add('rt-side', spaceL >= W ? 'rt-left' : 'rt-right');
    const h = bar.offsetHeight || 360;
    const y = rect && rect.height ? rect.top - 6 : topMin;
    const bottomMax = window.innerHeight - (window.innerWidth < 900 ? 92 : 8);
    clampFixed(bar, {
      left: spaceL >= W ? art.left - W - Math.min(18, (spaceL - W) / 2) : art.right + Math.min(18, (spaceR - W) / 2),
      top: Math.max(topMin, Math.min(bottomMax - h, y))
    });
  } else if (rect && rect.height && rect.top < topMin + 70) {
    // selezione proprio in alto: la barra resta in basso, lontano dal testo scelto
    clampFixed(bar, { centerX: (art.left + art.right) / 2 });
  } else {
    bar.classList.add('rt-top');
    clampFixed(bar, { centerX: (art.left + art.right) / 2, top: topMin });
  }
}
// mostra la barra quando la selezione è ferma e nessun dito o penna sta trascinando
function stableSelection(bar, check, { delay = 380, place = null } = {}) {
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(() => { if (!SelGesture.down && check()) { bar.hidden = false; if (place) place(); } }, delay); };
  SelGesture.subs.add(later);
  return { changed() { bar.hidden = true; later(); }, cancel() { clearTimeout(t); }, done() { clearTimeout(t); SelGesture.subs.delete(later); } };
}
/* v4.29: estrae il testo selezionato preservando elenchi puntati/numerati annidati e tutti i livelli di rientro */
function extractSelectedListMd(container, range) {
  const skipEl = el => el.matches('.pnote, .fold-btn, .fold-pk-btn, button');
  const sliceTextNode = tn => {
    const val = tn.nodeValue || '';
    if (!val) return '';
    try {
      if (range.comparePoint(tn, val.length) < 0 || range.comparePoint(tn, 0) > 0) return '';
    } catch {
      if (!range.intersectsNode(tn)) return '';
    }
    const a = tn === range.startContainer ? range.startOffset : 0;
    const b = tn === range.endContainer ? range.endOffset : val.length;
    return b > a ? val.slice(a, b) : '';
  };
  const ownText = (root, skipLists) => {
    let out = '';
    const walk = node => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) { out += sliceTextNode(c); continue; }
        if (c.nodeType !== 1) continue;
        if (skipEl(c)) continue;
        if (skipLists && (c.tagName === 'UL' || c.tagName === 'OL')) continue;
        if (c.tagName === 'BR') { out += ' '; continue; }
        walk(c);
      }
    };
    walk(root);
    return out.replace(/[\s\u00a0]+/g, ' ').trim();
  };

  const liMap = new Map();
  $$('li', container).forEach(li => {
    if (li.closest('.html-embed')) return;
    const t = ownText(li, true);
    if (t) liMap.set(li, t);
  });
  if (!liMap.size) return '';

  const nonListBlocks = [];
  $$('h1, h2, h3, h4, h5, h6, p', container).forEach(el => {
    if (el.closest('li, td, th, ul, ol, .html-embed')) return;
    const t = ownText(el, false);
    if (t) nonListBlocks.push({ el, text: t });
  });
  // Se è selezionata solo una singola voce (o parte di essa) senza altri blocchi, resta testo normale
  if (liMap.size === 1 && !nonListBlocks.length) return '';

  const markerFor = li => {
    const list = li.parentElement;
    if (list && list.tagName === 'OL') {
      const start = +(list.getAttribute('start') || 1);
      const siblings = [...list.children].filter(x => x.tagName === 'LI');
      const idx = Math.max(0, siblings.indexOf(li));
      return `${start + idx}. `;
    }
    return '- ';
  };
  const indentFor = li => {
    let pad = '';
    let p = li.parentElement?.closest('li');
    while (p && container.contains(p)) {
      if (liMap.has(p)) pad = ' '.repeat(markerFor(p).length) + pad;
      p = p.parentElement?.closest('li');
    }
    return pad;
  };

  const entries = [
    ...nonListBlocks.map(b => ({ el: b.el, kind: 'text', line: b.text })),
    ...[...liMap.entries()].map(([li, t]) => ({ el: li, kind: 'li', line: `${indentFor(li)}${markerFor(li)}${t}` }))
  ];
  entries.sort((a, b) => (a.el === b.el ? 0 : (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)));

  let out = '';
  for (let i = 0; i < entries.length; i++) {
    if (i > 0) out += (entries[i].kind === 'li' && entries[i - 1].kind === 'li') ? '\n' : '\n\n';
    out += entries[i].line;
  }
  return out;
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
  // v3.48: più parti insieme. Ctrl (⌘) mentre selezioni, oppure “＋ Altra parte”;
  // le parti tenute da parte si vedono con un riquadro tratteggiato
  let pending = [];
  const hlOk = typeof Highlight !== 'undefined' && window.CSS && CSS.highlights;
  const paintPending = () => {
    if (hlOk) { if (pending.length) CSS.highlights.set('nb-pending', new Highlight(...pending.map(p => p.range))); else CSS.highlights.delete('nb-pending'); }
    [bar, menu].forEach(el => {
      const b = $('[data-rt="clearpend"]', el);
      b.hidden = !pending.length;
      $('.rt-pend-n', b).textContent = `${pending.length} ${pending.length === 1 ? 'parte' : 'parti'}`;
      $('[data-rt="add"]', el).textContent = pending.length ? `＋ Altra parte (${pending.length + 1})` : '＋ Altra parte';
    });
  };
  const addPending = () => {
    const sel = document.getSelection();
    const c = capture();
    if (!c || !sel.rangeCount) return false;
    if (pending.some(p => p.c.text === c.text && p.c.occurrence === c.occurrence)) return false;
    pending.push({ c, range: sel.getRangeAt(0).cloneRange() });
    paintPending();
    return true;
  };
  const clearPending = () => { pending = []; paintPending(); };
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
    // v4.29: conserva tutte le voci padre/figlie e i rientri degli elenchi annidati (senza cancellare le voci con sottopunti)
    const listText = extractSelectedListMd(container, range);
    return { text: text.trim(), occurrence, listText };
  };
  const stable = stableSelection(bar, () => { const c = capture(); if (c) last = c; return !!c; }, { place: () => placeSelBar(bar, container) });
  // scorrendo, la barra segue la selezione
  let rafPlace = 0;
  const onScrollPlace = () => { if (bar.hidden || rafPlace) return; rafPlace = requestAnimationFrame(() => { rafPlace = 0; if (!bar.hidden) placeSelBar(bar, container); }); };
  window.addEventListener('scroll', onScrollPlace, { passive: true });
  addCleanup(() => window.removeEventListener('scroll', onScrollPlace));
  const onSel = () => {
    const c = capture();
    if (c) { clearTimeout(hideTimer); last = c; stable.changed(); }
    else if (pending.length) { stable.cancel(); clearTimeout(hideTimer); bar.hidden = false; placeSelBar(bar, container); }
    else if (!bar.hidden) { stable.cancel(); clearTimeout(hideTimer); hideTimer = setTimeout(() => { bar.hidden = true; }, 700); }
    else stable.cancel();
  };
  // al computer: Ctrl (⌘) premuto quando inizi una nuova selezione tiene da parte quella di prima;
  // un clic normale col mouse ricomincia da capo
  const onMultiDown = e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (e.ctrlKey || e.metaKey) { addPending(); return; }
    if (pending.length) clearPending();
  };
  container.addEventListener('pointerdown', onMultiDown, true);
  const closeMenu = () => { menu.hidden = true; };
  const act = async kind => {
    if (kind === 'add') {
      if (addPending()) { last = null; document.getSelection()?.removeAllRanges(); toast(SelGesture.touchy() ? 'Tenuta da parte: seleziona la prossima' : 'Tenuta da parte: seleziona la prossima (o tieni premuto Ctrl mentre selezioni)'); }
      return;
    }
    if (kind === 'clearpend') { clearPending(); if (!capture()) bar.hidden = true; return; }
    clearTimeout(hideTimer);
    bar.hidden = true;
    closeMenu();
    const cur = capture() || last;
    const pieces = [...pending.map(p => p.c), ...(cur && !pending.some(p => p.c.text === cur.text && p.c.occurrence === cur.occurrence) ? [cur] : [])];
    clearPending();
    const c = cur || pieces[pieces.length - 1];
    if (!c) return;
    document.getSelection()?.removeAllRanges();
    if (pieces.length > 1 && !['gloss', 'clin', 'move', 'edit', 'card'].includes(kind)) {
      // tutte le parti in un colpo, dalla più in fondo, così le posizioni prima non cambiano
      const rs = [];
      let lost = 0;
      pieces.forEach(pc => { const r = findSourceRange(sec.md, pc.text, pc.occurrence); if (r && !(kind === 'cloze' && /\n\s*\n/.test(sec.md.slice(r.start, r.end)))) rs.push(r); else lost++; });
      rs.sort((a, b) => b.start - a.start);
      const keep = rs.filter((r, i) => i === 0 || r.end <= rs[i - 1].start);
      lost += rs.length - keep.length;
      if (!keep.length) { toast('Non riesco a trovare queste parti negli appunti', 'err'); return; }
      const prevMd = sec.md;
      let md = sec.md;
      keep.forEach(r => { md = applyMarkToMd(md, r, kind); });
      if (md === prevMd) return;
      sec.md = md;
      await saveSection(sec);
      const y = window.scrollY;
      route();
      window.scrollTo(0, y);
      toast(`${kind === 'cloze' ? 'Cloze' : kind === 'none' ? 'Formattazione tolta' : 'Fatto'} su ${keep.length} parti${lost ? ` (${lost} non trovate)` : ''}`, '', {
        label: 'Annulla',
        fn: async () => {
          if (sec.md !== md) { toast('Non posso annullare: gli appunti sono cambiati nel frattempo', 'err'); return; }
          sec.md = prevMd;
          await saveSection(sec);
          const yy = window.scrollY;
          route();
          window.scrollTo(0, yy);
        }
      });
      return;
    }
    if (pieces.length > 1 && (kind === 'card' || kind === 'clin')) c.listText = pieces.map(p => p.listText || `- ${p.text}`).join('\n');
    if (kind === 'gloss') {
      if (await glossarySheet(null, { term: c.text.slice(0, 80), nbId: sec.notebookId })) { const y = window.scrollY; route(); window.scrollTo(0, y); }
      return;
    }
    if (kind === 'clin') {
      await clinicSheet(null, { title: sec.title, body: c.listText || c.text, nbId: sec.notebookId, sectionId: sec.id });
      return;
    }
    if (kind === 'move') { await moveBlockFlow(sec, c.text, c.occurrence); return; }
    if (kind === 'pnote') {
      const r = findSourceRange(sec.md, c.text, c.occurrence);
      if (!r) { toast('Non trovo questo punto negli appunti: aggiungila da Modifica', 'err'); return; }
      const note = await askPnote();
      if (!note) return;
      sec.md = `${sec.md.slice(0, r.end)}^[${note}]${sec.md.slice(r.end)}`;
      await saveSection(sec);
      const y = window.scrollY;
      route();
      window.scrollTo(0, y);
      toast('Nota aggiunta: tocca la ⓘ per aprirla');
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
    if (SelGesture.touchy()) return;
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
    clampFixed(menu, { left: e.clientX, top: e.clientY });
  };
  const onDocDown = e => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); };
  const onKey = e => { if (e.key === 'Escape') { closeMenu(); if (pending.length) { clearPending(); if (!capture()) bar.hidden = true; } } };
  document.addEventListener('selectionchange', onSel);
  container.addEventListener('contextmenu', onContext);
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', closeMenu, { passive: true });
  addCleanup(() => {
    clearTimeout(hideTimer);
    stable.done();
    if (hlOk) CSS.highlights.delete('nb-pending');
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
    if (p.t !== 'pen') return base;
    const pr = typeof p.p === 'number' && p.p > 0 ? Math.min(1, p.p) : 0.08;
    return base * (0.55 + Math.pow(pr, 0.75) * 0.75);
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
    const pr = e.pointerType === 'pen' ? (typeof e.pressure === 'number' && e.pressure > 0 ? Math.min(1, e.pressure) : 0.08) : 0.5;
    return { x: e.clientX - r.left, y: e.clientY - r.top, p: pr, t: e.pointerType };
  };
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'pen') state2.penSeen = true;
    if (state2.penSeen && e.pointerType === 'touch') return; // il palmo appoggiato non disegna
    if (cur) return;
    e.preventDefault();
    pid = e.pointerId;
    try { canvas.setPointerCapture(pid); } catch { /* ignora */ }
    const eraser = state2.tool === 'eraser' || penErases(e);
    cur = { color: state2.color, size: state2.size, erase: eraser, points: [pt(e)] };
    drawStroke(cur);
  });
  canvas.addEventListener('pointermove', e => {
    if (!cur || e.pointerId !== pid) return;
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = pt(ev);
      const prev = cur.points[cur.points.length - 1];
      if (Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) < 0.6) continue;
      if (p.t === 'pen' && prev.t === 'pen') p.p = prev.p * 0.65 + p.p * 0.35;
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
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  twoFingerTap(canvas, () => { if (state2.strokes.length) { state2.strokes.pop(); redraw(); onChange(state2.strokes); toast('Tratto annullato'); } }, () => state2.penSeen);
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
  fields.forEach(f => {
    const pick = () => { last = f; f.dataset.touched = '1'; };
    f.addEventListener('focus', pick);
    f.addEventListener('pointerdown', pick);
    setupListEditing(f);
  });
  $$('[data-ct]', root).forEach(b => b.addEventListener('pointerdown', e => {
    if (!['img', 'hw'].includes(b.dataset.ct)) e.preventDefault();
  }));
  $$('[data-ct]', root).forEach(b => b.addEventListener('click', async () => {
    const ta = last;
    const k = b.dataset.ct;
    if (k === 'list') { ta.focus(); toggleListLines(ta); }
    else if (k === 'in' || k === 'out') { ta.focus(); indentLines(ta, k === 'in' ? 1 : -1); }
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
   Elenchi puntati in Modifica: rientro, riduzione, continuazione con Invio
   --------------------------------------------------------------------- */
const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;
function lineStart(v, pos) { return v.lastIndexOf('\n', pos - 1) + 1; }
function lineEnd(v, pos) { const e = v.indexOf('\n', pos); return e < 0 ? v.length : e; }
/* v4.30: trasforma le righe selezionate (o la riga del cursore) in elenco puntato o numerato senza mai cancellare il testo */
function toggleListLines(ta, ordered = false) {
  const v = ta.value;
  const s = ta.selectionStart ?? v.length;
  const e = ta.selectionEnd ?? s;
  const ls = lineStart(v, s);
  const endPos = e > s && v[e - 1] === '\n' ? e - 1 : e;
  const le = lineEnd(v, Math.max(endPos, s));
  const lines = v.slice(ls, le).split('\n');
  const nonEmpty = lines.filter(l => l.trim());
  if (!nonEmpty.length) {
    const lead = lines[0] || '';
    const ins = `${lead}${ordered ? '1. ' : '- '}`;
    ta.setRangeText(ins, ls, le, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  const sameRe = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
  const allSame = nonEmpty.every(l => sameRe.test(l));
  let firstDelta = 0;
  let num = 1;
  const out = lines.map((l, i) => {
    if (!l.trim()) return l;
    const m = l.match(/^(\s*)(?:([-*+]|\d+[.)])\s+)?(.*)$/);
    const pad = m[1] || '';
    const hadMarker = m[2] ? m[0].slice(pad.length, m[0].length - m[3].length) : '';
    const rest = m[3] || '';
    if (allSame) {
      if (i === 0) firstDelta = -hadMarker.length;
      return pad + rest;
    }
    const nextMarker = ordered ? `${num++}. ` : '- ';
    if (i === 0) firstDelta = nextMarker.length - hadMarker.length;
    return `${pad}${nextMarker}${rest}`;
  });
  const joined = out.join('\n');
  ta.setRangeText(joined, ls, le, 'preserve');
  if (s === e) {
    const pos = Math.max(ls, s + firstDelta);
    ta.setSelectionRange(pos, pos);
  } else {
    ta.setSelectionRange(ls, ls + joined.length);
  }
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
function indentLines(ta, dir) {
  const v = ta.value;
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const ls = lineStart(v, s);
  const endPos = e > s && v[e - 1] === '\n' ? e - 1 : e;
  const le = lineEnd(v, Math.max(endPos, s));
  const prevLine = ls > 0 ? v.slice(lineStart(v, ls - 1), ls - 1) : '';
  const prevOrd = prevLine.match(/^\s*(\d+[.)]\s+)/);
  const addStep = prevOrd ? prevOrd[1].length : 2;
  const lines = v.slice(ls, le).split('\n');
  let first = 0;
  let total = 0;
  const out = lines.map((raw, i) => {
    const l = raw.replace(/^\t+/, m => '  '.repeat(m.length));
    const tabDiff = l.length - raw.length;
    const lead = l.match(/^ */)[0].length;
    if (dir > 0) {
      if (!l.trim()) { if (i === 0) first = tabDiff; total += tabDiff; return l; }
      if (i === 0) first = addStep + tabDiff;
      total += addStep + tabDiff;
      return ' '.repeat(addStep) + l;
    }
    const step = lead >= 3 && lead % 3 === 0 && lead % 2 !== 0 ? 3 : 2;
    const rm = Math.min(lead, step);
    if (i === 0) first = tabDiff - rm;
    total += tabDiff - rm;
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
    if (e.button > 0 && !penErases(e)) return;
    e.preventDefault();
    article.setPointerCapture(e.pointerId);
    if (tool === 'eraser' || penErases(e)) {
      cur = { id: e.pointerId, eraser: true, restore: tool !== 'eraser' ? tool : null };
      if (cur.restore) article.dataset.inkTool = 'eraser';
      erase(e);
      return;
    }
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
    for (const ev of ((e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e])) {
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
    if (c.eraser) { if (c.restore) article.dataset.inkTool = c.restore; return; }
    const d = data();
    const k = (d.w && article.clientWidth) ? d.w / article.clientWidth : 1;
    const s = { id: uid(), c: color, s: +(size * k).toFixed(2), b: c.bi, p: c.pts.map(([x, y]) => [+(x * k).toFixed(1), +((y - c.top) * k).toFixed(1)]) };
    d.strokes.push(s);
    undoStack.push({ add: s.id });
    draw(); save();
  };
  article.addEventListener('pointerup', end);
  article.addEventListener('pointercancel', end);
  article.addEventListener('contextmenu', e => { if (on) e.preventDefault(); });
  twoFingerTap(article, () => $('[data-it="undo"]', bar)?.click(), () => on && penSeen);
  draw();
}

/* ---------- Cloze: riga colorata per ricordare com’è andata ---------- */
const CZ_MARKS = ['g', 'y', 'o', 'r'];
const CZ_MARK_NAMES = { g: 'andata bene', y: 'qualche dubbio', o: 'da rivedere', r: 'non la sapevo' };
// v3.24: le linee hanno i margini trascinabili (vedi setupRateLines)
function setupClozeMarks(article, sec) {
  return setupRateLines(article, sec, { kind: 'cloze' });
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
  [['cloze', 'czHist', 'czMarks', ''], ['recall', 'rcHist', 'rcMarks', 'rc|'], ['map', 'mpHist', 'mpMarks', 'mp|']].forEach(([kind, hk, mk, pre]) => {
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
        <span class="czw-label">${showSec ? `<a href="#/sec/${sec.id}/${w.kind === 'recall' ? 'oral' : w.kind === 'map' ? 'map' : 'cloze'}">${esc(sec.title)}</a> › ` : ''}${esc(w.label || 'Paragrafo')}</span>
        <span class="czw-sub">${w.bad} ${w.bad === 1 ? 'volta' : 'volte'} in rosso o arancio ${w.kind === 'recall' ? 'nelle ultime ripetizioni' : w.kind === 'map' ? 'nel ripasso della mappa' : 'nelle ultime letture'}</span>
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
    Playlist.stop(true);
    bar.hidden = false;
    btn.classList.add('on');
    article.classList.add('tts-on');
    setPlay(true);
  };
  function stop() {
    const was = playing;
    playing = false;
    token++;
    // se sta leggendo l’ascolto in sequenza, non lo interrompo
    if (was) Voice.stop();
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
  // v3.99: tutto il testo, senza limite di righe; gli a capo restano; le parole lunghissime si spezzano
  const lines = [];
  String(text).split('\n').forEach(par => {
    let cur = '';
    par.split(' ').forEach(w => {
      while (mapMeasure.measureText(w).width > maxW * 1.4 && w.length > 4) {
        let k = w.length - 1;
        while (k > 1 && mapMeasure.measureText(w.slice(0, k)).width > maxW) k--;
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(`${w.slice(0, k)}-`);
        w = w.slice(k);
      }
      const t = cur ? `${cur} ${w}` : w;
      if (mapMeasure.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    });
    lines.push(cur);
  });
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
  const width = Math.max(...lines.map(l => mapMeasure.measureText(l).width), 20);
  return { lines, width };
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
/* =====================================================================
   v3.78: testo formattato nei nodi delle mappe
   n.t resta il testo semplice (ricerca, flashcard, XMind); n.r è lo stesso
   testo con grassetto, corsivo, sottolineato e colori (b, i, u, span.rc-…).
   n.r si usa solo se corrisponde ancora a n.t.
   ===================================================================== */
const RICH_COLORS = [['red', 'Rosso', '#dc2626'], ['blue', 'Blu', '#2563eb'], ['green', 'Verde', '#16a34a'], ['orange', 'Arancio', '#ea580c'], ['purple', 'Viola', '#9333ea']];
const richColorOf = v => {
  const s = String(v || '').toLowerCase().replace(/\s+/g, '');
  const hex = s.startsWith('rgb') ? `#${(s.match(/\d+/g) || []).slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('')}` : s;
  return (RICH_COLORS.find(c => c[2] === hex) || [])[0] || '';
};
function richSanitize(html) {
  const doc = new DOMParser().parseFromString(`<div>${String(html || '')}</div>`, 'text/html');
  const walk = (node, ctx) => [...node.childNodes].map(ch => {
    if (ch.nodeType === 3) {
      const t = esc(ch.nodeValue.replace(/\s+/g, ' '));
      if (!t) return '';
      let s = t;
      if (ctx.u) s = `<u>${s}</u>`;
      if (ctx.i) s = `<i>${s}</i>`;
      if (ctx.b) s = `<b>${s}</b>`;
      if (ctx.c) s = `<span class="rc-${ctx.c}">${s}</span>`;
      return s;
    }
    if (ch.nodeType !== 1) return '';
    const tag = ch.tagName.toLowerCase();
    if (tag === 'br') return ' ';
    const st = ch.style || {};
    const cls = (ch.className && String(ch.className).match(/rc-(\w+)/)) || null;
    return walk(ch, {
      b: ctx.b || tag === 'b' || tag === 'strong' || /bold|[6-9]00/.test(st.fontWeight || ''),
      i: ctx.i || tag === 'i' || tag === 'em' || st.fontStyle === 'italic',
      u: ctx.u || tag === 'u' || /underline/.test(st.textDecoration || st.textDecorationLine || ''),
      c: (cls && RICH_COLORS.some(c => c[0] === cls[1]) ? cls[1] : '') || richColorOf(ch.getAttribute('color')) || richColorOf(st.color) || ctx.c
    });
  }).join('');
  // fonde i pezzi uguali vicini (<b>a</b><b>b</b> → <b>ab</b>)
  let out = walk(doc.body.firstChild, {});
  for (let k = 0; k < 3; k++) out = out.replace(/<\/(b|i|u)><\1>/g, '');
  return out.replace(/\s{2,}/g, ' ').trim();
}
const richPlain = html => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent.replace(/\s+/g, ' ').trim(); };
const richHas = html => /<(b|i|u|span)\b/.test(html || '');
// l’HTML da mostrare per un nodo (sempre sicuro: viene da richSanitize o da esc)
const nodeHtml = n => (n.r && richPlain(n.r) === String(n.t || '').replace(/\s+/g, ' ').trim() ? n.r : esc(n.t || ''));
function setNodeRich(n, html) {
  const clean = richSanitize(html);
  n.t = richPlain(clean);
  if (richHas(clean)) n.r = clean; else delete n.r;
}
// pezzi con il loro stile, per il disegno della mappa
function richRuns(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  const out = [];
  const walk = (node, ctx) => node.childNodes.forEach(ch => {
    if (ch.nodeType === 3) { if (ch.nodeValue) out.push({ t: ch.nodeValue, ...ctx }); return; }
    if (ch.nodeType !== 1) return;
    const tag = ch.tagName.toLowerCase();
    const cls = String(ch.className || '').match(/rc-(\w+)/);
    walk(ch, { b: ctx.b || tag === 'b', i: ctx.i || tag === 'i', u: ctx.u || tag === 'u', c: cls ? cls[1] : ctx.c });
  });
  walk(d, {});
  // spazi come nel testo semplice
  let txt = '';
  out.forEach(r => { r.t = r.t.replace(/\s+/g, ' '); if (!txt || /\s$/.test(txt)) r.t = r.t.replace(/^\s+/, ''); txt += r.t; });
  return out.filter(r => r.t);
}
// le righe di un nodo nell’SVG, con grassetto, corsivo, sottolineato e colori
function richSvgLines(n, lines, x, y0, dy) {
  const plainLine = (l, k) => `<text x="${x}" y="${y0 + k * dy}">${esc(l)}</text>`;
  if (!n.r || nodeHtml(n) !== n.r) return lines.map(plainLine).join('');
  const runs = richRuns(n.r);
  const plain = runs.map(r => r.t).join('');
  let pos = 0;
  return lines.map((l, k) => {
    const start = plain.indexOf(l, pos);
    if (start < 0) return plainLine(l, k);
    const end = start + l.length;
    pos = end;
    let at = 0;
    const spans = [];
    runs.forEach(r => {
      const a = Math.max(start, at), b = Math.min(end, at + r.t.length);
      if (b > a) spans.push(`<tspan${r.b ? ' font-weight="700"' : ''}${r.i ? ' font-style="italic"' : ''}${r.u ? ' text-decoration="underline"' : ''}${r.c ? ` class="rc-${r.c}"` : ''}>${esc(r.t.slice(a - at, b - at))}</tspan>`);
      at += r.t.length;
    });
    return `<text x="${x}" y="${y0 + k * dy}">${spans.join('')}</text>`;
  }).join('');
}
const richHasBold = n => !!(n.r && /<b>/.test(n.r));

/* ---------- Il menu di formattazione ----------
   Al computer: seleziona il testo di un nodo e premi il tasto destro.
   Sul tablet: compare da solo sopra il testo selezionato. */
const FormatMenu = {
  el: null, host: null,
  editable(node) { const el = node && (node.nodeType === 1 ? node : node.parentElement); return el && el.closest ? el.closest('.ml-t[contenteditable="true"], .rich-ed[contenteditable="true"]') : null; },
  build() {
    if (this.el) return;
    const el = document.createElement('div');
    el.className = 'fmt-menu';
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', 'Formattazione del testo');
    el.hidden = true;
    el.innerHTML = `
      <button type="button" data-fm="bold" title="Grassetto (Ctrl+B)"><b>G</b></button>
      <button type="button" data-fm="italic" title="Corsivo (Ctrl+I)"><i>C</i></button>
      <button type="button" data-fm="underline" title="Sottolineato (Ctrl+U)"><u>S</u></button>
      <span class="fmt-sep" aria-hidden="true"></span>
      ${RICH_COLORS.map(([k, l, hex]) => `<button type="button" class="fmt-c" data-fm="c:${hex}" title="${l}" aria-label="${l}" style="--c:${hex}"></button>`).join('')}
      <span class="fmt-sep" aria-hidden="true"></span>
      <button type="button" data-fm="clear" title="Togli la formattazione">✕</button>`;
    document.body.append(el);
    // i pulsanti non tolgono la selezione dal testo
    el.addEventListener('pointerdown', e => e.preventDefault());
    el.addEventListener('mousedown', e => e.preventDefault());
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-fm]');
      if (!b) return;
      try { document.execCommand('styleWithCSS', false, false); } catch { /* niente */ }
      const k = b.dataset.fm;
      if (k === 'clear') document.execCommand('removeFormat');
      else if (k.startsWith('c:')) document.execCommand('foreColor', false, k.slice(2));
      else document.execCommand(k);
      if (this.host) this.host.dispatchEvent(new Event('input', { bubbles: true }));
    });
    this.el = el;
  },
  show(x, y, host) {
    this.build();
    this.host = host;
    const el = this.el;
    el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight;
    clampFixed(el, { left: x - w / 2, top: y - h - 10, gap: 6 });
  },
  hide() { if (this.el) this.el.hidden = true; this.host = null; },
  init() {
    // tasto destro su un testo selezionato in un nodo
    document.addEventListener('contextmenu', e => {
      const host = this.editable(e.target);
      const sel = document.getSelection();
      if (!host || !sel || sel.isCollapsed || !host.contains(sel.anchorNode)) return;
      e.preventDefault();
      this.show(e.clientX, e.clientY, host);
    });
    let lastPointer = 'mouse';
    document.addEventListener('pointerdown', e => { lastPointer = e.pointerType; if (this.el && !this.el.contains(e.target)) this.hide(); }, true);
    // tablet e telefono: compare sopra la selezione
    document.addEventListener('selectionchange', () => {
      const sel = document.getSelection();
      const host = sel && sel.rangeCount ? this.editable(sel.anchorNode) : null;
      if (!host || sel.isCollapsed) { if (lastPointer !== 'mouse') this.hide(); return; }
      if (lastPointer === 'mouse') return;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width || r.height) this.show(r.left + r.width / 2, r.top, host);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.hide(); });
    window.addEventListener('scroll', () => this.hide(), true);
  }
};
FormatMenu.init();
// scheda per modificare un nodo con il testo formattato
function richEditSheet(title, html) {
  return new Promise(resolve => {
    const sh = openSheet(`
      <h2>${esc(title)}</h2>
      <div class="rich-tools" role="toolbar" aria-label="Formattazione">
        <button type="button" class="btn sm" data-rt2="bold"><b>G</b></button>
        <button type="button" class="btn sm" data-rt2="italic"><i>C</i></button>
        <button type="button" class="btn sm" data-rt2="underline"><u>S</u></button>
        ${RICH_COLORS.map(([k, l, hex]) => `<button type="button" class="btn sm fmt-c" data-rt2="c:${hex}" aria-label="${l}" title="${l}" style="--c:${hex}"></button>`).join('')}
        <button type="button" class="btn sm ghost" data-rt2="clear" title="Togli la formattazione">✕</button>
      </div>
      <div class="input rich-ed" contenteditable="true" role="textbox" aria-label="Testo del nodo" spellcheck="true">${html || ''}</div>
      <p class="hint">Seleziona una parte del testo e scegli lo stile; al computer anche con il tasto destro o Ctrl+B, Ctrl+I, Ctrl+U.</p>
      <div class="modal-actions"><button class="btn ghost" type="button" data-rx="no">Annulla</button><button class="btn primary" type="button" data-rx="ok">Salva</button></div>`, { label: title, onClose: v => resolve(v === undefined ? null : v) });
    const ed = $('.rich-ed', sh.el);
    $('.rich-tools', sh.el).addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); });
    $('.rich-tools', sh.el).addEventListener('click', e => {
      const b = e.target.closest('[data-rt2]');
      if (!b) return;
      ed.focus();
      try { document.execCommand('styleWithCSS', false, false); } catch { /* niente */ }
      const k = b.dataset.rt2;
      if (k === 'clear') document.execCommand('removeFormat');
      else if (k.startsWith('c:')) document.execCommand('foreColor', false, k.slice(2));
      else document.execCommand(k);
    });
    ed.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('[data-rx="ok"]', sh.el).click(); } });
    ed.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') || '').replace(/\s+/g, ' ')); });
    $('[data-rx="no"]', sh.el).onclick = () => sh.close(null);
    $('[data-rx="ok"]', sh.el).onclick = () => sh.close(ed.innerHTML);
    setTimeout(() => { ed.focus(); const r = document.createRange(); r.selectNodeContents(ed); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }, 50);
  });
}

// v3.78: sommari e frecce restano coerenti quando i rami si spostano o si eliminano
function mapNormSheet(sheet) {
  const ids = new Set();
  const walk = n => {
    if (n.id) ids.add(n.id);
    if (n.sum) {
      const L = (n.c || []).length;
      n.sum = n.sum.filter(x => x.a < L).map(x => ({ ...x, b: Math.min(Math.max(x.a, x.b), L - 1) }));
      if (!n.sum.length) delete n.sum;
    }
    (n.c || []).forEach(walk);
  };
  walk(sheet.root);
  if (sheet.rels) { sheet.rels = sheet.rels.filter(r => ids.has(r.from) && ids.has(r.to) && r.from !== r.to); if (!sheet.rels.length) delete sheet.rels; }
}
function mapFindById(root, id) { let res = null; const w = n => { if (res) return; if (n.id === id) res = n; else (n.c || []).forEach(w); }; w(root); return res; }
const slimTopic = t => {
  const o = { t: t.title };
  if (t.id) o.id = String(t.id);
  if (t.notes) o.n = t.notes.slice(0, 2000);
  if ((t.sums || []).length) o.sum = t.sums.map(x => ({ id: uid(), a: x.a, b: x.b, t: x.t || '…' }));
  const kids = [...(t.children || []), ...(t.floating || [])].map(slimTopic);
  if (kids.length) o.c = kids;
  return o;
};
// ogni ramo principale ha il suo colore
const branchHue = i => (i === undefined ? 205 : (200 + i * 67) % 360);
function mapCountNodes(n) { return 1 + (n.c || []).reduce((a, c) => a + mapCountNodes(c), 0); }

// v3.36: le mappe si modificano (in elenco o sulla mappa), si creano da zero o dagli
// appunti della sezione e si scaricano come file .xmind da riaprire in XMind.
function mdToMapTree(md, title) {
  const clean = s => stripMarks(String(s || ''))
    .replace(clozeRe(), (m, t) => splitHint(t)[0])
    .replace(IMG_MD_RE, '')
    .replace(XREF_RE, (m, t, l) => (l || t))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\s)\*([^*]+)\*/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
  const root = { t: title || 'Mappa' };
  // v4.01: tutto il testo, senza tagliarlo (prima i nodi si fermavano a 200 caratteri)
  const add = (parent, t) => { const n = { t }; (parent.c || (parent.c = [])).push(n); return n; };
  const note = (node, t) => { if (!t) return; node.n = node.n ? `${node.n}\n${t}` : t; };
  const stack = [{ lvl: 0, node: root }];
  const top = () => stack[stack.length - 1].node;
  const addList = (items, parent) => items.forEach(it => {
    const toks = it.tokens || [];
    const own = toks.filter(t => t.type === 'text' || t.type === 'paragraph').map(t => t.text).join(' ') || String(it.text || '').split('\n')[0];
    const n = add(parent, clean(own) || '…');
    toks.filter(t => t.type === 'list').forEach(l => addList(l.items || [], n));
  });
  const mk = window.marked;
  if (mk && mk.lexer) {
    let toks = [];
    try { toks = mk.lexer(String(md || '')); } catch { toks = []; }
    toks.forEach(t => {
      if (t.type === 'heading') {
        while (stack.length > 1 && stack[stack.length - 1].lvl >= t.depth) stack.pop();
        const n = add(top(), clean(t.text) || '…');
        stack.push({ lvl: t.depth, node: n });
      } else if (t.type === 'list') addList(t.items || [], top());
      else if (t.type === 'paragraph') note(top(), clean(t.text));
    });
  } else {
    String(md || '').split('\n').forEach(line => {
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      const li = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/);
      if (h) {
        while (stack.length > 1 && stack[stack.length - 1].lvl >= h[1].length) stack.pop();
        stack.push({ lvl: h[1].length, node: add(top(), clean(h[2])) });
      } else if (li) {
        const depth = Math.floor(li[1].replace(/\t/g, '  ').length / 2);
        let parent = top();
        for (let d = 0; d < depth && parent.c && parent.c.length; d++) parent = parent.c[parent.c.length - 1];
        add(parent, clean(li[2]));
      }
    });
  }
  // un solo titolo principale uguale al nome: diventa lui il centro
  if ((root.c || []).length === 1 && foldAccents(root.c[0].t) === foldAccents(root.t)) {
    const only = root.c[0];
    root.c = only.c;
    if (only.n) root.n = only.n;
    if (!root.c) delete root.c;
  }
  return root;
}
// v4.01: le mappe create dagli appunti fino alla 4.00 tagliavano ogni nodo a 200 caratteri.
// Se negli appunti della sezione c’è ancora la frase intera, il nodo la riprende.
function mapRepairCut(sec) {
  const cut = [];
  const walk = n => { if (!n) return; if (typeof n.t === 'string' && n.t.length === 200) cut.push(n); (n.c || []).forEach(walk); };
  mapsOf(sec).forEach(m => (m.sheets || []).forEach(sh => walk(sh.root)));
  if (!cut.length || !sec.md) return false;
  const full = [];
  const fw = n => { if (n.t && n.t.length > 200) full.push(n.t); (n.c || []).forEach(fw); };
  try { fw(mdToMapTree(sec.md, sec.title)); } catch { return false; }
  let fixed = 0;
  cut.forEach(n => {
    const f = full.find(t => t.startsWith(n.t));
    if (f) { n.t = f; delete n.r; fixed++; }
  });
  return fixed > 0;
}
async function exportXmind(m) {
  await ensureJSZip();
  const topic = n => {
    const o = { id: n.id || uid() + uid(), class: 'topic', title: n.t || '' };
    if (n.n) o.notes = { plain: { content: n.n } };
    if ((n.c || []).length) o.children = { attached: n.c.map(topic) };
    // v3.78: i sommari
    if ((n.sum || []).length && (n.c || []).length) {
      const tops = n.sum.map(x => ({ id: uid() + uid(), title: x.t || '' }));
      o.children.summary = tops;
      o.summaries = n.sum.map((x, i) => ({ id: uid() + uid(), range: `(${x.a},${x.b})`, topicId: tops[i].id }));
    }
    return o;
  };
  const content = m.sheets.map(s => {
    const o = { id: uid() + uid(), class: 'sheet', title: s.title || m.name, rootTopic: { ...topic(s.root), structureClass: 'org.xmind.ui.map.unbalanced' } };
    // le frecce tra rami: in XMind sono le “relazioni”
    if ((s.rels || []).length) o.relationships = s.rels.map(r => ({ id: uid() + uid(), end1Id: r.from, end2Id: r.to, ...(r.t ? { title: r.t } : {}) }));
    return o;
  });
  const zip = new window.JSZip();
  zip.file('content.json', JSON.stringify(content));
  zip.file('metadata.json', JSON.stringify({ creator: { name: 'StudyHub Notebook', version: APP_VERSION } }));
  zip.file('manifest.json', JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } }));
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.xmind.workbook' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${String(m.name || 'Mappa').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Mappa'}.xmind`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

function modeMap(sec, body) {
  // v4.01: i nodi tagliati a 200 caratteri dalle versioni precedenti si ricompongono dagli appunti
  if (mapRepairCut(sec)) saveSection(sec);
  let maps = mapsOf(sec);
  const st = S();
  let mi = Math.min(maps.length - 1, Math.max(0, maps.findIndex(m => m.id === st.mapLast)));
  let si = 0;
  // v3.78: nel pannello di Affianca la vista è sua (di solito l’elenco): mappa nella pagina, elenco accanto
  const inPanel = !!body.closest('.split-body');
  const instId = uid();
  let view = (inPanel ? st.mapViewPanel : st.mapView) || (inPanel || window.innerWidth < 700 ? 'list' : 'map');
  let connectFrom = null;
  // v3.79: la scheda Mappe usa tutta la larghezza; la mappa può andare a tutto schermo
  let mapFull = false;
  if (!inPanel) { document.body.classList.add('view-wide'); addCleanup(() => document.body.classList.remove('view-wide', 'map-full-on', 'map-full-edit')); }
  const onEscFull = e => { if (e.key === 'Escape' && mapFull && body.isConnected) { mapFull = false; draw(); } };
  document.addEventListener('keydown', onEscFull);
  addCleanup(() => document.removeEventListener('keydown', onEscFull));
  let quiz = !!window._mapStartQuiz;
  window._mapStartQuiz = false;
  // v3.57: semaforo nel ripasso delle mappe; le parti rosse e arancio diventano punti deboli
  let rateFor = null;
  const mpMarks = () => (sec.mpMarks && typeof sec.mpMarks === 'object' ? sec.mpMarks : (sec.mpMarks = {}));
  const markKey = key => `${(maps[mi] || {}).id}|${si}|${key}`;
  let edit = false;
  let selNode = null;
  let undo = [];
  const shown = new Set();
  let collapsed = new Set();   // nodi chiusi (per riferimento, così restano chiusi anche spostandoli)
  let zoom = 1;
  let saveT = 0;
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => { saveT = 0; saveSection(sec); }, 600); };
  addCleanup(() => { if (saveT) { clearTimeout(saveT); saveSection(sec); } });
  const cur = () => { const m = maps[mi]; return m ? { m, sheet: m.sheets[si] || m.sheets[0] } : null; };
  const touched = () => {
    const c = cur();
    if (c) { c.m.edited = Date.now(); mapNormSheet(c.sheet); }
    saveSoon();
    // l’altra copia aperta (pagina o Affianca) si ridisegna
    window.dispatchEvent(new CustomEvent('nb-map-edit', { detail: { secId: sec.id, from: instId } }));
  };
  const snap = () => { const c = cur(); if (!c) return; undo.push({ si, root: JSON.stringify(c.sheet.root), rels: JSON.stringify(c.sheet.rels || []) }); if (undo.length > 60) undo.shift(); };
  let extT = 0;
  const onExt = e => {
    if (!body.isConnected) { window.removeEventListener('nb-map-edit', onExt); return; }
    if (!e.detail || e.detail.secId !== sec.id || e.detail.from === instId) return;
    clearTimeout(extT);
    extT = setTimeout(() => {
      if (!body.isConnected) return;
      // non disturbo mentre scrivi in questa copia
      if (body.contains(document.activeElement) && document.activeElement.isContentEditable) return;
      const c = cur();
      if (selNode && c && !inTree(c.sheet.root, selNode)) selNode = null;
      draw();
    }, 200);
  };
  window.addEventListener('nb-map-edit', onExt);

  // v3.73: il testo che arriva dal PDF diventa un nodo
  const inTree = (n, x) => n === x || (n.c || []).some(k => inTree(k, x));
  MapTarget.set({
    secId: sec.id,
    alive: () => body.isConnected,
    add(text, note = '') {
      let c = cur();
      if (!c) {
        const name = sec.title;
        const rec = { id: uid(), name, sheets: [{ title: name, root: { t: name } }], created: Date.now(), edited: Date.now() };
        sec.maps = [...mapsOf(sec), rec];
        maps = sec.maps; mi = maps.length - 1; si = 0;
        c = cur();
        S().mapLast = rec.id;
      }
      snap();
      const parent = selNode && inTree(c.sheet.root, selNode) ? selNode : c.sheet.root;
      const node = { t: String(text) };
      if (note) node.n = note;
      parent.c = [...(parent.c || []), node];
      collapsed.delete(parent);
      if (!edit) { edit = true; selNode = parent; }
      touched();
      draw();
      // la mappa resta dov’era; se il nodo nuovo non si vede, lo porto in vista
      setTimeout(() => { const k = pathOf(c.sheet.root, node); const el = k && $(`[data-mkey="${k}"]`, body); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, 40);
      return { map: c.m.name, parent: parent.t };
    }
  });
  const draw = () => {
    maps = mapsOf(sec);
    if (mi >= maps.length) mi = Math.max(0, maps.length - 1);
    const m = maps[mi];
    if (!m) {
      body.innerHTML = `
        <div class="empty">
          <p>Qui crei e modifichi mappe concettuali: le leggi come mappa o come elenco, le ripassi coprendo i rami, ne ricavi flashcard e le scarichi come file XMind. Puoi anche caricare una mappa di XMind (file nuovi e XMind 8).</p>
          <div class="inline" style="justify-content:center">
            <button class="btn primary" data-act="map-new">Crea una mappa</button>
            ${String(sec.md || '').trim() ? '<button class="btn" data-act="map-from-md">Crea dagli appunti</button>' : ''}
            <button class="btn" data-act="map-add">Carica un file XMind</button>
          </div>
        </div>`;
      return;
    }
    const sheet = m.sheets[si] || m.sheets[0];
    const total = mapCountNodes(sheet.root) - 1;
    // v3.78: ridisegnando, la mappa e la pagina restano dove erano (prima tornavano in alto)
    const oldSc = $('.map-scroll', body);
    const keepSc = oldSc ? [oldSc.scrollLeft, oldSc.scrollTop] : null;
    const host = body.closest('.split-body') || document.scrollingElement;
    const keepY = host ? host.scrollTop : 0;
    body.innerHTML = `
      <div class="map-bar">
        ${maps.length > 1 ? `<select class="input map-sel" data-map-sel aria-label="Mappa">${maps.map((x, k) => `<option value="${k}" ${k === mi ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : `<b class="map-name">${esc(m.name)}</b>`}
        ${m.sheets.length > 1 ? `<select class="input map-sel" data-sheet-sel aria-label="Foglio">${m.sheets.map((x, k) => `<option value="${k}" ${k === si ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>` : ''}
        <div class="seg sm" role="tablist" aria-label="Vista">
          <button type="button" data-view="map" aria-selected="${view === 'map'}">Mappa</button>
          <button type="button" data-view="list" aria-selected="${view === 'list'}">Elenco</button>
        </div>
        ${edit ? '<button class="btn sm primary" data-act="map-edit">Fine</button>' : `
          <button class="btn sm" data-act="map-edit">✎ Modifica</button>
          <button class="btn sm ${quiz ? 'primary' : ''}" data-act="map-quiz" aria-pressed="${quiz}">${quiz ? `Fine ripasso (${shown.size}/${total})` : 'Ripassa'}</button>
          ${quiz ? '<button class="btn sm ghost" data-act="map-reveal">Scopri tutto</button>' : ''}
          <button class="btn sm ghost" data-act="map-more">Altro</button>`}
      </div>
      ${edit ? `<div class="map-etools" role="toolbar" aria-label="Modifica la mappa">
        <button type="button" class="btn sm" data-me="child" title="Aggiunge un nodo dentro quello scelto (Tab)">＋ Dentro</button>
        <button type="button" class="btn sm" data-me="sib" title="Aggiunge un nodo accanto a quello scelto (Invio)">＋ Accanto</button>
        <button type="button" class="btn sm" data-me="rename" title="Rinomina (F2 o doppio tocco)">Rinomina</button>
        <button type="button" class="btn sm" data-me="note" title="Nota del nodo">Nota</button>
        <button type="button" class="btn sm" data-me="sum" title="Una graffa che riassume il nodo scelto e quelli dopo (come il Sommario di XMind)">Sommario</button>
        <button type="button" class="btn sm" data-me="arrow" title="Una freccia dal nodo scelto a un altro nodo">→ Freccia</button>
        <button type="button" class="btn sm" data-me="fold" title="Chiude o apre i rami del nodo scelto">Chiudi/apri</button>
        <button type="button" class="btn sm" data-me="up" aria-label="Sposta su" title="Sposta su (Alt+↑)">↑</button>
        <button type="button" class="btn sm" data-me="down" aria-label="Sposta giù" title="Sposta giù (Alt+↓)">↓</button>
        <button type="button" class="btn sm" data-me="out" aria-label="Sposta fuori di un livello" title="Fuori di un livello (Maiusc+Tab)">←</button>
        <button type="button" class="btn sm" data-me="in" aria-label="Sposta dentro il nodo sopra" title="Dentro il nodo sopra">→</button>
        <button type="button" class="btn sm ghost danger" data-me="del" title="Elimina il nodo e i suoi rami (Canc)">Elimina</button>
        <button type="button" class="btn sm ghost" data-me="undo" ${undo.length ? '' : 'disabled'} title="Annulla (Ctrl+Z)">Annulla</button>
      </div>` : ''}
      <p class="hint map-hint">${edit
        ? (view === 'list' ? 'Scrivi direttamente sui nodi. Invio aggiunge un nodo accanto, Tab lo mette dentro quello sopra, Maiusc+Tab lo porta fuori, Canc su un nodo vuoto lo elimina.' : 'Tocca un nodo per sceglierlo e due volte per rinominarlo; trascinalo su un altro nodo per spostarlo lì dentro (sul telefono tieni premuto prima di trascinare).')
        : quiz ? 'Prova a ricordare ogni ramo, poi toccalo per scoprirlo; toccalo di nuovo per coprirlo.' : view === 'map' ? 'Tocca un nodo per chiudere o aprire i suoi rami; il pallino indica una nota. Zoom con due dita, Ctrl + rotellina o i pulsanti.' : 'Tocca la freccetta per chiudere o aprire un ramo.'}</p>
      ${quiz && rateFor && findNode(sheet, rateFor) ? `<div class="mp-rate" role="group" aria-label="Com’è andata">
        <span>Com’è andata con <b>${esc(findNode(sheet, rateFor).t)}</b>?</span>
        ${CZ_MARKS.map(c => `<button type="button" class="czm-dot ${c} ${mpMarks()[markKey(rateFor)] === c ? 'on' : ''}" data-mpr="${c}" aria-label="${CZ_MARK_NAMES[c]}" title="${CZ_MARK_NAMES[c]}"></button>`).join('')}
      </div>` : ''}
      ${connectFrom ? '<p class="hint warn-hint map-connect">→ Ora tocca il nodo a cui arriva la freccia. <button type="button" class="btn sm ghost" data-act="map-noconn">Annulla</button></p>' : ''}
      <div id="mapBox" class="map-box ${quiz ? 'quiz' : ''} ${edit ? 'editing' : ''} ${mapFull && view === 'map' ? 'map-full' : ''}"></div>`;
    document.body.classList.toggle('map-full-on', mapFull && view === 'map');
    document.body.classList.toggle('map-full-edit', mapFull && view === 'map' && edit);
    view === 'map' ? drawSvg(sheet) : drawList(sheet);
    const nsc = $('.map-scroll', body);
    if (keepSc && nsc) { nsc.scrollLeft = keepSc[0]; nsc.scrollTop = keepSc[1]; }
    if (host && host.scrollTop !== keepY) host.scrollTop = keepY;
  };
  const keyOf = path => path.join('.');
  const findNode = (sheet, key) => key.split('.').slice(1).reduce((n, k) => (n && n.c ? n.c[+k] : null), sheet.root);
  const parentOf = (root, target) => { let res = null; const walk = n => (n.c || []).forEach(c => { if (res) return; if (c === target) res = n; else walk(c); }); walk(root); return res; };
  const pathOf = (root, target) => {
    if (target === root) return '0';
    let res = null;
    const walk = (n, p) => (n.c || []).forEach((c, k) => { if (res) return; if (c === target) res = keyOf([...p, k]); else walk(c, [...p, k]); });
    walk(root, [0]);
    return res;
  };
  const contains = (a, b) => { let hit = false; const walk = n => (n.c || []).forEach(c => { if (c === b) hit = true; else if (!hit) walk(c); }); walk(a); return hit; };

  function drawList(sheet) {
    const box = $('#mapBox', body);
    const walk = (n, path, depth) => {
      const key = keyOf(path);
      const kids = n.c || [];
      const isClosed = collapsed.has(n);
      const hidden = quiz && depth > 0 && !shown.has(key);
      const mk = quiz && !hidden ? mpMarks()[markKey(key)] : '';
      return `<li class="ml-item d${Math.min(depth, 4)}" style="--h:${branchHue(path[1])}">
        <div class="ml-row ${edit && n === selNode ? 'sel' : ''}">
          ${kids.length ? `<button type="button" class="fold-btn" data-mtoggle="${key}" aria-expanded="${!isClosed}" aria-label="${isClosed ? 'Espandi' : 'Riduci'}">${CHEVRON}</button>` : '<span class="ml-dot" aria-hidden="true"></span>'}
          <span class="ml-t ${hidden ? 'covered' : ''} ${mk ? `mk-${mk}` : ''} ${connectFrom === n ? 'from' : ''}" data-mkey="${key}" ${edit ? 'contenteditable="true" spellcheck="true" role="textbox" aria-label="Nodo"' : hidden ? 'role="button" tabindex="0" aria-label="Ramo coperto: tocca per scoprirlo"' : ''}>${nodeHtml(n)}</span>
          ${n.n && !hidden ? `<button type="button" class="ml-note" data-mnote="${key}" aria-label="Nota">i</button>` : ''}
        </div>
        ${relLines(n)}
        ${kids.length && !isClosed ? `<ul>${kids.map((c, k) => walk(c, [...path, k], depth + 1) + (n.sum || []).map((s, i) => (s.b === k ? sumLi(key, s, i) : '')).join('')).join('')}</ul>` : ''}
      </li>`;
    };
    function sumLi(key, s, i) {
      const cov = quiz && !shown.has(`s:${key}|${i}`);
      return `<li class="ml-sum"><span class="ml-sum-b" aria-hidden="true">⟩</span><span class="ml-sum-t ${cov ? 'covered' : ''}" data-msum="${key}|${i}" role="button" tabindex="0" title="Sommario">${esc(s.t)}</span></li>`;
    }
    function relLines(n) {
      if (!n.id) return '';
      const rs = (sheet.rels || []).filter(r => r.from === n.id || r.to === n.id);
      return rs.length ? `<div class="ml-rels">${rs.map(r => { const out = r.from === n.id; const o = mapFindById(sheet.root, out ? r.to : r.from); return o ? `<button type="button" class="ml-rel" data-mrel="${r.id}" title="${edit ? 'Tocca per modificare la freccia' : 'Freccia'}">${out ? '→' : '←'} ${esc(richPlain(o.t).slice(0, 60))}${r.t ? ` <em>${esc(r.t)}</em>` : ''}</button>` : ''; }).join('')}</div>` : '';
    }
    box.innerHTML = `<ul class="map-list">${walk(sheet.root, [0], 0)}</ul>`;
  }
  function drawSvg(sheet) {
    const box = $('#mapBox', body);
    const GAPX = 46;
    const GAPY = 12;
    const layout = (n, path, depth) => {
      const key = keyOf(path);
      const isRoot = depth === 0;
      const w = mapWrap(n.t || ' ', isRoot ? 240 : 200);
      const node = { n, key, depth, path, lines: w.lines, w: Math.ceil(w.width * (richHasBold(n) ? 1.08 : 1)) + 24, h: w.lines.length * 19 + 14, kids: [] };
      if (!collapsed.has(n)) node.kids = (n.c || []).map((c, k) => layout(c, [...path, k], depth + 1));
      node.sub = node.kids.length ? Math.max(node.h, node.kids.reduce((a, k) => a + k.sub, 0) + GAPY * (node.kids.length - 1)) : node.h;
      return node;
    };
    const root = layout(sheet.root, [0], 0);
    const colW = [];
    const measure = nd => { colW[nd.depth] = Math.max(colW[nd.depth] || 0, nd.w); nd.kids.forEach(measure); };
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
    let W = colX[colX.length - 1] + colW[colW.length - 1] + 60;
    let H = root.sub + 40;
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
        <g class="mn ${isRoot ? 'root' : ''} d${Math.min(nd.depth, 3)} ${covered ? 'covered' : ''} ${edit && nd.n === selNode ? 'sel' : ''} ${connectFrom === nd.n ? 'from' : ''} ${quiz && !covered && mpMarks()[markKey(nd.key)] ? `mk-${mpMarks()[markKey(nd.key)]}` : ''}" data-mkey="${nd.key}" style="--h:${hue}" transform="translate(${nd.x} ${nd.y})" role="button" tabindex="0" aria-label="${covered ? 'Ramo coperto' : esc(nd.n.t)}">
          <rect width="${nd.w}" height="${nd.h}" rx="${isRoot ? 14 : 10}"/>
          ${richSvgLines(nd.n, nd.lines, 12, 21, 19)}
          ${nd.n.n && !covered ? `<g class="mn-note" data-mnote="${nd.key}" transform="translate(${nd.w - 4} -4)"><circle r="9"/><text text-anchor="middle" y="4">i</text><title>${esc(String(nd.n.n).slice(0, 200))}</title></g>` : ''}
          ${edit && kidsN && !collapsed.has(nd.n) ? `<g class="mn-more mn-fold" data-mtoggle="${nd.key}" transform="translate(${nd.w + 6} ${nd.h / 2 - 9})"><rect width="22" height="18" rx="9"/><text x="7" y="13">−</text><title>Chiudi questo ramo</title></g>` : ''}
          ${kidsN && collapsed.has(nd.n) ? `<g class="mn-more" data-mtoggle="${nd.key}" transform="translate(${nd.w + 6} ${nd.h / 2 - 9})"><rect width="${String(kidsN).length * 8 + 16}" height="18" rx="9"/><text x="8" y="13">+${kidsN}</text></g>` : ''}
        </g>`);
    };
    walk(root);
    // v3.78: sommari (una graffa sui rami raggruppati) e frecce tra rami
    const flat = [];
    const fl = nd => { flat.push(nd); nd.kids.forEach(fl); };
    fl(root);
    const sums = [];
    flat.forEach(nd => (nd.n.sum || []).forEach((s, i) => {
      const ks = nd.kids.slice(s.a, s.b + 1);
      if (!ks.length) return;
      let top = Infinity, bot = -Infinity, right = -Infinity;
      const ext = k => { top = Math.min(top, k.y); bot = Math.max(bot, k.y + k.h); right = Math.max(right, k.x + k.w); k.kids.forEach(ext); };
      ks.forEach(ext);
      const bx = right + 12, mid = (top + bot) / 2;
      const wr = mapWrap(s.t || ' ', 180);
      const w = Math.ceil(wr.width) + 24, h = wr.lines.length * 19 + 14;
      const sx = bx + 26, sy = mid - h / 2;
      const sk = `${nd.key}|${i}`;
      const cov = quiz && !shown.has(`s:${sk}`);
      sums.push(`<path class="mn-brace" d="M${bx} ${top}Q${bx + 9} ${top} ${bx + 9} ${top + 9}L${bx + 9} ${mid - 9}Q${bx + 9} ${mid} ${bx + 18} ${mid}Q${bx + 9} ${mid} ${bx + 9} ${mid + 9}L${bx + 9} ${bot - 9}Q${bx + 9} ${bot} ${bx} ${bot}"/>
        <g class="mn msum ${cov ? 'covered' : ''}" data-msum="${sk}" transform="translate(${sx} ${sy})" role="button" tabindex="0" aria-label="${cov ? 'Sommario coperto' : `Sommario: ${esc(s.t)}`}"><rect width="${w}" height="${h}" rx="8"/>${wr.lines.map((l, k) => `<text x="12" y="${21 + k * 19}">${esc(l)}</text>`).join('')}</g>`);
      W = Math.max(W, sx + w + 30);
      H = Math.max(H, sy + h + 20);
    }));
    const byId = new Map(flat.filter(nd => nd.n.id).map(nd => [nd.n.id, nd]));
    const rels = [];
    const edgePt = (nd, tx, ty) => { const cx = nd.x + nd.w / 2, cy = nd.y + nd.h / 2; const dx = tx - cx, dy = ty - cy; const k = Math.min((nd.w / 2 + 3) / Math.max(Math.abs(dx), 1e-6), (nd.h / 2 + 3) / Math.max(Math.abs(dy), 1e-6)); return [cx + dx * k, cy + dy * k]; };
    (sheet.rels || []).forEach(r => {
      const A = byId.get(r.from), B = byId.get(r.to);
      if (!A || !B) return;
      const p1 = edgePt(A, B.x + B.w / 2, B.y + B.h / 2), p2 = edgePt(B, A.x + A.w / 2, A.y + A.h / 2);
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
      const off = Math.min(70, len * 0.3);
      const nx = -(p2[1] - p1[1]) / len * off, ny = (p2[0] - p1[0]) / len * off;
      const c1 = [p1[0] + (p2[0] - p1[0]) / 3 + nx, p1[1] + (p2[1] - p1[1]) / 3 + ny];
      const c2 = [p1[0] + 2 * (p2[0] - p1[0]) / 3 + nx, p1[1] + 2 * (p2[1] - p1[1]) / 3 + ny];
      const f = v => v.toFixed(1);
      const d = `M${f(p1[0])} ${f(p1[1])}C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
      const mx = 0.125 * p1[0] + 0.375 * c1[0] + 0.375 * c2[0] + 0.125 * p2[0];
      const my = 0.125 * p1[1] + 0.375 * c1[1] + 0.375 * c2[1] + 0.125 * p2[1];
      const lt = r.t || '';
      const lwr = lt ? mapWrap(lt, 220) : null;
      const lw = lt ? Math.ceil(lwr.width) + 14 : 0;
      const lh = lt ? lwr.lines.length * 15 + 6 : 0;
      rels.push(`<g class="mrel" data-mrel="${r.id}"><path class="mrel-line" d="${d}" marker-end="url(#mArw-${instId})"/><path class="mrel-hit" d="${d}"><title>${esc(lt || 'Freccia')}</title></path>${lt ? `<rect class="mrel-lb" x="${f(mx - lw / 2)}" y="${f(my - lh / 2)}" width="${lw}" height="${lh}" rx="6"/>${lwr.lines.map((l, k) => `<text class="mrel-t" x="${f(mx)}" y="${f(my - lh / 2 + 15 + k * 15)}" text-anchor="middle">${esc(l)}</text>`).join('')}` : ''}</g>`);
    });
    box.innerHTML = `
      <div class="map-zoom"><button class="btn sm ghost" data-mz="-" aria-label="Rimpicciolisci">−</button><button class="btn sm ghost" data-mz="0" title="Torna al 100%">${Math.round(zoom * 100)}%</button><button class="btn sm ghost" data-mz="+" aria-label="Ingrandisci">+</button><button class="btn sm ghost" data-mz="fit" title="Adatta: la mappa intera nello spazio" aria-label="Adatta allo spazio">⤢</button><button class="btn sm ghost" data-mz="full" title="${mapFull ? 'Esci dallo schermo intero (Esc)' : 'Mappa a tutto schermo'}" aria-label="${mapFull ? 'Esci dallo schermo intero' : 'Mappa a tutto schermo'}">${mapFull ? '✕' : '⛶'}</button></div>
      <div class="map-scroll"><svg class="map-svg" viewBox="0 0 ${W} ${H}" width="${Math.round(W * zoom)}" height="${Math.round(H * zoom)}" role="img" aria-label="Mappa: ${esc(sheet.root.t)}"><defs><marker id="mArw-${instId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="mrel-head" d="M0 0L10 5L0 10z"/></marker></defs><g class="links">${links.join('')}</g><g class="sums">${sums.join('')}</g>${nodes.join('')}<g class="rels">${rels.join('')}</g></svg></div>`;
    const sc = $('.map-scroll', box);
    const setZoom = (z, cx, cy) => {
      const svg = $('.map-svg', box);
      const old = zoom;
      zoom = Math.max(0.15, Math.min(2.5, z));
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
    // la mappa intera nello spazio che c’è
    const fit = () => {
      const r = sc.getBoundingClientRect();
      const z = Math.min(r.width / W, (r.height || window.innerHeight * 0.7) / H) * 0.97;
      setZoom(Math.max(0.15, Math.min(1.5, z)));
      sc.scrollLeft = 0;
      sc.scrollTop = 0;
    };
    box.querySelector('.map-zoom').addEventListener('click', e => {
      const b = e.target.closest('[data-mz]');
      if (!b) return;
      // ridisegnata a tutto schermo, la mappa si adatta al nuovo spazio
      if (b.dataset.mz === 'full') { mapFull = !mapFull; draw(); if (mapFull) requestAnimationFrame(() => $('[data-mz="fit"]', body)?.click()); return; }
      if (b.dataset.mz === 'fit') { fit(); return; }
      setZoom(b.dataset.mz === '+' ? zoom * 1.2 : b.dataset.mz === '-' ? zoom / 1.2 : 1);
    });
    sc.addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = sc.getBoundingClientRect();
      const dy = Math.max(-180, Math.min(180, e.deltaY));
      setZoom(zoom * Math.exp(-dy * 0.0025), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    let pinch = null;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    sc.addEventListener('touchstart', e => { if (e.touches.length === 2) { const r = sc.getBoundingClientRect(); pinch = { d: Math.max(10, dist(e.touches[0], e.touches[1])), z: zoom, x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top }; } }, { passive: true });
    sc.addEventListener('touchmove', e => {
      if (drag && drag.armed) { e.preventDefault(); return; }
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        const r = sc.getBoundingClientRect();
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
        setZoom(pinch.z * dist(e.touches[0], e.touches[1]) / pinch.d, cx, cy);
      }
    }, { passive: false });
    sc.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });
    sc.addEventListener('touchcancel', () => { pinch = null; });
    if (edit) bindDrag(sc, sheet);
  }

  /* trascinare un nodo su un altro (solo in modifica, sulla mappa) */
  let drag = null;
  function bindDrag(sc, sheet) {
    const svg = $('.map-svg', sc);
    svg.addEventListener('pointerdown', e => {
      const g = e.target.closest('g.mn');
      if (!g || g.classList.contains('root') || e.button > 0) return;
      const n = findNode(sheet, g.dataset.mkey);
      if (!n) return;
      drag = { id: e.pointerId, n, x0: e.clientX, y0: e.clientY, armed: e.pointerType !== 'touch', moving: false, ghost: null, timer: 0 };
      if (e.pointerType === 'touch') drag.timer = setTimeout(() => { if (drag) { drag.armed = true; g.classList.add('lift'); navigator.vibrate?.(15); } }, 380);
    });
    svg.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const far = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 8;
      if (!drag.armed) { if (far) { clearTimeout(drag.timer); drag = null; } return; }
      if (!drag.moving && !far) return;
      if (!drag.moving) {
        drag.moving = true;
        try { svg.setPointerCapture(e.pointerId); } catch { /* niente */ }
        drag.ghost = document.createElement('div');
        drag.ghost.className = 'map-ghost';
        drag.ghost.textContent = drag.n.t || '…';
        document.body.append(drag.ghost);
      }
      drag.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`;
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('g.mn');
      $$('g.mn.drop', svg).forEach(x => { if (x !== over) x.classList.remove('drop'); });
      if (over) {
        const t = findNode(sheet, over.dataset.mkey);
        if (t && t !== drag.n && !contains(drag.n, t)) over.classList.add('drop');
      }
    });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      clearTimeout(drag.timer);
      const d = drag;
      drag = null;
      $$('g.mn.lift', svg).forEach(x => x.classList.remove('lift'));
      if (!d.moving) return;
      d.ghost?.remove();
      const over = $('g.mn.drop', svg);
      if (!over) return;
      const t = findNode(sheet, over.dataset.mkey);
      if (!t || t === d.n || contains(d.n, t)) return;
      const p = parentOf(sheet.root, d.n);
      if (!p) return;
      snap();
      p.c.splice(p.c.indexOf(d.n), 1);
      if (!p.c.length) delete p.c;
      (t.c || (t.c = [])).push(d.n);
      collapsed.delete(t);
      selNode = d.n;
      touched();
      draw();
      toast(`“${d.n.t}” spostato dentro “${t.t}”`);
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', e => { if (drag) { clearTimeout(drag.timer); drag.ghost?.remove(); drag = null; } });
  }
  let suppressClick = false;

  /* operazioni sui nodi */
  const focusSel = (atEnd = true) => {
    const c = cur();
    if (!c || !selNode) return;
    const key = pathOf(c.sheet.root, selNode);
    const el = key && $(`[data-mkey="${key}"]`, body);
    if (!el) return;
    if (view === 'list') {
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      if (atEnd) r.collapse(false);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    } else el.focus({ preventScroll: false });
  };
  const rename = async n => {
    const v = await richEditSheet('Modifica il nodo', nodeHtml(n));
    if (v === null || v === undefined) return;
    snap();
    setNodeRich(n, v);
    if (!n.t) { n.t = '…'; delete n.r; }
    touched();
    draw();
  };
  // frecce e sommari
  const addRel = (a, b) => {
    const c = cur();
    if (!c) return;
    connectFrom = null;
    snap();
    a.id = a.id || uid();
    b.id = b.id || uid();
    const r = { id: uid(), from: a.id, to: b.id, t: '' };
    c.sheet.rels = [...(c.sheet.rels || []), r];
    touched();
    draw();
    toast(`Freccia da “${richPlain(a.t).slice(0, 30)}” a “${richPlain(b.t).slice(0, 30)}”`, '', { label: 'Scrivi un’etichetta', fn: () => relMenu(c.sheet, r.id, 'label') });
  };
  const relMenu = async (sheet, id, direct = '') => {
    const r = (sheet.rels || []).find(x => x.id === id);
    if (!r) return;
    const ch = direct || await actionSheet('Freccia', [{ key: 'label', label: r.t ? 'Cambia l’etichetta' : 'Scrivi un’etichetta' }, { key: 'flip', label: 'Inverti la direzione' }, { key: 'del', label: 'Elimina la freccia', danger: true }]);
    if (!ch) return;
    if (ch === 'label') {
      const v = await modal({ title: 'Etichetta della freccia', text: 'Es. “causa”, “inibisce”, “porta a”. Lascia vuoto per toglierla.', input: true, value: r.t || '', confirm: 'Salva', allowEmpty: true });
      if (v === null || v === undefined) return;
      snap();
      r.t = String(v).trim();
    }
    if (ch === 'flip') { snap(); [r.from, r.to] = [r.to, r.from]; }
    if (ch === 'del') { snap(); sheet.rels = sheet.rels.filter(x => x !== r); }
    touched();
    draw();
  };
  const sumMenu = async (sheet, pk, i) => {
    const p = findNode(sheet, pk);
    const s = p && (p.sum || [])[i];
    if (!s) return;
    const ch = await actionSheet('Sommario', [{ key: 'ren', label: 'Cambia il testo' }, { key: 'del', label: 'Elimina il sommario', danger: true }]);
    if (ch === 'ren') { const v = await modal({ title: 'Sommario', input: true, value: s.t, confirm: 'Salva' }); if (!v) return; snap(); s.t = String(v).trim(); }
    else if (ch === 'del') { snap(); p.sum.splice(i, 1); if (!p.sum.length) delete p.sum; }
    else return;
    touched();
    draw();
  };
  const op = async (kind) => {
    const c = cur();
    if (!c) return;
    const root = c.sheet.root;
    if (kind === 'undo') {
      const u = undo.pop();
      if (!u) return;
      si = u.si;
      const s2 = cur();
      s2.sheet.root = JSON.parse(u.root);
      s2.sheet.rels = JSON.parse(u.rels || '[]');
      selNode = null;
      collapsed = new Set();
      touched();
      draw();
      return;
    }
    if (!selNode) { selNode = root; }
    const n = selNode;
    const p = parentOf(root, n);
    if (kind === 'fold') { if ((n.c || []).length) { if (collapsed.has(n)) collapsed.delete(n); else collapsed.add(n); draw(); } else toast('Questo nodo non ha rami da chiudere'); return; }
    if (kind === 'arrow') { connectFrom = n; draw(); return; }
    if (kind === 'sum') {
      if (!p) { toast('Il sommario raggruppa dei rami: scegli un nodo che non sia il centro'); return; }
      const idx = p.c.indexOf(n);
      let b = idx;
      const after = p.c.slice(idx);
      if (after.length > 1) {
        const ch = await actionSheet('Il sommario raggruppa da questo nodo fino a…', after.map((x, k) => ({ key: String(idx + k), label: richPlain(x.t || '…').slice(0, 60) })));
        if (ch === null || ch === undefined || ch === '') return;
        b = +ch;
      }
      const t = await modal({ title: 'Sommario', text: 'Cosa riassume questo gruppo di rami? Es. “Fattori di rischio”', input: true, value: '', confirm: 'Aggiungi' });
      if (!t) return;
      snap();
      (p.sum || (p.sum = [])).push({ id: uid(), a: idx, b, t: String(t).trim() });
      touched();
      draw();
      return;
    }
    if (kind === 'child') {
      snap();
      const k = { t: '' };
      (n.c || (n.c = [])).push(k);
      collapsed.delete(n);
      selNode = k;
      touched();
      draw();
      if (view === 'list') focusSel(); else rename(k);
      return;
    }
    if (kind === 'sib') {
      if (!p) return op('child');
      snap();
      const k = { t: '' };
      p.c.splice(p.c.indexOf(n) + 1, 0, k);
      selNode = k;
      touched();
      draw();
      if (view === 'list') focusSel(); else rename(k);
      return;
    }
    if (kind === 'rename') { if (view === 'list') focusSel(false); else rename(n); return; }
    if (kind === 'note') {
      const v = await modal({ title: `Nota di “${n.t || '…'}”`, text: 'Compare toccando il pallino del nodo; puoi usare il grassetto e gli elenchi.', input: true, multiline: true, value: n.n || '', confirm: 'Salva', allowEmpty: true });
      if (v === null || v === undefined) return;
      snap();
      if (String(v).trim()) n.n = String(v).trim().slice(0, 2000); else delete n.n;
      touched();
      draw();
      return;
    }
    if (!p) { if (kind === 'del') toast('Il nodo centrale non si elimina: rinominalo, oppure elimina la mappa da Altro'); return; }
    const i = p.c.indexOf(n);
    if (kind === 'up' || kind === 'down') {
      const j = kind === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= p.c.length) return;
      snap();
      [p.c[i], p.c[j]] = [p.c[j], p.c[i]];
    } else if (kind === 'in') {
      if (i === 0) { toast('Non c’è un nodo sopra in cui spostarlo'); return; }
      snap();
      const prev = p.c[i - 1];
      p.c.splice(i, 1);
      (prev.c || (prev.c = [])).push(n);
      collapsed.delete(prev);
    } else if (kind === 'out') {
      const gp = parentOf(root, p);
      if (!gp) { toast('È già al primo livello'); return; }
      snap();
      p.c.splice(i, 1);
      if (!p.c.length) delete p.c;
      gp.c.splice(gp.c.indexOf(p) + 1, 0, n);
    } else if (kind === 'del') {
      const kids = mapCountNodes(n) - 1;
      if (kids > 2 && !(await modal({ title: 'Eliminare il nodo?', text: `“${n.t}” ha ${kids} nodi sotto di sé: spariscono anche loro (puoi annullare).`, confirm: 'Elimina', danger: true }))) return;
      snap();
      p.c.splice(i, 1);
      if (!p.c.length) delete p.c;
      selNode = p.c && p.c.length ? p.c[Math.max(0, i - 1)] : p;
    }
    touched();
    draw();
    if (view === 'list') focusSel(); else focusSel();
  };

  async function addMap() {
    const file = await chooseXmindFile();
    if (!file) return;
    try {
      toast('Leggo la mappa…');
      const sheets = await parseXmind(file);
      if (!sheets.length) throw new Error('La mappa è vuota.');
      const rec = { id: uid(), name: file.name.replace(/\.xmind$/i, ''), sheets: sheets.map(s => { const sh = { title: s.title, root: slimTopic(s.root) }; if ((s.rels || []).length) sh.rels = s.rels; mapNormSheet(sh); return sh; }), created: Date.now() };
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
  async function newMap(fromMd = false) {
    const name = await modal({ title: fromMd ? 'Mappa dagli appunti' : 'Nuova mappa', text: fromMd ? 'Titoli ed elenchi degli appunti diventano i rami; i paragrafi diventano note dei nodi. Poi la sistemi come vuoi.' : 'Il nome è anche il nodo centrale.', input: true, value: sec.title, confirm: 'Crea' });
    if (!name) return;
    const root = fromMd ? mdToMapTree(sec.md, String(name).trim()) : { t: String(name).trim() };
    const rec = { id: uid(), name: String(name).trim(), sheets: [{ title: String(name).trim(), root }], created: Date.now(), edited: Date.now() };
    sec.maps = [...mapsOf(sec), rec];
    await saveSection(sec);
    S().mapLast = rec.id;
    Settings.save();
    mi = sec.maps.length - 1;
    si = 0;
    edit = !fromMd || mapCountNodes(root) < 2;
    quiz = false;
    undo = [];
    selNode = root;
    collapsed = new Set();
    draw();
    if (fromMd) toast(`Mappa creata con ${mapCountNodes(root) - 1} rami: tocca ✎ Modifica per sistemarla`);
    else focusSel();
  }

  body.addEventListener('change', e => {
    if (e.target.matches('[data-map-sel]')) { mi = +e.target.value; si = 0; collapsed = new Set(); shown.clear(); selNode = null; undo = []; S().mapLast = maps[mi].id; Settings.save(); draw(); }
    if (e.target.matches('[data-sheet-sel]')) { si = +e.target.value; collapsed = new Set(); shown.clear(); selNode = null; draw(); }
  });
  // scrivere sui nodi nell’elenco
  let textSnapFor = null;
  body.addEventListener('focusin', e => {
    const t = e.target.closest('.ml-t[contenteditable]');
    if (!t) return;
    const c = cur();
    const n = c && findNode(c.sheet, t.dataset.mkey);
    if (!n) return;
    if (connectFrom && edit && n !== connectFrom) { const from = connectFrom; t.blur(); addRel(from, n); return; }
    if (selNode !== n) { selNode = n; $$('.ml-row.sel', body).forEach(r => r.classList.remove('sel')); t.closest('.ml-row').classList.add('sel'); }
    textSnapFor = null;
  });
  body.addEventListener('input', e => {
    const t = e.target.closest('.ml-t[contenteditable]');
    if (!t) return;
    const c = cur();
    const n = c && findNode(c.sheet, t.dataset.mkey);
    if (!n) return;
    if (textSnapFor !== n) { snap(); textSnapFor = n; const u = $('[data-me="undo"]', body); if (u) u.disabled = false; }
    setNodeRich(n, t.innerHTML);
    touched();
  });
  body.addEventListener('paste', e => {
    if (!e.target.closest('.ml-t[contenteditable]')) return;
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') || '').replace(/\s+/g, ' '));
  });
  body.addEventListener('keydown', e => {
    if (e.key === 'Escape' && connectFrom) { connectFrom = null; draw(); return; }
    if (edit && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); op('undo'); return; }
    const t = e.target.closest('.ml-t[contenteditable]');
    if (t && edit) {
      if (e.key === 'Enter') { e.preventDefault(); op('sib'); return; }
      if (e.key === 'Tab') { e.preventDefault(); op(e.shiftKey ? 'out' : 'in'); return; }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); op(e.key === 'ArrowUp' ? 'up' : 'down'); return; }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !t.textContent.trim()) { e.preventDefault(); op('del'); return; }
      return;
    }
    const g = e.target.closest('[data-mkey]');
    if (g && edit && view === 'map') {
      const c = cur();
      selNode = c && findNode(c.sheet, g.dataset.mkey);
      if (e.key === 'Tab') { e.preventDefault(); op(e.shiftKey ? 'out' : 'child'); return; }
      if (e.key === 'Enter') { e.preventDefault(); op('sib'); return; }
      if (e.key === 'F2') { e.preventDefault(); op('rename'); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); op('del'); return; }
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-mkey]') && !edit) { e.preventDefault(); e.target.closest('[data-mkey]').dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
  body.addEventListener('dblclick', e => {
    if (!edit || view !== 'map') return;
    const g = e.target.closest('g.mn');
    const c = cur();
    const n = g && c && findNode(c.sheet, g.dataset.mkey);
    if (n) { selNode = n; rename(n); }
  });
  body.addEventListener('click', async e => {
    if (e.target.closest('[data-act="map-new"]')) { newMap(false); return; }
    if (e.target.closest('[data-act="map-from-md"]')) { newMap(true); return; }
    if (e.target.closest('[data-act="map-add"]')) { addMap(); return; }
    const m = maps[mi];
    if (!m) return;
    const sheet = m.sheets[si] || m.sheets[0];
    if (suppressClick) return;
    const v = e.target.closest('[data-view]');
    if (v) { view = v.dataset.view; if (inPanel) S().mapViewPanel = view; else S().mapView = view; Settings.save(); draw(); return; }
    if (e.target.closest('[data-act="map-edit"]')) {
      edit = !edit;
      quiz = false;
      shown.clear();
      if (edit && !selNode) selNode = sheet.root;
      if (!edit) { flushSave(); toast('Mappa salvata'); }
      draw();
      if (edit && view === 'list') focusSel();
      return;
    }
    const me = e.target.closest('[data-me]');
    if (me) { op(me.dataset.me); return; }
    if (e.target.closest('[data-act="map-quiz"]')) { quiz = !quiz; shown.clear(); rateFor = null; draw(); return; }
    const mpr = e.target.closest('[data-mpr]');
    if (mpr && rateFor) {
      const n = findNode(sheet, rateFor);
      const k = markKey(rateFor);
      mpMarks()[k] = mpr.dataset.mpr;
      const kids = (n?.c || []).map(x => x.t).join(', ');
      recordCzMark(sec, k, mpr.dataset.mpr, `${m.name}: ${n ? n.t : ''}`, kids ? `${n.t}: ${kids}` : (n ? n.t : ''), 'mpHist');
      saveSection(sec);
      rateFor = null;
      draw();
      return;
    }
    if (e.target.closest('[data-act="map-reveal"]')) {
      const all = (n, p) => { shown.add(keyOf(p)); (n.c || []).forEach((c, k) => all(c, [...p, k])); };
      all(sheet.root, [0]);
      draw();
      return;
    }
    const note = e.target.closest('[data-mnote]');
    if (note) {
      const n = findNode(sheet, note.dataset.mnote);
      if (n && edit) { selNode = n; op('note'); return; }
      if (n) { const sh = openSheet(`<h2>${esc(n.t)}</h2><div class="notes">${renderMd(n.n)}</div><div class="modal-actions"><button class="btn primary" type="button" data-x>Chiudi</button></div>`, { label: n.t }); $('[data-x]', sh.el).onclick = () => sh.close(); }
      return;
    }
    if (e.target.closest('[data-act="map-noconn"]')) { connectFrom = null; draw(); return; }
    const relEl = e.target.closest('[data-mrel]');
    if (relEl && edit) { await relMenu(sheet, relEl.dataset.mrel); return; }
    const sumEl = e.target.closest('[data-msum]');
    if (sumEl) {
      const [pk, i] = sumEl.dataset.msum.split('|');
      if (quiz) { const kk = `s:${pk}|${i}`; if (shown.has(kk)) shown.delete(kk); else shown.add(kk); draw(); return; }
      if (edit) await sumMenu(sheet, pk, +i);
      return;
    }
    const tg = e.target.closest('[data-mtoggle]');
    if (tg) { const n = findNode(sheet, tg.dataset.mtoggle); if (n) { if (collapsed.has(n)) collapsed.delete(n); else collapsed.add(n); draw(); } return; }
    const node = e.target.closest('[data-mkey]');
    if (node) {
      const k = node.dataset.mkey;
      const n = findNode(sheet, k);
      if (edit) {
        if (connectFrom && n && n !== connectFrom) { addRel(connectFrom, n); return; }
        if (view === 'map' && n) { selNode = n; $$('g.mn.sel', body).forEach(x => x.classList.remove('sel')); node.classList.add('sel'); }
        return;
      }
      if (quiz) {
        if (k === '0') return;
        if (shown.has(k)) { shown.delete(k); rateFor = null; } else { shown.add(k); rateFor = k; }
        draw();
        return;
      }
      if (view === 'map' && (n?.c || []).length) { if (collapsed.has(n)) collapsed.delete(n); else collapsed.add(n); draw(); }
      return;
    }
    if (e.target.closest('[data-act="map-more"]')) {
      const choice = await actionSheet(m.name, [
        { key: 'new', label: 'Crea una mappa nuova' },
        ...(String(sec.md || '').trim() ? [{ key: 'frommd', label: 'Crea una mappa dagli appunti' }] : []),
        { key: 'add', label: 'Carica un’altra mappa XMind' },
        { key: 'export', label: 'Scarica come file XMind' },
        { key: 'sheet', label: 'Aggiungi un foglio a questa mappa' },
        { key: 'cards', label: 'Crea flashcard da questa mappa' },
        { key: 'notes', label: 'Aggiungi la mappa agli appunti (elenco)' },
        { key: 'fold', label: collapsed.size ? 'Apri tutti i rami' : 'Chiudi i rami dal secondo livello' },
        { key: 'rename', label: 'Rinomina' },
        { key: 'delete', label: 'Elimina la mappa', danger: true }
      ]);
      const full = t => ({ title: t.t, notes: t.n || '', children: (t.c || []).map(full), floating: [] });
      if (choice === 'new') newMap(false);
      if (choice === 'frommd') newMap(true);
      if (choice === 'add') addMap();
      if (choice === 'export') {
        try { flushSave(); await exportXmind(m); toast('File XMind pronto: lo apri con XMind'); }
        catch (err) { toast(err.message || 'Non riesco a creare il file', 'err'); }
      }
      if (choice === 'sheet') {
        const t = await modal({ title: 'Nuovo foglio', text: 'Un’altra mappa nello stesso file, come i fogli di XMind.', input: true, value: '', placeholder: 'Nome del foglio', confirm: 'Crea' });
        if (t) { m.sheets.push({ title: String(t).trim(), root: { t: String(t).trim() } }); si = m.sheets.length - 1; edit = true; selNode = m.sheets[si].root; collapsed = new Set(); touched(); draw(); focusSel(); }
      }
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
        if (collapsed.size) collapsed = new Set();
        else (sheet.root.c || []).forEach(c => { if ((c.c || []).length) collapsed.add(c); });
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
  const flushSave = () => { if (saveT) { clearTimeout(saveT); saveT = 0; saveSection(sec); } };
  // al computer: trascina del testo (dal PDF o da altrove) su un nodo
  body.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('text/plain')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  body.addEventListener('drop', e => {
    const t = e.dataTransfer && e.dataTransfer.getData('text/plain');
    if (!t || !t.trim()) return;
    e.preventDefault();
    const c = cur();
    const k = e.target.closest && e.target.closest('[data-mkey]');
    if (c && k) { const n = findNode(c.sheet, k.dataset.mkey); if (n) { selNode = n; edit = true; } }
    const r = MapTarget.get()?.add(t.replace(/\s+/g, ' ').trim());
    if (r) toast(`Nuovo nodo sotto “${String(r.parent).slice(0, 40)}”`);
  });
  draw();
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



/* =====================================================================
   v3.35: dai segnalibri di un PDF alle sezioni del notebook
   Un segnalibro diventa un intervallo di pagine (fino al segnalibro dopo)
   collegato a una sezione: dalla sezione apri il PDF proprio lì.
   Il collegamento sta nella sezione (sec.pdfRefs), così si sincronizza con lei.
   ===================================================================== */
const pdfRefsOf = sec => (Array.isArray(sec.pdfRefs) ? sec.pdfRefs : []).filter(r => pdfById(r.pdfId));
const refsOfBookmark = (pdfId, bmId) => state.sections.filter(s => (s.pdfRefs || []).some(r => r.pdfId === pdfId && r.bmId === bmId));
// pagine di un segnalibro: dalla sua fino a quella prima del segnalibro dopo
function bmRange(meta, b) {
  const next = (meta.bookmarks || []).filter(x => x.page > b.page).sort((x, y) => x.page - y.page)[0];
  return { from: b.page, to: next ? Math.max(b.page, next.page - 1) : (meta.pages || b.page) };
}
const pagesTxt = (a, b) => (a === b ? `p. ${a}` : `pp. ${a}–${b}`);
async function addPdfRef(sec, ref) {
  const list = Array.isArray(sec.pdfRefs) ? sec.pdfRefs : (sec.pdfRefs = []);
  const ex = list.find(r => r.pdfId === ref.pdfId && (ref.bmId ? r.bmId === ref.bmId : r.from === ref.from && r.to === ref.to));
  if (ex) Object.assign(ex, ref); else list.push({ id: uid(), ...ref });
  list.sort((a, b) => (a.pdfId === b.pdfId ? a.from - b.from : 0));
  await saveSection(sec);
}
// una sezione nuova, nel notebook e nel macro-argomento scelti
async function newSectionForRef(nbId, groupId, title) {
  const s = newSection(nbId, { groupId: groupId || null, title: title || 'Senza titolo', md: '' });
  s.order = secsOf(nbId).length;
  await saveSection(s);
  return s;
}
const guessSection = (title, nbId) => {
  const f = foldAccents(title || '').trim();
  if (!f) return null;
  const pool = state.sections.filter(s => !nbId || s.notebookId === nbId);
  return pool.find(s => foldAccents(s.title).trim() === f) || pool.find(s => { const t = foldAccents(s.title).trim(); return t.length > 3 && (f.includes(t) || t.includes(f)); }) || null;
};

// Collegare un segnalibro: pagine, poi una sezione che c’è già o una nuova
function pdfBmLinkSheet(meta, b) {
  return new Promise(resolve => {
    const rg = bmRange(meta, b);
    const guess = guessSection(b.title, meta.notebookId);
    const nb = nbById(meta.notebookId) || state.notebooks.find(n => !n.kind) || state.notebooks[0];
    const where = s => [nbById(s.notebookId)?.name, groupPathText(s)].filter(Boolean).join(' › ');
    const all = state.sections.slice().sort((x, y) => (x.notebookId === meta.notebookId ? 0 : 1) - (y.notebookId === meta.notebookId ? 0 : 1) || x.title.localeCompare(y.title, 'it'));
    let pick = guess;
    const sh = openSheet(`
      <h2>Collega “${esc(b.title)}”</h2>
      <p class="sheet-sub">Dalla sezione aprirai il PDF proprio su queste pagine.</p>
      <div class="grid2">
        <label class="field"><span>Dalla pagina</span><input class="input" type="number" id="blFrom" min="1" max="${meta.pages || 9999}" value="${rg.from}" inputmode="numeric"></label>
        <label class="field"><span>Alla pagina</span><input class="input" type="number" id="blTo" min="1" max="${meta.pages || 9999}" value="${rg.to}" inputmode="numeric"></label>
      </div>
      <div class="seg" role="tablist" aria-label="Quale sezione">
        <button type="button" role="tab" data-blm="old" aria-selected="true">Sezione che c’è già</button>
        <button type="button" role="tab" data-blm="new" aria-selected="false">Nuova sezione</button>
      </div>
      <div id="blOld">
        <p class="hint" id="blPicked">${pick ? `Scelta: <strong>${esc(pick.title)}</strong> (${esc(where(pick))})` : 'Cerca e tocca la sezione.'}</p>
        <input type="search" class="input search" id="blQ" placeholder="Cerca una sezione" aria-label="Cerca una sezione" value="">
        <ul class="list pick-list bl-list" id="blList"></ul>
      </div>
      <div id="blNew" hidden>
        <label class="field"><span>Titolo</span><input class="input" id="blTitle" value="${esc(b.title)}"></label>
        <label class="field"><span>Notebook</span><select class="input" id="blNb">${state.notebooks.filter(n => !n.kind).map(n => `<option value="${n.id}" ${nb && n.id === nb.id ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Cartella</span><select class="input" id="blGroup"></select></label>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-bl="no">Annulla</button>
        <button class="btn primary" type="button" data-bl="ok">Collega</button>
      </div>`, { label: 'Collega a una sezione', onClose: v => resolve(v || null) });
    let mode = 'old';
    const list = $('#blList', sh.el);
    const draw = q => {
      const hits = all.filter(s => matchTokens(`${s.title} ${where(s)}`, q)).slice(0, 60);
      list.innerHTML = hits.map(s => `<li><button type="button" class="row ${pick && pick.id === s.id ? 'on' : ''}" data-blpick="${s.id}"><span class="row-main"><span class="row-title">${esc(s.title)}</span><span class="row-sub">${esc(where(s))}</span></span></button></li>`).join('') || '<li class="row muted">Nessuna sezione trovata.</li>';
    };
    draw(pick ? pick.title : '');
    if (pick) $('#blQ', sh.el).value = pick.title;
    $('#blQ', sh.el).addEventListener('input', e => draw(e.target.value));
    list.addEventListener('click', e => {
      const x = e.target.closest('[data-blpick]');
      if (!x) return;
      pick = secById(x.dataset.blpick);
      $('#blPicked', sh.el).innerHTML = `Scelta: <strong>${esc(pick.title)}</strong> (${esc(where(pick))})`;
      $$('[data-blpick]', list).forEach(r => r.classList.toggle('on', r === x));
    });
    const fillGroups = () => {
      const n = nbById($('#blNb', sh.el)?.value);
      const g = $('#blGroup', sh.el);
      if (g) g.innerHTML = n ? groupOptions(n, '') : '<option value="">Nessuno</option>';
    };
    if ($('#blNb', sh.el)) { fillGroups(); $('#blNb', sh.el).addEventListener('change', fillGroups); }
    $$('[data-blm]', sh.el).forEach(t => t.addEventListener('click', () => {
      mode = t.dataset.blm;
      $$('[data-blm]', sh.el).forEach(x => x.setAttribute('aria-selected', String(x === t)));
      $('#blOld', sh.el).hidden = mode !== 'old';
      $('#blNew', sh.el).hidden = mode !== 'new';
    }));
    if (!guess && !state.sections.length) $('[data-blm="new"]', sh.el).click();
    $('[data-bl="no"]', sh.el).onclick = () => sh.close(null);
    $('[data-bl="ok"]', sh.el).onclick = async () => {
      let from = parseInt($('#blFrom', sh.el).value, 10) || rg.from;
      let to = parseInt($('#blTo', sh.el).value, 10) || from;
      if (to < from) [from, to] = [to, from];
      let sec = pick;
      if (mode === 'new') {
        const nbId = $('#blNb', sh.el)?.value;
        if (!nbId) { toast('Crea prima un notebook'); return; }
        const gv = $('#blGroup', sh.el).value;
        sec = await newSectionForRef(nbId, gv && gv !== '__new' ? gv : null, $('#blTitle', sh.el).value.trim() || b.title);
      }
      if (!sec) { toast('Scegli la sezione da collegare'); return; }
      await addPdfRef(sec, { pdfId: meta.id, bmId: b.id, from, to, title: b.title });
      sh.close(sec);
    };
  });
}

// Tutti i segnalibri insieme: per ognuno una sezione proposta (stesso nome) o una nuova
function pdfBmBulkSheet(meta) {
  return new Promise(resolve => {
    const bms = (meta.bookmarks || []).slice().sort((a, b) => a.page - b.page);
    const nbs = state.notebooks.filter(n => !n.kind);
    let nbId = nbById(meta.notebookId) && !nbById(meta.notebookId).kind ? meta.notebookId : nbs[0]?.id;
    const sh = openSheet(`
      <h2>Collega i segnalibri alle sezioni</h2>
      <p class="sheet-sub">Ogni segnalibro prende le pagine fino al segnalibro dopo. Ti propongo la sezione con lo stesso nome; “Nuova sezione” la crea con il titolo del segnalibro.</p>
      <div class="grid2">
        <label class="field"><span>Notebook</span><select class="input" id="bbNb">${nbs.map(n => `<option value="${n.id}" ${n.id === nbId ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Cartella delle nuove sezioni</span><select class="input" id="bbGroup"></select></label>
      </div>
      <div class="inline"><button class="btn sm ghost" type="button" data-bb2="allnew">Nuove sezioni per quelli senza</button><button class="btn sm ghost" type="button" data-bb2="none">Nessuna per tutti</button></div>
      <div class="bb-rows" id="bbRows"></div>
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-bb2="no">Annulla</button>
        <button class="btn primary" type="button" data-bb2="ok">Collega</button>
      </div>`, { label: 'Collega i segnalibri', onClose: v => resolve(v || 0) });
    const rows = $('#bbRows', sh.el);
    let secs = [];
    const labelForVal = (bm, v) => {
      if (!v) return 'Nessuna';
      if (v === '__new') return `＋ Nuova sezione “${bm.title.slice(0, 40)}”`;
      const s = secById(v);
      return s ? `${s.title}${groupPathText(s) ? ` · ${groupPathText(s)}` : ''}` : 'Nessuna';
    };
    const setRowVal = (row, v) => {
      const bm = bms.find(x => x.id === row.dataset.bm);
      row.dataset.val = v;
      const btn = $('.bb-pick-btn', row);
      if (btn && bm) {
        btn.textContent = labelForVal(bm, v);
        btn.classList.toggle('is-empty', !v);
      }
    };
    const closePop = () => { $$('.bb-pick-pop', rows).forEach(p => { p.hidden = true; }); };
    const fillPop = (row, q = '') => {
      const bm = bms.find(x => x.id === row.dataset.bm);
      const list = $('.bb-pick-list', row);
      if (!list || !bm) return;
      const cur = row.dataset.val || '';
      const hits = secs.filter(s => matchTokens(`${s.title} ${groupPathText(s)}`, q)).slice(0, 40);
      const specials = !q.trim() ? [
        `<li><button type="button" class="row ${cur === '' ? 'on' : ''}" data-bbpick=""><span class="row-main"><span class="row-title">Nessuna</span></span></button></li>`,
        `<li><button type="button" class="row ${cur === '__new' ? 'on' : ''}" data-bbpick="__new"><span class="row-main"><span class="row-title">＋ Nuova sezione “${esc(bm.title.slice(0, 40))}”</span></span></button></li>`
      ] : [];
      list.innerHTML = specials.join('') + (hits.map(s => `<li><button type="button" class="row ${cur === s.id ? 'on' : ''}" data-bbpick="${s.id}"><span class="row-main"><span class="row-title">${esc(s.title)}</span>${groupPathText(s) ? `<span class="row-sub">${esc(groupPathText(s))}</span>` : ''}</span></button></li>`).join('') || (!specials.length ? '<li class="hint">Nessuna sezione trovata.</li>' : ''));
    };
    const draw = () => {
      secs = state.sections.filter(s => s.notebookId === nbId).sort((a, b) => a.title.localeCompare(b.title, 'it'));
      rows.innerHTML = bms.map(b => {
        const rg = bmRange(meta, b);
        const linked = refsOfBookmark(meta.id, b.id).find(s => s.notebookId === nbId);
        const sel = linked || guessSection(b.title, nbId);
        const val = sel ? sel.id : '';
        return `<div class="bb-row" data-bm="${b.id}" data-val="${esc(val)}">
          <div class="bb-t"><strong>${esc(b.title)}</strong><span class="muted-inline">${pagesTxt(rg.from, rg.to)}</span></div>
          <div class="bb-pick">
            <button type="button" class="input bb-pick-btn ${val ? '' : 'is-empty'}" data-bbopen aria-label="Scegli la sezione per ${esc(b.title)}">${esc(labelForVal(b, val))}</button>
            <div class="bb-pick-pop" hidden>
              <input type="search" class="input bb-pick-q" placeholder="Cerca sezione per titolo o cartella…" aria-label="Cerca sezione">
              <ul class="list pick-list bb-pick-list"></ul>
            </div>
          </div>
        </div>`;
      }).join('');
      const g = $('#bbGroup', sh.el);
      const n = nbById(nbId);
      g.innerHTML = n ? groupOptions(n, '') : '<option value="">Nessuno</option>';
    };
    draw();
    $('#bbNb', sh.el).addEventListener('change', e => { nbId = e.target.value; draw(); });
    rows.addEventListener('input', e => {
      const inp = e.target.closest('.bb-pick-q');
      if (inp) fillPop(inp.closest('.bb-row'), inp.value);
    });
    rows.addEventListener('click', e => {
      const pickBtn = e.target.closest('[data-bbpick]');
      if (pickBtn) {
        const row = pickBtn.closest('.bb-row');
        setRowVal(row, pickBtn.dataset.bbpick);
        closePop();
        return;
      }
      const openBtn = e.target.closest('[data-bbopen]');
      if (openBtn) {
        const row = openBtn.closest('.bb-row');
        const pop = $('.bb-pick-pop', row);
        const wasOpen = !pop.hidden;
        closePop();
        if (!wasOpen) {
          pop.hidden = false;
          const inp = $('.bb-pick-q', pop);
          inp.value = '';
          fillPop(row, '');
          setTimeout(() => inp.focus(), 20);
        }
      }
    });
    sh.el.addEventListener('click', async e => {
      if (!e.target.closest('.bb-pick')) closePop();
      const b = e.target.closest('[data-bb2]');
      if (!b) return;
      const k = b.dataset.bb2;
      if (k === 'no') { sh.close(0); return; }
      if (k === 'allnew') { $$('.bb-row', rows).forEach(row => { if (!row.dataset.val) setRowVal(row, '__new'); }); closePop(); return; }
      if (k === 'none') { $$('.bb-row', rows).forEach(row => setRowVal(row, '')); closePop(); return; }
      if (k === 'ok') {
        b.disabled = true;
        const gv = $('#bbGroup', sh.el).value;
        const groupId = gv && gv !== '__new' ? gv : null;
        let n = 0;
        for (const row of $$('.bb-row', rows)) {
          const v = row.dataset.val || '';
          if (!v) continue;
          const bm = bms.find(x => x.id === row.dataset.bm);
          const rg = bmRange(meta, bm);
          const sec = v === '__new' ? await newSectionForRef(nbId, groupId, bm.title) : secById(v);
          if (!sec) continue;
          await addPdfRef(sec, { pdfId: meta.id, bmId: bm.id, from: rg.from, to: rg.to, title: bm.title });
          n++;
        }
        sh.close(n);
      }
    });
  });
}

// Nella sezione (in Leggi): le pagine di PDF collegate
function pdfRefsBlockHtml(sec) {
  const refs = pdfRefsOf(sec);
  if (!refs.length) return '';
  return `
    <section class="fonti pdf-refs" aria-label="Pagine di PDF collegate">
      <div class="fonti-head"><h3>Pagine di PDF</h3></div>
      <ul class="pr-list">${refs.map(r => {
        const p = pdfById(r.pdfId);
        return `<li>
          <a class="pr-open" href="#/pdf/${p.id}/${r.from}" data-pr-ref="${r.id}">
            <span class="pr-t">${esc(r.title || p.name)}</span>
            <span class="pr-s">${esc(p.name)} · ${pagesTxt(r.from, r.to)}</span>
          </a>
          <button class="btn sm ghost" type="button" data-split-open="pdf:${p.id}:${r.from}" aria-label="Apri di fianco ${esc(r.title || p.name)}" title="Apri di fianco">⇆</button>
          <button class="btn sm ghost" type="button" data-pr-del="${r.id}" aria-label="Scollega ${esc(r.title || p.name)}" title="Scollega">✕</button>
        </li>`;
      }).join('')}</ul>
    </section>`;
}
function bindPdfRefsBlock(root, sec) {
  $$('[data-pr-del]', root).forEach(b => b.addEventListener('click', async () => {
    const r = (sec.pdfRefs || []).find(x => x.id === b.dataset.prDel);
    if (!r) return;
    sec.pdfRefs = sec.pdfRefs.filter(x => x !== r);
    await saveSection(sec);
    toast('Pagine scollegate', '', { label: 'Annulla', fn: async () => { sec.pdfRefs = [...(sec.pdfRefs || []), r]; await saveSection(sec); route(); } });
    route();
  }));
  $$('[data-pr-ref]', root).forEach(a => a.addEventListener('click', () => {
    const r = (sec.pdfRefs || []).find(x => x.id === a.dataset.prRef);
    if (r) PdfRefHint.set({ pdfId: r.pdfId, from: r.from, to: r.to, title: sec.title });
  }));
}
// aprendo un PDF da una sezione, un avviso ricorda quali pagine sono di quella sezione
const PdfRefHint = {
  cur: null,
  set(x) { this.cur = { ...x, t: Date.now() }; },
  take(pdfId) { const c = this.cur; this.cur = null; return c && c.pdfId === pdfId && Date.now() - c.t < 15000 ? c : null; }
};

/* =====================================================================
   v3.50: Audio nelle sezioni
   Carichi un file o registri la lezione; il lettore resta in basso mentre
   cambi scheda (Leggi, Modifica…), così scrivi ascoltando. Segnalibri con
   nome e minuto; “⏱ 12:34” nel testo porta a quel punto dell’audio.
   I file audio restano sul dispositivo (archivio a parte); nella sezione,
   che si sincronizza, ci sono nome, durata e segnalibri.
   ===================================================================== */
const AudioDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('nb-audio', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('files')) r.result.createObjectStore('files'); };
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) { const db = await this.open(); return new Promise(res => { const q = db.transaction('files').objectStore('files').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); },
  async put(k, v) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(v, k); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error || new Error('Spazio non sufficiente per salvare l’audio')); }); },
  async del(k) { const db = await this.open(); return new Promise(res => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(k); tx.oncomplete = () => res(true); tx.onerror = () => res(false); }); },
  async keys() { const db = await this.open(); return new Promise(res => { const q = db.transaction('files').objectStore('files').getAllKeys(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); }
};
const audiosOf = sec => (Array.isArray(sec.audios) ? sec.audios : (sec.audios = []));
/* v3.90: il punto di ascolto non sta più dentro la sezione o il notebook. Prima, mentre
   ascoltavi, l’app riscriveva tutta la sezione (o il notebook) ogni 15 secondi e la
   risincronizzava: se nel frattempo la modificavi da un altro dispositivo, la copia vecchia
   del telefono poteva sovrascrivere le modifiche nuove. Ora il punto si salva sul dispositivo
   e, quando metti in pausa o chiudi il lettore, in un piccolo elenco a parte che si sincronizza. */
const AudioPos = {
  KEY: 'nb-audio-pos',
  mem: null,
  load() { if (!this.mem) { try { this.mem = JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch { this.mem = {}; } } return this.mem; },
  rec() { return state.links.find(l => l.kind === 'audiopos') || null; },
  get(a) {
    if (!a) return 0;
    const l = this.load()[a.id], r = this.rec()?.map?.[a.id];
    const best = l && r ? ((r.t || 0) > (l.t || 0) ? r : l) : (l || r);
    return best ? best.p || 0 : (a.pos || 0);
  },
  set(id, p) {
    const m = this.load();
    m[id] = { p: Math.max(0, Math.floor(p)), t: Date.now() };
    const ids = Object.keys(m);
    if (ids.length > 400) ids.sort((x, y) => m[x].t - m[y].t).slice(0, ids.length - 400).forEach(k => delete m[k]);
    try { localStorage.setItem(this.KEY, JSON.stringify(m)); } catch { /* spazio pieno */ }
  },
  flushT: 0,
  flushSoon() { clearTimeout(this.flushT); this.flushT = setTimeout(() => this.flush().catch(() => {}), 2500); },
  async flush() {
    const m = this.load();
    const live = new Set([...state.sections, ...state.notebooks].flatMap(o => (o.audios || []).map(a => a.id)));
    let rec = this.rec();
    let changed = false;
    if (!rec) rec = { id: 'audiopos', kind: 'audiopos', notebookId: '_audiopos', map: {}, created: Date.now() };
    if (!rec.map || typeof rec.map !== 'object') rec.map = {};
    Object.keys(m).forEach(id => {
      if (!live.has(id)) return;
      const o = rec.map[id];
      if (!o || (o.t || 0) < m[id].t) { if (!o || Math.abs((o.p || 0) - m[id].p) >= 5) changed = true; rec.map[id] = m[id]; }
    });
    Object.keys(rec.map).forEach(id => { if (!live.has(id)) { delete rec.map[id]; changed = true; } });
    if (changed) await saveLink(rec);
  }
};
/* v3.87: ordine degli audio (lezioni del notebook o audio di una sezione), si sincronizza:
   per nome con i numeri in ordine (Lezione 2 prima di Lezione 10), per data, o a mano */
const AUDIO_SORTS = [['name', 'Per nome (1, 2, 3…)'], ['new', 'Le più recenti prima'], ['old', 'Le meno recenti prima'], ['custom', 'A mano (con ↑ ↓)']];
const audioNameCmp = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'it', { numeric: true, sensitivity: 'base' });
function audioOrder(owner) {
  const list = audiosOf(owner).slice();
  const mode = owner.audioSort || 'name';
  if (mode === 'new') return list.sort((a, b) => (b.created || 0) - (a.created || 0) || audioNameCmp(a, b));
  if (mode === 'old') return list.sort((a, b) => (a.created || 0) - (b.created || 0) || audioNameCmp(a, b));
  if (mode === 'custom') return list.sort((a, b) => (a.ord ?? 1e9) - (b.ord ?? 1e9) || audioNameCmp(a, b));
  return list.sort(audioNameCmp);
}
const audioSortHtml = owner => (audiosOf(owner).length > 1 ? `<label class="au-sort"><span>Ordine</span><select class="input" data-au-sort aria-label="Ordine degli audio">${AUDIO_SORTS.map(([k, l]) => `<option value="${k}" ${(owner.audioSort || 'name') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : '');
const audioMoveBtns = (owner, a) => ((owner.audioSort || 'name') === 'custom' ? `<span class="au-move"><button type="button" class="btn sm ghost" data-au-mv="-1" aria-label="Sposta su ${esc(a.name)}" title="Su">↑</button><button type="button" class="btn sm ghost" data-au-mv="1" aria-label="Sposta giù ${esc(a.name)}" title="Giù">↓</button></span>` : '');
async function setAudioSort(owner, mode) {
  // passando a “a mano” si parte dall’ordine che vedi adesso
  if (mode === 'custom') audioOrder(owner).forEach((a, i) => { a.ord = i; });
  owner.audioSort = mode;
  await saveOwner(owner);
}
async function moveAudio(owner, aId, dir) {
  const list = audioOrder(owner);
  const i = list.findIndex(a => a.id === aId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((a, k) => { a.ord = k; });
  await saveOwner(owner);
  return true;
}
// selettore dell’ordine e frecce ↑ ↓, per la pagina Lezioni e la scheda Audio
function bindAudioOrder(root, owner) {
  root.addEventListener('change', async e => {
    const sel = e.target.closest('[data-au-sort]');
    if (!sel) return;
    await setAudioSort(owner, sel.value);
    AudioMode.refresh();
  });
  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-au-mv]');
    if (!b) return;
    e.stopPropagation();
    const it = b.closest('.au-item');
    if (it && await moveAudio(owner, it.dataset.aid, +b.dataset.auMv)) {
      AudioMode.refresh();
      // la lezione spostata resta sotto il dito
      requestAnimationFrame(() => document.querySelector(`.au-item[data-aid="${it.dataset.aid}"] [data-au-mv="${b.dataset.auMv}"]`)?.focus({ preventScroll: false }));
    }
  }, true);
}
// v3.76: gli audio stanno in una sezione o nel notebook (le lezioni, che parlano di più argomenti)
const isSecRec = o => !!o && typeof o.md === 'string';
const audioOwner = (k, id) => (k === 'nb' ? nbById(id) : secById(id));
const ownerTitle = o => (isSecRec(o) ? o.title : `Lezioni · ${o.name}`);
const saveOwner = o => (isSecRec(o) ? saveSection(o) : saveNotebook(o));
// le lezioni di un notebook hanno nomi diversi: “⏱ 12:34 (nome)” deve ritrovare quella giusta
function uniqueLessonName(nb, name, selfId = '') {
  const base = String(name || 'Lezione').replace(/[()]/g, '').trim() || 'Lezione';
  const taken = new Set((nb.audios || []).filter(a => a.id !== selfId).map(a => foldAccents(a.name).trim()));
  if (!taken.has(foldAccents(base))) return base;
  let k = 2;
  while (taken.has(foldAccents(`${base} ${k}`))) k++;
  return `${base} ${k}`;
}
// i punti delle lezioni che parlano di una sezione: lezioni intere collegate e segnalibri collegati
function lessonRefsOf(sec) {
  const nb = nbById(sec.notebookId);
  if (!nb || !Array.isArray(nb.audios)) return [];
  return audioOrder(nb).map(a => ({ a, whole: (a.secIds || []).includes(sec.id), marks: (a.marks || []).filter(m => (m.secIds || []).includes(sec.id)) })).filter(x => x.whole || x.marks.length);
}
function lessonBlockHtml(sec) {
  const refs = lessonRefsOf(sec);
  if (!refs.length) return '';
  return `<section class="fonti lz-sec" aria-label="Nelle lezioni">
    <div class="fonti-head"><h3>Nelle lezioni</h3><a class="btn sm ghost" href="#/lezioni/${sec.notebookId}">Tutte le lezioni</a></div>
    <ul class="lz-refs">${refs.map(r => `<li><b>${esc(r.a.name)}</b>${r.whole ? ' <small>(tutta la lezione)</small>' : ''}
      <span class="lz-pts">${r.whole && !r.marks.length ? `<button type="button" class="btn sm" data-lz="${r.a.id}:${AudioPos.get(r.a)}">▶ Ascolta</button>` : ''}${r.marks.map(m => `<button type="button" class="btn sm" data-lz="${r.a.id}:${m.t}">▶ ${fmtT(m.t)}${m.label ? ` ${esc(m.label)}` : ''}</button>`).join('')}</span></li>`).join('')}</ul>
  </section>`;
}
function bindLessonBlock(root, sec) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-lz]');
    if (!b) return;
    const [aid, t] = b.dataset.lz.split(':');
    const nb = nbById(sec.notebookId);
    if (nb) AudioPlayer.load(nb, aid, { at: +t || 0 });
  });
}
const fmtT = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const parseT = str => { const p = String(str).split(':').map(Number); return p.some(Number.isNaN) ? null : p.reduce((a, x) => a * 60 + x, 0); };
async function audioDuration(blob) {
  return new Promise(res => {
    const a = new Audio();
    const url = URL.createObjectURL(blob);
    const done = v => { URL.revokeObjectURL(url); res(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      // alcune registrazioni webm non dicono la durata finché non le si scorre fino in fondo
      if (Number.isFinite(a.duration)) return done(a.duration);
      a.currentTime = 1e7;
      a.ontimeupdate = () => { a.ontimeupdate = null; done(Number.isFinite(a.duration) ? a.duration : 0); };
    };
    a.onerror = () => done(0);
    a.src = url;
  });
}
async function addAudioFile(sec, file, extra = {}) { // sec: una sezione o un notebook
  if (!file || !(file.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|opus|webm|flac)$/i.test(file.name))) { toast('Questo file non sembra un audio', 'err'); return null; }
  const id = uid();
  try { await AudioDB.put(id, file); } catch (err) { toast(err.message || 'Non riesco a salvare l’audio', 'err'); return null; }
  const rec = { id, name: extra.name || file.name.replace(/\.[^.]+$/, ''), size: file.size, type: file.type, duration: await audioDuration(file), marks: extra.marks || [], created: Date.now() };
  if (!isSecRec(sec)) { rec.secIds = extra.secIds || []; rec.name = uniqueLessonName(sec, rec.name); }
  audiosOf(sec).push(rec);
  await saveOwner(sec);
  return rec;
}
// tolgo dall’archivio i file audio che nessuna sezione usa più
async function pruneAudio() {
  try {
    const used = new Set([...state.sections, ...state.notebooks].flatMap(s => (s.audios || []).map(a => a.id)));
    if (AudioRec.active) used.add(AudioRec.id);
    for (const k of await AudioDB.keys()) if (!used.has(k)) await AudioDB.del(k);
  } catch { /* niente */ }
}

/* =====================================================================
   v3.86: lezioni audio su Google Drive (tramite lo script, versione 3)
   - “Da Google Drive”: apri le cartelle del tuo Drive e aggiungi gli audio
     che ci trovi; il file si scarica sul dispositivo quando lo ascolti
   - “Carica su Drive”: una lezione registrata o caricata qui finisce su
     Drive, così gli altri dispositivi la scaricano
   Nome, segnalibri e collegamenti viaggiano già con la sincronizzazione;
   nella lezione resta { drive: { id, name, size } }.
   ===================================================================== */
const AUDIO_UP_CHUNK = 3 * 1024 * 1024; // multiplo di 256 KB, come vuole Drive
const AUDIO_RE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|webm|flac|mp4|3gp|amr|wma)$/i;
const audioMimeOf = name => ({ mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac', '3gp': 'audio/3gpp', amr: 'audio/amr', wma: 'audio/x-ms-wma' })[String(name || '').split('.').pop().toLowerCase()] || '';
const DriveAudio = {
  token: '', tokenExp: 0, jobs: {},
  ready() { return Sync.configured(); },
  async call(body) {
    if (navigator.onLine === false) throw new Error('Sei offline: per Drive serve la connessione');
    try { return await Sync.post({ secret: S().syncSecret.trim(), ...body }); }
    catch (e) {
      if (/Azione sconosciuta/i.test(e.message || '')) throw new Error('Per le lezioni su Drive aggiorna lo script della sincronizzazione alla versione 3 (il file sync-notebook.gs nuovo) e autorizzalo di nuovo: le istruzioni sono in cima allo script.');
      throw e;
    }
  },
  list(folder) { return this.call({ action: 'drive-list', folder: folder || 'root' }); },
  async getToken() {
    if (this.token && Date.now() < this.tokenExp) return this.token;
    const r = await this.call({ action: 'drive-token' });
    this.token = r.token || '';
    this.tokenExp = Math.min(+r.expires || 0, Date.now() + 40 * 60 * 1000);
    return this.token;
  },
  busy(id) { return this.jobs[id] || null; },
  paint(id) {
    const j = this.jobs[id];
    $$(`[data-drv="${id}"]`).forEach(el => { el.textContent = j ? `${j.kind === 'up' ? 'Carico su Drive' : 'Scarico da Drive'}… ${Math.round(j.p * 100)}%` : ''; el.hidden = !j; });
    window.dispatchEvent(new CustomEvent('nb-drive-job', { detail: { id, job: j } }));
  },
  // scarica il file di una lezione e lo tiene sul dispositivo
  download(rec) {
    if (this.jobs[rec.id]) return this.jobs[rec.id].promise;
    const job = { kind: 'down', p: 0 };
    this.jobs[rec.id] = job;
    const onP = p => { job.p = p; this.paint(rec.id); };
    job.promise = (async () => {
      try {
        let blob;
        try { blob = await this.direct(rec, onP); } catch { blob = await this.viaScript(rec, onP); }
        const type = blob.type && blob.type !== 'application/octet-stream' ? blob.type : (rec.type || audioMimeOf(rec.drive.name) || 'audio/mpeg');
        const file = new File([blob], rec.drive.name || `${rec.name}.m4a`, { type });
        await AudioDB.put(rec.id, file);
        return file;
      } finally {
        delete this.jobs[rec.id];
        this.paint(rec.id);
      }
    })();
    this.paint(rec.id);
    return job.promise;
  },
  // diretto da Drive con l’accesso temporaneo dello script: veloce, a flusso
  async direct(rec, onP) {
    const tk = await this.getToken();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rec.drive.id)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${tk}` } });
    if (!res.ok) { if (res.status === 401) this.token = ''; throw new Error(`Drive ${res.status}`); }
    const total = +res.headers.get('content-length') || rec.drive.size || 0;
    if (!res.body || !res.body.getReader) return res.blob();
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      if (total) onP(Math.min(0.99, got / total));
    }
    return new Blob(parts, { type: res.headers.get('content-type') || '' });
  },
  // a pezzi da 3 MB tramite lo script (più lento, ma va sempre)
  async viaScript(rec, onP) {
    const parts = [];
    let total = 1, mime = '';
    for (let i = 0; i < total; i++) {
      const r = await this.call({ action: 'drive-part', id: rec.drive.id, part: i });
      total = r.total || 1;
      mime = r.mime || mime;
      parts.push(base64ToBlob(r.data, 'application/octet-stream'));
      onP((i + 1) / total);
    }
    return new Blob(parts, { type: mime });
  },
  // carica su Drive il file di questo dispositivo, in un unico file audio
  upload(owner, rec) {
    if (this.jobs[rec.id]) return this.jobs[rec.id].promise;
    const job = { kind: 'up', p: 0 };
    this.jobs[rec.id] = job;
    job.promise = (async () => {
      try {
        const file = await AudioDB.get(rec.id);
        if (!file) throw new Error('Il file di questa lezione non è su questo dispositivo');
        const nb = isSecRec(owner) ? nbById(owner.notebookId) : owner;
        const ext = (String(file.name || '').match(/\.([a-z0-9]{2,5})$/i) || [, /mp4/.test(file.type) ? 'm4a' : /mpeg/.test(file.type) ? 'mp3' : 'webm'])[1];
        const name = `${String(rec.name).replace(/[\\/:*?"<>|]/g, '-')}.${ext}`;
        const mime = file.type || audioMimeOf(name) || 'application/octet-stream';
        const st = await this.call({ action: 'drive-up-start', folder: nb?.lessonFolder?.id || '', sub: nb?.lessonFolder ? '' : (nb?.name || ''), name, mime, size: file.size });
        let at = 0, out = null;
        while (at < file.size) {
          const data = await blobToBase64(file.slice(at, at + AUDIO_UP_CHUNK));
          const r = await this.call({ action: 'drive-up-part', session: st.session, start: at, size: file.size, mime, data });
          if (r.done) { out = r; break; }
          at = r.next > at ? r.next : at + AUDIO_UP_CHUNK;
          job.p = Math.min(0.99, at / file.size);
          this.paint(rec.id);
        }
        if (!out || !out.fileId) throw new Error('Drive non ha confermato il caricamento: riprova');
        // il proprietario può essere cambiato nel frattempo (sincronizzazione): riprendo quello di adesso
        const cur = audioOwner(isSecRec(owner) ? 'sec' : 'nb', owner.id) || owner;
        const r2 = audiosOf(cur).find(a => a.id === rec.id) || rec;
        r2.drive = { id: out.fileId, name: out.name || name, size: file.size, folder: st.folderName || '' };
        await saveOwner(cur);
        return r2.drive;
      } finally {
        delete this.jobs[rec.id];
        this.paint(rec.id);
      }
    })();
    this.paint(rec.id);
    return job.promise;
  }
};
// lo stato del file di un audio, per la riga dell’elenco
function audioWhereText(a, local) {
  if (DriveAudio.busy(a.id)) return '';
  if (a.drive) return local ? 'qui e su Drive' : 'su Drive: si scarica quando l’ascolti';
  if (!local) return 'non su questo dispositivo';
  return DriveAudio.ready() ? 'solo su questo dispositivo' : '';
}
function paintAudioWhere(root, list) {
  AudioDB.keys().then(keys => {
    const have = new Set(keys);
    $$('.au-item', root).forEach(it => {
      const a = list.find(x => x.id === it.dataset.aid);
      const x = $('.au-miss', it);
      if (!a || !x) return;
      const t = audioWhereText(a, have.has(a.id));
      x.textContent = t ? ` · ${t}` : '';
      x.hidden = !t;
      x.classList.toggle('ok', !!a.drive || have.has(a.id));
      it.dataset.local = have.has(a.id) ? '1' : '';
    });
  });
}
// le voci del menu ⋯ che riguardano Drive
function driveMenuItems(a, local) {
  if (!DriveAudio.ready()) return [];
  const out = [];
  if (!a.drive && local) out.push({ key: 'drv-up', label: 'Carica su Drive (per gli altri dispositivi)' });
  if (a.drive && !local) out.push({ key: 'drv-get', label: 'Scarica su questo dispositivo (per ascoltarla offline)' });
  if (a.drive && local) out.push({ key: 'drv-free', label: 'Togli da questo dispositivo (resta su Drive)' });
  if (a.drive) out.push({ key: 'drv-unlink', label: 'Scollega da Drive' });
  return out;
}
async function driveMenuAct(ch, owner, a) {
  if (ch === 'drv-up') {
    toast('Carico la lezione su Drive: puoi continuare a usare l’app');
    try { await DriveAudio.upload(owner, a); toast(`“${a.name}” è su Drive: sugli altri dispositivi si scarica quando l’ascolti`); } catch (e) { toast(e.message || 'Caricamento non riuscito', 'err'); }
    AudioMode.refresh();
    return true;
  }
  if (ch === 'drv-get') {
    try { await DriveAudio.download(a); toast('Lezione scaricata: ora si ascolta anche offline'); } catch (e) { toast(e.message || 'Scaricamento non riuscito', 'err'); }
    AudioMode.refresh();
    return true;
  }
  if (ch === 'drv-free') {
    if (AudioPlayer.aId === a.id) AudioPlayer.act('close');
    await AudioDB.del(a.id);
    toast('Tolta da questo dispositivo: resta su Drive, con i segnalibri');
    AudioMode.refresh();
    return true;
  }
  if (ch === 'drv-unlink') {
    if (!(await modal({ title: 'Scollegare da Drive?', text: 'Il file su Drive resta dov’è; questa lezione non lo scaricherà più. Sugli altri dispositivi, se non hanno già il file, non si potrà ascoltare.', confirm: 'Scollega' }))) return true;
    delete a.drive;
    await saveOwner(owner);
    AudioMode.refresh();
    return true;
  }
  return false;
}
// sfoglia il Drive e aggiunge gli audio scelti (alle lezioni del notebook o a una sezione)
async function driveAudioSheet(owner) {
  if (!DriveAudio.ready()) { toast('Prima collega Drive: Impostazioni → Sincronizzazione', 'err'); return; }
  const nb = isSecRec(owner) ? nbById(owner.notebookId) : owner;
  if (!nb) return;
  const picked = new Map();
  let cur = null;
  const sh = openSheet(`
    <h2>Da Google Drive</h2>
    <p class="sheet-sub">Scegli gli audio da aggiungere ${isSecRec(owner) ? `a “${esc(owner.title)}”` : `alle lezioni di ${esc(nb.name)}`}. Si scaricano sul dispositivo quando li ascolti; nome, segnalibri e sezioni collegate si sincronizzano.</p>
    <div class="drv-path" id="drvPath"></div>
    <div class="drv-box" id="drvBox"><p class="hint">Apro Drive…</p></div>
    <div class="modal-actions drv-acts">
      <button class="btn ghost" type="button" data-drv-act="close">Chiudi</button>
      <button class="btn ghost" type="button" data-drv-act="home" hidden>Cartella delle lezioni</button>
      <button class="btn ghost" type="button" data-drv-act="use" hidden>Usa questa cartella per ${esc(nb.name)}</button>
      <button class="btn primary" type="button" data-drv-act="add" disabled>Aggiungi</button>
    </div>`, { label: 'Da Google Drive' });
  const box = $('#drvBox', sh.el);
  const paintAdd = () => { const b = $('[data-drv-act="add"]', sh.el); b.disabled = !picked.size; b.textContent = picked.size ? `Aggiungi (${picked.size})` : 'Aggiungi'; };
  const have = new Set(audiosOf(owner).map(a => a.drive?.id).filter(Boolean));
  const open = async folder => {
    box.innerHTML = '<p class="hint">Apro la cartella…</p>';
    try { cur = await DriveAudio.list(folder); } catch (e) { box.innerHTML = `<p class="err-line">${esc(e.message || 'Drive non risponde')}</p>`; return; }
    if (!sh.el.isConnected) return;
    $('#drvPath', sh.el).innerHTML = `${cur.parent ? `<button type="button" class="btn sm ghost" data-drv-dir="${esc(cur.parent.id)}">‹ ${esc(cur.parent.name)}</button>` : ''}<b>${esc(cur.name)}</b>`;
    const isHome = nb.lessonFolder && nb.lessonFolder.id === cur.id;
    $('[data-drv-act="use"]', sh.el).hidden = isHome || cur.id === 'root';
    $('[data-drv-act="home"]', sh.el).hidden = !nb.lessonFolder || isHome;
    box.innerHTML = `
      ${cur.folders.length ? `<ul class="drv-list">${cur.folders.map(f => `<li><button type="button" class="row" data-drv-dir="${esc(f.id)}"><span class="drv-ic" aria-hidden="true">${FOLDER_SVG}</span><span class="row-main"><span class="row-title">${esc(f.name)}</span></span><span aria-hidden="true">›</span></button></li>`).join('')}</ul>` : ''}
      ${cur.files.length ? `
        <div class="drv-allrow"><label class="check"><input type="checkbox" id="drvAll"><span>Seleziona tutti (${cur.files.filter(f => !have.has(f.id)).length})</span></label></div>
        <ul class="drv-list">${cur.files.map(f => `<li><label class="row drv-file ${have.has(f.id) ? 'done' : ''}">
          <input type="checkbox" data-drv-file="${esc(f.id)}" ${have.has(f.id) ? 'disabled checked' : picked.has(f.id) ? 'checked' : ''}>
          <span class="row-main"><span class="row-title">${esc(f.name.replace(AUDIO_RE, ''))}</span><span class="row-sub">${[fmtSize(f.size || 0), new Date(f.modified).toLocaleDateString('it-IT'), have.has(f.id) ? 'già aggiunto' : ''].filter(Boolean).join(' · ')}</span></span></label></li>`).join('')}</ul>`
        : `<p class="hint">${cur.folders.length ? 'Qui non ci sono audio: apri una cartella.' : 'Questa cartella è vuota (o non ha audio).'}</p>`}`;
  };
  sh.el.addEventListener('click', async e => {
    const d = e.target.closest('[data-drv-dir]');
    if (d) { open(d.dataset.drvDir); return; }
    const b = e.target.closest('[data-drv-act]');
    if (!b) return;
    if (b.dataset.drvAct === 'close') { sh.close(false); return; }
    if (b.dataset.drvAct === 'home') { open(nb.lessonFolder.id); return; }
    if (b.dataset.drvAct === 'use') {
      nb.lessonFolder = { id: cur.id, name: cur.name };
      await saveNotebook(nb);
      b.hidden = true;
      toast(`“${cur.name}” è la cartella delle lezioni di ${nb.name}: si apre da qui, e le lezioni caricate su Drive finiscono qui`);
      return;
    }
    if (b.dataset.drvAct === 'add') {
      const files = [...picked.values()];
      for (const f of files) {
        const rec = { id: uid(), name: f.name.replace(AUDIO_RE, '').trim() || 'Lezione', size: f.size || 0, type: f.mime && f.mime.startsWith('audio/') ? f.mime : audioMimeOf(f.name), duration: 0, marks: [], created: Date.now(), drive: { id: f.id, name: f.name, size: f.size || 0, folder: cur.name } };
        if (!isSecRec(owner)) { rec.secIds = []; rec.name = uniqueLessonName(owner, rec.name); }
        audiosOf(owner).push(rec);
      }
      await saveOwner(owner);
      sh.close(true);
      toast(files.length === 1 ? 'Lezione aggiunta da Drive' : `${files.length} lezioni aggiunte da Drive`);
      route();
    }
  });
  sh.el.addEventListener('change', e => {
    if (e.target.id === 'drvAll') {
      cur.files.filter(f => !have.has(f.id)).forEach(f => { if (e.target.checked) picked.set(f.id, f); else picked.delete(f.id); });
      $$('[data-drv-file]', sh.el).forEach(c => { if (!c.disabled) c.checked = e.target.checked; });
      paintAdd();
      return;
    }
    const c = e.target.closest('[data-drv-file]');
    if (!c) return;
    const f = cur.files.find(x => x.id === c.dataset.drvFile);
    if (c.checked) picked.set(f.id, f); else picked.delete(f.id);
    paintAdd();
  });
  open(nb.lessonFolder?.id || 'root');
}

/* =====================================================================
   v3.88: dalla lezione agli appunti (con Gemini, che ascolta l’audio intero)
   - Segnalibri automatici: l’indice della lezione, minuto per minuto, già
     collegato alle sezioni del notebook, con i punti “da esame”
   - Bozza di appunti: appunti in Markdown con i minuti, da tenere come sezione
   L’audio si carica una volta sul servizio File di Gemini (resta 48 ore).
   ===================================================================== */
const LESSON_SYS_MARKS = `Sei un assistente che ascolta la registrazione di una lezione universitaria di medicina, in italiano, e ne ricava l’indice per uno studente.
Ascolta TUTTO l’audio, dall’inizio alla fine. Individua ogni cambio di argomento e, per ognuno, scrivi:
- "t": il minuto esatto in cui il docente comincia a parlarne, nel formato H:MM:SS (ore:minuti:secondi dall’inizio della registrazione);
- "titolo": un titolo breve e preciso (3-8 parole), con i termini medici corretti;
- "sezione": se l’argomento corrisponde a una delle SEZIONI DEGLI APPUNTI che ti elenco, copia il suo titolo ESATTO; altrimenti stringa vuota;
- "esame": true solo se il docente dice esplicitamente che è importante, che lo chiede all’esame o che va saputo bene; altrimenti false;
- "nota": una riga (massimo 15 parole) su cosa dice in quel punto; se "esame" è true, riporta cosa ha detto sull’esame.
Regole: gli argomenti in ordine di tempo; uno ogni 3-8 minuti circa (da 8 a 45 voci secondo la durata); non inventare argomenti che non senti; ignora pause, appelli e chiacchiere. I minuti devono essere dentro la durata dell’audio.
Rispondi SOLO con JSON valido: {"argomenti": [{"t": "0:12:40", "titolo": "...", "sezione": "...", "esame": false, "nota": "..."}]}`;
const LESSON_SYS_NOTES = `Sei uno studente di medicina molto ordinato che prende appunti dalla registrazione di una lezione universitaria, in italiano.
Ascolta TUTTO l’audio e scrivi gli appunti completi in Markdown:
- un titolo "## " per ogni argomento e "### " per i sottoargomenti; subito dopo ogni titolo "## " una riga con il minuto di inizio nel formato "⏱ H:MM:SS";
- elenchi puntati con definizioni, classificazioni, meccanismi, valori numerici, esempi clinici, come li dice il docente; tabelle quando confronta più voci;
- segna con "**Esame:**" le cose che il docente dice di chiedere o di sapere bene;
- solo quello che viene detto: non aggiungere nozioni tue; se un termine non si capisce scrivi "(non chiaro)";
- niente introduzioni, saluti o commenti: solo gli appunti. Termini medici corretti.`;
/* =====================================================================
   v3.96: le lezioni lunghe si dividono in parti da 20 minuti
   Una lezione di due ore in una sola richiesta è troppo pesante quando
   Gemini è carico. Il file si taglia qui, senza decodificarlo (così anche
   un tablet regge due ore di audio):
   - M4A/MP4 (AAC, il formato dei registratori dei telefoni): si leggono le
     tabelle del file e ogni frame AAC diventa un frame ADTS (.aac);
   - MP3 e AAC (ADTS): si taglia ai confini dei frame;
   - WAV: si taglia ai campioni, con la sua intestazione.
   Gli altri formati (OGG, OPUS, WEBM, FLAC) si mandano interi, come prima.
   ===================================================================== */
const AudioSplit = {
  PART: 20 * 60,      // secondi per parte
  MIN: 25 * 60,       // sotto i 25 minuti non si divide
  async bytes(file, a, b) { return new Uint8Array(await file.slice(a, b).arrayBuffer()); },
  async plan(file, knownDur = 0) {
    const head = await this.bytes(file, 0, 64);
    const tag = (o, s) => String.fromCharCode(...head.slice(o, o + s.length)) === s;
    let p = null;
    try {
      if (tag(4, 'ftyp')) p = await this.mp4(file);
      else if (tag(0, 'RIFF') && tag(8, 'WAVE')) p = await this.wav(file);
      else if (tag(0, 'ID3') || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) p = await this.frames(file, knownDur);
    } catch (e) { p = null; }
    if (!p || !(p.duration > 0)) return null;
    const n = p.duration > this.MIN ? Math.ceil(p.duration / this.PART) : 1;
    const len = p.duration / n;
    p.parts = Array.from({ length: n }, (_, i) => ({ start: Math.round(i * len), end: i === n - 1 ? p.duration : Math.round((i + 1) * len) }));
    return p;
  },

  /* ---- M4A/MP4 con AAC → ADTS ---- */
  async mp4(file) {
    // le scatole principali; “moov” (le tabelle) può stare in fondo al file
    let off = 0, moov = null;
    while (off + 8 <= file.size) {
      const h = await this.bytes(file, off, off + 16);
      const dv = new DataView(h.buffer);
      let size = dv.getUint32(0);
      const type = String.fromCharCode(...h.slice(4, 8));
      let hdr = 8;
      if (size === 1) { size = dv.getUint32(8) * 2 ** 32 + dv.getUint32(12); hdr = 16; } else if (size === 0) size = file.size - off;
      if (size < hdr) return null;
      if (type === 'moov') { moov = await this.bytes(file, off + hdr, off + size); break; }
      off += size;
    }
    if (!moov) return null;
    const boxes = (buf, from, to) => {
      const out = [];
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      let o = from;
      while (o + 8 <= to) {
        let size = dv.getUint32(o);
        const type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]);
        let hdr = 8;
        if (size === 1) { size = dv.getUint32(o + 8) * 2 ** 32 + dv.getUint32(o + 12); hdr = 16; } else if (size === 0) size = to - o;
        if (size < hdr || o + size > to) break;
        out.push({ type, s: o + hdr, e: o + size });
        o += size;
      }
      return out;
    };
    const dv = new DataView(moov.buffer);
    const find = (list, t) => list.find(b => b.type === t);
    let au = null;
    for (const trak of boxes(moov, 0, moov.length).filter(b => b.type === 'trak')) {
      const mdia = find(boxes(moov, trak.s, trak.e), 'mdia');
      if (!mdia) continue;
      const mb = boxes(moov, mdia.s, mdia.e);
      const hdlr = find(mb, 'hdlr');
      if (!hdlr || String.fromCharCode(...moov.slice(hdlr.s + 8, hdlr.s + 12)) !== 'soun') continue;
      const mdhd = find(mb, 'mdhd');
      const v = moov[mdhd.s];
      const timescale = v === 1 ? dv.getUint32(mdhd.s + 20) : dv.getUint32(mdhd.s + 12);
      const minf = find(mb, 'minf');
      const stbl = minf && find(boxes(moov, minf.s, minf.e), 'stbl');
      if (!stbl) continue;
      au = { timescale, st: boxes(moov, stbl.s, stbl.e) };
      break;
    }
    if (!au) return null;
    const st = t => find(au.st, t);
    // la configurazione AAC (dentro stsd → mp4a → esds)
    const stsd = st('stsd');
    const entry = stsd.s + 8;
    if (String.fromCharCode(...moov.slice(entry + 4, entry + 8)) !== 'mp4a') return null;
    let asc = null;
    // la AudioSpecificConfig sta nella esds: ES_Descriptor (0x03) → DecoderConfig (0x04) → DecoderSpecificInfo (0x05)
    const esdsAt = (() => { for (let i = entry + 36; i < stsd.e - 8; i++) if (moov[i] === 0x65 && moov[i + 1] === 0x73 && moov[i + 2] === 0x64 && moov[i + 3] === 0x73) return i + 8; return -1; })();
    if (esdsAt < 0) return null;
    let q = esdsAt;
    const descLen = () => { let len = 0; for (let k = 0; k < 4; k++) { const b = moov[q++]; len = (len << 7) | (b & 0x7f); if (!(b & 0x80)) break; } return len; };
    if (moov[q++] !== 0x03) return null;
    descLen();
    q += 2;
    const fl = moov[q++];
    if (fl & 0x80) q += 2;
    if (fl & 0x40) q += 1 + moov[q];
    if (fl & 0x20) q += 2;
    if (moov[q++] !== 0x04) return null;
    descLen();
    q += 13;
    if (moov[q++] !== 0x05) return null;
    const alen = descLen();
    if (alen >= 2) asc = moov.slice(q, q + alen);
    if (!asc) return null;
    const obj = asc[0] >> 3;
    let sfi = ((asc[0] & 7) << 1) | (asc[1] >> 7);
    const ch = (asc[1] >> 3) & 0xf;
    // solo AAC normale (LC e simili): l’HE-AAC si manda intero
    if (![1, 2, 3, 4].includes(obj) || sfi > 12 || ch < 1 || ch > 7) return null;
    // tabelle: dimensioni, blocchi, posizioni, tempi
    const stsz = st('stsz');
    const fixed = dv.getUint32(stsz.s + 4), count = dv.getUint32(stsz.s + 8);
    const sizes = new Uint32Array(count);
    for (let i = 0; i < count; i++) sizes[i] = fixed || dv.getUint32(stsz.s + 12 + i * 4);
    const stco = st('stco') || st('co64');
    const nCh = dv.getUint32(stco.s + 4);
    const chunkOff = new Float64Array(nCh);
    for (let i = 0; i < nCh; i++) chunkOff[i] = stco.type === 'co64' ? dv.getUint32(stco.s + 8 + i * 8) * 2 ** 32 + dv.getUint32(stco.s + 12 + i * 8) : dv.getUint32(stco.s + 8 + i * 4);
    const stsc = st('stsc');
    const runs = Array.from({ length: dv.getUint32(stsc.s + 4) }, (_, i) => ({ first: dv.getUint32(stsc.s + 8 + i * 12), per: dv.getUint32(stsc.s + 12 + i * 12) }));
    const offsets = new Float64Array(count);
    let si = 0;
    for (let c = 0; c < nCh && si < count; c++) {
      let per = 0;
      for (const r of runs) if (r.first <= c + 1) per = r.per;
      let o = chunkOff[c];
      for (let k = 0; k < per && si < count; k++) { offsets[si] = o; o += sizes[si]; si++; }
    }
    const stts = st('stts');
    const times = new Float64Array(count + 1);
    let t = 0, idx = 0;
    for (let i = 0, n = dv.getUint32(stts.s + 4); i < n; i++) {
      const c = dv.getUint32(stts.s + 8 + i * 8), d = dv.getUint32(stts.s + 12 + i * 8);
      for (let k = 0; k < c && idx < count; k++) { times[idx++] = t; t += d; }
    }
    times[count] = t;
    const duration = t / au.timescale;
    const self = this;
    return {
      kind: 'm4a', mime: 'audio/aac', ext: 'aac', duration,
      async make(start, end) {
        const ts = au.timescale;
        let a = 0;
        while (a < count && times[a] / ts < start) a++;
        let b = a;
        while (b < count && times[b] / ts < end) b++;
        if (b <= a) throw new Error('Parte vuota');
        // un solo pezzo di file, dalla prima all’ultima frame (nei .m4a l’audio è tutto di fila)
        const from = offsets[a], to = offsets[b - 1] + sizes[b - 1];
        let total = 0;
        for (let i = a; i < b; i++) total += sizes[i];
        const contiguous = to - from <= total * 1.5;
        const src = contiguous ? await self.bytes(file, from, to) : null;
        const out = new Uint8Array(total + (b - a) * 7);
        let o = 0;
        for (let i = a; i < b; i++) {
          const len = sizes[i] + 7;
          out[o] = 0xff; out[o + 1] = 0xf1;
          out[o + 2] = (((obj - 1) & 3) << 6) | (sfi << 2) | ((ch >> 2) & 1);
          out[o + 3] = ((ch & 3) << 6) | ((len >> 11) & 3);
          out[o + 4] = (len >> 3) & 0xff;
          out[o + 5] = ((len & 7) << 5) | 0x1f;
          out[o + 6] = 0xfc;
          const frame = src ? src.subarray(offsets[i] - from, offsets[i] - from + sizes[i]) : await self.bytes(file, offsets[i], offsets[i] + sizes[i]);
          out.set(frame, o + 7);
          o += len;
        }
        return new Blob([out], { type: 'audio/aac' });
      }
    };
  },

  /* ---- WAV ---- */
  async wav(file) {
    const h = await this.bytes(file, 0, Math.min(file.size, 4096));
    const dv = new DataView(h.buffer);
    let o = 12, fmt = null, data = null;
    while (o + 8 <= h.length) {
      const id = String.fromCharCode(...h.slice(o, o + 4));
      const size = dv.getUint32(o + 4, true);
      if (id === 'fmt ') fmt = { o: o + 8, size };
      if (id === 'data') { data = { o: o + 8, size: Math.min(size, file.size - o - 8) }; break; }
      o += 8 + size + (size & 1);
    }
    if (!fmt || !data) return null;
    const byteRate = dv.getUint32(fmt.o + 8, true), align = dv.getUint16(fmt.o + 12, true);
    if (!byteRate || !align) return null;
    const fmtBytes = h.slice(fmt.o, fmt.o + fmt.size);
    const self = this;
    return {
      kind: 'wav', mime: 'audio/wav', ext: 'wav', duration: data.size / byteRate,
      async make(start, end) {
        const a = data.o + Math.floor((start * byteRate) / align) * align;
        const b = Math.min(data.o + data.size, data.o + Math.floor((end * byteRate) / align) * align);
        const body = await file.slice(a, b).arrayBuffer();
        const hd = new Uint8Array(20 + fmtBytes.length + 8);
        const v = new DataView(hd.buffer);
        hd.set([82, 73, 70, 70]); v.setUint32(4, hd.length - 8 + body.byteLength, true); hd.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
        v.setUint32(16, fmtBytes.length, true); hd.set(fmtBytes, 20);
        hd.set([100, 97, 116, 97], 20 + fmtBytes.length); v.setUint32(24 + fmtBytes.length, body.byteLength, true);
        return new Blob([hd, body], { type: 'audio/wav' });
      }
    };
  },

  /* ---- MP3 e AAC (ADTS): si taglia all’inizio di un frame ---- */
  async frames(file, knownDur) {
    const h = await this.bytes(file, 0, 10);
    let start = 0;
    if (h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) start = 10 + ((h[6] & 0x7f) << 21 | (h[7] & 0x7f) << 14 | (h[8] & 0x7f) << 7 | (h[9] & 0x7f));
    const MP3_BR = [[0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]];
    const MP3_SR = [[44100, 48000, 32000], [22050, 24000, 16000], [11025, 12000, 8000]];
    const ADTS_SR = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    // lunghezza e durata di un frame che comincia in b[i], o null
    const frameAt = (b, i) => {
      if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
      if ((b[i + 1] & 0xf6) === 0xf0) { // ADTS
        const sfi = (b[i + 2] >> 2) & 0xf;
        const len = ((b[i + 3] & 3) << 11) | (b[i + 4] << 3) | (b[i + 5] >> 5);
        if (sfi > 12 || len < 7) return null;
        return { len, sec: 1024 / ADTS_SR[sfi], adts: true };
      }
      const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3;
      if (ver === 1 || layer !== 1) return null; // solo Layer III
      const bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
      if (bri === 0 || bri === 15 || sri === 3) return null;
      const v1 = ver === 3;
      const br = MP3_BR[v1 ? 0 : 1][bri] * 1000, sr = MP3_SR[v1 ? 0 : ver === 2 ? 1 : 2][sri];
      const spf = v1 ? 1152 : 576;
      return { len: Math.floor((spf / 8) * br / sr) + pad, sec: spf / sr, br };
    };
    // il primo frame vero (due frame validi di fila)
    const probe = await this.bytes(file, start, Math.min(file.size, start + 65536));
    let first = -1, f0 = null;
    for (let i = 0; i < probe.length - 8; i++) {
      const f = frameAt(probe, i);
      if (f && i + f.len + 4 < probe.length && frameAt(probe, i + f.len)) { first = start + i; f0 = f; break; }
    }
    if (first < 0) return null;
    // il primo frame di un MP3 spesso è l’intestazione “Xing/Info” con la durata di tutto il file: nelle parti non va
    if (!f0.adts) {
      const fr = probe.subarray(first - start, first - start + Math.min(f0.len, 200));
      const txt = String.fromCharCode(...fr);
      if (/Xing|Info|VBRI/.test(txt)) first += f0.len;
    }
    const audioBytes = file.size - first;
    // durata: quella nota (dal lettore) o stimata dal bitrate
    const duration = knownDur > 0 ? knownDur : f0.adts ? null : audioBytes / (f0.br / 8);
    if (!duration) return null;
    const self = this;
    const syncFrom = async pos => {
      if (pos <= first) return first;
      if (pos >= file.size) return file.size;
      const buf = await self.bytes(file, pos, Math.min(file.size, pos + 16384));
      for (let i = 0; i < buf.length - 8; i++) {
        const f = frameAt(buf, i);
        if (f && i + f.len + 4 < buf.length && frameAt(buf, i + f.len)) return pos + i;
      }
      return pos;
    };
    return {
      kind: f0.adts ? 'aac' : 'mp3', mime: f0.adts ? 'audio/aac' : 'audio/mp3', ext: f0.adts ? 'aac' : 'mp3', duration,
      async make(s, e) {
        const a = await syncFrom(first + Math.floor((s / duration) * audioBytes));
        const b = e >= duration ? file.size : await syncFrom(first + Math.floor((e / duration) * audioBytes));
        return new Blob([await file.slice(a, b).arrayBuffer()], { type: f0.adts ? 'audio/aac' : 'audio/mpeg' });
      }
    };
  }
};
// sposta di “off” secondi i minuti ⏱ scritti negli appunti di una parte
const shiftStamps = (md, off) => String(md || '').replace(/⏱\s?((?:\d{1,2}:)?\d{1,2}:\d{2})/g, (m, t) => { const v = parseT(t); return v === null ? m : `⏱ ${fmtT(v + off)}`; });
const fmtHMS = s => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

// v3.93: se i modelli scelti in Impostazioni sono sovraccarichi, per una lezione intera provo anche questi
// (tutti ascoltano l’audio; quelli che non esistono più vengono saltati)
const LESSON_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
const lessonGemMime = f => {
  const ext = String(f.name || '').split('.').pop().toLowerCase();
  const m = { mp3: 'audio/mp3', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm', '3gp': 'audio/3gpp', amr: 'audio/amr' }[ext];
  return m || (f.type && f.type.startsWith('audio/') ? f.type.split(';')[0] : 'audio/mp3');
};
// sempre nel menu: senza la chiave di Gemini spiegano cosa serve (prima sparivano e basta)
const lessonAiItems = () => [{ key: 'ai-marks', label: '✨ Segnalibri automatici (Gemini ascolta la lezione)' }, { key: 'ai-notes', label: '✨ Bozza di appunti dalla lezione (Gemini)' }];
async function lessonAiNeedsKey() {
  if (S().geminiKey.trim()) return false;
  const ok = await modal({ title: 'Serve la chiave di Gemini', text: `Per ascoltare una lezione intera serve Gemini${S().claudeKey.trim() ? ' (Claude non ascolta l’audio)' : ''}: la chiave è gratuita. Le chiavi dell’AI non si sincronizzano tra i dispositivi: va inserita su ognuno, in Impostazioni → Intelligenza artificiale.`, confirm: 'Vai alle impostazioni' });
  if (ok) go('#/settings');
  return true;
}
// carica l’audio su Gemini e fa la richiesta, con una finestra che dice a che punto è
/* =====================================================================
   v3.97: le lezioni con l’AI lavorano in sottofondo
   Avvii “Segnalibri automatici” o “Bozza di appunti” e torni a studiare:
   l’app va avanti da sola, una parte alla volta. I segnalibri di ogni
   parte compaiono appena quella parte è pronta. Un riquadro in basso dice a
   che punto è; toccandolo vedi le parti, puoi riprovare o fermare.
   Le parti fatte restano salvate: se chiudi l’app, riparte da dove era.
   ===================================================================== */
const LessonJobs = {
  KEY: 'nb-lesson-jobs',
  jobs: [], running: null, ctl: null, chip: null, sheet: null,
  load() { try { this.jobs = JSON.parse(localStorage.getItem(this.KEY) || '[]') || []; } catch { this.jobs = []; } },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.jobs)); } catch { /* troppo grande: restano solo in memoria */ } },
  label: k => (k === 'marks' ? 'Segnalibri automatici' : 'Bozza di appunti'),
  owner(j) { return audioOwner(j.ot, j.oid); },
  audio(j) { const o = this.owner(j); return o ? audiosOf(o).find(x => x.id === j.aid) || null : null; },
  find(owner, a, kind) { return this.jobs.find(j => j.oid === owner.id && j.aid === a.id && j.kind === kind) || null; },
  init() {
    this.load();
    // lavori di lezioni che non esistono più
    this.jobs = this.jobs.filter(j => this.audio(j));
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'lj-chip';
    el.hidden = true;
    el.addEventListener('click', () => this.open(this.jobs.find(j => j.status === 'err') || this.jobs.find(j => j.status === 'run') || this.jobs[0]));
    document.body.append(el);
    this.chip = el;
    this.paint();
    // riparte da solo se l’app era stata chiusa a metà
    if (this.jobs.some(j => j.status === 'run' || j.status === 'wait')) setTimeout(() => this.run(), 1500);
  },
  start(owner, a, kind) {
    let j = this.find(owner, a, kind);
    if (j && j.status === 'done' && kind === 'notes') { this.openNotes(j); return; }
    if (!j) {
      j = { id: uid(), ot: isSecRec(owner) ? 'sec' : 'nb', oid: owner.id, aid: a.id, name: a.name, kind, status: 'wait', parts: null, done: [], added: [], err: '', wait: '', created: Date.now() };
      this.jobs.push(j);
    } else if (j.status === 'err') { j.status = 'wait'; j.err = ''; }
    this.save();
    this.paint();
    this.run();
    this.open(j);
  },
  paint() {
    if (!this.chip) return;
    const live = this.jobs.filter(j => j.status !== 'done' || j.kind === 'notes');
    if (!live.length) { this.chip.hidden = true; this.paintSheet(); return; }
    const j = live.find(x => x.status === 'err') || live.find(x => x.status === 'run') || live.find(x => x.status === 'done') || live[0];
    const n = j.parts ? j.parts.length : 0;
    const k = j.done.filter(Boolean).length;
    const more = live.length > 1 ? ` · +${live.length - 1}` : '';
    let txt;
    if (j.status === 'err') txt = `⚠ ${this.label(j.kind)} fermi${n > 1 ? ` alla parte ${k + 1} di ${n}` : ''}: tocca per riprovare`;
    else if (j.status === 'done') txt = `✨ Bozza di appunti pronta: tocca per aprirla`;
    else if (j.status === 'wait') txt = `✨ ${this.label(j.kind)} in coda`;
    else txt = `✨ ${this.label(j.kind)}${n > 1 ? ` · parte ${Math.min(k + 1, n)} di ${n}` : ' · in corso'}${j.wait ? ` · ${j.wait}` : ''}`;
    this.chip.hidden = false;
    this.chip.className = `lj-chip ${j.status}`;
    this.chip.innerHTML = `<span class="lj-t">${esc(txt)}${more}</span><span class="lj-n">${esc(j.name)}</span>`;
    this.paintSheet();
  },
  // la finestra con le parti; si può chiudere e continuare a studiare
  open(j) {
    if (!j) return;
    if (j.kind === 'notes' && j.status === 'done') { this.openNotes(j); return; }
    const sh = openSheet('<div class="lj-sheet"></div>', { label: this.label(j.kind), onClose: () => { this.sheet = null; } });
    this.sheet = { el: sh.el, close: sh.close, j };
    sh.el.addEventListener('click', e => {
      const b = e.target.closest('[data-lj]');
      if (!b) return;
      const k = b.dataset.lj;
      if (k === 'close') sh.close(null);
      else if (k === 'again') { j.status = 'wait'; j.err = ''; this.save(); this.paint(); this.run(); }
      else if (k === 'stop') this.stop(j);
    });
    this.paintSheet();
  },
  paintSheet() {
    const s = this.sheet;
    if (!s || !s.el.isConnected) return;
    const j = s.j;
    if (!this.jobs.includes(j)) { s.close(null); return; }
    const box = $('.lj-sheet', s.el);
    const n = j.parts ? j.parts.length : 0;
    const k = j.done.filter(Boolean).length;
    const items = n ? j.parts.map((p, i) => {
      const st = j.done[i] ? 'ok' : j.status === 'run' && i === k ? 'on' : j.status === 'err' && i === k ? 'ko' : '';
      return `<li class="${st}">${n > 1 ? `Parte ${i + 1} di ${n} · ${fmtT(p.start)}–${fmtT(p.end)}` : 'La lezione intera'}${st === 'on' && j.step ? ` <span class="lai-p">${esc(j.step)}</span>` : ''}${j.done[i] && j.kind === 'marks' ? ` <small class="muted-inline">${j.done[i].n || 0} segnalibri</small>` : ''}</li>`;
    }).join('') : `<li class="on">Prendo il file della lezione</li>`;
    box.innerHTML = `
      <h2>${this.label(j.kind)}</h2>
      <p class="sheet-sub">${esc(j.name)}</p>
      <ol class="lai-steps">${items}</ol>
      ${j.wait ? `<p class="lai-note">${esc(j.wait)}</p>` : ''}
      ${j.err ? `<p class="err-line">${esc(j.err)}</p>` : ''}
      <p class="hint">${j.kind === 'marks' ? 'I segnalibri di ogni parte compaiono nella lezione appena quella parte è pronta, già collegati alle sezioni.' : 'Quando tutte le parti sono pronte trovi la bozza qui, o dal riquadro in basso.'} Intanto puoi chiudere questa finestra e studiare: il lavoro continua finché l’app resta aperta, e se la chiudi riparte da dove era.</p>
      <div class="modal-actions">
        ${j.status === 'done' ? '' : '<button class="btn ghost danger" type="button" data-lj="stop">Ferma</button>'}
        ${j.status === 'err' ? '<button class="btn" type="button" data-lj="again">Riprova</button>' : ''}
        <button class="btn primary" type="button" data-lj="close">${j.status === 'done' ? 'Chiudi' : 'Continua a studiare'}</button>
      </div>`;
  },
  stop(j) {
    if (this.running === j && this.ctl) this.ctl.abort();
    this.jobs = this.jobs.filter(x => x !== j);
    this.save();
    if (this.sheet) this.sheet.close(null);
    this.paint();
    toast(j.kind === 'marks' && j.added.length ? `Fermato: i ${j.added.length} segnalibri già aggiunti restano` : 'Fermato');
  },
  async run() {
    if (this.running) return;
    for (;;) {
      const j = this.jobs.find(x => x.status === 'run') || this.jobs.find(x => x.status === 'wait');
      if (!j) break;
      this.running = j;
      this.ctl = new AbortController();
      j.status = 'run'; j.err = ''; j.wait = '';
      this.save(); this.paint();
      try {
        await this.exec(j, this.ctl.signal);
        j.status = 'done'; j.wait = ''; j.step = '';
        if (j.kind === 'marks') {
          this.jobs = this.jobs.filter(x => x !== j);
          const added = j.added.slice();
          toast(added.length ? `${j.name}: ${added.length} segnalibri aggiunti` : `${j.name}: nessun segnalibro nuovo`, '', added.length ? { label: 'Annulla', fn: () => this.undoMarks(j, added) } : null);
        } else toast(`${j.name}: bozza di appunti pronta`, '', { label: 'Apri', fn: () => this.openNotes(j) });
      } catch (e) {
        if (!this.jobs.includes(j)) { /* fermato */ }
        else if (e.name === 'AbortError') { j.status = 'wait'; }
        else { j.status = 'err'; j.wait = ''; j.step = ''; j.err = e.overloaded ? `${e.message}${j.done.filter(Boolean).length ? ` Le parti già fatte restano: Riprova riparte da quella che manca.` : ''}` : (e.message || 'Non riuscito'); }
      }
      this.running = null;
      this.save(); this.paint();
      if (j.status === 'wait') break; // interrotto: riparte alla prossima apertura
    }
  },
  async exec(j, signal) {
    const owner = this.owner(j), a = this.audio(j);
    if (!owner || !a) throw new Error('Questa lezione non c’è più.');
    const nb = isSecRec(owner) ? nbById(owner.notebookId) : owner;
    let file = await AudioDB.get(a.id);
    if (!file && a.drive && DriveAudio.ready()) { j.step = 'scarico da Drive'; this.paint(); file = await DriveAudio.download(a); }
    if (!file) throw new Error('Il file di questa lezione non è su questo dispositivo: ricaricalo o scaricalo da Drive.');
    let plan = null;
    try { plan = await AudioSplit.plan(file, a.duration || 0); } catch { plan = null; }
    const split = !!plan && plan.parts.length > 1;
    const parts = split ? plan.parts : [{ start: 0, end: a.duration || plan?.duration || 0 }];
    // se il taglio è cambiato (file diverso), le parti vecchie non valgono più
    if (!j.parts || j.parts.length !== parts.length) { j.parts = parts; j.done = []; }
    this.save(); this.paint();
    const n = parts.length;
    const secs = nb ? secsOf(nb.id).slice(0, 400) : [];
    const onWait = (ms, e) => {
      const until = Date.now() + ms;
      const why = e && e.status === 429 ? 'limite al minuto' : 'Gemini è sovraccarico';
      const tick = () => { if (this.running !== j) return; const left = Math.max(0, Math.ceil((until - Date.now()) / 1000)); j.wait = left ? `${why}: riprovo tra ${left} s` : ''; this.paint(); if (left) setTimeout(tick, 1000); };
      tick();
    };
    const onModel = m => { j.wait = `provo con “${m}”`; this.paint(); };
    for (let i = 0; i < n; i++) {
      if (j.done[i]) continue;
      const p = parts[i];
      const blob = split ? await plan.make(p.start, p.end) : file;
      const mime = split ? plan.mime : lessonGemMime(file);
      const gid = split ? `${a.id}:p${i}of${n}` : a.id;
      const ask = async retry => {
        j.step = 'carico'; this.paint();
        const gf = await GemFiles.ensure(gid, blob, mime, split ? `${a.name} (parte ${i + 1})` : a.name, q => { j.step = `carico ${Math.round(q * 100)}%`; this.paint(); }, signal);
        const t0 = Date.now();
        const tk = setInterval(() => { j.step = `ascolta ${fmtT((Date.now() - t0) / 1000)}`; this.paintSheet(); }, 1000);
        j.step = 'ascolta'; this.paint();
        const len = p.end - p.start;
        const where = split ? `\nPARTE ${i + 1} DI ${n} della lezione (da ${fmtHMS(p.start)} a ${fmtHMS(p.end)} della registrazione completa). L’audio che ascolti è SOLO questa parte e dura ${fmtT(len)}: scrivi i minuti contando dall’inizio di QUESTO audio (che parte da 0:00:00).${i > 0 && j.kind === 'notes' ? ' È il seguito delle parti precedenti: non ripetere introduzioni, continua gli appunti.' : ''}` : (a.duration ? `\nDURATA DELL’AUDIO: ${fmtT(a.duration)}` : '');
        const text = j.kind === 'marks'
          ? `LEZIONE: ${a.name}${nb ? `\nMATERIA: ${nb.name}` : ''}${where}\n\nSEZIONI DEGLI APPUNTI (titoli esatti):\n${secs.map(x => `- ${x.title}`).join('\n') || '(nessuna)'}`
          : `LEZIONE: ${a.name}${nb ? `\nMATERIA: ${nb.name}` : ''}${where}`;
        try {
          return await AI.generate({
            provider: 'gemini', file: gf, system: j.kind === 'marks' ? LESSON_SYS_MARKS : LESSON_SYS_NOTES, text, json: j.kind === 'marks', maxTokens: j.kind === 'marks' ? 16000 : (split ? 24000 : 60000), signal,
            onWait, onModel, extraModels: LESSON_MODELS
          });
        } catch (e) {
          if (!retry && (e.status === 403 || e.status === 404 || /file/i.test(e.message || '')) && e.name !== 'AbortError' && !e.quota) { GemFiles.forget(gid); return ask(true); }
          throw e;
        } finally { clearInterval(tk); }
      };
      // la connessione che salta (Wi-Fi, schermo spento) non ferma il lavoro: riprova da solo
      let r;
      for (let net = 0; ; net++) {
        try { r = await ask(false); break; } catch (e) {
          if (e.name === 'AbortError' || e.status !== 0 || net >= 3) throw e;
          const ms = [5000, 15000, 30000][net];
          j.wait = `connessione assente: riprovo tra ${Math.round(ms / 1000)} s`; this.paint();
          await sleepAbortable(ms, signal);
          j.wait = ''; this.paint();
        }
      }
      if (!this.jobs.includes(j)) throw Object.assign(new Error('Fermato'), { name: 'AbortError' });
      const d = { text: r.text, truncated: !!r.truncated };
      // i segnalibri di questa parte compaiono subito
      if (j.kind === 'marks') d.n = await this.addMarks(j, owner, a, r.text, p, nb);
      j.done[i] = d;
      j.wait = ''; j.step = '';
      this.save(); this.paint();
    }
    if (j.kind === 'notes') {
      j.result = { text: j.done.map((d, i) => shiftStamps(String(d.text || '').replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim(), parts[i].start)).join('\n\n'), truncated: j.done.some(d => d.truncated) };
      j.done = j.done.map(() => ({ text: '' })); // il testo resta solo nel risultato
    }
  },
  async addMarks(j, owner, a, text, p, nb) {
    let items = [];
    try { const js = vivaJson(text); items = Array.isArray(js.argomenti) ? js.argomenti : []; } catch { items = []; }
    const secs = nb ? secsOf(nb.id) : [];
    const findSec = name => { const f = foldAccents(String(name || '')).trim(); if (!f) return null; return secs.find(s => foldAccents(s.title).trim() === f) || secs.find(s => { const t = foldAccents(s.title).trim(); return t.length > 5 && (t.includes(f) || f.includes(t)); }) || null; };
    const len = p.end - p.start;
    const cur = this.owner(j) || owner;
    const rec = audiosOf(cur).find(x => x.id === a.id);
    if (!rec) return 0;
    rec.marks = rec.marks || [];
    let added = 0;
    items.forEach(x => {
      const rel = parseT(String(x.t || '').trim());
      const title = String(x.titolo || '').trim().slice(0, 120);
      if (rel === null || rel < 0 || rel > len + 30 || !title) return;
      const t = Math.round(rel + p.start);
      if (rec.marks.some(m => Math.abs(m.t - t) <= 15)) return;
      const sec = isSecRec(cur) ? null : findSec(x.sezione);
      const m = { id: uid(), t, label: `${x.esame ? '★ ' : ''}${title}`, ai: true, ...(isSecRec(cur) ? {} : { secIds: sec ? [sec.id] : [] }) };
      rec.marks.push(m);
      j.added.push(m.id);
      added++;
    });
    rec.marks.sort((x, y) => x.t - y.t);
    if (added) {
      await saveOwner(cur);
      AudioPlayer.paintTicks?.();
      AudioMode.refresh();
    }
    return added;
  },
  async undoMarks(j, ids) {
    const cur = this.owner(j);
    const rec = cur && audiosOf(cur).find(x => x.id === j.aid);
    if (!rec) return;
    const set = new Set(ids);
    rec.marks = (rec.marks || []).filter(m => !set.has(m.id));
    await saveOwner(cur);
    AudioPlayer.paintTicks?.();
    AudioMode.refresh();
    toast('Segnalibri tolti');
  },
  openNotes(j) {
    const owner = this.owner(j), a = this.audio(j);
    if (!owner || !a || !j.result) { this.jobs = this.jobs.filter(x => x !== j); this.save(); this.paint(); return; }
    lessonAiNotes(owner, a, j);
  }
};
async function lessonAiMarks(owner, a) { LessonJobs.start(owner, a, 'marks'); }
// la bozza arriva dal lavoro in sottofondo; resta da parte (anche chiudendo l’app) finché non la usi
async function lessonAiNotes(owner, a, job = null) {
  if (!job || !job.result) { LessonJobs.start(owner, a, 'notes'); return; }
  const r = job.result;
  const drop = () => { LessonJobs.jobs = LessonJobs.jobs.filter(x => x !== job); LessonJobs.save(); LessonJobs.paint(); };
  const nb = isSecRec(owner) ? nbById(owner.notebookId) : owner;
  // “⏱ 12:34” di una lezione del notebook ha bisogno del suo nome per ritrovarla
  let md = String(r.text || '').replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  if (!isSecRec(owner)) md = md.replace(/⏱\s?((?:\d{1,2}:)?\d{1,2}:\d{2})(?!\s?\()/g, (m, t) => `⏱ ${t} (${a.name.replace(/[()]/g, '')})`);
  const sh = openSheet(`
    <h2>Bozza di appunti</h2>
    <p class="sheet-sub">${esc(a.name)}${r.truncated ? ' · la lezione è lunga: la bozza si ferma prima della fine' : ''}. È una bozza scritta dall’AI ascoltando l’audio: confrontala con i tuoi appunti. I minuti (⏱) in Leggi fanno ripartire la lezione da lì.</p>
    <div class="lai-notes notes">${renderMd(md)}</div>
    <div class="modal-actions">
      <button class="btn ghost" type="button" data-lai="no">Chiudi</button>
      <button class="btn ghost" type="button" data-lai="redo">Rifalla</button>
      <button class="btn" type="button" data-lai="copy">Copia</button>
      <button class="btn primary" type="button" data-lai="ok">${isSecRec(owner) ? 'Aggiungi in fondo alla sezione' : 'Crea una sezione con questi appunti'}</button>
    </div>`, { label: 'Bozza di appunti' });
  $('[data-lai="no"]', sh.el).onclick = () => { sh.close(null); toast('La bozza resta da parte: la ritrovi nel riquadro in basso o da ⋯ → Bozza di appunti'); };
  $('[data-lai="redo"]', sh.el).onclick = () => { drop(); sh.close(null); LessonJobs.start(owner, a, 'notes'); };
  $('[data-lai="copy"]', sh.el).onclick = () => { navigator.clipboard?.writeText(md).then(() => toast('Appunti copiati'), () => toast('Non riesco a copiare', 'err')); };
  $('[data-lai="ok"]', sh.el).onclick = async () => {
    if (isSecRec(owner)) {
      owner.md = `${String(owner.md || '').trimEnd()}\n\n## Dalla registrazione “${a.name}”\n\n${md.replace(/^## /gm, '### ')}\n`;
      await saveSection(owner);
      drop();
      sh.close(true);
      toast('Appunti aggiunti in fondo alla sezione');
      go(`#/sec/${owner.id}/read`);
      return;
    }
    drop();
    const s = newSection(nb.id, { title: `${a.name} (appunti dalla lezione)`, md, source: `Bozza dell’AI dalla lezione “${a.name}”` });
    await saveSection(s);
    const rec = audiosOf(nb).find(x => x.id === a.id);
    if (rec) { rec.secIds = [...new Set([...(rec.secIds || []), s.id])]; await saveNotebook(nb); }
    sh.close(true);
    toast('Sezione creata, collegata alla lezione');
    go(`#/sec/${s.id}/read`);
  };
}
async function lessonAiAct(ch, owner, a) {
  if ((ch === 'ai-marks' || ch === 'ai-notes') && await lessonAiNeedsKey()) return true;
  if (ch === 'ai-marks') { await lessonAiMarks(owner, a); return true; }
  if (ch === 'ai-notes') { const j = LessonJobs.find(owner, a, 'notes'); if (j) LessonJobs.open(j); else LessonJobs.start(owner, a, 'notes'); return true; }
  return false;
}

/* ---------- Lettore: uno solo, resta in basso tra una pagina e l’altra ---------- */
const AudioPlayer = {
  el: null, bar: null, ownK: 'sec', ownId: '', aId: '', url: '', saveT: 0,
  get secId() { return this.ownK === 'sec' ? this.ownId : ''; },
  sec() { return audioOwner(this.ownK, this.ownId); },
  rec() { const s = this.sec(); return s ? audiosOf(s).find(a => a.id === this.aId) : null; },
  isOn() { return !!this.aId; },
  build() {
    if (this.bar) return;
    this.el = new Audio();
    this.el.preload = 'metadata';
    const bar = document.createElement('div');
    bar.className = 'ink-bar au-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Lettore audio');
    bar.innerHTML = `
      <div class="au-top">
        <button type="button" class="btn sm primary au-play" data-au="play" aria-label="Riproduci">▶</button>
        <div class="au-info"><b class="au-name"></b><small class="au-time">0:00</small></div>
        <button type="button" class="btn sm ghost" data-au="close" aria-label="Chiudi il lettore">✕</button>
      </div>
      <div class="au-ctl">
        <button type="button" class="btn sm ghost" data-au="back" aria-label="Indietro di 10 secondi" title="−10 s">−10</button>
        <button type="button" class="btn sm ghost" data-au="fwd" aria-label="Avanti di 30 secondi" title="+30 s">+30</button>
        <select class="input ink-size" data-au-rate aria-label="Velocità">${[0.75, 1, 1.25, 1.5, 1.75, 2].map(r => `<option value="${r}">${String(r).replace('.', ',')}×</option>`).join('')}</select>
        <button type="button" class="btn sm" data-au="mark" title="Segnalibro in questo punto (Alt+B)">＋ Segnalibro</button>
        <button type="button" class="btn sm ghost" data-au="stamp" title="Scrive il minuto nel testo che stai modificando (Alt+T)">⏱ Nel testo</button>
        <button type="button" class="btn sm ghost" data-au="open" title="Apri la pagina dell’audio">Audio</button>
      </div>
      <div class="au-track"><input type="range" class="au-seek" min="0" max="1000" value="0" step="1" aria-label="Posizione"><div class="au-ticks"></div></div>`;
    document.body.append(bar);
    this.bar = bar;
    bar.hidden = true;
    // i pulsanti non tolgono il cursore dal testo che stai scrivendo
    bar.addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); });
    bar.addEventListener('click', e => { const b = e.target.closest('[data-au]'); if (b) this.act(b.dataset.au); const tk = e.target.closest('[data-tick]'); if (tk) this.seek(+tk.dataset.tick); });
    $('[data-au-rate]', bar).addEventListener('change', e => { this.el.playbackRate = +e.target.value; S().audioRate = +e.target.value; Settings.save(); });
    const seek = $('.au-seek', bar);
    seek.addEventListener('input', () => { if (this.el.duration) this.el.currentTime = (+seek.value / 1000) * this.el.duration; });
    this.el.addEventListener('timeupdate', () => this.paintTime());
    this.el.addEventListener('play', () => this.paintPlay());
    this.el.addEventListener('pause', () => { this.paintPlay(); this.savePos(true); });
    this.el.addEventListener('loadedmetadata', () => { this.paintTicks(); const r = this.rec(); if (r && !r.duration && Number.isFinite(this.el.duration)) { r.duration = this.el.duration; this.saveSoon(); } });
    this.el.addEventListener('ended', () => { this.paintPlay(); this.savePos(true); });
    // se chiudi l’app o cambi scheda mentre ascolti, il punto è già salvato qui
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.isOn()) this.savePos(); });
    document.addEventListener('keydown', e => {
      if (!this.isOn() || !e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); this.act('mark'); }
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); this.act('stamp'); }
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); this.act('play'); }
    });
  },
  async load(sec, aId, { at = null, play = true } = {}) {
    this.build();
    const rec = audiosOf(sec).find(a => a.id === aId);
    if (!rec) return false;
    let f = await AudioDB.get(aId);
    // v3.86: è su Drive: la scarico adesso (il lettore mostra a che punto è)
    if (!f && rec.drive && DriveAudio.ready()) {
      this.bar.hidden = false;
      document.body.classList.add('au-on');
      $('.au-name', this.bar).textContent = rec.name;
      const tm = $('.au-time', this.bar);
      const onJob = e => { if (e.detail.id === aId && e.detail.job) tm.textContent = `Scarico da Drive… ${Math.round(e.detail.job.p * 100)}%`; };
      window.addEventListener('nb-drive-job', onJob);
      tm.textContent = 'Scarico da Drive…';
      try { f = await DriveAudio.download(rec); }
      catch (e) { tm.textContent = ''; if (!this.aId) { this.bar.hidden = true; document.body.classList.remove('au-on'); } toast(e.message || 'Non riesco a scaricare la lezione da Drive', 'err'); return false; }
      finally { window.removeEventListener('nb-drive-job', onJob); }
      if (!rec.duration) { rec.duration = await audioDuration(f); saveOwner(sec); }
    }
    if (!f) { toast(rec.drive ? 'Questa lezione è su Drive: collega Drive in Impostazioni → Sincronizzazione per scaricarla' : isSecRec(sec) ? 'Questo audio non è su questo dispositivo: ricaricalo dalla scheda Audio della sezione, o caricalo su Drive dal dispositivo dove c’è' : 'Questa lezione non è su questo dispositivo: dal dispositivo dove c’è, tocca ⋯ → Carica su Drive', 'err'); return false; }
    if (typeof Playlist !== 'undefined' && Playlist.active()) Playlist.stop(true);
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(f);
    this.ownK = isSecRec(sec) ? 'sec' : 'nb';
    this.ownId = sec.id;
    this.aId = aId;
    this.el.src = this.url;
    this.el.playbackRate = +(S().audioRate || 1);
    $('[data-au-rate]', this.bar).value = String(S().audioRate || 1);
    $('.au-name', this.bar).textContent = isSecRec(sec) ? `${rec.name} · ${sec.title}` : `${rec.name} · lezioni di ${sec.name}`;
    this.bar.hidden = false;
    document.body.classList.add('au-on');
    await new Promise(r => { if (this.el.readyState >= 1) r(); else this.el.addEventListener('loadedmetadata', r, { once: true }); setTimeout(r, 1500); });
    this.el.currentTime = at !== null ? at : AudioPos.get(rec);
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: rec.name, artist: isSecRec(sec) ? sec.title : 'Lezioni', album: (isSecRec(sec) ? nbById(sec.notebookId)?.name : sec.name) || 'Notebook' });
        navigator.mediaSession.setActionHandler('seekbackward', () => this.act('back'));
        navigator.mediaSession.setActionHandler('seekforward', () => this.act('fwd'));
      } catch { /* niente */ }
    }
    if (play) this.el.play().catch(() => {});
    this.paintTicks();
    this.paintTime();
    return true;
  },
  // dal testo: va al minuto nell’audio della sezione (quello aperto, se è suo, se no il primo)
  async seekSection(sec, t) {
    if (this.isOn() && this.secId === sec.id) { this.seek(t); this.el.play().catch(() => {}); return; }
    const a = audioOrder(sec)[0];
    if (!a) { toast('Questa sezione non ha audio'); return; }
    await this.load(sec, a.id, { at: t });
  },
  seek(t) { if (this.el) { this.el.currentTime = Math.max(0, t); this.paintTime(); this.savePos(); } },
  paintPlay() { const b = $('.au-play', this.bar); b.textContent = this.el.paused ? '▶' : '❚❚'; b.setAttribute('aria-label', this.el.paused ? 'Riproduci' : 'Pausa'); },
  paintTime() {
    const d = this.el.duration || this.rec()?.duration || 0;
    $('.au-time', this.bar).textContent = `${fmtT(this.el.currentTime)} / ${fmtT(d)}`;
    if (d) $('.au-seek', this.bar).value = String(Math.round((this.el.currentTime / d) * 1000));
    if (!this.el.paused && Math.abs(AudioPos.get(this.rec()) - this.el.currentTime) > 15) this.savePos();
  },
  paintTicks() {
    if (!this.bar) return;
    const r = this.rec();
    const d = this.el.duration || r?.duration || 0;
    $('.au-ticks', this.bar).innerHTML = r && d ? r.marks.map(m => `<button type="button" class="au-tick" data-tick="${m.t}" style="left:${(m.t / d) * 100}%" title="${esc(fmtT(m.t))} ${esc(m.label || '')}" aria-label="Vai a ${esc(fmtT(m.t))}"></button>`).join('') : '';
  },
  // il punto di ascolto resta sul dispositivo; va nell’elenco sincronizzato solo in pausa o alla chiusura
  savePos(flush = false) { const r = this.rec(); if (r && this.el && (this.el.currentTime > 0 || AudioPos.get(r))) { AudioPos.set(r.id, this.el.currentTime); if (flush) AudioPos.flushSoon(); } },
  saveSoon() { clearTimeout(this.saveT); this.saveT = setTimeout(() => { const s = this.sec(); if (s) saveOwner(s); }, 800); },
  async act(a) {
    if (a === 'play') { if (this.el.paused) this.el.play().catch(() => {}); else this.el.pause(); return; }
    if (a === 'back') { this.seek(this.el.currentTime - 10); return; }
    if (a === 'fwd') { this.seek(this.el.currentTime + 30); return; }
    if (a === 'close') { this.savePos(true); this.el.pause(); this.aId = ''; this.bar.hidden = true; document.body.classList.remove('au-on'); return; }
    if (a === 'open') { go(this.ownK === 'nb' ? `#/lezioni/${this.ownId}` : `#/sec/${this.ownId}/audio`); return; }
    if (a === 'mark') {
      const r = this.rec();
      if (!r) return;
      const m = { id: uid(), t: Math.floor(this.el.currentTime), label: '' };
      // in una lezione, il segnalibro nasce collegato alla sezione che stai studiando
      if (this.ownK === 'nb') { const s = currentStudySec(); m.secIds = s && s.notebookId === this.ownId ? [s.id] : []; }
      r.marks.push(m);
      r.marks.sort((x, y) => x.t - y.t);
      this.saveSoon();
      this.paintTicks();
      AudioMode.refresh();
      toast(`Segnalibro a ${fmtT(m.t)}${(m.secIds || []).length ? `, collegato a “${secById(m.secIds[0])?.title}”` : ''}`, '', { label: 'Dagli un nome', fn: async () => { const v = await modal({ title: `Segnalibro a ${fmtT(m.t)}`, input: true, value: '', placeholder: 'Es. Chiede all’esame', confirm: 'Salva' }); if (v) { m.label = String(v).trim(); this.saveSoon(); this.paintTicks(); AudioMode.refresh(); } } });
      return;
    }
    if (a === 'stamp') {
      const r = this.rec();
      insertStamp(this.el.currentTime, this.ownK === 'nb' && r ? r.name : '');
      if (this.ownK === 'nb' && r) linkMarkToStudy(r, Math.floor(this.el.currentTime), () => this.saveSoon());
    }
  }
};
// la sezione che stai studiando o scrivendo (pagina o pannello di Affianca)
function currentStudySec() {
  const ae = document.activeElement;
  if (ae && ae.closest && ae.closest('.split-edit') && typeof Split !== 'undefined' && Split.item) return secById(Split.item.id);
  const m = location.hash.match(/^#\/sec\/([^/]+)/);
  return m ? secById(m[1]) : null;
}
// ⏱ nel testo di una sezione da una lezione: il punto diventa anche un segnalibro collegato alla sezione
function linkMarkToStudy(rec, t, save) {
  const s = currentStudySec();
  if (!s) return;
  let m = rec.marks.find(x => Math.abs(x.t - t) <= 5);
  if (!m) { m = { id: uid(), t, label: '' }; rec.marks.push(m); rec.marks.sort((x, y) => x.t - y.t); }
  m.secIds = [...new Set([...(m.secIds || []), s.id])];
  save();
  AudioPlayer.paintTicks?.();
}
// scrive “⏱ 12:34” dove stai scrivendo (anteprima di Modifica, codice, blocco di testo)
function insertStamp(t, lesson = '') {
  const txt = `⏱ ${fmtT(t)}${lesson ? ` (${lesson.replace(/[()]/g, '')})` : ''} `;
  const ae = document.activeElement;
  if (ae && (ae.isContentEditable || ae.closest?.('[contenteditable="true"]'))) {
    const sel = document.getSelection();
    const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    const before = r && r.startContainer.nodeType === 3 ? r.startContainer.nodeValue.slice(0, r.startOffset) : '';
    document.execCommand('insertText', false, (before && !/\s$/.test(before) ? ' ' : '') + txt);
    return;
  }
  if (ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.type === 'text'))) {
    const pre = ae.value.slice(0, ae.selectionStart);
    ae.setRangeText((pre && !/\s$/.test(pre) ? ' ' : '') + txt, ae.selectionStart, ae.selectionEnd, 'end');
    ae.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  navigator.clipboard?.writeText(txt.trim()).catch(() => {});
  toast(`Metti il cursore nel testo (in Modifica) per scrivere ${txt.trim()}; intanto l’ho copiato`);
}
// in Leggi, i “⏱ 12:34” diventano pulsanti che portano a quel punto
function linkStamps(article, sec) {
  const nb = nbById(sec.notebookId);
  if (!audiosOf(sec).length && !(nb && (nb.audios || []).length)) return;
  // “⏱ 12:34” è l’audio della sezione; “⏱ 12:34 (Lezione 5)” è una lezione del notebook
  const re = /⏱\s?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s?\(([^)]{1,80})\))?/g;
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (re.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
  nodes.forEach(n => {
    const frag = document.createDocumentFragment();
    let last = 0;
    n.nodeValue.replace(re, (m, t, lz, i) => {
      frag.append(n.nodeValue.slice(last, i));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ts-jump';
      b.dataset.t = parseT(t);
      if (lz) b.dataset.lz = lz;
      b.textContent = lz ? `⏱ ${t} · ${lz}` : `⏱ ${t}`;
      b.title = lz ? `Ascolta la lezione “${lz}” da qui` : 'Ascolta da qui';
      frag.append(b);
      last = i + m.length;
      return m;
    });
    frag.append(n.nodeValue.slice(last));
    n.replaceWith(frag);
  });
  article.addEventListener('click', e => {
    const b = e.target.closest('.ts-jump');
    if (!b) return;
    if (b.dataset.lz && nb) {
      const f = foldAccents(b.dataset.lz).trim();
      const a = (nb.audios || []).find(x => foldAccents(x.name).replace(/[()]/g, '').trim() === f);
      if (a) { AudioPlayer.load(nb, a.id, { at: +b.dataset.t }); return; }
      toast(`Non trovo la lezione “${b.dataset.lz}” in questo notebook`, 'err');
      return;
    }
    AudioPlayer.seekSection(sec, +b.dataset.t);
  });
}

/* ---------- Registratore ---------- */
const AudioRec = {
  active: false, mr: null, chunks: [], start: 0, paused: 0, pauseAt: 0, marks: [], ownK: 'sec', ownId: '', name: '', id: '', bar: null, wake: null, tick: 0,
  elapsed() { return ((this.pauseAt || Date.now()) - this.start - this.paused) / 1000; },
  async begin(sec) {
    if (this.active) { toast('Stai già registrando'); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { toast('Questo browser non sa registrare audio', 'err'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } }); }
    catch { toast('Serve il permesso del microfono: consentilo nelle impostazioni del browser', 'err'); return; }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';
    this.mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
    this.chunks = [];
    this.marks = [];
    this.ownK = isSecRec(sec) ? 'sec' : 'nb';
    this.ownId = sec.id;
    this.name = `${isSecRec(sec) ? 'Registrazione' : 'Lezione'} ${new Date().toLocaleDateString('it-IT')} ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
    this.id = uid();
    this.start = Date.now();
    this.paused = 0;
    this.pauseAt = 0;
    this.active = true;
    this.mr.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.mr.start(5000);
    try { if (navigator.wakeLock) this.wake = await navigator.wakeLock.request('screen'); } catch { this.wake = null; }
    if (AudioPlayer.isOn()) AudioPlayer.el.pause();
    this.showBar();
  },
  showBar() {
    if (!this.bar) {
      const bar = document.createElement('div');
      bar.className = 'ink-bar au-bar rec-bar';
      bar.innerHTML = `<span class="rec-dot" aria-hidden="true"></span><b class="rec-t">0:00</b><small class="rec-where"></small>
        <button type="button" class="btn sm" data-rc="mark" title="Segnalibro in questo punto (Alt+B)">＋ Segnalibro</button>
        <button type="button" class="btn sm ghost" data-rc="stamp" title="Scrive il minuto nel testo (Alt+T)">⏱ Nel testo</button>
        <button type="button" class="btn sm ghost" data-rc="pause">Pausa</button>
        <button type="button" class="btn sm danger-solid" data-rc="stop">■ Ferma e salva</button>`;
      document.body.append(bar);
      bar.addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); });
      bar.addEventListener('click', e => { const b = e.target.closest('[data-rc]'); if (b) this.act(b.dataset.rc); });
      document.addEventListener('keydown', e => {
        if (!this.active || !e.altKey) return;
        if (e.key === 'b' || e.key === 'B') { e.preventDefault(); e.stopImmediatePropagation(); this.act('mark'); }
        if (e.key === 't' || e.key === 'T') { e.preventDefault(); e.stopImmediatePropagation(); this.act('stamp'); }
      }, true);
      window.addEventListener('pagehide', () => { if (this.active) this.stop(true); });
      this.bar = bar;
    }
    this.bar.hidden = false;
    document.body.classList.add('au-on');
    { const o = audioOwner(this.ownK, this.ownId); $('.rec-where', this.bar).textContent = o ? ownerTitle(o) : ''; }
    clearInterval(this.tick);
    this.tick = setInterval(() => { $('.rec-t', this.bar).textContent = fmtT(this.elapsed()); }, 500);
  },
  act(a) {
    if (a === 'mark') {
      const t = Math.floor(this.elapsed());
      const m = { id: uid(), t, label: '' };
      if (this.ownK === 'nb') { const s = currentStudySec(); if (s && s.notebookId === this.ownId) m.secIds = [s.id]; }
      this.marks.push(m);
      toast(`Segnalibro a ${fmtT(t)}: il nome lo dai dopo, ${this.ownK === 'nb' ? 'nella pagina Lezioni' : 'nella scheda Audio'}`);
    }
    if (a === 'stamp') {
      insertStamp(this.elapsed(), this.ownK === 'nb' ? this.name : '');
      if (this.ownK === 'nb') linkMarkToStudy({ marks: this.marks }, Math.floor(this.elapsed()), () => {});
    }
    if (a === 'pause') {
      if (this.mr.state === 'recording') { this.mr.pause(); this.pauseAt = Date.now(); $('[data-rc="pause"]', this.bar).textContent = 'Riprendi'; this.bar.classList.add('paused'); }
      else { this.mr.resume(); this.paused += Date.now() - this.pauseAt; this.pauseAt = 0; $('[data-rc="pause"]', this.bar).textContent = 'Pausa'; this.bar.classList.remove('paused'); }
    }
    if (a === 'stop') this.stop();
  },
  async stop(quiet = false) {
    if (!this.active) return;
    this.active = false;
    clearInterval(this.tick);
    const dur = this.elapsed();
    await new Promise(r => { this.mr.onstop = r; try { this.mr.stop(); } catch { r(); } });
    this.mr.stream.getTracks().forEach(t => t.stop());
    try { await this.wake?.release(); } catch { /* niente */ }
    this.wake = null;
    this.bar.hidden = true;
    if (!AudioPlayer.isOn()) document.body.classList.remove('au-on');
    const sec = audioOwner(this.ownK, this.ownId);
    const blob = new Blob(this.chunks, { type: this.mr.mimeType || 'audio/webm' });
    this.chunks = [];
    if (!sec || !blob.size) { if (!quiet) toast('Registrazione vuota', 'err'); return; }
    const ext = /mp4/.test(blob.type) ? 'm4a' : 'webm';
    const name = isSecRec(sec) ? this.name : uniqueLessonName(sec, this.name);
    const file = new File([blob], `${name.replace(/[/:]/g, '-')}.${ext}`, { type: blob.type });
    try { await AudioDB.put(this.id, file); } catch (err) { toast(err.message || 'Non riesco a salvare la registrazione', 'err'); return; }
    audiosOf(sec).push({ id: this.id, name, size: file.size, type: file.type, duration: dur, marks: this.marks, created: Date.now(), recorded: true, ...(isSecRec(sec) ? {} : { secIds: [] }) });
    await saveOwner(sec);
    if (!quiet) toast(`Registrazione salvata (${fmtT(dur)}, ${this.marks.length} segnalibri)`, '', { label: 'Apri', fn: () => go(isSecRec(sec) ? `#/sec/${sec.id}/audio` : `#/lezioni/${sec.id}`) });
    AudioMode.refresh();
  }
};

/* ---------- Scheda Audio della sezione ---------- */
const AudioMode = { refresh() { const h = location.hash; if ((/^#\/sec\/[^/]+\/audio/.test(h) || /^#\/lezioni\//.test(h)) && !$('#modalRoot').children.length && !document.activeElement?.matches('input, textarea')) { const y = window.scrollY; route(); window.scrollTo(0, y); } } };
function modeAudio(sec, body) {
  const list = audiosOf(sec);
  body.innerHTML = `
    <div class="row-actions">
      <label class="btn primary file-btn">Carica un audio<input type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.webm,.flac" multiple hidden id="auFile"></label>
      <button class="btn" type="button" data-act="au-rec">● Registra</button>
      ${DriveAudio.ready() ? '<button class="btn" type="button" data-act="au-drive">Da Google Drive</button>' : ''}
    </div>
    ${lessonBlockHtml(sec)}
    <p class="hint">Il lettore resta in basso anche se passi a Leggi o Modifica: scrivi mentre ascolti. <strong>＋ Segnalibro</strong> segna il punto (Alt+B al computer), <strong>⏱ Nel testo</strong> scrive il minuto dove hai il cursore (Alt+T): in Leggi quel minuto diventa un pulsante che fa ripartire l’audio da lì. I file audio restano su questo dispositivo (o su Drive, se li carichi lì o li prendi da lì); nome, durata e segnalibri si sincronizzano con la sezione.</p>
    ${list.length > 1 ? `<div class="au-tools">${audioSortHtml(sec)}</div>` : ''}
    ${list.length ? audioOrder(sec).map(a => `
      <section class="au-item" data-aid="${a.id}">
        <div class="au-head">
          <button type="button" class="btn sm primary" data-a="play" aria-label="Ascolta ${esc(a.name)}">▶</button>
          <div class="au-meta"><b>${esc(a.name)}</b><small>${[a.duration ? fmtT(a.duration) : '', a.size ? fmtSize(a.size) : '', a.recorded ? 'registrato' : '', new Date(a.created).toLocaleDateString('it-IT')].filter(Boolean).join(' · ')}<span class="au-miss" hidden></span></small><small class="au-drv" data-drv="${a.id}" hidden></small></div>
          ${audioMoveBtns(sec, a)}
          <button type="button" class="btn sm ghost" data-a="menu" aria-label="Altro">⋯</button>
        </div>
        ${a.marks.length ? `<ol class="au-marks">${a.marks.map(m => `<li><button type="button" class="link-btn" data-mt="${m.t}">${fmtT(m.t)}</button> <span class="au-ml">${esc(m.label || 'Senza nome')}</span>
          <button type="button" class="btn sm ghost" data-mr="${m.id}" aria-label="Rinomina">✎</button><button type="button" class="btn sm ghost" data-md="${m.id}" aria-label="Elimina il segnalibro">✕</button></li>`).join('')}</ol>` : '<p class="hint">Nessun segnalibro: aggiungili mentre ascolti.</p>'}
      </section>`).join('') : '<div class="empty"><p>Nessun audio in questa sezione. Carica la registrazione di una lezione, oppure registra adesso.</p></div>'}
  `;
  // dov’è il file: qui, su Drive, altrove
  paintAudioWhere(body, list);
  list.forEach(a => DriveAudio.paint(a.id));
  const onJob = e => { if (!e.detail.job && list.some(a => a.id === e.detail.id)) paintAudioWhere(body, list); };
  window.addEventListener('nb-drive-job', onJob);
  addCleanup(() => window.removeEventListener('nb-drive-job', onJob));
  on('[data-act="au-drive"]', 'click', () => driveAudioSheet(sec), body);
  bindAudioOrder(body, sec);
  $('#auFile', body).addEventListener('change', async e => {
    const files = [...e.target.files];
    let n = 0;
    for (const f of files) if (await addAudioFile(sec, f)) n++;
    if (n) { toast(n === 1 ? 'Audio aggiunto' : `${n} audio aggiunti`); route(); }
  });
  on('[data-act="au-rec"]', 'click', () => AudioRec.begin(sec), body);
  bindLessonBlock(body, sec);
  body.addEventListener('click', async e => {
    const it = e.target.closest('.au-item');
    if (!it) return;
    const a = list.find(x => x.id === it.dataset.aid);
    if (!a) return;
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.a === 'play') { await AudioPlayer.load(sec, a.id); return; }
    if (b.dataset.mt !== undefined) { if (AudioPlayer.aId === a.id) { AudioPlayer.seek(+b.dataset.mt); AudioPlayer.el.play().catch(() => {}); } else await AudioPlayer.load(sec, a.id, { at: +b.dataset.mt }); return; }
    if (b.dataset.mr) { const m = a.marks.find(x => x.id === b.dataset.mr); const v = await modal({ title: `Segnalibro a ${fmtT(m.t)}`, input: true, value: m.label || '', confirm: 'Salva', allowEmpty: true }); if (v !== null && v !== undefined) { m.label = String(v).trim(); await saveSection(sec); route(); } return; }
    if (b.dataset.md) { a.marks = a.marks.filter(x => x.id !== b.dataset.md); await saveSection(sec); AudioPlayer.paintTicks?.(); route(); return; }
    if (b.dataset.a === 'menu') {
      const local = it.dataset.local === '1';
      const ch = await actionSheet(a.name, [{ key: 'rename', label: 'Rinomina' }, { key: 'tolesson', label: 'Sposta nelle lezioni del notebook' }, ...lessonAiItems(), ...driveMenuItems(a, local), { key: 'reload', label: 'Ricarica il file (se qui manca)' }, { key: 'save', label: 'Salva il file (nei Download)' }, { key: 'del', label: 'Elimina l’audio', danger: true }]);
      if (await lessonAiAct(ch, sec, a)) return;
      if (await driveMenuAct(ch, sec, a)) return;
      if (ch === 'tolesson') {
        // la lezione resta collegata a questa sezione, con i suoi segnalibri
        const nb = nbById(sec.notebookId);
        if (!nb) return;
        if (AudioPlayer.aId === a.id) AudioPlayer.act('close');
        sec.audios = list.filter(x => x.id !== a.id);
        a.secIds = [sec.id];
        a.name = uniqueLessonName(nb, a.name, a.id);
        a.marks = (a.marks || []).map(m => ({ ...m, secIds: [sec.id] }));
        nb.audios = [...(nb.audios || []), a];
        await saveSection(sec);
        await saveNotebook(nb);
        toast(`“${a.name}” è ora nelle lezioni di ${nb.name}, collegata a questa sezione`, '', { label: 'Apri', fn: () => go(`#/lezioni/${nb.id}`) });
        route();
        return;
      }
      if (ch === 'rename') { const v = await modal({ title: 'Rinomina l’audio', input: true, value: a.name, confirm: 'Salva' }); if (v) { a.name = String(v).trim(); await saveSection(sec); route(); } }
      if (ch === 'save') { const f = await AudioDB.get(a.id); if (f) downloadBlob(f, f.name || `${a.name}.webm`); else toast('Il file non è su questo dispositivo', 'err'); }
      if (ch === 'reload') {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'audio/*';
        inp.onchange = async () => { const f = inp.files[0]; if (!f) return; await AudioDB.put(a.id, f); a.size = f.size; if (!a.duration) a.duration = await audioDuration(f); await saveSection(sec); toast('File ricollegato: i segnalibri restano'); route(); };
        inp.click();
      }
      if (ch === 'del') {
        if (!(await modal({ title: 'Eliminare l’audio?', text: 'Spariscono il file e i suoi segnalibri. I minuti scritti nel testo restano, ma non portano più a niente.', confirm: 'Elimina', danger: true }))) return;
        if (AudioPlayer.aId === a.id) AudioPlayer.act('close');
        sec.audios = list.filter(x => x.id !== a.id);
        await saveSection(sec);
        await AudioDB.del(a.id);
        route();
      }
    }
  });
}

/* ---------- v3.76: Lezioni del notebook ----------
   Audio di lezioni che parlano di più argomenti: stanno nel notebook (nb.audios),
   con segnalibri e sezioni collegate (alla lezione intera o a ogni segnalibro). */
function pickNbSectionSheet(nb, { title = 'Collega una sezione', exclude = [] } = {}) {
  return new Promise(resolve => {
    const ex = new Set(exclude);
    const secs = secsOf(nb.id).filter(s => !ex.has(s.id)).sort((a, b) => a.title.localeCompare(b.title, 'it'));
    if (!secs.length) { toast('Tutte le sezioni di questo notebook sono già collegate'); resolve(null); return; }
    const sh = openSheet(`
      <h2>${esc(title)}</h2>
      <input type="search" class="input search" id="nbSecQ" placeholder="Cerca per titolo o cartella…" aria-label="Cerca una sezione">
      <ul class="list pick-list" id="nbSecL"></ul>
      <div class="modal-actions"><button class="btn ghost" type="button" data-nbs="no">Annulla</button></div>`, { label: title, onClose: v => resolve(v || null) });
    const qEl = $('#nbSecQ', sh.el), listEl = $('#nbSecL', sh.el);
    const draw = () => {
      const hits = secs.filter(s => matchTokens(`${s.title} ${groupPathText(s)}`, qEl.value)).slice(0, 80);
      listEl.innerHTML = hits.map(s => `<li><button type="button" class="row" data-nbs="${s.id}"><span class="row-main"><span class="row-title">${esc(s.title)}</span>${groupPathText(s) ? `<span class="row-sub">${esc(groupPathText(s))}</span>` : ''}</span></button></li>`).join('') || '<li class="hint">Nessuna sezione trovata.</li>';
    };
    draw();
    qEl.addEventListener('input', draw);
    sh.el.addEventListener('click', e => {
      const b = e.target.closest('[data-nbs]');
      if (!b) return;
      sh.close(b.dataset.nbs === 'no' ? null : b.dataset.nbs);
    });
    setTimeout(() => qEl.focus(), 40);
  });
}
const lzState = { q: '' };
function viewLessons(nbId) {
  const nb = nbById(nbId);
  if (!nb || nb.kind) return notFound('Questo notebook');
  const list = audiosOf(nb);
  const tot = list.reduce((a, x) => a + (x.duration || 0), 0);
  const chips = ids => (ids || []).map(id => secById(id)).filter(Boolean).map(s => `<span class="tag">${esc(s.title)}<button type="button" class="tag-x" data-lzun="${s.id}" aria-label="Scollega ${esc(s.title)}">×</button></span>`).join('');
  setView(`
    <a class="back" href="#/nb/${nb.id}">${esc(nb.name)}</a>
    <header class="page-head">
      <div><h1>Lezioni</h1><p class="lede">${list.length ? `${list.length} ${list.length === 1 ? 'lezione' : 'lezioni'}${tot ? `, ${fmtT(tot)} in tutto` : ''}. ` : ''}Gli audio delle lezioni che parlano di più argomenti: segnalibri con nome, collegati alle sezioni del notebook.</p></div>
      <div class="actions">
        <label class="btn primary file-btn">Carica un audio<input type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.webm,.flac" multiple hidden id="lzFile"></label>
        <button class="btn" type="button" data-act="lz-rec">● Registra la lezione</button>
        ${DriveAudio.ready() ? '<button class="btn" type="button" data-act="lz-drive">Da Google Drive</button>' : ''}
      </div>
    </header>
    <div class="lz-drvbar" id="lzDrvBar" hidden></div>
    <p class="hint">Mentre ascolti, <strong>＋ Segnalibro</strong> segna il punto (Alt+B): se stai studiando una sezione di questo notebook, il segnalibro nasce già collegato a lei. <strong>⏱ Nel testo</strong> scrive il minuto e il nome della lezione negli appunti (Alt+T); in Leggi riparte da lì. Ogni sezione mostra i punti delle lezioni che la riguardano.</p>
    <div class="au-tools" id="lzTools">${list.length > 2 ? `<input type="search" class="input search" id="lzQ" placeholder="Cerca nelle lezioni, nei segnalibri e nelle sezioni collegate" aria-label="Cerca nelle lezioni" value="${esc(lzState.q)}">` : ''}${audioSortHtml(nb)}</div>
    <div id="lzList">
    ${list.length ? audioOrder(nb).map(a => `
      <section class="au-item lz-item" data-aid="${a.id}" data-find="${esc(foldAccents(`${a.name} ${(a.marks || []).map(m => m.label).join(' ')} ${[...(a.secIds || []), ...(a.marks || []).flatMap(m => m.secIds || [])].map(id => secById(id)?.title || '').join(' ')}`))}">
        <div class="au-head">
          <button type="button" class="btn sm primary" data-a="play" aria-label="Ascolta ${esc(a.name)}">▶</button>
          <div class="au-meta"><b>${esc(a.name)}</b><small>${[a.duration ? fmtT(a.duration) : '', a.size ? fmtSize(a.size) : '', a.recorded ? 'registrata' : '', new Date(a.created).toLocaleDateString('it-IT'), AudioPos.get(a) ? `ascoltata fino a ${fmtT(AudioPos.get(a))}` : ''].filter(Boolean).join(' · ')}<span class="au-miss" hidden></span></small><small class="au-drv" data-drv="${a.id}" hidden></small></div>
          ${audioMoveBtns(nb, a)}
          <button type="button" class="btn sm ghost" data-a="menu" aria-label="Altro">⋯</button>
        </div>
        <div class="lz-secs"><span class="lbl">Sezioni della lezione:</span> <span class="tags" data-scope="lesson">${chips(a.secIds) || '<span class="hint">nessuna</span>'}</span>
          <button type="button" class="btn sm ghost lz-add-btn" data-addto="lesson" aria-label="Collega la lezione a una sezione">＋ Collega una sezione</button></div>
        ${(a.marks || []).length ? `<ol class="au-marks lz-marks">${a.marks.map(m => `<li data-mid="${m.id}">
          <div class="lz-mrow"><button type="button" class="link-btn" data-mt="${m.t}">${fmtT(m.t)}</button> <span class="au-ml">${esc(m.label || 'Senza nome')}</span>
          <button type="button" class="btn sm ghost" data-mr="${m.id}" aria-label="Rinomina">✎</button><button type="button" class="btn sm ghost" data-md="${m.id}" aria-label="Elimina il segnalibro">✕</button></div>
          <div class="lz-mlink"><span class="tags" data-scope="mark">${chips(m.secIds)}</span>
          <button type="button" class="btn sm ghost lz-add-btn" data-addto="mark" aria-label="Collega il segnalibro a una sezione">＋ Sezione</button></div></li>`).join('')}</ol>` : '<p class="hint">Nessun segnalibro: aggiungili mentre ascolti, oppure <button type="button" class="link-btn" data-a="ai-marks">✨ falli proporre a Gemini</button>.</p>'}
      </section>`).join('') : '<div class="empty"><p>Nessuna lezione. Carica la registrazione di una lezione (anche lunga e su più argomenti), oppure registrala adesso. Poi segni i punti e li colleghi alle sezioni.</p></div>'}
    </div>`);
  // dov’è il file di ogni lezione; in cima, quante sono da scaricare o da caricare su Drive
  const paintDrv = () => {
    paintAudioWhere($('#lzList'), list);
    AudioDB.keys().then(keys => {
      const have = new Set(keys);
      const bar = $('#lzDrvBar');
      if (!bar || !DriveAudio.ready()) return;
      const down = list.filter(a => a.drive && !have.has(a.id) && !DriveAudio.busy(a.id));
      const up = list.filter(a => !a.drive && have.has(a.id) && !DriveAudio.busy(a.id));
      bar.innerHTML = `${down.length ? `<button class="btn sm" type="button" data-lzd="down">Scarica qui per l’ascolto offline (${down.length})</button>` : ''}${up.length ? `<button class="btn sm" type="button" data-lzd="up">Carica su Drive per gli altri dispositivi (${up.length})</button>` : ''}`;
      bar.hidden = !down.length && !up.length;
      bar.dataset.down = down.map(a => a.id).join(',');
      bar.dataset.up = up.map(a => a.id).join(',');
    });
  };
  paintDrv();
  list.forEach(a => DriveAudio.paint(a.id));
  const onJob = e => { if (!e.detail.job && list.some(a => a.id === e.detail.id)) paintDrv(); };
  window.addEventListener('nb-drive-job', onJob);
  addCleanup(() => window.removeEventListener('nb-drive-job', onJob));
  on('[data-act="lz-drive"]', 'click', () => driveAudioSheet(nb));
  bindAudioOrder($('#lzTools'), nb);
  bindAudioOrder($('#lzList'), nb);
  $('#lzDrvBar').addEventListener('click', async e => {
    const b = e.target.closest('[data-lzd]');
    if (!b) return;
    const ids = ($('#lzDrvBar').dataset[b.dataset.lzd] || '').split(',').filter(Boolean);
    b.disabled = true;
    let ok = 0, err = '';
    for (const id of ids) {
      const a = list.find(x => x.id === id);
      if (!a) continue;
      try { if (b.dataset.lzd === 'down') await DriveAudio.download(a); else await DriveAudio.upload(nb, a); ok++; } catch (x) { err = x.message || 'non riuscito'; break; }
    }
    if (ok) toast(b.dataset.lzd === 'down' ? `${ok} ${ok === 1 ? 'lezione scaricata' : 'lezioni scaricate'}: si ascoltano anche offline` : `${ok} ${ok === 1 ? 'lezione caricata' : 'lezioni caricate'} su Drive`);
    if (err) toast(err, 'err');
    AudioMode.refresh();
  });
  $('#lzQ')?.addEventListener('input', e => {
    lzState.q = e.target.value;
    const f = foldAccents(lzState.q.trim());
    $$('.lz-item').forEach(it => { it.hidden = !!f && !it.dataset.find.includes(f); });
  });
  if (lzState.q) $('#lzQ')?.dispatchEvent(new Event('input'));
  $('#lzFile').addEventListener('change', async e => {
    let n = 0;
    for (const f of [...e.target.files]) if (await addAudioFile(nb, f)) n++;
    if (n) { toast(n === 1 ? 'Lezione aggiunta' : `${n} lezioni aggiunte`); route(); }
  });
  on('[data-act="lz-rec"]', 'click', () => AudioRec.begin(nb));
  const box = $('#lzList');
  const find = it => list.find(x => x.id === it?.dataset.aid);
  box.addEventListener('click', async e => {
    const addBtn = e.target.closest('[data-addto]');
    if (!addBtn) return;
    const a = find(addBtn.closest('.au-item'));
    if (!a) return;
    const isLesson = addBtn.dataset.addto === 'lesson';
    const mark = isLesson ? null : a.marks.find(x => x.id === addBtn.closest('[data-mid]')?.dataset.mid);
    if (!isLesson && !mark) return;
    const pickedId = await pickNbSectionSheet(nb, {
      title: isLesson ? `Collega sezione a “${a.name}”` : `Collega sezione a “${mark.label || fmtT(mark.t)}”`,
      exclude: isLesson ? (a.secIds || []) : (mark.secIds || [])
    });
    if (!pickedId) return;
    if (isLesson) a.secIds = [...new Set([...(a.secIds || []), pickedId])];
    else mark.secIds = [...new Set([...(mark.secIds || []), pickedId])];
    await saveNotebook(nb);
    AudioMode.refresh();
  });
  box.addEventListener('click', async e => {
    const it = e.target.closest('.au-item');
    const a = find(it);
    if (!a) return;
    const un = e.target.closest('[data-lzun]');
    if (un) {
      const li = un.closest('[data-mid]');
      if (li) { const m = a.marks.find(x => x.id === li.dataset.mid); if (m) m.secIds = (m.secIds || []).filter(id => id !== un.dataset.lzun); }
      else a.secIds = (a.secIds || []).filter(id => id !== un.dataset.lzun);
      await saveNotebook(nb);
      AudioMode.refresh();
      return;
    }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.a === 'play') { await AudioPlayer.load(nb, a.id); return; }
    if (b.dataset.a === 'ai-marks') { await lessonAiAct('ai-marks', nb, a); return; }
    if (b.dataset.mt !== undefined) { if (AudioPlayer.aId === a.id) { AudioPlayer.seek(+b.dataset.mt); AudioPlayer.el.play().catch(() => {}); } else await AudioPlayer.load(nb, a.id, { at: +b.dataset.mt }); return; }
    if (b.dataset.mr) { const m = a.marks.find(x => x.id === b.dataset.mr); const v = await modal({ title: `Segnalibro a ${fmtT(m.t)}`, input: true, value: m.label || '', confirm: 'Salva', allowEmpty: true }); if (v !== null && v !== undefined) { m.label = String(v).trim(); await saveNotebook(nb); route(); } return; }
    if (b.dataset.md) { a.marks = a.marks.filter(x => x.id !== b.dataset.md); await saveNotebook(nb); AudioPlayer.paintTicks?.(); route(); return; }
    if (b.dataset.a === 'menu') {
      const local = it.dataset.local === '1';
      const ch = await actionSheet(a.name, [{ key: 'rename', label: 'Rinomina' }, ...lessonAiItems(), ...driveMenuItems(a, local), { key: 'reload', label: 'Ricarica il file (se qui manca)' }, { key: 'save', label: 'Salva il file (nei Download)' }, { key: 'del', label: 'Elimina la lezione', danger: true }]);
      if (await lessonAiAct(ch, nb, a)) return;
      if (await driveMenuAct(ch, nb, a)) return;
      if (ch === 'rename') { const v = await modal({ title: 'Rinomina la lezione', text: 'I minuti già scritti negli appunti con il vecchio nome (⏱ 12:34 (nome)) non la ritroverebbero più: correggili, o tieni il nome.', input: true, value: a.name, confirm: 'Salva' }); if (v) { a.name = uniqueLessonName(nb, String(v).trim(), a.id); await saveNotebook(nb); route(); } }
      if (ch === 'save') { const f = await AudioDB.get(a.id); if (f) downloadBlob(f, f.name || `${a.name}.webm`); else toast('Il file non è su questo dispositivo', 'err'); }
      if (ch === 'reload') {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'audio/*';
        inp.onchange = async () => { const f = inp.files[0]; if (!f) return; await AudioDB.put(a.id, f); a.size = f.size; if (!a.duration) a.duration = await audioDuration(f); await saveNotebook(nb); toast('File ricollegato: segnalibri e collegamenti restano'); route(); };
        inp.click();
      }
      if (ch === 'del') {
        if (!(await modal({ title: 'Eliminare la lezione?', text: `Spariscono il file su questo dispositivo, i segnalibri e i collegamenti alle sezioni.${a.drive ? ' Il file su Drive resta dov’è.' : ''} I minuti scritti negli appunti restano, ma non portano più a niente.`, confirm: 'Elimina', danger: true }))) return;
        if (AudioPlayer.aId === a.id) AudioPlayer.act('close');
        nb.audios = list.filter(x => x.id !== a.id);
        await saveNotebook(nb);
        await AudioDB.del(a.id);
        route();
      }
    }
  });
}

/* ---------- Stampa o salva in PDF ----------
   Una pagina pulita con gli appunti (cloze visibili, titoli aperti, immagini),
   poi la finestra di stampa del sistema: lì scegli la stampante o “Salva come PDF”. */
function viewPrint(kind, id) {
  let title = '', secs = [];
  if (kind === 'sec') { const s = secById(id); if (!s) return notFound('Questa sezione'); title = s.title; secs = [s]; }
  else if (kind === 'nb') {
    const nb = nbById(id);
    if (!nb) return notFound('Questo notebook');
    title = nb.name;
    secs = nbReadingOrder(nb).filter(s => String(s.md || '').trim());
  } else return notFound('Questa pagina');
  const back = kind === 'sec' ? `#/sec/${id}/read` : `#/nb/${id}`;
  const nbName = kind === 'sec' ? nbById(secs[0].notebookId)?.name || '' : '';
  setView(`
    <div class="print-tools">
      <a class="back" href="${back}">Torna indietro</a>
      <div class="inline">
        <label class="check"><input type="checkbox" id="prCz"><span>Nascondi i cloze (per esercitarti su carta)</span></label>
        <button class="btn primary" type="button" data-act="print">Stampa o salva in PDF</button>
      </div>
      <p class="hint">Nella finestra di stampa scegli la stampante oppure “Salva come PDF”. ${kind === 'nb' ? `${secs.length} sezioni, ognuna da una pagina nuova.` : ''}</p>
    </div>
    <article class="print-doc">
      <header class="print-head"><h1>${esc(title)}</h1>${nbName ? `<p class="meta">${esc(nbName)}${groupPathText(secs[0]) ? ` › ${esc(groupPathText(secs[0]))}` : ''}</p>` : ''}</header>
      ${secs.map((s, i) => `
        <section class="print-sec">
          ${kind === 'nb' ? `<h1 class="print-sec-t">${esc(s.title)}</h1>${groupPathText(s) ? `<p class="meta">${esc(groupPathText(s))}</p>` : ''}` : ''}
          <div class="notes">${renderMd(s.md)}</div>
          ${sourcesOf(s).length ? `<p class="print-src">Fonti: ${sourcesOf(s).map(esc).join('; ')}</p>` : ''}
        </section>`).join('')}
    </article>`);
  document.body.classList.add('print-page');
  addCleanup(() => document.body.classList.remove('print-page', 'print-hide-cz'));
  $('#prCz').onchange = e => document.body.classList.toggle('print-hide-cz', e.target.checked);
  $('[data-act="print"]').onclick = async () => {
    // aspetto che le immagini siano caricate, se no escono vuote
    const imgs = $$('.print-doc img');
    await Promise.race([Promise.all(imgs.map(im => (im.complete && im.naturalWidth ? null : new Promise(r => { im.addEventListener('load', r, { once: true }); im.addEventListener('error', r, { once: true }); })))), sleep(4000)]);
    window.print();
  };
}

/* ---------- Ascolto in sequenza: una sezione dopo l’altra, anche cambiando pagina ---------- */
function listenBlocksOf(article) {
  return $$('h1, h2, h3, h4, p, li, tr, blockquote, pre', article).filter(el => {
    if (el.closest('.html-embed, .img-box, pre code') && el.tagName !== 'PRE') return false;
    if (el.tagName === 'LI' && el.querySelector('li')) return !!el.firstChild?.textContent?.trim();
    if (el.tagName === 'P' && el.closest('li, blockquote')) return false;
    return el.textContent.trim().length > 0;
  });
}
function listenTextOf(el) {
  if (el.tagName === 'TR') return [...el.children].map(td => td.textContent.trim()).filter(Boolean).join('; ');
  const c = el.cloneNode(true);
  c.querySelectorAll('ul, ol, button, .czm-btn').forEach(x => { if (el.tagName === 'LI' || !/^(UL|OL)$/.test(x.tagName)) x.remove(); });
  c.querySelectorAll('.pnote').forEach(x => x.remove());
  return c.textContent.replace(/\s+/g, ' ').trim();
}
const Playlist = {
  secs: [], si: 0, parts: [], pi: 0, playing: false, token: 0, bar: null, wake: null, label: '',
  active() { return !!this.secs.length; },
  start(secs, label = '', from = 0) {
    secs = secs.filter(s => s && String(s.md || '').trim());
    if (!secs.length) { toast('Niente da ascoltare qui: le sezioni sono vuote'); return; }
    if (!canSpeak && !Voice.useGemini()) { toast('Questo browser non sa leggere ad alta voce', 'err'); return; }
    if (typeof PdfReader !== 'undefined' && PdfReader.active()) PdfReader.stop(true);
    this.stop(true);
    this.secs = secs;
    this.si = Math.max(0, Math.min(secs.length - 1, from));
    this.label = label;
    this.buildBar();
    this.load();
    this.setPlay(true);
  },
  load() {
    const sec = this.secs[this.si];
    const box = document.createElement('div');
    box.innerHTML = renderMd(sec.md);
    const parts = listenBlocksOf(box).map(listenTextOf).filter(Boolean);
    // se gli appunti iniziano con lo stesso titolo, non lo leggo due volte
    if (parts.length && foldAccents(parts[0]).replace(/[^a-z0-9]+/g, '') === foldAccents(sec.title).replace(/[^a-z0-9]+/g, '')) parts.shift();
    this.parts = [`${sec.title}.`, ...parts];
    this.pi = 0;
    this.paint();
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: sec.title, artist: nbById(sec.notebookId)?.name || 'Notebook', album: this.label || 'Ascolto in sequenza' });
        navigator.mediaSession.setActionHandler('play', () => this.setPlay(true));
        navigator.mediaSession.setActionHandler('pause', () => this.setPlay(false));
        navigator.mediaSession.setActionHandler('nexttrack', () => this.jumpSec(1));
        navigator.mediaSession.setActionHandler('previoustrack', () => this.jumpSec(-1));
      } catch { /* non tutti i browser */ }
    }
  },
  buildBar() {
    if (this.bar) return;
    const bar = document.createElement('div');
    bar.className = 'ink-bar tts-bar pl-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Ascolto in sequenza');
    bar.innerHTML = `
      <div class="pl-info"><small class="pl-what"></small><b class="pl-title"></b></div>
      <div class="pl-ctrl">
        <button type="button" class="btn sm ghost" data-pl="prev" aria-label="Sezione precedente">⏮</button>
        <button type="button" class="btn sm primary pl-play" data-pl="play">Pausa</button>
        <button type="button" class="btn sm ghost" data-pl="next" aria-label="Sezione successiva">⏭</button>
        <select class="input ink-size" data-pl-rate aria-label="Velocità">${[0.8, 1, 1.2, 1.4, 1.7].map(r => `<option value="${r}">${String(r).replace('.', ',')}×</option>`).join('')}</select>
        <button type="button" class="btn sm ghost" data-pl="open" title="Apri la sezione che sta leggendo">Apri</button>
        <button type="button" class="btn sm ghost" data-pl="stop" aria-label="Chiudi l’ascolto">✕</button>
      </div>`;
    document.body.append(bar);
    this.bar = bar;
    $('[data-pl-rate]', bar).value = String(S().ttsRate || 1);
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-pl]');
      if (!b) return;
      const a = b.dataset.pl;
      if (a === 'play') this.setPlay(!this.playing);
      if (a === 'next') this.jumpSec(1);
      if (a === 'prev') this.jumpSec(this.pi > 2 ? 0 : -1);
      if (a === 'open') { const s = this.secs[this.si]; if (s) go(`#/sec/${s.id}/read`); }
      if (a === 'stop') this.stop();
    });
    $('[data-pl-rate]', bar).addEventListener('change', e => { S().ttsRate = +e.target.value; Settings.save(); if (this.playing) this.speak(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && this.playing) this.keepAwake(true); });
  },
  paint() {
    if (!this.bar) return;
    const s = this.secs[this.si];
    $('.pl-title', this.bar).textContent = s ? s.title : '';
    $('.pl-what', this.bar).textContent = `${this.label ? `${this.label} · ` : ''}sezione ${this.si + 1} di ${this.secs.length}${this.parts.length ? ` · ${Math.min(this.pi + 1, this.parts.length)}/${this.parts.length}` : ''}`;
    $('.pl-play', this.bar).textContent = this.playing ? 'Pausa' : 'Riprendi';
    document.body.classList.add('pl-on');
  },
  async keepAwake(on) {
    try {
      if (on && !this.wake && navigator.wakeLock) this.wake = await navigator.wakeLock.request('screen');
      if (!on && this.wake) { await this.wake.release(); this.wake = null; }
    } catch { this.wake = null; }
  },
  setPlay(v) {
    this.playing = v;
    this.keepAwake(v);
    if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = v ? 'playing' : 'paused'; } catch { /* niente */ } }
    if (v) this.speak(); else { this.token++; Voice.stop(); if (canSpeak) speechSynthesis.cancel(); }
    this.paint();
  },
  jumpSec(d) {
    const n = this.si + d;
    if (n < 0) { this.pi = 0; if (this.playing) this.speak(); return; }
    if (n >= this.secs.length) { this.stop(); toast('Fine dell’ascolto'); return; }
    this.si = n;
    this.load();
    if (this.playing) this.speak(); else this.paint();
  },
  advance() {
    this.pi++;
    if (this.pi >= this.parts.length) { this.jumpSec(1); return; }
    this.paint();
    this.speak();
  },
  speak() {
    const my = ++this.token;
    Voice.stop();
    if (canSpeak) speechSynthesis.cancel();
    const text = this.parts[this.pi];
    if (text === undefined) { this.advance(); return; }
    this.paint();
    const rate = +(S().ttsRate || 1);
    if (Voice.useGemini()) {
      Voice.play(text, rate).then(r => { if (my === this.token && this.playing && r !== 'stopped') this.advance(); })
        .catch(err => { if (my !== this.token) return; toast(`${err.message} Continuo con la voce del telefono.`, 'err'); S().ttsEngine = 'system'; Settings.save(); if (this.playing) this.speak(); });
      const nx = this.parts[this.pi + 1];
      if (nx) Voice.fetch(nx).catch(() => {});
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'it-IT';
    const v = pickItalianVoice();
    if (v) u.voice = v;
    u.rate = rate;
    u.onend = () => { if (my === this.token && this.playing) setTimeout(() => { if (my === this.token && this.playing) this.advance(); }, this.pi === 0 ? 450 : 60); };
    u.onerror = e => { if (my === this.token && e.error !== 'interrupted' && e.error !== 'canceled' && this.playing) this.advance(); };
    speechSynthesis.speak(u);
  },
  stop(quiet = false) {
    const was = this.active();
    this.playing = false;
    this.token++;
    if (was) { Voice.stop(); if (canSpeak) speechSynthesis.cancel(); }
    this.keepAwake(false);
    this.secs = [];
    this.parts = [];
    if (this.bar) { this.bar.remove(); this.bar = null; }
    document.body.classList.remove('pl-on');
    if ('mediaSession' in navigator) { try { navigator.mediaSession.metadata = null; } catch { /* niente */ } }
    if (was && !quiet) toast('Ascolto chiuso');
  }
};

/* ---------- Aiuti per le figure ---------- */
// aggiunge immagini in fondo alla sezione, sotto un titolo (creato se manca)
async function appendImagesUnder(sec, heading, mdLines) {
  const block = mdLines.join('\n\n');
  let md = String(sec.md || '').replace(/\s+$/, '');
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  if (re.test(md)) {
    const lines = md.split('\n');
    const at = lines.findIndex(l => re.test(l));
    let end = lines.length;
    for (let i = at + 1; i < lines.length; i++) if (/^#{1,2}\s/.test(lines[i])) { end = i; break; }
    lines.splice(end, 0, '', block, '');
    md = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  } else md = `${md}${md ? '\n\n' : ''}## ${heading}\n\n${block}`;
  sec.md = `${md}\n`;
  await saveSection(sec);
}
// scegli una sezione: prima quella proposta, poi quelle dello stesso notebook
/* =====================================================================
   v3.73: nuova sezione (e nuova cartella) dove si sceglie una destinazione
   Un modulo dentro la stessa finestra: titolo, notebook, cartella; la cartella
   nuova si crea lì, come su Windows quando sposti qualcosa.
   ===================================================================== */
function newSecFormHtml(defNbId = '', defGroupId = '') {
  const nbs = state.notebooks.filter(n => !n.kind);
  const nb = nbById(defNbId) && !nbById(defNbId).kind ? nbById(defNbId) : nbs[0];
  return `
    <button type="button" class="btn ghost block ns-open" data-ns="open">＋ Nuova sezione</button>
    <div class="ns-form" hidden>
      <label class="field"><span>Titolo della nuova sezione</span><input class="input" data-nsf="title" placeholder="Es. Artrite reumatoide: terapia"></label>
      <div class="grid2">
        <label class="field"><span>Notebook</span><select class="input" data-nsf="nb">${nbs.map(n => `<option value="${n.id}" ${nb && n.id === nb.id ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Cartella</span><select class="input" data-nsf="grp">${nb ? groupOptions(nb, defGroupId) : '<option value="">Nessuno</option>'}</select></label>
      </div>
      <div class="ns-newgrp inline" hidden><input class="input" data-nsf="gname" placeholder="Nome della nuova cartella"><button type="button" class="btn sm" data-ns="mkgrp">Crea la cartella</button></div>
      <div class="inline"><button type="button" class="btn primary" data-ns="create">Crea la sezione</button><button type="button" class="btn ghost" data-ns="close">Annulla</button></div>
    </div>`;
}
function bindNewSecForm(root, onCreated) {
  const box = $('.ns-form', root);
  if (!box) return;
  const f = k => $(`[data-nsf="${k}"]`, box);
  const nbSel = f('nb'), grpSel = f('grp');
  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-ns]');
    if (!b) return;
    const k = b.dataset.ns;
    if (k === 'open') { box.hidden = false; b.hidden = true; f('title').focus(); return; }
    if (k === 'close') { box.hidden = true; $('[data-ns="open"]', root).hidden = false; return; }
    if (k === 'mkgrp') {
      const name = f('gname').value.trim();
      const nb = nbById(nbSel.value);
      if (!name || !nb) { toast('Scrivi il nome della cartella'); return; }
      const g = { id: uid(), name };
      nb.groups = [...groupsOf(nb), g];
      await saveNotebook(nb);
      grpSel.innerHTML = groupOptions(nb, g.id);
      grpSel.value = g.id;
      $('.ns-newgrp', box).hidden = true;
      toast(`Cartella “${name}” creata`);
      return;
    }
    if (k === 'create') {
      const title = f('title').value.trim();
      const nb = nbById(nbSel.value);
      if (!title) { toast('Scrivi il titolo della sezione'); f('title').focus(); return; }
      if (!nb) { toast('Scegli il notebook'); return; }
      const s = newSection(nb.id, { title, md: '' });
      const gv = grpSel.value;
      if (gv && gv !== '__new') s.groupId = gv;
      await saveSection(s);
      toast(`Sezione “${title}” creata`);
      onCreated(s);
    }
  });
  nbSel.addEventListener('change', () => { grpSel.innerHTML = groupOptions(nbById(nbSel.value), ''); $('.ns-newgrp', box).hidden = true; });
  grpSel.addEventListener('change', () => {
    const nw = grpSel.value === '__new';
    $('.ns-newgrp', box).hidden = !nw;
    if (nw) { grpSel.value = ''; f('gname').focus(); }
  });
  f('title').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('[data-ns="create"]', box).click(); } });
}

/* ---------- v3.73: il PDF manda il testo selezionato alla mappa aperta ----------
   La mappa aperta (nel pannello di Affianca o nella pagina) si registra qui; il nodo
   nuovo va sotto il nodo selezionato, o sotto il centro. */
const MapTarget = {
  cur: null,
  set(t) { this.cur = t; },
  get() { return this.cur && this.cur.alive() ? this.cur : null; }
};
// raggiungibile anche dal lettore PDF dentro Affianca (che è un’altra finestra)
window.MapTarget = MapTarget;
function pickSectionSheet(title, preferId = '') {
  return new Promise(resolve => {
    const pref = secById(preferId);
    const where = s => [nbById(s.notebookId)?.name, groupPathText(s)].filter(Boolean).join(' › ');
    const all = state.sections.slice().sort((a, b) => (b.id === preferId) - (a.id === preferId) || (pref ? (b.notebookId === pref.notebookId) - (a.notebookId === pref.notebookId) : 0) || (b.updated || 0) - (a.updated || 0));
    const sh = openSheet(`
      <h2>${esc(title)}</h2>
      <input type="search" class="input search" id="psQ" placeholder="Cerca una sezione" aria-label="Cerca una sezione">
      <ul class="list pick-list" id="psList"></ul>
      ${newSecFormHtml(pref ? pref.notebookId : '', pref ? pref.groupId || '' : '')}
      <div class="modal-actions"><button class="btn ghost" type="button" data-psx>Annulla</button></div>`, { label: title, onClose: v => resolve(v || null) });
    bindNewSecForm(sh.el, s => sh.close(s));
    const draw = () => {
      const q = $('#psQ', sh.el).value;
      $('#psList', sh.el).innerHTML = all.filter(s => matchTokens(`${s.title} ${where(s)}`, q)).slice(0, 60)
        .map(s => `<li><button type="button" class="row" data-ps="${s.id}"><span class="row-main"><span class="row-title">${esc(s.title)}</span><span class="row-sub">${esc(where(s))}${s.id === preferId ? ' · sezione del PDF' : ''}</span></span></button></li>`).join('') || '<li class="hint">Nessuna sezione trovata.</li>';
    };
    draw();
    $('#psQ', sh.el).addEventListener('input', draw);
    $('#psList', sh.el).addEventListener('click', e => { const b = e.target.closest('[data-ps]'); if (b) sh.close(secById(b.dataset.ps)); });
    $('[data-psx]', sh.el).onclick = () => sh.close(null);
  });
}

/* =====================================================================
   v3.33: Modifica sull’anteprima
   Gli appunti si scrivono direttamente nell’anteprima; sotto resta il codice
   Markdown, sempre allineato, per vedere e correggere la sintassi.
   Il testo è diviso nei suoi blocchi (paragrafi, titoli, elenchi, tabelle):
   si riconverte solo il blocco che tocchi, gli altri restano identici.
   Immagini, blocchi HTML e codice si modificano nel codice.
   ===================================================================== */
const WY_EDITABLE = new Set(['paragraph', 'heading', 'list', 'blockquote', 'table', 'text']);
function wyTokenize(md) {
  md = String(md || '').replace(/\r\n?/g, '\n');
  const mk = window.marked;
  if (mk && mk.lexer) {
    try {
      const toks = mk.lexer(md);
      const raws = toks.map(t => (typeof t.raw === 'string' ? t.raw : ''));
      if (raws.join('') === md) return { raws, types: toks.map(t => t.type), ok: true };
    } catch { /* passo al metodo semplice */ }
  }
  if (md.includes('```')) return { raws: [md], types: ['code'], ok: false };
  const raws = [], types = [];
  md.split(/(\n{2,})/).forEach(p => {
    if (!p) return;
    raws.push(p);
    types.push(/^\n+$/.test(p) ? 'space' : /^#{1,6}\s/.test(p) ? 'heading' : /^\s*([-*+]|\d+[.)])\s/.test(p) ? 'list' : /^\|/.test(p) ? 'table' : /^>/.test(p) ? 'blockquote' : 'paragraph');
  });
  return { raws, types, ok: true };
}
const wyWrap = (t, a, b) => { const m = t.match(/^(\s*)([\s\S]*?)(\s*)$/); return m[2] ? `${m[1]}${a}${m[2]}${b}${m[3]}` : t; };
function wyInline(node) {
  let out = '';
  node.childNodes.forEach(n => {
    if (n.nodeType === 3) { out += n.nodeValue.replace(/\u00a0/g, ' ').replace(/\n/g, ' '); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    const cls = n.classList;
    if (tag === 'BR') { out += '\n'; return; }
    if (tag === 'IMG') { if (n.dataset.img) out += imageMd(n.dataset.img, n.getAttribute('alt') || ''); return; }
    if (tag === 'STRONG' || tag === 'B') { out += wyWrap(wyInline(n), '**', '**'); return; }
    if (tag === 'EM' || tag === 'I') { out += wyWrap(wyInline(n), '*', '*'); return; }
    if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') { out += wyWrap(wyInline(n), '~~', '~~'); return; }
    if (tag === 'U') { out += wyWrap(wyInline(n), '{{u|', '}}'); return; }
    if (tag === 'MARK') {
      if (cls.contains('cz')) { const h = n.dataset.hint ? `::${n.dataset.hint}` : ''; out += wyWrap(wyInline(n), '==', `${h}==`); return; }
      const k = [...cls].map(c => (c.match(/^hl-([a-z])$/) || [])[1]).find(Boolean);
      out += k ? wyWrap(wyInline(n), `{{${k}|`, '}}') : wyInline(n);
      return;
    }
    if (tag === 'A') {
      const t = wyInline(n).trim();
      if (cls.contains('xref')) {
        const id = (n.getAttribute('href') || '').match(/#\/sec\/([^/]+)/)?.[1];
        const s = id && secById(id);
        if (s) { out += s.title.trim() === t ? `[[${s.title}]]` : `[[${s.title}|${t}]]`; return; }
        out += `[[${t}]]`;
        return;
      }
      const href = n.getAttribute('href') || '';
      out += href && href !== t ? `[${t}](${href})` : t;
      return;
    }
    if (tag === 'SPAN' && cls.contains('pnote')) { out += `^[${decodeURIComponent(n.dataset.pn || '')}]`; return; }
    if (tag === 'SPAN' && cls.contains('xref')) { out += `[[${wyInline(n).trim()}]]`; return; }
    if (tag === 'CODE') { out += `\`${n.textContent}\``; return; }
    if (tag === 'SUP' || tag === 'SUB') { out += `<${tag.toLowerCase()}>${wyInline(n)}</${tag.toLowerCase()}>`; return; }
    if (/^(P|DIV|H[1-6]|LI|UL|OL|TABLE|BLOCKQUOTE)$/.test(tag)) { out += `\n${wyInline(n)}\n`; return; }
    out += wyInline(n);
  });
  return out;
}
const wyLine = s => s.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
function wyList(list, pad) {
  const ordered = list.tagName === 'OL';
  let n = +(list.getAttribute('start') || 1);
  // il rientro del browser può mettere l’elenco annidato accanto alla voce invece che dentro
  const items = [];
  const loose = [];
  [...list.children].forEach(c => {
    if (c.tagName === 'LI') items.push({ li: c, subs: [] });
    else if (c.tagName === 'UL' || c.tagName === 'OL') {
      if (items.length) items[items.length - 1].subs.push(c);
      else loose.push(c);
    } else if (c.querySelector && c.querySelector('ul, ol')) {
      [...c.querySelectorAll(':scope > ul, :scope > ol')].forEach(u => {
        if (items.length) items[items.length - 1].subs.push(u);
        else loose.push(u);
      });
    }
  });
  const out = loose.map(sub => wyList(sub, pad));
  items.forEach(({ li, subs }) => {
    const own = document.createElement('div');
    const ownSubs = [];
    const collect = node => {
      node.childNodes.forEach(c => {
        if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) ownSubs.push(c);
        else if (c.nodeType === 1 && (c.tagName === 'DIV' || c.tagName === 'BLOCKQUOTE') && c.querySelector('ul, ol')) collect(c);
        else own.append(c.cloneNode(true));
      });
    };
    collect(li);
    const marker = ordered ? `${n++}. ` : '- ';
    const text = wyLine(wyInline(own)).replace(/\n/g, ' ');
    let s = `${pad}${marker}${text}`;
    [...ownSubs, ...subs].forEach(sub => { s += `\n${wyList(sub, pad + ' '.repeat(marker.length))}`; });
    out.push(s);
  });
  return out.join('\n');
}
function wyTable(table) {
  const rows = [...table.rows].map(r => [...r.cells].map(c => wyLine(wyInline(c)).replace(/\n/g, ' ').replace(/\|/g, '\\|')));
  if (!rows.length) return '';
  const w = Math.max(...rows.map(r => r.length));
  rows.forEach(r => { while (r.length < w) r.push(''); });
  const line = r => `| ${r.join(' | ')} |`;
  return [line(rows[0]), `|${' --- |'.repeat(w)}`, ...rows.slice(1).map(line)].join('\n');
}
function wyBlockToMd(el) {
  const parts = [];
  let loose = document.createElement('div');
  const flushLoose = () => { const t = wyLine(wyInline(loose)); if (t) parts.push(t); loose = document.createElement('div'); };
  const walk = parent => {
    parent.childNodes.forEach(n => {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) loose.append(n.cloneNode(true)); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName;
      if (/^(B|STRONG|I|EM|U|MARK|A|SPAN|CODE|SUP|SUB|S|DEL|IMG|BR)$/.test(tag)) { if (tag !== 'BR' || loose.childNodes.length) loose.append(n.cloneNode(true)); return; }
      flushLoose();
      if (/^H[1-6]$/.test(tag)) { const t = wyLine(wyInline(n)).replace(/\n/g, ' '); if (t) parts.push(`${'#'.repeat(+tag[1])} ${t}`); }
      else if (tag === 'UL' || tag === 'OL') parts.push(wyList(n, ''));
      else if (tag === 'TABLE') parts.push(wyTable(n));
      else if (tag === 'BLOCKQUOTE') { const t = wyBlockToMd(n); if (t) parts.push(t.split('\n').map(l => (l ? `> ${l}` : '>')).join('\n')); }
      else if (tag === 'HR') parts.push('---');
      else if (tag === 'PRE') parts.push(`\`\`\`\n${n.textContent.replace(/\n$/, '')}\n\`\`\``);
      else if (tag === 'P') { const t = wyLine(wyInline(n)); if (t) parts.push(t); }
      else if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') {
        if ($$(':scope > p, :scope > div, :scope > ul, :scope > ol, :scope > table, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > blockquote, :scope > hr', n).length) walk(n);
        else { const t = wyLine(wyInline(n)); if (t) parts.push(t); }
      } else { const t = wyLine(wyInline(n)); if (t) parts.push(t); }
    });
  };
  walk(el);
  flushLoose();
  return parts.join('\n\n');
}
// prima la misura di dove cade un punto del codice, senza spostare il cursore della pagina
function taOffsetY(ta, pos) {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement('div');
  ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'boxSizing', 'tabSize'].forEach(p => { mirror.style[p] = cs[p]; });
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: `${ta.clientWidth}px`, top: '0', left: '-9999px' });
  mirror.textContent = ta.value.slice(0, pos);
  const mark = document.createElement('span');
  mark.textContent = '|';
  mirror.append(mark);
  document.body.append(mirror);
  const y = mark.offsetTop;
  mirror.remove();
  return y;
}

function setupWysiwyg(box, ta, tools, opts = {}) {
  const { extraBars = [], onContentChange = () => {}, onBeforeMutate = () => {}, onAfterMutate = () => {}, onActiveChange = () => {} } = opts;
  let raws = [], types = [];
  let enabled = true;
  const dirty = new Set();
  let timer = 0;
  let lastFocus = 'wy';
  let curIdx = -1;
  const starts = () => { const s = []; let a = 0; raws.forEach(r => { s.push(a); a += r.length; }); return s; };
  const contentIndices = () => raws.map((r, i) => (types[i] === 'space' || !r.trim() ? -1 : i)).filter(i => i >= 0);

  const kindOfBlock = i => {
    const raw = (raws[i] || '').trim();
    const tp = types[i];
    if (!raw) return 'p';
    const hm = raw.match(/^(#{1,4})\s+/);
    if (hm) return `h${hm[1].length}`;
    if (tp === 'list') return 'list';
    if (tp === 'table') return 'table';
    if (tp === 'blockquote') return 'blockquote';
    if (tp === 'code' || raw.includes('```')) return 'code';
    if (/!\[[^\]]*\]\(img:/.test(raw)) return 'lock';
    return 'p';
  };

  const notifyActive = i => {
    const idxs = contentIndices();
    if (i < 0 && idxs.length) i = idxs[0];
    curIdx = i;
    const pos = idxs.indexOf(i);
    $$('.wy-b', box).forEach(x => x.classList.toggle('wy-cur', +x.dataset.b === i));
    onActiveChange({
      idx: i,
      kind: i >= 0 ? kindOfBlock(i) : 'p',
      canUp: pos > 0,
      canDown: pos >= 0 && pos < idxs.length - 1
    });
  };

  const render = () => {
    const t = wyTokenize(ta.value);
    raws = t.raws; types = t.types; enabled = t.ok;
    if (!enabled) {
      box.innerHTML = `<div class="wy-note">L’anteprima modificabile non è disponibile per questo testo: modifica nel codice.</div>${renderMd(ta.value)}`;
      box.removeAttribute('data-ph');
      notifyActive(-1);
      return;
    }
    const html = raws.map((raw, i) => {
      if (types[i] === 'space' || !raw.trim()) return '';
      const inner = renderMd(raw);
      const lock = !WY_EDITABLE.has(types[i]) || /<img|<iframe|html-embed|html-block/.test(inner) || raw.includes('```');
      return `<div class="wy-b${lock ? ' wy-lock' : ''}" data-b="${i}" contenteditable="${lock ? 'false' : 'true'}"${lock ? ' title="Questo blocco si modifica nel codice: toccalo per andarci"' : ' spellcheck="true"'}>${inner}</div>`;
    }).join('');
    box.innerHTML = html || '<div class="wy-b wy-new" data-b="new" contenteditable="true" spellcheck="true"><p><br></p></div>';
    box.toggleAttribute('data-empty', !html);
    hydrateImages(box);
    hydrateHtmlBlocks(box);
    const idxs = contentIndices();
    notifyActive(idxs.includes(curIdx) ? curIdx : (idxs[0] ?? -1));
  };

  const convert = el => {
    if (!el.isConnected) return;
    const md = wyBlockToMd(el).replace(/\n{3,}/g, '\n\n').trim();
    if (el.dataset.b === 'new') {
      raws = md ? [md + '\n'] : [];
      types = ['paragraph'];
      el.dataset.b = '0';
    } else {
      const i = +el.dataset.b;
      const raw = raws[i] ?? '';
      const lead = raw.match(/^\n*/)[0];
      const trail = raw.match(/\n*$/)[0];
      raws[i] = md ? `${lead}${md}${trail}` : '';
      if (!md && types[i + 1] === 'space') raws[i + 1] = '';
    }
    ta.value = raws.join('');
  };

  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    if (!dirty.size) return;
    dirty.forEach(convert);
    dirty.clear();
    onContentChange();
  };
  const markDirty = el => { if (!el) return; dirty.add(el); clearTimeout(timer); timer = setTimeout(flush, 250); };
  const blockOf = node => { const n = node && (node.nodeType === 1 ? node : node.parentElement); const b = n && n.closest('.wy-b'); return b && box.contains(b) ? b : null; };

  box.addEventListener('input', e => markDirty(blockOf(e.target)));
  box.addEventListener('focusin', e => {
    lastFocus = 'wy';
    const b = blockOf(e.target);
    if (b && b.dataset.b !== 'new') {
      notifyActive(+b.dataset.b);
      showInCode(+b.dataset.b);
    } else {
      notifyActive(-1);
    }
  });
  // uscendo dall’anteprima ridisegno i blocchi, così titoli ed elenchi nuovi prendono forma
  box.addEventListener('focusout', e => {
    if (e.relatedTarget && box.contains(e.relatedTarget)) return;
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.edit-tools, .ed-blkbar, .ed-pop')) return;
    flush();
    setTimeout(() => { if (!box.contains(document.activeElement)) render(); }, 0);
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('.wy-lock');
    if (b) { notifyActive(+b.dataset.b); goToCode(+b.dataset.b); return; }
    if (e.target.closest('a')) e.preventDefault();
  });
  // incollare: testo pulito, e se c’è una tabella (da NotebookLM/Gemini o HTML) la inserisce subito come blocco Markdown pulito
  box.addEventListener('paste', e => {
    if ([...(e.clipboardData?.items || [])].some(i => i.type.startsWith('image/'))) return;
    const norm = normalizePastedMarkdown(e.clipboardData);
    const plain = e.clipboardData?.getData('text/plain');
    const candidate = norm !== null ? norm : (plain || '');
    const hasMdTable = candidate.indexOf('|') >= 0 && /(?:^|\n)\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?(?:\n|$)/.test(candidate);
    if (hasMdTable) {
      e.preventDefault();
      flush();
      const blk = blockOf(e.target);
      const idxs = contentIndices();
      const idx = blk && blk.dataset.b !== 'new' ? +blk.dataset.b
        : (idxs.includes(curIdx) ? curIdx : (idxs.length ? idxs[idxs.length - 1] : -1));
      onBeforeMutate();
      if (idx >= 0 && raws[idx] !== undefined) {
        const cur = raws[idx];
        const core = cur.trimEnd();
        const trail = cur.slice(core.length) || '\n\n';
        raws[idx] = core ? `${core}\n\n${candidate}${trail}` : `${candidate}${trail}`;
      } else {
        raws = [`${candidate}\n`];
      }
      ta.value = raws.join('');
      onContentChange();
      onAfterMutate();
      render();
      toast('Tabella incollata e sistemata');
      return;
    }
    const text = norm !== null ? norm : plain;
    if (text === undefined) return;
    e.preventDefault();
    document.execCommand('insertText', false, text);
  });

  // v4.19: rientro/riduzione diretto sul DOM (senza execCommand, che stacca i <li> o crea <blockquote>)
  const wyIndent = dir => {
    const x = selIn();
    if (!x) return false;
    const { r, el: blk, s } = x;
    const sc = r.startContainer, so = r.startOffset;
    const ec = r.endContainer, eo = r.endOffset;
    const liOf = n => (n && (n.nodeType === 1 ? n : n.parentElement))?.closest('li');
    const liStart = liOf(sc);
    const liEnd = liOf(ec);
    let lis = [];
    if (r.collapsed) {
      if (liStart && blk.contains(liStart)) lis = [liStart];
    } else if (liStart && liStart === liEnd && blk.contains(liStart)) {
      lis = [liStart];
    } else {
      const hit = [...blk.querySelectorAll('li')].filter(li => r.intersectsNode(li) && !(liStart && li !== liStart && li.contains(liStart)));
      lis = hit.filter(li => !hit.some(other => other !== li && other.contains(li)));
    }
    if (!lis.length) return 'not-li';

    onBeforeMutate();
    let changed = false;
    let blockedFirst = false;
    if (dir > 0) {
      for (const li of lis) {
        const list = li.parentElement;
        if (!list || (list.tagName !== 'UL' && list.tagName !== 'OL')) continue;
        let prev = li.previousElementSibling;
        while (prev && prev.tagName !== 'LI') prev = prev.previousElementSibling;
        if (!prev) { blockedFirst = true; continue; }
        let sub = prev.lastElementChild;
        if (!sub || sub.tagName !== list.tagName) {
          sub = document.createElement(list.tagName);
          prev.appendChild(sub);
        }
        sub.appendChild(li);
        changed = true;
      }
    } else {
      for (const li of [...lis].reverse()) {
        const list = li.parentElement;
        if (!list || (list.tagName !== 'UL' && list.tagName !== 'OL')) continue;
        const p = list.parentElement;
        let grandList = null;
        let insertAfter = null;
        if (p && p.tagName === 'LI' && blk.contains(p)) {
          grandList = p.parentElement;
          insertAfter = p;
        } else if (p && (p.tagName === 'UL' || p.tagName === 'OL') && blk.contains(p)) {
          grandList = p;
          insertAfter = list;
        }
        if (!grandList || (grandList.tagName !== 'UL' && grandList.tagName !== 'OL')) continue;
        const following = [];
        let sib = li.nextElementSibling;
        while (sib) { following.push(sib); sib = sib.nextElementSibling; }
        if (following.length) {
          let sub = li.lastElementChild;
          if (!sub || sub.tagName !== list.tagName) {
            sub = document.createElement(list.tagName);
            li.appendChild(sub);
          }
          following.forEach(node => sub.appendChild(node));
        }
        grandList.insertBefore(li, insertAfter.nextSibling);
        if (!list.children.length) list.remove();
        changed = true;
      }
    }
    if (changed) {
      try {
        const nr = document.createRange();
        nr.setStart(sc, so);
        nr.setEnd(ec, eo);
        s.removeAllRanges();
        s.addRange(nr);
      } catch { /* cursore invariato */ }
      dirty.add(blk);
      flush();
      onAfterMutate();
    } else if (blockedFirst) {
      toast('Per rientrare una voce deve essercene una sopra nello stesso elenco');
    }
    return true;
  };

  box.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const res = wyIndent(e.shiftKey ? -1 : 1);
      if (res && res !== 'not-li') e.preventDefault();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const x = selIn();
      if (!x || !x.r.collapsed) return;
      const li = (x.r.startContainer.nodeType === 1 ? x.r.startContainer : x.r.startContainer.parentElement)?.closest('li');
      const list = li && li.parentElement;
      const nested = list && list.parentElement && (list.parentElement.tagName === 'LI' || list.parentElement.tagName === 'UL' || list.parentElement.tagName === 'OL') && x.el.contains(list.parentElement);
      if (nested && !li.textContent.trim() && !li.querySelector('ul, ol, img')) {
        e.preventDefault();
        wyIndent(-1);
      }
    }
  });

  ta.addEventListener('focusin', () => { lastFocus = 'ta'; });
  let tt = 0;
  ta.addEventListener('input', () => { if (box.contains(document.activeElement)) return; clearTimeout(tt); tt = setTimeout(render, 300); });
  const syncFromCode = () => {
    if (!enabled) return;
    const pos = ta.selectionStart;
    const st = starts();
    let i = st.length - 1;
    while (i > 0 && st[i] > pos) i--;
    while (i > 0 && (types[i] === 'space' || !raws[i].trim())) i--;
    notifyActive(i);
  };
  ta.addEventListener('click', syncFromCode);
  ta.addEventListener('keyup', syncFromCode);

  const showInCode = i => {
    const st = starts();
    if (st[i] === undefined || !ta.offsetParent) return;
    const y = taOffsetY(ta, st[i] + (raws[i].match(/^\n*/)[0].length));
    ta.scrollTop = Math.max(0, y - 12);
  };
  const goToCode = i => {
    flush();
    const st = starts();
    const lead = (raws[i] || '').match(/^\n*/)[0].length;
    const a = (st[i] ?? 0) + lead, b = (st[i] ?? 0) + (raws[i] || '').trimEnd().length;
    const work = ta.closest('.ed-workspace');
    if (work && work.classList.contains('view-wy')) {
      work.classList.remove('view-wy');
      work.classList.add('view-split');
      $$('[data-edview]', work.parentElement).forEach(btn => btn.setAttribute('aria-selected', String(btn.dataset.edview === 'split')));
    }
    jumpInTextarea(ta, { start: a, end: b });
  };

  /* ---------- Operazioni sui blocchi (T/H2/H3/H4, ↑/↓, ＋¶, ＋H2, 🗑) ---------- */
  const focusBlockEl = (el, { selectAll = false, atEnd = true } = {}) => {
    if (!el) return;
    if (el.classList.contains('wy-lock')) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    el.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const s = getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    if (!selectAll) r.collapse(!atEnd);
    s.removeAllRanges();
    s.addRange(r);
  };

  const setBlockType = kind => {
    flush();
    const prefix = kind === 'h2' ? '## ' : kind === 'h3' ? '### ' : kind === 'h4' ? '#### ' : '';
    if (lastFocus === 'ta' || !enabled) {
      onBeforeMutate();
      const v = ta.value;
      const pos = ta.selectionStart ?? v.length;
      const ls = lineStart(v, pos);
      const le = lineEnd(v, pos);
      const line = v.slice(ls, le);
      const cleaned = line.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
      const nextLine = prefix ? `${prefix}${cleaned}` : cleaned;
      ta.focus();
      ta.setRangeText(nextLine, ls, le, 'end');
      onAfterMutate();
      render();
      return;
    }
    const idxs = contentIndices();
    const i = idxs.includes(curIdx) ? curIdx : idxs[0];
    if (i === undefined) {
      insertBlockAfter(kind, true);
      return;
    }
    const raw = raws[i] || '';
    if (raw.includes('```') || /!\[[^\]]*\]\(img:/.test(raw) || types[i] === 'table') {
      toast('Questo blocco (tabella, immagine o HTML) non si trasforma in titolo');
      return;
    }
    onBeforeMutate();
    const lead = raw.match(/^\n*/)[0];
    const trail = raw.match(/\n*$/)[0];
    const core = raw.trim();
    const lines = core.split('\n');
    const firstClean = lines[0].replace(/^\s*#{1,6}\s+/, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
    const rest = lines.slice(1).join('\n').trim();
    if (prefix) {
      raws[i] = rest ? `${lead}${prefix}${firstClean}\n\n${rest}${trail}` : `${lead}${prefix}${firstClean}${trail}`;
    } else {
      raws[i] = `${lead}${firstClean}${rest ? `\n${rest}` : ''}${trail}`;
    }
    ta.value = raws.join('');
    onAfterMutate();
    render();
    const el = box.querySelector(`.wy-b[data-b="${i}"]`) || box.querySelector('.wy-b');
    if (el) { notifyActive(+el.dataset.b); focusBlockEl(el, { atEnd: true }); }
  };

  const moveBlock = dir => {
    flush();
    const idxs = contentIndices();
    const pos = idxs.indexOf(curIdx);
    const targetPos = pos + dir;
    if (pos < 0 || targetPos < 0 || targetPos >= idxs.length) return;
    onBeforeMutate();
    const blocks = idxs.map(i => raws[i].trim());
    [blocks[pos], blocks[targetPos]] = [blocks[targetPos], blocks[pos]];
    ta.value = blocks.join('\n\n') + '\n';
    onAfterMutate();
    render();
    const newIdxs = contentIndices();
    const newI = newIdxs[targetPos] ?? newIdxs[0];
    const el = box.querySelector(`.wy-b[data-b="${newI}"]`);
    if (el) { notifyActive(newI); focusBlockEl(el, { atEnd: true }); }
  };

  const insertBlockAfter = (kind, atEnd = false) => {
    flush();
    onBeforeMutate();
    const idxs = contentIndices();
    const snippet = kind === 'h2' ? '## Nuovo titolo' : kind === 'h3' ? '### Nuovo sottotitolo' : 'Nuovo paragrafo';
    const blocks = idxs.map(i => raws[i].trim());
    let insertPos = blocks.length;
    if (!atEnd && curIdx >= 0) {
      const pos = idxs.indexOf(curIdx);
      if (pos >= 0) insertPos = pos + 1;
    }
    blocks.splice(insertPos, 0, snippet);
    ta.value = blocks.join('\n\n') + '\n';
    onAfterMutate();
    render();
    const newIdxs = contentIndices();
    const newI = newIdxs[insertPos] ?? newIdxs[newIdxs.length - 1];
    const el = box.querySelector(`.wy-b[data-b="${newI}"]`);
    if (el) { notifyActive(newI); focusBlockEl(el, { selectAll: true }); }
  };

  const deleteBlock = () => {
    flush();
    const idxs = contentIndices();
    const pos = idxs.indexOf(curIdx);
    if (pos < 0) return false;
    onBeforeMutate();
    const blocks = idxs.map(i => raws[i].trim());
    blocks.splice(pos, 1);
    ta.value = blocks.length ? blocks.join('\n\n') + '\n' : '';
    onAfterMutate();
    render();
    const newIdxs = contentIndices();
    const nextI = newIdxs[Math.min(pos, newIdxs.length - 1)] ?? -1;
    notifyActive(nextI);
    return true;
  };

  const focusCharOffset = offset => {
    flush();
    const st = starts();
    let i = st.length - 1;
    while (i > 0 && st[i] > offset) i--;
    while (i > 0 && (types[i] === 'space' || !raws[i].trim())) i--;
    const el = box.querySelector(`.wy-b[data-b="${i}"]`);
    if (el) {
      notifyActive(i);
      focusBlockEl(el, { atEnd: false });
    }
  };

  /* Strumenti di formattazione quando scrivi nell’anteprima */
  const selIn = () => {
    const s = getSelection();
    if (!s.rangeCount) return null;
    const r = s.getRangeAt(0);
    const el = blockOf(r.commonAncestorContainer);
    return el && el.isContentEditable ? { r, el, s } : null;
  };
  const unwrap = n => { const p = n.parentNode; while (n.firstChild) p.insertBefore(n.firstChild, n); p.removeChild(n); };
  const wrap = (make, matches) => {
    const x = selIn();
    if (!x) { toast('Metti il cursore nel testo dell’anteprima'); return false; }
    const anc = (x.r.commonAncestorContainer.nodeType === 1 ? x.r.commonAncestorContainer : x.r.commonAncestorContainer.parentElement).closest('mark, u, strong, b');
    if (anc && x.el.contains(anc) && matches(anc)) { onBeforeMutate(); unwrap(anc); dirty.add(x.el); flush(); onAfterMutate(); return true; }
    if (x.r.collapsed) { toast('Seleziona prima il testo'); return false; }
    onBeforeMutate();
    const w = make();
    w.append(x.r.extractContents());
    x.r.insertNode(w);
    x.s.removeAllRanges();
    const nr = document.createRange();
    nr.selectNodeContents(w);
    x.s.addRange(nr);
    dirty.add(x.el);
    flush();
    onAfterMutate();
    return true;
  };
  const tag = (name, cls) => () => { const e = document.createElement(name); if (cls) e.className = cls; return e; };
  const handle = e => {
    if (lastFocus !== 'wy' || !enabled) return false;
    const b = e.target.closest('button');
    if (!b) return false;
    const d = b.dataset;
    if (d.ed || d.edview || d.btype || d.bact) return false;
    if (d.wrap === '==') return wrap(tag('mark', 'cz'), n => n.tagName === 'MARK' && n.classList.contains('cz')) || true;
    if (d.wrap === '**') return wrap(tag('strong'), n => n.tagName === 'STRONG' || n.tagName === 'B') || true;
    if (d.mark === 'u') return wrap(tag('u', 'ul'), n => n.tagName === 'U') || true;
    if (d.mark === 'none') {
      const x = selIn();
      if (!x) return true;
      const anc = (x.r.commonAncestorContainer.nodeType === 1 ? x.r.commonAncestorContainer : x.r.commonAncestorContainer.parentElement).closest('mark.hl, u.ul');
      if (anc && x.el.contains(anc)) { onBeforeMutate(); unwrap(anc); dirty.add(x.el); flush(); onAfterMutate(); }
      else toast('Metti il cursore dentro un testo evidenziato per togliere il colore');
      const pop = b.closest('.ed-pop'); if (pop) pop.hidden = true;
      return true;
    }
    if (d.mark) {
      const k = d.mark;
      const pop = b.closest('.ed-pop'); if (pop) pop.hidden = true;
      const x = selIn();
      const anc = x && (x.r.commonAncestorContainer.nodeType === 1 ? x.r.commonAncestorContainer : x.r.commonAncestorContainer.parentElement).closest('mark.hl');
      if (anc && x.el.contains(anc) && !anc.classList.contains(`hl-${k}`)) { onBeforeMutate(); anc.className = `hl hl-${k}`; dirty.add(x.el); flush(); onAfterMutate(); return true; }
      return wrap(tag('mark', `hl hl-${k}`), n => n.tagName === 'MARK' && n.classList.contains(`hl-${k}`)) || true;
    }
    if (d.ins === 'list' || d.ins === 'olist') {
      const x = selIn();
      if (!x) return true;
      onBeforeMutate();
      document.execCommand(d.ins === 'olist' ? 'insertOrderedList' : 'insertUnorderedList');
      dirty.add(x.el);
      flush();
      onAfterMutate();
      return true;
    }
    if (d.indent) {
      const res = wyIndent(+d.indent);
      if (res === 'not-li') toast('Il rientro vale per le voci di un elenco');
      return true;
    }
    if (d.act === 'pnote') {
      const x = selIn();
      if (!x) { toast('Metti il cursore nel testo dell’anteprima'); return true; }
      const range = x.r.cloneRange();
      const el = x.el;
      askPnote().then(note => {
        if (!note) return;
        onBeforeMutate();
        const sp = document.createElement('span');
        sp.className = 'pnote';
        sp.setAttribute('role', 'button');
        sp.dataset.pn = encodeURIComponent(note);
        sp.textContent = 'ⓘ';
        range.collapse(false);
        range.insertNode(sp);
        dirty.add(el);
        flush();
        onAfterMutate();
      });
      return true;
    }
    if (d.act === 'hint') {
      const x = selIn();
      const m = x && (x.r.startContainer.nodeType === 1 ? x.r.startContainer : x.r.startContainer.parentElement).closest('mark.cz');
      if (!m) { toast('Metti il cursore dentro un cloze, oppure trasforma prima il testo in cloze'); return true; }
      modal({ title: 'Suggerimento', text: `Per “${m.textContent}”: una domanda o un indizio che compare come “?” accanto al termine nascosto. Lascia vuoto per toglierlo.`, input: true, value: m.dataset.hint || '', placeholder: 'Es. ormone che abbassa la glicemia', confirm: 'Salva', allowEmpty: true }).then(v => {
        if (v === null) return;
        onBeforeMutate();
        const c = cleanHint(v);
        if (c) m.dataset.hint = c; else delete m.dataset.hint;
        dirty.add(x.el);
        flush();
        onAfterMutate();
      });
      return true;
    }
    // inserimenti (tabella, immagine, link…): vanno nel codice subito dopo il blocco dove sei
    const x = selIn();
    const targetIdx = x && x.el.dataset.b !== 'new' ? +x.el.dataset.b : curIdx;
    if (targetIdx >= 0 && raws[targetIdx] !== undefined) {
      flush();
      const st = starts();
      const end = (st[targetIdx] ?? ta.value.length) + (raws[targetIdx] || '').length;
      ta.setSelectionRange(end, end);
      ta.dataset.touched = '1';
    }
    return false;
  };
  const bindBar = bar => { if (bar) bar.addEventListener('click', e => { if (handle(e)) { e.stopImmediatePropagation(); e.preventDefault(); } }, true); };
  bindBar(tools);
  extraBars.forEach(bindBar);

  // “Modifica qui”: porto il cursore sul testo scelto, dentro l’anteprima
  const jump = jmp => {
    flush();
    const st = starts();
    let i = -1;
    if (jmp.start >= 0) { i = st.length - 1; while (i > 0 && st[i] > jmp.start) i--; }
    const want = String(jmp.text || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 50);
    const cands = i >= 0 ? [box.querySelector(`.wy-b[data-b="${i}"]`), ...$$('.wy-b', box)] : $$('.wy-b', box);
    for (const el of cands) {
      if (!el || !want) continue;
      const nodes = [];
      let acc = '';
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (tw.nextNode()) { nodes.push({ n: tw.currentNode, a: acc.length }); acc += tw.currentNode.nodeValue; }
      const norm = acc.toLowerCase().replace(/\s/g, ' ');
      const at = norm.indexOf(want);
      if (at < 0) continue;
      if (el.classList.contains('wy-lock')) { goToCode(+el.dataset.b); return; }
      const pick = off => { const k = nodes.filter(x => x.a <= off).pop() || nodes[0]; return [k.n, Math.min(off - k.a, k.n.nodeValue.length)]; };
      const r = document.createRange();
      r.setStart(...pick(at));
      r.setEnd(...pick(at + want.length));
      notifyActive(+el.dataset.b);
      el.focus({ preventScroll: true });
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      const rect = r.getBoundingClientRect();
      window.scrollBy(0, rect.top - window.innerHeight * 0.35);
      return;
    }
    goToCode(Math.max(0, i));
    if (jmp.start >= 0) jumpInTextarea(ta, jmp);
  };
  render();
  return { render, flush, jump, lastFocus: () => lastFocus, setBlockType, moveBlock, insertBlockAfter, deleteBlock, focusCharOffset };
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
            <div class="io-controls">
              <div class="seg sm" role="tablist" aria-label="Modalità">
                <button role="tab" data-mode="draw" aria-selected="true">Disegna</button>
                <button role="tab" data-mode="scroll" aria-selected="false">Scorri</button>
              </div>
              <div class="io-zoom" role="group" aria-label="Zoom">
                <button type="button" class="btn sm ghost" data-ioz="out" aria-label="Riduci zoom" title="Riduci zoom">−</button>
                <button type="button" class="btn sm ghost io-zval" data-ioz="reset" title="Ripristina 100%">100%</button>
                <button type="button" class="btn sm ghost" data-ioz="in" aria-label="Ingrandisci" title="Ingrandisci">＋</button>
              </div>
              ${occ.length ? `<button class="btn sm ghost" type="button" data-lb="occ">Usa i ${occ.length} riquadri dell’occlusione</button>` : ''}
            </div>
          </header>
          <div class="io-body" id="lbBody">
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
    const bodyEl = $('#lbBody', root);
    const stage = $('#lbStage', root);
    const draft = $('#lbDraft', root);
    const vp = attachIoViewport(bodyEl, stage, {
      canPan: () => mode === 'scroll',
      zOut: $('[data-ioz="out"]', root),
      zIn: $('[data-ioz="in"]', root),
      zReset: $('[data-ioz="reset"]', root)
    });
    const draw = () => {
      $('#lbMasks', root).innerHTML = masks.map((m, i) =>
        `<div class="io-mask edit lb-cut ${sel === m.id ? 'sel' : ''}" data-m="${m.id}" style="${posStyle(m)}"><span>${i + 1}</span></div>`).join('');
      $('#lbCount', root).textContent = masks.length ? `${masks.length} ${masks.length === 1 ? 'etichetta' : 'etichette'}` : '';
      $('#lbSel', root).hidden = !sel;
    };
    stage.addEventListener('pointerdown', e => {
      if (mode !== 'draw') return;
      const el = e.target.closest('.io-mask');
      if (!el) { if (sel) { sel = null; draw(); } return; }
      e.preventDefault();
      sel = el.dataset.m;
      draw();
    });
    stage.addEventListener('click', e => {
      if (mode !== 'scroll' || vp.wasDragged()) return;
      const el = e.target.closest('.io-mask');
      if (!el) { if (sel) { sel = null; draw(); } return; }
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
      vp.syncMode();
    }));
    const close = v => { vp.destroy(); root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
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
  // Numerazione visiva dall'alto in basso e da sinistra a destra (slegata dall'ordine del vassoio)
  const visualOrder = masks.slice().sort((a, b) => (Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) > 0.025 ? (a.y + a.h / 2) - (b.y + b.h / 2) : (a.x + a.w / 2) - (b.x + b.w / 2)));
  const slotNum = new Map(visualOrder.map((m, i) => [m.id, i + 1]));
  const placed = {};          // slot -> piece
  const locked = new Set();   // riquadri già confermati giusti
  let picked = null;          // etichetta toccata, in attesa del riquadro
  let checked = false;
  let firstScore = null;
  let zoom = 1;
  let blind = S().labelsBlind !== false;   // v4.34: Senza indizi attivo di default
  const crops = new Map();                 // mask.id -> dataURL nitido ritagliato
  const covers = new Map();                // mask.id -> colore di sfondo campionato attorno al ritaglio
  const started = Date.now();
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="overlay full">
      <div class="io-editor lq ${blind ? 'lq-blind' : ''}" role="dialog" aria-modal="true" aria-labelledby="lqTitle">
        <header class="io-head">
          <div class="lq-head-row">
            <h2 id="lqTitle">Rimetti le etichette</h2>
            <button class="btn sm ${blind ? 'primary' : 'ghost'}" type="button" data-q="blind" aria-pressed="${blind}" title="Tessere tutte uguali e bersagli standardizzati per non dare indizi dalla forma">🙈 Senza indizi</button>
          </div>
          <p class="hint" id="lqHint"></p>
        </header>
        <div class="io-body lq-body" id="lqBody">
          <div class="io lq-stage" id="lqStage" style="aspect-ratio:${im.w}/${im.h}">
            <img class="nb-img" data-img="${im.id}" alt="Schema con le etichette tolte" draggable="false">
            ${masks.map(m => `<span class="lq-cover" data-c="${m.id}" style="${posStyle(m)}" aria-hidden="true"></span>`).join('')}
            ${masks.map(m => `<button type="button" class="lq-slot" data-s="${m.id}" aria-label="Riquadro ${slotNum.get(m.id)}, vuoto"></button>`).join('')}
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
  const win = root.firstElementChild;
  const dialog = $('.lq', root);
  const stage = $('#lqStage', root);
  const tray = $('#lqTray', root);
  const bodyEl = $('#lqBody', root);
  const msg = $('#lqMsg', root);
  const hintEl = $('#lqHint', root);
  const byId = id => masks.find(m => m.id === id);

  const centerStyle = m => `left:${((m.x + m.w / 2) * 100).toFixed(3)}%;top:${((m.y + m.h / 2) * 100).toFixed(3)}%`;

  // Prepara ritagli nitidi su canvas e campiona il colore carta intorno a ogni etichetta
  let alive = true;
  (async () => {
    try {
      let src = null;
      let sw = im.w, sh = im.h;
      if (im.blob && typeof createImageBitmap === 'function') {
        try { src = await createImageBitmap(im.blob); sw = src.width; sh = src.height; } catch { src = null; }
      }
      if (!src && url) {
        src = await new Promise((res, rej) => { const g = new Image(); g.onload = () => res(g); g.onerror = rej; g.src = url; });
        sw = src.naturalWidth || im.w; sh = src.naturalHeight || im.h;
      }
      if (!src || !alive) return;
      const scale = Math.min(1, 2000 / Math.max(sw, sh, 1));
      const W = Math.max(1, Math.round(sw * scale));
      const H = Math.max(1, Math.round(sh * scale));
      const full = document.createElement('canvas');
      full.width = W; full.height = H;
      const fctx = full.getContext('2d', { willReadFrequently: true });
      fctx.fillStyle = '#ffffff';
      fctx.fillRect(0, 0, W, H);
      fctx.drawImage(src, 0, 0, W, H);
      if (src.close) try { src.close(); } catch { /* ignora */ }
      const imgData = fctx.getImageData(0, 0, W, H).data;
      const med = arr => { arr.sort((a, b) => a - b); return arr[arr.length >> 1] ?? 244; };
      const sampleBg = (rx, ry, rw, rh) => {
        const rs = [], gs = [], bs = [];
        const add = (px, py) => {
          const x = Math.max(0, Math.min(W - 1, Math.round(px)));
          const y = Math.max(0, Math.min(H - 1, Math.round(py)));
          const o = (y * W + x) * 4;
          rs.push(imgData[o]); gs.push(imgData[o + 1]); bs.push(imgData[o + 2]);
        };
        const pad = 3;
        for (let k = 0; k <= 5; k++) {
          const t = k / 5;
          add(rx + rw * t, ry - pad);
          add(rx + rw * t, ry + rh + pad);
        }
        for (let k = 1; k <= 3; k++) {
          const t = k / 4;
          add(rx - pad, ry + rh * t);
          add(rx + rw + pad, ry + rh * t);
        }
        return `rgb(${med(rs)}, ${med(gs)}, ${med(bs)})`;
      };
      const cropCv = document.createElement('canvas');
      const cctx = cropCv.getContext('2d');
      for (const m of masks) {
        const rx = Math.max(0, Math.floor(m.x * W));
        const ry = Math.max(0, Math.floor(m.y * H));
        const rw = Math.max(2, Math.min(W - rx, Math.ceil(m.w * W)));
        const rh = Math.max(2, Math.min(H - ry, Math.ceil(m.h * H)));
        covers.set(m.id, sampleBg(rx, ry, rw, rh));
        cropCv.width = rw; cropCv.height = rh;
        cctx.clearRect(0, 0, rw, rh);
        cctx.drawImage(full, rx, ry, rw, rh, 0, 0, rw, rh);
        let dataUrl = '';
        try { dataUrl = cropCv.toDataURL('image/webp', 0.92); } catch { /* fallback */ }
        if (!dataUrl || !dataUrl.startsWith('data:image/webp')) dataUrl = cropCv.toDataURL('image/png');
        crops.set(m.id, dataUrl);
      }
      if (!alive) return;
      $$('.lq-cover', stage).forEach(el => {
        const bg = covers.get(el.dataset.c);
        if (bg) el.style.setProperty('--cov-bg', bg);
      });
      draw();
    } catch { /* fallback CSS */ }
  })();

  const pieceHtml = (id, where, slotId) => {
    const m = byId(id);
    const cropUrl = crops.get(id);
    const isOkSlot = where === 'slot' && slotId && placed[slotId] === slotId && (checked || locked.has(slotId));
    let fit = '';
    if (!blind && where === 'slot' && slotId) {
      const sl = byId(slotId);
      if (sl) fit = ` style="width:${((m.w / sl.w) * 100).toFixed(2)}%;height:${((m.h / sl.h) * 100).toFixed(2)}%"`;
    }
    const inner = cropUrl
      ? `<img class="lq-crop-img ${isOkSlot ? 'exact' : ''}" src="${cropUrl}" alt="" draggable="false">`
      : `<span class="lq-crop" style="background-image:url('${url}');${cropStyle(m)}"></span>`;
    return `<span class="lq-piece ${picked === id ? 'picked' : ''}" data-p="${id}" data-where="${where}"${fit} role="button" tabindex="0" aria-label="Etichetta${where === 'tray' ? '' : ' nel riquadro'}">${inner}</span>`;
  };

  const sizeTray = () => {
    if (blind) {
      $$('.lq-piece', tray).forEach(p => { p.style.width = ''; p.style.height = ''; });
      return;
    }
    const w = stage.getBoundingClientRect().width;
    $$('.lq-piece', tray).forEach(p => {
      const m = byId(p.dataset.p);
      p.style.width = `${Math.max(36, m.w * w)}px`;
      p.style.height = `${Math.max(18, m.h * w * (im.h / im.w))}px`;
    });
  };

  const draw = () => {
    dialog.classList.toggle('lq-blind', blind);
    const bBtn = $('[data-q="blind"]', root);
    if (bBtn) {
      bBtn.classList.toggle('primary', blind);
      bBtn.classList.toggle('ghost', !blind);
      bBtn.setAttribute('aria-pressed', String(blind));
      bBtn.textContent = blind ? '🙈 Senza indizi' : '📐 Riquadri reali';
    }
    hintEl.textContent = blind
      ? 'Tessere tutte uguali e bersagli standardizzati: niente indizi dalla forma. Trascina un’etichetta sul bersaglio (o toccala e poi tocca il numero).'
      : 'Trascina ogni etichetta nel riquadro giusto, oppure toccala e poi tocca il riquadro. Quando hai finito, controlla.';

    const inSlots = new Set(Object.values(placed));
    tray.innerHTML = order.filter(id => !inSlots.has(id)).map(id => pieceHtml(id, 'tray')).join('') || '<p class="hint lq-done">Tutte le etichette sono al loro posto.</p>';

    $$('.lq-slot', stage).forEach(s => {
      const sid = s.dataset.s;
      const m = byId(sid);
      const p = placed[sid];
      const num = slotNum.get(sid);
      const isOk = !!(p && p === sid && (checked || locked.has(sid)));
      const isBad = !!(checked && p && p !== sid);
      const cov = $(`.lq-cover[data-c="${sid}"]`, stage);
      if (cov) cov.classList.toggle('revealed', isOk);

      if (blind && !isOk) {
        s.setAttribute('style', centerStyle(m));
      } else {
        s.setAttribute('style', posStyle(m));
      }
      s.innerHTML = p ? pieceHtml(p, 'slot', sid) : (blind ? `<span class="lq-num" aria-hidden="true">${num}</span>` : '');
      s.classList.toggle('filled', !!p);
      s.classList.toggle('target', !!picked && !p);
      s.classList.toggle('ok', isOk);
      s.classList.toggle('bad', isBad);
      s.setAttribute('aria-label', `Riquadro ${num}${p ? (isOk ? ', giusto' : isBad ? ', sbagliato' : ', occupato') : ', vuoto'}`);
    });
    sizeTray();
    const n = Object.keys(placed).length;
    if (!checked) msg.textContent = `${n} di ${masks.length} sistemate`;
  };

  const place = (pid, sid) => {
    if (sid && locked.has(sid)) return;
    checked = false;
    let prevSlot = null;
    for (const k of Object.keys(placed)) if (placed[k] === pid) { if (locked.has(k)) return; prevSlot = k; delete placed[k]; }
    if (sid) {
      const displaced = placed[sid];
      placed[sid] = pid;
      // se stavi spostando da un altro riquadro a uno occupato, li scambia
      if (displaced && displaced !== pid && prevSlot) placed[prevSlot] = displaced;
    }
    picked = null;
    draw();
  };
  const unplace = pid => { for (const k of Object.keys(placed)) if (placed[k] === pid && !locked.has(k)) delete placed[k]; checked = false; };

  /* trascinamento con dito o mouse; un tocco senza movimento seleziona */
  let drag = null;
  let suppressClick = false;
  win.addEventListener('pointerdown', e => {
    const p = e.target.closest('.lq-piece');
    if (!p || e.button > 0) return;
    const slEl = p.closest('.lq-slot');
    if (slEl && locked.has(slEl.dataset.s)) return;
    e.preventDefault();
    const r = p.getBoundingClientRect();
    drag = { id: e.pointerId, pid: p.dataset.p, where: p.dataset.where, el: p, x0: e.clientX, y0: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, ghost: null };
    try { p.setPointerCapture(e.pointerId); } catch { /* va bene lo stesso */ }
  });
  win.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
      const g = drag.el.cloneNode(true);
      g.className = `lq-piece lq-ghost ${blind ? 'lq-ghost-blind' : ''}`;
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
    if (!d.ghost) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      // se hai già scelto un'etichetta e tocchi un riquadro occupato, la metti lì
      const slot = d.el.closest('.lq-slot');
      if (picked && picked !== d.pid && slot) {
        place(picked, slot.dataset.s);
        return;
      }
      picked = picked === d.pid ? null : d.pid;
      draw();
      return;
    }
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    d.ghost.remove();
    d.el.classList.remove('lifting');
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.lq-slot');
    if (over) place(d.pid, over.dataset.s);
    else { unplace(d.pid); picked = null; draw(); }
  };
  win.addEventListener('pointerup', endDrag);
  win.addEventListener('pointercancel', e => { if (drag && drag.ghost) drag.ghost.remove(); if (drag) drag.el.classList.remove('lifting'); drag = null; draw(); });
  win.addEventListener('click', e => {
    if (suppressClick) return;
    const s = e.target.closest('.lq-slot');
    if (s && picked && !e.target.closest('.lq-piece')) { place(picked, s.dataset.s); return; }
    // tocco nello spazio del vassoio con un'etichetta già posizionata selezionata -> la riporta nel vassoio
    if (picked && e.target.closest('#lqTray') && !e.target.closest('.lq-piece')) {
      unplace(picked);
      picked = null;
      draw();
    }
  });
  win.addEventListener('keydown', e => {
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
  const close = () => { alive = false; root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', sizeTray); route(); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', sizeTray);
  win.addEventListener('click', async e => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    const q = b.dataset.q;
    if (q === 'close') close();
    else if (q === 'blind') {
      blind = !blind;
      S().labelsBlind = blind;
      Settings.save();
      draw();
    } else if (q === 'edit') { alive = false; root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', sizeTray); openLabelEditor(sec, imageId); }
    else if (q === 'zoom') {
      zoom = zoom === 1 ? 1.5 : zoom === 1.5 ? 2 : 1;
      stage.style.width = `${zoom * 100}%`;
      stage.style.maxWidth = zoom === 1 ? '' : 'none';
      b.textContent = `Zoom ${zoom}×`;
      requestAnimationFrame(sizeTray);
    } else if (q === 'again') {
      Object.keys(placed).forEach(k => delete placed[k]);
      locked.clear();
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
        if (!checked || !alive) return;
        for (const k of Object.keys(placed)) {
          if (placed[k] === k) locked.add(k);
          else delete placed[k];
        }
        checked = false;
        draw();
        msg.textContent = `${ok} giuste su ${masks.length}: sistema le altre.`;
      }, 1400);
    }
  });
  hydrateImages(root);
  draw();
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
  // v4.03: le cartelle non hanno più un limite di livelli (resta solo quello di sicurezza)
  const room = GROUP_MAX_DEPTH - (base ? groupDepth(nb, base) : 0);
  if (room <= 0) return base.id;
  const same = (a, b) => foldAccents(a).trim() === foldAccents(b).trim();
  const find = (name, parentId) => groupsOf(nb).find(g => same(g.name, name) && (g.parentId || null) === (parentId || null));
  const make = (name, parentId) => {
    const g = { id: uid(), name: name.slice(0, 120) };
    if (parentId) g.parentId = parentId;
    nb.groups = [...groupsOf(nb), g];
    job.groupsChanged = true;
    return g;
  };
  let target = base;
  for (const name of path.slice(-room)) target = find(name, target ? target.id : null) || make(name, target ? target.id : null);
  if (job.groupsChanged) { await saveNotebook(nb); job.groupsChanged = false; }
  return target.id;
}


/* =====================================================================
   v4.03: Mappe HTML
   Mappe e pagine fatte in HTML (per esempio da Claude o da Gemini) si
   caricano in una sezione e si usano qui come in Chrome. Il file resta
   com’è, nell’archivio delle immagini (così si sincronizza con Drive ed
   entra nel backup); la sezione tiene nome e data in `sec.htmls`.
   Ogni mappa gira in un riquadro isolato: i suoi script funzionano, ma
   non possono leggere né cambiare i dati dell’app.
   ===================================================================== */
const HTML_MAX = 15 * 1024 * 1024;
const HTML_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads';
function chooseHtmlFiles(multiple = true) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.html,.htm,text/html';
    inp.multiple = multiple;
    inp.style.display = 'none';
    const done = files => { resolve(files); inp.remove(); };
    inp.addEventListener('change', () => done([...(inp.files || [])]), { once: true });
    inp.addEventListener('cancel', () => done([]), { once: true });
    document.body.appendChild(inp);
    inp.click();
  });
}
// il titolo della pagina (<title>), se c’è, altrimenti il nome del file
function htmlTitleOf(text, fileName) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text.slice(0, 200000));
  let t = '';
  if (m) {
    try { t = new DOMParser().parseFromString(`<p>${m[1]}</p>`, 'text/html').body.textContent || ''; } catch { t = m[1]; }
  }
  t = t.replace(/\s+/g, ' ').trim().slice(0, 140);
  return t || String(fileName || 'Mappa').replace(/\.html?$/i, '').replace(/[_]+/g, ' ').trim() || 'Mappa';
}
async function readHtmlFile(file) {
  if (!file) throw new Error('Nessun file scelto.');
  if (file.size > HTML_MAX) throw new Error(`“${file.name}” è troppo grande (${fmtMB(file.size)}): il massimo è ${fmtMB(HTML_MAX)}.`);
  const text = await file.text();
  if (!/<[a-z!][\s\S]*>/i.test(text.slice(0, 20000))) throw new Error(`“${file.name}” non sembra un file HTML.`);
  return text;
}
// salva il file e restituisce la voce da mettere nella sezione
async function storeHtmlFile(file, notebookId) {
  const text = await readHtmlFile(file);
  const blob = new Blob([text], { type: 'text/html' });
  const now = Date.now();
  const im = { id: uid(), notebookId, mime: 'text/html', size: blob.size, blob, created: now, updated: now };
  await DB.put('images', im);
  state.images.push(im);
  scheduleSync();
  return { id: im.id, name: htmlTitleOf(text, file.name), file: file.name, size: blob.size, added: now };
}
// dalla pagina del notebook o di una cartella: ogni file diventa una sezione
async function addHtmlSections(nb, groupId) {
  const files = await chooseHtmlFiles(true);
  if (!files.length) return;
  const made = [];
  for (const f of files) {
    try {
      const rec = await storeHtmlFile(f, nb.id);
      const sec = newSection(nb.id, { title: rec.name, groupId: groupId || null, source: rec.file });
      sec.htmls = [rec];
      await saveSection(sec);
      made.push(sec);
    } catch (err) { toast(err.message || `Non riesco a leggere “${f.name}”`, 'err'); }
  }
  if (!made.length) return;
  if (made.length === 1) { go(`#/sec/${made[0].id}/html`); return; }
  toast(`${made.length} mappe HTML aggiunte, una per sezione`);
  route();
}
function downloadHtmlOf(h) {
  const im = imageById(h.id);
  if (!im || !im.blob) { toast('Il file non è ancora arrivato su questo dispositivo', 'err'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(im.blob);
  const base = String(h.file || h.name || 'Mappa').replace(/\.html?$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Mappa';
  a.download = `${base}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

function modeHtml(sec, body, { inPanel = false } = {}) {
  let hi = 0;
  let full = false;
  const want = sessionStorage.getItem(`nb-html:${sec.id}`);
  const startAt = htmlsOf(sec).findIndex(h => h.id === want);
  if (startAt > 0) hi = startAt;
  const setFull = on => {
    full = on;
    const wrap = $('.hm-wrap', body);
    if (wrap) wrap.classList.toggle('hm-full', on);
    document.body.classList.toggle('hm-full-on', on);
    const b = $('[data-hm="full"]', body);
    if (b) b.setAttribute('aria-pressed', String(on));
    const x = $('.hm-exit', body);
    if (x) x.hidden = !on;
    if (on) {
      // schermo intero vero dove il browser lo permette (Android, computer); altrimenti basta il riquadro sopra tutto
      const req = wrap && (wrap.requestFullscreen || wrap.webkitRequestFullscreen);
      if (req) { try { const p = req.call(wrap); if (p && p.catch) p.catch(() => {}); } catch { /* resta il riquadro */ } }
    } else {
      const fs = document.fullscreenElement || document.webkitFullscreenElement;
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      if (fs && ex) { try { const p = ex.call(document); if (p && p.catch) p.catch(() => {}); } catch { /* niente */ } }
    }
  };
  const onFs = () => { if (full && !(document.fullscreenElement || document.webkitFullscreenElement)) setFull(false); };
  const onKey = e => { if (e.key === 'Escape' && full && body.isConnected) setFull(false); };
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('webkitfullscreenchange', onFs);
  document.addEventListener('keydown', onKey);
  addCleanup(() => {
    document.removeEventListener('fullscreenchange', onFs);
    document.removeEventListener('webkitfullscreenchange', onFs);
    document.removeEventListener('keydown', onKey);
    if (full) setFull(false);
    document.body.classList.remove('hm-full-on');
  });
  const add = async () => {
    const files = await chooseHtmlFiles(true);
    if (!files.length) return;
    let n = 0;
    for (const f of files) {
      try { const rec = await storeHtmlFile(f, sec.notebookId); sec.htmls = [...htmlsOf(sec), rec]; n++; }
      catch (err) { toast(err.message || `Non riesco a leggere “${f.name}”`, 'err'); }
    }
    if (!n) return;
    await saveSection(sec);
    hi = htmlsOf(sec).length - 1;
    toast(n === 1 ? 'Mappa aggiunta' : `${n} mappe aggiunte`);
    draw();
  };
  const draw = () => {
    const list = htmlsOf(sec);
    if (hi >= list.length) hi = Math.max(0, list.length - 1);
    const h = list[hi];
    // il numero sulla scheda segue le mappe aggiunte o tolte
    if (!inPanel) { const t = $(`.tabs a[href="#/sec/${sec.id}/html"]`); if (t) t.textContent = `Mappe HTML${list.length ? ` (${list.length})` : ''}`; }
    if (!h) {
      body.innerHTML = `
        <div class="empty">
          <p>Qui metti le mappe e le pagine fatte in HTML, per esempio quelle che ti prepara Claude o Gemini: funzionano come in Chrome (zoom, rami che si aprono, pulsanti), ma restano dentro la sezione e si sincronizzano con gli altri dispositivi.</p>
          <button class="btn primary" type="button" data-hm="add">Carica un file HTML</button>
        </div>
        <p class="hint">Puoi sceglierne più di uno alla volta. Dalla pagina del notebook o di una cartella, “＋ Mappa HTML” crea invece una sezione nuova per ogni file.</p>`;
      return;
    }
    sessionStorage.setItem(`nb-html:${sec.id}`, h.id);
    const im = imageById(h.id);
    body.innerHTML = `
      <div class="hm-bar">
        ${list.length > 1 ? `<select class="input hm-sel" data-hm-sel aria-label="Mappa">${list.map((x, k) => `<option value="${k}" ${k === hi ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : (h.name !== sec.title || inPanel ? `<b class="hm-name">${esc(h.name)}</b>` : '')}
        <span class="hm-acts">
          <button class="btn sm" type="button" data-hm="full" aria-pressed="false" ${im && im.blob ? '' : 'disabled'}>⛶ Schermo intero</button>
          <button class="btn sm ghost" type="button" data-hm="add">＋ Aggiungi</button>
          <button class="btn sm ghost" type="button" data-hm="more">Altro ▾</button>
        </span>
      </div>
      <div class="hm-wrap">
        ${im && im.blob
          ? `<iframe class="hm-frame" data-hmid="${esc(h.id)}" sandbox="${HTML_SANDBOX}" title="${esc(h.name)}" allow="fullscreen; clipboard-write" referrerpolicy="no-referrer"></iframe>`
          : `<div class="empty hm-wait"><p>Questa mappa non è ancora arrivata su questo dispositivo: arriva con la prossima sincronizzazione con Drive.</p>${Sync.configured() ? '<button class="btn" type="button" data-hm="sync">Sincronizza adesso</button>' : ''}</div>`}
        <button class="btn hm-exit" type="button" data-hm="exit" hidden>✕ Esci dallo schermo intero</button>
      </div>
      ${inPanel ? '' : '<p class="hint">La mappa funziona come in Chrome ma isolata: non può leggere né cambiare i tuoi appunti. Se usa librerie prese da internet (grafici, Mermaid, D3…), le serve la connessione.</p>'}`;
    const fr = $('.hm-frame', body);
    if (fr && im && im.blob) {
      im.blob.text().then(t => { if (fr.isConnected) fr.srcdoc = prepareHtmlSrcdoc(t, h.id); }).catch(() => toast('Non riesco ad aprire il file', 'err'));
    }
    if (full) setFull(true);
  };
  body.addEventListener('change', e => {
    if (!e.target.matches('[data-hm-sel]')) return;
    hi = +e.target.value || 0;
    draw();
  });
  body.addEventListener('click', async e => {
    const b = e.target.closest('[data-hm]');
    if (!b || b.disabled) return;
    const act = b.dataset.hm;
    const list = htmlsOf(sec);
    const h = list[hi];
    if (act === 'add') return add();
    if (act === 'full') return setFull(!full);
    if (act === 'exit') return setFull(false);
    if (act === 'sync') { if (typeof Sync.run === 'function') await Sync.run(); else scheduleSync(); return draw(); }
    if (act !== 'more' || !h) return;
    const choice = await actionSheet(h.name, [
      { key: 'rename', label: 'Rinomina' },
      { key: 'replace', label: 'Sostituisci con una versione nuova del file' },
      { key: 'download', label: 'Scarica il file HTML' },
      ...(list.length > 1 ? [
        { key: 'up', label: 'Sposta prima', disabled: hi === 0 },
        { key: 'down', label: 'Sposta dopo', disabled: hi === list.length - 1 }
      ] : []),
      ...(list.length === 1 && sec.title !== h.name ? [{ key: 'title', label: 'Usa il suo nome come titolo della sezione' }] : []),
      { key: 'delete', label: 'Togli dalla sezione', danger: true }
    ]);
    if (!choice) return;
    if (choice === 'rename') {
      const name = await modal({ title: 'Rinomina la mappa', input: true, value: h.name, confirm: 'Rinomina' });
      if (!name) return;
      h.name = name;
      sec.htmls = [...list];
      await saveSection(sec);
      return draw();
    }
    if (choice === 'title') {
      sec.title = h.name;
      await saveSection(sec);
      return route();
    }
    if (choice === 'replace') {
      const [f] = await chooseHtmlFiles(false);
      if (!f) return;
      try {
        const text = await readHtmlFile(f);
        const im = imageById(h.id);
        const blob = new Blob([text], { type: 'text/html' });
        const now = Date.now();
        // stesso id: le altre copie della sezione (Affianca, altri dispositivi) restano collegate
        const rec = im || { id: h.id, notebookId: sec.notebookId, created: now };
        Object.assign(rec, { mime: 'text/html', blob, size: blob.size, updated: now });
        await DB.put('images', rec);
        if (!im) state.images.push(rec);
        forgetImageUrl(h.id);
        h.file = f.name; h.size = blob.size; h.edited = now;
        sec.htmls = [...list];
        await saveSection(sec);
        scheduleSync();
        toast('Mappa aggiornata');
      } catch (err) { toast(err.message || 'Non riesco a leggere il file', 'err'); }
      return draw();
    }
    if (choice === 'download') return downloadHtmlOf(h);
    if (choice === 'up' || choice === 'down') {
      const to = hi + (choice === 'up' ? -1 : 1);
      const arr = [...list];
      [arr[hi], arr[to]] = [arr[to], arr[hi]];
      sec.htmls = arr;
      hi = to;
      await saveSection(sec);
      return draw();
    }
    if (choice === 'delete') {
      const ok = await modal({ title: 'Togliere la mappa?', text: `“${h.name}” sparisce da questa sezione e da tutti i dispositivi. Se ti serve ancora, prima scaricala da Altro ▾ › Scarica il file HTML.`, confirm: 'Togli', danger: true });
      if (!ok) return;
      sec.htmls = list.filter(x => x.id !== h.id);
      await saveSection(sec);
      await removeOrphanImages([h.id]);
      toast('Mappa tolta');
      return draw();
    }
  });
  draw();
}


/* =====================================================================
   v4.10: Quiz di discriminazione (Smistamento, A vs B, Sequenza, Intruso)
   Generati con Gemini/AI dagli appunti della sezione o di una cartella,
   con campo "Cosa confondi spesso?" per mirare il quiz sulle tue confusioni.
   ===================================================================== */
const DQ_TYPES = [
  ['sort', 'Smistamento', 'A chi appartiene? (es. mesencefalo / ponte / bulbo)'],
  ['ab', 'Confronto A vs B', 'Solo A, Solo B, Entrambi o Nessuno'],
  ['order', 'Sequenza', 'Rimetti in ordine strati o stazioni di una via'],
  ['odd', 'Trova l’intruso', '3 condividono un criterio preciso, 1 no']
];
const dquizCache = {};

function dqParseJson(raw) {
  const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Risposta dell’AI non in formato JSON: riprova.');
  return JSON.parse(m[0]);
}

function dqPrompt(type, focus) {
  const f = (focus || '').trim();
  const focusNote = f
    ? `\nPRIORITÀ ASSOLUTA — LO STUDENTE CONFONDE SPESSO QUESTO:\n"${f}"\nConcentra TUTTO il quiz esattamente su questa distinzione/confusione, basandoti sugli appunti.\n`
    : '\nIndividua negli appunti gli elementi, strati, nuclei, vie o concetti più simili e facili da confondere tra loro, e costruisci il quiz su quelli.\n';
  const base = 'Sei un tutor universitario di medicina (in particolare neuroanatomia e scienze mediche). Crea un esercizio di discriminazione attiva basato SOLO sugli appunti forniti, in italiano, senza inventare dati non presenti. Rispondi SOLO con JSON valido, senza testo prima o dopo.' + focusNote;
  if (type === 'sort') return base + `
Modalità: SMISTAMENTO ("A chi appartiene?").
Scegli da 2 a 4 categorie facilmente confondibili negli appunti (es. livelli del tronco encefalico, tipi di corteccia, classi di farmaci) e crea da 8 a 12 elementi da assegnare alla categoria corretta.
JSON richiesto:
{"titolo":"Titolo breve","categorie":["Cat 1","Cat 2"],"domande":[{"elemento":"Nome o caratteristica breve","cat":0,"spiegazione":"Spiegazione breve (1-2 frasi)"}]}
("cat" è l'indice 0-based dentro "categorie").`;
  if (type === 'ab') return base + `
Modalità: CONFRONTO DIRETTO (A vs B).
Scegli 2 strutture/concetti molto confondibili dagli appunti (A e B) e crea da 8 a 12 affermazioni brevi. Per ognuna la risposta esatta deve essere "A" (solo A), "B" (solo B), "AB" (entrambi) o "N" (nessuno dei due). Bilancia le 4 risposte.
JSON richiesto:
{"a":"Nome di A","b":"Nome di B","domande":[{"testo":"Affermazione breve e precisa","risposta":"A","spiegazione":"Perché (1-2 frasi)"}]}`;
  if (type === 'order') return base + `
Modalità: ORDINA LA SEQUENZA.
Estrai da 2 a 3 sequenze ordinate dagli appunti (es. strati di una corteccia dalla superficie alla profondità, tappe di una via nervosa, nuclei in senso cranio-caudale), ciascuna con 4–6 passaggi chiari e distinti nell'ordine esatto.
JSON richiesto:
{"sequenze":[{"titolo":"Cosa ordinare e in che verso (es. dalla pia alla sostanza bianca)","passi":["Primo","Secondo","Terzo","Quarto"],"spiegazione":"Breve sintesi della sequenza"}]}`;
  return base + `
Modalità: TROVA L'INTRUSO (Odd one out).
Crea da 6 a 10 domande. Ogni domanda ha esattamente 4 opzioni brevi: 3 condividono un criterio anatomico/funzionale preciso presente negli appunti e 1 è l'intruso.
JSON richiesto:
{"domande":[{"opzioni":["Opt 1","Opt 2","Opt 3","Opt 4"],"intruso":2,"criterio":"Cosa accomuna gli altri 3","spiegazione":"Perché l'intruso è diverso (1-2 frasi)"}]}
("intruso" è l'indice 0-based dentro "opzioni").`;
}

function dqShuffleIdx(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function renderDiscQuizHost(body, { title, md, getMd, getTitle, nbId, secId, getSaved, setSaved, getConfusions, setConfusions, onFinishGrade }) {
  let type = 'sort';
  let focus = '';
  let loading = false;

  const makeCardBtn = (front, back) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn sm ghost';
    b.textContent = '＋ Flashcard';
    b.title = 'Trasforma questo punto in una flashcard';
    b.addEventListener('click', async () => {
      await openCardSheet({ front, back, sectionId: secId || null, notebookId: nbId });
    });
    return b;
  };

  const paintShell = () => {
    const saved = getSaved(type);
    const confs = getConfusions();
    body.innerHTML = `
      <div class="dq-top">
        <div class="dq-types" role="tablist" aria-label="Tipo di quiz">
          ${DQ_TYPES.map(([k, l, d]) => `<button type="button" class="dq-pill${k === type ? ' on' : ''}" role="tab" aria-selected="${k === type}" data-dqt="${k}" title="${esc(d)}">${l}${getSaved(k) ? ' · ✓' : ''}</button>`).join('')}
        </div>
        <div class="dq-focus">
          <label class="field"><span>Cosa confondi spesso? <small class="muted-inline">(facoltativo: lascia vuoto per farlo scegliere all’AI)</small></span>
            <div class="inline">
              <input class="input" id="dqFocus" value="${esc(focus)}" placeholder="Es. strati neocorteccia vs archicorteccia, oppure nuclei del ponte vs bulbo">
              <button type="button" class="btn sm ghost" data-act="dq-save-conf" title="Salva questa confusione tra i pulsanti rapidi">Salva</button>
            </div>
          </label>
          ${confs.length ? `<div class="dq-chips" aria-label="Confusioni salvate">${confs.map((c, i) => `<span class="dq-chip${focus === c ? ' on' : ''}"><button type="button" class="dq-chip-t" data-dqc="${i}">${esc(c)}</button><button type="button" class="dq-chip-x" data-dqcd="${i}" aria-label="Rimuovi">×</button></span>`).join('')}</div>` : ''}
        </div>
        <div class="dq-bar">
          ${AI.ready() ? `<button type="button" class="btn ${saved ? '' : 'primary'}" data-act="dq-gen" ${loading ? 'disabled' : ''}>${loading ? 'Genero il quiz…' : saved ? `↻ Rigenera con ${AI.name()}` : `Genera con ${AI.name()}`}</button>`
            : '<p class="hint">Per generare questi quiz aggiungi la chiave Gemini o Claude in <a href="#/settings">Impostazioni</a>.</p>'}
          ${saved ? `<span class="hint dq-meta">${saved.focus ? `Mirato su: “${esc(saved.focus)}”` : 'Generato dagli appunti'}</span>` : ''}
        </div>
      </div>
      <div id="dqStage"></div>
      <div id="dqGrade"></div>`;

    const inp = $('#dqFocus', body);
    if (inp) inp.addEventListener('input', () => { focus = inp.value; });
    $$('[data-dqt]', body).forEach(b => b.addEventListener('click', () => {
      if (loading) return;
      type = b.dataset.dqt;
      paintShell();
    }));
    on('[data-act="dq-save-conf"]', 'click', async () => {
      const v = focus.trim();
      if (!v) { toast('Scrivi prima cosa confondi'); inp?.focus(); return; }
      const next = [...new Set([v, ...getConfusions()])].slice(0, 12);
      await setConfusions(next);
      toast('Confusione salvata');
      paintShell();
    }, body);
    $$('[data-dqc]', body).forEach(b => b.addEventListener('click', () => {
      const c = getConfusions()[+b.dataset.dqc];
      if (!c) return;
      focus = focus === c ? '' : c;
      paintShell();
    }));
    $$('[data-dqcd]', body).forEach(b => b.addEventListener('click', async () => {
      const next = getConfusions().filter((_, i) => i !== +b.dataset.dqcd);
      await setConfusions(next);
      paintShell();
    }));
    on('[data-act="dq-gen"]', 'click', async () => {
      const curMd = typeof getMd === 'function' ? getMd() : md;
      const curTitle = typeof getTitle === 'function' ? getTitle() : title;
      const txt = aiText(curMd).trim();
      if (txt.length < 80) { toast('Seleziona almeno una sezione o un paragrafo con abbastanza appunti', 'err'); return; }
      loading = true;
      paintShell();
      try {
        const f = focus.trim();
        if (f && !getConfusions().includes(f)) await setConfusions([f, ...getConfusions()].slice(0, 12));
        const r = await AI.generate({
          system: dqPrompt(type, f),
          text: `ARGOMENTO: ${curTitle}\n\nAPPUNTI:\n${txt.slice(0, 18000)}`,
          json: true,
          maxTokens: 4500
        });
        const data = dqParseJson(r.text);
        const ok = (type === 'sort' && Array.isArray(data.categorie) && data.categorie.length >= 2 && Array.isArray(data.domande) && data.domande.length)
          || (type === 'ab' && data.a && data.b && Array.isArray(data.domande) && data.domande.length)
          || (type === 'order' && Array.isArray(data.sequenze) && data.sequenze.length)
          || (type === 'odd' && Array.isArray(data.domande) && data.domande.length);
        if (!ok) throw new Error('Il quiz generato era incompleto: riprova.');
        await setSaved(type, { ...data, focus: f, at: Date.now() });
      } catch (err) {
        toast(err.message || 'Generazione non riuscita', 'err');
      } finally {
        loading = false;
        paintShell();
      }
    }, body);

    const stage = $('#dqStage', body);
    if (!saved) {
      const info = DQ_TYPES.find(x => x[0] === type);
      stage.innerHTML = `<div class="empty"><p><strong>${info[1]}</strong>: ${info[2]}.<br>Scrivi sopra cosa confondi (oppure lascia vuoto) e tocca <em>Genera</em>.</p></div>`;
      return;
    }
    if (type === 'sort') runSort(stage, saved);
    else if (type === 'ab') runAB(stage, saved);
    else if (type === 'order') runOrder(stage, saved);
    else runOdd(stage, saved);
  };

  const showDone = (stage, { right, wrong, idk, total, missed, isRetry, onAgain, onRetryMissed }) => {
    const pct = total ? right / total : 0;
    const suggested = pct < 0.5 ? 'again' : pct < 0.7 ? 'hard' : pct < 0.9 ? 'good' : 'easy';
    stage.innerHTML = `
      <div class="qcard done">
        <p class="score">${right} su ${total}</p>
        <p class="hint">${isRetry ? 'ripasso completato' : 'risposte esatte'}</p>
        <div class="dq-stats" aria-label="Riepilogo risposte">
          <span class="dq-stat ok">✓ ${right} ${right === 1 ? 'esatta' : 'esatte'}</span>
          <span class="dq-stat ko">✗ ${wrong} ${wrong === 1 ? 'sbagliata' : 'sbagliate'}</span>
          <span class="dq-stat idk">? ${idk} non so</span>
        </div>
        <div class="inline dq-done-acts">
          ${missed.length ? `<button class="btn primary" type="button" data-dq="retry-missed">↻ Ripassa errori e Non so (${missed.length})</button>` : ''}
          <button class="btn ${missed.length ? 'ghost' : 'primary'}" type="button" data-dq="again">${isRetry ? 'Rifai tutto il quiz' : 'Rifai il quiz'}</button>
        </div>
      </div>`;
    $('[data-dq="again"]', stage).onclick = onAgain;
    const rm = $('[data-dq="retry-missed"]', stage);
    if (rm && onRetryMissed) rm.onclick = onRetryMissed;
    if (onFinishGrade) onFinishGrade($('#dqGrade', body), suggested);
  };

  const runSort = (stage, data, subset = null) => {
    const gradeEl = $('#dqGrade', body);
    if (gradeEl) gradeEl.innerHTML = '';
    const order = subset ? dqShuffleIdx(subset.length).map(i => subset[i]) : dqShuffleIdx(data.domande.length);
    let pos = 0, right = 0, wrong = 0, idk = 0;
    const missed = [];
    const draw = () => {
      if (pos >= order.length) return showDone(stage, { right, wrong, idk, total: order.length, missed, isRetry: !!subset, onAgain: () => runSort(stage, data), onRetryMissed: () => runSort(stage, data, missed) });
      const q = data.domande[order[pos]];
      stage.innerHTML = `
        <div class="qcard dq-card">
          <p class="qnum">${esc(data.titolo || 'Smistamento')}${subset ? ' · ripasso' : ''} · ${pos + 1} di ${order.length}</p>
          <p class="q">${esc(q.elemento)}</p>
          <div class="dq-opts">${data.categorie.map((c, i) => `<button type="button" class="btn dq-opt" data-ci="${i}">${esc(c)}</button>`).join('')}</div>
          <div class="dq-idk-row"><button type="button" class="btn sm ghost dq-idk-btn" data-dq="idk">? Non so</button></div>
          <div class="dq-fb" hidden></div>
        </div>`;
      let locked = false;
      const resolve = pick => {
        if (locked) return;
        locked = true;
        const isIdk = pick === null;
        const ok = !isIdk && pick === +q.cat;
        if (ok) right++;
        else { if (isIdk) idk++; else wrong++; missed.push(order[pos]); }
        $$('[data-ci]', stage).forEach(x => {
          const idx = +x.dataset.ci;
          x.disabled = true;
          if (idx === +q.cat) x.classList.add('right');
          else if (!isIdk && idx === pick) x.classList.add('wrong');
        });
        const idkRow = $('.dq-idk-row', stage);
        if (idkRow) idkRow.hidden = true;
        const fb = $('.dq-fb', stage);
        fb.hidden = false;
        const cls = ok ? 'dq-ok' : isIdk ? 'dq-idk' : 'dq-ko';
        const lead = ok ? 'Esatto!' : isIdk ? `Non la sapevi — Appartiene a ${esc(data.categorie[+q.cat])}.` : `No: appartiene a ${esc(data.categorie[+q.cat])}.`;
        fb.innerHTML = `<p class="${cls}"><strong>${lead}</strong> ${esc(q.spiegazione || '')}</p><div class="inline dq-fb-acts"><button type="button" class="btn primary sm" data-dq="next">${pos + 1 >= order.length ? 'Vedi risultato' : 'Avanti'}</button></div>`;
        $('.dq-fb-acts', fb).prepend(makeCardBtn(`A quale categoria appartiene: ${q.elemento}?`, `**${data.categorie[+q.cat]}**${q.spiegazione ? `\n\n${q.spiegazione}` : ''}`));
        $('[data-dq="next"]', fb).onclick = () => { pos++; draw(); };
        $('[data-dq="next"]', fb).focus();
      };
      $$('[data-ci]', stage).forEach(b => b.addEventListener('click', () => resolve(+b.dataset.ci)));
      $('[data-dq="idk"]', stage).onclick = () => resolve(null);
    };
    draw();
  };

  const runAB = (stage, data, subset = null) => {
    const gradeEl = $('#dqGrade', body);
    if (gradeEl) gradeEl.innerHTML = '';
    const order = subset ? dqShuffleIdx(subset.length).map(i => subset[i]) : dqShuffleIdx(data.domande.length);
    let pos = 0, right = 0, wrong = 0, idk = 0;
    const missed = [];
    const labels = { A: `Solo ${data.a}`, B: `Solo ${data.b}`, AB: 'Entrambi', N: 'Nessuno' };
    const draw = () => {
      if (pos >= order.length) return showDone(stage, { right, wrong, idk, total: order.length, missed, isRetry: !!subset, onAgain: () => runAB(stage, data), onRetryMissed: () => runAB(stage, data, missed) });
      const q = data.domande[order[pos]];
      const ans = String(q.risposta || '').toUpperCase();
      stage.innerHTML = `
        <div class="qcard dq-card">
          <p class="qnum">Confronto${subset ? ' · ripasso' : ''} · ${pos + 1} di ${order.length}</p>
          <div class="dq-ab-head"><span class="dq-ab-tag"><b>A</b> ${esc(data.a)}</span><span class="dq-ab-vs">vs</span><span class="dq-ab-tag"><b>B</b> ${esc(data.b)}</span></div>
          <p class="q">${esc(q.testo)}</p>
          <div class="dq-opts dq-ab-opts">
            ${['A', 'B', 'AB', 'N'].map(k => `<button type="button" class="btn dq-opt" data-ab="${k}">${esc(labels[k])}</button>`).join('')}
          </div>
          <div class="dq-idk-row"><button type="button" class="btn sm ghost dq-idk-btn" data-dq="idk">? Non so</button></div>
          <div class="dq-fb" hidden></div>
        </div>`;
      let locked = false;
      const resolve = pick => {
        if (locked) return;
        locked = true;
        const isIdk = pick === null;
        const ok = !isIdk && pick === ans;
        if (ok) right++;
        else { if (isIdk) idk++; else wrong++; missed.push(order[pos]); }
        $$('[data-ab]', stage).forEach(x => {
          x.disabled = true;
          if (x.dataset.ab === ans) x.classList.add('right');
          else if (!isIdk && x.dataset.ab === pick) x.classList.add('wrong');
        });
        const idkRow = $('.dq-idk-row', stage);
        if (idkRow) idkRow.hidden = true;
        const fb = $('.dq-fb', stage);
        fb.hidden = false;
        const cls = ok ? 'dq-ok' : isIdk ? 'dq-idk' : 'dq-ko';
        const lead = ok ? 'Esatto!' : isIdk ? `Non la sapevi — Risposta corretta: ${esc(labels[ans] || ans)}.` : `Risposta corretta: ${esc(labels[ans] || ans)}.`;
        fb.innerHTML = `<p class="${cls}"><strong>${lead}</strong> ${esc(q.spiegazione || '')}</p><div class="inline dq-fb-acts"><button type="button" class="btn primary sm" data-dq="next">${pos + 1 >= order.length ? 'Vedi risultato' : 'Avanti'}</button></div>`;
        $('.dq-fb-acts', fb).prepend(makeCardBtn(`${data.a} vs ${data.b}: ${q.testo}`, `**${labels[ans] || ans}**${q.spiegazione ? `\n\n${q.spiegazione}` : ''}`));
        $('[data-dq="next"]', fb).onclick = () => { pos++; draw(); };
        $('[data-dq="next"]', fb).focus();
      };
      $$('[data-ab]', stage).forEach(b => b.addEventListener('click', () => resolve(b.dataset.ab)));
      $('[data-dq="idk"]', stage).onclick = () => resolve(null);
    };
    draw();
  };

  const runOrder = (stage, data, subset = null) => {
    const gradeEl = $('#dqGrade', body);
    if (gradeEl) gradeEl.innerHTML = '';
    const order = subset ? [...subset] : data.sequenze.map((_, i) => i);
    let pos = 0, right = 0, wrong = 0, idk = 0;
    const missed = [];
    const draw = () => {
      if (pos >= order.length) return showDone(stage, { right, wrong, idk, total: order.length, missed, isRetry: !!subset, onAgain: () => runOrder(stage, data), onRetryMissed: () => runOrder(stage, data, missed) });
      const seqIdx = order[pos];
      const seq = data.sequenze[seqIdx];
      const steps = seq.passi || [];
      let cur = dqShuffleIdx(steps.length);
      if (steps.length > 1 && cur.every((v, i) => v === i)) [cur[0], cur[1]] = [cur[1], cur[0]];
      let checked = false, gaveUp = false;
      const paintSeq = () => {
        stage.innerHTML = `
          <div class="qcard dq-card">
            <p class="qnum">Sequenza${subset ? ' · ripasso' : ''} ${pos + 1} di ${order.length}</p>
            <p class="q">${esc(seq.titolo)}</p>
            <ol class="dq-seq">${cur.map((si, i) => `
              <li class="dq-seq-item${checked ? (gaveUp ? ' idk' : (si === i ? ' ok' : ' ko')) : ''}">
                <span class="dq-seq-n">${i + 1}</span>
                <span class="dq-seq-t">${esc(steps[si])}</span>
                ${checked ? '' : `<span class="dq-seq-mv"><button type="button" class="btn sm ghost" data-mv="-1" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Sposta su">↑</button><button type="button" class="btn sm ghost" data-mv="1" data-i="${i}" ${i === cur.length - 1 ? 'disabled' : ''} aria-label="Sposta giù">↓</button></span>`}
              </li>`).join('')}</ol>
            <div class="dq-fb"></div>
          </div>`;
        if (!checked) {
          $$('[data-mv]', stage).forEach(b => b.addEventListener('click', () => {
            const i = +b.dataset.i, j = i + (+b.dataset.mv);
            if (j < 0 || j >= cur.length) return;
            [cur[i], cur[j]] = [cur[j], cur[i]];
            paintSeq();
          }));
          $('.dq-fb', stage).innerHTML = '<div class="inline dq-fb-acts"><button type="button" class="btn primary" data-dq="check">Controlla l’ordine</button><button type="button" class="btn ghost dq-idk-btn" data-dq="idk">? Non so</button></div>';
          $('[data-dq="check"]', stage).onclick = () => {
            checked = true;
            const ok = cur.every((v, i) => v === i);
            if (ok) right++;
            else { wrong++; missed.push(seqIdx); }
            paintSeq();
          };
          $('[data-dq="idk"]', stage).onclick = () => {
            checked = true;
            gaveUp = true;
            idk++;
            missed.push(seqIdx);
            cur = steps.map((_, i) => i);
            paintSeq();
          };
        } else {
          const ok = !gaveUp && cur.every((v, i) => v === i);
          const fb = $('.dq-fb', stage);
          const cls = ok ? 'dq-ok' : gaveUp ? 'dq-idk' : 'dq-ko';
          const lead = ok ? 'Ordine perfetto!' : gaveUp ? 'Non la sapevi — Ecco la sequenza esatta.' : 'Qualche passaggio non era al posto giusto.';
          fb.innerHTML = `<p class="${cls}"><strong>${lead}</strong> ${esc(seq.spiegazione || '')}</p>
            ${ok || gaveUp ? '' : `<p class="hint"><strong>Ordine esatto:</strong> ${steps.map((s, i) => `${i + 1}. ${esc(s)}`).join(' → ')}</p>`}
            <div class="inline dq-fb-acts"><button type="button" class="btn primary sm" data-dq="next">${pos + 1 >= order.length ? 'Vedi risultato' : 'Prossima sequenza'}</button></div>`;
          $('.dq-fb-acts', fb).prepend(makeCardBtn(seq.titolo, steps.map((s, i) => `${i + 1}. ${s}`).join('\n')));
          $('[data-dq="next"]', fb).onclick = () => { pos++; draw(); };
          $('[data-dq="next"]', fb).focus();
        }
      };
      paintSeq();
    };
    draw();
  };

  const runOdd = (stage, data, subset = null) => {
    const gradeEl = $('#dqGrade', body);
    if (gradeEl) gradeEl.innerHTML = '';
    const order = subset ? dqShuffleIdx(subset.length).map(i => subset[i]) : dqShuffleIdx(data.domande.length);
    let pos = 0, right = 0, wrong = 0, idk = 0;
    const missed = [];
    const draw = () => {
      if (pos >= order.length) return showDone(stage, { right, wrong, idk, total: order.length, missed, isRetry: !!subset, onAgain: () => runOdd(stage, data), onRetryMissed: () => runOdd(stage, data, missed) });
      const q = data.domande[order[pos]];
      stage.innerHTML = `
        <div class="qcard dq-card">
          <p class="qnum">Trova l’intruso${subset ? ' · ripasso' : ''} · ${pos + 1} di ${order.length}</p>
          <p class="q">Quale di questi 4 non appartiene allo stesso gruppo?</p>
          <div class="dq-opts">${(q.opzioni || []).map((o, i) => `<button type="button" class="btn dq-opt" data-oi="${i}">${esc(o)}</button>`).join('')}</div>
          <div class="dq-idk-row"><button type="button" class="btn sm ghost dq-idk-btn" data-dq="idk">? Non so</button></div>
          <div class="dq-fb" hidden></div>
        </div>`;
      let locked = false;
      const resolve = pick => {
        if (locked) return;
        locked = true;
        const isIdk = pick === null;
        const ok = !isIdk && pick === +q.intruso;
        if (ok) right++;
        else { if (isIdk) idk++; else wrong++; missed.push(order[pos]); }
        $$('[data-oi]', stage).forEach(x => {
          const idx = +x.dataset.oi;
          x.disabled = true;
          if (idx === +q.intruso) x.classList.add('right');
          else if (!isIdk && idx === pick) x.classList.add('wrong');
        });
        const idkRow = $('.dq-idk-row', stage);
        if (idkRow) idkRow.hidden = true;
        const fb = $('.dq-fb', stage);
        fb.hidden = false;
        const cls = ok ? 'dq-ok' : isIdk ? 'dq-idk' : 'dq-ko';
        const lead = ok ? 'Preso!' : isIdk ? `Non la sapevi — L’intruso era: ${esc((q.opzioni || [])[+q.intruso] || '')}.` : `L’intruso era: ${esc((q.opzioni || [])[+q.intruso] || '')}.`;
        fb.innerHTML = `<p class="${cls}"><strong>${lead}</strong> ${q.criterio ? `<em>Criterio:</em> ${esc(q.criterio)}. ` : ''}${esc(q.spiegazione || '')}</p><div class="inline dq-fb-acts"><button type="button" class="btn primary sm" data-dq="next">${pos + 1 >= order.length ? 'Vedi risultato' : 'Avanti'}</button></div>`;
        $('.dq-fb-acts', fb).prepend(makeCardBtn(`Tra ${(q.opzioni || []).join(', ')}, qual è l’intruso e perché?`, `**${(q.opzioni || [])[+q.intruso] || ''}**\n\n${q.criterio ? `Criterio: ${q.criterio}. ` : ''}${q.spiegazione || ''}`));
        $('[data-dq="next"]', fb).onclick = () => { pos++; draw(); };
        $('[data-dq="next"]', fb).focus();
      };
      $$('[data-oi]', stage).forEach(b => b.addEventListener('click', () => resolve(+b.dataset.oi)));
      $('[data-dq="idk"]', stage).onclick = () => resolve(null);
    };
    draw();
  };

  paintShell();
}

function modeDiscQuiz(sec, body) {
  if (!String(sec.md || '').trim()) {
    body.innerHTML = `<div class="empty"><p>Questa sezione non ha ancora appunti da cui creare un quiz.</p><a class="btn primary" href="#/sec/${sec.id}/edit">Scrivi in Modifica</a></div>`;
    return;
  }
  renderDiscQuizHost(body, {
    title: sec.title,
    md: sec.md,
    nbId: sec.notebookId,
    secId: sec.id,
    getSaved: k => (sec.dquiz && sec.dquiz[k]) || null,
    setSaved: async (k, val) => { sec.dquiz = { ...(sec.dquiz || {}), [k]: val }; await saveSection(sec); },
    getConfusions: () => Array.isArray(sec.confusions) ? sec.confusions : [],
    setConfusions: async list => { sec.confusions = list; await saveSection(sec); },
    onFinishGrade: (slot, suggested) => gradeBar(sec, slot, { mode: 'dquiz', suggested })
  });
}

// v4.13: divide gli appunti di una sezione nei suoi paragrafi (titoli Markdown)
function splitMdParts(md) {
  const lines = String(md || '').split('\n');
  const parts = [];
  let cur = { title: 'Introduzione', level: 0, lines: [] };
  let fence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fence = !fence;
    const m = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (m) {
      if (cur.lines.join('\n').trim()) parts.push({ ...cur, md: cur.lines.join('\n').trim() });
      cur = { title: m[2].replace(/\*\*|__|==|`|\[\[|\]\]/g, '').trim() || 'Paragrafo', level: m[1].length, lines: [line] };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.lines.join('\n').trim()) parts.push({ ...cur, md: cur.lines.join('\n').trim() });
  if (!parts.length) return [{ idx: 0, title: 'Tutta la sezione', level: 0, md: String(md || '').trim() }];
  if (parts.length === 1 && parts[0].level === 0) parts[0].title = 'Tutta la sezione';
  return parts.map((p, idx) => ({ idx, title: p.title, level: p.level, md: p.md }));
}

function viewDiscQuiz(kind, id) {
  let nb = null, grp = null, secs = [], title = '', backHref = '#/notebooks', backLabel = 'Notebook';
  if (kind === 'grp') {
    for (const n of state.notebooks) {
      const g = groupsOf(n).find(x => x.id === id);
      if (g) { nb = n; grp = g; const tree = groupTreeIds(n, g); secs = secsOf(n.id).filter(s => tree.has(s.groupId)); title = g.name; backHref = `#/nb/${n.id}/${g.id}`; backLabel = g.name; break; }
    }
  } else if (kind === 'nb') {
    nb = nbById(id);
    if (nb) { secs = secsOf(nb.id); title = nb.name; backHref = `#/nb/${nb.id}`; backLabel = nb.name; }
  }
  if (!nb) return notFound('Questo argomento');
  const usable = secs.filter(s => aiText(s.md || '').trim().length > 40).map(s => ({
    sec: s,
    path: groupPathText(s),
    parts: splitMdParts(s.md)
  }));
  setView(`
    <a class="back" href="${backHref}">${esc(backLabel)}</a>
    <header class="page-head"><div><h1>Quiz di discriminazione</h1><p class="lede">${esc(title)} · scegli le sezioni e i paragrafi da mescolare</p></div></header>
    <div id="dqPickerHost"></div>
    <div id="dqBody"></div>`);
  const box = $('#dqBody');
  const pickHost = $('#dqPickerHost');
  if (!usable.length) { box.innerHTML = '<div class="empty"><p>Qui non ci sono ancora appunti da cui creare un quiz.</p></div>'; return; }

  // Stato selezione: Map<secId, Set<partIdx>>. Se sono poche sezioni (<= 4) le preseleziono tutte, altrimenti parte vuoto per scegliere subito quelle volute
  const sel = new Map();
  const autoAll = usable.length <= 4;
  usable.forEach(u => sel.set(u.sec.id, new Set(autoAll ? u.parts.map(p => p.idx) : [])));
  const expanded = new Set();
  let filterQ = '';

  const selSummary = () => {
    let nSec = 0, nPart = 0;
    usable.forEach(u => {
      const s = sel.get(u.sec.id);
      if (s && s.size) { nSec++; nPart += s.size; }
    });
    return { nSec, nPart };
  };
  const selSig = () => usable.map(u => {
    const s = sel.get(u.sec.id);
    return s && s.size ? `${u.sec.id}:${[...s].sort((a, b) => a - b).join(',')}` : '';
  }).filter(Boolean).join('|') || 'none';

  const buildMd = () => usable.map(u => {
    const s = sel.get(u.sec.id);
    if (!s || !s.size) return '';
    const bodyMd = u.parts.filter(p => s.has(p.idx)).map(p => p.md).join('\n\n');
    return `## ${u.sec.title}\n${bodyMd}`;
  }).filter(Boolean).join('\n\n');

  const buildTitle = () => {
    const names = usable.filter(u => (sel.get(u.sec.id)?.size || 0) > 0).map(u => u.sec.title);
    return names.length ? (names.length <= 3 ? names.join(' vs ') : `${title} (${names.length} sezioni)`) : title;
  };

  const presetHost = grp || nb;
  const getPresets = () => Array.isArray(presetHost.dqPresets) ? presetHost.dqPresets : [];
  pickHost.innerHTML = `
    <details class="dq-picker" id="dqPicker" open>
      <summary class="dq-picker-sum">
        <span class="dq-picker-t">Materiale per il quiz</span>
        <span class="dq-picker-cnt" id="dqPickCnt"></span>
      </summary>
      <div class="dq-picker-in">
        <div class="dq-presets" id="dqPresets"></div>
        <div class="dq-picker-bar">
          <input type="search" class="input" id="dqPickQ" placeholder="Cerca sezione o paragrafo…" aria-label="Cerca sezione o paragrafo">
          <button type="button" class="btn sm ghost" data-dqp="all">Tutto</button>
          <button type="button" class="btn sm ghost" data-dqp="none">Nessuno</button>
          <button type="button" class="btn sm" data-dqp="save" title="Salva questa selezione per rilanciarla con un tocco">＋ Salva preset</button>
        </div>
        <ul class="dq-sec-list" id="dqSecList"></ul>
      </div>
    </details>`;
  const renderPresets = () => {
    const list = getPresets();
    const el = $('#dqPresets', pickHost);
    if (!el) return;
    el.hidden = !list.length;
    el.innerHTML = list.map(pr => `<span class="dq-chip"><button type="button" class="dq-chip-t" data-dp-load="${esc(pr.id)}">${esc(pr.name)}</button><button type="button" class="dq-chip-x" data-dp-del="${esc(pr.id)}" aria-label="Elimina preset ${esc(pr.name)}">×</button></span>`).join('');
  };

  const renderPicker = () => {
    const { nSec, nPart } = selSummary();
    $('#dqPickCnt', pickHost).textContent = nSec
      ? `${nSec} ${nSec === 1 ? 'sezione' : 'sezioni'} · ${nPart} ${nPart === 1 ? 'paragrafo' : 'paragrafi'}`
      : 'Nessun paragrafo selezionato';
    const q = foldAccents(filterQ.trim());
    const ul = $('#dqSecList', pickHost);
    const rows = usable.filter(u => {
      if (!q) return true;
      if (foldAccents(`${u.sec.title} ${u.path}`).includes(q)) return true;
      return u.parts.some(p => foldAccents(p.title).includes(q));
    });
    if (!rows.length) { ul.innerHTML = '<li class="hint" style="padding:10px">Nessuna sezione o paragrafo trovato.</li>'; return; }
    ul.innerHTML = rows.map(u => {
      const s = sel.get(u.sec.id);
      const count = s ? s.size : 0;
      const total = u.parts.length;
      const allOn = count === total && total > 0;
      const isOpen = expanded.has(u.sec.id) || (!!q && u.parts.some(p => foldAccents(p.title).includes(q)));
      const partsHtml = isOpen && total > 1 ? `<ul class="dq-part-list">${u.parts.map(p => {
        const checked = s && s.has(p.idx);
        const pad = Math.max(0, Math.min(3, (p.level || 1) - 1)) * 12;
        return `<li><label class="dq-part-row" style="padding-left:${pad}px"><input type="checkbox" data-dp-sec="${u.sec.id}" data-dp-idx="${p.idx}" ${checked ? 'checked' : ''}><span>${esc(p.title)}</span></label></li>`;
      }).join('')}</ul>` : '';
      return `<li class="dq-sec-item">
        <div class="dq-sec-row">
          <input type="checkbox" class="dq-sec-chk" data-ds-chk="${u.sec.id}" ${allOn ? 'checked' : ''} aria-label="Seleziona ${esc(u.sec.title)}">
          <button type="button" class="dq-sec-exp" data-ds-exp="${u.sec.id}" ${total <= 1 ? 'disabled' : ''}>
            <span class="dq-sec-arr">${total > 1 ? (isOpen ? '▾' : '▸') : '·'}</span>
            <span class="dq-sec-main"><span class="dq-sec-t">${esc(u.sec.title)}</span>${u.path ? `<span class="dq-sec-p">${esc(u.path)}</span>` : ''}</span>
            <span class="dq-sec-badge${count > 0 ? ' on' : ''}">${count > 0 && count < total ? `${count}/${total}` : `${total} ${total === 1 ? 'parte' : 'parti'}`}</span>
          </button>
        </div>
        ${partsHtml}
      </li>`;
    }).join('');
    rows.forEach(u => {
      const s = sel.get(u.sec.id);
      const count = s ? s.size : 0;
      const chk = $(`[data-ds-chk="${u.sec.id}"]`, ul);
      if (chk) chk.indeterminate = count > 0 && count < u.parts.length;
    });
  };

  pickHost.addEventListener('input', e => {
    if (e.target.id === 'dqPickQ') { filterQ = e.target.value; renderPicker(); }
  });
  pickHost.addEventListener('click', async e => {
    const ld = e.target.closest('[data-dp-load]');
    if (ld) {
      const pr = getPresets().find(x => x.id === ld.dataset.dpLoad);
      if (pr && pr.sel) {
        usable.forEach(u => {
          const arr = Array.isArray(pr.sel[u.sec.id]) ? pr.sel[u.sec.id] : [];
          sel.set(u.sec.id, new Set(arr.filter(i => u.parts.some(p => p.idx === i))));
        });
        renderPicker();
        toast(`Preset “${pr.name}” caricato`);
      }
      return;
    }
    const dl = e.target.closest('[data-dp-del]');
    if (dl) {
      presetHost.dqPresets = getPresets().filter(x => x.id !== dl.dataset.dpDel);
      await saveNotebook(nb);
      renderPresets();
      return;
    }
    const b = e.target.closest('[data-dqp]');
    if (b) {
      if (b.dataset.dqp === 'save') {
        const { nSec } = selSummary();
        if (!nSec) { toast('Seleziona almeno una sezione o un paragrafo prima di salvare', 'err'); return; }
        const name = await modal({ title: 'Salva preset', text: 'Un nome breve per richiamare questa selezione con un tocco.', input: true, placeholder: 'Es. Strati corteccia vs cervelletto', confirm: 'Salva' });
        if (!name) return;
        const snap = {};
        usable.forEach(u => { const s = sel.get(u.sec.id); if (s && s.size) snap[u.sec.id] = [...s]; });
        presetHost.dqPresets = [{ id: uid(), name: String(name).trim(), sel: snap }, ...getPresets()].slice(0, 20);
        await saveNotebook(nb);
        renderPresets();
        toast('Preset salvato');
        return;
      }
      const on = b.dataset.dqp === 'all';
      usable.forEach(u => sel.set(u.sec.id, new Set(on ? u.parts.map(p => p.idx) : [])));
      renderPicker();
      return;
    }
    const exp = e.target.closest('[data-ds-exp]');
    if (exp && !exp.disabled) {
      const sid = exp.dataset.dsExp;
      if (expanded.has(sid)) expanded.delete(sid); else expanded.add(sid);
      renderPicker();
    }
  });
  pickHost.addEventListener('change', e => {
    const sc = e.target.closest('[data-ds-chk]');
    if (sc) {
      const u = usable.find(x => x.sec.id === sc.dataset.dsChk);
      if (u) sel.set(u.sec.id, new Set(sc.checked ? u.parts.map(p => p.idx) : []));
      renderPicker();
      return;
    }
    const pc = e.target.closest('[data-dp-sec]');
    if (pc) {
      const s = sel.get(pc.dataset.dpSec);
      const idx = +pc.dataset.dpIdx;
      if (s) { if (pc.checked) s.add(idx); else s.delete(idx); }
      renderPicker();
    }
  });

  renderPresets();
  renderPicker();
  renderDiscQuizHost(box, {
    title,
    getMd: buildMd,
    getTitle: buildTitle,
    nbId: nb.id,
    secId: null,
    getSaved: k => { const ck = `${kind}:${id}:${selSig()}`; return (dquizCache[ck] && dquizCache[ck][k]) || null; },
    setSaved: async (k, val) => { const ck = `${kind}:${id}:${selSig()}`; dquizCache[ck] = { ...(dquizCache[ck] || {}), [k]: val }; },
    getConfusions: () => Array.isArray((grp || nb).confusions) ? (grp || nb).confusions : [],
    setConfusions: async list => { (grp || nb).confusions = list; await saveNotebook(nb); }
  });
}


/* =====================================================================
   v4.26: Prima sessione di studio completa (Active Recall immediato)
   - Oscura dettagli istantaneo (Dettagli + Solo Cloze; funziona anche con ==cloze== già presenti)
   - Prima passata a micro-blocchi (Metodo 3R + Coda Criterio = 1)
   - Suddivisione blocchi personalizzabile (✂️ Dividi qui, 🔗 Unisci, preset salvati sulla sezione)
   - == Cloze al volo affidabile su tablet (memoria selezione + toggle Solo Cloze)
   - Interrogazione elaborativa (fissa + AI sul blocco + verifica AI)
   - Pre-test rapido di 60s + Radar di lettura + Banner sezioni nuove
   ===================================================================== */

const FP_ELAB_PROMPTS = [
  'Qual è il meccanismo o il “perché” di ciò che hai appena letto?',
  'Cosa succede se questa struttura, via o meccanismo è alterato o leso?',
  'In cosa si distingue dal blocco precedente o da concetti simili?',
  'Qual è il dato chiave o il collegamento clinico che il docente potrebbe chiedere?',
  'Come lo riassumeresti in 2 frasi chiare se dovessi dirlo ora all’orale?'
];

/* ---------- 1. Oscura dettagli istantaneo (Dettagli / Solo Cloze) ---------- */
function setupPeekDetails(article, { barEl = null, btnEl = null } = {}) {
  let on = false;
  let peekMode = 'details'; // 'details' | 'cloze'

  const wrapNodes = (parent, nodes) => {
    if (!nodes.length) return false;
    const text = nodes.map(n => n.textContent || '').join('').trim();
    if (text.length < 2) return false;
    const sp = document.createElement('span');
    sp.className = 'pk-mask';
    sp.setAttribute('role', 'button');
    sp.setAttribute('tabindex', '0');
    sp.setAttribute('aria-expanded', 'false');
    sp.title = 'Tocca per scoprire o coprire';
    parent.insertBefore(sp, nodes[0]);
    nodes.forEach(n => sp.appendChild(n));
    return true;
  };

  const maskElementCueTail = (el, stopTags = new Set(), hasSubList = false) => {
    const kids = [];
    for (const c of [...el.childNodes]) {
      if (c.nodeType === 1 && stopTags.has(c.tagName)) break;
      kids.push(c);
    }
    const meaningful = kids.filter(n => n.nodeType === 1 || (n.nodeType === 3 && n.nodeValue.trim()));
    if (!meaningful.length) return false;
    // Salta solo maschere già applicate o elementi multimediali (NON saltare mark.cz!)
    if (meaningful.some(n => n.nodeType === 1 && (n.matches('.pk-mask, .img-box, .html-embed') || n.querySelector?.('.pk-mask, .img-box, .html-embed')))) return false;

    const first = meaningful[0];
    const firstIdx = kids.indexOf(first);
    const fullText = kids.map(n => n.textContent || '').join('').replace(/\s+/g, ' ').trim();

    // Caso 1: inizia con **Termine** seguito da spiegazione
    if (first.nodeType === 1 && (first.tagName === 'STRONG' || first.tagName === 'B')) {
      const rest = kids.slice(firstIdx + 1);
      if (rest.length && rest[0].nodeType === 3) {
        const m = rest[0].nodeValue.match(/^(\s*[:–—-]\s*)([\s\S]*)$/);
        if (m && m[2].trim()) {
          const tail = rest[0].splitText(m[1].length);
          return wrapNodes(el, [tail, ...rest.slice(1)]);
        }
      }
      if (rest.map(n => n.textContent || '').join('').trim().length >= 2) {
        return wrapNodes(el, rest);
      }
      // Se è un titolo/etichetta in grassetto con sottolista (es. "**Psalterium:**"), resta visibile come guida!
      if (hasSubList) return false;
      if (el.tagName === 'LI') return wrapNodes(el, kids);
      return false;
    }

    // Caso 2: inizia con "Etichetta: spiegazione" oppure "Etichetta — spiegazione"
    if (first.nodeType === 3) {
      const m = first.nodeValue.match(/^(\s*[^:\n–—]{2,60}?(?::|\s+[–—]\s+)\s*)([\s\S]*)$/);
      if (m) {
        const tailNodes = [];
        if (m[2].length) {
          const tail = first.splitText(m[1].length);
          tailNodes.push(tail);
        }
        tailNodes.push(...kids.slice(firstIdx + 1));
        if (tailNodes.map(n => n.textContent || '').join('').trim().length >= 2) {
          return wrapNodes(el, tailNodes);
        }
      }
    }

    // Se ha una sottolista ed è un'etichetta breve che finisce con ":" (es. "situata:"), resta visibile come guida
    if (hasSubList && /:\s*$/.test(fullText) && fullText.length <= 80) return false;

    // Caso 3: per le voci di elenco (fogliari o frasi descrittive prima di un sottopunto) oscura l'intero testo della voce
    if (el.tagName === 'LI' || el.closest('li')) {
      return wrapNodes(el, kids);
    }

    // Caso 4: paragrafo normale -> oscura parole chiave (cloze, grassetti, evidenziature) oppure l'intero paragrafo
    const keyMarks = kids.filter(n => n.nodeType === 1 && (n.tagName === 'STRONG' || n.tagName === 'B' || n.tagName === 'MARK'));
    if (keyMarks.length) {
      let any = false;
      keyMarks.forEach(h => { if (wrapNodes(h, [...h.childNodes])) any = true; });
      return any;
    }
    if (fullText.length >= 12) return wrapNodes(el, kids);
    return false;
  };

  const applyClozeOnlyIn = scope => {
    let count = 0;
    $$('mark.cz', scope).forEach(m => {
      if (m.closest('.html-embed, .img-box, .pk-mask') || m.querySelector('.pk-mask')) return;
      if (wrapNodes(m, [...m.childNodes])) count++;
    });
    return count;
  };

  const applyMasksIn = (scope, mode = peekMode) => {
    if (mode === 'cloze') return applyClozeOnlyIn(scope);
    let count = 0;
    const stopList = new Set(['UL', 'OL', 'TABLE', 'PRE', 'BLOCKQUOTE']);
    $$('li', scope).forEach(li => {
      if (li.closest('.html-embed, .img-box, pre')) return;
      const hasSub = !!li.querySelector(':scope > ul, :scope > ol');
      const pChild = li.querySelector(':scope > p');
      if (pChild) {
        if (maskElementCueTail(pChild, stopList, hasSub)) count++;
      } else if (maskElementCueTail(li, stopList, hasSub)) count++;
    });
    $$('table', scope).forEach(tbl => {
      if (tbl.closest('.html-embed')) return;
      $$('tbody tr, :scope > tr', tbl).forEach(tr => {
        const cells = [...tr.children].filter(c => c.tagName === 'TD');
        cells.slice(1).forEach(td => {
          if (td.querySelector('.pk-mask, .img-box')) return;
          if (wrapNodes(td, [...td.childNodes])) count++;
        });
      });
    });
    $$('p', scope).forEach(p => {
      if (p.closest('li, td, th, .html-embed, .img-box, .callout, blockquote')) return;
      if (maskElementCueTail(p)) count++;
    });
    return count;
  };

  const clearMasksIn = scope => {
    $$('.pk-mask', scope).forEach(sp => {
      const p = sp.parentNode;
      if (!p) return;
      while (sp.firstChild) p.insertBefore(sp.firstChild, sp);
      sp.remove();
      p.normalize();
    });
  };

  const syncFoldBtns = () => {
    $$('.fold-pk-btn', article).forEach(b => {
      const fold = b.closest('.fold');
      const active = !!(fold && fold.classList.contains('pk-fold-on'));
      b.setAttribute('aria-pressed', String(active));
      b.classList.toggle('on', active);
      b.textContent = active ? '👁' : '🙈';
      b.title = active ? 'Mostra i dettagli di questo paragrafo' : 'Oscura i dettagli solo in questo paragrafo';
    });
  };

  const updateBar = () => {
    if (!barEl) return;
    const all = $$('.pk-mask', article);
    if (!on && !all.length) { barEl.hidden = true; barEl.innerHTML = ''; return; }
    const open = all.filter(x => x.classList.contains('open')).length;
    const hasCloze = $$('mark.cz', article).length > 0;
    barEl.hidden = false;
    barEl.innerHTML = `
      <span class="pk-stat">🙈 <strong>${peekMode === 'cloze' ? 'Solo Cloze' : 'Oscura dettagli'}</strong> · ${open} / ${all.length} scoperti</span>
      <span class="pk-acts">
        ${hasCloze ? `<button type="button" class="btn sm ghost ${peekMode === 'details' ? 'on' : ''}" data-pk="mode-details" title="Oscura tutte le spiegazioni e sottopunti">Dettagli</button><button type="button" class="btn sm ghost ${peekMode === 'cloze' ? 'on' : ''}" data-pk="mode-cloze" title="Oscura solo i termini ==cloze==">Solo Cloze</button>` : ''}
        <button type="button" class="btn sm ghost" data-pk="all-open">Scopri tutti</button>
        <button type="button" class="btn sm ghost" data-pk="all-hide">Copri tutti</button>
        <button type="button" class="btn sm ghost" data-pk="off">Esci</button>
      </span>`;
  };

  const setOn = (next, mode = peekMode) => {
    const modeChanged = mode !== peekMode;
    peekMode = mode;
    if (next === on && !modeChanged && !(!next && $$('.pk-mask', article).length)) return;
    if (next) {
      clearMasksIn(article);
      $$('.fold.pk-fold-on', article).forEach(f => f.classList.remove('pk-fold-on'));
      const n = applyMasksIn(article, peekMode);
      if (!n) {
        on = false;
        article.classList.remove('pk-on');
        toast(peekMode === 'cloze' ? 'Non ci sono termini ==cloze== in questo blocco' : 'Non ci sono dettagli da oscurare in questo blocco');
        if (btnEl) { btnEl.setAttribute('aria-pressed', 'false'); btnEl.classList.remove('on'); btnEl.textContent = '🙈 Oscura'; }
        updateBar();
        return;
      }
      on = true;
      article.classList.add('pk-on');
      $$('.fold:not(.fold-empty)', article).forEach(f => {
        if (f.querySelector('.pk-mask')) f.classList.add('pk-fold-on');
      });
    } else {
      clearMasksIn(article);
      $$('.fold.pk-fold-on', article).forEach(f => f.classList.remove('pk-fold-on'));
      on = false;
      article.classList.remove('pk-on');
    }
    if (btnEl) {
      btnEl.setAttribute('aria-pressed', String(on));
      btnEl.classList.toggle('on', on);
      btnEl.textContent = on ? '👁 Mostra tutto' : (btnEl.dataset.labelOff || '🙈 Oscura dettagli');
    }
    syncFoldBtns();
    updateBar();
  };

  const toggleFoldPeek = fold => {
    const body = fold.querySelector(':scope > .fold-body');
    if (!body) return;
    if (fold.classList.contains('pk-fold-on')) {
      clearMasksIn(body);
      fold.classList.remove('pk-fold-on');
      if (!$$('.pk-mask', article).length) {
        on = false;
        article.classList.remove('pk-on');
        if (btnEl) { btnEl.setAttribute('aria-pressed', 'false'); btnEl.classList.remove('on'); btnEl.textContent = btnEl.dataset.labelOff || '🙈 Oscura dettagli'; }
      }
    } else {
      if (fold.classList.contains('closed')) setFold(fold, false);
      const n = applyMasksIn(body, peekMode);
      if (!n) { toast('Nessun dettaglio da oscurare in questo paragrafo'); return; }
      fold.classList.add('pk-fold-on');
      article.classList.add('pk-on');
    }
    syncFoldBtns();
    updateBar();
  };

  const attachFoldButtons = () => {
    $$('.fold:not(.fold-empty) > .fold-h', article).forEach(h => {
      if (h.querySelector('.fold-pk-btn')) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fold-pk-btn';
      b.textContent = '🙈';
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', 'Oscura i dettagli solo in questo paragrafo');
      b.title = 'Oscura i dettagli solo in questo paragrafo';
      b.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const fold = h.parentElement;
        if (fold) toggleFoldPeek(fold);
      });
      h.appendChild(b);
    });
  };
  attachFoldButtons();

  const onClick = e => {
    const m = e.target.closest('.pk-mask');
    if (!m || !article.contains(m)) return;
    e.preventDefault();
    e.stopPropagation();
    const isOpen = m.classList.toggle('open');
    m.setAttribute('aria-expanded', String(isOpen));
    updateBar();
  };
  const onKey = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const m = e.target.closest('.pk-mask');
    if (!m || !article.contains(m)) return;
    e.preventDefault();
    const isOpen = m.classList.toggle('open');
    m.setAttribute('aria-expanded', String(isOpen));
    updateBar();
  };
  article.addEventListener('click', onClick);
  article.addEventListener('keydown', onKey);

  if (barEl) {
    barEl.addEventListener('click', e => {
      const a = e.target.closest('[data-pk]')?.dataset.pk;
      if (!a) return;
      if (a === 'off') { setOn(false); return; }
      if (a === 'mode-details') { setOn(true, 'details'); return; }
      if (a === 'mode-cloze') { setOn(true, 'cloze'); return; }
      const open = a === 'all-open';
      $$('.pk-mask', article).forEach(m => { m.classList.toggle('open', open); m.setAttribute('aria-expanded', String(open)); });
      updateBar();
    });
  }

  return {
    isOn: () => on || $$('.pk-mask', article).length > 0,
    mode: () => peekMode,
    setOn,
    toggle: () => setOn(!on, peekMode),
    toggleCloze: () => {
      if (on && peekMode === 'cloze') setOn(false);
      else setOn(true, 'cloze');
    },
    destroy() {
      if (on || $$('.pk-mask', article).length) setOn(false);
      $$('.fold-pk-btn', article).forEach(b => b.remove());
      article.removeEventListener('click', onClick);
      article.removeEventListener('keydown', onKey);
    }
  };
}

/* ---------- 2. Atomi e suddivisione personalizzabile per Prima passata ---------- */
function atomPreviewLabel(md) {
  const first = String(md || '').split('\n').find(l => l.trim()) || '';
  const cleaned = stripMarks(stripCloze(first))
    .replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s+/, '')
    .replace(/\*\*|__|`/g, '')
    .trim();
  // Se è una voce "Titolo: resto", prendi il titolo se breve
  const m = cleaned.match(/^([^:]{3,75}):(?:\s*$|\s+)/);
  const out = m ? m[1].trim() : cleaned;
  return out.length > 72 ? out.slice(0, 69).trimEnd() + '…' : out;
}

function buildFirstPassAtoms(sec) {
  const src = String(sec.md || '');
  if (!src.trim()) return [];
  const lineObjs = [];
  const re = /[^\n]*\n?/g;
  let m;
  while ((m = re.exec(src))) {
    if (!m[0]) break;
    const raw = m[0];
    const text = raw.replace(/\r?\n$/, '');
    lineObjs.push({ text, start: m.index, end: m.index + text.length });
    if (m.index + raw.length >= src.length) break;
  }

  const atoms = [];
  const stack = [];
  let secIdx = 0;
  let curHeading = sec.title || 'Appunti';
  let curPath = [];
  let inFence = false;
  let inTable = false;
  let cur = [];

  const flush = () => {
    while (cur.length && !cur[0].text.trim()) cur.shift();
    while (cur.length && !cur[cur.length - 1].text.trim()) cur.pop();
    if (!cur.length) return;
    const start = cur[0].start;
    const end = cur[cur.length - 1].end;
    const md = src.slice(start, end);
    const firstLine = cur[0].text;
    const isListItem = /^([-*+]|\d+[.)])\s+/.test(firstLine);
    const hasSub = isListItem && cur.slice(1).some(x => /^\s+([-*+]|\d+[.)])\s+/.test(x.text));
    const isBoldLead = /^([-*+]|\d+[.)])\s+\*\*[^*\n]+\*\*/.test(firstLine);
    atoms.push({
      secIdx,
      heading: curHeading,
      path: [...curPath],
      start,
      end,
      md,
      isListItem,
      hasSub,
      isBoldLead,
      label: atomPreviewLabel(md)
    });
    cur = [];
  };

  for (const lo of lineObjs) {
    const line = lo.text;
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      cur.push(lo);
      if (!inFence) flush();
      continue;
    }
    if (inFence) { cur.push(lo); continue; }
    const hm = line.match(/^(#{1,4})\s+(.+?)\s*#*$/);
    if (hm) {
      inTable = false;
      flush();
      secIdx++;
      const lvl = hm[1].length;
      const title = stripMarks(stripCloze(hm[2])).replace(/\*\*|__|`/g, '').trim();
      while (stack.length && stack[stack.length - 1].lvl >= lvl) stack.pop();
      curPath = stack.map(x => x.title);
      curHeading = title || sec.title || 'Blocco';
      stack.push({ lvl, title: curHeading });
      continue;
    }
    if (/^\s*\|/.test(line)) {
      if (!inTable && cur.length) flush();
      inTable = true;
      cur.push(lo);
      continue;
    } else if (inTable) {
      inTable = false;
      flush();
    }
    if (!line.trim()) { flush(); continue; }
    if (/^([-*+]|\d+[.)])\s+/.test(line)) {
      if (cur.length) flush();
      cur.push(lo);
    } else if (cur.length && /^([-*+]|\d+[.)])\s+/.test(cur[0].text) && /^\s+/.test(line)) {
      cur.push(lo);
    } else {
      cur.push(lo);
    }
  }
  flush();
  return atoms;
}

function computePresetCuts(atoms, preset = 'auto') {
  const cuts = [];
  if (atoms.length <= 1) return cuts;
  if (preset === 'headings') {
    for (let i = 1; i < atoms.length; i++) {
      if (atoms[i].secIdx !== atoms[i - 1].secIdx) cuts.push(i);
    }
    return cuts;
  }
  if (preset === 'items') {
    for (let i = 1; i < atoms.length; i++) {
      const prev = atoms[i - 1], cur = atoms[i];
      if (cur.secIdx !== prev.secIdx || cur.isListItem || prev.isListItem || cur.md.length > 260 || prev.md.length > 260) {
        cuts.push(i);
      }
    }
    return cuts;
  }
  // 'auto': per titoli, spezzando blocchi lunghi in 3-4 punti / ~680 caratteri
  let gStart = 0;
  let gLen = atoms[0].md.length;
  for (let i = 1; i < atoms.length; i++) {
    const sameSec = atoms[i].secIdx === atoms[i - 1].secIdx;
    const gCount = i - gStart;
    if (!sameSec || gCount >= 4 || gLen + atoms[i].md.length > 680) {
      cuts.push(i);
      gStart = i;
      gLen = atoms[i].md.length;
    } else {
      gLen += atoms[i].md.length;
    }
  }
  return cuts;
}

function normalizeCuts(cuts, atomCount) {
  return [...new Set((cuts || []).map(Number).filter(n => Number.isInteger(n) && n > 0 && n < atomCount))].sort((a, b) => a - b);
}

function buildFirstPassModel(sec) {
  const atoms = buildFirstPassAtoms(sec);
  if (!atoms.length) return { atoms: [], cuts: [], preset: 'auto', chunks: [] };
  const saved = sec.fpCustom && sec.fpCustom.atomCount === atoms.length ? sec.fpCustom : null;
  const preset = saved ? (saved.preset || 'custom') : 'auto';
  const cuts = saved ? normalizeCuts(saved.cuts, atoms.length) : computePresetCuts(atoms, 'auto');

  const bounds = [0, ...cuts, atoms.length];
  const rawChunks = [];
  for (let b = 0; b < bounds.length - 1; b++) {
    const a0 = bounds[b], a1 = bounds[b + 1] - 1;
    const slice = atoms.slice(a0, a1 + 1);
    const sameSec = slice.every(x => x.secIdx === slice[0].secIdx);
    const start = slice[0].start;
    const end = slice[slice.length - 1].end;
    const md = String(sec.md || '').slice(start, end);
    rawChunks.push({ a0, a1, slice, sameSec, start, end, md });
  }

  // Conta quanti blocchi condividono lo stesso titolo di sezione (per numerarli (1/3), (2/3)…)
  const headingTotals = new Map();
  rawChunks.forEach(rc => {
    if (rc.sameSec && !(rc.slice.length === 1 && (rc.slice[0].hasSub || rc.slice[0].isBoldLead))) {
      const k = rc.slice[0].secIdx;
      headingTotals.set(k, (headingTotals.get(k) || 0) + 1);
    }
  });
  const headingSeen = new Map();

  const countHint = text => {
    const bullets = (text.match(/^([-*+]|\d+[.)])\s+/gm) || []).length;
    const hasTbl = /^\s*\|.+\|/m.test(text);
    if (hasTbl && bullets) return `${bullets} punti + tabella`;
    if (hasTbl) return 'tabella da richiamare';
    if (bullets >= 2) return `${bullets} punti chiave`;
    const subBullets = (text.match(/^\s+([-*+]|\d+[.)])\s+/gm) || []).length;
    if (subBullets >= 2) return `${subBullets} sottopunti`;
    const paras = text.split(/\n{2,}/).filter(Boolean).length;
    return paras > 1 ? `${paras} concetti` : 'concetto chiave';
  };

  const chunks = rawChunks.map((rc, id) => {
    const first = rc.slice[0];
    let title = first.heading;
    let path = [...first.path];
    if (rc.slice.length === 1 && (first.hasSub || first.isBoldLead) && first.label && first.label !== first.heading) {
      // Singola voce strutturata (es. "Psalterium..." o "Corpo del Fornice") -> usa il suo nome come titolo!
      title = first.label;
      if (first.heading && first.heading !== sec.title) path = [...first.path, first.heading];
    } else if (rc.sameSec) {
      const tot = headingTotals.get(first.secIdx) || 1;
      if (tot > 1) {
        const curN = (headingSeen.get(first.secIdx) || 0) + 1;
        headingSeen.set(first.secIdx, curN);
        title = `${first.heading} (${curN}/${tot})`;
      }
    } else {
      const heads = [...new Set(rc.slice.map(x => x.heading))];
      title = heads.slice(0, 2).join(' + ') + (heads.length > 2 ? ` (+${heads.length - 2})` : '');
    }
    return {
      id, a0: rc.a0, a1: rc.a1, atoms: rc.slice,
      title, path, start: rc.start, end: rc.end, md: rc.md,
      hint: countHint(rc.md)
    };
  });

  return { atoms, cuts, preset, chunks };
}

/* ---------- 3. Radar di lettura e Pre-test rapido (60s) ---------- */
function radarKey(secId) { return `nb-radar:${secId}`; }
function loadRadar(secId) {
  try {
    const d = JSON.parse(sessionStorage.getItem(radarKey(secId)) || 'null');
    return d && Array.isArray(d.items) && d.items.length ? d : null;
  } catch { return null; }
}
function saveRadar(secId, data) {
  try {
    if (!data || !data.items?.length) sessionStorage.removeItem(radarKey(secId));
    else sessionStorage.setItem(radarKey(secId), JSON.stringify(data));
  } catch { /* niente */ }
}

function derivePretestQuestions(sec) {
  const qs = [];
  const seen = new Set();
  const pushQ = q => {
    const clean = String(q || '').replace(/\s+/g, ' ').trim();
    const k = clean.toLowerCase();
    if (!clean || seen.has(k)) return;
    seen.add(k);
    qs.push(clean);
  };
  (sec.questions || []).slice(0, 5).forEach(q => { if (q && q.q) pushQ(q.q); });
  if (qs.length >= 3) return qs.slice(0, 5);

  const md = String(sec.md || '');
  const headings = [...md.matchAll(/^#{1,4}\s+(.+?)\s*#*$/gm)]
    .map(m => stripMarks(stripCloze(m[1])).replace(/\*\*|__|`/g, '').trim())
    .filter(h => h.length >= 3 && h.length <= 90 && !/^altro$/i.test(h));
  headings.slice(0, 5 - qs.length).forEach(h => pushQ(`Cosa sai dire su: ${h}?`));
  if (qs.length >= 3) return qs.slice(0, 5);

  const bolds = [...md.matchAll(/\*\*([^*\n]{3,55})\*\*/g)]
    .map(m => stripMarks(stripCloze(m[1])).replace(/:$/, '').trim())
    .filter(t => t.length >= 3);
  bolds.slice(0, 5 - qs.length).forEach(t => pushQ(`Che ruolo o significato ha: ${t}?`));

  if (!qs.length) pushQ(`Quali sono i 3 punti fondamentali di “${sec.title}”?`);
  return qs.slice(0, 5);
}

function renderRadarBox(boxEl, sec, { compact = false, onChange = () => {} } = {}) {
  if (!boxEl) return;
  const r = loadRadar(sec.id);
  if (!r) { boxEl.hidden = true; boxEl.innerHTML = ''; return; }
  const done = r.items.filter(x => x.done).length;
  boxEl.hidden = false;
  boxEl.innerHTML = `
    <details class="fp-radar-det" ${r.open !== false && !compact ? 'open' : ''}>
      <summary class="fp-radar-sum">
        <span>⚡ <strong>Radar di lettura</strong> · ${done}/${r.items.length} risposte trovate</span>
        <button type="button" class="btn sm ghost fp-radar-x" data-rd="clear" title="Chiudi radar" aria-label="Chiudi radar">✕</button>
      </summary>
      <ul class="fp-radar-list">
        ${r.items.map((it, i) => `
          <li class="${it.done ? 'done' : ''}">
            <label>
              <input type="checkbox" data-rd-i="${i}" ${it.done ? 'checked' : ''}>
              <span>${esc(it.q)}${it.guess ? `<small class="fp-radar-g">Ipotesi: ${esc(it.guess)}</small>` : ''}</span>
            </label>
          </li>`).join('')}
      </ul>
    </details>`;
  const det = $('.fp-radar-det', boxEl);
  if (det) det.addEventListener('toggle', () => { r.open = det.open; saveRadar(sec.id, r); });
  boxEl.onclick = e => {
    if (e.target.closest('[data-rd="clear"]')) {
      e.preventDefault();
      e.stopPropagation();
      saveRadar(sec.id, null);
      renderRadarBox(boxEl, sec, { compact, onChange });
      onChange();
    }
  };
  boxEl.onchange = e => {
    const cb = e.target.closest('[data-rd-i]');
    if (!cb) return;
    const i = +cb.dataset.rdI;
    if (r.items[i]) {
      r.items[i].done = cb.checked;
      saveRadar(sec.id, r);
      renderRadarBox(boxEl, sec, { compact, onChange });
      onChange();
    }
  };
}

function openPreTest(sec, { onRadarSaved = () => {}, onStartFirstPass = null } = {}) {
  const existing = loadRadar(sec.id);
  let items = existing
    ? existing.items.map(x => ({ ...x }))
    : derivePretestQuestions(sec).map(q => ({ q, guess: '', done: false }));
  let left = 60;
  let timer = 0;

  const sh = openSheet(`
    <div class="fp-sh-head">
      <h2>⚡ Pre-test rapido (60s)</h2>
      ${typeof helpBtn === 'function' ? helpBtn('preTest') : ''}
      <span class="fp-timer" id="ptTimer">01:00</span>
    </div>
    <p class="sheet-sub">Prova a rispondere a mente o in 2 parole <strong>prima</strong> di leggere: sbagliare va benissimo, serve ad attivare la memoria. Poi le domande restano come radar in cima a Leggi.</p>
    ${AI.ready() ? `<div class="fp-pt-ai"><button type="button" class="btn sm ghost" data-pt="ai">✨ Genera 4 pre-domande con ${AI.name()}</button></div>` : ''}
    <ol class="fp-pt-list" id="ptList"></ol>
    <div class="modal-actions fp-pt-acts">
      <button type="button" class="btn ghost" data-pt="cancel">Chiudi</button>
      <button type="button" class="btn" data-pt="radar">Fissa radar in Leggi</button>
      ${onStartFirstPass ? '<button type="button" class="btn primary" data-pt="fp">Avvia Prima passata</button>' : ''}
    </div>`, { label: 'Pre-test rapido', onClose: () => { clearInterval(timer); } });

  const drawList = () => {
    $('#ptList', sh.el).innerHTML = items.map((it, i) => `
      <li class="fp-pt-item">
        <div class="fp-pt-q">${esc(it.q)}</div>
        <input class="input fp-pt-in" data-pt-g="${i}" value="${esc(it.guess || '')}" placeholder="Ipotesi al volo (facoltativa)…" autocomplete="off">
      </li>`).join('');
  };
  drawList();

  const timerEl = $('#ptTimer', sh.el);
  timer = setInterval(() => {
    if (!sh.el.isConnected) { clearInterval(timer); return; }
    left = Math.max(0, left - 1);
    const m = Math.floor(left / 60), s = left % 60;
    timerEl.textContent = left ? `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : 'Pronta!';
    if (!left) { timerEl.classList.add('done'); clearInterval(timer); }
  }, 1000);

  const collectGuesses = () => {
    $$('[data-pt-g]', sh.el).forEach(inp => {
      const i = +inp.dataset.ptG;
      if (items[i]) items[i].guess = inp.value.trim();
    });
  };

  sh.el.addEventListener('click', async e => {
    const act = e.target.closest('[data-pt]')?.dataset.pt;
    if (!act) return;
    if (act === 'cancel') { sh.close(null); return; }
    if (act === 'ai') {
      const btn = e.target.closest('[data-pt="ai"]');
      btn.disabled = true;
      btn.textContent = 'Preparo le domande…';
      try {
        const r = await AI.generate({
          system: 'Crea esattamente 4 brevi domande di pre-test (una per riga, senza risposte e senza numerazione) basate SOLO sul testo fornito. Devono stimolare curiosità sui concetti principali e sui meccanismi chiave della sezione.',
          text: aiText(sec.md).slice(0, 12000),
          maxTokens: 600
        });
        const qs = String(r.text || '').split('\n')
          .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
          .filter(l => l.length >= 8)
          .slice(0, 5);
        if (!qs.length) throw new Error('Nessuna domanda generata.');
        items = qs.map(q => ({ q, guess: '', done: false }));
        drawList();
        toast(`${qs.length} pre-domande pronte`);
      } catch (err) {
        toast(err.message || 'Non riesco a generare le domande', 'err');
      }
      if (btn.isConnected) { btn.disabled = false; btn.textContent = `✨ Genera 4 pre-domande con ${AI.name()}`; }
      return;
    }
    collectGuesses();
    saveRadar(sec.id, { items, open: true, created: Date.now() });
    onRadarSaved();
    sh.close(true);
    if (act === 'fp' && onStartFirstPass) onStartFirstPass();
    else toast('Radar fissato in cima a Leggi');
  });
}

/* ---------- 4. Prima passata (Metodo 3R + Coda Criterio = 1 + Dividi/Unisci + Cloze) ---------- */
function fpStateKey(secId) { return `nb-fp:${secId}`; }

function openFirstPass(sec, { onDone = () => {} } = {}) {
  let model = buildFirstPassModel(sec);
  if (!model.chunks.length) { toast('La sezione è vuota: scrivi o importa prima gli appunti'); return; }

  const makeSig = () => `${model.atoms.length}:${model.cuts.join(',')}`;
  let st = {
    sig: makeSig(), phase: 'pass', idx: 0, step: 'read',
    queue: [], fixedFirst: [], fixedQueue: [], misses: {},
    startedAt: Date.now()
  };
  try {
    const saved = JSON.parse(sessionStorage.getItem(fpStateKey(sec.id)) || 'null');
    if (saved && saved.sig === st.sig && saved.phase !== 'done') {
      st = { ...st, ...saved, misses: saved.misses || {} };
    }
  } catch { /* riparto da capo */ }

  let recallText = '';
  let elabQuestion = '';
  let elabAnswer = '';
  let elabFeedback = '';
  let elabBusy = false;
  let promptIdx = -1;
  let tocOpen = false;
  let splitMode = false;
  let peekApi = null;
  let mdChanged = false;
  let lastSel = null; // { text, occurrence, at } per Android/tablet

  const resetBlockDraft = () => {
    recallText = '';
    elabQuestion = '';
    elabAnswer = '';
    elabFeedback = '';
    elabBusy = false;
    promptIdx = -1;
    splitMode = false;
    lastSel = null;
  };

  const saveSt = () => {
    try {
      if (st.phase === 'done') sessionStorage.removeItem(fpStateKey(sec.id));
      else sessionStorage.setItem(fpStateKey(sec.id), JSON.stringify(st));
    } catch { /* niente */ }
  };

  const ov = document.createElement('div');
  ov.className = 'fp-overlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', `Prima passata: ${sec.title}`);
  document.body.appendChild(ov);

  const curChunkIdx = () => (st.phase === 'queue' ? st.queue[0] : st.idx);
  const curChunk = () => model.chunks[curChunkIdx()] || model.chunks[0];

  const captureChunkSelection = () => {
    const notesBox = $('#fpNotes', ov);
    if (!notesBox) return null;
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!notesBox.contains(range.commonAncestorContainer)) return null;
    const text = sel.toString().replace(/[\s\u00a0]+/g, ' ').trim();
    if (!text || text.length > 300) return null;
    const pre = document.createRange();
    pre.selectNodeContents(notesBox);
    pre.setEnd(range.startContainer, range.startOffset);
    const occurrence = countOccurrences(pre.toString().replace(/[\s\u00a0]+/g, ' '), text);
    return { text, occurrence, at: Date.now() };
  };

  const onSelChange = () => {
    const c = captureChunkSelection();
    if (c) lastSel = c;
    const hasNow = !!(c || (lastSel && Date.now() - lastSel.at < 4500));
    $$('[data-fp="cloze-sel"]', ov).forEach(b => b.classList.toggle('has-sel', !!c));
    if (!hasNow) lastSel = null;
  };
  document.addEventListener('selectionchange', onSelChange);

  const close = (refresh = false) => {
    if (peekApi) { peekApi.destroy(); peekApi = null; }
    document.removeEventListener('selectionchange', onSelChange);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('hashchange', onHash);
    ov.remove();
    onDone(refresh || mdChanged);
  };
  const onHash = () => close(false);
  window.addEventListener('hashchange', onHash);

  // Salva una nuova configurazione di tagli (cuts) sulla sezione e aggiorna la sessione
  const applyCustomCuts = async (newCuts, preset = 'custom', adjust = null) => {
    const norm = normalizeCuts(newCuts, model.atoms.length);
    if (preset === 'auto' && norm.join(',') === computePresetCuts(model.atoms, 'auto').join(',')) {
      delete sec.fpCustom;
    } else {
      sec.fpCustom = { atomCount: model.atoms.length, preset, cuts: norm };
    }
    model = buildFirstPassModel(sec);
    if (adjust) adjust();
    st.idx = Math.max(0, Math.min(model.chunks.length - 1, st.idx));
    st.sig = makeSig();
    mdChanged = true;
    await saveSection(sec);
    render();
  };

  const splitAtAtom = async atomIdx => {
    const ci = curChunkIdx();
    if (model.cuts.includes(atomIdx)) return;
    splitMode = false;
    await applyCustomCuts([...model.cuts, atomIdx], 'custom', () => {
      const shift = arr => arr.map(x => (x > ci ? x + 1 : x));
      st.fixedFirst = shift(st.fixedFirst);
      st.fixedQueue = shift(st.fixedQueue);
      st.queue = shift(st.queue);
      const nextMiss = {};
      Object.entries(st.misses || {}).forEach(([k, v]) => { const n = +k; nextMiss[n > ci ? n + 1 : n] = v; });
      st.misses = nextMiss;
      if (st.phase === 'queue' && st.queue[0] === ci) st.queue.splice(1, 0, ci + 1);
    });
    toast('Blocco diviso in due (salvato per i prossimi studi)');
  };

  const mergeWithNext = async chunkIdx => {
    if (chunkIdx < 0 || chunkIdx >= model.chunks.length - 1) return;
    const cutAtom = model.chunks[chunkIdx + 1].a0;
    const nextCuts = model.cuts.filter(c => c !== cutAtom);
    splitMode = false;
    await applyCustomCuts(nextCuts, 'custom', () => {
      const remap = arr => [...new Set(arr.map(x => (x > chunkIdx + 1 ? x - 1 : x === chunkIdx + 1 ? chunkIdx : x)))];
      st.fixedFirst = remap(st.fixedFirst);
      st.fixedQueue = remap(st.fixedQueue);
      st.queue = remap(st.queue);
      const nextMiss = {};
      Object.entries(st.misses || {}).forEach(([k, v]) => {
        const n = +k;
        const m = n > chunkIdx + 1 ? n - 1 : n === chunkIdx + 1 ? chunkIdx : n;
        nextMiss[m] = (nextMiss[m] || 0) + v;
      });
      st.misses = nextMiss;
      if (st.idx > chunkIdx) st.idx = Math.max(chunkIdx, st.idx - 1);
    });
    toast('Blocchi uniti');
  };

  const applyPreset = async preset => {
    const curAtom = curChunk().a0;
    const newCuts = computePresetCuts(model.atoms, preset);
    splitMode = false;
    tocOpen = false;
    resetBlockDraft();
    await applyCustomCuts(newCuts, preset, () => {
      const targetChunk = model.chunks.findIndex(c => c.a0 <= curAtom && curAtom <= c.a1);
      st = {
        sig: makeSig(), phase: 'pass', idx: Math.max(0, targetChunk), step: 'read',
        queue: [], fixedFirst: [], fixedQueue: [], misses: {}, startedAt: st.startedAt
      };
    });
    const names = { headings: 'Per titoli', auto: 'Standard', items: 'Ogni voce principale' };
    toast(`Suddivisione: ${names[preset] || preset} (${model.chunks.length} blocchi)`);
  };

  // == Cloze al volo: usa selezione corrente o recente (tablet-friendly); senza selezione su blocco con cloze, nasconde i cloze!
  const clozeSelectedInChunk = async () => {
    const picked = captureChunkSelection() || (lastSel && Date.now() - lastSel.at < 5000 ? lastSel : null);
    const ch = curChunk();
    if (!picked) {
      if (countCloze(ch.md) > 0 && peekApi) {
        peekApi.toggleCloze();
        if (peekApi.isOn()) toast('Cloze nascosti nel blocco · per crearne uno nuovo, seleziona prima una parola');
        return;
      }
      toast('Seleziona prima una parola o frase nel blocco, poi tocca == Cloze');
      return;
    }
    const rChunk = findSourceRange(ch.md, picked.text, picked.occurrence);
    if (!rChunk) { toast('Non riesco a individuare quel testo nel Markdown'); return; }
    const absRange = { start: ch.start + rChunk.start, end: ch.start + rChunk.end };
    const nextSecMd = applyMarkToMd(sec.md, absRange, 'cloze');
    if (!nextSecMd || nextSecMd === sec.md) { toast('Nessuna modifica applicata'); return; }
    const added = nextSecMd.length > sec.md.length;
    sec.md = nextSecMd;
    model = buildFirstPassModel(sec);
    st.sig = makeSig();
    mdChanged = true;
    lastSel = null;
    document.getSelection()?.removeAllRanges();
    await saveSection(sec);
    toast(added ? 'Aggiunto al Cloze per i prossimi ripassi' : 'Cloze rimosso');
    render();
  };

  const askAiElabQuestion = async () => {
    if (!AI.ready() || elabBusy) return;
    const ch = curChunk();
    elabBusy = true;
    render();
    try {
      const r = await AI.generate({
        system: 'Formula UNA sola domanda breve di interrogazione elaborativa ("Perché…?", "Come fa…?", "Cosa succede se…?") basata SOLO sul blocco di appunti fornito, utile per capire il meccanismo o il collegamento clinico. Rispondi solo con la domanda, senza prefissi né risposta.',
        text: `Titolo: ${ch.title}\n\n${aiText(ch.md).slice(0, 3500)}`,
        maxTokens: 160
      });
      const q = String(r.text || '').replace(/^["«*\-\d.)\s]+|["»\s]+$/g, '').trim();
      if (!q) throw new Error('Nessuna domanda generata');
      elabQuestion = q;
      elabFeedback = '';
    } catch (err) {
      toast(err.message || 'Non riesco a generare la domanda', 'err');
    }
    elabBusy = false;
    render();
  };

  const checkAiElabAnswer = async () => {
    if (!AI.ready() || elabBusy || !elabAnswer.trim()) return;
    const ch = curChunk();
    elabBusy = true;
    render();
    try {
      const r = await AI.generate({
        system: 'Valuta in 2–3 righe chiare e dirette la risposta dello studente rispetto al blocco di appunti. Conferma cosa è giusto e integra brevemente solo ciò che manca o è impreciso, senza inventare dettagli fuori dal testo.',
        text: `Domanda: ${elabQuestion}\nRisposta dello studente: ${elabAnswer}\n\nAppunti di riferimento (${ch.title}):\n${aiText(ch.md).slice(0, 3500)}`,
        maxTokens: 280
      });
      elabFeedback = String(r.text || '').trim();
    } catch (err) {
      toast(err.message || 'Non riesco a verificare la risposta', 'err');
    }
    elabBusy = false;
    render();
  };

  const render = () => {
    if (peekApi) { peekApi.destroy(); peekApi = null; }
    saveSt();

    const chunks = model.chunks;
    if (st.phase === 'done') {
      const mins = Math.max(1, Math.round((Date.now() - (st.startedAt || Date.now())) / 60000));
      const nFirst = st.fixedFirst.length;
      const nQueue = st.fixedQueue.length;
      const hasCloze = countCloze(sec.md) + ioMaskCount(sec) > 0;
      const canPlan = !sec.studyhub && !sec.srs?.due;
      ov.innerHTML = `
        <div class="fp-shell">
          <header class="fp-head">
            <div class="fp-htitle">
              <span class="fp-badge done">✓ Prima passata completata</span>
              <h2>${esc(sec.title)}</h2>
            </div>
            <div class="fp-hacts">
              ${typeof helpBtn === 'function' ? helpBtn('firstPass3R') : ''}
              <button type="button" class="btn sm ghost" data-fp="close" aria-label="Chiudi">✕</button>
            </div>
          </header>
          <div class="fp-main">
            <div class="fp-done-card">
              <div class="fp-done-ic" aria-hidden="true">🎯</div>
              <h3>Tutti i ${chunks.length} blocchi fissati almeno 1 volta</h3>
              <p class="hint">Hai completato sia la lettura attiva 3R sia la coda di chiusura (Criterio = 1) in circa ${mins} ${mins === 1 ? 'minuto' : 'minuti'}.</p>
              <div class="fp-stats">
                <div class="fp-stat"><strong>${nFirst}</strong><span>Fissati al 1° colpo</span></div>
                <div class="fp-stat"><strong>${nQueue}</strong><span>Recuperati in coda</span></div>
                <div class="fp-stat"><strong>${chunks.length}</strong><span>Blocchi totali</span></div>
              </div>
              <div class="fp-done-acts">
                ${canPlan ? '<button type="button" class="btn primary" data-fp="studied">Segna come studiata in StudyHub</button><button type="button" class="btn" data-fp="plan">Ripassa nel Notebook</button>' : ''}
                ${hasCloze ? '<button type="button" class="btn" data-fp="cloze">Passa al Cloze</button>' : ''}
                <button type="button" class="btn ghost" data-fp="restart">Rifai da capo</button>
                <button type="button" class="btn ${canPlan ? 'ghost' : 'primary'}" data-fp="close">Torna a Leggi</button>
              </div>
            </div>
          </div>
        </div>`;
      return;
    }

    const ci = curChunkIdx();
    const ch = curChunk();
    const isQueue = st.phase === 'queue';
    const doneCount = st.fixedFirst.length + st.fixedQueue.length;
    const pct = Math.min(100, Math.round((doneCount / chunks.length) * 100));
    const radar = loadRadar(sec.id);
    const missCount = st.misses[ci] || 0;
    const canSplitOrMerge = ch.atoms.length > 1 || ci > 0 || ci < chunks.length - 1;
    const hasChunkCloze = countCloze(ch.md) > 0;

    ov.innerHTML = `
      <div class="fp-shell">
        <header class="fp-head">
          <div class="fp-htitle">
            <button type="button" class="fp-badge ${isQueue ? 'queue' : ''}" data-fp="toc" title="Mostra elenco blocchi e cambia suddivisione">
              ${isQueue ? `↻ Coda di chiusura · ${st.queue.length} ${st.queue.length === 1 ? 'rimasto' : 'rimasti'}` : `Blocco ${st.idx + 1} di ${chunks.length}`} ▾
            </button>
            <h2>${esc(sec.title)}</h2>
          </div>
          <div class="fp-hacts">
            ${typeof helpBtn === 'function' ? helpBtn('firstPass3R') : ''}
            <button type="button" class="btn sm ghost" data-fp="restart" title="Ricomincia dal primo blocco">↺</button>
            <button type="button" class="btn sm ghost" data-fp="close" aria-label="Chiudi">✕</button>
          </div>
        </header>
        <div class="fp-prog"><span style="width:${pct}%"></span></div>
        ${tocOpen ? `
          <div class="fp-toc" role="region" aria-label="Elenco e suddivisione dei blocchi">
            <div class="fp-preset-bar">
              <span class="fp-preset-lbl">Divisione:</span>
              <button type="button" class="btn sm ghost ${model.preset === 'headings' ? 'on' : ''}" data-fp-preset="headings" title="Un blocco per ogni titolo">Per titoli</button>
              <button type="button" class="btn sm ghost ${model.preset === 'auto' ? 'on' : ''}" data-fp-preset="auto" title="Gruppi di 3–4 punti">Standard</button>
              <button type="button" class="btn sm ghost ${model.preset === 'items' ? 'on' : ''}" data-fp-preset="items" title="Separa ogni voce principale (es. Psalterium, Corpo del Fornice…)">Ogni voce</button>
            </div>
            ${chunks.map((c, i) => {
              const isDone = st.fixedFirst.includes(i) || st.fixedQueue.includes(i);
              const inQ = st.queue.includes(i);
              const curMark = i === ci ? ' on' : '';
              return `<div class="fp-toc-item">
                <button type="button" class="fp-toc-row${curMark}" data-fp-jump="${i}">
                  <span class="fp-toc-ic">${isDone ? '✓' : inQ ? '↻' : `${i + 1}.`}</span>
                  <span class="fp-toc-t">${esc(c.title)}</span>
                </button>
                ${i < chunks.length - 1 ? `<button type="button" class="btn sm ghost fp-toc-merge" data-fp-merge="${i}" title="Unisci con il blocco successivo">🔗</button>` : ''}
              </div>`;
            }).join('')}
          </div>` : ''}
        <div class="fp-steps" aria-label="Fasi del metodo 3R">
          <span class="fp-step ${st.step === 'read' ? 'on' : 'past'}">1. Leggi</span>
          <span class="fp-step ${st.step === 'recall' ? 'on' : st.step === 'verify' ? 'past' : ''}">2. Copri e ripeti</span>
          <span class="fp-step ${st.step === 'verify' ? 'on' : ''}">3. Verifica</span>
          ${st.queue.length && !isQueue ? `<span class="fp-qpill" title="Blocchi in coda per il giro finale">↻ ${st.queue.length} in coda</span>` : ''}
        </div>
        ${radar ? '<div class="fp-radar fp-radar-in" id="fpInRadar"></div>' : ''}
        <div class="fp-main">
          ${isQueue && st.step === 'recall' ? '<div class="fp-qbanner"><strong>Coda di chiusura (Criterio = 1):</strong> richiama questo blocco senza guardare per fissarlo prima di finire.</div>' : ''}
          ${missCount >= 2 && st.step === 'verify' ? `<div class="fp-hard-nudge">⚠ <strong>Punto ostico</strong> (mancato ${missCount} volte): seleziona qui sotto i termini che ti sfuggono e premi <strong>== Cloze</strong>, oppure crea una <strong>＋ Flashcard</strong>.</div>` : ''}
          <article class="fp-card">
            ${ch.path.length ? `<div class="fp-crumb">${esc(ch.path.join(' › '))}</div>` : ''}
            <div class="fp-chead">
              <h3>${esc(ch.title)}</h3>
              <div class="fp-chead-acts">
                ${st.step !== 'recall' && canSplitOrMerge ? `<button type="button" class="btn sm ghost ${splitMode ? 'on' : ''}" data-fp="split-mode" aria-pressed="${splitMode}" title="Dividi questo blocco in punti separati o uniscilo ai vicini">✂️ ${splitMode ? 'Fine tagli' : 'Dividi'}</button>` : ''}
                ${st.step !== 'recall' && !splitMode ? `<button type="button" class="btn sm ghost" data-fp="cloze-sel" title="${hasChunkCloze ? 'Seleziona una parola per farne un cloze, oppure tocca senza selezione per nascondere i cloze del blocco' : 'Seleziona una parola o frase qui sotto e trasformala subito in ==cloze=='}">== Cloze</button>` : ''}
                ${st.step === 'read' && !splitMode ? '<button type="button" class="btn sm ghost" data-fp="peek" data-label-off="🙈 Oscura" aria-pressed="false" title="Copri i dettagli di questo blocco">🙈 Oscura</button>' : ''}
              </div>
            </div>
            <div class="pk-bar" id="fpPkBar" hidden></div>
            ${splitMode && st.step !== 'recall' ? `
              <div class="fp-split-ui">
                <p class="hint fp-split-hint">${ch.atoms.length > 1 ? 'Tocca <strong>✂️ Dividi qui</strong> tra due parti per separarle in blocchi distinti (si salva per i prossimi studi):' : 'Questo blocco è già una singola voce. Puoi unirlo al blocco vicino qui sotto oppure cambiare preset da <em>Blocco ▾</em>.'}</p>
                ${ch.atoms.map((a, k) => `
                  ${k > 0 ? `<button type="button" class="fp-cut-btn" data-fp-cut="${ch.a0 + k}"><span>✂️ Dividi qui</span></button>` : ''}
                  <div class="fp-atom-box notes">${renderMd(a.md)}</div>
                `).join('')}
                <div class="fp-split-merge-bar">
                  ${ci > 0 ? `<button type="button" class="btn sm ghost" data-fp-merge="${ci - 1}">🔗 Unisci col precedente</button>` : ''}
                  ${ci < chunks.length - 1 ? `<button type="button" class="btn sm ghost" data-fp-merge="${ci}">🔗 Unisci col successivo</button>` : ''}
                  <button type="button" class="btn sm primary" data-fp="split-mode">Fatto</button>
                </div>
              </div>` : st.step === 'recall' ? `
              <div class="fp-curtain">
                <p class="fp-curtain-t">Chiudi gli occhi o guarda solo il titolo e richiama questo blocco <strong>(${esc(ch.hint)})</strong>.</p>
                <textarea class="input fp-recall-ta" id="fpRecallTa" rows="3" placeholder="Facoltativo: scrivi 2–3 parole chiave o punti richiamati per confrontarli subito…">${esc(recallText)}</textarea>
                <div class="fp-elab-row">
                  <div class="fp-elab-btns">
                    <button type="button" class="btn sm ghost" data-fp="elab">❓ Collega (Perché?)</button>
                    ${AI.ready() ? `<button type="button" class="btn sm ghost" data-fp="elab-ai" ${elabBusy ? 'disabled' : ''}>${elabBusy ? 'Preparo domanda…' : `✨ Domanda ${AI.name()} sul blocco`}</button>` : ''}
                  </div>
                  ${elabQuestion ? `
                    <div class="fp-elab-box">
                      <div class="fp-elab-q">${esc(elabQuestion)}</div>
                      <textarea class="input fp-elab-ta" id="fpElabTa" rows="2" placeholder="Rispondi in 1 frase (collegamento causa-effetto o clinico)…">${esc(elabAnswer)}</textarea>
                    </div>` : ''}
                </div>
              </div>` : `
              ${st.step === 'verify' && (recallText.trim() || elabAnswer.trim()) ? `
                <div class="fp-your">
                  ${recallText.trim() ? `<span class="fp-your-lbl">Quello che hai richiamato</span><div class="fp-your-txt">${esc(recallText)}</div>` : ''}
                  ${elabAnswer.trim() ? `
                    <div class="fp-your-elab">
                      <span class="fp-your-lbl">Collegamento · ${esc(elabQuestion)}</span>
                      <div class="fp-your-txt">${esc(elabAnswer)}</div>
                      ${AI.ready() ? `<button type="button" class="btn sm ghost fp-elab-chk" data-fp="elab-check" ${elabBusy ? 'disabled' : ''}>${elabBusy ? 'Controllo…' : `✨ Controlla con ${AI.name()}`}</button>` : ''}
                      ${elabFeedback ? `<div class="fp-elab-fb">${esc(elabFeedback)}</div>` : ''}
                    </div>` : ''}
                </div>` : ''}
              <div class="notes fp-notes" id="fpNotes">${renderMd(ch.md)}</div>`}
          </article>
        </div>
        <footer class="fp-foot">
          ${st.step === 'read' ? `
            ${!isQueue && st.idx > 0 ? '<button type="button" class="btn ghost" data-fp="prev">← Precedente</button>' : '<span></span>'}
            <button type="button" class="btn primary" data-fp="to-recall">Copri e ripeti subito →</button>` : ''}
          ${st.step === 'recall' ? `
            <button type="button" class="btn ghost" data-fp="to-read">👁 Rileggi un attimo</button>
            <button type="button" class="btn primary" data-fp="to-verify">Mostra e confronta →</button>` : ''}
          ${st.step === 'verify' ? `
            <div class="fp-foot-left">
              <button type="button" class="btn sm ghost" data-fp="cloze-sel" title="Seleziona un termine nel blocco e aggiungilo al Cloze">== Cloze</button>
              <button type="button" class="btn sm ghost" data-fp="card" title="Crea una flashcard da questo blocco">＋ Flashcard</button>
            </div>
            <div class="fp-ver-btns">
              <button type="button" class="btn fp-miss" data-fp="miss">↻ Da riprendere</button>
              <button type="button" class="btn fp-ok" data-fp="ok">✓ Fissato</button>
            </div>` : ''}
        </footer>
      </div>`;

    $$('[data-fp="cloze-sel"]', ov).forEach(b => b.addEventListener('pointerdown', e => {
      const c = captureChunkSelection();
      if (c) lastSel = c;
      if (e.pointerType === 'mouse') e.preventDefault();
    }));

    if (radar) renderRadarBox($('#fpInRadar', ov), sec, { compact: true });

    const notesBox = $('#fpNotes', ov);
    if (notesBox) {
      hydrateImages(notesBox);
      hydrateHtmlBlocks(notesBox);
      if (typeof attachInlineAtlasAnn === 'function') attachInlineAtlasAnn(notesBox, sec);
      if (st.step === 'read' || st.step === 'verify') {
        peekApi = setupPeekDetails(notesBox, { barEl: $('#fpPkBar', ov), btnEl: $('[data-fp="peek"]', ov) });
      }
    }
    const splitBox = $('.fp-split-ui', ov);
    if (splitBox) { hydrateImages(splitBox); hydrateHtmlBlocks(splitBox); }

    const ta = $('#fpRecallTa', ov);
    if (ta) ta.addEventListener('input', () => { recallText = ta.value; });
    const eta = $('#fpElabTa', ov);
    if (eta) eta.addEventListener('input', () => { elabAnswer = eta.value; });

    const main = $('.fp-main', ov);
    if (main) main.scrollTop = 0;
  };

  const advance = ok => {
    const ci = curChunkIdx();
    const chunks = model.chunks;
    resetBlockDraft();
    tocOpen = false;
    if (st.phase === 'pass') {
      if (ok) {
        if (!st.fixedFirst.includes(ci)) st.fixedFirst.push(ci);
      } else {
        st.misses[ci] = (st.misses[ci] || 0) + 1;
        if (!st.queue.includes(ci)) st.queue.push(ci);
      }
      st.idx++;
      if (st.idx < chunks.length) {
        st.step = 'read';
      } else if (st.queue.length) {
        st.phase = 'queue';
        st.step = 'recall';
        toast(`Giro di chiusura: ${st.queue.length} ${st.queue.length === 1 ? 'blocco' : 'blocchi'} da fissare`);
      } else {
        st.phase = 'done';
      }
    } else if (st.phase === 'queue') {
      st.queue.shift();
      if (ok) {
        if (!st.fixedQueue.includes(ci)) st.fixedQueue.push(ci);
      } else {
        st.misses[ci] = (st.misses[ci] || 0) + 1;
        st.queue.push(ci);
      }
      if (st.queue.length) st.step = 'recall';
      else st.phase = 'done';
    }
    render();
  };

  ov.addEventListener('click', async e => {
    const pre = e.target.closest('[data-fp-preset]');
    if (pre) { await applyPreset(pre.dataset.fpPreset); return; }
    const cut = e.target.closest('[data-fp-cut]');
    if (cut) { await splitAtAtom(+cut.dataset.fpCut); return; }
    const mg = e.target.closest('[data-fp-merge]');
    if (mg) { await mergeWithNext(+mg.dataset.fpMerge); return; }
    const jmp = e.target.closest('[data-fp-jump]');
    if (jmp) {
      const target = +jmp.dataset.fpJump;
      if (target >= 0 && target < model.chunks.length) {
        st.phase = 'pass';
        st.idx = target;
        st.step = 'read';
        tocOpen = false;
        resetBlockDraft();
        render();
      }
      return;
    }
    const act = e.target.closest('[data-fp]')?.dataset.fp;
    if (!act) return;
    if (act === 'close') { close(false); return; }
    if (act === 'toc') { tocOpen = !tocOpen; render(); return; }
    if (act === 'split-mode') { splitMode = !splitMode; tocOpen = false; render(); return; }
    if (act === 'restart') {
      model = buildFirstPassModel(sec);
      st = { sig: makeSig(), phase: 'pass', idx: 0, step: 'read', queue: [], fixedFirst: [], fixedQueue: [], misses: {}, startedAt: Date.now() };
      tocOpen = false;
      resetBlockDraft();
      render();
      return;
    }
    if (act === 'peek') { peekApi?.toggle(); return; }
    if (act === 'cloze-sel') { await clozeSelectedInChunk(); return; }
    if (act === 'prev' && st.phase === 'pass' && st.idx > 0) { st.idx--; st.step = 'read'; resetBlockDraft(); render(); return; }
    if (act === 'to-recall') { splitMode = false; st.step = 'recall'; tocOpen = false; render(); return; }
    if (act === 'to-read') { st.step = 'read'; render(); return; }
    if (act === 'to-verify') { st.step = 'verify'; render(); return; }
    if (act === 'elab') {
      promptIdx = (promptIdx + 1) % FP_ELAB_PROMPTS.length;
      elabQuestion = FP_ELAB_PROMPTS[promptIdx];
      elabFeedback = '';
      render();
      return;
    }
    if (act === 'elab-ai') { await askAiElabQuestion(); return; }
    if (act === 'elab-check') { await checkAiElabAnswer(); return; }
    if (act === 'ok') { advance(true); return; }
    if (act === 'miss') { advance(false); return; }
    if (act === 'card') {
      const ch = curChunk();
      await openCardSheet({ front: ch.title, back: ch.md, sectionId: sec.id, notebookId: sec.notebookId });
      return;
    }
    if (act === 'studied') {
      if (await markStudiedInStudyHub(sec)) close(true);
      return;
    }
    if (act === 'plan') {
      sec.srs = { ...(sec.srs || newSrs()), due: addDays(todayStr(), 1), interval: 1 };
      await saveSection(sec);
      toast('Primo ripasso nel Notebook domani');
      close(true);
      return;
    }
    if (act === 'cloze') {
      close(false);
      Nav.replace(`#/sec/${sec.id}/cloze`);
    }
  });

  const onKey = e => {
    if ($('#modalRoot').children.length) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (splitMode) { splitMode = false; render(); }
      else if (tocOpen) { tocOpen = false; render(); }
      else close(false);
      return;
    }
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (st.phase === 'done' || splitMode) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (st.step === 'read') { e.preventDefault(); st.step = 'recall'; render(); }
      else if (st.step === 'recall') { e.preventDefault(); st.step = 'verify'; render(); }
    } else if (st.step === 'verify') {
      if (e.key === '1') { e.preventDefault(); advance(false); }
      else if (e.key === '2') { e.preventDefault(); advance(true); }
    }
  };
  document.addEventListener('keydown', onKey, true);

  render();
}

function setupFirstPassControls(sec, body, notesEl) {
  const peekBtn = $('[data-act="fp-peek"]', body);
  const peekBar = $('#pkBar', body);
  const radarBox = $('#fpRadar', body);
  const ptBtn = $('[data-act="fp-pretest"]', body);
  const startBtn = $('[data-act="fp-start"]', body);
  const newBanner = $('#fpNewBanner', body);

  if (peekBtn) peekBtn.dataset.labelOff = '🙈 Oscura dettagli';
  const peek = setupPeekDetails(notesEl, { barEl: peekBar, btnEl: peekBtn });
  addCleanup(() => peek.destroy());

  const launchFirstPass = () => {
    if (peek.isOn()) peek.setOn(false);
    openFirstPass(sec, { onDone: refresh => { if (refresh) route(); else syncPretestBtn(); } });
  };

  const syncPretestBtn = () => {
    const r = loadRadar(sec.id);
    if (ptBtn) {
      const done = r ? r.items.filter(x => x.done).length : 0;
      ptBtn.textContent = r ? `⚡ Pre-test (${done}/${r.items.length})` : '⚡ Pre-test';
      ptBtn.classList.toggle('on', !!r);
    }
    renderRadarBox(radarBox, sec, { onChange: syncPretestBtn });
  };
  syncPretestBtn();

  const isFresh = !sec.studyhub && !sec.srs?.due && !(sec.srs?.history?.length);
  const dismissedKey = `nb-fp-dismiss:${sec.id}`;
  if (newBanner && isFresh && !loadRadar(sec.id) && !sessionStorage.getItem(dismissedKey)) {
    newBanner.hidden = false;
    newBanner.innerHTML = `
      <div class="fp-nb-txt"><strong>Sezione nuova:</strong> prima di leggere tutto di fila, attiva la memoria con 60s di Pre-test o studia un blocco alla volta.</div>
      <div class="fp-nb-acts">
        <button type="button" class="btn sm" data-fpnb="pretest">⚡ Pre-test (60s)</button>
        <button type="button" class="btn sm primary" data-fpnb="start">▶ Prima passata</button>
        <button type="button" class="btn sm ghost" data-fpnb="hide" aria-label="Chiudi suggerimento" title="Chiudi">✕</button>
      </div>`;
    newBanner.addEventListener('click', e => {
      const a = e.target.closest('[data-fpnb]')?.dataset.fpnb;
      if (!a) return;
      if (a === 'hide') { try { sessionStorage.setItem(dismissedKey, '1'); } catch {} newBanner.hidden = true; return; }
      if (a === 'start') { newBanner.hidden = true; launchFirstPass(); return; }
      if (a === 'pretest') {
        newBanner.hidden = true;
        openPreTest(sec, { onRadarSaved: syncPretestBtn, onStartFirstPass: launchFirstPass });
      }
    });
  }

  try {
    const saved = JSON.parse(sessionStorage.getItem(fpStateKey(sec.id)) || 'null');
    if (saved && saved.phase && saved.phase !== 'done' && startBtn) {
      startBtn.textContent = saved.phase === 'queue' ? `▶ Riprendi coda (${saved.queue?.length || 0})` : '▶ Riprendi passata';
    }
  } catch { /* niente */ }

  if (peekBtn) peekBtn.addEventListener('click', () => peek.toggle());
  if (startBtn) startBtn.addEventListener('click', launchFirstPass);
  if (ptBtn) ptBtn.addEventListener('click', () => {
    openPreTest(sec, { onRadarSaved: syncPretestBtn, onStartFirstPass: launchFirstPass });
  });
}
