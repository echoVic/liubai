package main

import (
	"context"
	"strings"
	"testing"

	"github.com/egoist/mygo"
)

func TestMenuTemplateUsesChineseLabelsAndStandardItems(t *testing.T) {
	items := menuTemplate(func(string) func(*mygo.MenuItem, *mygo.Window) { return nil })
	labels := map[mygo.MenuRole]string{}
	var walk func([]*mygo.MenuItem)
	walk = func(list []*mygo.MenuItem) {
		for _, it := range list {
			if it == nil {
				continue
			}
			if it.Role != "" {
				labels[it.Role] = it.Label
			}
			walk(it.Submenu)
		}
	}
	walk(items)
	for role, want := range map[mygo.MenuRole]string{
		mygo.RoleCut: "剪切", mygo.RoleCopy: "拷贝", mygo.RolePaste: "粘贴", mygo.RoleSelectAll: "全选",
		mygo.RoleHide: "隐藏留白", mygo.RoleHideOthers: "隐藏其他", mygo.RoleUnhide: "全部显示", mygo.RoleQuit: "退出留白",
		mygo.RoleMinimize: "最小化", mygo.RoleZoom: "缩放", mygo.RoleFront: "前置全部窗口",
		mygo.RoleToggleFullScreen: "切换全屏", mygo.RoleClose: "关闭窗口",
	} {
		if labels[role] != want {
			t.Errorf("%s label %q, want %q", role, labels[role], want)
		}
	}
}

func TestSaveHTMLRejectsOversizedContentBeforeDialog(t *testing.T) {
	d := &Desktop{}
	r, err := d.SaveHTML(context.Background(), "文稿", strings.Repeat("x", (64<<20)+1))
	if err == nil || err.Error() != "HTML 过大，请改用 ZIP 导出" {
		t.Fatalf("SaveHTML error = %v", err)
	}
	if r.Path != "" || r.Cancelled {
		t.Fatalf("SaveHTML result = %+v", r)
	}
}

func TestMenuUsesToolbarNamesAndShortcuts(t *testing.T) {
	got := map[string]string{}
	var walk func([]*mygo.MenuItem)
	walk = func(items []*mygo.MenuItem) {
		for _, item := range items {
			got[item.Label] = item.Accelerator
			walk(item.Submenu)
		}
	}
	walk(menuTemplate(func(string) func(*mygo.MenuItem, *mygo.Window) { return nil }))
	for label, key := range map[string]string{
		"导出…": "", "专注模式": "CmdOrCtrl+Shift+F", "外观与排版…": "",
		"切换分栏": "CmdOrCtrl+\\", "阅读模式": "CmdOrCtrl+Shift+R",
		"显示 Markdown 源码": "CmdOrCtrl+Shift+M", "所有操作…": "CmdOrCtrl+K",
	} {
		if actual, exists := got[label]; !exists || actual != key {
			t.Errorf("menu %q shortcut = %q (exists %v), want %q", label, actual, exists, key)
		}
	}
}
