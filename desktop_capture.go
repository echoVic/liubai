package main

import "github.com/egoist/mygo"

var captured = mygo.NewEvent[Summary]("liubai:captured")
var captureAppearance = mygo.NewEvent[Appearance]("liubai:capture-appearance")

func (d *Desktop) Capture(text string) (Summary, error) {
	summary, err := d.w.Capture(text)
	if err == nil && d.native != nil && d.win != nil {
		_ = captured.Emit(d.win, summary)
	}
	return summary, err
}

func (d *Desktop) GetCaptureSettings() CaptureStatus {
	if d.capture != nil {
		d.capture.mu.Lock()
		defer d.capture.mu.Unlock()
	}
	d.w.mu.Lock()
	defer d.w.mu.Unlock()
	status := CaptureStatus{Settings: d.w.capture}
	if d.capture != nil {
		status.Error = d.capture.errorText
	}
	return status
}

func (d *Desktop) SetCaptureSettings(p CaptureSettings) error {
	if d.capture != nil {
		d.capture.mu.Lock()
		defer d.capture.mu.Unlock()
	}
	if err := d.w.SetCaptureSettings(p); err != nil {
		return err
	}
	if d.capture == nil {
		return nil
	}
	d.w.mu.Lock()
	p = d.w.capture
	d.w.mu.Unlock()
	return d.capture.apply(p)
}

func (d *Desktop) HideCapture() {
	if d.native != nil && d.capturePanel != nil {
		d.capturePanel.Hide()
	}
}

func (d *Desktop) ShowCapture() {
	if d.native == nil || d.capturePanel == nil {
		return
	}
	panel := d.capturePanel
	display := mygo.Screen.DisplayNearestPoint(mygo.Screen.CursorScreenPoint())
	width, height := panel.Size()
	panel.SetPosition(display.WorkArea.X+(display.WorkArea.Width-width)/2, display.WorkArea.Y+(display.WorkArea.Height-height)/3)
	panel.Show()
}

func (d *Desktop) toggleCapture() {
	if d.native == nil || d.capturePanel == nil {
		return
	}
	if d.capturePanel.IsVisible() {
		d.HideCapture()
	} else {
		d.ShowCapture()
	}
}

func (d *Desktop) initCapture() {
	d.capturePanel = mygo.NewWindow(mygo.WindowOptions{Panel: true, Hidden: true, Frameless: true, Transparent: true, Vibrancy: mygo.VibrancyPopover, Width: 560, Height: 240, DisableResize: true, URL: "/capture.html"})
	d.capturePanel.OnClose(d.handleCaptureClose)
	d.capturePanel.OnBlur(d.HideCapture)
	d.capturePanel.OnShow(func() {
		go func() { _, _ = d.capturePanel.Page().Eval("window.dispatchEvent(new Event('liubai:capture-show'))") }()
	})
	d.capture = &captureController{registrar: mygo.GlobalShortcut, toggle: d.toggleCapture, setOpenAtLogin: mygo.App.SetOpenAtLogin, loginKnown: true, loginApplied: mygo.App.OpenAtLogin()}
	p := d.GetCaptureSettings().Settings
	d.capture.mu.Lock()
	_ = d.capture.apply(p)
	d.capture.mu.Unlock()
}

func (d *Desktop) handleCaptureClose(e *mygo.CloseEvent) {
	if d.allowClose.Load() {
		return
	}
	e.PreventDefault()
	d.HideCapture()
}
