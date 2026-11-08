'use strict';
/* StudyHub Notebook — 06-app.js
   L’app intorno: impostazioni, StudyHub, link, guida, aiuto e tutorial, pagina Altro, Affianca, blocco note, Riprendi, protezione dei dati, avvio.
   I moduli si caricano in ordine (vedi index.html) e condividono le stesse variabili globali. */

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
      <h3 class="sub">Intervalli</h3>
      <p class="hint">Partono come in Anki: passi di 1 e 10 minuti, poi 1 giorno con “Bene”; 4 giorni con “Facile” su una carta nuova. Le modifiche valgono dalle prossime risposte.</p>
      <div class="grid2 anki-set">
        <label class="field"><span>Passi di apprendimento <span class="muted-inline">minuti, es. 1 10 (anche 1h, 1d)</span></span><input class="input" id="akLearn" value="${esc(fmtSteps(ANKI.learnSteps))}"></label>
        <label class="field"><span>Passi dopo un errore</span><input class="input" id="akRelearn" value="${esc(fmtSteps(ANKI.relearnSteps))}"></label>
        <label class="field"><span>Primo intervallo con “Bene” <span class="muted-inline">giorni</span></span><input class="input" type="number" min="1" max="30" id="akGrad" value="${ANKI.gradIvl}" inputmode="numeric"></label>
        <label class="field"><span>Primo intervallo con “Facile” <span class="muted-inline">giorni</span></span><input class="input" type="number" min="1" max="30" id="akEasy" value="${ANKI.easyIvl}" inputmode="numeric"></label>
        <label class="field"><span>Facilità iniziale <span class="muted-inline">%</span></span><input class="input" type="number" min="130" max="500" step="10" id="akEase" value="${Math.round(ANKI.startEase * 100)}" inputmode="numeric"></label>
        <label class="field"><span>Bonus “Facile” <span class="muted-inline">%</span></span><input class="input" type="number" min="100" max="300" step="5" id="akBonus" value="${Math.round(ANKI.easyBonus * 100)}" inputmode="numeric"></label>
        <label class="field"><span>Intervallo massimo <span class="muted-inline">giorni</span></span><input class="input" type="number" min="1" max="36500" id="akMax" value="${ANKI.maxIvl}" inputmode="numeric"></label>
      </div>
      <div class="actions"><button class="btn sm ghost" type="button" data-act="anki-reset">Ripristina i valori di Anki</button></div>
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
      <p class="hint" id="bkGuard"></p>
      <div class="actions"><button class="btn sm" type="button" data-act="persist">Proteggi l’archivio</button></div>
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
  const saveAnki = () => {
    const ls = parseSteps($('#akLearn').value), rs = parseSteps($('#akRelearn').value);
    if (!ls.length || ls.some(x => !(x > 0))) { toast('Passi di apprendimento non validi: scrivi i minuti separati da spazi, es. 1 10', 'err'); return; }
    if (!rs.length || rs.some(x => !(x > 0))) { toast('Passi dopo un errore non validi: es. 10', 'err'); return; }
    st.anki = {
      learnSteps: ls, relearnSteps: rs,
      gradIvl: Math.min(30, Math.max(1, +$('#akGrad').value || 1)),
      easyIvl: Math.min(30, Math.max(1, +$('#akEasy').value || 1)),
      startEase: Math.min(5, Math.max(1.3, (+$('#akEase').value || 250) / 100)),
      easyBonus: Math.min(3, Math.max(1, (+$('#akBonus').value || 130) / 100)),
      maxIvl: Math.min(36500, Math.max(1, +$('#akMax').value || 36500))
    };
    if (st.anki.easyIvl < st.anki.gradIvl) { st.anki.easyIvl = st.anki.gradIvl; $('#akEasy').value = st.anki.easyIvl; toast('“Facile” non può essere più corto di “Bene”: l’ho messo uguale'); }
    Settings.save();
    applyAnkiSettings();
    toast('Intervalli salvati: valgono dalle prossime risposte');
  };
  ['#akLearn', '#akRelearn', '#akGrad', '#akEasy', '#akEase', '#akBonus', '#akMax'].forEach(sel => $(sel)?.addEventListener('change', saveAnki));
  on('[data-act="anki-reset"]', 'click', () => { delete st.anki; Settings.save(); applyAnkiSettings(); toast('Valori di Anki ripristinati'); route(); });
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
      DataGuard.markBackup();
    } catch (err) {
      toast(err.message || 'Backup non riuscito', 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };
  on('[data-act="export-full"]', 'click', e => runExport(true, e.currentTarget));
  on('[data-act="persist"]', 'click', async () => { await askPersist(); route(); });
  DataGuard.status().then(st2 => {
    const el = $('#bkGuard');
    const pb = $('[data-act="persist"]');
    if (pb && st2.persisted === true) pb.hidden = true;
    if (!el) return;
    const lb = DataGuard.lastBackup();
    el.textContent = [st2.persisted === true ? 'Archivio protetto: il browser non lo cancella per fare spazio.' : st2.persisted === false ? 'Archivio non ancora protetto dal browser: tieni un backup o Drive attivo.' : '',
      st2.usage ? `Spazio usato: ${fmtSize(st2.usage)}${st2.quota ? ` su ${fmtSize(st2.quota)} disponibili` : ''}.` : '',
      lb ? `Ultimo backup scaricato: ${new Date(lb).toLocaleDateString('it-IT')}.` : 'Nessun backup scaricato da questo dispositivo.'].filter(Boolean).join(' ');
  });
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
async function markStudiedInStudyHub(sec, { relink = false } = {}) {
  const nb = nbById(sec.notebookId);
  const place = await shPlaceSheet(sec, { relink });
  if (place === false) return false;
  // per spostarla: StudyHub prima la scollega (e toglie l’argomento se l’aveva creato il Notebook), poi la rimette dove hai scelto
  if (relink) Bridge.send({ type: 'topic-unlinked', sectionId: sec.id, notebookId: sec.notebookId, subject: nb?.name || '', topic: sec.title });
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
  if (relink) { toast(`Spostata in StudyHub: ${place.shSubject}`, '', ShDock.isOpen() ? undefined : { label: 'Apri StudyHub', fn: () => ShDock.open() }); return true; }
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
    ${CHANGES.map(c => sec(`Novità della ${c.v}: ${esc(c.title)}`, c.html)).join('')}
    ${sec('Novità della 3.43: una sola barra, a sinistra', `
      <ul>
        <li>Sul tablet, tenere premuto con la penna o col dito apriva anche il menu pensato per il tasto destro del mouse, e le barre diventavano due. Ora con penna e dita compare solo la barra; il menu resta per il mouse.</li>
        <li>La colonna della selezione è più stretta e va <strong>a sinistra</strong> del testo, dove c’è spazio anche con la barra laterale aperta; a destra solo se a sinistra non ci sta.</li>
      </ul>`)}
    ${sec('Novità della 3.42: barra della selezione di lato', `
      <ul>
        <li>Quando selezioni del testo, la barra con Modifica, Cloze, colori, Glossario, Nota clinica e Flashcard si mette <strong>di lato</strong>, nello spazio libero accanto agli appunti e all’altezza della selezione, in colonna. Non copre più il testo né le maniglie della selezione.</li>
        <li>Se di lato non c’è spazio (telefono, pannelli aperti), va <strong>in alto</strong>, sotto le schede. Nel lettore PDF sta in alto, sotto gli strumenti.</li>
        <li>Il riquadro di Google che compare in basso con la parola selezionata è “Tocca per cercare” di Chrome: l’app non lo può spegnere, si disattiva da Chrome → Impostazioni → Servizi Google.</li>
      </ul>`)}
    ${sec('Novità della 3.41: selezione più precisa con la penna', `
      <ul>
        <li>La barra con Modifica, Cloze e i colori ora compare <strong>solo quando hai finito di selezionare</strong> (alzi la penna o il dito e la selezione resta ferma un attimo). Prima compariva subito, sotto la punta: trascinandoci sopra, il browser allungava la selezione fino in fondo. Vale in Leggi, nel Cloze e nel lettore PDF.</li>
        <li>Se poi sposti le maniglie della selezione, la barra si nasconde e ricompare appena ti fermi.</li>
      </ul>`)}
    ${sec('Novità della 3.40: terzo livello nei notebook', `
      <ul>
        <li>Dentro un sottoargomento puoi crearne un altro: <strong>macro-argomento › sottoargomento › sottoargomento</strong>, per esempio Cardiologia › Valvulopatie › Stenosi aortica. Dal menu “Opzioni” di un sottoargomento: <strong>Nuovo sottoargomento (3° livello)</strong>.</li>
        <li><strong>Sposta dentro un altro argomento</strong> (stesso menu) porta un gruppo, con le sue sezioni e i suoi sottoargomenti, dentro un altro, o di nuovo al primo livello: così riorganizzi quello che hai già senza ricreare niente. L’app ti propone solo i posti dove i livelli restano tre al massimo.</li>
        <li>Eliminando un gruppo, i suoi sottoargomenti salgono di un livello e le sue sezioni passano al gruppo sopra.</li>
        <li>Tutto il resto segue i tre livelli: il percorso in cima alla sezione, i menu “Macro-argomento” in Modifica e in Importa, la simulazione d’esame e l’ascolto in sequenza di un gruppo (che includono tutti i livelli sotto), l’ordine Precedente/Successiva e l’import “Per argomenti” dentro un gruppo.</li>
      </ul>`)}
    ${sec('Novità della 3.39: domande d’esame, ascolto in sequenza, figure del PDF', `
      <ul>
        <li><strong>Domande d’esame</strong> (barra laterale o Altro): la banca delle domande uscite, con materia, docente, anno, argomento e quante volte sono uscite. Si importano da un foglio <strong>Excel o CSV</strong> scegliendo le colonne; le domande ripetute si sommano. Filtri per materia, docente, anno; allenamento dalle più frequenti o da quelle che sbagli; esportazione in Excel per condividerle.</li>
        <li><strong>Ascolto in sequenza</strong>: dal menu di un macro-argomento o del notebook, oppure con “Ascolta da qui in poi” in Leggi, la voce legge una sezione dopo l’altra. Continua anche se cambi pagina; con la voce di Google si comanda anche dalla schermata di blocco.</li>
        <li><strong>Galleria delle figure</strong>: nel lettore PDF, pannello <strong>Figure</strong> (o “Galleria delle figure” nella libreria): l’app trova le immagini pagina per pagina; toccandone una la aggiungi a una sezione, ne fai l’esercizio delle etichette, la scarichi o apri la pagina di fianco.</li>
        <li><strong>Più leggera sul telefono</strong>: all’avvio non carica più in memoria il testo di tutti i PDF; la lettura dei PDF per la ricerca va a piccoli passi senza bloccare lo schermo e, se chiudi l’app a metà, riprende da dove era rimasta invece di ricominciare (con slide da centinaia di pagine faceva una grande differenza). Anche Leggi e Ripasso si aprono più in fretta con notebook grandi.</li>
      </ul>`)}
    ${sec('Novità della 3.38: Affianca', `
      <ul>
        <li><strong>⇆ Affianca</strong> (in cima a ogni sezione, nel lettore PDF, nella barra laterale e in Altro) apre in un pannello di fianco una <strong>sezione</strong> o un <strong>PDF</strong> a scelta: puoi confrontare due sezioni, una sezione con le sue slide, due PDF, o tenere un PDF accanto a un altro.</li>
        <li>Sul tablet sta di fianco anche in verticale; sul telefono si apre sotto. Trascina il bordo per cambiarne la misura.</li>
        <li>Per i PDF: pagine, zoom (anche con due dita), salto ai segnalibri; le pagine collegate a una sezione hanno il tasto ⇆ per aprirle direttamente di fianco, e nella libreria PDF c’è “Apri di fianco”.</li>
        <li>“Cambia” mostra un’altra cosa, “Apri qui” la porta nella pagina principale. Il pannello si alterna con il blocco note e con StudyHub.</li>
      </ul>`)}
    ${sec('Novità della 3.37: gomma della penna e tocco con due dita', `
      <ul>
        <li>In tutti i punti in cui scrivi a mano (blocco note, Scrivi a mano, appunti in Leggi, lettore PDF) funziona la <strong>gomma della penna</strong>: tieni premuto il pulsante laterale della S Pen mentre passi sul tratto, oppure usa l’estremità con la gomma della Staedtler Noris digital (e delle penne Wacom o Surface).</li>
        <li><strong>Tocco con due dita</strong> = annulla l’ultimo tratto, dopo che hai iniziato a scrivere con la penna. Con l’<strong>Apple Pencil</strong>, che non ha una gomma e il cui doppio tocco non arriva alle app nel browser, è il modo più rapido per correggere.</li>
        <li>Nel blocco note, appena usi la penna il palmo smette di scrivere da solo e con le dita scorri il foglio, come negli altri punti dell’app.</li>
      </ul>`)}
    ${sec('Novità della 3.36: crea e modifica le mappe', `
      <ul>
        <li>Nella scheda <strong>Mappe</strong> di ogni sezione: <strong>Crea una mappa</strong> da zero, oppure <strong>Crea dagli appunti</strong>: titoli ed elenchi della sezione diventano i rami e i paragrafi le note dei nodi.</li>
        <li><strong>✎ Modifica</strong> funziona su tutte le mappe, anche quelle caricate da XMind. Nella vista <strong>Elenco</strong> scrivi direttamente sui nodi: Invio aggiunge un nodo accanto, Tab lo mette dentro quello sopra, Maiusc+Tab lo porta fuori, Alt+↑/↓ lo sposta, Canc su un nodo vuoto lo elimina.</li>
        <li>Nella vista <strong>Mappa</strong> tocchi un nodo per sceglierlo e due volte per rinominarlo; lo trascini su un altro nodo per spostarlo lì dentro (sul telefono tieni premuto un attimo prima di trascinare). I pulsanti sopra fanno lo stesso: ＋ Dentro, ＋ Accanto, Rinomina, Nota, ↑ ↓ ← →, Elimina e Annulla (anche Ctrl+Z).</li>
        <li>Da <strong>Altro</strong>: <strong>Scarica come file XMind</strong> per riaprirla in XMind, aggiungi un foglio, crea flashcard, aggiungila agli appunti.</li>
      </ul>`)}
    ${sec('Novità della 3.35: segnalibri del PDF collegati alle sezioni', `
      <ul>
        <li>Nel lettore PDF, pannello <strong>Segnalibri</strong>: il tasto 🔗 accanto a un segnalibro lo collega a una sezione del notebook, che c’è già o nuova. Le pagine vanno dal segnalibro fino a quella prima del segnalibro successivo, e puoi cambiarle.</li>
        <li>Se il PDF ha un indice interno, in fondo al pannello <strong>Trasforma l’indice in segnalibri</strong> crea un segnalibro per ogni capitolo (e, se vuoi, paragrafo) in un colpo solo.</li>
        <li><strong>Collega i segnalibri alle sezioni</strong> li collega tutti insieme: per ognuno ti propongo la sezione con lo stesso nome, oppure scegli “Nuova sezione” (anche per tutti quelli senza) e il macro-argomento dove crearle. Comodo per dividere un PDF di centinaia di slide tra gli argomenti.</li>
        <li>Nella sezione, in fondo a Leggi, trovi <strong>Pagine di PDF</strong>: un tocco apre il PDF proprio lì. Le vedi anche in PDF della sezione; sotto ogni segnalibro compare la sezione collegata.</li>
      </ul>`)}
    ${sec('Novità della 3.34: menu fisso e figure dalle miniature del PDF', `
      <ul>
        <li>Le <strong>schede in alto</strong> (Cloze, Leggi, Modifica…) restano visibili quando scorri la pagina; in Modifica resta in vista anche la barra degli strumenti (Cloze, Grassetto, colori…).</li>
        <li><strong>Figura da PDF</strong>: scegli il PDF tra quelli della libreria (prima quelli della sezione e del notebook) o dal dispositivo, poi vedi tutte le pagine in miniatura e tocchi quella giusta. “Inserisci e continua” ti fa ritagliare più figure di fila; “Tutte le pagine” torna alle miniature.</li>
      </ul>`)}
    ${sec('Novità della 3.33: modifica sull’anteprima', `
      <ul>
        <li>In <strong>Modifica</strong> scrivi direttamente sugli appunti come li vedi in Leggi: correggi il testo, premi Invio per un nuovo paragrafo, seleziona e usa Cloze, Grassetto, Sottolinea, i colori, Elenco, Rientra (anche Tab) e Suggerimento.</li>
        <li>Sotto c’è il <strong>codice</strong> Markdown, sempre aggiornato: il blocco su cui stai lavorando si illumina, e toccando un blocco nell’anteprima il codice scorre lì. Immagini e blocchi HTML si modificano nel codice: toccali per arrivarci. Il riquadro del codice si può chiudere.</li>
        <li>Selezionando del testo in <strong>Leggi o nel Cloze</strong>, il primo pulsante della barra è <strong>✎ Modifica</strong>: apre Modifica con il cursore proprio su quel testo.</li>
      </ul>`)}
    ${sec('Novità della 3.32: blocco note, Riprendi e barra a scomparsa', `
      <ul>
        <li><strong>Blocco note a mano</strong>: il tasto con la penna in basso a destra apre un foglio accanto a qualunque pagina, anche durante Cloze, Orale o le flashcard. Sul computer sta a destra, sul telefono in basso; trascina il bordo per cambiarne la misura. Penna con pressione, quattro colori, tre spessori, gomma, annulla, più pagine; ogni sezione ha il suo blocco. Su tablet attiva “Solo penna” per appoggiare il palmo.</li>
        <li><strong>Riprendi</strong>: in cima alla barra laterale (sul telefono in Notebook e in Altro) riporta all’ultima sezione che stavi studiando, nella stessa scheda e allo stesso punto della pagina.</li>
        <li><strong>Barra laterale a scomparsa</strong>: il tasto accanto al nome dell’app la nasconde, quello in alto a sinistra la riapre; anche con Ctrl+B. L’app se lo ricorda.</li>
      </ul>`)}
    ${sec('Novità della 3.31: semeiotica, dati di laboratorio e barra laterale', `
      <ul>
        <li><strong>Sul computer</strong> la barra a sinistra ha ora Casi clinici, Laboratorio, Semeiotica e Da completare, con il numero degli elementi incompleti. Sul telefono restano in Altro.</li>
        <li><strong>Semeiotica</strong>: una scheda per ogni manovra, segno o punto di repere, con ambito (clinica o chirurgica) e distretto scelti da te. Parte vuota: la riempi tu, con i titoli già pronti per ogni tipo, foto (anche come etichette da rimettere al posto giusto) e video. “Esercitati” apre una scheda a caso in modalità Orale.</li>
        <li><strong>Laboratorio</strong>: l’elenco di base ora arriva compilato da Claude, con range indicativi, valori critici, cause di aumento e diminuzione, unità SI e note, e Claude come fonte. Hai già aggiunto l’elenco vuoto? Nella pagina degli esami tocca “Completale con i dati di Claude”: riempie solo i campi vuoti.</li>
        <li>Tutto è modificabile, anche le categorie: nella scheda di un esame scegli “Nuova categoria”.</li>
      </ul>`)}
    ${sec('Novità della 3.30: Medicina di laboratorio', `
      <ul>
        <li>Da Altro → <strong>Medicina di laboratorio</strong>. Ogni esame ha la sua scheda: campione e preparazione, range (anche diversi per uomini, donne o età) con la loro fonte, valori critici, cause di aumento e diminuzione, interferenze, andamento nel tempo, quando richiederlo, uso diagnostico, note, note cliniche collegate, fonti e “incompleto”.</li>
        <li><strong>Uso diagnostico</strong>: una riga per malattia e soglia con sensibilità e specificità; LR+ e LR− li calcola l’app.</li>
        <li><strong>Elenco di base</strong>: oltre 110 esami in 15 categorie, già compilati da Claude (vedi le novità della 3.31).</li>
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
      <p>Ogni sezione ha la scheda <strong>Mappe</strong>: crei una mappa (da zero o dagli appunti), la modifichi con ✎ Modifica, oppure carichi un file .xmind; la leggi come <strong>mappa</strong> (rami colorati, zoom con due dita o Ctrl + rotellina, tocchi un nodo per chiuderne o aprirne i rami) o come <strong>elenco</strong>. <strong>Ripassa</strong> copre tutti i rami: prova a ricordarli e toccali per scoprirli. Da <strong>Altro</strong> crei le flashcard della mappa, la aggiungi agli appunti come elenco, carichi altre mappe, la rinomini o la elimini. Si salva la struttura della mappa (titoli e note, non le immagini) e si sincronizza con la sezione.</p>`)}
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
/* ---------- Pagina "Altro" ---------- */
const MORE_ITEMS = [
  ['resume', 'Riprendi', 'Torna all’ultima sezione che stavi studiando, nella stessa scheda e allo stesso punto'],
  ['pad', 'Blocco note', 'Scrivi a mano accanto a qualunque pagina, mentre ripeti'],
  ['split', 'Affianca', 'Una sezione o un PDF di fianco, per confrontare due cose'],
  ['search', 'Cerca ovunque', 'Appunti, flashcard, testo dei PDF, glossario, note cliniche'],
  ['studyhub', 'StudyHub', 'Il tuo planner, aperto qui accanto senza lasciare il Notebook'],
  ['calendar', 'Calendario', 'Ripassi in programma, tempo di studio, punti deboli'],
  ['clinic', 'Note cliniche', 'Quadri clinici di tutte le materie, per sintomo'],
  ['examq', 'Domande d’esame', 'Le domande uscite agli esami, anche da Excel: frequenza, docenti, allenamento'],
  ['cases', 'Casi clinici', 'I casi visti a lezione e in tirocinio, con foto, PDF e modalità Risolvi'],
  ['scores', 'Score clinici', 'CHA₂DS₂-VASc, Wells, CURB-65, qSOFA, NEWS2, Glasgow, Child-Pugh, MELD'],
  ['micro', 'Microbiologia', 'Una scheda per ogni microrganismo, con foto e video'],
  ['pharma', 'Farmacologia', 'Una scheda per farmaco, per classe, con la tabella di confronto'],
  ['anat', 'Atlante di anatomia', 'Le tavole e le immagini di anatomia che usi di più, con etichette, tag e collegamenti'],
  ['atlas', 'Atlante diagnostico', 'ECG, emogas, Rx torace e altre immagini da imparare a leggere'],
  ['diary', 'Diario di tirocinio', 'Giornate, reparti, tutor e procedure sommate'],
  ['lab', 'Medicina di laboratorio', 'Esami con range, cause e uso diagnostico; referti, calcoli e allenamento'],
  ['semei', 'Semeiotica', 'Manovre, segni e punti di repere, clinica e chirurgica, con foto e video'],
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

/* =====================================================================
   v3.23: tempo di studio sommato tra i dispositivi, voce di Google
   (Gemini), filtro luce blu, tastiera del telefono
   ===================================================================== */

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
  SelGesture.init();
  NavHide.init();
  Resume.init();
  Pad.init();
  Split.init();
  PNote.init();
  initHelp();
  DataGuard.protect();
  applyAnkiSettings();
  // il vecchio “Atlante” diventa “Atlante diagnostico”
  const oldAtlas = state.notebooks.find(n => n.kind === 'atlas' && n.name === 'Atlante');
  if (oldAtlas) { oldAtlas.name = 'Atlante diagnostico'; saveNotebook(oldAtlas); }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-guard="later"]');
    if (!b) return;
    try { localStorage.setItem(DataGuard.KEY_SNOOZE, String(Date.now() + 7 * 86400000)); } catch { /* niente */ }
    b.closest('.guard-banner')?.remove();
  });
  setTimeout(showChangesIfNew, 900);
  setTimeout(pruneAudio, 8000);
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

