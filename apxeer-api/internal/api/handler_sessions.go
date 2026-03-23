package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// These mirror the structs in the desktop results.rs, sent as JSON.

type UploadLapRow struct {
	Num           int      `json:"num"`
	LapTimeMs     *uint32  `json:"lap_time_ms"`
	S1Ms          *uint32  `json:"s1_ms"`
	S2Ms          *uint32  `json:"s2_ms"`
	S3Ms          *uint32  `json:"s3_ms"`
	TopSpeedKph   float32  `json:"top_speed_kph"`
	FuelFraction  float32  `json:"fuel_fraction"`
	FuelUsed      float32  `json:"fuel_used"`
	ElapsedTimeS  float64  `json:"elapsed_time_s"`
	TyreWearFL    float32  `json:"tyre_wear_fl"`
	TyreWearFR    float32  `json:"tyre_wear_fr"`
	TyreWearRL    float32  `json:"tyre_wear_rl"`
	TyreWearRR    float32  `json:"tyre_wear_rr"`
	TyreCompound  string   `json:"tyre_compound"`
	IsPitLap      bool     `json:"is_pit_lap"`
	RacePosition  *int     `json:"race_position"`
}

type UploadDriverRow struct {
	Name          string         `json:"name"`
	CarType       string         `json:"car_type"`
	CarClass      string         `json:"car_class"`
	CarNumber     string         `json:"car_number"`
	TeamName      string         `json:"team_name"`
	IsPlayer      bool           `json:"is_player"`
	IsConnected   bool           `json:"is_connected"`
	GridPos       *int           `json:"grid_pos"`
	ClassGridPos  *int           `json:"class_grid_pos"`
	FinishPos     int            `json:"finish_pos"`
	ClassPos      int            `json:"class_pos"`
	LapsCompleted int            `json:"laps_completed"`
	BestLapMs     *uint32        `json:"best_lap_ms"`
	FinishTimeS   *float64       `json:"finish_time_s"`
	Pitstops      int            `json:"pitstops"`
	FinishStatus  string         `json:"finish_status"`
	Laps          []UploadLapRow `json:"laps"`
}

type UploadStreamEvent struct {
	EventType   string          `json:"event_type"`
	ElapsedTime float64         `json:"elapsed_time"`
	DriverName  string          `json:"driver_name"`
	Detail      json.RawMessage `json:"detail"`
	Description string          `json:"description"`
}

type UploadSessionBlock struct {
	SessionType      string              `json:"session_type"`
	SessionDatetime  int64               `json:"session_datetime"`
	DurationMinutes  int                 `json:"duration_minutes"`
	Drivers          []UploadDriverRow   `json:"drivers"`
	StreamEvents     []UploadStreamEvent `json:"stream_events"`
}

type UploadSessionRequest struct {
	TrackVenue    string               `json:"track_venue"`
	TrackCourse   string               `json:"track_course"`
	TrackEvent    string               `json:"track_event"`
	TrackLengthM  float64              `json:"track_length_m"`
	GameVersion   string               `json:"game_version"`
	Setting       string               `json:"setting"`
	ServerName    string               `json:"server_name"`
	FuelMult      float64              `json:"fuel_mult"`
	TireMult      float64              `json:"tire_mult"`
	DamageMult    int                  `json:"damage_mult"`
	Datetime      int64                `json:"datetime"`
	SourceFile    string               `json:"source_filename"`
	SessionBlocks []UploadSessionBlock `json:"session_blocks"`
}

// TrackRow is the JSON shape for embedded track info in session responses.
type TrackRow struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	LengthM float64 `json:"length_m"`
	MapPath *string `json:"map_path"`
}

