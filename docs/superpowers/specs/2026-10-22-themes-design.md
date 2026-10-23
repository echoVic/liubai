# 主题：天光与四时 设计

**日期**：2026-10-22
**状态**：已与用户确认方向、主题清单、外观面板、工程做法和「大纲只留一处」，待写实施计划

## 背景与决定

用户把「非常好看的主题」定为和 Typora、Bear、Obsidian 拉开差距的一个点，要求用合适的设计 skill 来做。这次用 impeccable：先把产品事实记进根目录的 `PRODUCT.md`（中文写作者为主、对标产品、主题不内置字体），再用它的方向流程出候选，用户在样张里挑。

- **方向**：抽签定的主方向是「天光·时辰」（同一张纸在一天不同的光下），impeccable 的推荐是「中国传统色·四时」。用户两个都要，合成**两个系列并列**：天光按一天的时辰排，四时按一年的季节排。两个系列同属「时」，一个是一天之时，一个是一年之时。
- **数量**：共 11 套，深色 4 套。现有四套（纸白、暖纸、雾绿、夜墨）保留，名字和色值不动，只有下文「夜间纪律」会作用到夜墨；新做 7 套。
- **字体**：主题可以换字体，但只在 macOS 和 Windows 自带的字体里搭配，不内置字体。
- **切换**：11 套都能随时手动选；另有「自动切换」四选一（关、跟随系统、跟随天光、跟随四季）。新用户默认「跟随系统」，浅色纸白、深色夜墨，与现在一致。开着自动切换时手动点任一主题，就把自动切换关掉。

不采用的方案：
- **编辑器标准主题包**（GitHub、Solarized、Nord、Dracula 等）：和竞品的主题列表几乎一样。
- **蓝黑墨水**（墨色配纸色、一支红笔）：中文写作者最有亲切感，但文具世界容易滑向横格纸、手写体这类装扮，蓝色正文久读也不如中性墨色耐看。
- 另外五个候选（深色开发者控制台、动物园导览图、克劳威尔网格字样、工厂唱片编目、发射谱线标尺）不适合写作主题，各取一条纪律（见「纪律」）。
- 合并时去掉了和别的主题太像的三套：雪霁（与月白同为浅冷蓝）、紫檀（与灯下同为暖褐深色）、暮色（与暖纸、秋香三套暖色浅主题挤在一起）。

## 主题清单

| 系列 | id | 名称 | English | 时辰 / 季节 | 深浅 | 字体 | 说明 |
|---|---|---|---|---|---|---|---|
| 天光 | `dawn` | 晨光 | Dawn | 卯，5–9 点 | 浅 | 书卷 | 黎明前的珍珠灰，朝霞色的光标（新） |
| 天光 | `paper` | 纸白 | Paper | 午，9–15 点 | 浅 | 书卷 | 正午的白纸，清楚中性（现有） |
| 天光 | `warm` | 暖纸 | Warm | 申，15–19 点 | 浅 | 书卷 | 午后斜阳里的米色纸（现有） |
| 天光 | `lamp` | 灯下 | Lamplight | 戌，19–21 点 | 深 | 书卷 | 台灯下的暖褐，灯黄点睛（新） |
| 天光 | `ink` | 夜墨 | Ink | 亥，21–23 点 | 深 | 书卷 | 克制的深炭夜色（现有） |
| 天光 | `moon` | 月夜 | Moonlight | 子，23–5 点 | 深 | 书卷 | 深夜的蓝灰，月光银蓝（新） |
| 四时 | `mist` | 雾绿 | Mist | 春 | 浅 | 书卷 | 烟雨江南的灰绿（现有） |
| 四时 | `lotus` | 藕荷 | Lotus | 夏 | 浅 | 清朗 | 接天莲叶，莲紫点睛（新） |
| 四时 | `autumn` | 秋香 | Harvest | 秋 | 浅 | 书卷 | 秋香色的纸，秋水石青（新） |
| 四时 | `moonwhite` | 月白 | Moon White | 冬 | 浅 | 清朗 | 月白风清，靛青点睛（新） |
| 四时 | `indigo` | 黛蓝 | Indigo | 夜 | 深 | 清朗 | 远山如黛，一点烫金（新） |

