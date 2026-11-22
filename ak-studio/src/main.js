// Entry point: owns the weapon studio's image library and switches between
// the weapon and phone studios.
import {ImageLibrary} from './shared/library.js';
import {initWeapon} from './weapon/app.js';
import {initPhone} from './phone/app.js';

const $ = id => document.getElementById(id);
const library = new ImageLibrary();
let mode = 'weapon', weapon = null, phone = null, uploading = false;

function renderLibrary() {
  $('image-count').textContent = String(library.images.length).padStart(2, '0');
  $('images').replaceChildren(...library.images.map(entry => {
    const tile = document.createElement('div'), thumb = document.createElement('img'), remove = document.createElement('button');
    tile.className = 'image-tile'; thumb.src = entry.url; thumb.alt = entry.name; thumb.title = entry.name;
    remove.className = 'remove-image'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${entry.name}`);
    remove.onclick = () => library.remove(entry.id);
    tile.append(thumb, remove);
    return tile;
  }));
}

async function upload(files) {
  if (uploading || !files.length) return;
  uploading = true; $('files').disabled = true;
  $('library-status').classList.remove('error'); $('library-status').textContent = 'Opening your images…';
  const {added, errors} = await library.add(files);
  uploading = false; $('files').disabled = false;
  $('library-status').classList.toggle('error', errors.length > 0);
  $('library-status').textContent = errors.length ? errors.join(' ') : added ? `${added} image${added === 1 ? '' : 's'} added.` : 'Those images are already in your collection.';
}

function setMode(next) {
  mode = next;
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.classList.toggle('active', button.dataset.mode === mode); button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  }
  for (const name of ['weapon', 'phone']) {
    $(`${name}-stage`).hidden = name !== mode; $(`${name}-controls`).hidden = name !== mode;
  }
  // The phone studio has its own posts, so the skin images step is hidden there.
  $('library-section').hidden = mode === 'phone';
  if (mode === 'phone') void phone.start(); else phone.stop();
}

library.addEventListener('change', event => {
  if (event.detail.reason !== 'add') $('library-status').textContent = '';
  renderLibrary();
});
$('files').onchange = event => { void upload([...event.target.files]); event.target.value = ''; };
for (const name of ['dragenter', 'dragover']) $('dropzone').addEventListener(name, event => { event.preventDefault(); $('dropzone').classList.add('dragging'); });
for (const name of ['dragleave', 'drop']) $('dropzone').addEventListener(name, event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); });
$('dropzone').addEventListener('drop', event => void upload([...event.dataTransfer.files]));
for (const button of document.querySelectorAll('[data-mode]')) button.onclick = () => setMode(button.dataset.mode);
window.addEventListener('pagehide', () => { library.dispose(); phone.dispose(); });

// Opt-in inspection hooks for local debugging and the QA scripts: add ?debug=1.
if (new URLSearchParams(location.search).has('debug')) {
  window.akStudio = {
    library, setMode, get phone() { return phone; },
    get weapon() { return weapon; }, get scene() { return weapon?.scene; }, get atlas() { return weapon?.atlas; },
    get ready() { return Boolean(weapon?.ready) && !uploading; }, get state() { return weapon?.state; },
  };
}

phone = initPhone({getWeaponRender: () => weapon.snapshot()});
renderLibrary();
weapon = await initWeapon({library});
