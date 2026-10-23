---
version: 1
slug: "src-themes-css"
primary_target: "src/themes.css"
related_targets: ["src/style.css","src/app.ts","src/index.html"]
---

# 主题系统：天光与四时

范围：`themes.css` 里 11 套主题的 token、「外观与排版」面板、自动切换。模式：Operate（编辑器），阅读视图属 Read。
受众与任务：中文写作者长时间写和读；挑一套好看、耐看的主题，或让它随时辰、季节自动换。
约束：只用系统字体；现有四套色值不动；导出仍按白纸；Windows 原生外观在跟随系统和跟随四季时交给系统。
设计文档：docs/superpowers/specs/2026-10-22-themes-design.md

## Direction contract

THESIS: 主题就是「时」：一天之时（天光六套，同一张纸只换光线）与一年之时（四时五套，有名有姓的传统色）。拒绝编辑器圈通用的 GitHub、Solarized、Nord、Dracula 主题包。

OWN-WORLD: 自然光下的纸与墨。纸面就是主题色（珍珠灰、白、米、炭、暖褐、蓝灰、灰绿、藕荷、秋香、月白、黛蓝），正文只用墨色，强调色只做细线标记；书卷体（Iowan + 宋体）与清朗体（苹方）两种声音；平涂，无纹理无渐变，深色只用细线和一级明暗分层。

STORY: 写作者打开外观面板，看见一天的时辰带和一年的色卡，挑一套，或交给天光、四季去换；写到深夜，界面只给光标、选区和当前项留颜色。

FIRST VIEWPORT: 600px 的外观与排版对话框。顶部「天光」时辰带六格，每格用该主题的纸色和墨色画大字时辰、名称和一道强调色细线，下有一行说明；中部「四时」五张色卡，左侧强调色竖条，主题名用它自己的字体，标季节，下有一行说明；再下是自动切换四选一和模式说明；字号、行宽不变。签名动作：时辰带，加上「跟随天光」。

FORM: 天光·时辰（抽签主方向，自己排序第 6）与中国传统色·四时（impeccable 推荐，自己排序第 1）按用户要求并列成两个系列。seed:121cd12a920052bb

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
