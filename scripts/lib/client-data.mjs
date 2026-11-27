import fs from "node:fs";
import path from "node:path";

/**
 * 客户端 BaseItemTypes 表。<client-version-directory> 下按语言分目录（us / tw / cn），各有一份 BaseItemTypes.jsonl，
 * 三种语言按物品的稳定编号（Id）逐条对应。目录里收哪些物品由物品列表决定，客户端表提供三语名字、
 * 物品类别编号、标签和掉落等级。
 */

const LANGUAGES = ["us", "tw", "cn"];

/** 只出传奇的记录：编号带 Unique，例如符文之叉 FourWandUnique2。同名还有别的记录时（Shrine Sceptre），普通变体照出。 */
export const isUniqueOnlyRecord = (record) => /Unique/.test(record.Id);

/**
 * 读三份语言表。同名可以对应几条记录（旧残酷难度的变体、只出传奇的同名基底），按名字收在一起，
 * 再按不区分大小写建一份索引。
 */
export function loadClient(clientRoot) {
  // 缺哪种语言的表，那种语言的名字就先用英文。
  const load = (language) => {
    const file = path.join(clientRoot, language, "BaseItemTypes.jsonl");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  };
  const records = load("us");
  const localized = Object.fromEntries(LANGUAGES.slice(1).map((language) => [language, new Map(load(language).map((record) => [record.Id, record.Name]))]));
  const byName = new Map();
  const byLowerName = new Map();
  for (const record of records) {
    if (!record.Name) continue;
    let entry = byName.get(record.Name);
    if (!entry) {
      entry = {
        name: record.Name,
        records: [],
        localeNames: { us: record.Name, tw: localized.tw.get(record.Id) ?? record.Name, cn: localized.cn.get(record.Id) ?? record.Name },
      };
      byName.set(record.Name, entry);
      byLowerName.set(record.Name.toLowerCase(), entry);
    }
    entry.records.push(record);
    entry.dropLevel = Math.max(...entry.records.map((item) => item.DropLevel));
  }
  return { records, byName, byLowerName };
}
