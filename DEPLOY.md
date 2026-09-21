# Deploy — operator runbook

The [Worker configuration](wrangler.jsonc) and [deployment workflow](.github/workflows/deploy.yml) define the deployment. This file covers operator setup and verification.

The deploy target is **Cloudflare Workers** with Static Assets (the unified 2024+ replacement for Cloudflare Pages). The repo's `wrangler.jsonc` is the source of truth for the Worker's name, compatibility settings, the `_worker.js` entrypoint, the `ASSETS` binding, observability, and bindings to external resources (R2, etc.).

GitHub Actions use Node 24 and pin runners to Ubuntu 24.04. Upgrade the runner image deliberately after validating PostgreSQL backup tooling and Playwright on the new image.

## Deploy pipeline

On every push to `main`, `.github/workflows/deploy.yml` runs the E2E job, then `npm run check`, `npm test`, a production build, and `wrangler deploy` in the dependent deploy job. The Worker is deployed to whichever Cloudflare account the `CLOUDFLARE_API_TOKEN` GitHub secret authenticates.

`npm run deploy` builds the app and runs `wrangler deploy` from a developer's machine. Use it for the very first deploy (before the GitHub Action's secrets are set), for one-off hotfixes, and to reproduce a CI failure locally.

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

`buildAuth` throws if `BETTER_AUTH_SECRET` or `BETTER_AUTH_URL` is missing — the Worker returns 500 on every request until both are set. The check is unconditional; even E2E paths must supply their own secret. A previous version silently fell back to a hardcoded dev secret in test mode, which turned out to be a session-forgery primitive on any prod with a misapplied `BETWIXT_E2E_PGLITE=1` runtime secret. See [buildAuth](src/lib/server/auth.ts) and the [request hook](src/hooks.server.ts) for the checks.

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
npm run deploy   # builds the app, then runs wrangler deploy
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

After one-time setup, deploy is `git push origin main`. The GitHub Action gates deployment on E2E, type checks, unit/integration tests, and a production build. First request after deploy may take ~1s as the Worker cold-starts the Neon pool.

If a deploy ships a migration: **run `npm run db:migrate` first** (against the prod Neon branch from your machine), then `git push`.

For an emergency manual deploy: `npm run deploy` from a checkout of the commit you want to ship.

## Verifying a deploy

1. Hit `https://<your-worker-or-custom-domain>/` — should serve the landing page.
2. Visit `/auth/login`, enter your email, submit. Check inbox for the magic-link (Resend must be wired). Click → land on `/app` authenticated.
3. Open `/app`, then use the taskbar to open Characters, Timeline, and World Map. Confirm each window loads.

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

The daily 06:00 UTC workflow is opt-in. Set repository variable `BACKUPS_ENABLED=true` after configuring the secrets below. Until then, scheduled runs validate the backup code against disposable PostgreSQL, without accessing production.

The backup job creates a compressed `pg_dump -Fc` archive and extracts uploaded-image references from that exact snapshot, including references inside notes and JSON. It copies the referenced images once by SHA-256 content hash. Database archives, images, filenames, and manifests are encrypted through rclone's `crypt` remote over B2. Each run downloads the stored archive, verifies its checksum, and restores it into an empty, disposable PostgreSQL 18 database. Every referenced image is also downloaded and checksum-verified. The manifest is published last, marking a complete recovery point.

### One-time backup configuration

1. Create a dedicated private B2 bucket or prefix, with a restricted application key. Configure an rclone B2 remote named `b2`, then a **crypt** remote named `backup` wrapping `b2:YOUR-BUCKET/betwixt-v1`. Keep the default content and filename encryption. Save the crypt password, salt, and configuration outside GitHub too; losing them makes the backups unreadable. Unlike the earlier GPG-only plan, this permits unattended verification of the actual encrypted archive.
2. Configure an R2 S3 remote and an alias named `uploads` rooted at the `MAP_UPLOADS` bucket, e.g. `r2:betwixt-map-uploads`. This must be the production upload bucket, not the shared terrain asset bucket. Initially give its credentials read-only access.
3. Store the complete rclone config as GitHub secret `BACKUP_RCLONE_CONFIG`, and the **direct, non-pooler** production connection string as `DATABASE_URL_PROD`. The old `BACKUP_GPG_RECIPIENT`, `BACKUP_GPG_PUBLIC_KEY`, and inline `RCLONE_CONFIG` secrets are no longer used by the workflow. Existing `.sql.gpg` backups are untouched and still need their original GPG private key.
4. Set `BACKUPS_ENABLED=true`, run the backup workflow manually, and require a successful restore check. GitHub Actions failure notifications must be enabled for this workflow. A delayed or absent scheduled run should also be investigated; a green app deployment is not evidence of a recent backup.
5. Set `BACKUP_PRUNE=true` to enable retention. Set `IMAGE_CLEANUP=true` only after verifying recovery, and grant the upload credential delete access then. Both default to report-only. No application migration is required.

