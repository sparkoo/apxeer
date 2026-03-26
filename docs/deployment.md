# Deployment Guide

## Stack

| Service | Platform | Cost |
|---|---|---|
| DB + Auth + Storage + API | Supabase | Free tier (2 projects) |
| Web frontend (static SPA) | Cloudflare Pages | Free |

Two environments — **stage** and **prod** — each backed by a separate Supabase project.

---

## Architecture

```
Supabase (apxeer-stage)
  ├── Postgres DB
  ├── Auth (OAuth: Google, Discord, GitHub)
  ├── Storage bucket: telemetry/
  └── Edge Function: api  ← handles all REST endpoints

Cloudflare Pages: apxeer-web-staging  ← static SPA

Supabase (apxeer-prod)  — same structure, separate project
Cloudflare Pages: apxeer-web
```

**API URL pattern:**
- Stage: `https://<stage-ref>.supabase.co/functions/v1`
- Prod:  `https://<prod-ref>.supabase.co/functions/v1`

The web frontend calls `${VITE_API_URL}/api/laps`, `/api/compare`, etc.
The desktop app's `api_url` setting should point to `https://<prod-ref>.supabase.co/functions/v1`.

---

## CI/CD Triggers

| Trigger | What deploys |
|---|---|
| Push to `master` | Edge Function + web → **stage** (automatic) |
| Actions → Run workflow → `stage` | Edge Function + web → **stage** (manual, any branch) |
| Actions → Run workflow → `prod` | Edge Function + web → **prod** (manual, master only) |

Relevant files:
- `.github/workflows/ci.yml` — build checks (unchanged, runs on every push + PR)
- `.github/workflows/deploy.yml` — deployments
- `supabase/functions/api/index.ts` — Edge Function (all REST endpoints)

---

## One-Time Setup

Do this once before CI/CD can run.

### Step 1: Supabase

**Create 2 projects** at [supabase.com](https://supabase.com):
- `apxeer-stage` (region: eu-central-1 / Frankfurt)
- `apxeer-prod` (same region)

**Run migrations** on each project:
```bash
supabase db push --project-ref <ref>   # applies all migrations in supabase/migrations/
```

**Create storage bucket** on each project:
- Dashboard → Storage → New bucket
- Name: `telemetry`
- Public: **off**

**Edge Function secrets:** The following are **auto-injected** — no manual setup needed:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL` (direct Postgres connection string)

No additional secrets are required. If `SUPABASE_DB_URL` is not available in your Supabase version, set `DATABASE_URL` manually via Dashboard → Edge Functions → Manage secrets:
```bash
supabase secrets set --project-ref <ref> \
  DATABASE_URL="postgres://postgres.<ref>:<pass>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"
```

**Collect credentials** — from Dashboard → Settings → API:
- Project ref (short ID in the URL, e.g. `abcdefghij`)
- Project URL: `https://<ref>.supabase.co`
- Anon key (`anon public`)
- Service role key (`service_role`)

**Create a personal access token** (once, for CI):
- supabase.com → Account → Access Tokens → Generate new token
- Name: `github-actions`

### Step 2: Cloudflare Pages

**Create account** at [cloudflare.com](https://cloudflare.com) — free, no credit card.

**Create 2 Pages projects** (Pages → Create → **Direct Upload**):
- `apxeer-web-staging`
- `apxeer-web`

**Create API token**: My Profile → API Tokens → Create → use **"Edit Cloudflare Workers"** template.

**Note your Account ID** from the sidebar.

### Step 3: GitHub Actions Secrets

The workflow uses GitHub **environments** (`stage` and `prod`).
Settings → Environments → (create `stage` and `prod`) → add secrets/variables per environment.

**Secrets** (same name in both environments, different values):

| Secret | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Personal access token from Step 1 (can be repo-level) |
| `SUPABASE_PROJECT_REF` | e.g. `abcdefghij` (stage ref) or `klmnopqrst` (prod ref) |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | anon key for that environment |
| `CLOUDFLARE_API_TOKEN` | from Step 2 (can be repo-level) |
| `CLOUDFLARE_ACCOUNT_ID` | from Step 2 (can be repo-level) |

**Variables** (Settings → Environments → Variables):

| Variable | Stage value | Prod value |
|---|---|---|
| `SITE_URL` | `https://apxeer-web-staging.pages.dev` | `https://apxeer-web.pages.dev` |

`SITE_URL` is the public URL of the deployed web frontend. It is set as the Supabase auth `site_url` and added to the allowed OAuth redirect URL list automatically on every deploy. If you use a custom domain, update `SITE_URL` to match.

---

## Local Development

```bash
# 1. Install Supabase CLI
brew install supabase/tap/supabase   # macOS/Linux

# 2. Start local Supabase stack (DB + Auth + Storage + Edge Function runtime)
supabase start

# 3. Run migrations
supabase db push

# 4. Create supabase/.env.local with the local service role key
#    (printed by `supabase start` — look for "service_role key")
echo 'SUPABASE_SERVICE_ROLE_KEY=<key>' > supabase/.env.local
# SUPABASE_DB_URL is auto-injected in deployed Edge Functions.
# For local dev, set DATABASE_URL pointing at the local Supabase DB:
echo 'DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres' >> supabase/.env.local

# 5. Serve the Edge Function locally
supabase functions serve api --env-file supabase/.env.local

# 6. Start the web frontend (in another terminal)
cd apxeer-web
cp .env.example .env.local    # then fill in VITE_SUPABASE_ANON_KEY from `supabase start` output
npm install
npm run dev
```

Local URLs:
- Web: `http://localhost:5173`
- Edge Function: `http://localhost:54321/functions/v1/api/health`
- Supabase Studio: `http://localhost:54323`

---

## Desktop App

In the desktop app Settings UI (or `<AppData>/apxeer/config/settings.json`), set:
```json
{
  "api_url": "https://<prod-ref>.supabase.co/functions/v1",
  "auth_token": "<supabase-user-jwt>",
  "lmu_results_dir": "C:\\Users\\<name>\\Documents\\Le Mans Ultimate\\UserData\\Log\\Results"
}
```

For staging, use the stage project ref instead.

---

## Verification Checklist

- [ ] `GET https://<stage-ref>.supabase.co/functions/v1/api/health` → `ok`
- [ ] `GET https://<prod-ref>.supabase.co/functions/v1/api/health` → `ok`
- [ ] Stage web app opens at `https://apxeer-web-staging.pages.dev` and login works
- [ ] Prod web app opens at `https://apxeer-web.pages.dev` and login works
- [ ] Upload a lap from desktop → row appears in `laps` table, file in `telemetry/` bucket
- [ ] `/compare` page loads telemetry charts
- [ ] Push commit to `master` → `deploy-stage` job is green in Actions
- [ ] Run workflow (stage, feature branch) → deploys to stage
- [ ] Run workflow (prod, master) → `deploy-prod` job is green
- [ ] Run workflow (prod, feature branch) → `deploy-prod` job is skipped
