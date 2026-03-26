import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// vi.mock is hoisted, so we must use vi.hoisted for variables referenced inside factories.
const { mockPageEvaluate, mockPageGoto, mockPageWaitForTimeout, mockPageClose, mockPage } = vi.hoisted(() => {
  const mockPageEvaluate = vi.fn();
  const mockPageGoto = vi.fn().mockResolvedValue(undefined);
  const mockPageWaitForTimeout = vi.fn().mockResolvedValue(undefined);
  const mockPageClose = vi.fn().mockResolvedValue(undefined);
  const mockPage = {
    goto: mockPageGoto,
    evaluate: mockPageEvaluate,
    waitForTimeout: mockPageWaitForTimeout,
    close: mockPageClose,
    url: vi.fn().mockReturnValue('https://bdp.giustizia.it/'),
  };
  return { mockPageEvaluate, mockPageGoto, mockPageWaitForTimeout, mockPageClose, mockPage };
});

vi.mock('../../src/tools/search.js', () => ({
  eseguiRicerca: vi.fn(),
  estraiCardProvvedimento: vi.fn(),
}));

vi.mock('../../src/browser/browser-factory.js', () => ({
  getPage: vi.fn().mockResolvedValue(mockPage),
  assertNotRedirectedToLogin: vi.fn(),
}));

import { eseguiRicerca } from '../../src/tools/search.js';
import { getPage } from '../../src/browser/browser-factory.js';
import { analizzaQuesito } from '../../src/workflows/analisi-quesito.js';

// ─── Fixture helper ───────────────────────────────────────────────────────────

function makeProvvedimento(i, estratti = []) {
  return {
    tipo_provvedimento: 'SENTENZA',
    area: 'CIVILE',
    estremi: `Trib. Milano n. ${i}/2023`,
    ufficio: 'Tribunale di Milano',
    ruolo: '',
    materia: 'Diritto civile',
    parole_chiave: ['responsabilità medica', 'danno sanitario'],
    riferimenti_normativi: ['art. 2043 c.c.'],
    n_abstract_collegati: i % 2 === 0 ? 1 : 0,
    estratti: estratti.length > 0 ? estratti : [
      `Estratto ${i}: responsabilità medica e danno sanitario al paziente per errore del medico`,
    ],
    link_dettaglio: `https://bdp.giustizia.it/provvedimento/page?id=hash${i}&area=CIVILE`,
    _pagina_sorgente: Math.ceil(i / 3),
  };
}

