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

const sidebarStorageKey = 'pixel-sidebar-width';
let preferredSidebarWidth: number | null = null;
let sidebarPreferenceLoaded = false;

export function getSidebarSizing(viewportWidth?: number) {
  if (!sidebarPreferenceLoaded) {
    sidebarPreferenceLoaded = true;
    try {
      const saved = Number(localStorage.getItem(sidebarStorageKey));
      if (Number.isSafeInteger(saved) && saved > 0) preferredSidebarWidth = saved;
    } catch { /* Use the session preference when storage is unavailable. */ }
  }
  const viewport = viewportWidth ?? Math.max(1, Math.floor(Math.min(window.innerWidth, window.visualViewport?.width ?? window.innerWidth) / getPixelUnit()));
  const maximum = Math.max(1, Math.min(Math.floor(viewport / 2), viewport - 240));
  const minimum = Math.min(120, maximum);
  const width = Math.max(minimum, Math.min(maximum, preferredSidebarWidth ?? Math.floor(viewport / 5)));
  return { width, minimum, maximum, viewport };
}

function applySidebarWidth(viewportWidth?: number) {
  const sizing = getSidebarSizing(viewportWidth);
  // A separate variable lets compact/collapsed CSS continue to use a zero-width layout column.
  document.documentElement.style.setProperty('--sidebar-expanded-width', `${sizing.width}rem`);
  window.dispatchEvent(new Event('pixel:sidebar-width'));
}

export function setSidebarWidth(width: number | null, persist = true) {
  getSidebarSizing();
  if (width !== null && !Number.isFinite(width)) return;
  const { minimum, maximum } = getSidebarSizing();
  preferredSidebarWidth = width === null ? null : Math.max(minimum, Math.min(maximum, Math.round(width)));
  applySidebarWidth();
  if (persist) {
    try {
      if (preferredSidebarWidth === null) localStorage.removeItem(sidebarStorageKey);
      else localStorage.setItem(sidebarStorageKey, String(preferredSidebarWidth));
    } catch { /* Resizing still works during this session. */ }
  }
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
    applySidebarWidth(width);
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
