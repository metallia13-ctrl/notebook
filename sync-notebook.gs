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
 * un file per ogni notebook, un indice e le sottocartelle "immagini", "pdf" e "lezioni".
 * Non modificarli a mano (tranne "lezioni": lì ci sono file audio normali).
 *
 * Versione 2 (Notebook 3.8): aggiunge i PDF.
 *
 * Versione 3 (Notebook 3.86): aggiunge le lezioni audio su Drive. L'app può aprire le
 * cartelle del tuo Drive, aggiungere gli audio che ci trovi e scaricarli sul dispositivo,
 * e caricare su Drive le lezioni registrate o caricate da un dispositivo.
 * Per aggiornare dalla versione 2:
 *   a. incolla questo file al posto del vecchio TENENDO LA TUA FRASE SEGRETA;
 *   b. scegli di nuovo la funzione "autorizza" e premi Esegui: questa volta Google chiede
 *      anche il permesso di "connettersi a un servizio esterno" (serve per leggere e scrivere
 *      i file audio a pezzi). Consenti;
 *   c. Distribuisci > Gestisci distribuzioni > Modifica (matita) > Versione: "Nuova versione"
 *      > Distribuisci. L'indirizzo /exec resta lo stesso.
 */

const SECRET = 'CAMBIA-QUESTA-FRASE';
const FOLDER_NAME = 'StudyHub Notebook (sincronizzazione)';
const MAX_SET_CONTENT = 7 * 1024 * 1024; // oltre questa misura il file viene ricreato invece che sovrascritto
const DRIVE_CHUNK = 3 * 1024 * 1024;     // pezzi degli audio: 3 MB (multiplo di 256 KB, come vuole Drive)
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|webm|flac|mp4|3gp|amr|wma)$/i;

/** Da eseguire una volta dall'editor: concede l'accesso a Drive e crea la cartella. */
function autorizza() {
  const folder = folder_();
  indexFile_(folder);
  imgFolder_(folder);
  // chiede anche il permesso per i servizi esterni (gli audio passano dall'API di Drive)
  UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  Logger.log('Autorizzazione completata. Cartella: ' + folder.getName());
}

