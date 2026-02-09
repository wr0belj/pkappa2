package manager

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

const (
	discordWebhookTimeout = 10 * time.Second
	discordMaxEmbeds      = 10
)

type discordStreamInfo struct {
	ID          uint64
	Protocol    string
	ClientHost  string
	ClientPort  uint16
	ServerHost  string
	ServerPort  uint16
	ClientBytes uint64
	ServerBytes uint64
	FirstPacket time.Time
	LastPacket  time.Time
}

type discordEmbed struct {
	Title  string         `json:"title"`
	Fields []discordField `json:"fields"`
	Color  int            `json:"color,omitempty"`
}

type discordField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline"`
}

type discordWebhookPayload struct {
	Content string         `json:"content"`
	Embeds  []discordEmbed `json:"embeds"`
}

// checkDiscordNotification detects new stream matches for a tag and sends
// Discord notifications if the tag is monitored. Must be called from the jobs goroutine.
func (mgr *Manager) checkDiscordNotification(name string, t *tag) {
	if mgr.config.DiscordWebhookURL == "" {
		return
	}
	monitored := false
	for _, monitoredTag := range mgr.config.DiscordNotifyTags {
		if monitoredTag == name {
			monitored = true
			break
		}
	}
	if !monitored {
		return
	}
	prevNotified := mgr.discordNotifiedStreams[name]
	newMatches := t.Matches.Copy()
	newMatches.Sub(prevNotified)
	if newMatches.IsZero() {
		return
	}
	// Update notified set
	updated := prevNotified.Copy()
	updated.Or(t.Matches)
	mgr.discordNotifiedStreams[name] = updated
	// Collect stream details from indexes
	var streamInfos []discordStreamInfo
	var bit uint
	for newMatches.Next(&bit) {
		for _, idx := range mgr.indexes {
			s, err := idx.StreamByID(uint64(bit))
			if err != nil || s == nil {
				continue
			}
			streamInfos = append(streamInfos, discordStreamInfo{
				ID:          s.ID(),
				Protocol:    s.Protocol(),
				ClientHost:  s.ClientHostIP(),
				ClientPort:  s.ClientPort,
				ServerHost:  s.ServerHostIP(),
				ServerPort:  s.ServerPort,
				ClientBytes: s.ClientBytes,
				ServerBytes: s.ServerBytes,
				FirstPacket: s.FirstPacket(),
				LastPacket:  s.LastPacket(),
			})
			break
		}
		bit++
	}
	if len(streamInfos) > 0 {
		go sendDiscordNotification(mgr.config.DiscordWebhookURL, name, streamInfos)
	}
}

func sendDiscordNotification(webhookURL, tagName string, streams []discordStreamInfo) {
	// Batch into groups of discordMaxEmbeds
	for i := 0; i < len(streams); i += discordMaxEmbeds {
		end := i + discordMaxEmbeds
		if end > len(streams) {
			end = len(streams)
		}
		batch := streams[i:end]

		embeds := make([]discordEmbed, 0, len(batch))
		for _, s := range batch {
			embeds = append(embeds, discordEmbed{
				Title: fmt.Sprintf("Stream #%d", s.ID),
				Fields: []discordField{
					{Name: "Protocol", Value: s.Protocol, Inline: true},
					{Name: "Client", Value: fmt.Sprintf("%s:%d", s.ClientHost, s.ClientPort), Inline: true},
					{Name: "Server", Value: fmt.Sprintf("%s:%d", s.ServerHost, s.ServerPort), Inline: true},
					{Name: "Bytes", Value: fmt.Sprintf("C: %d / S: %d", s.ClientBytes, s.ServerBytes), Inline: true},
					{Name: "Time", Value: s.FirstPacket.Local().Format("15:04:05"), Inline: true},
				},
				Color: 0x5865F2, // Discord blurple
			})
		}

		payload := discordWebhookPayload{
			Content: fmt.Sprintf("Tag **%s** matched %d new stream(s)", tagName, len(streams)),
			Embeds:  embeds,
		}

		if err := postDiscordWebhook(webhookURL, payload); err != nil {
			log.Printf("discord webhook error for tag %q: %v", tagName, err)
		}
	}
}

func postDiscordWebhook(webhookURL string, payload discordWebhookPayload) error {
	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal discord payload: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), discordWebhookTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("failed to create discord webhook request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send discord webhook: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("discord webhook returned status %q", res.Status)
	}
	return nil
}
