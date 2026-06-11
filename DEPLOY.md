# Deploy — operator runbook

Architecture, bindings, and deployment shape are in [docs/architecture.md → Deployment shape](docs/architecture.md#deployment-shape). This file is the step-by-step runbook for operators.

The deploy target is **Cloudflare Workers** with Static Assets (the unified 2024+ replacement for Cloudflare Pages). The repo's `wrangler.jsonc` is the source of truth for the Worker's name, compatibility settings, the `_worker.js` entrypoint, the `ASSETS` binding, observability, and bindings to external resources (R2, etc.).

## Deploy pipeline

`.github/workflows/deploy.yml` runs `wrangler deploy` on every push to `main`, after `npm run check` + `npm test` pass in the same job. The Worker is deployed to whichever Cloudflare account the `CLOUDFLARE_API_TOKEN` GitHub secret authenticates.

`npm run deploy` (= `wrangler deploy`) is the same command, run from a developer's machine. Use it for the very first deploy (before the GitHub Action's secrets are set), for one-off hotfixes, and to reproduce a CI failure locally.

## One-time setup

### 1. Neon Postgres

Create a Neon project. Use the production connection string (must include `?sslmode=require`):

```
postgres://<user>:<password>@<host>.<region>.aws.neon.tech/<dbname>?sslmode=require
```

Create a dev branch off prod for local development. Never run migrations or destructive scripts against prod directly.

### 2. Cloudflare account + wrangler CLI

```sh
npm i -g wrangler   # if not already
wrangler login      # browser-based OAuth; one-time per machine
```

Note your account ID from `wrangler whoami` or the dashboard URL. You will need it for the GitHub Action.

### 3. Cloudflare Worker secrets

Set via `wrangler secret put <NAME>` (interactive) or the dashboard (Workers & Pages → your Worker → Settings → Variables and Secrets):

| Secret | Source | Required |
|---|---|---|
| `DATABASE_URL` | Neon production connection string | yes |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | yes |
| `BETTER_AUTH_URL` | The Worker's public URL once deployed (e.g. `https://betwixt-and-between.<account-subdomain>.workers.dev` or a custom domain you've attached) | yes |
| `GOOGLE_CLIENT_ID` | Google Cloud Console OAuth | optional (Google sign-in) |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console OAuth | optional |
| `RESEND_API_KEY` | Resend dashboard | required for prod magic-links |
| `RESEND_FROM_EMAIL` | Resend-verified sender | required for prod magic-links |

`buildAuth` throws if `BETTER_AUTH_SECRET` or `BETTER_AUTH_URL` is missing — the Worker returns 500 on every request until both are set. The check is unconditional; even E2E paths must supply their own secret. A previous version silently fell back to a hardcoded dev secret in test mode, which turned out to be a session-forgery primitive on any prod with a misapplied `BETWIXT_E2E_PGLITE=1` runtime secret. See [docs/findings/x-test-user-id-prod-guard.md](docs/findings/x-test-user-id-prod-guard.md) § Resolution.

**Never set `BETWIXT_E2E_PGLITE` in production**, in either:
- the Worker's runtime secrets/variables (the `wrangler secret list` surface), **OR**
- the Worker's plaintext environment variables in the dashboard (which apply at both build and runtime).

The bypass branch is tree-shaken from production bundles at build time via Vite `define` (`__E2E_BYPASS__`), but the safety property requires `BETWIXT_E2E_PGLITE` to be unset in the build process env when CI / wrangler runs `npm run build`. If it leaks into either surface, the bypass branch ships.

### 4. R2 bucket for map uploads

```sh
wrangler r2 bucket create betwixt-map-uploads
```

The `MAP_UPLOADS` binding is declared in `wrangler.jsonc:r2_buckets`; the next `wrangler deploy` wires it up. No dashboard step.

### 5. First deploy (from your machine)

Before the GitHub Action can run, the Worker must exist and have its secrets set. Bootstrap from your machine:

```sh
npm install
DATABASE_URL='postgres://...prod-branch...' npm run db:migrate   # see § Migrations
npm run build
npm run deploy   # = wrangler deploy
```

The first `wrangler deploy` creates the Worker. Note the URL it prints (e.g. `https://betwixt-and-between.<account-subdomain>.workers.dev`). Update `BETTER_AUTH_URL` to match if you didn't already:

```sh
wrangler secret put BETTER_AUTH_URL   # paste the URL from above
```

Then `wrangler deploy` once more so the new secret takes effect.

### 6. GitHub Action secrets (enables auto-deploy on push to main)

In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**. Add:

| GitHub secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template. Restrict to your account. |
| `CLOUDFLARE_ACCOUNT_ID` | `wrangler whoami` or the dashboard URL. |

Once both are set, `.github/workflows/deploy.yml` will deploy automatically on the next push to `main`.

### 7. (Optional) Custom domain

Dashboard → Workers & Pages → your Worker → Settings → Domains & Routes → Add Custom Domain. Then update `BETTER_AUTH_URL` to the custom domain and `wrangler deploy` once more.

## Migrating from a prior Cloudflare Pages deploy (one-time, only if applicable)

If this project was previously deployed via Cloudflare Pages (URL like `*.pages.dev`), follow these steps to cut over to Workers Static Assets without downtime:

1. **Complete steps 1–6 above.** The new Worker is now live at `*.workers.dev` (or your custom domain), running the same build. Test it end-to-end (landing, login, app, map upload).
2. **If the Pages project had a custom domain attached**, move the custom domain from Pages to the new Worker:
   - On the Pages project: Settings → Custom domains → Remove the domain.
   - On the Worker: Settings → Domains & Routes → Add Custom Domain → same domain.
   - DNS records are managed automatically if the zone is on Cloudflare.
