import { z } from 'zod';
import { getPage, assertNotRedirectedToLogin } from '../browser/browser-factory.js';
import { rateLimit } from '../browser/utils.js';

const BASE_URL = 'https://bdp.giustizia.it';

// Mappa enum schema → label testuale nel select BDP
const TIPO_RICERCA_LABEL = {
  ALMENO_UNA_PAROLA: 'ALMENO UNA PAROLA',
  TUTTE_LE_PAROLE: 'TUTTE LE PAROLE',
  FRASE_ESATTA: 'FRASE ESATTA',
};

const CercaProvvedimentiSchema = z.object({
  query: z.string().optional(),
  tipo: z.enum(['TUTTI', 'SENTENZA', 'ORDINANZA', 'DECRETO']).default('TUTTI'),
  distretto: z.string().optional(),
  materia: z.string().optional(),
  tipo_ricerca: z.enum(['ALMENO_UNA_PAROLA', 'TUTTE_LE_PAROLE', 'FRASE_ESATTA']).default('TUTTE_LE_PAROLE'),
  numero: z.string().optional(),
  anno: z.number().int().optional(),
  numero_ruolo: z.string().optional(),
  anno_ruolo: z.number().int().optional(),
  riferimento_normativo: z.string().optional(),
  parola_chiave: z.string().optional(),
  full_text: z.string().optional(),
  data_da: z.string().optional(),
  data_a: z.string().optional(),
  tipo_data: z.enum(['DATA', 'DATA_PUBBLICAZIONE']).default('DATA'),
  sort_field: z.enum(['data', 'rilevanza']).default('data'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
  max_results: z.number().int().min(1).max(100).default(20),
  nelle_cartelle: z.boolean().default(false),
});

const CercaAbstractSchema = z.object({
  query: z.string().optional(),
  tipo: z.enum(['TUTTI', 'SENTENZA', 'ORDINANZA', 'DECRETO']).default('TUTTI'),
  distretto: z.string().optional(),
  materia: z.string().optional(),
  tipo_ricerca: z.enum(['ALMENO_UNA_PAROLA', 'TUTTE_LE_PAROLE', 'FRASE_ESATTA']).default('TUTTE_LE_PAROLE'),
  numero: z.string().optional(),
  anno: z.number().int().optional(),
  numero_ruolo: z.string().optional(),
  anno_ruolo: z.number().int().optional(),
  riferimento_normativo: z.string().optional(),
  parola_chiave: z.string().optional(),
  full_text: z.string().optional(),
  titolo_abstract: z.string().optional(),
  testo_abstract: z.string().optional(),
  data_da: z.string().optional(),
  data_a: z.string().optional(),
  tipo_data: z.enum(['DATA', 'DATA_PUBBLICAZIONE']).default('DATA'),
  sort_field: z.enum(['data', 'rilevanza']).default('data'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
  max_results: z.number().int().min(1).max(100).default(20),
  nelle_cartelle: z.boolean().default(false),
});

/**
 * Compila il form di ricerca BDP con i parametri forniti.
 * Salta silenziosamente i campi undefined/null.
 * @param {import('playwright').Page} page
 * @param {object} p - parametri già validati
 * @param {'provvedimento'|'abstract'} target
 */
async function compilaForm(page, p, target) {
  // Radio tipo pubblicazione — id reali verificati live
  if (target === 'abstract') {
    await page.locator('#target-massima').check();
    await rateLimit(page);
  } else {
    await page.locator('#target-provvedimento').check();
  }

  // Checkbox "Cerca nelle cartelle personali"
  if (p.nelle_cartelle) {
    await page.locator('#collated-toggle').first().check();
  }

  // Select Tipo provvedimento (id="tipo", valore '' = TUTTI)
  if (p.tipo && p.tipo !== 'TUTTI') {
    await page.locator('#tipo').selectOption({ label: p.tipo });
  }

  // Select Distretto (id="distretto")
  if (p.distretto) {
    await page.locator('#distretto').selectOption({ label: p.distretto });
  }

  // Select Materia (id="materia")
  if (p.materia) {
    await page.locator('#materia').selectOption({ label: p.materia });
  }

  // Select Tipo ricerca (id="ricerca_testuale")
  if (p.tipo_ricerca) {
    await page.locator('#ricerca_testuale').selectOption({ label: TIPO_RICERCA_LABEL[p.tipo_ricerca] });
  }

  // Input testuale principale / full_text (id="testo")
  const testoQuery = p.query || p.full_text;
  if (testoQuery) {
    await page.locator('#testo').fill(testoQuery);
  }

  // Numero e anno provvedimento
  if (p.numero) {
    await page.locator('#numero_provvedimento').fill(String(p.numero));
  }
  if (p.anno) {
    await page.locator('#anno_provvedimento').fill(String(p.anno));
  }

  // Numero e anno ruolo
  if (p.numero_ruolo) {
    await page.locator('#numero_ruolo').fill(String(p.numero_ruolo));
  }
  if (p.anno_ruolo) {
    await page.locator('#anno_ruolo').fill(String(p.anno_ruolo));
  }

  // Riferimento normativo (id="riferimento_normativo")
  if (p.riferimento_normativo) {
    await page.locator('#riferimento_normativo').fill(p.riferimento_normativo);
  }

  // Parola chiave (id="parola_chiave")
  if (p.parola_chiave) {
    await page.locator('#parola_chiave').fill(p.parola_chiave);
  }

  // Campi esclusivi abstract — selettori da verificare live con ricerca abstract
  if (target === 'abstract') {
    if (p.titolo_abstract) {
      const titleInput = page.locator('[aria-label="Titolo abstract"], [aria-label="Titolo"]').first();
      if (await titleInput.count() > 0) await titleInput.fill(p.titolo_abstract);
    }
    if (p.testo_abstract) {
      const testoInput = page.locator('[aria-label="Testo abstract"], [aria-label="Testo massima"]').first();
      if (await testoInput.count() > 0) await testoInput.fill(p.testo_abstract);
    }
  }

  // Date — il tipo data è un select (id="date-range-filter-modal-type" con opzioni vuota/Data deposito minuta/Data pubblicazione)
  // I datepicker si aprono con bottoni .btn-calendar; compiliamo i campi di testo associati
  if (p.data_da || p.data_a) {
    // Tipo data (opzionale)
    if (p.tipo_data === 'DATA_PUBBLICAZIONE') {
      await page.locator('#date-range-filter-modal-type').selectOption({ label: 'Data pubblicazione' });
    }
    // Gli input data sono identificati da aria-label sul bottone calendario adiacente
    if (p.data_da) {
      // Bottone "Data deposito minuta da" apre il datepicker; proviamo fill diretto sull'input vicino
      const inputDa = page.locator('[aria-label="Data deposito minuta da"]').locator('..').locator('input').first();
      if (await inputDa.count() > 0) await inputDa.fill(p.data_da);
    }
    if (p.data_a) {
      const inputA = page.locator('[aria-label="Data deposito minuta a"]').locator('..').locator('input').first();
      if (await inputA.count() > 0) await inputA.fill(p.data_a);
    }
  }
}

/**
 * Estrae le card provvedimento dalla pagina risultati.
 * @param {import('playwright').Page} page
 * @param {string} baseUrl
 * @returns {Promise<object[]>}
 */
async function estraiCardProvvedimento(page, baseUrl) {
  return page.evaluate((base) => {
    // Struttura verificata live:
    // .card.card-bg > .card-body.text-secondary
    //   button.btn-link.text-break  ← titolo cliccabile (apre dettaglio, non ha href)
    //     .badge.bg-provvedimento   ← tipo (SENTENZA/ORDINANZA/DECRETO)
    //     .badge.bg-secondary       ← area (CIVILE/PENALE)
    //     .title-text-md > strong   ← ufficio + estremi
    //   "Ufficio: " + .chip-label
    //   "Ruolo: "   + .chip-label
    //   "Materia: " + .chip-label
    //   "Parole chiave: " + .chip-label[]
    //   "Riferimenti normativi: " + .chip-label[] | .unavailable
    //   .accordion  ← "Abstract (N)"
    //   .estratto   ← estratti testo con <mark>
    //
    // Il click sul titolo naviga alla pagina dettaglio (SPA navigation).
    // L'URL dettaglio ha pattern: /provvedimento/page?from=0&size=1&area=CIVILE&...
    // Non è estraibile direttamente dalla card — viene ricostruito navigando.

    const cards = document.querySelectorAll('.card.card-bg');
    return Array.from(cards).map((card) => {
      const body = card.querySelector('.card-body');
      if (!body) return null;

      // Tipo e area dai badge nel titolo
      const badges = Array.from(body.querySelectorAll('.badge'));
      const tipo_provvedimento = badges.find(b => b.classList.contains('bg-provvedimento'))?.textContent?.trim() ?? '';
      const area = badges.find(b => b.classList.contains('bg-secondary'))?.textContent?.trim() ?? '';

      // Estremi dal testo del titolo (button.btn-link.text-break)
      const titleBtn = body.querySelector('button.btn-link.text-break');
      const titleText = titleBtn?.querySelector('.title-text-md')?.textContent?.trim() ?? titleBtn?.textContent?.trim() ?? '';

      // Helper: legge il chip-label del primo chip dopo una label testuale
      const chipAfterLabel = (label) => {
        const divs = Array.from(body.querySelectorAll('.d-lg-flex.align-items-lg-center'));
        const div = divs.find(d => d.textContent?.includes(label));
        return Array.from(div?.querySelectorAll('.chip-label') ?? []).map(c => c.textContent.trim()).filter(Boolean);
      };

      const uffici = chipAfterLabel('Ufficio:');
      const ufficio = uffici[0] ?? '';
      const ruolo = chipAfterLabel('Ruolo:')[0] ?? '';
      const materia = chipAfterLabel('Materia:')[0] ?? '';
      const parole_chiave = chipAfterLabel('Parole chiave:');
      const riferimenti_normativi = chipAfterLabel('Riferimenti normativi:');

      // Numero abstract collegati dall'accordion header
      const accordionBtn = body.querySelector('.accordion-button');
      const abstractMatch = accordionBtn?.textContent?.match(/Abstract\s*\((\d+)\)/i);
      const n_abstract_collegati = abstractMatch ? parseInt(abstractMatch[1], 10) : 0;

      // Estratti di testo (snippet con <mark>)
      const estratti = Array.from(body.querySelectorAll('.estratto li')).map(li => li.textContent?.trim() ?? '').filter(Boolean);

      // Prova a estrarre l'id dall'attributo data-* o onclick del button
      const idMatch = titleBtn?.getAttribute('onclick')?.match(/id=([^&'"]+)/) ??
                      titleBtn?.getAttribute('data-id')?.match(/(.+)/);
      const link_dettaglio = null; // sarà popolato dopo il click

      return {
        tipo_provvedimento,
        area,
        estremi: titleText,
        ufficio,
        ruolo,
        materia,
        parole_chiave,
        riferimenti_normativi,
        n_abstract_collegati,
        estratti,
        link_dettaglio,
      };
    }).filter(Boolean);
  }, baseUrl);
}

/**
 * Estrae le card abstract dalla pagina risultati.
 * @param {import('playwright').Page} page
 * @param {string} baseUrl
 * @returns {Promise<object[]>}
 */
async function estraiCardAbstract(page, baseUrl) {
  // Struttura card abstract verificata live (uguale alla card provvedimento ma con .bg-massima):
  // .card.card-bg > .card-body
  //   .badge.bg-massima → "ABSTRACT"
  //   .badge.bg-provvedimento → tipo (SENTENZA/DECRETO/ORDINANZA)
  //   .badge.bg-secondary → area (CIVILE/PENALE)
  //   button.btn-link.text-break [aria-label="Apri provvedimento"] → estremi del provvedimento collegato
  //     .title-text-sm > strong → ufficio, numero, data
  //   button.btn-link (senza .text-break) → testo principio (dentro <strong>)
  //   .d-lg-flex.align-items-lg-center → ufficio/ruolo/materia/parole chiave
  //   .accordion → conteggi precedenti conformi/difformi nel testo header (disabled se 0)
  return page.evaluate((base) => {
    const cards = document.querySelectorAll('.card.card-bg');
    return Array.from(cards).map((card) => {
      const body = card.querySelector('.card-body');
      if (!body) return null;

      // Salta card che non sono abstract
      if (!body.querySelector('.badge.bg-massima')) return null;

      const badges = Array.from(body.querySelectorAll('.badge'));
      const tipo_provvedimento = badges.find(b => b.classList.contains('bg-provvedimento'))?.textContent?.trim() ?? '';
      const area = badges.find(b => b.classList.contains('bg-secondary'))?.textContent?.trim() ?? '';

      // Estremi del provvedimento collegato (button con aria-label="Apri provvedimento")
      const provvBtn = body.querySelector('button.btn-link.text-break[aria-label="Apri provvedimento"]');
      const estremi_provvedimento = provvBtn?.querySelector('.title-text-sm')?.textContent?.trim() ?? provvBtn?.textContent?.trim() ?? '';

      // Testo principio di diritto (button.btn-link senza .text-break, contiene <strong>)
      const testoBtn = Array.from(body.querySelectorAll('button.btn-link'))
        .find(b => !b.classList.contains('text-break') && !b.getAttribute('aria-label'));
      const testo_principio = testoBtn?.querySelector('strong')?.textContent?.trim() ?? testoBtn?.textContent?.trim() ?? '';

      const chipAfterLabel = (label) => {
        const divs = Array.from(body.querySelectorAll('.d-lg-flex.align-items-lg-center'));
        const div = divs.find(d => d.textContent?.includes(label));
        return Array.from(div?.querySelectorAll('.chip-label') ?? []).map(c => c.textContent.trim()).filter(Boolean);
      };

      const ufficio = chipAfterLabel('Ufficio:')[0] ?? '';
      const ruolo = chipAfterLabel('Ruolo:')[0] ?? '';
      const materia = chipAfterLabel('Materia:')[0] ?? '';
      const parole_chiave = chipAfterLabel('Parole chiave:');
      const riferimenti_normativi = chipAfterLabel('Riferimenti normativi:');

      return {
        tipo_provvedimento,
        area,
        testo_principio: testo_principio.substring(0, 500),
        estremi_provvedimento,
        ufficio,
        ruolo,
        materia,
        parole_chiave,
        riferimenti_normativi,
      };
    }).filter(Boolean);
  }, baseUrl);
}

/**
 * Logica comune di ricerca per provvedimenti e abstract.
 * @param {'provvedimento'|'abstract'} target
 * @param {object} p - parametri validati
 * @param {Function} estraiCard - funzione di estrazione card specifica
 */
async function eseguiRicerca(target, p, estraiCard) {
  const page = await getPage();
  try {
    const url = `${BASE_URL}/search/standard?target=${target}&sort_field=${p.sort_field}&sort_order=${p.sort_order}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    assertNotRedirectedToLogin(page);

    await compilaForm(page, p, target);
    await rateLimit(page);

    // Click bottone Ricerca (aria-label="Ricerca", class="btn btn-primary ms-3 flex-fill")
    await page.locator('button[aria-label="Ricerca"]').click();

    // Attendi che le card risultato siano nel DOM (la SPA carica in modo asincrono)
    try {
      await page.waitForSelector('.card.card-bg .btn-link.text-break', { timeout: 20000 });
    } catch {
      // Nessun risultato trovato — verifica redirect login prima di restituire array vuoto
    }
    await page.waitForLoadState('networkidle');
    assertNotRedirectedToLogin(page);

    const results = [];

    // Paginazione: estrai fino a max_results
    while (results.length < p.max_results) {
      const pagina = await estraiCard(page, BASE_URL);
      if (pagina.length === 0) break;

      // Per ogni card estratta, clicca il titolo per catturare l'URL del dettaglio
      for (let i = 0; i < pagina.length && results.length < p.max_results; i++) {
        const card = pagina[i];
        const titleBtns = page.locator('.card.card-bg .btn-link.text-break');
        const btn = titleBtns.nth(i);
        if (await btn.count() > 0) {
          await btn.click();
          try {
            await page.waitForURL(/\/provvedimento\/page|\/abstract\/page/, { timeout: 10000 });
            card.link_dettaglio = page.url();
          } catch {
            card.link_dettaglio = null;
          }
          // Torna alla pagina dei risultati
          await page.goBack({ waitUntil: 'networkidle' });
          try {
            await page.waitForSelector('.card.card-bg .btn-link.text-break', { timeout: 15000 });
          } catch { /* ignora */ }
          await rateLimit(page);
        }
        results.push(card);
      }

      if (results.length >= p.max_results) break;

      // Paginatore verificato live: button[aria-label="Pagina successiva"] con testo "Successiva"
      const nextBtn = page.locator('button[aria-label="Pagina successiva"]').first();

      if (await nextBtn.count() === 0 || !(await nextBtn.isEnabled())) break;

      await nextBtn.click();
      try {
        await page.waitForSelector('.card.card-bg .btn-link.text-break', { timeout: 20000 });
      } catch { /* ignora */ }
      await page.waitForLoadState('networkidle');
      assertNotRedirectedToLogin(page);
      await rateLimit(page);
    }

    return results.slice(0, p.max_results);
  } finally {
    await page.close();
  }
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerSearchTools(server) {
  server.registerTool(
    'cerca_provvedimenti',
    {
      title: 'Cerca Provvedimenti BDP',
      description: 'Cerca provvedimenti (sentenze, decreti, ordinanze) nella Banca Dati del Merito del Ministero della Giustizia',
      inputSchema: CercaProvvedimentiSchema,
      annotations: { readOnlyHint: true, idempotentHint: false },
    },
    async (args) => {
      try {
        const results = await eseguiRicerca('provvedimento', args, estraiCardProvvedimento);
        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err.message }],
        };
      }
    }
  );

  server.registerTool(
    'cerca_abstract',
    {
      title: 'Cerca Abstract / Massime BDP',
      description: 'Cerca abstract/massime redazionali nella Banca Dati del Merito del Ministero della Giustizia',
      inputSchema: CercaAbstractSchema,
      annotations: { readOnlyHint: true, idempotentHint: false },
    },
    async (args) => {
      try {
        const results = await eseguiRicerca('abstract', args, estraiCardAbstract);
        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err.message }],
        };
      }
    }
  );
}
