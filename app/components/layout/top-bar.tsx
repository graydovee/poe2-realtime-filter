"use client";

import Image from "next/image";
import { ArrowLeft, Search } from "lucide-react";

import { requestLeaveEditor } from "../../hooks/use-shortcuts";
import { SERVER_LABELS } from "../../../lib/desktop";
import type { GameServer } from "../../../lib/types";
import { useAppStore } from "../../state/store";
import { DesktopUpdate } from "../desktop-update";
import { Badge, StatusDot } from "../ui/badge";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { SegmentedControl } from "../ui/segmented";
import { Separator } from "../ui/separator";
import { Tooltip } from "../ui/tooltip";
import { InspectorToggleButton } from "./inspector";

const SERVERS = Object.entries(SERVER_LABELS).map(([value, label]) => ({ value: value as GameServer, label }));

/** 服务器属于方案库设置：在方案库里可切换，编辑中只读，避免编辑途中换环境。 */
function ServerControl() {
  const view = useAppStore((state) => state.view);
  const library = useAppStore((state) => state.library);
  const busy = useAppStore((state) => state.managerBusy);
  const profileServer = useAppStore((state) => state.profile.server) ?? "international";
  const selectServer = useAppStore((state) => state.selectServer);

  if (view === "editor") {
    return (
      <Tooltip label="服务器在方案库里切换，编辑中不可更改">
        <Badge tone="muted" className="h-7 px-2 text-xs">
          {SERVER_LABELS[profileServer]}
        </Badge>
      </Tooltip>
    );
  }
  return (
    <SegmentedControl
      ariaLabel="游戏服务器"
      value={library?.server ?? "international"}
      onValueChange={(server) => void selectServer(server)}
      options={SERVERS}
      disabled={busy || !library}
    />
  );
}

function ViewContext() {
  const view = useAppStore((state) => state.view);
  const schemeName = useAppStore((state) => state.schemeName);
  const schemeId = useAppStore((state) => state.schemeId);
  const dirty = useAppStore((state) => state.dirty);

  if (view === "manager") {
    return <h1 className="truncate text-sm font-semibold text-ink">方案库</h1>;
  }
  // 窄窗口里先收起状态徽标，给方案名留出截断空间。
  const badgeClassName = "hidden md:inline-flex";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Button variant="ghost" size="sm" className="-ml-1.5 shrink-0 text-ink-muted" onClick={requestLeaveEditor}>
        <ArrowLeft aria-hidden="true" />
        方案库
      </Button>
      <Separator />
      <span className="min-w-0 truncate text-sm font-semibold text-ink">{schemeName || "未命名方案"}</span>
      {!schemeId ? (
        <Badge tone="muted" className={badgeClassName}>
          <StatusDot tone="muted" />
          新方案
        </Badge>
      ) : dirty ? (
        <Badge tone="gold" className={badgeClassName}>
          <StatusDot tone="gold" />
          未保存
        </Badge>
      ) : (
        <Badge tone="muted" className={badgeClassName}>
          <StatusDot tone="sage" />
          已保存
        </Badge>
      )}
    </div>
  );
}

export function TopBar() {
  const setPaletteOpen = useAppStore((state) => state.setPaletteOpen);
  return (
    <header className="flex h-(--top-bar-height) shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
      <div className="flex shrink-0 items-center gap-2.5">
        <Image src="/brand/poe2-filter.png" alt="" width={26} height={26} className="shrink-0 overflow-hidden rounded-md" unoptimized />
        <span className="hidden font-display text-sm font-semibold tracking-wide text-ink lg:inline">PoE2 Filter</span>
      </div>
      <Separator />
      <ViewContext />
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <ServerControl />
        <Separator />
        <DesktopUpdate />
        <Tooltip label="命令面板">
          <Button
            variant="ghost"
            size="sm"
            className="text-ink-muted"
            aria-label="打开命令面板"
            onClick={() => setPaletteOpen(true)}
          >
            <Search aria-hidden="true" />
            <span className="hidden md:inline">搜索</span>
            <span className="hidden items-center gap-1 lg:flex">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
          </Button>
        </Tooltip>
        <InspectorToggleButton />
        <span className="hidden pr-1 font-mono text-xs text-ink-faint xl:inline">v{process.env.NEXT_PUBLIC_APP_VERSION}</span>
      </div>
    </header>
  );
}
