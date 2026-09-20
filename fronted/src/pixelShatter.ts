import { Application, Particle, ParticleContainer, ParticleShader, Rectangle, Texture, isWebGLSupported } from "pixi.js";
import { getFontEmbedCSS, toSvg } from "html-to-image";
import { getPixelDensity, getPixelUnit } from "./pixelGrid";

export type ShatterRequest = {
  selectedIndex: number;
  origin: { x: number; y: number } | null;
};

type Tile = { x: number; y: number; width: number; height: number };
type Fragment = {
  particle: Particle;
  texture: Texture;
  tile: Tile;
  x: number;
  y: number;
  vx: number;
  vy: number;
  delay: number;
  death: number;
  visible: boolean;
};
type Card = {
  node: HTMLDivElement;
  texture: Texture;
  container: ParticleContainer;
  fragments: Fragment[];
};

const DURATION = 400;
const MAX_FRAGMENTS = 4000;
// Room for both the normal shadow and the larger hover/focus shadow.
const INSET = 4;
const PADDING = 16;

function noise(x: number, y: number, seed = 0) {
  let hash = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(seed, 83492791);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0xffffffff;
}

function tiles(width: number, height: number, scale: number): Tile[] {
  const result: Tile[] = [];
  const block = 8 * scale;
  for (let y = 0; y < height; y += block) {
    for (let x = 0; x < width; x += block) {
      const rank = noise(x / block, y / block, 17);
      const size = (rank < 0.08 ? 2 : rank < 0.82 ? 4 : 8) * scale;
      for (let dy = 0; dy < block && y + dy < height; dy += size) {
        for (let dx = 0; dx < block && x + dx < width; dx += size) {
          result.push({ x: x + dx, y: y + dy,
            width: Math.min(size, width - x - dx), height: Math.min(size, height - y - dy) });
        }
      }
    }
  }
  return result;
}

async function capture(node: HTMLDivElement, unit: number, density: number, fontEmbedCSS: string) {
  const bounds = node.getBoundingClientRect();
  const width = Math.round(bounds.width / unit) + PADDING;
  const height = Math.round(bounds.height / unit) + PADDING;
  // html-to-image 1.11 deep-clones SVG trees without copying descendant CSS.
  // Preserve resolved paint and animation transforms before leaving the page.
  const svgProperties = ["color", "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity",
    "opacity", "visibility", "display", "transform", "transform-origin", "transform-box", "shape-rendering"];
  const svgStyles = Array.from(node.querySelectorAll("svg *"), (element) => {
    const style = getComputedStyle(element);
    return svgProperties.map((property) => [property, style.getPropertyValue(property)] as const);
  });
  // Padding is applied only to html-to-image's clone, never the live card.
  const svgURL = await toSvg(node, {
    width: width * unit,
    height: height * unit,
    // html-to-image normally subtracts 0.1 CSS px from every font size.
    // All our card text shares the native 12-design-pixel font grid.
    fontEmbedCSS: `${fontEmbedCSS}\n* { font-size: ${12 * unit}px !important; animation: none !important; }`,
    preferredFontFormat: "woff2",
    style: {
      width: `${width * unit}px`, height: `${height * unit}px`,
      padding: `${INSET * unit}px ${(PADDING - INSET) * unit}px ${(PADDING - INSET) * unit}px ${INSET * unit}px`,
      boxSizing: "border-box", flex: "none", transform: "none", animation: "none",
    },
  });
  const snapshot = new DOMParser().parseFromString(decodeURIComponent(svgURL.slice(svgURL.indexOf(",") + 1)), "image/svg+xml");
  // Scope each inner SVG separately: the serialized document itself has an
  // outer SVG, so `svg *` there would also match the entire HTML card.
  const svgElements = Array.from(snapshot.querySelector("foreignObject")?.querySelectorAll("svg") ?? [])
    .flatMap((svg) => Array.from(svg.querySelectorAll<SVGElement>("*")));
  if (svgElements.length !== svgStyles.length) throw new Error("Card SVG snapshot structure changed");
  svgElements.forEach((element, index) => {
    for (const [property, value] of svgStyles[index]) element.style.setProperty(property, value);
  });
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to rasterize card snapshot"));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(snapshot))}`;
  });
  const source = document.createElement("canvas");
  source.width = width * density;
  source.height = height * density;
  const sourceContext = source.getContext("2d");
  if (!sourceContext) throw new Error("Card snapshot canvas unavailable");
  sourceContext.drawImage(image, 0, 0, source.width, source.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Card texture canvas unavailable");
  // Store one texel per design pixel; the GPU expands it to the current physical pixel grid.
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, width, height);
  source.width = source.height = 0;
  return canvas;
}

