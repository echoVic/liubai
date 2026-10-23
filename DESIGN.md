---
name: "Liubai (留白)"
description: "A one-page Markdown editor whose themes are the hours of a day and the seasons of a year: flat paper, one ink, and a mark colour drawn only as lines."
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
  input: "#bfc2bc"
  code: "#eef0ed"
  quote: "#4c665c"
  primary: "#4e675e"
  primary-foreground: "#ffffff"
  ring: "#496f61"
  link: "#315f82"
  destructive: "#9c433d"
  highlight: "#eee2a5"
  selection: "#bdd6ca"
  # The other ten themes, each as paper (card), ink (foreground) and mark (primary).
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
  alert-note: "#316dba"
  alert-tip: "#34794c"
  alert-important: "#8250b5"
  alert-warning: "#966611"
  alert-caution: "#bd4343"
  alert-note-dark: "#83b8f6"
  alert-tip-dark: "#8bc79e"
  alert-important-dark: "#c6a1ef"
  alert-warning-dark: "#e1bd6b"
  alert-caution-dark: "#f09c98"
typography:
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
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"
    fontSize: "19px"
    fontWeight: 600
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"
    fontSize: "12px"
    fontWeight: 400
  hour-mark:
    fontFamily: "'Iowan Old Style', 'Songti SC', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Noto Serif SC', Georgia, 'Microsoft YaHei', serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.15
  season-name:
    fontFamily: "var(--font-body)"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
  code:
    fontFamily: "'SFMono-Regular', 'Cascadia Code', Consolas, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.8
  voice-book:
    fontFamily: "'Iowan Old Style', 'Songti SC', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Noto Serif SC', Georgia, 'Microsoft YaHei', serif"
  voice-clear:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"
rounded:
  xs: "2px"
  sm: "4px"
  md: "5px"
  lg: "6px"
  group: "7px"
  xl: "8px"
  menu: "9px"
  dialog: "13px"
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
    rounded: "{rounded.xl}"
    height: "88px"
    padding: "0 4px"
  theme-swatch-seasons:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.season-name}"
    rounded: "{rounded.xl}"
    height: "88px"
    padding: "6px 8px 10px 16px"
  segmented:
    backgroundColor: "{colors.muted}"
    rounded: "{rounded.group}"
    padding: "2px"
  segmented-item:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  segmented-item-active:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
  tool-button:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.lg}"
    size: "34px"
  tool-button-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
  button-outline:
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: "34px"
    padding: "0 10px"
  button-outline-hover:
    backgroundColor: "{colors.accent}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.group}"
    padding: "8px 14px"
  select:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "6px 9px"
  menu:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.menu}"
    padding: "5px"
  menu-item:
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "34px"
    padding: "0 9px"
  menu-item-hover:
    backgroundColor: "{colors.accent}"
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
    textColor: "{colors.primary}"
---

# Design System: Liubai (留白)

## Overview

**Creative North Star: "The Page in Natural Light"**

Liubai is one page to write on. The chrome steps back and the page takes the colour of the hour: each of the eleven themes is a sheet of paper and a colour of ink under a particular light. Six themes follow the hours of a day (天光, Hours) and five follow the seasons of a year (四时, Seasons). The paper is the theme: pearl grey, white, ivory, charcoal, warm brown, blue-grey, grey-green, lotus pink, olive gold, moon white, deep indigo. Body text is always ink. A theme's mark colour shows only as thin lines and small marks.

The system is flat and low-interference, following the product principle of editing first. Surfaces are separated by 1px hairlines and at most one tonal step; only a layer that floats above the page casts an ambient shadow. Nothing is textured, gradient or decorative. Hover is instant. The one authored moment is the one-second crossfade when the automatic switch turns one light theme into another, or one dark theme into another, as the hour or the season changes.

Two voices speak on the page, both system fonts: a book voice (Iowan Old Style with Songti) and a clear voice (PingFang, the system sans). Each theme picks one for its page, and the chrome around the page always stays in the UI sans.

