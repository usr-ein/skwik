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

export type Datum = RectDatum | LineDatum

export type ConfidenceScore = 1 | 2 | 3 | 4 | 5

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
}

export interface AxisCorrection {
    ratio: number
    totalWeight: number
}

export interface DatumReport {
    label: string
    type: "rectangle" | "line"
    measuredMm: number
    expectedMm: number
    errorPercent: number
    axisContribution: "x" | "y" | "both"
}

export interface DeskewDiagnostics {
    primaryDatum: string
    xCorrection: AxisCorrection
    yCorrection: AxisCorrection
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
