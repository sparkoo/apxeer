package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/apxeer/api/internal/storage"
)

type LapMetadata struct {
	LapNumber    int     `json:"lap_number"`
	LapTimeMs    uint32  `json:"lap_time_ms"`
	S1Ms         *uint32 `json:"s1_ms"`
	S2Ms         *uint32 `json:"s2_ms"`
	S3Ms         *uint32 `json:"s3_ms"`
	CarName      string  `json:"car_name"`
	CarClass     string  `json:"car_class"`
	TrackName    string  `json:"track_name"`
	SessionType  int     `json:"session_type"`
	IsValid      bool    `json:"is_valid"`
	RecordedAt   string  `json:"recorded_at"`
	SampleRateHz uint32  `json:"sample_rate_hz"`
}

type UploadLapRequest struct {
	Metadata LapMetadata `json:"metadata"`
	// Telemetry samples are uploaded as a separate gzip file in the same request
	// via multipart form, or the entire .json.gz is sent as the body.
}

// ListLaps handles GET /api/laps (public — no auth required).
// Optional query param: user_id to filter by a specific user.
func ListLaps(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		filterUserID := r.URL.Query().Get("user_id")

		query := `
			SELECT l.id, l.user_id, l.track_id, l.car_id,
			       l.lap_number, l.lap_time_ms, l.s1_ms, l.s2_ms, l.s3_ms,
			       l.is_valid, l.sample_rate_hz, l.recorded_at, l.telemetry_url,
			       t.name AS track_name, c.name AS car_name, c.class AS car_class,
			       u.username
			FROM laps l
			JOIN tracks t ON t.id = l.track_id
			JOIN cars c ON c.id = l.car_id
			LEFT JOIN users u ON u.id = l.user_id`

		var args []any
		if filterUserID != "" {
			query += ` WHERE l.user_id = $1`
			args = append(args, filterUserID)
		}
		query += ` ORDER BY l.recorded_at DESC LIMIT 100`

		rows, err := db.Query(r.Context(), query, args...)
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type LapRow struct {
			ID           string  `json:"id"`
			UserID       string  `json:"user_id"`
			TrackID      string  `json:"track_id"`
			CarID        string  `json:"car_id"`
			LapNumber    int     `json:"lap_number"`
			LapTimeMs    uint32  `json:"lap_time_ms"`
			S1Ms         *uint32 `json:"s1_ms"`
			S2Ms         *uint32 `json:"s2_ms"`
			S3Ms         *uint32 `json:"s3_ms"`
			IsValid      bool    `json:"is_valid"`
			SampleRateHz uint32  `json:"sample_rate_hz"`
			RecordedAt   string  `json:"recorded_at"`
			TelemetryURL *string `json:"telemetry_url"`
			TrackName    string  `json:"track_name"`
			CarName      string  `json:"car_name"`
			CarClass     string  `json:"car_class"`
			Username     *string `json:"username"`
		}

		laps := []LapRow{}
		for rows.Next() {
			var l LapRow
			var recordedAt time.Time
			if err := rows.Scan(
				&l.ID, &l.UserID, &l.TrackID, &l.CarID,
				&l.LapNumber, &l.LapTimeMs, &l.S1Ms, &l.S2Ms, &l.S3Ms,
				&l.IsValid, &l.SampleRateHz, &recordedAt, &l.TelemetryURL,
				&l.TrackName, &l.CarName, &l.CarClass, &l.Username,
			); err != nil {
				http.Error(w, "db scan error", http.StatusInternalServerError)
				return
			}
			l.RecordedAt = recordedAt.Format(time.RFC3339)
			laps = append(laps, l)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(laps)
	}
}

// UploadLap handles POST /api/laps
// The desktop app sends the raw .json.gz file as the request body.
// We store it in Supabase Storage and record metadata in the DB.
func UploadLap(db *pgxpool.Pool, store *storage.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := UserIDFromContext(r.Context())

		// Read the raw .json.gz body (max 10MB — a lap is ~50KB compressed).
		r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "failed to read body", http.StatusBadRequest)
			return
		}

		// Parse metadata from X-Lap-Metadata header (base64-encoded JSON).
		metaBytes, err := base64.StdEncoding.DecodeString(r.Header.Get("X-Lap-Metadata"))
		if err != nil {
			http.Error(w, "invalid X-Lap-Metadata encoding", http.StatusBadRequest)
			return
		}
		var meta LapMetadata
		if err := json.Unmarshal(metaBytes, &meta); err != nil {
			http.Error(w, "invalid X-Lap-Metadata header", http.StatusBadRequest)
			return
		}

		if !meta.IsValid {
			// Accept but don't store invalid laps (track limits, etc.)
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// 1. Ensure track exists (upsert by name).
		var trackID string
		err = db.QueryRow(r.Context(), `
			INSERT INTO tracks (id, name, length_m)
			VALUES (gen_random_uuid(), $1, 0)
			ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
			RETURNING id
		`, meta.TrackName).Scan(&trackID)
		if err != nil {
			http.Error(w, "db error (track)", http.StatusInternalServerError)
			return
		}

		// 2. Ensure car exists (upsert by name + class).
		var carID string
		err = db.QueryRow(r.Context(), `
			INSERT INTO cars (id, name, class)
			VALUES (gen_random_uuid(), $1, $2)
			ON CONFLICT (name, class) DO UPDATE SET name = EXCLUDED.name
			RETURNING id
		`, meta.CarName, meta.CarClass).Scan(&carID)
		if err != nil {
			http.Error(w, "db error (car)", http.StatusInternalServerError)
			return
		}

		// 3. Insert lap row to get the lap ID.
		lapID := ""
		recordedAt, _ := time.Parse(time.RFC3339, meta.RecordedAt)
		err = db.QueryRow(r.Context(), `
			INSERT INTO laps
				(id, user_id, track_id, car_id, lap_number, lap_time_ms,
				 s1_ms, s2_ms, s3_ms, is_valid, sample_rate_hz, recorded_at)
			VALUES
				(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			RETURNING id
		`,
			userID, trackID, carID,
			meta.LapNumber, meta.LapTimeMs,
			meta.S1Ms, meta.S2Ms, meta.S3Ms,
			meta.IsValid, meta.SampleRateHz, recordedAt,
		).Scan(&lapID)
		if err != nil {
			http.Error(w, "db error (lap)", http.StatusInternalServerError)
			return
		}

		// 4. Upload telemetry blob to Supabase Storage.
		storagePath := fmt.Sprintf("telemetry/%s/%s.json.gz", userID, lapID)
		if err := store.Upload("telemetry", storagePath, body, "application/gzip"); err != nil {
			// Non-fatal: lap row exists, telemetry can be retried.
			// Update the lap row to mark telemetry as pending.
			_, _ = db.Exec(r.Context(), `UPDATE laps SET telemetry_url = NULL WHERE id = $1`, lapID)
			http.Error(w, "storage upload failed", http.StatusInternalServerError)
			return
		}

		// 5. Update lap row with the telemetry URL.
		_, err = db.Exec(r.Context(),
			`UPDATE laps SET telemetry_url = $1 WHERE id = $2`,
			storagePath, lapID,
		)
		if err != nil {
			http.Error(w, "db error (telemetry_url update)", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{"lap_id": lapID})
	}
}
