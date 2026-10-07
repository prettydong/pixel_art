import { useSyncExternalStore } from 'react';

const key = 'pixel-chat-auto-conclusions';
const listeners = new Set<() => void>();
function readPreference() {
  try { return localStorage.getItem(key) !== 'false'; }
  catch { return true; }
}
let enabled = readPreference();
export const getAutoConclusions = () => enabled;
const notify = () => listeners.forEach(listener => listener());
export function setAutoConclusions(next: boolean) {
  enabled = next;
  try { localStorage.setItem(key, String(next)); } catch { /* Keep the session preference. */ }
  notify();
}
window.addEventListener('storage', event => {
  if (event.key === key || event.key === null) { enabled = readPreference(); notify(); }
});
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useAutoConclusions() {
  return [useSyncExternalStore(subscribe, getAutoConclusions), setAutoConclusions] as const;
}
