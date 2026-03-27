# Apxeer – local development

WEB_DIR  := apxeer-web
DESK_DIR := apxeer-desktop

.PHONY: help install web desktop api api-stop db-reset db-reset

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
	@echo "  api          Start local Supabase (Postgres + Edge Functions)"
	@echo "  api-stop     Stop local Supabase"
	@echo ""
	@echo "Database"
	@echo "  db-reset     Apply migrations from supabase/migrations/ to local DB"

# ── Setup ─────────────────────────────────────────────────────────────────────

install:
	cd $(WEB_DIR) && npm install

# ── Web ───────────────────────────────────────────────────────────────────────

web:
	cd $(WEB_DIR) && npm run dev

# ── Desktop (Windows only) ────────────────────────────────────────────────────

desktop:
	cd $(DESK_DIR) && cargo tauri dev

# ── API (Supabase) ────────────────────────────────────────────────────────────

api:
	supabase start

api-stop:
	supabase stop

db-reset:
	supabase db reset
