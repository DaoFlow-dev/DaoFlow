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

- CSS lives in `src/index.css`. Use CSS class names, not Tailwind utilities in JSX.
- Follow the existing glassmorphism card pattern for new sections.
- Status colors use the `StatusCard` component with tone props.
- Dark mode: use CSS custom properties from `:root` and `.dark` blocks.

## tRPC Usage

- Queries use `trpc.procedureName.useQuery()` with `enabled: Boolean(session.data)` guard.
- Mutations use `trpc.procedureName.useMutation()`.
- After mutations, call `refreshOperationalViews()` to update all panels.

## Accessibility

- Use semantic HTML (`<section>`, `<nav>`, `<h2>`, `<label>`).
- Forms must have proper `<label>` elements.
- Buttons need descriptive text or `aria-label`.
