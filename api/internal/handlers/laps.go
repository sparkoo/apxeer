package handlers

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sparkoo/apxeer/api/internal/db"
	"github.com/sparkoo/apxeer/api/internal/middleware"
	"github.com/sparkoo/apxeer/api/internal/storage"
)

type LapHandler struct {
	DB      *db.DB
	Storage *storage.Client
}

// lapSelect is the standard SELECT fragment reused across lap queries.
const lapSelect = `
	SELECT l.id, l.user_id, l.track_id, l.car_id,
	       l.lap_number, l.lap_time_ms, l.s1_ms, l.s2_ms, l.s3_ms,
	       l.is_valid, l.sample_rate_hz, l.recorded_at, l.telemetry_url,
	       t.name AS track_name, c.name AS car_name, c.class AS car_class,
	       u.username
	FROM laps l
	JOIN tracks t ON t.id = l.track_id
	JOIN cars   c ON c.id = l.car_id
	LEFT JOIN users u ON u.id = l.user_id`

type lapRow struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	TrackID      string    `json:"track_id"`
	CarID        string    `json:"car_id"`
	LapNumber    int       `json:"lap_number"`
	LapTimeMs    int       `json:"lap_time_ms"`
	S1Ms         *int      `json:"s1_ms"`
	S2Ms         *int      `json:"s2_ms"`
	S3Ms         *int      `json:"s3_ms"`
	IsValid      bool      `json:"is_valid"`
	SampleRateHz int       `json:"sample_rate_hz"`
	RecordedAt   time.Time `json:"recorded_at"`
	TelemetryURL *string   `json:"telemetry_url"`
	TrackName    string    `json:"track_name"`
	CarName      string    `json:"car_name"`
	CarClass     string    `json:"car_class"`
	Username     *string   `json:"username"`
}

func scanLaps(w http.ResponseWriter, rows pgx.Rows) []lapRow {
	result := []lapRow{}
	for rows.Next() {
		var row lapRow
		if err := rows.Scan(
			&row.ID, &row.UserID, &row.TrackID, &row.CarID,
			&row.LapNumber, &row.LapTimeMs, &row.S1Ms, &row.S2Ms, &row.S3Ms,
			&row.IsValid, &row.SampleRateHz, &row.RecordedAt, &row.TelemetryURL,
			&row.TrackName, &row.CarName, &row.CarClass, &row.Username,
		); err != nil {
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return nil
		}
		result = append(result, row)
	}
	return result
}

// List handles GET /api/laps
func (h *LapHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	trackID := r.URL.Query().Get("track_id")

	query := lapSelect
	var args []any

	switch {
	case userID != "" && trackID != "":
		query += ` WHERE l.user_id = $1 AND l.track_id = $2`
		args = []any{userID, trackID}
	case userID != "":
		query += ` WHERE l.user_id = $1`
		args = []any{userID}
	case trackID != "":
		query += ` WHERE l.track_id = $1`
		args = []any{trackID}
	}
	query += ` ORDER BY l.recorded_at DESC LIMIT 100`

	rows, err := h.DB.Pool.Query(r.Context(), query, args...)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	writeJSON(w, scanLaps(w, rows))
}

// Get handles GET /api/laps/:id
func (h *LapHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rows, err := h.DB.Pool.Query(r.Context(), lapSelect+` WHERE l.id = $1`, id)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	laps := scanLaps(w, rows)
	if len(laps) == 0 {
		http.Error(w, "lap not found", http.StatusNotFound)
		return
	}
	writeJSON(w, laps[0])
}

