# Apxeer – local development

WEB_DIR  := apxeer-web
DESK_DIR := apxeer-desktop

.PHONY: help web desktop

# ── Help ──────────────────────────────────────────────────────────────────────

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  web         Start Vite dev server (port 3000)"
	@echo "  desktop     Start Tauri desktop app (Windows only)"

# ── Web ───────────────────────────────────────────────────────────────────────

web:
	cd $(WEB_DIR) && npm run dev

# ── Desktop (Windows only) ────────────────────────────────────────────────────

desktop:
	cd $(DESK_DIR) && cargo tauri dev
