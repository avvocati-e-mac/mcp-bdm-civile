/**
 * Estrae termini di ricerca ottimizzati per BDP a partire da un quesito giuridico.
 * Logica DETERMINISTICA: usa dizionario di sinonimi giuridici IT.
 */

const STOPWORDS = new Set([
  'la', 'il', 'del', 'dei', 'nelle', 'agli', 'per', 'con', 'che', 'una', 'uno',
  'di', 'da', 'in', 'a', 'e', 'o', 'se', 'ma', 'non', 'su', 'al', 'lo', 'le',
  'un', 'i', 'gli', 'ne', 'si', 'ci', 'vi', 'c', 'è', 'come', 'questo', 'questa',
  'tale', 'caso', 'fatto', 'tra', 'fra', 'dopo', 'prima', 'poi', 'anche', 'solo',
  'più', 'molto', 'quando', 'dove', 'mentre', 'quindi', 'però', 'oppure', 'sia',
  'sono', 'stata', 'stato', 'essere', 'avere', 'fare', 'quale', 'quali',
]);

/**
 * Dizionario sinonimi giuridici IT: token → lista di termini di ricerca correlati.
 * Ogni entry produce termini_primari aggiuntivi.
 */
const SINONIMI_GIURIDICI = {
  // Responsabilità civile / medica
  'medico': ['colpa medica', 'responsabilità sanitaria', 'malpractice medica'],
  'sanitario': ['colpa medica', 'responsabilità sanitaria', 'negligenza medica'],
  'ospedale': ['responsabilità ospedaliera', 'struttura sanitaria', 'azienda sanitaria'],
  'malpractice': ['colpa medica', 'responsabilità sanitaria'],

  // Lavoro
  'licenziamento': ['recesso datoriale', 'art. 18 l. 300/1970', 'reintegra lavoratore'],
  'lavoro': ['rapporto di lavoro', 'contratto di lavoro subordinato'],
  'lavoratore': ['dipendente', 'rapporto di lavoro', 'recesso datoriale'],
  'mobbing': ['comportamento persecutorio', 'danno lavoratore', 'molestie lavoro'],
  'discriminazione': ['parità di trattamento', 'comportamento discriminatorio'],

  // Contratti
  'locazione': ['contratto di affitto', 'art. 1571 c.c.', 'canone locativo', 'conduttore locatore'],
  'affitto': ['contratto di locazione', 'art. 1571 c.c.', 'canone affitto'],
  'contratto': ['inadempimento contrattuale', 'risoluzione contratto', 'art. 1453 c.c.'],
  'inadempimento': ['risoluzione contratto', 'art. 1453 c.c.', 'mora debitoris'],
  'appalto': ['contratto di appalto', 'art. 1655 c.c.', 'appaltatore'],

  // Risarcimento danni
  'risarcimento': ['danno patrimoniale', 'danno non patrimoniale', 'liquidazione danni'],
  'danno': ['risarcimento danni', 'danno patrimoniale', 'danno non patrimoniale'],
  'mora': ['interessi moratori', 'mora debitoris', 'art. 1282 c.c.'],

  // Famiglia
  'divorzio': ['scioglimento matrimonio', 'l. 898/1970', 'assegno divorzile'],
  'separazione': ['separazione coniugale', 'assegno separazione', 'affidamento figli'],
  'affidamento': ['affidamento minori', 'genitorialità', 'interesse superiore minore'],
  'eredità': ['successione ereditaria', 'art. 565 c.c.', 'asse ereditario'],
  'testamento': ['disposizioni testamentarie', 'volontà testatore', 'art. 587 c.c.'],

  // Proprietà / Immobili
  'proprietà': ['diritto di proprietà', 'art. 832 c.c.', 'tutela proprietà'],
  'usucapione': ['acquisto proprietà', 'art. 1158 c.c.', 'possesso continuato'],
  'condominio': ['parti comuni', 'assemblea condominiale', 'art. 1117 c.c.'],
  'servitù': ['diritto di servitù', 'art. 1027 c.c.', 'fondo dominante servente'],

  // Responsabilità extracontrattuale
  'incidente': ['sinistro stradale', 'responsabilità extracontrattuale', 'art. 2054 c.c.'],
  'sinistro': ['incidente stradale', 'art. 2054 c.c.', 'assicurazione responsabilità civile'],

  // Consumatori / Commercio
  'consumatore': ['tutela consumatori', 'd.lgs. 206/2005', 'codice del consumo'],
  'garanzia': ['garanzia legale', 'vizi prodotto', 'art. 1490 c.c.'],

  // Procedure
  'pignoramento': ['espropriazione forzata', 'art. 491 c.p.c.', 'esecuzione forzata'],
  'fallimento': ['procedure concorsuali', 'l. fall.', 'stato insolvenza'],
};

