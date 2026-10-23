package main

import (
	_ "embed"
	"encoding/json"
)

// src/themes.json lists the themes for both sides; their colours live in src/themes.css.
//
//go:embed src/themes.json
var themesJSON []byte

type themeSpec struct {
	ID     string `json:"id"`
	Series string `json:"series"`
	Dark   bool   `json:"dark"`
	Hours  []int  `json:"hours"`
	Season string `json:"season"`
}

var themes = func() (list []themeSpec) {
	if err := json.Unmarshal(themesJSON, &list); err != nil {
		panic("src/themes.json: " + err.Error())
	}
	return list
}()

func themeNamed(id string) (themeSpec, bool) {
	for _, t := range themes {
		if t.ID == id {
			return t, true
		}
	}
	return themeSpec{}, false
}
func validTheme(s string) bool {
	_, ok := themeNamed(s)
	return ok
}
func darkTheme(s string) bool {
	t, _ := themeNamed(s)
	return t.Dark
}
func validAuto(s string) bool { return s == "off" || s == "system" || s == "hours" || s == "seasons" }

// hoursTheme is the hours theme for a local hour; one range wraps past midnight.
func hoursTheme(hour int) string {
	for _, t := range themes {
		if len(t.Hours) != 2 {
			continue
		}
		from, to := t.Hours[0], t.Hours[1]
		if from < to && hour >= from && hour < to || from > to && (hour >= from || hour < to) {
			return t.ID
		}
	}
	return "paper"
}

// normalizeAppearance fills what older versions did not save: auto from
// followSystem, and paper and ink for the follow-system pair.
func normalizeAppearance(p *Appearance) {
	if !validAuto(p.Auto) {
		p.Auto = "off"
		if p.FollowSystem {
			p.Auto = "system"
		}
	}
	if !validTheme(p.LightTheme) || darkTheme(p.LightTheme) {
		p.LightTheme = "paper"
	}
	if !darkTheme(p.DarkTheme) {
		p.DarkTheme = "ink"
	}
	p.FollowSystem = p.Auto == "system"
}
