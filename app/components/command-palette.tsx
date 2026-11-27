"use client";

import { Command } from "cmdk";
import {
  ArrowLeft,
  ClipboardPaste,
  Eye,
  FileArchive,
  FilePen,
  Layers,
  ListX,
  PackagePlus,
  PackageSearch,
  PanelRight,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { scrollToModule } from "../hooks/navigation";
import { requestLeaveEditor } from "../hooks/use-shortcuts";
import { inspectorShownForViewport, toggleInspectorForViewport, useAppStore } from "../state/store";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Kbd } from "./ui/kbd";

type CommandEntry = {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  keywords?: string;
  shortcut?: string[];
  run: () => void;
};

/** Ctrl+K 命令面板：按当前视图列出可执行的操作，也能搜索规则和方案。 */
export function CommandPalette() {
  const open = useAppStore((state) => state.paletteOpen);
  const setOpen = useAppStore((state) => state.setPaletteOpen);

  // 命令列表很轻，每次渲染按 store 当前的快照直接生成；面板打开期间是模态的，数据不会变。
  function buildGroups() {
    const state = useAppStore.getState();
    const commands: CommandEntry[] = [
      {
        id: "inspector",
        label: inspectorShownForViewport() ? "收起检查器" : "展开检查器",
        group: "界面",
        icon: PanelRight,
        shortcut: ["Ctrl", "\\"],
        run: toggleInspectorForViewport,
      },
      {
        id: "update",
        label: "检查更新",
        group: "界面",
        icon: RefreshCw,
        run: () => window.dispatchEvent(new Event("poe2:check-update")),
      },
    ];
    if (state.view === "manager") {
      const library = state.library;
      commands.push(
        {
          id: "import",
          label: "导入分享码",
          group: "方案",
          icon: ClipboardPaste,
          run: () => state.patchManager({ importOpen: true }),
        },
        {
          id: "import-package",
          label: "导入方案包",
          group: "方案",
          icon: PackagePlus,
          run: () => void state.pickPackage(),
        },
        {
          id: "export-package",
          label: "导出方案包",
          group: "方案",
          icon: FileArchive,
          run: () => state.openExport(),
        },
      );
      if (library) {
        commands.push({
          id: "new",
          label: "新建方案",
          group: "方案",
          icon: Plus,
          run: () => void state.openDraft(null, library.server),
        });
        for (const league of new Set(library.schemes.map((scheme) => scheme.profile.league))) {
          commands.push({
            id: `refresh-${league}`,
            label: `刷新行情：${league || "待选赛季"}`,
            group: "行情",
            icon: RefreshCw,
            run: () => void state.refreshLeagueMarket(league),
          });
        }
        for (const scheme of library.schemes) {
          commands.push({
            id: `open-${scheme.id}`,
            label: `打开方案：${scheme.name}`,
            group: "打开方案",
            keywords: scheme.profile.league,
            icon: FilePen,
            run: () => void state.openDraft(scheme, library.server),
          });
        }
      }
    } else {
      commands.push(
        { id: "save", label: "保存方案", group: "方案", icon: Save, shortcut: ["Ctrl", "S"], run: state.requestSave },
        {
          id: "preview",
          label: "生成预览",
          group: "方案",
          icon: Eye,
          shortcut: ["Ctrl", "Enter"],
          run: () => void state.generate(),
        },
        { id: "back", label: "返回方案库", group: "方案", icon: ArrowLeft, shortcut: ["Alt", "←"], run: requestLeaveEditor },
        {
          id: "base-filter",
          label: state.baseFilterOpen ? "收起基础过滤器" : "展开基础过滤器",
          group: "编辑",
          icon: Layers,
          run: () => {
            state.setBaseFilterOpen(true);
            scrollToModule("base");
          },
        },
        { id: "skipped", label: "编辑跳过物品", group: "编辑", icon: ListX, run: () => state.openPicker("skipped") },
        {
          id: "add-rule",
          label: "新增规则",
          group: "规则",
          icon: Plus,
          run: () => {
            state.addRule();
            scrollToModule("rules");
          },
        },
      );
      if (state.activeRuleId) {
        commands.push(
          { id: "pick-items", label: "为当前规则选择物品", group: "规则", icon: PackageSearch, run: () => state.openPicker("rule") },
          { id: "pick-preset", label: "为当前规则选择特效预设", group: "规则", icon: Sparkles, run: () => state.setPresetGalleryOpen(true) },
        );
      }
      for (const rule of state.profile.rules) {
        commands.push({
          id: `goto-${rule.id}`,
          label: `跳转到规则：${rule.name}`,
          group: "跳转到规则",
          keywords: [rule.enabled ? "启用" : "停用", rule.hidden ? "隐藏" : "显示"].join(" "),
          icon: Sparkles,
          run: () => {
            state.setActiveRuleId(rule.id);
            scrollToModule("rules");
          },
        });
      }
    }
    const grouped = new Map<string, CommandEntry[]>();
    for (const command of commands) {
      const list = grouped.get(command.group);
      if (list) list.push(command);
      else grouped.set(command.group, [command]);
    }
    return [...grouped];
  }

  const groups = buildGroups();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent hideClose className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">命令面板</DialogTitle>
        <DialogDescription className="sr-only">搜索并执行命令，或跳转到规则和方案。</DialogDescription>
        <Command loop label="命令面板" className="flex flex-col overflow-hidden bg-surface-2 text-ink">
          <div className="flex h-12 items-center gap-2.5 border-b border-line px-4">
            <Search aria-hidden="true" className="size-4 shrink-0 text-ink-faint" />
            <Command.Input
              autoFocus
              className="h-full w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-faint"
              placeholder="输入命令，或搜索规则和方案"
            />
          </div>
          <Command.List className="max-h-80 overflow-y-auto overscroll-contain p-2">
            <Command.Empty className="py-8 text-center text-sm text-ink-muted">没有匹配的命令</Command.Empty>
            {groups.map(([group, items]) => (
              <Command.Group
                key={group}
                heading={group}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-faint"
              >
                {items.map((entry) => (
                  <Command.Item
                    key={entry.id}
                    value={`${entry.label} ${entry.keywords ?? ""}`}
                    onSelect={() => {
                      setOpen(false);
                      entry.run();
                    }}
                    className="group flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2 text-sm text-ink data-[selected=true]:bg-surface-3 data-[selected=true]:text-gold-bright"
                  >
                    <entry.icon aria-hidden="true" className="size-4 shrink-0 text-ink-muted group-data-[selected=true]:text-gold" />
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    {entry.shortcut && (
                      <span className="flex shrink-0 items-center gap-1">
                        {entry.shortcut.map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </span>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
