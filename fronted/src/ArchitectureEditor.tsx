import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ARCHITECTURE_TEMPLATES,
  architectureSummary,
  parseArchitecture,
  serializeArchitecture,
  type ArchitectureFields,
} from './architectureTemplates';
import './ArchitectureEditor.css';

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
  const [selectedTemplateId, setSelectedTemplateId] = useState(draft.templateId);
  const [mode, setMode] = useState<Mode>(draft.mode);
  const [parametersDirty, setParametersDirty] = useState(false);
  const [confirmTemplateId, setConfirmTemplateId] = useState<string | null>(null);
  const [needsPresetForParameters, setNeedsPresetForParameters] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);

  useEffect(() => {
    const next = initialDraft(initial);
    setName(next.name);
    setCustomDescription(next.customDescription);
    setFields(next.fields);
    setTemplateId(next.templateId);
    setSelectedTemplateId(next.templateId);
    setMode(next.mode);
    setParametersDirty(false);
    setConfirmTemplateId(null);
    setNeedsPresetForParameters(false);
    setError('');
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
    setSelectedTemplateId(id);
    setParametersDirty(false);
    setConfirmTemplateId(null);
    setNeedsPresetForParameters(false);
    setError('');
  }

  function requestApplyTemplate() {
    if (parametersDirty) {
      setConfirmTemplateId(selectedTemplateId);
      return;
    }
    applyTemplate(selectedTemplateId);
  }

  function switchMode(nextMode: Mode) {
    if (nextMode === mode) return;
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
      setSelectedTemplateId(parsed.templateId);
      setParametersDirty(false);
      setMode('parameters');
      setError('');
      return;
    }
    setNeedsPresetForParameters(true);
    setError('这段自定义定义不是可识别的参数模板；不会自动覆盖原文。');
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

  return <form className="architecture-editor task-architecture-form" onSubmit={event => void submit(event)} aria-busy={pending}>
    <label className="architecture-editor-field">架构名称
      <input required maxLength={120} value={name} disabled={pending} onChange={event => { setName(event.target.value); setError(''); }} placeholder="例如：1024 × 1024 行列冗余" />
    </label>

    <fieldset className="architecture-editor-mode" disabled={pending}>
      <legend>定义方式</legend>
      <label><input type="radio" name="architecture-mode" checked={mode === 'parameters'} onChange={() => switchMode('parameters')} />参数模板</label>
      <label><input type="radio" name="architecture-mode" checked={mode === 'custom'} onChange={() => switchMode('custom')} />自定义文本</label>
    </fieldset>

    {mode === 'parameters' ? <>
      <section className="architecture-editor-template" aria-label="参数模板">
        <label className="architecture-editor-field">预设模板
          <select value={selectedTemplateId} disabled={pending} onChange={event => { setSelectedTemplateId(event.target.value); setConfirmTemplateId(null); }}>
            {ARCHITECTURE_TEMPLATES.map(template => <option key={template.id} value={template.id}>{template.label}</option>)}
          </select>
        </label>
        <p className="task-note">{ARCHITECTURE_TEMPLATES.find(template => template.id === selectedTemplateId)?.summary}</p>
        <button className="action-button" type="button" disabled={pending} onClick={requestApplyTemplate}>应用此模板</button>
        {confirmTemplateId && <div className="architecture-editor-confirm" role="status">
          <p>应用模板会替换当前已修改的参数。</p>
          <button className="action-button primary" type="button" disabled={pending} onClick={() => applyTemplate(confirmTemplateId)}>确认替换参数</button>
          <button className="action-button" type="button" disabled={pending} onClick={() => setConfirmTemplateId(null)}>保留当前参数</button>
        </div>}
      </section>
      <div className="architecture-editor-fields">
        <Field label="阵列行数（Rows）" value={fields.rows} disabled={pending} onChange={value => changeField('rows', value)} hint="正整数，不含备用行" />
        <Field label="阵列列数（Cols）" value={fields.cols} disabled={pending} onChange={value => changeField('cols', value)} hint="正整数，不含备用列" />
        <label className="architecture-editor-field">坐标起点
          <select value={fields.coordinateBase} disabled={pending} onChange={event => changeField('coordinateBase', event.target.value)}><option value="0">0</option><option value="1">1</option></select>
        </label>
        <Field label="备用行数" value={fields.spareRows} disabled={pending} onChange={value => changeField('spareRows', value)} hint="非负整数" />
        <Field label="列资源组数" value={fields.columnGroups} disabled={pending} onChange={value => changeField('columnGroups', value)} hint="1～256 组；不是连续区域或 bank 数" />
        <Field label="每组备用列" value={fields.spareColsPerGroup} disabled={pending} onChange={value => changeField('spareColsPerGroup', value)} hint="单值表示每组相同；或用逗号按列组逐一填写，不是总数。" />
        <Field label="列分组偏移" value={fields.columnGroupOffset} disabled={pending} onChange={value => changeField('columnGroupOffset', value)} hint="从 0 开始，必须小于列资源组数" />
        <label className="architecture-editor-field architecture-editor-notes">备注（可选）
          <textarea rows={3} maxLength={4000} value={fields.notes} disabled={pending} onChange={event => changeField('notes', event.target.value)} placeholder="例如：备用列在组内共享。" />
        </label>
      </div>
      <p className="task-note">模板参数仅为可修改的示例。每条备用行／列替换完整一行／列；资源按样本独立分配，组间不借用，不含 ECC。列分组按（零基列地址 + 偏移）% 组数计算，不是连续分段。保存架构不会自动运行评估。</p>
      {generatedSummary && <p className="task-note" aria-live="polite">当前参数：{generatedSummary}</p>}
      {generated.error && <p role="alert" className="error-text">{generated.error}</p>}
      {generated.value && <details className="architecture-editor-generated"><summary>生成的架构定义{generatedSummary ? ` · ${generatedSummary}` : ''}</summary><pre>{generated.value}</pre></details>}
    </> : <label className="architecture-editor-field">架构定义
      <textarea required rows={10} maxLength={30000} value={customDescription} disabled={pending} onChange={event => { setCustomDescription(event.target.value); setNeedsPresetForParameters(false); setError(''); }} placeholder="可填写说明或粘贴既有 JSON；切换回参数模板时会先识别，不会静默覆盖。" />
    </label>}

    {needsPresetForParameters && <div className="architecture-editor-confirm" role="status">
      <p>原有定义尚未改动。应用预设并保存后将用模板定义替换它；如需保留原文，请取消切换。</p>
      <button className="action-button primary" type="button" disabled={pending} onClick={() => { applyTemplate(selectedTemplateId); setMode('parameters'); }}>应用预设并进入参数模板</button>
      <button className="action-button" type="button" disabled={pending} onClick={() => { setNeedsPresetForParameters(false); setError(''); }}>保留自定义定义</button>
    </div>}
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="panel-actions"><button className="action-button primary" disabled={pending}>保存架构</button><button className="action-button" type="button" disabled={pending} onClick={onCancel}>取消</button></div>
  </form>;
}

function Field({ label, value, hint, disabled, onChange }: { label: string; value: string; hint: string; disabled: boolean; onChange: (value: string) => void }) {
  return <label className="architecture-editor-field">{label}
    <input value={value} disabled={disabled} inputMode="numeric" onChange={event => onChange(event.target.value)} />
    <small>{hint}</small>
  </label>;
}
