# Carrel handoff for Claude Code

Carrel is the design language for Teaching OS. This note tells a Claude Code session how to bring it into the app. It travels with one other file: `2026-10-01 carrel tokens.css`.

**Tyler, to use this:** add both files to the teaching-os repo (or attach them to the cloud session), then paste the prompt below.

---

## Prompt to paste

Read `2026-10-02 carrel handoff.md` and `2026-10-01 carrel tokens.css`. Together they define Carrel, the approved design language for this app. Adopt it in the order given under "Migration order", one step per commit. Before step 1, find where today's custom properties (`--bg`, `--panel`, `--panel-2`, `--line`, `--text`, `--muted`, `--accent`) are defined and tell me which files will change. Do not build anything listed under "Ask first". When you finish each step, tell me what to check by hand.

---

## What the tokens file is

One stylesheet of CSS custom properties. No component classes, no build step, no web fonts.

- Copy it into the renderer's global styles as `carrel.css` (no spaces, so it imports cleanly) and load it before any other stylesheet.
- Delete the old `:root` definitions of the seven properties above. The tokens file redefines them as aliases of the new names, so existing rules keep working.
- `--accent` keeps its name. Its value changes slightly.

### Theme and space

Two attributes on the `<html>` element of each BrowserWindow select the values:

```html
<html data-theme="dark" data-space="everyday">   <!-- Files, Calendar, Presenter, In-class Tools -->
<html data-theme="dark" data-space="vault">      <!-- the Vault window -->
<html data-space="stage">                        <!-- the Stage; it ignores data-theme -->
```

Dark and everyday are the defaults, so an untouched window already works. Light values exist for both spaces. The app is dark-only today: do not add a theme switch unless Tyler asks.

### Old names to new

| Today | Carrel | Role |
|---|---|---|
| `--bg` | `--desk` | The canvas |
| `--panel` | `--surface-1` | Window body, cards, sidebars |
| `--panel-2` | `--surface-2` | Title bars, toolbars, inputs |
| `--line` | `--rule` | Hairlines and dividers |
| `--text` | `--ink` | Primary text |
| `--muted` | `--ink-muted` | Secondary text |
| `--accent` | `--accent` | Focus, selection, primary action |

New, with no old equivalent: `--surface-0` (wells: grid bodies, editors), `--surface-3` (pressed, chips), `--rule-strong` (the border of anything clickable), `--ink-faint` (placeholders, disabled), `--accent-strong`, `--on-accent`, `--accent-wash`.

## Three things that will bite

1. **`color-mix()` is required.** The washes, state layers and frost are built with it. That needs Chromium 111 or later, which means Electron 24 or newer. Check the Electron version first.
2. **Set `--zoom` on `document.documentElement`.** `--chrome-comp` and `--hairline` are computed from it at `:root`. If `--zoom` is set on a canvas element instead, redeclare those two properties on that same element or they will not update.
3. **Derived tokens follow scope.** Washes, elevation, `--block-*` and `--area-*` are redeclared on any element carrying `data-theme` or `data-space`. If a themed island is ever nested inside a window, give it both attributes.

## Rules that are not in the CSS

**Type.** Base size moves from 13px to 14px. Keep 13px for grids, sidebar rows and menus. Nothing a person must read is under 12px. `--font-serif` (Palatino) is for pane and view titles (`--text-xl` and up), area labels, empty states, the lock screen and everything on the Stage. Everything else is `--font-ui`. Numbers in columns use `font-variant-numeric: tabular-nums` and are right-aligned.

**Zoomed out.** Window titles, area labels, pinned-card names and block glyph tiles multiply their size by `--chrome-comp`. Window content does not. Hairlines on the canvas use `--hairline`.

**Windows.** Focus is shown by the frame only: title bar `--surface-2`, coloured lights, `--elev-3`. Unfocused: title bar `--surface-1`, lights `--window-idle`, `--elev-2`, title in `--ink-muted`. Never dim an unfocused window's content.

