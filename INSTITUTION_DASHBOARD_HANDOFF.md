# Institution Dashboard: Agent Handoff

> **Quick state (2026-10-20):** The officer dashboard redesign is deployed to `https://gamciv.pocketsoftware.dev/dashboard/institute`. Latest commit: `278a077` on `main`. GitHub CI and the CI-gated VPS Deploy workflow succeeded. The live desktop/mobile browser suite passed 17/17 tests. Read this page before changing either institution dashboard.

## Purpose

This note records what changed, how the institution dashboard is meant to work, the security boundaries future changes must preserve, and the exact regression that blocked the first deployment attempt. It is intended to let another developer or AI agent pick up the work quickly without rediscovering the routes, APIs, test setup, or deployment behavior.

## Where the pages live

There are two institution dashboard pages in the repository. They are related, but they are not the same deployed route:

| Page | File | Role |
| --- | --- | --- |
| Active officer dashboard | `frontend/dashboard/admin/src/pages/InstitutionDashboard.tsx` | The officer-facing dashboard served at `/dashboard/institute`. This is the page to change for the current live officer experience. |
| Legacy institution page | `frontend/app/src/pages/InstituteDashboard.tsx` | Older dashboard/feed in the citizen app. It remains institution-scoped and retains its existing case actions, but is not the active dashboard route used by officers. |
| Regression tests | `frontend/app/e2e/institution-dashboard.spec.ts` | Browser checks for sign-in gating, officer-only access, own-institution query scope, secret-settings denial, chart geometry, mobile width, and network failure behavior. |

The active officer route is registered in the separate dashboard app. Do not redesign the citizen app's general home page when working on this officer dashboard.

## What changed

The active `/dashboard/institute` page was rebuilt as a responsive analytics dashboard using the dashboard's existing shadcn-style `Card`, `Badge`, `Button`, `Input`, and `Table` components plus Recharts. It now shows summary cards, a 14-day received/resolved trend, a status donut, a category bar chart, an intake-channel donut, and a searchable recent-complaint table. The table is limited to the latest 200 records; the aggregate charts and total counters come from the backend analytics function, not from those 200 rows.

The active page checks the signed-in user's profile role, verifies that the user has an active officer assignment, displays only the assigned institution name, and provides manual refresh plus Supabase Realtime refreshes filtered to that institution. It is read-only; the existing case action buttons are in the legacy citizen-app page, not in this active analytics view.

The legacy page was also tightened: it no longer queries a list of all institutions or displays institution-forward targets. It retrieves only the current institution's logo by its own institution ID. If aggregate analytics fail, unavailable values are shown as `-` rather than being presented as zero.

The active dashboard bounds its data request with an eight-second deadline and an `AbortController`. A dropped or stalled connection gets friendly retry guidance instead of an indefinitely spinning dashboard or a low-level error. The analytics area validates that the institution ID returned by the backend matches the signed-in officer's assignment before rendering aggregate values.

## Data and access boundaries

These are requirements, not optional UI conventions:

1. The dashboard role is derived from the authenticated user's `profiles.role`. Only `officer` may stay on `/dashboard/institute`. An admin is redirected to `/dashboard/`; an unauthenticated visitor goes to `/dashboard/login`; other roles go to `/app/login`.
2. The officer must have an `officers` row for the same `auth.uid()` and `is_active = true`. The institution identity is read from that assignment and its joined institution row.
3. Complaint-feed requests must retain `.eq("institution_id", institutionId)`. Returned rows are also filtered by that same ID before entering UI state. This client filter is defense in depth, not a substitute for database security.
4. Aggregate numbers must come from `supabase.rpc("fn_institution_dashboard_stats")`. That server function derives the officer's institution; the frontend rejects its response if `stats.institution.id !== institutionId`.
5. Database RLS is the authoritative isolation boundary. The existing complaint select policy `comp_select_officer_own_inst` scopes an officer to complaints whose `institution_id` matches their `officers` row. The analytics function is in `backend/db/0015_institution_dashboard.sql` and the authorization helpers/policies are in the existing migrations. Do not relax or bypass those policies to make a chart render.
6. The institution page must not enumerate all institutions. If an institution name/logo is needed, use the ID assigned to the current officer and query only that row. Do not add cross-institution names, activity, complaint totals, or forwarding targets to this view.
7. Telegram bot tokens, API secrets, service-role keys, and admin settings must never appear in the officer UI, frontend source, logs, or this document. The admin secrets/settings page is separate and remains for admins; the officer browser test verifies that an officer attempting `/dashboard/settings` is redirected to their own dashboard.

The Supabase client imported by the active page is `frontend/dashboard/admin/src/lib/secretsClient.ts`. Despite the filename, it is initialized with the public frontend URL and anon key from Vite environment variables; do not put a service-role key in a frontend build. Existing backend RLS and admin-only APIs remain the security authority.

## Backend contract used by the active page

The active dashboard calls `fn_institution_dashboard_stats` and expects an object with an `institution` object containing `id`, plus aggregate fields such as `total`, `today`, `open`, `resolved_week`, `overdue`, `avg_resolution_hours`, `by_status`, `by_category`, `by_channel`, and `daily`. The rendered charts use status, category, channel, and daily received/resolved series.

