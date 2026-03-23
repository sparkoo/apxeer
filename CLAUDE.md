# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation

Architecture, design decisions, and notable implementation details are kept in `docs/`. Update the relevant file(s) in `docs/` whenever you make a change that affects architecture, data flow, API contracts, DB schema, or key design decisions. Create new files as needed — keep them focused by topic.

## Git Workflow

Commit often — after each small, self-contained, working change. Each commit should leave the codebase in a working state. Prefer many focused commits over one large commit at the end of a task.

## Development Commands

All commands are run from the repo root via `make`. The Makefile handles WSL/Windows detection automatically.

| Command | What it does |
|---|---|
| `make desktop` | Start Tauri desktop app — **Windows terminal only** (Git Bash / cmd) |
| `make api` | Start Go API on port 8080 (runs in WSL) |
| `make web` | Start Next.js dev server on port 3000 (runs in WSL) |
| `make db` | Start Postgres 17 container via Podman (WSL) |
| `make db-stop` | Stop Postgres container |
| `make migrate` | Run `migrations/001_local.sql` against local DB |
| `make seed` | Insert two test laps with fake telemetry |
| `make dev` | Start DB + API + web together |

### Desktop-specific commands
```bash
# From apxeer-desktop/ on Windows
cargo tauri dev       # dev mode with hot-reload
cargo tauri build     # production build

# Run Rust tests (includes XML parser tests against real LMU files)
cd apxeer-desktop && cargo test
```

> The desktop app requires LMU XML result files at absolute Windows paths hardcoded in the tests — see `results.rs:342`.

## Architecture Overview

```
apxeer-desktop/  — Tauri 2 app (Windows only)
apxeer-api/      — Go REST API (Fly.io)
apxeer-web/      — Next.js web frontend (Fly.io)
lmu-telemetry/     — LMU C++ headers + sample XML result files
plans/             — SPEC.md (full spec) + lmu-shared-memory-rust.md
```

### Desktop App (Tauri 2 + Rust + HTMX)

The frontend is plain HTML with [HTMX](https://htmx.org/) and the `tauri-htmx-extension` that maps `hx-post="command:<name>"` to Tauri `invoke()` calls. Tauri commands return HTML strings that HTMX swaps into the DOM.

**Rust backend modules** (`apxeer-desktop/src-tauri/src/`):

| Module | Role |
|---|---|
| `lib.rs` | Tauri setup, state management, command registration |
| `telemetry.rs` | 20Hz recording loop, lap detection, writes `.json.gz` to local buffer |
| `lmu_telemetry` | Windows shared memory reader (`LMU_Data`) via `winapi` |
| `results.rs` | Polls LMU XML results folder every 5s, parses XML → `.json.gz` buffer |
| `upload.rs` | Upload queue: auto (every 30s) or manual via `upload_now` command |
| `settings.rs` | Persisted settings (API URL, auth token, auto-upload, LMU results path) |

**Data flow:**
1. `telemetry.rs` reads `LMU_Data` shared memory at 20Hz → detects lap boundaries → writes `{timestamp}-lap-{n}.json.gz` to `<AppData>/apxeer/buffer/`
2. `results.rs` watches the LMU results XML folder → parses → writes `{filename}.json.gz` to `<AppData>/apxeer/results/`
3. `upload.rs` reads both buffer folders → `POST /api/laps` (body = gzip, metadata in `X-Lap-Metadata` header) and `POST /api/sessions` (body = JSON)
4. On success, the local file is deleted

**Tauri commands** exposed to the frontend:
- `get_recorder_status` → returns HTML fragment (status dot + pending count)
- `upload_now` → triggers immediate upload, returns result HTML
- `get_settings` / `save_settings` → read/write `settings.json`

### Lap file format

Completed laps are written as gzip-compressed JSON:
```json
{
  "metadata": { "lap_number", "lap_time_ms", "s1_ms", "s2_ms", "s3_ms",
                "car_name", "car_class", "track_name", "session_type",
                "is_valid", "recorded_at", "sample_rate_hz" },
  "samples": [{ "t", "x", "y", "z", "speed", "gear", "rpm",
                "throttle", "brake", "steering", "clutch" }, ...]
}
```
Invalid laps (track limits, `is_valid=false`) are silently skipped at upload time.

### SimTelemetrySource trait

The telemetry layer is designed for multi-sim extensibility. New sims implement:
```rust
trait SimTelemetrySource {
    fn read(&self) -> Result<TelemetrySample, Error>;
    fn is_in_session(&self) -> bool;
    fn current_lap(&self) -> i32;
}
```

### API (Go) — not yet implemented

REST API with `Authorization: Bearer <supabase_jwt>`. Key endpoints:
- `POST /api/laps` — upload lap (gzip body + `X-Lap-Metadata` header)
- `POST /api/sessions` — upload parsed XML session
- `GET /api/compare?lap_a=:id&lap_b=:id` — fetch both laps' telemetry

### Database

Supabase (Postgres). Telemetry samples are **not** stored as DB rows — they are stored as MessagePack files in Supabase Storage at `telemetry/{user_id}/{lap_id}.msgpack`. The `laps.telemetry_url` column references this file.

## Key Dependencies (Desktop)

- `winapi` + `widestring` — Windows shared memory access
- `roxmltree` — XML parsing (LMU result files include DTD, so `allow_dtd: true` required)
- `flate2` — gzip compress/decompress for lap and session files
- `ureq` — HTTP client for uploads
- `serde_json` — serialization throughout
- `tauri-htmx-extension` — maps HTMX requests to Tauri commands

## Settings Storage

Settings are persisted to `<AppData>/apxeer/config/settings.json`:
```json
{
  "api_url": "http://localhost:8080",
  "auth_token": "",
  "auto_upload": false,
  "lmu_results_dir": ""
}
```
Default LMU results path: `Documents/Le Mans Ultimate/UserData/Log/Results`.
