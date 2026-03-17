package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// These mirror the structs in the desktop results.rs, sent as JSON.

type UploadLapRow struct {
	Num          int     `json:"num"`
	LapTimeMs    *uint32 `json:"lap_time_ms"`
	S1Ms         *uint32 `json:"s1_ms"`
	S2Ms         *uint32 `json:"s2_ms"`
	S3Ms         *uint32 `json:"s3_ms"`
	TopSpeedKph  float32 `json:"top_speed_kph"`
	FuelFraction float32 `json:"fuel_fraction"`
	TyreWearFL   float32 `json:"tyre_wear_fl"`
	TyreWearFR   float32 `json:"tyre_wear_fr"`
	TyreWearRL   float32 `json:"tyre_wear_rl"`
	TyreWearRR   float32 `json:"tyre_wear_rr"`
	TyreCompound string  `json:"tyre_compound"`
	IsPitLap     bool    `json:"is_pit_lap"`
	RacePosition *int    `json:"race_position"`
}

type UploadDriverRow struct {
	Name          string         `json:"name"`
	CarType       string         `json:"car_type"`
	CarClass      string         `json:"car_class"`
	CarNumber     string         `json:"car_number"`
	TeamName      string         `json:"team_name"`
	IsPlayer      bool           `json:"is_player"`
	GridPos       *int           `json:"grid_pos"`
	FinishPos     int            `json:"finish_pos"`
	ClassPos      int            `json:"class_pos"`
	LapsCompleted int            `json:"laps_completed"`
	BestLapMs     *uint32        `json:"best_lap_ms"`
	Pitstops      int            `json:"pitstops"`
	FinishStatus  string         `json:"finish_status"`
	Laps          []UploadLapRow `json:"laps"`
}

type UploadSessionBlock struct {
	SessionType     string            `json:"session_type"`
	DurationMinutes int               `json:"duration_minutes"`
	Drivers         []UploadDriverRow `json:"drivers"`
}

type UploadSessionRequest struct {
	TrackVenue    string               `json:"track_venue"`
	TrackEvent    string               `json:"track_event"`
	TrackLengthM  float64              `json:"track_length_m"`
	GameVersion   string               `json:"game_version"`
	Datetime      int64                `json:"datetime"`
	SourceFile    string               `json:"source_filename"`
	SessionBlocks []UploadSessionBlock `json:"session_blocks"`
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

		type TrackRow struct {
			ID       string  `json:"id"`
			Name     string  `json:"name"`
			LengthM  float64 `json:"length_m"`
			MapPath  *string `json:"map_path"`
		}
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

// UploadSession handles POST /api/sessions
// Ingests a full parsed XML result file.
func UploadSession(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req UploadSessionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}

		// Upsert track.
		var trackID string
		err := db.QueryRow(r.Context(), `
			INSERT INTO tracks (id, name, length_m)
			VALUES (gen_random_uuid(), $1, $2)
			ON CONFLICT (name) DO UPDATE SET length_m = EXCLUDED.length_m
			RETURNING id
		`, req.TrackVenue, req.TrackLengthM).Scan(&trackID)
		if err != nil {
			http.Error(w, "db error (track)", http.StatusInternalServerError)
			return
		}

		sessionAt := time.Unix(req.Datetime, 0).UTC()

		for _, block := range req.SessionBlocks {
			// Insert session row.
			var sessionID string
			err := db.QueryRow(r.Context(), `
				INSERT INTO sessions (id, track_id, session_type, event_name, started_at, duration_min, game_version)
				VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
				RETURNING id
			`, trackID, block.SessionType, req.TrackEvent, sessionAt, block.DurationMinutes, req.GameVersion).Scan(&sessionID)
			if err != nil {
				http.Error(w, "db error (session)", http.StatusInternalServerError)
				return
			}

			for _, d := range block.Drivers {
				// Upsert car.
				var carID string
				err := db.QueryRow(r.Context(), `
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
				_ = db.QueryRow(r.Context(), `
					SELECT id FROM users WHERE $1 = ANY(ingame_names) LIMIT 1
				`, d.Name).Scan(&userID)

				// Insert session result.
				var resultID string
				err = db.QueryRow(r.Context(), `
					INSERT INTO session_results
						(id, session_id, user_id, ingame_name, car_id, team_name, car_number,
						 grid_pos, finish_pos, class_pos, laps_completed, best_lap_ms, pitstops, finish_status)
					VALUES
						(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
					RETURNING id
				`,
					sessionID, userID, d.Name, carID, d.TeamName, d.CarNumber,
					d.GridPos, d.FinishPos, d.ClassPos, d.LapsCompleted,
					d.BestLapMs, d.Pitstops, d.FinishStatus,
				).Scan(&resultID)
				if err != nil {
					http.Error(w, "db error (session_result)", http.StatusInternalServerError)
					return
				}

				// Insert per-lap rows.
				for _, lap := range d.Laps {
					_, err := db.Exec(r.Context(), `
						INSERT INTO session_laps
							(id, session_result_id, lap_number, lap_time_ms,
							 s1_ms, s2_ms, s3_ms, top_speed_kph, fuel_fraction,
							 tyre_wear_fl, tyre_wear_fr, tyre_wear_rl, tyre_wear_rr,
							 tyre_compound, is_pit_lap, race_position)
						VALUES
							(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
					`,
						resultID, lap.Num, lap.LapTimeMs,
						lap.S1Ms, lap.S2Ms, lap.S3Ms,
						lap.TopSpeedKph, lap.FuelFraction,
						lap.TyreWearFL, lap.TyreWearFR, lap.TyreWearRL, lap.TyreWearRR,
						lap.TyreCompound, lap.IsPitLap, lap.RacePosition,
					)
					if err != nil {
						http.Error(w, "db error (session_lap)", http.StatusInternalServerError)
						return
					}
				}
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}
}
