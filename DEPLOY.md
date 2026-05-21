# Deploy — operator runbook

Architecture, bindings, and deployment shape are in [docs/architecture.md → Deployment shape](docs/architecture.md#deployment-shape). This file is the step-by-step runbook for operators.

## Deploy pipeline

Cloudflare's GitHub integration auto-builds and deploys every push to `main`. CI (`.github/workflows/test.yml`) runs typecheck + Vitest on PRs; Cloudflare deploys only after merge. **Migrations are not run by CI** — see [§ Migrations](#migrations).

`npm run deploy` (= `wrangler deploy`) is a manual escape hatch only. Use it when the GitHub integration is down or for hotfix urgency. Do not normalize manual deploys.

## One-time setup

### 1. Neon Postgres

Create a Neon project. Use the production connection string (must include `?sslmode=require`):

```
postgres://<user>:<password>@<host>.<region>.aws.neon.tech/<dbname>?sslmode=require
```

Create a dev branch off prod for local development. Never run migrations or destructive scripts against prod directly.

### 2. Cloudflare Worker secrets

Set via `wrangler secret put <NAME>` or the dashboard (Workers & Pages → Settings → Variables and Secrets):

| Secret | Source | Required |
|---|---|---|
| `DATABASE_URL` | Neon production connection string | yes |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | yes |
| `BETTER_AUTH_URL` | Worker's public URL (e.g. `https://betwixt.example.workers.dev`) | yes |
| `GOOGLE_CLIENT_ID` | Google Cloud Console OAuth | optional (Google sign-in) |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console OAuth | optional |
| `RESEND_API_KEY` | Resend dashboard | required for prod magic-links |
| `RESEND_FROM_EMAIL` | Resend-verified sender | required for prod magic-links |

`buildAuth` throws if `BETTER_AUTH_SECRET` or `BETTER_AUTH_URL` is missing — the Worker returns 500 on every request until both are set. The check is unconditional; even E2E paths must supply their own secret. A previous version silently fell back to a hardcoded dev secret in test mode, which turned out to be a session-forgery primitive on any prod with a misapplied `BETWIXT_E2E_PGLITE=1` runtime secret. See [docs/findings/x-test-user-id-prod-guard.md](docs/findings/x-test-user-id-prod-guard.md) § Resolution.

**Never set `BETWIXT_E2E_PGLITE` in production.** It enables the `x-test-user-id` session-bypass header. The bypass branch is also tree-shaken from production bundles at build time via Vite `define` (`__E2E_BYPASS__`), but this protection requires that `BETWIXT_E2E_PGLITE` is *not* set in the Pages **build** environment (separate from runtime secrets; dashboard → Pages → Settings → Builds & deployments → Environment variables). Audit both surfaces.

### 3. Connect the GitHub repo to Cloudflare

Dashboard → Workers & Pages → Create → Pages → Connect to Git. Pick `main`. Cloudflare runs `npm run build` and deploys `.svelte-kit/cloudflare/`.

## Migrations

**Manual. Run before deploying any schema-changing commit.**

```sh
DATABASE_URL='postgres://...prod-branch...' npm run db:migrate
```

Applies pending migrations from `drizzle/`. There is no CI step, no deploy hook. If you forget, the Worker deploys against a schema it expects to find — and 500s on the first query that hits a missing column.

### Migrating existing single-tenant data (legacy)

Migration `0005` added nullable `user_id` columns. T8b's gated routes filter every SELECT by `userId`, so pre-existing rows with NULL `user_id` become invisible.

For a deploy that needs to preserve existing single-tenant data:

1. Apply migrations as above.
2. Run `drizzle/backfill-multi-user.sql.example` against prod (substitute `:owner_id` with the UUID of the user who should own the legacy rows). Template is commented-out by default — read it, parameterize, run only what you need.
3. Deploy the Worker.

For fresh deploys with no pre-existing data, skip the backfill — every new row stamps `user_id` automatically.

## Deploying

After one-time setup, deploy is `git push origin main`. Watch the Cloudflare dashboard for build status. First request after deploy may take ~1s as the Worker cold-starts the Neon pool.

If a deploy ships a migration: **run `npm run db:migrate` first**, then `git push`.

## Verifying a deploy

1. Hit `https://<your-worker>.workers.dev/` — should serve the landing page.
2. Visit `/auth/login`, enter your email, submit. Check inbox for the magic-link (Resend must be wired). Click → land on `/app` authenticated.
3. Open `/app` → timeline + map + entity list visible.

If any step fails: `wrangler tail` for live logs, or Cloudflare dashboard's Workers Logs view.

## Magic-link email (production gate)

Until `RESEND_API_KEY` + `RESEND_FROM_EMAIL` are set, magic-links are `console.log`-only on prod — no real user can complete login. **Do not announce the public URL until this verifies.**

Setup:

1. Sign up at [resend.com](https://resend.com), verify a sending domain.
2. Create an API key.
3. Set Cloudflare secrets:

    ```sh
    wrangler secret put RESEND_API_KEY
    wrangler secret put RESEND_FROM_EMAIL   # noreply@mail.yourdomain.com
    ```

4. From an incognito window: `/auth/login` → enter your real email → check inbox → click link → confirm `/app` loads.

The `sendMagicLink` callback in `src/lib/server/auth.ts` falls back to `console.log` when the Resend env vars are missing, so requests succeed silently but emails never arrive.

## Backups

Weekly Sunday 06:00 UTC: `.github/workflows/backup.yml` runs `pg_dump | gpg | rclone copy` to Backblaze B2. Restore tested as part of T8b acceptance criteria; cost ~$1-2/mo storage. Neon's 24h-free / 7d-paid PITR alone is insufficient for a writer's app where the data IS the product.

## Rollback

Cloudflare retains previous Worker versions. To revert: dashboard → Deployments → click an older successful deploy → "Rollback to this deployment."

**Database changes are not rolled back automatically.** If a migration is involved:

1. Roll back the Worker first (so the old code is running against the new schema — usually safe if the migration was additive).
2. If the migration was destructive, restore from the most recent backup via `pg_restore` against a Neon dev branch, validate, then swap branches via Neon's dashboard.
3. `drizzle-kit drop` only removes migration files from `drizzle/` locally — it does not roll back applied SQL. Hand-write the reverse migration if you need one.

## When something is wrong

| Symptom | First check |
|---|---|
| All requests 500 immediately after deploy | `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` / `DATABASE_URL` set on the Worker? `wrangler secret list`. |
| Login succeeds but `/app` 500s | `DATABASE_URL` points at the right Neon branch? Migration applied to that branch? |
| Magic-link form 200s but no email arrives | `RESEND_API_KEY` / `RESEND_FROM_EMAIL` set? Resend domain verified? `wrangler tail` for the `console.log` fallback. |
| Map image upload returns 500 | `MAP_UPLOADS` R2 binding present in `wrangler.jsonc` and bucket exists? |
| Slow first request | Expected: Neon pool cold-start (~1s) and Worker cold-start. Watch over 1–2 minutes; if persistent, check Neon dashboard for compute scaling state. |

## References

- [docs/architecture.md](docs/architecture.md) — deployment shape, env vars, trust boundaries.
- [docs/adr/0004-neon-postgres-better-auth.md](docs/adr/0004-neon-postgres-better-auth.md) — why Postgres + Better-Auth + Workers.
- [docs/findings/x-test-user-id-prod-guard.md](docs/findings/x-test-user-id-prod-guard.md) — security follow-up on the E2E bypass.
- `.github/workflows/backup.yml` — backup automation.
- `.github/workflows/test.yml` — CI test gate.
