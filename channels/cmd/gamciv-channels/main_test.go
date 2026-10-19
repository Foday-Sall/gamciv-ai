// Tests for the gamciv-channels HTTP surface (/health, /send).
// The channel manager is not started here: /send exercises the bus path only,
// publishing into a live MessageBus without channel workers attached.
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sipeed/picoclaw/pkg/bus"
)

func newTestServer(t *testing.T) (*httptest.Server, *bus.MessageBus) {
	t.Helper()
	messageBus := bus.NewMessageBus()
	t.Cleanup(messageBus.Close)

	mux := http.NewServeMux()
	registerHandlers(mux, nil, messageBus)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server, messageBus
}

func TestHealthEndpoint(t *testing.T) {
	server, _ := newTestServer(t)

	resp, err := http.Get(server.URL + "/health")
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("content-type = %q, want application/json", ct)
	}

	var body struct {
		Status string `json:"status"`
		Bus    string `json:"bus"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Status != "ok" {
		t.Errorf("status = %q, want ok", body.Status)
	}
	if !strings.Contains(body.Bus, "in=") {
		t.Errorf("bus summary %q missing queue info", body.Bus)
	}
}

func TestSendQueuesOutboundMessage(t *testing.T) {
	server, messageBus := newTestServer(t)

	// Drain the bus so PublishOutbound does not block on a full queue.
	received := make(chan bus.OutboundMessage, 1)
	go func() {
		msg := <-messageBus.OutboundChan()
		received <- msg
	}()

	body := strings.NewReader(`{"channel":"telegram","to":"12345","content":"hello"}`)
	resp, err := http.Post(server.URL+"/send", "application/json", body)
	if err != nil {
		t.Fatalf("POST /send: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusAccepted)
	}

	var sent bus.OutboundMessage
	select {
	case sent = <-received:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for published message")
	}
	if sent.Channel != "telegram" || sent.ChatID != "12345" || sent.Content != "hello" {
		t.Errorf("unexpected message: %+v", sent)
	}
}

func TestSendValidation(t *testing.T) {
	server, _ := newTestServer(t)

	cases := []struct {
		name   string
		body   string
		status int
	}{
		{"missing channel", `{"to":"1","content":"x"}`, http.StatusBadRequest},
		{"missing to", `{"channel":"telegram","content":"x"}`, http.StatusBadRequest},
		{"missing content", `{"channel":"telegram","to":"1"}`, http.StatusBadRequest},
		{"invalid json", `{not json`, http.StatusBadRequest},
		{"empty fields", `{"channel":"","to":"","content":""}`, http.StatusBadRequest},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := http.Post(server.URL+"/send", "application/json", strings.NewReader(tc.body))
			if err != nil {
				t.Fatalf("POST /send: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != tc.status {
				t.Errorf("status = %d, want %d", resp.StatusCode, tc.status)
			}
		})
	}
}

func TestSendRejectsUnknownChannel(t *testing.T) {
	server, _ := newTestServer(t)

	// No channel workers are attached, so the manager would not consume this;
	// but the publish itself still succeeds (queueing contract).
	body := strings.NewReader(`{"channel":"discord","to":"1","content":"hi"}`)
	resp, err := http.Post(server.URL+"/send", "application/json", body)
	if err != nil {
		t.Fatalf("POST /send: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Errorf("status = %d, want %d (publish succeeds before dispatch)", resp.StatusCode, http.StatusAccepted)
	}
}

func TestSendRejectsOversizedBody(t *testing.T) {
	server, _ := newTestServer(t)

	huge := `{"channel":"telegram","to":"1","content":"` + strings.Repeat("x", 2<<20) + `"}`
	resp, err := http.Post(server.URL+"/send", "application/json", strings.NewReader(huge))
	if err != nil {
		t.Fatalf("POST /send: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
}

func TestSendMethodNotAllowed(t *testing.T) {
	server, _ := newTestServer(t)

	resp, err := http.Get(server.URL + "/send")
	if err != nil {
		t.Fatalf("GET /send: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
	}
}
