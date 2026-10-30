/**
 * StudyHub Notebook: sincronizzazione su Google Drive
 *
 * Installazione (una volta sola):
 * 1. Vai su script.google.com, crea un NUOVO progetto (non usare quello di StudyHub)
 *    e incolla tutto questo file al posto del codice di esempio.
 * 2. Cambia SECRET qui sotto con una frase lunga che conosci solo tu.
 * 3. In alto scegli la funzione "autorizza" e premi Esegui: Google chiede l'accesso a Drive.
 *    Se compare "App non verificata": Avanzate > Vai al progetto (non sicuro) > Consenti.
 *    È il tuo script, quindi va bene.
 * 4. Distribuisci > Nuova distribuzione > tipo "App web".
 *    Esegui come: Me.  Chi ha accesso: Chiunque (NON "Chiunque con un account Google").
 * 5. Copia l'URL dell'app web, quello che finisce con /exec, e incollalo nelle Impostazioni
 *    del Notebook insieme alla stessa frase segreta. Poi premi "Prova il collegamento".
 * Se usi l'account dell'università, l'amministratore potrebbe vietare "Chiunque":
 * in quel caso crea lo script con il tuo account Gmail personale.
 *
 * Se modifichi questo codice: Distribuisci > Gestisci distribuzioni > Modifica (matita)
 * > Versione: "Nuova versione". Così l'indirizzo resta lo stesso.
 *
 * I dati finiscono nella cartella "StudyHub Notebook (sincronizzazione)" del tuo Drive:
 * un file per ogni notebook, un indice e le sottocartelle "immagini" e "pdf".
 * Non modificarli a mano.
 *
 * Versione 2 (Notebook 3.8): aggiunge i PDF. Se avevi già la versione 1, incolla questo file
 * al posto del vecchio TENENDO LA TUA FRASE SEGRETA, poi Distribuisci > Gestisci distribuzioni
 * > Modifica (matita) > Versione: "Nuova versione" > Distribuisci. Non serve autorizzare di nuovo.
 * Ogni PDF è salvato in pezzi da 3 MB nella sottocartella "pdf": l'app li ricompone da sola.
 */

const SECRET = 'CAMBIA-QUESTA-FRASE';
const FOLDER_NAME = 'StudyHub Notebook (sincronizzazione)';
const MAX_SET_CONTENT = 7 * 1024 * 1024; // oltre questa misura il file viene ricreato invece che sovrascritto

/** Da eseguire una volta dall'editor: concede l'accesso a Drive e crea la cartella. */
function autorizza() {
  const folder = folder_();
  indexFile_(folder);
  imgFolder_(folder);
  Logger.log('Autorizzazione completata. Cartella: ' + folder.getName());
}