天光的时辰标签取该段时间里的主时辰，范围覆盖相邻时辰：卯含辰，午含巳、未，申含酉，子含丑、寅。色卡上的大字写这个时辰；说明文字只写钟点，例如「5–9 点 · 黎明前的珍珠灰，朝霞色的光标」，不写「卯时 5–9 点」，因为一个时辰只有两小时（卯时是 5–7 点）。英文界面的色卡写每段开始的钟点，一律 12 小时制：5 am、9 am、3 pm、7 pm、9 pm、11 pm。

## 配色

### token

沿用现有 token，作用不变：`--card` 是纸面和工具栏，`--popover` 是菜单、抽屉和对话框，`--background` 是窗口底色，`--muted` 是表头和分段控件底色，`--accent` 是悬停底色，`--primary` 是光标、按钮和选中标记，`--quote` 是引用竖线和引用文字，`--code`、`--highlight`、`--selection` 分别是代码底、`==高亮==` 和选区。

- **新增**：`--font-body`（正文与标题字体，见「字体」），`--syntax-keyword`、`--syntax-string`、`--syntax-type`（代码高亮；浅色主题等于强调色、引用色、链接色，与现在一样；深色主题用低饱和版本）。
- **删除**：`--secondary`、`--secondary-foreground`、`--surface`、`--text-strong`、`--text-muted`、`--card-foreground`、`--destructive-foreground`，全仓库没有引用。
- 选择器从 `:root[data-liubai-theme=…]` 改成 `[data-liubai-theme=…]`，任何元素都能套用某套主题，外观面板的预览色卡因此直接用各主题自己的 token，不再写死色值。
- 根元素另设 `data-liubai-scheme="light|dark"`，与深浅有关的规则（提示块深色配色、夜间纪律、深色不用阴影）挂在它上面，不再逐个列出深色主题。

### 色值

现有四套的色值原样保留，只补上新增 token。下面是 `themes.css` 里 11 套主题的原样摘录，顺序与文件相同；每套都显式声明 `--font-body`（书卷体 `var(--font-song)`，清朗体 `var(--font-hei)`），两个字体栈定义在文件第一行的 `:root` 里（见「字体」），纸白同时是 `:root` 的缺省值：

