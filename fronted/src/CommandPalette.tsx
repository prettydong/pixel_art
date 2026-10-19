import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react';
import { t } from './i18n';
import type { Conversation } from './chatTypes';
import { CornerDownLeft, Folder, MessageSquare, Search } from './Icons';

export type PaletteAction = { id: string; label: string; icon: ComponentType; hint?: string; keywords?: string; run: () => void };

/** Platform modifier label for shortcut hints. */
export const modKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

type Props = {
  query: string; onQuery: (value: string) => void; actions: PaletteAction[];
  chats: Conversation[]; searching: boolean; chatDetail: (chat: Conversation) => string;
  onChat: (id: string) => void; onClose: () => void;
};

/** ⌘K: one box for actions and chat search, driven by arrow keys and Enter. */
export function CommandPalette({ query, onQuery, actions, chats, searching, chatDetail, onChat, onClose }: Props) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLowerCase();
  const matched = needle ? actions.filter(action => `${action.label} ${action.keywords ?? ''}`.toLowerCase().includes(needle)) : actions;
  const shownChats = needle ? chats : chats.slice(0, 8);
  const items = [
    ...matched.map(action => () => { onClose(); action.run(); }),
    ...shownChats.map(chat => () => onChat(chat.id)),
  ];
  useEffect(() => setActive(0), [needle]);
  useEffect(() => { listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);
  function keydown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !items.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => (index + 1) % items.length); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index - 1 + items.length) % items.length); }
    if (event.key === 'Enter') { event.preventDefault(); items[Math.min(active, items.length - 1)]?.(); }
  }
  const option = (index: number) => ({
    id: `palette-option-${index}`, role: 'option', 'aria-selected': active === index, 'data-active': active === index,
    className: 'palette-item', onMouseMove: () => setActive(index), onClick: items[index],
  });
  return <div className="palette">
    <div className="palette-field">
      <Search />
      <input className="palette-input" autoFocus role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list"
        aria-activedescendant={items.length ? `palette-option-${Math.min(active, items.length - 1)}` : undefined}
        aria-label={t("搜索或输入命令")} placeholder={t("搜索聊天，或输入命令…")}
        value={query} onChange={event => onQuery(event.target.value)} onKeyDown={keydown} />
      <kbd>Esc</kbd>
    </div>
    <div className="palette-list" id="palette-list" role="listbox" aria-label={t("命令与聊天")} ref={listRef}>
      {matched.length > 0 && <div className="palette-section" role="presentation">{t("操作")}</div>}
      {matched.map((action, index) => <button key={action.id} {...option(index)}>
        <action.icon /><span>{action.label}</span>{action.hint ? <kbd>{action.hint}</kbd> : <CornerDownLeft className="palette-enter" />}
      </button>)}
      {shownChats.length > 0 && <div className="palette-section" role="presentation">{needle ? t("匹配的聊天") : t("最近聊天")}</div>}
      {shownChats.map((chat, index) => <button key={chat.id} {...option(matched.length + index)}>
        <MessageSquare /><span>{chat.title}<small>{chatDetail(chat)}</small></span><CornerDownLeft className="palette-enter" />
      </button>)}
      {searching && <p role="status">{t("搜索中…")}</p>}
      {!searching && !items.length && <div className="palette-empty"><Folder /><p>{query ? t("没有找到相关对话") : t("还没有对话，先聊点什么吧。")}</p></div>}
    </div>
    <div className="palette-footer" aria-hidden="true">
      <span><kbd>↑</kbd><kbd>↓</kbd>{t("选择")}</span>
      <span><kbd>↵</kbd>{t("打开")}</span>
      <span><kbd>{modKey}</kbd><kbd>B</kbd>{t("侧边栏")}</span>
      <span><kbd>/</kbd>{t("聚焦输入框")}</span>
    </div>
  </div>;
}
