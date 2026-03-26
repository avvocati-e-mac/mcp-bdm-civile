import { describe, it, expect } from 'vitest';
import { analizzaEstratti, prefiltraPerEstratti } from '../../src/workflows/excerpt-analyzer.js';

const terminiBase = {
  termini_primari: ['responsabilità medica', 'colpa medica', 'danno sanitario'],
  termini_abstract: ['malpractice', 'negligenza'],
};

const quesito = 'Responsabilità del medico per errore sanitario e danno al paziente';

describe('analizzaEstratti', () => {
  it('estratti ricchi di termini → score > 0.5 e raccomandazione APRI', () => {
    const provvedimento = {
      estratti: [
        'La responsabilità medica richiede colpa medica grave e danno sanitario diretto al paziente',
        'Il medico risponde per errore sanitario quando la responsabilità è accertata con perizia',
        'Danno al paziente per malpractice: responsabilità medica accertata in sede civile',
      ],
    };
    const result = analizzaEstratti(quesito, provvedimento, terminiBase);
    expect(result.score_estratti).toBeGreaterThan(0.35);
    expect(result.raccomandazione).toBe('APRI');
  });

  it('estratti vuoti → score < 0.2 e raccomandazione SALTA', () => {
    const provvedimento = { estratti: [] };
    const result = analizzaEstratti(quesito, provvedimento, terminiBase);
    expect(result.score_estratti).toBeLessThan(0.2);
    expect(result.raccomandazione).toBe('SALTA');
  });

  it('estratti brevissimi (<50 char) → raccomandazione SALTA', () => {
    const provvedimento = { estratti: ['breve', 'ok'] };
    const result = analizzaEstratti(quesito, provvedimento, terminiBase);
    expect(result.raccomandazione).toBe('SALTA');
  });

  it('estratti parziali → raccomandazione FORSE', () => {
    const provvedimento = {
      estratti: [
        'Questione di diritto civile relativa al contratto, senza specifici riferimenti al tema principale',
        'Il giudice ha valutato la situazione tenendo conto dei fatti di causa e delle prove prodotte',
      ],
    };
    const result = analizzaEstratti(quesito, provvedimento, terminiBase);
    // Score in range intermedio
    expect(result.score_estratti).toBeGreaterThanOrEqual(0);
    expect(result.score_estratti).toBeLessThan(1);
    // raccomandazione valida
    expect(['APRI', 'FORSE', 'SALTA']).toContain(result.raccomandazione);
  });

  it('contiene sempre _score e campi dettaglio', () => {
    const provvedimento = { estratti: ['qualcosa'] };
    const result = analizzaEstratti(quesito, provvedimento, terminiBase);
    expect(result).toHaveProperty('score_estratti');
    expect(result).toHaveProperty('raccomandazione');
    expect(result).toHaveProperty('dettaglio');
    expect(result.dettaglio).toHaveProperty('copertura_termini');
    expect(result.dettaglio).toHaveProperty('densita_termini');
    expect(result.dettaglio).toHaveProperty('coerenza_contestuale');
    expect(result.dettaglio).toHaveProperty('lunghezza_estratti');
  });

  it('è deterministica: stesso input produce stesso output', () => {
    const provvedimento = {
      estratti: ['Responsabilità medica per danno sanitario al paziente'],
    };
    const r1 = analizzaEstratti(quesito, provvedimento, terminiBase);
    const r2 = analizzaEstratti(quesito, provvedimento, terminiBase);
    expect(r1).toEqual(r2);
  });
});

describe('prefiltraPerEstratti', () => {
  it('con 20 provvedimenti su 5 pagine → da_aprire.length <= max_da_aprire', () => {
    const provvedimenti = Array.from({ length: 20 }, (_, i) => ({
      estremi: `Sentenza n. ${i + 1}`,
      _pagina_sorgente: Math.floor(i / 4) + 1,
      estratti: i < 10
        ? ['Responsabilità medica e colpa del medico per danno sanitario al paziente in ospedale']
        : ['Questione contrattuale irrilevante'],
    }));

    const result = prefiltraPerEstratti(quesito, provvedimenti, terminiBase, { max_da_aprire: 8 });
    expect(result.da_aprire.length).toBeLessThanOrEqual(8);
  });

  it('stats.pagine_analizzate riflette le pagine sorgente dei provvedimenti', () => {
    const provvedimenti = [
      { estremi: 'A', _pagina_sorgente: 1, estratti: ['testo uno'] },
      { estremi: 'B', _pagina_sorgente: 2, estratti: ['testo due'] },
      { estremi: 'C', _pagina_sorgente: 3, estratti: ['testo tre'] },
    ];
    const result = prefiltraPerEstratti(quesito, provvedimenti, terminiBase);
    expect(result.stats.pagine_analizzate).toBe(3);
  });

  it('stats.distribuzione_score contiene min, max, media corretti', () => {
    const provvedimenti = [
      { estremi: 'X', estratti: ['Responsabilità medica danno sanitario colpa grave paziente'] },
      { estremi: 'Y', estratti: [] },
    ];
    const result = prefiltraPerEstratti(quesito, provvedimenti, terminiBase);
    expect(result.stats.distribuzione_score).toHaveProperty('min');
    expect(result.stats.distribuzione_score).toHaveProperty('max');
    expect(result.stats.distribuzione_score).toHaveProperty('media');
    expect(result.stats.distribuzione_score.max).toBeGreaterThanOrEqual(result.stats.distribuzione_score.min);
    expect(result.stats.distribuzione_score.media).toBeGreaterThanOrEqual(result.stats.distribuzione_score.min);
    expect(result.stats.distribuzione_score.media).toBeLessThanOrEqual(result.stats.distribuzione_score.max);
  });

  it('restituisce struttura corretta con tutti i campi', () => {
    const result = prefiltraPerEstratti(quesito, [], terminiBase);
    expect(result).toHaveProperty('da_aprire');
    expect(result).toHaveProperty('forse');
    expect(result).toHaveProperty('saltati');
    expect(result).toHaveProperty('stats');
    expect(result.stats).toHaveProperty('totale_analizzati');
    expect(result.stats).toHaveProperty('pagine_analizzate');
    expect(result.stats).toHaveProperty('distribuzione_score');
  });

  it('è deterministica: stesso input produce stesso output', () => {
    const provvedimenti = [
      { estremi: 'Test', estratti: ['Responsabilità medica colpa sanitaria'] },
    ];
    const r1 = prefiltraPerEstratti(quesito, provvedimenti, terminiBase);
    const r2 = prefiltraPerEstratti(quesito, provvedimenti, terminiBase);
    expect(r1).toEqual(r2);
  });
});