/* ---------- Protezione dell’archivio, su richiesta ---------- */
async function askPersist() {
  if (!navigator.storage || !navigator.storage.persist) { toast('Questo browser non permette di proteggere l’archivio: tieni attivo Drive o fai un backup ogni tanto', 'err'); return false; }
  let ok = false;
  try { ok = (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch { ok = false; }
  if (ok) toast('Archivio protetto: il browser non lo cancellerà per fare spazio');
  else toast('Il browser per ora non lo concede: di solito lo fa quando installi l’app sulla schermata Home o la usi spesso. Intanto tieni attivo Drive o fai un backup', 'err');
  return ok;
}

/* ---------- Protezione dei dati e promemoria del backup ---------- */
const DataGuard = {
  KEY_BK: 'nb-last-backup',
  KEY_SNOOZE: 'nb-backup-snooze',
  lastBackup() { return +localStorage.getItem(this.KEY_BK) || 0; },
  markBackup() { try { localStorage.setItem(this.KEY_BK, String(Date.now())); } catch { /* niente */ } },
  async protect() {
    // chiedo al browser di non cancellare mai l’archivio dell’app quando manca spazio
    try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* non tutti i browser */ }
  },
  async status() {
    const out = { persisted: null, usage: 0, quota: 0 };
    try { if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted(); } catch { /* niente */ }
    try { if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); out.usage = e.usage || 0; out.quota = e.quota || 0; } } catch { /* niente */ }
    return out;
  },
  // cosa dire nella pagina dei notebook: nulla, se è tutto a posto
  reminder() {
    if (!state.sections.length || state.sections.length < 5) return null;
    if (Date.now() < (+localStorage.getItem(this.KEY_SNOOZE) || 0)) return null;
    const day = 86400000;
    if (Sync.configured()) {
      const last = Sync.meta().lastSync || 0;
      if (Date.now() - last > 3 * day) return { kind: 'sync', days: last ? Math.floor((Date.now() - last) / day) : null };
      return null;
    }
    const bk = this.lastBackup();
    if (!bk || Date.now() - bk > 14 * day) return { kind: 'backup', days: bk ? Math.floor((Date.now() - bk) / day) : null };
    return null;
  },
  bannerHtml() {
    const r = this.reminder();
    if (!r) return '';
    const txt = r.kind === 'sync'
      ? `Drive non si sincronizza ${r.days === null ? 'da quando l’hai configurato' : `da ${r.days} giorni`}: i dati nuovi sono solo su questo dispositivo.`
      : `${r.days === null ? 'Non hai ancora fatto un backup' : `L’ultimo backup è di ${r.days} giorni fa`}: se perdi il dispositivo, perdi gli appunti.`;
    return `<div class="guard-banner" role="status"><span>${txt}</span><span class="inline">
      <a class="btn sm primary" href="#/settings" data-guard="go">${r.kind === 'sync' ? 'Controlla Drive' : 'Fai il backup'}</a>
      <button class="btn sm ghost" type="button" data-guard="later">Più tardi</button></span></div>`;
  },
  bind(root) {
    const b = root.querySelector('[data-guard="later"]');
    if (b) b.addEventListener('click', () => { try { localStorage.setItem(this.KEY_SNOOZE, String(Date.now() + 7 * 86400000)); } catch { /* niente */ } b.closest('.guard-banner').remove(); });
  }
};

