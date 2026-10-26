import { localizeMessage, t, useLanguage } from './i18n';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { architectureCols, cpCountForCols, CSL_PER_CP, MAX_CP_COUNT, type CslRuleSet } from '@pixel/contracts';
import {
  ARCHITECTURE_TEMPLATES,
  architectureSummary,
  parseArchitecture,
  serializeArchitecture,
  type ArchitectureFields,
} from './architectureTemplates';
import './ArchitectureEditor.css';
import { CcrLayoutPreview } from './CcrLayoutPreview';

type InitialArchitecture = { name: string; description: string };

type Props = {
  initial?: InitialArchitecture;
  /** Rule sets from the CSL rules page; null while they load. */
  ruleSets: CslRuleSet[] | null;
  initialRuleSetId: string;
  pending: boolean;
  onSave: (name: string, description: string, ruleSetId: string | null) => Promise<void>;
  onCancel: () => void;
};

type Mode = 'parameters' | 'custom';

const defaultTemplate = ARCHITECTURE_TEMPLATES[0];

function templateFields(templateId: string): ArchitectureFields {
  return ARCHITECTURE_TEMPLATES.find(template => template.id === templateId)?.fields ?? defaultTemplate.fields;
}

function initialDraft(initial?: InitialArchitecture) {
  const parsed = initial ? parseArchitecture(initial.description) : null;
  return {
    name: initial?.name ?? defaultTemplate.name,
    customDescription: initial?.description ?? '',
    fields: parsed?.fields ?? defaultTemplate.fields,
    templateId: parsed?.templateId ?? defaultTemplate.id,
    mode: (parsed || !initial ? 'parameters' : 'custom') as Mode,
  };
}

function readableError(error: unknown) {
  return error instanceof Error && error.message ? error.message : t("保存失败，请稍后重试。");
}

