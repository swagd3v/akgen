// Draws the phone's display: an endless feed of your screenshots inside a
// generic social-app template (status bar, tabs, navigation bar).
import {BARS, SCREEN, imageRect, layoutFeed, visiblePosts} from './generator.js';

const THEMES = {
  dark: {page: '#000000', bar: 'rgba(0, 0, 0, .97)', line: '#2f3336', text: '#e7e9ea', muted: '#71767b', block: '#16181c', soft: '#202327'},
  light: {page: '#ffffff', bar: 'rgba(255, 255, 255, .97)', line: '#e6ecf0', text: '#0f1419', muted: '#536471', block: '#eff3f4', soft: '#dfe5e8'},
};
const ACCENT = '#3d9bff';
const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const W = SCREEN.width, H = SCREEN.height;

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  return canvas;
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function pill(c, x, y, w, h, color) { c.fillStyle = color; roundRect(c, x, y, w, h, h / 2); c.fill(); }

/** The small line icons under a post: reply, repost, like, share. */
function actions(c, y, color) {
  c.strokeStyle = color; c.lineWidth = 3.5; c.lineJoin = c.lineCap = 'round';
  const at = index => 150 + index * 150;
  roundRect(c, at(0), y, 32, 26, 9); c.stroke();
  c.beginPath(); c.moveTo(at(1), y + 8); c.lineTo(at(1) + 9, y); c.lineTo(at(1) + 18, y + 8); c.moveTo(at(1) + 9, y); c.lineTo(at(1) + 9, y + 22); c.lineTo(at(1) + 30, y + 22); c.stroke();
  c.beginPath(); c.moveTo(at(2) + 16, y + 26); c.bezierCurveTo(at(2) - 12, y + 8, at(2) + 6, y - 8, at(2) + 16, y + 6); c.bezierCurveTo(at(2) + 26, y - 8, at(2) + 44, y + 8, at(2) + 16, y + 26); c.stroke();
  c.beginPath(); c.moveTo(at(3) + 14, y + 22); c.lineTo(at(3) + 14, y); c.moveTo(at(3) + 4, y + 9); c.lineTo(at(3) + 14, y); c.lineTo(at(3) + 24, y + 9); c.moveTo(at(3), y + 26); c.lineTo(at(3) + 28, y + 26); c.stroke();
}

const AVATARS = ['#7c9272', '#c98b5e', '#6f8fc9', '#b56f9c', '#c9b458'];
const TEXT_LINES = [[.8, .55], [.86, .9, .4], [.6], [.9, .7], [.75, .82, .5]];

/**
 * A stand-in post in the template's own style: an avatar, name and text as
 * plain bars, an optional picture and the action row.
 * @param media  null, 'block' for an empty picture, or an image to show
 */
export function templatePost(themeId, index, media = null, caption = '') {
  const theme = THEMES[themeId], lines = TEXT_LINES[index % TEXT_LINES.length], left = 150, width = W - left - 32;
  const mediaHeight = media ? Math.round(width * (media === 'block' ? .6 : Math.min(1.2, Math.max(.5, media.height / media.width)))) : 0;
  const textTop = 84, textHeight = caption ? 48 : lines.length * 38, mediaTop = textTop + textHeight + 14;
  const height = mediaTop + (media ? mediaHeight + 22 : 0) + 62;
  const canvas = makeCanvas(W, height), c = canvas.getContext('2d');
  c.fillStyle = theme.page; c.fillRect(0, 0, W, height);
  c.fillStyle = AVATARS[index % AVATARS.length]; c.beginPath(); c.arc(84, 76, 46, 0, Math.PI * 2); c.fill();
  pill(c, left, 34, 190 + index % 3 * 30, 24, theme.text); pill(c, left + 210 + index % 3 * 30, 34, 150, 24, theme.soft);
  if (caption) {
    c.fillStyle = theme.text; c.font = `32px ${FONT}`; c.textBaseline = 'top'; c.fillText(caption, left, textTop - 2);
  } else lines.forEach((length, row) => pill(c, left, textTop + row * 38, width * length, 22, theme.soft));
  if (media) {
    c.save(); roundRect(c, left, mediaTop, width, mediaHeight, 28); c.clip();
    if (media === 'block') {
      const gradient = c.createLinearGradient(left, mediaTop, left + width, mediaTop + mediaHeight);
      gradient.addColorStop(0, AVATARS[(index + 2) % AVATARS.length]); gradient.addColorStop(1, theme.block);
      c.fillStyle = gradient; c.fillRect(left, mediaTop, width, mediaHeight);
    } else {
      c.fillStyle = theme.block; c.fillRect(left, mediaTop, width, mediaHeight);
      const [x, y, w, h] = imageRect(media.width, media.height, width, mediaHeight, 'cover');
      c.drawImage(media, left + x, mediaTop + y, w, h);
    }
    c.restore();
    c.strokeStyle = theme.line; c.lineWidth = 2; roundRect(c, left, mediaTop, width, mediaHeight, 28); c.stroke();
  }
  actions(c, height - 50, theme.muted);
  return canvas;
}

export class PhoneScreen {
  constructor() {
    this.canvas = makeCanvas(W, H); this.context = this.canvas.getContext('2d');
    this.context.imageSmoothingQuality = 'high';
    this.templates = new Map();
    this.setPosts([]);
  }