/* ---------- Novità dopo ogni aggiornamento ---------- */
const CHANGES = [
  { v: "3.57", title: "cartelle, note a comparsa, semaforo nelle mappe", html: `      <ul>
        <li><strong>Cartelle</strong>: nella pagina di un notebook il primo livello (i macro-argomenti) è fatto di cartelle. Le tocchi per entrare: dentro trovi le sezioni e i sottoargomenti, con i pulsanti per scrivere una sezione, creare un sottoargomento o importare proprio lì. Il percorso in cima a una sezione riporta alla sua cartella. “Cerca nel notebook” trova le sezioni in tutte le cartelle.</li>
        <li><strong>Note a comparsa</strong>: seleziona del testo e tocca <strong>ⓘ Nota</strong> nella barra (o il pulsante ⓘ Nota in Modifica): dopo il testo compare una ⓘ che si apre con un tocco, come le note di XMind. Dalla nota aperta puoi modificarla o toglierla. Nel testo si scrivono così: ^[testo della nota].</li>
        <li>Nelle <strong>mappe</strong> le note dei nodi hanno ora una ⓘ ben visibile (al computer, passandoci sopra, vedi anche l’inizio della nota).</li>
        <li><strong>Semaforo nel ripasso delle mappe</strong>: quando scopri un ramo, scegli com’è andata (verde, giallo, arancio, rosso); il ramo si colora. I rami rimasti rossi o arancio in più ripassi diventano <strong>punti deboli</strong>, come nel Cloze: li trovi in fondo alla sezione, nel Ripasso e nella simulazione d’esame.</li>
      </ul>` },
  { v: "3.56", title: "tasto Cancella, blocco note con lazo e quadretti, evidenziare le scansioni", html: `      <ul>
        <li>Con una tastiera collegata al tablet, <strong>Cancella</strong> in un campo già vuoto chiudeva la finestra (Android lo prendeva per “Indietro”). Ora non succede più.</li>
        <li><strong>Blocco note</strong>: il <strong>lazo</strong> circonda i tratti per selezionarli; poi li trascini dove vuoi, oppure li elimini con il cestino (o Canc). Lo <strong>sfondo</strong> si sceglie con il pulsante accanto: righe, quadretti o bianco.</li>
        <li><strong>Salva</strong> (la freccia in giù) scarica la pagina come immagine, tutte le pagine in un PDF, oppure mette la pagina in fondo alla sezione aperta, sotto “Appunti a mano”.</li>
        <li><strong>PDF da scansioni</strong>: nelle pagine senza testo (le scansioni sono immagini), con Evidenzia, Sottolinea o Barra trascini un riquadro sulla parte da segnare. Nei PDF con il testo funziona come prima.</li>
      </ul>` },
  { v: "3.55", title: "codice riordinato", html: `      <ul>
        <li>Nessuna funzione nuova: il codice dell’app, che era un unico file di oltre un megabyte, ora è diviso in sei moduli per argomento (base, notebook e sezioni, flashcard, PDF, materie cliniche, app). Così ogni modifica futura tocca un pezzo più piccolo, con meno rischi di rompere altro.</li>
        <li>Tutte le funzioni sono state riprovate dopo il riordino.</li>
      </ul>` },
  { v: "3.54", title: "note cliniche più ricche e diagnosi differenziale", html: `      <ul>
        <li>Le <strong>note cliniche</strong> hanno ora, tutti facoltativi: <strong>specialità</strong>; <strong>epidemiologia</strong> (incidenza, prevalenza, chi colpisce, fattori di rischio, codice di esenzione); <strong>diagnosi</strong> (clinica, di laboratorio, strumentale…, criteri, esami di primo e secondo livello, esame di riferimento); <strong>diagnosi differenziale</strong> collegata ad altre note; complicanze, stadiazione, prognosi; <strong>terapia</strong>; note; <strong>link</strong> e fonti. Nella scheda li apri solo quando ti servono; le note di prima restano com’erano.</li>
        <li>Nella nota, la diagnosi differenziale mostra per ogni malattia collegata i <strong>sintomi in comune</strong> e quelli <strong>solo suoi</strong>. Il collegamento vale nei due sensi. “Cerca su” apre Orphanet, MSD Manuals, PubMed e le linee guida sul nome della malattia.</li>
        <li><strong>Ricerca per più sintomi</strong>: scrivili separati da virgole (o tocca i sintomi sotto): in cima le malattie che ne hanno di più, con il conto (per esempio 3/4). Filtro per specialità.</li>
        <li><strong>Diagnosi differenziale</strong> (seconda scheda delle note cliniche): “Dai sintomi alla diagnosi” ti mostra alcuni sintomi di una tua nota e quattro diagnosi possibili, scelte tra quelle con sintomi in comune; dopo la risposta vedi quali sintomi spiega o non spiega ciascuna. “Cosa entra in diagnosi differenziale” ti chiede di scegliere le malattie collegate a un quadro.</li>
      </ul>` },
  { v: "3.53", title: "Farmacologia con il confronto; mappe in Affianca", html: `      <ul>
        <li><strong>Farmacologia</strong> (barra laterale o Altro): una scheda per farmaco, con area, <strong>classe</strong> e segno di <strong>prototipo</strong>, e i titoli pronti (meccanismo, farmacocinetica, indicazioni, effetti avversi, controindicazioni, interazioni, monitoraggio, gravidanza, sovradosaggio e antidoto). Tag e collegamenti alle sezioni come negli atlanti.</li>
        <li>La scheda <strong>Confronta</strong> mette i farmaci di una classe (o quelli che scegli) in una <strong>tabella</strong>: una riga per titolo, una colonna per farmaco, il prototipo per primo. Il testo viene dalle schede, quindi non lo scrivi due volte. Con <strong>Ripassa</strong> le celle si coprono e le scopri toccandole.</li>
        <li><strong>Mappe in Affianca</strong>: in ⇆ Affianca c’è la scheda <strong>Mappa</strong>. Scegli la sezione (prima quella che stai leggendo, o quella del PDF aperto) e nel pannello hai tutta la scheda Mappe: crei la mappa, la modifichi mentre leggi il PDF o gli appunti e da Altro la scarichi come file XMind.</li>
      </ul>` },
  { v: "3.52", title: "Atlante di anatomia; l’Atlante diventa Atlante diagnostico", html: `      <ul>
        <li><strong>Atlante di anatomia</strong> (barra laterale o Altro): una scheda per tavola o struttura, con apparato (osteologia, miologia, cardiovascolare, sistema nervoso…) e regione scelta da te. L’elenco mostra le immagini in miniatura. Carica la figura con ＋ Foto e fanne l’esercizio delle etichette o l’image occlusion.</li>
        <li><strong>Tag</strong> nei dati della scheda, per filtrare l’elenco (vale anche per microbiologia, atlante diagnostico e diario). <strong>Collegamenti</strong>: “Collega una sezione del notebook” unisce la scheda ai tuoi appunti; nella scheda vedi “Collegata a”, nella sezione collegata la trovi tra le “Pagine che rimandano qui”.</li>
        <li>Il vecchio <strong>Atlante</strong> (ECG, emogas, Rx) ora si chiama <strong>Atlante diagnostico</strong>: le schede restano tutte lì.</li>
      </ul>` },
  { v: "3.51", title: "intervalli delle flashcard modificabili", html: `      <ul>
        <li>Gli intervalli erano già identici a quelli di Anki, compresi i 4 giorni di “Facile” su una carta nuova. Ora li puoi cambiare in <strong>Impostazioni → Flashcard → Intervalli</strong>: passi di apprendimento, passi dopo un errore, primo intervallo con “Bene” e con “Facile”, facilità iniziale, bonus di “Facile”, intervallo massimo.</li>
        <li>Se 4 giorni ti sembrano troppi per una carta appena vista, metti “Facile” a 2 o 3. “Ripristina i valori di Anki” torna a quelli di partenza. Le modifiche valgono dalle prossime risposte; i pulsanti del ripasso mostrano già i nuovi intervalli.</li>
      </ul>` },
  { v: "3.50", title: "audio nelle sezioni, con segnalibri", html: `      <ul>
        <li>Ogni sezione ha la scheda <strong>Audio</strong>: <strong>Carica un audio</strong> (mp3, m4a, wav, ogg…) oppure <strong>● Registra</strong> la lezione direttamente.</li>
        <li>Il <strong>lettore resta in basso</strong> anche quando passi a Leggi o Modifica: scrivi gli appunti mentre ascolti. Avanti e indietro, velocità da 0,75× a 2×, barra con i segnalibri; riprende da dove eri rimasta.</li>
        <li><strong>＋ Segnalibro</strong> segna il punto (Alt+B al computer), anche mentre registri; poi gli dai un nome. Nella scheda Audio i segnalibri si toccano per ripartire da lì.</li>
        <li><strong>⏱ Nel testo</strong> (Alt+T) scrive il minuto, per esempio “⏱ 12:34”, dove hai il cursore in Modifica; in Leggi diventa un pulsante che fa ripartire l’audio da quel punto.</li>
        <li>I file audio restano su questo dispositivo (sono grandi per Drive e per il backup); nome, durata e segnalibri si sincronizzano con la sezione. Su un altro dispositivo puoi ricollegare lo stesso file e ritrovi i segnalibri.</li>
      </ul>` },
  { v: "3.49", title: "più flashcard insieme, stampa e PDF, protezione dell’archivio", html: `      <ul>
        <li><strong>Selezione multipla delle flashcard</strong>: nell’elenco di un mazzo (Flashcard → notebook) o nella scheda Flashcard di una sezione tocca <strong>Seleziona</strong>, poi le flashcard da eliminare. Al computer Maiusc + clic prende tutte quelle in mezzo. Nella barra in basso: Tutte, Nessuna, <strong>Doppioni</strong> (le flashcard con lo stesso fronte, lasciando la prima) ed <strong>Elimina</strong>.</li>
        <li><strong>Stampa o salva in PDF</strong>: il pulsante Stampa in cima a una sezione, oppure “Stampa o salva in PDF” nel menu Altro del notebook per stamparlo tutto (ogni sezione da una pagina nuova). Nella finestra di stampa scegli la stampante o “Salva come PDF”. Puoi nascondere i cloze per esercitarti su carta.</li>
        <li><strong>Proteggi l’archivio</strong> in Impostazioni → Backup: chiede al browser di non cancellare mai i dati dell’app quando manca spazio. Se il browser non lo concede (Chrome lo fa di solito dopo che installi l’app sulla schermata Home o la usi spesso), tieni attivo Drive o fai un backup.</li>
      </ul>` },
  { v: "3.48", title: "più parti insieme per il cloze", html: `      <ul>
        <li><strong>Al computer</strong>: seleziona la prima parte, poi tieni premuto <strong>Ctrl</strong> (⌘ sul Mac) mentre selezioni le altre. Le parti tenute da parte restano segnate con un riquadro tratteggiato; alla fine tocca <strong>Cloze</strong> (o un colore, la sottolineatura, ✕) e vale per tutte. Un clic normale ricomincia da capo, Esc le lascia perdere.</li>
        <li><strong>Sul tablet e sul telefono</strong>: seleziona una parte e tocca <strong>＋ Altra parte</strong> nella barra; poi seleziona la successiva, e così via. Il pulsante mostra quante parti hai; “✕ N parti” le lascia perdere.</li>
        <li>Anche Flashcard e Nota clinica usano tutte le parti, come elenco puntato. Shift resta per allungare una selezione, come sempre.</li>
      </ul>` },
  { v: "3.47", title: "StudyHub: scegli sempre materia e argomento", html: `      <ul>
        <li>“Segna come studiata in StudyHub” chiede <strong>sempre</strong> la materia e l’argomento. La materia proposta è quella usata l’ultima volta per quel notebook, oppure quella con il nome più simile: maiuscole, accenti, virgole e spazi non contano più. Prima, se il nome non era identico, proponeva “Nuova materia” e bastava un tocco per crearne una doppia.</li>
        <li><strong>Nuova materia</strong> non è mai scelta da sola: devi selezionarla e scriverne il nome; se ne esiste già una simile, l’app te lo dice e ti propone di usare quella.</li>
        <li>Per l’argomento scegli tra <strong>Argomento che c’è già</strong> (con la ricerca, e quello con lo stesso nome già evidenziato) e <strong>Nuovo argomento</strong>, di cui puoi cambiare il nome e scegliere dove metterlo.</li>
        <li>Per le sezioni finite nella materia sbagliata: nella sezione, <strong>Cambia materia o argomento</strong> la sposta dove vuoi; l’argomento che il Notebook aveva creato nella materia sbagliata sparisce. La materia doppia, ormai vuota, la elimini da StudyHub.</li>
        <li>Se il Notebook non vede le materie di StudyHub (non l’hai mai aperto in questo browser), te lo dice e ti fa aprire StudyHub prima di segnare.</li>
      </ul>` },
  { v: "3.46", title: "score clinici, microbiologia, atlante, diario, protezione dei dati", html: `      <ul>
        <li><strong>Score clinici</strong> (Altro o barra laterale): CHA₂DS₂-VASc, HAS-BLED, Wells per embolia e per TVP, CURB-65, qSOFA, NEWS2, Glasgow, Child-Pugh, MELD e MELD-Na, con il punteggio che si aggiorna mentre spunti e la lettura delle soglie. La fonte sono io (Claude), sulle linee guida citate sotto ogni score.</li>
        <li><strong>Microbiologia</strong>: una scheda per microrganismo (batterio, virus, fungo, parassita, prione), raggruppate come vuoi tu (per esempio Cocchi Gram+), con i titoli pronti: caratteristiche, virulenza, malattie, diagnosi, terapia e resistenze, prevenzione. Parte vuota.</li>
        <li><strong>Atlante</strong>: ECG, emogas, Rx torace, ecografie, TC e altro. Carichi l’immagine, ne fai l’esercizio delle etichette e scrivi la lettura; per ECG, emogas e Rx i titoli seguono l’ordine di lettura. Parte vuoto.</li>
        <li><strong>Diario di tirocinio</strong>: una pagina per giornata con data, reparto, tutor e procedure (eseguite, assistite, osservate, quante volte); la scheda <strong>Procedure</strong> le somma tutte.</li>
        <li><strong>Protezione dei dati</strong>: l’app chiede al browser di non cancellare mai il suo archivio. Se non usi Drive e non fai un backup da due settimane, o se Drive non si sincronizza da tre giorni, nella pagina dei notebook compare un avviso. In Impostazioni → Backup vedi lo spazio usato e se l’archivio è protetto.</li>
        <li>Da ora, dopo ogni aggiornamento compare una finestra con le <strong>novità</strong>.</li>
      </ul>` },
  { v: "3.45", title: "correzioni del lettore PDF", html: `      <ul>
        <li><strong>Zoom</strong>: con due dita o Ctrl + rotellina resta fermo sul punto che stai guardando. Prima, nei PDF lunghi, più eri avanti più lo zoom ti faceva saltare di pagine.</li>
        <li><strong>Evidenziare col dito o con la penna</strong>: con lo strumento Evidenzia (o Sottolinea, Barra), se selezioni tenendo premuto e allarghi con le maniglie, l’app non evidenzia più da sola a metà: compare la barra con i colori e tocchi quello che vuoi quando la selezione è giusta. Con la penna evidenzia appena la alzi dopo aver trascinato; con il mouse come prima.</li>
        <li><strong>Affianca con PDF pesanti</strong>: se il PDF è lo stesso del lettore, il pannello usa quello già aperto invece di caricarne una seconda copia; disegna una pagina alla volta (prima le più vicine), ne tiene poche in memoria e chiude davvero il PDF quando cambi o chiudi il pannello. Prima i PDF aperti si accumulavano e il tablet si bloccava.</li>
      </ul>` },
  { v: "3.44", title: "sposta un paragrafo in un’altra sezione", html: `      <ul>
        <li>Seleziona del testo in Leggi o nel Cloze e tocca <strong>↗ Sposta</strong> nella barra. L’app prende il blocco intero dove hai selezionato: un <strong>titolo con tutto quello che contiene</strong> (fino al titolo successivo dello stesso livello), le <strong>voci di elenco</strong> toccate con le loro sottovoci, un paragrafo o una tabella. Prima di spostare vedi l’anteprima.</li>
        <li>Scegli la sezione di arrivo (prima quelle dello stesso notebook) e dove metterlo: in fondo, all’inizio o dentro uno dei suoi titoli. Se c’è un titolo con lo stesso nome, è già proposto; i titoli spostati scendono di livello quando finiscono dentro un altro titolo.</li>
        <li>“Lasciane una copia anche qui” copia invece di spostare. Dopo lo spostamento, <strong>Annulla</strong> nel messaggio rimette tutto com’era.</li>
      </ul>` }
];
const verNum = v => String(v || '0').split('.').map(Number).reduce((a, x, i) => a + x / Math.pow(1000, i), 0);
function showChangesIfNew() {
  const KEY = 'nb-seen-version';
  let seen = '';
  try { seen = localStorage.getItem(KEY) || ''; localStorage.setItem(KEY, APP_VERSION); } catch { return; }
  if (!seen || verNum(seen) >= verNum(APP_VERSION)) return;
  const news = CHANGES.filter(c => verNum(c.v) > verNum(seen)).slice(0, 4);
  if (!news.length) return;
  const sh = openSheet(`
    <h2>Novità della versione ${APP_VERSION}</h2>
    <div class="notes changes">${news.map(c => `<h3>${esc(c.v)}: ${esc(c.title)}</h3>${c.html}`).join('')}</div>
    <p class="hint">Tutte le novità precedenti sono nella Guida.</p>
    <div class="modal-actions"><a class="btn ghost" href="#/guide" data-x>Apri la Guida</a><button class="btn primary" type="button" data-x>Ho capito</button></div>`, { label: 'Novità' });
  $$('[data-x]', sh.el).forEach(b => b.addEventListener('click', () => sh.close()));
}

/* =====================================================================
   v3.38: Affianca — una sezione o un PDF in un pannello di fianco
   Di fianco anche sul tablet in verticale (da 700 px), sotto sul telefono.
   Il pannello mostra in sola lettura; “Apri qui” lo porta nella pagina principale.
   ===================================================================== */
