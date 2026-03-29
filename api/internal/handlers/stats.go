package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/sparkoo/apxeer/api/internal/db"
)

type StatsHandler struct {
	DB *db.DB
}

// Stats handles GET /api/stats — global community stats.
func (h *StatsHandler) Stats(w http.ResponseWriter, r *http.Request) {
	row := h.DB.Pool.QueryRow(r.Context(), `
		SELECT
			(SELECT COUNT(*)               FROM laps)::int                        AS total_laps,
			(SELECT COUNT(DISTINCT user_id) FROM laps)::int                       AS total_drivers,
			COALESCE(
				(SELECT SUM(t.length_m)
				 FROM laps l JOIN tracks t ON t.id = l.track_id
				 WHERE t.length_m > 0),
				0
			) / 1000.0                                                             AS total_km
	`)

	var result struct {
		TotalLaps     int     `json:"total_laps"`
		TotalDrivers  int     `json:"total_drivers"`
		TotalKm       float64 `json:"total_km"`
	}
	if err := row.Scan(&result.TotalLaps, &result.TotalDrivers, &result.TotalKm); err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, result)
}

// TrackRecords handles GET /api/tracks/records — best lap per track.
func (h *StatsHandler) TrackRecords(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Pool.Query(r.Context(), `
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
	`)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type record struct {
		LapID      string  `json:"lap_id"`
		LapTimeMs  int     `json:"lap_time_ms"`
		RecordedAt string  `json:"recorded_at"`
		TrackID    string  `json:"track_id"`
		TrackName  string  `json:"track_name"`
		CarName    string  `json:"car_name"`
		CarClass   string  `json:"car_class"`
		Username   *string `json:"username"`
	}

	result := []record{}
	for rows.Next() {
		var rec record
		if err := rows.Scan(
			&rec.LapID, &rec.LapTimeMs, &rec.RecordedAt,
			&rec.TrackID, &rec.TrackName,
			&rec.CarName, &rec.CarClass, &rec.Username,
		); err != nil {
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}
		result = append(result, rec)
	}
	writeJSON(w, result)
}

// writeJSON is a shared helper used by all handler files in this package.
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
	}
}
