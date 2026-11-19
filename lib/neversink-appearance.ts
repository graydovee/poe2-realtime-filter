import appearanceData from "../data/neversink-currency-appearances.json";
import type { FilterProfile, VisualPreset } from "./types";

export type CurrencyAppearance = Pick<VisualPreset, "effect" | "minimapIcon" | "textColor" | "borderColor" | "backgroundColor" | "fontSize" | "sound"> & { name: string; line: number };
type TemplateAppearances = { file: string; sha256: string; appearances: Record<string, CurrencyAppearance> };
const templates = appearanceData.files as unknown as Record<string, TemplateAppearances>;
export const NEVERSINK_VERSION = appearanceData.version;
export type TemplateSelection = Pick<FilterProfile, "style" | "strictness">;

export function templateAppearance(selection: TemplateSelection, itemId?: string) {
  if (!itemId) return undefined;
  const template = templates[selection.style + ":" + selection.strictness];
  const appearance = template?.appearances[itemId];
  if (!appearance) return undefined;
  return { ...appearance, file: template.file, version: appearanceData.version, url: "https://github.com/NeverSinkDev/NeverSink-Filter-for-PoE2/blob/" + appearanceData.version + "/" + template.file.split("/").map(encodeURIComponent).join("/") + "#L" + appearance.line };
}

export function applyTemplateAppearances(presets: VisualPreset[], selection: TemplateSelection): VisualPreset[] {
  return presets.map((preset) => {
    if (preset.followTemplate === false) return preset;
    const appearance = templateAppearance(selection, preset.appearanceItemId ?? preset.sourceItemId);
    if (!appearance) return preset;
    // Assign every optional action explicitly: a style may intentionally omit a background or border.
    return { ...preset, effect: appearance.effect, minimapIcon: appearance.minimapIcon, textColor: appearance.textColor, borderColor: appearance.borderColor, backgroundColor: appearance.backgroundColor, fontSize: appearance.fontSize, sound: preset.sound.type === "custom" ? preset.sound : appearance.sound };
  });
}
