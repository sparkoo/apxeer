# Apxeer – local development

WEB_DIR  := apxeer-web
DESK_DIR := apxeer-desktop

.PHONY: help install web desktop api db-migrate

# ── Help ──────────────────────────────────────────────────────────────────────

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "Setup"
	@echo "  install      Install web frontend dependencies"
	@echo ""
	@echo "Run"
	@echo "  web          Start Vite dev server (port 3000)"
	@echo "  desktop      Start Tauri desktop app (Windows only)"
	@echo "  api          Start Go API on port 8080"
	@echo ""
	@echo "Database"
	@echo "  db-migrate   Apply migrations to local Postgres (requires golang-migrate)"

# ── Setup ─────────────────────────────────────────────────────────────────────

install:
	cd $(WEB_DIR) && npm install

# ── Web ───────────────────────────────────────────────────────────────────────

web:
	cd $(WEB_DIR) && npm run dev

# ── Desktop (Windows only) ────────────────────────────────────────────────────

desktop:
	cd $(DESK_DIR) && cargo tauri dev

# ── API (Go) ──────────────────────────────────────────────────────────────────

api:
	cd api && go run ./cmd/api/

# ── Database ──────────────────────────────────────────────────────────────────

db-migrate:
	migrate -path api/migrations -database "postgres://postgres:postgres@localhost:5432/apxeer?sslmode=disable" up
