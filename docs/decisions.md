# Design Decisions

## Telemetry storage: MessagePack files, not DB rows

Telemetry samples are stored as MessagePack files in Supabase Storage (`telemetry/{user_id}/{lap_id}.msgpack`), not as database rows. The `laps.telemetry_url` column references the file.

**Why:** A single lap at 20Hz contains thousands of samples. Storing them as rows would bloat the DB and make queries slow. Binary files are cheaper, faster to read, and simpler to serve.

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

---

## Hosting: Fly.io (not GCP/Firestore)

API and web frontend are hosted on Fly.io.

**Why:** Avoid vendor lock-in. Previous stack used GCP/Firestore.
