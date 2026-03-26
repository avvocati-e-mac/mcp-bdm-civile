# 🏛️ MCP Banca Dati di Merito — Civile

Server **MCP (Model Context Protocol)** che permette a qualsiasi LLM o sistema compatibile di consultare direttamente la [Banca Dati di Merito](https://bdp.giustizia.it) del Ministero della Giustizia — la banca dati gratuita che raccoglie sentenze, decreti e ordinanze civili dei tribunali italiani.

Compatibile con **Claude Desktop**, **Cursor**, **Windsurf**, **Continue**, **Zed** e qualsiasi altro client che supporta il protocollo MCP.

Una volta configurato, puoi chiedere al tuo assistente AI:

> *"Cerca sentenze del Tribunale di Bologna sulla locazione abitativa degli ultimi due anni"*

> *"Leggi il testo integrale di questa sentenza e dimmi se è rilevante per il mio caso"*

> *"Trova abstract sulla responsabilità medica con precedenti conformi"*

L'assistente cercherà, leggerà e analizzerà i provvedimenti per te, direttamente in chat.

---

## Cosa serve prima di iniziare

1. **Un Mac** (il progetto è testato su macOS)
2. **Un client MCP** installato — es. [Claude Desktop](https://claude.ai/download), [Cursor](https://cursor.sh), [Windsurf](https://codeium.com/windsurf) o altro
3. **Node.js 20 o superiore** — scaricalo da [nodejs.org](https://nodejs.org) (scegli la versione "LTS")
4. **La tua CIE** (Carta d'Identità Elettronica) fisica con PIN
5. **L'app CieID** installata sul tuo smartphone ([App Store](https://apps.apple.com/it/app/cieid/id1504644677) / [Google Play](https://play.google.com/store/apps/details?id=it.ipzs.cieid))
6. Un lettore NFC sul telefono (tutti gli smartphone moderni ce l'hanno)

---

## Installazione

### 1. Scarica il progetto

Apri il **Terminale** (cercalo con Spotlight: `⌘ Spazio`, digita "Terminale") e incolla questi comandi uno alla volta:

```bash
cd ~/Documents
git clone https://github.com/avvocati-e-mac/mcp-bdm-civile.git
cd mcp-bdm-civile
```

### 2. Installa le dipendenze

Sempre nel Terminale, nella cartella del progetto:

```bash
npm install
npx playwright install chromium
```

Questo scarica le librerie necessarie e il browser interno usato dallo strumento. Ci vuole qualche minuto.

### 3. Esegui il login con la CIE

Questo passaggio va fatto **una sola volta** (la sessione dura circa un anno):

```bash
node src/auth/save-session.js
```

Si aprirà un browser. Segui questi passi:

1. Clicca **"Accedi"** nella homepage della Banca Dati
2. Seleziona **"Entra con CIE"**
3. Apparirà un **QR code** — apri l'app **CieID** sul telefono e scansionalo
4. Avvicina la CIE al telefono (NFC) e inserisci il PIN nell'app
5. Aspetta che il browser torni sulla homepage della Banca Dati
6. Torna nel Terminale e premi **Invio**

Se vedi `✅ Sessione verificata`, hai completato il login con successo.

### 4. Configura il tuo client MCP

Apri il Terminale e incolla questo comando per trovare il percorso corretto del server:

```bash
echo "$(pwd)/src/server.js"
```

Copia l'output (es. `/Users/tuonome/Documents/mcp-bdm-civile/src/server.js`).

Poi aggiungi il server alla configurazione del tuo client. Il blocco da aggiungere è sempre lo stesso:

```json
{
  "mcpServers": {
    "bdm-civile": {
      "command": "node",
      "args": ["/Users/tuonome/Documents/mcp-bdm-civile/src/server.js"]
    }
  }
}
```

> ⚠️ Sostituisci il percorso con quello copiato prima.

**Dove si trova il file di configurazione** a seconda del client:

| Client | File di configurazione |
|--------|------------------------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | `.cursor/mcp.json` nella cartella del progetto, oppure `~/.cursor/mcp.json` globale |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Continue | `.continue/config.json` nella cartella del progetto |
| Altri | Consulta la documentazione del tuo client per la posizione del file MCP |

Se nel file c'era già altro contenuto (altri server MCP), aggiungi solo la parte `"bdm-civile": { ... }` dentro `"mcpServers"`.

### 5. Riavvia il client

Chiudi e riapri il tuo client MCP. Gli strumenti della Banca Dati di Merito saranno disponibili nell'interfaccia.

---

## Come si usa

Chiedi normalmente al tuo assistente AI, in italiano. Alcuni esempi:

**Ricerca provvedimenti:**
- *"Cerca sentenze sulla locazione commerciale del distretto di Milano"*
- *"Trova ordinanze del 2024 del Tribunale di Roma in materia di separazione"*
- *"Cerca provvedimenti che citano l'articolo 1453 del codice civile"*

**Lettura provvedimenti:**
- *"Leggi il testo integrale di questa sentenza: [incolla URL dalla BDP]"*
- *"Dimmi i metadati di questo provvedimento: giudice, materia, parole chiave"*

**Abstract e precedenti:**
- *"Cerca abstract sulla responsabilità del medico"*
- *"Ci sono precedenti conformi per questo abstract?"*

**Navigazione archivio:**
- *"Mostrami i tribunali del distretto di Napoli presenti in archivio"*
- *"Quali materie sono disponibili per il Tribunale di Torino?"*

**Utilità:**
- *"La sessione della Banca Dati è ancora attiva?"*
- *"Elenca tutte le materie disponibili nella BDP"*

---

## Quando la sessione scade

La sessione CIE dura circa **un anno**. Quando scade, l'assistente risponderà con un messaggio del tipo:

> *Sessione CIE scaduta. Ferma il server, esegui: npm run save-session, poi riavvia.*

Per rinnovarla, apri il Terminale nella cartella del progetto e ripeti il login:

```bash
cd ~/Documents/mcp-bdm-civile
node src/auth/save-session.js
```

Poi riavvia il client MCP.

---

## Domande frequenti

**Il browser si apre quando uso il server — è normale?**
Sì. Il server usa un browser interno in background per navigare la BDP. Alla prima chiamata dopo l'avvio del client, il browser si inizializza e potresti vederlo comparire brevemente nella Dock.

**I miei dati sono al sicuro?**
Il server accede alla BDP usando le tue credenziali CIE, esattamente come faresti tu nel browser. Non invia nulla a server esterni — tutto rimane sul tuo Mac e sulla BDP del Ministero.

**Posso usarlo senza CIE?**
No. La BDP richiede autenticazione con CIE livello 3. Senza login non è possibile accedere ai provvedimenti.

**Funziona su Windows?**
Il progetto è sviluppato e testato su macOS. Potrebbe funzionare su Windows con adattamenti, ma non è supportato ufficialmente.

**Il client non trova i tool della BDP dopo la configurazione — cosa faccio?**
Verifica che il percorso nel file di configurazione sia corretto e che il file sia salvato nella posizione giusta per il tuo client. Poi riavvia completamente il client.

---

## Strumenti di workflow

### `analisi_quesito_giuridico`

Pipeline a due fasi progettata per rispondere a quesiti giuridici complessi analizzando sistematicamente la BDP.

**Come funziona:**

**Fase 1 — Scansione ampia**
- Estrae automaticamente termini di ricerca ottimizzati dal quesito (sinonimi giuridici IT, riferimenti normativi, materia)
- Esegue più query in parallelo sulla SERP BDP, scorrendo fino a `max_pagine_serp` pagine per query
- Analizza gli estratti testuali di ogni risultato (senza aprire i documenti) calcolando uno score di pertinenza basato su copertura termini, densità, coerenza contestuale e lunghezza
- Pre-seleziona i candidati più promettenti (`da_aprire`) in base alla soglia `soglia_apri`

**Fase 2 — Approfondimento selettivo**
- Apre e legge i dettagli completi SOLO per i candidati selezionati (max `max_da_aprire` documenti)
- Calcola uno score finale multifattore (parole chiave, materia, abstract collegati, riferimenti normativi)
- Restituisce i migliori `max_provvedimenti` ordinati per pertinenza

**Parametri:**

| Parametro | Default | Descrizione |
|-----------|---------|-------------|
| `quesito` | — | Quesito giuridico in linguaggio naturale (min 10 caratteri) |
| `max_provvedimenti` | 10 | Numero massimo di risultati restituiti |
| `max_pagine_serp` | 5 | Pagine SERP da scansionare per ogni query |
| `max_per_query` | 15 | Risultati massimi per query per pagina |
| `include_abstract` | true | Se cercare anche nelle abstract/massime |
| `soglia_score` | 0.1 | Score minimo per includere un provvedimento nel risultato finale |
| `soglia_apri` | 0.35 | Score estratti minimo per aprire un documento in Fase 2 |
| `max_da_aprire` | 15 | Numero massimo di documenti da aprire in Fase 2 |

**Output:**
```json
{
  "quesito": "...",
  "termini_utilizzati": { "termini_primari": [], "materia_suggerita": "...", ... },
  "fase1": { "pagine_analizzate": 5, "provvedimenti_analizzati": 75, ... },
  "fase2": { "documenti_aperti": 12, "documenti_scartati_dopo_lettura": 1 },
  "provvedimenti": [ { "estremi": "...", "_score": 0.72, "_score_dettaglio": { ... } } ],
  "n_trovati_totale": 75,
  "n_restituiti": 10,
  "errori": []
}
```

**Esempio d'uso:**
> *"Analizza il quesito: quali sono i criteri per la responsabilità medica da omessa diagnosi?"*

---

## Roadmap

### In Progress
- Pipeline `analisi_quesito_giuridico` — branch `feature/analisi-quesito-giuridico`

### Completato
- Tool atomici: `cerca_provvedimenti`, `cerca_abstract`
- Tool di lettura: `leggi_dettaglio_provvedimento`, `leggi_abstract`, `leggi_testo_provvedimento`
- Tool di navigazione e utilità
- Gestione sessione CIE e browser singleton Playwright

### Backlog
- `confronta_provvedimenti`
- `estrai_massima`
- `mappa_orientamenti`
- `ricerca_per_articolo`
- Cache locale provvedimenti
- Autenticazione CIE completa
- Rate limiting adattivo

---

## Struttura del progetto

```
mcp-bdm-civile/
├── src/
│   ├── server.js              punto di ingresso del server MCP
│   ├── auth/
│   │   ├── save-session.js    script di login CIE
│   │   └── session-manager.js carica la sessione salvata
│   ├── browser/               gestione del browser interno
│   └── tools/                 gli 11 strumenti disponibili
├── spec/                      documentazione tecnica dei selettori DOM
├── sessioni/                  diario delle sessioni di sviluppo
├── CLAUDE.md                  istruzioni tecniche per lo sviluppo
└── GUIDA.md                   guida tecnica all'architettura
```

---

## Licenza e crediti

Sviluppato da [@avvocati-e-mac](https://github.com/avvocati-e-mac).

I dati provengono dalla [Banca Dati di Merito](https://bdp.giustizia.it) del Ministero della Giustizia — accesso gratuito previa autenticazione CIE.
