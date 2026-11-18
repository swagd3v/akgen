import {GunScene, MODELS} from './scene.js';
import {Atlas} from './collage.js';
import {ZONES, DENSITIES, DEFAULT_SEED, initialParts, generateParts} from './generator.js';
import {GLOVES, SLEEVES} from './cs2-hands.js';

const $ = id => document.getElementById(id);
let scene, atlas, ready = false, busy = false, images = [], parts = initialParts();
let selected = null, density = 'medium', seed = DEFAULT_SEED, generated = false;
const workspaces = new Map();
const hints = {sparse: 'A few pieces of artwork, with room to breathe.', medium: 'A mix of artwork and the original finish.', dense: 'More images, more overlap, more personality.'};

function status(message, error = false) {
  $('status').textContent = message; $('status').classList.toggle('error', error);
}
function buttons() {
  const inactive = !ready || busy;
  for (const id of ['download-render', 'download-texture', 'download-model', 'model', 'glove', 'sleeve', 'reset', 'reset-view', 'files', 'seed']) $(id).disabled = inactive;
  $('glove').disabled = inactive || !scene?.active?.capabilities.hands;
  $('sleeve').disabled = inactive || !scene?.active?.capabilities.hands || scene?.active?.appearance.glove === 'original';
  for (const id of ['animation-clip', 'animation-play', 'animation-time']) $(id).disabled = inactive || !scene?.animationState;
  for (const id of ['generate', 'apply-seed']) $(id).disabled = inactive || !images.length;
  document.querySelectorAll('[data-view],[data-density],.remove-image,.part-chip,.part-choice input').forEach(button => { button.disabled = inactive; });
  document.querySelector('[data-view="hands"]').disabled = inactive || !scene?.active?.capabilities.hands;
  for (const id of ['animation-play', 'animation-time']) $(id).disabled = inactive || !(scene?.animationState?.duration > 0);
  if (selected) {
    const locked = parts[selected].locked;
    $('part-lock').disabled = inactive;
    for (const id of ['part-all', 'part-generate']) $(id).disabled = inactive || locked || !images.length;
    $('part-original').disabled = inactive || locked;
    document.querySelectorAll('.part-choice input').forEach(input => { input.disabled = inactive || locked; });
  }
}