export function ArchitectureEditor({ initial, ruleSets, initialRuleSetId, pending, onSave, onCancel }: Props) {
  const [language] = useLanguage();
  const draft = initialDraft(initial);
  const [name, setName] = useState(draft.name);
  const [customDescription, setCustomDescription] = useState(draft.customDescription);
  const [fields, setFields] = useState<ArchitectureFields>(draft.fields);
  const [templateId, setTemplateId] = useState(draft.templateId);
  const [mode, setMode] = useState<Mode>(draft.mode);
  const [ruleSetId, setRuleSetId] = useState(initialRuleSetId);
  const [confirmDefaults, setConfirmDefaults] = useState(false);
  const [needsPresetForParameters, setNeedsPresetForParameters] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);

  useEffect(() => {
    const next = initialDraft(initial);
    setName(next.name);
    setCustomDescription(next.customDescription);
    setFields(next.fields);
    setTemplateId(next.templateId);
    setMode(next.mode);
    setConfirmDefaults(false);
    setNeedsPresetForParameters(false);
    setError('');
    setAdvancedOpen(false);
  }, [initial?.name, initial?.description]);
  // The select stays disabled until the rule sets load, so this never replaces a choice.
  useEffect(() => { setRuleSetId(initialRuleSetId); }, [initialRuleSetId]);

  const generated = useMemo(() => {
    try {
      return { value: serializeArchitecture(fields, templateId), error: '' };
    } catch (reason) {
      return { value: '', error: readableError(reason) };
    }
  }, [fields, templateId, language]);
  const generatedSummary = generated.value ? architectureSummary(generated.value) : null;
  const ruleSet = ruleSets?.find(item => item.id === ruleSetId);
  const ruleSetCols = ruleSet ? String(ruleSet.cpCount * CSL_PER_CP) : null;

  // Saving links the rule set, whose CP count then follows this col count.
  const linkCols = architectureCols(mode === 'parameters' ? generated.value : customDescription);
  const linkCpCount = linkCols === null ? null : cpCountForCols(linkCols);
  const linkNote = !ruleSet || linkCols === null ? null
    : linkCpCount === null ? { warning: true, text: t("{0} col 无法换算为 CP（每 CP {1} col，最多 {2} CP），规则集“{3}”保持 {4} CP", linkCols, CSL_PER_CP, MAX_CP_COUNT, ruleSet.name, ruleSet.cpCount) }
      : linkCpCount !== ruleSet.cpCount ? { warning: false, text: t("保存后规则集“{0}”改为 {1} CP", ruleSet.name, linkCpCount) } : null;

  function changeField(key: keyof ArchitectureFields, value: string) {
    setFields(current => ({ ...current, [key]: value }));
    setConfirmDefaults(false);
    setError('');
  }

  function chooseRuleSet(id: string) {
    setRuleSetId(id);
    setError('');
    const next = ruleSets?.find(item => item.id === id);
    if (!next || mode !== 'parameters') return;
    const cols = String(next.cpCount * CSL_PER_CP);
    // A new architecture's untouched default name follows the col count.
    if (!initial && name === `${fields.rows}×${fields.cols} CCR`) setName(`${fields.rows}×${cols} CCR`);
    changeField('cols', cols);
  }

  function restoreDefaults() {
    const defaults = templateFields(templateId);
    setFields(ruleSetCols ? { ...defaults, cols: ruleSetCols } : defaults);
    setConfirmDefaults(false);
    setNeedsPresetForParameters(false);
    setError('');
  }

  function switchMode(nextMode: Mode) {
    if (nextMode === mode) return;
    setConfirmDefaults(false);
    setNeedsPresetForParameters(false);
    if (nextMode === 'custom') {
      if (generated.error) {
        setError(generated.error);
        return;
      }
      setCustomDescription(generated.value);
      setMode('custom');
      setError('');
      return;
    }
    const parsed = parseArchitecture(customDescription);
    if (parsed) {
      setFields(parsed.fields);
      setTemplateId(parsed.templateId);
      setMode('parameters');
      setError('');
      return;
    }
    setNeedsPresetForParameters(true);
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || saving.current) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("请填写架构名称。"));
      return;
    }
    const description = mode === 'parameters' ? generated.value : customDescription.trim();
    if (mode === 'parameters' && generated.error) {
      setError(generated.error);
      return;
    }
    if (!description) {
      setError(t("请填写架构定义。"));
      return;
    }
    setError('');
    saving.current = true;
    try {
      await onSave(trimmedName, description, ruleSetId || null);
    } catch (reason) {
      setError(readableError(reason));
    } finally { saving.current = false; }
  }

  const advancedSummary = [
    fields.coordinateBase !== '0' ? t("地址从 {0} 开始", fields.coordinateBase) : '',
    generated.value ? t("{0} 个 segment", Number(fields.sectionCount) / Number(fields.sectionsPerSegment)) : '',
    fields.notes.trim() ? t("有备注") : '',
  ].filter(Boolean).join(' · ');
  const advancedError = [t('地址起点'), t('备注'), 'Segment', 'segment', 'Section', 'section', 'Subsection', 'subsection']
    .some(label => generated.error.includes(label));

  return <form className="architecture-editor task-architecture-form" onSubmit={event => void submit(event)} aria-busy={pending}>
    <div className="architecture-editor-heading">
      <h2>{initial ? t("编辑 CCR 架构") : t("新建 CCR 架构")}</h2>
      <div className="architecture-editor-mode" role="group" aria-label={t("定义方式")}>
        <button type="button" className={mode === 'parameters' ? 'selected' : ''} aria-pressed={mode === 'parameters'} disabled={pending} onClick={() => switchMode('parameters')}>{t("参数配置")}</button>
        <button type="button" className={mode === 'custom' ? 'selected' : ''} aria-pressed={mode === 'custom'} disabled={pending} onClick={() => switchMode('custom')}>{t("自定义文本")}</button>
      </div>
    </div>
    <div className="architecture-editor-basics">
      <label className="architecture-editor-field"><span className="architecture-field-label">{t("名称")}</span>
        <input required maxLength={120} value={name} disabled={pending} onChange={event => { setName(event.target.value); setError(''); }} placeholder={t("架构名称")} />
      </label>
      <label className="architecture-editor-field"><span className="architecture-field-label">{t("CSL 规则")}</span>
        <select value={ruleSetId} disabled={pending || !ruleSets} onChange={event => chooseRuleSet(event.target.value)}>
          <option value="">{t("不关联")}</option>
          {ruleSets?.map(item => <option key={item.id} value={item.id}>{t("{0} · {1} CP", item.name, item.cpCount)}</option>)}
        </select>
      </label>
    </div>
    {linkNote && <p className={linkNote.warning ? 'task-warning' : 'task-note'} role="status">{linkNote.text}</p>}

    {mode === 'parameters' ? <>
      {confirmDefaults && <div className="architecture-editor-confirm" role="status">
        <p>{t("用默认参数替换当前参数？")}</p>
        <button className="action-button" type="button" disabled={pending} onClick={restoreDefaults}>{t("替换")}</button>
        <button className="action-button" type="button" disabled={pending} onClick={() => setConfirmDefaults(false)}>{t("取消")}</button>
      </div>}
      <div className="architecture-editor-core">
        <fieldset className="architecture-editor-section" disabled={pending}>
          <legend>{t("Region 尺寸")}</legend>
          <div className="architecture-editor-fields">
            <Field label={t("Region row 数")} value={fields.rows} disabled={pending} onChange={value => changeField('rows', value)} />
            <Field label={t("Region col 数")} value={fields.cols} disabled={pending} onChange={value => changeField('cols', value)} />
          </div>
        </fieldset>
        <fieldset className="architecture-editor-section" disabled={pending}>
          <legend>{t("CCR 冗余资源")}</legend>
          <div className="architecture-editor-fields">
            <Field label={t("Region 全局备用 row")} value={fields.spareRows} disabled={pending} onChange={value => changeField('spareRows', value)} />
            <Field label={t("CCR 子组数 / segment")} value={fields.ccrGroupsPerSegment} disabled={pending} onChange={value => changeField('ccrGroupsPerSegment', value)} />
            <Field label={t("每子组备用 col")} value={fields.ccrSparesPerGroup} disabled={pending} onChange={value => changeField('ccrSparesPerGroup', value)} />
          </div>
        </fieldset>
      </div>
      <details className="architecture-editor-advanced" open={advancedOpen || advancedError} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
        <summary>{t("Segment 划分与高级选项")}{advancedSummary ? ` · ${advancedSummary}` : ''}</summary>
        <div className="architecture-editor-fields">
          <label className="architecture-editor-field"><span className="architecture-field-label">{t("地址起点")}</span>
            <select value={fields.coordinateBase} disabled={pending} onChange={event => changeField('coordinateBase', event.target.value)}><option value="0">{t("0（默认）")}</option><option value="1">1</option></select>
          </label>
          <Field label={t("Section 总数")} value={fields.sectionCount} disabled={pending} onChange={value => changeField('sectionCount', value)} />
          <Field label={t("Section 数 / segment")} value={fields.sectionsPerSegment} disabled={pending} onChange={value => changeField('sectionsPerSegment', value)} />
          <Field label={t("Section group row 跨度")} value={fields.sectionGroupSize} disabled={pending} onChange={value => changeField('sectionGroupSize', value)} />
          <Field label={t("Subsection row 步长")} value={fields.subsectionSize} disabled={pending} onChange={value => changeField('subsectionSize', value)} />
          <Field label={t("Subsection 数 / group")} value={fields.subsectionsPerGroup} disabled={pending} onChange={value => changeField('subsectionsPerGroup', value)} />
          <label className="architecture-editor-field architecture-editor-notes"><span className="architecture-field-label">{t("备注")}</span>
            <textarea rows={2} maxLength={4000} value={fields.notes} disabled={pending} onChange={event => changeField('notes', event.target.value)} placeholder={t("可选")} />
          </label>
        </div>
        <div className="panel-actions"><button className="action-button" type="button" disabled={pending} onClick={() => setConfirmDefaults(true)}>{t("恢复默认参数")}</button></div>
        {generated.value && <details className="architecture-editor-generated"><summary>{t("查看完整定义")}</summary><pre>{generated.value}</pre></details>}
      </details>
      {generated.value && <details className="architecture-editor-advanced ccr-preview-toggle"><summary>{t("查看 CCR 结构与地址映射")}</summary><CcrLayoutPreview description={generated.value} /></details>}
      {generated.error && <p role="alert" className="error-text">{localizeMessage(generated.error)}</p>}
    </> : <label className="architecture-editor-field"><span className="architecture-field-label">{t("架构定义")}</span>
      <textarea required rows={8} maxLength={30000} value={customDescription} disabled={pending} onChange={event => { setCustomDescription(event.target.value); setNeedsPresetForParameters(false); setError(''); }} placeholder={t("输入架构说明或 JSON")} />
    </label>}

    {needsPresetForParameters && <div className="architecture-editor-confirm" role="status">
      <p>{t("当前文本无法转为参数配置。使用默认参数替换？")}</p>
      <button className="action-button" type="button" disabled={pending} onClick={() => { restoreDefaults(); setMode('parameters'); }}>{t("使用默认参数")}</button>
      <button className="action-button" type="button" disabled={pending} onClick={() => { setNeedsPresetForParameters(false); setError(''); }}>{t("保留原文")}</button>
    </div>}
    {error && <p role="alert" className="error-text">{localizeMessage(error)}</p>}
    <div className="architecture-editor-footer">
      {mode === 'parameters' && generatedSummary && <p className="task-note">{generatedSummary}</p>}
      <div className="panel-actions"><button className="action-button primary" disabled={pending || (mode === 'parameters' && !!generated.error)}>{pending ? t("正在保存…") : t("保存")}</button><button className="action-button" type="button" disabled={pending} onClick={onCancel}>{t("取消")}</button></div>
    </div>
  </form>;
}

function Field({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <label className="architecture-editor-field"><span className="architecture-field-label">{label}</span>
    <input value={value} disabled={disabled} inputMode="numeric" onChange={event => onChange(event.target.value)} />
  </label>;
}
