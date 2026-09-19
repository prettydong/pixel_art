import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { ShatterRenderer, ShatterRequest } from "./pixelShatter";

type Props = {
  cards: RefObject<(HTMLDivElement | null)[]>;
  viewport: RefObject<HTMLDivElement | null>;
  request: ShatterRequest | null;
  onComplete: () => void;
};

// Mounted with the cards, so importing Pixi, capturing fonts and GPU upload all
// happen before a click. React only handles the beginning/end of the effect.
export function PixelTransition({ cards, viewport, request, onComplete }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const completeRef = useRef(onComplete);
  const startRef = useRef<((value: ShatterRequest) => void) | null>(null);
  useLayoutEffect(() => { completeRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    const host = hostRef.current;
    const area = viewport.current;
    const nodes = cards.current.filter((node): node is HTMLDivElement => !!node);
    if (!host || !area || !nodes.length || nodes.length !== cards.current.length) return;
    // Each effect owns a separate canvas: a late StrictMode init cannot destroy
    // or resize the canvas belonging to the subsequent effect.
    const canvas = document.createElement("canvas");
    canvas.style.visibility = "hidden";
    host.appendChild(canvas);
    let renderer: ShatterRenderer | undefined;
    let disposed = false;
    let failed = false;
    let contextLost = false;
    let completed = false;
    let playing = false;
    let pending: ShatterRequest | null = null;
    let timeout = 0;
    let readyBy = 0;
    let preparationFrame = 0;
    const debug = (event: string, detail?: unknown) => {
      if (import.meta.env.DEV) {
        host.dataset.transitionState = event;
        console.info(`[card-shatter] ${event}`, detail ?? "");
      }
    };

    const releaseRenderer = (restoreCards = true) => {
      const previous = renderer;
      renderer = undefined;
      try { previous?.destroy(restoreCards); }
      catch (error) { console.warn("Unable to release card transition renderer", error); }
    };

    const finish = (reason = "complete") => {
      if (disposed || completed || !pending) return;
      debug("finish", reason);
      completed = true;
      window.clearTimeout(timeout);
      // Keep the DOM cards hidden until React commits the new view.
      releaseRenderer(false);
      canvas.style.visibility = "hidden";
      completeRef.current();
    };
    const attempt = () => {
      if (disposed || completed || playing || !pending) return;
      if (failed || contextLost || performance.now() > readyBy) { finish("not-ready"); return; }
      if (!renderer?.ready) return;
      try {
        playing = renderer.play(pending, area, () => finish("complete"));
        debug("play", playing);
        if (playing) window.clearTimeout(timeout);
      } catch (error) { debug("play-error", error); finish("play-error"); }
    };
    const prepare = () => {
      if (disposed || completed || playing || contextLost || !renderer) return;
      debug("prepare");
      void renderer.prepare(nodes, area).then(() => {
        debug("prepared", renderer?.ready);
        if (renderer?.ready) failed = false;
        attempt();
      }).catch((error) => {
        debug("prepare-error", error);
        // A previous, valid hover snapshot can still be used if refresh fails.
        if (!renderer?.ready) failed = true;
        attempt();
      });
    };
    const refresh = () => {
      if (disposed || completed) return;
      if (pending) { finish("invalidated"); return; }
      renderer?.invalidate();
      failed = false;
      cancelAnimationFrame(preparationFrame);
      preparationFrame = requestAnimationFrame(prepare);
    };
    const refreshHover = () => {
      if (pending || disposed || completed) return;
      cancelAnimationFrame(preparationFrame);
      preparationFrame = requestAnimationFrame(prepare);
    };
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const start = (value: ShatterRequest) => {
      if (pending || disposed || completed) return;
      pending = value;
      readyBy = performance.now() + 100;
      debug("request", { ready: renderer?.ready, failed });
      timeout = window.setTimeout(() => finish("ready-timeout"), 100);
      if (preference.matches || document.hidden) failed = true;
      attempt();
    };
    startRef.current = start;

    const onPreferenceChange = () => {
      if (preference.matches) {
        failed = true;
        finish("reduced-motion");
      } else refresh();
    };
    const onVisibility = () => { if (document.hidden) finish("hidden"); };
    const onContextLost = () => {
      contextLost = true;
      finish("context-lost");
      if (!pending) releaseRenderer();
    };
    const resizeObserver = new ResizeObserver(refresh);
    resizeObserver.observe(area);
    nodes.forEach((node) => resizeObserver.observe(node));
    const themeObserver = new MutationObserver(refresh);
    themeObserver.observe(document.documentElement, { attributes: true,
      attributeFilter: ["data-theme", "data-dpr", "data-motion"] });
    const contentObserver = new MutationObserver((changes) => {
      // Ignore only our own visibility class, not other changes to the wrapper.
      const withoutHidden = (value: string) => value.split(/\s+/).filter((name) => name && name !== "pixel-shatter-hidden").join(" ");
      if (changes.some((change) => change.type !== "attributes"
        || withoutHidden(change.oldValue ?? "") !== withoutHidden((change.target as Element).getAttribute("class") ?? ""))) refresh();
    });
    nodes.forEach((node) => contentObserver.observe(node, { subtree: true, attributes: true,
      attributeFilter: ["class"], attributeOldValue: true, childList: true, characterData: true }));
    area.addEventListener("pointerover", refreshHover);
    area.addEventListener("pointerout", refreshHover);
    area.addEventListener("focusin", refreshHover);
    area.addEventListener("focusout", refreshHover);
    // Scrolling during a burst invalidates its captured positions.
    const onScroll = () => { if (pending) finish("scroll"); };
    area.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", refresh);
    preference.addEventListener("change", onPreferenceChange);
    document.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("webglcontextlost", onContextLost);

    void import("./pixelShatter").then(async ({ createShatterRenderer }) => {
      debug("module-loaded");
      if (disposed || completed) return;
      const next = await createShatterRenderer(canvas);
      debug("renderer-created");
      if (disposed || completed || contextLost) { next.destroy(); return; }
      renderer = next;
      prepare();
    }).catch((error) => { debug("init-error", error); failed = true; attempt(); });

    return () => {
      disposed = true;
      if (startRef.current === start) startRef.current = null;
      window.clearTimeout(timeout);
      cancelAnimationFrame(preparationFrame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      contentObserver.disconnect();
      area.removeEventListener("pointerover", refreshHover);
      area.removeEventListener("pointerout", refreshHover);
      area.removeEventListener("focusin", refreshHover);
      area.removeEventListener("focusout", refreshHover);
      area.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", refresh);
      preference.removeEventListener("change", onPreferenceChange);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      releaseRenderer();
      nodes.forEach((node) => node.classList.remove("pixel-shatter-hidden"));
      canvas.remove();
    };
  }, [cards, viewport]);

  useEffect(() => {
    if (!request) return;
    if (startRef.current) startRef.current(request);
    else completeRef.current();
  }, [request]);

  return <div ref={hostRef} className="pixel-transition" aria-hidden="true" />;
}
