/**
 * Pipeline a due fasi per l'analisi di un quesito giuridico sulla BDP.
 *
 * FASE 1 — Scansione ampia:
 *   - Estrae termini di ricerca dal quesito
 *   - Itera più pagine SERP per ogni query
 *   - Analizza gli estratti testuali (senza aprire i documenti)
 *   - Pre-filtra i candidati più promettenti
 *
 * FASE 2 — Approfondimento selettivo:
 *   - Apre e legge i dettagli SOLO per i candidati selezionati
 *   - Calcola uno score finale di pertinenza
 *   - Restituisce i risultati ordinati per pertinenza
 */

import { estraiTerminiRicerca } from './keyword-extractor.js';
import { prefiltraPerEstratti } from './excerpt-analyzer.js';
import { calcolaScore, ordinaPerPertinenza } from './relevance-scorer.js';
import { eseguiRicerca, estraiCardProvvedimento } from '../tools/search.js';
import { getPage, assertNotRedirectedToLogin } from '../browser/browser-factory.js';

const BASE_URL = 'https://bdp.giustizia.it';

/**
 * Esegue una singola query sulla SERP BDP e raccoglie i risultati di una pagina.
 * Restituisce i provvedimenti estratti con metadati di paginazione.
 *
 * @param {string} query - termine di ricerca
 * @param {number} pagina - numero di pagina (1-based)
 * @param {object} opzioniRicerca - opzioni per eseguiRicerca
 * @returns {Promise<object[]>}
 */
async function cercaPagina(query, pagina, opzioniRicerca = {}) {
  const max_results = opzioniRicerca.max_per_query ?? 15;

  // Costruiamo il payload per eseguiRicerca
  const params = {
    query,
    tipo: 'TUTTI',
    tipo_ricerca: 'ALMENO_UNA_PAROLA',
    sort_field: 'rilevanza',
    sort_order: 'desc',
    max_results: max_results * pagina, // carichiamo fino a pagina N
    nelle_cartelle: false,
    ...opzioniRicerca,
  };

  // eseguiRicerca gestisce la paginazione interna: restituisce fino a max_results
  // Per simulare la "pagina N", prendiamo i risultati saltando quelli delle pagine precedenti
  const tutti = await eseguiRicerca('provvedimento', params, estraiCardProvvedimento);
  const offset = (pagina - 1) * max_results;
  const risultatiPagina = tutti.slice(offset, offset + max_results);

  // Taggare ogni risultato con la pagina sorgente
  return risultatiPagina.map(p => ({ ...p, _pagina_sorgente: pagina }));
}

/**
 * Esegue task asincroni con concorrenza limitata (pool di N worker).
 * Semantica analoga a Promise.allSettled: non propaga eccezioni.
 *
 * @param {Array<() => Promise<any>>} tasks - array di thunk
 * @param {number} limit - max task concorrenti
 * @param {number} [delayMs=0] - pausa tra task dello stesso worker
 * @returns {Promise<Array<{status:'fulfilled',value:any}|{status:'rejected',reason:any}>>}
 */
async function runWithConcurrency(tasks, limit, delayMs = 0) {
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: 'fulfilled', value: await tasks[index]() };
      } catch (err) {
        results[index] = { status: 'rejected', reason: err };
      }
      if (delayMs > 0 && nextIndex < tasks.length) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/**
 * Dedup provvedimenti per link_dettaglio o estremi.
 * @param {object[]} provvedimenti
 * @returns {object[]}
 */
