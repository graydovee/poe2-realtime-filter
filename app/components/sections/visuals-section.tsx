"use client";

import type { VisualOverrides } from "../../../lib/types";
import { Slider, Switch } from "../ui/controls";
import { Panel } from "../ui/primitives";

export function VisualsSection({
  visuals,
  itemLevelMin,
  areaLevelMin,
  onItemLevelMin,
  onAreaLevelMin,
  onFontSize,
  onShowBeams,
  onShowMinimapIcons,
}: {
  visuals: VisualOverrides;
  itemLevelMin: number;
  areaLevelMin: number;
  onItemLevelMin: (value: number) => void;
  onAreaLevelMin: (value: number) => void;
  onFontSize: (value: number) => void;
  onShowBeams: (value: boolean) => void;
  onShowMinimapIcons: (value: boolean) => void;
}) {
  return (
    <Panel step="04" title="等级与基础视觉" description="设置等级条件、字体大小和显示效果。">
      <div className="grid gap-5 sm:grid-cols-3">
        <Slider label="物品等级下限" value={itemLevelMin} min={1} max={86} onValueChange={onItemLevelMin} ariaLabel="物品等级下限" />
        <Slider label="区域等级下限" value={areaLevelMin} min={1} max={86} onValueChange={onAreaLevelMin} ariaLabel="区域等级下限" />
        <Slider label="字体大小" value={visuals.fontSize} min={18} max={48} onValueChange={onFontSize} ariaLabel="字体大小" />
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-line/70 pt-5">
        <Switch checked={visuals.showBeams} onCheckedChange={onShowBeams} label="掉落光束" />
        <Switch checked={visuals.showMinimapIcons} onCheckedChange={onShowMinimapIcons} label="小地图图标" />
      </div>
    </Panel>
  );
}
