import { useEffect, useState } from 'react';
import { t, useLanguage } from './i18n';

// Status verbs shown while the agent works. They describe waiting, never progress.
const verbs = [
  "琢磨中", "正在驯服晶圆", "正在数失效点", "正在赶备用行", "正在抛接列地址",
  "正在请教 CCR", "正在酿造良率", "正在解开比特", "正在擦亮硅片", "正在排兵布阵",
  "正在翻找冗余", "正在和 row 谈判", "正在给 col 编组", "正在喝口咖啡",
  "正在旋涂光刻胶", "正在校准探针卡", "正在熔断熔丝", "正在点亮良品 die", "正在扫描晶圆图",
];

function pick(previous = -1) {
  let next = Math.floor(Math.random() * verbs.length);
  if (next === previous) next = (next + 1) % verbs.length;
  return next;
}

const cells = Array.from({ length: 16 }, (_, index) => ({ row: Math.floor(index / 4), col: index % 4 }));
const failing = new Map([["1:0", "fail"], ["1:2", "fail"], ["3:3", "fail late"]]);

/** A 4 × 4 memory array: cells fail, then a spare row sweeps down and repairs them. */
export function RepairSweep() {
  return <svg className="repair-sweep" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    {cells.map(({ row, col }) => <rect key={`${row}:${col}`} className={`cell ${failing.get(`${row}:${col}`) ?? ""}`} x={col * 4 + .5} y={row * 4 + .5} width={3} height={3} rx={.7} />)}
    <rect className="sweep" x={-1} y={-.7} width={18} height={1.4} rx={.7} />
  </svg>;
}

/** The working line: a repair sweep, a rotating playful verb and elapsed seconds. */
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
    <RepairSweep />
    <span key={verb} className="thinking-verb" aria-hidden="true">{t(verbs[verb])}…</span>
    {seconds > 0 && <span className="thinking-time" aria-hidden="true">{seconds}s</span>}
  </span>;
}