function doGet() {
  return json_({ ok: true, app: 'studyhub-notebook-sync', version: 3, pdf: true, drive: true });
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

  // gli audio su Drive non toccano l'indice: niente attesa per la sincronizzazione
  if (String(req.action || '').indexOf('drive-') === 0) {
    try {
      return json_(driveAction_(req));
    } catch (err) {
      return json_({ ok: false, error: driveError_(err) });
    }
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return json_({ ok: false, error: 'Sincronizzazione già in corso da un altro dispositivo, riprova tra poco' });
  try {
    const folder = folder_();
    const indexFile = indexFile_(folder);
    const index = readJson_(indexFile, { rev: 0, shards: {} });
    if (!index.shards) index.shards = {};
    if (!index.images) index.images = {};
    if (!index.pdfs) index.pdfs = {};
    if (req.action === 'ping') return json_({ ok: true, rev: index.rev, version: 3 });
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

/* ---------------------------------------------------------------------
   Versione 3: lezioni audio su Drive.
   - drive-list: le sottocartelle e i file audio di una cartella (anche "Il mio Drive")
   - drive-token: un accesso temporaneo, così l'app scarica l'audio direttamente da Drive
   - drive-part: un pezzo di un audio (se lo scaricamento diretto non va)
   - drive-up-start / drive-up-part: carica un audio a pezzi in un unico file
   --------------------------------------------------------------------- */
function driveAction_(req) {
  if (req.action === 'drive-list') return driveList_(req);
  if (req.action === 'drive-token') return { ok: true, token: ScriptApp.getOAuthToken(), expires: Date.now() + 45 * 60 * 1000 };
  if (req.action === 'drive-part') return drivePart_(req);
  if (req.action === 'drive-up-start') return driveUpStart_(req);
  if (req.action === 'drive-up-part') return driveUpPart_(req);
  return { ok: false, error: 'Azione sconosciuta' };
}

function driveError_(err) {
  const msg = String((err && err.message) || err);
  if (/UrlFetchApp|external_request|autorizzazione|permission|permesso/i.test(msg)) {
    return 'Lo script non ha ancora il permesso per gli audio: aprilo su script.google.com, scegli la funzione "autorizza", premi Esegui e consenti.';
  }
  if (/not found|non trovat|no item|Impossibile trovare/i.test(msg)) return 'Su Drive non trovo questo file o cartella (forse è stato spostato o cancellato).';
  return msg;
}

/** La cartella da un link di Drive, da un id o "root" (Il mio Drive). */
function folderFrom_(v) {
  const s = String(v || '').trim();
  if (!s || s === 'root') return DriveApp.getRootFolder();
  const m = s.match(/folders\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/) || s.match(/^([\w-]{10,})$/);
  if (!m) throw new Error('Link della cartella non valido: copia il link della cartella da Drive');
  return DriveApp.getFolderById(m[1]);
}

function driveList_(req) {
  const f = folderFrom_(req.folder);
  const rootId = DriveApp.getRootFolder().getId();
  const isRoot = f.getId() === rootId;
  let parent = null;
  if (!isRoot) {
    try {
      const ps = f.getParents();
      if (ps.hasNext()) {
        const p = ps.next();
        parent = { id: p.getId(), name: p.getId() === rootId ? 'Il mio Drive' : p.getName() };
      }
    } catch (err) { /* cartella condivisa: niente cartella sopra */ }
  }
  const folders = [];
  const fi = f.getFolders();
  while (fi.hasNext() && folders.length < 300) {
    const x = fi.next();
    if (!x.isTrashed()) folders.push({ id: x.getId(), name: x.getName() });
  }
  const files = [];
  const it = f.getFiles();
  let seen = 0;
  while (it.hasNext() && files.length < 500 && seen < 4000) {
    const x = it.next();
    seen++;
    if (x.isTrashed()) continue;
    const mime = x.getMimeType() || '';
    const name = x.getName();
    if (mime.indexOf('audio/') !== 0 && !AUDIO_EXT.test(name)) continue;
    files.push({ id: x.getId(), name: name, size: x.getSize(), mime: mime, modified: x.getLastUpdated().getTime() });
  }
  const byName = function (a, b) { return a.name.localeCompare(b.name, 'it', { numeric: true }); };
  folders.sort(byName);
  files.sort(byName);
  return { ok: true, id: isRoot ? 'root' : f.getId(), name: isRoot ? 'Il mio Drive' : f.getName(), parent: parent, folders: folders, files: files };
}

function validDriveId_(id) { return /^[\w-]{10,}$/.test(String(id || '')); }

/** Un pezzo da 3 MB di un file audio, in base64. */
function drivePart_(req) {
  const id = String(req.id || '');
  if (!validDriveId_(id)) return { ok: false, error: 'File non valido' };
  const file = DriveApp.getFileById(id);
  const size = file.getSize();
  const total = Math.max(1, Math.ceil(size / DRIVE_CHUNK));
  const part = Number(req.part) || 0;
  if (part < 0 || part >= total || part % 1) return { ok: false, error: 'Pezzo non valido' };
  const start = part * DRIVE_CHUNK;
  const end = Math.min(size, start + DRIVE_CHUNK) - 1;
  let bytes;
  try {
    const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media&supportsAllDrives=true', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + start + '-' + end },
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code !== 206 && code !== 200) throw new Error('Drive ha risposto ' + code);
    bytes = res.getContent();
    if (code === 200 && bytes.length > end - start + 1) bytes = bytes.slice(start, end + 1);
  } catch (err) {
    // ultima possibilità: tutto il file in memoria (va per i file fino a circa 50 MB)
    bytes = file.getBlob().getBytes().slice(start, end + 1);
  }
  return { ok: true, part: part, total: total, size: size, mime: file.getMimeType(), data: Utilities.base64Encode(bytes) };
}

/** Prepara il caricamento di un audio: restituisce l'indirizzo a cui mandare i pezzi. */
function driveUpStart_(req) {
  const size = Number(req.size) || 0;
  if (!(size > 0)) return { ok: false, error: 'File vuoto' };
  let folder;
  if (req.folder) folder = folderFrom_(req.folder);
  else {
    folder = lessonsFolder_(folder_());
    const sub = String(req.sub || '').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 100);
    if (sub) {
      const it = folder.getFoldersByName(sub);
      folder = it.hasNext() ? it.next() : folder.createFolder(sub);
    }
  }
  const meta = { name: String(req.name || 'Lezione').slice(0, 200), parents: [folder.getId()] };
  const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify(meta),
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': String(req.mime || 'application/octet-stream'),
      'X-Upload-Content-Length': String(size)
    },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return { ok: false, error: 'Drive non accetta il caricamento (' + res.getResponseCode() + ')' };
  const h = res.getAllHeaders();
  const session = h.Location || h.location;
  if (!session) return { ok: false, error: 'Drive non ha dato l’indirizzo per il caricamento' };
  return { ok: true, session: session, folder: folder.getId(), folderName: folder.getName() };
}

/** Manda un pezzo: Drive risponde 308 finché manca qualcosa, 200 quando il file è completo. */
function driveUpPart_(req) {
  const session = String(req.session || '');
  if (session.indexOf('https://www.googleapis.com/upload/drive/') !== 0) return { ok: false, error: 'Caricamento non valido' };
  const start = Number(req.start) || 0;
  const size = Number(req.size) || 0;
  const bytes = Utilities.base64Decode(String(req.data || ''));
  if (!bytes.length || !(size > 0)) return { ok: false, error: 'Pezzo vuoto' };
  const end = start + bytes.length - 1;
  const res = UrlFetchApp.fetch(session, {
    method: 'put',
    payload: bytes,
    contentType: String(req.mime || 'application/octet-stream'),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'Content-Range': 'bytes ' + start + '-' + end + '/' + size },
    muteHttpExceptions: true,
    followRedirects: false
  });
  const code = res.getResponseCode();
  if (code === 200 || code === 201) {
    const j = JSON.parse(res.getContentText() || '{}');
    return { ok: true, done: true, fileId: j.id, name: j.name };
  }
  if (code === 308) {
    const h = res.getAllHeaders();
    const m = String(h.Range || h.range || '').match(/bytes=0-(\d+)/);
    return { ok: true, done: false, next: m ? Number(m[1]) + 1 : 0 };
  }
  return { ok: false, error: 'Caricamento su Drive interrotto (' + code + '): riprova' };
}

function lessonsFolder_(folder) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('LESSONS_FOLDER_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) { /* cartella sparita: la ricreo */ }
  }
  const f = folder.createFolder('lezioni');
  props.setProperty('LESSONS_FOLDER_ID', f.getId());
  return f;
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