/**
 * Mappa keyword → materia BDP (label esatte del select #materia BDP).
 */
const MATERIA_MAP = [
  { keywords: ['medico', 'sanitario', 'ospedale', 'malpractice', 'colpa medica'], materia: 'Diritto civile' },
  { keywords: ['licenziamento', 'lavoro', 'lavoratore', 'mobbing', 'sindacato', 'discriminazione', 'ccnl'], materia: 'Diritto del lavoro' },
  { keywords: ['locazione', 'affitto', 'condominio', 'proprietà', 'usucapione', 'servitù', 'immobile'], materia: 'Diritto civile' },
  { keywords: ['contratto', 'appalto', 'compravendita', 'inadempimento', 'garanzia', 'consumatore'], materia: 'Diritto civile' },
  { keywords: ['divorzio', 'separazione', 'affidamento', 'minore', 'coniuge', 'matrimonio', 'eredità', 'testamento'], materia: 'Diritto di famiglia' },
  { keywords: ['fallimento', 'insolvenza', 'concordato', 'bancarotta', 'procedure concorsuali'], materia: 'Diritto commerciale' },
  { keywords: ['incidente', 'sinistro', 'assicurazione', 'rc auto', 'risarcimento stradale'], materia: 'Diritto civile' },
  { keywords: ['pignoramento', 'espropriazione', 'esecuzione forzata'], materia: 'Diritto processuale civile' },
];

/**
 * Patterns per riferimenti normativi.
 */
const NORM_PATTERNS = [
  /\bart\.\s*\d+[\w-]*(?:\s*(?:comma|co\.)\s*\d+)?(?:\s+c\.c\.|c\.p\.c\.|c\.p\.|l\.fall\.)?/gi,
  /\bd\.lgs\.\s*\d+\/\d{4}/gi,
  /\bl\.\s*\d+\/\d{4}/gi,
  /\bd\.p\.r\.\s*\d+\/\d{4}/gi,
  /\bregolamento\s*(?:UE|CE|n\.)\s*[\d\/]+/gi,
];

/**
 * Normalizza testo: lowercase, rimuove punteggiatura in eccesso.
 * @param {string} text
 * @returns {string}
 */
