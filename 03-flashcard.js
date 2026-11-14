'use strict';
/* StudyHub Notebook — 03-flashcard.js
   Flashcard e ripasso: algoritmo di Anki, viste delle flashcard, ripasso, calendario, simulazione e modalità esame.
   I moduli si caricano in ordine (vedi index.html) e condividono le stesse variabili globali. */

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
        <div class="inline">${studyBtns('all', cc, { cls: 'sm' })}</div>
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
// v3.51: i valori di Anki restano quelli di partenza; si possono cambiare in Impostazioni
const ANKI_DEFAULTS = JSON.parse(JSON.stringify(ANKI));
function applyAnkiSettings() {
  const a = (S && S().anki) || {};
  Object.assign(ANKI, ANKI_DEFAULTS);
  const steps = v => (Array.isArray(v) && v.length && v.every(x => x > 0) ? v.slice(0, 6) : null);
  if (steps(a.learnSteps)) ANKI.learnSteps = steps(a.learnSteps);
  if (steps(a.relearnSteps)) ANKI.relearnSteps = steps(a.relearnSteps);
  if (+a.gradIvl >= 1) ANKI.gradIvl = Math.round(+a.gradIvl);
  if (+a.easyIvl >= 1) ANKI.easyIvl = Math.round(+a.easyIvl);
  if (+a.startEase >= 1.3) ANKI.startEase = +a.startEase;
  if (+a.easyBonus >= 1) ANKI.easyBonus = +a.easyBonus;
  if (+a.maxIvl >= 1) ANKI.maxIvl = Math.round(+a.maxIvl);
}
// “1 10”, “1m 10m 1h”, “1d”: tutto in minuti
const parseSteps = t => String(t || '').trim().split(/[\s,;]+/).filter(Boolean).map(x => { const m = x.match(/^(\d+(?:[.,]\d+)?)\s*(m|min|h|d|g)?$/i); if (!m) return NaN; const n = +m[1].replace(',', '.'); const u = (m[2] || 'm').toLowerCase(); return Math.round(n * (u === 'h' ? 60 : u === 'd' || u === 'g' ? 1440 : 1)); });
const fmtSteps = a => a.map(m => (m % 1440 === 0 ? `${m / 1440}d` : m % 60 === 0 && m >= 60 ? `${m / 60}h` : `${m}m`)).join(' ');
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

