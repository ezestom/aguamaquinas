import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwind from '@tailwindcss/vite';
import react from '@astrojs/react';

export default defineConfig({
  output: 'server',
  integrations: [react()],
  adapter: node({ mode: 'standalone', bodySizeLimit: 17 * 1024 * 1024 }),
  vite: {
    plugins: [tailwind()],
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'vaul'],
    },
  },
  devToolbar: { enabled: false },
  server: { host: '127.0.0.1' },
});
