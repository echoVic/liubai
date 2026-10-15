package main

import (
	"bytes"
	"compress/zlib"
	"encoding/hex"
	"fmt"
	"io"
	"math/big"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"unicode/utf16"
)

// These readers deliberately do not use the production PDF or CMap parser.
var pdfTestObjectRE = regexp.MustCompile(`(?m)^(\d+) (\d+) obj\s*`)
var pdfTestSectionRE = regexp.MustCompile(`(?s)\d+ begin(bfchar|bfrange)\s*(.*?)\s*end(?:bfchar|bfrange)`)
var pdfTestHexRE = regexp.MustCompile(`<([0-9A-Fa-f\s]+)>|\[|\]`)

func pdfTestNumber(s string) int { n, _ := strconv.Atoi(s); return n }
func pdfTestStart(t *testing.T, p []byte) int {
	t.Helper()
	m := regexp.MustCompile(`startxref\s+(\d+)\s+%%EOF\s*$`).FindSubmatch(p)
	if m == nil {
		t.Fatal("missing final startxref")
	}
	return pdfTestNumber(string(m[1]))
}
func pdfTestObjects(p []byte) map[int][]byte {
	result := map[int][]byte{}
	for _, loc := range pdfTestObjectRE.FindAllSubmatchIndex(p, -1) {
		end := bytes.Index(p[loc[1]:], []byte("endobj"))
		if end >= 0 {
			result[pdfTestNumber(string(p[loc[2]:loc[3]]))] = p[loc[1] : loc[1]+end]
		}
	}
	return result
}
func pdfTestStream(t *testing.T, obj []byte) []byte {
	t.Helper()
	i := bytes.Index(obj, []byte("stream\n"))
	if i < 0 {
		t.Fatal("missing stream")
	}
	end := bytes.LastIndex(obj, []byte("endstream"))
	data := obj[i+7 : end]
	if !bytes.Contains(obj[:i], []byte("/FlateDecode")) {
		return bytes.TrimSuffix(data, []byte("\n"))
	}
	r, err := zlib.NewReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	data, err = io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
func pdfTestUnicode(t *testing.T, h string) string {
	t.Helper()
	b, err := hex.DecodeString(strings.Join(strings.Fields(h), ""))
	if err != nil || len(b)%2 != 0 {
		t.Fatalf("bad UTF-16: %q", h)
	}
	units := make([]uint16, len(b)/2)
	for i := range units {
		units[i] = uint16(b[2*i])<<8 | uint16(b[2*i+1])
	}
	return string(utf16.Decode(units))
}
func pdfTestMappings(t *testing.T, data []byte) map[string]string {
	t.Helper()
	result := map[string]string{}
	for _, section := range pdfTestSectionRE.FindAllSubmatch(data, -1) {
		tokens := pdfTestHexRE.FindAllStringSubmatch(string(section[2]), -1)
		for i := 0; i < len(tokens); {
			source := strings.ToUpper(strings.Join(strings.Fields(tokens[i][1]), ""))
			i++
			if string(section[1]) == "bfchar" {
				result[source] = pdfTestUnicode(t, tokens[i][1])
				i++
				continue
			}
			end, ok := new(big.Int).SetString(tokens[i][1], 16)
			if !ok {
				t.Fatal("bad range end")
			}
			i++
			start, _ := new(big.Int).SetString(source, 16)
			count := new(big.Int).Sub(end, start).Int64() + 1
			if count < 1 || count > 100000 {
				t.Fatal("invalid test range")
			}
			array := tokens[i][0] == "["
			if array {
				i++
			}
			dest, _ := new(big.Int).SetString(tokens[i][1], 16)
			width := len(tokens[i][1])
			for j := int64(0); j < count; j++ {
				key := fmt.Sprintf("%0*X", len(source), new(big.Int).Add(start, big.NewInt(j)))
				if array {
					result[key] = pdfTestUnicode(t, tokens[i][1])
					i++
				} else {
					result[key] = pdfTestUnicode(t, fmt.Sprintf("%0*X", width, new(big.Int).Add(dest, big.NewInt(j))))
				}
			}
			if !array {
				i++
			} else {
				if tokens[i][0] != "]" {
					t.Fatal("array not closed")
				}
				i++
			}
		}
	}
	return result
}
func pdfTestFontMaps(t *testing.T, p []byte) map[int]map[string]string {
	t.Helper()
	objects := pdfTestObjects(p)
	maps := map[int]map[string]string{}
	refRE := regexp.MustCompile(`/ToUnicode\s+(\d+)\s+\d+\s+R`)
	for _, obj := range objects {
		if m := refRE.FindSubmatch(obj); m != nil {
			n := pdfTestNumber(string(m[1]))
			maps[n] = pdfTestMappings(t, pdfTestStream(t, objects[n]))
		}
	}
	return maps
}
func pdfTestCheckXref(t *testing.T, p []byte) string {
	t.Helper()
	offset := pdfTestStart(t, p)
	section := string(p[offset:])
	if !strings.HasPrefix(section, "xref\n") {
		t.Fatal("not classic xref")
	}
	lines := strings.Split(section, "\n")
	for i := 1; lines[i] != "trailer"; {
		var first, count int
		if _, err := fmt.Sscanf(lines[i], "%d %d", &first, &count); err != nil {
			t.Fatal(err)
		}
		i++
		for n := first; n < first+count; n++ {
			line := lines[i] + "\n"
			i++
			if len(line) != 20 {
				t.Fatalf("xref entry length %d: %q", len(line), line)
			}
			var at, gen int
			var state string
			fmt.Sscanf(line, "%d %d %s", &at, &gen, &state)
			if state != "n" {
				t.Fatalf("unexpected appended free entry: %q", line)
			}
			if at < 0 || at >= len(p) || !bytes.HasPrefix(p[at:], []byte(fmt.Sprintf("%d %d obj", n, gen))) {
				t.Fatalf("bad offset for %d %d: %d", n, gen, at)
			}
		}
	}
	return section[strings.Index(section, "trailer")+7 : strings.Index(section, "startxref")]
}

func TestFixPDFTextMappingFixture(t *testing.T) {
	original, err := os.ReadFile("testdata/pdf/webkit-radicals.pdf")
	if err != nil {
		t.Fatal(err)
	}
	before := pdfTestFontMaps(t, original)
	found := map[string]bool{}
	for _, m := range before {
		for _, v := range m {
			found[v] = true
		}
	}
	if !found["⻓"] || !found["⽂"] {
		t.Fatal("fixture no longer reproduces long/text radical mappings")
	}
	fixed := fixPDFTextMapping(original)
	if len(fixed) <= len(original) || !bytes.HasPrefix(fixed, original) {
		t.Fatal("expected an incremental update preserving every original byte")
	}
	trailer := pdfTestCheckXref(t, fixed)
	updatedObjects := pdfTestObjects(fixed[len(original):])
	if len(updatedObjects) != 3 || updatedObjects[34] == nil || updatedObjects[40] == nil || updatedObjects[51] == nil {
		t.Fatal("update must contain only the three changed ToUnicode objects")
	}
	for _, key := range []string{"Root", "Info", "ID"} {
		re := regexp.MustCompile(`/` + key + `\s+(\[[^\]]*\]|\d+\s+\d+\s+R)`)
		old := re.Find(original)
		if old == nil || !strings.Contains(trailer, string(old)) {
			t.Errorf("trailer lost %s", key)
		}
	}
	if !strings.Contains(trailer, fmt.Sprintf("/Prev %d", pdfTestStart(t, original))) {
		t.Fatal("wrong /Prev")
	}
	replacements := map[string]string{"⻓": "长", "⻚": "页", "⼀": "一", "⼄": "乙", "⼆": "二", "⼯": "工", "⽂": "文", "⽚": "片", "⽤": "用", "⽩": "白", "⾏": "行", "⾯": "面"}
	after := pdfTestFontMaps(t, fixed)
	if len(before) != len(after) {
		t.Fatal("changed font count")
	}
	for n, m := range before {
		if len(m) != len(after[n]) {
			t.Errorf("object %d mapping count changed", n)
		}
		for code, old := range m {
			want := old
			if s, ok := replacements[old]; ok {
				want = s
			}
			got := after[n][code]
			if got != want {
				t.Errorf("object %d <%s>: got %q want %q (was %q)", n, code, got, want, old)
			}
			for _, r := range got {
				if r >= 0x2e80 && r <= 0x2fdf {
					t.Errorf("remaining radical %U", r)
				}
			}
		}
	}
	if second := fixPDFTextMapping(fixed); !bytes.Equal(second, fixed) {
		t.Fatal("fix is not idempotent")
	}
}

func TestRewritePDFCMap(t *testing.T) {
	cases := []struct{ name, body, want string }{
		{"bfchar", "2 beginbfchar\n<01><2f42>\n<02><00412f64>\nendbfchar", "2 beginbfchar\n<01> <6587>\n<02> <00417528>\nendbfchar\n"},
		{"single range", "1 beginbfrange\n<21><21><2ed3>\nendbfrange", "1 beginbfchar\n<21> <957F>\nendbfchar\n"},
		{"incremented range", "1 beginbfrange\n<01><03><2eff>\nendbfrange", "3 beginbfchar\n<01> <2EFF>\n<02> <4E00>\n<03> <4E28>\nendbfchar\n"},
		{"array", "1 beginbfrange\n<01><03>[<2f42><0041><2ed3>]\nendbfrange", "3 beginbfchar\n<01> <6587>\n<02> <0041>\n<03> <957F>\nendbfchar\n"},
		{"two byte codes", "1 beginbfchar\n<00ab><2eda>\nendbfchar", "1 beginbfchar\n<00AB> <9875>\nendbfchar\n"},
		{"surrogate pair", "2 beginbfchar\n<01><d840dc00>\n<02><2f42>\nendbfchar", "2 beginbfchar\n<01> <D840DC00>\n<02> <6587>\nendbfchar\n"},
		{"multiple sections", "1 beginbfchar\n<01><2f42>\nendbfchar\n1 beginbfrange\n<02><02><2ed3>\nendbfrange", "2 beginbfchar\n<01> <6587>\n<02> <957F>\nendbfchar\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			prefix, suffix := "% header\n1 begincodespacerange\n<00><FF>\nendcodespacerange\n", "\nendcmap\n% footer\n"
			got, changed, err := rewritePDFCMap([]byte(prefix + tc.body + suffix))
			if err != nil || !changed {
				t.Fatalf("changed=%v err=%v", changed, err)
			}
			if string(got) != prefix+tc.want+suffix {
				t.Fatalf("got:\n%s\nwant:\n%s", got, prefix+tc.want+suffix)
			}
		})
	}
}
func TestRewritePDFCMapBatchLimit(t *testing.T) {
	input := []byte("1 beginbfrange\n<0000><00c8><2f00>\nendbfrange")
	got, changed, err := rewritePDFCMap(input)
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	sections := pdfTestSectionRE.FindAllSubmatch(got, -1)
	if len(sections) != 3 || !bytes.HasPrefix(got, []byte("100 beginbfchar")) || !bytes.Contains(got, []byte("1 beginbfchar\n<00C8>")) {
		t.Fatalf("incorrect batches: %s", got)
	}
	if len(pdfTestMappings(t, got)) != 201 {
		t.Fatal("lost range entries")
	}
}
func TestRewritePDFCMapUnchangedAndMalformed(t *testing.T) {
	for _, s := range []string{"1 beginbfchar <01><d840dc00> endbfchar", "1 beginbfchar <01><6587> endbfchar", "% beginbfchar in a comment\n"} {
		got, changed, err := rewritePDFCMap([]byte(s))
		if err != nil || changed || string(got) != s {
			t.Fatalf("unchanged CMap: %q, %v, %v", got, changed, err)
		}
	}
	for _, s := range []string{"1 beginbfchar <01><2f42>", "2 beginbfchar <01><2f42> endbfchar", "1 beginbfrange <02><01><2f42> endbfrange", "1 beginbfrange <01><02>[<2f42>] endbfrange", "1 beginbfchar <01><d800> endbfchar", "1 beginbfchar <01><2f4> endbfchar"} {
		if _, _, err := rewritePDFCMap([]byte(s)); err == nil {
			t.Errorf("accepted malformed CMap %q", s)
		}
	}
}

