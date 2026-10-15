# 分栏预览 0.3.0 验证记录

**日期**：2026-10-15
**基线**：`60288b5`
**范围**：Task 3 浏览器验收、文档、版本与生成产物

## 结果

以下命令均以退出码 0 完成：

```sh
go test ./...
go vet ./...
node_modules/.bin/tsc --noEmit
node scripts/check-editor.mjs
npx --yes bun@1.4.3 scripts/check-editing.ts
npx --yes bun@1.4.3 scripts/check-rendering.ts
python3 scripts/check-preview.py
node scripts/build.mjs
go build -o /tmp/liubai-preview-acceptance .
go tool mygo generate
node scripts/build.mjs
go test ./...
go vet ./...
node_modules/.bin/tsc --noEmit
```

最终浏览器验收使用已安装的 Chrome channel、端口 `4195` 和 `mktemp` 创建的独立数据目录：

```sh
data_dir="$(mktemp -d /tmp/liubai-preview-data.XXXXXX)"
python3 $WEBAPP_TESTING/scripts/with_server.py \
  --server "/tmp/liubai-preview-acceptance -web 127.0.0.1:4195 -data-dir $data_dir" \
  --port 4195 -- python3 scripts/check-split-preview.py http://127.0.0.1:4195
```

结果为 `PASS`。覆盖共享渲染与只读任务、模式/撤销历史、跨块软跟随、手动阅读滚动独立、合成 composition guard、重载/新文稿/Recent 偏好、本地图片与 HTML 下载、保存后图片重试、换稿后延迟 `ReadImage` 隔离、主题/字号，以及 `1440x900`、`1120x820`、`800x700`、`680x540` 响应式布局。

截图目录：

`$TMPDIR/liubai-preview-qa-8cqollz3`

四张截图均已检查。`680x540` 底部仍可见已知 Chrome 截图栅格重复；同次 DOM 断言确认只有一个顶层 `.topbar`、零个 `iframe`，并确认上下 pane 边界、首个阅读块可见、根页面无横向溢出，因此没有发现新的实际布局问题。

## 验证边界

- composition 回归是合成事件，不代表 macOS 原生中文输入法候选验证。
- 未执行系统 PDF 对话框或 PDF 最终分页验证。
- 未执行跨应用富文本粘贴验证；只验证共享交付 DOM。
- 未生成正式通用安装包，也未声明 codesign、Gatekeeper、公证或 stapler 通过。这些由 parent 在最终整分支审查后执行。
