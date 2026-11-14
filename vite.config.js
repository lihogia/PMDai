import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';

const cfg = JSON.parse(fs.readFileSync(new URL('./pmdai.config.json', import.meta.url), 'utf8'));
const apiPort = process.env.PORT || cfg.port || 4319;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true } } },
});
