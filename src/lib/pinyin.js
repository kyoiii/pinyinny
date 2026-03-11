import { pinyin } from "pinyin-pro";

export function generatePinyin(text) {
  const value = String(text ?? "").trim();
  if (!value) {
    return "";
  }

  return pinyin(value, {
    toneType: "symbol",
    type: "string",
    separator: " ",
  })
    .replace(/\s+/g, " ")
    .trim();
}
