# AK Studio

A standalone local skin generator for your animated AKS-74U, Classic AK-47, and CS2 AK-47, inspired by skingen. Pocket Studio, the source FBX/GLB uploads, and the original skingen checkout are unchanged.

## Launch

Double-click **Start AK Studio.cmd** and keep its terminal open. The launcher finds Node.js through PATH or standard Windows installation folders and opens your browser after the server starts.

Or run from this directory:

```
npm start
```

Open **http://127.0.0.1:4318**. Node.js 20 or newer is required. No npm install, API key, account, CDN, or network connection is needed. `npm run dev` serves without opening a browser. Set PORT to change the port.

The repository includes the ready-to-use models in `assets/`. Original ZIP/FBX downloads, duplicate source GLBs, generated QA screenshots/exports, and `dist/` stay local. Cloning the repository is sufficient to run the app; the original MultiRig ZIP is only needed to rebuild its curated assets with `scripts/prepare-cs2.py`.

## Models and views

The model selector defaults to **AKS-74U - Animated**. Its original rig, skin weights, hand textures, normal maps, material-detail maps, and seven clips are retained. Choose **AK-47 - Classic** for the previous model and its seven-part editor.

Choose **AK-47 · CS2** for your uploaded CS2 weapon. It retains its original textured finish, UV layout, skeleton, and skin weights. Its five exposed clips are Idle, Draw, Reload, Fire, and Inspect. Idle is a stationary pose, so Play and the timeline are disabled for it. This file contains weapon bones but no arms or finger bones: Hands and glove/sleeve controls are unavailable for this model. Both existing models retain their hand options.

The CS2 weapon has one **Weapon** paint group. Upload images and generate artwork as usual; the paint uses a nonmetallic, roughness-0.75 finish for clearer images while retaining normal and occlusion detail. Restore the original finish in Customize parts to recover its supplied color texture and original material. The model has its own workspace, and images remain shared across all three models.

All models support Left, Angle, and Right views. AKS-74U and Classic also support Hands. Drag to rotate and scroll to zoom in studio views. Hands uses a fixed first-person camera. Reset View restores the current preset.

In **Hands appearance**, choose Hard-Knuckle, Black Hard-Knuckle, Fingerless, or Full-Finger gloves, with Bare Arms, FBI, SAS, or Balkan sleeves. Hard-Knuckle with FBI sleeves is the default. Assets load when needed; each model remembers its own choices for the current tab. **Original Hands** restores the animated model's native arms or Classic's original POV grip. If an appearance fails to load, the last working selection remains available.

The CS2 hands follow each weapon's existing grip. On the AKS-74U they follow its seven native animation clips, including reloads. The CS2 pack's unrelated inspect animations are not used. Switching hand appearances does not change your gun artwork. These are curated textured presets from MultiRig; Blender's procedural skin controls are not included in the browser.

Uploaded images are shared between models. Each model retains its own seed, density, part settings, composed skin, view, and selected animation frame for the current tab. Switching models pauses playback. Refreshing discards session edits. Reset Studio clears the image collection and skin-edit workspaces and returns the active animated model to Fire single at frame zero.

## Animation controls

The AKS-74U includes all seven supplied clips: Reload t, Reload f, Fire single, Fire mode select, Fire sprite, Put in, and Put out. Labels reflect the source file's names.

- The initial selection is Fire single, paused at frame zero.
- Choose a clip to pause at its first frame.
- Play runs once and holds the last pose. Play again at the end restarts it.
- Pause or drag the timeline to choose a precise frame. Scrubbing pauses playback.
- Animation is available in studio and Hands views. The hands are hidden in studio views while the weapon keeps its original motion.

## Make a skin

1. Browse for images or drop them into the collection. Duplicate files are ignored.
2. Choose Sparse, Balanced, or Layered collage density.
3. Generate a new skin, or enter a seed and press Enter to reproduce a combination.
4. Open Customize parts, or click the weapon, to restrict a part's image pool, regenerate only that part, restore its base finish, or lock it against further generation.

The animated model has **Metal Body, Magazines, and Wood Fittings** groups. The Classic model retains **Body, Barrel, Stock, Magazine, Grip, Foregrip, and Details**. Hands and ammunition are never painted. Lock an original finish if you want a part to stay unpainted.

Seeds reproduce results given the same image contents, density, image restrictions, and locked state. Each part has its own random stream. Image IDs are content hashes, so upload order does not change selection. Part remixes increment a local revision; global seed generation resets unlocked revisions. Density changes apply on generation.

Images stay in browser memory and are never sent to the server. Files must be at most 20 MB and 50 million pixels. Collage source images are proportionally scaled to a maximum dimension of 1200 pixels. Static JPG, PNG, and WebP are the intended inputs. Removing images updates unlocked artwork; locked parts retain their composed pixels until regenerated.

## Downloads

- **Download render:** opaque 1920 x 1080 PNG from the current camera and animation frame. UI selection highlights are excluded. Playback freezes briefly for capture and then resumes if it was playing.
- **Download texture:** 2048 x 2048 PNG of the same color atlas used by the preview. Hands, lighting, and selection highlights are excluded.
- **Download GLB:** the customized selected model with the selected gloves and sleeves, even from a studio view. For the AKS-74U this includes the prepared color UVs, generated skin, skeleton, skin weights, and all seven native animation clips. CS2 hand motion is baked at 60 frames per second, including each clip's final frame. Original Hands exports the native arms instead. The original base pose is exported so partial weapon tracks keep the correct defaults; your editor pose and playback state are restored afterward.

