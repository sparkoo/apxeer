// Supabase Edge Function: api
// Single-function router that implements all REST API endpoints.
// URL pattern: https://<ref>.supabase.co/functions/v1/api/*
//
// Required secrets (set via `supabase secrets set --project-ref <ref>`):
//   SUPABASE_SERVICE_ROLE_KEY  — for storage uploads/downloads
//   DATABASE_URL               — Supabase transaction pooler connection string
//                                (postgres://postgres.<ref>:<pass>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres)

import { createClient } from "jsr:@supabase/supabase-js@2";
import postgres from "npm:postgres";

// ── CORS ─────────────────────────────────────────────────────────────────────

const CORS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-lap-metadata",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function err(msg: string, status: number): Response {
  return new Response(msg, { status, headers: CORS });
}

// ── DB client (reused across warm invocations) ────────────────────────────────

let _sql: ReturnType<typeof postgres> | null = null;

function getSql(): ReturnType<typeof postgres> {
  if (!_sql) {
    // SUPABASE_DB_URL is auto-injected by the Edge Function runtime (direct connection).
    // DATABASE_URL is a fallback for local dev or if the auto-injection is unavailable.
    const dbUrl = Deno.env.get("SUPABASE_DB_URL") ?? Deno.env.get("DATABASE_URL")!;
    _sql = postgres(dbUrl, {
      ssl: "require",
      prepare: false, // safe for both pooler and direct connections
      max: 1,
    });
  }
  return _sql;
}

// ── Supabase admin client (service role — for storage) ────────────────────────

function getAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ── Auth: validates JWT and returns user_id ───────────────────────────────────

