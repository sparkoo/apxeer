# Deployment Guide

## Stack

| Service | Platform | Cost |
|---|---|---|
| Go API | Railway | Free tier |
| Database | Neon (Postgres) | Free tier (2 projects) |
| Auth | Clerk | Free tier |
| File storage | Cloudflare R2 | Free tier |
| Web frontend | Cloudflare Workers | Free |

Two environments — **stage** and **prod** — each backed by separate Railway + Neon + Clerk projects.

---

## Architecture

```
Railway: apxeer-api-stage      ← Go HTTP API (auto-deploys from master)
Neon: apxeer-stage             ← Postgres DB
Clerk: apxeer-stage            ← Auth (OAuth: Google, Discord, GitHub)
Cloudflare R2: apxeer-telemetry-stage  ← gzip telemetry files
Cloudflare Workers: apxeer-web-staging ← static SPA

Railway: apxeer-api-prod       — same structure, separate project
Neon: apxeer-prod
Clerk: apxeer-prod
Cloudflare R2: apxeer-telemetry
Cloudflare Workers: apxeer-web
```

**API URL pattern:**
- Stage: `https://<your-stage-app>.railway.app`
- Prod:  `https://<your-prod-app>.railway.app`

The web frontend calls `${VITE_API_URL}/api/laps`, `/api/compare`, etc.
The desktop app's `api_url` setting should point to the prod Railway URL.

---

## CI/CD

The Railway Go API auto-deploys from git (configured in Railway dashboard). The CI/CD workflow only handles the web frontend.

| Trigger | What deploys |
|---|---|
| Push to `master` | Web → **stage** (automatic) |
| Actions → Run workflow → `stage` | Web → **stage** (manual, any branch) |
| Actions → Run workflow → `prod` | Web → **prod** (manual, master only) |

Relevant files:
- `.github/workflows/ci.yml` — build checks (runs on every push + PR)
- `.github/workflows/deploy.yml` — web frontend deployments

---

## One-Time Setup

Do this once before CI/CD can run.

### Step 1: Neon

**Create 2 projects** at [neon.tech](https://neon.tech):
- `apxeer-stage`
- `apxeer-prod`

**Apply migrations** to each:
```bash
migrate -path api/migrations \
  -database "postgres://<user>:<pass>@<host>/<db>?sslmode=require" up
```

### Step 2: Clerk

**Create 2 applications** at [clerk.com](https://clerk.com):
- `apxeer-stage` (use Test mode)
- `apxeer-prod` (use Live mode)

Enable the OAuth providers you want (Google, Discord, GitHub) in each app.

**Collect** from Dashboard → API Keys:
- Publishable key (`pk_test_...` / `pk_live_...`)
- JWKS URL: `https://<clerk-domain>/.well-known/jwks.json`

### Step 3: Cloudflare R2

**Create 2 buckets** in your Cloudflare account:
- `apxeer-telemetry-stage`
- `apxeer-telemetry`

**Create API tokens**: R2 → Manage R2 API tokens → Create API token (Object Read & Write).

**Note your Account ID** from the sidebar.

### Step 4: Railway

**Create 2 projects** at [railway.app](https://railway.app):
- `apxeer-stage`
- `apxeer-prod`

In each project, connect the GitHub repo and set the source to the `api/` directory (or use a Dockerfile).

**Set environment variables** for each Railway project:
```
DATABASE_URL=<neon connection string>
CLERK_JWKS_URL=https://<clerk-domain>/.well-known/jwks.json
R2_ACCOUNT_ID=<cloudflare account id>
R2_ACCESS_KEY_ID=<r2 access key>
R2_SECRET_ACCESS_KEY=<r2 secret key>
R2_BUCKET=apxeer-telemetry-stage   # or apxeer-telemetry for prod
PORT=8080
```

### Step 5: Cloudflare Workers (web)

**Create 2 Workers projects** (Workers & Pages → Create):
- `apxeer-web-staging`
- `apxeer-web`

**Create API token**: My Profile → API Tokens → Create → use **"Edit Cloudflare Workers"** template.

### Step 6: GitHub Actions Secrets

The workflow uses GitHub **environments** (`stage` and `prod`).
Settings → Environments → (create `stage` and `prod`) → add secrets per environment.

**Secrets** (same name in both environments, different values):

| Secret | Value |
|---|---|
| `RAILWAY_API_URL` | Railway app URL, e.g. `https://apxeer-api-stage.railway.app` |
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key for that environment |
| `CLOUDFLARE_API_TOKEN` | From Step 5 (can be repo-level) |
| `CLOUDFLARE_ACCOUNT_ID` | From Step 5 (can be repo-level) |

---

## Local Development

```bash
# 1. Start local Postgres
podman run -d --name apxeer-db \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:16

# 2. Apply migrations (requires golang-migrate)
#    https://github.com/golang-migrate/migrate
make db-migrate

# 3. Configure the Go API
cd api && cp .env.example .env
# Edit .env: set DATABASE_URL, CLERK_JWKS_URL, R2_* credentials

# 4. Start the Go API (port 8080)
make api

# 5. Start the web frontend (in another terminal)
cd apxeer-web && cp .env.example .env.local
# Edit .env.local: set VITE_CLERK_PUBLISHABLE_KEY (use Test key)
make web
```

Local URLs:
- Web: `http://localhost:3000`
- API: `http://localhost:8080`

---

## Desktop App

In the desktop app Settings UI (or `<AppData>/apxeer/config/settings.json`), set:
```json
{
  "api_url": "https://<prod-railway-app>.railway.app",
  "clerk_domain": "your-app.clerk.accounts.dev",
  "lmu_results_dir": "C:\\Users\\<name>\\Documents\\Le Mans Ultimate\\UserData\\Log\\Results"
}
```

For staging, use the stage Railway URL and stage Clerk domain instead.

---

## Verification Checklist

- [ ] `GET https://<stage-railway-app>.railway.app/health` → `ok`
- [ ] `GET https://<prod-railway-app>.railway.app/health` → `ok`
- [ ] Stage web app opens at `https://apxeer-web-staging.<account>.workers.dev` and login works
- [ ] Prod web app opens at `https://apxeer-web.<account>.workers.dev` and login works
- [ ] Upload a lap from desktop → row appears in `laps` table, file in R2 bucket
- [ ] `/compare` page loads telemetry charts
- [ ] Push commit to `master` → `deploy-stage` job is green in Actions
- [ ] Run workflow (stage, feature branch) → deploys to stage
- [ ] Run workflow (prod, master) → `deploy-prod` job is green
- [ ] Run workflow (prod, feature branch) → `deploy-prod` job is skipped
