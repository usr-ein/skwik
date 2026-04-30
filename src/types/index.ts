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
    /** When true, this rectangle defines the world axes: TL→TR is +x,
     *  TL→BL is +y. At most one datum in the set may hold the axis role. */
    isAxisReference?: boolean
}

export type LineAxisRole = "x" | "y" | null

export interface LineDatum {
    id: string
    type: "line"
    endpoints: [Point, Point]
    lengthMm: number
    confidence: 1 | 2 | 3 | 4 | 5
    label: string
    /** Marks this line as the world axis reference. "x" maps endpoint[0]
     *  to origin and endpoint[1] to (+L, 0); "y" maps to (0, +L). At most
     *  one datum in the set may hold the axis role. */
    axisRole?: LineAxisRole
}

export interface EllipseDatum {
    id: string
    type: "ellipse"
    /** User-placed points on the circle contour (≥5, default 8). The
     *  best-fit ellipse is refitted each time this array changes; the
     *  `center`/`axisEndA`/`axisEndB` fields below are that fit cached
     *  on the datum for use by renderers and the solver. */
    points: Point[]
    center: Point
    /** Offset endpoint of the fitted semi-major axis from `center`. */
    axisEndA: Point
    /** Offset endpoint of the fitted semi-minor axis from `center`
     *  (perpendicular to axisEndA). */
    axisEndB: Point
    /** Known real-world diameter of the circle being drawn. */
    diameterMm: number
    confidence: 1 | 2 | 3 | 4 | 5
    label: string
    /** When true, this ellipse is the gauge primary — overrides the
     *  type-rank auto-pick. Mutually exclusive with `RectDatum.isAxisReference`
     *  and `LineDatum.axisRole`; setting any of those clears the others. */
    isPrimary?: boolean
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

export type AppStep = 1 | 2 | 3 | 4 | 5 | 6

/** Crop rectangle stored as fractions (0..1) of the rotated deskewed
 *  image. Persisting fractions (rather than absolute pixels) means the
 *  same crop survives a re-deskew at a different output px/mm. */
export interface CropRectFractions {
    left: number
    top: number
    right: number
    bottom: number
}

/** Per-hash post-deskew transform: rotate around the deskewed image's
 *  centre by `rotationDeg`, then crop the bounding box defined by
 *  fractional `crop` values of the rotated image. Default is identity:
 *  rotation 0, crop covering the full image. */
export interface CropRotateState {
    rotationDeg: number
    crop: CropRectFractions
}

export const IDENTITY_CROP_ROTATE: CropRotateState = {
    rotationDeg: 0,
    crop: { left: 0, top: 0, right: 1, bottom: 1 },
}

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
