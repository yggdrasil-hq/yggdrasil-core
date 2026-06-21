# Yggdrasil brand assets

Public-facing brand kit for partners, press, and external collaborators.

| Asset | Location |
|-------|----------|
| Interactive brand sheet | [`brand-sheet.html`](brand-sheet.html) — open in a browser |
| Logo (SVG) | [`svg/`](svg/) |
| Logo (PNG) | [`png/`](png/) |
| App tile | [`app-tile.png`](app-tile.png) |

Regenerate SVG/PNG assets after changing the mark:

```bash
node branding/scripts/generate-assets.mjs
```

Requires [librsvg](https://wiki.gnome.org/Projects/LibRsvg) (`rsvg-convert`). Fonts are cached in `branding/fonts/` on first run. The script also syncs assets into `docusaurus/static/img/branding/`, `landing/public/branding/`, and `web/public/branding/`.

## For developers

Implementation details — design tokens, Tailwind config, ShadCN mapping, Docusaurus
theme — live in the agent docs, not here:

👉 [`docs/conventions/theming.md`](../docs/conventions/theming.md)
