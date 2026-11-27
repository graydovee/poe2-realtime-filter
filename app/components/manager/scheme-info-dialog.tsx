"use client";

import { useId, useState } from "react";

import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/dialog";
import { Field } from "../ui/field";
import { Input, Textarea } from "../ui/input";

export const SCHEME_DESCRIPTION_MAX = 200;

/**
 * 方案的名称和描述。输入值只在对话框里保存：每次打开时用方案当时的内容初始化，
 * 开着的时候方案库重新加载也不会冲掉正在输入的内容。
 */
export function SchemeInfoDialog({
  open,
  title,
  description,
  initialName,
  initialDescription,
  submitLabel,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description: string;
  initialName: string;
  initialDescription: string;
  submitLabel: string;
  /** 保存成功后返回；抛出的错误显示在对话框里。 */
  onSubmit: (name: string, description: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const formId = useId();
  const [name, setName] = useState(initialName);
  const [text, setText] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  // 开关状态变化的那一次渲染记下当时的值；只在这一次渲染里调整自己的状态。
  if (open !== wasOpen) {
    setWasOpen(open);
    setName(initialName);
    setText(initialDescription);
    setError("");
  }
  const close = () => onOpenChange(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(trimmed, text);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      busy={busy}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button disabled={busy} onClick={close}>
            取消
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={busy || !name.trim()}>
            {busy ? "保存中…" : submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="方案名称" hint="同时是游戏里的过滤器文件名。">
          <Input required maxLength={80} autoFocus value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="描述" hint="可选。显示在方案库的卡片上。">
          <Textarea
            rows={3}
            maxLength={SCHEME_DESCRIPTION_MAX}
            className="min-h-20"
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-ember">
            {error}
          </p>
        )}
      </form>
    </ConfirmDialog>
  );
}
