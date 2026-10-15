# 分栏预览 0.3.0 验证记录

**日期**：2026-10-15
**验收基线**：`60288b5`
**最终代码**：`81185a4`
**范围**：浏览器验收、最终审查、文档、版本、生成产物与正式签名公证

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

`$TMPDIR/liubai-preview-qa-d_umrsvj`

四张最终截图均已检查。`680x540` 首个阅读块可见，本次截图未出现早期 Chrome 截图中的底部重复条带。同次 DOM 断言确认只有一个顶层 `.topbar`、零个 `iframe`，上下 pane 边界正确，根页面无横向溢出。

## 最终审查与修复

整分支审查覆盖 `2059446..139b482`，发现空白分隔行缺少前置块定位，以及分栏载入文稿重复渲染。`81185a4` 一并修复；对修复范围的定向复核确认两项均解决，未发现新增问题。

- 软联动优先选择包含光标行的最小块；无包含块时选择结束行最近的前置块，再按起始行及 DOM 顺序处理并列。
- 新文稿 ID 的载入由控制器负责单次渲染；同 ID 重新载入和另存后图片路径改写仍显式刷新。
- 新增真实浏览器回归先在修复前因空白行定位超时失败，修复后通过。
- 页面重载、新建、Recent 重开和同 ID 载入均断言仅替换一次预览 DOM。

最终修复后重新运行的覆盖命令均通过：

```sh
npm run check
npm run build
go build -o /tmp/liubai-preview-final-fix-acceptance .
python3 scripts/check-preview.py
go test ./...
data_dir="$(mktemp -d /tmp/liubai-preview-final-fix-pass.XXXXXX)"
python3 $WEBAPP_TESTING/scripts/with_server.py \
  --server "/tmp/liubai-preview-final-fix-acceptance -web 127.0.0.1:4196 -data-dir $data_dir" \
  --port 4196 -- python3 scripts/check-split-preview.py http://127.0.0.1:4196
```

最终浏览器输出：

```text
PASS: rendering, readonly tasks, modes/history, separator soft follow, one-render reload/new/Recent/same-ID load, synthetic composition guard, stale image isolation, themes, local images/HTML export, responsive layout
```

同 ID 载入使用合成响应进入真实 `load()` 分支，覆盖原生 ReloadDisk 所用的刷新逻辑；不代表原生文件冲突及系统对话框已实测。

## 实施取舍

- 用阅读容器自身的 `scrollTo` 计算 nearest 定位，避免 `scrollIntoView` 同时滚动编辑区的祖先。若未来改成双向同步，需要重做定位策略。
- 为编辑区和阅读区设置确定高度、`min-height: 0` 与独立滚动容器。若未来改成整页统一滚动，需要调整布局和位置持久化。

## 正式安装包验证

2026-10-15 完成正式构建与验证。构建提交为 `9d046df`，产品代码仍为已审查的 `81185a4`。前端已在最终修复时重建，TypeScript bindings 无变化。使用独立输出目录保留既有 0.2.0 产物：

```sh
go tool mygo build -platform darwin/universal -o build/preview-0.3.0 .
```

用户完成钥匙串授权后，构建成功完成应用签名、DMG 创建及 Apple 公证。最终产物：

- 应用：`build/preview-0.3.0/darwin-universal/Liubai.app`
- 安装包：`build/preview-0.3.0/darwin-universal/Liubai 0.3.0.dmg`，8,212,011 字节（约 7.83 MiB）
- 应用标识：`app.liubai.desktop`；版本与构建版本均为 `0.3.0`
- 架构：`arm64`、`x86_64`；最低系统版本：macOS 13.0
- 签名：`Developer ID Application: Zijie Hu (8LH7PFQJ89)`，启用 hardened runtime；安全时间戳为 2026-10-15 15:18:50

以下命令均以退出码 0 完成：

```sh
package_dir=build/preview-0.3.0/darwin-universal
codesign --verify --deep --strict --verbose=2 "$package_dir/Liubai.app"
codesign -dvv "$package_dir/Liubai.app"
spctl -a -t exec -vv "$package_dir/Liubai.app"
xcrun stapler validate "$package_dir/Liubai.app"
codesign --verify --strict --verbose=2 "$package_dir/Liubai 0.3.0.dmg"
spctl -a -t open --context context:primary-signature -vv "$package_dir/Liubai 0.3.0.dmg"
xcrun stapler validate "$package_dir/Liubai 0.3.0.dmg"
lipo -archs "$package_dir/Liubai.app/Contents/MacOS/Liubai"
hdiutil verify "$package_dir/Liubai 0.3.0.dmg"
```

应用与 DMG 均显示 `valid on disk`、`satisfies its Designated Requirement`；Gatekeeper 均返回 `accepted`、`source=Notarized Developer ID`；两份 stapler 检查均返回 `The validate action worked!`。DMG 完整性检查返回 `checksum ... is VALID`。

DMG SHA-256：

```text
75f52e4281087ec7fab0fc9754041364490607f3869f45e3007b80a75d75ed7f
```

构建后复核原 0.2.0 DMG 和应用二进制的 SHA-256，均与构建前记录相同；原应用 PID `7369` 及其启动时间保持不变。本次未启动新桌面应用，未推送或发布远端版本。

临时构建日志：`/tmp/liubai-preview-production-retry.log`。

## 验证边界

- composition 回归是合成事件，不代表 macOS 原生中文输入法候选验证。
- 未执行系统 PDF 对话框或 PDF 最终分页验证。
- 未执行跨应用富文本粘贴验证；只验证共享交付 DOM。