func pdfTestBuild(cmap, filter string, indirect bool) []byte {
	var stream bytes.Buffer
	if filter == "" {
		stream.WriteString(cmap)
	} else {
		w := zlib.NewWriter(&stream)
		w.Write([]byte(cmap))
		w.Close()
	}
	length := strconv.Itoa(stream.Len())
	if indirect {
		length = "5 0 R"
	}
	objects := map[int]string{1: "<< /Type /Catalog /Pages 2 0 R >>", 2: "<< /Type /Pages /Count 0 /Kids [] >>", 3: "<< /Type /Font /ToUnicode 4 3 R >>", 4: fmt.Sprintf("<< /Length %s %s >>\nstream\n%s\nendstream", length, filter, stream.String()), 5: strconv.Itoa(stream.Len())}
	var out bytes.Buffer
	out.WriteString("%PDF-1.3\n")
	offsets := map[int]int{}
	for n := 1; n <= 5; n++ {
		offsets[n] = out.Len()
		gen := 0
		if n == 4 {
			gen = 3
		}
		fmt.Fprintf(&out, "%d %d obj\n%s\nendobj\n", n, gen, objects[n])
	}
	xref := out.Len()
	out.WriteString("xref\n0 6\n0000000000 65535 f \n")
	for n := 1; n <= 5; n++ {
		gen := 0
		if n == 4 {
			gen = 3
		}
		fmt.Fprintf(&out, "%010d %05d n \n", offsets[n], gen)
	}
	fmt.Fprintf(&out, "trailer\n<< /Size 6 /Root 1 0 R /Info 5 0 R /ID [<ABCD><1234>] /Custom << /Text (escaped \\( value \\) /Prev) /Values [1 true null] >> >>\nstartxref\n%d\n%%%%EOF\n", xref)
	return out.Bytes()
}
func TestFixPDFStreamVariants(t *testing.T) {
	for _, filter := range []string{"", "/Filter /FlateDecode", "/Filter [/FlateDecode]"} {
		for _, indirect := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/indirect=%v", filter, indirect), func(t *testing.T) {
				p := pdfTestBuild("1 beginbfchar\n<01><2f42>\nendbfchar", filter, indirect)
				fixed := fixPDFTextMapping(p)
				if len(fixed) <= len(p) {
					t.Fatal("no update")
				}
				trailer := pdfTestCheckXref(t, fixed)
				if !strings.Contains(trailer, "/Custom << /Text (escaped \\( value \\) /Prev) /Values [1 true null] >>") {
					t.Fatal("custom trailer value lost")
				}
				obj := pdfTestObjects(fixed)[4]
				if !bytes.Contains(obj, []byte("/Filter /FlateDecode")) || bytes.Contains(obj, []byte("/Length 5 0 R")) {
					t.Fatal("new stream must use direct length and FlateDecode")
				}
				if got := pdfTestFontMaps(t, fixed)[4]["01"]; got != "文" {
					t.Fatalf("got %q", got)
				}
			})
		}
	}
}
func TestFixPDFNewestXrefWins(t *testing.T) {
	p := pdfTestBuild("1 beginbfchar\n<01><2ed3>\nendbfchar", "", false)
	prev := pdfTestStart(t, p)
	content := "1 beginbfchar\n<01><2f42>\nendbfchar"
	var update bytes.Buffer
	fmt.Fprintf(&update, "4 3 obj\n<< /Length %d >>\nstream\n%s\nendstream\nendobj\n", len(content), content)
	xref := len(p) + update.Len()
	fmt.Fprintf(&update, "xref\n4 1\n%010d 00003 n \ntrailer\n<< /Size 6 /Root 1 0 R /Info 5 0 R /ID [<ABCD><1234>] /Prev %d /XRefStm 0 >>\nstartxref\n%d\n%%%%EOF\n", len(p), prev, xref)
	p = append(p, update.Bytes()...)
	fixed := fixPDFTextMapping(p)
	if !bytes.HasPrefix(fixed, p) || len(fixed) == len(p) {
		t.Fatal("expected incremental fix")
	}
	if got := pdfTestFontMaps(t, fixed)[4]["01"]; got != "文" {
		t.Fatalf("stale object used: %q", got)
	}
	trailer := pdfTestCheckXref(t, fixed)
	if !strings.Contains(trailer, fmt.Sprintf("/Prev %d", xref)) || strings.Contains(trailer, "/XRefStm") || strings.Count(trailer, "/Prev") != 1 {
		t.Fatalf("bad trailer: %s", trailer)
	}
}
func TestFixPDFTextMappingUnchanged(t *testing.T) {
	valid := pdfTestBuild("1 beginbfchar\n<01><6587>\nendbfchar", "", false)
	radical := pdfTestBuild("1 beginbfchar\n<01><2f42>\nendbfchar", "", false)
	xstream := []byte("%PDF-1.5\n1 0 obj\n<< /Type /XRef >>\nendobj\nstartxref\n9\n%%EOF\n")
	badCompression := pdfTestBuild("1 beginbfchar\n<01><2f42>\nendbfchar", "/Filter /FlateDecode", false)
	streamAt := bytes.Index(badCompression, []byte("stream\n")) + len("stream\n")
	badCompression[streamAt] ^= 0xff
	cases := map[string][]byte{
		"non PDF":            []byte("hello"),
		"nil":                nil,
		"truncated":          radical[:len(radical)/2],
		"xref stream":        xstream,
		"no radicals":        valid,
		"missing startxref":  []byte("%PDF-1.3\n%%EOF"),
		"unsupported filter": pdfTestBuild("1 beginbfchar <01><2f42> endbfchar", "/Filter /ASCIIHexDecode", false),
		"malformed CMap":     pdfTestBuild("1 beginbfchar <01><2f42>", "", false),
		"bad generation":     bytes.Replace(radical, []byte("/ToUnicode 4 3 R"), []byte("/ToUnicode 4 2 R"), 1),
		"bad object offset":  bytes.Replace(radical, []byte("1 0 obj"), []byte("9 0 obj"), 1),
		"bad length":         bytes.Replace(radical, []byte("/Length 34"), []byte("/Length 99"), 1),
		"bad compression":    badCompression,
	}
	cycle := bytes.Replace(radical, []byte("/Size 6"), []byte(fmt.Sprintf("/Prev %d /Size 6", pdfTestStart(t, radical))), 1)
	cases["cyclic Prev"] = cycle
	for name, p := range cases {
		t.Run(name, func(t *testing.T) {
			if got := fixPDFTextMapping(p); !bytes.Equal(got, p) {
				t.Fatal("input should remain unchanged")
			}
		})
	}
	// Malformed/truncated inputs must never panic or partially modify the PDF.
	for i := 0; i < len(bytes.TrimSpace(radical)); i++ {
		p := radical[:i]
		if got := fixPDFTextMapping(p); !bytes.Equal(got, p) {
			t.Fatalf("modified prefix of length %d", i)
		}
	}
}
func TestPDFRadicalIdeographs(t *testing.T) {
	for from, to := range map[rune]rune{0x2ed3: 0x957f, 0x2eda: 0x9875, 0x2f00: 0x4e00, 0x2f42: 0x6587, 0x2f64: 0x7528} {
		if pdfRadicalIdeographs[from] != to {
			t.Errorf("%U: got %U want %U", from, pdfRadicalIdeographs[from], to)
		}
	}
	if len(pdfRadicalIdeographs) < 214 {
		t.Fatal("missing Kangxi mappings")
	}
}
func TestFixPDFFile(t *testing.T) {
	in, out := os.Getenv("LIUBAI_PDF_IN"), os.Getenv("LIUBAI_PDF_OUT")
	if in == "" || out == "" {
		t.Skip("set LIUBAI_PDF_IN and LIUBAI_PDF_OUT to fix a PDF file")
	}
	p, err := os.ReadFile(in)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, fixPDFTextMapping(p), 0644); err != nil {
		t.Fatal(err)
	}
}

// FuzzFixPDFTextMapping: any input either comes back unchanged or as an append-only update, never a panic.
func FuzzFixPDFTextMapping(f *testing.F) {
	fixture, err := os.ReadFile("testdata/pdf/webkit-radicals.pdf")
	if err != nil {
		f.Fatal(err)
	}
	f.Add(fixture)
	f.Add(fixture[:len(fixture)/2])
	f.Add([]byte("%PDF-1.3\nxref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 >>\nstartxref\n9\n%%EOF\n"))
	f.Fuzz(func(t *testing.T, data []byte) {
		out := fixPDFTextMapping(data)
		if !bytes.HasPrefix(out, data) {
			t.Fatalf("output does not keep the input as its prefix")
		}
	})
}
