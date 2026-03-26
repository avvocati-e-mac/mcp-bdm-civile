import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerSearchTools } from './tools/search.js';
import { registerContentTools } from './tools/content.js';
import { registerNavigationTools } from './tools/navigation.js';
import { registerUtilityTools } from './tools/utility.js';
import { closeSharedContext } from './browser/browser-singleton.js';

// CRITICO: stdio transport — console.log su stdout corrompe il protocollo MCP.
// USA SEMPRE console.error() per il logging in questo progetto.

const server = new McpServer({
  name: 'bdp-merito',
  version: '1.0.0',
  description: 'Consulta la Banca Dati di Merito del Ministero della Giustizia (bdp.giustizia.it)',
});

registerSearchTools(server);
registerContentTools(server);
registerNavigationTools(server);
registerUtilityTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[mcp-bdp] Server avviato su stdio');

// Shutdown pulito del browser singleton
const shutdown = async () => {
  console.error('[mcp-bdp] Shutdown in corso...');
  await closeSharedContext();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
