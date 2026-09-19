// A design pixel always targets a 3 × 3 device-pixel square.
// Read screen dimensions for display information; use the actual viewport for layout.
export function startPixelGrid() {
  const root = document.documentElement;
  let densityQuery: MediaQueryList | undefined;

  function update() {
    const dpr = window.devicePixelRatio || 1;
    const unit = 3 / dpr;
    const width = Math.max(1, Math.floor(window.innerWidth / unit));
    const height = Math.max(1, Math.floor(window.innerHeight / unit));
    root.style.setProperty("--pixel", `${unit}px`);
    root.style.setProperty("--viewport-width", `${width}rem`);
    root.style.setProperty("--viewport-height", `${height}rem`);
    root.dataset.layout = width < 640 ? "compact" : "wide";
    root.dataset.narrow = String(width < 320);
    root.dataset.screen = `${Math.round(window.screen.width * dpr)}x${Math.round(window.screen.height * dpr)}`;
    root.dataset.dpr = String(dpr);
    root.dataset.pixelRatio = "1:3";

    densityQuery?.removeEventListener("change", update);
    densityQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
    densityQuery.addEventListener("change", update);
  }

  update();
  window.addEventListener("resize", update);
  return () => {
    window.removeEventListener("resize", update);
    densityQuery?.removeEventListener("change", update);
  };
}
