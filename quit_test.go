package main

import "testing"

func TestQuitAllowedOnlyWithoutPendingInput(t *testing.T) {
	for _, c := range []struct{ allow, pending, want bool }{
		{false, false, true},
		{false, true, false},
		{true, true, true},
	} {
		if got := quitAllowed(c.allow, c.pending); got != c.want {
			t.Fatalf("quitAllowed(%v,%v)=%v", c.allow, c.pending, got)
		}
	}
}