export async function createShatterRenderer(canvas: HTMLCanvasElement) {
  // This particle shader requires WebGL. Managed browsers may only expose Canvas.
  if (!isWebGLSupported()) throw new Error("WebGL unavailable for the card particle renderer");
  const app = new Application();
  try {
    await app.init({ canvas, width: 1, height: 1, resolution: getPixelDensity(),
      preference: "webgl", antialias: false, backgroundAlpha: 0,
      autoDensity: false, autoStart: false, sharedTicker: false });
  } catch (error) {
    // init can reject before Application has a renderer or ticker.
    app.stage.destroy({ children: true });
    app.renderer?.destroy();
    throw error;
  }
  let cards: Card[] = [];
  let destroyed = false;
  let generation = 0;
  let frame = 0;
  let deadline = 0;
  let playing = false;
  let prepared = false;
  let fontCSS: Promise<string> | undefined;

  function loadFontCSS(node: HTMLDivElement) {
    if (!fontCSS) {
      fontCSS = getFontEmbedCSS(node, { preferredFontFormat: "woff2" }).catch((error) => {
        // Do not retain a transient font-export failure forever: a later
        // hover/resize preparation must be able to fetch it again.
        fontCSS = undefined;
        throw error;
      });
    }
    return fontCSS;
  }

  function clearCards() {
    prepared = false;
    for (const card of cards) {
      card.container.destroy();
      for (const fragment of card.fragments) fragment.texture.destroy();
      card.texture.destroy(true);
    }
    cards = [];
  }

  function resize(viewport: HTMLElement, unit: number) {
    const bounds = viewport.getBoundingClientRect();
    const width = Math.max(1, Math.floor(bounds.width / unit));
    const height = Math.max(1, Math.floor(bounds.height / unit));
    app.renderer.resize(width, height, getPixelDensity());
    // autoDensity would use logical pixels as CSS pixels, breaking our grid.
    canvas.style.width = `${width * unit}px`;
    canvas.style.height = `${height * unit}px`;
    return { bounds, width, height };
  }

  return {
    get ready() { return !destroyed && prepared; },
    invalidate() {
      generation++;
      if (!playing) clearCards();
    },
    async prepare(nodes: HTMLDivElement[], viewport: HTMLElement) {
      if (destroyed || playing || !nodes.length) return;
      const ticket = ++generation;
      await document.fonts.ready;
      if (destroyed || ticket !== generation) return;
      if (!document.fonts.check('12px "Fusion Pixel"', "数据分析")) {
        throw new Error("Pixel font unavailable for card capture");
      }
      const css = await loadFontCSS(nodes[0]);
      if (destroyed || ticket !== generation) return;
      const unit = getPixelUnit();
      const density = getPixelDensity();
      const captures = await Promise.all(nodes.map((node) => capture(node, unit, density, css)));
      if (destroyed || ticket !== generation) return;
      let scale = 1;
      let layouts = captures.map((image) => tiles(image.width, image.height, scale));
      while (layouts.reduce((sum, layout) => sum + layout.length, 0) > MAX_FRAGMENTS) {
        scale *= 2;
        layouts = captures.map((image) => tiles(image.width, image.height, scale));
      }
      clearCards();
      const { width, height } = resize(viewport, unit);
      // Build and upload the batches while idle, including their shader pipeline.
      captures.forEach((image, index) => {
        const texture = Texture.from(image);
        texture.source.scaleMode = "nearest";
        // Own the binding so destroying a card detaches its shader before its
        // texture is freed; Pixi's shared particle shader retains the last card.
        const shader = new ParticleShader();
        shader.resources.uSampler = texture.source.style;
        const container = new ParticleContainer({ texture, shader, roundPixels: true,
          dynamicProperties: { position: true, color: true, rotation: false, vertex: false, uvs: false } });
        container.boundsArea = new Rectangle(0, 0, width, height);
        app.stage.addChild(container);
        const card: Card = { node: nodes[index], texture, container, fragments: [] };
        cards.push(card);
        for (const tile of layouts[index]) {
          const piece = new Texture({ source: texture.source,
            frame: new Rectangle(tile.x, tile.y, tile.width, tile.height) });
          const particle = new Particle({ texture: piece, x: tile.x, y: tile.y });
          container.addParticle(particle);
          card.fragments.push({ particle, texture: piece, tile,
            x: 0, y: 0, vx: 0, vy: 0, delay: 0, death: 0, visible: false });
        }
      });
      app.render();
      prepared = true;
    },
    play(request: ShatterRequest, viewport: HTMLElement, complete: () => void) {
      if (destroyed || playing || !prepared) return false;
      generation++; // Discard a hover capture that is still in flight.
      playing = true;
      const unit = getPixelUnit();
      const { bounds, width, height } = resize(viewport, unit);
      const cardBounds = cards.map((card) => card.node.getBoundingClientRect());
      const selected = cardBounds[request.selectedIndex];
      if (!selected) throw new Error("Selected card unavailable");
      const origin = request.origin ?? { x: selected.left + selected.width / 2, y: selected.top + selected.height / 2 };
      const ox = Math.round((origin.x - bounds.left) / unit);
      const oy = Math.round((origin.y - bounds.top) / unit);
      const order = cardBounds.map((rect, index) => ({ index,
        distance: index === request.selectedIndex ? -1 : Math.hypot(rect.left + rect.width / 2 - origin.x, rect.top + rect.height / 2 - origin.y) }))
        .sort((a, b) => a.distance - b.distance);
      for (const [index, card] of cards.entries()) {
        const rect = cardBounds[index];
        const left = Math.round((rect.left - bounds.left) / unit) - INSET;
        const top = Math.round((rect.top - bounds.top) / unit) - INSET;
        const lag = order.findIndex((entry) => entry.index === index) * 40;
        const maxDistance = Math.max(1, ...[
          [left, top], [left + rect.width / unit, top],
          [left, top + rect.height / unit], [left + rect.width / unit, top + rect.height / unit],
        ].map(([x, y]) => Math.hypot(x - ox, y - oy)));
        card.container.boundsArea = new Rectangle(0, 0, width, height);
        for (const fragment of card.fragments) {
          const { tile, particle } = fragment;
          const x = left + tile.x;
          const y = top + tile.y;
          const dx = x + tile.width / 2 - ox;
          const dy = y + tile.height / 2 - oy;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const random = noise(tile.x, tile.y, index + 31);
          const speed = 170 + random * 330;
          fragment.x = particle.x = x;
          fragment.y = particle.y = y;
          fragment.vx = dx / distance * speed + (noise(tile.y, tile.x, 83) - 0.5) * 100;
          fragment.vy = dy / distance * speed - 100;
          fragment.delay = lag + Math.min(1, distance / maxDistance) * 45;
          fragment.death = 260 + random * 140;
          fragment.visible = x < width && y < height && x + tile.width > 0 && y + tile.height > 0;
          particle.alpha = fragment.visible ? 1 : 0;
        }
      }
      // Draw the intact textured cards before hiding their DOM counterparts.
      app.render();
      canvas.style.visibility = "visible";
      for (const card of cards) card.node.classList.add("pixel-shatter-hidden");
      const start = performance.now();
      let finished = false;
      const finish = () => {
        if (finished || destroyed) return;
        finished = true;
        cancelAnimationFrame(frame);
        window.clearTimeout(deadline);
        canvas.style.visibility = "hidden";
        complete();
      };
      const draw = (now: number) => {
        if (destroyed || finished) return;
        const elapsed = now - start;
        if (elapsed >= DURATION) { finish(); return; }
        for (const card of cards) {
          for (const fragment of card.fragments) {
            if (!fragment.visible) continue;
            const { particle } = fragment;
            particle.alpha = elapsed < fragment.death ? 1 : 0;
            const seconds = Math.max(0, elapsed - fragment.delay) / 1000;
            // Fast impact followed by drag; gravity remains deliberately small.
            const travel = (1 - Math.exp(-seconds * 5)) / 5;
            particle.x = Math.round(fragment.x + fragment.vx * travel);
            particle.y = Math.round(fragment.y + fragment.vy * travel + 220 * seconds * seconds);
          }
        }
        try { app.render(); }
        catch { finish(); return; }
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
      deadline = window.setTimeout(finish, DURATION);
      return true;
    },
    destroy(restoreCards = true) {
      if (destroyed) return;
      destroyed = true;
      generation++;
      cancelAnimationFrame(frame);
      window.clearTimeout(deadline);
      if (restoreCards) {
        for (const card of cards) card.node.classList.remove("pixel-shatter-hidden");
      }
      clearCards();
      app.destroy({ removeView: false }, { children: true });
    },
  };
}

export type ShatterRenderer = Awaited<ReturnType<typeof createShatterRenderer>>;
