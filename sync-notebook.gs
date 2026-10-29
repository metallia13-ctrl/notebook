/**
 * StudyHub Notebook: sincronizzazione su Google Drive
 *
 * Installazione (una volta sola):
 * 1. Vai su script.google.com, crea un NUOVO progetto (non usare quello di StudyHub)
 *    e incolla tutto questo file al posto del codice di esempio.
 * 2. Cambia SECRET qui sotto con una frase lunga che conosci solo tu.
 * 3. Esegui > Distribuisci > Nuova distribuzione > tipo "App web".
 *    Esegui come: Me.  Chi ha accesso: Chiunque.
 * 4. Autorizza l'accesso a Drive quando Google lo chiede.
 * 5. Copia l'indirizzo che finisce con /exec e incollalo nelle Impostazioni del Notebook,
 *    insieme alla stessa frase segreta.
 *
 * Se modifichi questo codice: Distribuisci > Gestisci distribuzioni > Modifica (matita)
 * > Versione: "Nuova versione". Così l'indirizzo resta lo stesso.
 *
 * I dati finiscono nella cartella "StudyHub Notebook (sincronizzazione)" del tuo Drive:
 * un file per ogni notebook più un indice. Non modificarli a mano.
 */

const SECRET = 'CAMBIA-QUESTA-FRASE';
const FOLDER_NAME = 'StudyHub Notebook (sincronizzazione)';
const MAX_SET_CONTENT = 7 * 1024 * 1024; // oltre questa misura il file viene ricreato invece che sovrascritto

function doGet() {
  return json_({ ok: true, app: 'studyhub-notebook-sync', version: 1 });
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
    if (req.action === 'ping') return json_({ ok: true, rev: index.rev });
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
  (req.records || []).forEach(function (r) {
    if (!r || !r.id || !r.store) return;
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

  let indexChanged = false;
  Object.keys(loaded).forEach(function (key) {
    const sh = loaded[key];
    if (!sh.dirty) return;
    const name = 'notebook-' + key.replace(/[^\w-]/g, '_') + '.json';
    sh.file = writeFile_(folder, sh.file, name, JSON.stringify(sh.data));
    index.shards[key] = { fileId: sh.file.getId(), rev: index.rev };
    indexChanged = true;
  });
  if (indexChanged) {
    const newIndex = writeFile_(folder, indexFile, 'index.json', JSON.stringify(index));
    if (newIndex.getId() !== indexFile.getId()) {
      PropertiesService.getScriptProperties().setProperty('INDEX_ID', newIndex.getId());
    }
  }

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
  }
  return { ok: true, rev: index.rev, accepted: Object.keys(accepted).length, records: out };
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
