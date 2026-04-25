import type { Point } from "@/types"
import type { Measurement } from "@/types/measurements"

const KEY_PREFIX = "skwik-measurements-"

/** Scale every image-space point in `m` by `ratio`. Used when the user
 *  re-runs the deskew at a different output px/mm — the corrected image
 *  changes size, so measurements (stored in image-pixel coords) must move
 *  with it to stay anchored to the same physical features. */
function scalePoint(p: Point, ratio: number): Point {
    return { x: p.x * ratio, y: p.y * ratio }
}

export function scaleMeasurements(
    measurements: Measurement[],
    ratio: number,
): Measurement[] {
    if (ratio === 1) return measurements
    return measurements.map((m) => {
        switch (m.type) {
            case "line":
                return { ...m, a: scalePoint(m.a, ratio), b: scalePoint(m.b, ratio) }
            case "rectangle":
                return {
                    ...m,
                    corners: [
                        scalePoint(m.corners[0], ratio),
                        scalePoint(m.corners[1], ratio),
                        scalePoint(m.corners[2], ratio),
                        scalePoint(m.corners[3], ratio),
                    ],
                }
            case "ellipse":
                return {
                    ...m,
                    center: scalePoint(m.center, ratio),
                    axisEndA: scalePoint(m.axisEndA, ratio),
                    axisEndB: scalePoint(m.axisEndB, ratio),
                }
            case "circle":
                return {
                    ...m,
                    center: scalePoint(m.center, ratio),
                    edge: scalePoint(m.edge, ratio),
                }
            case "angle":
                return {
                    ...m,
                    vertex: scalePoint(m.vertex, ratio),
                    armA: scalePoint(m.armA, ratio),
                    armB: scalePoint(m.armB, ratio),
                }
        }
    })
}

export function saveMeasurements(
    hash: string,
    measurements: Measurement[],
): void {
    try {
        localStorage.setItem(
            KEY_PREFIX + hash,
            JSON.stringify(measurements),
        )
    } catch {
        // localStorage full or unavailable — silently ignore
    }
}

export function loadMeasurements(hash: string): Measurement[] | null {
    try {
        const raw = localStorage.getItem(KEY_PREFIX + hash)
        if (!raw) return null
        return JSON.parse(raw) as Measurement[]
    } catch {
        return null
    }
}

export function clearCache(): void {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith(KEY_PREFIX)) {
            toRemove.push(key)
        }
    }
    for (const key of toRemove) {
        localStorage.removeItem(key)
    }
}