  /**
   * @param posts  [{id, image}] top to bottom. With none, the template shows
   *               its own stand-in posts.
   * @param theme  'dark' or 'light' bars and page
   */
  setPosts(posts, theme = 'dark') {
    this.theme = THEMES[theme] ? theme : 'dark';
    if (!posts.length) {
      if (!this.templates.has(this.theme)) {
        this.templates.set(this.theme, [0, 1, 2, 3, 4].map(index => ({id: `template-${index}`, image: templatePost(this.theme, index, index % 2 ? null : 'block', index ? '' : 'Your screenshots go here')})));
      }
      posts = this.templates.get(this.theme);
    }
    this.posts = new Map(posts.map(post => [post.id, post.image]));
    this.layout = layoutFeed(posts.map(post => ({id: post.id, width: post.image.width, height: post.image.height})));
  }

  /**
   * @param scroll  feed position in screen pixels; any number, the feed repeats
   * @param bars    draw the app's bars; turn off for full-screen screenshots
   */
  draw(scroll, {bars = true, time = new Date()} = {}) {
    const c = this.context, theme = THEMES[this.theme], top = bars ? BARS.top : 0;
    c.fillStyle = theme.page; c.fillRect(0, 0, W, H);
    for (const post of visiblePosts(this.layout, scroll - top, H)) {
      c.drawImage(this.posts.get(post.id), 0, post.y, W, post.height);
      c.fillStyle = theme.line; c.fillRect(0, post.y + post.height, W, 2);
    }
    if (bars) this.bars(c, theme, time);
    this.clock = time.getHours() * 60 + time.getMinutes();
  }

  bars(c, theme, time) {
    // Status bar and header.
    c.fillStyle = theme.bar; c.fillRect(0, 0, W, BARS.top);
    c.fillStyle = theme.line; c.fillRect(0, BARS.top - 2, W, 2);
    c.fillStyle = theme.text; c.textBaseline = 'middle'; c.textAlign = 'left';
    c.font = `600 33px ${FONT}`; c.fillText(`${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}`, 62, 56);
    pill(c, W / 2 - 118, 24, 236, 66, '#000000');
    for (let bar = 0; bar < 4; bar++) { c.fillStyle = theme.text; roundRect(c, 548 + bar * 13, 66 - bar * 6 - 8, 9, 8 + bar * 6, 2); c.fill(); }
    c.strokeStyle = theme.text; c.lineWidth = 2.5; roundRect(c, 640, 42, 58, 28, 8); c.stroke();
    c.fillStyle = theme.text; roundRect(c, 644, 46, 40, 20, 5); c.fill(); roundRect(c, 701, 50, 4, 12, 2); c.fill();
    c.fillStyle = '#7c9272'; c.beginPath(); c.arc(70, 150, 30, 0, Math.PI * 2); c.fill();
    c.fillStyle = theme.text; roundRect(c, W / 2 - 22, 128, 44, 44, 12); c.fill();
    c.fillStyle = theme.bar; c.beginPath(); c.arc(W / 2, 150, 9, 0, Math.PI * 2); c.fill();
    c.textAlign = 'center'; c.font = `700 29px ${FONT}`; c.fillStyle = theme.text; c.fillText('For you', W * .25, 224);
    c.font = `500 29px ${FONT}`; c.fillStyle = theme.muted; c.fillText('Following', W * .75, 224);
    pill(c, W * .25 - 56, BARS.top - 10, 112, 8, ACCENT);

    // Compose button and navigation bar.
    const navTop = H - BARS.bottom;
    c.fillStyle = ACCENT; c.beginPath(); c.arc(W - 96, navTop - 96, 56, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#ffffff'; c.lineWidth = 6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(W - 96, navTop - 118); c.lineTo(W - 96, navTop - 74); c.moveTo(W - 118, navTop - 96); c.lineTo(W - 74, navTop - 96); c.stroke();
    c.fillStyle = theme.bar; c.fillRect(0, navTop, W, BARS.bottom);
    c.fillStyle = theme.line; c.fillRect(0, navTop, W, 2);
    c.strokeStyle = theme.text; c.fillStyle = theme.text; c.lineWidth = 4.5; c.lineJoin = 'round';
    const y = navTop + 56, at = index => W * (index + .5) / 5;
    c.beginPath(); c.moveTo(at(0) - 22, y + 20); c.lineTo(at(0) - 22, y - 6); c.lineTo(at(0), y - 24); c.lineTo(at(0) + 22, y - 6); c.lineTo(at(0) + 22, y + 20); c.closePath(); c.fill();
    c.beginPath(); c.arc(at(1) - 4, y - 4, 17, 0, Math.PI * 2); c.moveTo(at(1) + 9, y + 9); c.lineTo(at(1) + 22, y + 22); c.stroke();
    c.beginPath(); c.moveTo(at(2) - 20, y + 12); c.quadraticCurveTo(at(2) - 16, y - 24, at(2), y - 24); c.quadraticCurveTo(at(2) + 16, y - 24, at(2) + 20, y + 12); c.closePath(); c.moveTo(at(2) - 6, y + 22); c.lineTo(at(2) + 6, y + 22); c.stroke();
    roundRect(c, at(3) - 23, y - 17, 46, 36, 7); c.moveTo(at(3) - 21, y - 13); c.lineTo(at(3), y + 4); c.lineTo(at(3) + 21, y - 13); c.stroke();
    c.beginPath(); c.arc(at(4), y - 10, 11, 0, Math.PI * 2); c.moveTo(at(4) - 21, y + 22); c.quadraticCurveTo(at(4), y - 6, at(4) + 21, y + 22); c.stroke();
    pill(c, W / 2 - 134, H - 26, 268, 10, theme.text);
    c.textAlign = 'left';
  }
}