function doGet() {
  return json_({ ok: true, app: 'studyhub-notebook-sync', version: 2, pdf: true });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Richiesta non leggibile' });
  }
  if (SECRET === 'CAMBIA-QUESTA-FRASE') {
    return json_({ ok: false, error: 'Nello script manca la frase segreta: cambiala e crea una nuova versione della distribuzione' });
  }
  if (!req || req.secret !== SECRET) return json_({ ok: false, error: 'Frase segreta errata' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return json_({ ok: false, error: 'Sincronizzazione già in corso da un altro dispositivo, riprova tra poco' });
  try {
    const folder = folder_();
    const indexFile = indexFile_(folder);
    const index = readJson_(indexFile, { rev: 0, shards: {} });
    if (!index.shards) index.shards = {};
    if (!index.images) index.images = {};
    if (!index.pdfs) index.pdfs = {};
    if (req.action === 'ping') return json_({ ok: true, rev: index.rev, version: 2 });
    if (req.action === 'images') return json_(images_(index, req));
    if (req.action === 'pdf-info') return json_(pdfInfo_(index, req));
    if (req.action === 'pdf-up') return json_(pdfUp_(folder, indexFile, index, req));
    if (req.action === 'pdf-down') return json_(pdfDown_(index, req));
    if (req.action !== 'sync') return json_({ ok: false, error: 'Azione sconosciuta' });
    return json_(sync_(folder, indexFile, index, req));
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Riceve le modifiche del dispositivo e restituisce quelle degli altri.
 * Per ogni elemento vince la versione modificata per ultima (campo "updated").
 */
function sync_(folder, indexFile, index, req) {
  const loaded = {};
  const getShard = function (key) {
    if (!loaded[key]) {
      const meta = index.shards[key];
      let file = null;
      let data = { records: {} };
      if (meta && meta.fileId) {
        try {
          file = DriveApp.getFileById(meta.fileId);
          data = readJson_(file, { records: {} });
          if (!data.records) data.records = {};
        } catch (err) {
          file = null;
        }
      }
      loaded[key] = { file: file, data: data, dirty: false };
    }
    return loaded[key];
  };

  const accepted = {};
  let imagesChanged = false;
  (req.records || []).forEach(function (r) {
    if (!r || !r.id || !r.store) return;
    // PDF eliminato da un dispositivo: si cestinano anche i suoi pezzi
    if (r.store === 'pdfs' && r.deleted && index.pdfs[r.id] && !index.pdfs[r.id].deleted) {
      trashPdf_(index, r.id);
      imagesChanged = true;
    }
    if (r.store === 'images') {
      if (saveImage_(folder, index, r)) { accepted['images:' + r.id] = true; imagesChanged = true; }
      return;
    }
    const key = r.store === 'notebooks' ? '_notebooks' : String(r.notebookId || '_altro');
    const sh = getShard(key);
    const k = r.store + ':' + r.id;
    const cur = sh.data.records[k];
    if (!cur || (Number(r.updated) || 0) > (Number(cur.updated) || 0)) {
      index.rev += 1;
      r.rev = index.rev;
      sh.data.records[k] = r;
      sh.dirty = true;
      accepted[k] = true;
    }
  });

  let indexChanged = imagesChanged;
  Object.keys(loaded).forEach(function (key) {
    const sh = loaded[key];
    if (!sh.dirty) return;
    const name = 'notebook-' + key.replace(/[^\w-]/g, '_') + '.json';
    sh.file = writeFile_(folder, sh.file, name, JSON.stringify(sh.data));
    index.shards[key] = { fileId: sh.file.getId(), rev: index.rev };
    indexChanged = true;
  });
  if (indexChanged) saveIndex_(folder, indexFile, index);

  const out = [];
  if (req.pull !== false) {
    const since = Number(req.since) || 0;
    Object.keys(index.shards).forEach(function (key) {
      if ((index.shards[key].rev || 0) <= since) return;
      const sh = getShard(key);
      Object.keys(sh.data.records).forEach(function (k) {
        const r = sh.data.records[k];
        if ((r.rev || 0) > since && !accepted[k]) out.push(r);
      });
    });
    // delle immagini si inviano solo i dati descrittivi: il contenuto si chiede con action "images"
    Object.keys(index.images).forEach(function (id) {
      const m = index.images[id];
      if ((m.rev || 0) > since && !accepted['images:' + id]) {
        out.push({ store: 'images', id: id, updated: m.updated, rev: m.rev, deleted: !!m.deleted, notebookId: m.notebookId, meta: m.meta || {} });
      }
    });
  }
  return { ok: true, rev: index.rev, accepted: Object.keys(accepted).length, records: out };
}

/** Salva un'immagine come file separato nella sottocartella "immagini". */
function saveImage_(folder, index, r) {
  const cur = index.images[r.id];
  if (cur && (Number(r.updated) || 0) <= (Number(cur.updated) || 0)) return false;
  if (!r.deleted && !r.data) return false;
  index.rev += 1;
  if (cur && cur.fileId) {
    try { DriveApp.getFileById(cur.fileId).setTrashed(true); } catch (err) { /* già rimosso */ }
  }
  if (r.deleted) {
    index.images[r.id] = { rev: index.rev, updated: r.updated, deleted: true, notebookId: r.notebookId };
    return true;
  }
  const meta = r.meta || {};
  const mime = meta.mime || 'image/webp';
  const ext = mime.indexOf('png') >= 0 ? '.png' : mime.indexOf('jpeg') >= 0 ? '.jpg' : '.webp';
  const file = imgFolder_(folder).createFile(Utilities.newBlob(Utilities.base64Decode(r.data), mime, 'img-' + r.id + ext));
  index.images[r.id] = { fileId: file.getId(), rev: index.rev, updated: r.updated, notebookId: r.notebookId, meta: meta };
  return true;
}

/** Restituisce il contenuto delle immagini richieste, fino a circa 6 MB per risposta. */
function images_(index, req) {
  const out = [];
  const missing = [];
  let size = 0;
  (req.ids || []).some(function (id) {
    const m = index.images[id];
    if (!m || m.deleted || !m.fileId) { missing.push(id); return false; }
    let data;
    try {
      data = Utilities.base64Encode(DriveApp.getFileById(m.fileId).getBlob().getBytes());
    } catch (err) {
      missing.push(id);
      return false;
    }
    if (out.length && size + data.length > 6 * 1024 * 1024) return true;
    out.push({ id: id, mime: (m.meta && m.meta.mime) || 'image/webp', updated: m.updated, notebookId: m.notebookId, meta: m.meta || {}, data: data });
    size += data.length;
    return false;
  });
  return { ok: true, images: out, missing: missing };
}

/* ---------------------------------------------------------------------
   PDF: ogni file è diviso in pezzi numerati. L'app manda e chiede un pezzo
   per volta, così anche un PDF grande non supera i limiti di Apps Script.
   --------------------------------------------------------------------- */
function validPdfId_(id) { return /^[A-Za-z0-9_-]{4,40}$/.test(String(id || '')); }

/** Quali pezzi di un PDF sono già su Drive (per riprendere un caricamento interrotto). */
function pdfInfo_(index, req) {
  const m = index.pdfs[req.id];
  if (!m || m.deleted) return { ok: true, exists: false, parts: [] };
  const parts = [];
  (m.parts || []).forEach(function (fid, i) { if (fid) parts.push(i); });
  return { ok: true, exists: true, complete: !!m.complete, total: m.total, size: m.size, parts: parts };
}

/** Riceve un pezzo del PDF e lo salva come file nella sottocartella "pdf". */
function pdfUp_(folder, indexFile, index, req) {
  const id = String(req.id || '');
  const part = Number(req.part);
  const total = Number(req.total);
  const size = Number(req.size) || 0;
  if (!validPdfId_(id) || !(part >= 0) || !(total > 0) || part >= total || part % 1 || !req.data) {
    return { ok: false, error: 'Pezzo del PDF non valido' };
  }
  let m = index.pdfs[id];
  if (!m || m.deleted || m.total !== total || m.size !== size) {
    if (m && m.parts) trashParts_(m.parts);
    m = { parts: [], total: total, size: size, complete: false };
  }
  if (m.parts[part]) {
    try { DriveApp.getFileById(m.parts[part]).setTrashed(true); } catch (err) { /* già rimosso */ }
  }
  const name = id + '.parte-' + ('000' + part).slice(-4);
  const file = pdfFolder_(folder).createFile(Utilities.newBlob(Utilities.base64Decode(req.data), 'application/octet-stream', name));
  m.parts[part] = file.getId();
  m.name = String(req.name || '').slice(0, 200);
  m.notebookId = String(req.notebookId || '');
  let have = 0;
  for (let i = 0; i < total; i++) if (m.parts[i]) have++;
  m.complete = have === total;
  m.updated = Date.now();
  index.pdfs[id] = m;
  saveIndex_(folder, indexFile, index);
  return { ok: true, part: part, complete: m.complete };
}

/** Restituisce un pezzo del PDF. */
function pdfDown_(index, req) {
  const m = index.pdfs[req.id];
  if (!m || m.deleted) return { ok: false, error: 'Questo PDF non è su Drive' };
  if (!m.complete) return { ok: false, error: 'Il PDF non è ancora stato caricato del tutto su Drive' };
  const part = Number(req.part) || 0;
  if (part < 0 || part >= m.total || !m.parts[part]) return { ok: false, error: 'Pezzo del PDF mancante' };
  let data;
  try {
    data = Utilities.base64Encode(DriveApp.getFileById(m.parts[part]).getBlob().getBytes());
  } catch (err) {
    return { ok: false, error: 'Un pezzo del PDF è stato cancellato da Drive: caricalo di nuovo' };
  }
  return { ok: true, part: part, total: m.total, size: m.size, data: data };
}

function trashParts_(parts) {
  (parts || []).forEach(function (fid) {
    if (!fid) return;
    try { DriveApp.getFileById(fid).setTrashed(true); } catch (err) { /* già rimosso */ }
  });
}

function trashPdf_(index, id) {
  const m = index.pdfs[id];
  if (!m) return;
  trashParts_(m.parts);
  index.pdfs[id] = { deleted: true, updated: Date.now() };
}

function pdfFolder_(folder) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PDF_FOLDER_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) { /* cartella sparita: la ricreo */ }
  }
  const f = folder.createFolder('pdf');
  props.setProperty('PDF_FOLDER_ID', f.getId());
  return f;
}

