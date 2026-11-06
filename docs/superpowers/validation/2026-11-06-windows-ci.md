# Windows CI 失败：验证记录

对应 `main` 上的 `671fc45`（修复）与 `d981488`（加强小窗口字号测试），接在 [0.7.0 发布验证](2026-11-05-release-0.7.0.md)之后。这次只改测试和测试辅助函数，没有改动产品代码。

## 现象

Windows CI（`windows-latest` 上的 `go vet ./...` 与 `go test ./...`）从 2026-10-29 的提交 `023b6bb8` 起持续失败，此前最后一次通过是 2026-10-27 的 `8bf8e58`。失败的三项：

- `TestDocumentFilterReadOnly`（`filter_contract_test.go`）
- `TestWikiRegisteredScopeRestartAndReadOnly`（`wiki_links_test.go`）
- `TestSettingsSmallWindowCanScrollToTypography`（`settings_test.go`）

三项在 macOS 上都通过。同一份代码在 Windows 上不同次运行结果还不一致：`023b6bb8` 只有 wiki 一项失败，`fa25656` 起 filter 也失败，而这两个提交之间只差一个文档文件。这说明其中含有时机因素。

## 诊断方法

在临时分支 `feat/windows-ci-diagnostics`（诊断提交 `f690eba`）上把合并的断言拆开，新增文件快照差异输出（`searchFilesDiff`、`shortText`），并把 Windows 工作流临时改成 `go test -v ./...`。其中一次运行（[42153695992](https://github.com/echoVic/liubai/actions/runs/42153695992)）就取到了确凿证据，之后该分支已删除。

## 根因一：目录的修改时间（filter、wiki）

失败的字段不是文件内容，而是两个目录的修改时间：

```
modtime "...\001\drafts": 1793934041617716100 -> 1793934041618818900 (delta 1102800 ns)
modtime "...\001\trash":  1793934041618239800 -> 1793934041618818900 (delta 579100 ns)
```

没有任何文件的 Data / Mode / ModTime 变化，也没有新增、删除路径；工作区状态、通知和语言断言都通过。`drafts` 和 `trash` 正好是用例启动时被写过的两个目录：

- `workspace(t)` 里的 `newLocked` 写 `drafts/<id>.json`（`workspace.go:508`）；
- `openFile` 的 `w.Open` 再持久化一份草稿（`workspace.go:500`）；
- `activate` 把空的临时草稿移进 `trash/`（`workspace.go:398-401`、`369-392`）；
- wiki 用例还多一次 `openWorkspace` 的 quarantine（`workspace.go:410`）。

两个只读查询本身是纯读的：`FilterDocuments`（`filter.go:37`）、`Backlinks` 与 `ResolveWikiLink`（`wiki_links.go:92`、`41`）只调用 `searchSnapshot()`（`search.go:76`）在锁内复制文稿，不会 `State()`、`check()` 或 persist，也没有 goroutine。

Windows 的 `DirEntry.Info()` 目录时间来自目录枚举缓存（Go 的 `src/os/dir_windows.go` 使用 `FILE_ID_BOTH_DIR_INFO`），不是 MFT 的实时值，目录句柄关闭时才回写。这与 [golang/go#42637](https://github.com/golang/go/issues/42637) 是同一现象（Go 自己在 `os.TestDirFS` 里用 `os.Stat` + `Chtimes` 绕开）。由此形成的时序是：初始化刚改过这两个目录 → 第一次 `WalkDir` 读到旧缓存 → 遍历自己打开又关闭目录句柄，触发刷新 → 第二次 `WalkDir` 读到新值。`0.58–1.1ms` 的差值和两个目录最终相同的后值，都符合“同一批元数据回写”；缓存何时刷新取决于 Defender、索引器等后台活动，所以会有时通过、有时失败。`TestSearchHasNoSideEffects` 一直通过只是同一竞态下的运气。

**修复**：`searchFiles` 只对普通文件记录修改时间；目录仍记录 Mode 和整棵树（增删仍可比）。真实查询若写文件，内容、文件时间或路径增删必然变化。这里统一处理、不加 `GOOS` 分支，因为 POSIX 下目录时间信号本来就和增删重复。

## 根因二：固定滚动距离与裁剪后的点击（settings）

Windows 上固定滚动 600 DIP 后，控件被视图裁剪：

```
label "Body Font Size" rect={X:236 Y:433.91992 W:72 H:6.1191406}
label "18" rect={X:249 Y:442.91992 W:0 H:0}
after click 18 focused=false has15=false has22=false
```

macOS 同样代码里字号标签在窗口内（y≈417，高 15.3）并可通过。原因有两层：

- MyGo 默认字号在 darwin 是 13、其他平台是 14（`ui/theme.go:98-103`），加上 DirectWrite 行高约 1.33×、CoreText 约 1.177×，Windows 的内容整体更高，字号行落在视口下方；
- 滚出视口的控件被视图裁成边缘上的空矩形（`ui/runtime.go` 的 `intersect` 返回 `{x,y,0,0}`），而 `Tester.Click` 只检查中心点是否落在窗口内（`ui/headless.go` 的 `targetCenter`）。“点击成功”实际打在页脚上方的空白处，下拉菜单没打开，后续按键自然不生效。

所以这是测试对固定滚动距离和盲点击的依赖，不是产品缺陷。真实用户滚到最大滚动量时，字号行是滚动内容的最后一行、底边对齐视口底，完整可见；macOS 的 600 恰好等于它的最大滚动量，测试才一直通过。

**修复**：新增 `revealControl`，以 80 DIP 为步长滚动，只有“点击后菜单真的打开（`Find("15")` 出现）”才算点击生效，未打开就继续滚；测试先断言字号行在滚动前位于折线以下（否则就不是在测滚动），再断言焦点在下拉触发器上、菜单提供 15–22 全部字号，最后用键盘选到 22 并检查分栏和源码偏好保持。`onScreen` 用宽高均为正的矩形且完全在窗口内，避免把被裁的零面积矩形当成可见。

在 macOS 上做了反证：在 typography 前插入 +25 DIP 占位模拟 Windows 的布局后，旧测试以与 Windows CI 逐字相同的消息失败，矩形位置与真实 Windows 数据只差 0.24 DIP；新测试在 640×360/400/500/600/700 全通过，`-count=20` 稳定。移除 typography 段时新测试报“settings did not scroll ... into view”，移除下拉菜单时报“clicking ... did not open its menu”，说明没有被弱化成空测试。

## 验证

- macOS：`go vet ./...`、`go test ./...`（21.259s）通过；小窗口字号测试 `-count=10` 稳定通过；`GOOS=windows GOARCH=amd64` 与 `GOOS=windows GOARCH=arm64` 的 `go vet ./...` 通过。
- Windows CI：
  - 修复提交 `0ce2b8b` 的 [42154241374](https://github.com/echoVic/liubai/actions/runs/42154241374) 通过：378 个用例 PASS、0 FAIL，三项原失败用例分别为 0.04s / 0.14s / 0.12s。
  - `main` 上 `671fc45` 的 [42154587811](https://github.com/echoVic/liubai/actions/runs/42154587811) 通过（`ok liubai 25.572s`）。
  - `main` 上 `d981488` 的 [42154725366](https://github.com/echoVic/liubai/actions/runs/42154725366) 通过。

## 遗留

- 仍没有新增 Windows 真机验收；这次只恢复并加固了 Windows CI 的运行时测试覆盖。
- Windows 的目录时间不再参与只读快照比较。将来若要检测“查询期间创建又删除临时文件”，需要在应用层记录写操作，而不是依赖目录时间戳。
