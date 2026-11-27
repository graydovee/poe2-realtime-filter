"use client";

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
import { ColorPaletteSelect, ColorPicker } from "../ui/color";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { Tooltip } from "../ui/tooltip";
import { MapIconGlyph } from "./appearance-preview";

const NONE = "__none";

type FieldProps = {
  /** 规则名，拼进控件的标签里，让每个标签在界面里唯一。 */
  ruleName: string;
  /** 没设置时沿用的样式：沿用基础，或游戏默认。 */
  defaultLabel: string;
};

/** 光柱：从固定颜色里选一种，可以设成只在掉落时短暂显示。 */
export function BeamField({
  ruleName,
  value,
  defaultLabel,
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
          placeholder={defaultLabel}
          noneLabel={defaultLabel}
        />
        <Tooltip label="物品掉落时光柱只短暂显示">
          <div>
            <Switch
              checked={modifier === "Temp"}
              onCheckedChange={(temporary) => onChange(compose(color, temporary))}
              label="临时"
              disabled={!color}
            />
          </div>
        </Tooltip>
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
  onChange,
}: FieldProps & { label: string; value?: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <Input
          aria-label={`${ruleName} ${label}`}
          placeholder={`R G B (A)，${defaultLabel}`}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
        />
        <ColorPicker ariaLabel={`${ruleName} ${label}调色盘`} tooltip={`${label}调色盘`} value={value} onValueChange={onChange} />
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
  onChange,
  className,
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
    { value: NONE, label: defaultLabel },
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
    <Field label="地图图标" className={className}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-x-3 gap-y-1.5">
        <Field label="形状">
          <Select
            ariaLabel={`${ruleName} 地图图标形状`}
            value={shape ?? NONE}
            onValueChange={(next) => edit("shape", next === NONE ? "" : next)}
            options={shapeOptions}
          />
        </Field>
        <Field label="颜色">
          <ColorPaletteSelect
            ariaLabel={`${ruleName} 地图图标颜色`}
            value={color ?? ""}
            onValueChange={(next) => edit("color", next)}
            colors={beamColors}
            placeholder="先选形状"
            disabled={!shape}
          />
        </Field>
        <Field label="尺寸">
          <Select
            ariaLabel={`${ruleName} 地图图标尺寸`}
            value={size ?? ""}
            onValueChange={(next) => edit("size", next)}
            options={sizeOptions}
            placeholder="先选形状"
            disabled={!shape}
          />
        </Field>
      </div>
    </Field>
  );
}
