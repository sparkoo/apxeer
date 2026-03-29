package handlers

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/sparkoo/apxeer/api/internal/db"
	"github.com/sparkoo/apxeer/api/internal/middleware"
)

type UserHandler struct {
	DB *db.DB
}

// Me handles GET /api/me — returns the authenticated user's internal profile.
// This is how the web frontend gets its internal UUID after signing in via Clerk.
func (h *UserHandler) Me(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserIDFromCtx(r.Context())
	user, err := h.DB.GetUserByID(r.Context(), userID)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	writeJSON(w, user)
}

// Get handles GET /api/users/:id — public user profile by internal UUID.
func (h *UserHandler) Get(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	user, err := h.DB.GetUserByID(r.Context(), id)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	writeJSON(w, user)
}

// Laps handles GET /api/users/:id/laps — all laps for a user.
func (h *UserHandler) Laps(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	userID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	trackID := r.URL.Query().Get("track_id")
	carID := r.URL.Query().Get("car_id")

	query := lapSelect + ` WHERE l.user_id = $1`
	args := []any{userID}

	if trackID != "" {
		args = append(args, trackID)
		query += ` AND l.track_id = $` + itoa(len(args))
	}
	if carID != "" {
		args = append(args, carID)
		query += ` AND l.car_id = $` + itoa(len(args))
	}
	query += ` ORDER BY l.recorded_at DESC LIMIT 500`

	rows, err := h.DB.Pool.Query(r.Context(), query, args...)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	writeJSON(w, scanLaps(w, rows))
}

// Sessions handles GET /api/users/:id/sessions — sessions where user has a result.
func (h *UserHandler) Sessions(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	userID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	rows, err := h.DB.Pool.Query(r.Context(), `
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
		WHERE sr.user_id = $1
		ORDER BY s.started_at DESC
		LIMIT 50
	`, userID)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type myResult struct {
		FinishPos     int     `json:"finish_pos"`
		ClassPos      int     `json:"class_pos"`
		BestLapMs     *int    `json:"best_lap_ms"`
		LapsCompleted int     `json:"laps_completed"`
		FinishStatus  *string `json:"finish_status"`
		CarName       string  `json:"car_name"`
		CarClass      string  `json:"car_class"`
	}
	type track struct {
		ID      string  `json:"id"`
		Name    string  `json:"name"`
		LengthM float64 `json:"length_m"`
	}
	type userSession struct {
		ID          string    `json:"id"`
		TrackID     string    `json:"track_id"`
		SessionType string    `json:"session_type"`
		EventName   *string   `json:"event_name"`
		StartedAt   time.Time `json:"started_at"`
		DurationMin int       `json:"duration_min"`
		Track       track     `json:"track"`
		MyResult    myResult  `json:"my_result"`
	}

	result := []userSession{}
	for rows.Next() {
		var s userSession
		var trackName string
		var lengthM float64
		var mr myResult
		if err := rows.Scan(
			&s.ID, &s.TrackID, &s.SessionType, &s.EventName,
			&s.StartedAt, &s.DurationMin,
			&trackName, &lengthM,
			&mr.FinishPos, &mr.ClassPos, &mr.BestLapMs,
			&mr.LapsCompleted, &mr.FinishStatus,
			&mr.CarName, &mr.CarClass,
		); err != nil {
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}
		s.Track = track{ID: s.TrackID, Name: trackName, LengthM: lengthM}
		s.MyResult = mr
		result = append(result, s)
	}
	writeJSON(w, result)
}

func itoa(n int) string {
	return string(rune('0' + n))
}
