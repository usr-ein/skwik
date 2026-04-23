import { nanoid } from "nanoid"
import type { LineDatum, Point, RectDatum, RectPreset } from "@/types"

export const RECT_PRESETS: RectPreset[] = [
    { label: "A3", widthMm: 297, heightMm: 420 },
    { label: "A4", widthMm: 210, heightMm: 297 },
    { label: "A5", widthMm: 148, heightMm: 210 },
    { label: "A6", widthMm: 105, heightMm: 148 },
    { label: "15\u00D710 cm", widthMm: 150, heightMm: 100 },
]

const DATUM_COLORS = [
    "#3b82f6", // blue
    "#ef4444", // red
    "#22c55e", // green
    "#f59e0b", // amber
    "#8b5cf6", // violet
    "#ec4899", // pink
    "#06b6d4", // cyan
    "#f97316", // orange
]

export function getDatumColor(index: number): string {
    const color = DATUM_COLORS[index % DATUM_COLORS.length]
    if (!color) throw new Error("Unreachable: DATUM_COLORS is non-empty")
    return color
}

export function createRectDatum(
    center: Point,
    index: number,
    preset?: RectPreset,
): RectDatum {
    const spread = 80
    return {
        id: nanoid(),
        type: "rectangle",
        corners: [
            { x: center.x - spread, y: center.y - spread },
            { x: center.x + spread, y: center.y - spread },
            { x: center.x + spread, y: center.y + spread },
            { x: center.x - spread, y: center.y + spread },
        ],
        widthMm: preset?.widthMm ?? 0,
        heightMm: preset?.heightMm ?? 0,
        confidence: 3,
        label: preset?.label ?? `Rectangle ${String(index)}`,
    }
}

/**
 * Rectangle corners are stored as [TL, TR, BR, BL]. A rectangle is
 * "crossed" when a user has dragged corners past each other so the ordering
 * no longer holds: top corners must sit above bottom corners (smaller y in
 * image coordinates), and right corners must sit right of left corners.
 */
export function isRectCrossed(rect: RectDatum): boolean {
    const [tl, tr, br, bl] = rect.corners
    return tl.y >= bl.y || tr.y >= br.y || tl.x >= tr.x || bl.x >= br.x
}

export function createLineDatum(center: Point, index: number): LineDatum {
    const spread = 100
    return {
        id: nanoid(),
        type: "line",
        endpoints: [
            { x: center.x - spread, y: center.y },
            { x: center.x + spread, y: center.y },
        ],
        lengthMm: 0,
        confidence: 3,
        label: `Line ${String(index)}`,
    }
}