```css
:root,[data-liubai-theme=paper]{color-scheme:light;--background:#e9e9e7;--foreground:#242523;--card:#fafaf8;--popover:#ffffff;--popover-foreground:#242523;--primary:#4e675e;--primary-foreground:#ffffff;--muted:#eeeeeb;--muted-foreground:#61665f;--accent:#dce3df;--accent-foreground:#26342f;--destructive:#9c433d;--border:#d2d3cf;--input:#bfc2bc;--ring:#496f61;--link:#315f82;--quote:#4c665c;--code:#eef0ed;--highlight:#eee2a5;--selection:#bdd6ca;--syntax-keyword:#4e675e;--syntax-string:#4c665c;--syntax-type:#315f82;--font-body:var(--font-song)}
[data-liubai-theme=warm]{color-scheme:light;--background:#e9e2d7;--foreground:#352d27;--card:#fbf5e9;--popover:#fff9ef;--popover-foreground:#352d27;--primary:#835f48;--primary-foreground:#fffaf3;--muted:#eee5d7;--muted-foreground:#685d53;--accent:#ead8c4;--accent-foreground:#4d392c;--destructive:#9a443a;--border:#d8cab9;--input:#c7b6a3;--ring:#8b6046;--link:#76523d;--quote:#785d49;--code:#f1e7d8;--highlight:#edd59b;--selection:#dfc5a7;--syntax-keyword:#835f48;--syntax-string:#785d49;--syntax-type:#76523d;--font-body:var(--font-song)}
[data-liubai-theme=mist]{color-scheme:light;--background:#dfe5e0;--foreground:#26342e;--card:#f3f5ef;--popover:#f8faf5;--popover-foreground:#26342e;--primary:#416556;--primary-foreground:#ffffff;--muted:#e2e9e3;--muted-foreground:#52645b;--accent:#cddcd2;--accent-foreground:#263c32;--destructive:#974a43;--border:#c4d0c7;--input:#afbeb3;--ring:#426b59;--link:#356774;--quote:#3e6656;--code:#e2eae3;--highlight:#d9dea0;--selection:#b6d2c1;--syntax-keyword:#416556;--syntax-string:#3e6656;--syntax-type:#356774;--font-body:var(--font-song)}
[data-liubai-theme=ink]{color-scheme:dark;--background:#191b1a;--foreground:#e7e5de;--card:#242624;--popover:#292b29;--popover-foreground:#e7e5de;--primary:#9bb5aa;--primary-foreground:#14201b;--muted:#2d302d;--muted-foreground:#afb1aa;--accent:#39443e;--accent-foreground:#f0f1eb;--destructive:#d1796e;--border:#454844;--input:#5a5d57;--ring:#a9c9bb;--link:#9bc7df;--quote:#acc6b9;--code:#1c1e1d;--highlight:#655b2d;--selection:#3f6557;--syntax-keyword:#a3c3b6;--syntax-string:#a1bcae;--syntax-type:#9fb9c7;--font-body:var(--font-song)}
[data-liubai-theme=dawn]{color-scheme:light;--background:#e1dfe8;--foreground:#252534;--card:#f6f5fc;--popover:#fbfbfe;--popover-foreground:#252534;--primary:#a44d4d;--primary-foreground:#fefbfa;--muted:#eae9f2;--muted-foreground:#5e5e71;--accent:#f5e3e2;--accent-foreground:#2a293a;--destructive:#a83630;--border:#cfcdd7;--input:#bab8c3;--ring:#aa5352;--link:#3d5787;--quote:#4d4d63;--code:#ebe9f2;--highlight:#f5deb5;--selection:#f7d7d5;--syntax-keyword:#a44d4d;--syntax-string:#4d4d63;--syntax-type:#3d5787;--font-body:var(--font-song)}
[data-liubai-theme=lamp]{color-scheme:dark;--background:#18130e;--foreground:#e1d6c3;--card:#221c16;--popover:#28221c;--popover-foreground:#e1d6c3;--primary:#e7aa5b;--primary-foreground:#140e09;--muted:#2a231d;--muted-foreground:#aba08e;--accent:#352c24;--accent-foreground:#ebe0cd;--destructive:#df8075;--border:#3d352f;--input:#4e463f;--ring:#e7aa5b;--link:#ddb18d;--quote:#b7a897;--code:#1b1611;--highlight:#60491b;--selection:#513b22;--syntax-keyword:#cbb79f;--syntax-string:#c3b19d;--syntax-type:#c5b09e;--font-body:var(--font-song)}
[data-liubai-theme=moon]{color-scheme:dark;--background:#0d131a;--foreground:#d8dfe6;--card:#151d25;--popover:#1a232c;--popover-foreground:#d8dfe6;--primary:#9ec8df;--primary-foreground:#080f17;--muted:#1b242e;--muted-foreground:#9ca2a9;--accent:#222e3a;--accent-foreground:#e2e9f0;--destructive:#df8075;--border:#2d3640;--input:#3e4752;--ring:#9ec8df;--link:#86c5e1;--quote:#a4b0ba;--code:#10171e;--highlight:#574c2c;--selection:#273f56;--syntax-keyword:#a2c0d0;--syntax-string:#a2b7c9;--syntax-type:#9eb9c6;--font-body:var(--font-song)}
[data-liubai-theme=lotus]{color-scheme:light;--background:#e6dae0;--foreground:#31242f;--card:#faf0f5;--popover:#fef6fa;--popover-foreground:#31242f;--primary:#8f4869;--primary-foreground:#fefbfc;--muted:#f0e3ea;--muted-foreground:#6b5a69;--accent:#eed8e1;--accent-foreground:#372835;--destructive:#a83630;--border:#d5c7ce;--input:#c1b2ba;--ring:#964d6f;--link:#5d4980;--quote:#5c4957;--code:#f0e4ea;--highlight:#f4dfb4;--selection:#f3d2e1;--syntax-keyword:#8f4869;--syntax-string:#5c4957;--syntax-type:#5d4980;--font-body:var(--font-hei)}
[data-liubai-theme=autumn]{color-scheme:light;--background:#dfdabc;--foreground:#2d2516;--card:#f3efd7;--popover:#f7f5e1;--popover-foreground:#2d2516;--primary:#135f83;--primary-foreground:#f9fcfe;--muted:#e9e4c5;--muted-foreground:#685f4d;--accent:#e3dfc5;--accent-foreground:#322a1a;--destructive:#a83630;--border:#cec9a8;--input:#b9b491;--ring:#1c6589;--link:#1d4f7e;--quote:#534a31;--code:#e9e4c8;--highlight:#edd898;--selection:#dad2a9;--syntax-keyword:#135f83;--syntax-string:#534a31;--syntax-type:#1d4f7e;--font-body:var(--font-song)}
[data-liubai-theme=moonwhite]{color-scheme:light;--background:#d7e2e9;--foreground:#1c2734;--card:#eef7fd;--popover:#f8fcfe;--popover-foreground:#1c2734;--primary:#2e4685;--primary-foreground:#fafcff;--muted:#e0ecf3;--muted-foreground:#546271;--accent:#dae2f3;--accent-foreground:#202c3a;--destructive:#a83630;--border:#c4d1d8;--input:#afbcc3;--ring:#334c8c;--link:#205684;--quote:#3f4f60;--code:#e1ecf3;--highlight:#efe1b4;--selection:#c8e0f2;--syntax-keyword:#2e4685;--syntax-string:#3f4f60;--syntax-type:#205684;--font-body:var(--font-hei)}
[data-liubai-theme=indigo]{color-scheme:dark;--background:#0b1324;--foreground:#e3ddd2;--card:#131c30;--popover:#192337;--popover-foreground:#e3ddd2;--primary:#e3be7b;--primary-foreground:#070f21;--muted:#19243a;--muted-foreground:#a6a196;--accent:#1f2d4a;--accent-foreground:#ede7dc;--destructive:#df8075;--border:#2b364e;--input:#3c4860;--ring:#e3be7b;--link:#8cc8e0;--quote:#bab0a0;--code:#0e1727;--highlight:#5f5129;--selection:#324263;--syntax-keyword:#c8b99e;--syntax-string:#c0b29c;--syntax-type:#9db9c5;--font-body:var(--font-hei)}
```