const dettaglioMock = {
  tipo_provvedimento: 'SENTENZA',
  area: 'CIVILE',
  estremi: 'Trib. Milano n. X/2023',
  ufficio: 'Tribunale di Milano',
  ruolo: '',
  materia: 'Diritto civile',
  parole_chiave: ['responsabilità medica', 'colpa medica', 'danno paziente'],
  riferimenti_normativi: ['art. 2043 c.c.'],
  n_abstract_collegati: 1,
  estratti: ['estratto completo dal dettaglio'],
  url_dettaglio: 'https://bdp.giustizia.it/provvedimento/page?id=hashX',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('analizzaQuesito', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mock: eseguiRicerca restituisce 5 provvedimenti fittizi
    eseguiRicerca.mockResolvedValue(Array.from({ length: 5 }, (_, i) => makeProvvedimento(i + 1)));
    // Reset page mocks
    mockPageGoto.mockResolvedValue(undefined);
    mockPageWaitForTimeout.mockResolvedValue(undefined);
    mockPageClose.mockResolvedValue(undefined);
    mockPageEvaluate.mockResolvedValue(dettaglioMock);
    getPage.mockResolvedValue(mockPage);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('struttura output contiene tutti i campi obbligatori', async () => {
    const result = await analizzaQuesito(
      'Responsabilità medica per errore sanitario al paziente',
      { max_pagine_serp: 1, max_da_aprire: 3, max_provvedimenti: 3, delay_tra_query_ms: 0 }
    );

    expect(result).toHaveProperty('quesito');
    expect(result).toHaveProperty('termini_utilizzati');
    expect(result).toHaveProperty('fase1');
    expect(result).toHaveProperty('fase2');
    expect(result).toHaveProperty('provvedimenti');
    expect(result).toHaveProperty('n_trovati_totale');
    expect(result).toHaveProperty('n_restituiti');
    expect(result).toHaveProperty('errori');

    // fase1 sottocampi
    expect(result.fase1).toHaveProperty('pagine_analizzate');
    expect(result.fase1).toHaveProperty('provvedimenti_analizzati');
    expect(result.fase1).toHaveProperty('provvedimenti_selezionati');
    expect(result.fase1).toHaveProperty('provvedimenti_saltati');
    expect(result.fase1).toHaveProperty('distribuzione_score_estratti');

    // fase2 sottocampi
    expect(result.fase2).toHaveProperty('documenti_aperti');
    expect(result.fase2).toHaveProperty('documenti_scartati_dopo_lettura');
  });

  it('dedup: stesso link_dettaglio → un solo provvedimento nel n_trovati_totale', async () => {
    // Tutti i risultati hanno lo stesso link_dettaglio
    const duplicati = Array.from({ length: 5 }, () => makeProvvedimento(1));
    eseguiRicerca.mockResolvedValue(duplicati);

    const result = await analizzaQuesito(
      'Responsabilità medica errore sanitario',
      { max_pagine_serp: 1, delay_tra_query_ms: 0 }
    );

    // n_trovati_totale dopo dedup: deve essere 1
    expect(result.n_trovati_totale).toBe(1);
  });

  it('Promise.allSettled: query fallita → errore in errori[], altre query OK', async () => {
    let chiamata = 0;
    eseguiRicerca.mockImplementation(async () => {
      chiamata++;
      if (chiamata === 1) throw new Error('Network error simulato');
      return Array.from({ length: 2 }, (_, i) => makeProvvedimento(i + 1));
    });

    const result = await analizzaQuesito(
      'Responsabilità medica sanitaria errore paziente danno',
      { max_pagine_serp: 1, delay_tra_query_ms: 0 }
    );

    // Deve aver gestito l'errore senza crash
    expect(result.errori.length).toBeGreaterThan(0);
    // Struttura valida comunque
    expect(risultatoValido(result)).toBe(true);
  });

  it('solo candidati APRI causano getPage (verifica mock)', async () => {
    // Provvedimenti con estratti molto pertinenti → APRI
    const provvPertinenti = Array.from({ length: 3 }, (_, i) =>
      makeProvvedimento(i + 1, [
        'Responsabilità medica colpa del medico danno sanitario al paziente in ospedale errore grave',
      ])
    );
    // Provvedimenti con estratti irrilevanti → SALTA
    const provvIrrilevanti = Array.from({ length: 3 }, (_, i) =>
      makeProvvedimento(i + 10, [])
    );
    eseguiRicerca.mockResolvedValue([...provvPertinenti, ...provvIrrilevanti]);

    const result = await analizzaQuesito(
      'Responsabilità medica errore sanitario danno paziente',
      { max_pagine_serp: 1, soglia_apri: 0.20, max_da_aprire: 5, delay_tra_query_ms: 0 }
    );

    // getPage deve essere stato chiamato solo per i candidati selezionati (che hanno link_dettaglio)
    const chiamateGetPage = getPage.mock.calls.length;
    expect(chiamateGetPage).toBeLessThanOrEqual(5); // max_da_aprire
    expect(risultatoValido(result)).toBe(true);
  });

  it('max_da_aprire = 3 con 10 APRI → getPage chiamato al massimo 3 volte', async () => {
    // 10 provvedimenti molto pertinenti
    const provvPertinenti = Array.from({ length: 10 }, (_, i) =>
      makeProvvedimento(i + 1, [
        'Responsabilità medica colpa del medico danno sanitario al paziente in ospedale errore grave negligenza',
      ])
    );
    eseguiRicerca.mockResolvedValue(provvPertinenti);

    await analizzaQuesito(
      'Responsabilità medica errore sanitario danno paziente ospedale',
      { max_pagine_serp: 1, soglia_apri: 0.01, max_da_aprire: 3, delay_tra_query_ms: 0 }
    );

    expect(getPage.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('tutti estratti sotto soglia → fallback a forse, non crash', async () => {
    // Provvedimenti con estratti nulli → tutti SALTA/FORSE
    const provvVuoti = Array.from({ length: 5 }, (_, i) =>
      makeProvvedimento(i + 1, [])
    );
    eseguiRicerca.mockResolvedValue(provvVuoti);

    const result = await analizzaQuesito(
      'Responsabilità medica errore sanitario',
      { max_pagine_serp: 1, soglia_apri: 0.99, delay_tra_query_ms: 0 }
    );

    // Non deve crashare e deve restituire struttura valida
    expect(risultatoValido(result)).toBe(true);
  });

  it('n_restituiti <= max_provvedimenti', async () => {
    const result = await analizzaQuesito(
      'Responsabilità medica errore sanitario danno paziente',
      { max_provvedimenti: 2, max_pagine_serp: 1, delay_tra_query_ms: 0 }
    );
    expect(result.n_restituiti).toBeLessThanOrEqual(2);
    expect(result.provvedimenti.length).toBeLessThanOrEqual(2);
  });

  it('termini_override usa i termini passati e _sorgente=llm_override', async () => {
    const terminiPersonalizzati = {
      termini_primari: ['TFR fallimento lavoratore', 'art. 46 l.fall. beni esclusi massa'],
      termini_abstract: ['trattamento fine rapporto procedura concorsuale'],
      materia_suggerita: 'Diritto del lavoro',
      tipo_suggerito: 'SENTENZA',
      riferimenti_normativi: ['art. 46 l.fall.', 'art. 2119 c.c.'],
    };

    const result = await analizzaQuesito(
      'TFR del lavoratore fallito: va alla massa o al fallito?',
      { max_pagine_serp: 1, termini_override: terminiPersonalizzati, delay_tra_query_ms: 0 }
    );

    expect(result.termini_utilizzati.termini_primari).toEqual(terminiPersonalizzati.termini_primari);
    expect(result.termini_utilizzati.materia_suggerita).toBe('Diritto del lavoro');
    expect(result.termini_utilizzati._sorgente).toBe('llm_override');
    expect(risultatoValido(result)).toBe(true);
  });

  it('senza termini_override _sorgente=keyword_extractor', async () => {
    const result = await analizzaQuesito(
      'Responsabilità medica errore sanitario',
      { max_pagine_serp: 1, delay_tra_query_ms: 0 }
    );
    expect(result.termini_utilizzati._sorgente).toBe('keyword_extractor');
  });
});

describe('runWithConcurrency', () => {
  it('non supera il limite di concorrenza', async () => {
    // Importiamo analizzaQuesito solo come veicolo per testare runWithConcurrency indirettamente.
    // Test diretto sulla funzione: verifichiamo tramite timing che max 2 task girino in parallelo.
    let concorrentiAttivi = 0;
    let maxConcorrenti = 0;

    const tasks = Array.from({ length: 8 }, () => async () => {
      concorrentiAttivi++;
      maxConcorrenti = Math.max(maxConcorrenti, concorrentiAttivi);
      await new Promise(r => setTimeout(r, 5));
      concorrentiAttivi--;
      return 'ok';
    });

    // Invochiamo runWithConcurrency direttamente tramite un modulo che la espone per test.
    // Poiché runWithConcurrency è privata, la testiamo indirettamente attraverso analizzaQuesito
    // con max_query_concorrenti=2 e verificando che le call a eseguiRicerca siano raggruppate.
    // Questo test verifica la logica di conteggio concorrenza con un mock dedicato.
    let maxSimultanee = 0;
    let attive = 0;
    eseguiRicerca.mockImplementation(async () => {
      attive++;
      maxSimultanee = Math.max(maxSimultanee, attive);
      await new Promise(r => setTimeout(r, 10));
      attive--;
      return Array.from({ length: 2 }, (_, i) => makeProvvedimento(i + 1));
    });

    await analizzaQuesito(
      'Responsabilità medica sanitaria errore paziente danno ospedale negligenza',
      { max_pagine_serp: 1, max_query_concorrenti: 2, delay_tra_query_ms: 0 }
    );

    expect(maxSimultanee).toBeLessThanOrEqual(2);
  });

  it('runWithConcurrency: query fallita non blocca le altre (semantica allSettled)', async () => {
    let chiamata = 0;
    eseguiRicerca.mockImplementation(async () => {
      chiamata++;
      if (chiamata === 1) throw new Error('Network error simulato');
      return Array.from({ length: 2 }, (_, i) => makeProvvedimento(i + 1));
    });

    const result = await analizzaQuesito(
      'Responsabilità medica sanitaria errore paziente danno',
      { max_pagine_serp: 1, max_query_concorrenti: 2, delay_tra_query_ms: 0 }
    );

    expect(result.errori.length).toBeGreaterThan(0);
    expect(risultatoValido(result)).toBe(true);
  });
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function risultatoValido(result) {
  return (
    result != null &&
    typeof result.quesito === 'string' &&
    Array.isArray(result.provvedimenti) &&
    Array.isArray(result.errori) &&
    typeof result.fase1 === 'object' &&
    typeof result.fase2 === 'object'
  );
}
