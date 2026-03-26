import { z } from 'zod';
import { getPage, assertNotRedirectedToLogin } from '../browser/browser-factory.js';
import { rateLimit } from '../browser/utils.js';

const BASE_URL = 'https://bdp.giustizia.it';

const UrlSchema = z.object({
  url: z.string().url().describe('URL della pagina dettaglio (da cerca_provvedimenti o cerca_abstract)'),
});

const LeggiTestoSchema = z.object({
  url: z.string().url().describe('URL viewer provvedimento (url_visualizza_provvedimento da leggi_dettaglio_provvedimento)'),
  from: z.number().int().min(0).default(0).describe('Offset pagina per documenti multi-pagina'),
});

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerContentTools(server) {
  // Tool 3: leggi_dettaglio_provvedimento
  server.registerTool(
    'leggi_dettaglio_provvedimento',
    {
      title: 'Leggi Dettaglio Provvedimento',
      description: 'Legge metadati completi, timeline gradi di giudizio e abstract collegati di un provvedimento BDP',
      inputSchema: UrlSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const parsed = UrlSchema.safeParse(args);
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Input non valido: ${parsed.error.message}` }],
        };
      }

      const page = await getPage();
      try {
        await page.goto(parsed.data.url, { waitUntil: 'networkidle' });
        assertNotRedirectedToLogin(page);

        // Espandi l'accordion Abstract per avere accesso al contenuto inline
        const abstractAccBtn = page.locator('.accordion-button').filter({ hasText: /Abstract\s*\(\d+\)/i }).first();
        if (await abstractAccBtn.count() > 0 && !(await abstractAccBtn.isDisabled())) {
          await abstractAccBtn.click();
          await page.waitForTimeout(800);
        }

        const dettaglio = await page.evaluate((base) => {
          // Struttura pagina dettaglio verificata live (stessa della card risultati):
          // .card.card-bg > .card-body.text-secondary
          //   button.btn-link  (senza .text-break) ← titolo con badge tipo/area
          //   righe .d-lg-flex con label + .chip-label
          //   .accordion ← Abstract (N) con lista abstract collegati
          //   "Provvedimento precedente" (sezione separata)
          //
          // Bottoni azione: button[aria-label="Mostra"], button[aria-label="Scarica provvedimento"],
          //                 button[aria-label="Mostra timeline"]
          // Modal timeline: #provvedimento-timeline-modal > .modal-body > .it-timeline-wrapper

          const body = document.querySelector('.card-body') ?? document.body;

          const chipAfterLabel = (label, root = body) => {
            const divs = Array.from(root.querySelectorAll('.d-lg-flex.align-items-lg-center'));
            const div = divs.find(d => d.textContent?.includes(label));
            return Array.from(div?.querySelectorAll('.chip-label') ?? []).map(c => c.textContent.trim()).filter(Boolean);
          };

          // Tipo e area dai badge
          const badges = Array.from(body.querySelectorAll('.badge'));
          const tipo_provvedimento = badges.find(b => b.classList.contains('bg-provvedimento'))?.textContent?.trim() ?? '';
          const area = badges.find(b => b.classList.contains('bg-secondary'))?.textContent?.trim() ?? '';

          // Estremi dal titolo (breadcrumb o h1)
          const breadcrumb = document.querySelector('.breadcrumb-item.active, nav[aria-label="breadcrumb"] li:last-child');
          const titleBtn = body.querySelector('button.btn-link');
          const estremi = breadcrumb?.textContent?.trim() ?? titleBtn?.querySelector('.title-text-md')?.textContent?.trim() ?? '';

          const ufficio = chipAfterLabel('Ufficio:')[0] ?? '';
          const ruolo = chipAfterLabel('Ruolo:')[0] ?? '';
          const materia = chipAfterLabel('Materia:')[0] ?? '';
          const giudice = chipAfterLabel('Giudice assegnatario fascicolo:')[0] ?? '';
          const presidente = chipAfterLabel('Presidente:')[0] ?? '';
          const relatore = chipAfterLabel('Relatore:')[0] ?? '';
          const parole_chiave = chipAfterLabel('Parole chiave:');
          const riferimenti_normativi = chipAfterLabel('Riferimenti normativi:');

          // Abstract collegati — accordion "Abstract (N)"
          // Struttura verificata live: dentro .accordion-collapse.show .accordion-body
          // ogni abstract è una .card.card-bg con:
          //   .badge.bg-massima   → "ABSTRACT"
          //   button.btn-link.text-break .title-text-sm  → estremi provvedimento collegato
          //   button.btn-link (senza text-break) > strong → testo del principio di diritto
          //   .chip-label  → ufficio, materia, parole chiave
          const abstractAccordion = Array.from(body.querySelectorAll('.accordion-item'))
            .find(item => /Abstract\s*\(\d+\)/i.test(item.querySelector('.accordion-header')?.textContent ?? ''));
          const accordionBtn = abstractAccordion?.querySelector('.accordion-button');
          const abstractMatch = accordionBtn?.textContent?.match(/Abstract\s*\((\d+)\)/i);
          const n_abstract_collegati = abstractMatch ? parseInt(abstractMatch[1], 10) : 0;

          // Estrai abstract dall'accordion body (potrebbe non essere espanso)
          const accordionBody = abstractAccordion?.querySelector('.accordion-body');
          const abstract_collegati = Array.from(accordionBody?.querySelectorAll('.card.card-bg') ?? []).map(card => {
            const cardBody = card.querySelector('.card-body');
            const estremiBtn = cardBody?.querySelector('button.btn-link.text-break');
            const estremiAbstract = estremiBtn?.querySelector('.title-text-sm')?.textContent?.trim() ?? estremiBtn?.textContent?.trim() ?? '';
            // Testo del principio (button.btn-link senza .text-break, contiene <strong>)
            const testoBtn = Array.from(cardBody?.querySelectorAll('button.btn-link') ?? [])
              .find(b => !b.classList.contains('text-break'));
            const testo_principio = testoBtn?.querySelector('strong')?.textContent?.trim() ?? testoBtn?.textContent?.trim() ?? '';
            const chips = Array.from(cardBody?.querySelectorAll('.chip-label') ?? []).map(c => c.textContent.trim()).filter(Boolean);
            return { estremi: estremiAbstract, testo_principio, parole_chiave: chips };
          });

          // Accordion gradi: Provvedimento precedente / Esito / Provvedimento successivo
          // Se disabled → vuoto (nessun grado precedente/successivo)
          const getAccordionText = (label) => {
            const item = Array.from(body.querySelectorAll('.accordion-item'))
              .find(i => i.querySelector('.accordion-header')?.textContent?.trim() === label);
            const btn = item?.querySelector('.accordion-button');
            if (!btn || btn.disabled) return null;
            return item?.querySelector('.accordion-body')?.innerText?.trim() || null;
          };

          const url_dettaglio = window.location.href;

          return {
            tipo_provvedimento,
            area,
            estremi,
            ufficio,
            ruolo,
            materia,
            giudice,
            presidente,
            relatore,
            parole_chiave,
            riferimenti_normativi,
            n_abstract_collegati,
            abstract_collegati,
            provvedimento_precedente: getAccordionText('Provvedimento precedente'),
            esito: getAccordionText('Esito'),
            provvedimento_successivo: getAccordionText('Provvedimento successivo'),
            url_dettaglio,
          };
        }, BASE_URL);

        return { content: [{ type: 'text', text: JSON.stringify(dettaglio) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err.message }],
        };
      } finally {
        await page.close();
      }
    }
  );

  // Tool 4: leggi_abstract
  server.registerTool(
    'leggi_abstract',
    {
      title: 'Leggi Testo Abstract',
      description: 'Legge testo completo di un abstract BDP con precedenti conformi e difformi',
      inputSchema: UrlSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const parsed = UrlSchema.safeParse(args);
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Input non valido: ${parsed.error.message}` }],
        };
      }

      const page = await getPage();
      try {
        await page.goto(parsed.data.url, { waitUntil: 'networkidle' });
        assertNotRedirectedToLogin(page);
        // Attendi caricamento contenuto abstract (SPA)
        await page.waitForSelector('.title-text-lg, .text-justify', { timeout: 10000 });

        const abstract = await page.evaluate((base) => {
          // Struttura pagina /abstract/page?id=... verificata live:
          // Sezione principale (.container.mt-3):
          //   .title-text-lg > button.btn-link.text-break[aria-label="Apri provvedimento"] → estremi provvedimento
          //   div.text-justify.fw-bold → PRINCIPIO DI DIRITTO (testo in grassetto)
          //   p.text-justify.fst-italic.mt-3 → testo motivazione (in corsivo)
          //   .d-lg-flex.align-items-lg-center → ufficio/ruolo/materia/parole chiave/riferimenti normativi
          //   .accordion-item "Provvedimento" → card con metadati provvedimento
          //   .accordion-item "Precedenti conformi (N)"
          //   .accordion-item "Precedenti difformi (N)"
          // Badge tipo/area vicino all'intestazione

          // Estremi provvedimento dal titolo principale
          const titleBtn = document.querySelector('.title-text-lg button.btn-link');
          const estremi_provvedimento = titleBtn?.querySelector('.title-text-md')?.textContent?.trim() ?? titleBtn?.textContent?.trim() ?? '';

          // Badge tipo e area
          const badges = Array.from(document.querySelectorAll('.badge'));
          const tipo_provvedimento = badges.find(b => b.classList.contains('bg-provvedimento'))?.textContent?.trim() ?? '';
          const area = badges.find(b => b.classList.contains('bg-secondary'))?.textContent?.trim() ?? '';

          // Principio di diritto (div.text-justify.fw-bold)
          const principioEl = document.querySelector('div.text-justify.fw-bold');
          const testo_principio = principioEl?.textContent?.trim() ?? '';

          // Motivazione (p.text-justify.fst-italic)
          const motivazioneEl = document.querySelector('p.text-justify.fst-italic');
          const testo_motivazione = motivazioneEl?.textContent?.trim() ?? '';

          // Chips metadati
          const chipAfterLabel = (label, root = document) => {
            const divs = Array.from(root.querySelectorAll('.d-lg-flex.align-items-lg-center'));
            const div = divs.find(d => d.textContent?.includes(label));
            return Array.from(div?.querySelectorAll('.chip-label') ?? []).map(c => c.textContent.trim()).filter(Boolean);
          };

          const ufficio = chipAfterLabel('Ufficio:')[0] ?? '';
          const ruolo = chipAfterLabel('Ruolo:')[0] ?? '';
          const materia = chipAfterLabel('Materia:')[0] ?? '';
          const parole_chiave = chipAfterLabel('Parole chiave:');
          const riferimenti_normativi = chipAfterLabel('Riferimenti normativi:');

          // Conteggi precedenti
          const getN = (label) => {
            const item = Array.from(document.querySelectorAll('.accordion-item'))
              .find(i => i.querySelector('.accordion-header')?.textContent?.toLowerCase().includes(label));
            const match = item?.querySelector('.accordion-header')?.textContent?.match(/\((\d+)\)/);
            return match ? parseInt(match[1], 10) : 0;
          };
          const n_conformi = getN('conformi');
          const n_difformi = getN('difformi');

          return {
            tipo_provvedimento,
            area,
            testo_principio,
            testo_motivazione,
            estremi_provvedimento,
            ufficio,
            ruolo,
            materia,
            parole_chiave,
            riferimenti_normativi,
            n_precedenti_conformi: n_conformi,
            n_precedenti_difformi: n_difformi,
            url_abstract: window.location.href,
          };
        }, BASE_URL);

        return { content: [{ type: 'text', text: JSON.stringify(abstract) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err.message }],
        };
      } finally {
        await page.close();
      }
    }
  );

  // Tool 5: leggi_testo_provvedimento
  server.registerTool(
    'leggi_testo_provvedimento',
    {
      title: 'Leggi Testo Integrale Provvedimento',
      description: 'Estrae il testo integrale anonimizzato di un provvedimento aprendolo dalla pagina dettaglio e cliccando "Mostra". Il testo completo (tutte le pagine) è nel DOM in .visually-hidden dentro #document-modal.',
      inputSchema: UrlSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const parsed = UrlSchema.safeParse(args);
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Input non valido: ${parsed.error.message}` }],
        };
      }

      const page = await getPage();
      try {
        await page.goto(parsed.data.url, { waitUntil: 'networkidle' });
        assertNotRedirectedToLogin(page);
        await rateLimit(page);

        // Clicca il bottone "Mostra" per aprire il viewer #document-modal
        await page.locator('button[aria-label="Mostra"]').click();

        // Attendi che il modal sia visibile e il testo caricato
        await page.waitForSelector('#document-modal.show', { timeout: 15000 });
        await page.waitForSelector('#document-modal .visually-hidden', { timeout: 15000 });
        await page.waitForTimeout(2000); // attesa extra rendering PDF.js

        const testo = await page.evaluate(() => {
          // Il testo completo del documento (tutte le pagine) è in un singolo
          // .visually-hidden dentro #document-modal — verificato live.
          return document.querySelector('#document-modal .visually-hidden')?.innerText?.trim() ?? '';
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({ testo, lunghezza: testo.length }) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err.message }],
        };
      } finally {
        await page.close();
      }
    }
  );
}