function dedup(provvedimenti) {
  const seen = new Set();
  return provvedimenti.filter(p => {
    const key = p.link_dettaglio || p.estremi || JSON.stringify(p);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Legge il dettaglio completo di un provvedimento dalla sua pagina.
 * @param {string} url
 * @returns {Promise<object>}
 */
async function leggiDettaglio(url) {
  const page = await getPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    assertNotRedirectedToLogin(page);

    await page.waitForTimeout(800 + Math.random() * 1200);

    const dettaglio = await page.evaluate(() => {
      const body = document.querySelector('.card-body') ?? document.body;

      const chipAfterLabel = (label, root = body) => {
        const divs = Array.from(root.querySelectorAll('.d-lg-flex.align-items-lg-center'));
        const div = divs.find(d => d.textContent?.includes(label));
        return Array.from(div?.querySelectorAll('.chip-label') ?? []).map(c => c.textContent.trim()).filter(Boolean);
      };

      const badges = Array.from(body.querySelectorAll('.badge'));
      const tipo_provvedimento = badges.find(b => b.classList.contains('bg-provvedimento'))?.textContent?.trim() ?? '';
      const area = badges.find(b => b.classList.contains('bg-secondary'))?.textContent?.trim() ?? '';

      const titleBtn = body.querySelector('button.btn-link');
      const estremi = titleBtn?.querySelector('.title-text-md')?.textContent?.trim() ?? '';

      const ufficio = chipAfterLabel('Ufficio:')[0] ?? '';
      const ruolo = chipAfterLabel('Ruolo:')[0] ?? '';
      const materia = chipAfterLabel('Materia:')[0] ?? '';
      const parole_chiave = chipAfterLabel('Parole chiave:');
      const riferimenti_normativi = chipAfterLabel('Riferimenti normativi:');

      const accordionBtn = body.querySelector('.accordion-button');
      const abstractMatch = accordionBtn?.textContent?.match(/Abstract\s*\((\d+)\)/i);
      const n_abstract_collegati = abstractMatch ? parseInt(abstractMatch[1], 10) : 0;

      const estratti = Array.from(body.querySelectorAll('.estratto li'))
        .map(li => li.textContent?.trim() ?? '')
        .filter(Boolean);

      return {
        tipo_provvedimento,
        area,
        estremi,
        ufficio,
        ruolo,
        materia,
        parole_chiave,
        riferimenti_normativi,
        n_abstract_collegati,
        estratti,
        url_dettaglio: window.location.href,
      };
    });

    return dettaglio;
  } finally {
    await page.close();
  }
}

/**
 * Pipeline a due fasi per l'analisi di un quesito giuridico.
 *
 * @param {string} quesito
 * @param {{
 *   max_provvedimenti?: number,
 *   max_pagine_serp?: number,
 *   max_per_query?: number,
 *   include_abstract?: boolean,
 *   soglia_score?: number,
 *   soglia_apri?: number,
 *   max_da_aprire?: number,
 *   termini_override?: object|null,
 *   max_query_concorrenti?: number,
 *   delay_tra_query_ms?: number
 * }} opzioni
 * @returns {Promise<object>}
 */
export async function analizzaQuesito(quesito, opzioni = {}) {
  const {
    max_provvedimenti = 10,
    max_pagine_serp = 3,
    max_per_query = 10,
    include_abstract = true,
    soglia_score = 0.1,
    soglia_apri = 0.35,
    max_da_aprire = 10,
    termini_override = null,
    max_query_concorrenti = 2,
    delay_tra_query_ms = 3000,
  } = opzioni;

  const errori = [];

  // ════════════════════════════════════════════════════════════════════════════
  // FASE 1 — Scansione ampia
  // ════════════════════════════════════════════════════════════════════════════

  // 1. Estrai termini di ricerca: usa override LLM se fornito, altrimenti keyword-extractor deterministico
  const termini = termini_override != null
    ? {
        termini_primari: termini_override.termini_primari ?? [],
        termini_abstract: termini_override.termini_abstract ?? [],
        materia_suggerita: termini_override.materia_suggerita ?? null,
        tipo_suggerito: termini_override.tipo_suggerito ?? 'TUTTI',
        riferimenti_normativi: termini_override.riferimenti_normativi ?? [],
      }
    : estraiTerminiRicerca(quesito);

  // 2. Costruisci lista query: primarie + (se include_abstract) abstract
  const queriesPrimarie = termini.termini_primari.slice(0, 5); // max 5 query primarie
  const querieAbstract = include_abstract
    ? termini.termini_abstract.slice(0, 3)  // max 3 query abstract
    : [];
  const tutteLeQuery = [...new Set([...queriesPrimarie, ...querieAbstract])];

  let tuttIProvvedimenti = [];
  let totalePagineAnalizzate = 0;

  // Per ogni query, itera le pagine 1…max_pagine_serp in SEQUENZA
  // Le query sono eseguite con concorrenza limitata (max_query_concorrenti) per evitare rate-limit BDP
  const taskQuery = tutteLeQuery.map((query) => async () => {
    if (!query || query.trim().length === 0) return [];
    const provvQuery = [];

    for (let pagina = 1; pagina <= max_pagine_serp; pagina++) {
      try {
        const risultatiPagina = await cercaPagina(query, pagina, { max_per_query });
        provvQuery.push(...risultatiPagina);

        // Se la pagina ha restituito meno risultati del massimo, non c'è altra pagina
        if (risultatiPagina.length < max_per_query) break;
      } catch (err) {
        errori.push({ query, pagina, errore: err.message });
        break;
      }
    }

    return provvQuery;
  });

  const risultatiQueries = await runWithConcurrency(taskQuery, max_query_concorrenti, delay_tra_query_ms);

  for (const risultato of risultatiQueries) {
    if (risultato.status === 'fulfilled') {
      tuttIProvvedimenti.push(...risultato.value);
    } else {
      errori.push({ errore: risultato.reason?.message ?? String(risultato.reason) });
    }
  }

  // 3. Dedup
  tuttIProvvedimenti = dedup(tuttIProvvedimenti);

  // Conta le pagine analizzate
  const pagineSet = new Set(tuttIProvvedimenti.map(p => p._pagina_sorgente).filter(p => p != null));
  totalePagineAnalizzate = pagineSet.size > 0 ? pagineSet.size : Math.min(max_pagine_serp, tutteLeQuery.length);

  // 4. Pre-filtra per estratti
  const filtro = prefiltraPerEstratti(quesito, tuttIProvvedimenti, termini, {
    soglia_apri,
    soglia_forse: 0.15,
    max_da_aprire,
  });

  // Se da_aprire è vuoto, includi anche forse fino a max_da_aprire
  let candidati = filtro.da_aprire;
  if (candidati.length === 0) {
    candidati = filtro.forse.slice(0, max_da_aprire);
  }

  const fase1 = {
    pagine_analizzate: filtro.stats.pagine_analizzate || totalePagineAnalizzate,
    provvedimenti_analizzati: filtro.stats.totale_analizzati,
    provvedimenti_selezionati: candidati.length,
    provvedimenti_saltati: filtro.stats.totale_analizzati - candidati.length - filtro.forse.length,
    distribuzione_score_estratti: filtro.stats.distribuzione_score,
  };

  // ════════════════════════════════════════════════════════════════════════════
  // FASE 2 — Approfondimento selettivo
  // ════════════════════════════════════════════════════════════════════════════

  const provvedimentiFinali = [];
  let documentiAperti = 0;
  let documentiScartatiDopoLettura = 0;

  // Esecuzione SEQUENZIALE per rispettare il rate limit BDP
  const daAprire = candidati.slice(0, max_da_aprire);

  for (const candidato of daAprire) {
    if (!candidato.link_dettaglio) {
      // Nessun URL disponibile: usa i dati della SERP direttamente
      const scored = calcolaScore(quesito, candidato, {
        materia_suggerita: termini.materia_suggerita,
        riferimenti_normativi: termini.riferimenti_normativi,
        termini_primari: termini.termini_primari,
      });
      provvedimentiFinali.push(scored);
      continue;
    }

    try {
      const dettaglio = await leggiDettaglio(candidato.link_dettaglio);
      documentiAperti++;

      // Merge dati SERP con dati dettaglio
      const provvCompleto = {
        ...candidato,
        ...dettaglio,
        // Mantieni i dati di scoring estratti
        score_estratti: candidato.score_estratti,
        raccomandazione: candidato.raccomandazione,
      };

      const scored = calcolaScore(quesito, provvCompleto, {
        materia_suggerita: termini.materia_suggerita,
        riferimenti_normativi: termini.riferimenti_normativi,
        termini_primari: termini.termini_primari,
      });

      provvedimentiFinali.push(scored);
    } catch (err) {
      errori.push({ link: candidato.link_dettaglio, errore: err.message });
      documentiScartatiDopoLettura++;

      // Fallback: usa dati SERP
      const scored = calcolaScore(quesito, candidato, {
        materia_suggerita: termini.materia_suggerita,
        riferimenti_normativi: termini.riferimenti_normativi,
        termini_primari: termini.termini_primari,
      });
      provvedimentiFinali.push(scored);
    }
  }

  // 7. Ordina per pertinenza e prendi i migliori
  const risultatiOrdinati = ordinaPerPertinenza(quesito, provvedimentiFinali, soglia_score);
  const provvedimenti = risultatiOrdinati.slice(0, max_provvedimenti);

  const fase2 = {
    documenti_aperti: documentiAperti,
    documenti_scartati_dopo_lettura: documentiScartatiDopoLettura,
  };

  return {
    quesito,
    termini_utilizzati: {
      ...termini,
      _sorgente: termini_override != null ? 'llm_override' : 'keyword_extractor',
    },
    fase1,
    fase2,
    provvedimenti,
    n_trovati_totale: tuttIProvvedimenti.length,
    n_restituiti: provvedimenti.length,
    errori,
  };
}
