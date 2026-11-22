// Weapon studio controller: wires the controls to the skin pipeline and the
// 3D scene. Each model keeps its own workspace (atlas, parts and settings).
import {GunScene, MODELS} from './scene.js';
import {GLOVES, SLEEVES} from './cs2-hands.js';
import {Atlas, SkinPainter} from './skin/atlas.js';
import {DesignComposer} from './skin/design.js';
import {StickerPrinter} from './skin/stickers.js';
import {ImageLibrary} from '../shared/library.js';
import {Projector} from './skin/projector.js';
import {PALETTE_PRESETS, PALETTE_SLOTS, targetStats, extractPalette} from './skin/palette.js';
import {
  BASE_COATS, DEFAULT_SETTINGS, DEFAULT_STICKERS, FINISHES, SCALES, STICKER_EFFECTS, STICKER_SIZES, STYLES, TOUCHES, TREATMENTS,
  initialParts, resetRevisions, surprise,
} from './skin/generator.js';
import {newSeed} from '../shared/random.js';

const $ = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];

export async function initWeapon({library}) {
  let scene, projector, atlas, parts = {}, settings = {...DEFAULT_SETTINGS};
  let ready = false, busy = false, repaintQueued = false, selected = null;
  const composer = new DesignComposer(), workspaces = new Map();
  // Stickers are one sheet shared by every model, with their own images.
  const stickerLibrary = new ImageLibrary(), printer = new StickerPrinter();
  let stickers = {...DEFAULT_STICKERS}, stickerUploading = false;
  const stickerPass = () => ({images: stickerLibrary.images, settings: stickers});
  const applyFinish = () => scene.setFinish(atlas.paintedZones, settings.finish, atlas.stickers ? values => atlas.surfaceMap(values) : null);
  let autoPalette = null, autoPaletteKey = null;

  function status(message, error = false) {
    $('status').textContent = message; $('status').classList.toggle('error', error);
  }

  // ---------------------------------------------------------- look

  function palette() {
    if (settings.palette === 'custom' && settings.custom) return settings.custom;
    const preset = PALETTE_PRESETS.find(item => item.id === settings.palette);
    if (preset) return preset.colors;
    const key = library.images.map(entry => entry.id).join();
    if (key !== autoPaletteKey) {
      const pooled = new Uint8ClampedArray(library.images.reduce((total, entry) => total + entry.samples.length, 0));
      let offset = 0;
      for (const entry of library.images) { pooled.set(entry.samples, offset); offset += entry.samples.length; }
      autoPalette = library.images.length ? extractPalette(pooled) : PALETTE_PRESETS[0].colors;
      autoPaletteKey = key;
    }
    return autoPalette;
  }

  /** Everything about colour that the painted pixels depend on. */
  function look() {
    const colors = palette();
    const target = library.images.length ? targetStats(library.images.map(entry => entry.stats)) : null;
    const matchKey = settings.treatment === 'matched' && target ? [...target.mean, ...target.spread].map(Math.round) : 0;
    return {
      treatment: settings.treatment, palette: colors, baseCoat: settings.baseCoat, target,
      key: JSON.stringify([settings.treatment, colors, settings.baseCoat, matchKey]),
    };
  }

  // ---------------------------------------------------------- painting

  /** Repaints whatever changed. Calls made while painting are coalesced into one follow-up. */
  async function paint(message) {
    if (!ready) return;
    if (busy) { repaintQueued = true; return; }
    busy = true; render();
    try {
      do {
        repaintQueued = false;
        await atlas.update(parts, library.images, settings, look(), zones => status(`Painting ${zones.join(', ').toLowerCase()}…`), stickerPass());
      } while (repaintQueued);
      applyFinish(); scene.refresh();
      status(message || (atlas.stickers && !atlas.hasArtwork ? 'Stickers applied to the factory finish.' : atlas.hasArtwork ? 'Skin ready. Rotate it to see both sides.' : 'Factory finish. Add images to paint this weapon.'));
    } catch (error) {
      console.error(error); status(`Could not paint this skin: ${error.message}`, true);
    } finally {
      busy = false; render();
    }
  }

  async function generate(seed, extra = {}) {
    if (!ready || busy || !library.images.length) return;
    if (Object.values(parts).every(part => part.locked)) { status('All parts are locked. Unlock a part to generate changes.'); return; }
    settings = {...settings, ...extra, seed: seed.trim() || DEFAULT_SETTINGS.seed};
    parts = resetRevisions(parts);
    await paint();
  }

  function setting(key, value) {
    if (busy || settings[key] === value) return;
    settings = {...settings, [key]: value};
    if (key === 'finish') { applyFinish(); render(); return; }
    render();
    void paint();
  }

  // ---------------------------------------------------------- rendering the controls

  function segmented(attribute, value) {
    for (const button of all(`[data-${attribute}]`)) {
      const active = button.dataset[attribute.replace(/-(\w)/g, (_, letter) => letter.toUpperCase())] === value;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    }
  }

  function render() {
    const idle = ready && !busy, record = scene?.active, hasImages = library.images.length > 0;
    for (const id of ['model', 'reset', 'reset-view', 'seed', 'stencil-text', 'palette', 'base-coat', 'finish', 'download-render', 'download-texture', 'download-model']) $(id).disabled = !idle;
    for (const id of ['generate', 'apply-seed', 'surprise']) $(id).disabled = !idle || !hasImages;
    for (const button of all('[data-view],[data-style],[data-scale],[data-treatment],[data-touch],#swatches input')) button.disabled = !idle;
    if (!record) return;

    const canHands = record.capabilities.hands;
    document.querySelector('[data-view="hands"]').disabled = !idle || !canHands;
    $('glove').disabled = !idle || !canHands;
    $('sleeve').disabled = !idle || !canHands || record.appearance.glove === 'original';
    $('glove').value = record.appearance.glove; $('sleeve').value = record.appearance.sleeve;
    $('hands-note').textContent = canHands ? 'Choose the Hands view to see them. Original Hands restores the model’s own arms.' : 'This CS2 weapon ships without arm animations, so hands are unavailable for it.';
    const animation = scene.animationState;
    $('animation-clip').disabled = !idle || !animation;
    for (const id of ['animation-play', 'animation-time']) $(id).disabled = !idle || !(animation?.duration > 0);

    $('model').value = record.id; $('model-tag').textContent = record.capabilities.tag;
    $('seed').value = settings.seed;
    segmented('style', settings.style); segmented('scale', settings.scale); segmented('treatment', settings.treatment);
    $('style-hint').textContent = `${STYLES[settings.style].hint} ${SCALES[settings.scale].hint}`;
    $('treatment-hint').textContent = TREATMENTS[settings.treatment].hint;
    $('text-field').hidden = settings.style !== 'text';
    if (document.activeElement !== $('stencil-text')) $('stencil-text').value = settings.text;
    const active = Object.keys(TOUCHES).filter(touch => settings[touch]);
    for (const button of all('[data-touch]')) {
      button.classList.toggle('active', settings[button.dataset.touch]); button.setAttribute('aria-pressed', String(settings[button.dataset.touch]));
    }
    $('touch-hint').textContent = active.length ? active.map(touch => TOUCHES[touch].hint).join(' ') : 'Optional passes laid over any layout.';
    $('palette').value = settings.palette; $('base-coat').value = settings.baseCoat; $('finish').value = settings.finish;
    const colors = palette();
    for (const slot of PALETTE_SLOTS) $(`color-${slot}`).value = colors[slot];

    const locks = Object.values(parts).filter(part => part.locked).length, painted = atlas?.hasArtwork;
    $('edition').textContent = painted ? settings.seed : 'Factory finish';
    $('edition-info').textContent = painted
      ? `${STYLES[settings.style].label} · ${TREATMENTS[settings.treatment].label.toLowerCase()} colour · ${library.images.length} image${library.images.length === 1 ? '' : 's'}${locks ? ` · ${locks} locked` : ''}`
      : 'Add images to paint this weapon.';
    $('selected-label').textContent = selected ? `${selected.toUpperCase()} SELECTED` : 'CLICK A PART ON THE MODEL';
    renderParts(idle);
    renderStickers(idle);
  }

  function renderStickers(idle) {
    const count = stickerLibrary.images.length, any = count > 0;
    $('sticker-count-badge').textContent = String(count).padStart(2, '0');
    $('sticker-files').disabled = !ready || stickerUploading;
    for (const button of all('[data-sticker-effect],[data-sticker-size]')) button.disabled = !idle;
    segmented('sticker-effect', stickers.effect); segmented('sticker-size', stickers.size);
    $('sticker-hint').textContent = STICKER_EFFECTS[stickers.effect].hint;
    $('sticker-count').disabled = !idle; $('sticker-count').value = stickers.count;
    $('sticker-count-label').textContent = `${stickers.count} sticker${stickers.count === 1 ? '' : 's'}`;
    $('sticker-shuffle').disabled = !idle || !any; $('sticker-clear').disabled = !idle || !any;
    $('sticker-images').replaceChildren(...stickerLibrary.images.map(entry => {
      const tile = document.createElement('div'), thumb = document.createElement('img'), remove = document.createElement('button');
      tile.className = 'image-tile'; thumb.src = entry.url; thumb.alt = entry.name; thumb.title = entry.name;
      remove.className = 'remove-image'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove sticker ${entry.name}`);
      remove.disabled = !idle; remove.onclick = () => stickerLibrary.remove(entry.id);
      tile.append(thumb, remove);
      return tile;
    }));
  }

  function stickerSetting(key, value) {
    if (busy || stickers[key] === value) return;
    stickers = {...stickers, [key]: value};
    render();
    if (stickerLibrary.images.length) void paint(`Stickers updated · ${STICKER_EFFECTS[stickers.effect].label.toLowerCase()}.`);
  }

  async function uploadStickers(files) {
    if (stickerUploading || !files.length) return;
    stickerUploading = true; render();
    $('sticker-status').classList.remove('error'); $('sticker-status').textContent = 'Opening your stickers…';
    const {added, errors} = await stickerLibrary.add(files);
    stickerUploading = false;
    $('sticker-status').classList.toggle('error', errors.length > 0);
    $('sticker-status').textContent = errors.length ? errors.join(' ') : added ? `${added} sticker image${added === 1 ? '' : 's'} added.` : 'Those images are already stickers.';
    render();
  }

  function renderParts(idle) {
    $('part-list').replaceChildren(...Object.entries(parts).map(([zone, part]) => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (selected === zone ? ' selected' : '');
      chip.textContent = zone + (part.locked ? ' · locked' : part.mode === 'solid' ? ' · solid' : part.mode === 'original' ? ' · factory' : part.revision || part.allowed.length ? ' · own art' : '');
      chip.setAttribute('aria-pressed', String(selected === zone)); chip.disabled = !idle;
      chip.onclick = () => select(zone);
      return chip;
    }));
    $('part-editor').hidden = !selected;
    if (!selected) return;

    const part = parts[selected], editable = idle && !part.locked, colors = palette();
    $('part-title').textContent = selected;
    $('part-lock').checked = part.locked; $('part-lock').disabled = !idle;
    segmented('part-mode', part.mode);
    for (const button of all('[data-part-mode]')) button.disabled = !editable;
    $('part-solid').hidden = part.mode !== 'solid'; $('part-art').hidden = part.mode !== 'art';
    $('part-solid').replaceChildren(...PALETTE_SLOTS.map(slot => {
      const button = document.createElement('button');
      button.className = 'swatch-button' + (part.solid === slot ? ' selected' : '');
      button.style.background = colors[slot]; button.title = `Palette ${slot}`; button.setAttribute('aria-label', `Palette ${slot}`);
      button.disabled = !editable;
      button.onclick = () => editPart({solid: slot});
      return button;
    }));

    const own = part.revision > 0 || part.allowed.length > 0;
    $('part-all').disabled = !editable || !part.allowed.length;
    $('part-generate').disabled = !editable || !library.images.length;
    $('part-rejoin').disabled = !editable || !own;
    if (!library.images.length) {
      const note = document.createElement('p'); note.className = 'hint'; note.textContent = 'Add images to paint this part.';
      $('part-images').replaceChildren(note);
      return;
    }
    $('part-images').replaceChildren(...library.images.map(entry => {
      const label = document.createElement('label'), input = document.createElement('input'), thumb = document.createElement('img');
      label.className = 'part-choice'; label.title = entry.name;
      input.type = 'checkbox'; input.checked = !part.allowed.length || part.allowed.includes(entry.id); input.disabled = !editable;
      input.setAttribute('aria-label', `Use ${entry.name} on ${selected}`);
      thumb.src = entry.url; thumb.alt = '';
      input.onchange = () => {
        const allowed = new Set(part.allowed.length ? part.allowed : library.images.map(item => item.id));
        input.checked ? allowed.add(entry.id) : allowed.delete(entry.id);
        if (!allowed.size) { input.checked = true; status('Keep at least one image, or switch this part to a solid colour.'); return; }
        editPart({allowed: allowed.size === library.images.length ? [] : [...allowed].sort()});
      };
      label.append(input, thumb);
      return label;
    }));
  }

  function editPart(changes, message) {
    if (!selected || busy) return;
    parts = {...parts, [selected]: {...parts[selected], ...changes}};
    void paint(message);
  }

  function select(zone) {
    if (!ready || busy) return;
    selected = zone; scene.select(zone);
    if (zone) $('parts-panel').open = true;
    render();
  }

  // ---------------------------------------------------------- views, hands, animation

  function syncView() {
    for (const button of all('[data-view]')) {
      button.classList.toggle('active', button.dataset.view === scene.view);
      button.setAttribute('aria-pressed', String(button.dataset.view === scene.view));
    }
    $('view-hint').textContent = scene.view === 'hands' ? 'First-person view · click a part to edit it' : 'Drag to rotate · scroll to zoom · click a part to edit it';
  }

  async function changeView(view) {
    if (busy) return;
    busy = true; render();
    if (view === 'hands') status('Positioning the rigged hands…');
    try {
      await scene.setView(view); syncView();
      status(view === 'hands' ? 'Hands view ready. Render downloads include the hands.' : 'Studio view ready.');
    } catch (error) { status(`Could not load hands: ${error.message}`, true); }
    finally { busy = false; render(); }
  }

  function animationUpdate(state) {
    $('animation-panel').hidden = !state;
    if (!state) return;
    $('animation-play').textContent = state.playing ? 'Pause' : 'Play';
    $('animation-play').setAttribute('aria-pressed', String(state.playing));
    $('animation-time').max = state.duration; $('animation-time').value = state.time;
    $('animation-label').textContent = `${state.time.toFixed(2)} / ${state.duration.toFixed(2)} s`;
  }

  // ---------------------------------------------------------- workspaces

  async function loadWorkspace(id) {
    if (scene.active && atlas) {
      scene.select(null);
      workspaces.set(scene.active.id, {atlas, parts, settings});
    }
    busy = true; render(); status(`Loading ${MODELS[id].label}…`);
    try {
      const meshes = await scene.load(id), cached = workspaces.get(id);
      if (cached) ({atlas, parts, settings} = cached);
      else {
        const painter = new SkinPainter(scene.active.bake, projector, composer, printer);
        atlas = new Atlas(meshes, scene.active.atlasOptions, painter);
        parts = initialParts(scene.active.atlasOptions.zones);
        // A new model starts from the look you were just using, with its
        // own name on the stencil unless you have typed something yourself.
        const stock = Object.values(MODELS).map(model => model.text || DEFAULT_SETTINGS.text);
        settings = {...settings, text: stock.includes(settings.text) ? MODELS[id].text || DEFAULT_SETTINGS.text : settings.text};
      }
      selected = null;
      await atlas.update(parts, library.images, settings, look(), undefined, stickerPass());
      scene.setAtlas(atlas.canvas); applyFinish();
      $('animation-clip').replaceChildren(...scene.active.clips.map((clip, index) => {
        const option = document.createElement('option');
        option.value = index; option.textContent = clip.name.replace(/^.*\|/, '').replaceAll('_', ' ');
        return option;
      }));
      if (scene.animationState) $('animation-clip').value = scene.animationState.clipIndex;
      animationUpdate(scene.animationState); syncView();
      ready = true; $('loading').hidden = true;
      status(library.images.length ? 'Skin ready. Rotate it to see both sides.' : 'Your model is ready. Add images to paint it.');
    } finally { busy = false; render(); }
  }

  // ---------------------------------------------------------- downloads

  async function download(kind) {
    if (busy) return;
    busy = true; render();
    status({render: 'Rendering your PNG…', model: 'Packing your model, textures and animations…', texture: 'Preparing your texture…'}[kind]);
    try {
      const blob = kind === 'render' ? await scene.exportPNG() : kind === 'model' ? await scene.exportGLB()
        : await new Promise((resolve, reject) => atlas.canvas.toBlob(value => value ? resolve(value) : reject(Error('Texture export failed.')), 'image/png'));
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `${scene.active.id}-${settings.seed.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)}-${kind}.${kind === 'model' ? 'glb' : 'png'}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      status({render: 'Render downloaded · 1920 × 1080 px.', texture: 'Texture downloaded · 2048 × 2048 px.', model: scene.active.clips.length ? 'GLB downloaded with its skin, rig and animation clips.' : 'GLB downloaded with your model and skin.'}[kind]);
    } catch (error) { status(error.message, true); }
    finally { busy = false; render(); }
  }

  // ---------------------------------------------------------- wiring

  for (const [id, options] of [['glove', GLOVES], ['sleeve', SLEEVES]]) {
    $(id).replaceChildren(...options.map(([value, label]) => new Option(label, value)));
    $(id).onchange = async () => {
      // Read the choice first: render() syncs both menus back to the scene.
      const appearance = {glove: $('glove').value, sleeve: $('sleeve').value};
      busy = true; render(); status('Loading your selected hands…');
      try {
        await scene.setAppearance(appearance);
        status(scene.view === 'hands' ? 'Hands updated.' : 'Hands ready. Choose the Hands view to see them.');
      } catch (error) { status(`Could not load appearance: ${error.message}. Your previous hands are still available.`, true); }
      finally { busy = false; render(); }
    };
  }
  $('palette').replaceChildren(new Option('Auto · from your images', 'auto'), ...PALETTE_PRESETS.map(preset => new Option(preset.label, preset.id)), new Option('Custom', 'custom'));
  $('base-coat').replaceChildren(...Object.entries(BASE_COATS).map(([value, label]) => new Option(label, value)));
  $('finish').replaceChildren(...Object.entries(FINISHES).map(([value, finish]) => new Option(finish.label, value)));
  $('swatches').replaceChildren(...PALETTE_SLOTS.map(slot => {
    const input = document.createElement('input');
    input.type = 'color'; input.id = `color-${slot}`; input.title = `Palette ${slot}`; input.setAttribute('aria-label', `Palette ${slot} colour`);
    // Editing any swatch forks the current palette into a custom one.
    input.onchange = () => {
      if (busy) return;
      settings = {...settings, palette: 'custom', custom: {...palette(), [slot]: input.value}};
      void paint();
    };
    return input;
  }));
  $('palette').onchange = () => {
    if ($('palette').value === 'custom' && !settings.custom) settings = {...settings, custom: {...palette()}};
    setting('palette', $('palette').value);
  };
  $('base-coat').onchange = () => setting('baseCoat', $('base-coat').value);
  $('finish').onchange = () => setting('finish', $('finish').value);
  const optionButtons = (attribute, options) => Object.entries(options).map(([value, option]) => {
    const button = document.createElement('button');
    button.dataset[attribute] = value; button.textContent = option.label; button.title = option.hint;
    return button;
  });
  $('styles').replaceChildren(...optionButtons('style', STYLES));
  $('treatments').replaceChildren(...optionButtons('treatment', TREATMENTS));
  $('touches').replaceChildren(...optionButtons('touch', TOUCHES));
  for (const button of all('[data-touch]')) button.onclick = () => setting(button.dataset.touch, !settings[button.dataset.touch]);
  // Repaint once typing pauses, rather than on every keystroke.
  let typing = 0;
  $('stencil-text').oninput = () => {
    clearTimeout(typing);
    typing = setTimeout(() => setting('text', $('stencil-text').value.trim().toUpperCase() || MODELS[scene.active.id].text || DEFAULT_SETTINGS.text), 350);
  };
  for (const button of all('[data-style]')) button.onclick = () => setting('style', button.dataset.style);
  for (const button of all('[data-scale]')) button.onclick = () => setting('scale', button.dataset.scale);
  for (const button of all('[data-treatment]')) button.onclick = () => setting('treatment', button.dataset.treatment);

  $('generate').onclick = () => generate(newSeed('edition'));
  $('apply-seed').onclick = () => generate($('seed').value);
  $('seed').addEventListener('keydown', event => { if (event.key === 'Enter') void generate($('seed').value); });
  $('surprise').onclick = () => { const seed = newSeed('edition'); void generate(seed, surprise(seed)); };

  for (const button of all('[data-view]')) button.onclick = () => changeView(button.dataset.view);
  $('reset-view').onclick = () => changeView(scene.view === 'hands' ? 'hands' : 'angle');
  $('animation-clip').onchange = () => scene.setClip(Number($('animation-clip').value));
  $('animation-play').onclick = () => scene.togglePlay();
  $('animation-time').oninput = () => scene.scrub(Number($('animation-time').value));

  $('part-lock').onchange = () => {
    parts = {...parts, [selected]: {...parts[selected], locked: $('part-lock').checked}};
    render(); status(parts[selected].locked ? `${selected} locked. Its artwork will stay exactly as it is.` : `${selected} unlocked.`);
    if (!parts[selected].locked) void paint();
  };
  for (const button of all('[data-part-mode]')) button.onclick = () => editPart({mode: button.dataset.partMode});
  $('part-all').onclick = () => editPart({allowed: []}, `${selected} now uses your whole collection.`);
  $('part-generate').onclick = () => editPart({revision: parts[selected].revision + 1}, `${selected} remixed with its own layout.`);
  $('part-rejoin').onclick = () => editPart({revision: 0, allowed: []}, `${selected} rejoined the shared design.`);

  $('download-render').onclick = () => download('render');
  $('download-texture').onclick = () => download('texture');
  $('download-model').onclick = () => download('model');
  $('reset').onclick = async () => {
    if (busy) return;
    workspaces.clear(); selected = null; scene.select(null);
    settings = {...DEFAULT_SETTINGS, text: MODELS[scene.active.id].text || DEFAULT_SETTINGS.text}; parts = initialParts(scene.active.atlasOptions.zones);
    stickers = {...DEFAULT_STICKERS};
    if (scene.active.clips.length) {
      const index = Math.max(0, scene.active.clips.findIndex(clip => clip.name.endsWith('Fire_single')));
      scene.setClip(index); $('animation-clip').value = index;
    }
    await scene.setView('angle'); syncView();
    await paint('Weapon studio reset.');
  };
  $('model').onchange = async () => {
    const previous = scene.active?.id || 'aks74u';
    try { await loadWorkspace($('model').value); }
    catch (error) { $('model').value = previous; status(`Could not load model: ${error.message}`, true); }
  };
  $('scene').addEventListener('scene-error', event => { ready = false; render(); status(event.detail, true); });

  library.addEventListener('change', event => {
    if (event.detail.reason === 'remove') {
      const strip = list => Object.fromEntries(Object.entries(list).map(([zone, part]) => [zone, {...part, allowed: part.allowed.filter(id => id !== event.detail.id)}]));
      parts = strip(parts);
      for (const workspace of workspaces.values()) workspace.parts = strip(workspace.parts);
    }
    void paint(event.detail.reason === 'remove' ? 'Image removed. Locked artwork is preserved.' : undefined);
  });

  // Stickers.
  for (const [container, attribute, options, key] of [['sticker-effects', 'stickerEffect', STICKER_EFFECTS, 'effect'], ['sticker-sizes', 'stickerSize', STICKER_SIZES, 'size']]) {
    $(container).replaceChildren(...Object.entries(options).map(([id, option]) => {
      const button = document.createElement('button');
      button.dataset[attribute] = id; button.textContent = option.label; button.disabled = true;
      button.onclick = () => stickerSetting(key, id);
      return button;
    }));
  }
  $('sticker-count').oninput = () => { $('sticker-count-label').textContent = `${$('sticker-count').value} sticker${$('sticker-count').value === '1' ? '' : 's'}`; };
  $('sticker-count').onchange = () => stickerSetting('count', Number($('sticker-count').value));
  $('sticker-shuffle').onclick = () => stickerSetting('seed', newSeed('stickers'));
  $('sticker-clear').onclick = () => { if (!busy) stickerLibrary.clear(); };
  $('sticker-files').onchange = event => { void uploadStickers([...event.target.files]); event.target.value = ''; };
  for (const name of ['dragenter', 'dragover']) $('sticker-dropzone').addEventListener(name, event => { event.preventDefault(); $('sticker-dropzone').classList.add('dragging'); });
  for (const name of ['dragleave', 'drop']) $('sticker-dropzone').addEventListener(name, event => { event.preventDefault(); $('sticker-dropzone').classList.remove('dragging'); });
  $('sticker-dropzone').addEventListener('drop', event => void uploadStickers([...event.dataTransfer.files]));
  stickerLibrary.addEventListener('change', event => {
    if (event.detail.reason !== 'add') $('sticker-status').textContent = '';
    printer.prune(new Set(stickerLibrary.images.map(entry => entry.id)));
    const count = stickerLibrary.images.length;
    void paint(count ? `Stickers applied · ${STICKER_EFFECTS[stickers.effect].label.toLowerCase()}.` : 'Stickers removed.');
  });

  render();
  try {
    scene = new GunScene($('scene'), select); scene.onAnimation = animationUpdate;
    projector = new Projector(scene.renderer);
    await loadWorkspace('aks74u');
  } catch (error) {
    const heading = document.createElement('strong'), message = document.createElement('span');
    heading.textContent = 'The studio could not load.'; message.textContent = 'Reload in a browser with WebGL enabled.';
    $('loading').replaceChildren(heading, message); status(error.message, true); console.error(error);
    if (scene) $('model').disabled = false;
  }
  window.addEventListener('pagehide', () => { projector?.dispose(); scene?.dispose(); stickerLibrary.dispose(); });

  return {
    get scene() { return scene; }, get atlas() { return atlas; }, get ready() { return ready && !busy; },
    get state() {
      return structuredClone({
        model: scene?.active?.id, appearance: scene?.active?.appearance, settings, palette: palette(), parts, selected,
        images: library.images.map(({id, name}) => ({id, name})),
        stickers: {...stickers, images: stickerLibrary.images.map(({id, name}) => ({id, name}))},
      });
    },
    /** A PNG blob of the current view, for the phone screen. */
    snapshot: () => scene.exportPNG(),
  };
}
