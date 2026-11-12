package main

import (
	"math"
	"testing"

	"github.com/egoist/mygo/ui"
)

// colourDistance is the OKLab distance x100 that scripts/check-themes.mjs
// uses for the page's roles: 2 is about the smallest step seen side by side.
func colourDistance(a, b ui.Color) float64 {
	lab := func(c ui.Color) [3]float64 {
		linear := func(v uint8) float64 {
			x := float64(v) / 255
			if x <= 0.04045 {
				return x / 12.92
			}
			return math.Pow((x+0.055)/1.055, 2.4)
		}
		r, g, b := linear(c.R), linear(c.G), linear(c.B)
		l := math.Cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b)
		m := math.Cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b)
		s := math.Cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b)
		return [3]float64{
			0.2104542553*l + 0.793617785*m - 0.0040720468*s,
			1.9779984951*l - 2.428592205*m + 0.4505937099*s,
			0.0259040371*l + 0.7827717662*m - 0.808675766*s,
		}
	}
	p, q := lab(a), lab(b)
	return 100 * math.Sqrt((p[0]-q[0])*(p[0]-q[0])+(p[1]-q[1])*(p[1]-q[1])+(p[2]-q[2])*(p[2]-q[2]))
}

// A hovered or pressed control is drawn on Surface (a button) or on
// Background (a menu row, the window), so both states must differ from both
// faces and from each other in every theme. The floor is the page's accent
// floor in scripts/check-themes.mjs.
func TestNativeThemesShowHoverAndPress(t *testing.T) {
	const floor = 4
	for _, theme := range themes {
		nt := nativeThemes[theme.ID]
		for _, pair := range []struct {
			name string
			a, b ui.Color
		}{
			{"hover on Surface", nt.SurfaceHover, nt.Surface},
			{"hover on Background", nt.SurfaceHover, nt.Background},
			{"pressed on Surface", nt.SurfacePressed, nt.Surface},
			{"pressed on Background", nt.SurfacePressed, nt.Background},
			{"pressed after hover", nt.SurfacePressed, nt.SurfaceHover},
		} {
			if d := colourDistance(pair.a, pair.b); d < floor {
				t.Errorf("%s: %s differs by %.1f, below %d", theme.ID, pair.name, d, floor)
			}
		}
	}
}
