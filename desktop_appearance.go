package main

import (
	"strconv"

	"liubai/locales"

	"github.com/egoist/mygo/ui"
)

// Lucide check and chevron-down, matching the editor's icon strokes.
var settingsCheck = ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m20 6-11 11-5-5"/></svg>`))
var settingsChevron = ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`))

var themeTextKeys = map[string][3]string{
	"dawn": {"fDawn", "fDawnCaption", "fHourMao"}, "paper": {"fPaper", "fPaperCaption", "fHourWu"},
	"warm": {"fWarm", "fWarmCaption", "fHourShen"}, "lamp": {"fLamplight", "fLamplightCaption", "fHourXu"},
	"ink": {"fInk", "fInkCaption", "fHourHai"}, "moon": {"fMoonlight", "fMoonlightCaption", "fHourZi"},
	"mist": {"fMist", "fMistCaption", "fSpring"}, "lotus": {"fLotus", "fLotusCaption", "fSummer"},
	"autumn": {"fAutumn", "fAutumnCaption", "fAutumnSeason"}, "moonwhite": {"fMoonWhite", "fMoonWhiteCaption", "fWinter"},
	"indigo": {"fIndigo", "fIndigoCaption", "fNight"},
}

func (s *settingsWindow) themeOptions(dark *bool) []settingsOption[string] {
	var options []settingsOption[string]
	for _, theme := range themes {
		if dark == nil || theme.Dark == *dark {
			options = append(options, settingsOption[string]{theme.ID, s.text(themeTextKeys[theme.ID][0])})
		}
	}
	return options
}

func (s *settingsWindow) appearanceView(c *ui.Context, m locales.Messages, p Appearance, current string) {
	width, _ := c.Size()
	scale := c.Preferences().TextScale
	choice, activated := current, false
	ui.RadioGroup(c, func() {
		s.themeCards(c, "hours", m.FHours(), m.FOnePageInTheChangingLightOfADay(), &choice, &activated)
		s.themeCards(c, "seasons", m.FSeasons(), m.FTheColoursOfTheYear(), &choice, &activated)
	}).Label(m.FTheme()).FillWidth().Gap(20)
	if activated {
		p.Auto, current = "off", choice
		s.saveAppearance(AppearanceChange{Theme: &choice, Auto: &p.Auto})
	}
	ui.Divider(c).FillWidth()
	ui.Column(c).FillWidth().Gap(10).Children(func() {
		row := ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(16)
		if width < 700*scale {
			row.Column().AlignItems(ui.Stretch)
		}
		row.Children(func() {
			ui.Text(c, m.FSwitchAutomatically()).Grow(1)
			options := []settingsOption[string]{
				{"off", m.FOff()}, {"system", m.FFollowSystem()},
				{"hours", m.FFollowTheHours()}, {"seasons", m.FFollowTheSeasons()},
			}
			selected := 0
			for i, option := range options {
				if option.value == p.Auto {
					selected = i
				}
			}
			t := c.Theme()
			segments := ui.SegmentedBase(c, &selected, len(options))
			track := segments.Track.Label(m.FSwitchAutomatically()).Padding(3).Gap(2).
				Radius(8).Background(t.SurfaceHover).Border(1, t.Border)
			if width < 700*scale {
				track.FillWidth()
			}
			twoRows := width < 560*scale
			if twoRows {
				track.Wrap()
			}
			track.Children(func() {
				for i, option := range options {
					b := segments.Segment(i).Label(option.label).Padding(7, 10).Radius(5)
					if twoRows {
						b.Width((width - 48 - 6 - 2) / 2)
					}
					if i == selected {
						b.Background(t.Background)
					} else {
						b.TextColor(t.TextMuted)
					}
					b.Children(func() { ui.Text(c, option.label).SingleLine() })
				}
			})
			if segments.Track.Changed() {
				p.Auto = options[selected].value
				s.saveAppearance(AppearanceChange{Auto: &p.Auto, Theme: &current})
			}
		})
		ui.Text(c, s.text(map[string]string{
			"off": "fAlwaysUseTheSelectedTheme", "system": "fChooseAThemeForLightAndDarkMode",
			"hours": "fHoursSchedule", "seasons": "fSeasonsSchedule",
		}[p.Auto])).FontSize(12 * scale).TextColor(c.Theme().TextMuted)
	})
	if p.Auto == "system" {
		ui.Row(c).FillWidth().Gap(24).Children(func() {
			for _, pair := range []struct {
				label string
				dark  bool
			}{{m.FLightMode(), false}, {m.FDarkMode(), true}} {
				ui.Column(c).Grow(1).Gap(8).Children(func() {
					ui.Text(c, pair.label)
					value := p.LightTheme
					if pair.dark {
						value = p.DarkTheme
					}
					if settingsSelect(c, &value, pair.label, s.themeOptions(&pair.dark)) {
						if pair.dark {
							s.saveAppearance(AppearanceChange{DarkTheme: &value})
						} else {
							s.saveAppearance(AppearanceChange{LightTheme: &value})
						}
					}
				})
			}
		})
	}
	typography := ui.Row(c).FillWidth().Gap(24)
	if width < 560*scale {
		typography.Column()
	}
	typography.Children(func() {
		ui.Row(c).Grow(1).AlignItems(ui.Center).Gap(12).Children(func() {
			ui.Text(c, m.FFontSize()).Grow(1)
			ui.Box(c).Width(72 * scale).Children(func() {
				font := p.FontSize
				if font == 0 {
					font = 18
				}
				var sizes []settingsOption[int]
				for size := 15; size <= 22; size++ {
					sizes = append(sizes, settingsOption[int]{size, strconv.Itoa(size)})
				}
				if settingsSelect(c, &font, m.FBodyFontSize(), sizes) {
					s.saveAppearance(AppearanceChange{FontSize: &font})
				}
			})
		})
		ui.Row(c).Grow(1).AlignItems(ui.Center).Gap(12).Children(func() {
			ui.Text(c, m.FLineWidth()).Grow(1)
			ui.Box(c).Width(140 * scale).Children(func() {
				width := p.LineWidth
				if width == "" {
					width = "normal"
				}
				if settingsSelect(c, &width, m.FBodyLineWidth(), []settingsOption[string]{
					{"normal", m.FComfortable()}, {"wide", m.FWide()}, {"full", m.FFullWidth()},
				}) {
					s.saveAppearance(AppearanceChange{LineWidth: &width})
				}
			})
		})
	})
}

func (s *settingsWindow) themeCards(c *ui.Context, series, title, subtitle string, choice *string, activated *bool) {
	width, _ := c.Size()
	scale := c.Preferences().TextScale
	columns := 6
	if series == "seasons" {
		columns = 5
	}
	if width < 640*scale {
		columns = 3
	}
	cardWidth := (width - 48 - 8*float32(columns-1)) / float32(columns)
	ui.Column(c).FillWidth().Gap(10).Children(func() {
		ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(10).Children(func() {
			ui.Text(c, title).FontSize(15 * scale).Bold()
			ui.Text(c, subtitle).TextColor(c.Theme().TextMuted)
		})
		selectedCaption, focusedCaption, hoveredCaption := "", "", ""
		ui.Row(c).FillWidth().Wrap().Gap(8).Children(func() {
			for _, theme := range themes {
				if theme.Series != series {
					continue
				}
				keys := themeTextKeys[theme.ID]
				name, note, tag := s.text(keys[0]), s.text(keys[1]), s.text(keys[2])
				t := nativeThemes[theme.ID].withPreferences(c.Preferences())
				card := ui.RadioBase(c, choice, theme.ID).Label(name).Description(note).Column().Width(cardWidth).
					Height(96*scale).Radius(9).Clip().Background(t.Surface).TextColor(t.Text).Border(1, t.Border)
				if card.Clicked() || card.Changed() {
					*activated = true
				}
				selected := *choice == theme.ID
				if selected {
					card.Border(2, t.Accent)
				} else if card.Hovered() {
					card.Border(1, t.Accent)
				}
				card.Children(func() {
					if series == "hours" {
						ui.Column(c).Fill().Center().Gap(4).Padding(0, 0, 6, 0).Children(func() {
							ui.Text(c, tag).Font(t.font).FontSize(28 * scale)
							ui.Text(c, name).Font(t.font).FontSize(13 * scale).SingleLine()
						})
					} else {
						titleSize := float32(21)
						if s.locale() == "en" {
							titleSize = 17
						}
						ui.Column(c).Fill().Padding(16, 16).Gap(8).Children(func() {
							ui.Text(c, name).Font(t.font).FontSize(titleSize * scale).Bold().Grow(1)
							ui.Text(c, tag).Font(t.font).FontSize(12 * scale).TextColor(t.TextMuted)
						})
					}
				})
				card.DrawOver(func(p *ui.Painter, r ui.Rect) {
					if series == "hours" {
						p.Fill(ui.Rect{X: r.X + (r.W-32)/2, Y: r.Y + r.H - 10, W: 32, H: 2}, t.Accent, 1)
					} else {
						p.Clip(r, 9, func() {
							p.Fill(ui.Rect{X: r.X + 1, Y: r.Y + 1, W: 4, H: r.H - 2}, t.Accent, 0)
						})
					}
					if selected {
						p.Icon(settingsCheck, ui.Rect{X: r.X + r.W - 22, Y: r.Y + 8, W: 14, H: 14}, t.Accent)
					}
				})
				caption := name + " · " + note
				if selected {
					selectedCaption = caption
				}
				if card.Focused() {
					focusedCaption = caption
				}
				if card.Hovered() {
					hoveredCaption = caption
				}
			}
		})
		caption := selectedCaption
		if focusedCaption != "" {
			caption = focusedCaption
		}
		if hoveredCaption != "" {
			caption = hoveredCaption
		}
		ui.Text(c, caption).MinHeight(18 * scale).FontSize(12 * scale).TextColor(c.Theme().TextMuted)
	})
}
