package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sparkoo/apxeer/api/internal/db"
	"github.com/sparkoo/apxeer/api/internal/middleware"
)

type SessionHandler struct {
	DB *db.DB
}

// List handles GET /api/sessions — 50 most recent sessions.
func (h *SessionHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Pool.Query(r.Context(), `
		SELECT s.id, s.track_id, s.session_type, s.event_name,
		       s.started_at, s.duration_min,
		       t.name AS track_name, t.length_m
		FROM sessions s
		JOIN tracks t ON t.id = s.track_id
		ORDER BY s.started_at DESC
		LIMIT 50
	`)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type track struct {
		ID      string  `json:"id"`
		Name    string  `json:"name"`
		LengthM float64 `json:"length_m"`
	}
	type session struct {
		ID          string    `json:"id"`
		TrackID     string    `json:"track_id"`
		SessionType string    `json:"session_type"`
		EventName   *string   `json:"event_name"`
		StartedAt   time.Time `json:"started_at"`
		DurationMin int       `json:"duration_min"`
		Track       track     `json:"track"`
	}

	result := []session{}
	for rows.Next() {
		var s session
		var trackName string
		var lengthM float64
		if err := rows.Scan(
			&s.ID, &s.TrackID, &s.SessionType, &s.EventName,
			&s.StartedAt, &s.DurationMin,
			&trackName, &lengthM,
		); err != nil {
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}
		s.Track = track{ID: s.TrackID, Name: trackName, LengthM: lengthM}
		result = append(result, s)
	}
	writeJSON(w, result)
}

// Get handles GET /api/sessions/:id — session detail with results.
func (h *SessionHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	type track struct {
		ID      string  `json:"id"`
		Name    string  `json:"name"`
		LengthM float64 `json:"length_m"`
	}
	type result struct {
		ID            string  `json:"id"`
		IngameName    string  `json:"ingame_name"`
		CarType       string  `json:"car_type"`
		CarClass      string  `json:"car_class"`
		CarNumber     *string `json:"car_number"`
		TeamName      *string `json:"team_name"`
		GridPos       *int    `json:"grid_pos"`
		FinishPos     int     `json:"finish_pos"`
		ClassPos      int     `json:"class_pos"`
		LapsCompleted int     `json:"laps_completed"`
		BestLapMs     *int    `json:"best_lap_ms"`
		Pitstops      int     `json:"pitstops"`
		FinishStatus  *string `json:"finish_status"`
	}
	type sessionDetail struct {
		ID          string    `json:"id"`
		TrackID     string    `json:"track_id"`
		SessionType string    `json:"session_type"`
		EventName   *string   `json:"event_name"`
		StartedAt   time.Time `json:"started_at"`
		DurationMin int       `json:"duration_min"`
		Track       track     `json:"track"`
		Results     []result  `json:"results"`
	}

	var s sessionDetail
	var trackName string
	var lengthM float64
	err := h.DB.Pool.QueryRow(r.Context(), `
		SELECT s.id, s.track_id, s.session_type, s.event_name,
		       s.started_at, s.duration_min,
		       t.name, t.length_m
		FROM sessions s
		JOIN tracks t ON t.id = s.track_id
		WHERE s.id = $1
	`, id).Scan(
		&s.ID, &s.TrackID, &s.SessionType, &s.EventName,
		&s.StartedAt, &s.DurationMin,
		&trackName, &lengthM,
	)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	s.Track = track{ID: s.TrackID, Name: trackName, LengthM: lengthM}

	rows, err := h.DB.Pool.Query(r.Context(), `
		SELECT sr.id, sr.ingame_name,
		       c.name AS car_type, c.class AS car_class,
		       sr.car_number, sr.team_name, sr.grid_pos,
		       sr.finish_pos, sr.class_pos, sr.laps_completed,
		       sr.best_lap_ms, sr.pitstops, sr.finish_status
		FROM session_results sr
		JOIN cars c ON c.id = sr.car_id
		WHERE sr.session_id = $1
		ORDER BY sr.finish_pos ASC
	`, id)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	s.Results = []result{}
	for rows.Next() {
		var res result
		if err := rows.Scan(
			&res.ID, &res.IngameName,
			&res.CarType, &res.CarClass,
			&res.CarNumber, &res.TeamName, &res.GridPos,
			&res.FinishPos, &res.ClassPos, &res.LapsCompleted,
			&res.BestLapMs, &res.Pitstops, &res.FinishStatus,
		); err != nil {
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}
		s.Results = append(s.Results, res)
	}
	writeJSON(w, s)
}

