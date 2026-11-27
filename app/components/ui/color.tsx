"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { ChevronDown } from "lucide-react";

import { cn } from "../../../lib/cn";
import {
  cssColor,
  formatFilterColor,
  hexToRgb,
  hsvToRgb,
  parseFilterColor,
  rgbToHex,
  rgbToHsv,
  type FilterColor,
  type Hsva,
  type NamedColor,
} from "../../../lib/color";
import { beamColors } from "../../../lib/effect-labels";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { selectTriggerClass } from "./select";
import { Tooltip } from "./tooltip";

/** 棋盘格背景，半透明的颜色叠在上面能看出透明度。 */
const CHECKER = "repeating-conic-gradient(rgb(var(--color-line)) 0% 25%, transparent 0% 50%)";
const CHECKER_SIZE = "8px 8px";
const WHITE: FilterColor = { r: 255, g: 255, b: 255, a: 255, hasAlpha: false };
/** 取色器里的预设颜色：光柱的 11 种颜色，加上黑色。 */
const PRESETS: NamedColor[] = [...beamColors, { name: "Black", label: "黑色", value: "#000000" }];
const clamp = (value: number) => Math.min(1, Math.max(0, value));

const thumbClass =
  "block size-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.6)] outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-gold-bright";

/** 一小块颜色；半透明的部分露出底下的棋盘格。 */
export function ColorChip({ color, className }: { color?: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block bg-surface-3", className)}
      style={{
        backgroundImage: color ? `linear-gradient(${color}, ${color}), ${CHECKER}` : CHECKER,
        backgroundSize: color ? `100% 100%, ${CHECKER_SIZE}` : CHECKER_SIZE,
      }}
    />
  );
}

function PaletteCell({
  index,
  color,
  label,
  selected,
  onClick,
  cellRef,
}: {
  index: number;
  color?: string;
  label: string;
  selected: boolean;
  onClick: () => void;
  cellRef: (node: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={cellRef}
      type="button"
      data-index={index}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex min-w-14 cursor-pointer flex-col items-center gap-1 rounded-sm p-1.5 text-xs text-ink outline-none transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-gold-bright",
        selected && "text-gold-bright",
      )}
    >
      <span
        className={cn(
          "grid size-6 place-items-center rounded-sm border bg-surface-3 transition-shadow duration-150",
          color ? "border-line-strong/60" : "border-dashed border-line-strong",
          selected && "border-gold ring-2 ring-gold ring-offset-2 ring-offset-surface-2",
        )}
      >
        <ColorChip color={color} className="size-full rounded-[2px]" />
      </span>
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

/** 固定颜色的调色盘：每格一种颜色，下面标着名字，方向键在格子间移动。 */
export function ColorPalette({
  colors,
  isSelected,
  onPick,
  noneLabel,
  noneSelected,
  className,
}: {
  colors: NamedColor[];
  isSelected: (color: NamedColor) => boolean;
  onPick: (color: NamedColor | null) => void;
  /** 第一格是「不设置」时显示的文字。 */
  noneLabel?: string;
  noneSelected?: boolean;
  className?: string;
}) {
  const cells = useRef<Array<HTMLButtonElement | null>>([]);
  const items = [
    ...(noneLabel ? [{ color: undefined, label: noneLabel, selected: Boolean(noneSelected), pick: () => onPick(null) }] : []),
    ...colors.map((color) => ({ color: color.value, label: color.label, selected: isSelected(color), pick: () => onPick(color) })),
  ];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = Number((event.target as HTMLElement).dataset.index);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 4 : event.key === "ArrowUp" ? -4 : undefined;
    const last = items.length - 1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? last : step === undefined ? undefined : index + step;
    if (next === undefined) return;
    event.preventDefault();
    cells.current[Math.max(0, Math.min(next, last))]?.focus();
  };
  return (
    <div role="group" className={cn("grid grid-cols-4 gap-1", className)} onKeyDown={onKeyDown}>
      {items.map((item, index) => (
        <PaletteCell
          key={index}
          index={index}
          color={item.color}
          label={item.label}
          selected={item.selected}
          onClick={item.pick}
          cellRef={(node) => {
            cells.current[index] = node;
          }}
        />
      ))}
    </div>
  );
}

