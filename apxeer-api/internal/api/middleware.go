package api

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const userIDKey contextKey = "userID"

// ── JWKS cache ────────────────────────────────────────────────────────────────

type jwksCache struct {
	mu   sync.RWMutex
	keys map[string]*ecdsa.PublicKey // kid → key
}

var globalJWKS = &jwksCache{}

func (c *jwksCache) get(kid string) (*ecdsa.PublicKey, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	k, ok := c.keys[kid]
	return k, ok
}

func (c *jwksCache) load(jwksURL string) error {
	resp, err := http.Get(jwksURL) //nolint:noctx
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var body struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			Crv string `json:"crv"`
			X   string `json:"x"`
			Y   string `json:"y"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return err
	}

	keys := make(map[string]*ecdsa.PublicKey, len(body.Keys))
	for _, k := range body.Keys {
		if k.Kty != "EC" {
			continue
		}
		xBytes, err := base64.RawURLEncoding.DecodeString(k.X)
		if err != nil {
			continue
		}
		yBytes, err := base64.RawURLEncoding.DecodeString(k.Y)
		if err != nil {
			continue
		}
		curve := curveForCrv(k.Crv)
		if curve == nil {
			continue
		}
		keys[k.Kid] = &ecdsa.PublicKey{
			Curve: curve,
			X:     new(big.Int).SetBytes(xBytes),
			Y:     new(big.Int).SetBytes(yBytes),
		}
	}

	c.mu.Lock()
	c.keys = keys
	c.mu.Unlock()
	return nil
}

func curveForCrv(crv string) elliptic.Curve {
	switch crv {
	case "P-256":
		return elliptic.P256()
	default:
		return nil
	}
}

// ── RequireAuth ───────────────────────────────────────────────────────────────

// RequireAuth validates the Supabase JWT and injects the user ID into context.
// Supports both ES256 (current Supabase user JWTs, validated via JWKS) and
// HS256 (legacy, validated with SUPABASE_JWT_SECRET).
// In development, DEV_TOKEN bypasses all validation.
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			http.Error(w, "missing token", http.StatusUnauthorized)
			return
		}
		tokenStr := strings.TrimPrefix(header, "Bearer ")

		// Dev bypass.
		if devToken := os.Getenv("DEV_TOKEN"); devToken != "" && tokenStr == devToken {
			ctx := context.WithValue(r.Context(), userIDKey, "00000000-0000-0000-0000-000000000001")
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		token, err := jwt.Parse(tokenStr, keyFunc)
		if err != nil || !token.Valid {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			http.Error(w, "invalid claims", http.StatusUnauthorized)
			return
		}
		userID, _ := claims["sub"].(string)
		if userID == "" {
			http.Error(w, "missing sub claim", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), userIDKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func keyFunc(t *jwt.Token) (interface{}, error) {
	switch t.Method.(type) {
	case *jwt.SigningMethodECDSA:
		// ES256: look up the key by kid from the JWKS cache.
		kid, _ := t.Header["kid"].(string)
		if key, ok := globalJWKS.get(kid); ok {
			return key, nil
		}
		// Cache miss — try to fetch JWKS once.
		jwksURL := os.Getenv("SUPABASE_JWKS_URL")
		if jwksURL == "" {
			supabaseURL := os.Getenv("SUPABASE_URL")
			if supabaseURL != "" {
				jwksURL = strings.TrimRight(supabaseURL, "/") + "/auth/v1/.well-known/jwks.json"
			}
		}
		if jwksURL == "" {
			return nil, fmt.Errorf("SUPABASE_URL not set, cannot validate ES256 token")
		}
		if err := globalJWKS.load(jwksURL); err != nil {
			return nil, fmt.Errorf("failed to fetch JWKS: %w", err)
		}
		if key, ok := globalJWKS.get(kid); ok {
			return key, nil
		}
		return nil, fmt.Errorf("unknown kid: %s", kid)

	case *jwt.SigningMethodHMAC:
		// HS256: legacy path.
		secret := os.Getenv("SUPABASE_JWT_SECRET")
		return []byte(secret), nil

	default:
		return nil, jwt.ErrSignatureInvalid
	}
}

func UserIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(userIDKey).(string)
	return id
}