function normalizza(text) {
  return text
    .toLowerCase()
    .replace(/["""''«»]/g, ' ')
    .replace(/[;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenizza testo normalizzato rimuovendo stopwords.
 * @param {string} testo
 * @returns {string[]}
 */
function tokenizza(testo) {
  return testo
    .split(/[\s,.()\[\]{}]+/)
    .map(t => t.replace(/[^a-zàèéìòù0-9]/g, '').trim())
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Estrae bigram da una lista di token.
 * @param {string[]} tokens
 * @returns {string[]}
 */
function estrai_bigram(tokens) {
  const bigram = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!STOPWORDS.has(tokens[i]) && !STOPWORDS.has(tokens[i + 1])) {
      bigram.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
  }
  return bigram;
}

/**
 * Estrae trigram da una lista di token.
 * @param {string[]} tokens
 * @returns {string[]}
 */
function estrai_trigram(tokens) {
  const trigram = [];
  for (let i = 0; i < tokens.length - 2; i++) {
    if (!STOPWORDS.has(tokens[i]) && !STOPWORDS.has(tokens[i + 2])) {
      trigram.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
    }
  }
  return trigram;
}

/**
 * Rileva riferimenti normativi dal testo originale.
 * @param {string} quesito
 * @returns {string[]}
 */
function rilevaRiferimentiNormativi(quesito) {
  const trovati = new Set();
  for (const pattern of NORM_PATTERNS) {
    const matches = quesito.match(pattern) ?? [];
    for (const m of matches) {
      trovati.add(m.trim().toLowerCase());
    }
  }
  return Array.from(trovati);
}

/**
 * Suggerisce la materia BDP in base ai token del quesito.
 * @param {string[]} tokens
 * @param {string} quesito
 * @returns {string|null}
 */
function suggerisciMateria(tokens, quesito) {
  const testoCompleto = quesito.toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const { keywords, materia } of MATERIA_MAP) {
    let score = 0;
    for (const kw of keywords) {
      if (testoCompleto.includes(kw)) score += 2;
      else if (tokens.some(t => t === kw || kw.includes(t))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = materia;
    }
  }

  return bestScore > 0 ? best : null;
}

/**
 * Suggerisce il tipo di provvedimento in base al quesito.
 * @param {string} quesito
 * @returns {'TUTTI'|'SENTENZA'|'ORDINANZA'|'DECRETO'}
 */
function suggerisciTipo(quesito) {
  const lower = quesito.toLowerCase();
  if (lower.includes('ordinanza') || lower.includes('misura cautelare') || lower.includes('sequestro')) {
    return 'ORDINANZA';
  }
  if (lower.includes('decreto') || lower.includes('ingiunzione')) {
    return 'DECRETO';
  }
  if (lower.includes('sentenza')) {
    return 'SENTENZA';
  }
  return 'TUTTI';
}

/**
 * Estrae termini di ricerca ottimizzati per BDP a partire da un quesito giuridico.
 * Logica DETERMINISTICA: usa dizionario di sinonimi giuridici IT.
 *
 * @param {string} quesito
 * @returns {{
 *   termini_primari: string[],
 *   termini_abstract: string[],
 *   materia_suggerita: string|null,
 *   tipo_suggerito: 'TUTTI'|'SENTENZA'|'ORDINANZA'|'DECRETO',
 *   riferimenti_normativi: string[]
 * }}
 */
export function estraiTerminiRicerca(quesito) {
  if (!quesito || typeof quesito !== 'string' || quesito.trim().length === 0) {
    return {
      termini_primari: [],
      termini_abstract: [],
      materia_suggerita: null,
      tipo_suggerito: 'TUTTI',
      riferimenti_normativi: [],
    };
  }

  const riferimenti_normativi = rilevaRiferimentiNormativi(quesito);
  const testoNorm = normalizza(quesito);
  const tokens = tokenizza(testoNorm);
  const bigram = estrai_bigram(tokens);
  const trigram = estrai_trigram(tokens);

  // Termini primari: token significativi + sinonimi dal dizionario
  const terminiPrimariSet = new Set();

  // Aggiungi i token di base (non stopwords, lunghezza > 3)
  for (const t of tokens) {
    if (t.length > 3) terminiPrimariSet.add(t);
  }

  // Aggiungi sinonimi dal dizionario
  for (const t of tokens) {
    if (SINONIMI_GIURIDICI[t]) {
      for (const sinonimo of SINONIMI_GIURIDICI[t]) {
        terminiPrimariSet.add(sinonimo);
      }
    }
  }

  // Aggiungi bigram significativi (max 3)
  const bigramSignificativi = bigram.filter(bg => {
    const parts = bg.split(' ');
    return parts.every(p => p.length > 3 && !STOPWORDS.has(p));
  }).slice(0, 3);

  for (const bg of bigramSignificativi) {
    terminiPrimariSet.add(bg);
  }

  // Termini abstract: trigram + termini più specifici per abstract/massime
  const terminiAbstractSet = new Set();

  // Aggiungi trigram
  const trigramSignificativi = trigram.filter(tg => {
    const parts = tg.split(' ');
    return parts.filter(p => p.length > 3 && !STOPWORDS.has(p)).length >= 2;
  }).slice(0, 3);

  for (const tg of trigramSignificativi) {
    terminiAbstractSet.add(tg);
  }

  // Aggiungi anche alcuni termini primari negli abstract
  for (const t of tokens) {
    if (t.length > 4) terminiAbstractSet.add(t);
  }

  const materia_suggerita = suggerisciMateria(tokens, quesito);
  const tipo_suggerito = suggerisciTipo(quesito);

  return {
    termini_primari: Array.from(terminiPrimariSet),
    termini_abstract: Array.from(terminiAbstractSet),
    materia_suggerita,
    tipo_suggerito,
    riferimenti_normativi,
  };
}