### 对比度

按 WCAG 公式计算，纸面上的比值。门槛按现有四套都能通过来定，新做的七套也都高于门槛；`scripts/check-themes` 会按这些门槛检查每一套：正文 ≥ 11，次要文字 ≥ 5，链接 ≥ 5.5，强调色 ≥ 4.5，引用 ≥ 5.5，选区和高亮上的正文 ≥ 5，按钮文字 ≥ 4.5，危险色 ≥ 4.5，夜间代码高亮 ≥ 7。

| 主题 | 纸面 | 正文 | 次要文字 | 链接 | 强调色 | 引用 | 选区上正文 | 高亮上正文 | 按钮文字 | 危险色 | 夜间代码高亮 | 悬停底上的强调色 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 晨光 | `#f6f5fc` | 13.9 | 5.8 | 6.7 | 5.2 | 7.6 | 11.2 | 11.5 | 5.4 | 6.0 | 同强调色、引用、链接 | 4.5 |
| 纸白 | `#fafaf8` | 14.7 | 5.6 | 6.5 | 5.9 | 6.0 | 10.0 | 11.8 | 6.1 | 6.1 | 同强调色、引用、链接 | 4.7 |
| 暖纸 | `#fbf5e9` | 12.4 | 5.9 | 6.4 | 5.2 | 5.6 | 8.2 | 9.4 | 5.5 | 5.9 | 同强调色、引用、链接 | 4.1 |
| 灯下 | `#221c16` | 11.7 | 6.5 | 8.6 | 8.3 | 7.3 | 7.3 | 5.9 | 9.4 | 6.0 | 8.7/8.1/8.1 | 6.7 |
| 夜墨 | `#242624` | 12.1 | 7.0 | 8.4 | 7.0 | 8.4 | 5.2 | 5.4 | 7.7 | 4.8 | 8.0/7.5/7.4 | 4.6 |
| 月夜 | `#151d25` | 12.7 | 6.6 | 9.0 | 9.5 | 7.7 | 8.1 | 6.3 | 10.8 | 6.1 | 8.9/8.2/8.3 | 7.8 |
| 雾绿 | `#f3f5ef` | 11.9 | 5.7 | 5.7 | 5.9 | 5.9 | 8.0 | 9.2 | 6.5 | 5.7 | 同强调色、引用、链接 | 4.6 |
| 藕荷 | `#faf0f5` | 13.2 | 5.7 | 6.9 | 5.7 | 7.4 | 10.6 | 11.3 | 6.2 | 5.8 | 同强调色、引用、链接 | 4.7 |
| 秋香 | `#f3efd7` | 13.1 | 5.4 | 7.3 | 6.1 | 7.6 | 9.9 | 10.7 | 6.8 | 5.6 | 同强调色、引用、链接 | 5.2 |
| 月白 | `#eef7fd` | 13.9 | 5.8 | 7.1 | 8.3 | 7.7 | 11.1 | 11.6 | 8.8 | 6.0 | 同强调色、引用、链接 | 6.9 |
| 黛蓝 | `#131c30` | 12.6 | 6.6 | 9.3 | 9.6 | 7.9 | 7.4 | 5.8 | 10.8 | 6.1 | 8.8/8.2/8.2 | 7.8 |