**The seven states.** Every interactive component uses these and nothing else:

| State | Recipe |
|---|---|
| Hover | `background: var(--state-hover)` |
| Focus-visible | `box-shadow: var(--focus-ring)`. Inside grids and menus use `inset 0 0 0 2px var(--accent-strong)` |
| Pressed | `background: var(--state-pressed)`. No movement. Dragging adds `--elev-5` |
| Selected | `background: var(--state-selected)`, weight 600, and a 3px accent marker in lists |
| Disabled | `--ink-faint`, no hover, no pointer. Do not fade text with opacity |
| Drag-over | `outline: var(--drop-outline)`, `background: var(--state-drop)`, and the action in words ("Move into PHIL 101") |
| Missing | `border: var(--missing-border)`, `background-image: var(--missing-hatch)`, italic name. Keep the name and offer a way out (Locate, Unpin) |

**Controls.** 30px tall, 13px text, radius `--radius-sm`. Primary: `--accent` fill, `--on-accent` text. Secondary: `--surface-2` with a `--rule-strong` border. Quiet: no fill, no border. Danger: `--danger` fill with `--on-status` text, in confirming dialogs only; in lists and cards use an outlined danger button. One primary button per pane.

**Status colours.** `--danger`, `--warning` and `--success` always appear with an icon and words, on a 16% wash. Never colour a grade or score.

**Pigments.** `--block-*` and `--area-*` are fills, never text colours. A lesson block is always three parts: the wash (`--pigment-x-wash`) with a 45% edge, a solid tile holding the glyph in `--on-pigment-x`, and the name in `--ink`. Twelve hues cannot stay distinct for colour-blind eyes by colour alone, so the glyph is required wherever a block colour appears at 20px or larger.

Block glyphs, 16 by 16 viewBox, `fill="currentColor" fill-rule="evenodd"`:

```
lecture        M4 2.5h8a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1z M7 5.5h2v6H7z M5 11.5h6a1 1 0 0 1 1 1v.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-.5a1 1 0 0 1 1-1z
discussion     M3 2h5.5A1.5 1.5 0 0 1 10 3.5V6a1.5 1.5 0 0 1-1.5 1.5H5.6L3 9.6V7.5A1.5 1.5 0 0 1 1.5 6V3.5A1.5 1.5 0 0 1 3 2z M7.5 8.5H13a1.5 1.5 0 0 1 1.5 1.5v2.5A1.5 1.5 0 0 1 13 14v1.6L10.9 14H7.5A1.5 1.5 0 0 1 6 12.5V10a1.5 1.5 0 0 1 1.5-1.5z
writing        M10.2 2.3 13.7 5.8 6.2 13.3 2.2 13.8 2.7 9.8z
reading        M1.5 3.5 7.25 4.5v9L1.5 12.5z M14.5 3.5 8.75 4.5v9l5.75-1z
group          M5.7 4.6a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0-4.6 0z M1.9 11a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0-4.6 0z M9.5 11a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0-4.6 0z
activity       M8 1.5 9.8 6.2 14.5 8 9.8 9.8 8 14.5 6.2 9.8 1.5 8 6.2 6.2z
video          M3 2.5h10A1.5 1.5 0 0 1 14.5 4v8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12V4A1.5 1.5 0 0 1 3 2.5z M6.5 5.2v5.6L11 8z
quiz           M3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2z M4.6 8.3l1.3-1.3 1.6 1.6 3.3-3.6 1.4 1.2-4.6 5.1z
presentations  M3 2.5h10a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z M5.2 10h1.6l-1.5 4.5H3.7z M9.2 10h1.6l1.5 4.5h-1.6z
review         M12.6 6 9.5 6.2 12.3 2.9z   plus a second path, fill none, stroke currentColor, stroke-width 2:  M12.5 8a4.5 4.5 0 1 1-1.6-3.45
break          M4.5 3h1.2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M10.3 3h1.2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-1.2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z
other          M1.9 8a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0z M6.4 8a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0z M10.9 8a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0z
```

