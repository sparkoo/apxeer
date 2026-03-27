-- 001: Initial schema (ported from Supabase migration 20260324000000_initial.sql)
-- Supabase-specific constructs removed:
--   - No auth.users FK (replaced by clerk_id column)
--   - No handle_new_user trigger
--   - No RLS policies (enforced at API layer)

-- Users
CREATE TABLE IF NOT EXISTS public.users (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_id     text UNIQUE NOT NULL,
    username     text UNIQUE,
    display_name text,
    avatar_url   text,
    role         text NOT NULL DEFAULT 'user', -- 'user' | 'admin' | 'premium'
    ingame_names text[] NOT NULL DEFAULT '{}', -- LMU driver names linked to this account
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Tracks
CREATE TABLE IF NOT EXISTS public.tracks (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name      text UNIQUE NOT NULL,
    length_m  float NOT NULL DEFAULT 0,
    map_path  text -- generated SVG/JSON path, populated after first lap upload
);

-- Cars
CREATE TABLE IF NOT EXISTS public.cars (
    id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name  text NOT NULL,
    class text NOT NULL,
    UNIQUE (name, class)
);

-- Sessions (one row per Practice/Qualifying/Race block from an XML result file)
CREATE TABLE IF NOT EXISTS public.sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id     uuid NOT NULL REFERENCES public.tracks(id),
    session_type text NOT NULL, -- 'Practice' | 'Qualifying' | 'Race'
    event_name   text,
    started_at   timestamptz NOT NULL,
    duration_min int NOT NULL DEFAULT 0,
    game_version text
);

-- Session results (one row per driver per session)
CREATE TABLE IF NOT EXISTS public.session_results (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id     uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    user_id        uuid REFERENCES public.users(id), -- null if driver not linked to account
    ingame_name    text NOT NULL,
    car_id         uuid NOT NULL REFERENCES public.cars(id),
    team_name      text,
    car_number     text,
    grid_pos       int,
    finish_pos     int NOT NULL DEFAULT 0,
    class_pos      int NOT NULL DEFAULT 0,
    laps_completed int NOT NULL DEFAULT 0,
    best_lap_ms    int,
    pitstops       int NOT NULL DEFAULT 0,
    finish_status  text
);

-- Per-lap data from XML results (all drivers)
CREATE TABLE IF NOT EXISTS public.session_laps (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_result_id uuid NOT NULL REFERENCES public.session_results(id) ON DELETE CASCADE,
    lap_number        int NOT NULL,
    lap_time_ms       int,       -- null = invalid lap
    s1_ms             int,
    s2_ms             int,
    s3_ms             int,
    top_speed_kph     float,
    fuel_fraction     float,
    tyre_wear_fl      float,
    tyre_wear_fr      float,
    tyre_wear_rl      float,
    tyre_wear_rr      float,
    tyre_compound     text,
    is_pit_lap        bool NOT NULL DEFAULT false,
    race_position     int
);

-- Recorded laps from desktop telemetry (player car only)
CREATE TABLE IF NOT EXISTS public.laps (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    track_id        uuid NOT NULL REFERENCES public.tracks(id),
    car_id          uuid NOT NULL REFERENCES public.cars(id),
    session_id      uuid REFERENCES public.sessions(id),
    lap_number      int NOT NULL,
    lap_time_ms     int NOT NULL,
    s1_ms           int,
    s2_ms           int,
    s3_ms           int,
    is_valid        bool NOT NULL DEFAULT true,
    sample_rate_hz  int NOT NULL DEFAULT 20,
    recorded_at     timestamptz NOT NULL,
    telemetry_url   text -- R2 object key: telemetry/{clerk_id}/{lap_id}.json.gz
);

CREATE INDEX IF NOT EXISTS laps_user_id     ON public.laps(user_id);
CREATE INDEX IF NOT EXISTS laps_track_id    ON public.laps(track_id);
CREATE INDEX IF NOT EXISTS laps_car_id      ON public.laps(car_id);
CREATE INDEX IF NOT EXISTS laps_lap_time_ms ON public.laps(lap_time_ms);
