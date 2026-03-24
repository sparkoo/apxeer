-- Run this in the Supabase SQL editor to bootstrap the schema.

-- Users (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
    id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username     text UNIQUE,
    display_name text,
    avatar_url   text,
    role         text NOT NULL DEFAULT 'user', -- 'user' | 'admin' | 'premium'
    ingame_names text[] NOT NULL DEFAULT '{}', -- LMU driver names linked to this account
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Auto-create a users row when someone signs up via Supabase Auth.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO public.users (id, display_name, avatar_url)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

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
    telemetry_url   text -- path in Supabase Storage
);

CREATE INDEX IF NOT EXISTS laps_user_id       ON public.laps(user_id);
CREATE INDEX IF NOT EXISTS laps_track_id      ON public.laps(track_id);
CREATE INDEX IF NOT EXISTS laps_car_id        ON public.laps(car_id);
CREATE INDEX IF NOT EXISTS laps_lap_time_ms   ON public.laps(lap_time_ms);

-- Row Level Security: users can only read their own laps; all laps are public.
ALTER TABLE public.laps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "laps are publicly readable" ON public.laps FOR SELECT USING (true);
CREATE POLICY "users insert own laps"      ON public.laps FOR INSERT WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.session_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "session_results are publicly readable" ON public.session_results FOR SELECT USING (true);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions are publicly readable" ON public.sessions FOR SELECT USING (true);
