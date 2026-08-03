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
    // Fallback Astro (nginx a déjà les 301 sans/avec slash)
    '/abonnement-2/': '/abonnement/',
    '/subscribe-page-electronlibre/': '/abonnement/',
  },
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@el/excerpt': path.join(root, 'shared/excerpt.mjs'),
        '@el/categories': path.join(root, 'shared/categories.mjs'),
        '@el/editorial-update': path.join(root, 'shared/editorial-update.mjs'),
        '@el/article-path': path.join(root, 'shared/article-path.mjs'),
        '@el/article-row': path.join(root, 'shared/article-row.mjs'),
        '@el/roles': path.join(root, 'shared/roles.mjs'),
        '@el/slugify': path.join(root, 'shared/slugify.mjs'),
        '@el/humanize': path.join(root, 'shared/humanize.mjs'),
      },
    },
    server: {
      fs: { allow: [root] },
    },
  },
});
