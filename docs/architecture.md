# Architecture

## System Overview

Apxeer is a simracing telemetry platform — "Strava for sim racing". The desktop app records lap telemetry from the simulator and uploads it to the server; the web app provides lap comparison and race statistics.

## Components

```
apxeer-desktop/  — Tauri 2 app (Windows only)
api/             — Go REST API
apxeer-web/      — Preact + Vite web frontend (Cloudflare Workers)
lmu-telemetry/   — LMU C++ headers + sample XML result files
plans/           — SPEC.md (full spec) + lmu-shared-memory-rust.md
docs/            — Architecture and design documentation (this folder)
```

## Stack

| Layer | Tech |
|---|---|
| Desktop | Tauri 2 + Rust + HTMX |
| Backend API | Go (chi router, pgx) — hosted on Railway |
| Web frontend | Preact + Vite + Tailwind + wouter — hosted on Cloudflare Workers |
| Auth | Clerk (OAuth: Google, Discord, GitHub) |
| Database | Neon (Postgres) — local dev: podman postgres container |
| File storage | Cloudflare R2 (S3-compatible) |
| Web hosting | Cloudflare Workers (static assets) |

## Local Dev Quick-Start

```bash
# 1. Postgres
podman run -d --name apxeer-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16

# 2. Apply migrations
migrate -path api/migrations -database "postgres://postgres:postgres@localhost:5432/apxeer?sslmode=disable" up

# 3. Go API (copy api/.env.example to api/.env and fill in values)
cd api && go run ./cmd/api/

# 4. Web frontend (copy apxeer-web/.env.example to apxeer-web/.env.local)
cd apxeer-web && npm run dev
```

## Data Flow

1. **Telemetry recording** — `telemetry.rs` reads `LMU_Data` Windows shared memory at 20Hz, detects lap boundaries, writes `{timestamp}-lap-{n}.json.gz` to `<AppData>/apxeer/buffer/`
2. **Results parsing** — `results.rs` polls the LMU XML results folder every 5s, parses session XML, writes `{filename}.json.gz` to `<AppData>/apxeer/results/`
3. **Upload** — `upload.rs` reads both buffer folders, POSTs lap files to `POST /api/laps` (gzip body + `X-Lap-Metadata` header) and session files to `POST /api/sessions`; deletes local file on success. Runs every 30s or on manual trigger.
4. **Blob storage** — API stores telemetry as gzip JSON files in Cloudflare R2 at `telemetry/{clerk_user_id}/{lap_id}.json.gz`; the `laps.telemetry_url` DB column stores the R2 object key. Telemetry samples are **not** stored as DB rows.
5. **Compare** — Web frontend fetches `GET /api/compare?lap_a=:id&lap_b=:id`, API downloads both blobs from R2, decompresses them, and returns both sample arrays for the frontend to render.

## Auth Flow

### Web frontend
- Clerk JS SDK (`@clerk/clerk-js`) handles sign-in via Clerk's hosted UI
- `clerk.session.getToken()` provides the JWT Bearer token for API calls
- On sign-in, frontend calls `GET /api/me` to get the internal user UUID (used for all user-scoped API calls)

### Desktop app
- Native OAuth 2.0 PKCE flow against Clerk's Frontend API
- Opens system browser → user signs in → browser redirects to `http://127.0.0.1:54321/` with code
- App exchanges code for JWT via Clerk's token endpoint
- JWT stored in `settings.json` as `auth_token`, sent as `Authorization: Bearer` header

### API (Go)
- Validates JWTs using Clerk's JWKS endpoint (`CLERK_JWKS_URL`)
- On first authenticated request, upserts user row in `users` table (lazy provisioning — no webhook needed)
- All authorization enforced at handler level (no DB-level RLS)

## Desktop App Modules

| Module | Role |
|---|---|
| `lib.rs` | Tauri setup, state management, command registration, Clerk PKCE flow |
| `telemetry.rs` | 20Hz recording loop, lap detection |
| `lmu_telemetry/` | Windows shared memory reader (`LMU_Data`) via `winapi` |
| `results.rs` | LMU XML results watcher and parser |
| `upload.rs` | Upload queue (auto every 30s or manual) |
| `settings.rs` | Persisted settings (`settings.json`) |

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Health check |
| `GET` | `/api/stats` | No | Global stats (total laps, drivers, km) |
| `GET` | `/api/tracks/records` | No | Best lap per track |
| `GET` | `/api/laps` | No | List laps (filter: `user_id`, `track_id`) |
| `POST` | `/api/laps` | Yes | Upload lap (gzip body + `X-Lap-Metadata` header) |
| `GET` | `/api/laps/:id` | No | Single lap with joins |
| `GET` | `/api/compare` | No | Fetch telemetry for two laps (`?lap_a=:id&lap_b=:id`) |
| `GET` | `/api/sessions` | No | List recent sessions |
| `GET` | `/api/sessions/:id` | No | Session detail with driver results |
| `POST` | `/api/sessions` | Yes | Upload parsed XML session |
| `GET` | `/api/me` | Yes | Authenticated user's internal profile (UUID) |
| `GET` | `/api/users/:id` | No | User profile |
| `GET` | `/api/users/:id/laps` | No | User's laps |
| `GET` | `/api/users/:id/sessions` | No | User's sessions |

Auth: `Authorization: Bearer <clerk_jwt>`

## Database Schema

See `api/migrations/` for authoritative schema. Key tables:

- `users` — internal user profile, keyed by `clerk_id` (Clerk user ID)
- `laps` — recorded telemetry laps from desktop
- `sessions` / `session_results` / `session_laps` — race session data from XML results
- `tracks` / `cars` — normalized lookup tables
- `events` / `session_events` — race events and incidents

## Lap File Format

```json
{
  "metadata": { "lap_number", "lap_time_ms", "s1_ms", "s2_ms", "s3_ms",
                "car_name", "car_class", "track_name", "session_type",
                "is_valid", "recorded_at", "sample_rate_hz" },
  "samples": [{ "t", "x", "y", "z", "speed", "gear", "rpm",
                "throttle", "brake", "steering", "clutch" }, ...]
}
```

Invalid laps (`is_valid=false`) are silently skipped at upload time.