最后一列是强调色落在悬停底（`--accent`）上的比值，大纲当前项、表格的菜单按钮和深色主题里悬停的块手柄都是这样配色的；只作参考，`check-themes` 不检查，暖纸沿用原来的色值，是 4.1。秋香和晨光的 `--accent` 在完成审查时改过：秋香原来是天蓝 `#b7e2fc`，成了页面上最抢眼的颜色，改为从自家纸色取的 `#e3dfc5`（强调色在上面 5.2，正文 11.3）；晨光从 `#f1dddc` 提亮到 `#f5e3e2`，让强调色在上面也过 4.5。

## 字体

两种搭配，都只用系统字体：

- **书卷**（默认）：`'Iowan Old Style','Songti SC','Noto Serif CJK SC','Source Han Serif SC','Noto Serif SC',Georgia,'Microsoft YaHei',serif`，即现在的编辑区字体。
- **清朗**：`-apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI','Microsoft YaHei','Noto Sans CJK SC',sans-serif`。

天光六套全部用书卷体：同一张纸只换光线，「跟随天光」一天切几次也不会因为换字体而重新排版。四时里藕荷、月白、黛蓝用清朗体，雾绿、秋香用书卷体；「跟随四季」一年只切四次。界面（工具栏、侧栏、菜单）仍用系统无衬线字体，不随主题变化。新装的 macOS 上可靠的中文字体只有宋体、苹方、冬青黑体，所以不用楷体、圆体这类需要用户另行下载的字体。

## 纪律

从落选方向各取一条，作用于全部主题：

1. **深色不用阴影分层**（取自深色开发者控制台）：深色主题里侧栏、工具栏和纸面只用一像素细线和一级明暗差分开；分段控件、侧栏标签的选中态在深色下不用阴影，改用细线。浮层（菜单、对话框）保留现有边框和阴影。
2. **颜色有职责**（取自动物园导览图）：正文只用墨色，强调色只做标记，不承载正文；全部平涂，不加纹理和渐变。
3. **夜间只给当前的东西上色**（取自工厂唱片编目）：深色四套里，光标、选区、当前块手柄和大纲当前项用强调色；链接改成墨色字加彩色细下划线；代码高亮用低饱和的 `--syntax-*`。这条也作用到夜墨。
4. **强调色以细线出现**（取自发射谱线标尺）：链接下划线、引用竖线这类标记都是线，不做色块填充。

没有采用的一条：「标题字号和段距按正文行高的整数倍排」（取自克劳威尔网格字样）。它会改动所有主题共用的间距，现有四套的气质也会跟着变，超出这次的范围。

