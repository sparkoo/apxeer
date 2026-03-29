// Package db wraps a pgxpool connection and provides query helpers.
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DB holds the connection pool.
type DB struct {
	Pool *pgxpool.Pool
}

// Connect opens a pgxpool to the given DATABASE_URL.
func Connect(ctx context.Context, dbURL string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		return nil, fmt.Errorf("parse db url: %w", err)
	}
	cfg.MaxConns = 10
	cfg.MinConns = 1
	cfg.MaxConnLifetime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("open pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return &DB{Pool: pool}, nil
}

// User is the internal user record returned from the DB.
type User struct {
	ID          uuid.UUID  `json:"id"`
	ClerkID     string     `json:"clerk_id"`
	Username    *string    `json:"username"`
	DisplayName *string    `json:"display_name"`
	AvatarURL   *string    `json:"avatar_url"`
	Role        string     `json:"role"`
	CreatedAt   time.Time  `json:"created_at"`
}

// EnsureUser upserts a user row keyed by clerk_id and returns the internal UUID.
// display_name and avatar_url are updated only when the new value is non-empty.
func (db *DB) EnsureUser(ctx context.Context, clerkID, displayName, avatarURL string) (uuid.UUID, error) {
	var dn, av *string
	if displayName != "" {
		dn = &displayName
	}
	if avatarURL != "" {
		av = &avatarURL
	}

	var id uuid.UUID
	err := db.Pool.QueryRow(ctx, `
		INSERT INTO users (id, clerk_id, display_name, avatar_url, created_at)
		VALUES (gen_random_uuid(), $1, $2, $3, NOW())
		ON CONFLICT (clerk_id) DO UPDATE SET
			display_name = COALESCE(EXCLUDED.display_name, users.display_name),
			avatar_url   = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
		RETURNING id
	`, clerkID, dn, av).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("ensure user: %w", err)
	}
	return id, nil
}

// GetUserByID returns a user by internal UUID.
func (db *DB) GetUserByID(ctx context.Context, id uuid.UUID) (*User, error) {
	u := &User{}
	err := db.Pool.QueryRow(ctx, `
		SELECT id, clerk_id, username, display_name, avatar_url, role, created_at
		FROM users WHERE id = $1
	`, id).Scan(&u.ID, &u.ClerkID, &u.Username, &u.DisplayName, &u.AvatarURL, &u.Role, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}
