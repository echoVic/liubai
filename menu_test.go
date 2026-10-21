package main

import (
	"context"
	"strings"
	"testing"

	"liubai/locales"

	"github.com/egoist/mygo"
)

func TestMenuTemplateUsesChineseLabelsAndStandardItems(t *testing.T) {
	items := menuTemplateFor("darwin", locales.In("zh-Hans"), func(string) func(*mygo.MenuItem, *mygo.Window) { return nil })
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

func TestAppMenuOffersCheckForUpdatesAfterAbout(t *testing.T) {
	for _, tt := range []struct{ locale, about, label string }{
		{"zh-Hans", "关于留白", "检查更新…"},
		{"en", "About Liubai", "Check for Updates…"},
	} {
		t.Run(tt.locale, func(t *testing.T) {
			items := menuTemplateFor("darwin", locales.In(tt.locale), func(string) func(*mygo.MenuItem, *mygo.Window) { return nil })
			app := items[0].Submenu
			if len(app) < 4 || app[0].Label != tt.about {
				t.Fatalf("app menu must start with %q", tt.about)
			}
			if label := locales.Catalog.Format(tt.locale, "bMenuCheckForUpdates", nil); label != tt.label {
				t.Errorf("catalog label = %q, want %q", label, tt.label)
			}
			if app[1].Label != tt.label || app[1].Click == nil {
				t.Errorf("item after About = %+v, want %q with Click", app[1], tt.label)
			}
			if app[2].Type != mygo.MenuItemSeparator || app[3].Role != mygo.RoleHide {
				t.Error("Check for Updates must be followed by a separator and Hide")
			}
		})
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
	walk(menuTemplateFor("darwin", locales.In("zh-Hans"), func(string) func(*mygo.MenuItem, *mygo.Window) { return nil }))
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

func TestFileMenuOffersOpenRecentAfterOpen(t *testing.T) {
	for _, menu := range menuTemplateFor("darwin", locales.In("zh-Hans"), func(string) func(*mygo.MenuItem, *mygo.Window) { return nil }) {
		if menu.Label != "文件" {
			continue
		}
		for i, item := range menu.Submenu {
			if item.Label == "打开文稿…" && i+1 < len(menu.Submenu) {
				next := menu.Submenu[i+1]
				if next.Role == mygo.RoleOpenRecent && next.Label == "打开最近使用" {
					return
				}
			}
		}
	}
	t.Fatal("文件菜单的打开文稿…之后应为打开最近使用")
}

func TestEditMenuOffersPastePlainAfterPaste(t *testing.T) {
	for _, menu := range menuTemplateFor("darwin", locales.In("zh-Hans"), func(string) func(*mygo.MenuItem, *mygo.Window) { return nil }) {
		if menu.Label != "编辑" {
			continue
		}
		for i, item := range menu.Submenu {
			if item.Role == mygo.RolePaste && i+1 < len(menu.Submenu) {
				next := menu.Submenu[i+1]
				if next.Label == "粘贴为纯文本" && next.Accelerator == "CmdOrCtrl+Shift+V" {
					return
				}
			}
		}
	}
	t.Fatal("编辑菜单的粘贴之后应为粘贴为纯文本（CmdOrCtrl+Shift+V）")
}

func TestFileMenuOffersCaptureAfterOpenRecent(t *testing.T) {
	for _, menu := range menuTemplateFor("darwin", locales.In("zh-Hans"), func(string) func(*mygo.MenuItem, *mygo.Window) { return nil }) {
		if menu.Label != "文件" {
			continue
		}
		for i, item := range menu.Submenu {
			if item.Role == mygo.RoleOpenRecent && i+1 < len(menu.Submenu) {
				next := menu.Submenu[i+1]
				if next.Label == "随手记" && next.Accelerator == "" {
					return
				}
			}
		}
	}
	t.Fatal("文件菜单的打开最近使用之后应为随手记，无快捷键")
}

func TestMenuTemplateEnglishLabelsAndLanguageChoices(t *testing.T) {
	items := menuTemplateFor("darwin", locales.In("en"), func(string) func(*mygo.MenuItem, *mygo.Window) { return nil })
	labels := map[string]*mygo.MenuItem{}
	var walk func([]*mygo.MenuItem)
	walk = func(items []*mygo.MenuItem) {
		for _, item := range items {
			labels[item.Label] = item
			walk(item.Submenu)
		}
	}
	walk(items)
	for _, label := range []string{"File", "Edit", "View", "Window", "New Document", "Open Recent", "Paste as Plain Text", "Quick Note", "Follow System", "简体中文", "English"} {
		if labels[label] == nil {
			t.Errorf("missing English menu label %q", label)
		}
	}
	for _, label := range []string{"Follow System", "简体中文", "English"} {
		if item := labels[label]; item != nil && item.Type != mygo.MenuItemRadio {
			t.Errorf("language %q is not a radio item", label)
		}
	}
}

func TestLanguageChoicesAreInsideViewMenu(t *testing.T) {
	items := menuTemplateFor("darwin", locales.In("en"), func(string) func(*mygo.MenuItem, *mygo.Window) { return nil })
	for _, item := range items {
		if item.Label == "Language" {
			t.Fatal("Language must be inside View")
		}
		if item.Label != "View" {
			continue
		}
		for _, child := range item.Submenu {
			if child.Label == "Language" && len(child.Submenu) == 3 {
				return
			}
		}
	}
	t.Fatal("View > Language must contain three choices")
}

func TestWindowsMenusFollowWindowsHabits(t *testing.T) {
	for _, tt := range []struct{ locale, file, exit, help, updates, about string }{
		{"zh-Hans", "文件", "退出", "帮助", "检查更新…", "关于留白"},
		{"en", "File", "Exit", "Help", "Check for Updates…", "About Liubai"},
	} {
		t.Run(tt.locale, func(t *testing.T) {
			items := menuTemplateFor("windows", locales.In(tt.locale), func(string) func(*mygo.MenuItem, *mygo.Window) { return nil })
			if len(items) != 4 || items[0].Label != tt.file || items[3].Label != tt.help {
				t.Fatalf("menus %d: want File, Edit, View and Help", len(items))
			}
			file := items[0].Submenu
			if exit := file[len(file)-1]; exit.Role != mygo.RoleQuit || exit.Label != tt.exit {
				t.Errorf("File ends with %+v, want %q", exit, tt.exit)
			}
			help := items[3].Submenu
			if len(help) != 3 || help[0].Label != tt.updates || help[0].Click == nil || help[1].Type != mygo.MenuItemSeparator || help[2].Label != tt.about || help[2].Click == nil {
				t.Errorf("Help menu %+v", help)
			}
			var walk func([]*mygo.MenuItem)
			walk = func(list []*mygo.MenuItem) {
				for _, item := range list {
					switch item.Role {
					case mygo.RoleHide, mygo.RoleHideOthers, mygo.RoleUnhide, mygo.RoleFront, mygo.RoleZoom, mygo.RoleClose:
						t.Errorf("Windows menus hold the macOS item %q", item.Role)
					}
					walk(item.Submenu)
				}
			}
			walk(items)
			// Since MyGo 0.6 the page keeps these roles' keys, so Ctrl+V still
			// pastes web pages, Word and screenshots as Markdown.
			edit := map[mygo.MenuRole]bool{}
			for _, item := range items[1].Submenu {
				edit[item.Role] = true
			}
			for _, role := range []mygo.MenuRole{mygo.RoleCut, mygo.RoleCopy, mygo.RolePaste, mygo.RoleSelectAll} {
				if !edit[role] {
					t.Errorf("the Edit menu lacks %q", role)
				}
			}
		})
	}
}

func TestWindowsMenuShortcuts(t *testing.T) {
	got := map[string]string{}
	var walk func([]*mygo.MenuItem)
	walk = func(items []*mygo.MenuItem) {
		for _, item := range items {
			got[item.Label] = item.Accelerator
			walk(item.Submenu)
		}
	}
	walk(menuTemplateFor("windows", locales.In("zh-Hans"), func(string) func(*mygo.MenuItem, *mygo.Window) { return nil }))
	// Chinese input methods switch to Traditional Chinese on Ctrl+Shift+F.
	for label, key := range map[string]string{"专注模式": "F8", "重做": "Ctrl+Y", "撤销": "CmdOrCtrl+Z", "阅读模式": "CmdOrCtrl+Shift+R", "粘贴为纯文本": "CmdOrCtrl+Shift+V"} {
		if actual, exists := got[label]; !exists || actual != key {
			t.Errorf("menu %q shortcut = %q (exists %v), want %q", label, actual, exists, key)
		}
	}
}
