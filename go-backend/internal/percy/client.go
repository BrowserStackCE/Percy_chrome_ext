package percy

import (
	"encoding/json"
	"net/http"
	"bytes"
	"io"
	"fmt"
	"time"

	"github.com/jostan30/Percy_chrome_ext/go-backend/internal/snapshot"
)

type Client struct {
	baseURL string
	client *http.Client
}

func NewClient() *Client {
	return &Client{
		baseURL : "http://localhost:5338",
		client: &http.Client{},
	}
}

func (c *Client) Health() (*HealthResponse ,error) {
	resp ,err := c.client.Get(c.baseURL + "/percy/healthcheck")
	if err != nil {
		return nil ,err
	}
	defer resp.Body.Close()

	var health HealthResponse

	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		return nil, err
	}

	return &health ,nil
}

// WaitIdle blocks until Percy reports all queued snapshots are processed,
// the done channel closes (process died), or the timeout elapses.
func (c *Client) WaitIdle(timeout time.Duration, done <-chan struct{}) error {
	deadline := time.Now().Add(timeout)
	httpc := &http.Client{Timeout: 2 * time.Minute}

	for {
		select {
		case <-done:
			return fmt.Errorf("percy exited while waiting for snapshots")
		default:
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out waiting for Percy to finish snapshots")
		}

		resp, err := httpc.Get(c.baseURL + "/percy/idle")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func toSnapshotRequest(s snapshot.Snapshot) SnapshotRequest {
	return SnapshotRequest{
		Name:        s.Name,
		URL:         s.URL,
		DomSnapshot: s.DOM,

		Widths:    s.Widths,
		MinHeight: s.MinHeight,

		EnableJavaScript: s.EnableJavaScript,

		PercyCSS: s.PercyCSS,
		Scope:    s.Scope,
	}
}


func (c *Client) Snapshot(s snapshot.Snapshot) error {

	body := toSnapshotRequest(s)

	data, err := json.Marshal(body)
	if err != nil {
		return err
	}

	resp, err := c.client.Post(
		c.baseURL+"/percy/snapshot",
		"application/json",
		bytes.NewBuffer(data),
	)

	if err != nil {
		return err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		response, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("percy returned %d: %s", resp.StatusCode, string(response))
	}

	return nil
}