package main

import (
	"context"
	"testing"
)

func TestSaveDOCXRejectsOversizedContentBeforeDialog(t *testing.T) {
	d := &Desktop{}
	r, err := d.SaveDOCX(context.Background(), "文稿", make([]byte, (64<<20)+1))
	if err == nil || err.Error() != "Word 文稿过大，请改用 ZIP 导出" {
		t.Fatalf("SaveDOCX error = %v", err)
	}
	if r.Path != "" || r.Cancelled {
		t.Fatalf("SaveDOCX result = %+v", r)
	}
}