async function getUser(req: Request): Promise<string | null> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: {
        headers: { Authorization: req.headers.get("Authorization") ?? "" },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ── Types for session upload (mirrors desktop results.rs) ─────────────────────

interface LapUploadRow {
  num: number;
  lap_time_ms: number | null;
  s1_ms: number | null;
  s2_ms: number | null;
  s3_ms: number | null;
  top_speed_kph: number;
  fuel_fraction: number;
  fuel_used: number;
  elapsed_time_s: number;
  tyre_wear_fl: number;
  tyre_wear_fr: number;
  tyre_wear_rl: number;
  tyre_wear_rr: number;
  tyre_compound: string;
  is_pit_lap: boolean;
  race_position: number | null;
}

interface DriverUploadRow {
  name: string;
  car_type: string;
  car_class: string;
  car_number: string;
  team_name: string;
  is_connected: boolean;
  grid_pos: number | null;
  class_grid_pos: number | null;
  finish_pos: number;
  class_pos: number;
  laps_completed: number;
  best_lap_ms: number | null;
  finish_time_s: number | null;
  pitstops: number;
  finish_status: string;
  laps: LapUploadRow[];
}

interface StreamEventUpload {
  event_type: string;
  elapsed_time: number;
  driver_name: string;
  detail: unknown;
  description: string;
}

interface SessionBlockUpload {
  session_type: string;
  session_datetime: number;
  duration_minutes: number;
  drivers: DriverUploadRow[];
  stream_events: StreamEventUpload[];
}

interface SessionUploadRequest {
  track_venue: string;
  track_course: string;
  track_event: string;
  track_length_m: number;
  game_version: string;
  setting: string;
  server_name: string;
  fuel_mult: number;
  tire_mult: number;
  damage_mult: number;
  datetime: number;
  source_filename: string;
  session_blocks: SessionBlockUpload[];
}

// ── SQL fragment for the standard lap SELECT with JOINs ───────────────────────

const LAP_SELECT = `
  SELECT l.id, l.user_id, l.track_id, l.car_id,
         l.lap_number, l.lap_time_ms, l.s1_ms, l.s2_ms, l.s3_ms,
         l.is_valid, l.sample_rate_hz, l.recorded_at, l.telemetry_url,
         t.name AS track_name, c.name AS car_name, c.class AS car_class,
         u.username
  FROM laps l
  JOIN tracks t ON t.id = l.track_id
  JOIN cars c ON c.id = l.car_id
  LEFT JOIN users u ON u.id = l.user_id
`;

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(req.url);
  // Strip /functions/v1/api prefix so path starts at /health, /api/laps, etc.
  const path = url.pathname.replace(/^\/functions\/v1\/api/, "") || "/";
  const method = req.method;
  const sql = getSql();

  try {
    // ── GET /health ───────────────────────────────────────────────────────────
    if (method === "GET" && path === "/health") {
      return new Response("ok", { headers: CORS });
    }

    // ── GET /api/stats ────────────────────────────────────────────────────────
    if (method === "GET" && path === "/api/stats") {
      const [row] = await sql`
        SELECT
          (SELECT COUNT(*)            FROM laps)::int                           AS total_laps,
          (SELECT COUNT(DISTINCT user_id) FROM laps)::int                      AS total_drivers,
          COALESCE(
            (SELECT SUM(t.length_m)
             FROM laps l JOIN tracks t ON t.id = l.track_id
             WHERE t.length_m > 0),
            0
          ) / 1000.0                                                            AS total_km
      `;
      return json(row);
    }

    // ── GET /api/tracks/records ───────────────────────────────────────────────
    if (method === "GET" && path === "/api/tracks/records") {
      const rows = await sql`
        SELECT DISTINCT ON (l.track_id)
          l.id AS lap_id, l.lap_time_ms, l.recorded_at,
          t.id AS track_id, t.name AS track_name,
          c.name AS car_name, c.class AS car_class,
          u.username
        FROM laps l
        JOIN tracks t ON t.id = l.track_id
        JOIN cars   c ON c.id = l.car_id
        LEFT JOIN users u ON u.id = l.user_id
        WHERE l.is_valid = true
        ORDER BY l.track_id, l.lap_time_ms ASC
      `;
      return json(rows);
    }

    // ── GET /api/laps ─────────────────────────────────────────────────────────
    if (method === "GET" && path === "/api/laps") {
      const userId = url.searchParams.get("user_id");
      const trackId = url.searchParams.get("track_id");
      let rows;
      if (userId && trackId) {
        rows = await sql`
          ${sql.unsafe(LAP_SELECT)}
          WHERE l.user_id = ${userId} AND l.track_id = ${trackId}
          ORDER BY l.recorded_at DESC LIMIT 100
        `;
      } else if (userId) {
        rows = await sql`
          ${sql.unsafe(LAP_SELECT)}
          WHERE l.user_id = ${userId}
          ORDER BY l.recorded_at DESC LIMIT 100
        `;
      } else if (trackId) {
        rows = await sql`
          ${sql.unsafe(LAP_SELECT)}
          WHERE l.track_id = ${trackId}
          ORDER BY l.recorded_at DESC LIMIT 100
        `;
      } else {
        rows = await sql`
          ${sql.unsafe(LAP_SELECT)}
          ORDER BY l.recorded_at DESC LIMIT 100
        `;
      }
      return json(rows);
    }

    // ── POST /api/laps ────────────────────────────────────────────────────────
    if (method === "POST" && path === "/api/laps") {
      const userId = await getUser(req);
      if (!userId) return err("Unauthorized", 401);

      // Read raw gzip body (max 10 MB)
      const body = new Uint8Array(await req.arrayBuffer());
      if (body.length > 10 * 1024 * 1024) return err("body too large", 400);

      // Parse X-Lap-Metadata header (base64-encoded JSON)
      const metaB64 = req.headers.get("x-lap-metadata");
      if (!metaB64) return err("missing X-Lap-Metadata header", 400);
      let meta: Record<string, unknown>;
      try {
        meta = JSON.parse(atob(metaB64));
      } catch {
        return err("invalid X-Lap-Metadata header", 400);
      }

      // Silently skip invalid laps (track limits, etc.)
      if (!meta.is_valid) {
        return new Response(null, { status: 204, headers: CORS });
      }

      // Upsert track
      const [{ id: trackId }] = await sql`
        INSERT INTO tracks (id, name, length_m)
        VALUES (gen_random_uuid(), ${meta.track_name as string}, 0)
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `;

      // Upsert car
      const [{ id: carId }] = await sql`
        INSERT INTO cars (id, name, class)
        VALUES (gen_random_uuid(), ${meta.car_name as string}, ${meta.car_class as string})
        ON CONFLICT (name, class) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `;

      // Insert lap row
      const [{ id: lapId }] = await sql`
        INSERT INTO laps
          (id, user_id, track_id, car_id, lap_number, lap_time_ms,
           s1_ms, s2_ms, s3_ms, is_valid, sample_rate_hz, recorded_at)
        VALUES
          (gen_random_uuid(), ${userId}, ${trackId}, ${carId},
           ${meta.lap_number as number}, ${meta.lap_time_ms as number},
           ${(meta.s1_ms as number) ?? null},
           ${(meta.s2_ms as number) ?? null},
           ${(meta.s3_ms as number) ?? null},
           ${meta.is_valid as boolean},
           ${meta.sample_rate_hz as number},
           ${new Date(meta.recorded_at as string)})
        RETURNING id
      `;

      // Upload gzip to Supabase Storage
      const storagePath = `telemetry/${userId}/${lapId}.json.gz`;
      const { error: uploadError } = await getAdmin()
        .storage.from("telemetry")
        .upload(storagePath, body, {
          contentType: "application/gzip",
          upsert: true,
        });
      if (uploadError) return err("storage upload failed", 500);

      // Set telemetry_url on the lap row
      await sql`UPDATE laps SET telemetry_url = ${storagePath} WHERE id = ${lapId}`;

      return json({ lap_id: lapId }, 201);
    }

    // ── GET /api/laps/:id ─────────────────────────────────────────────────────
    const lapMatch = path.match(/^\/api\/laps\/([^/]+)$/);
    if (method === "GET" && lapMatch) {
      const lapId = lapMatch[1];
      const [lap] = await sql`
        ${sql.unsafe(LAP_SELECT)}
        WHERE l.id = ${lapId}
      `;
      if (!lap) return err("lap not found", 404);
      return json(lap);
    }

    // ── GET /api/compare ──────────────────────────────────────────────────────
    if (method === "GET" && path === "/api/compare") {
      const lapAId = url.searchParams.get("lap_a");
      const lapBId = url.searchParams.get("lap_b");
      if (!lapAId || !lapBId) {
        return err("lap_a and lap_b are required", 400);
      }

      const [[lapA], [lapB]] = await Promise.all([
        sql`${sql.unsafe(LAP_SELECT)} WHERE l.id = ${lapAId}`,
        sql`${sql.unsafe(LAP_SELECT)} WHERE l.id = ${lapBId}`,
      ]);
      if (!lapA) return err("lap_a not found", 404);
      if (!lapB) return err("lap_b not found", 404);

      const admin = getAdmin();
      async function fetchSamples(lap: Record<string, unknown>) {
        if (!lap.telemetry_url) return [];
        const { data: blob, error } = await admin.storage
          .from("telemetry")
          .download(lap.telemetry_url as string);
        if (error || !blob) return [];
        const ds = new DecompressionStream("gzip");
        const decompressed = await new Response(
          blob.stream().pipeThrough(ds),
        ).json();
        return decompressed.samples ?? [];
      }

      const [samplesA, samplesB] = await Promise.all([
        fetchSamples(lapA as Record<string, unknown>),
        fetchSamples(lapB as Record<string, unknown>),
      ]);
      return json({
        lap_a: lapA,
        lap_b: lapB,
        samples_a: samplesA,
        samples_b: samplesB,
      });
    }

    // ── GET /api/sessions ─────────────────────────────────────────────────────
    if (method === "GET" && path === "/api/sessions") {
      const rows = await sql`
        SELECT s.id, s.track_id, s.session_type, s.event_name,
               s.started_at, s.duration_min,
               t.name AS track_name, t.length_m
        FROM sessions s
        JOIN tracks t ON t.id = s.track_id
        ORDER BY s.started_at DESC
        LIMIT 50
      `;
      return json(
        rows.map((s) => ({
          ...s,
          track: { id: s.track_id, name: s.track_name, length_m: s.length_m },
        })),
      );
    }

    // ── GET /api/sessions/:id ─────────────────────────────────────────────────
    const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (method === "GET" && sessionMatch) {
      const id = sessionMatch[1];
      const [session] = await sql`
        SELECT s.id, s.track_id, s.session_type, s.event_name,
               s.started_at, s.duration_min,
               t.name AS track_name, t.length_m
        FROM sessions s
        JOIN tracks t ON t.id = s.track_id
        WHERE s.id = ${id}
      `;
      if (!session) return err("session not found", 404);

      const results = await sql`
        SELECT sr.id, sr.ingame_name,
               c.name AS car_type, c.class AS car_class,
               sr.car_number, sr.team_name, sr.grid_pos,
               sr.finish_pos, sr.class_pos, sr.laps_completed,
               sr.best_lap_ms, sr.pitstops, sr.finish_status
        FROM session_results sr
        JOIN cars c ON c.id = sr.car_id
        WHERE sr.session_id = ${id}
        ORDER BY sr.finish_pos ASC
      `;
      return json({
        ...session,
        track: {
          id: session.track_id,
          name: session.track_name,
          length_m: session.length_m,
        },
        results,
      });
    }

    // ── POST /api/sessions ────────────────────────────────────────────────────
    if (method === "POST" && path === "/api/sessions") {
      const userId = await getUser(req);
      if (!userId) return err("Unauthorized", 401);

      const body: SessionUploadRequest = await req.json();

      // Upsert track (with layout)
      const [{ id: trackId }] = await sql`
        INSERT INTO tracks (id, name, layout, length_m)
        VALUES (gen_random_uuid(),
                ${body.track_venue},
                ${body.track_course || null},
                ${body.track_length_m})
        ON CONFLICT (name, layout) DO UPDATE SET length_m = EXCLUDED.length_m
        RETURNING id
      `;

      // Upsert event (dedup by source_datetime)
      const eventAt = new Date(body.datetime * 1000);
      const [{ id: eventId }] = await sql`
        INSERT INTO events
          (id, track_id, event_name, started_at, game_version,
           setting, server_name, fuel_mult, tire_mult, damage_mult,
           source_datetime)
        VALUES
          (gen_random_uuid(), ${trackId}, ${body.track_event}, ${eventAt},
           ${body.game_version}, ${body.setting}, ${body.server_name},
           ${body.fuel_mult}, ${body.tire_mult}, ${body.damage_mult},
           ${body.datetime})
        ON CONFLICT (source_datetime) DO UPDATE SET event_name = EXCLUDED.event_name
        RETURNING id
      `;

      for (const block of body.session_blocks) {
        const blockAt =
          block.session_datetime > 0
            ? new Date(block.session_datetime * 1000)
            : eventAt;
        const blockSourceFile = `${body.source_filename}/${block.session_type}`;

        // Insert session (dedup by source_filename — DO NOTHING on conflict)
        const sessionRows = await sql`
          INSERT INTO sessions
            (id, event_id, track_id, session_type, event_name,
             started_at, duration_min, game_version, source_filename)
          VALUES
            (gen_random_uuid(), ${eventId}, ${trackId}, ${block.session_type},
             ${body.track_event}, ${blockAt}, ${block.duration_minutes},
             ${body.game_version}, ${blockSourceFile})
          ON CONFLICT (source_filename) DO NOTHING
          RETURNING id
        `;
        if (sessionRows.length === 0) continue; // already exists

        const sessionId = sessionRows[0].id;

        for (const d of block.drivers) {
          // Upsert car
          const [{ id: carId }] = await sql`
            INSERT INTO cars (id, name, class)
            VALUES (gen_random_uuid(), ${d.car_type}, ${d.car_class})
            ON CONFLICT (name, class) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
          `;

          // Try to link ingame name to a registered user account
          const [userRow] = await sql`
            SELECT id FROM users WHERE ${d.name} = ANY(ingame_names) LIMIT 1
          `;
          const driverUserId = userRow?.id ?? null;

          // Insert session result
          const [{ id: resultId }] = await sql`
            INSERT INTO session_results
              (id, session_id, user_id, ingame_name, car_id, team_name,
               car_number, grid_pos, class_grid_pos, finish_pos, class_pos,
               laps_completed, best_lap_ms, finish_time_s, pitstops,
               finish_status, is_connected)
            VALUES
              (gen_random_uuid(), ${sessionId}, ${driverUserId}, ${d.name},
               ${carId}, ${d.team_name}, ${d.car_number},
               ${d.grid_pos ?? null}, ${d.class_grid_pos ?? null},
               ${d.finish_pos}, ${d.class_pos}, ${d.laps_completed},
               ${d.best_lap_ms ?? null}, ${d.finish_time_s ?? null},
               ${d.pitstops}, ${d.finish_status}, ${d.is_connected})
            RETURNING id
          `;

          // Insert per-lap rows
          for (const lap of d.laps) {
            await sql`
              INSERT INTO session_laps
                (id, session_result_id, lap_number, lap_time_ms,
                 s1_ms, s2_ms, s3_ms, top_speed_kph, fuel_fraction, fuel_used,
                 elapsed_time_s,
                 tyre_wear_fl, tyre_wear_fr, tyre_wear_rl, tyre_wear_rr,
                 tyre_compound, is_pit_lap, race_position)
              VALUES
                (gen_random_uuid(), ${resultId}, ${lap.num},
                 ${lap.lap_time_ms ?? null},
                 ${lap.s1_ms ?? null}, ${lap.s2_ms ?? null},
                 ${lap.s3_ms ?? null}, ${lap.top_speed_kph},
                 ${lap.fuel_fraction}, ${lap.fuel_used}, ${lap.elapsed_time_s},
                 ${lap.tyre_wear_fl}, ${lap.tyre_wear_fr},
                 ${lap.tyre_wear_rl}, ${lap.tyre_wear_rr},
                 ${lap.tyre_compound}, ${lap.is_pit_lap},
                 ${lap.race_position ?? null})
            `;
          }
        }

        // Insert stream events (incidents, penalties, track limits)
        for (const ev of block.stream_events) {
          await sql`
            INSERT INTO session_events
              (id, session_id, event_type, elapsed_time, driver_name,
               detail, description)
            VALUES
              (gen_random_uuid(), ${sessionId}, ${ev.event_type},
               ${ev.elapsed_time}, ${ev.driver_name},
               ${JSON.stringify(ev.detail)}, ${ev.description})
          `;
        }
      }

      return json({ status: "ok" }, 201);
    }

    // ── GET /api/users/:id ────────────────────────────────────────────────────
    const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
    if (method === "GET" && userMatch) {
      const id = userMatch[1];
      const [user] = await sql`
        SELECT id, username, display_name, avatar_url, role, created_at
        FROM users WHERE id = ${id}
      `;
      if (!user) return err("user not found", 404);
      return json(user);
    }

    // ── GET /api/users/:id/laps ───────────────────────────────────────────────
    const userLapsMatch = path.match(/^\/api\/users\/([^/]+)\/laps$/);
    if (method === "GET" && userLapsMatch) {
      const userId = userLapsMatch[1];
      const trackId = url.searchParams.get("track_id");
      const carId = url.searchParams.get("car_id");
      let rows;
      if (trackId && carId) {
        rows = await sql`
          ${sql.unsafe(LAP_SELECT)}
          WHERE l.user_id = ${userId}
            AND l.track_id = ${trackId}
            AND l.car_id = ${carId}
          ORDER BY l.recorded_at DESC LIMIT 500
        `;
      } else if (trackId) {
        rows = await sql`
          ${sql.unsafe(LAP_SELECT)}
          WHERE l.user_id = ${userId} AND l.track_id = ${trackId}
          ORDER BY l.recorded_at DESC LIMIT 500
        `;
      } else if (carId) {
        rows = await sql`
          ${sql.unsafe(LAP_SELECT)}
          WHERE l.user_id = ${userId} AND l.car_id = ${carId}
          ORDER BY l.recorded_at DESC LIMIT 500
        `;
      } else {
        rows = await sql`
          ${sql.unsafe(LAP_SELECT)}
          WHERE l.user_id = ${userId}
          ORDER BY l.recorded_at DESC LIMIT 500
        `;
      }
      return json(rows);
    }

    // ── GET /api/users/:id/sessions ───────────────────────────────────────────
    const userSessionsMatch = path.match(/^\/api\/users\/([^/]+)\/sessions$/);
    if (method === "GET" && userSessionsMatch) {
      const userId = userSessionsMatch[1];
      const rows = await sql`
        SELECT s.id, s.track_id, s.session_type, s.event_name,
               s.started_at, s.duration_min,
               t.name AS track_name, t.length_m,
               sr.finish_pos, sr.class_pos, sr.best_lap_ms,
               sr.laps_completed, sr.finish_status,
               c.name AS car_name, c.class AS car_class
        FROM session_results sr
        JOIN sessions s ON s.id = sr.session_id
        JOIN tracks   t ON t.id = s.track_id
        JOIN cars     c ON c.id = sr.car_id
        WHERE sr.user_id = ${userId}
        ORDER BY s.started_at DESC
        LIMIT 50
      `;
      return json(
        rows.map((s) => ({
          id: s.id,
          track_id: s.track_id,
          session_type: s.session_type,
          event_name: s.event_name,
          started_at: s.started_at,
          duration_min: s.duration_min,
          track: { id: s.track_id, name: s.track_name, length_m: s.length_m },
          my_result: {
            finish_pos: s.finish_pos,
            class_pos: s.class_pos,
            best_lap_ms: s.best_lap_ms,
            laps_completed: s.laps_completed,
            finish_status: s.finish_status,
            car_name: s.car_name,
            car_class: s.car_class,
          },
        })),
      );
    }

    return err("not found", 404);
  } catch (e) {
    console.error(e);
    return err("internal server error", 500);
  }
});