// v3.59: una flashcard nuova rimandata resta fuori dal ripasso fino al giorno scelto
const cardHeld = c => c.srs && c.srs.state === 'new' && c.srs.holdUntil && c.srs.holdUntil > todayStr();
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
    if (s.state === 'new') { if (!cardHeld(c)) newBy[c.notebookId] = (newBy[c.notebookId] || 0) + 1; }
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
  if (s.state === 'new') return cardHeld(c) ? `nuova, rimandata a ${fmtDay(s.holdUntil)}` : 'nuova';
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
      ${cards.length ? studyBtns(`sec-${sec.id}`, cardCounts(cards)) || '<span class="hint">Niente da studiare adesso in questa sezione.</span>' : ''}
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
      <div class="cs-head"><h2 class="sub">${cards.length} flashcard in questa sezione</h2><span id="csHostS"></span></div>
      <ul class="list" id="cardListS">${cards.map(cardRow).join('')}</ul>` : ''}
  `;
  if (cards.length) bindCardSelect($('#cardListS', body), () => cardsOfSection(sec.id), $('#csHostS', body));
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
        ${total ? studyBtns('all', all) : ''}
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
        ${studyBtns(nb.id, cnt)}
        <button class="btn" data-act="new-card">Nuova flashcard</button>
        <a class="btn ghost" href="#/nb/${nb.id}">Apri il notebook</a>
      </div>
    </header>
    ${cards.length ? `
      <div class="deck-counts">${countsHtml(cnt)}</div>
      ${COUNTS_LEGEND}
      <div class="cs-head">${cards.length > 5 ? '<input type="search" class="input search" id="cardSearch" placeholder="Cerca tra le flashcard" aria-label="Cerca tra le flashcard">' : ''}<span id="csHost"></span></div>
      <ul class="list" id="cardList">${cards.slice(0, LIMIT).map(cardRow).join('')}</ul>
      ${cards.length > LIMIT ? `<p class="hint" id="moreHint">Mostro le prime ${LIMIT}: usa la ricerca per trovare le altre.</p>` : ''}` : `
      <div class="empty"><p>Nessuna flashcard in questo notebook. Selezionando del testo in una sezione puoi crearne una in un attimo.</p></div>`}
  `);
  on('[data-act="new-card"]', 'click', async () => {
    const c = await openCardSheet({ notebookId: nb.id });
    if (c) route();
  });
  bindCardSelect($('#cardList'), () => cardsOf(nbId), $('#csHost'));
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
// v3.68: “Ripassa” = solo le flashcard già studiate (in scadenza e in apprendimento),
// “Studia” = anche le nuove, entro il limite del giorno
function studyBtns(scope, cnt, { cls = '' } = {}) {
  const old = (cnt.r || 0) + (cnt.l || 0), news = cnt.n || 0;
  return [
    old ? `<a class="btn primary ${cls}" href="#/study/${scope}/ripassa" title="Solo le flashcard già studiate, senza nuove">Ripassa <span class="btn-n">${old}</span></a>` : '',
    news ? `<a class="btn ${old ? '' : 'primary'} ${cls}" href="#/study/${scope}" title="Il ripasso più le flashcard nuove di oggi">${old ? 'Studia anche le nuove' : 'Studia le nuove'} <span class="btn-n">${news}</span></a>` : ''
  ].join('');
}
function startSession(scope, mode = '') {
  const now = Date.now();
  const cards = scopeCards(scope);
  const reviews = cards.filter(c => c.srs.state === 'review' && c.srs.due <= now).sort((a, b) => a.srs.due - b.srs.due || a.order - b.order);
  let news = mode === 'ripassa' ? [] : cards.filter(c => c.srs.state === 'new' && !cardHeld(c)).sort((a, b) => a.order - b.order);
  if (!scope.startsWith('sec-')) {
    // limite giornaliero di nuove per notebook (in una sola sezione studi tutto)
    const left = {};
    news = news.filter(c => {
      if (!(c.notebookId in left)) left[c.notebookId] = newLeftToday(c.notebookId);
      if (left[c.notebookId] > 0) { left[c.notebookId]--; return true; }
      return false;
    });
  }
  session = { scope, mode, queue: [...reviews, ...news].map(c => c.id), done: 0, undo: [], learned: [], current: null, revealed: false };
}
function pickNext() {
  const now = Date.now();
  const learning = scopeCards(session.scope)
    .filter(c => c.srs.state === 'learning' || c.srs.state === 'relearning')
    .sort((a, b) => a.srs.due - b.srs.due);
  if (learning.length && learning[0].srs.due <= now) return learning[0];
  while (session.queue.length) {
    const c = cardById(session.queue[0]);
    if (c && !c.suspended && ((c.srs.state === 'new' && !cardHeld(c)) || (c.srs.state === 'review' && c.srs.due <= now))) return c;
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
    if (c.srs.state === 'new') { if (!cardHeld(c)) n++; }
    else if (c.srs.state === 'review' && c.srs.due <= now) r++;
  }
  const l = scopeCards(session.scope).filter(c => (c.srs.state === 'learning' || c.srs.state === 'relearning') && c.srs.due <= now + LEARN_AHEAD).length;
  return { n, l, r };
}

function viewStudy(scope, mode = '') {
  if (!scope) scope = 'all';
  mode = mode === 'ripassa' ? 'ripassa' : '';
  if (!session || session.scope !== scope || (session.mode || '') !== mode) startSession(scope, mode);
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
      <h1>${esc(scopeTitle(sc))}${session.mode === 'ripassa' ? ' <span class="pill soft">solo ripasso</span>' : ''}</h1>
      ${countsHtml(sessionCounts())}
    </header>
    <article class="fcard study ${card.type === 'occlusion' ? 'is-io' : ''}">
      ${cardFaceHtml(card, session.revealed)}
      ${session.revealed && card.note ? `<p class="card-note"><strong>La tua nota sull’errore:</strong> ${esc(card.note)}</p>` : ''}
      ${session.revealed && session.typedCard === card.id && String(session.typed || '').trim() ? typedCompareHtml(session.typed, card) : ''}
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
            <button class="btn sm ghost board-toggle" data-act="typeans" aria-expanded="${!!S().typeOpen}">${S().typeOpen ? 'Chiudi la tastiera' : 'Scrivi con la tastiera'}</button>
            <button class="btn sm ghost board-toggle" data-act="board" aria-expanded="${S().boardOpen}">${S().boardOpen ? (inline ? 'Chiudi lavagna' : 'Chiudi la lavagna') : inline ? 'Lavagna' : 'Lavagna: scrivi la risposta a mano'}</button>
            ${inline && !session.revealed ? '<button class="btn primary reveal-inline" data-act="reveal" aria-keyshortcuts="Space">Mostra la risposta</button>' : ''}
          </div>
          ${S().typeOpen && card.type !== 'occlusion' && !session.revealed ? `<textarea class="input type-ans" id="typeAns" rows="3" placeholder="Scrivi qui la risposta, poi Mostra la risposta (Ctrl+Invio)" aria-label="La tua risposta">${esc(session.typedCard === card.id ? session.typed || '' : '')}</textarea>` : ''}
          ${S().boardOpen ? `<div class="board-wrap">${penToolsHtml({ colors: false })}<canvas class="board-canvas" id="boardCanvas" aria-label="Lavagna per scrivere la risposta"></canvas></div>` : ''}
        </div>`;
      if (inline) return grades + board;
      return board + (session.revealed ? grades : '<div class="study-actions"><button class="btn primary block big" data-act="reveal" aria-keyshortcuts="Space">Mostra la risposta</button></div>');
    })()}
    <div class="study-tools">
      <button class="btn sm ghost" data-act="undo" ${session.undo.length ? '' : 'disabled'}>Annulla l’ultima</button>
      <button class="btn sm ghost" data-act="cedit">✎ Modifica</button>
      <button class="btn sm ghost" data-act="postpone">Rimanda…</button>
      <button class="btn sm ghost" data-act="suspend">Sospendi</button>
    </div>
    ${sec && session.revealed ? `<p class="source">Dalla sezione <a href="#/sec/${sec.id}/read">${esc(sec.title)}</a></p>` : ''}
    ${session.revealed && card.pdf && pdfById(card.pdf.id) ? `<p class="source">Dal PDF <a href="#/pdf/${card.pdf.id}/${card.pdf.page}">${esc(pdfById(card.pdf.id).name)}, pagina ${card.pdf.page}</a></p>` : ''}
    <p class="hint kbd-hint">Spazio mostra la risposta, 1-4 per valutare, Ctrl+Z annulla.</p>
  `);
  on('[data-act="reveal"]', 'click', () => { session.revealed = true; renderStudy(); });
  on('[data-act="board"]', 'click', () => { S().boardOpen = !S().boardOpen; Settings.save(); renderStudy(); });
  on('[data-act="typeans"]', 'click', () => { S().typeOpen = !S().typeOpen; Settings.save(); renderStudy(); if (S().typeOpen) setTimeout(() => $('#typeAns')?.focus(), 30); });
  const typeAns = $('#typeAns');
  if (typeAns) {
    if (session.typedCard !== card.id) { session.typedCard = card.id; session.typed = ''; }
    typeAns.addEventListener('input', () => { session.typed = typeAns.value; });
    typeAns.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); session.revealed = true; renderStudy(); } });
    if (!session.revealed && document.activeElement === document.body) typeAns.focus({ preventScroll: true });
  }
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
  on('[data-act="cedit"]', 'click', async () => {
    if (await quickCardEdit(card)) renderStudy();
  });
  on('[data-act="postpone"]', 'click', async () => {
    const day = await pickPostponeDay();
    if (!day) return;
    const prev = JSON.parse(JSON.stringify(card.srs));
    postponeCard(card, day);
    await saveCard(card);
    session.queue = session.queue.filter(x => x !== card.id);
    session.current = null;
    session.revealed = false;
    toast(`Rimandata a ${fmtDay(day)}`, '', { label: 'Annulla', fn: async () => { card.srs = prev; await saveCard(card); session.queue.unshift(card.id); session.current = null; renderStudy(); } });
    renderStudy();
  });
  on('[data-act="suspend"]', 'click', async () => {
    card.suspended = true;
    await saveCard(card);
    session.current = null;
    toast('Flashcard sospesa');
    renderStudy();
  });
  const onKey = e => {
    if (isTyping() || $('#modalRoot').children.length) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoAnswer(); return; }
    if (!session.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); session.revealed = true; renderStudy(); return; }
    const i = ['1', '2', '3', '4'].indexOf(e.key);
    if (session.revealed && i >= 0) { e.preventDefault(); answerCard(CARD_GRADES[i].key); }
  };
  document.addEventListener('keydown', onKey);
  addCleanup(() => document.removeEventListener('keydown', onKey));
}

// v3.58: la risposta scritta con la tastiera accanto a quella giusta, con le parole
// importanti del retro che hai scritto (verdi) e quelle che mancano
const ANS_STOP = new Set('alla allo alle agli dalla dallo dalle dagli della dello delle degli nella nello nelle negli sulla sullo sulle sugli come anche quando perché perche sono essere viene vengono può possono questa questo queste questi quella quello quelle quelli loro molto più meno dopo prima senza sempre ogni altre altri altra altro solo cioè quindi però mentre dove tutti tutte tutto tutta hanno ha ho abbiamo hanno sia'.split(' '));
function ansWords(t) { return (foldAccents(String(t || '')).match(/[a-z0-9]{4,}/g) || []).filter(w => !ANS_STOP.has(w)); }
function typedCompareHtml(typed, card) {
  const back = plainText(card.type === 'occlusion' ? '' : (card.back || ''), 4000);
  const mine = new Set(ansWords(typed).map(w => w.slice(0, 6)));
  const key = [...new Set(ansWords(back))];
  const hit = key.filter(w => mine.has(w.slice(0, 6)));
  // le parole che mancano, scritte come nel retro (con gli accenti)
  const orig = new Map();
  (String(back).match(/[A-Za-zÀ-ÿ0-9]{4,}/g) || []).forEach(w => { const f = foldAccents(w); if (!orig.has(f)) orig.set(f, w.toLowerCase()); });
  const miss = key.filter(w => !mine.has(w.slice(0, 6))).map(w => orig.get(w) || w);
  const marked = esc(typed).replace(/[A-Za-zÀ-ÿ0-9]{4,}/g, w => (key.some(k => k.slice(0, 6) === foldAccents(w).slice(0, 6)) ? `<mark class="ans-ok">${w}</mark>` : w));
  return `<div class="typed-cmp">
    <p class="typed-h">La tua risposta${key.length ? ` · <span class="muted-inline">${hit.length} parole importanti su ${key.length}</span>` : ''}</p>
    <div class="typed-txt">${marked.replace(/\n/g, '<br>')}</div>
    ${miss.length && key.length ? `<p class="typed-miss">Nel retro ci sono anche: ${miss.slice(0, 10).map(esc).join(', ')}${miss.length > 10 ? '…' : ''}</p>` : ''}
  </div>`;
}
// Rimanda: le nuove restano fuori fino a quel giorno; le altre tornano quel giorno,
// con l’intervallo e la facilità di prima (come “Imposta la data” di Anki)
function postponeCard(c, day) {
  if (c.srs.state === 'new') { c.srs.holdUntil = day; return; }
  c.srs.due = new Date(`${day}T00:00:00`).getTime();
}
async function pickPostponeDay() {
  const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return localDateStr(d); };
  const ch = await actionSheet('Rimanda a', [
    { key: plus(1), label: `Domani (${fmtDay(plus(1))})` },
    { key: plus(2), label: `Tra 2 giorni (${fmtDay(plus(2))})` },
    { key: plus(3), label: `Tra 3 giorni (${fmtDay(plus(3))})` },
    { key: plus(7), label: `Tra una settimana (${fmtDay(plus(7))})` },
    { key: 'pick', label: 'Scegli il giorno…' }
  ]);
  if (!ch) return null;
  if (ch !== 'pick') return ch;
  return new Promise(resolve => {
    const sh = openSheet(`
      <h2>Rimanda a</h2>
      <label class="field"><span>Giorno</span><input class="input" type="date" id="ppDay" value="${plus(1)}" min="${plus(1)}"></label>
      <div class="modal-actions"><button class="btn ghost" type="button" data-pp="no">Annulla</button><button class="btn primary" type="button" data-pp="ok">Rimanda</button></div>`, { label: 'Rimanda', onClose: v => resolve(v || null) });
    $('[data-pp="no"]', sh.el).onclick = () => sh.close(null);
    $('[data-pp="ok"]', sh.el).onclick = () => { const v = $('#ppDay', sh.el).value; if (!v || v <= todayStr()) { toast('Scegli un giorno da domani in poi'); return; } sh.close(v); };
  });
}
// Modifica senza lasciare il ripasso
function quickCardEdit(c) {
  return new Promise(resolve => {
    const isIo = c.type === 'occlusion';
    const sh = openSheet(`
      <h2>Modifica la flashcard</h2>
      ${isIo ? '' : `<label class="field"><span>Fronte</span><textarea class="input card-ta" id="qeFront" rows="3">${esc(c.front)}</textarea></label>`}
      <label class="field"><span>${isIo ? 'Etichetta del riquadro' : 'Retro'}</span><textarea class="input card-ta" id="qeBack" rows="4">${esc(c.back || '')}</textarea></label>
      ${tagFieldHtml('qeTags', tagsOf(c))}
      <div class="modal-actions">
        <a class="btn ghost" href="#/card/${c.id}" data-qe="full">Editor completo</a>
        <button class="btn ghost" type="button" data-qe="no">Annulla</button>
        <button class="btn primary" type="button" data-qe="ok">Salva</button>
      </div>`, { label: 'Modifica la flashcard', onClose: v => resolve(!!v) });
    bindTagField(sh.el, 'qeTags');
    $('[data-qe="full"]', sh.el).onclick = () => { state.cardReturn = location.hash; sh.close(false); };
    $('[data-qe="no"]', sh.el).onclick = () => sh.close(false);
    $('[data-qe="ok"]', sh.el).onclick = async () => {
      const f = $('#qeFront', sh.el);
      if (f && !f.value.trim()) { toast('Il fronte non può essere vuoto'); f.focus(); return; }
      if (f) c.front = f.value.trim();
      c.back = $('#qeBack', sh.el).value.trim();
      c.tags = parseTags($('#qeTags', sh.el).value);
      c.updated = Date.now();
      await saveCard(c);
      toast('Flashcard salvata');
      sh.close(true);
    };
    setTimeout(() => ($('#qeFront', sh.el) || $('#qeBack', sh.el)).focus(), 40);
  });
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
  const newWaiting = session.mode === 'ripassa' ? cardCounts(scopeCards(sc)).n : 0;
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
    ${session.mode === 'ripassa' && newWaiting ? `<p>Hai ripassato tutto. Ci sono ancora ${newWaiting} ${newWaiting === 1 ? 'flashcard nuova' : 'flashcard nuove'} per oggi.</p>` : ''}
    <div class="row-actions">
      ${later.length ? '<button class="btn" data-act="continue">Continua lo stesso</button>' : ''}
      ${session.mode === 'ripassa' && newWaiting ? `<a class="btn" href="#/study/${sc}">Studia anche le nuove</a>` : ''}
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

/* ---------- Simulazione d’esame ---------- */
let examRun = null;
let examTimer = null;
let examStepOff = null;
function examScope(nbId, gid) {
  const nb = nbById(nbId);
  if (!nb) return null;
  const g = gid ? groupsOf(nb).find(x => x.id === gid) : null;
  const ids = g ? groupTreeIds(nb, g) : null;
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
      vocab: vocabFrom(`${it.q || ''} ${it.a || ''} ${secById(it.sid || it.sectionId)?.md || ''}`),
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
    if ($('#modalRoot').children.length || isTyping()) return;
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
   v3.15: ascolto delle sezioni, previsione dei ripassi, sanguisughe
   ===================================================================== */
const LEECH = 6;
const LEECH_TAG = 'sanguisuga';
const isLeech = c => (c.srs && c.srs.lapses >= LEECH) || tagsOf(c).includes(LEECH_TAG);

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

/* =====================================================================
   v3.49: selezione multipla delle flashcard, stampa e PDF, protezione dati
   ===================================================================== */
// Selezione di più flashcard in un elenco: tocca “Seleziona”, poi le righe;
// al computer Maiusc + clic prende tutte quelle in mezzo.
function bindCardSelect(listEl, getCards, btnHost) {
  if (!listEl || !btnHost) return;
  let on = false;
  let picked = new Set();
  let lastIdx = -1;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn sm ghost';
  btn.textContent = 'Seleziona';
  btnHost.append(btn);
  const bar = document.createElement('div');
  bar.className = 'ink-bar cs-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Flashcard selezionate');
  bar.innerHTML = `
    <b class="cs-n" aria-live="polite"></b>
    <button type="button" class="btn sm ghost" data-cs="all">Tutte</button>
    <button type="button" class="btn sm ghost" data-cs="none">Nessuna</button>
    <button type="button" class="btn sm ghost" data-cs="dup" title="Seleziona le flashcard con lo stesso fronte di un’altra, lasciando la prima">Doppioni</button>
    <button type="button" class="btn sm ghost" data-cs="post">Rimanda…</button>
    <button type="button" class="btn sm danger-solid" data-cs="del">Elimina</button>
    <button type="button" class="btn sm ghost" data-cs="end">Fine</button>`;
  document.body.append(bar);
  addCleanup(() => { bar.remove(); document.body.classList.remove('cs-on'); });
  const rows = () => $$('li[data-id]', listEl);
  const paint = () => {
    rows().forEach(li => {
      li.classList.toggle('cs-on', picked.has(li.dataset.id));
      let box = $('.cs-box', li);
      if (on && !box) { li.insertAdjacentHTML('afterbegin', '<span class="cs-box" aria-hidden="true"></span>'); }
      if (!on && box) box.remove();
    });
    listEl.classList.toggle('cs-mode', on);
    // spazio in fondo, così le ultime flashcard possono scorrere sopra la barra
    document.body.classList.toggle('cs-on', on);
    bar.hidden = !on;
    $('.cs-n', bar).textContent = `${picked.size} selezionate`;
    $('[data-cs="del"]', bar).disabled = !picked.size;
    $('[data-cs="post"]', bar).disabled = !picked.size;
    btn.textContent = on ? 'Fine selezione' : 'Seleziona';
  };
  const set = v => { on = v; if (!on) { picked = new Set(); lastIdx = -1; } paint(); };
  btn.addEventListener('click', () => set(!on));
  // l’elenco si ridisegna con la ricerca: ripasso i segni
  new MutationObserver(() => { if (on) paint(); }).observe(listEl, { childList: true });
  listEl.addEventListener('click', e => {
    if (!on) return;
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    e.preventDefault();
    e.stopPropagation();
    const all = rows();
    const idx = all.indexOf(li);
    if (e.shiftKey && lastIdx >= 0) {
      const [a, b] = [Math.min(lastIdx, idx), Math.max(lastIdx, idx)];
      all.slice(a, b + 1).forEach(x => picked.add(x.dataset.id));
    } else if (picked.has(li.dataset.id)) picked.delete(li.dataset.id);
    else picked.add(li.dataset.id);
    lastIdx = idx;
    paint();
  }, true);
  bar.addEventListener('click', async e => {
    const b = e.target.closest('[data-cs]');
    if (!b) return;
    const k = b.dataset.cs;
    if (k === 'end') { set(false); return; }
    if (k === 'all') { rows().forEach(li => picked.add(li.dataset.id)); paint(); return; }
    if (k === 'none') { picked = new Set(); paint(); return; }
    if (k === 'dup') {
      const seen = new Set();
      let n = 0;
      getCards().forEach(c => {
        if (c.type === 'occlusion') return;
        const key = foldAccents(plainText(c.front || '', 400)).replace(/\s+/g, ' ').trim();
        if (!key) return;
        if (seen.has(key)) { picked.add(c.id); n++; } else seen.add(key);
      });
      paint();
      toast(n ? `${n} doppioni selezionati: resta la prima di ognuna` : 'Nessun doppione');
      return;
    }
    if (k === 'post') {
      const list = getCards().filter(c => picked.has(c.id));
      if (!list.length) return;
      const day = await pickPostponeDay();
      if (!day) return;
      list.forEach(c => postponeCard(c, day));
      await saveCards(list);
      toast(`${list.length} flashcard rimandate a ${fmtDay(day)}`);
      set(false);
      route();
      return;
    }
    if (k === 'del') {
      const list = getCards().filter(c => picked.has(c.id));
      if (!list.length) return;
      if (!(await modal({ title: `Eliminare ${list.length} flashcard?`, text: 'Spariscono su tutti i tuoi dispositivi, con i loro ripassi.', confirm: 'Elimina', danger: true }))) return;
      await removeRecords(list.map(rec => ({ store: 'cards', rec })));
      toast(`${list.length} flashcard eliminate`);
      set(false);
      route();
    }
  });
  const onEsc = e => { if (on && e.key === 'Escape' && !$('#modalRoot').children.length) set(false); };
  document.addEventListener('keydown', onEsc);
  addCleanup(() => document.removeEventListener('keydown', onEsc));
}

