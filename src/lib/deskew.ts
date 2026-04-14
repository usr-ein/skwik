/**
 * deskew.ts — Browser-based perspective correction using OpenCV.js (WASM)
 *
 * Adapted from the reference algorithm. Accepts N datums (rectangles and/or
 * lines), each with known real-world dimensions and a confidence score (1–5).
 * Minimum: one rectangle.
 *
 * Algorithm:
 *   1. Pick the highest-confidence rectangle as primary reference.
 *   2. getPerspectiveTransform from its 4 corners → initial correction.
 *   3. Project all other datums through that transform and measure them.
 *   4. Compute per-axis weighted scale corrections from all secondary datums.
 *   5. Fold corrections into the destination rectangle, recompute
 *      getPerspectiveTransform → single clean perspective matrix.
 *   6. warpPerspective the image.
 */

import cv from "@techstark/opencv-js"
import type {
    AxisCorrection,
    Datum,
    DatumReport,
    DeskewDiagnostics,
    DeskewInput,
    DeskewResult,
    Point,
    RectDatum,
} from "@/types"

// ─── OpenCV helpers ──────────────────────────────────────────────────────────

function pointsToMat(points: Point[]): InstanceType<typeof cv.Mat> {
    const flat = points.flatMap((p) => [p.x, p.y])
    return cv.matFromArray(points.length, 1, cv.CV_32FC2, flat)
}

function transformPoints(
    points: Point[],
    M: InstanceType<typeof cv.Mat>,
): Point[] {
    const src = pointsToMat(points)
    const dst = new cv.Mat()
    cv.perspectiveTransform(src, dst, M)
    const result: Point[] = []
    const data = dst.data32F
    for (let i = 0; i < points.length; i++) {
        const x = data[i * 2]
        const y = data[i * 2 + 1]
        if (x === undefined || y === undefined) continue
        result.push({ x, y })
    }
    src.delete()
    dst.delete()
    return result
}

function dist(a: Point, b: Point): number {
    return Math.hypot(b.x - a.x, b.y - a.y)
}

function readMat3x3(M: InstanceType<typeof cv.Mat>): number[] {
    const d: number[] = []
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            d.push(M.doubleAt(r, c))
        }
    }
    return d
}

/** Row-major 3x3 matrix multiply */
function mul3x3(A: number[], B: number[]): number[] {
    const R = Array<number>(9).fill(0)
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            let sum = 0
            for (let k = 0; k < 3; k++) {
                sum += (A[r * 3 + k] ?? 0) * (B[k * 3 + c] ?? 0)
            }
            R[r * 3 + c] = sum
        }
    }
    return R
}

// ─── Validation ──────────────────────────────────────────────────────────────

function pickPrimary(datums: Datum[]): RectDatum {
    const rects = datums.filter((d): d is RectDatum => d.type === "rectangle")
    if (rects.length === 0) {
        throw new Error(
            "At least one rectangle datum is required for perspective correction.",
        )
    }
    // Highest confidence; tie-break by pixel area (larger = more precise corners)
    rects.sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence
        const area = (r: RectDatum) =>
            dist(r.corners[0], r.corners[1]) * dist(r.corners[0], r.corners[3])
        return area(b) - area(a)
    })
    return rects[0] as RectDatum
}

/**
 * Convert our app corner order (TL, TR, BR, BL) to the algorithm's
 * expected order (TL, TR, BL, BR) for getPerspectiveTransform.
 */
function cornersToAlgoOrder(
    corners: [Point, Point, Point, Point],
): [Point, Point, Point, Point] {
    // App: [TL, TR, BR, BL] → Algo: [TL, TR, BL, BR]
    return [corners[0], corners[1], corners[3], corners[2]]
}

// ─── Canvas → Blob helper ───────────────────────────────────────────────────

function canvasToBlob(
    canvas: HTMLCanvasElement,
    type = "image/png",
    quality = 0.95,
): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (b) => {
                if (b) {
                    resolve(b)
                } else {
                    reject(new Error("toBlob failed"))
                }
            },
            type,
            quality,
        )
    })
}

// ─── Core ────────────────────────────────────────────────────────────────────

