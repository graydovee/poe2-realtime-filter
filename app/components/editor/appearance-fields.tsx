"use client";

import { useRef, type ReactNode } from "react";
import { RotateCcw, Upload } from "lucide-react";

import {
  beamColors,
  beamColorValues,
  iconParts,
  isMapIconShape,
  mapIconShapeNames,
  mapIconShapes,
  mapIconSizes,
  withIconPart,
} from "../../../lib/effect-labels";
import type { PresetSound } from "../../../lib/types";
import { cn } from "../../../lib/cn";
import { buttonVariants, IconButton } from "../ui/button";
import { ColorPaletteSelect, ColorPicker } from "../ui/color";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { Tooltip } from "../ui/tooltip";
import { MapIconGlyph } from "./appearance-preview";

const NONE = "__none";
const PICK_FILE = "__pick";
const CUSTOM_PREFIX = "custom:";

type FieldProps = {
  /** 规则名，拼进控件的标签里，让每个标签在界面里唯一。 */
  ruleName: string;
  /** 没设置时沿用的样式：沿用基础，或游戏默认。 */
  defaultLabel?: string;
  /** 改基础规则时给出：这一项没写时显示基础规则现在的值，列表里「不设置」的选项写「沿用基础规则」。 */
  inherited?: string;
  /** 给出时这一项写了值，控件旁出现恢复它的按钮。 */
  onReset?: () => void;
  /** 只读时禁用这一项的全部控件。 */
  disabled?: boolean;
};

/** 写了值的一项旁边的「恢复」按钮，回到基础规则的值。 */
function ResetButton({ name, onClick }: { name: string; onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <IconButton label={`恢复基础规则的${name}`} size="icon-sm" onClick={onClick}>
      <RotateCcw aria-hidden="true" className="size-3.5" />
    </IconButton>
  );
}

/** 光柱：从固定颜色里选一种，可以设成只在掉落时短暂显示。 */
export function BeamField({
  ruleName,
  value,
  defaultLabel,
  inherited,
  onReset,
  disabled,
  onChange,
}: FieldProps & { value?: string; onChange: (value?: string) => void }) {
  const [color = "", modifier = ""] = (value ?? "").split(" ");
  const compose = (next: string, temporary: boolean) => (next ? next + (temporary ? " Temp" : "") : undefined);
  return (
    <Field label="光柱">
      <div className="flex gap-2">
        <ColorPaletteSelect
          className="min-w-0 flex-1"
          ariaLabel={`${ruleName} 光柱`}
          value={color}
          onValueChange={(next) => onChange(compose(next, modifier === "Temp"))}
          colors={beamColors}
          placeholder={inherited ?? defaultLabel ?? ""}
          noneLabel={inherited ? "沿用基础规则" : defaultLabel}
          disabled={disabled}
        />
        <Tooltip label="物品掉落时光柱只短暂显示">
          <div>
            <Switch
              checked={modifier === "Temp"}
              onCheckedChange={(temporary) => onChange(compose(color, temporary))}
              label="临时"
              disabled={disabled || !color}
            />
          </div>
        </Tooltip>
        <ResetButton name="光柱" onClick={onReset} />
      </div>
    </Field>
  );
}

/** RGB 颜色：文本框里填 `R G B (A)`，旁边的色块点开是取色器。 */
export function RgbColorField({
  ruleName,
  label,
  value,
  defaultLabel,
  inherited,
  onReset,
  disabled,
  onChange,
}: FieldProps & { label: string; value?: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <Input
          aria-label={`${ruleName} ${label}`}
          placeholder={`R G B (A)，${inherited ?? defaultLabel ?? ""}`}
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <ColorPicker
          ariaLabel={`${ruleName} ${label}调色盘`}
          tooltip={`${label}调色盘`}
          value={value}
          onValueChange={onChange}
          disabled={disabled}
        />
        <ResetButton name={label} onClick={onReset} />
      </div>
    </Field>
  );
}

/** 字号：18–45。 */
export function FontSizeField({
  ruleName,
  value,
  defaultLabel,
  inherited,
  onReset,
  disabled,
  onChange,
}: FieldProps & { value?: number; onChange: (value?: number) => void }) {
  return (
    <Field label="字号" hint="18–45">
      <div className="flex gap-2">
        <Input
          type="number"
          min={1}
          max={45}
          aria-label={`${ruleName} 字号`}
          placeholder={inherited ?? defaultLabel}
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
        />
        <ResetButton name="字号" onClick={onReset} />
      </div>
    </Field>
  );
}