3. **Delete the Pages project**: Dashboard → Workers & Pages → the Pages project → Manage → Delete project. This removes the `*.pages.dev` URL and stops any auto-builds. Do this *after* the Worker is verified working at the public URL — otherwise users hit a deleted endpoint.
4. **Audit step**: confirm `BETWIXT_E2E_PGLITE` was never set on the old Pages project (runtime *or* build environment variables). If it was, regenerate `BETTER_AUTH_SECRET` and rotate it on the Worker — sessions signed by the previous fallback secret are forgeable.

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

After one-time setup, deploy is `git push origin main`. The GitHub Action runs `npm run check`, `npm test`, then `wrangler deploy`. First request after deploy may take ~1s as the Worker cold-starts the Neon pool.

If a deploy ships a migration: **run `npm run db:migrate` first** (against the prod Neon branch from your machine), then `git push`.

For an emergency manual deploy: `npm run deploy` from a checkout of the commit you want to ship.

## Verifying a deploy

1. Hit `https://<your-worker-or-custom-domain>/` — should serve the landing page.
2. Visit `/auth/login`, enter your email, submit. Check inbox for the magic-link (Resend must be wired). Click → land on `/app` authenticated.
3. Open `/app` → timeline + map + entity list visible.

If any step fails: `wrangler tail` for live logs, or Cloudflare dashboard → your Worker → Logs.

## Magic-link email (production gate)

Until `RESEND_API_KEY` + `RESEND_FROM_EMAIL` are set, a built/prod Worker **refuses to issue magic-links** — the sign-in request throws ("refusing to deliver a magic link outside dev") and no real user can complete login. (In `vite dev` / Vitest the link is `console.log`-ed instead, so local sign-in still works.) **Do not announce the public URL until this verifies.**

Setup:

1. Sign up at [resend.com](https://resend.com), verify a sending domain.
2. Create an API key.
3. Set Cloudflare secrets:

    ```sh
    wrangler secret put RESEND_API_KEY
    wrangler secret put RESEND_FROM_EMAIL   # noreply@mail.yourdomain.com
    ```

4. From an incognito window: `/auth/login` → enter your real email → check inbox → click link → confirm `/app` loads.

The `deliverMagicLink` helper in `src/lib/server/auth.ts` (called by the `sendMagicLink` callback) only `console.log`s the link when the Resend env vars are missing **and** the build is dev (`import.meta.env.DEV`). In a built Worker that branch throws instead, so a misconfigured prod fails the sign-in request rather than silently leaking the link to logs.

## Backups

Weekly Sunday 06:00 UTC: `.github/workflows/backup.yml` runs `pg_dump | gpg | rclone copy` to Backblaze B2. Restore tested as part of T8b acceptance criteria; cost ~$1-2/mo storage. Neon's 24h-free / 7d-paid PITR alone is insufficient for a writer's app where the data IS the product.

## Rollback

Cloudflare retains previous Worker versions. To revert: dashboard → your Worker → Deployments → click an older successful deploy → "Rollback to this deployment." Or from CLI: `wrangler rollback <deployment-id>`.

**Database changes are not rolled back automatically.** If a migration is involved:

1. Roll back the Worker first (so the old code is running against the new schema — usually safe if the migration was additive).
2. If the migration was destructive, restore from the most recent backup via `pg_restore` against a Neon dev branch, validate, then swap branches via Neon's dashboard.
3. `drizzle-kit drop` only removes migration files from `drizzle/` locally — it does not roll back applied SQL. Hand-write the reverse migration if you need one.

## When something is wrong

| Symptom | First check |
|---|---|
| All requests 500 immediately after deploy | `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` / `DATABASE_URL` set on the Worker? `wrangler secret list`. |
| Login succeeds but `/app` 500s | `DATABASE_URL` points at the right Neon branch? Migration applied to that branch? |
| Magic-link form 500s / errors on prod | `RESEND_API_KEY` / `RESEND_FROM_EMAIL` set? A built Worker fails closed without them (`wrangler tail` shows the "refusing to deliver a magic link outside dev" throw). |
| Magic-link form 200s but no email arrives | `RESEND_API_KEY` / `RESEND_FROM_EMAIL` set and Resend domain verified? Send-failure surfaces as a thrown `Resend send failed: <status>` in `wrangler tail`. |
| Map image upload returns 500 | `MAP_UPLOADS` R2 binding present in `wrangler.jsonc` AND bucket exists (`wrangler r2 bucket list`)? Last `wrangler deploy` ran after the binding was added? |
| GitHub Action fails at `wrangler deploy` step | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` GitHub secrets set? Token has `Workers Scripts: Edit` permission? |
| Slow first request | Expected: Neon pool cold-start (~1s) and Worker cold-start. Watch over 1–2 minutes; if persistent, check Neon dashboard for compute scaling state. |

## References

- [docs/architecture.md](docs/architecture.md) — deployment shape, env vars, trust boundaries.
- [docs/adr/0004-neon-postgres-better-auth.md](docs/adr/0004-neon-postgres-better-auth.md) — why Postgres + Better-Auth + Workers.
- [docs/findings/x-test-user-id-prod-guard.md](docs/findings/x-test-user-id-prod-guard.md) — security follow-up on the E2E bypass.
- `.github/workflows/test.yml` — CI test gate (runs on PRs).
- `.github/workflows/deploy.yml` — auto-deploy on push to main.
- `.github/workflows/backup.yml` — weekly Neon backup to Backblaze B2.
- [Cloudflare: SvelteKit on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/sveltekit/) — canonical wrangler.jsonc shape used by this repo.
