// A generic first-person game overlay: crosshair, health and armour, round
// timer and radar. Drawn onto a transparent canvas the size of the frame.

function panel(c, x, y, w, h) {
  c.fillStyle = 'rgba(8, 12, 16, .42)'; c.beginPath(); c.roundRect(x, y, w, h, 6); c.fill();
}

/** @param c  2D context of a transparent width x height canvas */
export function drawHud(c, width, height) {
  const s = Math.min(width / 1920, height / 1080) * (width < height ? 1.5 : 1), mono = `${Math.round(40 * s)}px "Consolas", "SF Mono", "Roboto Mono", monospace`;
  c.clearRect(0, 0, width, height);
  c.save();
  c.shadowColor = 'rgba(0, 0, 0, .55)'; c.shadowBlur = 4 * s;

  // Crosshair.
  const cx = width / 2, cy = height / 2, gap = 7 * s, arm = 12 * s;
  c.strokeStyle = '#a6ff7a'; c.lineWidth = Math.max(2, 3 * s); c.lineCap = 'butt';
  c.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(cx + dx * gap, cy + dy * gap); c.lineTo(cx + dx * (gap + arm), cy + dy * (gap + arm)); }
  c.stroke();

  // Health and armour, bottom left.
  const margin = 34 * s, rowHeight = 62 * s, bottom = height - margin;
  c.font = `700 ${mono}`; c.textBaseline = 'middle'; c.textAlign = 'left';
  [['#ffffff', '100', 'cross', 0], ['#cfe3ff', '100', 'shield', 1]].forEach(([color, value, icon, index]) => {
    const x = margin + index * 236 * s, y = bottom - rowHeight;
    panel(c, x, y, 216 * s, rowHeight);
    c.fillStyle = color; c.strokeStyle = color; c.lineWidth = 4 * s;
    const ix = x + 34 * s, iy = y + rowHeight / 2, r = 13 * s;
    if (icon === 'cross') { c.fillRect(ix - r, iy - r / 3, r * 2, r * 2 / 3); c.fillRect(ix - r / 3, iy - r, r * 2 / 3, r * 2); }
    else { c.beginPath(); c.moveTo(ix - r, iy - r); c.lineTo(ix + r, iy - r); c.lineTo(ix + r, iy); c.quadraticCurveTo(ix + r, iy + r, ix, iy + r * 1.3); c.quadraticCurveTo(ix - r, iy + r, ix - r, iy); c.closePath(); c.stroke(); }
    c.fillText(value, x + 66 * s, iy + 2 * s);
    c.fillStyle = 'rgba(255, 255, 255, .28)'; c.fillRect(x + 148 * s, iy - 4 * s, 54 * s, 8 * s);
    c.fillStyle = color; c.fillRect(x + 148 * s, iy - 4 * s, 54 * s, 8 * s);
  });

  // Round timer and score, top centre.
  const top = margin;
  panel(c, cx - 70 * s, top, 140 * s, 54 * s);
  c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.fillText('1:42', cx, top + 29 * s);
  [['#7fb2ff', '7', -1], ['#ffc46b', '5', 1]].forEach(([color, score, side]) => {
    panel(c, cx + side * 110 * s - 34 * s, top, 68 * s, 54 * s);
    c.fillStyle = color; c.fillText(score, cx + side * 110 * s, top + 29 * s);
  });

  // Radar, top left.
  const radius = 92 * s, rx = margin + radius, ry = margin + radius;
  c.fillStyle = 'rgba(8, 12, 16, .42)'; c.beginPath(); c.arc(rx, ry, radius, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(255, 255, 255, .35)'; c.lineWidth = 2 * s;
  c.beginPath(); c.arc(rx, ry, radius, 0, Math.PI * 2); c.moveTo(rx + radius * .5, ry); c.arc(rx, ry, radius * .5, 0, Math.PI * 2);
  c.moveTo(rx - radius, ry); c.lineTo(rx + radius, ry); c.moveTo(rx, ry - radius); c.lineTo(rx, ry + radius); c.stroke();
  c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(rx, ry - 11 * s); c.lineTo(rx + 8 * s, ry + 9 * s); c.lineTo(rx - 8 * s, ry + 9 * s); c.closePath(); c.fill();
  for (const [dx, dy, color] of [[.42, -.3, '#7fb2ff'], [-.35, .2, '#7fb2ff'], [.1, -.62, '#ffc46b']]) {
    c.fillStyle = color; c.beginPath(); c.arc(rx + dx * radius, ry + dy * radius, 6 * s, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}
