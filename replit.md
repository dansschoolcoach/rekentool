# ByB Ledenchallenge

A responsive web portal where dance school owners enter weekly trial-lesson results, track funnel performance, and compete on percentage-based member growth.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/byb-ledenchallenge/` — React/Vite website, Clerk screens, participant portal, leaderboard, and admin UI
- `artifacts/api-server/src/routes/challenge.ts` — challenge API and score/week calculations
- `lib/api-spec/openapi.yaml` — source of truth for the API contract
- `lib/db/src/schema/challenge.ts` — PostgreSQL tables for challenge settings, participants, and weekly entries

## Architecture decisions

- Calendar-only challenge dates are stored as `YYYY-MM-DD` values so weeks do not shift across timezones.
- Growth, conversion, and attendance percentages are calculated server-side from weekly totals.
- Clerk owns authentication; participant records link to Clerk identities and contain challenge-specific profile data.
- One active challenge is supported at a time, while dates remain fully configurable for future editions.

## Product

- Branded sign-in and responsive participant dashboard
- Weekly entry of trial signups, attendance, and memberships
- Personal totals and growth/conversion/attendance scores
- Competitive leaderboard sorted by member-growth percentage
- Admin management for participants, challenge dates, and weekly-number corrections

## User preferences

- This is a website intended for the user's own domain, not a mobile app.
- Visual language: warm off-white, navy, and gold with editorial serif/sans typography.

## Gotchas

- Run API codegen after every OpenAPI change before using new client hooks or server schemas.
- Admin access requires Clerk public metadata `role: "admin"`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
