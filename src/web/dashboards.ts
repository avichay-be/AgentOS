import fs from 'fs';
import path from 'path';

import { z } from 'zod';

import { resolveGroupFolderPath } from '../group-folder.js';

const DASHBOARD_MANIFEST_FILENAME = /^[a-z0-9][a-z0-9_-]{0,63}\.json$/;
const DASHBOARD_HTML_FILENAME = /^[a-z0-9][a-z0-9_-]{0,63}\.html$/;
const DASHBOARD_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const LEGACY_DASHBOARD_HTML = 'dashboard.html';
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_HTML_BYTES = 512 * 1024;

const markdownBlockSchema = z.object({
  type: z.literal('markdown'),
  title: z.string().min(1).max(120).optional(),
  markdown: z.string().min(1).max(50_000),
});

const heroBlockSchema = z.object({
  type: z.literal('hero'),
  eyebrow: z.string().max(80).optional(),
  title: z.string().min(1).max(160),
  subtitle: z.string().max(500).optional(),
});

const statsBlockSchema = z.object({
  type: z.literal('stats'),
  title: z.string().min(1).max(120).optional(),
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        value: z.string().min(1).max(120),
        trend: z.enum(['up', 'down', 'flat']).optional(),
        detail: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(12),
});

const tableBlockSchema = z.object({
  type: z.literal('table'),
  title: z.string().min(1).max(120).optional(),
  columns: z.array(z.string().min(1).max(80)).min(1).max(12),
  rows: z.array(z.array(z.string().max(500)).max(12)).max(200),
});

const listBlockSchema = z.object({
  type: z.literal('list'),
  title: z.string().min(1).max(120).optional(),
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        body: z.string().max(2_000).optional(),
        meta: z.string().max(160).optional(),
      }),
    )
    .min(1)
    .max(100),
});

const timelineBlockSchema = z.object({
  type: z.literal('timeline'),
  title: z.string().min(1).max(120).optional(),
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        timestamp: z.string().max(120).optional(),
        body: z.string().max(2_000).optional(),
      }),
    )
    .min(1)
    .max(100),
});

const chartBlockSchema = z.object({
  type: z.literal('chart'),
  title: z.string().min(1).max(120).optional(),
  chartType: z.enum(['line', 'bar']),
  series: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        points: z
          .array(
            z.object({
              label: z.string().min(1).max(80),
              value: z.number().finite(),
            }),
          )
          .min(1)
          .max(200),
      }),
    )
    .min(1)
    .max(8),
});

export const dashboardComponentSchema = z.discriminatedUnion('type', [
  markdownBlockSchema,
  heroBlockSchema,
  statsBlockSchema,
  tableBlockSchema,
  listBlockSchema,
  timelineBlockSchema,
  chartBlockSchema,
]);

export const dashboardManifestSchema = z.object({
  version: z.literal(1),
  slug: z.string().regex(DASHBOARD_SLUG),
  title: z.string().min(1).max(160),
  description: z.string().max(500).optional(),
  updatedAt: z.string().datetime().optional(),
  components: z.array(dashboardComponentSchema).min(1).max(50),
});

export type DashboardManifest = z.infer<typeof dashboardManifestSchema>;
export type DashboardKind = 'manifest' | 'html';

export interface DashboardSummary {
  slug: string;
  title: string;
  description?: string;
  updatedAt?: string;
  path: string;
  kind: DashboardKind;
  origin: 'published' | 'legacy';
}

export interface HtmlDashboardDocument {
  kind: 'html';
  version: 1;
  slug: string;
  title: string;
  description?: string;
  updatedAt?: string;
}

export interface ManifestDashboardDocument {
  kind: 'manifest';
  manifest: DashboardManifest;
}

export type PublishedDashboardDocument =
  | ManifestDashboardDocument
  | HtmlDashboardDocument;