### Retention and image cleanup

- Keep every completed database backup for 30 days, plus the first successful backup in each of the current and previous 11 calendar months. Manual pre-migration runs get at least 30 days too. Always retain the latest completed backup. Cleanup only starts after the current backup passes restoration.
- Keep a backup image as long as **any** retained manifest needs it. Unreferenced backup images and interrupted uploads of database archives get a seven-day grace period. Retention uses exact object deletions through the encrypted remote. Do not apply blanket bucket-age rules: an old image may still be needed by a new or monthly database backup.
- B2 normally retains hidden object versions. The retention job requests hard deletion of the specific expired objects so those versions do not accumulate. Object Lock can delay cleanup and make the job report a failure until objects become eligible. Do not grant governance-retention bypass solely to silence that failure.
- Source image cleanup scans references across all public database tables, preserves shared images, ignores unrecognized filenames, and removes at most 100 unreferenced uploads observed as unreferenced for over seven days per run. It briefly locks public tables against writes while rechecking references and deleting candidates. A five-second lock-acquisition timeout aborts cleanup when busy. This is for a small deployment; replace the table scan/locks with tracked asset references if the job starts delaying writers. The first unreferenced observation is saved in each completed manifest. Reappearing references or changed object timestamps reset that grace period; new uploads also get at least seven days.
- Shared terrain sprites, arbitrary external image URLs, and infrastructure secrets are outside this backup. The repository/deployment configuration and encryption keys need their own recovery copies.

### Restore a completed backup

Use a trusted machine with the saved rclone configuration and PostgreSQL client tools. List `backup:snapshots/` with `rclone lsf backup:snapshots/ --dirs-only` and choose a snapshot containing both `manifest.json` and `database.dump`. Download via the **crypt remote** so rclone decrypts it. Read `databaseHash` from the manifest and verify the dump's SHA-256 before restoring with `pg_restore --exit-on-error --no-owner --no-acl --dbname "$RESTORE_DATABASE_URL" database.dump` into an empty development database. Never point a restore test at production.

For each manifest image, download `backup:images/HASH`, verify its SHA-256 equals `hash`, and restore it to the upload bucket under its original `key`. A database-only restore is incomplete when those files are missing. Validate story counts, ownership, and map rendering before any production cutover. Run a manual recovery drill at least monthly, including access to the independently saved encryption configuration.

Local regression command: `node --test tests/backup/*.test.mjs`. The real encrypted round-trip test additionally requires rclone, PostgreSQL 18 client tools, and `BACKUP_TEST_DATABASE_URL` pointing to a **disposable loopback** PostgreSQL server. It creates its own source database and `betwixt_restore_check`; it refuses to reuse an existing restore-check database. CI runs this test with local encrypted storage and no cloud credentials.

If backup reports missing referenced uploads, confirm that the `uploads` alias targets `r2:betwixt-map-uploads`. Restore the listed original files or correct obsolete image links in the application. The job stops before publishing a recovery point or deleting anything. Downloads reject zero transferred files and discard earlier temporary downloads before trying again.

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

- [wrangler.jsonc](wrangler.jsonc) — Worker entrypoint, assets, and runtime bindings.
- [src/hooks.server.ts](src/hooks.server.ts) and [vite.config.ts](vite.config.ts) — runtime and build-time E2E bypass guards.
- [src/lib/server/auth.ts](src/lib/server/auth.ts) — required auth configuration and magic-link delivery.
- `.github/workflows/test.yml` — CI test gate (runs on PRs).
- `.github/workflows/deploy.yml` — auto-deploy on push to main.
- `.github/workflows/backup.yml` — daily verified Neon and image backups to Backblaze B2.
- [Cloudflare: SvelteKit on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/sveltekit/) — canonical wrangler.jsonc shape used by this repo.

### Story ownership migration 0029

Apply migration 0029 before deploying the story-switching Worker. It creates a first story for each existing account and retargets narrative and appearance ownership foreign keys. Physical `user_id` columns stay in place for the previous Worker; application fields now call them `storyId`. A Worker rollback can still serve the original story, while additional stories remain stored until the newer Worker is restored. Test the migration on a Neon dev branch first.
