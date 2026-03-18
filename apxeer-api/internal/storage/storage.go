package storage

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// Client is a thin wrapper around Supabase Storage REST API.
// When LOCAL_STORAGE_DIR is set it uses the local filesystem instead,
// which is useful for local development without a real Supabase instance.
type Client struct {
	localDir   string // set when LOCAL_STORAGE_DIR is configured
	baseURL    string // e.g. https://<project>.supabase.co/storage/v1
	serviceKey string // service_role key for server-side uploads
	httpClient *http.Client
}

func NewClient() *Client {
	return &Client{
		localDir:   os.Getenv("LOCAL_STORAGE_DIR"),
		baseURL:    os.Getenv("SUPABASE_URL") + "/storage/v1",
		serviceKey: os.Getenv("SUPABASE_SERVICE_KEY"),
		httpClient: &http.Client{},
	}
}

// Upload writes data to object at path in the given bucket.
// Creates or overwrites the object.
func (c *Client) Upload(bucket, path string, data []byte, contentType string) error {
	if c.localDir != "" {
		dest := filepath.Join(c.localDir, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			return err
		}
		return os.WriteFile(dest, data, 0644)
	}

	url := fmt.Sprintf("%s/object/%s/%s", c.baseURL, bucket, path)

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("x-upsert", "true") // overwrite if exists

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("storage upload failed (%d): %s", resp.StatusCode, body)
	}
	return nil
}

// Download fetches a stored object by its path and returns the raw bytes.
// path should include the bucket prefix, e.g. "telemetry/<user>/<lap>.json.gz"
func (c *Client) Download(path string) ([]byte, error) {
	if c.localDir != "" {
		src := filepath.Join(c.localDir, filepath.FromSlash(path))
		return os.ReadFile(src)
	}

	url := fmt.Sprintf("%s/object/%s", c.baseURL, path)

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("storage download failed (%d): %s", resp.StatusCode, body)
	}
	return io.ReadAll(resp.Body)
}
