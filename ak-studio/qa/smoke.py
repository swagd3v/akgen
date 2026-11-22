"""End-to-end smoke check for AK Studio, driven in headless Chromium.

Start the server first (npm run dev), then:  python qa/smoke.py
Needs Playwright (with Chromium) and Pillow. Screenshots and downloads are
written to qa/out/, which is git-ignored.
"""
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'out'
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4318'
MODELS = {'aks74u': 3, 'ak47': 7, 'ak47-cs2': 1, 'awp': 5}  # model id -> number of paint zones

# A cheap content hash of a canvas (every 97th pixel), enough to tell renders apart.
HASH = '''canvas => { const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let h = 2166136261; for (let i = 0; i < d.length; i += 388) { h ^= d[i] | d[i + 1] << 8 | d[i + 2] << 16; h = Math.imul(h, 16777619); } return h >>> 0; }'''


def fixtures():
    """Three deliberately clashing images plus the transparent fixture."""
    OUT.mkdir(exist_ok=True)
    stripes = Image.new('RGB', (640, 480), (250, 40, 140)); draw = ImageDraw.Draw(stripes)
    for x in range(-480, 640, 80): draw.polygon([(x, 0), (x + 40, 0), (x + 520, 480), (x + 480, 480)], fill=(30, 220, 230))
    stripes.save(OUT / 'stripes.png')
    night = Image.new('RGB', (800, 450), (8, 10, 40)); draw = ImageDraw.Draw(night)
    draw.ellipse((480, 80, 720, 320), fill=(70, 100, 230)); night.save(OUT / 'night.png')
    sand = Image.new('RGB', (480, 640), (214, 180, 120)); draw = ImageDraw.Draw(sand)
    for y in range(0, 640, 40): draw.line([(0, y), (480, y + 30)], fill=(150, 110, 60), width=8)
    sand.save(OUT / 'sand.png')
    return [str(OUT / name) for name in ('stripes.png', 'night.png', 'sand.png')] + [str(ROOT / 'alpha.png')]


