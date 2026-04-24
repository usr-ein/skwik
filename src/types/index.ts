export interface Point {
    x: number
    y: number
}

export interface RectDatum {
    id: string
    type: "rectangle"
    corners: [Point, Point, Point, Point] // TL, TR, BR, BL
    widthMm: number
    heightMm: number
    confidence: 1 | 2 | 3 | 4 | 5
    label: string
}

export interface LineDatum {
    id: string
    type: "line"
    endpoints: [Point, Point]
    lengthMm: number
    confidence: 1 | 2 | 3 | 4 | 5
    label: string
}

export interface EllipseDatum {
    id: string
    type: "ellipse"
    /** Image-space ellipse as 3 free points: center + two conjugate
     * semi-axis endpoints. axisEndA/axisEndB don't need to be perpendicular;
     * together with center they give a full 5-DoF ellipse matrix. */
    center: Point
    axisEndA: Point
    axisEndB: Point
    /** Known real-world diameter of the circle being drawn. */
    diameterMm: number
    confidence: 1 | 2 | 3 | 4 | 5
    label: string
}

export type Datum = RectDatum | LineDatum | EllipseDatum

export type ConfidenceScore = 1 | 2 | 3 | 4 | 5

export type DatumType = Datum["type"]

export interface ExifData {
    make?: string
    model?: string
    lensModel?: string
    focalLength?: number
    focalLengthIn35mm?: number
    orientation?: number
    imageWidth?: number
    imageHeight?: number
    exposureTime?: number
    fNumber?: number
    iso?: number
    dateTimeOriginal?: string
    gpsLatitude?: number
    gpsLongitude?: number
}

export interface DeskewInput {
    image: HTMLImageElement | HTMLCanvasElement
    datums: Datum[]
    exif: ExifData
    /** Output pixels per mm. */
    scalePxPerMm: number
    /** Called with (stepIndex 0-based, totalSteps, stepLabel) */
    onProgress?: (step: number, total: number, label: string) => void
}

export interface DatumReport {
    label: string
    type: DatumType
    /** Representative expected dimension in mm (widthMm / lengthMm / diameterMm). */
    expectedMm: number
    /** Representative measured dimension in mm under the solved H. */
    measuredMm: number
    /** Overall residual magnitude expressed as a percentage. */
    errorPercent: number
    /** Free-form breakdown for debugging (e.g. "iso 0.2%, skew 0.1%, dia 0.8%"). */
    details: string
}

export interface DeskewDiagnostics {
    /** Label of the rectangle used to fix the output gauge. */
    primaryDatum: string
    /** Number of outer alternating-minimization iterations the solver ran. */
    iterations: number
    /** Final weighted RMS residual across all datums, as a percentage. */
    finalRMSPercent: number
    perDatum: DatumReport[]
    outputWidthPx: number
    outputHeightPx: number
}

export interface DeskewResult {
    correctedImageBlob: Blob
    diagnostics: DeskewDiagnostics
}

export type AppStep = 1 | 2 | 3 | 4

/** Pixels per mm in the output image. Default 10 (= 100 px/cm). */
export const DEFAULT_SCALE_PX_PER_MM = 10

export interface RectPreset {
    label: string
    widthMm: number
    heightMm: number
}

export interface CirclePreset {
    label: string
    diameterMm: number
}
