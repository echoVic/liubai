package main

import "testing"

func TestSearchActivationKeepsDraftsForCancellation(t *testing.T) {
	w := workspace(t)
	target := edit(t, w, "# target\n\nneedle")
	origin, err := w.New()
	if err != nil {
		t.Fatal(err)
	}
	d := &Desktop{w: w}
	if _, err := d.ActivateSearch(target.ID); err != nil {
		t.Fatal(err)
	}
	restored, err := d.ActivateSearch(origin.Current.ID)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Current.ID != origin.Current.ID || len(restored.Recent) != 2 {
		t.Fatalf("cancelled search lost a draft: %+v", restored)
	}
	saved, err := d.Update(Edit{ID: restored.Current.ID, Revision: restored.Current.Revision, Content: "after cancellation"})
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := openWorkspace(w.root)
	if err != nil {
		t.Fatal(err)
	}
	if got := reopened.State().Current; got.ID != saved.ID || got.Content != saved.Content {
		t.Fatalf("cancelled search did not persist the origin: %+v", got)
	}
	if _, err := d.ActivateSearch("missing"); err == nil || d.State().Current.ID != saved.ID {
		t.Fatal("missing search target changed current document")
	}
}
