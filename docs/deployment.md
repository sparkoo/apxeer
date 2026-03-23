# Deployment Guide

## Stack & Hosting

| Service | Platform | Cost |
|---|---|---|
| Database + Auth + Storage | Supabase | Free tier (2 projects) |
| Go REST API | Fly.io | Free tier (shared CPU, 256 MB) |
| Web frontend (static SPA) | Cloudflare Pages | Free |
| Desktop app (Windows) | GitHub Actions build artifact | Free |

---

## Order of Operations

Set these up in order — each depends on the previous:

1. Supabase (staging project)
2. Supabase (production project)
3. Fly.io API apps
4. Cloudflare Pages web apps
5. GitHub Actions secrets
6. Desktop build

---

## 1. Supabase Setup

Do this **twice** — once for staging, once for production.

### 1.1 Create project

1. Go to [supabase.com](https://supabase.com) → New project
2. Name: `apxeer-staging` / `apxeer-prod`
3. Region: `eu-central-1` (Frankfurt) — matches Fly.io `fra`
4. Save the database password

### 1.2 Run migrations

From the repo root, using `psql` (or the Supabase SQL editor):

```bash
# Install Supabase CLI (optional, psql works too)
brew install supabase/tap/supabase   # macOS
# or: npm install -g supabase

# Get your connection string from:
# Dashboard → Project Settings → Database → Connection string → URI (use the pooler on port 6543)

psql "$DATABASE_URL" -f apxeer-api/migrations/001_initial.sql
psql "$DATABASE_URL" -f apxeer-api/migrations/002_events_and_enrichment.sql
```

Alternatively, paste each file's content into the Supabase SQL editor.

### 1.3 Create Storage bucket

Dashboard → Storage → New bucket:
- Name: `telemetry`
- Public: **off** (private, RLS enforced)

### 1.4 Collect secrets

Dashboard → Project Settings → API. Save these for later:

| Secret | Where to find it |
|---|---|
| `DATABASE_URL` | Settings → Database → Connection string (pooler, port 6543) |
| `SUPABASE_URL` | Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | Settings → API → `service_role` key |
| `SUPABASE_JWT_SECRET` | Settings → API → JWT Secret |
| `SUPABASE_ANON_KEY` | Settings → API → `anon` key (for the web frontend) |

---

## 2. Fly.io API

### 2.1 Install flyctl & log in

```bash
curl -L https://fly.io/install.sh | sh
flyctl auth login
```

### 2.2 Create apps

```bash
flyctl apps create apxeer-api-staging --org personal
flyctl apps create apxeer-api          --org personal
```

### 2.3 Set secrets

```bash
# Staging — use staging Supabase values
flyctl secrets set --app apxeer-api-staging \
  DATABASE_URL="postgres://postgres.<ref>:<pass>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" \
  SUPABASE_URL="https://<staging-ref>.supabase.co" \
  SUPABASE_SERVICE_KEY="<service_role_key>" \
  SUPABASE_JWT_SECRET="<jwt_secret>"

# Production — use prod Supabase values
flyctl secrets set --app apxeer-api \
  DATABASE_URL="..." \
  SUPABASE_URL="..." \
  SUPABASE_SERVICE_KEY="..." \
  SUPABASE_JWT_SECRET="..."
```

### 2.4 First deploy (manual)

```bash
cd apxeer-api

# Staging
flyctl deploy --app apxeer-api-staging

# Production
flyctl deploy --app apxeer-api
```

### 2.5 Verify

```bash
curl https://apxeer-api-staging.fly.dev/health   # → 200 OK
curl https://apxeer-api.fly.dev/health            # → 200 OK
```

---

## 3. Cloudflare Pages (Web Frontend)

The web app is a static Vite/Preact SPA — no server required.

### 3.1 Create Cloudflare account & get tokens

1. Sign up at [cloudflare.com](https://cloudflare.com) (free)
2. My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** template
3. Note your **Account ID** from the dashboard sidebar

### 3.2 Create Pages projects

For each project: Pages → Create a project → **Direct Upload** (we deploy via CI, not git integration).

| Project name | Used for |
|---|---|
| `apxeer-web-staging` | Staging |
| `apxeer-web` | Production |

> Alternatively, connect the GitHub repo to CF Pages for the staging project and let it auto-deploy — but CI-based deploy (used here) gives more control over environment variables.

### 3.3 First deploy (manual)

```bash
cd apxeer-web
npm ci

# Staging
VITE_API_URL=https://apxeer-api-staging.fly.dev \
VITE_SUPABASE_URL=https://<staging-ref>.supabase.co \
VITE_SUPABASE_ANON_KEY=<anon_key> \
npm run build

npx wrangler pages deploy dist --project-name apxeer-web-staging

# Production
VITE_API_URL=https://apxeer-api.fly.dev \
VITE_SUPABASE_URL=https://<prod-ref>.supabase.co \
VITE_SUPABASE_ANON_KEY=<anon_key> \
npm run build

npx wrangler pages deploy dist --project-name apxeer-web
```

### 3.4 Verify

```
https://apxeer-web-staging.pages.dev   → app loads, login works
https://apxeer-web.pages.dev           → production
```

---

## 4. GitHub Actions Secrets

Go to the repo → Settings → Secrets and variables → Actions → New repository secret.

| Secret name | Value |
|---|---|
| `FLY_API_TOKEN` | `flyctl tokens create deploy` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (step 3.1) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID (step 3.1) |
| `STAGING_SUPABASE_URL` | staging Supabase project URL |
| `STAGING_SUPABASE_ANON_KEY` | staging `anon` key |
| `PROD_SUPABASE_URL` | production Supabase project URL |
| `PROD_SUPABASE_ANON_KEY` | production `anon` key |

After this, the CI/CD pipeline in `.github/workflows/deploy.yml` takes over:
- **Push to `master`** → auto-deploys API + Web to **staging**
- **Actions → Run workflow** → deploys API + Web to **production**, and builds the Windows desktop installer

---

## 5. Desktop App (Windows)

### Local build

```bash
# Prerequisites (Windows):
# - Rust stable: https://rustup.rs
# - Node 22: https://nodejs.org
# - cargo-tauri: cargo install tauri-cli

cd apxeer-desktop
cargo tauri build
# Installer output: src-tauri/target/release/bundle/msi/*.msi
#                   src-tauri/target/release/bundle/nsis/*.exe
```

### CI build (production)

Trigger via GitHub Actions → Deploy → Run workflow. The job:
1. Checks out the repo on `windows-latest`
2. Builds with `tauri-apps/tauri-action`
3. Uploads the `.msi` / `.exe` as a workflow artifact (retained 30 days)

Download from: Actions → Deploy → (run) → Artifacts → `apxeer-desktop-windows`

### Configure before shipping

In the desktop app Settings UI (or `<AppData>/apxeer/config/settings.json`), set:
```json
{
  "api_url": "https://apxeer-api.fly.dev",
  "auth_token": "<user's Supabase JWT>",
  "lmu_results_dir": "C:\\Users\\<name>\\Documents\\Le Mans Ultimate\\UserData\\Log\\Results"
}
```

---

## CI/CD Summary

| Trigger | What deploys |
|---|---|
| Push to `master` | API → Fly.io staging, Web → CF Pages staging |
| Actions → Run workflow | API → Fly.io prod, Web → CF Pages prod, Desktop → Windows artifact |

Relevant files:
- `.github/workflows/ci.yml` — build checks (unchanged, runs on every push + PR)
- `.github/workflows/deploy.yml` — deployments (staging auto, prod manual)
- `apxeer-api/Dockerfile` — Go API container image
- `apxeer-api/fly.toml` — Fly.io machine config

---

## Verification Checklist

- [ ] `GET /health` → 200 on both staging and production API
- [ ] Web app opens and Supabase login works
- [ ] Upload a lap from desktop → appears in the web app
- [ ] Supabase Storage → `telemetry/{user_id}/` has `.json.gz` files
- [ ] Push a commit to `master` → staging deploy job runs green in Actions
- [ ] Run workflow manually → production deploy + desktop artifact appear in Actions
