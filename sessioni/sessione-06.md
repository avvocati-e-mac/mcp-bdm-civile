# Sessione 06 — 2026-03-26

## Obiettivo
Aggiornare il server MCP allo standard 2025 (spec 2025-03-26 e 2025-06-18) su branch dedicato.
Creare README per utenti non tecnici e pubblicare il repository su GitHub.

## Branch
`mcp-2025-upgrade` (da `main`)

## Lavoro completato

### Pubblicazione GitHub
- Repository creato: https://github.com/avvocati-e-mac/mcp-bdp-merito
- `gh` installato via Homebrew
- Autenticazione GitHub completata (gh auth login)

### README.md
Creato `README.md` per avvocati non esperti:
- Cosa serve (Mac, Claude Desktop, Node.js, CIE, app CieID)
- Installazione passo-passo (clone, npm install, login CIE, configurazione Claude Desktop)
- Esempi di domande in italiano
- Sezione rinnovo sessione quando scade
- FAQ (browser in background, sicurezza dati, Windows, troubleshooting)

---

## Aggiornamenti MCP 2025 — branch mcp-2025-upgrade

### Step 1 — package.json (commit 46c9b9e) ✅
- `"@modelcontextprotocol/sdk": "latest"` → `"^1.10.0"`
- SDK installato: 1.28.0 (soddisfa ^1.10.0)

### Step 2 — server.js (commit 0a4258d) ✅
- Aggiunto `description` all'init `McpServer` (spec 2025-11-25)

### Step 3 — session-manager.js (commit a735f8c) ✅
- Path relativo `./session.json` → path assoluto basato su `import.meta.url`
- Fix: Claude Desktop lancia il server con CWD variabile

### Step 4 — Migrazione a registerTool (commit 978d21b) ✅
Tutti gli 11 tool migrati da `server.tool()` (deprecated) a `server.registerTool()` con:
- `title` human-readable separato dal `name` programmatico
- `annotations.readOnlyHint: true` (tutti i tool sono read-only)
- `annotations.idempotentHint: true/false` secondo la tabella del prompt
- `structuredContent` aggiunto a `verifica_sessione`, `ottieni_materie`, `ottieni_distretti`

Firma usata (verificata in `mcp.d.ts`):
```js
server.registerTool(name, { title, description, inputSchema, annotations }, callback)
```

### Step 5 — Rimozione doppia validazione Zod (commit d38872a) ✅
Rimossi i `safeParse` ridondanti da tutti i tool in:
- `src/tools/search.js`
- `src/tools/content.js`
- `src/tools/navigation.js`

Tutti i riferimenti `parsed.data.campo` sostituiti con `args.campo`.
Server verificato avviabile con `echo "" | node src/server.js`.

### Step 6 — outputSchema per tool utility (commit dc51ad6) ✅
Aggiunto `outputSchema` Zod a `verifica_sessione`, `ottieni_materie`, `ottieni_distretti`:
```js
outputSchema: z.object({ materie: z.array(z.string()) })
```
`structuredContent` era già presente — ora il contratto output è esplicito e validato dalla SDK.

---

## Test live — branch mcp-2025-upgrade

Tutti gli 11 tool testati via `node -e` con browser Playwright su sessione CIE reale.

| Tool | Esito | Dettaglio |
|------|-------|-----------|
| `verifica_sessione` | ✅ | `{ valida: true, messaggio: 'Sessione attiva' }` — structuredContent OK |
| `ottieni_materie` | ✅ | 66 materie estratte da `#materia option` |
| `ottieni_distretti` | ✅ | 26 distretti estratti da `#distretto option` |
| `cerca_provvedimenti` | ✅ | 3 risultati per query "locazione"; tipo/area/estremi/ufficio/estratti corretti |
| `cerca_abstract` | ✅ | 2 risultati; testo_principio/estremi_provvedimento/parole_chiave corretti |
| `leggi_dettaglio_provvedimento` | ✅ | Tutti i metadati; giudice/ruolo/materia/parole_chiave/abstract_collegati |
| `leggi_testo_provvedimento` | ✅ | 11.435 caratteri estratti da `#document-modal .visually-hidden` |
| `leggi_abstract` | ✅ | testo_principio/testo_motivazione/precedenti conformi+difformi |
| `naviga_archivio` | ✅ | 26 voci alla root `/archivio/home` |
| `ottieni_timeline` | ✅ | 1 grado con `corrente: true`; struttura `{ gradi, n_gradi }` corretta |
| `ottieni_precedenti` | ✅ | `{ conformi: [], difformi: [] }` (0 precedenti — atteso) |