/** 从一组固定颜色里选一种：按钮显示当前颜色，点开是调色盘。`value` 是颜色的名字，空串表示没有选。 */
export function ColorPaletteSelect({
  value,
  onValueChange,
  colors,
  ariaLabel,
  placeholder,
  noneLabel,
  disabled,
  className,
}: {
  value: string;
  onValueChange: (name: string) => void;
  colors: NamedColor[];
  ariaLabel: string;
  placeholder: string;
  noneLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = colors.find((color) => color.name === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={ariaLabel} disabled={disabled} className={cn(selectTriggerClass, className)}>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="grid size-4 shrink-0 place-items-center rounded-[3px] border border-line-strong/60 bg-surface-3 p-px">
              <ColorChip color={current?.value} className="size-full rounded-[2px]" />
            </span>
            <span className={cn("truncate", !current && !value && "text-ink-faint")}>{current ? current.label : value || placeholder}</span>
          </span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-1.5">
        <ColorPalette
          colors={colors}
          noneLabel={noneLabel}
          noneSelected={!value}
          isSelected={(color) => color.name === value}
          onPick={(color) => {
            onValueChange(color?.name ?? "");
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** 取色器的按钮：显示当前颜色，点开是自由取色器。`value` 是过滤器里的 `R G B (A)`。 */
export function ColorPicker({
  value,
  onValueChange,
  ariaLabel,
  tooltip,
  disabled,
}: {
  value?: string;
  onValueChange: (value: string) => void;
  ariaLabel: string;
  /** 悬停时显示的说明。 */
  tooltip: string;
  disabled?: boolean;
}) {
  const color = parseFilterColor(value);
  return (
    <Popover>
      <Tooltip label={tooltip}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={ariaLabel}
            disabled={disabled}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border border-line-strong bg-surface-2 p-1 transition-colors duration-150 hover:border-gold/50 hover:bg-surface-3 focus:border-gold focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:border-dashed disabled:border-line"
          >
            <ColorChip color={color && cssColor(color)} className="size-full rounded-[3px]" />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" aria-label={ariaLabel} className="w-64">
        <ColorPickerPanel initial={color} onChange={onValueChange} />
      </PopoverContent>
    </Popover>
  );
}

/** 自由取色：在色面上选饱和度和明度，用滑块调色相和透明度，也可以直接点预设颜色。改动即时生效。 */
function ColorPickerPanel({ initial, onChange }: { initial?: FilterColor; onChange: (value: string) => void }) {
  const [hsva, setHsva] = useState<Hsva>(() => ({ ...rgbToHsv(initial ?? WHITE), a: (initial?.a ?? 255) / 255 }));
  const latest = useRef(hsva);
  const area = useRef<HTMLDivElement>(null);
  const hasAlpha = initial?.hasAlpha ?? false;
  const rgb = hsvToRgb(hsva);
  const alpha = Math.round(hsva.a * 255);
  const solid = `rgb(${rgb.r} ${rgb.g} ${rgb.b})`;

  const update = (patch: Partial<Hsva>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setHsva(next);
    onChange(formatFilterColor({ ...hsvToRgb(next), a: Math.round(next.a * 255), hasAlpha }));
  };
  const pickArea = (x: number, y: number) => {
    const rect = area.current?.getBoundingClientRect();
    if (rect?.width && rect.height) update({ s: clamp((x - rect.left) / rect.width), v: clamp(1 - (y - rect.top) / rect.height) });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div
        ref={area}
        role="slider"
        tabIndex={0}
        aria-label="饱和度和明度"
        aria-valuenow={Math.round(hsva.v * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${rgb.r} ${rgb.g} ${rgb.b}`}
        className="relative h-32 touch-none rounded-md border border-line-strong/60 focus-visible:outline-offset-0"
        style={{ background: `linear-gradient(to top, #000, rgb(0 0 0 / 0)), linear-gradient(to right, #fff, hsl(${hsva.h} 100% 50%))` }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pickArea(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) pickArea(event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.1 : 0.02;
          const patch =
            event.key === "ArrowLeft" ? { s: latest.current.s - step }
            : event.key === "ArrowRight" ? { s: latest.current.s + step }
            : event.key === "ArrowUp" ? { v: latest.current.v + step }
            : event.key === "ArrowDown" ? { v: latest.current.v - step }
            : undefined;
          if (!patch) return;
          event.preventDefault();
          update({ s: clamp(patch.s ?? latest.current.s), v: clamp(patch.v ?? latest.current.v) });
        }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.6)]"
          style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%` }}
        />
      </div>
      <SliderRow label="色相" value={Math.round(hsva.h)}>
        <SliderPrimitive.Root
          min={0}
          max={360}
          step={1}
          value={[hsva.h]}
          onValueChange={([h]) => update({ h })}
          className="relative flex h-4 w-full touch-none select-none items-center"
        >
          <SliderPrimitive.Track
            className="relative h-3 w-full grow overflow-hidden rounded-full"
            style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
          >
            <SliderPrimitive.Range className="absolute h-full" />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb aria-label="色相" className={thumbClass} style={{ background: `hsl(${hsva.h} 100% 50%)` }} />
        </SliderPrimitive.Root>
      </SliderRow>
      <SliderRow label="透明度" value={alpha}>
        <SliderPrimitive.Root
          min={0}
          max={255}
          step={1}
          value={[alpha]}
          onValueChange={([next]) => update({ a: next / 255 })}
          className="relative flex h-4 w-full touch-none select-none items-center"
        >
          <SliderPrimitive.Track
            className="relative h-3 w-full grow overflow-hidden rounded-full"
            style={{ backgroundImage: `linear-gradient(rgb(${rgb.r} ${rgb.g} ${rgb.b} / 0), ${solid}), ${CHECKER}`, backgroundSize: `100% 100%, ${CHECKER_SIZE}` }}
          >
            <SliderPrimitive.Range className="absolute h-full" />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb
            aria-label="透明度"
            className={thumbClass}
            style={{
              backgroundImage: `linear-gradient(${cssColor({ ...rgb, a: alpha })}, ${cssColor({ ...rgb, a: alpha })}), ${CHECKER}`,
              backgroundSize: `100% 100%, ${CHECKER_SIZE}`,
            }}
          />
        </SliderPrimitive.Root>
      </SliderRow>
      <div className="text-xs text-ink-muted">预设</div>
      <ColorPalette
        colors={PRESETS}
        isSelected={(color) => color.value === rgbToHex(rgb)}
        onPick={(color) => {
          if (color) update({ ...rgbToHsv(hexToRgb(color.value) ?? WHITE), a: 1 });
        }}
      />
    </div>
  );
}

function SliderRow({ label, value, children }: { label: string; value: number; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-xs text-ink-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
      <span className="w-8 shrink-0 text-right font-mono text-xs text-ink-muted">{value}</span>
    </div>
  );
}
