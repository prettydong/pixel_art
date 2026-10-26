import { useState } from 'react';
import { t, useLanguage, type Language } from './i18n';

export function LanguageSelect() {
  const [language, selectLanguage] = useLanguage();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return <label className="language-select">
    <span>{t('语言')}</span>
    <select aria-label={t('语言')} value={language} disabled={pending} aria-busy={pending}
      onChange={event => {
        setPending(true); setFailed(false);
        void selectLanguage(event.target.value as Language).catch(() => setFailed(true)).finally(() => setPending(false));
      }}>
      <option value="en">English</option>
      <option value="zh-CN">简体中文</option>
      <option value="ja">日本語</option>
    </select>
    {failed && <span role="alert" className="error-text">{t('语言载入失败，请重试。')}</span>}
  </label>;
}
