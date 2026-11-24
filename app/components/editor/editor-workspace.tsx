"use client";

import { useAppStore } from "../../state/store";
import { ItemPickerDialog } from "../item-picker";
import { PreviewView } from "../preview-view";
import { requestLeaveEditor } from "../../hooks/use-shortcuts";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { BaseFilterModule } from "./base-filter-module";
import { RulesModule } from "./rules-module";
import { SeasonModule } from "./season-module";

function EditorDialogs() {
  const dialog = useAppStore((state) => state.editorDialog);
  const setDialog = useAppStore((state) => state.setEditorDialog);
  const busy = useAppStore((state) => state.schemeBusy);
  const saveError = useAppStore((state) => state.saveError);
  const setSaveError = useAppStore((state) => state.setSaveError);
  const newName = useAppStore((state) => state.newName);
  const setNewName = useAppStore((state) => state.setNewName);
  const saveScheme = useAppStore((state) => state.saveScheme);
  const leaveEditor = useAppStore((state) => state.leaveEditor);
  const previewOpen = useAppStore((state) => state.previewOpen);
  const previewBusy = useAppStore((state) => state.previewBusy);
  const previewError = useAppStore((state) => state.previewError);
  const generated = useAppStore((state) => state.generated);
  const closePreview = useAppStore((state) => state.closePreview);

  return (
    <>
      <Dialog
        open={previewOpen}
        onOpenChange={(open) => {
          if (!open) closePreview();
        }}
      >
        <DialogContent className="max-w-5xl">
          <DialogHeader title="预览过滤器" description={generated?.fileName ?? "根据当前方案生成过滤器内容。"} />
          {previewBusy && (
            <p role="status" className="text-sm text-ink-muted">
              正在生成预览…
            </p>
          )}
          {previewError && <Alert tone="ember">{previewError}</Alert>}
          {generated && <PreviewView generated={generated} />}
          <DialogFooter>
            <Button onClick={closePreview}>关闭预览</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={dialog === "saveName"}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDialog(null);
            setSaveError("");
          }
        }}
        busy={busy}
        title="保存新方案"
        description="给这个方案起个名字，之后可以在方案库里重命名。"
        size="sm"
        footer={
          <>
            <Button
              disabled={busy}
              onClick={() => {
                setDialog(null);
                setSaveError("");
              }}
            >
              取消
            </Button>
            <Button variant="primary" type="submit" form="scheme-name" disabled={busy || !newName.trim()}>
              {busy ? "保存中…" : "保存方案"}
            </Button>
          </>
        }
      >
        <form
          id="scheme-name"
          onSubmit={(event) => {
            event.preventDefault();
            if (newName.trim() && !busy) void saveScheme(newName);
          }}
        >
          <Field label="方案名称">
            <Input required maxLength={80} autoFocus value={newName} disabled={busy} onChange={(event) => setNewName(event.target.value)} />
          </Field>
          {saveError && (
            <p role="alert" className="mt-2 text-sm text-ember">
              {saveError}
            </p>
          )}
        </form>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "discard"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="放弃未保存的修改？"
        description="返回方案库后，本次未保存的修改将丢失。"
        size="sm"
        footer={
          <>
            <Button onClick={() => setDialog(null)}>继续编辑</Button>
            <Button variant="danger" onClick={leaveEditor}>
              放弃修改
            </Button>
          </>
        }
      />
    </>
  );
}

/** 编辑器：三个模块自上而下排在一页里，右侧检查器常驻。保存或读取方案期间整体不可操作。 */
export function EditorWorkspace() {
  const schemeBusy = useAppStore((state) => state.schemeBusy);
  return (
    <>
      <fieldset disabled={schemeBusy} aria-busy={schemeBusy || undefined} className="mx-auto flex w-full min-w-0 max-w-[1200px] flex-col gap-4 p-4">
        <SeasonModule />
        <BaseFilterModule />
        <RulesModule />
      </fieldset>
      <EditorDialogs />
      <ItemPickerDialog />
    </>
  );
}
