"use client";

import { Copy } from "lucide-react";

import { SERVER_LABELS } from "../../../lib/desktop";
import { useAppStore } from "../../state/store";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/dialog";
import { Field } from "../ui/field";
import { Input, Textarea } from "../ui/input";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { toast } from "../ui/toast";

/** 方案库用到的全部对话框：重命名、卸载、删除、导入分享码、导入确认、手动复制分享码。 */
export function SchemeDialogs() {
  const library = useAppStore((state) => state.library);
  const busy = useAppStore((state) => state.managerBusy);
  const error = useAppStore((state) => state.managerError);
  const dialog = useAppStore((state) => state.managerDialog);
  const setDialog = useAppStore((state) => state.setManagerDialog);
  const renameValue = useAppStore((state) => state.renameValue);
  const removeFile = useAppStore((state) => state.removeFile);
  const importOpen = useAppStore((state) => state.importOpen);
  const shareCode = useAppStore((state) => state.shareCode);
  const importName = useAppStore((state) => state.importName);
  const importTarget = useAppStore((state) => state.importTarget);
  const importLeague = useAppStore((state) => state.importLeague);
  const shareOutput = useAppStore((state) => state.shareOutput);
  const patch = useAppStore((state) => state.patchManager);
  const confirm = useAppStore((state) => state.confirmManagerDialog);
  const inspectShare = useAppStore((state) => state.inspectShare);
  const importShare = useAppStore((state) => state.importShare);

  const scheme = dialog?.scheme;
  const closeDialog = () => setDialog(null);
  const closeImport = () => patch({ importOpen: false, managerError: "" });

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareOutput);
      toast.success("分享码已复制");
      patch({ shareOutput: "" });
    } catch {
      toast.error("复制失败，请在文本框里全选后手动复制");
    }
  };

  return (
    <>
      <ConfirmDialog
        open={dialog?.kind === "rename"}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        busy={busy}
        title="重命名方案"
        size="sm"
        footer={
          <>
            <Button disabled={busy} onClick={closeDialog}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="scheme-rename" disabled={busy || !renameValue.trim()}>
              {busy ? "保存中…" : "保存名称"}
            </Button>
          </>
        }
      >
        <form
          id="scheme-rename"
          onSubmit={(event) => {
            event.preventDefault();
            if (renameValue.trim() && !busy) void confirm();
          }}
        >
          <Field label="方案名称">
            <Input required maxLength={80} value={renameValue} disabled={busy} onChange={(event) => patch({ renameValue: event.target.value })} />
          </Field>
          {error && (
            <p role="alert" className="mt-2 text-sm text-ember">
              {error}
            </p>
          )}
        </form>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "uninstall"}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        busy={busy}
        title={`卸载「${scheme?.name ?? ""}」的过滤器？`}
        description="卸载后可在方案列表里重新安装。"
        size="sm"
        footer={
          <>
            <Button disabled={busy} onClick={closeDialog}>
              取消
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
              确认卸载
            </Button>
          </>
        }
      >
        {error && (
          <p role="alert" className="text-sm text-ember">
            {error}
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "remove"}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        busy={busy}
        title={`删除「${scheme?.name ?? ""}」？`}
        description="删除后无法恢复。"
        size="sm"
        footer={
          <>
            <Button disabled={busy} onClick={closeDialog}>
              取消
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
              确认删除
            </Button>
          </>
        }
      >
        {scheme?.installed && (
          <Switch label="同时删除游戏里的过滤器文件" checked={removeFile} disabled={busy} onCheckedChange={(checked) => patch({ removeFile: checked })} />
        )}
        {error && (
          <p role="alert" className="text-sm text-ember">
            {error}
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!open) closeImport();
        }}
        busy={busy}
        title="导入分享码"
        description="粘贴分享码后，会在这里创建一个新的本地方案。"
        footer={
          <>
            <Button disabled={busy} onClick={closeImport}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="scheme-import" disabled={busy || !library || !shareCode.trim()}>
              导入方案
            </Button>
          </>
        }
      >
        <form
          id="scheme-import"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && library && shareCode.trim()) void inspectShare();
          }}
          className="grid gap-4"
        >
          <Field label="分享码">
            <Textarea
              required
              className="min-h-28 font-mono text-xs"
              placeholder="粘贴 POE2F 开头的分享码"
              maxLength={1404096}
              value={shareCode}
              disabled={busy}
              onChange={(event) => patch({ shareCode: event.target.value })}
            />
          </Field>
          <Field label="导入名称" hint="留空则使用分享码里的名称。">
            <Input maxLength={80} value={importName} disabled={busy} onChange={(event) => patch({ importName: event.target.value })} />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-ember">
              {error}
            </p>
          )}
        </form>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(importTarget)}
        onOpenChange={(open) => {
          if (!open) patch({ importTarget: null, managerError: "" });
        }}
        busy={busy}
        title={`导入到${importTarget ? SERVER_LABELS[importTarget.server] : ""}`}
        description={importName.trim() || importTarget?.name}
        size="sm"
        footer={
          <>
            <Button disabled={busy} onClick={() => patch({ importTarget: null, managerError: "" })}>
              取消
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => importTarget && void importShare(importTarget.server, importLeague)}>
              导入方案
            </Button>
          </>
        }
      >
        {importTarget && !importTarget.hasServer && importTarget.catalog.leagues.length > 0 ? (
          <Select
            ariaLabel="导入赛季"
            value={importLeague}
            onValueChange={(value) => patch({ importLeague: value })}
            options={importTarget.catalog.leagues.map(({ id, label }) => ({ value: id, label }))}
          />
        ) : (
          <p className="text-sm text-ink-muted">{importTarget?.league ? `赛季：${importTarget.league}` : "待选赛季"}</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-ember">
            {error}
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(shareOutput)}
        onOpenChange={(open) => {
          if (!open) patch({ shareOutput: "" });
        }}
        title="手动复制分享码"
        description="无法访问剪贴板。请复制下面的分享码发给对方。"
        footer={
          <>
            <Button onClick={() => patch({ shareOutput: "" })}>关闭</Button>
            <Button variant="primary" onClick={() => void copyShare()}>
              <Copy aria-hidden="true" />
              复制
            </Button>
          </>
        }
      >
        <Textarea aria-label="分享码" className="min-h-40 font-mono text-xs" value={shareOutput} readOnly onFocus={(event) => event.currentTarget.select()} />
      </ConfirmDialog>
    </>
  );
}
