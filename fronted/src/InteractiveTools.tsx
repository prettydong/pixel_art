import { useId, useRef, useState, type FormEvent } from "react";
import type { InteractiveTool, MessageTool, ToolResult } from "./chatTypes";
import "./interactiveTools.css";

type InteractiveToolsProps = {
  tools: MessageTool[];
  disabled?: boolean;
  onSubmit: (result: ToolResult) => void;
};

function ownValue<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function resultSummary(tool: InteractiveTool): string {
  const result = tool.result;
  if (!result || result.type !== tool.type) return "已提交，回答记录不可用。";
  if (tool.type === "single" && result.type === "single") {
    return `已选择：${tool.options.find((option) => option.value === result.value)?.label ?? result.value}`;
  }
  if (tool.type === "multi" && result.type === "multi") {
    return `已选择：${result.value.map((value) => tool.options.find((option) => option.value === value)?.label ?? value).join("、")}`;
  }
  if (result.type === "confirm") return result.value ? "已确认" : "已取消";
  if (tool.type === "form" && result.type === "form") {
    return tool.fields.map((field) => `${field.label}：${ownValue(result.value, field.id) ?? "未填写"}`).join("；");
  }
  return "已提交";
}

function InteractiveToolCard({ tool, disabled, onSubmit }: {
  tool: InteractiveTool;
  disabled: boolean;
  onSubmit: (result: ToolResult) => void;
}) {
  const groupId = useId();
  const submitting = useRef(false);
  const [single, setSingle] = useState("");
  const [multiple, setMultiple] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const locked = disabled || tool.status !== "pending";
  const submittedResult = tool.status === "submitted" ? tool.result : undefined;
  const errorId = `${groupId}-error`;

  function submit(result: ToolResult) {
    if (locked || submitting.current) return;
    submitting.current = true;
    try {
      onSubmit(result);
    } finally {
      // The parent owns accepted submissions; a rejected callback must not lock this card.
      queueMicrotask(() => { submitting.current = false; });
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    if (tool.type === "single") {
      if (!tool.options.some((option) => option.value === single)) {
        setErrors({ selection: "请选择一项后提交。" });
        return;
      }
      setErrors({});
      submit({ toolId: tool.id, type: "single", value: single });
    } else if (tool.type === "multi") {
      const selected = tool.options.filter((option) => multiple.includes(option.value)).map((option) => option.value);
      if (!selected.length) {
        setErrors({ selection: "请至少选择一项后提交。" });
        return;
      }
      setErrors({});
      submit({ toolId: tool.id, type: "multi", value: selected });
    } else if (tool.type === "form") {
      const nextErrors: Record<string, string> = Object.create(null);
      const result: Record<string, string | number> = Object.create(null);
      for (const field of tool.fields) {
        const value = (ownValue(values, field.id) ?? "").trim();
        const control = event.currentTarget.elements.namedItem(field.id);
        if (field.type === "number" && control instanceof HTMLInputElement && control.validity.badInput) {
          nextErrors[field.id] = "请输入有效数字。";
        } else if (!value) {
          if (field.required) nextErrors[field.id] = "此项为必填项。";
        } else if (field.type === "number") {
          const numeric = Number(value);
          if (!Number.isFinite(numeric)) nextErrors[field.id] = "请输入有限的有效数字。";
          else if (field.min !== undefined && numeric < field.min) nextErrors[field.id] = `不能小于 ${field.min}。`;
          else if (field.max !== undefined && numeric > field.max) nextErrors[field.id] = `不能大于 ${field.max}。`;
          else result[field.id] = numeric;
        } else {
          result[field.id] = value;
        }
      }
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length) {
        const firstInvalid = event.currentTarget.elements.namedItem(Object.keys(nextErrors)[0]);
        if (firstInvalid instanceof HTMLInputElement) firstInvalid.focus();
        return;
      }
      submit({ toolId: tool.id, type: "form", value: result });
    }
  }

  return (
    <form className="interactive-tool" onSubmit={handleSubmit} noValidate>
      <fieldset disabled={locked}>
        <legend>{tool.title}</legend>
        {tool.description && <p className="interactive-tool-description">{tool.description}</p>}
        {(tool.type === "single" || tool.type === "multi") && (
          <div className="interactive-tool-options" aria-describedby={errors.selection ? errorId : undefined}>
            {tool.options.map((option, index) => {
              const checked = submittedResult?.type === "single"
                ? submittedResult.value === option.value
                : submittedResult?.type === "multi"
                  ? submittedResult.value.includes(option.value)
                  : tool.type === "single" ? single === option.value : multiple.includes(option.value);
              return (
                <label key={option.value} className="interactive-tool-option" htmlFor={`${groupId}-option-${index}`}>
                  <input
                    id={`${groupId}-option-${index}`}
                    className="interactive-tool-choice"
                    type={tool.type === "single" ? "radio" : "checkbox"}
                    name={groupId}
                    value={option.value}
                    required={tool.type === "single"}
                    checked={checked}
                    aria-invalid={Boolean(errors.selection)}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      if (tool.type === "single") setSingle(option.value);
                      else setMultiple((current) => checked ? [...current, option.value] : current.filter((value) => value !== option.value));
                      setErrors({});
                    }}
                  />
                  <span>{option.label}{option.description && <small>{option.description}</small>}</span>
                </label>
              );
            })}
          </div>
        )}
        {tool.type === "form" && (
          <div className="interactive-tool-fields">
            {tool.fields.map((field, index) => {
              const fieldId = `${groupId}-field-${index}`;
              const hintId = `${fieldId}-hint`;
              const fieldErrorId = `${fieldId}-error`;
              const hasRange = field.type === "number" && (field.min !== undefined || field.max !== undefined);
              const fieldValue = submittedResult?.type === "form" ? ownValue(submittedResult.value, field.id) ?? "" : ownValue(values, field.id) ?? "";
              const fieldError = ownValue(errors, field.id);
              return (
                <div className="interactive-tool-field" key={field.id}>
                  <label htmlFor={fieldId}>{field.label}{field.required ? "（必填）" : "（选填）"}</label>
                  <input
                    id={fieldId}
                    name={field.id}
                    type={field.type}
                    value={fieldValue}
                    required={field.required}
                    min={field.type === "number" ? field.min : undefined}
                    max={field.type === "number" ? field.max : undefined}
                    step={field.type === "number" ? "any" : undefined}
                    aria-invalid={Boolean(fieldError)}
                    aria-describedby={[hasRange ? hintId : "", fieldError ? fieldErrorId : ""].filter(Boolean).join(" ") || undefined}
                    onChange={(event) => {
                      const value = event.target.value;
                      setValues((current) => ({ ...current, [field.id]: value }));
                      setErrors((current) => ({ ...current, [field.id]: "" }));
                    }}
                  />
                  {hasRange && <small id={hintId}>{[field.min !== undefined ? `最小 ${field.min}` : "", field.max !== undefined ? `最大 ${field.max}` : ""].filter(Boolean).join("，")}</small>}
                  {fieldError && <p className="interactive-tool-error" id={fieldErrorId} role="alert">{fieldError}</p>}
                </div>
              );
            })}
          </div>
        )}
        {errors.selection && <p className="interactive-tool-error" id={errorId} role="alert">{errors.selection}</p>}
        {tool.status === "pending" && (
          <div className="interactive-tool-actions">
            {tool.type === "confirm" ? <>
              <button type="button" className="interactive-tool-submit" onClick={() => submit({ toolId: tool.id, type: "confirm", value: true })}>{tool.confirmLabel ?? "确认"}</button>
              <button type="button" onClick={() => submit({ toolId: tool.id, type: "confirm", value: false })}>{tool.cancelLabel ?? "取消"}</button>
            </> : <button type="submit" className="interactive-tool-submit">提交回答</button>}
            {disabled && <span className="interactive-tool-status">等待回复完成后可提交</span>}
          </div>
        )}
        {tool.status === "submitted" && <p className="interactive-tool-result" role="status">{resultSummary(tool)}</p>}
        {tool.status === "expired" && <p className="interactive-tool-status">此工具已失效，无法继续提交。</p>}
      </fieldset>
    </form>
  );
}

export function InteractiveTools({ tools, disabled = false, onSubmit }: InteractiveToolsProps) {
  return (
    <div className="interactive-tools">
      {tools.map((tool) => tool.type === "unavailable" ? (
        <section className="interactive-tool interactive-tool-unavailable" key={tool.id}>
          <h3>{tool.title}</h3>
          <p className="interactive-tool-status">工具格式未知或记录损坏，无法操作。</p>
        </section>
      ) : <InteractiveToolCard key={tool.id} tool={tool} disabled={disabled} onSubmit={onSubmit} />)}
    </div>
  );
}
