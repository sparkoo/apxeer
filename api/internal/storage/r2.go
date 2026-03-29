// Package storage wraps the Cloudflare R2 client (S3-compatible).
package storage

import (
	"context"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Client wraps an S3 client pointed at Cloudflare R2.
type Client struct {
	s3     *s3.Client
	bucket string
}

// NewClient creates an R2 client using S3-compatible credentials.
// endpoint: https://<account-id>.r2.cloudflarestorage.com
func NewClient(accountID, accessKeyID, secretAccessKey, bucket string) *Client {
	endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID)

	s3Client := s3.New(s3.Options{
		BaseEndpoint: aws.String(endpoint),
		Region:       "auto",
		Credentials:  credentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, ""),
	})

	return &Client{s3: s3Client, bucket: bucket}
}

// Upload streams body to R2 at the given object key.
func (c *Client) Upload(ctx context.Context, key string, body io.Reader, contentType string) error {
	_, err := c.s3.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(c.bucket),
		Key:         aws.String(key),
		Body:        body,
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return fmt.Errorf("r2 upload %s: %w", key, err)
	}
	return nil
}

// Download fetches an object from R2 and returns its body. Caller must close.
func (c *Client) Download(ctx context.Context, key string) (io.ReadCloser, error) {
	out, err := c.s3.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("r2 download %s: %w", key, err)
	}
	return out.Body, nil
}
