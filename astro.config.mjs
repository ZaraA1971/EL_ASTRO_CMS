// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import node from '@astrojs/node';

const root = path.dirname(fileURLToPath(import.meta.url));

// https://astro.build/config
export default defineConfig({
  site: 'https://electronlibre.info',
  trailingSlash: 'always',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  redirects: {
    '/abonnement-2': '/abonnement/',
    '/abonnement-2/': '/abonnement/',
  },
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@el/excerpt': path.join(root, 'shared/excerpt.mjs'),
      },
    },
    server: {
      fs: { allow: [root] },
    },
  },
});
