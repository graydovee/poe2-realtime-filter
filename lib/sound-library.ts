import type { BaseOverlay, FilterRule } from "./types";

/** 音效文件定名时用得到的部分。 */
export type SoundFile = { name: string; size: number };

/** 过滤器里能用的音效文件名：字母、数字和 `._-`，其余字符换成下划线。 */
export function safeSoundName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** 方案里各条规则和对基础规则的修改正在使用的自定义音效，按文件名去重；别的规则、修改可以直接选。 */
export function customSoundOptions<T extends SoundFile>(
  rules: FilterRule[],
  files: Record<string, T>,
  overlays: BaseOverlay[] = [],
): Array<{ fileName: string; file: T }> {
  const options = new Map<string, T>();
  const used = [
    ...rules.map((rule) => ({ id: rule.id, sound: rule.baselineEffectItemId ? undefined : rule.effects.sound })),
    ...overlays.map((overlay) => ({ id: overlay.id, sound: overlay.effects.sound })),
  ];
  for (const { id, sound } of used) {
    const file = files[id];
    if (sound?.type === "custom" && file && !options.has(sound.fileName)) options.set(sound.fileName, file);
  }
  return [...options].map(([fileName, file]) => ({ fileName, file }));
}

/** 新选的音效文件在方案里的名字：和已有音效同名同大小时是同一个文件，沿用这个名字；同名但大小不同时在扩展名前加序号。 */
export function customSoundFileName(file: SoundFile, existing: Array<{ fileName: string; file: SoundFile }>): string {
  const base = safeSoundName(file.name);
  const clash = existing.find((option) => option.fileName === base);
  if (!clash || clash.file.size === file.size) return base;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : "";
  let index = 2;
  while (existing.some((option) => option.fileName === `${stem}-${index}${extension}`)) index += 1;
  return `${stem}-${index}${extension}`;
}
