// cmd/seed/main.go — inserts two test laps with fake telemetry into the local DB.
// Run from WSL: go run -buildvcs=false ./cmd/seed
package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/apxeer/api/internal/storage"
)

// ── Telemetry types (must match handler_compare.go) ─────────────────────────

type sample struct {
	T        float64 `json:"t"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Z        float64 `json:"z"`
	Speed    float64 `json:"speed"`
	Gear     int     `json:"gear"`
	RPM      float64 `json:"rpm"`
	Throttle float64 `json:"throttle"`
	Brake    float64 `json:"brake"`
	Steering float64 `json:"steering"`
	Clutch   float64 `json:"clutch"`
}

type lapFile struct {
	Samples []sample `json:"samples"`
}

// ── Circuit definition ───────────────────────────────────────────────────────
// A simplified circuit defined as (angle, radius, targetSpeed) waypoints.
// We interpolate between waypoints to build a smooth path.

type segment struct {
	length      float64 // arc length in metres
	curvature   float64 // 1/radius (0 = straight)
	targetSpeed float64 // km/h
}

var circuit = []segment{
	// Start/finish straight
	{length: 600, curvature: 0, targetSpeed: 240},
	// Tight right hairpin
	{length: 150, curvature: 1.0 / 40, targetSpeed: 70},
	// Short straight
	{length: 200, curvature: 0, targetSpeed: 180},
	// Medium right
	{length: 120, curvature: 1.0 / 80, targetSpeed: 120},
	// Fast left sweeper
	{length: 300, curvature: -1.0 / 150, targetSpeed: 200},
	// Chicane left
	{length: 80, curvature: -1.0 / 50, targetSpeed: 100},
	// Chicane right
	{length: 80, curvature: 1.0 / 50, targetSpeed: 100},
	// Back straight
	{length: 500, curvature: 0, targetSpeed: 230},
	// Final complex — slow right
	{length: 130, curvature: 1.0 / 60, targetSpeed: 90},
	// Fast right onto straight
	{length: 200, curvature: 1.0 / 120, targetSpeed: 160},
}

// generateLap builds a lap's worth of telemetry samples.
// speedFactor scales overall speed (use slightly different values for lap A vs B).
func generateLap(speedFactor float64) []sample {
	const hz = 20
	const dt = 1.0 / hz
	const maxAccel = 12.0  // m/s² longitudinal
	const maxBrake = 20.0  // m/s² braking
	const gearRatios = 8   // max gear

	// Build list of (distAlongTrack, targetSpeed) pairs from circuit segments.
	type speedNode struct {
		dist  float64
		speed float64 // m/s
	}
	var nodes []speedNode
	d := 0.0
	for _, seg := range circuit {
		nodes = append(nodes, speedNode{d, seg.targetSpeed * speedFactor / 3.6})
		d += seg.length
	}
	trackLen := d

	// Interpolate target speed at any distance.
	targetSpeedAt := func(dist float64) float64 {
		dist = math.Mod(dist, trackLen)
		for i := 1; i < len(nodes); i++ {
			if dist <= nodes[i].dist {
				t := (dist - nodes[i-1].dist) / (nodes[i].dist - nodes[i-1].dist)
				return nodes[i-1].speed + t*(nodes[i].speed-nodes[i-1].speed)
			}
		}
		return nodes[0].speed
	}

	// Build world XZ coordinates by integrating heading.
	type point struct{ x, z, heading float64 }
	pointAt := func(dist float64) point {
		dist = math.Mod(dist, trackLen)
		x, z, heading := 0.0, 0.0, 0.0
		segStart := 0.0
		for _, seg := range circuit {
			segEnd := segStart + seg.length
			if dist <= segEnd {
				traveled := dist - segStart
				if seg.curvature == 0 {
					x += traveled * math.Sin(heading)
					z += traveled * math.Cos(heading)
				} else {
					r := 1.0 / seg.curvature
					dAngle := traveled * seg.curvature
					x += r * (math.Cos(heading) - math.Cos(heading+dAngle)) * math.Copysign(1, seg.curvature)
					z += r * (math.Sin(heading+dAngle) - math.Sin(heading)) * math.Abs(1/seg.curvature) * math.Copysign(1, seg.curvature)
					heading += dAngle
				}
				return point{x, z, heading}
			}
			// Advance through full segment
			if seg.curvature == 0 {
				x += seg.length * math.Sin(heading)
				z += seg.length * math.Cos(heading)
			} else {
				heading += seg.length * seg.curvature
			}
			segStart = segEnd
		}
		return point{x, z, heading}
	}

	// Simulate lap
	var samples []sample
	speed := targetSpeedAt(0) // m/s
	lapTime := 0.0
	distTraveled := 0.0

	for distTraveled < trackLen {
		target := targetSpeedAt(distTraveled)
		lookahead := math.Min(distTraveled+speed*1.5, trackLen-1)
		brakeTarget := targetSpeedAt(lookahead)

		var throttle, brake float64
		var accel float64

		if speed < brakeTarget-1 {
			// Accelerate
			accel = maxAccel
			throttle = math.Min(1.0, accel/maxAccel)
			brake = 0
		} else if speed > target+2 {
			// Brake
			accel = -maxBrake
			brake = math.Min(1.0, -accel/maxBrake)
			throttle = 0
		} else {
			// Cruise
			accel = (target - speed) * 2
			if accel > 0 {
				throttle = math.Min(1.0, accel/maxAccel)
				brake = 0
			} else {
				brake = math.Min(0.3, -accel/maxBrake)
				throttle = 0
			}
		}

		speed += accel * dt
		speed = math.Max(20/3.6, speed)

		distTraveled += speed * dt
		lapTime += dt

		p := pointAt(distTraveled)

		gear := int(math.Ceil(speed/(250.0/3.6/float64(gearRatios))*float64(gearRatios)))
		gear = max(1, min(gearRatios, gear))
		rpm := 1000 + float64(gear)*700 + speed*15

		// Steering: proportional to curvature at current position
		steering := 0.0
		cumDist := 0.0
		for _, seg := range circuit {
			segEnd := cumDist + seg.length
			pos := math.Mod(distTraveled, trackLen)
			if pos >= cumDist && pos < segEnd {
				steering = seg.curvature * 30
				break
			}
			cumDist = segEnd
		}
		steering = math.Max(-1, math.Min(1, steering))

		samples = append(samples, sample{
			T:        lapTime,
			X:        p.x,
			Y:        0,
			Z:        p.z,
			Speed:    speed * 3.6,
			Gear:     gear,
			RPM:      rpm,
			Throttle: throttle,
			Brake:    brake,
			Steering: steering,
			Clutch:   0,
		})
	}

	return samples
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// compressLap serialises samples to JSON and gzip-compresses them.
func compressLap(samples []sample) ([]byte, error) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if err := json.NewEncoder(gz).Encode(lapFile{Samples: samples}); err != nil {
		return nil, err
	}
	if err := gz.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ── Main ─────────────────────────────────────────────────────────────────────

func main() {
	_ = godotenv.Load()

	ctx := context.Background()

	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	store := storage.NewClient()

	// Fixed dev user from 001_local.sql
	const devUserID = "00000000-0000-0000-0000-000000000001"

	// Upsert track
	var trackID string
	err = pool.QueryRow(ctx, `
		INSERT INTO tracks (id, name, length_m)
		VALUES (gen_random_uuid(), $1, $2)
		ON CONFLICT (name) DO UPDATE SET length_m = EXCLUDED.length_m
		RETURNING id
	`, "Spa-Francorchamps", 7004).Scan(&trackID)
	if err != nil {
		log.Fatalf("upsert track: %v", err)
	}
	log.Printf("track: %s", trackID)

	// Upsert car
	var carID string
	err = pool.QueryRow(ctx, `
		INSERT INTO cars (id, name, class)
		VALUES (gen_random_uuid(), $1, $2)
		ON CONFLICT (name, class) DO UPDATE SET name = EXCLUDED.name
		RETURNING id
	`, "Porsche 911 GT3 R", "GT3").Scan(&carID)
	if err != nil {
		log.Fatalf("upsert car: %v", err)
	}
	log.Printf("car: %s", carID)

	// Generate two laps — lap B is slightly slower
	type lapDef struct {
		speedFactor float64
		lapNumber   int
		s1Ms        int
		s2Ms        int
		s3Ms        int
	}
	laps := []lapDef{
		{speedFactor: 1.00, lapNumber: 5, s1Ms: 42310, s2Ms: 51780, s3Ms: 29200},
		{speedFactor: 0.97, lapNumber: 3, s1Ms: 43580, s2Ms: 53410, s3Ms: 30110},
	}

	for i, ld := range laps {
		samples := generateLap(ld.speedFactor)
		lapTimeMs := samples[len(samples)-1].T * 1000

		gz, err := compressLap(samples)
		if err != nil {
			log.Fatalf("compress lap %d: %v", i, err)
		}

		// Insert lap row
		var lapID string
		err = pool.QueryRow(ctx, `
			INSERT INTO laps
				(id, user_id, track_id, car_id, lap_number, lap_time_ms,
				 s1_ms, s2_ms, s3_ms, is_valid, sample_rate_hz, recorded_at)
			VALUES
				(gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, true, 20, now())
			RETURNING id
		`,
			devUserID, trackID, carID,
			ld.lapNumber, int(lapTimeMs),
			ld.s1Ms, ld.s2Ms, ld.s3Ms,
		).Scan(&lapID)
		if err != nil {
			log.Fatalf("insert lap %d: %v", i, err)
		}

		// Upload telemetry
		storagePath := fmt.Sprintf("telemetry/%s/%s.json.gz", devUserID, lapID)
		if err := store.Upload("telemetry", storagePath, gz, "application/gzip"); err != nil {
			log.Fatalf("upload lap %d: %v", i, err)
		}

		// Update telemetry_url
		_, err = pool.Exec(ctx,
			`UPDATE laps SET telemetry_url = $1 WHERE id = $2`,
			storagePath, lapID,
		)
		if err != nil {
			log.Fatalf("update telemetry_url %d: %v", i, err)
		}

		log.Printf("lap %d: id=%s  time=%.3fs  samples=%d  gz=%dKB",
			i+1, lapID, lapTimeMs/1000, len(samples), len(gz)/1024)
	}

	log.Println("Seed complete. Use the lap IDs above in the compare page.")
}
