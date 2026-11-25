"use client";

import { itemLabel } from "../../../lib/catalog";
import { FILTER_ITEMS_BY_ID } from "../../../lib/data";
import {
  beamColorNames,
  beamColorValues,
  describeIcon,
  hex,
  iconParts,
  rgba,
  rgbaFromHex,
} from "../../../lib/effect-labels";
import type { BaseFilter, RuleEffects } from "../../../lib/types";
import { cn } from "../../../lib/cn";
import { SoundPreviewButton } from "../sound-preview";

export function effectSourceLabel(itemId: string) {
  const item = FILTER_ITEMS_BY_ID.get(itemId);
  return item ? itemLabel(item, "cn") : itemId;
}

/** 没有设置光柱时，预览里用一条暗淡的暖色光表示「沿用基础样式」。 */
const FALLBACK_BEAM = "#8a7a5c";

function MapIcon({ shape, color }: { shape: string; color: string }) {
  return (
    <svg viewBox="0 0 24 24" className="loot-icon" style={{ color }} aria-hidden="true">
      {shape === "Star" ? (
        <path fill="currentColor" d="m12 1 3.1 7.1 7.8.7-5.9 5.1 1.8 7.6L12 17.5 5.2 21.5 7 13.9 1.1 8.8l7.8-.7z" />
      ) : shape === "Circle" ? (
        <circle cx="12" cy="12" r="9" fill="currentColor" />
      ) : (
        <path d="M12 2 22 12 12 22 2 12z" fill="currentColor" />
      )}
    </svg>
  );
}

/** 模拟游戏里的掉落效果：光柱、物品标签和地图图标。 */
export function LootScene({
  effects,
  label,
  compact,
  className,
}: {
  effects: RuleEffects;
  label: string;
  compact?: boolean;
  className?: string;
}) {
  const { color: iconColor, shape } = iconParts(effects.icon);
  const [beamColor] = (effects.beam ?? "").split(" ");
  const beam = beamColorValues[beamColor] ?? "transparent";
  const glow = beam === "transparent" ? FALLBACK_BEAM : beam;
  const font = effects.font ?? {};

  return (
    <div className={cn("loot-scene", className)} style={compact ? { minHeight: "4.5rem" } : undefined}>
      <div className="loot-beam-wrap">
        <span
          aria-hidden="true"
          className="loot-glow"
          style={{ background: `radial-gradient(ellipse at center, ${rgbaFromHex(glow, 0.45)}, transparent 70%)` }}
        />
        <span
          aria-hidden="true"
          className="loot-beam motion-safe:animate-beam-pulse"
          style={{
            color: beam,
            background: `linear-gradient(to top, ${rgbaFromHex(glow, 0.95)} 0%, ${rgbaFromHex(glow, 0.55)} 55%, transparent 92%)`,
          }}
        />
        <span
          className="loot-label"
          style={{
            color: rgba(font.textColor, "#c8c8c8"),
            borderColor: rgba(font.borderColor),
            backgroundColor: rgba(font.backgroundColor, "rgba(0,0,0,.7)"),
            ...(compact ? { fontSize: "0.75rem", padding: "0.1rem 0.6rem" } : {}),
          }}
        >
          {label}
        </span>
      </div>
      {shape && <MapIcon shape={shape} color={beamColorValues[iconColor ?? ""] ?? "#9a9a9a"} />}
    </div>
  );
}

/** 逐项列出光柱、地图图标、字体、音效；没有设置的项说明会沿用什么。 */
export function EffectSummary({ effects, base }: { effects: RuleEffects; base?: BaseFilter }) {
  const defaultStyleLabel = base ? "沿用基础" : "游戏默认";
  const font = effects.font ?? {};
  const rows: Array<[string, string]> = [
    [
      "光柱",
      effects.beam
        ? (beamColorNames[effects.beam.split(" ")[0]] ?? effects.beam) + (effects.beam.endsWith("Temp") ? "（临时）" : "")
        : defaultStyleLabel,
    ],
    ["地图图标", effects.icon ? describeIcon(effects.icon) : defaultStyleLabel],
    ["字体", font.fontSize ? `${font.fontSize} 号${font.textColor ? " · " + hex(font.textColor) : ""}` : defaultStyleLabel],
    [
      "音效",
      effects.sound
        ? effects.sound.type === "builtin"
          ? `内置 ${effects.sound.id} · 音量 ${effects.sound.volume}`
          : effects.sound.fileName
        : defaultStyleLabel,
    ],
  ];
  return (
    <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="min-w-0 text-right text-ink [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
