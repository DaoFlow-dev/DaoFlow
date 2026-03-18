# @daoflow/client — Agent Rules

## Build

- Run `bun run typecheck` before committing.
- Never import server-side code. The client is a standalone SPA.
- Use `import type` for type-only imports from `@daoflow/shared`.

## Components

- All components go in `src/components/`.
- Use `data-testid` attributes on every interactive element and data display.
- Format: `data-testid="section-entity_id"` (e.g., `server-card-srv_foundation_1`).

## Styling

- Tailwind CSS 4 is the default styling system for the client. Prefer utility classes in JSX over adding bespoke feature-level CSS.
- Use shadcn/ui components and patterns as the primary UI building blocks. Extend existing primitives before introducing one-off wrappers.
- Keep shared design tokens, theme variables, and Tailwind-driven global styles in `src/index.css`.
- When shadcn/ui and Tailwind are introduced or updated, preserve `components.json` as the canonical component registry/config.
- Dark mode and theme tokens should continue to flow through CSS custom properties exposed from the global theme layer.

## tRPC Usage

- Queries use `trpc.procedureName.useQuery()` with `enabled: Boolean(session.data)` guard.
- Mutations use `trpc.procedureName.useMutation()`.
- After mutations, call `refreshOperationalViews()` to update all panels.

## Accessibility

- Use semantic HTML (`<section>`, `<nav>`, `<h2>`, `<label>`).
- Forms must have proper `<label>` elements.
- Buttons need descriptive text or `aria-label`.
