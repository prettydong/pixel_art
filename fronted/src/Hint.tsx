import { useId, type ReactNode } from 'react';
import { Help } from './Icons';
import { t } from './i18n';

// Secondary notes stay one hover / focus / tap away instead of occupying a line of small text.
export function Hint({ children, label }: { children: ReactNode; label?: string }) {
  const id = useId();
  return <span className="hint">
    <button type="button" className="hint-trigger" aria-label={label ?? t("说明")} aria-describedby={id} onClick={event => event.stopPropagation()}><Help /></button>
    <span role="tooltip" id={id} className="hint-bubble">{children}</span>
  </span>;
}
