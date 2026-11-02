# PinchPulse — Landing Page

Static landing page for **PinchPulse**, the Apple Watch app that counts heartbeats with one pinch per beat.

No build step, no dependencies: plain HTML, one small runtime script (`dc-lite.js`) and image assets.

## Files

| Path | What it is |
|---|---|
| `index.html` | The page: markup templates + page logic |
| `dc-lite.js` | Tiny runtime that renders the templates and keeps scroll animations smooth |
| `assets/` | Images, sprite sheets and icons (extension-less; types set in `vercel.json`) |
| `favicon.svg` | App icon |
| `vercel.json` | Content-Type + long-cache headers for `assets/` |

## Run locally

Any static server works, e.g.

```bash
npx serve .
```

Note: `assets/` files have no extension. Vercel sets their types from `vercel.json`; some local servers won't, which can break the SVG icons locally only.

## Deploy on Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New → Project → Import** the repo.
3. Framework Preset: **Other**. Leave Build Command and Output Directory empty (root `/`).
4. Deploy. Add a custom domain under **Settings → Domains** if you want one.

## Related pages

- Privacy Policy: https://claude.ai/artifact/DH6FntR1PBLjnmiiufoUWE
- Support: https://claude.ai/artifact/SaqyVwXK1QUcc37wSGDefC
