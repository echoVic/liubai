package main

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

// WatchFiles needs a running native app. Substitute only that boundary;
// the manager's Next loop, cancellation, and callback delivery are real.
type testFileWatch struct {
	events chan []mygo.FileEvent
	done   chan struct{}
	once   sync.Once
}

func (w *testFileWatch) Next(ctx context.Context) ([]mygo.FileEvent, error) {
	select {
	case events := <-w.events:
		return events, nil
	case <-w.done:
		return nil, io.EOF
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
func (w *testFileWatch) Close() error {
	w.once.Do(func() { close(w.done) })
	return nil
}
func (w *testFileWatch) Done() <-chan struct{} { return w.done }

func receiveChange(t *testing.T, changes <-chan string, want string) {
	t.Helper()
	select {
	case got := <-changes:
		if got != want {
			t.Fatalf("changed document = %q, want %q", got, want)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for disk change")
	}
}

func TestFileWatchManagerRetargetsAndStopsForDrafts(t *testing.T) {
	changes := make(chan string, 10)
	watches := map[string]*testFileWatch{}
	var previous *testFileWatch
	m := fileWatchManager{
		start: func(_ context.Context, path string) (documentFileWatch, error) {
			if previous != nil {
				select {
				case <-previous.done:
				default:
					t.Error("started next watch before closing previous watch")
				}
			}
			w := &testFileWatch{events: make(chan []mygo.FileEvent, 4), done: make(chan struct{})}
			watches[path], previous = w, w
			return w, nil
		},
		changed: func(id string) { changes <- id },
	}
	defer m.stop()
	dir := t.TempDir()
	a, b := filepath.Join(dir, "a.md"), filepath.Join(dir, "b.md")
	for _, path := range []string{a, b} {
		if err := os.WriteFile(path, []byte("before"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.retarget(context.Background(), "a", a); err != nil {
		t.Fatal(err)
	}
	first := watches[a]
	if err := m.retarget(context.Background(), "a", a); err != nil || watches[a] != first {
		t.Fatalf("unchanged document restarted its watch: %v", err)
	}
	// An external writer changes the file; the native boundary reports one batch.
	if err := os.WriteFile(a, []byte("external write"), 0600); err != nil {
		t.Fatal(err)
	}
	first.events <- []mygo.FileEvent{{Op: mygo.FileWrite, Path: "."}}
	receiveChange(t, changes, "a")
	if err := m.retarget(context.Background(), "b", b); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(a, []byte("no longer watched"), 0600); err != nil {
		t.Fatal(err)
	}
	// Even a late batch from the old native stream must not escape.
	first.events <- []mygo.FileEvent{{Op: mygo.FileWrite, Path: "."}}
	if err := os.WriteFile(b, []byte("external b"), 0600); err != nil {
		t.Fatal(err)
	}
	watches[b].events <- []mygo.FileEvent{{Op: mygo.FileWrite, Path: "."}}
	receiveChange(t, changes, "b")
	if err := m.retarget(context.Background(), "draft", ""); err != nil {
		t.Fatal(err)
	}
	select {
	case <-watches[b].done:
	default:
		t.Fatal("draft kept the file watch alive")
	}
	watches[b].events <- []mygo.FileEvent{{Op: mygo.FileRemove, Path: "."}}
	select {
	case id := <-changes:
		t.Fatalf("duplicate or stale disk change: %q", id)
	case <-time.After(100 * time.Millisecond):
	}
}
