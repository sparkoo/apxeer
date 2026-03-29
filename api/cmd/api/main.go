package main

import (
	"context"
	"fmt"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/joho/godotenv"

	"github.com/sparkoo/apxeer/api/internal/auth"
	"github.com/sparkoo/apxeer/api/internal/db"
	"github.com/sparkoo/apxeer/api/internal/handlers"
	"github.com/sparkoo/apxeer/api/internal/middleware"
	"github.com/sparkoo/apxeer/api/internal/storage"
)

func main() {
	// Load .env for local dev (ignored in production where env vars are set directly)
	_ = godotenv.Load()

	ctx := context.Background()

	// ── Database ──────────────────────────────────────────────────────────────
	dbURL := requireEnv("DATABASE_URL")
	database, err := db.Connect(ctx, dbURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "db connect: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("[startup] Connected to database")

	// ── Clerk JWT verifier ────────────────────────────────────────────────────
	jwksURL := requireEnv("CLERK_JWKS_URL")
	verifier, err := auth.NewVerifier(jwksURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "clerk verifier: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("[startup] Clerk JWKS loaded")

	// ── Cloudflare R2 storage ─────────────────────────────────────────────────
	r2 := storage.NewClient(
		requireEnv("R2_ACCOUNT_ID"),
		requireEnv("R2_ACCESS_KEY_ID"),
		requireEnv("R2_SECRET_ACCESS_KEY"),
		requireEnv("R2_BUCKET"),
	)
	fmt.Println("[startup] R2 client initialized")

	// ── Handlers ──────────────────────────────────────────────────────────────
	lapHandler := &handlers.LapHandler{DB: database, Storage: r2}
	sessionHandler := &handlers.SessionHandler{DB: database}
	userHandler := &handlers.UserHandler{DB: database}
	statsHandler := &handlers.StatsHandler{DB: database}

	requireAuth := middleware.RequireAuth(verifier, database)

	// ── Router ────────────────────────────────────────────────────────────────
	r := chi.NewRouter()
	r.Use(middleware.CORS)

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("ok"))
	})

	r.Get("/api/stats", statsHandler.Stats)
	r.Get("/api/tracks/records", statsHandler.TrackRecords)

	r.Get("/api/laps", lapHandler.List)
	r.Get("/api/laps/{id}", lapHandler.Get)
	r.Get("/api/compare", lapHandler.Compare)
	r.With(requireAuth).Post("/api/laps", lapHandler.Create)

	r.Get("/api/sessions", sessionHandler.List)
	r.Get("/api/sessions/{id}", sessionHandler.Get)
	r.With(requireAuth).Post("/api/sessions", sessionHandler.Create)

	r.With(requireAuth).Get("/api/me", userHandler.Me)
	r.Get("/api/users/{id}", userHandler.Get)
	r.Get("/api/users/{id}/laps", userHandler.Laps)
	r.Get("/api/users/{id}/sessions", userHandler.Sessions)

	// ── Serve ─────────────────────────────────────────────────────────────────
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	addr := ":" + port
	fmt.Printf("[startup] Listening on %s\n", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		fmt.Fprintf(os.Stderr, "server: %v\n", err)
		os.Exit(1)
	}
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		fmt.Fprintf(os.Stderr, "required env var %s is not set\n", key)
		os.Exit(1)
	}
	return v
}
