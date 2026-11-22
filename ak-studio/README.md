# AK Studio

A local, browser-based studio with two tools:

- **Weapon skin** turns your images into a skin for an animated AKS-74U, an animated seven-part classic AK-47, a CS2 AK-47 or an AWP, and exports renders, the texture and a GLB.
- **Phone scene** stacks your post screenshots into a scrolling feed on a phone held in a rigged hand, seen in first person like a game viewmodel. Scroll it live, record it, or download stills.

Nothing is uploaded. Images stay in the tab's memory and are gone on refresh.

## Launch

Double-click **Start AK Studio.cmd**, or from this folder:

```
npm start
```

Then open **http://127.0.0.1:4318**. Node.js 20 or newer is the only requirement: no `npm install`, account, CDN or network. `npm run dev` serves without opening a browser; set `PORT` to change the port.

## Making a skin that holds together

Drop images into **Your images**. The weapon is painted straight away and repaints whenever you change a control.

The artwork is composed on the weapon's **left and right side profiles** and then projected onto the model, so each image lands whole and runs straight across part boundaries (rather than being cut up along the UV layout). Text reads correctly on both sides. Top, bottom and end faces continue the artwork "over the edge" of the profile.

| Control | What it does |
| --- | --- |
| **Layout** | Ten ways to arrange the images, listed below. |
| **Image size** | Bold, Balanced or Busy. Sizes are relative to the weapon's body, so they behave the same on every model. |
| **Colour** | *Original* leaves images alone. *Matched* pulls brightness, contrast, saturation and colour cast together. *Duotone* recolours every image with the palette, the strongest way to unify unrelated pictures. *Halftone* redraws them as comic-print dots in palette colours, which also hides differences in photo quality. *Poster* flattens them to the four palette colours. |
| **Palette** | *Auto* extracts four colours (dark, main, light, accent) from your images. Or pick a preset, or click a swatch to make your own. The palette drives the colour treatments, the base coat, dividers, stripes, outlines and solid parts. |
| **Base coat** | The paint under the artwork wherever images do not reach. *Factory finish* leaves the original surface showing. |
| **Surface** | Auto (a neutral paint finish), Matte, Satin or Gloss. Only painted parts change; unpainted parts keep their factory metal and wood. |
| **Finishing touches** | Optional passes over any layout. *Fade* dissolves the artwork into the base coat toward the muzzle and stock. *Stripes* adds racing stripes along the weapon. *Edge wear* scuffs the paint back to the factory finish along hard edges. |
| **Edition seed** | The same seed, images and settings always give the same skin. *Generate a new layout* rolls a new seed. *Surprise me* also rolls the layout, size, colour and palette. |

The layouts:

| Layout | |
| --- | --- |
| **Collage** | Overlapping images cover the weapon. |
| **Panels** | Angled bands, one image each, with accent dividers. |
| **Camo** | Camouflage blobs, each cut from a different image or filled with a palette colour. |
| **Stencil** | A word you type, set large along the weapon, with the images showing through the letters. |
| **Hero** | One image shown whole on the receiver; the rest is base coat and pinstripes. |
| **Split** | Artwork toward the muzzle, a solid colour behind, divided by a diagonal with an accent stripe. |
| **Filmstrip** | Rows of film frames with sprocket holes, one image per frame. |
| **Slices** | One image cut into vertical strips that slip up and down. |
| **Hex** | A honeycomb of cells, each holding a different image. |
| **Pattern** | One image mirrored and repeated end to end. |

Hero, Slices and Pattern use a single image, picked by the seed; untick images on the parts panel, or generate again, to get a different one.

Quick recipe for a coherent skin from mismatched images: **Duotone**, then try palettes; or **Panels**; or keep **Collage** and give the stock, grip or magazine a solid palette colour (below).

### Stickers

**Add stickers** is a separate step after the skin: it has its own images, and the stickers are laid over whatever the weapon is wearing (artwork, solid colours, edge wear or the bare factory finish). Changing or regenerating the skin leaves them where they are. Cut-out PNGs keep their shape and get a die-cut edge.

| Effect | |
| --- | --- |
| **Paper** | The image as it is, with a white edge. |
| **Gold** | The image struck in polished gold. |
| **Holo** | A rainbow holographic film over the image. |
| **Foil** | The image in mirrored silver foil. |
| **Engraved** | The image etched into the surface, with the skin showing through. |

