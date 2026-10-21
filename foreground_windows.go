package main

import (
	"github.com/egoist/mygo"
	"golang.org/x/sys/windows"
)

var procAllowSetForegroundWindow = windows.NewLazySystemDLL("user32.dll").NewProc("AllowSetForegroundWindow")

// allowForegroundHandoff lets other processes bring a window to the front,
// as the process the user just started may: Windows refuses SetForegroundWindow
// to the first instance otherwise, and its window only flashes in the taskbar.
// A launch at login hands nothing over, and keeps the protection.
func allowForegroundHandoff() {
	if mygo.App.WasOpenedAtLogin() {
		return
	}
	const asfwAny = 0xFFFFFFFF // ASFW_ANY, (DWORD)-1
	procAllowSetForegroundWindow.Call(asfwAny)
}
