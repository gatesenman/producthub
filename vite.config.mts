import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwind from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const dir = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({ root: 'src/ui', base: './', plugins: [react()], css: { postcss: { plugins: [tailwind(path.join(dir, 'tailwind.config.cjs')), autoprefixer()] } },
  resolve: { alias: { '@': path.join(dir, 'src/ui') } },
  build: { outDir: '../../dist-ui', emptyOutDir: true, chunkSizeWarningLimit: 2000 }, server: { proxy: { '/api': 'http://127.0.0.1:8787', '/images': 'http://127.0.0.1:8787' } } });