Choose a size and how many (1 to 12, shared between the two sides), and **Move the stickers** for a new arrangement. One sticker sheet is shared by every model. Gold, Holo and Foil are also reflective: they catch the studio lights as you rotate the weapon, and that shine is included in the downloaded GLB as a roughness/metalness texture. The holographic colours are printed into the sticker rather than shifting with the viewing angle. On parts left in factory finish on the AKS-74U and the CS2 AK-47, stickers show their colour but not the extra shine, because those parts keep the model's own surface maps.

### Customize parts

Open **Customize parts** or click a part on the model. Every part starts on the shared design, so artwork flows across them. Per part you can:

- switch to a **Solid colour** from the palette, or back to the **Factory finish**;
- untick images to keep them off that part, or **Remix this part** for its own layout (**Rejoin shared design** undoes both);
- **Lock** it: its artwork then stays exactly as it is, whatever you generate or change. (Edge wear is laid over the whole weapon, locked parts included.)

Parts are Metal Body, Magazines and Wood Fittings on the AKS-74U; Body, Barrel, Stock, Magazine, Grip, Foregrip and Details on the classic AK-47; a single Weapon part on the CS2 model; and Body, Barrel, Scope, Bolt & Magazine and Bipod on the AWP. Each model keeps its own parts and settings while the tab is open.

### Views, hands and animation