// Create handles POST /api/laps — telemetry upload from the desktop app.
// Body: gzip-compressed telemetry JSON (max 10 MB)
// Header: X-Lap-Metadata — base64-encoded JSON with lap metadata
func (h *LapHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserIDFromCtx(r.Context())
	clerkID := middleware.ClerkIDFromCtx(r.Context())

	// Read gzip body (max 10 MB)
	body, err := io.ReadAll(io.LimitReader(r.Body, 10*1024*1024+1))
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}
	if len(body) > 10*1024*1024 {
		http.Error(w, "body too large", http.StatusRequestEntityTooLarge)
		return
	}

	// Parse X-Lap-Metadata header (base64-encoded JSON)
	metaB64 := r.Header.Get("X-Lap-Metadata")
	if metaB64 == "" {
		http.Error(w, "missing X-Lap-Metadata header", http.StatusBadRequest)
		return
	}
	metaJSON, err := base64.StdEncoding.DecodeString(metaB64)
	if err != nil {
		http.Error(w, "invalid X-Lap-Metadata encoding", http.StatusBadRequest)
		return
	}

	var meta struct {
		IsValid      bool    `json:"is_valid"`
		TrackName    string  `json:"track_name"`
		CarName      string  `json:"car_name"`
		CarClass     string  `json:"car_class"`
		LapNumber    int     `json:"lap_number"`
		LapTimeMs    int     `json:"lap_time_ms"`
		S1Ms         *int    `json:"s1_ms"`
		S2Ms         *int    `json:"s2_ms"`
		S3Ms         *int    `json:"s3_ms"`
		SampleRateHz int     `json:"sample_rate_hz"`
		RecordedAt   string  `json:"recorded_at"`
	}
	if err := json.Unmarshal(metaJSON, &meta); err != nil {
		http.Error(w, "invalid X-Lap-Metadata JSON", http.StatusBadRequest)
		return
	}

	// Silently discard invalid laps (track limits, etc.)
	if !meta.IsValid {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	recordedAt, err := time.Parse(time.RFC3339Nano, meta.RecordedAt)
	if err != nil {
		http.Error(w, "invalid recorded_at timestamp", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	pool := h.DB.Pool

	// Upsert track — targets the partial index tracks_name_null_layout
	// (layout is not available from desktop telemetry, so we insert with layout = NULL).
	var trackID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO tracks (id, name, length_m)
		VALUES (gen_random_uuid(), $1, 0)
		ON CONFLICT (name) WHERE layout IS NULL DO UPDATE SET name = EXCLUDED.name
		RETURNING id
	`, meta.TrackName).Scan(&trackID); err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// Upsert car
	var carID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO cars (id, name, class)
		VALUES (gen_random_uuid(), $1, $2)
		ON CONFLICT (name, class) DO UPDATE SET name = EXCLUDED.name
		RETURNING id
	`, meta.CarName, meta.CarClass).Scan(&carID); err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// Insert lap row
	lapID := uuid.New()
	if _, err := pool.Exec(ctx, `
		INSERT INTO laps
			(id, user_id, track_id, car_id, lap_number, lap_time_ms,
			 s1_ms, s2_ms, s3_ms, is_valid, sample_rate_hz, recorded_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, lapID, userID, trackID, carID,
		meta.LapNumber, meta.LapTimeMs,
		meta.S1Ms, meta.S2Ms, meta.S3Ms,
		meta.IsValid, meta.SampleRateHz, recordedAt,
	); err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// Upload gzip telemetry to R2
	storageKey := fmt.Sprintf("telemetry/%s/%s.json.gz", clerkID, lapID)
	if err := h.Storage.Upload(ctx, storageKey, bytes.NewReader(body), "application/gzip"); err != nil {
		fmt.Printf("[laps] R2 upload failed for lap %s: %v\n", lapID, err)
		http.Error(w, "storage upload failed", http.StatusInternalServerError)
		return
	}

	// Update lap with telemetry_url
	if _, err := pool.Exec(ctx,
		`UPDATE laps SET telemetry_url = $1 WHERE id = $2`,
		storageKey, lapID,
	); err != nil {
		fmt.Printf("[laps] Failed to update telemetry_url for lap %s: %v\n", lapID, err)
	}

	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]string{"lap_id": lapID.String()})
}

// Compare handles GET /api/compare?lap_a=:id&lap_b=:id
func (h *LapHandler) Compare(w http.ResponseWriter, r *http.Request) {
	lapAID := r.URL.Query().Get("lap_a")
	lapBID := r.URL.Query().Get("lap_b")
	if lapAID == "" || lapBID == "" {
		http.Error(w, "lap_a and lap_b are required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	fetchLap := func(id string) (*lapRow, error) {
		rows, err := h.DB.Pool.Query(ctx, lapSelect+` WHERE l.id = $1`, id)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		laps := scanLaps(w, rows)
		if len(laps) == 0 {
			return nil, fmt.Errorf("not found")
		}
		return &laps[0], nil
	}

	lapA, err := fetchLap(lapAID)
	if err != nil {
		http.Error(w, "lap_a not found", http.StatusNotFound)
		return
	}
	lapB, err := fetchLap(lapBID)
	if err != nil {
		http.Error(w, "lap_b not found", http.StatusNotFound)
		return
	}

	fetchSamples := func(lap *lapRow) []any {
		if lap.TelemetryURL == nil || *lap.TelemetryURL == "" {
			return []any{}
		}
		rc, err := h.Storage.Download(ctx, *lap.TelemetryURL)
		if err != nil {
			fmt.Printf("[compare] R2 download failed for %s: %v\n", *lap.TelemetryURL, err)
			return []any{}
		}
		defer rc.Close()

		gz, err := gzip.NewReader(rc)
		if err != nil {
			return []any{}
		}
		defer gz.Close()

		var payload struct {
			Samples []any `json:"samples"`
		}
		if err := json.NewDecoder(gz).Decode(&payload); err != nil {
			return []any{}
		}
		return payload.Samples
	}

	samplesA := fetchSamples(lapA)
	samplesB := fetchSamples(lapB)

	writeJSON(w, map[string]any{
		"lap_a":     lapA,
		"lap_b":     lapB,
		"samples_a": samplesA,
		"samples_b": samplesB,
	})
}
