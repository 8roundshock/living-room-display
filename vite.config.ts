import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:4318', changeOrigin: true } } },
  // #711: the client output starts empty each build, so dist/client (and the installed payload, which copies dist)
  // holds only this build's hashed chunks. Only dist/client is emptied: tsc writes dist/server and dist/shared.
  // A page that outlived an update recovers through src/client/stale-build.ts.
  build: { outDir: 'dist/client', emptyOutDir: true, target: 'es2022' },
});
