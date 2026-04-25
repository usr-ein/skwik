import type { Point } from "@/types"

/** Measurement geometry lives in image space so it is invariant under
 *  pan/zoom and survives redraws without reprojection. Persisted to
 *  localStorage keyed by file hash; see `src/lib/measurement-cache.ts`. */
export interface BaseMeasurement {
    id: string
    colorIndex: number
}

export interface LineMeasurement extends BaseMeasurement {
    type: "line"
    a: Point
    b: Point
}

// Corner ordering [TL, TR, BR, BL] mirrors the RectDatum convention from
// `src/types/index.ts`. Indices stay stable across drags even if the user
// crosses corners.
export interface RectMeasurement extends BaseMeasurement {
    type: "rectangle"
    corners: [Point, Point, Point, Point]
}

export interface EllipseMeasurement extends BaseMeasurement {
    type: "ellipse"
    center: Point
    axisEndA: Point
    axisEndB: Point
}

export interface CircleMeasurement extends BaseMeasurement {
    type: "circle"
    center: Point
    edge: Point
}

export interface AngleMeasurement extends BaseMeasurement {
    type: "angle"
    vertex: Point
    armA: Point
    armB: Point
}

export type Measurement =
    | LineMeasurement
    | RectMeasurement
    | EllipseMeasurement
    | CircleMeasurement
    | AngleMeasurement
