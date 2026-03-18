# Apxeer — Product Specification & Architecture

## 1. Overview

Apxeer is a simracing community platform. Drivers record their lap telemetry via a desktop app, upload it to a shared backend, and compare laps with other drivers on the web — overlaid on a track map with full telemetry graphs and delta analysis. A secondary feature provides rich race session stats parsed from LMU's XML result files.

**Core value proposition**: Find exactly where you lose time compared to a faster driver — visually, on the track map, with telemetry to explain it.

---

## 2. System Components

```
┌─────────────────────────────┐
│      Desktop App (Tauri)    │  Windows only (LMU is Windows)
│  Rust + HTMX + TypeScript   │
│  - Read shared memory       │
│  - Record lap telemetry     │
│  - Watch XML results folder │
│  - Upload to API            │
└─────────────┬───────────────┘
              │ HTTPS (REST/JSON)
              ▼
┌─────────────────────────────┐
│       Backend API (Go)      │  Fly.io
│  - Lap + telemetry storage  │
│  - Race result ingestion    │
│  - Auth validation          │
│  - Query endpoints for web  │
└──────┬──────────────────────┘
       │
       ├──────────────────────────────────┐
       ▼                                  ▼
┌─────────────────┐            ┌──────────────────────┐
│   Supabase      │            │   Web Frontend        │
│  - PostgreSQL   │            │   Next.js (React)     │
│  - Auth         │            │   Fly.io              │
│    (Google +    │            │  - Lap comparison     │
│     Discord)    │            │  - Track map + replay │
└─────────────────┘            │  - Telemetry graphs   │
                               │  - Race stats         │
                               │  - User profiles      │
                               └──────────────────────┘
```

---

## 3. Data Sources

### 3.1 Shared Memory (Telemetry)

Source: `LMU_Data` Windows shared memory, read via `SharedMemoryLayout` struct.

Recorded for **player car only**, at **20Hz** (extensible — sample rate is a config value).

Per sample (from `TelemInfoV01`):

| Field | Source | Notes |
|---|---|---|
| `timestamp` | `mElapsedTime` | seconds since session start |
| `pos_x/y/z` | `mPos` | world position (meters) — used for track map |
| `speed` | derived from `mLocalVel` | m/s → km/h |
| `gear` | `mGear` | -1=R, 0=N, 1+=forward |
| `rpm` | `mEngineRPM` | |
| `throttle` | `mUnfilteredThrottle` | 0.0–1.0 (raw driver input) |
| `brake` | `mUnfilteredBrake` | 0.0–1.0 |
| `steering` | `mUnfilteredSteering` | -1.0–1.0 |
| `clutch` | `mUnfilteredClutch` | 0.0–1.0 |

Per lap metadata (from `ScoringInfoV01` / `TelemInfoV01`):

- `lap_number`, `lap_time`, `sector_1/2/3`
- `car_name`, `car_class`, `track_name`
- `session_type` (Practice / Qualifying / Race)
- `is_valid` (track limits)

### 3.2 XML Result Files

Source: LMU writes result XML files after each session to a known folder. Desktop app watches this folder.

Key data extracted per session:

- **Session metadata**: track, event name, date/time, session type, duration, car classes allowed
- **Per driver per session**: name, car, class, grid position, final position, class position, laps, best lap time, pitstops, finish status
- **Per driver per lap**: lap time, sector times, top speed, fuel level, tyre wear (FL/FR/RL/RR), tyre compound, position in race, pit lap flag
- **Events**: penalties (type + reason), incidents (contact reports), track limit warnings

---

## 4. Features

### 4.1 Lap Recording (Desktop)

- Poll shared memory at 20Hz while in-session
- Detect lap boundaries via `mLapNumber` change
- Buffer completed lap data (samples + metadata) to local folder as JSON/binary files
- Discard invalid laps (e.g. track limits invalidation, incomplete laps)
- Upload behavior: **user-configurable**
  - Auto-upload: upload completed lap immediately when connected
  - Manual: show notification / light up upload button when buffered laps are pending
- Local buffer survives app restarts and offline sessions

### 4.2 XML Result Ingestion (Desktop)

- Watch LMU results folder (configurable path) for new XML files
- Parse on file creation
- Upload to API (same auto/manual setting as laps)
- Link race result entries to Apxeer user accounts by driver name matching (best-effort; user can confirm their in-game name in settings)

### 4.3 Lap Comparison (Web)

Core feature. Select any two laps from the same car class.

**Track Map view**:
- Track shape rendered from recorded XYZ position data (generated from first available lap for that track)
- Two animated "cars" (colored dots) racing around the map simultaneously
- Playback controls: play, pause, scrub (manual position control)
- Speed control (0.5×, 1×, 2×, 4×)

