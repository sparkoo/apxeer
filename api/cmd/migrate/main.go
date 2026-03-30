package main

import (
	"log"
	"os"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	// golang-migrate's pgx/v5 driver requires the pgx5:// scheme
	dbURL = strings.Replace(dbURL, "postgresql://", "pgx5://", 1)
	dbURL = strings.Replace(dbURL, "postgres://", "pgx5://", 1)

	m, err := migrate.New("file://migrations", dbURL)
	if err != nil {
		log.Fatalf("migrate init: %v", err)
	}
	defer m.Close()

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		log.Fatalf("migrate up: %v", err)
	}

	log.Println("migrations applied")
}