function saveIndex_(folder, indexFile, index) {
  const f = writeFile_(folder, indexFile, 'index.json', JSON.stringify(index));
  if (f.getId() !== indexFile.getId()) PropertiesService.getScriptProperties().setProperty('INDEX_ID', f.getId());
  return f;
}

function imgFolder_(folder) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('IMG_FOLDER_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) { /* cartella sparita: la ricreo */ }
  }
  const f = folder.createFolder('immagini');
  props.setProperty('IMG_FOLDER_ID', f.getId());
  return f;
}

function folder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) { /* cartella sparita: la ricreo */ }
  }
  const f = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', f.getId());
  props.deleteProperty('INDEX_ID');
  return f;
}

function indexFile_(folder) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('INDEX_ID');
  if (id) {
    try {
      const f = DriveApp.getFileById(id);
      if (!f.isTrashed()) return f;
    } catch (err) { /* indice sparito: lo ricreo */ }
  }
  const f = folder.createFile('index.json', JSON.stringify({ rev: 0, shards: {} }), MimeType.PLAIN_TEXT);
  props.setProperty('INDEX_ID', f.getId());
  return f;
}

function readJson_(file, fallback) {
  try {
    return JSON.parse(file.getBlob().getDataAsString('UTF-8'));
  } catch (err) {
    return fallback;
  }
}

function writeFile_(folder, file, name, content) {
  if (file && content.length < MAX_SET_CONTENT) {
    file.setContent(content);
    return file;
  }
  if (file) file.setTrashed(true);
  return folder.createFile(Utilities.newBlob(content, 'application/json', name));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
