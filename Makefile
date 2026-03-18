# Apxeer – local development
#
# Works from both WSL and Windows (Git Bash / cmd).
# WSL targets (db, api, web, seed) run directly when already in WSL,
# or via `wsl -e bash -c` when invoked from a Windows terminal.
# Desktop target requires Windows — it will print an error if run from WSL.

# ── Environment detection ──────────────────────────────────────────────────────

# uname -r inside WSL contains "microsoft"; empty/different on Windows Git Bash
IN_WSL := $(shell uname -r 2>/dev/null | grep -ic microsoft)

# wsl(cmd) — runs cmd in WSL context regardless of where make was invoked
ifeq ($(IN_WSL),1)
  wsl = $(1)
else
  wsl = wsl -e bash -c "$(1)"
endif

API_DIR  := /mnt/c/Users/michal/dev/apxeer/apxeer-api
WEB_DIR  := /mnt/c/Users/michal/dev/apxeer/apxeer-web
DESK_DIR := apxeer-desktop

.PHONY: help db db-stop migrate api web desktop seed dev

# ── Help ──────────────────────────────────────────────────────────────────────

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  db          Start Postgres container (WSL/Podman)"
	@echo "  db-stop     Stop Postgres container"
	@echo "  migrate     Run migrations against local DB"
	@echo "  api         Start Go API (port 8080)"
	@echo "  web         Start Next.js dev server (port 3000)"
	@echo "  seed        Insert two test laps with fake telemetry"
	@echo "  desktop     Start Tauri desktop app (Windows only)"
	@echo "  dev         Start DB + API + web together"

# ── Database ──────────────────────────────────────────────────────────────────

db:
	$(call wsl, podman start apxeer-postgres 2>/dev/null || podman run -d \
		--name apxeer-postgres \
		-e POSTGRES_USER=apxeer \
		-e POSTGRES_PASSWORD=apxeer \
		-e POSTGRES_DB=apxeer \
		-p 5432:5432 \
		postgres:17-alpine)

db-stop:
	$(call wsl, podman stop apxeer-postgres)

migrate:
	$(call wsl, cd $(API_DIR) && psql $$DATABASE_URL -f migrations/001_local.sql)

# ── API ───────────────────────────────────────────────────────────────────────

api:
	$(call wsl, cd $(API_DIR) && go run -buildvcs=false .)

# ── Web ───────────────────────────────────────────────────────────────────────

web:
	$(call wsl, cd $(WEB_DIR) && npm run dev)

# ── Desktop (Windows only) ────────────────────────────────────────────────────

desktop:
ifeq ($(IN_WSL),1)
	@echo "Error: desktop app must be run from a Windows terminal (Git Bash or cmd)"
	@exit 1
else
	cd $(DESK_DIR) && cargo tauri dev
endif

# ── Seed ──────────────────────────────────────────────────────────────────────

seed:
	$(call wsl, cd $(API_DIR) && go run -buildvcs=false ./cmd/seed)

# ── Combined ──────────────────────────────────────────────────────────────────

dev: db
	@echo "Starting API in background, web in foreground..."
	$(call wsl, cd $(API_DIR) && go run -buildvcs=false . &)
	$(call wsl, cd $(WEB_DIR) && npm run dev)