**Telemetry graphs** (all vs. distance, both laps overlaid):
- Speed
- Throttle %
- Brake %
- Gear
- Steering angle
- Delta time (+ / - seconds between the two laps at each track position)

**Interaction**:
- Clicking/dragging on any graph scrubs the playback position on the map
- Hovering shows exact values at that distance for both laps

### 4.4 Race Stats (Web)

Per session page:
- Full results table (position, class position, driver, car, team, laps, best lap, pitstops, finish status)
- Lap-by-lap breakdown per driver (lap time, sectors, position in race, tyre compound, tyre wear)
- Penalties and incidents log
- Position changes chart (grid → finish)

Per user profile:
- List of uploaded laps (filterable by track / car)
- List of races participated in
- Stats summary: total races, total laps recorded, best lap per track/car combo (future: wins, podiums, consistency index, improvement trend)

### 4.5 Auth & Accounts

- Login via **Google** or **Discord** OAuth (Supabase Auth)
- User must be authenticated to upload laps or race results
- Public profiles — anyone can view laps and stats without an account
- In-game name(s) linked to account (used to match XML results to user)
- Role field on user record: `user` | `admin` | `premium` (only `user` active initially)

---

## 5. Data Model (PostgreSQL)

```sql
-- Users (mirrors Supabase auth.users)
users
  id            uuid PK (= auth.users.id)
  username      text unique
  display_name  text
  avatar_url    text
  role          text default 'user'   -- 'user' | 'admin' | 'premium'
  ingame_names  text[]                -- LMU driver names linked to this account
  created_at    timestamptz

-- Tracks (auto-created on first lap upload for that track)
tracks
  id            uuid PK
  name          text unique           -- mTrackName from telemetry
  length_m      float                 -- from XML TrackLength
  map_path      text                  -- generated SVG/JSON path from position data

-- Cars
cars
  id            uuid PK
  name          text                  -- mVehicleName
  class         text                  -- CarClass (e.g. LMP2_ELMS)

-- Sessions (a session = one Practice/Qual/Race block from an XML file)
sessions
  id            uuid PK
  track_id      uuid FK tracks
  session_type  text                  -- 'Practice' | 'Qualifying' | 'Race'
  event_name    text                  -- TrackEvent
  started_at    timestamptz
  duration_min  int
  game_version  text
  raw_xml_url   text                  -- stored original XML for reprocessing

-- Session results (one row per driver per session)
session_results
  id            uuid PK
  session_id    uuid FK sessions
  user_id       uuid FK users nullable  -- null if driver not linked to account
  ingame_name   text
  car_id        uuid FK cars
  team_name     text
  car_number    text
  grid_pos      int
  finish_pos    int
  class_pos     int
  laps_completed int
  best_lap_ms   int
  pitstops      int
  finish_status text                  -- 'Finished Normally' | 'DNF' | etc.

-- Laps (from XML — all drivers, basic data)
session_laps
  id            uuid PK
  session_result_id uuid FK session_results
  lap_number    int
  lap_time_ms   int                   -- null if invalid/no time
  s1_ms         int
  s2_ms         int
  s3_ms         int
  top_speed_kph float
  fuel_fraction float
  tyre_wear_fl  float
  tyre_wear_fr  float
  tyre_wear_rl  float
  tyre_wear_rr  float
  tyre_compound text
  is_pit_lap    bool
  race_position int                   -- position in race at end of lap

-- Recorded laps (from desktop telemetry recording — player only)
laps
  id            uuid PK
  user_id       uuid FK users
  track_id      uuid FK tracks
  car_id        uuid FK cars
  session_id    uuid FK sessions nullable  -- if linkable to an XML session
  lap_number    int
  lap_time_ms   int
  s1_ms         int
  s2_ms         int
  s3_ms         int
  is_valid      bool
  sample_rate_hz int default 20
  recorded_at   timestamptz
  telemetry_url text                  -- URL to stored telemetry samples file

-- Telemetry samples stored as binary/JSON file (not in DB rows)
-- Format: array of { t, x, y, z, speed, gear, rpm, throttle, brake, steering, clutch }
-- Stored in object storage (Supabase Storage or S3-compatible)
```

**Note on telemetry storage**: Raw samples (~20Hz × ~90s lap = ~1800 samples) are stored as a compressed binary file (MessagePack or similar), not as individual DB rows. The `laps.telemetry_url` points to this file. This keeps the DB lean and queries fast.

---

## 6. API Design (Go)

### Auth
All write endpoints require `Authorization: Bearer <supabase_jwt>`.

### Endpoints