// Create handles POST /api/sessions — full session upload from desktop.
func (h *SessionHandler) Create(w http.ResponseWriter, r *http.Request) {
	type lapRow struct {
		Num          int      `json:"num"`
		LapTimeMs    *int     `json:"lap_time_ms"`
		S1Ms         *int     `json:"s1_ms"`
		S2Ms         *int     `json:"s2_ms"`
		S3Ms         *int     `json:"s3_ms"`
		TopSpeedKph  float64  `json:"top_speed_kph"`
		FuelFraction float64  `json:"fuel_fraction"`
		FuelUsed     float64  `json:"fuel_used"`
		ElapsedTimeS float64  `json:"elapsed_time_s"`
		TyreWearFL   float64  `json:"tyre_wear_fl"`
		TyreWearFR   float64  `json:"tyre_wear_fr"`
		TyreWearRL   float64  `json:"tyre_wear_rl"`
		TyreWearRR   float64  `json:"tyre_wear_rr"`
		TyreCompound string   `json:"tyre_compound"`
		IsPitLap     bool     `json:"is_pit_lap"`
		RacePosition *int     `json:"race_position"`
	}
	type driverRow struct {
		Name          string   `json:"name"`
		CarType       string   `json:"car_type"`
		CarClass      string   `json:"car_class"`
		CarNumber     string   `json:"car_number"`
		TeamName      string   `json:"team_name"`
		IsPlayer      bool     `json:"is_player"`
		IsConnected   bool     `json:"is_connected"`
		GridPos       *int     `json:"grid_pos"`
		ClassGridPos  *int     `json:"class_grid_pos"`
		FinishPos     int      `json:"finish_pos"`
		ClassPos      int      `json:"class_pos"`
		LapsCompleted int      `json:"laps_completed"`
		BestLapMs     *int     `json:"best_lap_ms"`
		FinishTimeS   *float64 `json:"finish_time_s"`
		Pitstops      int      `json:"pitstops"`
		FinishStatus  string   `json:"finish_status"`
		Laps          []lapRow `json:"laps"`
	}
	type streamEvent struct {
		EventType   string `json:"event_type"`
		ElapsedTime float64 `json:"elapsed_time"`
		DriverName  string `json:"driver_name"`
		Detail      any    `json:"detail"`
		Description string `json:"description"`
	}
	type sessionBlock struct {
		SessionType     string        `json:"session_type"`
		SessionDatetime int64         `json:"session_datetime"`
		DurationMinutes int           `json:"duration_minutes"`
		Drivers         []driverRow   `json:"drivers"`
		StreamEvents    []streamEvent `json:"stream_events"`
	}
	type body struct {
		TrackVenue     string         `json:"track_venue"`
		TrackCourse    string         `json:"track_course"`
		TrackEvent     string         `json:"track_event"`
		TrackLengthM   float64        `json:"track_length_m"`
		GameVersion    string         `json:"game_version"`
		Setting        string         `json:"setting"`
		ServerName     string         `json:"server_name"`
		FuelMult       float64        `json:"fuel_mult"`
		TireMult       float64        `json:"tire_mult"`
		DamageMult     int            `json:"damage_mult"`
		Datetime       int64          `json:"datetime"`
		SourceFilename string         `json:"source_filename"`
		SessionBlocks  []sessionBlock `json:"session_blocks"`
	}

	var req body
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	pool := h.DB.Pool
	callerID := middleware.UserIDFromCtx(ctx)

	// Upsert track (with layout)
	var trackID uuid.UUID
	trackCourse := strOrNil(req.TrackCourse)
	err := pool.QueryRow(ctx, `
		INSERT INTO tracks (id, name, layout, length_m)
		VALUES (gen_random_uuid(), $1, $2, $3)
		ON CONFLICT (name, layout) DO UPDATE SET length_m = EXCLUDED.length_m
		RETURNING id
	`, req.TrackVenue, trackCourse, req.TrackLengthM).Scan(&trackID)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// Upsert event (dedup by source_datetime)
	eventAt := time.Unix(req.Datetime, 0).UTC()
	var eventID uuid.UUID
	err = pool.QueryRow(ctx, `
		INSERT INTO events
			(id, track_id, event_name, started_at, game_version,
			 setting, server_name, fuel_mult, tire_mult, damage_mult,
			 source_datetime)
		VALUES
			(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (source_datetime) DO UPDATE SET event_name = EXCLUDED.event_name
		RETURNING id
	`, trackID, req.TrackEvent, eventAt, req.GameVersion,
		req.Setting, req.ServerName, req.FuelMult, req.TireMult, req.DamageMult,
		req.Datetime).Scan(&eventID)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	for _, block := range req.SessionBlocks {
		blockAt := eventAt
		if block.SessionDatetime > 0 {
			blockAt = time.Unix(block.SessionDatetime, 0).UTC()
		}
		blockSrcFile := req.SourceFilename + "/" + block.SessionType

		// Insert session (dedup by source_filename)
		var sessionID uuid.UUID
		err = pool.QueryRow(ctx, `
			INSERT INTO sessions
				(id, event_id, track_id, session_type, event_name,
				 started_at, duration_min, game_version, source_filename)
			VALUES
				(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (source_filename) DO NOTHING
			RETURNING id
		`, eventID, trackID, block.SessionType, req.TrackEvent,
			blockAt, block.DurationMinutes, req.GameVersion, blockSrcFile).Scan(&sessionID)
		if err != nil {
			// DO NOTHING returned no rows — session already exists, skip block
			continue
		}

		for _, d := range block.Drivers {
			var carID uuid.UUID
			if err := pool.QueryRow(ctx, `
				INSERT INTO cars (id, name, class)
				VALUES (gen_random_uuid(), $1, $2)
				ON CONFLICT (name, class) DO UPDATE SET name = EXCLUDED.name
				RETURNING id
			`, d.CarType, d.CarClass).Scan(&carID); err != nil {
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}

			// Link driver to a user account.
			// If this is the player who uploaded the session, use their authenticated
			// ID directly, update ingame_names for future matching, and retroactively
			// link any historical session_results with the same ingame name.
			var driverUserID *uuid.UUID
			if d.IsPlayer && callerID != uuid.Nil {
				driverUserID = &callerID
				// Add ingame name to user's profile (idempotent).
				pool.Exec(ctx, `
					UPDATE users
					SET ingame_names = array_append(ingame_names, $1)
					WHERE id = $2 AND NOT ($1 = ANY(ingame_names))
				`, d.Name, callerID)
				// Retroactively link unowned historical results for this driver name.
				pool.Exec(ctx, `
					UPDATE session_results
					SET user_id = $2
					WHERE ingame_name = $1 AND user_id IS NULL
				`, d.Name, callerID)
			} else {
				var uid uuid.UUID
				if err := pool.QueryRow(ctx,
					`SELECT id FROM users WHERE $1 = ANY(ingame_names) LIMIT 1`,
					d.Name,
				).Scan(&uid); err == nil {
					driverUserID = &uid
				}
			}

			var resultID uuid.UUID
			if err := pool.QueryRow(ctx, `
				INSERT INTO session_results
					(id, session_id, user_id, ingame_name, car_id, team_name,
					 car_number, grid_pos, class_grid_pos, finish_pos, class_pos,
					 laps_completed, best_lap_ms, finish_time_s, pitstops,
					 finish_status, is_connected)
				VALUES
					(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8,
					 $9, $10, $11, $12, $13, $14, $15, $16)
				RETURNING id
			`, sessionID, driverUserID, d.Name, carID,
				strOrNil(d.TeamName), strOrNil(d.CarNumber),
				d.GridPos, d.ClassGridPos,
				d.FinishPos, d.ClassPos, d.LapsCompleted,
				d.BestLapMs, d.FinishTimeS,
				d.Pitstops, strOrNil(d.FinishStatus), d.IsConnected,
			).Scan(&resultID); err != nil {
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}

			for _, lap := range d.Laps {
				if _, err := pool.Exec(ctx, `
					INSERT INTO session_laps
						(id, session_result_id, lap_number, lap_time_ms,
						 s1_ms, s2_ms, s3_ms, top_speed_kph, fuel_fraction, fuel_used,
						 elapsed_time_s,
						 tyre_wear_fl, tyre_wear_fr, tyre_wear_rl, tyre_wear_rr,
						 tyre_compound, is_pit_lap, race_position)
					VALUES
						(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8,
						 $9, $10, $11, $12, $13, $14, $15, $16, $17)
				`, resultID, lap.Num, lap.LapTimeMs,
					lap.S1Ms, lap.S2Ms, lap.S3Ms,
					lap.TopSpeedKph, lap.FuelFraction, lap.FuelUsed,
					lap.ElapsedTimeS,
					lap.TyreWearFL, lap.TyreWearFR, lap.TyreWearRL, lap.TyreWearRR,
					lap.TyreCompound, lap.IsPitLap, lap.RacePosition,
				); err != nil {
					http.Error(w, "Internal Server Error", http.StatusInternalServerError)
					return
				}
			}
		}

		for _, ev := range block.StreamEvents {
			detailJSON, _ := json.Marshal(ev.Detail)
			if _, err := pool.Exec(ctx, `
				INSERT INTO session_events
					(id, session_id, event_type, elapsed_time, driver_name,
					 detail, description)
				VALUES
					(gen_random_uuid(), $1, $2, $3, $4, $5, $6)
			`, sessionID, ev.EventType, ev.ElapsedTime,
				strOrNil(ev.DriverName), detailJSON, strOrNil(ev.Description),
			); err != nil {
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}
		}
	}

	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]string{"status": "ok"})
}

func strOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
