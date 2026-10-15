package main

import (
	"bytes"
	"compress/zlib"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

var errPDFText = errors.New("invalid or unsupported PDF text mapping")

// fixPDFTextMapping preserves the original PDF and appends replacements for only
// the ToUnicode streams whose destinations contain known radical aliases.
// Unsupported or malformed files are left intact; PDF export must still work.
func fixPDFTextMapping(pdf []byte) []byte {
	fixed, err := appendPDFTextUpdate(pdf)
	if err != nil {
		return pdf
	}
	return fixed
}

type pdfTextToken struct {
	text       string
	start, end int
}
type pdfTextParser struct {
	data []byte
	pos  int
}

func pdfTextSpace(c byte) bool { return c == 0 || c == 9 || c == 10 || c == 12 || c == 13 || c == 32 }
func pdfTextDelimiter(c byte) bool {
	return pdfTextSpace(c) || strings.ContainsRune("()<>[]{}/%", rune(c))
}
func (p *pdfTextParser) token() (pdfTextToken, error) {
	for p.pos < len(p.data) {
		if pdfTextSpace(p.data[p.pos]) {
			p.pos++
			continue
		}
		if p.data[p.pos] == '%' {
			for p.pos < len(p.data) && p.data[p.pos] != '\r' && p.data[p.pos] != '\n' {
				p.pos++
			}
			continue
		}
		break
	}
	start := p.pos
	if start == len(p.data) {
		return pdfTextToken{}, io.EOF
	}
	c := p.data[p.pos]
	p.pos++
	switch c {
	case '(':
		depth := 1
		for p.pos < len(p.data) && depth > 0 {
			c = p.data[p.pos]
			p.pos++
			switch c {
			case '\\':
				if p.pos < len(p.data) {
					p.pos++
				}
			case '(':
				depth++
			case ')':
				depth--
			}
		}
		if depth != 0 {
			return pdfTextToken{}, errPDFText
		}
	case '<':
		if p.pos < len(p.data) && p.data[p.pos] == '<' {
			p.pos++
		} else {
			for p.pos < len(p.data) && p.data[p.pos] != '>' {
				p.pos++
			}
			if p.pos == len(p.data) {
				return pdfTextToken{}, errPDFText
			}
			p.pos++
		}
	case '>':
		if p.pos >= len(p.data) || p.data[p.pos] != '>' {
			return pdfTextToken{}, errPDFText
		}
		p.pos++
	case '/':
		for p.pos < len(p.data) && !pdfTextDelimiter(p.data[p.pos]) {
			p.pos++
		}
	case '[', ']', '{', '}':
	default:
		if pdfTextDelimiter(c) {
			return pdfTextToken{}, errPDFText
		}
		for p.pos < len(p.data) && !pdfTextDelimiter(p.data[p.pos]) {
			p.pos++
		}
	}
	return pdfTextToken{string(p.data[start:p.pos]), start, p.pos}, nil
}
func (p *pdfTextParser) expect(s string) error {
	t, e := p.token()
	if e != nil || t.text != s {
		return errPDFText
	}
	return nil
}
func (p *pdfTextParser) integer() (int, error) {
	t, e := p.token()
	if e != nil {
		return 0, e
	}
	n, e := strconv.Atoi(t.text)
	if e != nil {
		return 0, errPDFText
	}
	return n, nil
}

type pdfTextEntry struct {
	key, keyRaw string
	value       pdfTextValue
}
type pdfTextValue struct {
	kind, raw string
	n, gen    int
	entries   []pdfTextEntry
	list      []pdfTextValue
}

func pdfTextName(raw string) (string, error) {
	if !strings.HasPrefix(raw, "/") {
		return "", errPDFText
	}
	var b strings.Builder
	for i := 1; i < len(raw); i++ {
		if raw[i] == '#' {
			if i+2 >= len(raw) {
				return "", errPDFText
			}
			v, e := strconv.ParseUint(raw[i+1:i+3], 16, 8)
			if e != nil {
				return "", errPDFText
			}
			b.WriteByte(byte(v))
			i += 2
		} else {
			b.WriteByte(raw[i])
		}
	}
	return b.String(), nil
}
func (p *pdfTextParser) value(depth int) (pdfTextValue, error) {
	if depth > 64 {
		return pdfTextValue{}, errPDFText
	}
	t, err := p.token()
	if err != nil {
		return pdfTextValue{}, err
	}
	v := pdfTextValue{raw: t.text, kind: "atom"}
	switch {
	case t.text == "<<":
		v.kind = "dict"
		keys := map[string]bool{}
		for {
			key, e := p.token()
			if e != nil {
				return v, e
			}
			if key.text == ">>" {
				break
			}
			name, e := pdfTextName(key.text)
			if e != nil || keys[name] {
				return v, errPDFText
			}
			keys[name] = true
			value, e := p.value(depth + 1)
			if e != nil {
				return v, e
			}
			v.entries = append(v.entries, pdfTextEntry{name, key.text, value})
		}
	case t.text == "[":
		v.kind = "array"
		for {
			save := p.pos
			next, e := p.token()
			if e != nil {
				return v, e
			}
			if next.text == "]" {
				break
			}
			p.pos = save
			item, e := p.value(depth + 1)
			if e != nil {
				return v, e
			}
			v.list = append(v.list, item)
		}
	case strings.HasPrefix(t.text, "/"):
		v.kind = "name"
		if _, err = pdfTextName(t.text); err != nil {
			return v, err
		}
	case strings.HasPrefix(t.text, "("):
		v.kind = "string"
	case strings.HasPrefix(t.text, "<") && t.text != "<<":
		v.kind = "hex"
		if _, err = pdfTextHex(t.text); err != nil {
			return v, err
		}
	default:
		if n, e := strconv.Atoi(t.text); e == nil {
			v.kind = "int"
			v.n = n
			save := p.pos
			second, e := p.token()
			if e == nil {
				gen, e := strconv.Atoi(second.text)
				if e == nil {
					third, e := p.token()
					if e == nil && third.text == "R" {
						if n < 0 || gen < 0 || gen > 65535 {
							return v, errPDFText
						}
						v.kind = "ref"
						v.gen = gen
					} else {
						p.pos = save
					}
				} else {
					p.pos = save
				}
			} else {
				p.pos = save
			}
		} else if t.text != "true" && t.text != "false" && t.text != "null" {
			// Real numbers may occur in arbitrary dictionaries/arrays.
			if strings.ContainsAny(t.text, "eENaInf") {
				return v, errPDFText
			}
			if _, e := strconv.ParseFloat(t.text, 64); e != nil {
				return v, errPDFText
			}
		}
	}
	v.raw = string(p.data[t.start:p.pos])
	return v, nil
}
func (v pdfTextValue) get(key string) (pdfTextValue, bool) {
	for _, e := range v.entries {
		if e.key == key {
			return e.value, true
		}
	}
	return pdfTextValue{}, false
}
func (v pdfTextValue) named(name string) bool {
	if v.kind != "name" {
		return false
	}
	n, e := pdfTextName(v.raw)
	return e == nil && n == name
}
func (v pdfTextValue) dictionaryWithout(excluded ...string) string {
	var b strings.Builder
	b.WriteString("<<")
	for _, e := range v.entries {
		skip := false
		for _, key := range excluded {
			if e.key == key {
				skip = true
			}
		}
		if !skip {
			fmt.Fprintf(&b, " %s %s", e.keyRaw, e.value.raw)
		}
	}
	return b.String()
}

type pdfTextXref struct {
	offset, gen int
	used        bool
}
type pdfTextDocument struct {
	data    []byte
	xref    map[int]pdfTextXref
	trailer pdfTextValue
	start   int
}

func readPDFTextDocument(data []byte) (*pdfTextDocument, error) {
	if !bytes.HasPrefix(data, []byte("%PDF-")) {
		return nil, errPDFText
	}
	end := bytes.TrimRightFunc(data, func(r rune) bool { return r <= 127 && pdfTextSpace(byte(r)) })
	if !bytes.HasSuffix(end, []byte("%%EOF")) {
		return nil, errPDFText
	}
	footer := bytes.LastIndex(end, []byte("startxref"))
	if footer < 0 {
		return nil, errPDFText
	}
	p := pdfTextParser{data: end, pos: footer + len("startxref")}
	start, err := p.integer()
	if err != nil {
		return nil, err
	}
	// Unlike regular PDF comments, the EOF marker is significant here.
	if string(bytes.TrimSpace(end[p.pos:])) != "%%EOF" {
		return nil, errPDFText
	}
	doc := &pdfTextDocument{data: data, xref: map[int]pdfTextXref{}, start: start}
	seen := map[int]bool{}
	for offset := start; ; {
		if offset < 0 || offset >= len(data) || seen[offset] || !bytes.HasPrefix(data[offset:], []byte("xref")) {
			return nil, errPDFText
		}
		seen[offset] = true
		p := pdfTextParser{data: data, pos: offset}
		if p.expect("xref") != nil {
			return nil, errPDFText
		}
		for {
			save := p.pos
			t, e := p.token()
			if e != nil {
				return nil, e
			}
			if t.text == "trailer" {
				break
			}
			p.pos = save
			first, e := p.integer()
			if e != nil || first < 0 {
				return nil, errPDFText
			}
			count, e := p.integer()
			if e != nil || count < 0 || count > len(data)/4 || first > int(^uint(0)>>1)-count {
				return nil, errPDFText
			}
			for i := 0; i < count; i++ {
				at, e := p.integer()
				if e != nil || at < 0 {
					return nil, errPDFText
				}
				gen, e := p.integer()
				if e != nil || gen < 0 || gen > 65535 {
					return nil, errPDFText
				}
				flag, e := p.token()
				if e != nil || (flag.text != "n" && flag.text != "f") {
					return nil, errPDFText
				}
				if flag.text == "n" && at >= len(data) {
					return nil, errPDFText
				}
				if _, exists := doc.xref[first+i]; !exists {
					doc.xref[first+i] = pdfTextXref{at, gen, flag.text == "n"}
				}
			}
		}
		trailer, e := p.value(0)
		if e != nil || trailer.kind != "dict" {
			return nil, errPDFText
		}
		if offset == start {
			doc.trailer = trailer
		}
		prev, ok := trailer.get("Prev")
		if !ok {
			break
		}
		if prev.kind != "int" || prev.n < 0 {
			return nil, errPDFText
		}
		offset = prev.n
	}
	size, ok := doc.trailer.get("Size")
	if !ok || size.kind != "int" || size.n < 1 {
		return nil, errPDFText
	}
	for n := range doc.xref {
		if n >= size.n {
			return nil, errPDFText
		}
	}
	if _, encrypted := doc.trailer.get("Encrypt"); encrypted {
		return nil, errPDFText
	}
	return doc, nil
}
func (d *pdfTextDocument) object(n, gen int) (pdfTextValue, int, error) {
	x, ok := d.xref[n]
	if !ok || !x.used || x.offset == 0 || x.gen != gen {
		return pdfTextValue{}, 0, errPDFText
	}
	p := pdfTextParser{data: d.data, pos: x.offset}
	number, e := p.integer()
	if e != nil || number != n {
		return pdfTextValue{}, 0, errPDFText
	}
	generation, e := p.integer()
	if e != nil || generation != gen || p.expect("obj") != nil {
		return pdfTextValue{}, 0, errPDFText
	}
	v, e := p.value(0)
	if e != nil {
		return v, 0, e
	}
	end := p.pos
	t, e := p.token()
	if e != nil || (t.text != "endobj" && (t.text != "stream" || v.kind != "dict")) {
		return v, 0, errPDFText
	}
	return v, end, nil
}
func (d *pdfTextDocument) stream(dict pdfTextValue, end int) ([]byte, error) {
	length, ok := dict.get("Length")
	if !ok {
		return nil, errPDFText
	}
	if length.kind == "ref" {
		v, _, e := d.object(length.n, length.gen)
		if e != nil {
			return nil, e
		}
		length = v
	}
	if length.kind != "int" || length.n < 0 {
		return nil, errPDFText
	}
	p := pdfTextParser{data: d.data, pos: end}
	if p.expect("stream") != nil {
		return nil, errPDFText
	}
	if p.pos < len(d.data) && d.data[p.pos] == '\r' {
		p.pos++
		if p.pos < len(d.data) && d.data[p.pos] == '\n' {
			p.pos++
		}
	} else if p.pos < len(d.data) && d.data[p.pos] == '\n' {
		p.pos++
	} else {
		return nil, errPDFText
	}
	if length.n > len(d.data)-p.pos {
		return nil, errPDFText
	}
	data := d.data[p.pos : p.pos+length.n]
	p.pos += length.n
	if p.expect("endstream") != nil || p.expect("endobj") != nil {
		return nil, errPDFText
	}
	if _, filtered := dict.get("Filter"); filtered {
		reader, e := zlib.NewReader(bytes.NewReader(data))
		if e != nil {
			return nil, e
		}
		// Bound allocations on damaged/untrusted export files.
		const maxCMapBytes = 64 << 20
		decoded, e := io.ReadAll(io.LimitReader(reader, maxCMapBytes+1))
		closeErr := reader.Close()
		if e != nil || closeErr != nil || len(decoded) > maxCMapBytes {
			return nil, errPDFText
		}
		return decoded, nil
	}
	return data, nil
}
func appendPDFTextUpdate(data []byte) ([]byte, error) {
	d, err := readPDFTextDocument(data)
	if err != nil {
		return nil, err
	}
	refs := map[int]int{}
	for n, x := range d.xref {
		// CoreGraphics emits unused entries marked 'n' with offset zero.
		if !x.used || x.offset == 0 {
			continue
		}
		obj, _, e := d.object(n, x.gen)
		if e != nil {
			return nil, e
		}
		if typ, ok := obj.get("Type"); ok && typ.named("ObjStm") {
			return nil, errPDFText
		}
		if ref, ok := obj.get("ToUnicode"); ok {
			if ref.kind != "ref" {
				return nil, errPDFText
			}
			if gen, exists := refs[ref.n]; exists && gen != ref.gen {
				return nil, errPDFText
			}
			refs[ref.n] = ref.gen
		}
	}
	numbers := make([]int, 0, len(refs))
	for n := range refs {
		numbers = append(numbers, n)
	}
	sort.Ints(numbers)
	var update bytes.Buffer
	update.WriteByte('\n')
	offsets := map[int]int{}
	for _, n := range numbers {
		dict, end, e := d.object(n, refs[n])
		if e != nil || dict.kind != "dict" {
			return nil, errPDFText
		}
		if filter, ok := dict.get("Filter"); ok {
			if filter.kind == "array" && len(filter.list) == 1 {
				filter = filter.list[0]
			}
			if !filter.named("FlateDecode") {
				continue
			}
		}
		// Non-default decode parameters would change the stream's interpretation.
		if params, ok := dict.get("DecodeParms"); ok && params.raw != "null" {
			continue
		}
		cmap, e := d.stream(dict, end)
		if e != nil {
			return nil, e
		}
		fixed, changed, e := rewritePDFCMap(cmap)
		if e != nil {
			return nil, e
		}
		if !changed {
			continue
		}
		var compressed bytes.Buffer
		writer := zlib.NewWriter(&compressed)
		if _, e = writer.Write(fixed); e != nil {
			return nil, e
		}
		if e = writer.Close(); e != nil {
			return nil, e
		}
		offsets[n] = len(data) + update.Len()
		if int64(offsets[n]) > 9999999999 {
			return nil, errPDFText
		}
		fmt.Fprintf(&update, "%d %d obj\n%s /Length %d /Filter /FlateDecode >>\nstream\n", n, refs[n], dict.dictionaryWithout("Length", "Filter", "DecodeParms"), compressed.Len())
		update.Write(compressed.Bytes())
		update.WriteString("\nendstream\nendobj\n")
	}
	if len(offsets) == 0 {
		return data, nil
	}
	xrefOffset := len(data) + update.Len()
	update.WriteString("xref\n")
	for _, n := range numbers {
		if at, ok := offsets[n]; ok {
			fmt.Fprintf(&update, "%d 1\n%010d %05d n \n", n, at, refs[n])
		}
	}
	fmt.Fprintf(&update, "trailer\n%s /Prev %d >>\nstartxref\n%d\n%%%%EOF\n", d.trailer.dictionaryWithout("Prev", "XRefStm"), d.start, xrefOffset)
	result := make([]byte, 0, len(data)+update.Len())
	result = append(result, data...)
	result = append(result, update.Bytes()...)
	return result, nil
}

// CMap sources retain their hex width; destinations are UTF-16BE byte strings.
type pdfTextMapping struct{ source, destination string }

func pdfTextHex(s string) (string, error) {
	if len(s) < 2 || s[0] != '<' || s[1] == '<' || s[len(s)-1] != '>' {
		return "", errPDFText
	}
	var b strings.Builder
	for i := 1; i < len(s)-1; i++ {
		c := s[i]
		if pdfTextSpace(c) {
			continue
		}
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return "", errPDFText
		}
		b.WriteByte(c)
	}
	if b.Len() == 0 {
		return "", errPDFText
	}
	return strings.ToUpper(b.String()), nil
}
func rewritePDFDestination(h string) (string, bool, error) {
	if len(h)%4 != 0 {
		return "", false, errPDFText
	}
	b, e := hex.DecodeString(h)
	if e != nil {
		return "", false, e
	}
	units := make([]uint16, len(b)/2)
	for i := range units {
		units[i] = uint16(b[2*i])<<8 | uint16(b[2*i+1])
	}
	// Reject unpaired surrogates rather than silently introducing U+FFFD.
	for i := 0; i < len(units); i++ {
		u := units[i]
		if u >= 0xd800 && u <= 0xdbff {
			if i+1 == len(units) || units[i+1] < 0xdc00 || units[i+1] > 0xdfff {
				return "", false, errPDFText
			}
			i++
		} else if u >= 0xdc00 && u <= 0xdfff {
			return "", false, errPDFText
		}
	}
	runes := utf16.Decode(units)
	changed := false
	for i, r := range runes {
		if target, ok := pdfRadicalIdeographs[r]; ok {
			runes[i] = target
			changed = true
		}
	}
	if !changed {
		return h, false, nil
	}
	units = utf16.Encode(runes)
	b = make([]byte, 2*len(units))
	for i, u := range units {
		b[2*i] = byte(u >> 8)
		b[2*i+1] = byte(u)
	}
	return strings.ToUpper(hex.EncodeToString(b)), true, nil
}
func rewritePDFCMap(cmap []byte) ([]byte, bool, error) {
	p := pdfTextParser{data: cmap}
	var previous pdfTextToken
	first, last := -1, -1
	var mappings []pdfTextMapping
	changed := false
	const maxMappings = 1 << 20
	add := func(source, dest string) error {
		if len(mappings) >= maxMappings {
			return errPDFText
		}
		fixed, didChange, e := rewritePDFDestination(dest)
		if e != nil {
			return e
		}
		changed = changed || didChange
		mappings = append(mappings, pdfTextMapping{source, fixed})
		return nil
	}
	readHex := func() (string, error) {
		t, e := p.token()
		if e != nil {
			return "", e
		}
		return pdfTextHex(t.text)
	}
	for {
		token, e := p.token()
		if e == io.EOF {
			break
		}
		if e != nil {
			return cmap, false, e
		}
		if token.text != "beginbfchar" && token.text != "beginbfrange" {
			if token.text == "endbfchar" || token.text == "endbfrange" {
				return cmap, false, errPDFText
			}
			previous = token
			continue
		}
		count, e := strconv.Atoi(previous.text)
		if e != nil || count < 0 || count > maxMappings {
			return cmap, false, errPDFText
		}
		if first < 0 {
			first = previous.start
		}
		for row := 0; row < count; row++ {
			source, e := readHex()
			if e != nil {
				return cmap, false, e
			}
			if token.text == "beginbfchar" {
				dest, e := readHex()
				if e != nil {
					return cmap, false, e
				}
				if e = add(source, dest); e != nil {
					return cmap, false, e
				}
				continue
			}
			high, e := readHex()
			if e != nil || len(source) != len(high) {
				return cmap, false, errPDFText
			}
			lowInt, _ := new(big.Int).SetString(source, 16)
			highInt, _ := new(big.Int).SetString(high, 16)
			distance := new(big.Int).Sub(highInt, lowInt)
			if !distance.IsInt64() || distance.Sign() < 0 || distance.Int64() >= int64(maxMappings-len(mappings)) {
				return cmap, false, errPDFText
			}
			size := int(distance.Int64()) + 1
			destination, e := p.token()
			if e != nil {
				return cmap, false, e
			}
			array := destination.text == "["
			var dest string
			var destInt *big.Int
			if !array {
				dest, e = pdfTextHex(destination.text)
				if e != nil {
					return cmap, false, e
				}
				destInt, _ = new(big.Int).SetString(dest, 16)
			}
			for j := 0; j < size; j++ {
				code := fmt.Sprintf("%0*X", len(source), lowInt)
				value := dest
				if array {
					value, e = readHex()
					if e != nil {
						return cmap, false, e
					}
				} else {
					value = fmt.Sprintf("%0*X", len(dest), destInt)
					if len(value) != len(dest) {
						return cmap, false, errPDFText
					}
					destInt.Add(destInt, big.NewInt(1))
				}
				if e = add(code, value); e != nil {
					return cmap, false, e
				}
				lowInt.Add(lowInt, big.NewInt(1))
			}
			if array && p.expect("]") != nil {
				return cmap, false, errPDFText
			}
		}
		end, e := p.token()
		want := "endbfchar"
		if token.text == "beginbfrange" {
			want = "endbfrange"
		}
		if e != nil || end.text != want {
			return cmap, false, errPDFText
		}
		last = end.end
		previous = end
	}
	if !changed {
		return cmap, false, nil
	}
	var out bytes.Buffer
	out.Write(cmap[:first])
	for start := 0; start < len(mappings); start += 100 {
		end := min(start+100, len(mappings))
		fmt.Fprintf(&out, "%d beginbfchar\n", end-start)
		for _, m := range mappings[start:end] {
			fmt.Fprintf(&out, "<%s> <%s>\n", m.source, m.destination)
		}
		out.WriteString("endbfchar\n")
	}
	out.Write(cmap[last:])
	return out.Bytes(), true, nil
}
