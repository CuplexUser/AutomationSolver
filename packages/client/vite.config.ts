import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const DRACO_FILES = ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'];

// Serves three's bundled Draco decoder at /draco/ (dev) and copies it into
// dist/draco/ (build), so GLTF loading never reaches out to the Google CDN
// and the decoder always matches the installed three version.
function localDracoDecoder(): Plugin {
  const require = createRequire(import.meta.url);
  const dracoDir = path.dirname(
    require.resolve('three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js'),
  );
  return {
    name: 'local-draco-decoder',
    configureServer(server) {
      server.middlewares.use('/draco', (req, res, next) => {
        const name = path.posix.basename((req.url ?? '').split('?')[0]);
        if (!DRACO_FILES.includes(name)) return next();
        res.setHeader(
          'Content-Type',
          name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
        );
        res.end(fs.readFileSync(path.join(dracoDir, name)));
      });
    },
    generateBundle() {
      for (const name of DRACO_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `draco/${name}`,
          source: fs.readFileSync(path.join(dracoDir, name)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), localDracoDecoder()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
