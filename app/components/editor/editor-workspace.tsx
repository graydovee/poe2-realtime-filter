"use client";

import { useAppStore } from "../../state/store";
import { ItemPickerDialog } from "../item-picker";
import { PreviewView } from "../preview-view";
import { requestLeaveEditor } from "../../hooks/use-shortcuts";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { SchemeInfoDialog } from "../manager/scheme-info-dialog";
import { BaseFilterModule } from "./base-filter-module";
import { RulesModule } from "./rules-module";
import { SeasonModule } from "./season-module";

function EditorDialogs() {
  const dialog = useAppStore((state) => state.editorDialog);
  const setDialog = useAppStore((state) => state.setEditorDialog);
  const schemeId = useAppStore((state) => state.schemeId);
  const schemeName = useAppStore((state) => state.schemeName);
  const schemeDescription = useAppStore((state) => state.schemeDescription);
  const saveScheme = useAppStore((state) => state.saveScheme);
  const updateSchemeInfo = useAppStore((state) => state.updateSchemeInfo);
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

      <SchemeInfoDialog
        open={dialog === "saveName"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="保存新方案"
        description="方案名同时是游戏里的过滤器文件名。名称和描述之后可以修改。"
        initialName=""
        initialDescription=""
        submitLabel="保存方案"
        onSubmit={saveScheme}
      />

      <SchemeInfoDialog
        open={dialog === "nameDescription"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="名称和描述"
        description="方案名同时是游戏里的过滤器文件名。保存后立即生效，不影响还没保存的规则。"
        initialName={schemeName}
        initialDescription={schemeDescription}
        submitLabel="保存"
        onSubmit={(name, description) => (schemeId ? updateSchemeInfo(schemeId, name, description) : Promise.resolve())}
      />

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
