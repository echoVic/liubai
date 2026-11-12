---
name: "Liubai (留白)"
description: "A one-page Markdown editor whose designed themes are the hours of a day and the seasons of a year, beside a series of established palettes for code and notes: flat paper, one ink, and a mark colour drawn mostly as lines."
colors:
  # Roles. Values are the default theme, Paper (纸白), which is also the :root fallback.
  # Every theme redeclares these roles in src/themes.css. Components read var(--role), never the hex.
  background: "#e9e9e7"
  foreground: "#242523"
  card: "#fafaf8"
  popover: "#ffffff"
  muted: "#eeeeeb"
  muted-foreground: "#61665f"
  accent: "#dce3df"
  border: "#d2d3cf"
  input: "#898e83"
  code: "#eef0ed"
  quote: "#4c665c"
  primary: "#4e675e"
  primary-foreground: "#ffffff"
  ring: "#496f61"
  link: "#315f82"
  destructive: "#9c433d"
  highlight: "#eee2a5"
  selection: "#bdd6ca"
  # The other ten Hours and Seasons themes, each as paper (card), ink (foreground) and mark (primary).
  # The fourteen Studio themes are established palettes; their values live only in src/themes.css.
  dawn-card: "#f6f5fc"
  dawn-foreground: "#252534"
  dawn-primary: "#a44d4d"
  warm-card: "#fbf5e9"
  warm-foreground: "#352d27"
  warm-primary: "#835f48"
  lamp-card: "#221c16"
  lamp-foreground: "#e1d6c3"
  lamp-primary: "#e7aa5b"
  ink-card: "#242624"
  ink-foreground: "#e7e5de"
  ink-primary: "#9bb5aa"
  # Ink (夜墨), the default dark theme, also shows the dark ladder: ground, paper, floating paper, hairline.
  ink-background: "#191b1a"
  ink-popover: "#292b29"
  ink-border: "#454844"
  moon-card: "#151d25"
  moon-foreground: "#d8dfe6"
  moon-primary: "#9ec8df"
  mist-card: "#f3f5ef"
  mist-foreground: "#26342e"
  mist-primary: "#416556"
  lotus-card: "#faf0f5"
  lotus-foreground: "#31242f"
  lotus-primary: "#8f4869"
  autumn-card: "#f3efd7"
  autumn-foreground: "#2d2516"
  autumn-primary: "#135f83"
  moonwhite-card: "#eef7fd"
  moonwhite-foreground: "#1c2734"
  moonwhite-primary: "#2e4685"
  indigo-card: "#131c30"
  indigo-foreground: "#e3ddd2"
  indigo-primary: "#e3be7b"
  # Callout hues: the only colours that do not change with the theme. Light set for light themes, dark set for dark themes.
  alert-note: "#2d64aa"
  alert-tip: "#306f46"
  alert-important: "#7d4bb0"
  alert-warning: "#865b0f"
  alert-caution: "#ad3d3d"
  alert-note-dark: "#83b8f6"
  alert-tip-dark: "#8bc79e"
  alert-important-dark: "#c6a1ef"
  alert-warning-dark: "#e1bd6b"
  alert-caution-dark: "#f09c98"
typography:
  # Four family tokens in the :root block of src/themes.css; no stylesheet writes a literal stack (stacks in the Typography section).
  display:
    fontFamily: "var(--font-body)"
    fontSize: "1.9em"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.01em"
  headline:
    fontFamily: "var(--font-body)"
    fontSize: "1.5em"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.01em"
  title:
    fontFamily: "var(--font-body)"
    fontSize: "1.2em"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.01em"
  body:
    fontFamily: "var(--font-body)"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.9
  dialog-title:
    fontFamily: "var(--font-ui)"
    fontSize: "19px"
    fontWeight: 600
  label:
    fontFamily: "var(--font-ui)"
    fontSize: "12px"
    fontWeight: 400
  hour-mark:
    fontFamily: "var(--font-song)"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.15
  season-name:
    fontFamily: "var(--font-body)"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
  code:
    fontFamily: "var(--font-mono)"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.8
  voice-book:
    fontFamily: "var(--font-song)"
  voice-clear:
    fontFamily: "var(--font-hei)"
rounded:
  xs: "2px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  dialog: "12px"
  pill: "30px"
spacing:
  xs: "4px"
  tight: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  page-gutter: "48px"
  paper-width: "760px"
  paper-wide: "920px"
components:
  theme-swatch-hours:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.hour-mark}"
    rounded: "{rounded.lg}"
    height: "88px"
    padding: "0 4px"
  theme-swatch-seasons:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.season-name}"
    rounded: "{rounded.lg}"
    height: "88px"
    padding: "6px 8px 10px 16px"
  segmented:
    backgroundColor: "{colors.muted}"
    rounded: "{rounded.lg}"
    padding: "4px"
  segmented-item:
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
  segmented-item-active:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
  tool-button:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.md}"
    size: "34px"
  tool-button-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
  button-outline:
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "34px"
    padding: "0 8px"
  button-outline-hover:
    backgroundColor: "{colors.accent}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
  button-dialog-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  select:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
  menu:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "6px"
  menu-item:
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "34px"
    padding: "0 8px"
  menu-item-hover:
    backgroundColor: "{colors.accent}"
  tooltip:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
  dialog:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.dialog}"
    padding: "24px"
    width: "470px"
  dialog-appearance:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    typography: "{typography.dialog-title}"
    rounded: "{rounded.dialog}"
    padding: "24px"
    width: "600px"
  outline-item:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  outline-item-current:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
