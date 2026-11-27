"use client";

import { FileArchive, PackagePlus } from "lucide-react";

import { cn } from "../../../lib/cn";
import { SERVER_LABELS, type LocalScheme } from "../../../lib/desktop";
import { useAppStore } from "../../state/store";
import type { BasePlan, PackageImport, SchemePlan } from "../../state/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { ConfirmDialog } from "../ui/dialog";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { SegmentedControl } from "../ui/segmented";
import { Select } from "../ui/select";
import { baseLabel } from "./scheme-meta";

/** 需要用户选一份的基础过滤器。 */
type FilterChoice = Extract<BasePlan, { state: "updateCopy" } | { state: "choose" }>;

function toggle(list: number[], index: number, on: boolean) {
  return on ? [...new Set([...list, index])] : list.filter((value) => value !== index);
}

function customSounds(scheme: LocalScheme) {
  return scheme.profile.rules.flatMap((rule) =>
    rule.effects.sound?.type === "custom" ? [rule.effects.sound.fileName] : [],
  );
}

const card = "min-w-0 rounded-md border border-line bg-surface-2 px-3 py-2";
const note = "text-xs leading-relaxed text-ink-muted";

/** 导出方案包：勾选方案，随时显示将打包的内容。 */
function ExportDialog() {
  const open = useAppStore((state) => state.exportOpen);
  const ids = useAppStore((state) => state.exportIds);
  const title = useAppStore((state) => state.exportTitle);
  const library = useAppStore((state) => state.library);
  const busy = useAppStore((state) => state.managerBusy);
  const error = useAppStore((state) => state.managerError);
  const patch = useAppStore((state) => state.patchManager);
  const exportSelected = useAppStore((state) => state.exportSelected);
  const close = () => patch({ exportOpen: false, managerError: "" });
  const schemes = library?.schemes ?? [];
  const selected = schemes.filter((scheme) => ids.includes(scheme.id));
  // 多个方案可能共用一份过滤器，包里只存一份。
  const bases = new Set(
    selected.flatMap((scheme) => (scheme.profile.baseFilter ? [JSON.stringify(scheme.profile.baseFilter)] : [])),
  ).size;
  const sounds = new Set(selected.flatMap(customSounds)).size;
  const pick = (next: string[]) => patch({ exportIds: next });
  const link =
    "cursor-pointer text-xs text-ink-muted underline underline-offset-4 hover:text-ink disabled:opacity-50";

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      busy={busy}
      title="导出方案包"
      size="lg"
      description="把选中的方案连同它们用到的基础过滤器和音效打成一个压缩包。对方导入后可以直接编辑和安装。"
      footer={
        <>
          <Button disabled={busy} onClick={close}>
            取消
          </Button>
          <Button variant="primary" disabled={busy || !selected.length} onClick={() => void exportSelected()}>
            <FileArchive aria-hidden="true" />
            {busy ? "正在打包…" : "导出"}
          </Button>
        </>
      }
    >
      <div className="min-w-0 space-y-4">
        <Field label="包名称" hint="可选。留空时，单个方案用方案名，多个方案叫「方案包」。">
          <Input
            maxLength={80}
            value={title}
            disabled={busy}
            placeholder="例如：开荒到终局"
            onChange={(event) => patch({ exportTitle: event.target.value })}
          />
        </Field>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-medium text-ink-muted">方案</h4>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={busy || !schemes.length}
                onClick={() => pick(schemes.map((scheme) => scheme.id))}
                className={link}
              >
                全选
              </button>
              <button type="button" disabled={busy || !ids.length} onClick={() => pick([])} className={link}>
                清空
              </button>
            </div>
          </div>
          <ul
            aria-label="要打包的方案"
            className="max-h-[36dvh] space-y-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]"
          >
            {schemes.map((scheme) => {
              const checked = ids.includes(scheme.id);
              return (
                <li key={scheme.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 transition-colors duration-150",
                      checked ? "border-gold/45 bg-gold/6" : "border-line bg-surface-2 hover:border-line-strong",
                    )}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={checked}
                      disabled={busy}
                      onCheckedChange={() =>
                        pick(ids.includes(scheme.id) ? ids.filter((id) => id !== scheme.id) : [...ids, scheme.id])
                      }
                    />
                    <span className="min-w-0 flex-1 basis-0">
                      <span className="block truncate text-sm text-ink">{scheme.name}</span>
                      <span className="block truncate text-xs text-ink-faint">
                        {baseLabel(scheme.profile.baseFilter, scheme.profile.baseFilterHint)} ·{" "}
                        {scheme.profile.rules.length} 条规则
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
        <p role="status" className={note}>
          将打包：{selected.length} 个方案 · {bases} 份基础过滤器 · {sounds} 个音效
        </p>
        {error && (
          <p role="alert" className="text-sm text-ember">
            {error}
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}

type RowProps = {
  state: PackageImport;
  busy: boolean;
  update: (changes: Partial<PackageImport>) => void;
};

/** 包里的一个方案；需要选择的地方就地选择。 */
function SchemeRow({ scheme, state, busy, update }: RowProps & { scheme: SchemePlan }) {
  const index = scheme.index;
  const choice = (value: "skip" | "copy") =>
    update({ skips: toggle(state.skips, index, value === "skip"), copies: toggle(state.copies, index, value === "copy") });
  const skipped = state.skips.includes(index);
  const copied = state.copies.includes(index);

  switch (scheme.state) {
    case "new":
      return (
        <li className={cn(card, "space-y-1.5")}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-ink" title={scheme.name}>
              {scheme.name}
            </span>
            <Badge tone="sage">新导入</Badge>
          </div>
          {scheme.conflict ? (
            <Field label="本机已有同名方案，改用这个名称">
              <Input
                maxLength={80}
                value={state.names[index] ?? ""}
                disabled={busy}
                onChange={(event) => update({ names: { ...state.names, [index]: event.target.value } })}
              />
            </Field>
          ) : (
            <p className="text-xs text-ink-faint">{scheme.rules} 条规则</p>
          )}
        </li>
      );
    case "latest":
      return (
        <li className={cn(card, "flex min-w-0 items-center gap-2")}>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-muted" title={scheme.name}>
            {scheme.name}
          </span>
          <Badge>已是最新</Badge>
        </li>
      );
    case "update":
      return (
        <li className={cn(card, "space-y-1.5")}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-ink" title={scheme.name}>
              {scheme.name}
            </span>
            <Badge tone={skipped || scheme.blocked ? "muted" : "gold"}>
              {copied ? "另存副本" : skipped ? "不改动" : scheme.blocked ? "不能更新" : "有更新"}
            </Badge>
          </div>
          {scheme.localName !== scheme.name && (
            <p className={note}>
              名称：「{scheme.localName}」改为「{scheme.name}」
            </p>
          )}
          {scheme.blocked ? (
            <p className="text-xs leading-relaxed text-ember">
              名称「{scheme.name}」已被本机另一个方案占用，不能更新。
            </p>
          ) : (
            !skipped && <p className="text-xs leading-relaxed text-ink-faint">用包里的内容替换本机的方案。</p>
          )}
          <SegmentedControl
            ariaLabel={`方案「${scheme.name}」的处理方式`}
            disabled={busy}
            value={scheme.blocked ? (copied ? "copy" : "skip") : copied ? "copy" : skipped ? "skip" : "update"}
            onValueChange={(value) => (value === "update" ? update({ skips: toggle(state.skips, index, false), copies: toggle(state.copies, index, false) }) : choice(value))}
            options={
              scheme.blocked
                ? [
                    { value: "skip", label: "跳过" },
                    { value: "copy", label: "另存副本" },
                  ]
                : [
                    { value: "update", label: "更新" },
                    { value: "skip", label: "跳过" },
                    { value: "copy", label: "另存副本" },
                  ]
            }
          />
        </li>
      );
    case "foreign":
      return (
        <li className={cn(card, "space-y-1.5")}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-ink" title={scheme.name}>
              {scheme.name}
            </span>
            <Badge>{copied ? "另存副本" : "不改动"}</Badge>
          </div>
          <p className="text-xs leading-relaxed text-ink-faint">
            本机有同一个方案，它在另一个服务器上。
          </p>
          <SegmentedControl
            ariaLabel={`方案「${scheme.name}」的处理方式`}
            disabled={busy}
            value={copied ? "copy" : "skip"}
            onValueChange={choice}
            options={[
              { value: "skip", label: "跳过" },
              { value: "copy", label: "另存副本" },
            ]}
          />
        </li>
      );
  }
}

/** 包里的基础过滤器和本机的那份内容不同，需要选一份。 */
function BaseRow({ base, state, busy, update }: RowProps & { base: FilterChoice }) {
  const index = base.index;
  if (base.state === "updateCopy") {
    const kept = state.keeps.includes(index);
    return (
      <li className={cn(card, "space-y-1.5")}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-ink" title={base.name}>
            {base.name}
          </span>
          <Badge tone={kept ? "muted" : "gold"}>{kept ? "保留本机" : "有更新"}</Badge>
        </div>
        <p className={note}>本机有一份方案包带来的副本，内容和包里的不同。</p>
        <SegmentedControl
          ariaLabel={`基础过滤器「${base.name}」的副本`}
          disabled={busy}
          value={kept ? "keep" : "update"}
          onValueChange={(value) => update({ keeps: toggle(state.keeps, index, value === "keep") })}
          options={[
            { value: "update", label: "更新副本" },
            { value: "keep", label: "保留本机的" },
          ]}
        />
      </li>
    );
  }
  const copied = state.baseCopies.includes(index);
  return (
    <li className={cn(card, "space-y-1.5")}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-ink" title={base.name}>
          {base.name}
        </span>
        <Badge tone={copied ? "muted" : "gold"}>{copied ? "用包里的" : "用本机的"}</Badge>
      </div>
      <p className={note}>本机有同名的{base.source}，内容和包里的不同。</p>
      <SegmentedControl
        ariaLabel={`基础过滤器「${base.name}」用哪一份`}
        disabled={busy}
        value={copied ? "copy" : "local"}
        onValueChange={(value) => update({ baseCopies: toggle(state.baseCopies, index, value === "copy") })}
        options={[
          { value: "local", label: "用本机的" },
          { value: "copy", label: "用包里的" },
        ]}
      />
      <p className="text-xs leading-relaxed text-ink-faint">
        {copied ? "从包里另存一份副本，它不会自动更新。" : "方案使用本机的那一份，它照常更新。"}
      </p>
    </li>
  );
}

/** 导入方案包的确认：列出每个方案的去向，需要选择的地方就地选择。 */
function ImportDialog() {
  const state = useAppStore((current) => current.packageImport);
  const busy = useAppStore((current) => current.managerBusy);
  const error = useAppStore((current) => current.managerError);
  const patch = useAppStore((current) => current.patchManager);
  const importPackage = useAppStore((current) => current.importPackage);
  const close = () => patch({ packageImport: null, managerError: "" });
  const update = (changes: Partial<PackageImport>) =>
    state && patch({ packageImport: { ...state, ...changes } });
  const plan = state?.plan;

  let added = 0;
  let updated = 0;
  let pending = 0;
  let latest = 0;
  for (const scheme of plan?.schemes ?? []) {
    if (scheme.state === "new") added += 1;
    else if (scheme.state === "latest") latest += 1;
    else if (scheme.state === "update" && !scheme.blocked) updated += 1;
    else pending += 1;
  }
  const summary = [
    added ? `导入 ${added} 个新方案` : "",
    updated ? `更新 ${updated} 个方案` : "",
    pending ? `${pending} 个需要你决定` : "",
    latest ? `${latest} 个已是最新` : "",
  ].filter(Boolean);
  const choices =
    plan?.bases.filter((base): base is FilterChoice => base.state === "updateCopy" || base.state === "choose") ?? [];

  return (
    <ConfirmDialog
      open={Boolean(state)}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      busy={busy}
      size="lg"
      title={state?.title ? `导入方案包「${state.title}」` : "导入方案包"}
      description={summary.length ? `${summary.join("，")}。` : "包里没有方案。"}
      footer={
        <>
          <Button disabled={busy} onClick={close}>
            取消
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void importPackage()}>
            <PackagePlus aria-hidden="true" />
            {busy ? "正在导入…" : "导入"}
          </Button>
        </>
      }
    >
      {state && plan && (
        <div className="min-w-0 space-y-4">
          {plan.server !== state.current && (
            <p className="text-sm leading-relaxed text-ink-muted">
              将导入到{SERVER_LABELS[plan.server]}，导入后切换到这个服务器。
            </p>
          )}
          {plan.needsLeague && (
            <Field label="导入赛季" hint="包里的赛季在本机已经不存在，这些方案改为所选的赛季。">
              <Select
                ariaLabel="导入赛季"
                value={state.league}
                onValueChange={(league) => update({ league })}
                options={state.catalog.leagues.map(({ id, label }) => ({ value: id, label }))}
              />
            </Field>
          )}
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-ink-muted">方案</h4>
            <ul
              aria-label="包里的方案"
              className="max-h-[40dvh] space-y-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]"
            >
              {plan.schemes.map((scheme) => (
                <SchemeRow key={scheme.index} scheme={scheme} state={state} busy={busy} update={update} />
              ))}
            </ul>
          </div>
          {choices.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-ink-muted">基础过滤器</h4>
              <ul aria-label="需要选择的基础过滤器" className="space-y-1">
                {choices.map((base) => (
                  <BaseRow key={base.index} base={base} state={state} busy={busy} update={update} />
                ))}
              </ul>
            </div>
          )}
          {plan.sounds > 0 && <p className={note}>另含 {plan.sounds} 个自定义音效。</p>}
          {error && (
            <p role="alert" className="text-sm text-ember">
              {error}
            </p>
          )}
        </div>
      )}
    </ConfirmDialog>
  );
}

/** 方案库里和方案包有关的对话框。 */
export function PackageDialogs() {
  return (
    <>
      <ExportDialog />
      <ImportDialog />
    </>
  );
}
