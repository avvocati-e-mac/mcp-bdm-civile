import { getPage, assertNotRedirectedToLogin } from '../browser/browser-factory.js';

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerUtilityTools(server) {
  // Tool 9: verifica_sessione
  server.registerTool(
    'verifica_sessione',
    {
      title: 'Verifica Sessione CIE',
      description: 'Verifica se la sessione CIE è ancora attiva navigando la BDP',
      annotations: { readOnlyHint: true, idempotentHint: false },
    },
    async () => {
      const page = await getPage();
      try {
        await page.goto('https://bdp.giustizia.it/', { waitUntil: 'networkidle' });
        const sessioneValida =
          !page.url().includes('idserver') && !page.url().includes('pst.giustizia') && !page.url().includes('/login');
        const result = {
          valida: sessioneValida,
          messaggio: sessioneValida
            ? 'Sessione attiva'
            : 'Sessione scaduta. Ferma il server (Ctrl+C), esegui: npm run save-session, poi riavvia.',
        };
        return {
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err.message }],
        };
      } finally {
        await page.close();
      }
    }
  );

  // Tool 10: ottieni_materie
  server.registerTool(
    'ottieni_materie',
    {
      title: 'Ottieni Materie Disponibili',
      description: 'Estrae le materie disponibili dal select della ricerca BDP (live, non hardcoded)',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const page = await getPage();
      try {
        await page.goto('https://bdp.giustizia.it/search/standard?target=provvedimento', {
          waitUntil: 'networkidle',
        });
        assertNotRedirectedToLogin(page);
        const materie = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('#materia option'))
            .map((o) => o.textContent.trim())
            .filter(Boolean);
        });
        return {
          structuredContent: { materie },
          content: [{ type: 'text', text: JSON.stringify({ materie }) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err.message }],
        };
      } finally {
        await page.close();
      }
    }
  );

  // Tool 11: ottieni_distretti
  server.registerTool(
    'ottieni_distretti',
    {
      title: 'Ottieni Distretti Giudiziari',
      description: 'Estrae i distretti giudiziari disponibili dal select della ricerca BDP (live, non hardcoded)',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const page = await getPage();
      try {
        await page.goto('https://bdp.giustizia.it/search/standard?target=provvedimento', {
          waitUntil: 'networkidle',
        });
        assertNotRedirectedToLogin(page);
        const distretti = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('#distretto option'))
            .map((o) => o.textContent.trim())
            .filter(Boolean);
        });
        return {
          structuredContent: { distretti },
          content: [{ type: 'text', text: JSON.stringify({ distretti }) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err.message }],
        };
      } finally {
        await page.close();
      }
    }
  );
}
