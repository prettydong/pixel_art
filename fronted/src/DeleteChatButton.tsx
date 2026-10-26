import { t } from './i18n';
import { useEffect, useState } from 'react';
import { Check, Trash2 } from './Icons';

// The first press arms the button; deletion needs a second press within 3 s.
export function useArmedDelete(disabled: boolean) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);
  useEffect(() => { if (disabled) setArmed(false); }, [disabled]);
  return [armed, setArmed] as const;
}

export function DeleteChatButton({ title, disabled, onDelete }: { title: string; disabled: boolean; onDelete: () => void }) {
  const [armed, setArmed] = useArmedDelete(disabled);
  return <button
    className={`delete-chat ${armed ? 'armed' : ''}`}
    disabled={disabled}
    aria-label={armed ? t("确认删除对话：{0}", title) : t("删除对话：{0}", title)}
    title={armed ? t("再次点击确认删除") : t("删除对话")}
    onBlur={() => setArmed(false)}
    onClick={() => { if (armed) { setArmed(false); onDelete(); } else setArmed(true); }}
  >{armed ? t("删除") : <Trash2 />}</button>;
}

export function DeleteArchitectureButton({ name, disabled, onDelete, kind = 'architecture' }: { name: string; disabled: boolean; onDelete: () => void; kind?: 'architecture' | 'rules' }) {
  const [armed, setArmed] = useArmedDelete(disabled);
  const rules = kind === 'rules';
  return <button
    className={`icon-button delete-architecture ${armed ? 'armed' : ''}`}
    disabled={disabled}
    aria-label={armed ? (rules ? t("确认删除规则集：{0}", name) : t("确认删除架构：{0}", name)) : rules ? t("删除规则集：{0}", name) : t("删除架构：{0}", name)}
    title={armed ? t("再次点击确认删除") : rules ? t("删除规则集") : t("删除架构")}
    onBlur={() => setArmed(false)}
    onClick={() => { if (armed) { setArmed(false); onDelete(); } else setArmed(true); }}
  >{armed ? <Check /> : <Trash2 />}</button>;
}