---

# Design System: Liubai (留白)

## Overview

**Creative North Star: "The Page in Natural Light"**

Liubai is one page to write on. The chrome steps back and the page takes the colour of its theme. There are twenty-five themes in three series. The two designed series make each theme a sheet of paper and a colour of ink under a particular light: six follow the hours of a day (天光, Hours) and five follow the seasons of a year (四时, Seasons). Their papers are pearl grey, white, ivory, charcoal, warm brown, blue-grey, grey-green, lotus pink, olive gold, moon white and deep indigo. The third series, Studio (工作坊), carries fourteen established palettes for people who write code and notes: GitHub, Solarized, Monokai, Nord, One Dark and One Light, Dracula, Catppuccin, Gruvbox and Rosé Pine, some in a light and a dark flavour. Body text is always ink. A theme's mark colour shows as thin lines and small marks, and fills only the few primary buttons.

The system is flat and low-interference, following the product principle of editing first. Surfaces are separated by 1px hairlines and at most one tonal step; only a layer that floats above the page casts an ambient shadow. Nothing is textured, gradient or decorative. Hover is instant. Floating layers enter in under 200ms; the one authored moment is the one-second crossfade when the automatic switch turns one light theme into another, or one dark theme into another, as the hour or the season changes.

Two voices speak on the page, both system fonts: a book voice (Iowan Old Style with Songti) and a clear voice (PingFang, the system sans). Each theme picks one for its page, and the chrome around the page always stays in the UI sans.

