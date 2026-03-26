import { z } from 'zod';
import { analizzaQuesito } from '../workflows/analisi-quesito.js';

const AnalizzaQuesitioSchema = z.object({
  quesito: z.string().min(10).describe('Quesito giuridico in linguaggio naturale'),
  max_provvedimenti: z.number().int().min(1).max(30).default(10),
  max_pagine_serp: z.number().int().min(1).max(20).default(5),
  max_per_query: z.number().int().min(5).max(30).default(15),
  include_abstract: z.boolean().default(true),
  soglia_score: z.number().min(0).max(1).default(0.1),
  soglia_apri: z.number().min(0).max(1).default(0.35),
  max_da_aprire: z.number().int().min(1).max(30).default(15),
});

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerWorkflowTools(server) {
  server.registerTool(
    'analisi_quesito_giuridico',
    {
      title: 'Analisi Quesito Giuridico',
      description: 'Pipeline a due fasi: (1) scansiona più pagine SERP BDP analizzando gli estratti testuali per identificare i provvedimenti più promettenti; (2) apre e legge integralmente SOLO i candidati selezionati, calcolando uno score finale. Usa come primo passo per qualsiasi ricerca giuridica sulla BDP.',
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
        });
        return { content: [{ type: 'text', text: JSON.stringify(risultato, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
    }
  );
}
