import { z } from 'zod';
import { analizzaQuesito } from '../workflows/analisi-quesito.js';

const TerminiOverrideSchema = z.object({
  termini_primari: z.array(z.string()).min(1),
  termini_abstract: z.array(z.string()).optional().default([]),
  materia_suggerita: z.string().nullable().optional().default(null),
  tipo_suggerito: z.enum(['TUTTI', 'SENTENZA', 'ORDINANZA', 'DECRETO']).optional().default('TUTTI'),
  riferimenti_normativi: z.array(z.string()).optional().default([]),
});

const AnalizzaQuesitioSchema = z.object({
  quesito: z.string().min(10).describe('Quesito giuridico in linguaggio naturale'),
  max_provvedimenti: z.number().int().min(1).max(30).default(10),
  max_pagine_serp: z.number().int().min(1).max(20).default(3),
  max_per_query: z.number().int().min(5).max(30).default(10),
  include_abstract: z.boolean().default(true),
  soglia_score: z.number().min(0).max(1).default(0.1),
  soglia_apri: z.number().min(0).max(1).default(0.35),
  max_da_aprire: z.number().int().min(1).max(30).default(10),
  termini_override: TerminiOverrideSchema.optional().describe(
    'Termini di ricerca pre-calcolati dall\'LLM. Se forniti, sostituiscono il keyword-extractor deterministico interno.'
  ),
  max_query_concorrenti: z.number().int().min(1).max(5).default(2).describe(
    'Numero massimo di query BDP in parallelo. Default 2. Aumentare con cautela per non triggerare rate-limit.'
  ),
  delay_tra_query_ms: z.number().int().min(0).max(10000).default(3000).describe(
    'Millisecondi di pausa tra una query e la successiva (throttle BDP). Default 3000.'
  ),
});

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerWorkflowTools(server) {
  server.registerTool(
    'analisi_quesito_giuridico',
    {
      title: 'Analisi Quesito Giuridico',
      description: `Pipeline a due fasi per ricerca sulla BDP del MinGiustizia: (1) scansiona SERP analizzando estratti per identificare candidati; (2) apre e legge integralmente solo i candidati selezionati.

WORKFLOW CONSIGLIATO: prima di chiamare questo tool, genera i termini di ricerca ottimali e passali in \`termini_override\`. Produce risultati nettamente migliori rispetto al keyword-extractor deterministico interno.

Come generare termini_override:
- termini_primari: 3-8 stringhe tecnico-giuridiche specifiche (istituti, fattispecie, articoli di legge) che compaiono in sentenze. Evita parole generiche. Es: "TFR fallimento lavoratore", "art. 46 l.fall. beni esclusi massa".
- termini_abstract: 2-4 locuzioni precise per abstract/massime.
- materia_suggerita: "Diritto civile" | "Diritto del lavoro" | "Diritto di famiglia" | "Diritto commerciale" | "Diritto processuale civile". Null se incerto o misto.
- tipo_suggerito: "SENTENZA" | "ORDINANZA" | "DECRETO" | "TUTTI".
- riferimenti_normativi: array articoli citati nel quesito (es. ["art. 46 l.fall.", "art. 2119 c.c."]).

Se termini_override è assente, il fallback è il keyword-extractor deterministico interno.`,
      inputSchema: AnalizzaQuesitioSchema,
      annotations: { readOnlyHint: true, idempotentHint: false },
    },
    async (args) => {
      try {
        const risultato = await analizzaQuesito(args.quesito, {
          max_provvedimenti: args.max_provvedimenti,
          max_pagine_serp: args.max_pagine_serp,
          max_per_query: args.max_per_query,
          include_abstract: args.include_abstract,
          soglia_score: args.soglia_score,
          soglia_apri: args.soglia_apri,
          max_da_aprire: args.max_da_aprire,
          termini_override: args.termini_override,
          max_query_concorrenti: args.max_query_concorrenti,
          delay_tra_query_ms: args.delay_tra_query_ms,
        });
        return { content: [{ type: 'text', text: JSON.stringify(risultato, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
    }
  );
}
