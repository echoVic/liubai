package main

// AppearanceChange edits only the supplied preferences. Settings and editor
// windows must not replace one another's unrelated, possibly pending values.
type AppearanceChange struct {
	Theme         *string `json:"theme,omitempty"`
	Auto          *string `json:"auto,omitempty"`
	LightTheme    *string `json:"lightTheme,omitempty"`
	DarkTheme     *string `json:"darkTheme,omitempty"`
	FontSize      *int    `json:"fontSize,omitempty"`
	LineWidth     *string `json:"lineWidth,omitempty"`
	Layout        *string `json:"layout,omitempty"`
	Source        *bool   `json:"source,omitempty"`
	SidebarDocked *bool   `json:"sidebarDocked,omitempty"`
	OutlineHidden *bool   `json:"outlineHidden,omitempty"`
}

func (w *Workspace) updateAppearance(change AppearanceChange) (Appearance, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	p := w.appearance
	if change.Theme != nil {
		p.Theme = *change.Theme
	}
	if change.Auto != nil {
		p.Auto = *change.Auto
	}
	if change.LightTheme != nil {
		p.LightTheme = *change.LightTheme
	}
	if change.DarkTheme != nil {
		p.DarkTheme = *change.DarkTheme
	}
	if change.FontSize != nil {
		p.FontSize = *change.FontSize
	}
	if change.LineWidth != nil {
		p.LineWidth = *change.LineWidth
	}
	if change.Layout != nil {
		p.Layout = *change.Layout
	}
	if change.Source != nil {
		p.Source = *change.Source
	}
	if change.SidebarDocked != nil {
		p.SidebarDocked = *change.SidebarDocked
	}
	if change.OutlineHidden != nil {
		p.OutlineHidden = *change.OutlineHidden
	}
	err := w.saveAppearance(p)
	return w.appearance, err
}

func (d *Desktop) UpdateAppearance(change AppearanceChange) (Appearance, error) {
	p, err := d.w.updateAppearance(change)
	if err == nil && d.native != nil {
		syncWindowTheme(p)
		_ = captureAppearance.Broadcast(p)
		if d.win != nil {
			d.win.Update(func() {
				if d.settings != nil && d.settings.win != nil {
					d.settings.win.Invalidate()
				}
			})
		}
	}
	return p, err
}