def main():
    images = fixtures()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        page = browser.new_page(viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)

        def idle():
            page.wait_for_timeout(150)
            page.wait_for_function('window.akStudio && akStudio.ready', timeout=240000)

        def act(selector):
            page.click(selector); idle()

        def choose(selector, value):
            page.select_option(selector, value); idle()

        def atlas(): return page.evaluate(f'({HASH})(akStudio.atlas.canvas)')
        def layer(zone): return page.evaluate(f'zone => ({HASH})(akStudio.atlas.layers[zone])', zone)
        def state(): return page.evaluate('akStudio.state')
        def status(): return page.inner_text('#status')

        def download(selector, name):
            with page.expect_download(timeout=300000) as event: page.click(selector)
            path = OUT / name; event.value.save_as(str(path)); idle()
            return path

        def step(name): print(f'ok  {name}')

        page.goto(f'{URL}/?debug=1'); idle()
        assert page.evaluate('akStudio.atlas.hasArtwork') is False
        assert page.is_disabled('#generate'), 'Generate needs images'
        factory = atlas()
        step('loads with the factory finish')

        page.set_input_files('#files', images); idle()
        assert page.inner_text('#image-count') == '04'
        assert page.evaluate('akStudio.atlas.hasArtwork') is True and atlas() != factory
        page.set_input_files('#files', images[:2]); idle()
        assert page.inner_text('#image-count') == '04', 'duplicates are ignored'
        step('uploading paints the weapon; duplicates are ignored')

        def seed(value):
            page.fill('#seed', value); page.press('#seed', 'Enter'); idle()
            return atlas()
        first = seed('smoke-one')
        assert seed('smoke-two') != first
        assert seed('smoke-one') == first, 'a seed must reproduce its skin'
        step('seeds are reproducible')

        seen = {}
        styles = page.eval_on_selector_all('[data-style]', 'buttons => buttons.map(button => button.dataset.style)')
        treatments = page.eval_on_selector_all('[data-treatment]', 'buttons => buttons.map(button => button.dataset.treatment)')
        assert len(styles) == 10 and len(treatments) == 5, (styles, treatments)
        for style in styles:
            act(f'[data-style={style}]')
            assert 'Could not' not in status(), status()
            seen[(style, 'matched')] = atlas()
        act('[data-style=collage]')
        for treatment in treatments:
            act(f'[data-treatment={treatment}]')
            assert 'Could not' not in status(), status()
            seen[('collage', treatment)] = atlas()
        assert len(set(seen.values())) == len(seen), 'every layout and colour treatment should differ'

        act('[data-style=text]'); assert page.is_visible('#stencil-text')
        default_word = atlas()
        page.fill('#stencil-text', 'rush b'); page.wait_for_timeout(600); idle()
        assert state()['settings']['text'] == 'RUSH B' and atlas() != default_word
        act('[data-style=collage]'); assert page.is_hidden('#stencil-text')
        act('[data-treatment=matched]'); plain = atlas()
        for touch in ('fade', 'stripes', 'wear'):
            act(f'[data-touch={touch}]'); assert state()['settings'][touch] is True and atlas() != plain, touch
            act(f'[data-touch={touch}]'); assert atlas() == plain, f'{touch} must switch off cleanly'
        for scale in ('bold', 'busy', 'balanced'): act(f'[data-scale={scale}]')
        choose('#palette', 'vapor'); vapor = atlas()
        choose('#palette', 'arctic'); assert atlas() != vapor
        assert state()['palette']['main'] == '#3f7fa6'
        choose('#base-coat', 'none'); choose('#base-coat', 'dark'); choose('#finish', 'gloss'); choose('#finish', 'auto')
        act('[data-style=collage]')
        step('all layouts, colour treatments, stencil text, finishing touches, sizes, palettes, base coat and surface')

        for model, zones in MODELS.items():
            choose('#model', model)
            current = state()
            assert current['model'] == model and len(current['parts']) == zones
            assert current['settings']['palette'] == 'arctic', 'a new model starts from the current look'
            assert page.evaluate('akStudio.atlas.paintedZones.size') == zones
            for view in ('left', 'right', 'angle'): act(f'[data-view={view}]')
            page.locator('#weapon-stage .canvas-wrap').screenshot(path=str(OUT / f'{model}.png'))
        step('every model loads and paints')

        # Per-part editing on the classic model.
        choose('#model', 'ak47'); act('#parts-panel summary')
        act('#part-list .chip:nth-child(3)')                       # Stock
        act('[data-part-mode=solid]'); act('#part-solid .swatch-button:nth-child(4)')
        assert state()['parts']['Stock'] == {'locked': False, 'mode': 'solid', 'solid': 'accent', 'allowed': [], 'revision': 0}
        act('#part-list .chip:nth-child(5)'); act('[data-part-mode=original]')   # Grip
        assert 'Grip' not in page.evaluate('[...akStudio.atlas.paintedZones]')
        act('#part-list .chip:nth-child(4)'); shared = layer('Magazine'); act('#part-generate')   # Magazine
        assert layer('Magazine') != shared and state()['parts']['Magazine']['revision'] == 1
        act('#part-rejoin'); assert layer('Magazine') == shared, 'rejoining restores the shared design'
        act('#part-list .chip:nth-child(1)'); act('#part-lock')    # Body
        locked, barrel = layer('Body'), layer('Barrel')
        act('#generate'); act('[data-treatment=original]'); choose('#palette', 'ember')
        assert layer('Body') == locked, 'a locked part keeps its pixels'
        assert layer('Barrel') != barrel
        act('#part-lock'); assert layer('Body') != locked
        step('parts: solid colour, factory finish, remix, rejoin and lock')

        # Downloads.
        render = Image.open(download('#download-render', 'render.png'))
        assert render.size == (1920, 1080)
        texture = Image.open(download('#download-texture', 'texture.png'))
        assert texture.size == (2048, 2048)
        for model in ('ak47-cs2', 'ak47'):
          choose('#model', model)
          glb = download('#download-model', 'weapon.glb').read_bytes()
          assert struct.unpack('<I', glb[:4])[0] == 0x46546C67 and struct.unpack('<I', glb[8:12])[0] == len(glb)
          motion = page.evaluate('''async () => {
            const T = await import('three'), {GLTFLoader} = await import('./vendor/loaders/GLTFLoader.js');
            const copy = await new GLTFLoader().loadAsync('./qa/out/weapon.glb'), scene = akStudio.scene, mixer = new T.AnimationMixer(copy.scene);
            let worst = 0;
            for (let clip = 0; clip < scene.active.clips.length; clip++) {
              scene.setClip(clip); scene.scrub(scene.active.clips[clip].duration * .5);
              mixer.stopAllAction(); mixer.clipAction(copy.animations[clip]).play(); mixer.setTime(copy.animations[clip].duration * .5);
              copy.scene.updateMatrixWorld(true);
              for (const source of scene.meshes) {
                const target = copy.scene.getObjectByName(source.name);
                for (const i of [0, Math.floor(source.geometry.attributes.position.count / 2), source.geometry.attributes.position.count - 1]) {
                  const a = source.getVertexPosition(i, new T.Vector3()).applyMatrix4(source.matrixWorld);
                  const b = target.getVertexPosition(i, new T.Vector3()).applyMatrix4(target.matrixWorld);
                  worst = Math.max(worst, a.distanceTo(b));
                }
              }
            }
            return {clips: copy.animations.length, worst, textured: !!copy.scene.getObjectByProperty('isMesh', true).material.map};
          }''')
          assert motion['clips'] == 4 and motion['worst'] < 1e-3 and motion['textured'], (model, motion)
        choose('#model', 'awp')
        assert page.is_disabled('[data-view=hands]') and page.is_disabled('#animation-clip')
        download('#download-model', 'weapon.glb')
        copy = page.evaluate('''async () => {
          const {GLTFLoader} = await import('./vendor/loaders/GLTFLoader.js');
          const copy = await new GLTFLoader().loadAsync('./qa/out/weapon.glb'), meshes = [];
          copy.scene.traverse(object => { if (object.isMesh) meshes.push(object); });
          return {meshes: meshes.length, textured: meshes.every(mesh => !!mesh.material.map), clips: copy.animations.length};
        }''')
        assert copy == {'meshes': 5, 'textured': True, 'clips': 0}, copy
        step('render, texture and GLB downloads (GLBs re-import with matching motion)')

        # The classic model's parts ride the CS2 skeleton.
        choose('#model', 'ak47')
        painted = page.evaluate(f'({HASH})(akStudio.atlas.canvas)')
        moved = page.evaluate('''async () => {
          const T = await import('three'), scene = akStudio.scene;
          const at = name => scene.meshes.find(mesh => mesh.name === name).getWorldPosition(new T.Vector3());
          const gap = () => ({magazine: at('MAGAZINE').distanceTo(at('LOWER_RECIEVER')), bolt: at('BOLT').distanceTo(at('LOWER_RECIEVER')), stock: at('STOCK').distanceTo(at('LOWER_RECIEVER'))});
          const names = scene.active.clips.map(clip => clip.name), clip = name => scene.setClip(names.indexOf(name));
          clip('Idle'); const idle = gap();
          clip('Reload'); scene.scrub(.6); const reload = gap();
          clip('Fire'); scene.scrub(.06); const fire = gap();
          // Hands stay on the weapon while it is drawn.
          await scene.setView('hands');
          const grip = () => scene.active.cs2.bones.get('hand_r').getWorldPosition(new T.Vector3()).distanceTo(at('PISTOL_GRIP'));
          clip('Draw'); scene.scrub(.1); scene.render(); const early = grip(), where = at('PISTOL_GRIP');
          scene.scrub(1); scene.render(); const late = grip(), travelled = where.distanceTo(at('PISTOL_GRIP'));
          await scene.setView('angle'); clip('Idle');
          return {names, idle, reload, fire, early, late, travelled};
        }''')
        assert moved['names'] == ['Idle', 'Draw', 'Reload', 'Fire'], moved
        assert moved['reload']['magazine'] - moved['idle']['magazine'] > .5, moved
        assert abs(moved['fire']['bolt'] - moved['idle']['bolt']) > .05, moved
        assert all(abs(moved[pose]['stock'] - moved['idle']['stock']) < 1e-6 for pose in ('reload', 'fire')), moved
        assert moved['travelled'] > .02 and abs(moved['early'] - moved['late']) < 1e-3, moved
        assert page.evaluate(f'({HASH})(akStudio.atlas.canvas)') == painted, 'posing never repaints the skin'
        step('classic AK-47: reload, fire and draw move the right parts; hands follow')

        # Hands and animation on the animated model.
        choose('#model', 'aks74u'); act('#pose-panel summary')
        assert page.evaluate('akStudio.scene.meshes.filter(m => m.userData.spare).every(m => !m.visible)'), 'spare magazine hidden outside reloads'
        choose('#animation-clip', '0')
        assert page.evaluate('akStudio.scene.meshes.filter(m => m.userData.spare).every(m => m.visible)'), 'spare magazine shown while reloading'
        act('[data-view=hands]'); assert 'Hands view ready' in status(), status()
        choose('#glove', 'fingerless'); choose('#sleeve', 'sas')
        assert state()['appearance'] == {'glove': 'fingerless', 'sleeve': 'sas'}
        page.locator('#weapon-stage .canvas-wrap').screenshot(path=str(OUT / 'hands.png'))
        act('[data-view=angle]')
        step('hands, gloves, sleeves and the reload magazine')

        # Stickers: a separate pass with its own images, over the finished skin.
        choose('#model', 'ak47')
        bare, body = atlas(), layer('Body')
        assert page.is_disabled('#sticker-shuffle') and state()['stickers']['images'] == []
        page.set_input_files('#sticker-files', [images[0], images[3]])
        page.wait_for_function('akStudio.state.stickers.images.length === 2', timeout=120000); idle()
        assert len(state()['stickers']['images']) == 2 and len(state()['images']) == 4, 'sticker images are kept apart from skin images'
        assert 'sticker' in status().lower(), status()
        seen = {atlas()}
        assert bare not in seen and layer('Body') == body, 'stickers sit on top without repainting the skin'
        surface = '''() => { const record = akStudio.scene.active, mesh = record.meshes[0];
          return {map: !!record.surface, used: !!mesh.material.roughnessMap && mesh.material.roughnessMap === record.surface && mesh.material.metalnessMap === record.surface, reflections: !!mesh.material.envMap}; }'''
        assert page.evaluate(surface) == {'map': True, 'used': True, 'reflections': True}
        for effect in ('gold', 'holo', 'foil', 'engraved'):
            act(f'[data-sticker-effect={effect}]'); seen.add(atlas())
        assert len(seen) == 5, 'every effect looks different'
        page.locator('#weapon-stage .canvas-wrap').screenshot(path=str(OUT / 'stickers.png'))
        for change in ("[data-sticker-size=large]", "#sticker-shuffle"):
            act(change); seen.add(atlas())
        page.evaluate("() => { const input = document.querySelector('#sticker-count'); input.value = 9; input.dispatchEvent(new Event('change')); }"); idle()
        seen.add(atlas())
        assert len(seen) == 8 and state()['stickers']['count'] == 9 and state()['stickers']['size'] == 'large'
        download('#download-model', 'weapon.glb')
        assert page.evaluate('''async () => {
          const {GLTFLoader} = await import('./vendor/loaders/GLTFLoader.js');
          const copy = await new GLTFLoader().loadAsync('./qa/out/weapon.glb'); let shiny = 0, meshes = 0;
          copy.scene.traverse(object => { if (object.isMesh && object.material.map && !object.isSkinnedMesh) { meshes++; if (object.material.roughnessMap && object.material.metalnessMap) shiny++; } });
          return meshes > 0 && shiny === meshes;
        }'''), 'the downloaded model carries the sticker shine'
        choose('#model', 'aks74u'); assert page.evaluate('!!akStudio.atlas.stickers'), 'the same stickers go on every model'
        choose('#model', 'ak47')
        act('#sticker-clear')
        assert state()['stickers']['images'] == [] and atlas() == bare, 'removing the stickers restores the skin exactly'
        assert page.evaluate(surface) == {'map': False, 'used': False, 'reflections': False}
        choose('#model', 'aks74u')
        step('stickers: own images, five effects, size, count, shuffle, download and removal')

        # Phone studio.
        page.click('[data-mode=phone]')
        page.wait_for_function('akStudio.phone.ready', timeout=120000)
        assert page.is_hidden('#weapon-stage') and page.is_visible('#phone-stage')
        assert page.is_hidden('#library-section'), 'the phone studio has its own posts'
        phone_ready = lambda: page.wait_for_function('akStudio.phone.ready', timeout=180000)
        # Draws one still frame and hashes the phone's screen.
        screen = f'(() => {{ akStudio.phone.scene.update(0); return ({HASH})(akStudio.phone.scene.screenCanvas); }})()'
        settle = '() => { const s = akStudio.phone.scene; for (let i = 0; i < 400; i++) s.update(1 / 30, false); return s.scroll.position; }'
        assert page.evaluate('akStudio.phone.scene.hand.mesh.name').startswith('Object_'), 'the rigged hand is in the scene'
        page.evaluate('akStudio.phone.scene.now = () => new Date(2026, 0, 1, 9, 41)')   # A fixed status-bar clock keeps frames comparable.
        template = page.evaluate(screen)
        page.set_input_files('#phone-files', [images[0], images[1], images[2]]); page.wait_for_timeout(300); phone_ready()
        feed = page.evaluate('akStudio.phone.feed')
        assert len(feed) == 3 and page.locator('#phone-posts .image-tile').count() == 3 and page.evaluate('akStudio.library.images.length') == 4, 'posts are kept apart from skin images'
        posted = page.evaluate(screen); assert posted != template

        # Live: the wheel, auto-scroll and the endless feed.
        page.evaluate('akStudio.phone.scene.setActive(false)')
        page.dispatch_event('#phone-scene', 'wheel', {'deltaY': 400}); moved = page.evaluate(settle)
        assert moved == 560 and page.evaluate(screen) != posted, 'the wheel scrolls the feed'
        lap = page.evaluate('akStudio.phone.scene.screen.layout.height')
        page.click('[data-phone-bars=off]')   # The bars carry the clock, which may tick over mid-check.
        page.evaluate(f'akStudio.phone.scene.scrollBy({lap})'); assert page.evaluate(settle) == 560 + lap
        looped = page.evaluate(screen); page.evaluate(f'akStudio.phone.scene.scrollBy({-lap})'); page.evaluate(settle)
        assert page.evaluate(screen) == looped, 'the feed repeats exactly after one lap'
        page.click('[data-phone-bars=on]')
        page.click('[data-phone-auto=fast]'); assert page.evaluate('akStudio.phone.auto') == 'fast'
        assert page.evaluate(settle) > 560, 'auto-scroll moves the feed on its own'
        page.click('[data-phone-auto=off]'); page.evaluate(settle); rest = page.evaluate(settle); assert page.evaluate(settle) == rest
        thumb = '() => akStudio.phone.scene.hand.bones.thumb[1].quaternion.toArray()'
        still = page.evaluate(thumb); page.evaluate('akStudio.phone.scene.scrollBy(300); akStudio.phone.scene.update(.1, false); akStudio.phone.scene.update(.1, false)')
        assert page.evaluate(thumb) != still, 'the thumb swipes when the feed scrolls'
        page.evaluate(settle)

        # The template and the scene.
        with_bars = page.evaluate(screen); page.click('[data-phone-bars=off]'); bare_screen = page.evaluate(screen); assert bare_screen != with_bars
        page.click('[data-phone-bars=on]'); with_bars = page.evaluate(screen); assert with_bars != bare_screen
        page.click('#phone-use-weapon'); page.wait_for_function('akStudio.phone.ready && akStudio.phone.feed[0] === "weapon-render"', timeout=120000)
        assert len(page.evaluate('akStudio.phone.feed')) == 4 and page.evaluate(screen) != with_bars
        page.click('#phone-shuffle'); assert sorted(page.evaluate('akStudio.phone.feed')) == sorted(feed + ['weapon-render'])
        page.fill('#phone-seed', 'smoke'); page.press('#phone-seed', 'Enter'); config = page.evaluate('akStudio.phone.config')
        page.fill('#phone-seed', 'other'); page.press('#phone-seed', 'Enter')
        page.fill('#phone-seed', 'smoke'); page.press('#phone-seed', 'Enter')
        assert page.evaluate('akStudio.phone.config') == config, 'a phone seed must reproduce its scene'
        frame = '(() => { akStudio.phone.scene.update(0); return akStudio.phone.scene.canvas.toDataURL(); })()'
        frames = set()
        for world in ('yard', 'night', 'hall'):
            page.select_option('#phone-environment', world); frames.add(page.evaluate(frame))
        for hold in ('hip', 'raised'):
            page.select_option('#phone-hold', hold); frames.add(page.evaluate(frame))
        page.click('[data-phone-hud=off]'); frames.add(page.evaluate(frame)); page.click('[data-phone-hud=on]')
        assert len(frames) >= 5, 'worlds, holds and the overlay all change the picture'
        for format, size in (('tall', (1080, 1920)), ('post', (1080, 1350)), ('wide', (1920, 1080))):
            page.select_option('#phone-format', format)
            with page.expect_download(timeout=120000) as event: page.click('#phone-download')
            event.value.save_as(str(OUT / f'phone-{format}.png')); phone_ready()
            assert Image.open(OUT / f'phone-{format}.png').size == size
        if page.evaluate('akStudio.phone.scene.startRecording()'):
            page.wait_for_timeout(300)
            # Headless Chromium has no video encoder, so only the hand-off is checked here, not the footage.
            assert page.evaluate('akStudio.phone.scene.stopRecording().then(video => video.type)') == 'video/webm' and not page.evaluate('!!akStudio.phone.scene.recorder')
        page.click('#phone-clear'); assert page.evaluate('akStudio.phone.feed') == [] and page.evaluate(settle) is not None
        page.evaluate('akStudio.phone.scene.scroll.position = akStudio.phone.scene.scroll.target = 0; akStudio.phone.scene.redrawScreen = true')
        assert page.evaluate(screen) == template, 'with no posts the template shows its stand-ins again'
        step('phone scene: rigged hand, feed of posts, live scrolling, worlds, frames, recording and downloads')

        # Removing images and resetting.
        page.click('[data-mode=weapon]'); idle()
        assert page.is_visible('#library-section') and not page.evaluate('akStudio.phone.scene.request'), 'the live view pauses off-screen'
        while page.locator('#images .remove-image').count():
            page.locator('#images .remove-image').first.click(force=True); idle()
        assert page.evaluate('akStudio.atlas.hasArtwork') is False and atlas() == factory, 'no images means the factory finish'
        act('#reset'); assert state()['settings']['style'] == 'collage'
        step('removing every image restores the factory finish')

        page.set_viewport_size({'width': 390, 'height': 844}); page.wait_for_timeout(400)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'no horizontal scrolling on a phone-sized screen'
        page.screenshot(path=str(OUT / 'mobile.png'), full_page=True)
        step('narrow layout')

        assert not errors, errors
        browser.close()
    print('All smoke checks passed.')


if __name__ == '__main__':
    main()
