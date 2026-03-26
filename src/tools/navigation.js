import { z } from 'zod';
import { getPage, assertNotRedirectedToLogin } from '../browser/browser-factory.js';
import { rateLimit } from '../browser/utils.js';

const BASE_URL = 'https://bdp.giustizia.it';

const NavigaArchivioSchema = z.object({
  distretto: z.string().optional(),
  ufficio: z.string().optional(),
  materia: z.string().optional(),
  anno: z.number().int().optional(),
  mese: z.number().int().min(1).max(12).optional(),
  target: z.enum(['provvedimento', 'abstract']).default('provvedimento'),
  max_results: z.number().int().max(50).default(20),
});

const UrlSchema = z.object({ url: z.string().url() });

const OttieniPrecedentiSchema = z.object({
  url: z.string().url().describe('URL pagina dettaglio abstract'),
  tipo: z.enum(['conformi', 'difformi', 'entrambi']).default('entrambi'),
});

/**
 * Costruisce l'URL archivio.
 * Struttura verificata live: /archivio/home (home), /archivio/{DISTRETTO}, ecc.
 * La gerarchia è: home → distretto → ufficio → materia (navigazione a click).
 */
function buildArchiveUrl(p) {
  if (p.distretto) {
    return `${BASE_URL}/archivio/${encodeURIComponent(p.distretto)}`;
  }
  return `${BASE_URL}/archivio/home`;
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerNavigationTools(server) {
  // Tool 6: naviga_archivio
  server.registerTool(
    'naviga_archivio',
    {
      title: 'Naviga Archivio BDP',
      description: 'Naviga la struttura gerarchica dell\'archivio BDP: Distretto → Ufficio → Materia → Anno → Mese',
      inputSchema: NavigaArchivioSchema,
      annotations: { readOnlyHint: true, idempotentHint: false },
    },
    async (args) => {
      const p = args;
      const page = await getPage();
      try {
        const archiveUrl = buildArchiveUrl(p);
        await page.goto(archiveUrl, { waitUntil: 'networkidle' });
        assertNotRedirectedToLogin(page);
        await page.waitForTimeout(2000);

        // Naviga via click gerarchicamente se necessario (ufficio, materia, anno, mese)
        // I link dell'archivio usano href=/archivio/{DISTRETTO} ecc.
        if (p.ufficio) {
          const link = page.locator(`a:has-text("${p.ufficio}")`).first();
          if (await link.count() > 0) { await link.click(); await page.waitForLoadState('networkidle'); await rateLimit(page); }
        }
        if (p.materia) {
          const link = page.locator(`a:has-text("${p.materia}")`).first();
          if (await link.count() > 0) { await link.click(); await page.waitForLoadState('networkidle'); await rateLimit(page); }
        }
        if (p.anno) {
          const link = page.locator(`a:has-text("${p.anno}")`).first();
          if (await link.count() > 0) { await link.click(); await page.waitForLoadState('networkidle'); await rateLimit(page); }
        }
        if (p.mese) {
          const nomiMese = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
            'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
          const link = page.locator(`a:has-text("${nomiMese[p.mese]}")`).first();
          if (await link.count() > 0) { await link.click(); await page.waitForLoadState('networkidle'); await rateLimit(page); }
        }

        assertNotRedirectedToLogin(page);

        // Estrai la struttura corrente della pagina archivio.
        // Struttura verificata live:
        //   /archivio/home → link a[href^="/archivio/"] con testo = nome distretto
        //   /archivio/DISTRETTO → link a[href^="/archivio/"] con testo = nome ufficio
        //   /archivio/DISTRETTO/UFFICIO → link a[href^="/archivio/"] con testo = materia
        const risultati = await page.evaluate((base) => {
          // Tutti i link interni all'archivio (escluso il link "Archivio" breadcrumb che punta a /archivio/home)
          const tileLinks = Array.from(document.querySelectorAll('a[href^="/archivio/"]'))
            .filter(a => a.getAttribute('href') !== '/archivio/home')
            .map(a => {
              const parent = a.closest('.card, [class*="item"], [class*="tile"]') ?? a.parentElement;
              const countsText = parent?.textContent?.replace(a.textContent ?? '', '').trim() ?? '';
              return { nome: a.textContent?.trim(), url: base + a.getAttribute('href'), info: countsText.substring(0, 80) };
            }).filter(t => t.nome);

          if (tileLinks.length > 0) return { tipo: 'navigazione', voci: tileLinks.slice(0, 50) };

          // Livello card risultati (provvedimenti/abstract)
          const cards = Array.from(document.querySelectorAll('.card.card-bg'));
          if (cards.length > 0) {
            return {
              tipo: 'risultati',
              voci: cards.map(card => {
                const body = card.querySelector('.card-body');
                const tipo = body?.querySelector('.badge.bg-provvedimento')?.textContent?.trim() ?? '';
                const estremi = body?.querySelector('button.btn-link.text-break .title-text-md')?.textContent?.trim() ?? '';
                return { tipo, estremi };
              })
            };
          }

          // Fallback
          return { tipo: 'vuoto', url_corrente: window.location.href };
        }, BASE_URL);

        // Limita voci se presente
        if (risultati.voci) risultati.voci = risultati.voci.slice(0, p.max_results);
        return {
          content: [{ type: 'text', text: JSON.stringify(risultati) }],
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

  // Tool 7: ottieni_timeline
  server.registerTool(
    'ottieni_timeline',
    {
      title: 'Ottieni Timeline Gradi di Giudizio',
      description: 'Estrae la catena dei gradi di giudizio dalla pagina dettaglio di un provvedimento BDP',
      inputSchema: UrlSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const page = await getPage();
      try {
        await page.goto(args.url, { waitUntil: 'networkidle' });
        assertNotRedirectedToLogin(page);

        // Apri il modal timeline cliccando il bottone dedicato
        await page.locator('button[aria-label="Mostra timeline"]').click();
        await page.waitForTimeout(1500);

        const timeline = await page.evaluate(() => {
          // Modal timeline verificato live: #provvedimento-timeline-modal
          // Struttura: .it-timeline-wrapper > .row > .col-12 > .timeline-element[]
          //   .timeline-element > .it-pin-wrapper > .pin-text > button.btn-link > span  ← estremi
          //   Elemento corrente ha .it-now sulla .it-pin-wrapper
          const modal = document.querySelector('#provvedimento-timeline-modal');
          const wrapper = modal?.querySelector('.it-timeline-wrapper');

          const gradi = Array.from(wrapper?.querySelectorAll('.timeline-element') ?? []).map(el => {
            const pinWrapper = el.querySelector('.it-pin-wrapper');
            const isCurrente = pinWrapper?.classList.contains('it-now') ?? false;
            const estremiBtn = el.querySelector('.pin-text button.btn-link');
            const estremi = estremiBtn?.querySelector('span')?.textContent?.trim() ?? estremiBtn?.textContent?.trim() ?? '';
            const cardText = el.querySelector('.card-body')?.innerText?.trim() ?? '';
            return { estremi, corrente: isCurrente, info: cardText.substring(0, 100) };
          }).filter(g => g.estremi);

          return { gradi, n_gradi: gradi.length };
        });

        return { content: [{ type: 'text', text: JSON.stringify(timeline) }] };
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

  // Tool 8: ottieni_precedenti
  server.registerTool(
    'ottieni_precedenti',
    {
      title: 'Ottieni Precedenti Conformi/Difformi',
      description: 'Estrae la lista di precedenti conformi e/o difformi dalla pagina dettaglio di un abstract BDP',
      inputSchema: OttieniPrecedentiSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { url, tipo } = args;
      const page = await getPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle' });
        assertNotRedirectedToLogin(page);
        // Attendi caricamento SPA (pagina /abstract/page?id=...)
        await page.waitForSelector('.title-text-lg, .text-justify, .accordion-item', { timeout: 10000 });

        // Espandi gli accordion dei precedenti richiesti
        const accordionBtns = page.locator('.accordion-button');
        const nBtns = await accordionBtns.count();
        for (let i = 0; i < nBtns; i++) {
          const btn = accordionBtns.nth(i);
          const label = (await btn.textContent() ?? '').toLowerCase();
          const isDisabled = await btn.isDisabled();
          if (isDisabled) continue;
          if (
            (tipo === 'conformi' || tipo === 'entrambi') && label.includes('conformi') ||
            (tipo === 'difformi' || tipo === 'entrambi') && label.includes('difformi')
          ) {
            const expanded = await btn.getAttribute('aria-expanded');
            if (expanded !== 'true') {
              await btn.click();
              await page.waitForTimeout(600);
            }
          }
        }

        const precedenti = await page.evaluate((params) => {
          const { base, tipo } = params;
          // Struttura accordion precedenti in /abstract/page?id=... verificata:
          // .accordion-item con header "Precedenti conformi (N)" / "Precedenti difformi (N)"
          // Quando N=0 il bottone è disabled.
          // Struttura corpo (da verificare live su abstract con precedenti > 0):
          // Probabilmente una lista di button.btn-link con .title-text-sm o .title-text-md
          const result = { conformi: [], difformi: [] };

          const accordionItems = Array.from(document.querySelectorAll('.accordion-item'));

          function estraiDaAccordion(label) {
            const item = accordionItems.find(i =>
              i.querySelector('.accordion-header')?.textContent?.toLowerCase().includes(label.toLowerCase())
            );
            if (!item) return [];
            const body = item.querySelector('.accordion-body');
            if (!body) return [];
            // Prova prima le card (stessa struttura di cerca_provvedimenti)
            const cards = Array.from(body.querySelectorAll('.card.card-bg'));
            if (cards.length > 0) {
              return cards.map(card => {
                const titleBtn = card.querySelector('button.btn-link');
                const estremi = titleBtn?.querySelector('.title-text-md, .title-text-sm')?.textContent?.trim() ?? titleBtn?.textContent?.trim() ?? '';
                return { estremi: estremi.substring(0, 200) };
              }).filter(e => e.estremi);
            }
            // Fallback: tutti i button.btn-link
            return Array.from(body.querySelectorAll('button.btn-link')).map(btn => ({
              estremi: btn.textContent?.trim().substring(0, 200) ?? '',
            })).filter(e => e.estremi);
          }

          if (tipo === 'conformi' || tipo === 'entrambi') {
            result.conformi = estraiDaAccordion('conformi');
          }
          if (tipo === 'difformi' || tipo === 'entrambi') {
            result.difformi = estraiDaAccordion('difformi');
          }
          return result;
        }, { base: BASE_URL, tipo });

        return { content: [{ type: 'text', text: JSON.stringify(precedenti) }] };
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
