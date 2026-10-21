import { useEffect, useState } from 'react';
import { t, useLanguage } from './i18n';
import { Spark } from './Icons';

// Status verbs shown while the agent works. They describe waiting, never progress.
const verbs = [
  "琢磨中", "正在驯服晶圆", "正在数失效点", "正在赶备用行", "正在抛接列地址",
  "正在请教 CCR", "正在酿造良率", "正在解开比特", "正在擦亮硅片", "正在排兵布阵",
  "正在翻找冗余", "正在和 row 谈判", "正在给 col 编组", "正在喝口咖啡",
];

function pick(previous = -1) {
  let next = Math.floor(Math.random() * verbs.length);
  if (next === previous) next = (next + 1) % verbs.length;
  return next;
}

/** A spinning spark, a rotating verb and elapsed seconds, like Claude Code's working line. */
export function Thinking({ label }: { label?: string }) {
  useLanguage();
  const [verb, setVerb] = useState(() => pick());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed > 0 && elapsed % 3 === 0) setVerb(previous => pick(previous));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="thinking" role="status" aria-label={label ?? t("正在回复")}>
    <Spark className="thinking-spark" />
    <span key={verb} className="thinking-verb" aria-hidden="true">{t(verbs[verb])}…</span>
    {seconds > 0 && <span className="thinking-time" aria-hidden="true">{seconds}s</span>}
  </span>;
}
