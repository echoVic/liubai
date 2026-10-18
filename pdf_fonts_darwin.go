//go:build darwin

package main

import (
	"runtime"
	"sync"

	"github.com/ebitengine/purego"
)

var (
	pdfFontsOnce                 sync.Once
	cfStringCreateWithBytes      func(allocator uintptr, bytes *byte, length int, encoding uint32, external bool) uintptr
	cfEqual                      func(a, b uintptr) bool
	cfRelease                    func(value uintptr)
	ctFontCreateWithName         func(name uintptr, size float64, matrix uintptr) uintptr
	ctFontCopyPostScriptName     func(font uintptr) uintptr
	ctFontGetGlyphsForCharacters func(font uintptr, chars, glyphs *uint16, count int) bool
)

// fontIdeographs finds the first ideograph sharing each radical's glyph, in
// U+4E00–U+9FFF, then U+3400–U+4DBF. A substituted font gives nil.
// These C APIs are safe from any goroutine and need no autorelease pool.
func fontIdeographs(font string, radicals []rune) map[rune]rune {
	pdfFontsOnce.Do(func() {
		cf, err := purego.Dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", purego.RTLD_LAZY|purego.RTLD_LOCAL)
		if err != nil {
			panic(err)
		}
		purego.RegisterLibFunc(&cfStringCreateWithBytes, cf, "CFStringCreateWithBytes")
		purego.RegisterLibFunc(&cfEqual, cf, "CFEqual")
		purego.RegisterLibFunc(&cfRelease, cf, "CFRelease")
		ct, err := purego.Dlopen("/System/Library/Frameworks/CoreText.framework/CoreText", purego.RTLD_LAZY|purego.RTLD_LOCAL)
		if err != nil {
			panic(err)
		}
		purego.RegisterLibFunc(&ctFontCreateWithName, ct, "CTFontCreateWithName")
		purego.RegisterLibFunc(&ctFontCopyPostScriptName, ct, "CTFontCopyPostScriptName")
		purego.RegisterLibFunc(&ctFontGetGlyphsForCharacters, ct, "CTFontGetGlyphsForCharacters")
	})
	if font == "" {
		return nil
	}
	b := []byte(font)
	const utf8 = 0x08000100
	requested := cfStringCreateWithBytes(0, &b[0], len(b), utf8, false)
	runtime.KeepAlive(b)
	if requested == 0 {
		return nil
	}
	defer cfRelease(requested)
	f := ctFontCreateWithName(requested, 12, 0)
	if f == 0 {
		return nil
	}
	defer cfRelease(f)
	name := ctFontCopyPostScriptName(f)
	if name == 0 {
		return nil
	}
	defer cfRelease(name)
	if !cfEqual(name, requested) {
		return nil
	}
	chars := make([]uint16, 0, len(radicals))
	for _, r := range radicals {
		if r > 0 && r <= 0xFFFF {
			chars = append(chars, uint16(r))
		}
	}
	if len(chars) == 0 {
		return nil
	}
	// Songti SC draws both ⼝ and ⼜ as 口, so a glyph may have several radicals.
	glyphs := make([]uint16, len(chars))
	ctFontGetGlyphsForCharacters(f, &chars[0], &glyphs[0], len(chars))
	wanted := map[uint16][]rune{}
	for i, g := range glyphs {
		if g != 0 {
			wanted[g] = append(wanted[g], rune(chars[i]))
		}
	}
	found := map[rune]rune{}
	for _, block := range [][2]uint16{{0x4E00, 0x9FFF}, {0x3400, 0x4DBF}} {
		if len(wanted) == 0 {
			break
		}
		chars = make([]uint16, int(block[1]-block[0])+1)
		for i := range chars {
			chars[i] = block[0] + uint16(i)
		}
		glyphs = make([]uint16, len(chars))
		// Missing characters get glyph 0; the Boolean result says if all exist.
		ctFontGetGlyphsForCharacters(f, &chars[0], &glyphs[0], len(chars))
		for i, g := range glyphs {
			for _, r := range wanted[g] {
				found[r] = rune(chars[i])
			}
			delete(wanted, g)
		}
	}
	return found
}
