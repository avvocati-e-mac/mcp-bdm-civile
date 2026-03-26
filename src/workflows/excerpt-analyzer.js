/**
 * Prima fase del pipeline: analisi degli estratti testuali della SERP
 * senza aprire i documenti.
 *
 * Funzioni PURE (no side effects, no I/O).
 */

/**
 * Normalizza il testo per il confronto: lowercase, rimuove punteggiatura.
 * @param {string} text
 * @returns {string}
 */
function normalizzaTesto(text) {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^\w\sàèéìòù]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenizza un testo in parole significative (lunghezza > 2).
 * @param {string} text
 * @returns {string[]}
 */
function tokenizzaTesto(text) {
  return normalizzaTesto(text)
    .split(/\s+/)
    .filter(t => t.length > 2);
}

/**
 * Estrae tutti i bigram da una lista di token.
 * @param {string[]} tokens
 * @returns {string[]}
 */
function estraiBigram(tokens) {
  const bigram = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigram.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigram;
}

/**
 * Estrae tutti i trigram da una lista di token.
 * @param {string[]} tokens
 * @returns {string[]}
 */
function estraiTrigram(tokens) {
  const trigram = [];
  for (let i = 0; i < tokens.length - 2; i++) {
    trigram.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return trigram;
}

/**
 * Ottieni tutti gli estratti testuali di un provvedimento come stringa unica.
 * @param {object} provvedimento
 * @returns {string}
 */
function getTestoEstratti(provvedimento) {
  const estratti = provvedimento.estratti ?? [];
  if (estratti.length === 0) return '';
  return estratti.join(' ');
}

/**
 * Score preliminare [0-1] basato SOLO sugli estratti della SERP.
 *
 * Pesi:
 * - copertura_termini (40%): % termini del quesito trovati in almeno un estratto
 * - densita_termini (30%): occorrenze totali normalizzate per lunghezza estratti
 * - coerenza_contestuale (20%): presenza bigram/trigram del quesito negli estratti
 * - lunghezza_estratti (10%): 1.0 se >100 char; 0.5 se 50-100; 0.0 se <50
 *
 * @param {string} quesito
 * @param {object} provvedimento
 * @param {{ termini_primari: string[], termini_abstract: string[] }} termini
 * @returns {{
 *   score_estratti: number,
 *   raccomandazione: 'APRI'|'FORSE'|'SALTA',
 *   dettaglio: object
 * }}
 */
export function analizzaEstratti(quesito, provvedimento, termini) {
  const testoEstratti = getTestoEstratti(provvedimento);
  const testoNorm = normalizzaTesto(testoEstratti);
  const totalLen = testoEstratti.length;

  // Tutti i termini di ricerca (primari + abstract)
  const tuttiTermini = [
    ...(termini.termini_primari ?? []),
    ...(termini.termini_abstract ?? []),
  ];

  // Tokenizza il quesito per ottenere i token di confronto
  const tokensQuesito = tokenizzaTesto(quesito);
  const bigramQuesito = estraiBigram(tokensQuesito);
  const trigramQuesito = estraiTrigram(tokensQuesito);

  // ── 1. Copertura termini (40%) ──────────────────────────────────────────────
  // % dei termini del quesito (token + termini_primari) trovati in almeno un estratto
  const terminiDaCercare = [...new Set([...tokensQuesito, ...tuttiTermini.map(t => normalizzaTesto(t))])];
  let terminiTrovati = 0;
  for (const termine of terminiDaCercare) {
    if (testoNorm.includes(normalizzaTesto(termine))) {
      terminiTrovati++;
    }
  }
  const copertura_termini = terminiDaCercare.length > 0
    ? terminiTrovati / terminiDaCercare.length
    : 0;

  // ── 2. Densità termini (30%) ────────────────────────────────────────────────
  // Occorrenze totali normalizzate per lunghezza del testo estratti
  let occorrenzeTotali = 0;
  for (const termine of terminiDaCercare) {
    const normTermine = normalizzaTesto(termine);
    if (!normTermine) continue;
    let pos = 0;
    while ((pos = testoNorm.indexOf(normTermine, pos)) !== -1) {
      occorrenzeTotali++;
      pos += normTermine.length;
    }
  }
  const densitaRaw = totalLen > 0 ? occorrenzeTotali / (totalLen / 100) : 0;
  // Normalizza a [0,1]: densità massima ragionevole = 5 occorrenze ogni 100 char
  const densita_termini = Math.min(densitaRaw / 5, 1.0);

  // ── 3. Coerenza contestuale (20%) ───────────────────────────────────────────
  // Presenza di bigram e trigram del quesito negli estratti
  const ngramQuesito = [...bigramQuesito, ...trigramQuesito];
  let ngramTrovati = 0;
  for (const ng of ngramQuesito) {
    if (testoNorm.includes(normalizzaTesto(ng))) {
      ngramTrovati++;
    }
  }
  const coerenza_contestuale = ngramQuesito.length > 0
    ? Math.min(ngramTrovati / ngramQuesito.length, 1.0)
    : 0;

  // ── 4. Lunghezza estratti (10%) ─────────────────────────────────────────────
  let lunghezza_estratti;
  if (totalLen > 100) lunghezza_estratti = 1.0;
  else if (totalLen >= 50) lunghezza_estratti = 0.5;
  else lunghezza_estratti = 0.0;

  // ── Score finale ────────────────────────────────────────────────────────────
  const score_estratti =
    copertura_termini * 0.40 +
    densita_termini * 0.30 +
    coerenza_contestuale * 0.20 +
    lunghezza_estratti * 0.10;

  // ── Raccomandazione ─────────────────────────────────────────────────────────
  let raccomandazione;
  if (score_estratti >= 0.35) raccomandazione = 'APRI';
  else if (score_estratti >= 0.15) raccomandazione = 'FORSE';
  else raccomandazione = 'SALTA';

  return {
    score_estratti: Math.round(score_estratti * 1000) / 1000,
    raccomandazione,
    dettaglio: {
      copertura_termini: Math.round(copertura_termini * 1000) / 1000,
      densita_termini: Math.round(densita_termini * 1000) / 1000,
      coerenza_contestuale: Math.round(coerenza_contestuale * 1000) / 1000,
      lunghezza_estratti,
      totale_char_estratti: totalLen,
      termini_trovati: terminiTrovati,
      termini_cercati: terminiDaCercare.length,
    },
  };
}

/**
 * Pre-filtra e ordina provvedimenti per score_estratti.
 *
 * @param {string} quesito
 * @param {object[]} provvedimenti - ogni item può avere un campo _pagina_sorgente (number)
 * @param {{ termini_primari: string[], termini_abstract: string[] }} termini
 * @param {{
 *   soglia_apri?: number,
 *   soglia_forse?: number,
 *   max_da_aprire?: number
 * }} opzioni
 * @returns {{
 *   da_aprire: object[],
 *   forse: object[],
 *   saltati: number,
 *   stats: {
 *     totale_analizzati: number,
 *     pagine_analizzate: number,
 *     distribuzione_score: { min: number, max: number, media: number }
 *   }
 * }}
 */
export function prefiltraPerEstratti(quesito, provvedimenti, termini, opzioni = {}) {
  const {
    soglia_apri = 0.35,
    soglia_forse = 0.15,
    max_da_aprire = 15,
  } = opzioni;

  if (!provvedimenti || provvedimenti.length === 0) {
    return {
      da_aprire: [],
      forse: [],
      saltati: 0,
      stats: {
        totale_analizzati: 0,
        pagine_analizzate: 0,
        distribuzione_score: { min: 0, max: 0, media: 0 },
      },
    };
  }

  // Calcola score per ogni provvedimento
  const scored = provvedimenti.map(prov => {
    const analisi = analizzaEstratti(quesito, prov, termini);
    return { ...prov, ...analisi };
  });

  // Ordina per score decrescente
  scored.sort((a, b) => b.score_estratti - a.score_estratti);

  // Calcola statistiche score
  const scores = scored.map(p => p.score_estratti);
  const minScore = scores.length > 0 ? Math.min(...scores) : 0;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
  const mediaScore = scores.length > 0
    ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 1000) / 1000
    : 0;

  // Determina pagine analizzate
  const pagineSet = new Set();
  for (const p of provvedimenti) {
    if (typeof p._pagina_sorgente === 'number') {
      pagineSet.add(p._pagina_sorgente);
    }
  }
  const pagine_analizzate = pagineSet.size > 0 ? pagineSet.size : 1;

  // Classifica
  const da_aprire = scored
    .filter(p => p.score_estratti >= soglia_apri)
    .slice(0, max_da_aprire);

  const forse = scored
    .filter(p => p.score_estratti >= soglia_forse && p.score_estratti < soglia_apri);

  const saltati = scored.filter(p => p.score_estratti < soglia_forse).length;

  return {
    da_aprire,
    forse,
    saltati,
    stats: {
      totale_analizzati: provvedimenti.length,
      pagine_analizzate,
      distribuzione_score: {
        min: minScore,
        max: maxScore,
        media: mediaScore,
      },
    },
  };
}
