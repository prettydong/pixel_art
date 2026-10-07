import { useSyncExternalStore } from 'react';
import { english } from './locales/en';

export type Language = 'en' | 'zh-CN';
const STORAGE_KEY = 'pixel-chat-language';
const listeners = new Set<() => void>();
const punctuation: Record<string, string> = { '：': ': ', '；': '; ', '（': '(', '）': ')', '～': '–', '、': ', ', '，': ', ' };
let language: Language = readLanguage();

function readLanguage(): Language {
  try { return localStorage.getItem(STORAGE_KEY) === 'zh-CN' ? 'zh-CN' : 'en'; }
  catch { return 'en'; }
}

export const getLanguage = () => language;

export function applyLanguage() {
  document.documentElement.lang = language;
  document.title = 'Pixel Chat';
  document.querySelector('meta[name="description"]')?.setAttribute('content',
    language === 'en' ? 'Pixel Chat — a pixel workspace for memory repair analysis.' : 'Pixel Chat — 内存修补分析工作台。');
}

export function setLanguage(next: Language) {
  if (next !== 'en' && next !== 'zh-CN') return;
  language = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Session-only selection still works. */ }
  applyLanguage();
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useLanguage() {
  return [useSyncExternalStore(subscribe, getLanguage, () => 'en' as const), setLanguage] as const;
}

/** Source keys remain Chinese; values and interpolation arguments are never recursively translated. */
export function t(source: string, ...values: unknown[]): string {
  let translated = language === 'en' && Object.hasOwn(english, source) ? english[source] : source;
  if (language === 'en') translated = translated.replace(/[：；（）～、，]/g, character => punctuation[character]);
  return translated.replace(/\{(\d+)\}/g, (token, index: string) => Number(index) < values.length ? String(values[Number(index)] ?? '') : token);
}

export function formatNumber(value: number): string {
  return value.toLocaleString(language);
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function messagePattern(template: string) {
  const indices: number[] = [];
  let cursor = 0;
  let pattern = '^';
  for (const match of template.matchAll(/\{(\d+)\}/g)) {
    pattern += escapeRegex(template.slice(cursor, match.index)) + '([\\s\\S]*?)';
    indices.push(Number(match[1]));
    cursor = match.index! + match[0].length;
  }
  return { regex: new RegExp(pattern + escapeRegex(template.slice(cursor)) + '$'), indices };
}
const messages = Object.entries(english).map(([source, translated]) => ({
  source, translated, chinese: messagePattern(source), english: messagePattern(translated),
}));

/** Use only for application-generated notices/errors, never chat text, names or uploaded data. */
export function localizeMessage(message: string): string {
  if (Object.hasOwn(english, message)) return t(message);
  for (const entry of messages) {
    if (entry.translated === message) return language === 'en' ? message : entry.source;
    const pattern = language === 'en' ? entry.chinese : entry.english;
    if (!pattern.indices.length) continue;
    const match = pattern.regex.exec(message);
    if (!match) continue;
    const values: string[] = [];
    pattern.indices.forEach((index, position) => {
      const value = match[position + 1];
      // These are validation type names from the shared codec, not user content.
      values[index] = language === 'en' && (value === '整数' || value === '有限数字') ? english[value] : value;
    });
    return t(entry.source, ...values);
  }
  return message;
}

export function formatDate(value: number): string {
  return new Date(value).toLocaleString(language);
}
