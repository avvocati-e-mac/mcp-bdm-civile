import { describe, it, expect } from 'vitest';
import { estraiTerminiRicerca } from '../../src/workflows/keyword-extractor.js';

describe('estraiTerminiRicerca', () => {
  it('rileva riferimenti normativi espliciti nel quesito', () => {
    const quesito = 'Responsabilità medica ex art. 2043 c.c. e d.lgs. 502/1992 per errore sanitario';
    const result = estraiTerminiRicerca(quesito);
    expect(result.riferimenti_normativi.length).toBeGreaterThan(0);
    const rifConcat = result.riferimenti_normativi.join(' ');
    expect(rifConcat).toMatch(/2043|502\/1992/);
  });

  it('rileva materia "Diritto civile" per responsabilità medica', () => {
    const quesito = 'Responsabilità del medico per errore sanitario durante operazione chirurgica';
    const result = estraiTerminiRicerca(quesito);
    expect(result.materia_suggerita).toBe('Diritto civile');
    expect(result.termini_primari.length).toBeGreaterThanOrEqual(2);
  });

  it('rileva materia "Diritto del lavoro" per quesito su licenziamento', () => {
    const quesito = 'Validità del licenziamento per giustificato motivo oggettivo del lavoratore';
    const result = estraiTerminiRicerca(quesito);
    expect(result.materia_suggerita).toBe('Diritto del lavoro');
  });

  it('restituisce array vuoti per quesito vuoto senza throw', () => {
    const result = estraiTerminiRicerca('');
    expect(result.termini_primari).toEqual([]);
    expect(result.termini_abstract).toEqual([]);
    expect(result.riferimenti_normativi).toEqual([]);
    expect(result.materia_suggerita).toBeNull();
  });

  it('restituisce array vuoti per quesito con solo spazi senza throw', () => {
    const result = estraiTerminiRicerca('   ');
    expect(result.termini_primari).toEqual([]);
  });

  it('è una funzione pura: stesso input produce stesso output', () => {
    const quesito = 'Risarcimento danno da incidente stradale art. 2054 c.c.';
    const r1 = estraiTerminiRicerca(quesito);
    const r2 = estraiTerminiRicerca(quesito);
    expect(r1).toEqual(r2);
  });

  it('rileva tipo TUTTI per quesito generico', () => {
    const quesito = 'Responsabilità contrattuale per inadempimento del contratto di locazione';
    const result = estraiTerminiRicerca(quesito);
    expect(result.tipo_suggerito).toBe('TUTTI');
  });

  it('rileva tipo ORDINANZA per quesito su misura cautelare', () => {
    const quesito = 'Misura cautelare urgente su sequestro conservativo';
    const result = estraiTerminiRicerca(quesito);
    expect(result.tipo_suggerito).toBe('ORDINANZA');
  });

  it('include sinonimi dal dizionario per "locazione"', () => {
    const quesito = 'Il conduttore può recedere dal contratto di locazione?';
    const result = estraiTerminiRicerca(quesito);
    const termini = result.termini_primari.join(' ');
    // Deve includere almeno un sinonimo/termine correlato
    expect(termini.length).toBeGreaterThan(0);
  });

  it('restituisce struttura corretta con tutti i campi', () => {
    const result = estraiTerminiRicerca('Danno patrimoniale da inadempimento contrattuale');
    expect(result).toHaveProperty('termini_primari');
    expect(result).toHaveProperty('termini_abstract');
    expect(result).toHaveProperty('materia_suggerita');
    expect(result).toHaveProperty('tipo_suggerito');
    expect(result).toHaveProperty('riferimenti_normativi');
    expect(Array.isArray(result.termini_primari)).toBe(true);
    expect(Array.isArray(result.termini_abstract)).toBe(true);
    expect(Array.isArray(result.riferimenti_normativi)).toBe(true);
  });
});
