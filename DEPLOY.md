# Deploy

The app deploys to **Cloudflare Workers** via the GitHub integration: Cloudflare auto-builds and deploys every push to `main`. There is no manual `wrangler deploy` step in CI.

## One-time setup

### 1. Neon Postgres

Create a Neon project. Get the **production** connection string — must include `?sslmode=require`:

```
postgres://<user>:<password>@<host>.<region>.aws.neon.tech/<dbname>?sslmode=require
```

For local development, create a Neon **dev branch** off the production branch. Use that branch's URL in your local `.env`. Never run migrations or destructive scripts against the production branch directly.

### 2. Apply migrations

Migrations are checked into `drizzle/` and applied via `npm run db:migrate`. Run once against the production branch:

```sh
DATABASE_URL='postgres://...prod-branch...' npm run db:migrate
```

After T8b lands, the auth tables (`user`, `session`, `account`, `verification`) and `userId` columns are part of the migration set.

### 3. Cloudflare Workers secrets

Set these via the Cloudflare dashboard (Workers & Pages → Settings → Variables and Secrets) or `wrangler secret put`:

| Secret | Source | Required |
|---|---|---|
| `DATABASE_URL` | Neon production connection string | yes |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | yes |
| `BETTER_AUTH_URL` | Your Worker's public URL (e.g. `https://betwixt.example.workers.dev`) | yes |
| `GOOGLE_CLIENT_ID` | Google Cloud Console OAuth credentials | optional (Google sign-in) |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console OAuth credentials | optional (Google sign-in) |
| `RESEND_API_KEY` | Resend dashboard | required for production magic-links (S9'b) |
| `RESEND_FROM_EMAIL` | Resend-verified sender (e.g. `noreply@yourdomain.com`) | required for production magic-links (S9'b) |

`buildAuth` throws if `BETTER_AUTH_SECRET` or `BETTER_AUTH_URL` is missing in non-test mode — the Worker will return 500 on every request until both are set. This is intentional: silent fallback to a dev secret would make sessions trivially forgeable.

### 4. Connect the GitHub repo to Cloudflare

In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**. Pick the `main` branch. Cloudflare runs `npm run build` and deploys the `.svelte-kit/cloudflare/` output.

The deploy trigger is push-to-`main`. CI (`.github/workflows/test.yml`) runs typecheck + Vitest on every PR — Cloudflare deploys only after merge.

## Deploying

After initial setup:

```sh
git push origin main
```

Watch the Cloudflare dashboard for the build status. First request after deploy may take ~1s as the Worker cold-starts the Neon Pool.

## Verifying a deploy

1. Hit `https://<your-worker>.workers.dev/` — should serve the landing page.
2. Visit `/auth/login`, enter your email, submit. Check your inbox for the magic-link (S9'b email provider must be wired). Click → land on `/app` authenticated.
3. Open `/app` → timeline + map + entity list visible.

If any step fails, check Cloudflare's **Workers Logs** (`wrangler tail` or the dashboard's Live Logs view).

## Magic-link email (production gate)

Until S9'b lands, magic-links are `console.log`-only on prod — no real user can complete login. **Do not announce the public URL until this verifies**.

Setup:

1. Sign up at [resend.com](https://resend.com), verify a sending domain (e.g. `mail.yourdomain.com`).
2. Create an API key.
3. Set Cloudflare secrets:

   ```sh
   wrangler secret put RESEND_API_KEY
   wrangler secret put RESEND_FROM_EMAIL   # noreply@mail.yourdomain.com
   ```

4. Deploy. From an incognito window: `/auth/login` → enter your real email → check inbox → click magic-link → confirm `/app` loads with your session.

Until step 4 verifies, treat the deploy as private. The `sendMagicLink` callback in `src/lib/server/auth.ts` falls back to `console.log` when the Resend env vars are missing, so requests succeed but emails never arrive.

## Backups

Weekly `pg_dump` from Neon → encrypted with `gpg` → uploaded to Backblaze B2. See `.github/workflows/backup.yml`.

## Rollback

Cloudflare retains previous Worker versions. To revert: dashboard → Deployments → click an older successful deploy → "Rollback to this deployment." Database changes are not rolled back automatically — if a migration is involved, manually downgrade via `drizzle-kit drop` after rolling back.
