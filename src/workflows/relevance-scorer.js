/**
 * Scoring finale basato sul contenuto completo del documento.
 *
 * Funzioni PURE (no side effects, no I/O).
 */

/**
 * Normalizza un testo per il confronto.
 * @param {string} text
 * @returns {string}
 */
function normalizza(text) {
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
function tokenizza(text) {
  return normalizza(text)
    .split(/\s+/)
    .filter(t => t.length > 2);
}

/**
 * Calcola la similarità Jaccard tra due insiemi di token.
 * @param {string[]} setA
 * @param {string[]} setB
 * @returns {number} [0-1]
 */
function jaccardSimilarity(setA, setB) {
  if (setA.length === 0 && setB.length === 0) return 0;
  const a = new Set(setA);
  const b = new Set(setB);
  let intersection = 0;
  for (const v of a) {
    if (b.has(v)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Materie correlate: se la materia del provvedimento è correlata alla materia
 * suggerita del quesito, restituisce 0.5 invece di 0.0.
 */
const MATERIE_CORRELATE = {
  'Diritto civile': ['Diritto di famiglia', 'Diritto processuale civile', 'Diritto commerciale'],
  'Diritto del lavoro': ['Diritto civile', 'Diritto processuale civile'],
  'Diritto di famiglia': ['Diritto civile'],
  'Diritto commerciale': ['Diritto civile', 'Diritto processuale civile'],
  'Diritto processuale civile': ['Diritto civile', 'Diritto del lavoro'],
};

/**
 * Score finale [0-1] sul contenuto completo del documento.
 *
 * Pesi:
 * - peso_parole_chiave (40%): overlap Jaccard tra termini quesito e provvedimento.parole_chiave
 * - peso_materia (25%): 1.0 se materia corrisponde, 0.5 se correlata, 0.0 se irrilevante
 * - peso_abstract (20%): 1.0 se n_abstract_collegati > 0, 0.5 se ha estratti, 0.0 altrimenti
 * - peso_riferimenti (15%): overlap riferimenti normativi
 *
 * @param {string} quesito
 * @param {object} provvedimento
 * @param {{
 *   materia_suggerita?: string|null,
 *   riferimenti_normativi?: string[],
 *   termini_primari?: string[],
 *   peso_parole_chiave?: number,
 *   peso_materia?: number,
 *   peso_abstract?: number,
 *   peso_riferimenti?: number
 * }} opzioni
 * @returns {object} provvedimento con _score e _score_dettaglio aggiunti
 */
export function calcolaScore(quesito, provvedimento, opzioni = {}) {
  const {
    materia_suggerita = null,
    riferimenti_normativi: rifNormQuesito = [],
    termini_primari = [],
    peso_parole_chiave = 0.40,
    peso_materia = 0.25,
    peso_abstract = 0.20,
    peso_riferimenti = 0.15,
  } = opzioni;

  // ── 1. Parole chiave — Jaccard ──────────────────────────────────────────────
  const tokensQuesito = [
    ...tokenizza(quesito),
    ...termini_primari.flatMap(t => tokenizza(t)),
  ];
  const tokensProvv = [
    ...(provvedimento.parole_chiave ?? []).flatMap(pk => tokenizza(pk)),
    ...tokenizza(provvedimento.materia ?? ''),
    ...tokenizza(provvedimento.estremi ?? ''),
  ];
  const scoreParoleChiave = jaccardSimilarity(tokensQuesito, tokensProvv);

  // ── 2. Materia ──────────────────────────────────────────────────────────────
  let scoreMateria = 0;
  if (materia_suggerita && provvedimento.materia) {
    const materiaProvv = provvedimento.materia.trim();
    if (materiaProvv === materia_suggerita) {
      scoreMateria = 1.0;
    } else {
      const correlate = MATERIE_CORRELATE[materia_suggerita] ?? [];
      if (correlate.some(m => materiaProvv.includes(m) || m.includes(materiaProvv))) {
        scoreMateria = 0.5;
      }
    }
  } else if (!materia_suggerita) {
    // Se non c'è materia suggerita, ignoriamo questo componente
    scoreMateria = 0.5;
  }

  // ── 3. Abstract ─────────────────────────────────────────────────────────────
  let scoreAbstract = 0;
  if ((provvedimento.n_abstract_collegati ?? 0) > 0) {
    scoreAbstract = 1.0;
  } else if ((provvedimento.estratti ?? []).length > 0) {
    scoreAbstract = 0.5;
  }

  // ── 4. Riferimenti normativi ─────────────────────────────────────────────────
  let scoreRiferimenti = 0;
  if (rifNormQuesito.length > 0 && (provvedimento.riferimenti_normativi ?? []).length > 0) {
    const rifNormProvv = (provvedimento.riferimenti_normativi ?? []).map(r => normalizza(r));
    const rifNormQ = rifNormQuesito.map(r => normalizza(r));
    scoreRiferimenti = jaccardSimilarity(rifNormQ, rifNormProvv);
  } else if (rifNormQuesito.length === 0) {
    // Nessun riferimento normativo nel quesito: componente neutro
    scoreRiferimenti = 0.5;
  }

  // ── Score finale ────────────────────────────────────────────────────────────
  const _score =
    scoreParoleChiave * peso_parole_chiave +
    scoreMateria * peso_materia +
    scoreAbstract * peso_abstract +
    scoreRiferimenti * peso_riferimenti;

  const _score_dettaglio = {
    parole_chiave: Math.round(scoreParoleChiave * 1000) / 1000,
    materia: Math.round(scoreMateria * 1000) / 1000,
    abstract: Math.round(scoreAbstract * 1000) / 1000,
    riferimenti: Math.round(scoreRiferimenti * 1000) / 1000,
    pesi: { peso_parole_chiave, peso_materia, peso_abstract, peso_riferimenti },
  };

  return {
    ...provvedimento,
    _score: Math.round(_score * 1000) / 1000,
    _score_dettaglio,
  };
}

/**
 * Ordina per score decrescente e filtra sotto soglia.
 *
 * @param {string} quesito
 * @param {object[]} provvedimenti - ogni item deve avere _score (pre-calcolato)
 *   oppure verrà calcolato con opzioni di default
 * @param {number} soglia_minima - default 0.1
 * @returns {object[]}
 */
export function ordinaPerPertinenza(quesito, provvedimenti, soglia_minima = 0.1) {
  if (!provvedimenti || provvedimenti.length === 0) return [];

  // Assicuriamo che ogni provvedimento abbia _score
  const scored = provvedimenti.map(p => {
    if (typeof p._score === 'number') return p;
    return calcolaScore(quesito, p);
  });

  return scored
    .filter(p => p._score >= soglia_minima)
    .sort((a, b) => b._score - a._score);
}