function getDashboardDir(groupFolder: string): string {
  const groupDir = resolveGroupFolderPath(groupFolder);
  return path.resolve(groupDir, 'published', 'dashboards');
}

function getLegacyDashboardPath(groupFolder: string): string {
  const groupDir = resolveGroupFolderPath(groupFolder);
  return path.resolve(groupDir, LEGACY_DASHBOARD_HTML);
}

function parseDashboardFile(filePath: string): DashboardManifest {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_MANIFEST_BYTES) {
    throw new Error(`Dashboard file exceeds ${MAX_MANIFEST_BYTES} bytes`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  return dashboardManifestSchema.parse(JSON.parse(raw));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return undefined;
  return collapseWhitespace(decodeHtmlEntities(match[1].replace(/<[^>]*>/g, '')));
}

function extractMetaContent(html: string, name: string): string | undefined {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const expected = name.toLowerCase();

  for (const tag of tags) {
    const nameMatch = tag.match(/\b(?:name|property)=["']([^"']+)["']/i);
    const contentMatch = tag.match(/\bcontent=["']([^"']*)["']/i);
    if (!nameMatch || !contentMatch) continue;
    if (nameMatch[1].toLowerCase() !== expected) continue;
    return collapseWhitespace(decodeHtmlEntities(contentMatch[1]));
  }

  return undefined;
}

function inferTitleFromSlug(slug: string): string {
  const words = slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1));
  return words.join(' ') || 'Dashboard';
}

function normalizeUpdatedAt(value: string | undefined, fallbackDate: Date): string {
  if (!value) return fallbackDate.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallbackDate.toISOString();
  return parsed.toISOString();
}

function parseHtmlDashboardFile(
  filePath: string,
  slug: string,
): { document: HtmlDashboardDocument; html: string } {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_HTML_BYTES) {
    throw new Error(`Dashboard HTML exceeds ${MAX_HTML_BYTES} bytes`);
  }

  const html = fs.readFileSync(filePath, 'utf8');
  const title =
    extractMetaContent(html, 'agentos:title') ||
    extractHtmlTitle(html) ||
    inferTitleFromSlug(slug);
  const description =
    extractMetaContent(html, 'agentos:description') ||
    extractMetaContent(html, 'description');
  const updatedAt = normalizeUpdatedAt(
    extractMetaContent(html, 'agentos:updatedAt') ||
      extractMetaContent(html, 'updatedAt'),
    stat.mtime,
  );

  return {
    document: {
      kind: 'html',
      version: 1,
      slug,
      title: title.slice(0, 160),
      description: description?.slice(0, 500),
      updatedAt,
    },
    html,
  };
}

function getPublishedManifestPath(groupFolder: string, slug: string): string {
  return path.join(getDashboardDir(groupFolder), `${slug}.json`);
}

function getPublishedHtmlPath(groupFolder: string, slug: string): string {
  return path.join(getDashboardDir(groupFolder), `${slug}.html`);
}

function createPublishedDashboardSlug(date: Date): string {
  const compact = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'z')
    .toLowerCase();
  return `dashboard-${compact}`;
}

