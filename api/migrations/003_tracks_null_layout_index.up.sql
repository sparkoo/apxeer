-- 003: Partial unique index for tracks without a layout.
--
-- Migration 002 changed the tracks unique constraint from UNIQUE (name) to
-- UNIQUE (name, layout). PostgreSQL treats NULL as distinct, so two rows with
-- the same name and layout IS NULL would not conflict, and ON CONFLICT (name)
-- no longer targets any constraint — causing lap uploads to fail with a 500.
--
-- This partial index lets the upsert in the lap upload handler use:
--   ON CONFLICT (name) WHERE layout IS NULL DO UPDATE ...
-- which correctly deduplicates desktop-recorded laps that carry no layout info.
CREATE UNIQUE INDEX IF NOT EXISTS tracks_name_null_layout
    ON public.tracks(name)
    WHERE layout IS NULL;
