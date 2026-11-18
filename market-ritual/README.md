# Market Ritual

A generative artwork and local-first cinematic studio disguised as a trading terminal. It combines deterministic, HashLips-inspired media traits with real BTC, ETH, and SOL market candles, a native SVG candlestick chart, uploaded film and imagery, WebGL-rendered models, historical playback, and paper trades.

Market data is loaded from Coinbase's public Exchange API and live ticker feed. A same-origin Worker route avoids browser cross-origin restrictions in production, Kraken OHLC is used as a REST fallback, and the most recent successful candles are cached locally for gallery resilience. The interface never sends orders.

## Run locally

```bash
npm install
npm run dev
```

## Production checks

```bash
npm run build
```

The static production output is written to `dist/`. The React runtime is vendored in the output so the published artwork does not depend on a CDN.

## Curating media

Media pools and their weights live in `src/generative.ts`. Add same-origin image or muted video assets under `public/media`, then define the asset's weight, blend mode, allowed anchor types, opacity, and scale in a `TraitLayer`.

The in-app Artist Library accepts JPG, PNG, WebP, MP4, WebM, OBJ, GLB, and embedded single-file GLTF. Files are validated and stored privately in IndexedDB, then immediately become reactive scene layers. OBJ geometry and GLB meshes are centered and normalized automatically; GLB is preferred when materials or external resources matter.

`ENTER CINEMA` opens the full-screen compositor. Archive, Liquid, and Crash presets change the grade and effects; uploaded films loop in the background, uploaded models receive seeded lighting and motion, and the first film can provide optional audio after a visitor gesture.

## Cloud storage

The browser client includes resumable upload and immutable publication contracts in `src/cloud-sync.ts`. A Cloudflare Worker implementation and D1 schema are provided under `cloud/`. Activating cross-device sync requires a registered Sites project with D1 and R2 bindings; use `.openai/hosting.cloud.example.json` as the binding reference after Sites Git is available.

Private studio routes must use Sites identity. Published scenes expose only assets listed in their immutable publication manifest.

The URL query stores `episode`, `seed`, and the scene configuration version. Identical values reconstruct the same trait selection and placement.

This project is an artwork with a real public market-data feed. It has no broker connection and cannot execute real orders.

## First-person phone

The chart and full-screen cinematic mode include a first-person phone layer. Click LOOK AT PHONE to raise the textured hand and phone; LOOK AT CHART lowers it. ADD SCREEN IMAGE maps a local image to the phone screen. FIT IMAGE / FILL SCREEN changes cropping, and the remove button resets the display. Screen images remain in memory for the current view and are never uploaded. The original right hand and arm come from the supplied `iphone/hand-cs-go` OBJ archive; the phone and curled thumb are procedural geometry because the supplied phone source folder was empty. Reduced-motion preferences disable idle sway and the raise transition.