The complaint table queries only the fields needed for display, orders newest-first, limits to 200, and scopes by the active institution ID. Do not replace the aggregate RPC with client-side aggregation over the visible 200 rows; that would make the charts incomplete and can create misleading numbers.

No backend schema, migration, or RLS change was made for the dashboard redesign. If a future feature requires a backend change, inspect the existing RPC and policies first, write a regression test for the server-side authorization, then use the approved migration/deployment path. Never treat a browser-only filter as an access-control fix.

## Important deployment-test gotcha

The first deploy attempt for this dashboard commit stopped at the production-configured local browser smoke-test step, before any frontend upload to the VPS. CI had passed. The cause was a test-harness mismatch:

- Local CI builds use `https://ci-placeholder.supabase.co`, whose default Supabase local-storage key is `sb-ci-placeholder-auth-token`.
- The production-configured dashboard bundle uses `https://api.pocketsoftware.dev`, whose key is `sb-api-auth-token`.
- The deploy workflow runs the local pre-upload browser tests without setting `BASE_URL`. The test originally inferred the project key from `BASE_URL`, so the production-built local preview got only the CI placeholder key and appeared signed out.

The E2E setup now seeds both known keys when `BASE_URL` is absent, and only the production key when running against the live base URL. Preserve this behavior if the Supabase project URL or test setup changes. A change to the storage key must be verified in both local CI builds and production-configured preflight builds.

There was no VPS upload from the failed attempt. Follow-up commit `278a077` fixed the test setup. The second CI run and Deploy run both succeeded, followed by a live public-site E2E run with 17/17 passing tests.

## Fast verification commands

### CI-shaped local build and tests

Run from the repository root. These are placeholders only; do not paste production secrets into commands or files.

```bash
export VITE_SUPABASE_URL=https://ci-placeholder.supabase.co
export VITE_SUPABASE_ANON_KEY=ci-placeholder

(cd frontend/app && npm run build)
(cd frontend/dashboard/admin && npm run build)
(cd frontend/landing && npm run build)
(cd frontend/app && npm run lint && npx tsc -b --pretty false && npm run test:e2e)
```

### Reproduce the production-configured preflight locally

This reproduces the important project-ref/storage-key distinction while keeping the anon key a placeholder. Do not use service-role credentials here.

```bash
export VITE_SUPABASE_URL=https://api.pocketsoftware.dev
export VITE_SUPABASE_ANON_KEY=ci-placeholder

(cd frontend/app && npm run build)
(cd frontend/dashboard/admin && npm run build)
(cd frontend/landing && npm run build)
(cd frontend/app && env -u BASE_URL npm run test:e2e)
```

### Check the deployed public site

```bash
cd frontend/app
BASE_URL=https://gamciv.pocketsoftware.dev npm run test:e2e
```

The officer session and institution data in the new dashboard E2E tests are mocked. The test does not need an officer password and must not query real citizen or institution complaint data.

## Current test and build notes

The browser suite passed 17/17 locally, including against the live public site. The new institution tests cover signed-out redirect, officer redirect away from admin secrets, institution-specific query filtering, rendered pie sectors, mobile overflow, and clear behavior after a lost connection. Both app and dashboard TypeScript/build checks passed.

The observed app lint run reported 1,460 warnings and 0 errors. Vite also reported a large JavaScript chunk and an ineffective dynamic-import warning. Those are non-blocking output from the wider existing frontend configuration; do not claim lint is warning-free, and do not expand this dashboard task into unrelated bundle refactoring unless asked.

## Normal change and deploy flow

1. Change the active dashboard page first. Touch the legacy page only when correcting its own institution-scoping or compatibility behavior.
2. Preserve the role/active-assignment checks, own-institution RPC identity check, complaint filter, and database RLS.
3. Extend `frontend/app/e2e/institution-dashboard.spec.ts` for any new chart, data boundary, role, offline state, or mobile layout behavior.
4. Run strict builds and the local E2E suite. If the build uses production Supabase settings, run the production-shaped preflight command above.
5. Commit to a branch or push to `main` according to the repository workflow. `.github/workflows/ci.yml` runs checks; `.github/workflows/deploy.yml` deploys only after CI succeeds on a push to `main`.
6. After deployment, check the Deploy workflow and run the live E2E command. A successful local build alone does not prove Nginx serves the new bundle.

For the general Nginx/UI pipeline and required GitHub Actions secrets, see [UI_DEPLOYMENT.md](UI_DEPLOYMENT.md). Secret values do not belong in this handoff.

## Change history

- `cf570ff` - institution-scoped officer dashboard redesign, legacy cross-institution UI removal, and regression coverage.
- `278a077` - fix E2E auth-storage setup for production-configured preflight builds.
- CI run: <https://github.com/Foday-Sall/gamciv-ai/actions/runs/39444738570>
- Deploy run: <https://github.com/Foday-Sall/gamciv-ai/actions/runs/39444930601>