/** 地图图标：形状、颜色、尺寸三项，选了形状才有图标。 */
export function MapIconField({
  ruleName,
  value,
  beamColor,
  defaultLabel,
  inherited,
  onReset,
  disabled,
  className,
  onChange,
}: FieldProps & {
  value?: string;
  /** 新选形状时，颜色默认跟光柱一致。 */
  beamColor?: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const { size, color, shape } = iconParts(value);
  const defaults = { size: "1", color: beamColor ?? "Red", shape: "Star" };
  const edit = (part: "size" | "color" | "shape", next: string) => onChange(withIconPart(value, part, next, defaults));
  const glyphColor = beamColorValues[color ?? ""] ?? "#9a9a9a";
  const shapeOptions = [
    { value: NONE, label: inherited ? "沿用基础规则" : defaultLabel ?? "" },
    ...(shape && !isMapIconShape(shape) ? [{ value: shape, label: shape }] : []),
    ...mapIconShapes.map((name) => ({
      value: name,
      label: (
        <span className="inline-flex items-center gap-1.5">
          <MapIconGlyph shape={name} color={glyphColor} className="size-4 shrink-0" />
          {mapIconShapeNames[name]}
        </span>
      ),
    })),
  ];
  const sizeOptions = size && !mapIconSizes.some((option) => option.value === size) ? [{ value: size, label: size }, ...mapIconSizes] : mapIconSizes;

  return (
    <Field
      label={
        <span className="flex min-w-0 items-center justify-between gap-2">
          地图图标
          <ResetButton name="地图图标" onClick={onReset} />
        </span>
      }
      hint={inherited}
      className={className}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-x-3 gap-y-1.5">
        <Field label="形状">
          <Select
            ariaLabel={`${ruleName} 地图图标形状`}
            value={shape ?? NONE}
            onValueChange={(next) => edit("shape", next === NONE ? "" : next)}
            options={shapeOptions}
            disabled={disabled}
          />
        </Field>
        <Field label="颜色">
          <ColorPaletteSelect
            ariaLabel={`${ruleName} 地图图标颜色`}
            value={color ?? ""}
            onValueChange={(next) => edit("color", next)}
            colors={beamColors}
            placeholder="先选形状"
            disabled={disabled || !shape}
          />
        </Field>
        <Field label="尺寸">
          <Select
            ariaLabel={`${ruleName} 地图图标尺寸`}
            value={size ?? ""}
            onValueChange={(next) => edit("size", next)}
            options={sizeOptions}
            placeholder="先选形状"
            disabled={disabled || !shape}
          />
        </Field>
      </div>
    </Field>
  );
}

/** 音效：沿用当前的样式，或者选方案里的自定义音效、内置音效；「选择文件」从本地选一个新的。 */
export function SoundField({
  ruleName,
  value,
  defaultLabel,
  inherited,
  onReset,
  disabled,
  customOptions,
  onChange,
  onReuse,
  onPickFile,
  warning,
}: FieldProps & {
  value: PresetSound | undefined;
  /** 方案里已经在用的自定义音效，可以直接选。 */
  customOptions: Array<{ fileName: string; file: File }>;
  /** 选了沿用，或者一种内置音效。 */
  onChange: (sound: PresetSound | undefined) => void;
  /** 选了方案里已有的自定义音效。 */
  onReuse: (option: { fileName: string; file: File }) => void;
  /** 从文件里新选一个自定义音效。 */
  onPickFile: (file: File | undefined) => void;
  /** 下拉下面的提示。 */
  warning?: ReactNode;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const soundValue = !value
    ? NONE
    : value.type === "custom"
      ? CUSTOM_PREFIX + value.fileName
      : value.type === "builtin"
        ? "builtin:" + value.id
        : "base:" + value.fileName;
  // 当前这项的音效文件读不到时，也把名字列出来，看得出缺了什么。
  const customItems = [
    ...customOptions.map((option) => ({ value: CUSTOM_PREFIX + option.fileName, label: option.fileName })),
    ...(value?.type === "custom" && !customOptions.some((option) => option.fileName === value.fileName)
      ? [{ value: CUSTOM_PREFIX + value.fileName, label: value.fileName }]
      : []),
    { value: PICK_FILE, label: "选择文件" },
  ];

  return (
    <Field label="音效">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="min-w-0 flex-1 basis-40"
            ariaLabel={`${ruleName} 音效`}
            value={soundValue}
            onValueChange={(next) => {
              if (next === NONE) onChange(undefined);
              else if (next === PICK_FILE) fileInput.current?.click();
              else if (next.startsWith(CUSTOM_PREFIX)) {
                const option = customOptions.find((entry) => CUSTOM_PREFIX + entry.fileName === next);
                if (option) onReuse(option);
              } else if (next.startsWith("builtin:")) {
                const id = Number(next.slice(8));
                onChange(value?.type === "builtin" && value.id === id ? value : { type: "builtin", id, volume: 300 });
              }
            }}
            options={[
              { value: NONE, label: inherited ?? defaultLabel ?? "" },
              ...(soundValue.startsWith("base:")
                ? [{ value: soundValue, label: "基础过滤器音效 · " + soundValue.slice(5) }]
                : []),
            ]}
            groups={[
              { label: "自定义音效", options: customItems },
              {
                label: "内置音效",
                options: Array.from({ length: 16 }, (_, index) => ({ value: "builtin:" + (index + 1), label: "内置音效 " + (index + 1) })),
              },
            ]}
            disabled={disabled}
          />
          {/* 「选择文件」是包着文件输入框的标签，不是按钮，禁用时要自己变灰。 */}
          <label className={cn("inline-flex shrink-0", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
            <input
              ref={fileInput}
              type="file"
              className="peer sr-only"
              accept="audio/mpeg,audio/wav,audio/ogg"
              aria-label={`${ruleName} 自定义音效`}
              disabled={disabled}
              onChange={(event) => {
                onPickFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <span
              className={cn(
                buttonVariants({ size: "sm" }),
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold-bright",
                disabled && "pointer-events-none opacity-50",
              )}
            >
              <Upload aria-hidden="true" />
              选择文件
            </span>
          </label>
          <ResetButton name="音效" onClick={onReset} />
        </div>
        {warning}
      </div>
    </Field>
  );
}