### URL usati nei test
```
Provvedimento: https://bdp.giustizia.it/provvedimento/page?from=0&size=1&area=CIVILE&target=provvedimento&sort_field=_score&sort_order=desc&q=anonymized_testo%3A%22LOCAZIONE%22
Abstract:      https://bdp.giustizia.it/abstract/page?from=0&size=1&area=CIVILE&target=abstract&sort_field=_score&sort_order=desc&q=testo%3A%22LOCAZIONE%22+anonymized_testo%3A%22LOCAZIONE%22
```

### Note sui test
- Gli URL SPA con query string (senza `id=HASH`) sono navigabili direttamente ✅
- `save-session.js` deve essere eseguito dalla root del progetto (`cd ... && node src/auth/save-session.js`) — il path `./session.json` è relativo alla CWD, non al file
- `leggi_dettaglio_provvedimento` non espone `url_visualizza_provvedimento` nel return — ma `leggi_testo_provvedimento` accetta lo stesso URL della pagina dettaglio e clicca "Mostra" autonomamente
- `ottieni_precedenti` con N>0 non ancora testato live (BDP ha pochi abstract con precedenti)

## Note tecniche
- `server.tool()` è deprecato nella SDK 1.28.0, ma ancora funzionante
- `registerTool` accetta `inputSchema` come Zod schema intero (non `.shape`)
- `structuredContent` è nel tipo `CallToolResult` come `Record<string, unknown>`
- I tool registrati espongono `.handler` (non `.callback`) — usare `tool.handler({}, {})` nei test
- Il test `echo "" | node src/server.js` verifica import/sintassi senza avviare il browser

## Stato finale branch
Tutti e 6 gli step completati e committati. Branch `mcp-2025-upgrade` pronto per merge su `main`.

---

## Test use-case reale — Sentenza Tribunale di Salerno n. 3773/2024

### Ricerca eseguita
Tentato recupero e riassunto della sentenza:
`TRIBUNALE DI SALERNO N. 3773/2024 - N. R.G. 00001611/2020 DEPOSITO MINUTA 15/07/2024`

### Esito `cerca_provvedimenti`
Tool ha trovato il provvedimento correttamente:
```json
{
  "tipo_provvedimento": "SENTENZA",
  "area": "CIVILE",
  "estremi": "TRIBUNALE DI SALERNO N. 3773/2024 - N. R.G. 00001611/2020 DEPOSITO MINUTA 15/07/2024 PUBBLICAZIONE 15/07/2024",
  "ufficio": "TRIBUNALE DI SALERNO",
  "ruolo": "GENERALE DEGLI AFFARI CIVILI CONTENZIOSI",
  "materia": "ALTRI ISTITUTI E LEGGI SPECIALI IN GENERE",
  "parole_chiave": ["ALTRI ISTITUTI E LEGGI SPECIALI"]
}
```

### Bug identificato: `link_dettaglio` mancante
`cerca_provvedimenti` non restituisce l'URL del dettaglio perché il sito BDP usa una SPA:
i titoli delle card sono `<button>` (non `<a href>`), quindi l'URL non è estraibile staticamente.

`leggi_testo_provvedimento` e `leggi_dettaglio_provvedimento` richiedono un URL diretto,
ma senza `link_dettaglio` non c'è modo di passarlo.

### Fix applicato a `search.js`
Modificata `eseguiRicerca` per, dopo ogni estrazione card, cliccare il titolo e catturare l'URL SPA:
```js
await btn.click();
await page.waitForURL(/\/provvedimento\/page|\/abstract\/page/, { timeout: 10000 });
card.link_dettaglio = page.url();
await page.goBack({ waitUntil: 'networkidle' });
```
Il campo `link_dettaglio` viene ora popolato su ogni card risultato.

### Problema aperto: riavvio server MCP necessario
Le modifiche a `search.js` richiedono il riavvio del server MCP (processo gestito da Claude Desktop).
Senza riavvio, il codice vecchio continua a girare e `link_dettaglio` rimane `null`.

Soluzione alternativa tentata: navigazione via `naviga_archivio` → SALERNO → TRIBUNALE DI SALERNO
→ ALTRI ISTITUTI E LEGGI SPECIALI IN GENERE → 2024 → LUGLIO → 42 provvedimenti.
`leggi_testo_provvedimento` sull'URL archivio ha fallito per strict mode violation
(10 bottoni "Mostra" in pagina, il tool usa `.click()` senza `.first()`).

### Prossimi passi
1. Riavviare il server MCP da Claude Desktop
2. Rieseguire `cerca_provvedimenti` → ottenere `link_dettaglio`
3. Passarlo a `leggi_testo_provvedimento` per estrarre e riassumere il testo integrale
4. In alternativa: modificare `content.js` per usare `.first()` su "Mostra" quando la pagina
   è un archivio con più provvedimenti (attualmente strict mode lancia errore)
