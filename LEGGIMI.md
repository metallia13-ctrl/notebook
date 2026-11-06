# StudyHub Notebook: mappa del codice

L’app è una pagina web (GitHub Pages) senza passaggi di compilazione: quello che c’è nel repository è quello che il browser esegue.

## File

| File | Cosa contiene |
|---|---|
| `index.html` | La pagina, la barra laterale e la navigazione; carica i sei moduli **in quest’ordine** |
| `01-base.js` | Utilità, database (IndexedDB), impostazioni, stato, testo e Markdown, cloze, AI (Gemini e Claude), interfaccia comune (finestre, messaggi), router, immagini, tag, collegamenti `[[…]]`, ricerca, sincronizzazione con Drive, backup |
| `02-notebook.js` | Notebook e sezioni: elenchi e gruppi (tre livelli), modalità di studio (Cloze, Leggi, Orale, Pagina bianca, Domande, Mappe, Video, Audio, Modifica sull’anteprima), importazione, segni a semaforo, scrittura a mano, etichette, sposta paragrafo, stampa |
| `03-flashcard.js` | Flashcard e ripasso: algoritmo di Anki (intervalli modificabili), viste delle flashcard, selezione multipla, calendario, simulazione e modalità esame |
| `04-pdf.js` | Lettore PDF (evidenziatori, penna, segnalibri, figure) e libreria dei PDF |
| `05-clinica.js` | Glossario e note cliniche, diagnosi differenziale, sezioni speciali (microbiologia, atlanti, farmacologia con il confronto, diario di tirocinio), score clinici, domande d’esame, semeiotica, laboratorio, casi clinici |
| `06-app.js` | Impostazioni, collegamento con StudyHub, link, guida, aiuto e tutorial, pagina Altro, Affianca, blocco note, Riprendi, protezione dei dati, novità; alla fine `init()` avvia l’app |
| `style.css` | Tutto lo stile |
| `sw.js` | Service worker: funziona anche offline; `VERSION` va aumentata a ogni aggiornamento |

## Regole

- I moduli sono script normali, non moduli ES: condividono le stesse variabili globali. Dentro le funzioni si può usare tutto; **al caricamento** (fuori dalle funzioni) un file può usare solo quello che è definito nei file prima.
- A ogni versione: `APP_VERSION` in `01-base.js`, `VERSION` in `sw.js` e una voce in `CHANGES` (in `06-app.js`) per la finestra delle novità.
- Testi e commenti in italiano, rivolti alla persona che usa l’app.
