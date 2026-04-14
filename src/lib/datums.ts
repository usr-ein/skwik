import { nanoid } from "nanoid";
import type { LineDatum, Point, RectDatum, RectPreset } from "@/types";

export const RECT_PRESETS: RectPreset[] = [
  { label: "A3", widthMm: 297, heightMm: 420 },
  { label: "A4", widthMm: 210, heightMm: 297 },
  { label: "A5", widthMm: 148, heightMm: 210 },
  { label: "A6", widthMm: 105, heightMm: 148 },
  { label: "10\u00D715 cm", widthMm: 100, heightMm: 150 },
];

const DATUM_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
];

export function getDatumColor(index: number): string {
  return DATUM_COLORS[index % DATUM_COLORS.length]!;
}

export function createRectDatum(
  center: Point,
  preset?: RectPreset,
): RectDatum {
  const spread = 80;
  return {
    id: nanoid(),
    type: "rectangle",
    corners: [
      { x: center.x - spread, y: center.y - spread },
      { x: center.x + spread, y: center.y - spread },
      { x: center.x + spread, y: center.y + spread },
      { x: center.x - spread, y: center.y + spread },
    ],
    widthMm: preset?.widthMm ?? 210,
    heightMm: preset?.heightMm ?? 297,
    confidence: 3,
    label: preset?.label ?? "Rectangle",
  };
}

export function createLineDatum(center: Point): LineDatum {
  const spread = 100;
  return {
    id: nanoid(),
    type: "line",
    endpoints: [
      { x: center.x - spread, y: center.y },
      { x: center.x + spread, y: center.y },
    ],
    lengthMm: 100,
    confidence: 3,
    label: "Line",
  };
}
