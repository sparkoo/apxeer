package api

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/apxeer/api/internal/storage"
)

type compareLapRow struct {
	ID           string  `json:"id"`
	UserID       string  `json:"user_id"`
	TrackID      string  `json:"track_id"`
	CarID        string  `json:"car_id"`
	LapNumber    int     `json:"lap_number"`
	LapTimeMs    int     `json:"lap_time_ms"`
	S1Ms         *int    `json:"s1_ms"`
	S2Ms         *int    `json:"s2_ms"`
	S3Ms         *int    `json:"s3_ms"`
	IsValid      bool    `json:"is_valid"`
	SampleRateHz int     `json:"sample_rate_hz"`
	RecordedAt   string  `json:"recorded_at"`
	TelemetryURL *string `json:"telemetry_url"`
	TrackName    string  `json:"track_name"`
	CarName      string  `json:"car_name"`
	CarClass     string  `json:"car_class"`
	Username     *string `json:"username"`
}

type telemetrySample struct {
	T        float64 `json:"t"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Z        float64 `json:"z"`
	Speed    float64 `json:"speed"`
	Gear     int     `json:"gear"`
	RPM      float64 `json:"rpm"`
	Throttle float64 `json:"throttle"`
	Brake    float64 `json:"brake"`
	Steering float64 `json:"steering"`
	Clutch   float64 `json:"clutch"`
}

type lapFile struct {
	Samples []telemetrySample `json:"samples"`
}

type compareResponse struct {
	LapA    compareLapRow     `json:"lap_a"`
	LapB    compareLapRow     `json:"lap_b"`
	SamplesA []telemetrySample `json:"samples_a"`
	SamplesB []telemetrySample `json:"samples_b"`
}

// Compare handles GET /api/compare?lap_a=:id&lap_b=:id
func Compare(db *pgxpool.Pool, store *storage.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		lapAID := r.URL.Query().Get("lap_a")
		lapBID := r.URL.Query().Get("lap_b")
		if lapAID == "" || lapBID == "" {
			http.Error(w, "lap_a and lap_b are required", http.StatusBadRequest)
			return
		}

		lapA, err := fetchLap(r, db, lapAID)
		if err != nil {
			http.Error(w, fmt.Sprintf("lap_a: %v", err), http.StatusNotFound)
			return
		}
		lapB, err := fetchLap(r, db, lapBID)
		if err != nil {
			http.Error(w, fmt.Sprintf("lap_b: %v", err), http.StatusNotFound)
			return
		}

		samplesA, err := fetchSamples(lapA, store)
		if err != nil {
			http.Error(w, fmt.Sprintf("samples_a: %v", err), http.StatusInternalServerError)
			return
		}
		samplesB, err := fetchSamples(lapB, store)
		if err != nil {
			http.Error(w, fmt.Sprintf("samples_b: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(compareResponse{
			LapA:     lapA,
			LapB:     lapB,
			SamplesA: samplesA,
			SamplesB: samplesB,
		})
	}
}

func fetchLap(r *http.Request, db *pgxpool.Pool, id string) (compareLapRow, error) {
	var lap compareLapRow
	err := db.QueryRow(r.Context(), `
		SELECT
			l.id, l.user_id, l.track_id, l.car_id, l.lap_number, l.lap_time_ms,
			l.s1_ms, l.s2_ms, l.s3_ms, l.is_valid, l.sample_rate_hz,
			l.recorded_at::text, l.telemetry_url,
			t.name, c.name, c.class,
			u.username
		FROM laps l
		JOIN tracks t ON t.id = l.track_id
		JOIN cars   c ON c.id = l.car_id
		LEFT JOIN users u ON u.id = l.user_id
		WHERE l.id = $1
	`, id).Scan(
		&lap.ID, &lap.UserID, &lap.TrackID, &lap.CarID,
		&lap.LapNumber, &lap.LapTimeMs,
		&lap.S1Ms, &lap.S2Ms, &lap.S3Ms,
		&lap.IsValid, &lap.SampleRateHz, &lap.RecordedAt, &lap.TelemetryURL,
		&lap.TrackName, &lap.CarName, &lap.CarClass, &lap.Username,
	)
	return lap, err
}

func fetchSamples(lap compareLapRow, store *storage.Client) ([]telemetrySample, error) {
	if lap.TelemetryURL == nil {
		return []telemetrySample{}, nil
	}

	data, err := store.Download(*lap.TelemetryURL)
	if err != nil {
		return nil, fmt.Errorf("download: %w", err)
	}

	gz, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("gzip: %w", err)
	}
	defer gz.Close()

	var f lapFile
	if err := json.NewDecoder(gz).Decode(&f); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	return f.Samples, nil
}