The prepared AKS-74U atlas targets the **downloaded customized GLB**, not the unmodified source GLB or FBX. In another application, import that customized GLB to get the matching UV setup. Classic textures retain the original `assets/ak47.glb` UV layout. This app exports artwork and models; it does not install game skins or export video.

CS2 texture downloads retain the supplied model's native UV layout. Its GLB download includes the customized material and the five exposed weapon clips, with no added hands. Original source clips unrelated to this preview, including M4A1 and additive clips, remain in your untouched original download.

## UV and rendering implementation

The animated model's original metal UVs include repeated and out-of-range islands, and its wood UVs collapse to a single point. Its prepared color UV channel is separate from the original UVs used by normal and material-detail maps:

- Metal and magazines retain the periodic source layout in a padded 1536-pixel square of the atlas.
- Alternate animated magazines retain the same color coordinates, so reloads show the same skin on both copies.
- Wood uses six padded box-projected charts in the atlas's right-hand strip.
- Small metal faces with collapsed UVs receive additional box charts in the unused upper strip.

All position, normal, tangent, original UV, joint-index, and weight attributes are preserved together when splitting paint groups. Animation remains attached to the original skeleton and tracks.

Masks are derived from the paint UV triangles, with one zone owner per atlas pixel so other parts cannot overwrite locked artwork. Each model's preview and PNG export share a single atlas. The original materials retain their normal, roughness, metallic, and occlusion maps. Only their base color uses the new paint channel.

The Classic model has no supplied finished base-color material, so it keeps the generated wood-and-metal starting finish introduced by AK Studio. Its separate POV grip reference has no textures and uses neutral skin/glove colors.

## Checks and build

```
npm test
npm run build
```

The build checks source syntax and GLB headers, then copies the self-contained static app into `dist/`. Serve that directory over HTTP; file:// is unsupported. Dependencies are vendored locally with their licenses.

Optional browser checks require Python, Pillow, Playwright, and its Chromium browser. With the local server running:

```
python qa/animated_checks.py
python qa/roundtrip_motion.py
python qa/browser_checks.py
python qa/hands_check.py
python qa/multirig_checks.py
python qa/multirig_failure_checks.py
python qa/cs2_weapon_checks.py
```

`animated_checks.py` covers all clips, playback/scrubbing/restart, paint channels, model switching and workspace restoration, PNG dimensions, GLB re-import with its skin and material detail, and mobile layout. It creates `qa/customized-aks74u.glb`; `roundtrip_motion.py` compares sampled animated vertices from that file against the editor across all clips. `browser_checks.py` covers the Classic editor, seeded pixels, locks/overrides, invalid files, reset, camera controls, PNG re-import, and failure states. `hands_check.py` covers the Classic reference grip. QA captures and exports are excluded from the build.

`multirig_checks.py` checks the four glove styles and sleeve options on both models, Original Hands, unchanged gun artwork, PNG/GLB export, and re-imported motion across all seven clips. `multirig_failure_checks.py` checks failed asset loads, fallback hands, playback restoration during GLB export, and Classic Original Hands export.

`cs2_weapon_checks.py` covers CS2 original-finish restoration, matte artwork, deterministic generation, unchanged UVs, all five clips, disabled hand controls, model workspaces, missing-model recovery, mobile layout, PNG/texture downloads, and sampled vertex motion after GLB re-import.

Add `?debug=1` to expose the local `window.akStudio` inspection hook. Normal usage does not expose it.

## Source and dependencies

- `assets/aks74u.glb` is a copy of your `animated_aks-74u.glb`. Its matching FBX remains untouched in `animated-aks-74u/source/`.
- `assets/ak47.glb` comes from your local skingen checkout. Original zone names and the mask-aware scoring approach are adapted from [skingen](https://github.com/swagd3v/skingen).
- `assets/ak47-cs2.glb` is a copy of your `rifle__ak-47_ver.2_weapon_model_cs2.glb`: [RIFLE | AK-47 (Ver.2) Weapon Model (CS2)](https://sketchfab.com/3d-models/rifle-ak-47-ver2-weapon-model-cs2-019465e8ecfd43b687d963f7b0aadf81) by [6lucius](https://sketchfab.com/6lucius), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), according to its embedded metadata. AK Studio modifies color/materials when artwork is applied and exports five selected clips; it preserves the original geometry and UVs.
- `assets/pov-grip.glb` is a copy of your static AK POV reference, used only by the Classic model.
- `assets/cs2/` contains seven browser-ready presets prepared from your `CS2_MultiRig_V3.zip` from [CS2-MultiRig](https://github.com/goribby/CS2-MultiRig). To rebuild them, run `python scripts/prepare-cs2.py` from this directory. The ZIP and Blender project remain unchanged and are excluded from the static build. Color, normal, and packed material maps are retained; runtime roughness is adjusted for cloth and leather under the app's lighting.
- Three.js 0.162.0, GLTFLoader, GLTFExporter, OrbitControls, and utility dependencies are vendored under `vendor/THREE-LICENSE.txt`.

Model rights remain with their original authors.
