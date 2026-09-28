import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
  pending: boolean;
  onSave: (name: string, description: string) => Promise<void>;
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
  return error instanceof Error && error.message ? error.message : '保存失败，请稍后重试。';
}

export function ArchitectureEditor({ initial, pending, onSave, onCancel }: Props) {
  const draft = initialDraft(initial);
  const [name, setName] = useState(draft.name);
  const [customDescription, setCustomDescription] = useState(draft.customDescription);
  const [fields, setFields] = useState<ArchitectureFields>(draft.fields);
  const [templateId, setTemplateId] = useState(draft.templateId);
  const [mode, setMode] = useState<Mode>(draft.mode);
  const [parametersDirty, setParametersDirty] = useState(false);
  const [confirmTemplateId, setConfirmTemplateId] = useState<string | null>(null);
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
    setParametersDirty(false);
    setConfirmTemplateId(null);
    setNeedsPresetForParameters(false);
    setError('');
    setAdvancedOpen(false);
  }, [initial?.name, initial?.description]);

  const generated = useMemo(() => {
    try {
      return { value: serializeArchitecture(fields, templateId), error: '' };
    } catch (reason) {
      return { value: '', error: readableError(reason) };
    }
  }, [fields, templateId]);
  const generatedSummary = generated.value ? architectureSummary(generated.value) : null;

  function changeField(key: keyof ArchitectureFields, value: string) {
    setFields(current => ({ ...current, [key]: value }));
    setParametersDirty(true);
    setConfirmTemplateId(null);
    setError('');
  }

  function applyTemplate(id: string) {
    const template = ARCHITECTURE_TEMPLATES.find(item => item.id === id);
    if (template && (!name.trim() || ARCHITECTURE_TEMPLATES.some(item => item.name === name))) setName(template.name);
    setFields(templateFields(id));
    setTemplateId(id);
    setParametersDirty(false);
    setConfirmTemplateId(null);
    setNeedsPresetForParameters(false);
    setError('');
  }

  function requestApplyTemplate(id: string) {
    if (id === templateId) return;
    const modified = parametersDirty || JSON.stringify(fields) !== JSON.stringify(templateFields(templateId));
    if (modified) { setConfirmTemplateId(id); return; }
    applyTemplate(id);
  }

  function switchMode(nextMode: Mode) {
    if (nextMode === mode) return;
    setConfirmTemplateId(null);
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
      setParametersDirty(false);
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
      setError('请填写架构名称。');
      return;
    }
    const description = mode === 'parameters' ? generated.value : customDescription.trim();
    if (mode === 'parameters' && generated.error) {
      setError(generated.error);
      return;
    }
    if (!description) {
      setError('请填写架构定义。');
      return;
    }
    setError('');
    saving.current = true;
    try {
      await onSave(trimmedName, description);
    } catch (reason) {
      setError(readableError(reason));
    } finally { saving.current = false; }
  }

  const advancedSummary = [
    fields.coordinateBase !== '0' ? `${fields.coordinateBase} 基坐标` : '',
    generated.value ? `${Number(fields.sectionCount) / Number(fields.sectionsPerSegment)} 个 segment` : '',
    fields.notes.trim() ? '有备注' : '',
  ].filter(Boolean).join(' · ');
  const advancedError = /坐标起点|Segment|segment|Section|section|Subsection|subsection|备注/.test(generated.error);

  return <form className="architecture-editor task-architecture-form" onSubmit={event => void submit(event)} aria-busy={pending}>
    <div className="architecture-editor-heading">
      <h2>{initial ? '编辑 CCR 架构' : '新建 CCR 架构'}</h2>
      <div className="architecture-editor-mode" role="group" aria-label="定义方式">
        <button type="button" className={mode === 'parameters' ? 'selected' : ''} aria-pressed={mode === 'parameters'} disabled={pending} onClick={() => switchMode('parameters')}>参数配置</button>
        <button type="button" className={mode === 'custom' ? 'selected' : ''} aria-pressed={mode === 'custom'} disabled={pending} onClick={() => switchMode('custom')}>自定义</button>
      </div>
    </div>
    <div className="architecture-editor-basics">
      <label className="architecture-editor-field"><span className="architecture-field-label">名称</span>
        <input required maxLength={120} value={name} disabled={pending} onChange={event => { setName(event.target.value); setError(''); }} placeholder="架构名称" />
      </label>
      {mode === 'parameters' && <label className="architecture-editor-field"><span className="architecture-field-label">预设</span>
        <select value={templateId} disabled={pending} onChange={event => requestApplyTemplate(event.target.value)}>
          {ARCHITECTURE_TEMPLATES.map(template => <option key={template.id} value={template.id}>{template.label}</option>)}
        </select>
      </label>}
    </div>

    {mode === 'parameters' ? <>
      {confirmTemplateId && <div className="architecture-editor-confirm" role="status">
        <p>使用“{ARCHITECTURE_TEMPLATES.find(item => item.id === confirmTemplateId)?.label}”替换当前参数？</p>
        <button className="action-button" type="button" disabled={pending} onClick={() => applyTemplate(confirmTemplateId)}>替换</button>
        <button className="action-button" type="button" disabled={pending} onClick={() => setConfirmTemplateId(null)}>取消</button>
      </div>}
      <div className="architecture-editor-core">
        <fieldset className="architecture-editor-section" disabled={pending}>
          <legend>Region 尺寸</legend>
          <div className="architecture-editor-fields">
            <Field label="Region row 数" value={fields.rows} disabled={pending} onChange={value => changeField('rows', value)} />
            <Field label="Region col 数" value={fields.cols} disabled={pending} onChange={value => changeField('cols', value)} />
          </div>
        </fieldset>
        <fieldset className="architecture-editor-section" disabled={pending}>
          <legend>CCR 冗余资源</legend>
          <div className="architecture-editor-fields">
            <Field label="Region 全局备用 row" value={fields.spareRows} disabled={pending} onChange={value => changeField('spareRows', value)} />
            <Field label="CCR 子组数 / segment" value={fields.ccrGroupsPerSegment} disabled={pending} onChange={value => changeField('ccrGroupsPerSegment', value)} />
            <Field label="每子组备用 col" value={fields.ccrSparesPerGroup} disabled={pending} onChange={value => changeField('ccrSparesPerGroup', value)} />
          </div>
        </fieldset>
      </div>
      <details className="architecture-editor-advanced" open={advancedOpen || advancedError} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
        <summary>Segment 划分与高级选项{advancedSummary ? ` · ${advancedSummary}` : ''}</summary>
        <div className="architecture-editor-fields">
          <label className="architecture-editor-field"><span className="architecture-field-label">坐标起点</span>
            <select value={fields.coordinateBase} disabled={pending} onChange={event => changeField('coordinateBase', event.target.value)}><option value="0">0（默认）</option><option value="1">1</option></select>
          </label>
          <Field label="Section 总数" value={fields.sectionCount} disabled={pending} onChange={value => changeField('sectionCount', value)} />
          <Field label="Section 数 / segment" value={fields.sectionsPerSegment} disabled={pending} onChange={value => changeField('sectionsPerSegment', value)} />
          <Field label="Section group row 跨度" value={fields.sectionGroupSize} disabled={pending} onChange={value => changeField('sectionGroupSize', value)} />
          <Field label="Subsection row 步长" value={fields.subsectionSize} disabled={pending} onChange={value => changeField('subsectionSize', value)} />
          <Field label="Subsection 数 / group" value={fields.subsectionsPerGroup} disabled={pending} onChange={value => changeField('subsectionsPerGroup', value)} />
          <label className="architecture-editor-field architecture-editor-notes"><span className="architecture-field-label">备注</span>
            <textarea rows={2} maxLength={4000} value={fields.notes} disabled={pending} onChange={event => changeField('notes', event.target.value)} placeholder="可选" />
          </label>
        </div>
        <div className="panel-actions"><button className="action-button" type="button" disabled={pending} onClick={() => setConfirmTemplateId(templateId)}>恢复当前预设参数</button></div>
        {generated.value && <details className="architecture-editor-generated"><summary>查看完整定义</summary><pre>{generated.value}</pre></details>}
      </details>
      {generated.value && <details className="architecture-editor-advanced ccr-preview-toggle"><summary>查看 CCR 结构与地址映射</summary><CcrLayoutPreview description={generated.value} /></details>}
      {generated.error && <p role="alert" className="error-text">{generated.error}</p>}
    </> : <label className="architecture-editor-field"><span className="architecture-field-label">架构定义</span>
      <textarea required rows={8} maxLength={30000} value={customDescription} disabled={pending} onChange={event => { setCustomDescription(event.target.value); setNeedsPresetForParameters(false); setError(''); }} placeholder="输入架构说明或 JSON" />
    </label>}

    {needsPresetForParameters && <div className="architecture-editor-confirm" role="status">
      <p>当前文本无法转为参数配置。使用预设替换？</p>
      <button className="action-button" type="button" disabled={pending} onClick={() => { applyTemplate(templateId); setMode('parameters'); }}>使用预设</button>
      <button className="action-button" type="button" disabled={pending} onClick={() => { setNeedsPresetForParameters(false); setError(''); }}>保留原文</button>
    </div>}
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="architecture-editor-footer">
      {mode === 'parameters' && generatedSummary && <p className="task-note">{generatedSummary}</p>}
      <div className="panel-actions"><button className="action-button primary" disabled={pending || (mode === 'parameters' && !!generated.error)}>{pending ? '正在保存…' : '保存'}</button><button className="action-button" type="button" disabled={pending} onClick={onCancel}>取消</button></div>
    </div>
  </form>;
}

function Field({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <label className="architecture-editor-field"><span className="architecture-field-label">{label}</span>
    <input value={value} disabled={disabled} inputMode="numeric" onChange={event => onChange(event.target.value)} />
  </label>;
}
