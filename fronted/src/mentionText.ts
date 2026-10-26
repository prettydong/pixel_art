import type { Mention, MentionRef } from '@pixel/contracts';

export type MentionQuery = { start: number; query: string };

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A mention ends where the name ends; "@A" must not match inside "@AB".
const tokenEnd = '(?![\\p{L}\\p{N}_])';
const keywords: Record<Mention['kind'], string[]> = {
  architecture: ['arch', 'architecture', '架构', 'アーキテクチャ'],
  wafer: ['dataset', 'data', 'wafer', '数据', 'データ'],
};

export const mentionKey = (mention: MentionRef) => `${mention.kind}:${mention.id}`;

/** The "@query" the caret is in, if any: "@" at the start or after a space, followed by no whitespace. */
export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const match = /(?:^|[\s(（,，、;；])@([^\s@]*)$/u.exec(text.slice(0, caret));
  return match ? { start: caret - match[1].length - 1, query: match[1] } : null;
}

/** "@arch" / "@dataset" (or a prefix of them) lists that kind; "@arch:R1" narrows it by name; anything else matches names. */
export function filterMentions(options: Mention[], query: string): Mention[] {
  const lower = query.toLowerCase();
  return options.filter(option => {
    const name = option.name.toLowerCase();
    return name.includes(lower) || keywords[option.kind].some(keyword => {
      if (keyword.startsWith(lower)) return true;
      if (!lower.startsWith(keyword)) return false;
      return name.includes(lower.slice(keyword.length).replace(/^[:：/]/, ''));
    });
  });
}

/** Mentions whose "@name" is still in the text, in the order they were picked. */
export function activeMentions(text: string, mentions: Mention[]): Mention[] {
  return mentions.filter(mention => new RegExp(`@${escapeRegex(mention.name)}${tokenEnd}`, 'u').test(text));
}

/** Splits text into plain runs and "@name" runs for the given mentions, preferring the longest name. */
export function splitMentions(text: string, mentions: Mention[]): { text: string; mention?: Mention }[] {
  if (!mentions.length) return [{ text }];
  const names = [...new Set(mentions.map(mention => mention.name))].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`@(${names.map(escapeRegex).join('|')})${tokenEnd}`, 'gu');
  const parts: { text: string; mention?: Mention }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) });
    parts.push({ text: match[0], mention: mentions.find(mention => mention.name === match[1]) });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

/** Turns "@name" back into plain text, dropping the reference. */
export function unmention(text: string, mention: Mention): string {
  return text.replace(new RegExp(`@(${escapeRegex(mention.name)})${tokenEnd}`, 'gu'), '$1');
}