These paths were written by hand and have not been rendered. Draw all twelve on one test page and show Tyler before wiring them in.

**The Vault.** It must be recognisable without colour. Five things, all required:

1. `data-space="vault"` on the window (aubergine surfaces, orchid accent).
2. A double frame: outer `1px solid var(--accent)`, padding `var(--vault-frame-gap)`, inner `1px` of the accent at 50%.
3. Title bar on `--accent-wash`, with a filled tag before the title: lock glyph and the word VAULT, 11px, weight 700, `--accent` fill, `--on-accent` text.
4. A 28px footer strip on `--accent-wash` that never scrolls away. It reads "Student data on screen" in views that show student data and "Vault is open" in views that do not.
5. No canvas dots.

**The lock screen** replaces the Vault's content. It does not blur it: remove the student data from the DOM while locked. It shows "The Vault is locked", a reason line naming the cause and time, the passcode field and one button. While locked, the title bar reads "Locked", not the class that was open. Locking is instant; unlocking fades in over `--dur-base`. Red appears only for a wrong passcode.

**The Stage.** Black only. Palatino only. No accent hue, no cursor, no toasts, no app chrome. Size text with `--stage-caption` up to `--stage-timer` (viewport units), never px. Nothing smaller than `--stage-caption`. Minimum contrast 7 to 1. Text over a queued document sits on a solid black plate. No coloured text on black: pigments appear only as fills under dark text with a number or word. A finished timer inverts the whole plate and says "Time"; it does not turn red. Transitions are a cut or a cross-fade of `--dur-base`.

**Motion.** Nothing bounces. Arriving uses `--ease-out`, leaving `--ease-in`, moving or resizing `--ease-move`. Dragging, panning and zooming have no easing. The tokens already zero every duration under Reduce Motion.

## Migration order

1. **Tokens in, nothing else.** Load `carrel.css`, remove the old `:root` values, set `data-theme` and `data-space` on each window. The app should look the same apart from slightly warmer colours. Fix anything that breaks before going on.
2. **The Vault's identity and lock screen.** This is the change that matters most.
3. **The Stage.**
4. **Shared chrome:** window frame, top bar, dock, canvas controls and map.
5. **Lesson blocks and areas:** switch the twelve block colours and six area colours to `--block-*` and `--area-*`, and add the glyphs.
6. **Controls and the seven states,** then the gradebook grid and the calendar.
7. **Retire the old names.** Replace `--bg`, `--panel` and the rest with the new names file by file, then delete the alias block at the bottom of `carrel.css`.

## Ask first

These appear in the design but are new behaviour. Do not build them without Tyler's say-so:

- A "Vault open" pill in the Everyday top bar while the Vault is unlocked.
- A Stage monitor on the laptop: a small live copy of what the projector shows, with Blank and Stop.
- Lectern density when the display is mirrored (base text 16px, rows 40px, toasts held).
- The timer shrinking to `--stage-name` size and docking in a corner when a document is on the Stage.

## Check before calling a step done

- No hex colour remains outside `carrel.css` in the files you touched.
- Tab through the screen: every control shows the focus ring.
- Zoom the canvas to 50%: window titles and area labels are still readable.
- View the Vault in greyscale (macOS Accessibility, Colour Filters): it is still obviously the Vault.
- Turn on Reduce Motion: nothing moves.

## Known gaps

- `--scrim` has one value for both themes. It will want a lighter one if the light theme ships.
- Dock and interface icons are drawn on the design canvas but not exported. Ask Tyler for an export of sheet 06, or keep today's icons until then.
- The design sheets and mockups live on Tyler's Design canvas, "Carrel: Teaching OS design language". Claude Code cannot open it; ask Tyler for an image of any sheet you need.
