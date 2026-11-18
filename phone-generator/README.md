# Pocket Studio

A standalone, local phone image generator using the supplied CS:GO rigged hand and UV-mapped phone. The existing Market Ritual app is unchanged.

## Launch

Double-click **Start Studio.cmd** on Windows. Keep its terminal open while using the app. The browser opens once the server is ready.

Or run from this directory:

```
npm start
```

Open http://127.0.0.1:4317. Node.js 20 or newer is required. No npm install, account, network connection, CDN, or API key is needed: Three.js 0.162.0 and the required loader utilities are vendored with their MIT license.

## Use

1. Add one or more screen images by browsing or dropping files.
2. Click a thumbnail to select it. Fill crops to cover the screen; Fit shows the entire image with dark bars when necessary. Remove images using their thumbnail's remove button.
3. Generate selects an image, one of four backgrounds, one of three lighting presets, and one of three camera angles with equal weights. Enter a seed and press Enter or the adjacent arrow to reproduce a combination. Selectors also let you override individual scene traits.
4. Download PNG saves the scene alone at **1080 x 1350** with an opaque background. Reset clears the library and restores the initial scene.

Uploaded images remain in tab memory and are never sent to the server. Refreshing discards them. Accepted image files must decode in the browser, be under 20 MB, and have no more than 50 million pixels. Exact duplicates are ignored. Animated formats use their browser-decoded frame when the scene is rendered; static JPG, PNG and WebP are the intended inputs.

A seed reproduces generated selections with the same image contents and fit mode. Image identifiers are content hashes, sorted before selection so upload order does not change the results. Manual selector or thumbnail changes override the generated scene; applying the seed restores its generated combination. Identical pixel output across different browsers/GPUs is not promised.

## Rendering and calibration

`src/scene.js` loads the supplied GLBs with GLTFLoader, retains the hand's skin weights and textures, hides the unused hand, and uses the actual finger bones for one fixed grip. Finger hinge rotations curl around the far edge; a small CCD solver positions the thumb against the near edge. The original low-poly silhouette is retained. This is a curated pose, not collision-driven hand physics.

The phone's two display triangles at source Z = 4.444224 are split into a separate material with portrait UVs. Uploaded images appear only there. The original phone geometry, bezel and camera detail are retained, and the UV diagnostic checker material is replaced with graphite body materials. Grip calibration is specific to the included files; replacing a GLB requires retuning the grip and display selection.

`src/generator.js` contains the seed logic, presets and image fitting. `src/app.js` manages session images and controls. Scene configuration contains seed, imageId, background, lighting, camera and fit. Add `?debug=1` to expose `window.pocketStudio` for local inspection/calibration; the normal app does not expose this hook.

## Checks and build

```
npm test
npm run build
```

The build checks JavaScript syntax and asset headers and copies a self-contained static app into `dist/`. Serve that folder over HTTP; opening index.html directly with file:// is not supported.

`qa/browser_checks.py` contains optional Playwright checks (requires Python, Pillow, Playwright and its Chromium browser). With the local server running:

```
python qa/browser_checks.py
```

It checks camera presets, three image shapes in both fit modes, seed and pixel repeatability, duplicate/broken/invalid files, removal/reset, opaque 1080 x 1350 exports, mobile overflow, oversized uploads, model loading failures, unavailable WebGL, and context loss. QA screenshots and a sample export are in `qa/` and excluded from the production build.

## Assets

- `assets/hand.glb`: copied from `iphone/hand-cs-go/default_counter-strike_hands_rigged.glb`.
- `assets/phone.glb`: copied from `iphone/phone_uv_mapped.glb`.
- These are user-supplied models; their original licensing is unchanged.
- `vendor/THREE-LICENSE.txt`: Three.js MIT license.
