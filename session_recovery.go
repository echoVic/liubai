package main

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"liubai/locales"
)

// RecoveryDelta uses the editor's UTF-16 coordinates, relative to the previous
// accepted snapshot. Full snapshots seed/reseed a stream; neither path writes
// an original file or performs disk IO on each keystroke.
type RecoveryDelta struct {
	From   int    `json:"from"`
	To     int    `json:"to"`
	Insert string `json:"insert"`
}
type RecoveryUpdate struct {
	Version   int             `json:"version"`
	ID        string          `json:"id"`
	Sequence  uint64          `json:"sequence"`
	Previous  uint64          `json:"previous"`
	Content   *string         `json:"content,omitempty"`
	Changes   []RecoveryDelta `json:"changes,omitempty"`
	Position  Position        `json:"position"`
	Composing bool            `json:"composing"`
}
type stagedRecovery struct {
	sequence  uint64
	content   string
	position  Position
	composing bool
	length    int
}

func recoveryLength(content string) int {
	length := 0
	for _, r := range content {
		length += utf16.RuneLen(r)
	}
	return length
}

// Translate ordered editor coordinates once and splice UTF-8 slices once.
// Position-only packets reuse the cached body and length without scanning it.
func applyRecoveryChanges(old stagedRecovery, changes []RecoveryDelta) (string, int, error) {
	if len(changes) == 0 {
		return old.content, old.length, nil
	}
	previous := 0
	length := old.length
	offsets := make([]int, 0, len(changes)*2)
	for _, change := range changes {
		if change.From < previous || change.To < change.From || change.To > old.length || !utf8.ValidString(change.Insert) {
			return "", 0, errors.New("invalid recovery delta")
		}
		offsets = append(offsets, change.From, change.To)
		previous = change.To
		length += recoveryLength(change.Insert) - (change.To - change.From)
	}
	indices := make([]int, len(offsets))
	next, unit := 0, 0
	for byteIndex, r := range old.content {
		for next < len(offsets) && offsets[next] == unit {
			indices[next] = byteIndex
			next++
		}
		if next == len(offsets) {
			break
		}
		unit += utf16.RuneLen(r)
		if offsets[next] < unit {
			return "", 0, errors.New("recovery delta splits a surrogate pair")
		}
	}
	for next < len(offsets) && offsets[next] == old.length {
		indices[next] = len(old.content)
		next++
	}
	if next != len(offsets) {
		return "", 0, errors.New("invalid recovery coordinate")
	}
	var result strings.Builder
	bytes := len(old.content)
	for i, change := range changes {
		bytes += len(change.Insert) - (indices[i*2+1] - indices[i*2])
	}
	if bytes > maxDocument {
		return "", 0, errors.New("invalid recovery content")
	}
	result.Grow(bytes)
	previous = 0
	for i, change := range changes {
		result.WriteString(old.content[previous:indices[i*2]])
		result.WriteString(change.Insert)
		previous = indices[i*2+1]
	}
	result.WriteString(old.content[previous:])
	return result.String(), length, nil
}

func (w *Workspace) stageRecovery(update RecoveryUpdate) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if update.Version != 1 || update.Sequence == 0 || w.docs[update.ID] == nil {
		return errors.New("invalid recovery stream")
	}
	if w.recovery == nil {
		w.recovery = map[string]stagedRecovery{}
	}
	old := w.recovery[update.ID]
	if update.Sequence <= old.sequence {
		return nil
	}
	content := ""
	length := 0
	if update.Content != nil {
		content = *update.Content
		length = recoveryLength(content)
	} else {
		if old.sequence == 0 || update.Previous != old.sequence {
			return errors.New("recovery stream needs a full snapshot")
		}
		var err error
		content, length, err = applyRecoveryChanges(old, update.Changes)
		if err != nil {
			return err
		}
	}
	if len(content) > maxDocument || update.Content != nil && !utf8.ValidString(content) {
		return errors.New("invalid recovery content")
	}
	if len(w.recovery) >= 8 && old.sequence == 0 {
		for id, snapshot := range w.recovery {
			if doc := w.docs[id]; doc == nil || doc.Content == snapshot.content {
				delete(w.recovery, id)
				break
			}
		}
		if len(w.recovery) >= 8 {
			return errors.New("too many recovery streams")
		}
	}
	w.recovery[update.ID] = stagedRecovery{sequence: update.Sequence, content: content, position: clampPositionLength(length, update.Position), composing: update.Composing, length: length}
	return nil
}

// flushRecovery runs synchronously before system quit closes the WebView. A
// distinct draft protects both a newer backend edit and any external file.
func (w *Workspace) flushRecovery() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	var failures []error
	ids := make([]string, 0, len(w.recovery))
	for id := range w.recovery {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		snapshot := w.recovery[id]
		doc := w.docs[id]
		if doc == nil {
			delete(w.recovery, id)
			continue
		}
		if doc.Content == snapshot.content {
			doc.Position = snapshot.position
			w.positions[id] = snapshot.position
			w.positionsDirty = true
			delete(w.recovery, id)
			continue
		}
		found := false
		for _, candidate := range w.docs {
			if candidate.RecoverySourceID == id && candidate.RecoverySourceHash == digest([]byte(snapshot.content)) && candidate.RecoveryContentHash == digest([]byte(candidate.Content)) {
				found = true
				break
			}
		}
		if found {
			delete(w.recovery, id)
			continue
		}
		copy := *doc
		copy.RecoverySourceID = id
		copy.RecoverySourceHash = digest([]byte(snapshot.content))
		copy.ID, copy.Path, copy.Content = uid(), "", snapshot.content
		copy.Position = snapshot.position
		copy.Title = doc.Title + locales.BRecoverySuffix()
		if snapshot.composing {
			copy.Title += " (IME)"
			copy.CustomTitle = true
			copy.GeneratedTitleSuffix = ""
		} else {
			copy.GeneratedTitleSuffix = "recovery"
		}
		copy.DiskHash, copy.DiskContentHash = "", ""
		copy.recordDiskInfo(nil)
		copy.Conflict = false
		copy.Updated = time.Now().UnixMilli()
		copy.setStatus("draftSaved")
		assetSource := *doc
		assetSource.Content = snapshot.content
		if err := w.copyAssets(&assetSource, &copy); err != nil {
			failures = append(failures, err)
			continue
		}
		copy.RecoveryContentHash = digest([]byte(copy.Content))
		if err := w.persist(&copy); err != nil {
			failures = append(failures, fmt.Errorf("recovery %s: %w", id, err))
			continue
		}
		w.docs[copy.ID] = &copy
		delete(w.recovery, id)
	}
	for _, doc := range w.docs {
		if err := w.persist(doc); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(append(failures, w.flushPositions(), w.saveIndex())...)
}
