import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const OVERRIDES_FILE = fileURLToPath(new URL('./src/water/plantOverrides.json', import.meta.url));

/**
 * Dev-only endpoint behind the inspector's save button: POST { name, entry } stores a preset
 * override in src/water/plantOverrides.json; `entry: null` removes it.
 */
function savePresetPlugin(): Plugin {
  return {
    name: 'save-water-preset',
    apply: 'serve',
    // Saving must not reload the page (that would discard the live state); the file is read on next load.
    handleHotUpdate(ctx) {
      if (ctx.file === OVERRIDES_FILE.replace(/\\/g, '/')) return [];
    },
    configureServer(server) {
      server.middlewares.use('/__save-water-preset', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const { name, entry } = JSON.parse(body) as { name: string; entry: unknown };
            if (typeof name !== 'string' || !name) throw new Error('missing preset name');
            const all = JSON.parse(readFileSync(OVERRIDES_FILE, 'utf8') || '{}');
            if (entry === null) delete all[name];
            else all[name] = entry;
            writeFileSync(OVERRIDES_FILE, `${JSON.stringify(all, null, 2)}\n`);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, file: 'src/water/plantOverrides.json' }));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [savePresetPlugin()],
  server: {
    host: true,
    port: 5180,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    target: 'esnext',
  },
});