Left, Angle and Right are orbit views (drag to rotate, scroll to zoom). **Hands** is a fixed first-person view, available on the AKS-74U and the classic AK-47. Under **Hands & animation** choose gloves (Hard-Knuckle, Black Hard-Knuckle, Fingerless, Full-Finger, or the model's Original Hands) and sleeves (Bare Arms, FBI, SAS, Balkan), pick a clip, and play or scrub to the pose you want. The AKS-74U has seven clips with fully animated arms. The classic AK-47 and the CS2 AK-47 share four Counter-Strike 2 clips (Idle, Draw, Reload, Fire). On the classic AK-47 the hands stay gripped to the weapon and move with it, but are not themselves animated: in a reload the magazine leaves and returns without a hand on it. The CS2 AK-47 has no arms. The AWP is a static model: no animation and no Hands view.

### Downloads

- **Render**: 1920 × 1080 PNG of the current camera and pose.
- **Texture**: the 2048 × 2048 colour atlas. For the AKS-74U it matches the downloaded GLB's prepared UVs, not the original source file; the other two keep their original UV layouts.
- **GLB**: the model with your skin, the selected hands, its rig and its animation clips. CS2 hand motion is baked at 60 fps.

## Phone scene

Switch tabs with **Phone scene** at the top. The view is first person: a rigged hand holds a phone in a small game-style world, and the phone shows a feed.

### Your posts

Drop screenshots of posts into **Your posts**. They are separate from the skin images. Each one is scaled to the width of the phone's screen and they are stacked, in the order you add them, into one endless feed: after the last post it starts again. The feed sits inside a generic social-app template (status bar with the real time, tabs, navigation bar) whose bars turn light or dark to match your first screenshot. With no screenshots the template shows stand-in posts.

- **Post my weapon render** adds the weapon studio's current view as the first post.
- **Shuffle the feed** reorders the posts; **Remove all posts** empties it.
- **App bars · Off** hides the template's bars, for screenshots of a whole phone screen that already include them.

### The scene

| Setting | |
| --- | --- |
| **World** | Dust yard, Night range or Training hall. |
| **How the phone is held** | Low right like a weapon viewmodel, or raised to read. |
| **Frame** | Landscape 16:9 (1920 × 1080), Vertical 9:16 (1080 × 1920) or Portrait 4:5 (1080 × 1350). |
| **Game overlay** | Crosshair, health and armour, round timer and radar. On or off. |

**Generate a scene** picks the world and the hold from a seed; the same seed gives the same scene.

### Using it live

The view is always live. Scroll the mouse wheel or drag over it to move the feed: the thumb swipes the glass as it moves. Move the mouse to look around; the hand trails the view slightly. **Auto-scroll** flicks through the feed on its own at three paces. **Go full screen** fills the display (Space toggles auto-scroll, the arrow and Page keys scroll, Esc leaves). **Record video** captures the live view and saves a WebM when you stop.

**Download PNG** saves the current moment at the frame's full size.

## Limits

Images must be under 20 MB and 50 megapixels; working copies are scaled to 1200 px on the long edge (2400 px for post screenshots). JPG, PNG and WebP are the intended formats. PNGs with transparency work well as stickers. The app needs WebGL 2 and must be served over HTTP (not opened as a file).

## Project layout

```
index.html, styles.css
src/
  main.js               entry: tabs and the skin image collection
  shared/               library.js (uploads), random.js (seeded randomness)
  weapon/
    app.js              controls and per-model workspaces
    scene.js            viewport, views, hands, animation, exports
    animated-model.js   AKS-74U preparation (paint groups, paint UVs)
    cs2-weapon.js       CS2 AK-47 preparation
    classic-rig.js      puts the classic AK-47's parts on the CS2 skeleton
    awp.js              AWP parts and factory colours
    hands.js, cs2-hands.js
    skin/
      generator.js      settings, parts, layout planning   (pure)
      palette.js        palette extraction, colour matching (pure)
      design.js         draws a layout as flat side-view artwork
      stickers.js       draws the sticker pass (colour and shine)
      sticker-effects.js  gold, foil, holo and engraving pixel maths (pure)
      projector.js      projects that artwork onto the UV atlas (WebGL)
      atlas.js          masks, base finish, per-part layers
  phone/
    app.js              posts, scene controls, live controls
    generator.js        presets, seeded scenes, feed layout, scrolling (pure)
    scene.js            the first-person view, world, live loop, exports
    hand.js             the rigged hand: poses and finger reach
    screen.js           draws the feed and the app template
    hud.js              draws the game overlay
assets/                 weapon, hand and phone models
vendor/                 three.js 0.162 and loaders (MIT)
scripts/                serve.mjs, build.mjs, extract-cs2-rig.mjs, convert-awp.mjs, prepare-cs2.py
tests/                  node --test unit tests
qa/                     optional Playwright browser checks
```

The two `generator.js` files, `palette.js` and `sticker-effects.js` have no DOM or WebGL dependencies, which is what the unit tests exercise.

## Checks and build

```
npm test          unit tests for layout planning, colour maths, and the phone's feed and scrolling
npm run build     syntax and asset checks, then a static copy in dist/
```

`qa/smoke.py` drives the real app in headless Chromium: every model, every layout and colour treatment, seeded repeatability, per-part editing and locks, the phone tab and every download. It needs Python with Playwright and Pillow, and the server running:

```
python qa/smoke.py
```

Add `?debug=1` to the URL to expose `window.akStudio` for inspection.

## Sources

- `assets/aks74u.glb`: your animated AKS-74U.
- `assets/ak47.glb`: from your skingen checkout; zone names follow [skingen](https://github.com/swagd3v/skingen).
- `assets/ak47-cs2.glb`: [RIFLE | AK-47 (Ver.2) Weapon Model (CS2)](https://sketchfab.com/3d-models/rifle-ak-47-ver2-weapon-model-cs2-019465e8ecfd43b687d963f7b0aadf81) by [6lucius](https://sketchfab.com/6lucius), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The app changes its colour and material when painted and exports four of its clips. Its skeleton and those clips, copied into `assets/ak47-rig.json` by `npm run rig`, also animate the classic AK-47.
- `assets/awp.glb`: converted from your `weapon_snip_awp.obj` with `npm run awp -- path/to/weapon_snip_awp.obj`, which welds the single OBJ object into its separate pieces and sorts them into the five parts. The OBJ has no texture, so the factory finish is flat colours.
- `assets/pov-grip.glb`: your static AK first-person reference, used by the classic model's Original Hands.
- `assets/cs2/`: glove and sleeve presets prepared from [CS2-MultiRig](https://github.com/goribby/CS2-MultiRig) with `scripts/prepare-cs2.py`.
- `assets/phone/rigged-hand.glb`: [Rigged hand](https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e) by [Elena FF](https://sketchfab.com/elenaferfor), [CC BY-SA 4.0](http://creativecommons.org/licenses/by-sa/4.0/), unmodified. The app poses it from its Open/Close clip.
- `assets/phone/phone.glb`: your UV-mapped phone. `assets/phone/hand.glb`, the earlier CS:GO hand, is no longer used.
- `vendor/`: Three.js 0.162.0 with its loaders, exporter and controls, under `vendor/THREE-LICENSE.txt`.

Model rights remain with their original authors.