// ListSessions handles GET /api/sessions (public — no auth required).
func ListSessions(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.Query(r.Context(), `
			SELECT s.id, s.track_id, s.session_type, s.event_name, s.started_at, s.duration_min,
			       t.name AS track_name, t.length_m
			FROM sessions s
			JOIN tracks t ON t.id = s.track_id
			ORDER BY s.started_at DESC
			LIMIT 50
		`)
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type SessionRow struct {
			ID          string   `json:"id"`
			TrackID     string   `json:"track_id"`
			SessionType string   `json:"session_type"`
			EventName   string   `json:"event_name"`
			StartedAt   string   `json:"started_at"`
			DurationMin int      `json:"duration_min"`
			Track       TrackRow `json:"track"`
		}

		sessions := []SessionRow{}
		for rows.Next() {
			var s SessionRow
			var startedAt time.Time
			if err := rows.Scan(
				&s.ID, &s.TrackID, &s.SessionType, &s.EventName, &startedAt, &s.DurationMin,
				&s.Track.Name, &s.Track.LengthM,
			); err != nil {
				http.Error(w, "db scan error", http.StatusInternalServerError)
				return
			}
			s.StartedAt = startedAt.Format(time.RFC3339)
			s.Track.ID = s.TrackID
			sessions = append(sessions, s)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(sessions)
	}
}

// ListUserSessions handles GET /api/users/{userID}/sessions (public).
// Returns sessions where the user participated, with their result embedded.
func ListUserSessions(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := chi.URLParam(r, "userID")

		rows, err := db.Query(r.Context(), `
			SELECT s.id, s.track_id, s.session_type, s.event_name, s.started_at, s.duration_min,
			       t.name AS track_name, t.length_m,
			       sr.finish_pos, sr.class_pos, sr.best_lap_ms, sr.laps_completed, sr.finish_status,
			       c.name AS car_name, c.class AS car_class
			FROM session_results sr
			JOIN sessions s ON s.id = sr.session_id
			JOIN tracks t ON t.id = s.track_id
			JOIN cars c ON c.id = sr.car_id
			WHERE sr.user_id = $1
			ORDER BY s.started_at DESC
			LIMIT 50
		`, userID)
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type UserResultRow struct {
			FinishPos     int    `json:"finish_pos"`
			ClassPos      int    `json:"class_pos"`
			BestLapMs     *int   `json:"best_lap_ms"`
			LapsCompleted int    `json:"laps_completed"`
			FinishStatus  string `json:"finish_status"`
			CarName       string `json:"car_name"`
			CarClass      string `json:"car_class"`
		}
		type UserSessionRow struct {
			ID          string        `json:"id"`
			TrackID     string        `json:"track_id"`
			SessionType string        `json:"session_type"`
			EventName   string        `json:"event_name"`
			StartedAt   string        `json:"started_at"`
			DurationMin int           `json:"duration_min"`
			Track       TrackRow      `json:"track"`
			MyResult    UserResultRow `json:"my_result"`
		}

		sessions := []UserSessionRow{}
		for rows.Next() {
			var s UserSessionRow
			var startedAt time.Time
			if err := rows.Scan(
				&s.ID, &s.TrackID, &s.SessionType, &s.EventName, &startedAt, &s.DurationMin,
				&s.Track.Name, &s.Track.LengthM,
				&s.MyResult.FinishPos, &s.MyResult.ClassPos, &s.MyResult.BestLapMs,
				&s.MyResult.LapsCompleted, &s.MyResult.FinishStatus,
				&s.MyResult.CarName, &s.MyResult.CarClass,
			); err != nil {
				http.Error(w, "db scan error", http.StatusInternalServerError)
				return
			}
			s.StartedAt = startedAt.Format(time.RFC3339)
			s.Track.ID = s.TrackID
			sessions = append(sessions, s)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(sessions)
	}
}