export function listPublishedDashboards(groupFolder: string): DashboardSummary[] {
  const summaries = new Map<string, DashboardSummary>();
  const dashboardDir = getDashboardDir(groupFolder);
  if (fs.existsSync(dashboardDir)) {
    for (const entry of fs.readdirSync(dashboardDir).sort()) {
      const filePath = path.join(dashboardDir, entry);

      try {
        if (DASHBOARD_MANIFEST_FILENAME.test(entry)) {
          const manifest = parseDashboardFile(filePath);
          summaries.set(manifest.slug, {
            slug: manifest.slug,
            title: manifest.title,
            description: manifest.description,
            updatedAt: manifest.updatedAt,
            path: filePath,
            kind: 'manifest',
            origin: 'published',
          });
          continue;
        }

        if (DASHBOARD_HTML_FILENAME.test(entry)) {
          const slug = entry.slice(0, -'.html'.length);
          if (summaries.has(slug)) continue;
          const artifact = parseHtmlDashboardFile(filePath, slug);
          summaries.set(slug, {
            slug,
            title: artifact.document.title,
            description: artifact.document.description,
            updatedAt: artifact.document.updatedAt,
            path: filePath,
            kind: 'html',
            origin: 'published',
          });
        }
      } catch {
        continue;
      }
    }
  }

  if (!summaries.has('dashboard')) {
    const legacyDashboardPath = getLegacyDashboardPath(groupFolder);
    if (fs.existsSync(legacyDashboardPath)) {
      try {
        const artifact = parseHtmlDashboardFile(legacyDashboardPath, 'dashboard');
        summaries.set('dashboard', {
          slug: 'dashboard',
          title: artifact.document.title,
          description: artifact.document.description,
          updatedAt: artifact.document.updatedAt,
          path: legacyDashboardPath,
          kind: 'html',
          origin: 'legacy',
        });
      } catch {
        // Ignore invalid legacy HTML artifacts so one bad file does not
        // block the rest of the dashboard list.
      }
    }
  }

  return [...summaries.values()].sort((left, right) =>
    (right.updatedAt || '').localeCompare(left.updatedAt || ''),
  );
}

export function getPublishedDashboard(
  groupFolder: string,
  slug: string,
): PublishedDashboardDocument | null {
  if (!DASHBOARD_SLUG.test(slug)) return null;

  const manifestPath = getPublishedManifestPath(groupFolder, slug);
  if (fs.existsSync(manifestPath)) {
    return {
      kind: 'manifest',
      manifest: parseDashboardFile(manifestPath),
    };
  }

  const htmlPath = getPublishedHtmlPath(groupFolder, slug);
  if (fs.existsSync(htmlPath)) {
    return parseHtmlDashboardFile(htmlPath, slug).document;
  }

  if (slug !== 'dashboard') return null;

  const legacyDashboardPath = getLegacyDashboardPath(groupFolder);
  if (!fs.existsSync(legacyDashboardPath)) return null;

  return parseHtmlDashboardFile(legacyDashboardPath, slug).document;
}

export function getPublishedDashboardHtml(
  groupFolder: string,
  slug: string,
): string | null {
  if (!DASHBOARD_SLUG.test(slug)) return null;

  const publishedHtmlPath = getPublishedHtmlPath(groupFolder, slug);
  if (fs.existsSync(publishedHtmlPath)) {
    return parseHtmlDashboardFile(publishedHtmlPath, slug).html;
  }

  if (slug !== 'dashboard') return null;

  const legacyDashboardPath = getLegacyDashboardPath(groupFolder);
  if (!fs.existsSync(legacyDashboardPath)) return null;

  return parseHtmlDashboardFile(legacyDashboardPath, slug).html;
}

export function publishLatestDashboard(
  groupFolder: string,
): DashboardSummary | null {
  const legacyDashboardPath = getLegacyDashboardPath(groupFolder);
  if (!fs.existsSync(legacyDashboardPath)) return null;

  const { document, html } = parseHtmlDashboardFile(legacyDashboardPath, 'dashboard');
  const dashboardDir = getDashboardDir(groupFolder);
  fs.mkdirSync(dashboardDir, { recursive: true });

  let date = new Date();
  let slug = createPublishedDashboardSlug(date);
  let targetPath = getPublishedHtmlPath(groupFolder, slug);
  while (fs.existsSync(targetPath)) {
    date = new Date(date.getTime() + 1000);
    slug = createPublishedDashboardSlug(date);
    targetPath = getPublishedHtmlPath(groupFolder, slug);
  }

  fs.writeFileSync(targetPath, html);

  return {
    slug,
    title: document.title,
    description: document.description,
    updatedAt: new Date().toISOString(),
    path: targetPath,
    kind: 'html',
    origin: 'published',
  };
}
