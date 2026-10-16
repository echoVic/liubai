package main

import (
	"context"
	"errors"
	"io"
	"log"
	"time"

	"github.com/egoist/mygo"
)

var diskChanged = mygo.NewEvent[string]("liubai:disk-changed")

type documentFileWatch interface {
	Next(context.Context) ([]mygo.FileEvent, error)
	Close() error
	Done() <-chan struct{}
}

// A single owner retargets the manager. stop joins the Next loop before
// another watch starts, so a late batch cannot notify the previous document.
type fileWatchManager struct {
	start   func(context.Context, string) (documentFileWatch, error)
	changed func(string)
	id      string
	path    string
	watch   documentFileWatch
	cancel  context.CancelFunc
	done    chan struct{}
}

func (m *fileWatchManager) stop() {
	if m.watch == nil {
		return
	}
	m.cancel()
	_ = m.watch.Close()
	<-m.done
	<-m.watch.Done()
	m.watch, m.cancel, m.done = nil, nil, nil
	m.id, m.path = "", ""
}

func (m *fileWatchManager) retarget(ctx context.Context, id, path string) error {
	if m.watch != nil && m.id == id && m.path == path {
		select {
		case <-m.done:
			// A stopped stream (e.g. a removed parent directory) can be retried.
		default:
			return nil
		}
	}
	m.stop()
	if path == "" {
		return nil
	}
	life, cancel := context.WithCancel(ctx)
	w, err := m.start(life, path)
	if err != nil {
		cancel()
		return err
	}
	done := make(chan struct{})
	m.id, m.path, m.watch, m.cancel, m.done = id, path, w, cancel, done
	go func() {
		defer close(done)
		defer w.Close()
		for {
			events, err := w.Next(life)
			if err != nil {
				if life.Err() == nil && !errors.Is(err, io.EOF) {
					log.Printf("监听文稿失败：%v", err)
				}
				return
			}
			if life.Err() != nil {
				return
			}
			if len(events) != 0 {
				m.changed(id)
			}
		}
	}()
	return nil
}

func watchDocument(ctx context.Context, path string) (documentFileWatch, error) {
	return mygo.WatchFiles(ctx, path, mygo.FileWatchOptions{Debounce: 100 * time.Millisecond})
}
