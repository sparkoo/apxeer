# Architecture

## System Overview

Apxeer is a simracing telemetry platform — "Strava for sim racing". The desktop app records lap telemetry from the simulator and uploads it to the server; the web app provides lap comparison and race statistics.

## Components

```
apxeer-desktop/  — Tauri 2 app (Windows only)
apxeer-api/      — Go REST API (Supabase Edge Function)
apxeer-web/      — Preact + Vite web frontend (Cloudflare Workers)
lmu-telemetry/     — LMU C++ headers + sample XML result files
plans/             — SPEC.md (full spec) + lmu-shared-memory-rust.md
docs/              — Architecture and design documentation (this folder)
```

## Stack

| Layer | Tech |
|---|---|
| Desktop | Tauri 2 + Rust + HTMX |
| Backend API | Go (chi router, pgx, godotenv) |
| Web frontend | Preact + Vite + Tailwind + wouter |
| Database + Auth | Supabase (Postgres + Google/Discord OAuth) |
| File storage | Supabase Storage (local: `LOCAL_STORAGE_DIR=/tmp/apxeer-storage`) |
| API hosting | Supabase Edge Functions (Deno) |
| Web hosting | Cloudflare Workers (static assets) |

## Data Flow

1. **Telemetry recording** — `telemetry.rs` reads `LMU_Data` Windows shared memory at 20Hz, detects lap boundaries, writes `{timestamp}-lap-{n}.json.gz` to `<AppData>/apxeer/buffer/`
2. **Results parsing** — `results.rs` polls the LMU XML results folder every 5s, parses session XML, writes `{filename}.json.gz` to `<AppData>/apxeer/results/`
3. **Upload** — `upload.rs` reads both buffer folders, POSTs lap files to `POST /api/laps` (gzip body + `X-Lap-Metadata` header) and session files to `POST /api/sessions`; deletes local file on success. Runs every 30s or on manual trigger.
4. **Storage** — API stores telemetry as MessagePack files in Supabase Storage at `telemetry/{user_id}/{lap_id}.msgpack`; the `laps.telemetry_url` DB column references this file. Telemetry samples are **not** stored as DB rows.
5. **Compare** — Web frontend fetches `GET /api/compare?lap_a=:id&lap_b=:id`, renders track map SVG from XYZ position data and telemetry charts (speed, throttle, brake, gear, RPM, steering).

## Desktop App Modules

| Module | Role |
|---|---|
| `lib.rs` | Tauri setup, state management, command registration |
| `telemetry.rs` | 20Hz recording loop, lap detection |
| `lmu_telemetry/` | Windows shared memory reader (`LMU_Data`) via `winapi` |
| `results.rs` | LMU XML results watcher and parser |
| `upload.rs` | Upload queue (auto every 30s or manual) |
| `settings.rs` | Persisted settings (`settings.json`) |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/laps` | Upload lap (gzip body + `X-Lap-Metadata` header) |
| `POST` | `/api/sessions` | Upload parsed XML session |
| `GET` | `/api/compare` | Fetch telemetry for two laps (`?lap_a=:id&lap_b=:id`) |

Auth: `Authorization: Bearer <supabase_jwt>`. Local dev bypasses JWT when token matches `DEV_TOKEN`.

## Database Schema

See `apxeer-api/migrations/` for authoritative schema. Key tables: `laps`, `sessions`.

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
