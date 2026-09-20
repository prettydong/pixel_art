// Keep integer device pixels: 2 × 2 for regular displays, 3 × 3 for roomy 4K windows.
// Read screen dimensions for display information; use the actual viewport for layout.
export function getPixelDensity(): number {
  return document.documentElement.dataset.pixelRatio === "1:3" ? 3 : 2;
}

// Chromium's minimum-font-size policy can inflate computed html.fontSize while
// rem geometry still uses our declared size. Never use fontSize as a grid ruler.
export function getPixelUnit(): number {
  const unit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pixel"));
  return Number.isFinite(unit) && unit > 0 ? unit : getPixelDensity() / (window.devicePixelRatio || 1);
}

export function startPixelGrid() {
  const root = document.documentElement;
  let densityQuery: MediaQueryList | undefined;

  function update() {
    const dpr = window.devicePixelRatio || 1;
    const viewportWidth = Math.min(window.innerWidth, window.visualViewport?.width ?? window.innerWidth);
    const viewportHeight = Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight);
    // 1440p needs more workspace than the old fixed 3-device-pixel grid allowed.
    const density = viewportWidth * dpr >= 2880 && viewportHeight * dpr >= 1800 ? 3 : 2;
    const unit = density / dpr;
    const width = Math.max(1, Math.floor(viewportWidth / unit));
    const height = Math.max(1, Math.floor(viewportHeight / unit));
    root.style.setProperty("--pixel", `${unit}px`);
    root.style.setProperty("--viewport-width", `${width}rem`);
    root.style.setProperty("--viewport-height", `${height}rem`);
    root.style.setProperty("--dialog-left", `${Math.floor((width - Math.min(360, Math.max(1, width - 16))) / 2)}rem`);
    root.style.setProperty("--wide-dialog-left", `${Math.floor((width - Math.min(760, Math.max(1, width - 16))) / 2)}rem`);
    // Reserve space for three 168-unit cards, gaps, padding and the sidebar.
    root.dataset.layout = width < 736 ? "compact" : "wide";
    root.dataset.narrow = String(width < 320);
    root.dataset.screen = `${Math.round(window.screen.width * dpr)}x${Math.round(window.screen.height * dpr)}`;
    root.dataset.dpr = String(dpr);
    root.dataset.pixelRatio = `1:${density}`;

    densityQuery?.removeEventListener("change", update);
    densityQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
    densityQuery.addEventListener("change", update);
  }

  update();
  window.addEventListener("resize", update);
  window.visualViewport?.addEventListener("resize", update);
  return () => {
    window.removeEventListener("resize", update);
    window.visualViewport?.removeEventListener("resize", update);
    densityQuery?.removeEventListener("change", update);
  };
}
