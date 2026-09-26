import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// Pure static SSG output — Cloudflare Pages serves the `dist/` directory
// directly. No adapter needed unless we add server-rendered routes.
export default defineConfig({
  site: 'https://justdb.kreativekorna.com',
  redirects: {
    '/guides': '/blog',
    '/guides/view-sqlite-tables-locally': '/blog/view-sqlite-tables-locally',
    '/guides/edit-postgresql-cells-inline': '/blog/edit-postgresql-cells-inline',
    '/guides/connect-postgres-in-docker': '/blog/connect-postgres-in-docker',
  },
  integrations: [
    tailwind({ applyBaseStyles: false }),
    // Emits sitemap-index.xml + sitemap-0.xml over every built page.
    // robots.txt (in public/) points crawlers at the index.
    sitemap({ filter: (page) => !new URL(page).pathname.startsWith('/guides') }),
  ],
});