function update() {
  $('model').value = scene.active.id;
  appearanceUI();
  document.querySelector('.stage-top-note').textContent = scene.active.id === 'aks74u' ? 'AKS-74U / 7 ANIMATIONS' : scene.active.id === 'ak47-cs2' ? 'CS2 AK-47 / 5 ANIMATIONS' : 'AK-47 / 7 PARTS';
  document.querySelector('.edition-badge span').textContent = scene.active.id === 'aks74u' ? '74U' : '47';
  $('image-count').textContent = String(images.length).padStart(2, '0');
  $('seed').value = seed;
  $('edition').textContent = generated ? seed : 'Original finish';
  const locks = Object.values(parts).filter(part => part.locked).length;
  $('edition-info').textContent = generated ? `${DENSITIES[density].label} collage · ${images.length} source image${images.length === 1 ? '' : 's'} · ${locks} locked part${locks === 1 ? '' : 's'}` : 'A clean slate. Ready for your images.';
  $('selected-label').textContent = selected ? `${selected.toUpperCase()} SELECTED` : 'CLICK A PART TO CUSTOMIZE';
  $('density-hint').textContent = hints[density];
  document.querySelectorAll('[data-density]').forEach(button => {
    const active = button.dataset.density === density;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  renderImages(); renderParts(); buttons();
}

async function paint(message = 'Your skin is ready.') {
  busy = true; buttons();
  try {
    await atlas.update(parts, images, zone => status(`Composing ${zone.toLowerCase()}…`));
    scene.setPainted(atlas.hasArtwork); scene.refresh(); update(); status(message);
  } catch (error) { status(`Could not compose this skin: ${error.message}`, true); }
  finally { busy = false; buttons(); }
}

function select(zone) {
  if (!ready || busy) return;
  selected = zone; scene.select(zone);
  if (zone) $('parts-panel').open = true;
  update();
}

function renderImages() {
  $('images').replaceChildren();
  for (const image of images) {
    const tile = document.createElement('div'); tile.className = 'image-tile';
    const img = document.createElement('img'); img.src = image.url; img.alt = image.name; img.title = image.name;
    const remove = document.createElement('button'); remove.className = 'remove-image'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${image.name}`);
    remove.onclick = async () => {
      images = images.filter(item => item !== image); URL.revokeObjectURL(image.url);
      for (const part of Object.values(parts)) part.allowed = part.allowed.filter(id => id !== image.id);
      for (const workspace of workspaces.values()) for (const part of Object.values(workspace.parts)) part.allowed = part.allowed.filter(id => id !== image.id);
      update(); await paint('Image removed. Locked artwork is preserved.');
    };
    tile.append(img, remove); $('images').append(tile);
  }
}

function renderParts() {
  $('part-list').replaceChildren();
  for (const [zone, part] of Object.entries(parts)) {
    const button = document.createElement('button'); button.className = 'part-chip' + (selected === zone ? ' selected' : '');
    button.textContent = zone + (part.locked ? ' · locked' : ''); button.dataset.zone = zone;
    button.setAttribute('aria-pressed', String(selected === zone)); button.onclick = () => select(zone);
    $('part-list').append(button);
  }
  $('part-editor').hidden = !selected;
  if (!selected) return;
  const part = parts[selected]; $('part-title').textContent = selected; $('part-lock').checked = part.locked;
  $('part-images').replaceChildren();
  if (!images.length) {
    const note = document.createElement('p'); note.className = 'hint'; note.textContent = 'Add images to customize this part.'; $('part-images').append(note);
  }
  for (const image of images) {
    const label = document.createElement('label'); label.className = 'part-choice';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = !part.allowed.length || part.allowed.includes(image.id); input.setAttribute('aria-label', `Use ${image.name} on ${selected}`);
    const img = document.createElement('img'); img.src = image.url; img.alt = '';
    const name = document.createElement('span'); name.textContent = image.name; name.title = image.name;
    input.onchange = async () => {
      const allowed = new Set(part.allowed.length ? part.allowed : images.map(i => i.id));
      input.checked ? allowed.add(image.id) : allowed.delete(image.id);
      if (!allowed.size) { input.checked = true; status('Keep at least one image, or choose Original finish.'); return; }
      part.allowed = allowed.size === images.length ? [] : [...allowed].sort();
      part.seed = seed; part.density = density; part.revision++; generated = true;
      await paint(`${selected} artwork updated.`);
    };
    label.append(input, img, name); $('part-images').append(label);
  }
}

async function generate(nextSeed) {
  if (!ready || busy || !images.length) return;
  if (Object.values(parts).every(part => part.locked)) { status('All parts are locked. Unlock a part to generate changes.'); return; }
  seed = nextSeed.trim() || DEFAULT_SEED;
  parts = generateParts(parts, seed, density); generated = true;
  await paint('New skin ready. Rotate it to see both sides.');
}
function newSeed() { return 'edition-' + crypto.getRandomValues(new Uint32Array(1))[0].toString(36); }
$('generate').onclick = () => generate(newSeed());
$('apply-seed').onclick = () => generate($('seed').value);
$('seed').addEventListener('keydown', event => { if (event.key === 'Enter') void generate($('seed').value); });
document.querySelectorAll('[data-density]').forEach(button => {
  button.onclick = () => { density = button.dataset.density; update(); status('Density selected. Generate to apply it to unlocked parts.'); };
});
document.querySelectorAll('[data-view]').forEach(button => {
  button.onclick = () => changeView(button.dataset.view);
});
function syncViewUI() {
  document.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === scene.view);
    button.setAttribute('aria-pressed', String(button.dataset.view === scene.view));
  });
  document.querySelector('.stage-foot > span:first-child').textContent = scene.view === 'hands' ? 'FIRST-PERSON VIEW · CLICK A PART TO CUSTOMIZE' : '↔ DRAG TO ROTATE · SCROLL TO ZOOM';
}
function appearanceUI() {
  if(!scene?.active)return;
  $('glove').value=scene.active.appearance.glove;$('sleeve').value=scene.active.appearance.sleeve;
  document.querySelector('.appearance-panel .micro').textContent = scene.active.capabilities.hands ? 'Choose Hands to preview. Original Hands restores the model’s previous look.' : 'This CS2 weapon includes no matching arm animations. Hands are unavailable for this model.';
}
for(const [id,options]of [['glove',GLOVES],['sleeve',SLEEVES]]){
  for(const [value,label]of options){const option=document.createElement('option');option.value=value;option.textContent=label;$(id).append(option);}
  $(id).onchange=async()=>{
    busy=true;buttons();status('Loading your selected CS2 hands…');
    try{await scene.setAppearance({glove:$('glove').value,sleeve:$('sleeve').value});status(scene.view==='hands'?'Hands appearance updated.':'Appearance ready. Choose Hands to preview it.');}
    catch(error){status(`Could not load appearance: ${error.message}. Your previous hands are still available.`,true);}
    finally{appearanceUI();busy=false;buttons();}
  };
}
async function changeView(view) {
  busy = true; buttons();
  if (view === 'hands') status('Positioning the rigged hands…');
  try {
    await scene.setView(view);
    syncViewUI();
    status(view === 'hands' ? 'Hands view ready. Render download includes the hands.' : 'Studio view ready.');
  } catch (error) { status(`Could not load hands: ${error.message}`, true); }
  finally { busy = false; buttons(); }
}
$('reset-view').onclick = () => changeView(scene.view === 'hands' ? 'hands' : 'angle');
$('part-lock').onchange = () => { parts[selected].locked = $('part-lock').checked; update(); status(parts[selected].locked ? `${selected} locked. Its artwork will stay as it is.` : `${selected} unlocked.`); };
$('part-all').onclick = async () => { const part = parts[selected]; part.allowed = []; part.seed = seed; part.density = density; part.revision++; generated = true; await paint(`${selected} now uses your whole collection.`); };
$('part-generate').onclick = async () => { const part = parts[selected]; part.seed = seed; part.density = density; part.revision++; generated = true; await paint(`${selected} remixed.`); };
$('part-original').onclick = async () => { parts[selected].seed = null; await paint(`${selected} restored. Lock it to keep this finish.`); };

async function upload(files) {
  if (!ready || busy) return;
  busy = true; buttons(); status('Opening your images…');
  let added = 0; const errors = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) { errors.push(`${file.name}: choose an image file.`); continue; }
    if (file.size > 20 * 1024 * 1024) { errors.push(`${file.name}: exceeds 20 MB.`); continue; }
    let url;
    try {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const id = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (images.some(image => image.id === id)) continue;
      url = URL.createObjectURL(file); const decoded = new Image(); decoded.src = url; await decoded.decode();
      if (decoded.width * decoded.height > 50000000) throw Error('Use an image smaller than 50 megapixels.');
      // Bound collage source memory while preserving image proportions and alpha.
      const image = document.createElement('canvas'), ratio = Math.min(1, 1200 / Math.max(decoded.width, decoded.height));
      image.width = Math.max(1, Math.round(decoded.width * ratio)); image.height = Math.max(1, Math.round(decoded.height * ratio));
      image.getContext('2d').drawImage(decoded, 0, 0, image.width, image.height);
      images.push({id, name: file.name, url, image}); url = null; added++;
    } catch (error) { errors.push(`${file.name}: ${error.message.includes('megapixels') ? error.message : 'could not open this image. Try JPG, PNG or WebP.'}`); }
    finally { if (url) URL.revokeObjectURL(url); }
  }
  images.sort((a, b) => a.id.localeCompare(b.id)); busy = false; update();
  status(errors.length ? errors.join(' ') : added ? `${added} image${added === 1 ? '' : 's'} added. Hit Generate to make a skin.` : 'Those images are already in your collection.', !!errors.length);
}
$('files').onchange = event => { void upload([...event.target.files]); event.target.value = ''; };
for (const name of ['dragenter', 'dragover']) $('dropzone').addEventListener(name, event => { event.preventDefault(); $('dropzone').classList.add('dragging'); });
for (const name of ['dragleave', 'drop']) $('dropzone').addEventListener(name, event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); });
$('dropzone').addEventListener('drop', event => void upload([...event.dataTransfer.files]));

async function download(kind) {
  busy = true; buttons(); status(kind === 'render' ? 'Rendering your PNG…' : kind === 'model' ? 'Packing your model, textures and animations…' : 'Preparing your texture…');
  try {
    const blob = kind === 'render' ? await scene.exportPNG() : kind === 'model' ? await scene.exportGLB() : await new Promise((resolve, reject) => atlas.canvas.toBlob(value => value ? resolve(value) : reject(Error('Texture export failed.')), 'image/png'));
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${scene.active.id}-${seed.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)}-${kind}.${kind === 'model' ? 'glb' : 'png'}`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    status(kind === 'render' ? 'Render downloaded · 1920 × 1080 px.' : kind === 'model' ? scene.active.clips.length ? 'GLB downloaded with its skin, rig and animation clips.' : 'GLB downloaded with your model and skin.' : 'Texture downloaded · 2048 × 2048 px.');
  } catch (error) { status(error.message, true); }
  finally { busy = false; buttons(); }
}
$('download-render').onclick = () => download('render'); $('download-texture').onclick = () => download('texture');
$('download-model').onclick = () => download('model');
$('reset').onclick = async () => {
  images.forEach(image => URL.revokeObjectURL(image.url)); images = []; parts = initialParts(scene.active.atlasOptions.zones); selected = null;
  workspaces.clear();
  seed = DEFAULT_SEED; density = 'medium'; generated = false; scene.select(null); scene.setView('angle');
  if (scene.active.clips.length) {
    const index = Math.max(0, scene.active.clips.findIndex(clip => clip.name.endsWith('Fire_single')));
    scene.setClip(index); $('animation-clip').value = index;
  }
  syncViewUI();
  await paint('Studio reset. Add images to start a new edition.');
};
$('scene').addEventListener('scene-error', event => { ready = false; buttons(); status(event.detail, true); });

function animationUpdate(state) {
  $('animation-panel').hidden = !state;
  if (!state) return;
  $('animation-play').textContent = state.playing ? 'Pause' : 'Play';
  $('animation-play').setAttribute('aria-pressed', String(state.playing));
  $('animation-time').max = state.duration;
  $('animation-time').value = state.time;
  $('animation-label').textContent = `${state.time.toFixed(2)} / ${state.duration.toFixed(2)} s`;
  for (const id of ['animation-play', 'animation-time']) $(id).disabled = !ready || busy || state.duration <= 0;
}
$('animation-clip').onchange = () => scene.setClip(Number($('animation-clip').value));
$('animation-play').onclick = () => scene.togglePlay();
$('animation-time').oninput = () => scene.scrub(Number($('animation-time').value));

async function loadWorkspace(id) {
  if (scene.active && atlas) {
    scene.select(null);
    workspaces.set(scene.active.id, {atlas, parts, density, seed, generated});
  }
  busy = true; buttons(); status(`Loading ${MODELS[id].label}…`);
  try {
    const meshes = await scene.load(id);
    const cached = workspaces.get(id);
    if (cached) ({atlas, parts, density, seed, generated} = cached);
    else {
      atlas = new Atlas(meshes, scene.active.atlasOptions); parts = initialParts(scene.active.atlasOptions.zones);
      density = 'medium'; seed = DEFAULT_SEED; generated = false;
    }
    selected = null;
    await atlas.update(parts, images);
    scene.setAtlas(atlas.canvas);
    scene.setPainted(atlas.hasArtwork);
    $('animation-clip').replaceChildren();
    scene.active.clips.forEach((clip, index) => {
      const option = document.createElement('option'); option.value = index; option.textContent = clip.name.replace(/^.*\|/, '').replaceAll('_', ' '); $('animation-clip').append(option);
    });
    if (scene.animationState) $('animation-clip').value = scene.animationState.clipIndex;
    animationUpdate(scene.animationState);
    syncViewUI();
    ready = true; $('loading').hidden = true; update(); status('Your model is ready. Add images, or choose an animation.');
  } finally { busy = false; buttons(); }
}
$('model').onchange = async () => {
  const previous = scene.active?.id || 'aks74u';
  try { await loadWorkspace($('model').value); }
  catch (error) { $('model').value = previous; status(`Could not load model: ${error.message}`, true); }
};

buttons();
try {
  scene = new GunScene($('scene'), select); scene.onAnimation = animationUpdate;
  await loadWorkspace('aks74u');
} catch (error) {
  const heading = document.createElement('strong'), message = document.createElement('span');
  heading.textContent = 'The studio could not load.'; message.textContent = 'Reload in a browser with WebGL enabled.';
  $('loading').replaceChildren(heading, message); status(error.message, true); console.error(error);
  if (scene) $('model').disabled = false;
}
window.addEventListener('pagehide', () => { images.forEach(image => URL.revokeObjectURL(image.url)); scene?.dispose(); });
if (new URLSearchParams(location.search).has('debug')) window.akStudio = {
  get scene() { return scene; }, get atlas() { return atlas; }, get ready() { return ready; },
  get state() { return structuredClone({model: scene.active?.id, appearance:scene.active?.appearance, seed, density, parts, selected, images: images.map(({id, name}) => ({id, name}))}); },
};
