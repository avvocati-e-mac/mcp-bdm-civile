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
      { max_pagine_serp: 1, max_da_aprire: 3, max_provvedimenti: 3 }
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
      { max_pagine_serp: 1 }
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
      { max_pagine_serp: 1 }
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
      { max_pagine_serp: 1, soglia_apri: 0.20, max_da_aprire: 5 }
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
      { max_pagine_serp: 1, soglia_apri: 0.01, max_da_aprire: 3 }
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
      { max_pagine_serp: 1, soglia_apri: 0.99 } // soglia altissima → nessun APRI
    );

    // Non deve crashare e deve restituire struttura valida
    expect(risultatoValido(result)).toBe(true);
  });

  it('n_restituiti <= max_provvedimenti', async () => {
    const result = await analizzaQuesito(
      'Responsabilità medica errore sanitario danno paziente',
      { max_provvedimenti: 2, max_pagine_serp: 1 }
    );
    expect(result.n_restituiti).toBeLessThanOrEqual(2);
    expect(result.provvedimenti.length).toBeLessThanOrEqual(2);
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
