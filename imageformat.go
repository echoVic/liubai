package main

import (
	"bytes"
	"encoding/binary"
	"encoding/xml"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"strings"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/webp"
)

type imageInfo struct {
	Format, MIME  string
	Width, Height int
}

func sniffImage(b []byte) (imageInfo, error) {
	var info imageInfo
	if c, format, err := image.DecodeConfig(bytes.NewReader(b)); err == nil {
		switch format {
		case "png", "jpeg", "gif", "webp", "bmp":
			info = imageInfo{format, "image/" + format, c.Width, c.Height}
		}
	}
	if info.Format == "" && svgImage(b) {
		info = imageInfo{Format: "svg", MIME: "image/svg+xml"}
	}
	if info.Format == "" {
		kind, payload, _, ok := imageBox(b)
		if ok && kind == "ftyp" && len(payload) >= 8 && len(payload)%4 == 0 {
			avif := func(brand []byte) bool { return string(brand) == "avif" || string(brand) == "avis" }
			found := avif(payload[:4])
			for i := 8; i < len(payload); i += 4 {
				found = found || avif(payload[i:i+4])
			}
			if found {
				width, height := avifDimensions(b)
				info = imageInfo{"avif", "image/avif", width, height}
			}
		}
	}
	if info.Format == "" {
		return imageInfo{}, errors.New("图片格式不受支持")
	}
	if info.Width > 16000 || info.Height > 16000 {
		return imageInfo{}, errors.New("图片尺寸超过 16000 像素")
	}
	return info, nil
}

func svgImage(b []byte) bool {
	b = bytes.TrimPrefix(b, []byte{0xef, 0xbb, 0xbf})
	if len(b) > 4096 {
		b = b[:4096]
	}
	d := xml.NewDecoder(bytes.NewReader(b))
	for {
		token, err := d.Token()
		if err != nil {
			return false
		}
		switch t := token.(type) {
		case xml.StartElement:
			return t.Name.Local == "svg"
		case xml.CharData:
			if strings.TrimSpace(string(t)) != "" {
				return false
			}
		case xml.Comment:
		case xml.ProcInst:
			if t.Target != "xml" {
				return false
			}
		case xml.Directive:
			if !bytes.HasPrefix(t, []byte("DOCTYPE")) || len(t) <= 7 || !strings.ContainsRune(" \t\r\n", rune(t[7])) {
				return false
			}
		default:
			return false
		}
	}
}

// imageBox bounds every ISO BMFF box before looking at its payload.
func imageBox(b []byte) (kind string, payload, rest []byte, ok bool) {
	if len(b) < 8 {
		return
	}
	size := uint64(binary.BigEndian.Uint32(b))
	header := 8
	switch size {
	case 0:
		size = uint64(len(b))
	case 1:
		if len(b) < 16 {
			return
		}
		header = 16
		size = binary.BigEndian.Uint64(b[8:])
	}
	if size < uint64(header) || size > uint64(len(b)) {
		return
	}
	return string(b[4:8]), b[header:int(size)], b[int(size):], true
}

func avifDimensions(b []byte) (int, int) {
	// Walk metadata containers in file order; image data may itself contain
	// the bytes "ispe", so a raw byte search cannot identify dimension boxes.
	pending := [][]byte{b}
	for len(pending) > 0 {
		i := len(pending) - 1
		kind, payload, rest, ok := imageBox(pending[i])
		if !ok {
			pending = pending[:i]
			continue
		}
		pending[i] = rest
		switch kind {
		case "ispe":
			if len(payload) >= 12 {
				return int(binary.BigEndian.Uint32(payload[4:])), int(binary.BigEndian.Uint32(payload[8:]))
			}
		case "meta":
			if len(payload) >= 4 {
				pending = append(pending, payload[4:])
			}
		case "iprp", "ipco":
			pending = append(pending, payload)
		}
	}
	return 0, 0
}
