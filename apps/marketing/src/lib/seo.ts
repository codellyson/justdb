/**
 * Shared JSON-LD builders. Structured data is JustDB's main lever for *entity
 * authority* (SEO pillar 2): it tells Google the desktop app is a distinct
 * SoftwareApplication — not the Linux `--justdb` flag, a Python library or a
 * no-code SaaS — and ties every page back to one Organization + WebSite node.
 *
 * Keep the graph small and honest: no aggregateRating/review markup we can't
 * back with real, visible reviews (Google flags self-served ratings).
 */
import {
  ORG_NAME,
  ORG_URL,
  RELEASES_URL,
  REPO_ORG_URL,
  REPO_URL,
  SITE_NAME,
  SITE_URL,
} from './site';

type Json = Record<string, unknown>;

/** Stable @id for the publisher node so other nodes can reference it. */
const ORG_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const SOFTWARE_ID = `${SITE_URL}/#software`;

export const organizationJsonLd: Json = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': ORG_ID,
  name: ORG_NAME,
  url: ORG_URL,
  logo: `${SITE_URL}/logo.svg`,
  sameAs: [REPO_ORG_URL, ORG_URL],
};

export const websiteJsonLd: Json = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  name: SITE_NAME,
  url: SITE_URL,
  publisher: { '@id': ORG_ID },
};

/**
 * Enriched SoftwareApplication. `featureList`, `screenshot`, `operatingSystem`
 * and the free `offers` node are the fields Google surfaces for app-style rich
 * results and, crucially, the ones that disambiguate the entity.
 */
export function softwareApplicationJsonLd(opts: { softwareVersion?: string } = {}): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': SOFTWARE_ID,
    name: SITE_NAME,
    description:
      'A simple database client for developers. Browse tables, run SQL and edit records in PostgreSQL, SQLite and Turso — free, no signup, and connecting straight from your machine.',
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Database Client',
    operatingSystem: 'macOS, Windows',
    url: SITE_URL,
    downloadUrl: RELEASES_URL,
    softwareHelp: `${REPO_URL}#readme`,
    screenshot: `${SITE_URL}/justdb-shot.png`,
    ...(opts.softwareVersion ? { softwareVersion: opts.softwareVersion } : {}),
    featureList: [
      'Browse tables, views, columns, indexes and foreign keys',
      'Run SQL with completion, formatting and EXPLAIN plans',
      'Edit records inline with a staged Review-SQL step',
      'Follow foreign keys and preview delete cascades',
      'Import and export CSV, JSON, SQL and Excel',
      'Direct local connections with credentials in the OS keychain',
    ],
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@id': ORG_ID },
  };
}

/**
 * BreadcrumbList for a sub-page. Pass the trail in order, root first, e.g.
 * `[{ name: 'JustDB', path: '/' }, { name: 'Compare', path: '/compare' }, …]`.
 */
export function breadcrumbJsonLd(trail: { name: string; path: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(({ name, path }, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: new URL(path, SITE_URL).toString(),
    })),
  };
}

/** WebPage node, tied to the site's WebSite — used by content sub-pages. */
export function webPageJsonLd(opts: { title: string; description: string; path: string }): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: opts.title,
    description: opts.description,
    url: new URL(opts.path, SITE_URL).toString(),
    isPartOf: { '@id': WEBSITE_ID },
    publisher: { '@id': ORG_ID },
  };
}

/** FAQPage node from a list of Q/A pairs. */
export function faqJsonLd(faq: { q: string; a: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

/** TechArticle node for a knowledge-base guide. */
export function articleJsonLd(opts: {
  title: string;
  description: string;
  path: string;
}): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: opts.title,
    description: opts.description,
    url: new URL(opts.path, SITE_URL).toString(),
    author: { '@id': ORG_ID },
    publisher: { '@id': ORG_ID },
    isPartOf: { '@id': WEBSITE_ID },
  };
}
