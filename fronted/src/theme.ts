import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
const STORAGE_KEY = "pixel-chat-theme";
const SYSTEM_THEME = "(prefers-color-scheme: dark)";

export function readTheme(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // System appearance remains available when storage is blocked.
  }
  return "system";
}

export function applyTheme(preference: ThemePreference) {
  const theme = preference === "system"
    ? (window.matchMedia(SYSTEM_THEME).matches ? "dark" : "light")
    : preference;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content", theme === "light" ? "#f4f1e9" : "#16151b",
  );
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(readTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Keep the selected appearance for this session if persistence is unavailable.
    }
    const media = window.matchMedia(SYSTEM_THEME);
    const onChange = () => {
      if (theme === "system") applyTheme(theme);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  return [theme, setTheme] as const;
}
