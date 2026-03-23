package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type StatsResponse struct {
	TotalLaps    int     `json:"total_laps"`
	TotalDrivers int     `json:"total_drivers"`
	TotalKm      float64 `json:"total_km"`
}

// GetStats handles GET /api/stats (public).
// Returns community-wide aggregate stats.
func GetStats(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var stats StatsResponse
		err := db.QueryRow(r.Context(), `
			SELECT
				(SELECT COUNT(*) FROM laps) AS total_laps,
				(SELECT COUNT(DISTINCT user_id) FROM laps) AS total_drivers,
				COALESCE(
					(SELECT SUM(t.length_m) FROM laps l JOIN tracks t ON t.id = l.track_id WHERE t.length_m > 0),
					0
				) / 1000.0 AS total_km
		`).Scan(&stats.TotalLaps, &stats.TotalDrivers, &stats.TotalKm)
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(stats)
	}
}

type TrackRecord struct {
	LapID      string  `json:"lap_id"`
	TrackID    string  `json:"track_id"`
	TrackName  string  `json:"track_name"`
	CarName    string  `json:"car_name"`
	CarClass   string  `json:"car_class"`
	LapTimeMs  int     `json:"lap_time_ms"`
	Username   *string `json:"username"`
	RecordedAt string  `json:"recorded_at"`
}

// ListTrackRecords handles GET /api/tracks/records (public).
// Returns the fastest lap per track.
func ListTrackRecords(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.Query(r.Context(), `
			SELECT DISTINCT ON (l.track_id)
				l.id, l.lap_time_ms, l.recorded_at,
				t.id AS track_id, t.name AS track_name,
				c.name AS car_name, c.class AS car_class,
				u.username
			FROM laps l
			JOIN tracks t ON t.id = l.track_id
			JOIN cars c ON c.id = l.car_id
			LEFT JOIN users u ON u.id = l.user_id
			WHERE l.is_valid = true
			ORDER BY l.track_id, l.lap_time_ms ASC
		`)
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		records := []TrackRecord{}
		for rows.Next() {
			var rec TrackRecord
			var recordedAt time.Time
			if err := rows.Scan(
				&rec.LapID, &rec.LapTimeMs, &recordedAt,
				&rec.TrackID, &rec.TrackName,
				&rec.CarName, &rec.CarClass,
				&rec.Username,
			); err != nil {
				http.Error(w, "db scan error", http.StatusInternalServerError)
				return
			}
			rec.RecordedAt = recordedAt.Format(time.RFC3339)
			records = append(records, rec)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(records)
	}
}
