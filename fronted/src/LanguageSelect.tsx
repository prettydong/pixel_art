import { useLanguage, type Language } from './i18n';

export function LanguageSelect() {
  const [language, selectLanguage] = useLanguage();
  return <label className="language-select">
    <span>{language === 'en' ? 'Language' : '语言'}</span>
    <select aria-label={language === 'en' ? 'Language' : '语言'} value={language}
      onChange={event => selectLanguage(event.target.value as Language)}>
      <option value="en">English</option>
      <option value="zh-CN">简体中文</option>
    </select>
  </label>;
}
