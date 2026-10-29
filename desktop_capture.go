package main

import (
	"encoding/json"
	"errors"
	"liubai/locales"

	"github.com/egoist/mygo"
)

var captured = mygo.NewEvent[Summary]("liubai:captured")
var captureAppearance = mygo.NewEvent[Appearance]("liubai:capture-appearance")

type CaptureContext struct {
	Appearance Appearance `json:"appearance"`
	Recent     []Summary  `json:"recent"`
	titles     WorkspaceState
}

func (d *Desktop) GetCaptureContext() CaptureContext {
	d.w.mu.Lock()
	defer d.w.mu.Unlock()
	state := d.w.snapshot()
	return valueIn(CaptureContext{Appearance: state.Appearance, Recent: state.Recent, titles: state}, "").(CaptureContext)
}

func (d *Desktop) SaveCapture(req CaptureRequest) (Summary, error) {
	if req.TargetID == "" {
		summary, err := d.w.CaptureWithTags(req.Text, req.Tags)
		if err == nil && d.native != nil && d.win != nil {
			_ = captured.Emit(d.win, summary)
		}
		return summary, err
	}
	if d.native != nil && d.win != nil {
		b, err := json.Marshal(req)
		if err != nil {
			return Summary{}, err
		}
		// The editor owns its pending text and history. Await its entire append
		// operation, including flushing edits, before clearing the capture panel.
		result, err := mygo.EvalAs[struct {
			Summary Summary `json:"summary"`
			Error   string  `json:"error"`
		}](d.win.Page(), "window.liubaiAppendCapture("+string(b)+").then(summary=>({summary}),e=>({error:e.message}))")
		if err != nil {
			return Summary{}, err
		}
		if result.Error != "" {
			return Summary{}, errors.New(result.Error)
		}
		return result.Summary, nil
	}
	result, err := d.AppendCapture(req)
	return result.Summary, err
}

func (d *Desktop) AppendCapture(req CaptureRequest) (CaptureAppendResult, error) {
	result, err := d.w.AppendCapture(req)
	d.savedNative(req.TargetID, err)
	result.Document = documentIn(result.Document, "")
	result.Summary.Title = result.Document.Title
	if err == nil && result.Document.Path != "" && result.Document.StatusCode != "fileSaved" {
		result.Summary.Warning = result.Document.Status
	}
	return result, err
}

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
		status.Error = errorIn(d.capture.lastError, "")
		status.errorCause = d.capture.lastError
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
	d.capturePanel = mygo.NewWindow(mygo.WindowOptions{Title: locales.BCaptureWindowTitle(), Panel: true, Hidden: true, Frameless: true, Transparent: true, Vibrancy: mygo.VibrancyPopover, Width: 560, Height: 340, DisableResize: true, URL: "/capture.html"})
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
