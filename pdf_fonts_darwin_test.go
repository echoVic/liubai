//go:build darwin

package main

import (
	"maps"
	"os"
	"slices"
	"testing"
)

func TestFontIdeographs(t *testing.T) {
	for font, want := range map[string]map[rune]rune{
		"PingFangSC-Regular":  {'⼈': '人', '⼝': '口', '⼜': '又'},
		"STSongti-SC-Regular": {'⼈': '人', '⼝': '口'},
	} {
		t.Run(font, func(t *testing.T) {
			t.Parallel()
			got := fontIdeographs(font, []rune{'⼈', '⼝', '⼜'})
			if got == nil {
				t.Skip("font is not installed")
			}
			for r, i := range want {
				if got[r] != i {
					t.Errorf("%c → %q, want %c", r, got[r], i)
				}
			}
		})
	}
	if got := fontIdeographs("NoSuchFont-Regular", []rune{'⼈'}); got != nil {
		t.Errorf("a font that is not installed gave %q", got)
	}
}

func TestFontIdeographsRecorded(t *testing.T) {
	for fixture, fonts := range map[string]map[string]map[rune]rune{
		"webkit": webkitIdeographs,
		"songti": printedIdeographs,
	} {
		for font, want := range fonts {
			t.Run(fixture+"/"+font, func(t *testing.T) {
				t.Parallel()
				got := fontIdeographs(font, slices.Sorted(maps.Keys(want)))
				if got == nil {
					t.Skip("font is not installed")
				}
				if !maps.Equal(got, want) {
					t.Errorf("CoreText answered %q, recorded %q", got, want)
				}
			})
		}
	}
}

func TestFixPDFSongtiMouth(t *testing.T) {
	if fontIdeographs("STSongti-SC-Regular", []rune{'⼜'}) == nil {
		t.Skip("Songti SC is not installed")
	}
	original, err := os.ReadFile("testdata/pdf/songti-radicals.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if got := testTextMaps(t, fixPDFTextMapping(original))[18]["3F"]; got != "口" {
		t.Errorf("Songti SC <3F> maps to %q, want 口", got)
	}
}
