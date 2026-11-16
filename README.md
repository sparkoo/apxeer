# Apxeer

Lap telemetry analysis for sim racers — find exactly where you lose time.

> **Status: Early development / work in progress. Expect breaking changes.**

[![CI](https://github.com/sparkoo/apxeer/actions/workflows/ci.yml/badge.svg)](https://github.com/sparkoo/apxeer/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

 - **Live:** https://apxeer-web.michal-vala.workers.dev/
 - **Stage:** https://apxeer-web-staging.michal-vala.workers.dev/

## What is it?

Apxeer records your lap telemetry from Le Mans Ultimate at 20Hz, uploads it to a shared backend, and lets you visually compare laps on an interactive track map with full telemetry graphs and delta analysis. Think of it as Strava for sim racing — see exactly where you gain or lose time against faster drivers.

## Features

- 20Hz telemetry recording via LMU shared memory (Windows desktop app)
- Lap-by-lap delta comparison with track map overlay
- Race session stats parsed from LMU XML result files
- Web app for visual analysis — no desktop app needed to browse

## Architecture

| Component | Stack | Purpose |
|-----------|-------|---------|
| `apxeer-desktop` | Tauri 2 + Rust + HTMX | Record & upload telemetry (Windows only) |
| `api` | Go + chi (Railway) | REST API — data storage & retrieval |
| `apxeer-web` | Preact + Vite + Tailwind | Lap comparison & analysis |
| Database | Neon (Postgres) + Cloudflare R2 | Schema + telemetry file storage |

## Local development

Install Node.js 22+, Go 1.24+, and Docker or Podman. See the
[desktop guide](apxeer-desktop/README.md) for the Windows recorder.

1. Start Postgres. Substitute `podman` for `docker` if needed.

   ```sh
   docker run -d --name apxeer-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=apxeer -p 5432:5432 postgres:16
   ```

2. Copy `api/.env.example` to `api/.env` and configure the Clerk JWKS URL
   and R2 credentials. From `api/`, set `DATABASE_URL` in your shell to
   the value in `.env` and run:

   ```sh
   go run ./cmd/migrate
   go run ./cmd/api
   ```

   In PowerShell, use `$env:DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/apxeer?sslmode=disable'`.
   The migrator reads the shell environment. The API also loads `.env`.
   Verify startup at <http://localhost:8080/health>.

3. Copy `apxeer-web/.env.example` to `apxeer-web/.env.local` and set the Clerk
   publishable key for the same instance as the API. From `apxeer-web/`,
   run `npm ci` and `npm run dev`. Open <http://localhost:5173>.

See the [architecture](docs/architecture.md) and [deployment](docs/deployment.md) guides.

## License

[AGPL-3.0](LICENSE) — free to use and fork, but modifications must remain open source.
