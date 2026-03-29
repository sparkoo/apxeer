// Package middleware provides HTTP middleware for the API.
package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/lestrrat-go/jwx/v2/jwt"

	"github.com/sparkoo/apxeer/api/internal/auth"
	"github.com/sparkoo/apxeer/api/internal/db"
)

type contextKey int

const (
	clerkIDKey contextKey = iota
	userIDKey
)

// CORS adds permissive CORS headers and handles preflight OPTIONS requests.
func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "authorization, content-type, x-lap-metadata")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireAuth validates the Bearer JWT, provisions the user if needed, and
// injects the Clerk user ID and internal UUID into the request context.
// Returns 401 if the token is missing or invalid.
func RequireAuth(verifier *auth.Verifier, database *db.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			clerkID, err := extractClerkID(r, verifier)
			if err != nil {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			// Extract name/picture from JWT claims for lazy user provisioning.
			displayName, avatarURL := claimsFromToken(r, verifier)

			userID, err := database.EnsureUser(r.Context(), clerkID, displayName, avatarURL)
			if err != nil {
				fmt.Printf("[auth] EnsureUser failed for %s: %v\n", clerkID, err)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}

			ctx := context.WithValue(r.Context(), clerkIDKey, clerkID)
			ctx = context.WithValue(ctx, userIDKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ClerkIDFromCtx returns the Clerk user ID injected by RequireAuth.
func ClerkIDFromCtx(ctx context.Context) string {
	v, _ := ctx.Value(clerkIDKey).(string)
	return v
}

// UserIDFromCtx returns the internal UUID injected by RequireAuth.
func UserIDFromCtx(ctx context.Context) uuid.UUID {
	v, _ := ctx.Value(userIDKey).(uuid.UUID)
	return v
}

// extractClerkID pulls the Bearer token from the Authorization header and validates it.
func extractClerkID(r *http.Request, verifier *auth.Verifier) (string, error) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return "", fmt.Errorf("missing bearer token")
	}
	token := strings.TrimPrefix(header, "Bearer ")
	return verifier.Verify(token)
}

// claimsFromToken tries to extract name and picture from JWT standard claims.
// Returns empty strings if claims are absent — EnsureUser handles nulls gracefully.
func claimsFromToken(r *http.Request, verifier *auth.Verifier) (displayName, avatarURL string) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return
	}
	tokenStr := strings.TrimPrefix(header, "Bearer ")

	// Parse without validation (already validated above) just to read claims.
	tok, err := jwt.ParseInsecure([]byte(tokenStr))
	if err != nil {
		return
	}

	if v, ok := tok.Get("name"); ok {
		displayName, _ = v.(string)
	}
	if v, ok := tok.Get("picture"); ok {
		avatarURL, _ = v.(string)
	}
	return
}
