import { t } from './i18n';
import { Fragment } from 'react';
import type { Mention } from '@pixel/contracts';
import { splitMentions } from './mentionText';

/** The user's own text, shown exactly as typed with "@" references marked; app-generated requests show a short summary first. */
export function UserMessageText({ text, mentions }: { text: string; mentions?: Mention[] }) {
  const summary = appRequestSummary(text);
  if (summary) return <AppRequestText summary={summary} text={text} />;
  if (!mentions?.length) return <span className="user-message-text">{text}</span>;
  return <span className="user-message-text">{splitMentions(text, mentions).map((part, index) => part.mention
    ? <span key={index} className="mention-token">{part.text}</span>
    : <Fragment key={index}>{part.text}</Fragment>)}</span>;
}

// Requests the app sends on the user's behalf (diagram drawing, repair code) carry developer instructions.
const drawingRequests = [
  /^请为当前任务中的架构 ([\s\S]+?)（ID：[^，]+，[\s\S]*架构预览/,
  /^(?:Independently design and generate|Generate) a Pixi architecture preview for architecture ([\s\S]+?) \(ID: [^,]+,/,
  /^現在のタスクのアーキテクチャ ([\s\S]+?) \(ID: [^,]+,[\s\S]*Pixi アーキテクチャプレビュー/,
];
const repairCodeRequest = '为任务面板实现 C++17 冗余资源映射';
const cslCheckRequest = '为 CSL 规则页编写规则检查脚本';
function drawingName(text: string) {
  for (const pattern of drawingRequests) {
    const name = pattern.exec(text)?.[1];
    if (name) return name;
  }
  return null;
}
/** Chats the app starts for a diagram or repair code, rather than the user's own questions. */
export function appRequestKind(text: string): 'drawing' | 'repair-code' | 'csl-check' | null {
  return drawingName(text) !== null ? 'drawing' : text.startsWith(repairCodeRequest) ? 'repair-code' : text.startsWith(cslCheckRequest) ? 'csl-check' : null;
}
export function isAppRequest(text: string) {
  return appRequestKind(text) !== null;
}
function appRequestSummary(text: string): string | null {
  const name = drawingName(text);
  if (name) return t("请为架构“{0}”绘制示意图", name);
  if (text.startsWith(repairCodeRequest)) return t("为所选架构编写修补代码；完成后系统会自动编译，并在所选 wafer 上运行修补。");
  if (text.startsWith(cslCheckRequest)) return t("按 CSL 规则编写检查脚本；完成后系统会先自测，再用于检查所选 col 是否符合规则。");
  return null;
}

function AppRequestText({ summary, text }: { summary: string; text: string }) {
  return <div className="user-message-text">{summary}
    <details className="app-request-details"><summary>{t("发送给 AI 的完整说明")}</summary><span>{text}</span></details>
  </div>;
}
