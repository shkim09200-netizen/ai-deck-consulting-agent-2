import { SKELETON_STRUCTURE } from "@engine/domain/houseStyle.js";

const TITLE: Record<string, string> = Object.fromEntries(
  SKELETON_STRUCTURE.map((s) => [s.key, s.title]),
);

export function sectionTitleOf(key: string): string {
  return TITLE[key] ?? key;
}
