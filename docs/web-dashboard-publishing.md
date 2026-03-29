# AgentOS Web Dashboard Publishing

Agent-created dashboards for the tenant web UI are published inside the owning
workspace folder as either structured JSON manifests or sandboxed HTML
artifacts.

## Publish location

For a web workspace with group folder `{folder}`:

```text
groups/{folder}/published/dashboards/{slug}.json
groups/{folder}/published/dashboards/{slug}.html
```

Legacy compatibility path:

```text
groups/{folder}/dashboard.html
```

This legacy root file is exposed as the `dashboard` slug so existing agent
scripts that write to `/workspace/group/dashboard.html` continue to work.

HTML artifacts are rendered inside a locked iframe. Inline styles render, but
scripts, forms, and outbound network access are blocked by CSP and sandbox
headers.

## JSON manifest shape

The host validates every manifest with the `zod` schema in
`src/web/dashboards.ts`.

Required top-level fields:

- `version: 1`
- `slug`
- `title`
- `components`

Optional top-level fields:

- `description`
- `updatedAt`

Supported component types in v1:

- `hero`
- `markdown`
- `stats`
- `table`
- `list`
- `timeline`
- `chart`

## Example

```json
{
  "version": 1,
  "slug": "weekly-status",
  "title": "Weekly Status",
  "description": "Workspace summary for this week",
  "updatedAt": "2026-03-27T09:00:00.000Z",
  "components": [
    {
      "type": "hero",
      "eyebrow": "AgentOS",
      "title": "Weekly Status",
      "subtitle": "Published from the workspace"
    },
    {
      "type": "stats",
      "title": "Key numbers",
      "items": [
        {
          "label": "Open items",
          "value": "12",
          "trend": "flat",
          "detail": "No change vs yesterday"
        }
      ]
    }
  ]
}
```

## Notes for agents

- Keep filenames aligned with `slug`.
- Keep JSON manifests and HTML artifacts below the host size limits enforced in `src/web/dashboards.ts`.
- Prefer structured data over rich formatting; the frontend is responsible for rendering.
- Update `updatedAt` when publishing a new version so the UI sorts recent dashboards correctly.
- For HTML artifacts, include a `<title>` tag so the dashboard list can show a useful label.
- Optional HTML metadata:
  - `<meta name="description" content="...">`
  - `<meta name="agentos:updatedAt" content="2026-03-29T08:00:00.000Z">`
