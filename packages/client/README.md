# @daoflow/client

React SPA that serves as the DaoFlow dashboard.

## Stack

- **Build**: Vite
- **Framework**: React 19
- **API**: tRPC React Query client
- **Auth**: Better Auth React client
- **Styling**: Tailwind CSS + custom vanilla CSS

## Key files

| Path                     | Purpose                                         |
| ------------------------ | ----------------------------------------------- |
| `src/App.tsx`            | Main dashboard (all sections)                   |
| `src/index.css`          | Design system (glassmorphism, grids, dark mode) |
| `src/lib/trpc.ts`        | tRPC client + React Query provider              |
| `src/lib/auth-client.ts` | Better Auth client hooks                        |
| `src/components/`        | Reusable components (StatusCard, etc.)          |
| `src/main.tsx`           | Vite entry point                                |

## Scripts

```bash
bun run dev        # Vite dev server (HMR)
bun run build      # Production build → dist/
bun run typecheck  # tsc --noEmit
```

## Design principles

- Glassmorphism aesthetic with backdrop blur
- Cards use `border-radius: 24px` and `rgba(255, 252, 246, 0.82)` backgrounds
- Status tones: `healthy` (green), `failed` (red), `running` (amber), `queued` (neutral)
- Data-testid attributes on all interactive and data elements for E2E testing