Confirmed visual rejections: the stock editor theme packs (GitHub, Solarized, Nord, Dracula) as palettes; stationery costume (ruled paper, handwriting faces); decorative paper cards and slogans around the editor (removed in 0.1.5 at the user's request).

**Key Characteristics:**
- Eleven themes, one role vocabulary: every theme redeclares the same colour roles in `src/themes.css`, and components only read `var(--role)`.
- Two series with two clocks: Hours (by local time, six themes, all in the book voice) and Seasons (by solar term, five themes, three in the clear voice).
- Flat paper: no texture, no gradient, no theme-specific imagery.
- Colour has jobs: ink for text, hairlines for structure, the mark colour for the caret, the current item and small marks, the link colour for links in light themes.
- Dark themes separate surfaces with hairlines and one tonal step, and colour only the current thing.
- System fonts only, Lucide icons only, chrome in 12 to 13px UI sans.
- Exports and print ignore the theme and stay white paper.

## Colors

A paper-and-ink palette: eleven flat, desaturated papers, one ink per theme, and one mark colour that is only ever drawn as a line or a small mark.

Hex values in this section are the default theme's, Paper (纸白), which is also the `:root` fallback; the frontmatter lists them under their role names. Every theme redeclares the same roles in `src/themes.css`, and components read `var(--card)`, `var(--primary)` and the rest, never a hex. One naming trap: the role called `accent` is the quiet hover fill. The theme's accent colour is `primary`.

### Primary
- **Mark (`primary`)** (#4e675e in Paper, a moss green): the caret, the current outline item, each swatch's own underline or spine, the block insertion line, small handles and checkboxes. It is a line or a small mark and never carries a paragraph. Every theme has its own (see the themes below).
- **Focus Ring (`ring`)** (#496f61): the 2px keyboard focus ring. It tracks the mark colour and is held at 3:1 or more on every paper.
- **On Mark (`primary-foreground`)** (#ffffff): text on a filled mark colour. Today that is the Quick Note save button and nothing else.

### Secondary
- **Link (`link`)** (#315f82, a river blue): link text in light themes, underlined at a 3px offset. In dark themes the text turns ink and the colour moves to the underline. Held at 5.5:1 or more on paper.
- **Rust (`destructive`)** (#9c433d): destructive actions and error text. Held at 4.5:1 or more on paper.

### Tertiary
- **Highlight (`highlight`)** (#eee2a5): the background of ==marked== text. Ink on it is held at 5:1 or more.
- **Selection (`selection`)** (#bdd6ca): the text selection and a selected block. Ink on it is held at 5:1 or more.
- **Callout hues** (light: note #316dba, tip #34794c, important #8250b5, warning #966611, caution #bd4343; dark: #83b8f6, #8bc79e, #c6a1ef, #e1bd6b, #f09c98): five fixed hues for the five callout kinds, and the only colours that do not change with the theme. The light set serves the light themes and the dark set the dark themes, switched by the root's `data-liubai-scheme`. A callout's title takes its hue and its block takes a 9% tint of it over the paper.

### Neutral
- **Paper (`card`)** (#fafaf8): the writing surface and everything level with it: top bar, format bar, status line, reading view and swatch faces.
- **Floating Paper (`popover`)** (#ffffff): the sidebar, menus, dialogs, toast and outline popover. One step lighter than paper in every theme, light or dark.
- **Ground (`background`)** (#e9e9e7): the window colour under everything. The paper covers it in every normal layout, so it is rarely seen.
- **Ink (`foreground`)** (#242523): all body text and headings. Held at 11:1 or more on paper in every theme (11.7 to 14.7 today).
- **Pencil (`muted-foreground`)** (#61665f): secondary text, inactive controls, captions. Held at 5:1 or more on paper.
- **Well (`muted`)** (#eeeeeb): recessed tracks (segmented control, view switch) and table headers.
- **Hover Fill (`accent`)** (#dce3df): the quiet fill under hover and under the current item.
- **Hairline (`border`)** (#d2d3cf): every 1px separator and container edge.
- **Field Line (`input`)** (#bfc2bc): field outlines and scrollbar thumbs, one step stronger than the hairline.
- **Code Well (`code`)** (#eef0ed): inline code and code blocks.
- **Quote Ink (`quote`)** (#4c665c): quoted text and its 2px rule. Held at 5.5:1 or more on paper.

### The Eleven Themes
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

### Named Rules
**The Roles-Not-Hex Rule.** New UI reads roles (`var(--card)`, `var(--primary)`); theme hex lives only in `src/themes.css`. A surface that works in Paper has to work in all eleven themes. A new role is declared in all eleven theme blocks or in none.

**The Jobs Rule.** Each colour has one job: ink for text, pencil for secondary text, hairlines for structure, the mark colour for the caret, the current item and small marks, the link colour for links. Colour never carries a paragraph, and every fill is flat.

**The Night Rule.** In the four dark themes (Lamplight, Ink, Moonlight, Indigo) only the current thing is coloured: the caret, the selection, the block handle under the pointer or focus, and the current outline item. Links read as ink with a coloured underline. Code uses the muted `syntax-*` roles, held at 7:1 or more on the dark paper. A few older accent uses (the table menu button, footnote references, the toast action) still carry colour at night and are not a pattern to copy.

## Typography

**UI Font:** the platform sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif
**Book Voice (书卷):** 'Iowan Old Style', 'Songti SC', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Noto Serif SC', Georgia, 'Microsoft YaHei', serif
**Clear Voice (清朗):** -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif
**Mono:** 'SFMono-Regular', 'Cascadia Code', Consolas, monospace

**Character:** A page set either like a book (Iowan with Songti) or in a clear modern sans (PingFang), inside chrome that never changes face. System fonts only, by product decision: themes bundle no font and pair only what a fresh macOS or Windows already ships (Songti and PingFang are reliable there; Kai and rounded faces are not). Each theme names its voice once, in `--font-body`.

### Hierarchy
- **Display** (600, 1.9em, line-height 1.5, 0.01em tracking): the document's H1 in the theme's voice, 34px at the default 18px body. The reading view uses line-height 1.45 and no tracking.
- **Headline** (600, 1.5em, 1.5): H2, 27px at the default.
- **Title** (600, 1.2em, 1.5): H3, 22px at the default. The outline lists H1 to H3 only.
- **Body** (400, 18px, 1.9): document text in the theme's voice, with kerning and legibility rendering in the editor. Font Size offers 16, 18, 20 and 22px, and the heading steps scale with it because they are em-based. Measure: the 760px paper less two 48px gutters leaves 664px, about 37 CJK characters at 18px (about 45 in the 920px Wide setting).
- **Dialog Title** (600, 19px): the Appearance dialog's heading, in the UI sans.
- **Label** (400, 12px): the interface's working size for buttons, menu items, segmented items, captions and notes. The chrome's base size is 13px; the status line and the outline label are 11px, the smallest recorded size.
- **Hour Mark** (500, 24px, 1.15): the large Chinese hour character on each Hours swatch (卯 午 申 戌 亥 子; the English locale shows the start time instead), always in the book voice so the six read as one set.
- **Season Name** (600, 20px, 1.2): the theme's name on its Seasons swatch, set in that theme's own voice.
- **Code** (400, 14px, 1.8 in the editor; 13px, 1.75 in the reading view; inline 0.84em, 1.6): monospace, on the code well.

### Named Rules
**The One Voice Rule.** A theme speaks in one voice on the page: headings and body share `--font-body`. The six Hours themes all use the book voice, so following the hours never reflows the page; the Seasons themes may differ because they change only four times a year. The chrome never takes a theme's voice.

**The System Fonts Rule.** The page and the chrome use only fonts that ship with macOS and Windows. A theme never bundles a font file or names one that needs downloading (the only font files in the app are KaTeX's math faces, used for formulas).

**The Upright Rule.** Quotes and callouts are set upright. Chinese faces have no italic, so the browser can only slant Songti or PingFang.

## Layout

A compact frame around a generous page. The frame is a 64px top bar over a workspace; the page is one centred column of paper. Chrome runs at 12 to 13px with 34px controls; the page runs at 18px with 1.9 line-height.

- **Frame.** The 64px top bar (paper, hairline below, 24px side padding) holds the sidebar button at the left, the document title and save status, and at the right the view switch (Edit, Split, Read), Appearance, Export, More and Outline. Outline is the right-most item and mirrors the sidebar button. In the macOS desktop app the bar leaves 88px at the left for the window buttons; on Windows it leaves room at the right for the native ones.
- **Workspace.** Under the bar: the format bar (a centred toolbar, 10px 12px padding, hairline below), an optional banner, the desk, and an 11px status line. At 1180px and wider the sidebar can dock as a 290px column; narrower it is a 310px drawer over the page.
- **Paper.** One centred column: 760px by default, 920px (Wide) or the full width (Full Width), with 48px side gutters (30px under 850px, 22px under 650px), 42px above the first line and 64px below the last (72px in the reading view). The reading view uses the same width and gutters.
- **Split.** Two equal columns at 820px and wider, joined by a 1px hairline; below 820px the editor and the reading view stack with a 1px hairline between.
- **Outline.** When the paper leaves 200px or more beside it and the document has two or more headings, the outline sits unboxed on the paper, 24px to the right of the column and at most 240px wide. In Split and Full Width it never sits beside the paper: the Outline button opens it as a popover under the button instead. Focus mode hides the outline and its button.
- **Appearance dialog.** 600px wide (never wider than the window less 32px), with its top edge pinned at the larger of 16px and half the window height less 300px, so the dialog grows downward and the control under the pointer never jumps. A short window scrolls the dialog. Swatch rows are six columns (Hours) and five (Seasons) with a 6px gap, and three columns each under 640px, where the automatic-switch row also stacks.
- **Rhythm.** Spacing steps are 4, 6, 8, 12, 16 and 24px; groups sit 6 to 8px apart and sections 16 to 24px apart.

### Named Rules
**The Padding Rule.** Vertical space around editor lines and block widgets is padding, never margin. CodeMirror measures lines and widgets without their margins, and a margin breaks hover, click and scroll positions.

## Elevation & Depth

A hybrid that leans flat. Surfaces that sit beside or on top of each other (top bar, format bar, paper, status line, docked sidebar, the split divider) are separated by 1px hairlines and at most one tonal step: ground, then paper, then floating paper, which is lighter in every theme. In Ink the ladder is ground #191b1a, paper #242624, floating paper #292b29 and hairline #454844. Those surfaces carry no shadow in any theme. Only a layer that floats above the page casts an ambient shadow, and on a dark ground that shadow barely registers, so the hairline and the lighter fill do the separating. For the same reason the selected tile of a segmented control gives up its lift in dark themes and is drawn with a hairline instead.

### Shadow Vocabulary
- **Dialog** (`box-shadow: 0 24px 80px #0003`): the largest, softest layer; every dialog.
- **Menu and Outline Popover** (`0 8px 30px #0002`): menus and the outline popover.
- **Toast** (`0 4px 25px #0002`).
- **Exit Focus pill** (`0 4px 24px #0001`).
- **Image Tools** (`0 3px 12px #0002`): the image toolbar and the alt-text popover.
- **Floating Sidebar** (`12px 0 40px #20282013`): the sidebar as a drawer over the page; docked, it has none.
- **Selected Tile Lift** (`0 1px 3px #0002`): the selected tile of a segmented control, the view switch and the source toggle, in light themes only.

### Named Rules
**The Hairline Rule.** Stacked surfaces are separated by a 1px `border` line and at most one tonal step, never by a shadow. In dark themes the selected tile drops its lift for a 1px hairline too.

**The Float Rule.** A shadow means "this layer floats above the page": menus, dialogs, toasts, popovers and the floating sidebar. It is soft, near-black, 7 to 20% opaque, and never a hard offset. The one small exception is the selected tile of a segmented control, which lifts by a hair in light themes only.

## Shapes

Small, quiet corners and thin lines. Controls and swatches sit between 4px and 8px, floating layers at 9px, dialogs at 13px, and there is one pill (the Exit Focus button, 30px). Every container edge is a 1px hairline; fields use the stronger field line. Nothing is clipped into a special shape, masked or textured. Icons are Lucide (1.59.0), drawn at a 1.6 stroke with round caps and joins, 14 to 19px, in the colour of their text.

- **Radii:** 2px for ==highlight==; 4px for inline code, keyboard hints and block handles; 5px for controls nested in a group (segmented items, menu items) and for images; 6px for standalone buttons, fields and code blocks; 7px for the segmented track and the sidebar search; 8px for swatches, the view switch and option cards; 9px for menus, the toast and the outline popover; 13px for dialogs.
- **Focus:** a 2px ring in the `ring` colour, 2 to 3px outside the control (inside, at -2px, for menu items).

### Named Rules
**The Line Rule.** The mark colour arrives as a line, not a block: the 2px caret, the link underline at a 3px offset, the 2px quote rule, the 2px focus ring, the 2px insertion line, the 2px underline on each Hours swatch. Fills are reserved for small marks (a resize handle, a checkbox) and the one Quick Note button.

## Components

### Theme Swatches (signature)
Each swatch is a small sheet of its own paper. It carries `data-liubai-theme`, so it paints with that theme's tokens rather than the page's: paper face, hairline, ink text. 88px tall, 8px radius, no hover motion.
- **Hours swatch:** the hour character (24px, book voice) with the theme name (12px) beneath it, centred, and a 2px mark-colour line near the foot (36% wide, 6px up). Six equal columns.
- **Seasons swatch:** the theme name (20px, 600) in the theme's own voice, left-aligned, with the season word (12px, pencil) at the foot, and the mark colour as a 5px spine along the left edge. The spine belongs to this swatch alone. Five equal columns.
- **Selected:** a 1px border plus a 1px inset ring (2px in all) and a 14px Lucide check at the top right, all in the dialog's own ring colour.
- **Focus:** a 2px outline, 2px outside, in the same dialog ring colour.
- **Hover and focus** change only the caption under the row, which names the theme under the pointer or focus, else the theme in use ("暖纸 · 15–19 点 · 午后斜阳里的米色纸").
- **Keyboard:** the eleven swatches are one radio group with a roving tab stop. Left and Right walk the visual order, Up and Down jump to the nearest swatch in the other row, Home and End go to the ends. Choosing a swatch turns the automatic switch off.

**The Outer Ring Rule.** Selection and focus on a swatch are drawn in the dialog's own ring colour, never the swatch's, so the state reads on every paper.

### Segmented Control and View Switch
A recessed track with a paper tile for the active choice. The Switch Automatically control (Off, Follow System, Follow the Hours, Follow the Seasons) and the top bar's view switch (Edit, Split, Read) share the pattern.
- **Track:** well fill, 1px hairline, 7px radius and 2px padding (view switch: 8px and 3px).
- **Item:** 12px, pencil text, 5px radius, 4px 10px padding (view switch: 30px high, 12px side padding, and it takes the hover fill and ink on hover).
- **Active:** paper tile with ink text and the 0 1px 3px lift in light themes; in dark themes no lift and a 1px hairline inset.
- **Keyboard:** a radio group; Left and Right move and select.

### Buttons
- **Shape:** 6px radius for tool and outlined buttons; 7px for the Quick Note button.
- **Tool button:** 34px square, transparent, a 19px Lucide icon in pencil. Hover: hover fill and ink. Focus: 2px ring, 3px outside. Pressed toggles are quiet: the Source toggle in the format bar takes a paper tile with a hairline, and a pressed image-alignment button takes the hover fill.
- **Outlined:** 1px hairline, 12px label, 34px high. Export has 10px side padding, an 18px icon, a hover fill, and hides its label under 760px. Dialog actions use 8px 11px padding.
- **Primary:** one filled button exists, Quick Note's Save as Draft: mark fill, `primary-foreground` text, 7px radius, 8px 14px padding. Everywhere else the mark colour is a line.
- **Disabled:** half opacity.

### Inputs and Fields
- **Select:** paper fill, 1px field line, 5px radius, 6px 9px padding, 12px text; focus is a 2px ring, 2px outside.
- **Text field:** paper fill, 1px field line, 6px radius, 11px padding; the sidebar search is the exception, with a 1px hairline, 7px radius and 10px padding.
- **Error:** destructive-coloured 12px text beneath the field.

### Navigation
- **Top bar:** see Layout. Tool buttons are 34px with 4px gaps; the document title is a 13px button that truncates at 280px; the save status is 12px pencil.
- **Sidebar:** floating paper, a 1px hairline at its right edge, a 12px pencil "Recent Documents" label, a search field, and a list of documents (7px radius; hover and current take the hover fill and a hairline border). A document's remove control appears on hover or focus.
- **Menus:** floating paper, 1px hairline, 9px radius, 5px padding and the menu shadow; items are 34px high with 12px text and 5px radius; hover and focus take the hover fill; keyboard hints sit right-aligned in pencil.
- **Outline:** items in pencil 12px with 8px vertical padding, indented 12px per heading level; the current item is the hover fill with mark-coloured text. Inline, it sits unboxed on the paper under an 11px "Outline" label; as a popover it takes the menu treatment.

### Appearance Dialog (signature surface)
The panel where the system shows itself. A modal dialog on floating paper with a 1px hairline, 13px radius and 24px padding, and no scrim and no blur, so a theme pick repaints the page behind it. Top to bottom: the title and a close tool button; Hours (a 13px bold title with a 12px pencil subtitle on one baseline, six swatches, a caption); Seasons (the same, five swatches); a hairline; Switch Automatically (label left, segmented control right) with a 12px note beneath it; in Follow System mode two labelled selects (Light, Dark); Font Size and Line Width selects; a 12px footnote. The other dialogs are centred and keep a dim scrim.

### Automatic Theme Switch (motion)
When the hour or season turns, or the window returns to the front with a different answer, and the new theme has the same scheme as the old (light to light, dark to dark), the large surfaces crossfade their background colour over 1s ease: the page, top bar, format bar, sidebar, desk, paper, status line, reading view, outline and dialogs. Text colour changes at once. A switch across light and dark is instant, as are manual picks, the first paint, the Quick Note window and the system's reduced-motion setting. Hover is instant everywhere; the only other transition is a 150ms opacity fade of the chrome in Focus mode.

**The Same-Scheme Fade Rule.** Fade only between themes of the same scheme. Text flips colour instantly, so a background still fading between light and dark would leave the text unreadable for a moment.

### Quick Note Panel
A small floating window on the same themes: paper at 92% over the desktop, 1px hairline, 14px radius (8px on Windows), an 18px UI-sans text area, a 12px pencil footer and the single filled mark button. It follows the same effective theme as the main window and rechecks it every minute.

## Do's and Don'ts

### Do:
- **Do** read colour through roles: `var(--card)` for paper, `var(--popover)` for anything that floats or docks beside the page, `var(--foreground)` for ink, `var(--muted-foreground)` for secondary text, `var(--primary)` for marks. Check a new surface in all eleven themes, not only Paper.
- **Do** keep text ink and hold any new text pair to 4.5:1 or more; text on the hover fill (`accent`) is not gated by the theme check, so compute it by hand.
- **Do** draw the mark colour as a line or a small mark: 2px weights, the 3px underline offset, a 2px ring.
- **Do** separate stacked surfaces with a 1px `border` hairline and at most one tonal step, and give a shadow only to a layer that floats, from the existing vocabulary.
- **Do** keep hover instant. Fade only through the automatic-switch crossfade (the `theme-fade` class on the root: 1s ease, background colour only) and the Focus-mode chrome (150ms opacity), and drop both under reduced motion.
- **Do** use Lucide icons at the 1.6 stroke and 14 to 19px, through `src/icons.ts`.
- **Do** set vertical space in the editor as padding.
- **Do** run `scripts/check-themes.mjs` after touching `src/themes.css` (ink 11, pencil 5, link 5.5, mark 4.5, quote 5.5, ink on selection and highlight 5, button text 4.5, destructive 4.5, ring 3, night syntax 7, all on paper), and declare any new role in all eleven blocks.

### Don't:
- **Don't** write a theme's hex anywhere but `src/themes.css`, or branch component CSS on a theme id. Scheme-wide differences go in the `[data-liubai-scheme=dark]` rules beside the tokens.
- **Don't** colour body text, and don't colour links at night: dark themes keep link text ink and put the colour in the underline.
- **Don't** add a gradient, a texture, ruled paper or a handwriting face; the paper is flat.
- **Don't** dim or blur behind a panel whose job is to change what is behind it. The Appearance dialog has no scrim.
- **Don't** crossfade between a light and a dark theme.
- **Don't** bundle a font or name one that needs downloading, and don't give the chrome a theme's voice.
- **Don't** theme exports or print: they stay white paper and black ink.
- **Don't** reuse the Seasons spine on other cards; it is that swatch's own marker.
- **Don't** imitate the stock editor theme packs (GitHub, Solarized, Nord, Dracula).
