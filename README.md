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
| `apxeer-api` | Go + chi + Supabase | Data storage & retrieval |
| `apxeer-web` | Preact + Vite + Tailwind | Lap comparison & analysis |
| Database | Supabase Postgres + Storage | Schema + telemetry file storage |

## Getting Started

### Prerequisites

- Go 1.25+
- Node 22+
- Podman (local DB)
- Supabase CLI (for local stack)
- Windows (required for desktop recording)

### Local development

```bash
make dev        # Start DB + API + web together
make migrate    # Run schema migrations
make seed       # Insert sample laps with fake telemetry
```

### Desktop app (Windows only)

```bash
cd apxeer-desktop
cargo tauri dev
```

See [`docs/`](docs/) for architecture, design decisions, and deployment details.

## License

[AGPL-3.0](LICENSE) — free to use and fork, but modifications must remain open source.
