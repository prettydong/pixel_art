// Small celebratory effects. Each one is skipped when motion is off or reduced.
function motionAllowed() {
  return document.documentElement.dataset.motion === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Throw a handful of tiny iridescent dies out from a point (viewport coordinates). */
export function sparkBurst(x: number, y: number, count = 9) {
  if (!motionAllowed()) return;
  const layer = document.createElement('div');
  layer.className = 'spark-burst';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.left = `${x}px`;
  layer.style.top = `${y}px`;
  for (let index = 0; index < count; index++) {
    const piece = document.createElement('i');
    const angle = (index / count) * Math.PI * 2 + Math.random() * 0.6;
    const distance = 28 + Math.random() * 34;
    piece.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    piece.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
    piece.style.setProperty('--spin', `${Math.round(Math.random() * 360 - 180)}deg`);
    piece.style.setProperty('--size', `${5 + Math.random() * 5}px`);
    piece.style.animationDelay = `${Math.random() * 60}ms`;
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 950);
}

/** Burst from the center of an element. */
export function sparkBurstFrom(element: Element | null, count?: number) {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  sparkBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, count);
}

/** A full-screen shower of dies, for rare moments such as the easter egg. */
export function dieShower(count = 70) {
  if (!motionAllowed()) return;
  const layer = document.createElement('div');
  layer.className = 'die-shower';
  layer.setAttribute('aria-hidden', 'true');
  let longest = 0;
  for (let index = 0; index < count; index++) {
    const piece = document.createElement('i');
    const duration = 1600 + Math.random() * 1400;
    const delay = Math.random() * 900;
    longest = Math.max(longest, duration + delay);
    piece.style.setProperty('--x', `${Math.random() * 100}vw`);
    piece.style.setProperty('--drift', `${Math.round(Math.random() * 120 - 60)}px`);
    piece.style.setProperty('--spin', `${Math.round(Math.random() * 720 - 360)}deg`);
    piece.style.setProperty('--size', `${6 + Math.random() * 8}px`);
    piece.style.setProperty('--duration', `${duration}ms`);
    piece.style.animationDelay = `${delay}ms`;
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), longest + 100);
}
