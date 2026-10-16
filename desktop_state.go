package main

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/i18n"
)

const editedGrace = 1500 * time.Millisecond

type editedIndicator struct {
	pending bool
	since   time.Time
}

func (s *editedIndicator) setPending(now time.Time, pending bool) {
	if pending && !s.pending {
		s.since = now
	}
	s.pending = pending
}

func (s editedIndicator) decision(now time.Time, conflict, failed bool) (bool, time.Duration) {
	if conflict || failed {
		return true, 0
	}
	if !s.pending {
		return false, 0
	}
	if delay := s.since.Add(editedGrace).Sub(now); delay > 0 {
		return false, delay
	}
	return true, 0
}

// Created only after the -web branch returns. The worker starts in WhenReady,
// and owns every watch/window update; no native calls run under these locks.
type desktopIntegration struct {
	w      *Workspace
	ctx    context.Context
	cancel context.CancelFunc
	wake   chan struct{}
	mu     sync.Mutex
	edited editedIndicator
	failed map[string]bool
	recent []string
}

func newDesktopIntegration(w *Workspace) *desktopIntegration {
	ctx, cancel := context.WithCancel(context.Background())
	return &desktopIntegration{w: w, ctx: ctx, cancel: cancel, wake: make(chan struct{}, 1), failed: map[string]bool{}}
}

func (n *desktopIntegration) signal() {
	select {
	case n.wake <- struct{}{}:
	default:
	}
}

func (d *Desktop) syncNative(recentPath string) {
	if d.native == nil {
		return
	}
	if recentPath != "" {
		d.native.mu.Lock()
		d.native.recent = append(d.native.recent, recentPath)
		d.native.mu.Unlock()
	}
	d.native.signal()
}

func (d *Desktop) savedNative(id string, err error) {
	if d.native == nil {
		return
	}
	d.native.mu.Lock()
	if err != nil {
		d.native.failed[id] = true
	} else {
		delete(d.native.failed, id)
	}
	d.native.mu.Unlock()
	d.native.signal()
}

func (d *Desktop) currentResult(state WorkspaceState, err error, recent bool) (WorkspaceState, error) {
	path := ""
	if err == nil && recent {
		path = state.Current.Path
	}
	d.syncNative(path)
	return valueIn(state, i18n.Locale()).(WorkspaceState), err
}

func (n *desktopIntegration) run(win *mygo.Window) {
	watch := fileWatchManager{start: watchDocument, changed: func(id string) { _ = diskChanged.Broadcast(id) }}
	defer watch.stop()
	var timer *time.Timer
	var due <-chan time.Time
	defer func() {
		if timer != nil {
			timer.Stop()
		}
	}()
	lastID, lastPath := "", ""
	n.signal()
	for {
		select {
		case <-n.ctx.Done():
			return
		case <-n.wake:
		case <-due:
		}
		if n.ctx.Err() != nil {
			return
		}
		// Read the latest document rather than a queued snapshot: simultaneous
		// Finder, sidebar, and save actions must not restore an obsolete watch.
		n.w.mu.Lock()
		doc := *n.w.docs[n.w.current]
		n.w.mu.Unlock()
		n.mu.Lock()
		edited, delay := n.edited.decision(time.Now(), doc.Conflict, n.failed[doc.ID] || doc.saveFailed())
		recent := n.recent
		n.recent = nil
		n.mu.Unlock()
		if timer != nil {
			timer.Stop()
		}
		due = nil
		if delay > 0 {
			if timer == nil {
				timer = time.NewTimer(delay)
			} else {
				timer.Reset(delay)
			}
			due = timer.C
		}
		if err := watch.retarget(n.ctx, doc.ID, doc.Path); err != nil {
			log.Printf("无法监听文稿：%v", err) // i18n-ignore: diagnostic log, not interface text
		}
		if doc.ID != lastID || doc.Path != lastPath {
			win.SetRepresentedFile(doc.Path)
			lastID, lastPath = doc.ID, doc.Path
		}
		win.SetDocumentEdited(edited)
		for _, path := range recent {
			if err := mygo.App.AddRecentDocument(path); err != nil {
				log.Printf("无法记录最近文稿：%v", err) // i18n-ignore: diagnostic log, not interface text
			}
		}
	}
}
