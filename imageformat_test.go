package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/image/bmp"
)

func box(kind string, payload []byte) []byte {
	b := make([]byte, 8+len(payload))
	binary.BigEndian.PutUint32(b, uint32(len(b)))
	copy(b[4:], kind)
	copy(b[8:], payload)
	return b
}

func TestSniffImageFormats(t *testing.T) {
	webp, _ := base64.StdEncoding.DecodeString("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")
	var bm bytes.Buffer
	bmp.Encode(&bm, image.NewNRGBA(image.Rect(0, 0, 3, 2)))
	size := make([]byte, 12)
	binary.BigEndian.PutUint32(size[4:], 640)
	binary.BigEndian.PutUint32(size[8:], 480)
	avif := append(box("ftyp", []byte("avif\x00\x00\x00\x00mif1avif")), box("meta", append([]byte{0, 0, 0, 0}, box("iprp", box("ipco", box("ispe", size)))...))...)
	svg := []byte("\xef\xbb\xbf<?xml version=\"1.0\"?>\n<!-- logo -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"></svg>")
	for _, c := range []struct {
		name string
		data []byte
		want imageInfo
	}{
		{"png", tinyPNG(), imageInfo{"png", "image/png", 32, 24}},
		{"webp", webp, imageInfo{"webp", "image/webp", 1, 1}},
		{"bmp", bm.Bytes(), imageInfo{"bmp", "image/bmp", 3, 2}},
		{"avif", avif, imageInfo{"avif", "image/avif", 640, 480}},
		{"svg", svg, imageInfo{"svg", "image/svg+xml", 0, 0}},
	} {
		got, err := sniffImage(c.data)
		if err != nil || got != c.want {
			t.Errorf("%s: got %+v %v, want %+v", c.name, got, err, c.want)
		}
	}
	var huge bytes.Buffer
	png.Encode(&huge, image.NewGray(image.Rect(0, 0, 16001, 1)))
	if _, err := sniffImage(huge.Bytes()); err == nil {
		t.Fatal("oversized image accepted")
	}
	if _, err := sniffImage([]byte("<html><svg></svg></html>")); err == nil {
		t.Fatal("HTML accepted as SVG")
	}
}

func TestReadImageServesSVGAndWebP(t *testing.T) {
	w := workspace(t)
	dir := t.TempDir()
	webp, _ := base64.StdEncoding.DecodeString("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")
	os.WriteFile(filepath.Join(dir, "logo.svg"), []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`), 0644)
	os.WriteFile(filepath.Join(dir, "photo.webp"), webp, 0644)
	p := filepath.Join(dir, "doc.md")
	os.WriteFile(p, []byte("![logo](logo.svg)\n\n![photo](photo.webp)\n"), 0644)
	s, err := w.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	for dest, prefix := range map[string]string{"logo.svg": "data:image/svg+xml;base64,", "photo.webp": "data:image/webp;base64,"} {
		r, err := w.ReadImage(s.Current.ID, dest)
		if err != nil || !strings.HasPrefix(r.URL, prefix) {
			t.Errorf("%s: %v %q", dest, err, r.URL[:min(len(r.URL), 40)])
		}
	}
	if im, err := w.ImportImage(s.Current.ID, "a.webp", base64.StdEncoding.EncodeToString(webp)); err != nil || !strings.HasSuffix(im.Name, ".webp") {
		t.Fatalf("import webp: %+v %v", im, err)
	}
}

func TestSniffImagePreamblesBrandsAndLimits(t *testing.T) {
	var jpg, animated bytes.Buffer
	if err := jpeg.Encode(&jpg, image.NewGray(image.Rect(0, 0, 4, 2)), nil); err != nil {
		t.Fatal(err)
	}
	if err := gif.Encode(&animated, image.NewGray(image.Rect(0, 0, 2, 3)), nil); err != nil {
		t.Fatal(err)
	}
	avif := func(brand string, width, height uint32) []byte {
		size := make([]byte, 12)
		binary.BigEndian.PutUint32(size[4:], width)
		binary.BigEndian.PutUint32(size[8:], height)
		return append(box("ftyp", []byte(brand)), box("meta", append([]byte{0, 0, 0, 0}, box("iprp", box("ipco", box("ispe", size)))...))...)
	}
	for _, c := range []struct {
		name string
		data []byte
		want imageInfo
	}{
		{"jpeg", jpg.Bytes(), imageInfo{"jpeg", "image/jpeg", 4, 2}},
		{"gif", animated.Bytes(), imageInfo{"gif", "image/gif", 2, 3}},
		{"doctype", []byte(" \n<?xml version=\"1.0\"?>\n<!-- logo -->\n<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\">\n<svg/>"), imageInfo{"svg", "image/svg+xml", 0, 0}},
		{"doctype subset", []byte("<!DOCTYPE svg [<!ENTITY logo 'a>b'>]><svg/>"), imageInfo{"svg", "image/svg+xml", 0, 0}},
		{"doctype whitespace", []byte("<!DOCTYPE\nsvg><svg/>"), imageInfo{"svg", "image/svg+xml", 0, 0}},
		{"svg boundary", []byte(strings.Repeat(" ", 4090) + "<svg/>"), imageInfo{"svg", "image/svg+xml", 0, 0}},
		{"compatible avif", avif("mif1\x00\x00\x00\x00miafavif", 16, 9), imageInfo{"avif", "image/avif", 16, 9}},
		{"avis", avif("avis\x00\x00\x00\x00mif1", 1, 2), imageInfo{"avif", "image/avif", 1, 2}},
		{"avif unknown size", box("ftyp", []byte("avif\x00\x00\x00\x00mif1")), imageInfo{"avif", "image/avif", 0, 0}},
		{"avif size boundary", avif("avif\x00\x00\x00\x00", 16000, 16000), imageInfo{"avif", "image/avif", 16000, 16000}},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got, err := sniffImage(c.data); err != nil || got != c.want {
				t.Fatalf("got %+v %v, want %+v", got, err, c.want)
			}
		})
	}
	var tall bytes.Buffer
	if err := bmp.Encode(&tall, image.NewGray(image.Rect(0, 0, 1, 16001))); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name string
		data []byte
		want string
	}{
		{"empty", nil, "图片格式不受支持"},
		{"html", []byte("<html><svg/></html>"), "图片格式不受支持"},
		{"svg name boundary", []byte("<svgfoo/>"), "图片格式不受支持"},
		{"svg past limit", []byte(strings.Repeat(" ", 4096) + "<svg/>"), "图片格式不受支持"},
		{"heic", box("ftyp", []byte("heic\x00\x00\x00\x00mif1")), "图片格式不受支持"},
		{"minor version is not brand", box("ftyp", []byte("mif1avifmif1")), "图片格式不受支持"},
		{"unaligned brand", box("ftyp", []byte("mif1\x00\x00\x00\x00xavifxxx")), "图片格式不受支持"},
		{"truncated ftyp", []byte("\x00\x00\x00\x20ftypavif"), "图片格式不受支持"},
		{"wide avif", avif("avif\x00\x00\x00\x00", 16001, 1), "图片尺寸超过 16000 像素"},
		{"tall avif", avif("avif\x00\x00\x00\x00", 1, 16001), "图片尺寸超过 16000 像素"},
		{"tall bmp", tall.Bytes(), "图片尺寸超过 16000 像素"},
	} {
		t.Run(c.name, func(t *testing.T) {
			if _, err := sniffImage(c.data); err == nil || err.Error() != c.want {
				t.Fatalf("got %v, want %s", err, c.want)
			}
		})
	}
}

func TestNewImageFormatsTravelWithDocuments(t *testing.T) {
	webp, _ := base64.StdEncoding.DecodeString("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")
	var bm bytes.Buffer
	if err := bmp.Encode(&bm, image.NewNRGBA(image.Rect(0, 0, 3, 2))); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		format, mime string
		data         []byte
	}{
		{"svg", "image/svg+xml", []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)},
		{"webp", "image/webp", webp},
		{"bmp", "image/bmp", bm.Bytes()},
		{"avif", "image/avif", box("ftyp", []byte("avif\x00\x00\x00\x00mif1"))},
	} {
		t.Run(c.format, func(t *testing.T) {
			w := workspace(t)
			d := w.State().Current
			im, err := w.ImportImage(d.ID, "misleading.png", base64.StdEncoding.EncodeToString(c.data))
			if err != nil {
				t.Fatal(err)
			}
			wantURL := "data:" + c.mime + ";base64," + base64.StdEncoding.EncodeToString(c.data)
			if !strings.HasSuffix(im.Name, "."+c.format) || im.URL != wantURL {
				t.Fatalf("wrong import format or MIME: %+v", im)
			}
			edit(t, w, "![图]("+im.Markdown+")\n")
			delivery, err := w.Delivery(d.ID)
			if err != nil || len(delivery.Missing) != 0 || delivery.Images[im.Destination] != wantURL {
				t.Fatalf("delivery: %+v %v", delivery, err)
			}
			copy := *w.docs[d.ID]
			copy.ID = uid()
			if err := w.copyAssets(w.docs[d.ID], &copy); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(copy.Content, "."+c.format+")") {
				t.Fatalf("copy lost format: %s", copy.Content)
			}
			if data, err := os.ReadFile(filepath.Join(w.root, "assets", copy.ID, im.Name)); err != nil || !bytes.Equal(data, c.data) {
				t.Fatalf("copied image changed: %v", err)
			}
			path := filepath.Join(t.TempDir(), "note.md")
			if _, err := w.SaveAs(d.ID, path); err != nil {
				t.Fatal(err)
			}
			portable := "note.assets/" + im.Name
			if got, err := w.ReadImage(d.ID, portable); err != nil || got.URL != wantURL {
				t.Fatalf("read saved image: %+v %v", got, err)
			}
			if data, err := os.ReadFile(filepath.Join(filepath.Dir(path), "note.assets", im.Name)); err != nil || !bytes.Equal(data, c.data) {
				t.Fatalf("saved image changed: %v", err)
			}
			// Restoring the original draft destination exercises materialize.
			edit(t, w, "![图]("+im.Markdown+")\n")
			if got := w.State().Current; got.Status != "文件已保存" {
				t.Fatalf("materialize lost image: %+v", got)
			}
			if data, err := os.ReadFile(path); err != nil || string(data) != "![图]("+portable+")\n" {
				t.Fatalf("materialized image target: %q %v", data, err)
			}
			archive := filepath.Join(t.TempDir(), "note.zip")
			if result, err := w.Export(d.ID, archive, false); err != nil || len(result.Missing) != 0 || result.Path == "" {
				t.Fatalf("export: %+v %v", result, err)
			}
			z, err := zip.OpenReader(archive)
			if err != nil {
				t.Fatal(err)
			}
			defer z.Close()
			found := false
			for _, file := range z.File {
				if !strings.HasPrefix(file.Name, "images/") {
					continue
				}
				f, err := file.Open()
				if err != nil {
					t.Fatal(err)
				}
				data, err := io.ReadAll(f)
				f.Close()
				if err != nil || !bytes.Equal(data, c.data) || !strings.HasSuffix(file.Name, "."+c.format) {
					t.Fatalf("wrong archive image %s: %v", file.Name, err)
				}
				found = true
			}
			if !found {
				t.Fatal("archive has no image")
			}
		})
	}
}

func TestImportImageRejectsUnsupportedAndOversized(t *testing.T) {
	var huge bytes.Buffer
	if err := png.Encode(&huge, image.NewGray(image.Rect(0, 0, 16001, 1))); err != nil {
		t.Fatal(err)
	}
	w := workspace(t)
	for _, data := range [][]byte{[]byte("<html><svg/></html>"), box("ftyp", []byte("heic\x00\x00\x00\x00mif1")), huge.Bytes()} {
		_, err := w.ImportImage(w.State().Current.ID, "fake.svg", base64.StdEncoding.EncodeToString(data))
		if err == nil || err.Error() != "请选择 PNG、JPEG、GIF、WebP、SVG、AVIF 或 BMP 图片，最长边不超过 16000 像素" {
			t.Fatalf("import error: %v", err)
		}
	}
}
