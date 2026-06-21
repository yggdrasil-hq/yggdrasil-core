# Convention: theming & design tokens

**Read this when:** you theme or style any Yggdrasil surface — `web`, `landing`,
or `docusaurus` — or need token values for Tailwind, CSS, or ShadCN.

**Brand assets (logos, mark):** `branding/` — for partners and external use. See
[`branding/README.md`](../../branding/README.md).  
**Visual reference:** open [`branding/brand-sheet.html`](../../branding/brand-sheet.html)
in a browser for swatches, logo usage, and mark anatomy.

Copy token values from this doc into each web repo as you scaffold it.

---

## Fonts

Load from [Google Fonts](https://fonts.google.com/):

| Role | Family | Weights | Used for |
|------|--------|---------|----------|
| **Mark** | [Cinzel](https://fonts.google.com/specimen/Cinzel) | 600, 700 | Logo Y letterform only |
| **UI / display / body** | [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) | 400, 500, 600, 700 | Headings, UI labels, marketing copy, body text, wordmark body |
| **Code / metadata** | [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) | 400, 500, 600 | Code blocks, tokens, status labels, hex values |

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Stack fallbacks:**

```css
--font-display: "Cinzel", Georgia, serif;
--font-sans: "Space Grotesk", system-ui, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, monospace;
```

---

## Color palette

A cool blue-black foundation. Two brand accents carry the identity; status colors map to the feature lifecycle.

### Surfaces

| Token | Hex | OKLCH | Role |
|-------|-----|-------|------|
| `niflheim` | `#080B11` | `oklch(.14 .012 250)` | Base canvas — app background, deepest layer |
| `surface-01` | `#0E131B` | — | Panels, spec cards, secondary backgrounds |
| `surface-02` | `#151C26` | `oklch(.22 .016 248)` | Cards, raised containers |
| `surface-03` | `#1C2531` | — | Highest elevation surface |
| `rime` | `#2A3543` | `oklch(.34 .020 245)` | Hairlines, dividers, input borders |
| `rime-soft` | `#1F2937` | — | Subtle borders on dark panels |

### Text

| Token | Hex | OKLCH | Role |
|-------|-----|-------|------|
| `frost` | `#E8EEF4` | `oklch(.94 .008 235)` | Primary text — headings, main copy on dark |
| `mist` | `#9FB0C0` | — | Secondary text — body, descriptions |
| `shadow` | `#5E6E7E` | — | Tertiary text — labels, metadata, captions |

### Brand accents

| Token | Hex | OKLCH | Role |
|-------|-----|-------|------|
| `bifrost` | `#2FD4C6` | `oklch(.79 .12 190)` | Primary accent — CTAs, links, focus rings, canopy, “ready” state |
| `aurora` | `#4F9BF0` | `oklch(.68 .13 250)` | Secondary accent — roots, infrastructure, “in progress”, info highlights |
| `frostfire` | `#BFE9EE` | `oklch(.90 .04 200)` | Highlight — core nodes, sparing emphasis, glints on dark surfaces |

### Light surface

| Token | Hex | Role |
|-------|-----|------|
| `light-surface` | `#EEF3F7` | Marketing / docs light backgrounds |

### Status (feature lifecycle)

| State | Token | Hex | Set by |
|-------|-------|-----|--------|
| Draft | `st-draft` | `#6B7A8A` | User |
| Ready to Work On | `st-ready` | `#2FD4C6` | User |
| In Progress | `st-progress` | `#4F9BF0` | System |
| Needs Input | `st-input` | `#E2A13C` | System |
| Agent Review | `st-review-agent` | `#9B8CF0` | System |
| In Review | `st-review` | `#5BC0E8` | User |
| Approved | `st-approved` | `#46C285` | User |
| Rejected | `st-rejected` | `#E06C75` | User |
| Failed | `st-failed` | `#C84A52` | System |

---

## Mark

A single **Y** in **Cinzel** (weight 700) — inscriptional, Nordic. In wordmark lockups the Y is **1.32×** the body size and reads as the first letter of “Yggdrasil” (not a separate icon). **gg** uses `bifrost`; **drasil** uses `frost` on dark surfaces.

| Context | Y color | gg | drasil |
|---------|---------|-----|--------|
| Dark UI / lockup | `bifrost` (`#2FD4C6`) | `bifrost` | `frost` |
| On light (`#EEF3F7`) | `#0E7C73` | `#0E7C73` | `#0E131B` |
| Knockout on Bifröst gradient | `#08110F` | `#08110F` | `#08110F` |
| Mark only (sidebar icon, favicon) | `bifrost` | — | — |
| Mono mark on dark | `frost` | — | — |
| Disabled / muted mark | `shadow` (`#5E6E7E`) | — | — |

Use the compact mark (`mark-mono.svg` / heavier weight) below 32px.

**Logo assets:** `branding/svg/` and `branding/png/` (mark, lockups, knockout, app tile). Regenerate with `node branding/scripts/generate-assets.mjs` — syncs into web, landing, and docs static folders.

---

## Typography scale

| Role | Size | Weight | Letter-spacing | Color | Notes |
|------|------|--------|----------------|-------|-------|
| **Hero / display** | `clamp(46px, 9vw, 104px)` | 600 | `-0.035em` | `frost` | Marketing hero only |
| **Display** | 64px (52px in compact demos) | 600 | `-0.02em` | `frost` | Large in-app headlines |
| **H1** | 38px (34px compact) | 600 | `-0.02em` | `frost` | Page titles |
| **H2** | 24px | 600 | `-0.02em` | `frost` | Section headings |
| **Section title** | `clamp(26px, 3.4vw, 38px)` | 600 | `-0.02em` | `frost` | Responsive section headers |
| **Body** | 16px | 400 | — | `mist` | Default paragraph text |
| **Body small** | 14–15px | 400 | — | `mist` | Supporting copy |
| **Mono / code** | 13px | 500 | — | `bifrost` | Commands, tokens, paths |
| **Label / meta** | 11–12px | 400–500 | `0.08em–0.18em` | `shadow` | Uppercase labels, table metadata |

**Wordmark lockup sizes:**

| Layout | Size | Weight |
|--------|------|--------|
| Horizontal lockup | 34px | 600 |
| Stacked lockup | 28px | 600 |

**Line heights:** `0.95` (tight display), `1.45` (body), `1.5` (general).

---

## Layout & shape

| Token | Value | Use |
|-------|-------|-----|
| `maxw` | `1200px` | Content max-width |
| `gap` | `clamp(56px, 7vw, 104px)` | Section vertical rhythm |

**Border radius:**

| Size | Value | Use |
|------|-------|-----|
| Small | `4px–8px` | Chips, badges |
| Medium | `14px–16px` | Cards, panels, inputs |
| Large | `36px` | Hero containers |
| Pill | `999px` | Status badges |

**Elevation (app icon tile):**

```css
box-shadow:
  0 24px 60px rgba(0, 0, 0, 0.5),
  inset 0 1px 0 rgba(191, 233, 238, 0.08);
```

**Mark glow (hero):**

```css
filter: drop-shadow(0 8px 40px rgba(47, 212, 198, 0.18));
```

---

## CSS custom properties

Paste into `:root` (or a shared `tokens.css`):

```css
:root {
  /* Surfaces */
  --niflheim: #080b11;
  --surface-01: #0e131b;
  --surface-02: #151c26;
  --surface-03: #1c2531;
  --rime: #2a3543;
  --rime-soft: #1f2937;

  /* Text */
  --frost: #e8eef4;
  --mist: #9fb0c0;
  --shadow: #5e6e7e;

  /* Brand */
  --bifrost: #2fd4c6;
  --aurora: #4f9bf0;
  --frostfire: #bfe9ee;

  /* Light surface */
  --light-surface: #eef3f7;

  /* Status */
  --st-draft: #6b7a8a;
  --st-ready: #2fd4c6;
  --st-progress: #4f9bf0;
  --st-input: #e2a13c;
  --st-review-agent: #9b8cf0;
  --st-review: #5bc0e8;
  --st-approved: #46c285;
  --st-rejected: #e06c75;
  --st-failed: #c84a52;

  /* Layout */
  --maxw: 1200px;
  --gap: clamp(56px, 7vw, 104px);

  /* Typography */
  --font-display: "Cinzel", Georgia, serif;
  --font-sans: "Space Grotesk", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}
```

---

## Tailwind (Next.js app + landing)

Extend your `tailwind.config.ts` theme:

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  theme: {
    extend: {
      colors: {
        niflheim: "#080B11",
        surface: {
          DEFAULT: "#0E131B",
          "01": "#0E131B",
          "02": "#151C26",
          "03": "#1C2531",
        },
        rime: { DEFAULT: "#2A3543", soft: "#1F2937" },
        frost: "#E8EEF4",
        mist: "#9FB0C0",
        shadow: "#5E6E7E",
        bifrost: "#2FD4C6",
        aurora: "#4F9BF0",
        frostfire: "#BFE9EE",
        status: {
          draft: "#6B7A8A",
          ready: "#2FD4C6",
          progress: "#4F9BF0",
          input: "#E2A13C",
          "review-agent": "#9B8CF0",
          review: "#5BC0E8",
          approved: "#46C285",
          rejected: "#E06C75",
          failed: "#C84A52",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      maxWidth: {
        content: "1200px",
      },
      borderRadius: {
        card: "14px",
        panel: "16px",
      },
    },
  },
};

export default config;
```

### ShadCN / Radix semantic mapping (dark)

Map Yggdrasil tokens to ShadCN CSS variables in `globals.css`:

```css
.dark {
  --background: 220 33% 4%;        /* niflheim #080B11 */
  --foreground: 210 33% 93%;       /* frost #E8EEF4 */

  --card: 216 27% 8%;              /* surface-01 #0E131B */
  --card-foreground: 210 33% 93%;

  --popover: 216 27% 11%;          /* surface-02 #151C26 */
  --popover-foreground: 210 33% 93%;

  --primary: 174 66% 51%;          /* bifrost #2FD4C6 */
  --primary-foreground: 220 33% 4%;

  --secondary: 216 21% 17%;        /* surface-03 #1C2531 */
  --secondary-foreground: 210 33% 93%;

  --muted: 216 21% 17%;
  --muted-foreground: 213 16% 63%;  /* mist #9FB0C0 */

  --accent: 213 21% 22%;           /* rime-soft #1F2937 */
  --accent-foreground: 210 33% 93%;

  --destructive: 355 55% 54%;      /* st-failed #C84A52 */
  --destructive-foreground: 210 33% 93%;

  --border: 213 21% 22%;            /* rime #2A3543 */
  --input: 213 21% 22%;
  --ring: 174 66% 51%;              /* bifrost — focus rings */

  --radius: 0.875rem;               /* 14px — card radius */
}
```

---

## Docusaurus (Infima overrides)

In `custom.css`, import fonts then map Infima to Yggdrasil tokens:

```css
@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;600;700&display=swap");

:root {
  --ifm-font-family-base: "Space Grotesk", system-ui, sans-serif;
  --ifm-font-family-monospace: "JetBrains Mono", ui-monospace, monospace;

  --ifm-color-primary: #2fd4c6;
  --ifm-color-primary-dark: #0e7c73;
  --ifm-color-primary-darker: #0a5c56;
  --ifm-color-primary-darkest: #064540;
  --ifm-color-primary-light: #5ce0d5;
  --ifm-color-primary-lighter: #8fe9e1;
  --ifm-color-primary-lightest: #bfe9ee;

  --ifm-background-color: #080b11;
  --ifm-background-surface-color: #151c26;
  --ifm-font-color-base: #e8eef4;
  --ifm-font-color-secondary: #9fb0c0;

  --ifm-code-font-size: 95%;
  --ifm-heading-font-weight: 600;
  --ifm-global-radius: 14px;
}
```

For a light docs theme, swap background to `#EEF3F7` and text to `#0E131B`.

---

## Mark usage (summary)

Full rules and examples are in [`branding/brand-sheet.html`](../../branding/brand-sheet.html) §07.

**Do**

- Use the compact mark below 32px
- Keep the Y in Cinzel at weight 600–700
- In wordmarks, the Nordic Y is the first letter — not a separate icon beside the word
- Give one clear-space letter-width of breathing room on each side

**Don't**

- Rotate, skew, or reflect the mark
- Recolor with warm or off-brand hues
- Add outlines, bevels, or drop shadows to the letter itself
- Separate the Y from the wordmark in lockups

**Clear-space scale:** 1× letter-width at full wordmark size; mark-only at 96px, 48px, 24px, 16px.
