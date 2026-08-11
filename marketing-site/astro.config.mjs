import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// https://astro.build/config
// The @astrojs/node standalone adapter reads HOST and PORT from the runtime
// environment (process.env) when `dist/server/entry.mjs` boots. This means:
//   - Railway injects PORT → the server listens on Railway's expected port.
//   - If PORT is unset (local dev), the adapter falls back to 4321.
// We bind host:true so dev/preview listen on 0.0.0.0 (all interfaces),
// matching the HOST=0.0.0.0 set in the `start` script for production.
export default defineConfig({
  output: 'hybrid',
  adapter: node({ mode: 'standalone' }),
  server: {
    host: true,
    allowedHosts: true,
  },
  vite: {
    server: {
      allowedHosts: true,
    },
  },
});
