# 性能修复：验证记录

对应[性能报告](../../performance/2026-10-24-0.6.3.md)，随 0.6.4 发布。

## 自动检查

发布前在与 v0.6.4 相同的代码上运行：

- `go test ./...`、`go vet ./...`、`tsc --noEmit`、`go tool mygo i18n check`（498 条消息）、`check-i18n`、`check-editor` 和 `check-themes.mjs` 全部通过。
- 17 项 bun 单元检查全部通过。
  - `check-performance` 新增 30 万字富文稿的三项预算：移动光标低于 8 ms，行中间和段落末尾的输入都低于 10 ms。
  - `check-images`、`check-extras` 新增两类测试：移动光标时复用已收集的范围；普通段落内的输入改为平移位置，5 个定向编辑和 400 个随机编辑的结果与重新扫描一致。
  - `check-math` 新增：300 个不同的公式第二次渲染时不再排版。
  - 每条新测试都先确认会失败；去掉对应的改动或其中的任一条件（变异检查），测试也会失败。
- Chrome 回归 17 项中 15 项通过，其中新加了 `check-word-count`。
  - `check-mermaid` 只有最后一条 CSP 断言失败：Chrome 156 对样例 `<svg onload>` 报告 `script-src-attr`，未改动的 HEAD 一样失败。新加的首帧检查在这条之前，已经通过。
  - `check-images` 在负载约 20–37 时，导入图片后的保存一步偶发失败。单独重跑时，分支、第三批之前的版本和未改动的 HEAD 都能通过。
- WebKit：`check-blocks-webkit`、`check-pdf` 通过。
- CI：Windows（`go vet`、`go test`）和新的 Performance 工作流都在 `7292234` 上通过。Performance 在 macos-latest 上运行，预算放宽一倍；30 万字富文稿上移动光标 4.6 ms、行中间输入 8.8 ms、段落末尾输入 9.7 ms，预算分别为 16 / 20 / 20 ms。
- 拆分成 9 个提交后，每个提交里的 `web/` 都与该提交重新构建的结果一致。在 worktree 里构建时，`node_modules` 必须是真实的目录：用符号链接时，代码分割的分块哈希会不同。

## 没有做的

- **桌面应用实测**：没有在原生应用里实测。性能和功能都在屏幕外的 WKWebView 里测，那是同一个 WebKit。MyGo 在 macOS 上用 `WKURLSchemeHandler` 以 `mygo://localhost/` 提供前端，worker 能否在这种协议下加载，用一个以同样方式注册协议的小程序验证过。
- **Windows 真机**：没有，只有 CI。

## 0.6.4 发布

- 标签 `v0.6.4` 是 `7292234`。构建命令同 [RELEASING.md](../../RELEASING.md)，三个平台一次构建。增量包齐全：每个平台都有从 0.6.3、0.6.2、0.6.1 升级的增量包。
- **检查全部通过。**
  - `codesign`、`spctl`（Notarized Developer ID）、`stapler validate` 和 `hdiutil verify`。
  - macOS 的 arm64 部分和两个 Windows 程序，`vcs.revision` 都是 `7292234`，`vcs.modified=false`。

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `Liubai.0.6.4.dmg` | 11,078,907 | `d38bb97245285f69209b128a48563e445c57be24b38549064d3030d7273c1f32` |
| `Liubai.Setup.0.6.4.amd64.exe` | 6,735,715 | `d6cde06421841466a2dcb29dc2d7a07017507966ca89178aafef274caab9e0ba` |
| `Liubai.Setup.0.6.4.arm64.exe` | 6,035,398 | `4fa80f37fb912ba957026539056d8a1382a38277998164ee0c0132494fceeeff` |

- 发布为最新版。匿名下载三份更新清单和三个安装包，都与本地构建一致，清单中的版本为 0.6.4。
- 网站：echovic-apps `2891f97` 把备用版本改为 v0.6.4。安装包按十进制 MB 取整为 11、7、6 MB，与上一版相同；线上页面已更新。
