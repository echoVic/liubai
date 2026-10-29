package main

import (
	_ "embed"
	"encoding/json"
	"math"
	"time"
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

// Match src/theme.ts so the native picker shows the theme on the page,
// including keeping that theme when automatic switching is turned off.
func resolveAppearanceTheme(p Appearance, now time.Time, systemDark bool) string {
	switch p.Auto {
	case "system":
		if systemDark {
			if darkTheme(p.DarkTheme) {
				return p.DarkTheme
			}
			return "ink"
		}
		if validTheme(p.LightTheme) && !darkTheme(p.LightTheme) {
			return p.LightTheme
		}
		return "paper"
	case "hours":
		return hoursTheme(now.Hour())
	case "seasons":
		season := "winter"
		if systemDark {
			season = "night"
		} else {
			// The same 21st-century solar-term dates used by the page.
			for i, term := range []struct {
				month    time.Month
				constant float64
				season   string
			}{{time.February, 3.87, "spring"}, {time.May, 5.52, "summer"}, {time.August, 7.5, "autumn"}, {time.November, 7.438, "winter"}} {
				y, leap := now.Year()%100, now.Year()%100
				if i == 0 {
					leap--
				}
				day := int(math.Floor(float64(y)*0.2422+term.constant) - math.Floor(float64(leap)/4))
				if !now.Before(time.Date(now.Year(), term.month, day, 0, 0, 0, 0, now.Location())) {
					season = term.season
				}
			}
		}
		for _, theme := range themes {
			if theme.Season == season {
				return theme.ID
			}
		}
	}
	if validTheme(p.Theme) {
		return p.Theme
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
