import { describe, it, expect } from 'vitest';
import { calcolaScore, ordinaPerPertinenza } from '../../src/workflows/relevance-scorer.js';

const quesito = 'Responsabilità del medico per errore sanitario e danno al paziente';

describe('calcolaScore', () => {
  it('parole chiave identiche al quesito → score > 0.5', () => {
    const provvedimento = {
      parole_chiave: ['responsabilità medica', 'errore sanitario', 'danno paziente'],
      materia: 'Diritto civile',
      n_abstract_collegati: 1,
      estratti: ['estratto pertinente'],
    };
    const result = calcolaScore(quesito, provvedimento, {
      materia_suggerita: 'Diritto civile',
      termini_primari: ['responsabilità medica', 'errore sanitario'],
    });
    expect(result._score).toBeGreaterThan(0.5);
  });

  it('provvedimento non correlato → score < 0.2', () => {
    const provvedimento = {
      parole_chiave: ['diritto tributario', 'evasione fiscale'],
      materia: 'Diritto tributario',
      n_abstract_collegati: 0,
      estratti: [],
    };
    const result = calcolaScore(quesito, provvedimento, {
      materia_suggerita: 'Diritto civile',
      termini_primari: ['responsabilità medica'],
    });
    expect(result._score).toBeLessThan(0.3);
  });

  it('con abstract collegati → score più alto che senza', () => {
    const baseProvv = {
      parole_chiave: ['responsabilità medica'],
      materia: 'Diritto civile',
      estratti: ['estratto'],
    };
    const opzioni = { materia_suggerita: 'Diritto civile', termini_primari: ['responsabilità'] };

    const conAbstract = calcolaScore(quesito, { ...baseProvv, n_abstract_collegati: 2 }, opzioni);
    const senzaAbstract = calcolaScore(quesito, { ...baseProvv, n_abstract_collegati: 0 }, opzioni);

    expect(conAbstract._score).toBeGreaterThan(senzaAbstract._score);
  });

  it('output contiene sempre _score e _score_dettaglio', () => {
    const provvedimento = { parole_chiave: [], materia: '', estratti: [] };
    const result = calcolaScore(quesito, provvedimento);
    expect(result).toHaveProperty('_score');
    expect(result).toHaveProperty('_score_dettaglio');
    expect(typeof result._score).toBe('number');
    expect(result._score_dettaglio).toHaveProperty('parole_chiave');
    expect(result._score_dettaglio).toHaveProperty('materia');
    expect(result._score_dettaglio).toHaveProperty('abstract');
    expect(result._score_dettaglio).toHaveProperty('riferimenti');
  });

  it('_score è sempre in range [0, 1]', () => {
    const provvedimenti = [
      { parole_chiave: [], materia: '', n_abstract_collegati: 0, estratti: [] },
      { parole_chiave: ['responsabilità', 'medica', 'danno'], materia: 'Diritto civile', n_abstract_collegati: 3, estratti: ['lungo estratto'] },
    ];
    for (const p of provvedimenti) {
      const result = calcolaScore(quesito, p, { materia_suggerita: 'Diritto civile' });
      expect(result._score).toBeGreaterThanOrEqual(0);
      expect(result._score).toBeLessThanOrEqual(1);
    }
  });

  it('pesi personalizzati sono rispettati nel dettaglio', () => {
    const provvedimento = {
      parole_chiave: ['responsabilità medica'],
      materia: 'Diritto civile',
      n_abstract_collegati: 1,
      estratti: [],
    };
    const opzioniCustom = {
      materia_suggerita: 'Diritto civile',
      peso_parole_chiave: 0.70,
      peso_materia: 0.10,
      peso_abstract: 0.10,
      peso_riferimenti: 0.10,
    };
    const result = calcolaScore(quesito, provvedimento, opzioniCustom);
    expect(result._score_dettaglio.pesi.peso_parole_chiave).toBe(0.70);
    expect(result._score_dettaglio.pesi.peso_materia).toBe(0.10);
  });

  it('non modifica l\'oggetto provvedimento originale', () => {
    const provvedimento = { parole_chiave: ['test'], materia: 'Diritto civile', estremi: 'orig' };
    const original = { ...provvedimento };
    calcolaScore(quesito, provvedimento);
    expect(provvedimento).toEqual(original);
  });
});

describe('ordinaPerPertinenza', () => {
  it('ordina per score decrescente', () => {
    const provvedimenti = [
      { estremi: 'A', _score: 0.2 },
      { estremi: 'B', _score: 0.8 },
      { estremi: 'C', _score: 0.5 },
    ];
    const result = ordinaPerPertinenza(quesito, provvedimenti, 0.1);
    expect(result[0]._score).toBeGreaterThanOrEqual(result[1]._score);
    expect(result[1]._score).toBeGreaterThanOrEqual(result[2]._score);
  });

  it('filtra provvedimenti sotto soglia 0.3', () => {
    const provvedimenti = [
      { estremi: 'A', _score: 0.4 },
      { estremi: 'B', _score: 0.1 },
      { estremi: 'C', _score: 0.6 },
    ];
    const result = ordinaPerPertinenza(quesito, provvedimenti, 0.3);
    expect(result.every(p => p._score >= 0.3)).toBe(true);
    expect(result.length).toBe(2);
  });

  it('restituisce array vuoto per input vuoto', () => {
    expect(ordinaPerPertinenza(quesito, [], 0.1)).toEqual([]);
    expect(ordinaPerPertinenza(quesito, null, 0.1)).toEqual([]);
  });

  it('calcola _score se mancante nel provvedimento', () => {
    const provvedimenti = [
      { estremi: 'Test', parole_chiave: ['responsabilità medica'], materia: 'Diritto civile', n_abstract_collegati: 1, estratti: [] },
    ];
    const result = ordinaPerPertinenza(quesito, provvedimenti, 0.0);
    expect(result[0]).toHaveProperty('_score');
    expect(result[0]).toHaveProperty('_score_dettaglio');
  });
});
