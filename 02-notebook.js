'use strict';
/* StudyHub Notebook — 02-notebook.js
   Notebook e sezioni: elenchi, modalità di studio (Cloze, Leggi, Orale, Pagina bianca, Domande, Mappe, Video, Audio, Modifica), importazione, scrittura a mano, etichette.
   I moduli si caricano in ordine (vedi index.html) e condividono le stesse variabili globali. */

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
    ${DataGuard.bannerHtml()}
    ${Resume.target() ? `<a class="resume-card" href="#/resume"><span class="resume-ic" aria-hidden="true">↺</span><span class="row-main"><span class="row-sub">Riprendi da dove eri</span><span class="row-title">${esc(Resume.target().sec.title)}</span></span></a>` : ''}
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
// v3.57: il primo livello (i macro-argomenti) è fatto di cartelle: le apri e dentro trovi
// le sezioni e i sottoargomenti. “#/nb/<id>/<cartella>” è la pagina di una cartella.
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
  const folder = folderId ? groups.find(g => g.id === folderId && !groupParent(nb, g)) : null;
  if (folderId && !folder) { location.replace(`#/nb/${id}`); return; }
  const foldKey = `nb:${id}`;
  const closed = new Set(foldGet(foldKey));
  const lede = [
    `${secs.length} ${secs.length === 1 ? 'sezione' : 'sezioni'}`,
    topGroups(nb).length ? `${topGroups(nb).length} ${topGroups(nb).length === 1 ? 'cartella' : 'cartelle'}` : '',
    due ? `${due} da ripassare oggi` : '',
    nbCards.length ? `${nbCards.length} flashcard` : ''
  ].filter(Boolean).join(', ');
  const groupBlock = g => {
    const gs = secs.filter(s => s.groupId === g.id);
    const subs = subGroups(nb, g);
    const tree = groupTreeIds(nb, g);
    const all = secs.filter(s => tree.has(s.groupId));
    const gd = all.filter(isDue).length;
    const depth = groupDepth(nb, g);
    const isSub = depth > 1;
    const meta = [
      subs.length ? `${subs.length} ${subs.length === 1 ? 'sottoargomento' : 'sottoargomenti'}` : '',
      gs.length ? `${gs.length} ${gs.length === 1 ? 'sezione' : 'sezioni'}` : '',
      subs.length && all.length > gs.length ? `${all.length} in tutto` : ''
    ].filter(Boolean).join(', ') || 'Ancora vuoto';
    return `
      <section class="grp fold ${isSub ? 'sub-grp' : ''} ${depth === 3 ? 'lvl3' : ''}" data-fold="${g.id}" data-g="${g.id}">
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
  const folderCard = g => {
    const tree = groupTreeIds(nb, g);
    const all = secs.filter(s => tree.has(s.groupId));
    const subs = subGroups(nb, g);
    const gd = all.filter(isDue).length;
    const meta = [all.length ? `${all.length} ${all.length === 1 ? 'sezione' : 'sezioni'}` : 'Vuota', subs.length ? `${subs.length} ${subs.length === 1 ? 'sottoargomento' : 'sottoargomenti'}` : ''].filter(Boolean).join(' · ');
    return `<div class="folder-card" role="link" tabindex="0" data-open="${g.id}" aria-label="Apri la cartella ${esc(g.name)}">
      ${FOLDER_SVG}
      <span class="fc-main"><span class="fc-name">${esc(g.name)}</span><span class="fc-meta">${meta}</span></span>
      ${gd ? `<span class="pill due">${gd}</span>` : ''}
      <button class="btn ghost sm grp-more" type="button" data-gmenu="${g.id}" aria-label="Opzioni per ${esc(g.name)}">⋯</button>
    </div>`;
  };
  if (folder) {
    // pagina della cartella: le sue sezioni, poi i sottoargomenti come adesso
    const tree = groupTreeIds(nb, folder);
    const fsecs = secs.filter(s => tree.has(s.groupId));
    const own = secs.filter(s => s.groupId === folder.id);
    const subs = subGroups(nb, folder);
    const fdue = fsecs.filter(isDue).length;
    setView(`
      <a class="back" href="#/nb/${id}">${esc(nb.name)}</a>
      <header class="page-head">
        <div>
          <h1 class="folder-h1">${FOLDER_SVG}<span>${esc(folder.name)}</span></h1>
          <p class="lede">${[`${fsecs.length} ${fsecs.length === 1 ? 'sezione' : 'sezioni'}`, subs.length ? `${subs.length} ${subs.length === 1 ? 'sottoargomento' : 'sottoargomenti'}` : '', fdue ? `${fdue} da ripassare oggi` : ''].filter(Boolean).join(', ')}</p>
        </div>
        <div class="actions">
          <button class="btn primary" data-act="new-sec-here">Scrivi una sezione qui</button>
          <button class="btn" data-act="new-sub-here">Nuovo sottoargomento</button>
          <a class="btn" href="#/import/${id}/${folder.id}">Importa qui</a>
          ${fsecs.length ? `<a class="btn" href="#/viva/grp/${folder.id}">Interrogami</a>` : ''}
          <button class="btn ghost" type="button" data-gmenu="${folder.id}">Opzioni</button>
        </div>
      </header>
      ${fsecs.length > 3 ? '<input type="search" class="input search" id="secSearch" placeholder="Cerca in questa cartella" aria-label="Cerca in questa cartella">' : ''}
      <div id="nbBody">
        ${own.length ? `<ul class="list sec-list">${own.map(s => sectionRow(s)).join('')}</ul>` : ''}
        ${subs.map(groupBlock).join('')}
        ${own.length || subs.length ? '' : `
          <div class="empty">
            <p>Cartella vuota. Scrivi una sezione, importa qui un testo o un PDF, oppure sposta dentro sezioni che hai già.</p>
            <button class="btn" type="button" data-gadd="${folder.id}">Aggiungi sezioni esistenti</button>
          </div>`}
      </div>
      <p class="hint" id="noMatch" hidden>Nessuna sezione contiene questo testo.</p>
    `);
  } else setView(`
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
        <button class="btn" data-act="new-grp">Nuova cartella</button>
        <a class="btn" href="#/pdfs/nb/${nb.id}">PDF${state.pdfs.some(p => p.notebookId === nb.id) ? ` (${state.pdfs.filter(p => p.notebookId === nb.id).length})` : ''}</a>
        <a class="btn" href="#/lezioni/${nb.id}">Lezioni${(nb.audios || []).length ? ` (${nb.audios.length})` : ''}</a>
        ${secs.length ? `<a class="btn" href="#/exam/${nb.id}">Simulazione d’esame</a>` : ''}
        <button class="btn ghost" data-act="nb-more">Altro</button>
      </div>
    </header>
    ${secs.length > 3 ? '<input type="search" class="input search" id="secSearch" placeholder="Cerca nel notebook" aria-label="Cerca nel notebook">' : ''}
    <div id="nbFound" hidden></div>
    <div id="nbBody">
      ${topGroups(nb).length ? `<div class="folder-grid">${topGroups(nb).map(folderCard).join('')}</div>` : ''}
      ${loose.length ? `
        <section class="grp-loose">
          ${groups.length ? '<h2 class="sub">Fuori dalle cartelle</h2>' : ''}
          <ul class="list sec-list">${loose.map(s => sectionRow(s)).join('')}</ul>
        </section>` : ''}
      ${!secs.length && !groups.length ? `
        <div class="empty">
          <p>Notebook vuoto. Importa testo o un PDF, oppure scrivi una sezione a mano. Con le cartelle (i macro-argomenti: per esempio un apparato o un capitolo) raggruppi le sezioni; dentro una cartella puoi creare sottoargomenti.</p>
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
  on('[data-act="new-sec-here"]', 'click', () => newSecIn(folder.id));
  on('[data-act="new-sub-here"]', 'click', async () => { const g = await createGroupFlow(nb, folder.id); if (g) { toast('Sottoargomento creato'); route(); } });
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
    const sibs = groups.filter(x => (groupParent(nb, x)?.id || null) === (parent ? parent.id : null));
    const si = sibs.indexOf(g);
    const nIn = secs.filter(s => s.groupId === g.id).length;
    const kids = subGroups(nb, g);
    const depth = groupDepth(nb, g);
    const word = groupWord(nb, g);
    const choice = await actionSheet(g.name, [
      { key: 'add', label: 'Aggiungi sezioni esistenti' },
      { key: 'write', label: 'Scrivi una sezione qui' },
      ...(depth < GROUP_MAX_DEPTH ? [{ key: 'sub', label: depth === 1 ? 'Nuovo sottoargomento' : 'Nuovo sottoargomento (3° livello)' }] : []),
      { key: 'import', label: 'Importa qui' },
      { key: 'exam', label: 'Simulazione d’esame su questo argomento' },
      { key: 'listen', label: 'Ascolta in sequenza' },
      { key: 'rename', label: 'Rinomina' },
      { key: 'move', label: 'Sposta dentro un altro argomento' },
      { key: 'up', label: 'Sposta su', disabled: si <= 0 },
      { key: 'down', label: 'Sposta giù', disabled: si === sibs.length - 1 },
      { key: 'delete', label: depth === 1 ? 'Elimina la cartella' : `Elimina il ${word}`, danger: true }
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
    if (choice === 'listen') {
      const ids = groupTreeIds(nb, g);
      return Playlist.start(nbReadingOrder(nb).filter(s => ids.has(s.groupId)), g.name);
    }
    if (choice === 'move') {
      // può andare dove i suoi livelli ci stanno ancora (al massimo tre in tutto)
      const h = groupHeight(nb, g);
      const own = groupTreeIds(nb, g);
      const pathName = x => [...groupAncestors(nb, x), x].map(y => y.name).join(' › ');
      const cands = groups.filter(x => !own.has(x.id) && x.id !== parent?.id && groupDepth(nb, x) + h <= GROUP_MAX_DEPTH);
      const opts = [
        ...(parent ? [{ key: '__top', label: 'Al primo livello (diventa una cartella)' }] : []),
        ...cands.map(x => ({ key: x.id, label: `Dentro ${pathName(x)}` }))
      ];
      if (!opts.length) { toast(h >= GROUP_MAX_DEPTH ? 'Ha già tre livelli: può stare solo al primo livello' : 'Non c’è un altro argomento in cui spostarlo'); return; }
      const to = await actionSheet(`Sposta “${g.name}”`, opts);
      if (!to) return;
      if (to === '__top') delete g.parentId; else g.parentId = to;
      await saveNotebook(nb);
      if (to !== '__top') foldSet(foldKey, foldGet(foldKey).filter(x => x !== to));
      toast(to === '__top' ? 'Ora è una cartella' : `Spostato dentro ${groups.find(x => x.id === to)?.name}`);
      return route();
    }
    if (choice === 'rename') {
      const name = await modal({ title: depth === 1 ? 'Rinomina la cartella' : `Rinomina il ${word}`, input: true, value: g.name, confirm: 'Rinomina' });
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
        title: depth === 1 ? 'Eliminare la cartella?' : `Eliminare il ${word}?`,
        text: [
          nIn ? `${nIn === 1 ? 'La sua sezione resta' : `Le sue ${nIn} sezioni restano`} nel notebook${parent ? `, dentro ${parent.name}` : ', fuori dalle cartelle'}.` : 'Non perdi nessuna sezione.',
          kids.length ? (parent ? `${kids.length === 1 ? 'Il suo sottoargomento sale' : `I suoi ${kids.length} sottoargomenti salgono`} dentro ${parent.name}.` : `${kids.length === 1 ? 'Il suo sottoargomento diventa un macro-argomento' : `I suoi ${kids.length} sottoargomenti diventano macro-argomenti`}.`) : ''
        ].filter(Boolean).join(' '),
        confirm: 'Elimina', danger: true
      });
      if (!ok) return;
      for (const s of secs.filter(x => x.groupId === g.id)) { s.groupId = parent ? parent.id : null; await saveSection(s); }
      kids.forEach(k => { if (parent) k.parentId = parent.id; else delete k.parentId; });
      nb.groups = groups.filter(x => x.id !== g.id);
      await saveNotebook(nb);
      foldSet(foldKey, foldGet(foldKey).filter(x => x !== g.id));
      toast(depth > 1 ? 'Sottoargomento eliminato' : 'Macro-argomento eliminato');
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
      { key: 'viva', label: 'Interrogazione con l’AI su tutto il notebook' },
      { key: 'rename', label: 'Rinomina il notebook' },
      { key: 'delete', label: 'Elimina il notebook', danger: true }
    ]);
    if (choice === 'listen') Playlist.start(nbReadingOrder(nb), nb.name);
    if (choice === 'print') go(`#/print/nb/${nb.id}`);
    if (choice === 'viva') go(`#/viva/nb/${nb.id}`);
    if (choice === 'rename') renameNb();
    if (choice === 'delete') deleteNb();
  });
  const search = $('#secSearch');
  if (search && !folder) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      const found = $('#nbFound');
      box.hidden = !!q;
      found.hidden = !q;
      if (!q) { $('#noMatch').hidden = true; return; }
      const hits = secs.filter(s => (s.title + '\n' + stripCloze(s.md)).toLowerCase().includes(q));
      found.innerHTML = hits.length ? `<ul class="list sec-list">${hits.slice(0, 200).map(s => sectionRow(s)).join('')}</ul>` : '';
      $('#noMatch').hidden = hits.length > 0;
    });
  } else if (search) {
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
  const pDepth = parent ? groupDepth(nb, parent) : 0;
  if (parent && pDepth >= GROUP_MAX_DEPTH) { toast('Si arriva al massimo a tre livelli'); return null; }
  const name = await modal(parent ? {
    title: pDepth === 1 ? 'Nuovo sottoargomento' : 'Nuovo sottoargomento (3° livello)',
    text: `Dentro ${[...groupAncestors(nb, parent), parent].map(x => x.name).join(' › ')}. Raccoglie alcune sezioni${pDepth === 1 ? ' del macro-argomento' : ' del sottoargomento'}.`,
    input: true, placeholder: pDepth === 1 ? 'Es. Valvulopatie' : 'Es. Stenosi aortica', confirm: 'Crea'
  } : {
    title: 'Nuova cartella',
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
            <p class="sheet-sub">Scegli le sezioni da spostare qui.</p>
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
const MODES = [['cloze', 'Cloze'], ['read', 'Leggi'], ['map', 'Mappe'], ['blank', 'Pagina bianca'], ['oral', 'Orale'], ['quiz', 'Domande'], ['cards', 'Flashcard'], ['video', 'Video'], ['audio', 'Audio'], ['edit', 'Modifica']];

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
    : `<a class="back" href="#/nb/${sec.notebookId}${groupPathOf(sec)[0] ? `/${groupPathOf(sec)[0].id}` : ''}">${esc(nb ? nb.name : 'Notebook')}${groupPathText(sec) ? ` › ${esc(groupPathText(sec))}` : ''}</a>`;
  // “Torna a…”: la pagina da cui sei arrivato, se non è già quella del percorso
  const from = Nav.from();
  const crumbHref = state.fromReview ? '#/review' : caseSec ? '#/cases' : semSec ? '#/semei' : spCfg ? `#/${spCfg.route}` : `#/nb/${sec.notebookId}${groupPathOf(sec)[0] ? `/${groupPathOf(sec)[0].id}` : ''}`;
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
        <a class="btn sm" href="#/split" title="Apri di fianco un’altra sezione o un PDF">⇆ Affianca</a>
        ${sec.md.trim() ? `<a class="btn sm" href="#/print/sec/${sec.id}" title="Stampa la sezione o salvala in PDF">Stampa</a>` : ''}
        ${sec.md.trim().length > 150 ? `<a class="btn sm" href="#/viva/sec/${sec.id}" title="Il professore (l’AI) ti interroga su questa sezione">Interrogami</a>` : ''}
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
  if (mode !== 'edit') { Resume.save(location.hash || `#/sec/${sec.id}/${mode}`, window.scrollY); Resume.refresh(); }
  on('[data-act="inc"]', 'click', async () => { if (await toggleIncomplete(sec, () => saveSection(sec), caseSec ? 'caso' : 'sezione')) route(); });
  on('[data-act="case-meta"]', 'click', async () => { if (await caseSheet(sec)) { toast('Dati del caso salvati'); route(); } });
  on('[data-act="semei-meta"]', 'click', async () => { if (await semeiSheet(sec)) { toast('Dati della scheda salvati'); route(); } });
  on('[data-act="sp-meta"]', 'click', async () => { if (await specialSheet(spCfg, sec)) { toast('Dati salvati'); route(); } });
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
  ({ read: modeRead, map: modeMap, cloze: modeCloze, blank: modeBlank, oral: (s, b) => modeBlank(s, b, { oral: true }), quiz: modeQuiz, cards: modeCards, video: modeVideo, audio: modeAudio, edit: modeEdit, case: modeCase }[mode])(sec, body);
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
    ${sec.md.trim() ? `<div class="fold-tools"><button class="btn sm ghost ink-btn" data-act="listen" hidden>Ascolta</button><button class="btn sm ghost" data-act="listen-on" hidden title="Legge questa sezione e poi le successive del notebook">Ascolta da qui in poi</button><button class="btn sm ghost ink-btn" data-act="ink" hidden>Scrivi a mano</button><button class="btn sm ghost" data-act="imgs" hidden></button><button class="btn sm ghost" data-act="fold-all" hidden></button></div><article class="notes">${renderMd(sec.md)}</article>` : `
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
  bindLessonBlock(body, sec);
  bindSourcesBlock(body, sec, () => saveSection(sec), isCase(sec) ? 'caso' : 'sezione');
  $$('[data-eqopen]', body).forEach(b => b.addEventListener('click', async () => { const x = examQs().find(r => r.id === b.dataset.eqopen); if (x && await eqSheet(x)) route(); }));
  bindPdfRefsBlock(body, sec);
  const notesEl = $('.notes', body);
  if (notesEl) {
    const readFolds = setupFolds(notesEl, sec.id);
    bindFoldAll($('[data-act="fold-all"]', body), readFolds);
    bindImagesToggle($('[data-act="imgs"]', body), prepareImages(notesEl, sec).count);
    markGlossary(notesEl);
    bindGlossaryClicks(notesEl);
    setupReadingTools(notesEl, sec);
    linkStamps(notesEl, sec);
    setupNotesInk(notesEl, sec, $('[data-act="ink"]', body));
    setupListen(notesEl, $('[data-act="listen"]', body), readFolds);
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
  return `<option value="">Nessuno</option>${topGroups(nb).map(g => walk(g, '')).join('')}<option value="__new">Nuova cartella…</option>`;
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

function modeEdit(sec, body, opts = {}) {
  const otherNbs = state.notebooks.filter(n => n.id !== sec.notebookId);
  body.innerHTML = `
    <div class="grid2 ed-head">
      <label class="field"><span>Titolo del micro-argomento</span><input class="input" id="edTitle" value="${esc(sec.title)}"></label>
      <label class="field"><span>Cartella o sottoargomento</span>
        <select class="input" id="edGroup">${groupOptions(nbById(sec.notebookId), groupOf(sec)?.id || '')}</select></label>
    </div>
    ${tagFieldHtml('edTags', tagsOf(sec))}
    <div class="edit-tools" role="toolbar" aria-label="Formattazione">
      <button class="btn sm" data-wrap="==" title="Nasconde il testo selezionato nella modalità Cloze">Cloze</button>
      <button class="btn sm" data-act="hint" title="Aggiunge un suggerimento al cloze dove si trova il cursore">Suggerimento</button>
      <button class="btn sm" data-act="pnote" title="Una nota che compare come ⓘ dove hai il cursore: un tocco la apre">ⓘ Nota</button>
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
    <p class="hint edit-hint">Scrivi direttamente nell’anteprima: seleziona il testo e usa i pulsanti qui sopra. Invio apre un nuovo paragrafo, Tab rientra una voce di elenco. Immagini e blocchi HTML si modificano nel codice: toccali per andarci.</p>
    <div class="wy-wrap">
      <article class="notes wy" id="edWy" aria-label="Anteprima modificabile della sezione"></article>
    </div>
    <details class="code-box" id="codeBox" ${localStorage.getItem('nb-code-open') === '0' ? '' : 'open'}>
      <summary>Codice <span class="muted-inline">Markdown: qui vedi la sintassi e correggi gli errori; il blocco dove sei si illumina sopra</span></summary>
      <label class="sr-only" for="edMd">Testo della sezione in Markdown</label>
      <textarea id="edMd" class="input md-edit" spellcheck="false">${esc(sec.md)}</textarea>
      <p class="hint edit-hint">Nel codice, negli elenchi Invio crea una nuova voce e Invio su una voce vuota torna indietro di un livello.</p>
    </details>
    <label class="field"><span>Domande per il richiamo, una riga “D:” e una “R:” per domanda</span>
      <textarea id="edQs" class="input qs-edit" spellcheck="false">${esc(serializeQs(sec.questions))}</textarea></label>
    <label class="field"><span>Link a siti utili, uno per riga: Titolo | https://indirizzo</span>
      <textarea id="edLinks" class="input qs-edit links-edit" spellcheck="false" placeholder="Radiopaedia: stenosi aortica | https://radiopaedia.org/…">${esc(secLinksOf(sec).map(l => `${l.title} | ${l.url}`).join('\n'))}</textarea></label>
    ${AI.ready() ? `<button class="btn sm" data-act="ai-qs">Aggiungi domande con ${AI.name()}</button>` : ''}
    ${otherNbs.length && !opts.onDone ? `
      <details class="move">
        <summary>Sposta in un altro notebook</summary>
        <div class="inline">
          <select class="input" id="mvNb" aria-label="Notebook di destinazione">${otherNbs.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join('')}</select>
          <button class="btn sm" data-act="move">Sposta</button>
        </div>
      </details>` : ''}
    <div class="save-bar">
      <button class="btn primary" data-act="save">Salva</button>
      ${opts.onDone ? '<button class="btn ghost" type="button" data-act="ed-cancel">Chiudi senza salvare</button>' : `<a class="btn ghost" href="#/sec/${sec.id}/read">Annulla</a>
      <button class="btn ghost danger push" data-act="del">Elimina sezione</button>`}
    </div>`;
  bindGroupSelect($('#edGroup', body), () => nbById(sec.notebookId));
  if (opts.onDone) on('[data-act="ed-cancel"]', 'click', () => opts.onDone(), body);
  if (editJump && editJump.secId === sec.id) {
    const jmp = editJump;
    editJump = null;
    setTimeout(() => wy.jump(jmp), 80);
  }
  bindTagField(body, 'edTags');
  on('[data-act="pnote"]', 'click', async () => {
    const note = await askPnote();
    if (note) insertAtCursor(ta, `^[${note}]`);
  });
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
  const wy = setupWysiwyg($('#edWy', body), ta, $('.edit-tools', body));
  // la barra degli strumenti resta in alto sotto le schede mentre scorri
  const tabsEl = $('#view .tabs');
  const setTop = () => document.documentElement.style.setProperty('--tabs-h', `${tabsEl ? tabsEl.offsetHeight : 0}px`);
  setTop();
  window.addEventListener('resize', setTop);
  addCleanup(() => window.removeEventListener('resize', setTop));
  const refresh = () => wy.render();
  $('#codeBox', body).addEventListener('toggle', e => { try { localStorage.setItem('nb-code-open', e.target.open ? '1' : '0'); } catch { /* niente */ } });
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
    const list = await openPdfCropper(sec.notebookId, { sec });
    if (list.length) insertAtCursor(ta, `\n\n${list.map(r => imageMd(r.id, r.caption)).join('\n\n')}\n\n`);
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
    wy.flush();
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
      <div class="field" id="imGroupBox"><label class="lbl" for="imGroup">Cartella o sottoargomento</label>
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
      const f = foldAccents($('#mvQ', sh.el).value.trim());
      $('#mvList', sh.el).innerHTML = others.filter(s => !f || foldAccents(`${s.title} ${where(s)}`).includes(f)).slice(0, 60)
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
    bar.style.top = `${Math.round(Math.max(topMin, Math.min(bottomMax - h, y)))}px`;
    bar.style.left = `${Math.round(spaceL >= W ? art.left - W - Math.min(18, (spaceL - W) / 2) : art.right + Math.min(18, (spaceR - W) / 2))}px`;
  } else if (rect && rect.height && rect.top < topMin + 70) {
    // selezione proprio in alto: la barra resta in basso, lontano dal testo scelto
    bar.style.left = `${Math.round((art.left + art.right) / 2)}px`;
  } else {
    bar.classList.add('rt-top');
    bar.style.top = `${Math.round(topMin)}px`;
    bar.style.left = `${Math.round((art.left + art.right) / 2)}px`;
  }
}
// mostra la barra quando la selezione è ferma e nessun dito o penna sta trascinando
function stableSelection(bar, check, { delay = 380, place = null } = {}) {
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(() => { if (!SelGesture.down && check()) { bar.hidden = false; if (place) place(); } }, delay); };
  SelGesture.subs.add(later);
  return { changed() { bar.hidden = true; later(); }, cancel() { clearTimeout(t); }, done() { clearTimeout(t); SelGesture.subs.delete(later); } };
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
    // elenco puntato se la selezione prende più voci
    const lis = $$('li', container).filter(li => range.intersectsNode(li) && !li.querySelector('li'));
    const listText = lis.length > 1 ? lis.map(li => '- ' + li.textContent.trim()).join('\n') : '';
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
    if (pieces.length > 1 && (kind === 'card' || kind === 'clin')) c.listText = pieces.map(p => `- ${p.text}`).join('\n');
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
    menu.style.left = `${Math.max(8, Math.min(e.clientX, window.innerWidth - w - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(e.clientY, window.innerHeight - h - 8))}px`;
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
    const k = d.w / article.clientWidth;
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
  const add = (parent, t) => { const n = { t: t.slice(0, 200) }; (parent.c || (parent.c = [])).push(n); return n; };
  const note = (node, t) => { if (!t) return; node.n = node.n ? `${node.n}\n${t}`.slice(0, 2000) : t.slice(0, 2000); };
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
async function exportXmind(m) {
  await ensureJSZip();
  const topic = n => {
    const o = { id: uid() + uid(), class: 'topic', title: n.t || '' };
    if (n.n) o.notes = { plain: { content: n.n } };
    if ((n.c || []).length) o.children = { attached: n.c.map(topic) };
    return o;
  };
  const content = m.sheets.map(s => ({ id: uid() + uid(), class: 'sheet', title: s.title || m.name, rootTopic: { ...topic(s.root), structureClass: 'org.xmind.ui.map.unbalanced' } }));
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
  let maps = mapsOf(sec);
  const st = S();
  let mi = Math.min(maps.length - 1, Math.max(0, maps.findIndex(m => m.id === st.mapLast)));
  let si = 0;
  let view = st.mapView || (window.innerWidth < 700 ? 'list' : 'map');
  let quiz = false;
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
  const touched = () => { const c = cur(); if (c) c.m.edited = Date.now(); saveSoon(); };
  const snap = () => { const c = cur(); if (!c) return; undo.push({ si, root: JSON.stringify(c.sheet.root) }); if (undo.length > 60) undo.shift(); };

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
      const node = { t: String(text).slice(0, 300) };
      if (note) node.n = note;
      parent.c = [...(parent.c || []), node];
      collapsed.delete(parent);
      if (!edit) { edit = true; selNode = parent; }
      touched();
      draw();
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
      <div id="mapBox" class="map-box ${quiz ? 'quiz' : ''} ${edit ? 'editing' : ''}"></div>`;
    view === 'map' ? drawSvg(sheet) : drawList(sheet);
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
          <span class="ml-t ${hidden ? 'covered' : ''} ${mk ? `mk-${mk}` : ''}" data-mkey="${key}" ${edit ? 'contenteditable="true" spellcheck="true" role="textbox" aria-label="Nodo"' : hidden ? 'role="button" tabindex="0" aria-label="Ramo coperto: tocca per scoprirlo"' : ''}>${esc(n.t)}</span>
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
    const layout = (n, path, depth) => {
      const key = keyOf(path);
      const isRoot = depth === 0;
      const w = mapWrap(n.t || ' ', isRoot ? 240 : 200);
      const node = { n, key, depth, path, lines: w.lines, w: Math.ceil(w.width) + 24, h: w.lines.length * 19 + 14, kids: [] };
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
    const W = colX[colX.length - 1] + colW[colW.length - 1] + 60;
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
        <g class="mn ${isRoot ? 'root' : ''} d${Math.min(nd.depth, 3)} ${covered ? 'covered' : ''} ${edit && nd.n === selNode ? 'sel' : ''} ${quiz && !covered && mpMarks()[markKey(nd.key)] ? `mk-${mpMarks()[markKey(nd.key)]}` : ''}" data-mkey="${nd.key}" style="--h:${hue}" transform="translate(${nd.x} ${nd.y})" role="button" tabindex="0" aria-label="${covered ? 'Ramo coperto' : esc(nd.n.t)}">
          <rect width="${nd.w}" height="${nd.h}" rx="${isRoot ? 14 : 10}"/>
          ${nd.lines.map((l, k) => `<text x="12" y="${21 + k * 19}">${esc(l)}</text>`).join('')}
          ${nd.n.n && !covered ? `<g class="mn-note" data-mnote="${nd.key}" transform="translate(${nd.w - 4} -4)"><circle r="9"/><text text-anchor="middle" y="4">i</text><title>${esc(String(nd.n.n).slice(0, 200))}</title></g>` : ''}
          ${kidsN && collapsed.has(nd.n) ? `<g class="mn-more" data-mtoggle="${nd.key}" transform="translate(${nd.w + 6} ${nd.h / 2 - 9})"><rect width="${String(kidsN).length * 8 + 16}" height="18" rx="9"/><text x="8" y="13">+${kidsN}</text></g>` : ''}
        </g>`);
    };
    walk(root);
    box.innerHTML = `
      <div class="map-zoom"><button class="btn sm ghost" data-mz="-">−</button><button class="btn sm ghost" data-mz="0">${Math.round(zoom * 100)}%</button><button class="btn sm ghost" data-mz="+">+</button></div>
      <div class="map-scroll"><svg class="map-svg" viewBox="0 0 ${W} ${H}" width="${Math.round(W * zoom)}" height="${Math.round(H * zoom)}" role="img" aria-label="Mappa: ${esc(sheet.root.t)}"><g class="links">${links.join('')}</g>${nodes.join('')}</svg></div>`;
    const sc = $('.map-scroll', box);
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
    sc.addEventListener('touchmove', e => {
      if (drag && drag.armed) { e.preventDefault(); return; }
      if (pinch && e.touches.length === 2) { e.preventDefault(); setZoom(pinch.z * dist(e.touches[0], e.touches[1]) / pinch.d, pinch.x, pinch.y); }
    }, { passive: false });
    sc.addEventListener('touchend', () => { pinch = null; });
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
    const v = await modal({ title: 'Rinomina il nodo', input: true, value: n.t, confirm: 'Salva' });
    if (v === null || v === undefined) return;
    snap();
    n.t = String(v).replace(/\s+/g, ' ').trim() || '…';
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
      selNode = null;
      collapsed = new Set();
      touched();
      draw();
      return;
    }
    if (!selNode) { selNode = root; }
    const n = selNode;
    const p = parentOf(root, n);
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
    n.t = t.textContent.replace(/\s+/g, ' ').trim();
    touched();
  });
  body.addEventListener('paste', e => {
    if (!e.target.closest('.ml-t[contenteditable]')) return;
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') || '').replace(/\s+/g, ' '));
  });
  body.addEventListener('keydown', e => {
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
    if (v) { view = v.dataset.view; S().mapView = view; Settings.save(); draw(); return; }
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
    const tg = e.target.closest('[data-mtoggle]');
    if (tg) { const n = findNode(sheet, tg.dataset.mtoggle); if (n) { if (collapsed.has(n)) collapsed.delete(n); else collapsed.add(n); draw(); } return; }
    const node = e.target.closest('[data-mkey]');
    if (node) {
      const k = node.dataset.mkey;
      const n = findNode(sheet, k);
      if (edit) {
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
        <label class="field"><span>Cartella o sottoargomento</span><select class="input" id="blGroup"></select></label>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-bl="no">Annulla</button>
        <button class="btn primary" type="button" data-bl="ok">Collega</button>
      </div>`, { label: 'Collega a una sezione', onClose: v => resolve(v || null) });
    let mode = 'old';
    const list = $('#blList', sh.el);
    const draw = q => {
      const f = foldAccents(q.trim());
      const hits = all.filter(s => !f || foldAccents(`${s.title} ${where(s)}`).includes(f)).slice(0, 60);
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
        <label class="field"><span>Macro-argomento delle nuove sezioni</span><select class="input" id="bbGroup"></select></label>
      </div>
      <div class="inline"><button class="btn sm ghost" type="button" data-bb2="allnew">Nuove sezioni per quelli senza</button><button class="btn sm ghost" type="button" data-bb2="none">Nessuna per tutti</button></div>
      <div class="bb-rows" id="bbRows"></div>
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-bb2="no">Annulla</button>
        <button class="btn primary" type="button" data-bb2="ok">Collega</button>
      </div>`, { label: 'Collega i segnalibri', onClose: v => resolve(v || 0) });
    const rows = $('#bbRows', sh.el);
    const draw = () => {
      const secs = state.sections.filter(s => s.notebookId === nbId).sort((a, b) => a.title.localeCompare(b.title, 'it'));
      rows.innerHTML = bms.map(b => {
        const rg = bmRange(meta, b);
        const linked = refsOfBookmark(meta.id, b.id).find(s => s.notebookId === nbId);
        const sel = linked || guessSection(b.title, nbId);
        return `<div class="bb-row" data-bm="${b.id}">
          <div class="bb-t"><strong>${esc(b.title)}</strong><span class="muted-inline">${pagesTxt(rg.from, rg.to)}</span></div>
          <select class="input" aria-label="Sezione per ${esc(b.title)}">
            <option value="">Nessuna</option>
            <option value="__new">＋ Nuova sezione “${esc(b.title.slice(0, 40))}”</option>
            ${secs.map(s => `<option value="${s.id}" ${sel && sel.id === s.id ? 'selected' : ''}>${esc(s.title)}${groupPathText(s) ? ` · ${esc(groupPathText(s))}` : ''}</option>`).join('')}
          </select>
        </div>`;
      }).join('');
      const g = $('#bbGroup', sh.el);
      const n = nbById(nbId);
      g.innerHTML = n ? groupOptions(n, '') : '<option value="">Nessuno</option>';
    };
    draw();
    $('#bbNb', sh.el).addEventListener('change', e => { nbId = e.target.value; draw(); });
    sh.el.addEventListener('click', async e => {
      const b = e.target.closest('[data-bb2]');
      if (!b) return;
      const k = b.dataset.bb2;
      if (k === 'no') { sh.close(0); return; }
      if (k === 'allnew') { $$('.bb-row select', rows).forEach(s => { if (!s.value) s.value = '__new'; }); return; }
      if (k === 'none') { $$('.bb-row select', rows).forEach(s => { s.value = ''; }); return; }
      if (k === 'ok') {
        b.disabled = true;
        const gv = $('#bbGroup', sh.el).value;
        const groupId = gv && gv !== '__new' ? gv : null;
        let n = 0;
        for (const row of $$('.bb-row', rows)) {
          const v = $('select', row).value;
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
  return nb.audios.map(a => ({ a, whole: (a.secIds || []).includes(sec.id), marks: (a.marks || []).filter(m => (m.secIds || []).includes(sec.id)) })).filter(x => x.whole || x.marks.length);
}
function lessonBlockHtml(sec) {
  const refs = lessonRefsOf(sec);
  if (!refs.length) return '';
  return `<section class="fonti lz-sec" aria-label="Nelle lezioni">
    <div class="fonti-head"><h3>Nelle lezioni</h3><a class="btn sm ghost" href="#/lezioni/${sec.notebookId}">Tutte le lezioni</a></div>
    <ul class="lz-refs">${refs.map(r => `<li><b>${esc(r.a.name)}</b>${r.whole ? ' <small>(tutta la lezione)</small>' : ''}
      <span class="lz-pts">${r.whole && !r.marks.length ? `<button type="button" class="btn sm" data-lz="${r.a.id}:${r.a.pos || 0}">▶ Ascolta</button>` : ''}${r.marks.map(m => `<button type="button" class="btn sm" data-lz="${r.a.id}:${m.t}">▶ ${fmtT(m.t)}${m.label ? ` ${esc(m.label)}` : ''}</button>`).join('')}</span></li>`).join('')}</ul>
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
    this.el.addEventListener('pause', () => { this.paintPlay(); this.savePos(); });
    this.el.addEventListener('loadedmetadata', () => { this.paintTicks(); const r = this.rec(); if (r && !r.duration && Number.isFinite(this.el.duration)) { r.duration = this.el.duration; this.saveSoon(); } });
    this.el.addEventListener('ended', () => this.paintPlay());
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
    const f = await AudioDB.get(aId);
    if (!f) { toast(isSecRec(sec) ? 'Questo audio non è su questo dispositivo: ricaricalo dalla scheda Audio della sezione' : 'Questa lezione non è su questo dispositivo: ricaricala dalla pagina Lezioni', 'err'); return false; }
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
    this.el.currentTime = at !== null ? at : (rec.pos || 0);
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
    const a = audiosOf(sec)[0];
    if (!a) { toast('Questa sezione non ha audio'); return; }
    await this.load(sec, a.id, { at: t });
  },
  seek(t) { if (this.el) { this.el.currentTime = Math.max(0, t); this.paintTime(); } },
  paintPlay() { const b = $('.au-play', this.bar); b.textContent = this.el.paused ? '▶' : '❚❚'; b.setAttribute('aria-label', this.el.paused ? 'Riproduci' : 'Pausa'); },
  paintTime() {
    const d = this.el.duration || this.rec()?.duration || 0;
    $('.au-time', this.bar).textContent = `${fmtT(this.el.currentTime)} / ${fmtT(d)}`;
    if (d) $('.au-seek', this.bar).value = String(Math.round((this.el.currentTime / d) * 1000));
    if (Math.abs((this.rec()?.pos || 0) - this.el.currentTime) > 15) this.savePos();
  },
  paintTicks() {
    const r = this.rec();
    const d = this.el.duration || r?.duration || 0;
    $('.au-ticks', this.bar).innerHTML = r && d ? r.marks.map(m => `<button type="button" class="au-tick" data-tick="${m.t}" style="left:${(m.t / d) * 100}%" title="${esc(fmtT(m.t))} ${esc(m.label || '')}" aria-label="Vai a ${esc(fmtT(m.t))}"></button>`).join('') : '';
  },
  savePos() { const r = this.rec(); if (r) { r.pos = Math.floor(this.el.currentTime); this.saveSoon(); } },
  saveSoon() { clearTimeout(this.saveT); this.saveT = setTimeout(() => { const s = this.sec(); if (s) saveOwner(s); }, 800); },
  async act(a) {
    if (a === 'play') { if (this.el.paused) this.el.play().catch(() => {}); else this.el.pause(); return; }
    if (a === 'back') { this.seek(this.el.currentTime - 10); return; }
    if (a === 'fwd') { this.seek(this.el.currentTime + 30); return; }
    if (a === 'close') { this.savePos(); this.el.pause(); this.aId = ''; this.bar.hidden = true; document.body.classList.remove('au-on'); return; }
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
    </div>
    ${lessonBlockHtml(sec)}
    <p class="hint">Il lettore resta in basso anche se passi a Leggi o Modifica: scrivi mentre ascolti. <strong>＋ Segnalibro</strong> segna il punto (Alt+B al computer), <strong>⏱ Nel testo</strong> scrive il minuto dove hai il cursore (Alt+T): in Leggi quel minuto diventa un pulsante che fa ripartire l’audio da lì. I file audio restano su questo dispositivo; nome, durata e segnalibri si sincronizzano con la sezione.</p>
    ${list.length ? list.map(a => `
      <section class="au-item" data-aid="${a.id}">
        <div class="au-head">
          <button type="button" class="btn sm primary" data-a="play" aria-label="Ascolta ${esc(a.name)}">▶</button>
          <div class="au-meta"><b>${esc(a.name)}</b><small>${[a.duration ? fmtT(a.duration) : '', a.size ? fmtSize(a.size) : '', a.recorded ? 'registrato' : '', new Date(a.created).toLocaleDateString('it-IT')].filter(Boolean).join(' · ')}<span class="au-miss" hidden> · non su questo dispositivo</span></small></div>
          <button type="button" class="btn sm ghost" data-a="menu" aria-label="Altro">⋯</button>
        </div>
        ${a.marks.length ? `<ol class="au-marks">${a.marks.map(m => `<li><button type="button" class="link-btn" data-mt="${m.t}">${fmtT(m.t)}</button> <span class="au-ml">${esc(m.label || 'Senza nome')}</span>
          <button type="button" class="btn sm ghost" data-mr="${m.id}" aria-label="Rinomina">✎</button><button type="button" class="btn sm ghost" data-md="${m.id}" aria-label="Elimina il segnalibro">✕</button></li>`).join('')}</ol>` : '<p class="hint">Nessun segnalibro: aggiungili mentre ascolti.</p>'}
      </section>`).join('') : '<div class="empty"><p>Nessun audio in questa sezione. Carica la registrazione di una lezione, oppure registra adesso.</p></div>'}
  `;
  // file mancanti su questo dispositivo (registrati altrove)
  AudioDB.keys().then(keys => { const have = new Set(keys); $$('.au-item', body).forEach(it => { $('.au-miss', it).hidden = have.has(it.dataset.aid); }); });
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
      const ch = await actionSheet(a.name, [{ key: 'rename', label: 'Rinomina' }, { key: 'tolesson', label: 'Sposta nelle lezioni del notebook' }, { key: 'reload', label: 'Ricarica il file (se qui manca)' }, { key: 'save', label: 'Scarica il file' }, { key: 'del', label: 'Elimina l’audio', danger: true }]);
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
function secOptionsHtml(nb, exclude = []) {
  const secs = secsOf(nb.id).filter(s => !exclude.includes(s.id));
  const by = new Map();
  secs.forEach(s => { const g = groupPathText(s) || 'Senza cartella'; if (!by.has(g)) by.set(g, []); by.get(g).push(s); });
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], 'it')).map(([g, list]) => `<optgroup label="${esc(g)}">${list.sort((a, b) => a.title.localeCompare(b.title, 'it')).map(s => `<option value="${s.id}">${esc(s.title)}</option>`).join('')}</optgroup>`).join('');
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
      </div>
    </header>
    <p class="hint">Mentre ascolti, <strong>＋ Segnalibro</strong> segna il punto (Alt+B): se stai studiando una sezione di questo notebook, il segnalibro nasce già collegato a lei. <strong>⏱ Nel testo</strong> scrive il minuto e il nome della lezione negli appunti (Alt+T); in Leggi riparte da lì. Ogni sezione mostra i punti delle lezioni che la riguardano.</p>
    ${list.length > 2 ? `<input type="search" class="input search" id="lzQ" placeholder="Cerca nelle lezioni, nei segnalibri e nelle sezioni collegate" aria-label="Cerca nelle lezioni" value="${esc(lzState.q)}">` : ''}
    <div id="lzList">
    ${list.length ? list.slice().sort((a, b) => (b.created || 0) - (a.created || 0)).map(a => `
      <section class="au-item lz-item" data-aid="${a.id}" data-find="${esc(foldAccents(`${a.name} ${(a.marks || []).map(m => m.label).join(' ')} ${[...(a.secIds || []), ...(a.marks || []).flatMap(m => m.secIds || [])].map(id => secById(id)?.title || '').join(' ')}`))}">
        <div class="au-head">
          <button type="button" class="btn sm primary" data-a="play" aria-label="Ascolta ${esc(a.name)}">▶</button>
          <div class="au-meta"><b>${esc(a.name)}</b><small>${[a.duration ? fmtT(a.duration) : '', a.size ? fmtSize(a.size) : '', a.recorded ? 'registrata' : '', new Date(a.created).toLocaleDateString('it-IT'), a.pos ? `ascoltata fino a ${fmtT(a.pos)}` : ''].filter(Boolean).join(' · ')}<span class="au-miss" hidden> · non su questo dispositivo</span></small></div>
          <button type="button" class="btn sm ghost" data-a="menu" aria-label="Altro">⋯</button>
        </div>
        <div class="lz-secs"><span class="lbl">Sezioni della lezione:</span> <span class="tags" data-scope="lesson">${chips(a.secIds) || '<span class="hint">nessuna</span>'}</span>
          <select class="input lz-add" data-addto="lesson" aria-label="Collega la lezione a una sezione"><option value="">＋ Collega una sezione</option>${secOptionsHtml(nb, a.secIds || [])}</select></div>
        ${(a.marks || []).length ? `<ol class="au-marks lz-marks">${a.marks.map(m => `<li data-mid="${m.id}">
          <div class="lz-mrow"><button type="button" class="link-btn" data-mt="${m.t}">${fmtT(m.t)}</button> <span class="au-ml">${esc(m.label || 'Senza nome')}</span>
          <button type="button" class="btn sm ghost" data-mr="${m.id}" aria-label="Rinomina">✎</button><button type="button" class="btn sm ghost" data-md="${m.id}" aria-label="Elimina il segnalibro">✕</button></div>
          <div class="lz-mlink"><span class="tags" data-scope="mark">${chips(m.secIds)}</span>
          <select class="input lz-add sm" data-addto="mark" aria-label="Collega il segnalibro a una sezione"><option value="">＋ Sezione</option>${secOptionsHtml(nb, m.secIds || [])}</select></div></li>`).join('')}</ol>` : '<p class="hint">Nessun segnalibro: aggiungili mentre ascolti.</p>'}
      </section>`).join('') : '<div class="empty"><p>Nessuna lezione. Carica la registrazione di una lezione (anche lunga e su più argomenti), oppure registrala adesso. Poi segni i punti e li colleghi alle sezioni.</p></div>'}
    </div>`);
  AudioDB.keys().then(keys => { const have = new Set(keys); $$('.au-item').forEach(it => { const x = $('.au-miss', it); if (x) x.hidden = have.has(it.dataset.aid); }); });
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
  box.addEventListener('change', async e => {
    const s = e.target.closest('[data-addto]');
    if (!s || !s.value) return;
    const a = find(e.target.closest('.au-item'));
    if (!a) return;
    if (s.dataset.addto === 'lesson') a.secIds = [...new Set([...(a.secIds || []), s.value])];
    else { const m = a.marks.find(x => x.id === e.target.closest('[data-mid]').dataset.mid); if (m) m.secIds = [...new Set([...(m.secIds || []), s.value])]; }
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
    if (b.dataset.mt !== undefined) { if (AudioPlayer.aId === a.id) { AudioPlayer.seek(+b.dataset.mt); AudioPlayer.el.play().catch(() => {}); } else await AudioPlayer.load(nb, a.id, { at: +b.dataset.mt }); return; }
    if (b.dataset.mr) { const m = a.marks.find(x => x.id === b.dataset.mr); const v = await modal({ title: `Segnalibro a ${fmtT(m.t)}`, input: true, value: m.label || '', confirm: 'Salva', allowEmpty: true }); if (v !== null && v !== undefined) { m.label = String(v).trim(); await saveNotebook(nb); route(); } return; }
    if (b.dataset.md) { a.marks = a.marks.filter(x => x.id !== b.dataset.md); await saveNotebook(nb); AudioPlayer.paintTicks?.(); route(); return; }
    if (b.dataset.a === 'menu') {
      const ch = await actionSheet(a.name, [{ key: 'rename', label: 'Rinomina' }, { key: 'reload', label: 'Ricarica il file (se qui manca)' }, { key: 'save', label: 'Scarica il file' }, { key: 'del', label: 'Elimina la lezione', danger: true }]);
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
        if (!(await modal({ title: 'Eliminare la lezione?', text: 'Spariscono il file, i segnalibri e i collegamenti alle sezioni. I minuti scritti negli appunti restano, ma non portano più a niente.', confirm: 'Elimina', danger: true }))) return;
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
      const f = foldAccents($('#psQ', sh.el).value.trim());
      $('#psList', sh.el).innerHTML = all.filter(s => !f || foldAccents(`${s.title} ${where(s)}`).includes(f)).slice(0, 60)
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
    else if (c.tagName === 'UL' || c.tagName === 'OL') { if (items.length) items[items.length - 1].subs.push(c); else loose.push(c); }
  });
  const out = loose.map(sub => wyList(sub, pad));
  items.forEach(({ li, subs }) => {
    const own = document.createElement('div');
    li.childNodes.forEach(c => {
      if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) subs.unshift(c);
      else own.append(c.cloneNode(true));
    });
    const marker = ordered ? `${n++}. ` : '- ';
    const text = wyLine(wyInline(own)).replace(/\n/g, ' ');
    let s = `${pad}${marker}${text}`;
    subs.forEach(sub => { s += `\n${wyList(sub, pad + ' '.repeat(marker.length))}`; });
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

function setupWysiwyg(box, ta, tools) {
  let raws = [], types = [];
  let enabled = true;
  const dirty = new Set();
  let timer = 0;
  let lastFocus = 'wy';
  const starts = () => { const s = []; let a = 0; raws.forEach(r => { s.push(a); a += r.length; }); return s; };
  const render = () => {
    const t = wyTokenize(ta.value);
    raws = t.raws; types = t.types; enabled = t.ok;
    if (!enabled) {
      box.innerHTML = `<div class="wy-note">L’anteprima modificabile non è disponibile per questo testo: modifica nel codice qui sotto.</div>${renderMd(ta.value)}`;
      box.removeAttribute('data-ph');
      return;
    }
    const html = raws.map((raw, i) => {
      if (types[i] === 'space' || !raw.trim()) return '';
      const inner = renderMd(raw);
      const lock = !WY_EDITABLE.has(types[i]) || /<img|<iframe|html-embed|html-block/.test(inner) || raw.includes('```');
      return `<div class="wy-b${lock ? ' wy-lock' : ''}" data-b="${i}" contenteditable="${lock ? 'false' : 'true'}"${lock ? ' title="Questo blocco si modifica nel codice qui sotto: toccalo per andarci"' : ' spellcheck="true"'}>${inner}</div>`;
    }).join('');
    box.innerHTML = html || '<div class="wy-b wy-new" data-b="new" contenteditable="true" spellcheck="true"><p><br></p></div>';
    box.toggleAttribute('data-empty', !html);
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
      // blocco svuotato: tolgo anche la riga vuota che lo seguiva
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
  };
  const markDirty = el => { if (!el) return; dirty.add(el); clearTimeout(timer); timer = setTimeout(flush, 250); };
  const blockOf = node => { const n = node && (node.nodeType === 1 ? node : node.parentElement); const b = n && n.closest('.wy-b'); return b && box.contains(b) ? b : null; };
  box.addEventListener('input', e => markDirty(blockOf(e.target)));
  box.addEventListener('focusin', e => {
    lastFocus = 'wy';
    const b = blockOf(e.target);
    $$('.wy-cur', box).forEach(x => x.classList.toggle('wy-cur', x === b));
    if (b && b.dataset.b !== 'new') showInCode(+b.dataset.b);
  });
  // uscendo dall’anteprima ridisegno i blocchi, così titoli ed elenchi nuovi prendono forma
  box.addEventListener('focusout', e => {
    if (e.relatedTarget && box.contains(e.relatedTarget)) return;
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.edit-tools')) return;
    flush();
    setTimeout(() => { if (!box.contains(document.activeElement)) render(); }, 0);
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('.wy-lock');
    if (b) { goToCode(+b.dataset.b); return; }
    if (e.target.closest('a')) e.preventDefault();
  });
  // incollare: solo testo, niente stili presi da altre pagine
  box.addEventListener('paste', e => {
    const text = e.clipboardData?.getData('text/plain');
    if (text === undefined || [...(e.clipboardData?.items || [])].some(i => i.type.startsWith('image/'))) return;
    e.preventDefault();
    document.execCommand('insertText', false, text);
  });
  box.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      const sel = getSelection();
      const li = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement).closest('li');
      if (li && box.contains(li)) { e.preventDefault(); document.execCommand(e.shiftKey ? 'outdent' : 'indent'); markDirty(blockOf(li)); }
    }
  });
  ta.addEventListener('focusin', () => { lastFocus = 'ta'; });
  let tt = 0;
  ta.addEventListener('input', () => { if (box.contains(document.activeElement)) return; clearTimeout(tt); tt = setTimeout(render, 300); });
  // dal codice all’anteprima: il blocco dove sta il cursore si illumina
  const syncFromCode = () => {
    if (!enabled) return;
    const pos = ta.selectionStart;
    const st = starts();
    let i = st.length - 1;
    while (i > 0 && st[i] > pos) i--;
    while (i > 0 && (types[i] === 'space' || !raws[i].trim())) i--;
    $$('.wy-b', box).forEach(x => x.classList.toggle('wy-cur', +x.dataset.b === i));
  };
  ta.addEventListener('click', syncFromCode);
  ta.addEventListener('keyup', syncFromCode);
  const showInCode = i => {
    const st = starts();
    if (st[i] === undefined) return;
    const y = taOffsetY(ta, st[i] + (raws[i].match(/^\n*/)[0].length));
    ta.scrollTop = Math.max(0, y - 12);
  };
  const goToCode = i => {
    flush();
    const st = starts();
    const lead = (raws[i] || '').match(/^\n*/)[0].length;
    const a = (st[i] ?? 0) + lead, b = (st[i] ?? 0) + (raws[i] || '').trimEnd().length;
    const det = ta.closest('details');
    if (det) det.open = true;
    jumpInTextarea(ta, { start: a, end: b });
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
    if (anc && x.el.contains(anc) && matches(anc)) { unwrap(anc); markDirty(x.el); return true; }
    if (x.r.collapsed) { toast('Seleziona prima il testo'); return false; }
    const w = make();
    w.append(x.r.extractContents());
    x.r.insertNode(w);
    x.s.removeAllRanges();
    const nr = document.createRange();
    nr.selectNodeContents(w);
    x.s.addRange(nr);
    markDirty(x.el);
    return true;
  };
  const tag = (name, cls) => () => { const e = document.createElement(name); if (cls) e.className = cls; return e; };
  const handle = e => {
    if (lastFocus !== 'wy' || !enabled) return false;
    const b = e.target.closest('button');
    if (!b) return false;
    const d = b.dataset;
    if (d.wrap === '==') return wrap(tag('mark', 'cz'), n => n.tagName === 'MARK' && n.classList.contains('cz')) || true;
    if (d.wrap === '**') return wrap(tag('strong'), n => n.tagName === 'STRONG' || n.tagName === 'B') || true;
    if (d.mark === 'u') return wrap(tag('u', 'ul'), n => n.tagName === 'U') || true;
    if (d.mark) {
      const k = d.mark;
      const x = selIn();
      const anc = x && (x.r.commonAncestorContainer.nodeType === 1 ? x.r.commonAncestorContainer : x.r.commonAncestorContainer.parentElement).closest('mark.hl');
      if (anc && x.el.contains(anc) && !anc.classList.contains(`hl-${k}`)) { anc.className = `hl hl-${k}`; markDirty(x.el); return true; }
      return wrap(tag('mark', `hl hl-${k}`), n => n.tagName === 'MARK' && n.classList.contains(`hl-${k}`)) || true;
    }
    if (d.ins === 'list') { const x = selIn(); if (!x) return true; document.execCommand('insertUnorderedList'); markDirty(x.el); return true; }
    if (d.indent) {
      const x = selIn();
      if (!x) return true;
      if (!(x.r.startContainer.nodeType === 1 ? x.r.startContainer : x.r.startContainer.parentElement).closest('li')) { toast('Il rientro vale per le voci di un elenco'); return true; }
      document.execCommand(+d.indent > 0 ? 'indent' : 'outdent');
      markDirty(x.el);
      return true;
    }
    if (d.act === 'pnote') {
      const x = selIn();
      if (!x) { toast('Metti il cursore nel testo dell’anteprima'); return true; }
      const range = x.r.cloneRange();
      const el = x.el;
      askPnote().then(note => {
        if (!note) return;
        const sp = document.createElement('span');
        sp.className = 'pnote';
        sp.setAttribute('role', 'button');
        sp.dataset.pn = encodeURIComponent(note);
        sp.textContent = 'ⓘ';
        range.collapse(false);
        range.insertNode(sp);
        dirty.add(el);
        flush();
      });
      return true;
    }
    if (d.act === 'hint') {
      const x = selIn();
      const m = x && (x.r.startContainer.nodeType === 1 ? x.r.startContainer : x.r.startContainer.parentElement).closest('mark.cz');
      if (!m) { toast('Metti il cursore dentro un cloze, oppure trasforma prima il testo in cloze'); return true; }
      modal({ title: 'Suggerimento', text: `Per “${m.textContent}”: una domanda o un indizio che compare come “?” accanto al termine nascosto. Lascia vuoto per toglierlo.`, input: true, value: m.dataset.hint || '', placeholder: 'Es. ormone che abbassa la glicemia', confirm: 'Salva', allowEmpty: true }).then(v => {
        if (v === null) return;
        const c = cleanHint(v);
        if (c) m.dataset.hint = c; else delete m.dataset.hint;
        dirty.add(x.el);
        flush();
      });
      return true;
    }
    // inserimenti (tabella, immagine, link…): vanno nel codice subito dopo il blocco dove sei
    const x = selIn();
    if (x && x.el.dataset.b !== 'new') {
      flush();
      const i = +x.el.dataset.b;
      const st = starts();
      const end = (st[i] ?? ta.value.length) + (raws[i] || '').length;
      ta.setSelectionRange(end, end);
      ta.dataset.touched = '1';
    }
    return false;
  };
  if (tools) tools.addEventListener('click', e => { if (handle(e)) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);

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
  return { render, flush, jump, lastFocus: () => lastFocus };
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
  // si scende al massimo fino al terzo livello: dentro un gruppo profondo uso solo i titoli più vicini
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