// il documento del lettore PDF aperto, che Affianca può riusare
const PdfShared = { id: '', doc: null };
const Split = {
  KEY: 'nb-split',
  el: null,
  item: null,          // { kind: 'sec' | 'pdf', id, page? }
  pdf: null,           // documento aperto nel pannello
  zoom: 1,
  io: null,
  rendered: new Map(),
  prefs() { let p = {}; try { p = JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch { p = {}; } return { w: 0.5, h: 0.5, ...p }; },
  setPrefs(ch) { const p = { ...this.prefs(), ...ch }; try { localStorage.setItem(this.KEY, JSON.stringify(p)); } catch { /* niente */ } return p; },
  side: () => matchMedia('(min-width: 700px)').matches,
  isOpen() { return document.body.classList.contains('split-open'); },
  leftW() { return window.innerWidth >= 900 && !document.body.classList.contains('nav-hidden') ? 232 : 0; },
  maxW() { return Math.max(300, window.innerWidth - this.leftW() - 300); },
  maxH() { return Math.max(220, window.innerHeight - 96 - 60); },
  curW() { const p = this.prefs(); const free = window.innerWidth - this.leftW(); return Math.round(Math.min(this.maxW(), Math.max(300, (+p.w || 0.5) * free))); },
  curH() { const p = this.prefs(); return Math.round(Math.min(this.maxH(), Math.max(200, (+p.h || 0.5) * this.maxH()))); },
  apply({ w, hPx } = {}) {
    const ww = w === undefined ? this.curW() : Math.round(Math.min(this.maxW(), Math.max(300, w)));
    const hh = hPx === undefined ? this.curH() : Math.round(Math.min(this.maxH(), Math.max(200, hPx)));
    document.documentElement.style.setProperty('--split-w', `${ww}px`);
    document.documentElement.style.setProperty('--split-h', `${hh}px`);
    this._w = ww; this._h = hh;
  },
  savePos() {
    if (this.side()) this.setPrefs({ w: +(this._w / (window.innerWidth - this.leftW())).toFixed(3) });
    else this.setPrefs({ h: +(this._h / this.maxH()).toFixed(3) });
  },
  build() {
    if (this.el) return;
    const el = document.createElement('aside');
    el.className = 'split-dock';
    el.setAttribute('aria-label', 'Pannello affiancato');
    el.hidden = true;
    el.innerHTML = `
      <div class="sh-grip split-grip" role="separator" tabindex="0" aria-label="Trascina per cambiare la dimensione del pannello; anche con le frecce"></div>
      <header class="split-head">
        <div class="split-title"><small class="split-kind"></small><strong class="split-name"></strong></div>
        <div class="split-acts">
          <button type="button" class="btn sm ghost" data-sp="pick" title="Mostra un’altra sezione o un altro PDF">Cambia</button>
          <button type="button" class="btn sm ghost" data-sp="open" title="Apri nella pagina principale">Apri qui</button>
          <button type="button" class="sh-ic" data-sp="close" aria-label="Chiudi il pannello" title="Chiudi">${SH_ICONS.close}</button>
        </div>
        <div class="split-pdfbar" hidden>
          <button type="button" class="btn sm ghost" data-sp="prev" aria-label="Pagina precedente">‹</button>
          <label class="split-pg"><span class="sr-only">Pagina</span><input class="input" type="number" inputmode="numeric" min="1" data-sp-page><span class="split-tot"></span></label>
          <button type="button" class="btn sm ghost" data-sp="next" aria-label="Pagina successiva">›</button>
          <span class="split-zoom"><button type="button" class="btn sm ghost" data-sp="z-" aria-label="Riduci">−</button><button type="button" class="btn sm ghost" data-sp="z0" title="Adatta alla larghezza">100%</button><button type="button" class="btn sm ghost" data-sp="z+" aria-label="Ingrandisci">+</button></span>
          <select class="input split-bm" data-sp-bm aria-label="Vai a un segnalibro" hidden></select>
        </div>
      </header>
      <div class="split-body" tabindex="-1"></div>`;
    document.body.append(el);
    this.el = el;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-sp]');
      if (b) { this.act(b.dataset.sp); return; }
      const x = e.target.closest('a.xref');
      if (x) {
        const id = (x.getAttribute('href') || '').match(/#\/sec\/([^/]+)/)?.[1];
        if (id) { e.preventDefault(); this.show({ kind: 'sec', id }); }
      }
    });
    el.addEventListener('change', e => {
      if (e.target.matches('[data-sp-page]')) this.goPage(parseInt(e.target.value, 10) || 1);
      if (e.target.matches('[data-sp-bm]') && e.target.value) { this.goPage(+e.target.value); e.target.value = ''; }
    });
    this.bindGrip($('.split-grip', el));
    const body = $('.split-body', el);
    body.addEventListener('scroll', () => this.trackPage(), { passive: true });
    // due dita per lo zoom del PDF
    let pinch = null;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    body.addEventListener('touchstart', e => { if (this.item?.kind === 'pdf' && e.touches.length === 2) pinch = { d: dist(e.touches[0], e.touches[1]), z: this.zoom }; }, { passive: true });
    body.addEventListener('touchmove', e => { if (pinch && e.touches.length === 2) { e.preventDefault(); this.preview(pinch.z * dist(e.touches[0], e.touches[1]) / pinch.d); } }, { passive: false });
    body.addEventListener('touchend', () => { if (pinch) { pinch = null; this.setZoom(this.pending || this.zoom); } });
    body.addEventListener('wheel', e => { if (this.item?.kind === 'pdf' && e.ctrlKey) { e.preventDefault(); this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.01)); } }, { passive: false });
    new ResizeObserver(() => { if (this.isOpen() && this.item?.kind === 'pdf') this.layoutPdf(); }).observe(body);
  },
  bindGrip(grip) {
    let d = null;
    grip.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      e.preventDefault();
      try { grip.setPointerCapture(e.pointerId); } catch { /* niente */ }
      d = { id: e.pointerId, x: e.clientX, y: e.clientY, w: this.curW(), h: this.curH() };
      this.el.classList.add('resizing');
    });
    grip.addEventListener('pointermove', e => {
      if (!d || e.pointerId !== d.id) return;
      if (this.side()) this.apply({ w: d.w - (e.clientX - d.x) }); else this.apply({ hPx: d.h - (e.clientY - d.y) });
    });
    const end = e => { if (!d || e.pointerId !== d.id) return; d = null; this.el.classList.remove('resizing'); this.savePos(); window.dispatchEvent(new Event('resize')); };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('keydown', e => {
      const dir = { ArrowLeft: 1, ArrowRight: -1, ArrowUp: 1, ArrowDown: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      if (this.side()) this.apply({ w: this.curW() + dir * 40 }); else this.apply({ hPx: this.curH() + dir * 40 });
      this.savePos();
    });
  },
  async show(item) {
    this.build();
    if (typeof Pad !== 'undefined' && Pad.isOpen()) Pad.close();
    if (ShDock.isOpen()) ShDock.close();
    this.el.hidden = false;
    const was = this.isOpen();
    document.body.classList.add('split-open');
    this.apply();
    if (!was) setTimeout(() => window.dispatchEvent(new Event('resize')), 30);
    this.item = item;
    this.setPrefs({ last: item });
    const body = $('.split-body', this.el);
    if (this.io) { this.io.disconnect(); this.io = null; }
    this.rendered.clear();
    $('.split-pdfbar', this.el).hidden = item.kind !== 'pdf';
    if (item.kind === 'map') {
      // la scheda Mappe di una sezione, intera: crei, modifichi e scarichi l’XMind mentre leggi
      const sec = secById(item.id);
      if (!sec) { this.close(); toast('Questa sezione non c’è più'); return; }
      this.dropDoc();
      $('.split-kind', this.el).textContent = `Mappe · ${[nbById(sec.notebookId)?.name, groupPathText(sec)].filter(Boolean).join(' › ')}`;
      $('.split-name', this.el).textContent = sec.title;
      body.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'mode-body split-map';
      body.append(box);
      modeMap(sec, box);
      body.scrollTop = 0;
      return;
    }
    if (item.kind === 'sec') {
      const sec = secById(item.id);
      if (!sec) { this.close(); toast('Questa sezione non c’è più'); return; }
      this.dropDoc();
      $('.split-kind', this.el).textContent = [nbById(sec.notebookId)?.name, groupPathText(sec)].filter(Boolean).join(' › ') || 'Sezione';
      $('.split-name', this.el).textContent = sec.title;
      body.innerHTML = sec.md.trim() ? `<article class="notes split-notes">${renderMd(sec.md)}</article>` : '<p class="hint">Questa sezione è ancora vuota.</p>';
      const art = $('.split-notes', body);
      if (art) setupFolds(art, sec.id);
      body.scrollTop = 0;
      return;
    }
    const meta = pdfById(item.id);
    if (!meta) { this.close(); toast('Questo PDF non c’è più'); return; }
    $('.split-kind', this.el).textContent = 'PDF';
    $('.split-name', this.el).textContent = meta.name;
    body.innerHTML = '<p class="hint split-wait">Apro il PDF…</p>';
    try {
      this.dropDoc();
      let pdf;
      // se lo stesso PDF è già aperto nel lettore, uso quello: niente seconda copia in memoria
      if (PdfShared.id === meta.id && PdfShared.doc) pdf = { doc: PdfShared.doc, pages: PdfShared.doc.numPages, shared: true };
      else {
        const rec = await DB.run('pdfblobs', 'readonly', tx => tx.objectStore('pdfblobs').get(meta.id));
        if (!rec || !rec.blob) throw new Error('Questo PDF non è ancora su questo dispositivo: aprilo una volta dalla libreria PDF per scaricarlo.');
        await ensurePdfJs();
        const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await rec.blob.arrayBuffer()) }).promise;
        pdf = { doc, pages: doc.numPages, shared: false };
      }
      if (this.item !== item) { if (!pdf.shared) pdf.doc.destroy(); return; }
      this.pdf = pdf;
      const first = await pdf.doc.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      this.ratio = vp.height / vp.width;
      this.zoom = 1;
      $('.split-tot', this.el).textContent = `/ ${pdf.pages}`;
      $('[data-sp-page]', this.el).max = pdf.pages;
      const bms = (meta.bookmarks || []).slice().sort((a, b) => a.page - b.page);
      const sel = $('[data-sp-bm]', this.el);
      sel.hidden = !bms.length;
      sel.innerHTML = `<option value="">Segnalibri…</option>${bms.map(b => `<option value="${b.page}">p. ${b.page} · ${esc(b.title)}</option>`).join('')}`;
      body.innerHTML = `<div class="split-pages">${Array.from({ length: pdf.pages }, (_, i) => `<div class="split-page" data-p="${i + 1}"><canvas></canvas><span class="split-pn">${i + 1}</span></div>`).join('')}</div>`;
      this.layoutPdf();
      this.io = new IntersectionObserver(ens => ens.forEach(en => { if (en.isIntersecting) this.queue(+en.target.dataset.p); }), { root: body, rootMargin: '300px 0px' });
      $$('.split-page', body).forEach(p => this.io.observe(p));
      this.goPage(item.page || meta.lastPage || 1, true);
    } catch (err) {
      body.innerHTML = `<div class="empty"><p>${esc(err.message || 'Non riesco ad aprire il PDF.')}</p></div>`;
    }
  },
  // il PDF aperto solo per il pannello si chiude davvero, così la memoria si libera
  dropDoc() {
    const p = this.pdf;
    this.pdf = null;
    this.waitQ = [];
    if (p && !p.shared) { try { p.doc.destroy(); } catch { /* già chiuso */ } }
  },
  layoutPdf() {
    if (!this.pdf || !this.el) return;
    const body = $('.split-body', this.el);
    const w = Math.max(200, (body.clientWidth - 24) * this.zoom);
    $$('.split-page', body).forEach(p => { p.style.width = `${w}px`; p.style.height = `${Math.round(w * this.ratio)}px`; });
    $('[data-sp="z0"]', this.el).textContent = `${Math.round(this.zoom * 100)}%`;
    // mentre trascini il bordo non ridisegno a ogni passo: aspetto che ti fermi
    clearTimeout(this.relayT);
    this.relayT = setTimeout(() => {
      this.rendered.forEach((v, n) => { if (v !== w) { this.rendered.delete(n); const el = $(`.split-page[data-p="${n}"]`, body); if (el && this.visible(el)) this.queue(n); } });
    }, 250);
  },
  visible(el) { const b = $('.split-body', this.el).getBoundingClientRect(); const r = el.getBoundingClientRect(); return r.bottom > b.top - 300 && r.top < b.bottom + 300; },
  // una pagina alla volta: con PDF pesanti disegnarne tante insieme bloccava il tablet
  waitQ: [],
  qBusy: false,
  queue(n) {
    if (!this.waitQ.includes(n)) this.waitQ.push(n);
    this.pump();
  },
  async pump() {
    if (this.qBusy) return;
    this.qBusy = true;
    try {
      while (this.waitQ.length && this.pdf) {
        // prima le pagine più vicine a quella che stai guardando
        const cur = this.curPage || 1;
        this.waitQ.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
        const n = this.waitQ.shift();
        const el = $(`.split-page[data-p="${n}"]`, this.el);
        if (el && this.visible(el)) await this.renderPage(n);
      }
    } finally { this.qBusy = false; }
  },
  async renderPage(n) {
    if (!this.pdf) return;
    const el = $(`.split-page[data-p="${n}"]`, this.el);
    if (!el) return;
    const w = parseFloat(el.style.width);
    if (this.rendered.get(n) === w) return;
    this.rendered.set(n, w);
    try {
      const pdf = this.pdf;
      const page = await pdf.doc.getPage(n);
      if (pdf !== this.pdf) return;
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = page.getViewport({ scale: (w * dpr) / base.width });
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width);
      cv.height = Math.round(vp.height);
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      if (this.rendered.get(n) !== w) return;
      $('canvas', el).replaceWith(cv);
      // tengo in memoria solo le pagine vicine
      if (this.rendered.size > 6) {
        const cur = this.curPage || n;
        [...this.rendered.keys()].filter(k => Math.abs(k - cur) > 3).forEach(k => {
          this.rendered.delete(k);
          const c = $(`.split-page[data-p="${k}"] canvas`, this.el);
          if (c) c.replaceWith(document.createElement('canvas'));
        });
      }
    } catch { this.rendered.delete(n); }
  },
  goPage(n, instant = false) {
    if (!this.pdf) return;
    n = Math.max(1, Math.min(this.pdf.pages, n));
    const el = $(`.split-page[data-p="${n}"]`, this.el);
    const body = $('.split-body', this.el);
    if (el) body.scrollTo({ top: el.offsetTop - 8, behavior: instant ? 'auto' : 'smooth' });
    this.curPage = n;
    $('[data-sp-page]', this.el).value = n;
  },
  trackPage() {
    if (!this.pdf) return;
    const body = $('.split-body', this.el);
    const mid = body.scrollTop + body.clientHeight / 3;
    const pages = $$('.split-page', body);
    let n = 1;
    for (const p of pages) { if (p.offsetTop <= mid) n = +p.dataset.p; else break; }
    if (n !== this.curPage) { this.curPage = n; $('[data-sp-page]', this.el).value = n; this.setPrefs({ last: { ...this.item, page: n } }); }
  },
  preview(z) {
    this.pending = Math.max(0.6, Math.min(3, z));
    $('.split-pages', this.el)?.style.setProperty('transform', `scale(${this.pending / this.zoom})`);
  },
  setZoom(z) {
    const keep = this.curPage || 1;
    this.zoom = Math.max(0.6, Math.min(3, z));
    this.pending = null;
    $('.split-pages', this.el)?.style.removeProperty('transform');
    this.layoutPdf();
    this.goPage(keep, true);
  },
  act(a) {
    if (a === 'close') this.close();
    else if (a === 'pick') this.pick();
    else if (a === 'open') {
      const it = this.item;
      if (!it) return;
      this.close();
      go(it.kind === 'sec' ? `#/sec/${it.id}/read` : it.kind === 'map' ? `#/sec/${it.id}/map` : `#/pdf/${it.id}/${this.curPage || it.page || 1}`);
    } else if (a === 'prev') this.goPage((this.curPage || 1) - 1);
    else if (a === 'next') this.goPage((this.curPage || 1) + 1);
    else if (a === 'z+') this.setZoom(this.zoom * 1.25);
    else if (a === 'z-') this.setZoom(this.zoom / 1.25);
    else if (a === 'z0') this.setZoom(1);
  },
  close() {
    if (!this.el) return;
    this.el.hidden = true;
    document.body.classList.remove('split-open');
    if (this.io) { this.io.disconnect(); this.io = null; }
    this.dropDoc();
    this.rendered.clear();
    $('.split-body', this.el).innerHTML = '';
    setTimeout(() => window.dispatchEvent(new Event('resize')), 30);
  },
  // scegli cosa mettere di fianco: prima quello che è vicino alla pagina aperta
  pick() {
    return new Promise(resolve => {
      const m = location.hash.match(/^#\/(sec|pdf)\/([^/]+)/);
      const here = m && m[1] === 'sec' ? secById(m[2]) : m && m[1] === 'pdf' ? secById(pdfById(m[2])?.sectionId) : null;
      const hereNb = here ? here.notebookId : (m && m[1] === 'pdf' ? pdfById(m[2])?.notebookId : null);
      const pdfs = [
        ...(here ? [...pdfsOf(here.id), ...pdfRefsOf(here).map(r => pdfById(r.pdfId))] : []),
        ...state.pdfs.filter(p => p.notebookId === hereNb),
        ...state.pdfs
      ].filter((p, i, a) => p && a.indexOf(p) === i && !(m && m[1] === 'pdf' && p.id === m[2]));
      const refPage = id => { const r = here && pdfRefsOf(here).find(x => x.pdfId === id); return r ? r.from : 0; };
      const secs = [...state.sections].filter(s => !(m && m[1] === 'sec' && s.id === m[2]))
        .sort((a, b) => (b.notebookId === hereNb) - (a.notebookId === hereNb) || (b.updated || 0) - (a.updated || 0));
      const where = s => [nbById(s.notebookId)?.name, groupPathText(s)].filter(Boolean).join(' › ');
      let tab = here && pdfs.length ? 'pdf' : 'sec';
      const sh = openSheet(`
        <h2>Affianca</h2>
        <p class="sheet-sub">Si apre in un pannello di fianco, mentre qui resta quello che stai guardando.</p>
        <div class="seg" role="tablist" aria-label="Cosa affiancare">
          <button type="button" role="tab" data-spt="sec" aria-selected="${tab === 'sec'}">Sezione</button>
          <button type="button" role="tab" data-spt="pdf" aria-selected="${tab === 'pdf'}">PDF</button>
          <button type="button" role="tab" data-spt="map" aria-selected="${tab === 'map'}">Mappa</button>
        </div>
        <input type="search" class="input search" id="spQ" placeholder="Cerca" aria-label="Cerca">
        <ul class="list pick-list sp-list" id="spList"></ul>
        <div class="modal-actions"><button class="btn ghost" type="button" data-spx>Chiudi</button></div>`, { label: 'Affianca', onClose: v => resolve(v || null) });
      const list = $('#spList', sh.el);
      const draw = () => {
        const f = foldAccents($('#spQ', sh.el).value.trim());
        if (tab === 'map') {
          // prima la sezione che stai leggendo (o quella del PDF), poi quelle con mappe
          const cands = [...(here ? [here] : []), ...state.sections.filter(s => s !== here).sort((a, b) => mapsOf(b).length - mapsOf(a).length || (b.updated || 0) - (a.updated || 0))];
          const hits = cands.filter(s => !f || foldAccents(`${s.title} ${where(s)}`).includes(f)).slice(0, 60);
          list.innerHTML = hits.map(s => { const n = mapsOf(s).length; return `<li><button type="button" class="row" data-spi="map:${s.id}"><span class="row-main"><span class="row-title">${esc(s.title)}</span><span class="row-sub">${esc(where(s))} · ${n ? `${n} ${n === 1 ? 'mappa' : 'mappe'}` : 'nessuna mappa: la crei lì'}${s === here ? ' · quella che stai leggendo' : ''}</span></span></button></li>`; }).join('') || '<li class="hint">Nessuna sezione trovata.</li>';
          return;
        }
        if (tab === 'sec') {
          const hits = secs.filter(s => !f || foldAccents(`${s.title} ${where(s)}`).includes(f)).slice(0, 60);
          list.innerHTML = hits.map(s => `<li><button type="button" class="row" data-spi="sec:${s.id}"><span class="row-main"><span class="row-title">${esc(s.title)}</span><span class="row-sub">${esc(where(s))}</span></span></button></li>`).join('') || '<li class="hint">Nessuna sezione trovata.</li>';
        } else {
          const hits = pdfs.filter(p => !f || foldAccents(p.name).includes(f)).slice(0, 60);
          list.innerHTML = hits.map(p => `<li><button type="button" class="row" data-spi="pdf:${p.id}:${refPage(p.id)}"><span class="row-main"><span class="row-title">${esc(p.name)}</span><span class="row-sub">${p.pages || '?'} pagine${refPage(p.id) ? ` · pagine di questa sezione da ${refPage(p.id)}` : ''}${here && p.sectionId === here.id ? ' · di questa sezione' : ''}</span></span></button></li>`).join('') || '<li class="hint">Nessun PDF trovato.</li>';
        }
      };
      draw();
      $('#spQ', sh.el).addEventListener('input', draw);
      $$('[data-spt]', sh.el).forEach(t => t.addEventListener('click', () => { tab = t.dataset.spt; $$('[data-spt]', sh.el).forEach(x => x.setAttribute('aria-selected', String(x === t))); draw(); }));
      $('[data-spx]', sh.el).onclick = () => sh.close(null);
      list.addEventListener('click', e => {
        const b = e.target.closest('[data-spi]');
        if (!b) return;
        const [kind, id, pg] = b.dataset.spi.split(':');
        const it = { kind, id, page: +pg || 0 };
        sh.close(it);
        this.show(it);
      });
      setTimeout(() => $('#spQ', sh.el)?.focus(), 40);
    });
  },
  init() {
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href="#/split"], [data-split-open]');
      if (!a || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      if (a.dataset.splitOpen) { const [kind, id, pg] = a.dataset.splitOpen.split(':'); this.show({ kind, id, page: +pg || 0 }); return; }
      if (this.isOpen() && a.closest('.nav')) { this.close(); return; }
      this.pick();
    });
    window.addEventListener('resize', () => { if (this.isOpen()) this.apply(); });
  }
};

