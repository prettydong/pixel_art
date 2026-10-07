import { t } from './i18n';
import { useEffect, useState } from 'react';
import { Trash2 } from './PixelIcons';

// The first press arms the button; deletion needs a second press within 3 s.
export function DeleteChatButton({ title, disabled, onDelete }: { title: string; disabled: boolean; onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);
  useEffect(() => { if (disabled) setArmed(false); }, [disabled]);
  return <button
    className={`delete-chat ${armed ? 'armed' : ''}`}
    disabled={disabled}
    aria-label={armed ? t("确认删除对话：{0}", title) : t("删除对话：{0}", title)}
    title={armed ? t("再次点击确认删除") : t("删除对话")}
    onBlur={() => setArmed(false)}
    onClick={() => { if (armed) { setArmed(false); onDelete(); } else setArmed(true); }}
  >{armed ? t("删除") : <Trash2 />}</button>;
}