## 外观面板

「外观与排版」对话框加宽到 600px（窄窗口下仍不超过 `100vw - 32px`）。标题上方不加眉题（原来的「适合此刻的颜色」去掉）；对话框不加遮罩和模糊，选主题时背后的页面直接换色。对话框的上边缘固定：切换自动切换方式时高度会变（跟随系统多出两个下拉框，各模式的说明长短不一），只往下伸缩，指针下的分段控件不会跳动；窗口太矮时对话框在窗口内滚动。其他对话框仍然居中。自上而下：

1. **天光**：一行时辰带，六个按钮等宽排开，每个用该主题自己的纸色和墨色画：大字时辰（宋体）、主题名、底部一道强调色细线。
2. 一行说明：显示指针所在或键盘焦点所在的主题，没有时显示当前生效的主题，例如「暖纸 · 15–19 点 · 午后斜阳里的米色纸」。
3. **四时**：一行五张色卡，左侧一道强调色竖条，主题名用该主题自己的字体，下面标季节。
4. 一行说明，规则同上。
5. **自动切换**：分段控件四选一，下面一行说明当前模式：
   - 关：一直用选中的主题。
   - 跟随系统：两个下拉框，「浅色用」列出 7 套浅色主题，「深色用」列出 4 套深色主题，默认纸白和夜墨。
   - 跟随天光：按当地时间，5 点晨光、9 点纸白、15 点暖纸、19 点灯下、21 点夜墨、23 点月夜。
   - 跟随四季：立春雾绿、立夏藕荷、立秋秋香、立冬月白；系统切到深色时用黛蓝。
6. 字号、行宽和底部提示保持不变。

交互：

- 11 个主题按钮同属一个 `radiogroup`，用游走 tabindex。←/→ 按视觉顺序移到上一个、下一个，↑/↓ 在两组之间跳到同一列（列数不同时取最近的一个），Home/End 到第一个、最后一个。选中状态以生效的主题为准。
- 点主题或按 Enter/空格：选中该主题，并把自动切换设为「关」。
- 命令面板（`⌘K`）里的「切换主题：某某」扩展到 11 套，行为与点按钮相同。

## 自动切换

生效主题由一个纯函数算出：输入是外观设置、当前本地时间、系统是否为深色。

- **关**：用选中的主题。
- **跟随系统**：系统深色用 `darkTheme`，否则用 `lightTheme`。
- **跟随天光**：按本地时间的小时取主题：5–9 晨光，9–15 纸白，15–19 暖纸，19–21 灯下，21–23 夜墨，23–次日 5 月夜（左闭右开）。与系统深浅无关。
- **跟随四季**：系统深色时用黛蓝；否则按日期：立春到立夏前雾绿，立夏到立秋前藕荷，立秋到立冬前秋香，立冬到次年立春前月白。

**节令日期**：用 21 世纪通用公式按年份计算：日 = ⌊Y × 0.2422 + C⌋ − L，Y 为年份后两位；立春（2 月）C = 3.87、L = ⌊(Y − 1) / 4⌋；立夏（5 月）C = 5.52，立秋（8 月）C = 7.5，立冬（11 月）C = 7.438，L = ⌊Y / 4⌋。日期按北京时间定义，在用户本地当天零点切换。已与天文算法（太阳视黄经 315°、45°、135°、225°）逐年核对 2026–2050 年，100 个日期全部一致。

**复核时机**：每 60 秒、窗口重新获得焦点或从后台回到前台、系统深浅变化时，各重算一次；结果与当前不同才更新界面，所以切换发生在边界后一分钟之内。

**淡入**：自动切换（到点，或窗口回到前台后算出不同的主题）只在深浅不变时淡入，即浅换浅、深换深，例如 15 点纸白换暖纸、21 点灯下换夜墨：窗口、工具栏、侧栏、纸面、阅读区和对话框这些大块底色用约 1 秒淡入新主题；只过渡底色，文字颜色立即换。跨深浅的自动切换立即换色，不淡入，例如 19 点暖纸换灯下、5 点月夜换晨光，以及跟随系统、跟随四季时系统深浅变化引起的切换：文字颜色是瞬间翻转的，底色若还在过渡，文字和底色会有零点几秒几乎同色。手动选主题、改自动切换方式或下拉框都立即生效；系统开了「减少动态效果」时也不淡入。启动时和随手记小窗不淡入。

