import fs from 'fs';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveGroupFolderPath } from '../group-folder.js';
import {
  getPublishedDashboard,
  getPublishedDashboardHtml,
  listPublishedDashboards,
  publishLatestDashboard,
} from './dashboards.js';

const createdFolders = new Set<string>();

function createGroupFolder(folder: string): string {
  const groupDir = resolveGroupFolderPath(folder);
  fs.rmSync(groupDir, { recursive: true, force: true });
  fs.mkdirSync(groupDir, { recursive: true });
  createdFolders.add(groupDir);
  return groupDir;
}

afterEach(() => {
  for (const groupDir of createdFolders) {
    fs.rmSync(groupDir, { recursive: true, force: true });
  }
  createdFolders.clear();
});

describe('published dashboards', () => {
  it('lists legacy dashboard.html as a sandboxed HTML dashboard', () => {
    const folder = 'dash_html_legacy';
    const groupDir = createGroupFolder(folder);

    fs.writeFileSync(
      path.join(groupDir, 'dashboard.html'),
      [
        '<!doctype html>',
        '<html>',
        '<head>',
        '<title>Macro Board</title>',
        '<meta name="description" content="Daily macro snapshot">',
        '</head>',
        '<body><h1>Hello dashboard</h1></body>',
        '</html>',
      ].join(''),
    );

    const summaries = listPublishedDashboards(folder);
    expect(summaries).toEqual([
      expect.objectContaining({
        slug: 'dashboard',
        title: 'Macro Board',
        description: 'Daily macro snapshot',
        kind: 'html',
      }),
    ]);

    expect(getPublishedDashboard(folder, 'dashboard')).toEqual(
      expect.objectContaining({
        kind: 'html',
        slug: 'dashboard',
        title: 'Macro Board',
      }),
    );
    expect(getPublishedDashboardHtml(folder, 'dashboard')).toContain(
      '<h1>Hello dashboard</h1>',
    );
  });

  it('keeps structured manifests alongside published HTML dashboards', () => {
    const folder = 'dash_html_published';
    const groupDir = createGroupFolder(folder);
    const publishDir = path.join(groupDir, 'published', 'dashboards');
    fs.mkdirSync(publishDir, { recursive: true });

    fs.writeFileSync(
      path.join(publishDir, 'weekly-status.json'),
      JSON.stringify({
        version: 1,
        slug: 'weekly-status',
        title: 'Weekly Status',
        updatedAt: '2026-03-29T08:00:00.000Z',
        components: [
          {
            type: 'hero',
            title: 'Weekly Status',
          },
        ],
      }),
    );

    fs.writeFileSync(
      path.join(publishDir, 'market-wrap.html'),
      [
        '<!doctype html>',
        '<html>',
        '<head>',
        '<title>Market Wrap</title>',
        '<meta name="agentos:updatedAt" content="2026-03-29T09:00:00.000Z">',
        '</head>',
        '<body><p>Markets closed mixed.</p></body>',
        '</html>',
      ].join(''),
    );

    const summaries = listPublishedDashboards(folder);
    expect(summaries.map((entry) => `${entry.kind}:${entry.slug}`)).toEqual([
      'html:market-wrap',
      'manifest:weekly-status',
    ]);

    expect(getPublishedDashboard(folder, 'weekly-status')).toEqual(
      expect.objectContaining({
        kind: 'manifest',
        manifest: expect.objectContaining({
          slug: 'weekly-status',
        }),
      }),
    );
    expect(getPublishedDashboard(folder, 'market-wrap')).toEqual(
      expect.objectContaining({
        kind: 'html',
        slug: 'market-wrap',
      }),
    );
  });

  it('publishes the latest legacy dashboard into the published directory', () => {
    const folder = 'dash_publish_latest';
    const groupDir = createGroupFolder(folder);

    fs.writeFileSync(
      path.join(groupDir, 'dashboard.html'),
      [
        '<!doctype html>',
        '<html>',
        '<head>',
        '<title>Ops Snapshot</title>',
        '<meta name="description" content="Latest operational summary">',
        '</head>',
        '<body><h1>Fresh dashboard</h1></body>',
        '</html>',
      ].join(''),
    );

    const published = publishLatestDashboard(folder);
    expect(published).toMatchObject({
      kind: 'html',
      origin: 'published',
      title: 'Ops Snapshot',
      description: 'Latest operational summary',
    });
    expect(published?.slug).toMatch(/^dashboard-\d{8}t\d{6}z$/);
    expect(getPublishedDashboardHtml(folder, published!.slug)).toContain(
      '<h1>Fresh dashboard</h1>',
    );
    expect(listPublishedDashboards(folder).some((entry) => entry.slug === published!.slug)).toBe(
      true,
    );
  });
});
