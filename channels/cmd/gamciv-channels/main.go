// gamciv-chains: standalone runner for the picoclaw channel service.
//
// Starts the copied picoclaw MessageBus + channel manager (telegram +
// whatsapp, verbatim upstream code) and exposes a small HTTP API so the
// Deno backend can send outbound messages through the same bus:
//
//	GET  /health  -> {"status":"ok", ...} (manager health summary)
//	POST /send    -> {"channel","to","content"} -> bus -> channel send
//
// Configuration comes from env vars (all optional unless noted):
//
//	TELEGRAM_BOT_TOKEN   telegram bot token (required to enable telegram)
//	TELEGRAM_ALLOW_FROM  comma-separated allowlist of telegram user ids
//	WHATSAPP_BRIDGE_URL  websocket URL of the GOWA bridge (required for whatsapp)
//	WHATSAPP_ALLOW_FROM  comma-separated allowlist of whatsapp senders
//	CHANNELS_HTTP_ADDR   listen address for /health and /send (default 127.0.0.1:8811)
//	CHANNELS_CONFIG      optional path to a picoclaw-style config.json
//
// When CHANNELS_CONFIG is set it is loaded with the upstream loader and any
// enabled channels there are started in addition to the env-derived ones.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/channels"
	_ "github.com/sipeed/picoclaw/pkg/channels/telegram"
	_ "github.com/sipeed/picoclaw/pkg/channels/whatsapp"
	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/media"
)

const defaultAddr = "127.0.0.1:8811"

// sendRequest is the body of POST /send.
type sendRequest struct {
	Channel string `json:"channel"`
	To      string `json:"to"`
	Content string `json:"content"`
}

// sendResponse is the reply of POST /send.
type sendResponse struct {
	Status  string   `json:"status"`
	Message []string `json:"message_ids,omitempty"`
	Error   string   `json:"error,omitempty"`
}

func main() {
	logger.SetLevelFromString(envOr("CHANNELS_LOG_LEVEL", "info"))

	// Split a single allowlist env var into entries.
	splitList := func(v string) []string {
		parts := strings.Split(v, ",")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			if p = strings.TrimSpace(p); p != "" {
				out = append(out, p)
			}
		}
		return out
	}

	cfg := config.DefaultConfig()

	// Build channels from env. Both env channels live under fixed names so
	// the manager treats them as the singleton telegram/whatsapp instances.
	if token := strings.TrimSpace(os.Getenv("TELEGRAM_BOT_TOKEN")); token != "" {
		tg := &config.Channel{
			Enabled:   true,
			Type:      config.ChannelTelegram,
			AllowFrom: config.FlexibleStringSlice(splitList(os.Getenv("TELEGRAM_ALLOW_FROM"))),
		}
		tg.Settings = config.RawNode(mustJSON(map[string]any{"token": token}))
		cfg.Channels["telegram"] = tg
	}
	if bridge := strings.TrimSpace(os.Getenv("WHATSAPP_BRIDGE_URL")); bridge != "" {
		wa := &config.Channel{
			Enabled:   true,
			Type:      config.ChannelWhatsApp,
			AllowFrom: config.FlexibleStringSlice(splitList(os.Getenv("WHATSAPP_ALLOW_FROM"))),
		}
		wa.Settings = config.RawNode(mustJSON(map[string]any{"bridge_url": bridge}))
		cfg.Channels["whatsapp"] = wa
	}

	// Optional full config file on top (upstream format, version 3).
	if path := strings.TrimSpace(os.Getenv("CHANNELS_CONFIG")); path != "" {
		fileCfg, err := config.LoadConfig(path)
		if err != nil {
			logger.FatalCF("gamciv-channels", "failed to load CHANNELS_CONFIG", map[string]any{
				"path":  path,
				"error": err.Error(),
			})
		}
		for name, bc := range fileCfg.Channels {
			if bc != nil && bc.Enabled {
				cfg.Channels[name] = bc
			}
		}
	}

	if len(cfg.Channels) == 0 {
		logger.FatalC("gamciv-channels", "no channels configured: set TELEGRAM_BOT_TOKEN and/or WHATSAPP_BRIDGE_URL (or CHANNELS_CONFIG)")
	}

	if err := config.InitChannelList(cfg.Channels); err != nil {
		logger.FatalCF("gamciv-channels", "invalid channel configuration", map[string]any{"error": err.Error()})
	}

	messageBus := bus.NewMessageBus()
	defer messageBus.Close()

	store := media.NewFileMediaStore()

	mgr, err := channels.NewManager(cfg, messageBus, store)
	if err != nil {
		logger.FatalCF("gamciv-channels", "failed to create channel manager", map[string]any{"error": err.Error()})
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	addr := envOr("CHANNELS_HTTP_ADDR", defaultAddr)

	mux := http.NewServeMux()
	registerHandlers(mux, mgr, messageBus)

	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		logger.FatalCF("gamciv-channels", "cannot bind HTTP listener", map[string]any{"addr": addr, "error": err.Error()})
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	if err := mgr.StartAll(ctx); err != nil {
		logger.FatalCF("gamciv-channels", "failed to start channels", map[string]any{"error": err.Error()})
	}

	logger.InfoCF("gamciv-channels", "gamciv-channels listening", map[string]any{
		"addr":     addr,
		"channels": mgr.GetEnabledChannels(),
	})

	if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
		logger.FatalCF("gamciv-channels", "HTTP server error", map[string]any{"error": err.Error()})
	}

	stopCtx, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer stopCancel()
	_ = mgr.StopAll(stopCtx)
}

// registerHandlers wires /health and /send. Exported for tests.
func registerHandlers(mux *http.ServeMux, mgr *channels.Manager, messageBus *bus.MessageBus) {
	// enabledChannelNames safely lists the manager's channels; nil-safe for tests.
	enabledChannelNames := func() []string {
		if mgr == nil {
			return []string{}
		}
		return mgr.GetEnabledChannels()
	}

	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ok, msg := messageBus.HealthCheck()
		resp := map[string]any{
			"status":   "ok",
			"channels": enabledChannelNames(),
			"bus":      msg,
		}
		if !ok {
			resp["status"] = "degraded"
		}
		_ = json.NewEncoder(w).Encode(resp)
	})

	mux.HandleFunc("/send", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			writeJSON(w, sendResponse{Status: "error", Error: "method not allowed, use POST"}, http.StatusMethodNotAllowed)
			return
		}

		var req sendRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
			writeJSON(w, sendResponse{Status: "error", Error: "invalid JSON body"}, http.StatusBadRequest)
			return
		}
		req.Channel = strings.TrimSpace(req.Channel)
		req.To = strings.TrimSpace(req.To)
		if req.Channel == "" || req.To == "" || req.Content == "" {
			writeJSON(w, sendResponse{Status: "error", Error: "channel, to and content are required"}, http.StatusBadRequest)
			return
		}

		msg := bus.OutboundMessage{
			Channel: req.Channel,
			ChatID:  req.To,
			Content: req.Content,
		}
		if err := messageBus.PublishOutbound(r.Context(), msg); err != nil {
			writeJSON(w, sendResponse{Status: "error", Error: err.Error()}, http.StatusBadGateway)
			return
		}
		// The manager drains the bus asynchronously (rate limiting, retries);
		// acceptance here means the message is queued for delivery.
		writeJSON(w, sendResponse{Status: "queued"}, http.StatusAccepted)
	})
}

func writeJSON(w http.ResponseWriter, v any, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func mustJSON(v map[string]any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		// Unreachable for map[string]any of plain values.
		panic(fmt.Sprintf("marshal channel settings: %v", err))
	}
	return b
}