/* =====================================================================
   v3.32: barra laterale a scomparsa, blocco note a mano accanto a ogni
   funzione, “Riprendi” l’ultimo argomento studiato
   ===================================================================== */

/* ---------- Barra laterale a scomparsa (computer) ---------- */
const NavHide = {
  KEY: 'nb-nav-hidden',
  on() { try { return localStorage.getItem(this.KEY) === '1'; } catch { return false; } },
  set(v) {
    try { localStorage.setItem(this.KEY, v ? '1' : '0'); } catch { /* solo una preferenza */ }
    document.body.classList.toggle('nav-hidden', v);
    const b = $('#navShow');
    if (b) b.hidden = !v;
    $('#navHide')?.setAttribute('aria-expanded', String(!v));
  },
  init() {
    const brand = $('.nav .brand');
    if (brand && !$('#navHide')) brand.insertAdjacentHTML('beforeend', '<button type="button" class="nav-hide" id="navHide" aria-label="Nascondi la barra laterale" title="Nascondi la barra (Ctrl+B)" aria-expanded="true"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/><path d="m15.5 9.5-2.5 2.5 2.5 2.5"/></svg></button>');
    if (!$('#navShow')) document.body.insertAdjacentHTML('beforeend', '<button type="button" class="nav-show" id="navShow" aria-label="Mostra la barra laterale" title="Mostra la barra (Ctrl+B)" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>');
    $('#navHide').addEventListener('click', () => this.set(true));
    $('#navShow').addEventListener('click', () => this.set(false));
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'b' || e.key === 'B') && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) {
        e.preventDefault();
        this.set(!document.body.classList.contains('nav-hidden'));
      }
    });
    this.set(this.on());
  }
};

/* ---------- “Riprendi”: l’ultima sezione studiata, con la scheda e il punto ---------- */
const Resume = {
  KEY: 'nb-last-study',
  pendingY: null,
  get() { try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { return null; } },
  save(hash, y) {
    const m = String(hash || '').match(/^#\/sec\/([^/]+)(?:\/([^/]+))?/);
    if (!m) return;
    const sec = secById(m[1]);
    if (!sec || m[2] === 'edit') return;
    try { localStorage.setItem(this.KEY, JSON.stringify({ id: m[1], mode: m[2] || '', y: Math.round(y || 0), t: Date.now() })); } catch { /* niente */ }
  },
  target() {
    const r = this.get();
    const sec = r && secById(r.id);
    return sec ? { ...r, sec } : null;
  },
  go() {
    const r = this.target();
    if (!r) { toast('Non hai ancora studiato nessuna sezione su questo dispositivo'); return; }
    this.pendingY = r.y || 0;
    const h = `#/sec/${r.id}${r.mode ? `/${r.mode}` : ''}`;
    if (location.hash === h) route(); else go(h);
  },
  // da chiamare dopo che la sezione è stata disegnata
  restore() {
    if (this.pendingY === null) return;
    const y = this.pendingY;
    this.pendingY = null;
    let tries = 0;
    const step = () => { window.scrollTo(0, y); if (Math.abs(window.scrollY - y) > 4 && ++tries < 15) setTimeout(step, 80); };
    requestAnimationFrame(step);
  },
  label() {
    const r = this.target();
    return r ? r.sec.title : '';
  },
  refresh() {
    const a = $('#navResume');
    if (!a) return;
    const r = this.target();
    a.hidden = !r;
    if (r) { $('span', a).textContent = 'Riprendi'; a.title = `Torna a “${r.sec.title}”`; $('.nav-resume-t', a).textContent = r.sec.title; }
  },
  init() {
    const firstLink = $('.nav a[data-nav="notebooks"]');
    if (firstLink && !$('#navResume')) {
      firstLink.insertAdjacentHTML('beforebegin', `<a href="#/resume" id="navResume" class="nav-extra nav-resume" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/></svg>
        <span>Riprendi</span><small class="nav-resume-t"></small></a>`);
    }
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href="#/resume"]');
      if (!a || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      this.go();
    });
    // la posizione si salva anche quando l’app va in secondo piano o si chiude
    const flush = () => { if (/^#\/sec\//.test(location.hash)) this.save(location.hash, window.scrollY); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', flush);
    let t = 0;
    window.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(flush, 600); }, { passive: true });
    this.refresh();
  }
};

/* ---------- Blocco note a mano ----------
   Un pannello accanto a qualunque pagina (a destra sul computer, in basso sul
   telefono), largo o alto quanto vuoi. Un blocco per ogni sezione (uno per le
   altre pagine), con più pagine; resta su questo dispositivo. */
const PadDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('nb-pad', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('pads')) r.result.createObjectStore('pads'); };
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) { const db = await this.open(); return new Promise(res => { const q = db.transaction('pads').objectStore('pads').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); },
  async put(k, v) { const db = await this.open(); return new Promise(res => { const tx = db.transaction('pads', 'readwrite'); tx.objectStore('pads').put(v, k); tx.oncomplete = () => res(true); tx.onerror = () => res(false); }); },
  async del(k) { const db = await this.open(); return new Promise(res => { const tx = db.transaction('pads', 'readwrite'); tx.objectStore('pads').delete(k); tx.oncomplete = () => res(true); tx.onerror = () => res(false); }); }
};
const PAD_COLORS = [['ink', 'Inchiostro'], ['#2563eb', 'Blu'], ['#dc2626', 'Rosso'], ['#16a34a', 'Verde']];
const PAD_SIZES = [[0.0035, 'Sottile'], [0.006, 'Media'], [0.011, 'Spessa']];
// v3.56: sfondo del foglio (righe, quadretti o bianco) e foglio da esportare su carta bianca
function padPaper(c, W, H, kind, color, alpha) {
  if (kind === 'plain') return;
  c.save();
  c.strokeStyle = color;
  c.globalAlpha = alpha;
  c.lineWidth = 1;
  const step = Math.max(26, W * 0.06);
  const sq = kind === 'grid' ? step * 0.6 : step;
  for (let y = sq; y < H; y += sq) { c.beginPath(); c.moveTo(0, Math.round(y) + 0.5); c.lineTo(W, Math.round(y) + 0.5); c.stroke(); }
  if (kind === 'grid') for (let x = sq; x < W; x += sq) { c.beginPath(); c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, H); c.stroke(); }
  c.restore();
}
function padExportCanvas(pg, bg, W = 1240) {
  const H = Math.max(Math.round(W * 1.414), Math.round((pg.h || 1.6) * W), ...pg.strokes.flatMap(s => s.p.map(q => Math.round(q[1] * W + 40))));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, W, H);
  padPaper(c, W, H, bg, '#9aa6b8', 0.5);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  pg.strokes.forEach(s => {
    c.strokeStyle = c.fillStyle = s.c === 'ink' ? '#111' : s.c;
    const pts = s.p;
    if (pts.length === 1) { c.beginPath(); c.arc(pts[0][0] * W, pts[0][1] * W, Math.max(0.8, s.w * W * (pts[0][2] || 0.5)), 0, Math.PI * 2); c.fill(); return; }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      c.lineWidth = Math.max(0.8, s.w * W * (0.45 + ((a[2] + b[2]) / 2 || 0.5)));
      c.beginPath(); c.moveTo(a[0] * W, a[1] * W); c.lineTo(b[0] * W, b[1] * W); c.stroke();
    }
  });
  return cv;
}
const Pad = {
  KEY: 'nb-pad-prefs',
  el: null, canvas: null, ctx: null,
  key: '', title: '', data: null, page: 0,
  tool: 'pen', color: 'ink', size: 0.006, penOnly: false,
  undo: [], saveT: 0, drawing: null,
  prefs() { let p = {}; try { p = JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch { p = {}; } return { w: 420, h: 0.45, open: false, ...p }; },
  setPrefs(ch) { const p = { ...this.prefs(), ...ch }; try { localStorage.setItem(this.KEY, JSON.stringify(p)); } catch { /* niente */ } return p; },
  wide: () => matchMedia('(min-width: 900px)').matches,
  isOpen() { return document.body.classList.contains('pad-open'); },
  maxW() { return Math.max(300, Math.min(1100, window.innerWidth - (document.body.classList.contains('nav-hidden') ? 0 : 232) - 340)); },
  maxH() { return Math.max(220, window.innerHeight - 96 - 60); },
  curW(p = this.prefs()) { return Math.round(Math.min(this.maxW(), Math.max(280, +p.w || 420))); },
  curH(p = this.prefs()) { return Math.round(Math.min(this.maxH(), Math.max(160, (+p.h || 0.45) * this.maxH()))); },
  // di chi è il blocco: la sezione aperta, oppure la pagina
  context() {
    const m = location.hash.match(/^#\/sec\/([^/]+)/);
    const sec = m && secById(m[1]);
    if (sec) return { key: `sec:${sec.id}`, title: sec.title };
    const k = Nav.key(location.hash);
    const names = { notebooks: 'Notebook', review: 'Ripasso', cards: 'Flashcard', lab: 'Laboratorio', cases: 'Casi clinici', semei: 'Semeiotica', clinic: 'Note cliniche' };
    return { key: `page:${k.split('/')[0]}`, title: names[k.split('/')[0]] || 'Blocco note' };
  },
  build() {
    if (this.el) return;
    const el = document.createElement('aside');
    el.className = 'pad-dock';
    el.setAttribute('aria-label', 'Blocco note a mano');
    el.hidden = true;
    el.innerHTML = `
      <div class="sh-grip pad-grip" role="separator" tabindex="0" aria-label="Trascina per cambiare la dimensione del blocco note; anche con le frecce"></div>
      <header class="pad-head">
        <div class="pad-title"><strong>Blocco note</strong>${helpBtn('pad')}<span class="pad-ctx"></span></div>
        <div class="pad-tools" role="toolbar" aria-label="Strumenti">
          <button type="button" class="pad-b" data-pt="pen" aria-label="Penna" title="Penna"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/></svg></button>
          <button type="button" class="pad-b" data-pt="eraser" aria-label="Gomma" title="Gomma: tocca o passa sui tratti da togliere"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 20h12"/><path d="M5.5 15.5 14 7l5 5-7.5 7.5H9z"/></svg></button>
          <button type="button" class="pad-b" data-pt="lasso" aria-label="Lazo" title="Lazo: circonda i tratti per selezionarli, poi trascinali per spostarli (il cestino elimina la selezione)"><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="9" rx="8" ry="5.5" stroke-dasharray="3 2.5"/><path d="M7 13.5c-1 2 0 4 2 4.5 1.5.4 1.2 2.4-.5 2.5"/></svg></button>
          <button type="button" class="pad-b" data-pt="hand" aria-label="Scorri" title="Scorri il foglio con il dito"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v7.5a6.5 6.5 0 0 1-6.5 6.5h-.6a6 6 0 0 1-4.9-2.6l-2.7-3.9a1.5 1.5 0 0 1 2.4-1.8L8 15"/></svg></button>
          <span class="pad-sep"></span>
          ${PAD_COLORS.map(([c, l]) => `<button type="button" class="pad-c" data-pc="${c}" aria-label="${l}" title="${l}" style="--c:${c === 'ink' ? 'var(--text)' : c}"></button>`).join('')}
          <span class="pad-sep"></span>
          ${PAD_SIZES.map(([s, l], i) => `<button type="button" class="pad-b pad-s" data-ps="${s}" aria-label="Tratto ${l.toLowerCase()}" title="${l}"><i style="--d:${4 + i * 4}px"></i></button>`).join('')}
          <span class="pad-sep"></span>
          <button type="button" class="pad-b" data-pa="undo" aria-label="Annulla l’ultimo tratto" title="Annulla (Ctrl+Z)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg></button>
          <button type="button" class="pad-b" data-pa="clear" aria-label="Svuota la pagina" title="Svuota la pagina"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
          <button type="button" class="pad-b pad-pen" data-pa="penonly" aria-pressed="false" title="Solo penna: il dito e il palmo non scrivono">✍︎</button>
          <span class="pad-sep"></span>
          <button type="button" class="pad-b pad-bg" data-pa="bg" title="Sfondo: righe, quadretti o bianco" aria-label="Cambia lo sfondo"></button>
          <button type="button" class="pad-b" data-pa="save" aria-label="Salva come file" title="Salva come immagine o PDF, oppure mettilo nella sezione"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></button>
        </div>
        <div class="pad-pages">
          <button type="button" class="pad-b" data-pa="prev" aria-label="Pagina precedente">‹</button>
          <span class="pad-pn" aria-live="polite"></span>
          <button type="button" class="pad-b" data-pa="next" aria-label="Pagina successiva">›</button>
          <button type="button" class="pad-b" data-pa="add" aria-label="Nuova pagina" title="Nuova pagina">＋</button>
          <button type="button" class="sh-ic" data-pa="size"></button>
          <button type="button" class="sh-ic" data-pa="close" aria-label="Chiudi il blocco note" title="Chiudi">${SH_ICONS.close}</button>
        </div>
      </header>
      <div class="pad-body"><canvas class="pad-canvas" aria-label="Foglio per scrivere a mano"></canvas></div>`;
    document.body.append(el);
    this.el = el;
    this.canvas = $('canvas', el);
    this.ctx = this.canvas.getContext('2d');
    el.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.pt) { this.tool = b.dataset.pt; this.paintTools(); }
      else if (b.dataset.pc) { this.color = b.dataset.pc; this.tool = 'pen'; this.paintTools(); }
      else if (b.dataset.ps) { this.size = +b.dataset.ps; this.tool = 'pen'; this.paintTools(); }
      else if (b.dataset.pa) this.act(b.dataset.pa);
    });
    this.bindGrip($('.pad-grip', el));
    this.bindDraw();
    new ResizeObserver(() => { if (this.isOpen()) this.layout(); }).observe($('.pad-body', el));
    el.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); this.act('undo'); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel && this.sel.length && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) { e.preventDefault(); this.act('clear'); }
    });
  },
  paintTools() {
    if (!this.el) return;
    $$('[data-pt]', this.el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pt === this.tool)));
    $$('[data-pc]', this.el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pc === this.color)));
    $$('[data-ps]', this.el).forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.ps === this.size)));
    $('[data-pa="penonly"]', this.el).setAttribute('aria-pressed', String(this.penOnly));
    this.canvas.style.touchAction = 'none';
    this.canvas.style.cursor = this.tool === 'hand' ? 'grab' : this.tool === 'eraser' ? 'cell' : this.tool === 'lasso' ? 'default' : 'crosshair';
    if (this.tool !== 'lasso' && this.sel) { this.sel = null; this.selBox = null; this.redraw(); }
    this.setPrefs({ tool: this.tool === 'hand' ? 'pen' : this.tool, color: this.color, size: this.size, penOnly: this.penOnly });
  },
  bindGrip(grip) {
    let d = null;
    grip.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      e.preventDefault();
      try { grip.setPointerCapture(e.pointerId); } catch { /* niente */ }
      d = { id: e.pointerId, x: e.clientX, y: e.clientY, w: this.curW(), h: this.curH() };
      this.el.classList.add('resizing');
    });
    grip.addEventListener('pointermove', e => {
      if (!d || e.pointerId !== d.id) return;
      if (this.wide()) this.apply({ w: d.w - (e.clientX - d.x) }); else this.apply({ hPx: d.h - (e.clientY - d.y) });
    });
    const end = e => { if (!d || e.pointerId !== d.id) return; d = null; this.el.classList.remove('resizing'); this.savePos(); };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('keydown', e => {
      const dir = { ArrowLeft: 1, ArrowRight: -1, ArrowUp: 1, ArrowDown: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      if (this.wide()) this.apply({ w: this.curW() + dir * 32 }); else this.apply({ hPx: this.curH() + dir * 40 });
      this.savePos();
    });
  },
  apply({ w, hPx } = {}) {
    const ww = w === undefined ? this.curW() : Math.round(Math.min(this.maxW(), Math.max(280, w)));
    const hh = hPx === undefined ? this.curH() : Math.round(Math.min(this.maxH(), Math.max(160, hPx)));
    document.documentElement.style.setProperty('--pad-w', `${ww}px`);
    document.documentElement.style.setProperty('--pad-h', `${hh}px`);
    this._w = ww; this._h = hh;
    if (this.el) {
      const big = this.wide() ? ww >= this.maxW() - 4 : hh >= this.maxH() - 4;
      const b = $('[data-pa="size"]', this.el);
      b.innerHTML = big ? SH_ICONS.small : SH_ICONS.size;
      b.setAttribute('aria-label', big ? 'Rimpicciolisci il blocco note' : 'Ingrandisci il blocco note');
      b.title = big ? 'Più piccolo' : 'Più grande';
    }
  },
  savePos() { if (this.wide()) this.setPrefs({ w: this._w }); else this.setPrefs({ h: +(this._h / this.maxH()).toFixed(3) }); },
  async open() {
    this.build();
    if (ShDock.isOpen()) ShDock.close();
    if (typeof Split !== 'undefined' && Split.isOpen()) Split.close();
    const p = this.prefs();
    this.tool = p.tool || 'pen'; this.color = p.color || 'ink'; this.size = +p.size || 0.006; this.penOnly = !!p.penOnly;
    this.el.hidden = false;
    document.body.classList.add('pad-open');
    this.apply();
    this.paintTools();
    this.setPrefs({ open: true });
    await this.load();
    this.refreshBtn();
  },
  close() {
    if (!this.el) return;
    this.flush();
    this.el.hidden = true;
    document.body.classList.remove('pad-open');
    this.setPrefs({ open: false });
    this.refreshBtn();
  },
  toggle() { if (this.isOpen()) this.close(); else this.open(); },
  refreshBtn() {
    const f = $('#padFab');
    if (f) { f.hidden = this.isOpen(); }
    $$('a[href="#/pad"]').forEach(a => a.classList.toggle('sh-on', this.isOpen()));
  },
  // cambia foglio quando cambi sezione o pagina
  async load() {
    const ctx = this.context();
    if (this.data && ctx.key === this.key) { this.layout(); return; }
    this.flush();
    this.key = ctx.key;
    this.title = ctx.title;
    const d = await PadDB.get(this.key);
    if (this.key !== ctx.key) return;
    this.data = d && Array.isArray(d.pages) && d.pages.length ? d : { pages: [{ strokes: [], h: 1.6 }], t: Date.now() };
    this.page = Math.min(this.data.page || 0, this.data.pages.length - 1);
    this.undo = [];
    $('.pad-ctx', this.el).textContent = this.title;
    this.sel = null;
    this.selBox = null;
    this.paintBg();
    this.layout();
    $('.pad-body', this.el).scrollTop = 0;
  },
  flush() {
    if (!this.saveT || !this.key || !this.data) return;
    clearTimeout(this.saveT);
    this.saveT = 0;
    const empty = this.data.pages.every(pg => !pg.strokes.length);
    if (empty) PadDB.del(this.key); else PadDB.put(this.key, { ...this.data, page: this.page, title: this.title, t: Date.now() });
  },
  saveSoon() { clearTimeout(this.saveT); this.saveT = setTimeout(() => { this.saveT = 1; this.flush(); }, 500); },
  pg() { return this.data.pages[this.page]; },
  layout() {
    if (!this.el || !this.data) return;
    const body = $('.pad-body', this.el);
    const w = body.clientWidth;
    if (!w) return;
    const pg = this.pg();
    const minH = body.clientHeight;
    const h = Math.max(minH, Math.round((pg.h || 1.6) * w));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.W = w; this.H = h;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
    $('.pad-pn', this.el).textContent = `${this.page + 1} / ${this.data.pages.length}`;
    $('[data-pa="prev"]', this.el).disabled = this.page === 0;
    $('[data-pa="next"]', this.el).disabled = this.page >= this.data.pages.length - 1;
  },
  inkColor(c) { return c === 'ink' ? getComputedStyle(document.body).getPropertyValue('--text').trim() || '#111' : c; },
  redraw() {
    const c = this.ctx;
    c.clearRect(0, 0, this.W, this.H);
    padPaper(c, this.W, this.H, this.bg(), getComputedStyle(document.body).getPropertyValue('--line').trim() || '#ccc', 0.45);
    this.pg().strokes.forEach(s => this.drawStroke(s));
    this.drawSel();
  },
  bg() { return (this.data && this.data.bg) || this.prefs().bg || 'lines'; },
  paintBg() {
    const b = this.el && $('[data-pa="bg"]', this.el);
    if (!b) return;
    const k = this.bg();
    b.innerHTML = k === 'grid' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/></svg>' : k === 'plain' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16"/></svg>';
    b.title = `Sfondo: ${k === 'grid' ? 'quadretti' : k === 'plain' ? 'bianco' : 'righe'} (tocca per cambiare)`;
  },
  // selezione del lazo: riquadro tratteggiato attorno ai tratti scelti
  drawSel() {
    const sel = this.sel;
    if (!sel || !sel.length) return;
    const W = this.W;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    sel.forEach(s => s.p.forEach(q => { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }));
    const pad = 8;
    this.selBox = [x0 * W - pad, y0 * W - pad, (x1 - x0) * W + pad * 2, (y1 - y0) * W + pad * 2];
    const c = this.ctx;
    c.save();
    c.setLineDash([6, 4]);
    c.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#7dd3fc';
    c.lineWidth = 1.5;
    c.strokeRect(...this.selBox);
    c.restore();
  },
  drawStroke(s, from = 1) {
    const c = this.ctx, W = this.W, pts = s.p;
    c.strokeStyle = this.inkColor(s.c);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (pts.length === 1) {
      c.fillStyle = c.strokeStyle;
      c.beginPath(); c.arc(pts[0][0] * W, pts[0][1] * W, Math.max(0.8, s.w * W * (pts[0][2] || 0.5)), 0, Math.PI * 2); c.fill();
      return;
    }
    for (let i = Math.max(1, from); i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      c.lineWidth = Math.max(0.8, s.w * W * (0.45 + ((a[2] + b[2]) / 2 || 0.5)));
      c.beginPath(); c.moveTo(a[0] * W, a[1] * W); c.lineTo(b[0] * W, b[1] * W); c.stroke();
    }
  },
  bindDraw() {
    const cv = this.canvas;
    const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / this.W, (e.clientY - r.top) / this.W, e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5]; };
    const erase = pt => {
      const pg = this.pg();
      const rad = 12 / this.W;
      const before = pg.strokes.length;
      const keep = pg.strokes.filter(s => !s.p.some(q => Math.hypot(q[0] - pt[0], q[1] - pt[1]) < rad + s.w));
      if (keep.length !== before) {
        this.undo.push({ type: 'erase', page: this.page, strokes: pg.strokes });
        pg.strokes = keep;
        this.redraw();
        this.saveSoon();
      }
    };
    const body = () => $('.pad-body', this.el);
    cv.addEventListener('pointerdown', e => {
      if (e.button > 0 && !penErases(e)) return;
      if (e.pointerType === 'pen') this.penSeen = true;
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch { /* niente */ }
      // con la mano, o con le dita quando scrivi con la penna, il foglio scorre
      if (this.tool === 'hand' || ((this.penOnly || this.penSeen) && e.pointerType === 'touch')) {
        this.drawing = { id: e.pointerId, pan: true, y0: e.clientY, st: body().scrollTop };
        return;
      }
      const pt = pos(e);
      if (this.tool === 'eraser' || penErases(e)) { this.drawing = { id: e.pointerId, erase: true }; erase(pt); return; }
      if (this.tool === 'lasso') {
        const px = pt[0] * this.W, py = pt[1] * this.W;
        const b = this.selBox;
        // dentro la selezione: la sposto; fuori: nuovo lazo
        if (this.sel && this.sel.length && b && px >= b[0] && px <= b[0] + b[2] && py >= b[1] && py <= b[1] + b[3]) {
          const pg = this.pg();
          this.undo.push({ type: 'clear', page: this.page, strokes: pg.strokes.map(s => ({ ...s, p: s.p.map(q => q.slice()) })), keepSel: true });
          this.drawing = { id: e.pointerId, move: true, last: pt };
        } else {
          this.sel = null;
          this.selBox = null;
          this.drawing = { id: e.pointerId, lasso: [pt] };
          this.redraw();
        }
        return;
      }
      this.sel = null;
      this.selBox = null;
      const s = { c: this.color, w: this.size, p: [pt.map(v => +v.toFixed(4))] };
      this.drawing = { id: e.pointerId, s };
      this.pg().strokes.push(s);
      this.drawStroke(s);
    });
    cv.addEventListener('pointermove', e => {
      const d = this.drawing;
      if (!d || e.pointerId !== d.id) return;
      e.preventDefault();
      if (d.pan) { body().scrollTop = d.st - (e.clientY - d.y0); return; }
      if (d.move) {
        const pt = pos(e);
        const dx = pt[0] - d.last[0], dy = pt[1] - d.last[1];
        d.last = pt;
        this.sel.forEach(s => s.p.forEach(q => { q[0] = +(q[0] + dx).toFixed(4); q[1] = +(q[1] + dy).toFixed(4); }));
        this.redraw();
        return;
      }
      if (d.lasso) {
        const pt = pos(e);
        d.lasso.push(pt);
        const c = this.ctx, W = this.W;
        c.save();
        c.setLineDash([5, 4]);
        c.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#7dd3fc';
        c.lineWidth = 1.5;
        const a = d.lasso[d.lasso.length - 2];
        c.beginPath(); c.moveTo(a[0] * W, a[1] * W); c.lineTo(pt[0] * W, pt[1] * W); c.stroke();
        c.restore();
        return;
      }
      const evs = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
      for (const ev of evs) {
        const pt = pos(ev);
        if (d.erase) { erase(pt); continue; }
        const last = d.s.p[d.s.p.length - 1];
        if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) * this.W < 1.2) continue;
        d.s.p.push(pt.map(v => +v.toFixed(4)));
        this.drawStroke(d.s, d.s.p.length - 1);
      }
      // scrivendo in fondo il foglio si allunga
      const pg = this.pg();
      const lastY = d.s ? d.s.p[d.s.p.length - 1][1] * this.W : 0;
      if (d.s && lastY > this.H - 60) { pg.h = (this.H + this.W * 0.5) / this.W; this.layout(); }
    });
    const inPoly = (x, y, poly) => { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside; } return inside; };
    const end = e => {
      const d = this.drawing;
      if (!d || e.pointerId !== d.id) return;
      this.drawing = null;
      if (d.s) { this.undo.push({ type: 'add', page: this.page, s: d.s }); this.saveSoon(); }
      if (d.move) { this.saveSoon(); this.redraw(); }
      if (d.lasso) {
        // presi i tratti che stanno per almeno metà dentro il lazo
        const poly = d.lasso;
        const sel = poly.length > 2 ? this.pg().strokes.filter(s => s.p.filter(q => inPoly(q[0], q[1], poly)).length >= Math.max(1, s.p.length / 2)) : [];
        this.sel = sel.length ? sel : null;
        this.redraw();
        if (sel.length) toast(`${sel.length} ${sel.length === 1 ? 'tratto selezionato' : 'tratti selezionati'}: trascinali per spostarli, il cestino li elimina`);
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('contextmenu', e => e.preventDefault());
    twoFingerTap(cv, () => this.act('undo'), () => this.penOnly || this.penSeen || this.tool === 'hand');
  },
  async act(a) {
    if (!this.data) return;
    if (a === 'close') this.close();
    else if (a === 'size') {
      if (this.wide()) this.apply({ w: this.curW() >= this.maxW() - 4 ? 380 : this.maxW() });
      else this.apply({ hPx: this.curH() >= this.maxH() - 4 ? this.maxH() * 0.45 : this.maxH() });
      this.savePos();
    } else if (a === 'penonly') {
      this.penOnly = !this.penOnly;
      if (this.penOnly && this.tool === 'hand') this.tool = 'pen';
      this.paintTools();
      toast(this.penOnly ? 'Solo penna: scrive la penna, con le dita scorri il foglio' : 'Scrivono anche le dita');
    }
    else if (a === 'undo') {
      const u = this.undo.pop();
      if (!u) return;
      const pg = this.data.pages[u.page];
      if (u.type === 'add') pg.strokes = pg.strokes.filter(s => s !== u.s);
      else if (u.type === 'erase' || u.type === 'clear') pg.strokes = u.strokes;
      this.sel = null;
      this.selBox = null;
      if (u.page !== this.page) { this.page = u.page; this.layout(); } else this.redraw();
      this.saveSoon();
    } else if (a === 'clear' && this.sel && this.sel.length) {
      const pg = this.pg();
      const gone = new Set(this.sel);
      this.undo.push({ type: 'clear', page: this.page, strokes: pg.strokes });
      pg.strokes = pg.strokes.filter(s => !gone.has(s));
      this.sel = null;
      this.selBox = null;
      this.redraw();
      this.saveSoon();
      toast(`${gone.size} ${gone.size === 1 ? 'tratto eliminato' : 'tratti eliminati'}`, '', { label: 'Annulla', fn: () => this.act('undo') });
    } else if (a === 'bg') {
      const order = ['lines', 'grid', 'plain'];
      const next = order[(order.indexOf(this.bg()) + 1) % order.length];
      this.data.bg = next;
      this.setPrefs({ bg: next });
      this.paintBg();
      this.redraw();
      this.saveSoon();
      toast(`Sfondo: ${next === 'grid' ? 'quadretti' : next === 'plain' ? 'bianco' : 'righe'}`);
    } else if (a === 'save') {
      this.flush();
      const m = location.hash.match(/^#\/sec\/([^/]+)/);
      const sec = m && secById(m[1]);
      const ch = await actionSheet('Salva gli appunti a mano', [
        { key: 'png', label: 'Scarica questa pagina come immagine (PNG)' },
        { key: 'pdf', label: `Scarica ${this.data.pages.length > 1 ? `tutte le ${this.data.pages.length} pagine` : 'la pagina'} in un PDF` },
        ...(sec ? [{ key: 'sec', label: `Metti questa pagina nella sezione “${sec.title}”` }] : [])
      ]);
      if (!ch) return;
      const name = (this.title || 'Appunti a mano').replace(/[\\/:*?"<>|]+/g, ' ').trim();
      if (ch === 'png') {
        const cv = padExportCanvas(this.pg(), this.bg());
        cv.toBlob(b => downloadBlob(b, `${name} p${this.page + 1}.png`), 'image/png');
      }
      if (ch === 'pdf') {
        try {
          await ensurePdfLib();
          const doc = await window.PDFLib.PDFDocument.create();
          for (const pg of this.data.pages) {
            if (!pg.strokes.length && this.data.pages.length > 1) continue;
            const cv = padExportCanvas(pg, this.bg());
            const png = await doc.embedPng(await new Promise(r => cv.toBlob(b => b.arrayBuffer().then(r), 'image/png')));
            const W = 595, H = W * cv.height / cv.width;
            const page = doc.addPage([W, H]);
            page.drawImage(png, { x: 0, y: 0, width: W, height: H });
          }
          const bytes = await doc.save();
          downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${name}.pdf`);
        } catch (err) { toast(err.message || 'Non riesco a creare il PDF', 'err'); }
      }
      if (ch === 'sec' && sec) {
        const cv = padExportCanvas(this.pg(), this.bg());
        const im = await saveImage(await canvasToImage(cv, 0.92), sec.notebookId);
        await appendImagesUnder(sec, 'Appunti a mano', [imageMd(im.id, `Appunti a mano, ${new Date().toLocaleDateString('it-IT')}`)]);
        toast('Pagina aggiunta in fondo alla sezione, sotto “Appunti a mano”');
        if (/\/(read|edit)$/.test(location.hash)) route();
      }
    } else if (a === 'clear') {
      const pg = this.pg();
      if (!pg.strokes.length) return;
      this.undo.push({ type: 'clear', page: this.page, strokes: pg.strokes });
      pg.strokes = [];
      pg.h = 1.6;
      this.layout();
      this.saveSoon();
      toast('Pagina svuotata', '', { label: 'Annulla', fn: () => this.act('undo') });
    } else if (a === 'add') {
      this.data.pages.splice(this.page + 1, 0, { strokes: [], h: 1.6 });
      this.page++;
      this.layout();
      $('.pad-body', this.el).scrollTop = 0;
      this.saveSoon();
    } else if (a === 'prev' && this.page > 0) { this.page--; this.layout(); $('.pad-body', this.el).scrollTop = 0; this.saveSoon(); }
    else if (a === 'next' && this.page < this.data.pages.length - 1) { this.page++; this.layout(); $('.pad-body', this.el).scrollTop = 0; this.saveSoon(); }
  },
  init() {
    if (!$('#padFab')) document.body.insertAdjacentHTML('beforeend', '<button type="button" class="pad-fab" id="padFab" aria-label="Apri il blocco note per scrivere a mano" title="Blocco note a mano"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/><path d="M13 20h7"/></svg></button>');
    $('#padFab').addEventListener('click', () => this.open());
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href="#/pad"]');
      if (!a || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      this.toggle();
    });
    window.addEventListener('resize', () => { if (this.isOpen()) this.apply(); });
    window.addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush(); });
    if (this.prefs().open && this.wide()) this.open();
  },
  // da route(): cambia foglio se cambia la sezione o la pagina
  onRoute() { if (this.isOpen()) this.load(); }
};

/* =====================================================================
   v3.29: tutorial a passi al primo avvio e tasti “?” che spiegano ogni parte
   ===================================================================== */
const TUT_KEY = 'nb-tutorial-done';
const TUTORIAL = [
  { icon: '👋', title: 'Benvenuta nel Notebook', html: `Qui trasformi appunti, PDF e slide in materiale da <b>ripassare attivamente</b>: cloze, domande, flashcard, ripetizione a voce.<br><br>Ti bastano due minuti per il giro completo.` },
  { icon: '📲', title: 'Mettilo sulla schermata Home', html: `Così si apre come una vera app e i dati restano al sicuro.<br><br><b>Android:</b> Altro → Impostazioni → <b>Installa l’app</b>, oppure in Chrome menu <b>⋮</b> → <b>Installa app</b>.<br><b>iPhone:</b> in <b>Safari</b> tasto <b>Condividi</b> → <b>Aggiungi alla schermata Home</b>.` },
  { icon: '📒', title: '1. Notebook e argomenti', html: `Crea un <b>notebook</b> per ogni materia.<br><br>Dentro puoi dividerlo in <b>macro-argomenti</b> e <b>sottoargomenti</b>, fino a tre livelli; le <b>sezioni</b> sono i singoli argomenti che studi e ripassi.` },
  { icon: '📥', title: '2. Importa', html: `In <b>Importa</b> incolli un testo, carichi un PDF o una mappa XMind e l’app crea le sezioni.<br><br>Un PDF lo dividi ogni tot pagine, a intervalli scelti o <b>per argomenti</b>, leggendo i titoli. Con una chiave AI (Impostazioni) i testi vengono anche formattati, con cloze e domande.` },
  { icon: '🧠', title: '3. Studia una sezione', html: `In alto trovi le schede:<br><br><b>Cloze</b> nasconde i termini chiave · <b>Leggi</b> · <b>Mappe</b> · <b>Pagina bianca</b> e <b>Orale</b>: ripeti e confronta, segnando col semaforo · <b>Domande</b> · <b>Flashcard</b> · <b>Video</b> · <b>Modifica</b>.<br><br>Seleziona del testo in Leggi per evidenziarlo o farne un cloze o una flashcard.` },
  { icon: '🔁', title: '4. Ripassa', html: `Finita una sezione, scegli in fondo:<br><br><b>Segna come studiata in StudyHub</b>: i ripassi li pianifica StudyHub.<br><b>Ripassa nel Notebook</b>: li trovi nella scheda Ripasso.<br><br>Dopo ogni prova tocca <b>Di nuovo</b>, <b>Difficile</b>, <b>Bene</b> o <b>Facile</b>: l’app decide quando riproportela.` },
  { icon: '🩺', title: '5. Gli strumenti clinici', html: `In <b>Altro</b> (sul telefono) trovi le <b>Note cliniche</b> (i quadri clinici, cercabili per sintomo), i <b>Casi clinici</b> (con foto, PDF e la modalità Risolvi), la <b>Medicina di laboratorio</b> (esami, referti e calcoli), la <b>Semeiotica</b> e il <b>Glossario</b>. Sul computer li trovi nella barra a sinistra.<br><br>Sulle immagini puoi creare un’<b>image occlusion</b> o l’esercizio delle <b>etichette</b> da rimettere al posto giusto.` },
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
  cardsSet: { t: 'Flashcard', b: `<b>Nuove al giorno</b>: quante flashcard mai viste ti propone ogni giorno per ogni notebook, così il ripasso non esplode.<br><br>La <b>nota del “Di nuovo”</b> ti chiede perché hai sbagliato: ti aiuta a riconoscere gli errori che ripeti.<br><br><b>Intervalli</b>: partono come in Anki. I <b>passi di apprendimento</b> sono le ripetizioni dello stesso giorno per una carta nuova (1 e 10 minuti); dopo l’ultimo, “Bene” la manda al <b>primo intervallo</b> (1 giorno). “Facile” su una carta nuova salta i passi e la manda subito a 4 giorni: se ti sembra troppo, abbassalo a 2 o 3. Poi ogni intervallo si moltiplica per la <b>facilità</b> (250%: circa 2,5 volte), che scende quando sbagli o premi “Difficile” e sale con “Facile”.` },
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
  notebook: { t: 'Il notebook', b: `Il primo livello è fatto di <b>cartelle</b> (i macro-argomenti, per esempio un apparato o un capitolo): tocchi una cartella per entrarci. Dentro ci sono le <b>sezioni</b> (le pagine con gli appunti) e i <b>sottoargomenti</b>, fino a <b>tre livelli</b> (per esempio Cardiologia › Valvulopatie › Stenosi aortica). Con “Sposta dentro un altro argomento” riorganizzi i gruppi che hai già. Il menu “⋯” di un gruppo serve per aggiungere sezioni, crearne di nuove, importare lì o fare una simulazione d’esame.<br><br>Accanto a ogni sezione vedi a che punto sono i ripassi.` },
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
  lab: { t: 'Medicina di laboratorio', b: `Una scheda per ogni esame: campione e preparazione, range (anche diversi per uomini e donne), valori critici, cause di aumento e diminuzione, interferenze, andamento nel tempo, uso diagnostico con sensibilità e specificità (LR+ e LR− li calcola l’app), note, collegamenti alle note cliniche e fonti.<br><br>L’<b>elenco di base</b> crea le schede di oltre 110 esami già compilate da Claude, con range indicativi, cause e note: la fonte è Claude, quindi confrontale con il tuo libro e il tuo laboratorio. Ogni campo si può cambiare, e puoi creare categorie nuove.<br><br>Con una chiave AI, “Compila con l’AI” riempie i campi vuoti e segna l’esame come incompleto, da verificare.` },
  clinicQuiz: { t: 'Diagnosi differenziale', b: `<b>Dai sintomi alla diagnosi</b>: vedi alcuni sintomi presi da una tua nota clinica e scegli tra quattro diagnosi, scelte tra quelle con più sintomi in comune (o collegate in diagnosi differenziale), così non è troppo facile. Dopo la risposta, per ogni opzione vedi quali sintomi spiega e quali no.<br><br><b>Cosa entra in diagnosi differenziale</b>: per un quadro, scegli le malattie che entrano in DDx; vale per le note in cui le hai collegate (Modifica → Diagnosi differenziale).<br><br>Più note scrivi, con più sintomi, più l’esercizio somiglia al reparto.` },
  scores: { t: 'Score clinici', b: `Spunta i criteri o scegli i valori: il punteggio e la sua lettura si aggiornano subito. Sotto ogni score c’è la fonte (sono io, Claude, sulle linee guida citate). Servono per studiare e per capire come ragionano in reparto: le decisioni vere si prendono con il medico.` },
  micro: { t: 'Microbiologia', b: `Una scheda per microrganismo, con tipo (batterio, virus, fungo, parassita, prione) e un gruppo scelto da te. I titoli sono già pronti; le malattie infettive restano nelle note cliniche. Ogni scheda ha tutte le modalità di studio, foto con etichette e video. <b>Esercitati</b> ne apre una a caso in Orale.` },
  pharma: { t: 'Farmacologia', b: `Una scheda per farmaco con area, <b>classe</b> (per esempio Beta-bloccanti) e, se vuoi, il segno di <b>prototipo</b>. I titoli sono già pronti: meccanismo, farmacocinetica, indicazioni, effetti avversi, controindicazioni, interazioni, monitoraggio, gravidanza, sovradosaggio e antidoto.<br><br><b>Confronta</b> mette i farmaci di una classe (o quelli che scegli tu) in una tabella: una riga per titolo, una colonna per farmaco, con il testo preso dalle schede. Con <b>Ripassa</b> le celle si coprono e le scopri toccandole.` },
  anat: { t: 'Atlante di anatomia', b: `Le immagini di anatomia che usi di più: una scheda per tavola o struttura, con apparato e regione scelti da te. Carica l’immagine con <b>＋ Foto</b> e fanne l’esercizio delle etichette (rimetti i nomi al posto giusto) o l’image occlusion.<br><br><b>Tag</b>: li scrivi nei dati della scheda e li usi per filtrare l’elenco. <b>Collegamenti</b>: “Collega una sezione” la unisce agli appunti del notebook; nella sezione collegata, in fondo a Leggi, trovi l’immagine tra le “Pagine che rimandano qui”.` },
  atlas: { t: 'Atlante diagnostico', b: `ECG, emogas, Rx e altre immagini da imparare a leggere. Carica l’immagine con <b>＋ Foto</b>, poi fanne l’esercizio delle etichette o l’image occlusion. Per ECG, emogas e Rx i titoli seguono l’ordine di lettura (ritmo, asse, onde… / pH, disturbo primario, compenso…).` },
  diary: { t: 'Diario di tirocinio', b: `Una pagina per ogni giornata: data, reparto, tutor e le <b>procedure</b> (eseguite, assistite, osservate, quante volte). Scrivi casi e cose imparate sotto i titoli pronti. La scheda <b>Procedure</b> fa il totale, con i reparti e l’ultima volta.` },
  examq: { t: 'Domande d’esame', b: `La banca delle domande uscite agli esami. Ogni domanda ha materia, argomenti collegati, risposta o traccia, e le volte in cui è uscita (docente, anno, data, fonte): quando esce di nuovo si somma, così l’elenco “Le più frequenti” ti dice cosa chiedono di più.<br><br><b>Importa da Excel</b>: un foglio .xlsx (anche scaricato da Google Fogli) o un CSV, una domanda per riga. Scegli quali colonne sono domanda, risposta, materia, argomento, docente, anno, data, fonte e tag; “Scarica il modello” ti dà un foglio già pronto. Le domande uguali si sommano e gli argomenti si collegano da soli quando il titolo di una sezione compare nella domanda.<br><br><b>Allenati</b> sulle domande filtrate: le più frequenti, quelle di un docente o di un anno, quelle che sbagli. In ogni sezione, in fondo a Leggi, trovi le domande uscite su quell’argomento.` },
  split: { t: 'Affianca', b: `Apre di fianco una <b>sezione</b> o un <b>PDF</b>, mentre nella pagina principale resta quello che stai guardando: due sezioni, una sezione e le slide, due PDF, o un PDF accanto al lettore PDF.<br><br>Sul tablet e sul computer sta a destra (anche col tablet in verticale), sul telefono sotto. Trascina il bordo per dargli più o meno spazio.<br><br>Nel PDF: pagine ‹ ›, zoom (anche con due dita), salto ai segnalibri. <b>Cambia</b> mostra un’altra cosa, <b>Apri qui</b> la porta nella pagina principale.` },
  pad: { t: 'Blocco note', b: `Un foglio per scrivere a mano mentre ripeti, accanto a qualunque pagina: a destra sul computer, in basso sul telefono. Trascina il bordo per allargarlo o stringerlo.<br><br>Ogni sezione ha il suo blocco, con più pagine (＋); le altre pagine dell’app condividono un blocco per tipo. Resta su questo dispositivo.<br><br><b>Penna</b>, <b>gomma</b> (passa sui tratti da togliere), <b>mano</b> per scorrere, colori e spessori. Quando scrivi con la penna il palmo non lascia segni e con le dita scorri il foglio; <b>✍︎ Solo penna</b> lo attiva da subito.<br><br><b>Gomma della penna</b>: tieni premuto il pulsante laterale (S Pen) o gira la penna dalla parte della gomma (Staedtler Noris digital, Wacom, Surface). <b>Tocco con due dita</b>: annulla l’ultimo tratto (comodo con Apple Pencil, che non ha la gomma).` },
  semei: { t: 'Semeiotica', b: `Una scheda per ogni <b>manovra</b>, <b>segno</b> o <b>punto di repere</b>, divise tra semeiotica <b>clinica</b> e <b>chirurgica</b> e per distretto (che scegli tu, per esempio Addome o Torace).<br><br>Ogni scheda è una sezione: descrivi i passaggi, aggiungi foto con <b>＋ Foto</b> (poi puoi farne etichette da rimettere al posto giusto o un’image occlusion) e video nella scheda Video.<br><br><b>Esercitati</b> apre una scheda a caso tra quelle filtrate in modalità Orale: descrivi la manovra a voce e confronta.` },
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
  { sel: '.page-head h1', text: 'Semeiotica', key: 'semei' },
  { sel: '.page-head h1', text: 'Domande d’esame', key: 'examq' },
  { sel: '.page-head h1', text: 'Score clinici', key: 'scores' },
  { sel: '.page-head h1', text: 'Diagnosi differenziale', key: 'clinicQuiz' },
  { sel: '.page-head h1', text: 'Microbiologia', key: 'micro' },
  { sel: '.page-head h1', text: 'Atlante diagnostico', key: 'atlas' },
  { sel: '.page-head h1', text: 'Atlante di anatomia', key: 'anat' },
  { sel: '.page-head h1', text: 'Farmacologia', key: 'pharma' },
  { sel: '.page-head h1', text: 'Diario di tirocinio', key: 'diary' },
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
// v3.47: nomi confrontati senza maiuscole, accenti, punteggiatura e spazi doppi;
// se sono quasi uguali (stesse parole importanti) li considero la stessa materia
const shKey = x => foldAccents(String(x || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SH_STOP = new Set(['e', 'ed', 'di', 'del', 'della', 'dei', 'delle', 'degli', 'il', 'lo', 'la', 'i', 'gli', 'le', 'a', 'in', 'con', 'per', 'da', 'su']);
function shSimilar(a, b) {
  const A = shKey(a), B = shKey(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  // contano tutte le parole, numeri compresi (Fisiologia I e II restano diverse), tranne articoli e preposizioni
  const words = k => new Set(k.split(' ').filter(w => w && !SH_STOP.has(w)));
  const wa = words(A), wb = words(B);
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  wa.forEach(w => { if (wb.has(w)) inter++; });
  return inter / Math.max(wa.size, wb.size);
}
const shBest = (list, want, key = x => x, min = 0.6) => {
  let best = null, sc = 0;
  list.forEach(x => { const v = shSimilar(key(x), want); if (v > sc) { sc = v; best = x; } });
  return sc >= min ? best : null;
};
// Chiede sempre materia e argomento. Restituisce false se annulli.
function shPlaceSheet(sec, { relink = false } = {}) {
  return new Promise(resolve => {
    const d = shData();
    const subs = d ? Object.keys(d.subjects) : [];
    const nb = nbById(sec.notebookId);
    const macro = groupOf(sec)?.name || '';
    if (!subs.length) {
      // StudyHub non ancora aperto in questo browser: non vedo le sue materie
      const sh = openSheet(`
        <h2>${relink ? 'Cambia materia in StudyHub' : 'Segna come studiata in StudyHub'}</h2>
        <p class="hint">Non vedo le materie di StudyHub su questo dispositivo: succede se non l’hai ancora aperto qui, o se lo usi in un altro browser. Aprilo una volta (anche qui accanto) e riprova, così scegli dalla lista.</p>
        <label class="field"><span>Oppure scrivi il nome esatto della materia</span><input class="input" id="shSubTxt" value="${esc(nb?.shSubject || nb?.name || '')}"></label>
        <label class="field"><span>Nome dell’argomento</span><input class="input" id="shTopTxt" value="${esc(sec.title)}"></label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" data-sh-pick="no">Annulla</button>
          <button class="btn" type="button" data-sh-pick="open">Apri StudyHub</button>
          <button class="btn primary" type="button" data-sh-pick="ok">Segna lo stesso</button>
        </div>`, { label: 'StudyHub', onClose: v => resolve(v === undefined || v === null ? false : v) });
      $('[data-sh-pick="no"]', sh.el).onclick = () => sh.close(false);
      $('[data-sh-pick="open"]', sh.el).onclick = () => { sh.close(false); ShDock.open(); toast('Quando StudyHub è aperto, tocca di nuovo “Segna come studiata”'); };
      $('[data-sh-pick="ok"]', sh.el).onclick = async () => {
        const name = $('#shSubTxt', sh.el).value.trim();
        if (!name) { toast('Scrivi il nome della materia'); return; }
        if (nb && nb.shSubject !== name) { nb.shSubject = name; await saveNotebook(nb); }
        sh.close({ shSubject: name, topic: $('#shTopTxt', sh.el).value.trim() || sec.title });
      };
      return;
    }
    // la materia: quella usata l’ultima volta per questo notebook, poi la più simile al nome
    const remembered = nb?.shSubject && (subs.find(n => n === nb.shSubject) || shBest(subs, nb.shSubject, x => x, 0.95));
    let subName = remembered || shBest(subs, nb?.name || '') || shBest(subs, macro) || '';
    const ind = n => '\u00a0\u00a0\u00a0'.repeat(n);
    const sh = openSheet(`
      <h2>${relink ? 'Cambia materia o argomento in StudyHub' : 'Segna come studiata in StudyHub'}</h2>
      <p class="hint">“${esc(sec.title)}” ${relink ? 'si sposta dove scegli; dalla materia di prima viene tolto se l’aveva creato il Notebook.' : 'entra in StudyHub, che da oggi ne pianifica i ripassi.'}</p>
      <label class="field"><span>Materia in StudyHub</span>
        <select class="input" id="shSub">
          <option value="" ${subName ? '' : 'selected'} disabled>Scegli la materia…</option>
          ${subs.map(n => `<option value="${esc(n)}" ${n === subName ? 'selected' : ''}>${esc(n)}</option>`).join('')}
          <option value="__new">Nuova materia…</option>
        </select></label>
      <div id="shNewBox" hidden>
        <label class="field"><span>Nome della nuova materia</span><input class="input" id="shNewName" value="${esc((nb?.name || '').trim())}"></label>
        <p class="hint warn-hint" id="shNewWarn" hidden></p>
      </div>
      <div class="seg sh-how" role="radiogroup" aria-label="Argomento">
        <button type="button" role="radio" data-how="link">Argomento che c’è già</button>
        <button type="button" role="radio" data-how="new">Nuovo argomento</button>
      </div>
      <div id="shLinkBox">
        <input type="search" class="input search" id="shTopQ" placeholder="Cerca l’argomento in StudyHub" aria-label="Cerca l’argomento">
        <ul class="list pick-list sh-topics" id="shTopList"></ul>
      </div>
      <div id="shNewTopBox" hidden>
        <label class="field"><span>Nome dell’argomento</span><input class="input" id="shTopName" value="${esc(sec.title)}"></label>
        <label class="field"><span>Dentro</span><select class="input" id="shParent"></select></label>
      </div>
      <p class="hint" id="shPosHint"></p>
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-sh-pick="no">Annulla</button>
        <button class="btn primary" type="button" data-sh-pick="ok">${relink ? 'Sposta' : 'Segna come studiata'}</button>
      </div>`, { label: 'StudyHub', onClose: v => resolve(v === undefined || v === null ? false : v) });
    let how = 'new';
    let topicId = '';
    const subObj = () => (subName && subName !== '__new' ? d.subjects[subName] : null);
    const freeOf = tree => tree.filter(x => !x.kids && !(x.t.nb && x.t.nb.sec && x.t.nb.sec !== sec.id));
    const setHow = v => {
      how = v;
      $$('[data-how]', sh.el).forEach(b => b.setAttribute('aria-checked', String(b.dataset.how === v)));
      $('#shLinkBox', sh.el).hidden = v !== 'link';
      $('#shNewTopBox', sh.el).hidden = v !== 'new';
      hint();
    };
    const drawTopics = () => {
      const tree = shTree(subObj());
      const free = freeOf(tree);
      const f = shKey($('#shTopQ', sh.el).value);
      const list = free.filter(x => !f || shKey(x.t.name).includes(f)).slice(0, 80);
      $('#shTopList', sh.el).innerHTML = list.map(x => `<li><button type="button" class="row ${x.t.id === topicId ? 'on' : ''}" data-top="${esc(x.t.id)}"><span class="row-main"><span class="row-title">${ind(x.depth)}${esc(x.t.name)}</span>${x.t.status === 'todo' ? '<span class="row-sub">da studiare</span>' : ''}</span></button></li>`).join('')
        || `<li class="hint">${subObj() ? 'Nessun argomento libero con questo nome.' : 'Scegli prima la materia.'}</li>`;
    };
    const drawSub = () => {
      const isNew = subName === '__new';
      $('#shNewBox', sh.el).hidden = !isNew;
      const tree = shTree(subObj());
      const free = freeOf(tree);
      // l’argomento: quello con lo stesso nome (o quasi) se c’è, altrimenti uno nuovo dentro il macro-argomento
      const same = shBest(free, sec.title, x => x.t.name, 0.8);
      topicId = same ? same.t.id : '';
      const macroHit = shBest(tree.filter(x => x.kids || !x.t.nb), macro, x => x.t.name, 0.8);
      $('#shParent', sh.el).innerHTML = `<option value="">Tra gli argomenti principali</option>${tree.filter(x => !(x.t.nb && x.t.nb.sec)).map(x => `<option value="${esc(x.t.id)}" ${macroHit && macroHit.t.id === x.t.id ? 'selected' : ''}>${ind(x.depth)}${esc(x.t.name)}</option>`).join('')}`;
      $('[data-how="link"]', sh.el).disabled = isNew || !free.length;
      setHow(!isNew && same ? 'link' : 'new');
      drawTopics();
      if (isNew) warnNew();
    };
    const warnNew = () => {
      const v = $('#shNewName', sh.el).value;
      const sim = shBest(subs, v, x => x, 0.6);
      const w = $('#shNewWarn', sh.el);
      w.hidden = !sim;
      if (sim) w.innerHTML = `In StudyHub c’è già “${esc(sim)}”. <button type="button" class="link-btn" data-use="${esc(sim)}">Usa quella</button>`;
    };
    const hint = () => {
      const t = topicId && shTree(subObj()).find(x => x.t.id === topicId);
      $('#shPosHint', sh.el).textContent = !subName ? 'Scegli la materia in cui segnarla.'
        : how === 'link' ? (t ? `La colleghi a “${t.t.name}”: se era da studiare parte oggi, se la ripassi già resta com’è.` : 'Tocca l’argomento a cui collegarla.')
        : `In StudyHub nasce l’argomento “${$('#shTopName', sh.el).value.trim() || sec.title}”${subName === '__new' ? ', in una materia nuova' : ''}.`;
    };
    drawSub();
    $('#shSub', sh.el).addEventListener('change', e => { subName = e.target.value; drawSub(); hint(); });
    $('#shNewName', sh.el).addEventListener('input', warnNew);
    $('#shTopName', sh.el).addEventListener('input', hint);
    $('#shTopQ', sh.el).addEventListener('input', drawTopics);
    sh.el.addEventListener('click', e => {
      const hb = e.target.closest('[data-how]');
      if (hb && !hb.disabled) { setHow(hb.dataset.how); return; }
      const tb = e.target.closest('[data-top]');
      if (tb) { topicId = tb.dataset.top; drawTopics(); hint(); return; }
      const ub = e.target.closest('[data-use]');
      if (ub) { subName = ub.dataset.use; $('#shSub', sh.el).value = subName; drawSub(); hint(); }
    });
    $('[data-sh-pick="no"]', sh.el).onclick = () => sh.close(false);
    $('[data-sh-pick="ok"]', sh.el).onclick = async () => {
      if (!subName) { toast('Scegli la materia'); $('#shSub', sh.el).focus(); return; }
      let chosen = subName;
      if (subName === '__new') {
        chosen = $('#shNewName', sh.el).value.trim();
        if (!chosen) { toast('Scrivi il nome della nuova materia'); return; }
        const sim = shBest(subs, chosen, x => x, 0.6);
        if (sim && !(await modal({ title: 'Creare una materia nuova?', text: `In StudyHub c’è già “${sim}”. Vuoi davvero una materia separata “${chosen}”?`, confirm: 'Sì, nuova materia', cancel: `Usa “${sim}”` }))) chosen = sim;
      }
      if (how === 'link' && !topicId) { toast('Tocca l’argomento a cui collegarla, oppure scegli “Nuovo argomento”'); return; }
      if (nb && nb.shSubject !== chosen) { nb.shSubject = chosen; await saveNotebook(nb); }
      sh.close(how === 'link'
        ? { shSubject: chosen, shPlace: 'link', shTopicId: topicId }
        : { shSubject: chosen, shPlace: 'new', shParentId: $('#shParent', sh.el).value || '', topic: $('#shTopName', sh.el).value.trim() || sec.title });
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
    if (typeof Pad !== 'undefined' && Pad.isOpen()) Pad.close();
    if (typeof Split !== 'undefined' && Split.isOpen()) Split.close();
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

