import { useSyncExternalStore } from 'react';
import { english } from './locales/en';
import { chinese } from './locales/zh';

export type Language = 'en' | 'zh-CN' | 'ja';
type Dictionary = Readonly<Record<string, string>>;
const STORAGE_KEY = 'pixel-chat-language';
const listeners = new Set<() => void>();
// English templates use plural nouns; a count of exactly one takes the singular ("1 run", not "1 runs").
const englishSingular = /(^|[^\d.,])1 (run|chip|wafer|architecture|region|segment|subgroup|fail|item|diagram)s\b/g;
const punctuation: Record<string, string> = { '：': ': ', '；': '; ', '（': ' (', '）': ')', '～': '–', '、': ', ', '，': ', ' };
const englishDictionary: Dictionary = english;
const chineseDictionary: Dictionary = chinese;
let japaneseDictionary: Dictionary | undefined;
let japaneseRequest: Promise<void> | undefined;
let selection = 0;
let language: Language = readLanguage();

function readLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'zh-CN' || saved === 'ja' ? saved : 'en';
  }
  catch { return 'en'; }
}

async function ensureLanguage(next: Language) {
  if (next !== 'ja' || japaneseDictionary) return;
  // Keep Japanese out of the English/Chinese startup download; retry failed downloads on demand.
  japaneseRequest ??= import('./locales/ja').then(module => {
    japaneseDictionary = module.japanese;
    messages = undefined;
  }).catch(error => { japaneseRequest = undefined; throw error; });
  await japaneseRequest;
}

export async function initializeLanguage() {
  try { await ensureLanguage(language); }
  catch { language = 'en'; } // A failed language download must not prevent sign-in.
  applyLanguage();
}

export const getLanguage = () => language;

export function applyLanguage() {
  document.documentElement.lang = language;
  document.title = 'Yield Analysis';
  document.querySelector('meta[name="description"]')?.setAttribute('content',
    t('Yield Analysis — 内存修补分析工作台。'));
}

export async function setLanguage(next: Language) {
  if (next !== 'en' && next !== 'zh-CN' && next !== 'ja') return;
  const request = ++selection;
  await ensureLanguage(next);
  if (request !== selection) return;
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

/** Source keys remain Chinese (with plain overrides for server text); values and interpolation arguments are never recursively translated. */
export function t(source: string, ...values: unknown[]): string {
  const dictionary = language === 'ja' ? japaneseDictionary : language === 'en' ? englishDictionary : chineseDictionary;
  let translated = dictionary && Object.hasOwn(dictionary, source) ? dictionary[source] : source;
  if (language === 'en') translated = translated.replace(/[：；（）～、，]/g, character => punctuation[character]);
  const filled = translated.replace(/\{(\d+)\}/g, (token, index: string) => Number(index) < values.length ? String(values[Number(index)] ?? '') : token);
  return language === 'en' ? filled.replace(englishSingular, (_match, before: string, noun: string) => `${before}1 ${noun}`) : filled;
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
type MessageEntry = { source: string; variants: { text: string; pattern: ReturnType<typeof messagePattern> }[] };
let messages: MessageEntry[] | undefined;
function messageEntries() {
  // Most notices already use source keys. Compile template patterns only when needed.
  return messages ??= Object.entries(english).map(([source, translated]) => ({
    source, variants: [...new Set([source, translated, chineseDictionary[source], japaneseDictionary?.[source]].filter((text): text is string => text !== undefined))]
      .map(text => ({ text, pattern: messagePattern(text) })),
  }));
}

/** Use only for application-generated notices/errors, never chat text, names or uploaded data. */
export function localizeMessage(message: string): string {
  if (Object.hasOwn(english, message)) return t(message);
  for (const entry of messageEntries()) {
    if (entry.variants.some(variant => variant.text === message)) return t(entry.source);
    for (const { pattern } of entry.variants) {
      if (!pattern.indices.length) continue;
      const match = pattern.regex.exec(message);
      if (!match) continue;
      const values: string[] = [];
      pattern.indices.forEach((index, position) => {
        const value = match[position + 1];
        // Only the shared codec's type names are translated; user-supplied values remain intact.
        const type = ['整数', '有限数字'].find(source =>
          value === source || value === englishDictionary[source] || value === japaneseDictionary?.[source]);
        values[index] = type ? t(type) : value;
      });
      return t(entry.source, ...values);
    }
  }
  return message;
}

export function formatDate(value: number): string {
  return new Date(value).toLocaleString(language);
}
