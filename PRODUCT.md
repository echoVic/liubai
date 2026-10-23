# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

中文写作者为主：在 Mac 上（另有 Windows 内测版）长时间写和读 Markdown，写公众号、博客、笔记和文档。英文界面是次要市场。（2026-10-22 用户确认）

## Product Purpose

留白是一页就能开始写的 Markdown 编辑器和阅读器：打开就写，没保存的内容自动留成草稿；整页都是纸面，边写边看到格式；文件始终是用户自己的 `.md`。它回应 egoist/mygo#274 想要的「markdown 阅读器和实时编辑器，界面美观简洁」。免费开源（MIT）。

## Positioning

- Markdown 文件编辑器：Markdown 文本是唯一来源，块编辑、表格、图片都只是 CodeMirror 之上的交互层，打开和写回都保持原文，能和其他工具、Git 互通。
- 本地优先：没有广告、遥测和云同步；检查更新只访问 GitHub Releases。
- 对标 Typora、Bear、Obsidian。用户把「非常好看的主题」定为和它们拉开差距的一个点（2026-10-22）。

## Operating Context

- 长时间写作和阅读：编辑、分栏、阅读三种视图，专注模式，侧栏里有最近文稿，大纲在正文右侧。
- 在任何应用里用快捷键唤起「随手记」小窗记下想法。
- 交给别人时导出 PDF、Word、HTML、ZIP，或复制富文本。
- 外观可以跟随系统深浅色；字号和行宽可调。

## Capabilities and Constraints

- 桌面应用：Go 后端（MyGo），界面用 Web 技术，macOS 上是 WKWebView，Windows 上是 WebView2。支持 macOS 13+（Apple 芯片和 Intel），Windows 10/11 为内测版。
- 用户在意安装包体积：0.5.0 专门做过瘦身（DMG 从 12.5 MiB 降到 10.5 MiB）。
- 导出按白纸排版，不随应用主题变化。
- 简体中文和英文界面，默认跟随系统语言。
- 主题分天光、四时两个系列，共 11 套（2026-10-22 在原有纸白、暖纸、雾绿、夜墨之外新增 7 套）；新用户默认「跟随系统」，浅色用纸白、深色用夜墨，也可以跟随天光或四季自动切换。
- 主题不内置字体，只在 macOS 和 Windows 自带的字体里搭配（2026-10-22 用户决定）。新装的 macOS 上可靠的中文字体只有宋体、苹方、冬青黑体，楷体、圆体等要用户自行下载。

## Brand Commitments

- 名称「留白」（Liubai），官网 https://liubai.echovic.com/。
- 图标统一用 Lucide 原版图标（用户要求）。
- 以编辑为主、界面低干扰：0.1.5 应用户要求去掉了纸张卡片和装饰标语（「应该以编辑为主」）。

## Evidence on Hand

- README（中英文）、CHANGELOG、官网的介绍和截图。
- 没有用户证言、客户名单或评测数据，后续工作不得编造。

## Product Principles

1. 以编辑为主：界面退后，文字在前。
2. 文件是用户的：所见即所得只是交互层，写回的永远是干净的 Markdown。
3. 不丢稿：自动草稿，冲突时先暂停，可靠性优先于花样。
4. 美观简洁：好看来自克制和细节，而不是装饰。
