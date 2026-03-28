# Template Catalog Maintenance

Use this workflow when refreshing DaoFlow's built-in starter templates.

## Goals

- Keep the built-in catalog current and transparent.
- Review starters in one place instead of hand-editing scattered definitions blindly.
- Ship explicit metadata for source, version, review date, and change notes with every starter.

## Review Loop

1. Run `bun run templates:report` to inspect version, source, last review date, and freshness for every starter.
2. Compare the current starter against the upstream source linked in `maintenance.sourceUrl`.
3. Update the shared template definition in `packages/shared/src/app-template-catalog-infrastructure.ts` or `packages/shared/src/templates/*.ts`.
4. Refresh `maintenance.version`, `maintenance.reviewedAt`, and `maintenance.changeNotes` alongside any compose or field changes.
5. Run `bun run templates:check` to catch malformed metadata.
6. Run the changed-surface tests plus the repo validation gates before commit and push.
7. In the browser, verify the Templates UI surfaces the new freshness status and review notes clearly.

## Shipping Rules

- Do not fetch template content from remote sources at runtime.
- Keep the built-in catalog as the only source of truth for shipped starters.
- If a starter is intentionally behind upstream, record the reason in `maintenance.changeNotes`.
