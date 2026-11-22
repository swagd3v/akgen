// Phone studio controller: your post screenshots, the scene controls and the
// live view. The 3D scene loads the first time the tab opens.
import {PhoneScene} from './scene.js';
import {templatePost} from './screen.js';
import {DEFAULT_OPTIONS, DEFAULT_SEED, SCREEN, WEAPON_POST, chooseScene, environments, formats, holds, shuffleFeed, speeds, themeFor} from './generator.js';
import {ImageLibrary} from '../shared/library.js';
import {newSeed} from '../shared/random.js';

const $ = id => document.getElementById(`phone-${id}`);
const all = selector => [...document.querySelectorAll(selector)];
const FRAME_CLASS = {wide: 'landscape', tall: 'vertical', post: 'portrait'};

/** @param getWeaponRender  async () => PNG Blob of the weapon studio's current view */
export function initPhone({getWeaponRender}) {
  // Screenshots keep their upload order and enough pixels to stay sharp on the phone.
  const library = new ImageLibrary({maxEdge: 2400, sorted: false});
  let scene, ready = false, busy = false, started = false, uploading = false, shown = false;
  let config = chooseScene(DEFAULT_SEED), order = [], weaponPost = null, auto = 'off', recording = false;

  function status(message, error = false) {
    $('status').textContent = message; $('status').classList.toggle('error', error);
  }
  const format = () => formats.find(item => item.id === config.format) || formats[0];

  /** The feed, top to bottom: the weapon post first, then the screenshots in order. */
  function posts() {
    const shots = order.map(id => library.get(id)).filter(Boolean);
    return {theme: themeFor(shots[0]?.samples), list: [...(weaponPost ? [{id: WEAPON_POST, image: weaponPost}] : []), ...shots.map(({id, image}) => ({id, image}))]};
  }
  function sendPosts() {
    if (!ready) return;
    const {list, theme} = posts();
    scene.setPosts(list, theme);
  }

  function render() {
    const idle = ready && !busy, count = order.length + (weaponPost ? 1 : 0);
    for (const id of ['download', 'generate', 'apply-seed', 'use-weapon', 'environment', 'hold', 'format', 'seed', 'fullscreen']) $(id).disabled = !idle;
    $('record').disabled = !idle && !recording;
    $('files').disabled = uploading;
    $('shuffle').disabled = !idle || order.length < 2; $('clear').disabled = !idle || !count;
    for (const key of ['environment', 'hold', 'format']) $(key).value = config[key];
    $('seed').value = config.seed;
    $('name').textContent = `POCKET / ${config.seed.toUpperCase()}`;
    $('count').textContent = String(count).padStart(2, '0');
    const {width, height, label} = format();
    $('size').textContent = `${width} × ${height} PX`; $('download-size').textContent = `${width} × ${height}`;
    $('format-note').textContent = label.toUpperCase();
    $('wrap').className = `canvas-wrap ${FRAME_CLASS[config.format]}`;
    $('use-weapon').textContent = weaponPost ? 'Remove my weapon post' : 'Post my weapon render';
    $('record').textContent = recording ? 'Stop and save video' : 'Record video'; $('record').classList.toggle('active', recording);
    for (const [attribute, value] of [['bars', config.bars ? 'on' : 'off'], ['hud', config.hud ? 'on' : 'off'], ['auto', auto]]) {
      for (const button of all(`[data-phone-${attribute}]`)) {
        const active = button.dataset[`phone${attribute[0].toUpperCase()}${attribute.slice(1)}`] === value;
        button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); button.disabled = !idle;
      }
    }
    $('posts').replaceChildren(...order.map(id => library.get(id)).filter(Boolean).map(entry => {
      const tile = document.createElement('div'), thumb = document.createElement('img'), remove = document.createElement('button');
      tile.className = 'image-tile'; thumb.src = entry.url; thumb.alt = entry.name; thumb.title = entry.name;
      remove.className = 'remove-image'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${entry.name}`);
      remove.onclick = () => library.remove(entry.id);
      tile.append(thumb, remove);
      return tile;
    }));
  }

  function apply(message) {
    render();   // The frame's shape is set first so the scene sizes itself to it.
    if (ready) scene.apply(config);
    if (message) status(message);
  }
  function set(change, message) {
    if (!ready || busy) return;
    config = {...config, ...change}; apply(message);
  }
  const options = () => ({format: config.format, hud: config.hud, bars: config.bars});

  function generate(seed) {
    if (!ready || busy) return;
    config = chooseScene(seed.trim() || DEFAULT_SEED, options());
    apply('Scene generated. Ready to download.');
  }

  function setAuto(next) {
    if (!ready) return;
    auto = next; scene.setAuto(auto !== 'off', auto === 'off' ? undefined : auto); render();
    status(auto === 'off' ? 'Auto-scroll is off. Scroll or drag to move the feed.' : `Auto-scrolling · ${speeds.find(item => item.id === auto).label.toLowerCase()}.`);
  }

  function save(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  const fileStem = () => `pocket-${config.seed.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)}`;

  async function upload(files) {
    if (uploading || !files.length) return;
    uploading = true; render();
    $('library-status').classList.remove('error'); $('library-status').textContent = 'Opening your screenshots…';
    scene?.setActive(false);   // Leave the processor to the images while they open.
    const {added, errors} = await library.add(files);
    uploading = false; scene?.setActive(shown && ready);
    $('library-status').classList.toggle('error', errors.length > 0);
    $('library-status').textContent = errors.length ? errors.join(' ') : added ? `${added} post${added === 1 ? '' : 's'} added to the feed.` : 'Those screenshots are already in the feed.';
    render();
  }

  for (const [key, list] of [['environment', environments], ['hold', holds], ['format', formats]]) {
    $(key).replaceChildren(...list.map(item => new Option(item.label, item.id)));
    $(key).onchange = () => set({[key]: $(key).value});
  }
  for (const button of all('[data-phone-bars]')) button.onclick = () => set({bars: button.dataset.phoneBars === 'on'});
  for (const button of all('[data-phone-hud]')) button.onclick = () => set({hud: button.dataset.phoneHud === 'on'});
  for (const button of all('[data-phone-auto]')) button.onclick = () => setAuto(button.dataset.phoneAuto);
  $('generate').onclick = () => generate(newSeed('pocket'));
  $('apply-seed').onclick = () => generate($('seed').value);
  $('seed').addEventListener('keydown', event => { if (event.key === 'Enter') generate($('seed').value); });

  $('files').onchange = event => { void upload([...event.target.files]); event.target.value = ''; };
  for (const name of ['dragenter', 'dragover']) $('dropzone').addEventListener(name, event => { event.preventDefault(); $('dropzone').classList.add('dragging'); });
  for (const name of ['dragleave', 'drop']) $('dropzone').addEventListener(name, event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); });
  $('dropzone').addEventListener('drop', event => void upload([...event.dataTransfer.files]));
  $('shuffle').onclick = () => { if (ready && !busy) { order = shuffleFeed(order, newSeed('feed')); sendPosts(); render(); status('Feed shuffled.'); } };
  $('clear').onclick = () => { if (!busy) { weaponPost = null; library.clear(); } };

  library.addEventListener('change', event => {
    if (event.detail.reason !== 'add') $('library-status').textContent = '';
    const ids = library.images.map(entry => entry.id);
    order = [...order.filter(id => ids.includes(id)), ...ids.filter(id => !order.includes(id))];
    sendPosts(); render();
    if (ready) status(ids.length ? 'Feed updated. Scroll to read it.' : 'No posts yet: the template shows stand-ins.');
  });

  $('use-weapon').onclick = async () => {
    if (!ready || busy) return;
    if (weaponPost) { weaponPost = null; sendPosts(); render(); status('Weapon post removed.'); return; }
    busy = true; render(); status('Rendering your weapon…');
    try {
      const picture = await createImageBitmap(await getWeaponRender());
      weaponPost = templatePost(posts().theme, 0, picture, 'New skin just dropped');
      picture.close?.();
      busy = false; sendPosts(); status('Your weapon render is the first post in the feed.');
    } catch (error) { status(`Could not render the weapon: ${error.message}`, true); }
    finally { busy = false; render(); }
  };

  $('download').onclick = async () => {
    if (!ready || busy) return;
    busy = true; render(); status('Rendering your PNG…');
    try {
      save(await scene.exportPNG(), `${fileStem()}.png`);
      status(`PNG downloaded · ${format().width} × ${format().height} px.`);
    } catch (error) { status(error.message, true); }
    finally { busy = false; render(); }
  };

  $('record').onclick = async () => {
    if (!ready) return;
    if (recording) {
      recording = false; render();
      const video = await scene.stopRecording();
      if (video?.size) { save(video, `${fileStem()}.webm`); status('Video saved as WebM.'); } else status('Nothing was recorded.', true);
    } else if (scene.startRecording()) { recording = true; render(); status('Recording the live view. Press the button again to stop and save.'); }
    else status('This browser cannot record the view. Use a screen recorder instead.', true);
  };

  $('fullscreen').onclick = () => {
    if (!ready) return;
    $('wrap').requestFullscreen?.().catch(() => status('Full screen was blocked by the browser.', true));
  };
  document.addEventListener('keydown', event => {
    if (document.fullscreenElement !== $('wrap') || !ready) return;
    const step = {ArrowDown: .25, ArrowUp: -.25, PageDown: .8, PageUp: -.8}[event.key];
    if (step) { event.preventDefault(); scene.scrollBy(step * SCREEN.height); }
    else if (event.key === ' ') { event.preventDefault(); setAuto(auto === 'off' ? 'normal' : 'off'); }
  });

  $('reset').onclick = () => {
    if (busy) return;
    config = chooseScene(DEFAULT_SEED, DEFAULT_OPTIONS); auto = 'off'; scene?.setAuto(false);
    apply('Phone scene reset.');
  };

  render();
  return {
    get scene() { return scene; }, get ready() { return ready && !busy && !uploading; }, get config() { return {...config}; },
    get feed() { return [...(weaponPost ? [WEAPON_POST] : []), ...order]; }, get auto() { return auto; }, library,
    /** Loads the 3D scene and starts the live view. Safe to call every time the tab is shown. */
    async start() {
      shown = true;
      if (started) { scene?.setActive(ready); return; }
      started = true; status('Loading the hand and phone…');
      try {
        scene = new PhoneScene(document.getElementById('phone-scene'));
        scene.canvas.addEventListener('scene-error', event => { ready = false; scene.setActive(false); render(); status(event.detail, true); });
        await scene.load();
        ready = true; $('loading').hidden = true;
        sendPosts(); apply(order.length ? 'Scene ready. Scroll to read the feed.' : 'Scene ready. Add screenshots of your posts.');
        scene.setActive(shown);
      } catch (error) {
        const title = document.createElement('strong'), message = document.createElement('span');
        title.textContent = 'The scene could not load.'; message.textContent = 'Reload in a browser with WebGL enabled.';
        $('loading').replaceChildren(title, message); status(error.message, true); console.error(error);
      }
    },
    /** Pauses the live view while the tab is hidden. */
    stop() { shown = false; scene?.setActive(false); },
    dispose() { scene?.dispose(); library.dispose(); },
  };
}