```
POST /api/laps                    Upload a completed lap + telemetry file
GET  /api/laps/:id                Get lap metadata
GET  /api/laps/:id/telemetry      Get telemetry samples for a lap

POST /api/sessions                Upload a parsed XML session result
GET  /api/sessions/:id            Get session with all results + laps
GET  /api/sessions                List sessions (filter: track, date, user)

GET  /api/tracks/:id              Get track info + map data
GET  /api/tracks/:id/laps         List laps for a track (filter: car_class, user)

GET  /api/users/:id               Get user profile
GET  /api/users/:id/laps          List user's recorded laps
GET  /api/users/:id/sessions      List user's race sessions
GET  /api/users/:id/stats         Aggregated stats

GET  /api/compare?lap_a=:id&lap_b=:id   Fetch both laps' telemetry for comparison
```

---

## 7. Desktop App Structure

```
apxeer-desktop/
├── src-tauri/src/
│   ├── lib.rs                    Tauri setup, command registration
│   ├── telemetry/
│   │   ├── mod.rs                Recording loop, lap detection, local buffer
│   │   └── lmu/
│   │       ├── mod.rs            read_telemetry() — shared memory reader
│   │       └── types.rs          C++ struct translations
│   ├── results/
│   │   ├── mod.rs                XML folder watcher + parser
│   │   └── types.rs              XML data structs
│   ├── upload/
│   │   └── mod.rs                Upload queue, auto/manual mode, retry logic
│   └── settings/
│       └── mod.rs                User settings (upload mode, LMU paths, auth token)
├── src/
│   ├── main.ts                   HTMX bootstrap
│   └── views/
│       ├── dashboard.html        Status, pending uploads, recent laps
│       ├── settings.html         Configure paths, upload mode, account
│       └── session.html          Live session indicator
```

### Desktop Recording Loop

```
Every 50ms (20Hz):
  read_telemetry() → SharedMemoryObjectOut
  if in_session and player_has_vehicle:
    if lap_number changed:
      finalize previous lap → write to local buffer
      if auto_upload: enqueue for upload
      else: notify user (badge / button)
    append sample to current lap buffer
```

---

## 8. Web Frontend Structure

```
apxeer-web/  (Next.js)
├── app/
│   ├── page.tsx                  Landing / recent sessions
│   ├── compare/
│   │   └── page.tsx              Lap comparison (track map + graphs)
│   ├── sessions/
│   │   ├── page.tsx              Session browser
│   │   └── [id]/page.tsx         Session detail (results table + lap breakdown)
│   ├── tracks/
│   │   └── [id]/page.tsx         Track page with lap leaderboard
│   └── users/
│       └── [id]/page.tsx         User profile (laps + stats)
├── components/
│   ├── TrackMap.tsx              SVG track map + animated car positions
│   ├── TelemetryGraph.tsx        Multi-channel graph (throttle/brake/speed/etc.)
│   ├── DeltaGraph.tsx            Delta time vs. distance
│   ├── PlaybackControls.tsx      Play/pause/scrub/speed
│   ├── SessionResultsTable.tsx
│   └── LapBreakdownTable.tsx
```

---

## 9. Track Map Generation

- On first lap upload for a track, generate the map from XYZ position samples
- XY plane (top-down view): normalize X/Z world coords to SVG viewport
- Store as SVG path or JSON coordinate array in `tracks.map_path`
- Subsequent laps for same track reuse the stored map

---

## 10. File Storage

Telemetry sample files stored in **Supabase Storage** (S3-compatible):

```
telemetry/{user_id}/{lap_id}.msgpack   (MessagePack compressed samples)
results/xml/{session_id}.xml           (original XML for audit/reprocessing)
```

---

## 11. Sim Support Extensibility

The telemetry layer is abstracted behind a trait/interface:

```rust
trait SimTelemetrySource {
    fn read(&self) -> Result<TelemetrySample, Error>;
    fn is_in_session(&self) -> bool;
    fn current_lap(&self) -> i32;
}
```

`LmuTelemetrySource` implements this for LMU shared memory. Future sims (iRacing, ACC, rF2) add new implementations without changing the recording loop.

---

## 12. Sample Rate Extensibility

`sample_rate_hz` is stored per lap. The recording interval is a user-configurable setting (default 20Hz). A future premium tier could allow 50Hz or 100Hz. The comparison/graph components consume whatever rate is stored — no hardcoding.

---

## 13. Phased Delivery

### Phase 1 — Core Loop
- Desktop: shared memory reader → lap recording → local buffer → manual upload
- API: lap + telemetry upload, basic retrieval
- Web: lap comparison page (track map + telemetry graphs + delta)

### Phase 2 — Race Stats
- Desktop: XML folder watcher + parser + upload
- API: session ingestion, driver name → user matching
- Web: session detail page, user profile with lap list

### Phase 3 — Community & Polish
- Web: track pages, session browser, search/filter
- User stats aggregation
- Auto-upload mode
- Notifications in desktop app

### Phase 4 — Future
- Premium tier (higher sample rate, private laps)
- Multi-sim support (iRacing, ACC)
- Opponent position recording
- Mobile-friendly web
