-- 002: Events table, track layouts, enriched session data, stream events
-- (ported from Supabase migration 20260324000001_events_and_enrichment.sql — no changes needed)

-- Events: groups Practice/Qualify/Race sessions from the same server event
CREATE TABLE IF NOT EXISTS public.events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id         uuid NOT NULL REFERENCES public.tracks(id),
    event_name       text,
    started_at       timestamptz NOT NULL,
    game_version     text,
    setting          text,
    server_name      text,
    fuel_mult        float NOT NULL DEFAULT 1,
    tire_mult        float NOT NULL DEFAULT 1,
    damage_mult      int NOT NULL DEFAULT 100,
    source_datetime  bigint UNIQUE
);

-- Track layouts
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS layout text;
ALTER TABLE public.tracks DROP CONSTRAINT IF EXISTS tracks_name_key;
ALTER TABLE public.tracks ADD CONSTRAINT tracks_name_layout_key UNIQUE (name, layout);

-- Sessions: link to event + dedup
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id);
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS source_filename text UNIQUE;

-- Session results: new columns
ALTER TABLE public.session_results ADD COLUMN IF NOT EXISTS finish_time_s float;
ALTER TABLE public.session_results ADD COLUMN IF NOT EXISTS class_grid_pos int;
ALTER TABLE public.session_results ADD COLUMN IF NOT EXISTS is_connected bool NOT NULL DEFAULT true;

-- Session laps: new columns
ALTER TABLE public.session_laps ADD COLUMN IF NOT EXISTS elapsed_time_s float;
ALTER TABLE public.session_laps ADD COLUMN IF NOT EXISTS fuel_used float;

-- Stream events: incidents, penalties, track limits
CREATE TABLE IF NOT EXISTS public.session_events (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    event_type   text NOT NULL,
    elapsed_time float NOT NULL,
    driver_name  text,
    detail       jsonb,
    description  text
);

CREATE INDEX IF NOT EXISTS session_events_session_id ON public.session_events(session_id);
CREATE INDEX IF NOT EXISTS session_events_type ON public.session_events(event_type);
