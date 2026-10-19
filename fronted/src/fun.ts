// Small celebratory effects. Each one is skipped when motion is off or reduced.
function motionAllowed() {
  return document.documentElement.dataset.motion === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Throw a handful of clay sparks out from a point (viewport coordinates). */
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
    const distance = 26 + Math.random() * 30;
    piece.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    piece.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
    piece.style.setProperty('--spin', `${Math.round(Math.random() * 360 - 180)}deg`);
    piece.style.setProperty('--size', `${6 + Math.random() * 6}px`);
    piece.style.animationDelay = `${Math.random() * 60}ms`;
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 900);
}

/** Burst from the center of an element. */
export function sparkBurstFrom(element: Element | null, count?: number) {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  sparkBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, count);
}
