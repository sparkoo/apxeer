# Design Decisions

## Telemetry storage: gzip JSON files in Cloudflare R2, not DB rows

Telemetry samples are stored as gzip-compressed JSON files in Cloudflare R2 at `telemetry/{clerk_user_id}/{lap_id}.json.gz`, not as database rows. The `laps.telemetry_url` column stores the R2 object key.

**Why:** A single lap at 20Hz contains thousands of samples. Storing them as rows would bloat the DB and make queries slow. Binary files are cheaper, faster to read, and simpler to serve. R2 is chosen because the web frontend is already on Cloudflare and R2 shares the same account with no egress fees.

---

## Auth: Clerk instead of Supabase Auth

OAuth sign-in (Google, Discord, GitHub) is handled by Clerk. JWTs issued by Clerk are validated by the Go API using Clerk's JWKS endpoint.

**Why:** Supabase Auth is tightly coupled to the Supabase platform. Clerk is a dedicated auth provider with better developer experience, native app support (PKCE), and is independently deployable alongside any backend. It also decouples auth from the database provider.

**Schema implication:** The `users` table has a `clerk_id TEXT UNIQUE NOT NULL` column that maps Clerk user IDs (e.g. `user_2abc...`) to internal UUIDs. The API provisions users lazily on first authenticated request — no webhook required.

---

## Backend: Go on Railway instead of Supabase Edge Functions

The API is a standard Go HTTP server (chi router, pgx, AWS SDK for R2) deployed on Railway.

**Why:** Supabase Edge Functions (Deno) are tied to Supabase's infrastructure and have a limited execution model. A plain Go server is easier to develop locally (`go run`), easier to test, runs anywhere, and gives full control over connection pooling and dependencies. Railway provides simple container deployment with automatic deploys from git.

---

## Database: Neon instead of Supabase Postgres

Postgres is hosted on Neon for production; local dev uses a podman postgres container.

**Why:** Neon is a standalone serverless Postgres provider with branching support and no vendor lock-in. Local dev with a plain postgres container (`podman run postgres:16`) is simpler than running the Supabase CLI stack.

**Schema change:** RLS policies removed — authorization is enforced at the API layer in Go instead. This is simpler and more explicit than DB-level policies.

---

## Sample rate: 20Hz

The telemetry recorder samples at 20Hz (configurable, stored per lap).

**Why:** Sufficient resolution for lap comparison without excessive file sizes.

---

## Player car only

Telemetry records only the player's car, not opponents.

**Why:** Scope and complexity — opponent telemetry would require matching cars across sessions and significantly more storage.

---

## Local buffer before upload

Telemetry and results are written to local `.json.gz` files first, then uploaded. On success the local file is deleted.

**Why:** Decouples recording from network availability. Laps are never lost due to upload failures.

---

## Track map from position data

The track map SVG is generated from the XYZ position samples of the first recorded lap on that track.

**Why:** Avoids needing a separate track map asset pipeline or external data source.

---

## XML results parsed on desktop

LMU writes XML result files after each session. These are parsed on the desktop and uploaded to the API as JSON.

**Why:** The XML files are only available locally on the player's machine.
