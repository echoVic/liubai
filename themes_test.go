package main

import "testing"

func TestThemeList(t *testing.T) {
	dark := 0
	for _, th := range themes {
		if th.Dark {
			dark++
		}
	}
	if len(themes) != 11 || dark != 4 {
		t.Fatalf("%d themes with %d dark, want 11 with 4 dark", len(themes), dark)
	}
	for _, id := range []string{"paper", "warm", "mist", "ink", "dawn", "lamp", "moon", "lotus", "autumn", "moonwhite", "indigo"} {
		if !validTheme(id) {
			t.Errorf("validTheme(%q) = false", id)
		}
	}
	if validTheme("unknown") || validTheme("") {
		t.Error("an unknown theme is valid")
	}
	for id, want := range map[string]bool{"ink": true, "lamp": true, "moon": true, "indigo": true, "paper": false, "lotus": false, "unknown": false} {
		if darkTheme(id) != want {
			t.Errorf("darkTheme(%q) = %v", id, !want)
		}
	}
}

func TestHoursTheme(t *testing.T) {
	for hour, want := range map[int]string{0: "moon", 4: "moon", 5: "dawn", 8: "dawn", 9: "paper", 14: "paper", 15: "warm", 18: "warm", 19: "lamp", 20: "lamp", 21: "ink", 22: "ink", 23: "moon"} {
		if got := hoursTheme(hour); got != want {
			t.Errorf("hoursTheme(%d) = %q, want %q", hour, got, want)
		}
	}
}
