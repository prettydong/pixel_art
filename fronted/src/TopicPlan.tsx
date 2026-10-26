import { t } from './i18n';
import type { ComponentType } from 'react';
import { EvaluationDiagram } from './EvaluationDiagram';
import { Check } from './Icons';
import './TopicPlan.css';

export type PlanField = { label: string; prefix: string };

/** The "Field:" lines of a direction's starter prompt; the first line is the request itself. */
export function planFields(prompt: string): PlanField[] {
  return prompt.split('\n').slice(1).map(line => line.trimEnd()).filter(line => /[:：]$/.test(line))
    .map(line => ({ label: line.slice(0, -1).trim(), prefix: line }));
}

/** The draft's answer for a field: undefined when its line is gone, '' while still blank. */
export function fieldValue(draft: string, field: PlanField): string | undefined {
  for (const line of draft.split('\n')) {
    const text = line.trimStart();
    if (text.startsWith(field.prefix)) return text.slice(field.prefix.length).trim();
  }
  return undefined;
}

type Props = { kind: 'data' | 'architecture' | 'repair'; icon: ComponentType; title: string; outcome: string; draft: string; fields: PlanField[]; onField: (field: PlanField) => void };

/** The chosen direction's points to cover, checked off as the draft fills them in. */
export function TopicPlan({ kind, icon: Icon, title, outcome, draft, fields, onField }: Props) {
  const values = fields.map(field => fieldValue(draft, field));
  return <section className={`topic-plan evaluation-${kind}`} aria-label={t("主题计划")}>
    <div className="topic-plan-card">
      <header className="topic-plan-header">
        <Icon />
        <div><h1>{title}</h1><p>{outcome}</p></div>
        {fields.length > 0 && <span className="topic-plan-progress">{t("已填写 {0}/{1}", values.filter(Boolean).length, fields.length)}</span>}
      </header>
      {fields.length > 0 && <ol className="topic-plan-steps">
        {fields.map((field, index) => {
          const value = values[index];
          return <li key={field.prefix}><button type="button" className={value ? 'is-filled' : undefined} title={t("在输入框中填写此项")} onClick={() => onField(field)}>
            <span className="topic-plan-mark" aria-hidden="true">{value ? <Check /> : index + 1}</span>
            <span className="topic-plan-label">{field.label}</span>
            {value && <span className="topic-plan-value">{value}</span>}
            <span className="visually-hidden">{value ? t("已填写") : t("未填写")}</span>
          </button></li>;
        })}
      </ol>}
      <figure className="evaluation-figure topic-plan-figure"><EvaluationDiagram kind={kind} /></figure>
    </div>
  </section>;
}
