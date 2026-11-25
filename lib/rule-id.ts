/** 新规则使用方案内唯一的 8 位随机字母数字 ID。新分享码在确认导入时分配本地 ID。 */
export const RULE_ID_LENGTH = 8;
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** 248 = 4 × 62：丢掉其余取值，免得取模后前几个字符偏多。 */
const UNBIASED = 248;
const ATTEMPTS = 100;

type RandomBytes = (length: number) => Uint8Array;
const randomBytes: RandomBytes = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length));

/** 生成一个不在 `taken` 里的规则 id；撞上就重新抽。 */
export function newRuleId(taken: Iterable<string>, random: RandomBytes = randomBytes): string {
  const used = taken instanceof Set ? taken : new Set(taken);
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    let id = "";
    for (let round = 0; id.length < RULE_ID_LENGTH; round += 1) {
      if (round >= ATTEMPTS) throw new Error("随机源无法生成规则 id");
      for (const byte of random(RULE_ID_LENGTH)) {
        if (byte < UNBIASED && id.length < RULE_ID_LENGTH) id += ALPHABET[byte % ALPHABET.length];
      }
    }
    if (!used.has(id)) return id;
  }
  throw new Error("无法生成不重复的规则 id");
}