// UploadSession handles POST /api/sessions
// Ingests a full parsed XML result file.
func UploadSession(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req UploadSessionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}

		ctx := r.Context()

		// Upsert track (with layout).
		var trackID string
		err := db.QueryRow(ctx, `
			INSERT INTO tracks (id, name, layout, length_m)
			VALUES (gen_random_uuid(), $1, $2, $3)
			ON CONFLICT (name, layout) DO UPDATE SET length_m = EXCLUDED.length_m
			RETURNING id
		`, req.TrackVenue, nilIfEmpty(req.TrackCourse), req.TrackLengthM).Scan(&trackID)
		if err != nil {
			http.Error(w, "db error (track)", http.StatusInternalServerError)
			return
		}

		// Upsert event (grouped by source_datetime).
		eventAt := time.Unix(req.Datetime, 0).UTC()
		var eventID string
		err = db.QueryRow(ctx, `
			INSERT INTO events (id, track_id, event_name, started_at, game_version,
			                    setting, server_name, fuel_mult, tire_mult, damage_mult,
			                    source_datetime)
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (source_datetime) DO UPDATE SET event_name = EXCLUDED.event_name
			RETURNING id
		`, trackID, req.TrackEvent, eventAt, req.GameVersion,
			req.Setting, req.ServerName, req.FuelMult, req.TireMult, req.DamageMult,
			req.Datetime,
		).Scan(&eventID)
		if err != nil {
			http.Error(w, "db error (event)", http.StatusInternalServerError)
			return
		}

		for _, block := range req.SessionBlocks {
			// Use per-block datetime if available, otherwise fall back to root datetime.
			blockAt := eventAt
			if block.SessionDatetime > 0 {
				blockAt = time.Unix(block.SessionDatetime, 0).UTC()
			}

			// Determine source_filename for this block.
			// The desktop sends one source_filename per XML file. Each block in the
			// file gets a suffix to make it unique: "file.xml/Race", "file.xml/Qualifying".
			blockSourceFile := req.SourceFile + "/" + block.SessionType

			// Insert session row (dedup via source_filename).
			var sessionID string
			err := db.QueryRow(ctx, `
				INSERT INTO sessions (id, event_id, track_id, session_type, event_name,
				                      started_at, duration_min, game_version, source_filename)
				VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
				ON CONFLICT (source_filename) DO NOTHING
				RETURNING id
			`, eventID, trackID, block.SessionType, req.TrackEvent,
				blockAt, block.DurationMinutes, req.GameVersion, blockSourceFile,
			).Scan(&sessionID)
			if err != nil {
				// ON CONFLICT DO NOTHING returns no rows — this is a duplicate, skip.
				continue
			}

			for _, d := range block.Drivers {
				// Upsert car.
				var carID string
				err := db.QueryRow(ctx, `
					INSERT INTO cars (id, name, class)
					VALUES (gen_random_uuid(), $1, $2)
					ON CONFLICT (name, class) DO UPDATE SET name = EXCLUDED.name
					RETURNING id
				`, d.CarType, d.CarClass).Scan(&carID)
				if err != nil {
					http.Error(w, "db error (car)", http.StatusInternalServerError)
					return
				}

				// Try to match driver name to a registered user.
				var userID *string
				_ = db.QueryRow(ctx, `
					SELECT id FROM users WHERE $1 = ANY(ingame_names) LIMIT 1
				`, d.Name).Scan(&userID)

				// Insert session result.
				var resultID string
				err = db.QueryRow(ctx, `
					INSERT INTO session_results
						(id, session_id, user_id, ingame_name, car_id, team_name, car_number,
						 grid_pos, class_grid_pos, finish_pos, class_pos, laps_completed,
						 best_lap_ms, finish_time_s, pitstops, finish_status, is_connected)
					VALUES
						(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
					RETURNING id
				`,
					sessionID, userID, d.Name, carID, d.TeamName, d.CarNumber,
					d.GridPos, d.ClassGridPos, d.FinishPos, d.ClassPos, d.LapsCompleted,
					d.BestLapMs, d.FinishTimeS, d.Pitstops, d.FinishStatus, d.IsConnected,
				).Scan(&resultID)
				if err != nil {
					http.Error(w, "db error (session_result)", http.StatusInternalServerError)
					return
				}

				// Insert per-lap rows.
				for _, lap := range d.Laps {
					_, err := db.Exec(ctx, `
						INSERT INTO session_laps
							(id, session_result_id, lap_number, lap_time_ms,
							 s1_ms, s2_ms, s3_ms, top_speed_kph, fuel_fraction, fuel_used,
							 elapsed_time_s,
							 tyre_wear_fl, tyre_wear_fr, tyre_wear_rl, tyre_wear_rr,
							 tyre_compound, is_pit_lap, race_position)
						VALUES
							(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
					`,
						resultID, lap.Num, lap.LapTimeMs,
						lap.S1Ms, lap.S2Ms, lap.S3Ms,
						lap.TopSpeedKph, lap.FuelFraction, lap.FuelUsed,
						lap.ElapsedTimeS,
						lap.TyreWearFL, lap.TyreWearFR, lap.TyreWearRL, lap.TyreWearRR,
						lap.TyreCompound, lap.IsPitLap, lap.RacePosition,
					)
					if err != nil {
						http.Error(w, "db error (session_lap)", http.StatusInternalServerError)
						return
					}
				}
			}

			// Insert stream events (incidents, penalties, track limits).
			for _, ev := range block.StreamEvents {
				_, err := db.Exec(ctx, `
					INSERT INTO session_events
						(id, session_id, event_type, elapsed_time, driver_name, detail, description)
					VALUES
						(gen_random_uuid(), $1, $2, $3, $4, $5, $6)
				`, sessionID, ev.EventType, ev.ElapsedTime, ev.DriverName, ev.Detail, ev.Description)
				if err != nil {
					http.Error(w, "db error (session_event)", http.StatusInternalServerError)
					return
				}
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}
}

