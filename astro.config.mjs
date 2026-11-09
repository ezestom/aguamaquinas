import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone', bodySizeLimit: 17 * 1024 * 1024 }),
  vite: { plugins: [tailwind()] },
  devToolbar: { enabled: false },
  server: { host: '127.0.0.1' },
});