**其他窗口和启动**：

- 随手记小窗用同一个函数，同样每 60 秒复核；设置变化时照旧通过 `liubai-appearance` 本地缓存和事件同步。
- 启动脚本（现在的 `boot.js`）改为从 TypeScript 构建，内含同一个函数，读本地缓存的设置算出生效主题后再绘制，避免先闪一下错误的主题。
- 根元素的 `color-scheme` 跟随生效主题的深浅。

**Windows 原生外观**：Windows 的窗口按钮画在页面上，菜单也跟随应用主题。「关」和「跟随天光」时按生效主题的深浅设置原生外观，生效主题变化时同步。「跟随系统」和「跟随四季」时交给系统（`ThemeSystem`），因为这两种模式要读系统深浅，而原生外观被强制成深色后，页面读到的系统深浅也会跟着变成深色，就再也切不回浅色。macOS 的红绿灯在深浅下一样，菜单和表单保持系统外观，不需要处理。

## 数据结构与迁移

**主题清单** `src/themes.json` 是唯一来源，前端打包时引入，Go 用 `go:embed` 读取：

```json
[
 {"id": "dawn", "series": "hours", "dark": false, "hours": [5, 9]},
 {"id": "paper", "series": "hours", "dark": false, "hours": [9, 15]},
 {"id": "warm", "series": "hours", "dark": false, "hours": [15, 19]},
 {"id": "lamp", "series": "hours", "dark": true, "hours": [19, 21]},
 {"id": "ink", "series": "hours", "dark": true, "hours": [21, 23]},
 {"id": "moon", "series": "hours", "dark": true, "hours": [23, 5]},
 {"id": "mist", "series": "seasons", "dark": false, "season": "spring"},
 {"id": "lotus", "series": "seasons", "dark": false, "season": "summer"},
 {"id": "autumn", "series": "seasons", "dark": false, "season": "autumn"},
 {"id": "moonwhite", "series": "seasons", "dark": false, "season": "winter"},
 {"id": "indigo", "series": "seasons", "dark": true, "season": "night"}
]
```

名称和说明放在 `locales/` 的中英文目录里，不进清单。代码里两个系列叫 `hours`、`seasons`，界面上叫「天光」「四时」（英文 Hours、Seasons）。

**外观设置**（Go 的 `Appearance` 与 TS 的同名类型同步）：

- `theme`：手动选中的主题，11 个 id 之一。
- `auto`：`off`、`system`、`hours`、`seasons`。
- `lightTheme`、`darkTheme`：跟随系统时用的两套，分别只能是浅色、深色主题。
- `followSystem`：只为兼容保留。读取旧设置时，没有 `auto` 就按它迁移：`true` → `system`，`false` → `off`；`lightTheme`、`darkTheme` 缺省为纸白、夜墨。写入时仍写 `followSystem = (auto == "system")`，回退到旧版本时「跟随系统」不丢。

Go 端的 `validTheme` 改为查清单。`Appearance` 调用时：`theme`、`lightTheme`、`darkTheme` 不在清单里，或 `lightTheme` 是深色、`darkTheme` 是浅色，返回已有的 `bUnknownTheme`；`auto` 不是四个取值之一，返回新增的 `bUnknownAutoSwitch`。默认值：`theme = paper`，`auto = system`，`lightTheme = paper`，`darkTheme = ink`。

## 其他覆盖