export async function deskewImage(input: DeskewInput): Promise<DeskewResult> {
    const { image, datums, scalePxPerMm: scale } = input
    if (datums.length === 0) throw new Error("No datums provided.")

    const primary = pickPrimary(datums)

    // Load source image into OpenCV
    let srcCanvas: HTMLCanvasElement
    if (image instanceof HTMLCanvasElement) {
        srcCanvas = image
    } else {
        srcCanvas = document.createElement("canvas")
        srcCanvas.width = image.naturalWidth
        srcCanvas.height = image.naturalHeight
        const ctx = srcCanvas.getContext("2d")
        if (!ctx) throw new Error("Failed to get 2d context")
        ctx.drawImage(image, 0, 0)
    }
    const src = cv.imread(srcCanvas)
    const imgW = src.cols
    const imgH = src.rows

    // ================================================================
    // STEP 1 — Initial perspective correction from primary rectangle
    // ================================================================
    const pw = primary.widthMm * scale
    const ph = primary.heightMm * scale

    const algoCorners = cornersToAlgoOrder(primary.corners)
    const srcPts = pointsToMat(algoCorners)
    const dstInit = pointsToMat([
        { x: 0, y: 0 },
        { x: pw, y: 0 },
        { x: 0, y: ph },
        { x: pw, y: ph },
    ])
    const mInit = cv.getPerspectiveTransform(srcPts, dstInit)

    // ================================================================
    // STEP 2 — Measure all secondary datums, accumulate corrections
    // ================================================================
    let xWSum = 0,
        xWTotal = 0
    let yWSum = 0,
        yWTotal = 0
    const reports: DatumReport[] = []

    for (const datum of datums) {
        const w = datum.confidence

        if (datum === primary) {
            reports.push({
                label: datum.label,
                type: "rectangle",
                measuredMm: datum.widthMm,
                expectedMm: datum.widthMm,
                errorPercent: 0,
                axisContribution: "both",
            })
            continue
        }

        if (datum.type === "line") {
            const [s, e] = transformPoints(datum.endpoints as Point[], mInit)
            if (!s || !e) continue
            const dx = Math.abs(e.x - s.x)
            const dy = Math.abs(e.y - s.y)
            const measured = dist(s, e)
            const expected = datum.lengthMm * scale
            const ratio = expected / measured

            // Axis contribution proportional to alignment
            const total = dx + dy
            if (total > 1e-6) {
                const xFrac = dx / total
                const yFrac = dy / total
                xWSum += ratio * w * xFrac
                xWTotal += w * xFrac
                yWSum += ratio * w * yFrac
                yWTotal += w * yFrac
            }

            reports.push({
                label: datum.label,
                type: "line",
                measuredMm: measured / scale,
                expectedMm: datum.lengthMm,
                errorPercent: Math.abs(1 - ratio) * 100,
                axisContribution: dx > dy ? "x" : "y",
            })
        } else {
            // Secondary rectangle: top edge → X, left edge → Y
            const ac = cornersToAlgoOrder(datum.corners)
            const [tl, tr, bl] = transformPoints([ac[0], ac[1], ac[2]], mInit)
            if (!tl || !tr || !bl) continue
            const mW = dist(tl, tr)
            const mH = dist(tl, bl)
            const xR = (datum.widthMm * scale) / mW
            const yR = (datum.heightMm * scale) / mH

            xWSum += xR * w
            xWTotal += w
            yWSum += yR * w
            yWTotal += w

            reports.push({
                label: datum.label,
                type: "rectangle",
                measuredMm: mW / scale,
                expectedMm: datum.widthMm,
                errorPercent: (Math.abs(1 - xR) + Math.abs(1 - yR)) * 50,
                axisContribution: "both",
            })
        }
    }

    // ================================================================
    // STEP 3 — Weighted corrections (1.0 = no secondary data)
    // ================================================================
    const xCorr: AxisCorrection = {
        ratio: xWTotal > 0 ? xWSum / xWTotal : 1.0,
        totalWeight: xWTotal,
    }
    const yCorr: AxisCorrection = {
        ratio: yWTotal > 0 ? yWSum / yWTotal : 1.0,
        totalWeight: yWTotal,
    }

    // ================================================================
    // STEP 4 — Fold into destination rectangle, recompute transform
    // ================================================================
    const pwFinal = pw * xCorr.ratio
    const phFinal = ph * yCorr.ratio

    const dstFinal = pointsToMat([
        { x: 0, y: 0 },
        { x: pwFinal, y: 0 },
        { x: 0, y: phFinal },
        { x: pwFinal, y: phFinal },
    ])
    const mFinal = cv.getPerspectiveTransform(srcPts, dstFinal)

    // ================================================================
    // STEP 5 — Output bounds + translation shift
    // ================================================================
    const imgCorners: Point[] = [
        { x: 0, y: 0 },
        { x: imgW, y: 0 },
        { x: 0, y: imgH },
        { x: imgW, y: imgH },
    ]
    const warped = transformPoints(imgCorners, mFinal)
    let xMin = Infinity,
        yMin = Infinity,
        xMax = -Infinity,
        yMax = -Infinity
    for (const c of warped) {
        xMin = Math.min(xMin, c.x)
        yMin = Math.min(yMin, c.y)
        xMax = Math.max(xMax, c.x)
        yMax = Math.max(yMax, c.y)
    }

    const outW = Math.ceil(xMax - xMin)
    const outH = Math.ceil(yMax - yMin)

    const mData: number[] = readMat3x3(mFinal)
    const tShift: number[] = [1, 0, -xMin, 0, 1, -yMin, 0, 0, 1]
    const mOutData: number[] = mul3x3(tShift, mData)
    const mOut = cv.matFromArray(3, 3, cv.CV_64FC1, mOutData)

    // ================================================================
    // STEP 6 — Warp
    // ================================================================
    const dstMat = new cv.Mat()
    cv.warpPerspective(
        src,
        dstMat,
        mOut,
        new cv.Size(outW, outH),
        cv.INTER_LANCZOS4 as number,
        cv.BORDER_CONSTANT as number,
        new cv.Scalar(0, 0, 0, 0),
    )

    const outCanvas = document.createElement("canvas")
    outCanvas.width = outW
    outCanvas.height = outH
    cv.imshow(outCanvas, dstMat)

    // Cleanup OpenCV mats
    src.delete()
    srcPts.delete()
    dstInit.delete()
    mInit.delete()
    dstFinal.delete()
    mFinal.delete()
    mOut.delete()
    dstMat.delete()

    const blob = await canvasToBlob(outCanvas, "image/png", 0.95)

    const diagnostics: DeskewDiagnostics = {
        primaryDatum: primary.label,
        xCorrection: xCorr,
        yCorrection: yCorr,
        perDatum: reports,
        outputWidthPx: outW,
        outputHeightPx: outH,
    }

    return { correctedImageBlob: blob, diagnostics }
}

// ─── OpenCV init ────────────────────────────────────────────────────────────

/** Wait for OpenCV WASM to initialize. Call once at app startup. */
export function waitForOpenCV(): Promise<void> {
    return new Promise<void>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cv.Mat) {
            resolve()
            return
        }
        cv.onRuntimeInitialized = () => {
            resolve()
        }
    })
}
