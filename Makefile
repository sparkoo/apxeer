# Apxeer – local development

API_DIR  := apxeer-api
WEB_DIR  := apxeer-web
DESK_DIR := apxeer-desktop

.PHONY: help db db-stop migrate api web desktop seed dev

# ── Help ──────────────────────────────────────────────────────────────────────

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  db          Start Postgres container (Podman)"
	@echo "  db-stop     Stop Postgres container"
	@echo "  migrate     Run migrations against local DB"
	@echo "  api         Start Go API (port 8080)"
	@echo "  web         Start Next.js dev server (port 3000)"
	@echo "  seed        Insert two test laps with fake telemetry"
	@echo "  desktop     Start Tauri desktop app (Windows only)"
	@echo "  dev         Start DB + API + web together"

# ── Database ──────────────────────────────────────────────────────────────────

db:
	podman start apxeer-postgres 2>/dev/null || podman run -d --replace \
		--name apxeer-postgres \
		-e POSTGRES_USER=apxeer \
		-e POSTGRES_PASSWORD=apxeer \
		-e POSTGRES_DB=apxeer \
		-p 5432:5432 \
		postgres:17-alpine

db-stop:
	podman stop apxeer-postgres

migrate:
	cd $(API_DIR) && psql $$DATABASE_URL -f migrations/001_local.sql

# ── API ───────────────────────────────────────────────────────────────────────

api:
	cd $(API_DIR) && go run -buildvcs=false .

# ── Web ───────────────────────────────────────────────────────────────────────

web:
	cd $(WEB_DIR) && npm run dev

# ── Desktop (Windows only) ────────────────────────────────────────────────────

desktop:
	cd $(DESK_DIR) && cargo tauri dev

# ── Seed ──────────────────────────────────────────────────────────────────────

seed:
	cd $(API_DIR) && go run -buildvcs=false ./cmd/seed

# ── Combined ──────────────────────────────────────────────────────────────────

dev: db
	@echo "Starting API in background, web in foreground..."
	cd $(API_DIR) && go run -buildvcs=false . &
	cd $(WEB_DIR) && npm run dev