- **Mermaid**：图表按生效主题的深浅选 `dark` 或 `default` 主题，缓存键和 `data-theme` 仍用主题 id。导出固定用纸白，不变。
- **提示块**：深色配色改为挂在 `data-liubai-scheme=dark` 上，四套深色都用。
- **代码高亮**：编辑区和阅读区都改用 `--syntax-*`。
- **引用**：编辑区和阅读区的引用都用正体，不再是斜体：中文字体没有斜体，浏览器只能把宋体、苹方硬拉斜。
- **文案**：新增 7 个主题名，11 条主题说明替换原来的 4 条，加上两组的标题和副标题、自动切换的四个选项、四条模式说明、两个下拉框标签，约 30 条，中英文都要。原来的「浅色用纸白，深色用夜墨」一条删除。

## 测试

- **对比度与一致性**（新增 `scripts/check-themes`）：从 `themes.css` 读出每套主题的 token，按「对比度」一节的门槛逐项检查；同时核对 `themes.json`、`themes.css` 和中英文文案三者的主题 id 一致。
- **生效主题**（TS 单元测试）：天光六段的边界（如 4:59、5:00、22:59、23:00）、四时四个节令的前一天和当天、跨年（1 月仍是月白）、跟随四季在系统深色时为黛蓝、跟随系统两种深浅、关；旧设置迁移。
- **Go**：设置迁移和校验（深浅不符的 `lightTheme`、`darkTheme` 被拒绝）、`themeSourceFor` 在四种模式下的结果、清单读取。
- **回归脚本**：`check-toolbar`、`check-extras`、`check-blocks`、`check-images`、`check-math`、`check-mermaid`、`check-split-preview` 里写死的四套主题改为读 `themes.json`，11 套都跑；新增外观面板的端到端检查（键盘导航、手动选择关闭自动切换、四种模式的保存和恢复、跟随系统的两个下拉框）。
- **截图**：11 套各在 Chrome 和 WebKit 里截编辑、分栏、阅读三种视图，交给用户过目。
- **桌面应用实测**：在空闲时于屏幕外运行，不抢焦点，检查外观面板、自动切换和随手记小窗。
- **impeccable**：改完界面后跑一次 `impeccable detect`，最后做一次完成审查，并按做出来的结果写 `DESIGN.md`。

## 不在这次范围

- 每套主题专属的 Mermaid 配色（这次只分深浅）。
- 导出跟随主题。导出仍按白纸。
- 官网的主题展示。发版时把 README、`README.en.md` 和官网上「四套主题」的说法改成十一套。
- 「标题字号和段距按行高整数倍排」（见「纪律」）。

## 附：大纲只留一处

窗口够宽、侧栏停靠时，左侧侧栏的「大纲」标签和正文右侧的大纲同时显示同一份目录（例如 1512 宽的 14 寸 MacBook 全屏）。用户确认改成**左边放文稿、右边放大纲**，和 Obsidian 一致。

- **侧栏**：去掉「最近文稿 / 大纲」两个标签，只放最近文稿和搜索。侧栏按钮的提示从「侧栏：最近文稿与大纲」改为「侧栏：最近文稿」。
- **右侧大纲**：保留现在的显示条件（不在分栏、专注模式和全宽行宽下，至少两个一到三级标题，正文右侧空出至少 200px），另加一个开关，记在外观设置里（`outlineHidden`，缺省为显示，与现在一致）。
- **大纲按钮**：顶栏最右端，与左上角的侧栏按钮对称。右侧放得下时，点它显示或隐藏右侧大纲；放不下时（窄窗口、分栏、全宽、侧栏占去空间），点它在按钮下方弹出同一份大纲，点一项跳过去并收起，按 Esc 或点别处也收起，焦点回到按钮。两种情况共用同一个大纲元素，当前章节高亮不变；按钮的 `aria-expanded` 表示大纲此刻是否可见。没有标题时，弹出层沿用已有的提示：「输入 # 标题后，大纲会出现在这里。」
- **命令面板**里的「大纲」与按钮行为相同。专注模式下不显示大纲，也不显示这个按钮。
- **标题层级**：沿用右侧大纲现在的一到三级。原来侧栏的大纲列出一到六级，四到六级标题从此不在大纲里出现。
- **测试**：1512 宽、侧栏停靠时页面上只有一份大纲；开关的保存和恢复；窄窗口、分栏、全宽下弹出、跳转、Esc 收起；现有引用 `#outline-tab` 的回归脚本相应修改。