Confirmed visual rejections: the stock editor theme packs (GitHub, Solarized, Nord, Dracula) as palettes for Hours or Seasons, whose themes are designed for Liubai; those palettes live in Studio, the series made for them. Stationery costume (ruled paper, handwriting faces). Decorative paper cards and slogans around the editor (removed in 0.1.5 at the user's request).

**Key Characteristics:**
- Twenty-five themes, one role vocabulary: every theme declares the same 22 colour roles and a body voice in `src/themes.css`, and components only read `var(--role)`.
- Three series: Hours (by local time, six themes, all in the book voice), Seasons (by solar term, five themes, three in the clear voice) and Studio (fourteen established palettes, picked by hand or as the light or dark theme of Follow System, all in the clear voice).
- Flat paper: no texture, no gradient, no theme-specific imagery.
- Colour has jobs: ink for text, hairlines for structure, the mark colour for the caret, small marks and the primary buttons, the link colour for links in light themes.
- The thirteen dark themes separate surfaces with hairlines and one tonal step, and colour only the current thing.
- System fonts only, Lucide icons only, chrome in 11 to 13px UI sans.
- Exports and print ignore the theme and stay white paper.

## Colors

A paper-and-ink palette: flat papers, one ink per theme, and one mark colour drawn as a line or a small mark, filled only in the primary buttons.

Hex values in this section are the default theme's, Paper (纸白), which is also the `:root` fallback; the frontmatter lists them under their role names. Every theme redeclares the same roles in `src/themes.css`, and components read `var(--card)`, `var(--primary)` and the rest, never a hex. One naming trap: the role called `accent` is the quiet hover fill. The theme's accent colour is `primary`.

### Primary
- **Mark (`primary`)** (#4e675e in Paper, a moss green): the caret, each swatch's own underline or spine, the block insertion line, the 1px inset ring on a selected tile, the outline of the current find match, small handles and checkboxes, and the fill of the primary buttons. It never carries a paragraph. Every theme has its own (see the themes below).
- **Focus Ring (`ring`)** (#496f61): the 2px keyboard focus ring, and a swatch's selected and hover ring. It tracks the mark colour and is held at 3:1 or more on paper and on floating paper in every theme.
- **On Mark (`primary-foreground`)** (#ffffff): text on a filled mark colour: Quick Note's save button and a dialog's submit or primary button. It is also the text of the one destructive button. Held at 4.5:1 or more on the mark colour.

### Secondary
- **Link (`link`)** (#315f82, a river blue): link text in light themes, underlined at a 3px offset. In dark themes the text turns ink and the colour moves to the underline. Held at 5.5:1 or more on paper.
- **Rust (`destructive`)** (#9c433d): destructive actions; error text mixes it 80% with ink. Held at 4.5:1 or more on paper.

### Tertiary
- **Highlight (`highlight`)** (#eee2a5): the background of ==marked== text. Ink on it is held at 5:1 or more.
- **Selection (`selection`)** (#bdd6ca): the text selection and a selected block. Ink on it is held at 5:1 or more.
- **Callout hues** (light: note #2d64aa, tip #306f46, important #7d4bb0, warning #865b0f, caution #ad3d3d; dark: #83b8f6, #8bc79e, #c6a1ef, #e1bd6b, #f09c98): five fixed hues for the five callout kinds, and the only colours that do not change with the theme. The light set serves the light themes and the dark set the dark themes, switched by the root's `data-liubai-scheme`. A callout's title takes its hue, its block takes a 3px rule in the hue and a 9% tint of it over the paper.

### Neutral
- **Paper (`card`)** (#fafaf8): the writing surface and everything level with it: top bar, format bar, status line, reading view and swatch faces.
- **Floating Paper (`popover`)** (#ffffff): the sidebar, menus, dialogs, toast, find panel, tooltip and outline popover. One step lighter than paper in every Hours and Seasons theme, light or dark. Studio keeps its palettes' own: level with the paper in GitHub, GitHub Dark, One Dark, One Light and Catppuccin Latte, a step darker in Dracula and Gruvbox Light.
- **Ground (`background`)** (#e9e9e7): the window colour under everything. The paper covers it in every normal layout, so it is rarely seen.
- **Ink (`foreground`)** (#242523): all body text and headings. Held at 11:1 or more on paper in every theme (11.2 to 15.8 today; 11.7 to 14.7 in Hours and Seasons).
- **Pencil (`muted-foreground`)** (#61665f): secondary text, inactive controls, captions, and the 1px edge of the segmented track. Held at 5:1 or more on paper.
- **Well (`muted`)** (#eeeeeb): recessed tracks (segmented control, view switch, the desktop Settings window's Switch Automatically), table headers and scrollbar tracks. Held 2 or more (OKLab ΔE×100) from paper, so a table head shows on it.
- **Hover Fill (`accent`)** (#dce3df): the quiet fill under hover and under the current item, on the page and in the desktop Settings window (where pressed mixes 10% ink into it). Held 4 or more (OKLab ΔE×100) from paper and floating paper, and 1.5 from the well.
- **Hairline (`border`)** (#d2d3cf): every 1px separator and container edge.
- **Field Line (`input`)** (#898e83): field outlines, outlined buttons, swatch edges and the editor's scrollbar thumb, one step stronger than the hairline.
- **Code Well (`code`)** (#eef0ed): inline code and code blocks.
- **Quote Ink (`quote`)** (#4c665c): quoted text and its 2px rule. Held at 5.5:1 or more on paper.

More roles exist in every block: `popover-foreground` (the ink on floating paper, equal to `foreground`) and `syntax-keyword`, `syntax-string` and `syntax-type` for code highlighting. One more token lives outside the theme blocks: `--shadow`, the colour of shadows and the dialog scrim, set once per scheme (see Elevation).

### The Twenty-Five Themes
Hours: one page under the changing light of a day. All six use the book voice, so the page never reflows as the hours turn.
- **Dawn 晨光** (5 to 9, light): pearl-lilac paper (#f6f5fc), blue-black ink (#252534), dawn-rose mark (#a44d4d).
- **Paper 纸白** (9 to 15, light, the default): plain white paper (#fafaf8), charcoal ink (#242523), moss mark (#4e675e).
- **Warm 暖纸** (15 to 19, light): ivory paper (#fbf5e9), umber ink (#352d27), walnut mark (#835f48).
- **Lamplight 灯下** (19 to 21, dark): lamplit brown paper (#221c16), candle-cream ink (#e1d6c3), lamp-amber mark (#e7aa5b).
- **Ink 夜墨** (21 to 23, dark): charcoal paper (#242624), bone ink (#e7e5de), pale-jade mark (#9bb5aa).
- **Moonlight 月夜** (23 to 5, dark): midnight blue-grey paper (#151d25), silver ink (#d8dfe6), moon silver-blue mark (#9ec8df).

Seasons: the colours of the year, switched at the four solar terms (立春, 立夏, 立秋, 立冬).
- **Mist 雾绿** (spring, light, book voice): rain-mist grey-green paper (#f3f5ef), deep green-black ink (#26342e), cypress mark (#416556).
- **Lotus 藕荷** (summer, light, clear voice): lotus-pink paper (#faf0f5), plum-black ink (#31242f), lotus-plum mark (#8f4869).
- **Harvest 秋香** (autumn, light, book voice): olive-gold paper (#f3efd7), bark-brown ink (#2d2516), river stone-blue mark (#135f83).
- **Moon White 月白** (winter, light, clear voice): moon-white paper (#eef7fd), slate ink (#1c2734), indigo-blue mark (#2e4685).
- **Indigo 黛蓝** (night, dark, clear voice; Follow the Seasons uses it whenever the system is dark): mountain-indigo paper (#131c30), rice-paper ink (#e3ddd2), gilt-gold mark (#e3be7b).

Studio: established palettes for people who write code and notes. No clock follows them; they are picked by hand or as the light or dark theme of Follow System. All fourteen use the clear voice, and each swatch carries a short tag, given here after the name. Their values are in `src/themes.css` only. Where a palette gives two roles one colour that the page draws one on the other (a hover fill, hairline, highlight or code well on paper), the role takes another of that palette's published colours, or its mark colour laid over its ground; `scripts/check-themes.mjs` holds those pairs apart (see Do's). Monokai's rust is its orange, since its pink is the mark.
- **Light (5):** GitHub 代码纸 (码 Code), Solarized 晴窗 (晴 Clear), One Light 素笺 (笺 Letter), Catppuccin Latte 奶霜 (霜 Cream), Gruvbox Light 暖阳 (阳 Sun).
- **Dark (9):** Solarized Dark 夜栈 (栈 Terminal), Monokai 霓虹 (霓 Neon), Nord 极光 (冰 Ice), One Dark 暮蓝 (暮 Dusk), Dracula 吸血 (紫 Violet), Catppuccin 咖啡 (咖 Mocha), Gruvbox 复古 (古 Retro), Rosé Pine 玫瑰 (玫 Rose), GitHub Dark 星夜 (星 Star).

### Named Rules
**The Roles-Not-Hex Rule.** New UI reads roles (`var(--card)`, `var(--primary)`); theme hex lives only in `src/themes.css`. A surface that works in Paper has to work in all twenty-five themes. A new role is declared in all twenty-five theme blocks or in none.

**The Jobs Rule.** Each colour has one job: ink for text, pencil for secondary text, hairlines for structure, the mark colour for the caret, small marks and the primary buttons, the link colour for links. Colour never carries a paragraph, and every fill is flat.

**The Studio Rule.** Hours and Seasons are designed for Liubai and never borrow a stock editor palette. Studio is where established palettes belong: each keeps its source's recognisable paper, ink and accent, mapped onto the same roles and held to the same contrast checks as every other theme.

**The Night Rule.** In the thirteen dark themes (Lamplight, Ink, Moonlight, Indigo and the nine dark Studio palettes) only the current thing is coloured: the caret, the selection, the block handle under the pointer or focus, and the current find match. Links read as ink with a coloured underline. Code uses the `syntax-*` roles, held at 7:1 or more on the dark paper: muted in Lamplight, Ink, Moonlight and Indigo, the palettes' own brighter hues in Studio. A few older accent uses (the table menu button, footnote references, the toast action) still carry colour at night and are not a pattern to copy.

## Typography

**UI Font (`--font-ui`):** the platform sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif
**Book Voice (书卷, `--font-song`):** 'Iowan Old Style', 'Songti SC', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Noto Serif SC', Georgia, 'Microsoft YaHei', serif
**Clear Voice (清朗, `--font-hei`):** -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif
**Mono (`--font-mono`):** 'SFMono-Regular', 'Cascadia Code', Consolas, monospace

The four stacks are declared once, in the `:root` block of `src/themes.css`, and `style.css`, `preview.css` and `capture.css` read only these tokens. Every UI text uses the one UI stack (keyboard hints, the editor's find and go-to-line panels, image notes and captions, the reading view's front matter and the Quick Note page included), and every code text the one mono stack (code blocks, the reading view's code, source mode, front matter in the editor, math and diagram errors), so on Windows all code prefers Cascadia Code and on Linux all UI text has the Noto CJK fallback.

**Character:** A page set either like a book (Iowan with Songti) or in a clear modern sans (PingFang), inside chrome that never changes face. System fonts only, by product decision: themes bundle no font and pair only what a fresh macOS or Windows already ships (Songti and PingFang are reliable there; Kai and rounded faces are not). Each theme names its voice once, in `--font-body`.

### Hierarchy
- **Display** (600, 1.9em, line-height 1.5, 0.01em tracking): the document's H1 in the theme's voice, 34px at the default 18px body. The reading view uses line-height 1.45 and no tracking.
- **Headline** (600, 1.5em, 1.5): H2, 27px at the default.
- **Title** (600, 1.2em, 1.5): H3, 22px at the default. The outline lists H1 to H3 only. H4 is 1.1em and H5 and H6 are 1em, in the editor and the reading view alike (about 20 and 18px at the default), so they follow the chosen size too.
- **Body** (400, 18px, 1.9): document text in the theme's voice, with kerning and legibility rendering in the editor. Font Size offers every size from 15 to 22px, in the web dialog and in the desktop Settings window alike; every heading scales with it because all six are em-based. Measure: the 760px paper less two 48px gutters leaves 664px, about 37 CJK characters at 18px (about 45 in the 920px Wide setting).
- **Dialog Title** (600, 19px): dialog headings, in the UI sans.
- **Label** (400, 12px): the interface's working size for buttons, menu items, segmented items, captions and notes. The chrome's base size is 13px; the status line, the outline label, the tag filter and the details of a recent document are 11px; keyboard hints are 10px, the smallest.
- **Hour Mark** (500, 24px, 1.15): the large Chinese hour character on each Hours swatch (卯 午 申 戌 亥 子; the English locale shows the start time instead), always in the book voice so the six read as one set.
- **Season Name** (600, 20px, 1.2): the theme's name on its Seasons or Studio swatch, set in that theme's own voice.
- **Code** (400, 14px, 1.8 in the editor; 13px, 1.75 in the reading view; inline 0.84em, 1.6): monospace, on the code well.

### Named Rules
**The One Voice Rule.** A theme speaks in one voice on the page: headings and body share `--font-body`. The six Hours themes all use the book voice, so following the hours never reflows the page; the Seasons themes may differ because they change only four times a year. The chrome never takes a theme's voice.

**The System Fonts Rule.** The page and the chrome use only fonts that ship with macOS and Windows. A theme never bundles a font file or names one that needs downloading (the only font files in the app are KaTeX's math faces, used for formulas).

**The Upright Rule.** Quotes and callouts are set upright. Chinese faces have no italic, so the browser can only slant Songti or PingFang.

## Layout

A compact frame around a generous page. The frame is a 64px top bar over a workspace; the page is one centred column of paper. Chrome runs at 11 to 13px with 34px controls; the page runs at 18px with 1.9 line-height.

- **Frame.** The 64px top bar (paper, hairline below, 24px side padding, 24px gaps; 8px gaps under 850px) holds the sidebar button at the left, the document title and save status, and at the right the view switch (Edit, Split, Read), Settings (⌘,), Find, Export, More and Outline. Outline is the right-most item and mirrors the sidebar button. The desktop app hides the Settings button, since ⌘, opens the native Settings window there. In the macOS desktop app the bar leaves the window-button inset plus 12px at the left (88px by default); on Windows it leaves room at the right for the native buttons.
- **Workspace.** Under the bar: the format bar (a centred toolbar, 8px 12px padding, hairline below; under 480px wide, or 819px wide and 400px tall, it stays one row and scrolls sideways), an optional banner, the desk, and an 11px status line. At 1180px and wider the sidebar can dock as a 290px column; narrower it is a 310px drawer over the page.
- **Paper.** One centred column: 760px by default, 920px (Wide) or the full width (Full Width), with 48px side gutters (30px under 850px, 24px under 650px), 42px above the first line and 64px below the last (72px in the reading view). The reading view uses the same width and gutters.
- **Split.** Two equal columns at 820px and wider, joined by a 1px hairline; narrower, the editor and the reading view stack with a 1px hairline between, except in a window 640 to 819px wide and at most 400px tall, which keeps them side by side.
- **Outline.** When the paper leaves 200px or more beside it and the document has two or more headings, the outline sits unboxed on the paper, 24px to the right of the column and at most 240px wide. In Split and Full Width it never sits beside the paper: the Outline button opens it as a popover 6px under the button, at most 280px wide. Focus mode hides the outline and its button.
- **Appearance dialog.** 600px wide (never wider than the window less 32px), with its top edge pinned at the larger of 16px and half the window height less 300px, so the dialog grows downward and the control under the pointer never jumps. A short window scrolls the dialog under a sticky head. Swatch rows are six columns (Hours), five (Seasons) and four (Studio) with a 6px gap, and two columns each under 640px, where the automatic-switch row also stacks.
- **Rhythm.** Spacing steps are 4, 6, 8, 12, 16 and 24px; groups sit 6 to 8px apart and sections 16 to 24px apart.

### Named Rules
**The Padding Rule.** Vertical space around editor lines and block widgets is padding, never margin. CodeMirror measures lines and widgets without their margins, and a margin breaks hover, click and scroll positions.

## Elevation & Depth

A hybrid that leans flat. Surfaces that sit beside or on top of each other (top bar, format bar, paper, status line, docked sidebar, the split divider) are separated by 1px hairlines and at most one tonal step: ground, then paper, then floating paper, which is lighter in every Hours and Seasons theme. In Ink the ladder is ground #191b1a, paper #242624, floating paper #292b29 and hairline #454844. Those surfaces carry no shadow in any theme. Only a layer that floats above the page casts an ambient shadow. Shadows take `--shadow`, which is the ink in the light themes and black in the dark ones, so a floating layer casts a shade in every theme, never a light haze. On dark paper the shade is faint, so there, and in the Studio palettes whose floating paper is level with or darker than the paper, the hairline does most of the separating. A selected tile is marked by a 1px inset ring in the mark colour, never by a lift.

### Shadow Vocabulary
Every shadow is `color-mix(in srgb,var(--shadow) N%,transparent)` at the offsets below. `--shadow` is declared twice beside the callout hues in `src/themes.css`: `var(--foreground)` in `:root` and `#000` under `[data-liubai-scheme=dark]`. The dialog scrim takes it too, at 25%.
- **Dialog** (`0 24px 80px`, 22%): the largest, softest layer; every dialog, the command palette included.
- **Menu and Outline Popover** (`0 8px 30px`, 14%): menus, the outline popover and the find panel.
- **Toast** (`0 4px 25px`, 14%).
- **Exit Focus pill** (`0 4px 24px`, 8%).
- **Image Tools** (`0 3px 12px`, 14%): the image toolbar, the alt-text popover, the footnote tooltip and the tooltip.
- **Floating Sidebar** (`12px 0 40px`, 12%): the sidebar as a drawer over the page; docked, it has none.

### Named Rules
**The Hairline Rule.** Stacked surfaces are separated by a 1px `border` line and at most one tonal step, never by a shadow. A selected tile (segmented control, view switch, the Source toggle) takes a 1px inset mark-colour ring in every theme.

**The Float Rule.** A shadow means "this layer floats above the page": menus, dialogs, toasts, popovers, the find panel, the tooltip, the Exit Focus pill and the floating sidebar. It is soft, `--shadow` at 8 to 22%, and never a hard offset. It always darkens: `scripts/check-themes.mjs` fails a theme whose shadow colour is not darker than its paper and its floating paper.

## Shapes

Small, quiet corners and thin lines. Controls sit at 4 to 6px, groups, swatches and floating layers at 8px, dialogs at 12px, and there is one pill (the Exit Focus button, 30px). Every container edge is a 1px hairline; fields and outlined buttons use the stronger field line. Nothing is clipped into a special shape, masked or textured. Icons are Lucide (1.59.0), drawn at a 1.6 stroke with round caps and joins, 12 to 19px, in the colour of their text.

- **Radii:** 2px for ==highlight== and search and find matches; 4px for inline code, keyboard hints, block handles, the table menu button, the image resize handle and size badge, find controls, document tags and scrollbar thumbs; 6px for tool buttons, outlined and dialog buttons, fields, selects, code blocks, images, the tooltip and the items nested in a group (segmented items, view-switch items, menu items, outline items); 8px for swatches, the segmented track and the view switch, menus, the toast, the outline popover, the find panel, the sidebar search, recent documents, option cards and the Quick Note button; 12px for dialogs and the Quick Note panel (8px on Windows). The image viewer's close button (10px) and the search field's clear glyph (round) are the only other shapes.
- **Focus:** a 2px ring in the `ring` colour, outside the control: 3px for buttons and fields, 2px for selects, swatches and tags, 1px for the view switch and find controls; inside, at -2px, for menu items, list rows and command rows.

### Named Rules
**The Line Rule.** The mark colour arrives as a line, not a block: the caret, the 2px focus ring, the 2px insertion line, the 1px inset ring of a selected tile, the 2px outline of the current find match, the 2px underline on each Hours swatch and the 5px spine on Seasons and Studio swatches. Link and quote colours follow the same habit: a 3px-offset underline and a 2px rule. Fills are reserved for small marks (a resize handle, a checkbox) and the primary buttons: Quick Note's save and a dialog's submit or primary button. The one destructive button fills with rust.

## Components

### Theme Swatches (signature)
Each swatch is a small sheet of its own paper. It carries `data-liubai-theme`, so it paints with that theme's tokens rather than the page's: paper face, field-line edge, ink text. 88px tall, 8px radius, no hover motion.
- **Hours swatch:** the hour character (24px, book voice) with the theme name (12px) beneath it, centred, and a 2px mark-colour line near the foot (36% wide, 6px up). Six equal columns.
- **Seasons and Studio swatches:** the theme name (20px, 600) in the theme's own voice, left-aligned, with the tag (12px, pencil) at the foot (the season for Seasons, a short tag such as 码 or 霓 for Studio), and the mark colour as a 5px spine along the left edge. Five equal columns for Seasons, four for Studio.
- **Selected:** the edge and a 1px inset ring (2px in all) and a 14px Lucide check, all in the swatch's own ring colour. The check sits at the top right on Hours swatches and at the right end of the tag row on Seasons and Studio swatches, clear of long names. Hover draws the same ring.
- **Focus:** a 2px outline, 2px outside, in the dialog theme's ring colour, since it lies on the dialog's paper: the row sets `--dialog-ring` from `--ring` before each swatch redeclares its own.
- **Hover and focus** also change the caption under the row, which names the theme under the pointer or focus, else the theme in use if that row holds it ("暖纸 · 15–19 点 · 午后斜阳里的米色纸").
- **Keyboard:** the twenty-five swatches are one radio group with a roving tab stop. Left and Right walk all of them in order and wrap, Up and Down move to the same column of the row above or below (or its last swatch), Home and End go to the ends. Choosing a swatch turns the automatic switch off.

The selected edge, ring and check are drawn in the swatch's own ring colour, which `scripts/check-themes.mjs` holds at 3:1 on that swatch's paper. The focus outline sits outside the swatch, on the dialog's floating paper, so it takes the current theme's ring, which the same check holds at 3:1 on floating paper; a swatch's own ring there could fall to 1.2:1 (Moon White's on Nord).

### Segmented Control and View Switch
A recessed track with a paper tile for the active choice. The Switch Automatically control (Off, Follow System, Follow the Hours, Follow the Seasons) and the top bar's view switch (Edit, Split, Read) share the pattern.
- **Track:** well fill, a 1px pencil edge, 8px radius and 4px padding.
- **Item:** 12px ink text, 6px radius, 4px 8px padding (view switch: 30px high with 12px side padding); hover takes the hover fill.
- **Active:** paper tile with ink text and a 1px inset mark-colour ring, in every theme.
- **Keyboard:** a radio group; Left and Right move and select.

### Buttons
- **Shape:** 6px radius for tool, outlined and dialog buttons; 8px for the Quick Note button.
- **Tool button:** 34px square (32px wide under 650px), transparent, a 19px Lucide icon in pencil. Hover: hover fill and ink. Focus: 2px ring, 3px outside. Pressed toggles are quiet: the Source toggle in the format bar takes a paper tile with a 1px inset mark ring, and a pressed image-alignment button takes the hover fill with a 1px inset ring.
- **Find:** 34px high, 8px side padding, a 16px icon and a 12px "Find" label in ink; hover and open take the hover fill. Under 480px only the icon shows.
- **Outlined:** 1px field line, 12px label. Export is 34px high with 8px side padding, an 18px icon 6px from its label and a hover fill, and hides its label to become a 34px square under 760px. Dialog actions sit on paper with 8px 12px padding.
- **Primary:** mark fill and `primary-foreground` text, in two places: Quick Note's Save as Draft (8px radius, 8px 16px padding) and a dialog's submit or primary action (Save Name, Apply Link, Continue, Export with Original References), whose hover mixes 12% ink into the mark. Discard Changes and Quit is the one destructive fill. Everywhere else the mark colour is a line.
- **Disabled:** half opacity (tool buttons 0.4, menu items 0.45).
- **Press:** compact controls scale to 96% while pressed, without a transition; full-width rows and option cards answer with their hover fill instead.

### Inputs and Fields
- **Select:** paper fill, 1px field line, 6px radius, 6px 8px padding; focus is a 2px ring, 2px outside.
- **Text field:** paper fill, 1px field line, 6px radius, 12px padding. The sidebar search uses the field line with an 8px radius and 8px padding.
- **Find field:** 34px high, 1px field line, 6px radius; while it has focus its edge turns mark-coloured with a 1px mark ring.
- **Error:** 12px text in rust mixed 80% with ink.

### Navigation
- **Top bar:** see Layout. Tool buttons are 34px with 4px gaps; the document title is a 13px button that truncates at 280px; the save status is 12px pencil (11px under 850px).
- **Sidebar:** floating paper with 24px 16px padding and a 1px hairline at its right edge. Top to bottom: the 28px logo and name (14px, 600, 2px tracking) with New and Close; a 12px pencil "Recent Documents" label; the search field; the tag filter (an 11px label and a select); the list of documents (8px radius, 12px padding; hover and current take the hover fill and a hairline border); Backlinks, a collapsible section under a hairline; and Open Local Markdown under a hairline. A document's 28px remove control appears on hover or focus (always on touch screens) and asks again in rust-mixed text before it removes.
- **Menus:** floating paper, 1px hairline, 8px radius, 6px padding and the menu shadow; items are 34px high with 8px side padding, 12px text and 6px radius; hover takes the hover fill, keyboard focus the hover fill and a 2px ring inside; separators are 1px hairlines; keyboard hints sit right-aligned in pencil and turn ink with the item.
- **Tooltip:** one floating-paper layer for the chrome, with a 1px hairline, 6px radius, the Image Tools shadow and 6px 8px padding. The name is 12px ink and the keys sit right-aligned in pencil, as in the menus; at most 320px wide. It sits 6px under its control, centred, or above it where the window ends first, and stays 8px inside the window. It appears once the pointer has rested 500ms, moves from control to control at once for 800ms after the last one closed, shows at once when Tab, an arrow key, Home or End moves focus, and never fades. Any other key, a press, scrolling, resizing or leaving the window hides it, and a control whose menu is open shows none. Controls declare it with `data-tip` and `data-shortcut`, never `title`.
- **Outline:** items in pencil 12px with 8px vertical padding, indented 12px per heading level; the current item is the hover fill with ink text. Inline, it sits unboxed on the paper under an 11px "Outline" label; as a popover it takes the menu treatment.

### Appearance Dialog (signature surface)
The panel where the system shows itself, in the browser version. A modal dialog on floating paper with a 1px hairline, 12px radius and 24px padding, and no scrim and no blur, so a theme pick repaints the page behind it. Top to bottom: the title and a close tool button; Hours (a 13px bold title with a 12px pencil subtitle on one baseline, six swatches, a caption); Seasons (the same, five swatches); Studio (the same, fourteen swatches in rows of four); a hairline; Switch Automatically (label left, segmented control right) with a 12px note beneath it; in Follow System mode two labelled selects (Light, Dark), each listing every theme of that scheme; Font Size and Line Width selects; a 12px footnote. The other dialogs are centred (470px wide unless they need more) and keep a scrim of `--shadow` at 25% (ink in the light themes, black in the dark ones) with a 4px blur.

### Desktop Settings Window
In the desktop app Settings is a native window drawn with MyGo's UI toolkit, in the current theme's colours (floating paper as its background, paper for its cards, the mark as its accent) and, for book-voice themes, Songti SC on macOS and Georgia on Windows. 720 by 760px (at least 640 by 500), 24px padding, with three tabs (Appearance, Quick Note, Language), a footnote and a Feedback link at the foot; Escape and ⌘W close it.
- **Theme cards:** the same three series, each under a 15px bold title. Cards are 96px tall with a 9px radius and a 1px edge in their own hairline. The selected card's edge is its own mark colour with a 1px inset ring of it inside (2px in all, as on the page, so the content does not move), and hover draws the 1px edge in it. Hours cards centre a 28px tag over a 13px name with a 32 by 2px mark line near the foot. Seasons and Studio cards set the name at 21px bold (17px in English) over a 12px pencil tag, with a 4px mark spine. A 14px check in the mark colour sits at the top right of an Hours card and at the right end of the tag row on Seasons and Studio cards. Rows are six columns for Hours, five for Seasons and four for Studio, three under 640px, 8px apart.
- **Switch Automatically:** a well track with a 1px hairline, 3px padding and an 8px radius; items have 7px 10px padding and a 5px radius. The chosen item is a floating-paper tile with a 1px inset mark ring, as on the page: in Nord, Catppuccin, Gruvbox and Rosé Pine the floating paper and the well are one colour, and the ring is what shows the choice.
- **Hover and press:** buttons and menu rows take the hover fill (`accent`) under the pointer, and pressed mixes 10% ink into it; both differ from paper and floating paper in every theme (a Go test holds them 4 or more apart, OKLab ΔE×100). A select's highlighted option takes the mark fill with on-mark text.
- **Font Size** offers 15 to 22px; Line Width offers Comfortable, Wide and Full Width.

### Automatic Theme Switch (motion)
When the hour or season turns, or the window returns to the front with a different answer, and the new theme has the same scheme as the old (light to light, dark to dark), the large surfaces crossfade their background colour over 1s ease: the page, top bar, format bar, sidebar, desk, paper, editor, status line, reading view, outline and dialogs. Text colour changes at once. A switch across light and dark is instant, as are manual picks, the first paint, the Quick Note window and the system's reduced-motion setting. Hover is instant everywhere. The other motion is small: a 150ms opacity fade of the chrome in Focus mode, and entrances for floating layers (the sidebar drawer slides 16px in over 0.18s, dialogs and their scrim fade in over 0.14s, the toast rises 8px over 0.16s, the find panel drops 3px over 0.12s). Reduced motion removes every transition and animation.

**The Same-Scheme Fade Rule.** Fade only between themes of the same scheme. Text flips colour instantly, so a background still fading between light and dark would leave the text unreadable for a moment.

### Quick Note Panel
A small floating window on the same themes: paper at 92% over the desktop, 1px hairline, 12px radius (8px on Windows), 24px padding (16px at the foot), an 18px UI-sans text area at 1.65, a 12px pencil footer and the filled mark button. It follows the same effective theme as the main window and rechecks it every minute, when it returns to the front and when the system appearance changes.

## Do's and Don'ts

### Do:
- **Do** read colour through roles: `var(--card)` for paper, `var(--popover)` for anything that floats or docks beside the page, `var(--foreground)` for ink, `var(--muted-foreground)` for secondary text, `var(--primary)` for marks. Check a new surface in all twenty-five themes, not only Paper.
- **Do** keep text ink and hold any new text pair to 4.5:1 or more; text on the hover fill (`accent`) is not gated by the theme check, so compute it by hand.
- **Do** draw the mark colour as a line or a small mark: 2px weights, the 3px underline offset, a 2px ring, a 1px inset ring for a selected tile.
- **Do** separate stacked surfaces with a 1px `border` hairline and at most one tonal step, and give a shadow only to a layer that floats, from the existing vocabulary.
- **Do** keep hover instant. Fade only through the automatic-switch crossfade (the `theme-fade` class on the root: 1s ease, background colour only) and the Focus-mode chrome (150ms opacity), keep entrances under 200ms, and drop all of them under reduced motion.
- **Do** use Lucide icons at the 1.6 stroke and 12 to 19px, through `src/icons.ts`.
- **Do** set vertical space in the editor as padding.
- **Do** run `scripts/check-themes.mjs` after touching `src/themes.css`, and declare any new role in all twenty-five blocks. It holds contrast (ink 11, pencil 5, link 5.5, mark 4.5, quote 5.5, ink on selection and highlight 5, button text 4.5, destructive 4.5, ring 3 and night syntax 7, all on paper; ring 3 on floating paper too), distinctness in OKLab ΔE×100 (hover fill 4 from paper and floating paper and 1.5 from the well; hairline 7.5 from paper and floating paper; highlight 5 from paper, floating paper, well and code well and 3.5 from selection; code well 2 and well 2 from paper; rust 4.5 from the mark), and a shadow colour darker than paper and floating paper. `go test` holds the desktop Settings window's hover and press apart in every theme.

### Don't:
- **Don't** write a theme's hex anywhere but `src/themes.css`, or branch component CSS on a theme id. Scheme-wide differences go in the `[data-liubai-scheme=dark]` rules beside the tokens.
- **Don't** colour body text, and don't colour links at night: dark themes keep link text ink and put the colour in the underline.
- **Don't** add a gradient, a texture, ruled paper or a handwriting face; the paper is flat.
- **Don't** dim or blur behind a panel whose job is to change what is behind it. The Appearance dialog has no scrim.
- **Don't** crossfade between a light and a dark theme.
- **Don't** bundle a font or name one that needs downloading, and don't give the chrome a theme's voice.
- **Don't** theme exports or print: they stay white paper and black ink.
- **Don't** reuse the swatch spine on other cards; it marks a Seasons or Studio swatch.
- **Don't** give an Hours or Seasons theme a stock editor palette (GitHub, Solarized, Nord, Dracula and the like); established palettes belong in Studio.