// GetSession handles GET /api/sessions/{id} (public).
// Returns the session header with all results, ordered by finish position.
func GetSession(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")

		type ResultRow struct {
			ID           string  `json:"id"`
			InGameName   string  `json:"ingame_name"`
			CarType      string  `json:"car_type"`
			CarClass     string  `json:"car_class"`
			CarNumber    string  `json:"car_number"`
			TeamName     string  `json:"team_name"`
			GridPos      *int    `json:"grid_pos"`
			FinishPos    int     `json:"finish_pos"`
			ClassPos     int     `json:"class_pos"`
			LapsCompleted int    `json:"laps_completed"`
			BestLapMs    *int    `json:"best_lap_ms"`
			Pitstops     int     `json:"pitstops"`
			FinishStatus string  `json:"finish_status"`
		}
		type SessionDetailRow struct {
			ID          string      `json:"id"`
			TrackID     string      `json:"track_id"`
			SessionType string      `json:"session_type"`
			EventName   string      `json:"event_name"`
			StartedAt   string      `json:"started_at"`
			DurationMin int         `json:"duration_min"`
			Track       TrackRow    `json:"track"`
			Results     []ResultRow `json:"results"`
		}

		// Fetch session + track.
		var s SessionDetailRow
		var startedAt time.Time
		err := db.QueryRow(r.Context(), `
			SELECT s.id, s.track_id, s.session_type, s.event_name, s.started_at, s.duration_min,
			       t.name AS track_name, t.length_m
			FROM sessions s
			JOIN tracks t ON t.id = s.track_id
			WHERE s.id = $1
		`, id).Scan(
			&s.ID, &s.TrackID, &s.SessionType, &s.EventName, &startedAt, &s.DurationMin,
			&s.Track.Name, &s.Track.LengthM,
		)
		if err != nil {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}
		s.StartedAt = startedAt.Format(time.RFC3339)
		s.Track.ID = s.TrackID

		// Fetch results ordered by finish position.
		rows, err := db.Query(r.Context(), `
			SELECT sr.id, sr.ingame_name, c.name AS car_type, c.class AS car_class,
			       sr.car_number, sr.team_name, sr.grid_pos, sr.finish_pos, sr.class_pos,
			       sr.laps_completed, sr.best_lap_ms, sr.pitstops, sr.finish_status
			FROM session_results sr
			JOIN cars c ON c.id = sr.car_id
			WHERE sr.session_id = $1
			ORDER BY sr.finish_pos ASC
		`, id)
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		s.Results = []ResultRow{}
		for rows.Next() {
			var res ResultRow
			if err := rows.Scan(
				&res.ID, &res.InGameName, &res.CarType, &res.CarClass,
				&res.CarNumber, &res.TeamName, &res.GridPos, &res.FinishPos, &res.ClassPos,
				&res.LapsCompleted, &res.BestLapMs, &res.Pitstops, &res.FinishStatus,
			); err != nil {
				http.Error(w, "db scan error", http.StatusInternalServerError)
				return
			}
			s.Results = append(s.Results, res)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(s)
	}
}

// nilIfEmpty returns nil for empty strings, useful for nullable text columns.
func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
