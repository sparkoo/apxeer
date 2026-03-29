// Package auth validates Clerk JWTs using the JWKS endpoint.
package auth

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/lestrrat-go/jwx/v2/jwk"
	"github.com/lestrrat-go/jwx/v2/jwt"
)

// Verifier fetches Clerk's public keys and validates JWTs.
type Verifier struct {
	jwksURL string
	cache   jwk.Set
	mu      sync.RWMutex
}

// NewVerifier creates a Verifier and does an initial JWKS fetch.
func NewVerifier(jwksURL string) (*Verifier, error) {
	v := &Verifier{jwksURL: jwksURL}
	if err := v.refresh(); err != nil {
		return nil, fmt.Errorf("initial JWKS fetch: %w", err)
	}
	go v.autoRefresh()
	return v, nil
}

// Verify parses and validates a raw JWT string, returning the Clerk user ID (sub claim).
func (v *Verifier) Verify(tokenStr string) (string, error) {
	v.mu.RLock()
	ks := v.cache
	v.mu.RUnlock()

	tok, err := jwt.Parse([]byte(tokenStr),
		jwt.WithKeySet(ks),
		jwt.WithValidate(true),
	)
	if err != nil {
		return "", fmt.Errorf("JWT validation failed: %w", err)
	}

	clerkID := tok.Subject()
	if clerkID == "" {
		return "", fmt.Errorf("JWT has no sub claim")
	}
	return clerkID, nil
}

func (v *Verifier) refresh() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	ks, err := jwk.Fetch(ctx, v.jwksURL)
	if err != nil {
		return err
	}

	v.mu.Lock()
	v.cache = ks
	v.mu.Unlock()
	return nil
}

func (v *Verifier) autoRefresh() {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		if err := v.refresh(); err != nil {
			fmt.Printf("[auth] JWKS refresh failed: %v\n", err)
		}
	}
}
