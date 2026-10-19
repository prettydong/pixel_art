// Layout breakpoints and the resizable sidebar width, all in CSS pixels.
const sidebarStorageKey = 'chat-sidebar-width';
let preferredSidebarWidth: number | null = null;
let sidebarPreferenceLoaded = false;

function viewportWidth() {
  return Math.max(1, Math.floor(Math.min(window.innerWidth, window.visualViewport?.width ?? window.innerWidth)));
}

export function getSidebarSizing(width = viewportWidth()) {
  if (!sidebarPreferenceLoaded) {
    sidebarPreferenceLoaded = true;
    try {
      const saved = Number(localStorage.getItem(sidebarStorageKey));
      if (Number.isSafeInteger(saved) && saved > 0) preferredSidebarWidth = saved;
    } catch { /* Use the session preference when storage is unavailable. */ }
  }
  const maximum = Math.max(1, Math.min(Math.floor(width / 2), width - 480, 480));
  const minimum = Math.min(200, maximum);
  const fallback = Math.max(220, Math.min(320, Math.floor(width / 5)));
  const current = Math.max(minimum, Math.min(maximum, preferredSidebarWidth ?? fallback));
  return { width: current, minimum, maximum, viewport: width };
}

function applySidebarWidth(width?: number) {
  const sizing = getSidebarSizing(width);
  // A separate variable lets compact/collapsed CSS keep a zero-width layout column.
  document.documentElement.style.setProperty('--sidebar-expanded-width', `${sizing.width}px`);
  window.dispatchEvent(new Event('app:sidebar-width'));
}

export function setSidebarWidth(width: number | null, persist = true) {
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

/** Canvas renderers draw at the device resolution so text and lines stay sharp. */
export function getRenderResolution() {
  return Math.max(1, Math.min(3, window.devicePixelRatio || 1));
}

export function startViewport() {
  const root = document.documentElement;
  function update() {
    const width = viewportWidth();
    applySidebarWidth(width);
    root.dataset.layout = width < 760 ? 'compact' : 'wide';
    root.dataset.narrow = String(width < 420);
  }
  update();
  window.addEventListener('resize', update);
  window.visualViewport?.addEventListener('resize', update);
  return () => {
    window.removeEventListener('resize', update);
    window.visualViewport?.removeEventListener('resize', update);
  };
}

/** Canvas text uses the same system UI family as the page. */
export const canvasFontFamily = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
