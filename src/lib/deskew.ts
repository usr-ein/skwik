/**
 * deskew.ts — Browser-based perspective correction using OpenCV.js (WASM)
 *
 * Accepts N datums (rectangles and/or lines), each with known real-world
 * dimensions and a confidence score (1–5). Minimum: one rectangle.
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

// Max output dimension in pixels to avoid WASM OOM
// 12288 = ~576MB RGBA at square, but actual images are rarely square
const MAX_OUTPUT_DIM = 12288

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
                sum +=
                    (A[r * 3 + k] ?? 0) * (B[k * 3 + c] ?? 0)
            }
            R[r * 3 + c] = sum
        }
    }
    return R
}

// ─── Validation ──────────────────────────────────────────────────────────────

function pickPrimary(datums: Datum[]): RectDatum {
    const rects = datums.filter(
        (d): d is RectDatum => d.type === "rectangle",
    )
    if (rects.length === 0) {
        throw new Error(
            "At least one rectangle datum is required for perspective correction.",
        )
    }
    rects.sort((a, b) => {
        if (b.confidence !== a.confidence)
            return b.confidence - a.confidence
        const area = (r: RectDatum) =>
            dist(r.corners[0], r.corners[1]) *
            dist(r.corners[0], r.corners[3])
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
                if (b) resolve(b)
                else reject(new Error("toBlob failed"))
            },
            type,
            quality,
        )
    })
}

// ─── Core ────────────────────────────────────────────────────────────────────

const log = (tag: string, ...args: unknown[]) => {
    console.log(`[deskew:${tag}]`, ...args)
}

export async function deskewImage(
    input: DeskewInput,
): Promise<DeskewResult> {
    const { image, datums, scalePxPerMm: scale, onProgress } = input
    log("start", `${String(datums.length)} datums, scale=${String(scale)} px/mm`)

    const TOTAL_STEPS = 7
    const progress = async (step: number, label: string) => {
        log(`progress`, `[${String(step + 1)}/${String(TOTAL_STEPS)}] ${label}`)
        onProgress?.(step, TOTAL_STEPS, label)
        // Yield to let the browser repaint
        await new Promise((r) => {
            requestAnimationFrame(r)
        })
    }
    if (datums.length === 0) throw new Error("No datums provided.")

    const primary = pickPrimary(datums)
    log("primary", primary.label, `${String(primary.widthMm)}×${String(primary.heightMm)}mm`, `conf=${String(primary.confidence)}`)

    // Load source image into OpenCV
    let srcCanvas: HTMLCanvasElement
    if (image instanceof HTMLCanvasElement) {
        srcCanvas = image
        log("input", `canvas ${String(image.width)}×${String(image.height)}`)
    } else {
        srcCanvas = document.createElement("canvas")
        srcCanvas.width = image.naturalWidth
        srcCanvas.height = image.naturalHeight
        log("input", `img ${String(image.naturalWidth)}×${String(image.naturalHeight)}, drawing to canvas`)
        const ctx = srcCanvas.getContext("2d")
        if (!ctx) throw new Error("Failed to get 2d context")
        ctx.drawImage(image, 0, 0)
    }

    await progress(0, "Loading image into OpenCV")

    // All OpenCV mats to clean up
    const mats: InstanceType<typeof cv.Mat>[] = []
    const track = <T extends InstanceType<typeof cv.Mat>>(m: T): T => {
        mats.push(m)
        return m
    }

    try {
        log("cv.imread", "reading source canvas into cv.Mat")
        const src = track(cv.imread(srcCanvas))
        const imgW = src.cols
        const imgH = src.rows
        log("cv.imread", `done: ${String(imgW)}×${String(imgH)}, type=${String(src.type())}, channels=${String(src.channels())}`)

        // ============================================================
        // STEP 1 — Initial perspective correction from primary rect
        // ============================================================
        await progress(1, "Computing initial homography")
        const pw = primary.widthMm * scale
        const ph = primary.heightMm * scale
        log("step1", `dest rect: ${pw.toFixed(1)}×${ph.toFixed(1)} px`)

        const algoCorners = cornersToAlgoOrder(primary.corners)
        log("step1", `corners (algo order): ${JSON.stringify(algoCorners)}`)
        const srcPts = track(pointsToMat(algoCorners))

        const dstInit = track(
            pointsToMat([
                { x: 0, y: 0 },
                { x: pw, y: 0 },
                { x: 0, y: ph },
                { x: pw, y: ph },
            ]),
        )
        log("step1", "calling getPerspectiveTransform (initial)")
        const mInit = track(
            cv.getPerspectiveTransform(srcPts, dstInit),
        )
        log("step1", `mInit type=${String(mInit.type())}, rows=${String(mInit.rows)}, cols=${String(mInit.cols)}`)

        // ============================================================
        // STEP 2 — Measure secondary datums, accumulate corrections
        // ============================================================
        await progress(2, "Measuring secondary datums")
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
                const pts = transformPoints(
                    datum.endpoints as Point[],
                    mInit,
                )
                const s = pts[0]
                const e = pts[1]
                if (!s || !e) continue
                const dx = Math.abs(e.x - s.x)
                const dy = Math.abs(e.y - s.y)
                const measured = dist(s, e)
                const expected = datum.lengthMm * scale
                const ratio = expected / measured

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
                const ac = cornersToAlgoOrder(datum.corners)
                const pts = transformPoints(
                    [ac[0], ac[1], ac[2]],
                    mInit,
                )
                const tl = pts[0]
                const tr = pts[1]
                const bl = pts[2]
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
                    errorPercent:
                        (Math.abs(1 - xR) + Math.abs(1 - yR)) * 50,
                    axisContribution: "both",
                })
            }
        }

        // ============================================================
        // STEP 3 — Weighted corrections (1.0 = no secondary data)
        // ============================================================
        await progress(3, "Computing axis corrections")
        const xCorr: AxisCorrection = {
            ratio: xWTotal > 0 ? xWSum / xWTotal : 1.0,
            totalWeight: xWTotal,
        }
        const yCorr: AxisCorrection = {
            ratio: yWTotal > 0 ? yWSum / yWTotal : 1.0,
            totalWeight: yWTotal,
        }
        log("step3", `xCorr=${xCorr.ratio.toFixed(4)} (w=${xCorr.totalWeight.toFixed(1)}), yCorr=${yCorr.ratio.toFixed(4)} (w=${yCorr.totalWeight.toFixed(1)})`)

        // ============================================================
        // STEP 4 — Fold corrections, recompute transform
        // ============================================================
        await progress(4, "Recomputing final transform")
        const pwFinal = pw * xCorr.ratio
        const phFinal = ph * yCorr.ratio
        log("step4", `final dest rect: ${pwFinal.toFixed(1)}×${phFinal.toFixed(1)} px`)

        const dstFinal = track(
            pointsToMat([
                { x: 0, y: 0 },
                { x: pwFinal, y: 0 },
                { x: 0, y: phFinal },
                { x: pwFinal, y: phFinal },
            ]),
        )
        log("step4", "calling getPerspectiveTransform (final)")
        const mFinal = track(
            cv.getPerspectiveTransform(srcPts, dstFinal),
        )
        log("step4", `mFinal type=${String(mFinal.type())}, rows=${String(mFinal.rows)}, cols=${String(mFinal.cols)}`)

        // ============================================================
        // STEP 5 — Output bounds + translation shift
        // ============================================================
        await progress(5, "Computing output bounds")
        const imgCorners: Point[] = [
            { x: 0, y: 0 },
            { x: imgW, y: 0 },
            { x: 0, y: imgH },
            { x: imgW, y: imgH },
        ]
        const warped = transformPoints(imgCorners, mFinal)
        if (warped.length < 4) {
            throw new Error(
                "Perspective transform produced invalid bounds",
            )
        }

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

        let outW = Math.ceil(xMax - xMin)
        let outH = Math.ceil(yMax - yMin)
        log("step5", `bounds: x=[${xMin.toFixed(1)}, ${xMax.toFixed(1)}], y=[${yMin.toFixed(1)}, ${yMax.toFixed(1)}]`)
        log("step5", `raw output: ${String(outW)}×${String(outH)} px`)

        // Guard against absurd output sizes that crash WASM
        if (outW <= 0 || outH <= 0) {
            throw new Error(
                `Invalid output dimensions: ${String(outW)}×${String(outH)}`,
            )
        }
        let downscale = 1
        if (outW > MAX_OUTPUT_DIM || outH > MAX_OUTPUT_DIM) {
            downscale = MAX_OUTPUT_DIM / Math.max(outW, outH)
            log("step5", `CLAMPING from ${String(outW)}×${String(outH)} by factor ${downscale.toFixed(4)}`)
            outW = Math.ceil(outW * downscale)
            outH = Math.ceil(outH * downscale)
        }
        log("step5", `final output: ${String(outW)}×${String(outH)} px (${String(Math.round(outW * outH * 4 / 1024 / 1024))} MB RGBA)`)

        const mData: number[] = readMat3x3(mFinal)
        // Translate so the top-left warped corner is at (0,0),
        // then scale down if we clamped the output size.
        const tShift: number[] = [
            downscale, 0, -xMin * downscale,
            0, downscale, -yMin * downscale,
            0, 0, 1,
        ]
        const mOutData: number[] = mul3x3(tShift, mData)
        const mOut = track(
            cv.matFromArray(3, 3, cv.CV_64FC1, mOutData),
        )

        // ============================================================
        // STEP 6 — Warp
        // ============================================================
        await progress(6, "Warping image (this may take a moment)")
        log("step6", "calling warpPerspective...")
        const dstMat = track(new cv.Mat())
        cv.warpPerspective(
            src,
            dstMat,
            mOut,
            new cv.Size(outW, outH),
            cv.INTER_LANCZOS4 as number,
            cv.BORDER_CONSTANT as number,
            new cv.Scalar(0, 0, 0, 0),
        )

        log("step6", `warpPerspective done, dstMat: ${String(dstMat.cols)}×${String(dstMat.rows)}, type=${String(dstMat.type())}`)

        log("export", "cv.imshow to canvas")
        const outCanvas = document.createElement("canvas")
        outCanvas.width = outW
        outCanvas.height = outH
        cv.imshow(outCanvas, dstMat)

        log("export", "canvas.toBlob (PNG)")
        const blob = await canvasToBlob(outCanvas, "image/png", 0.95)
        log("export", `blob size: ${String(Math.round(blob.size / 1024))} KB`)

        const diagnostics: DeskewDiagnostics = {
            primaryDatum: primary.label,
            xCorrection: xCorr,
            yCorrection: yCorr,
            perDatum: reports,
            outputWidthPx: outW,
            outputHeightPx: outH,
        }

        log("done", "success")
        return { correctedImageBlob: blob, diagnostics }
    } finally {
        // Always clean up all OpenCV mats, even on error
        for (const m of mats) {
            try {
                m.delete()
            } catch {
                // already deleted or invalid — ignore
            }
        }
    }
}

// ─── OpenCV init ────────────────────────────────────────────────────────────

let cvReady = false

/** Wait for OpenCV WASM to initialize. Call once at app startup. */
export function waitForOpenCV(): Promise<void> {
    log("opencv", "waitForOpenCV called, cvReady=" + String(cvReady))
    return new Promise<void>((resolve) => {
        if (cvReady) {
            log("opencv", "already ready")
            resolve()
            return
        }

        // Test if WASM is actually functional by trying to create a mat
        try {
            log("opencv", "probing cv.Mat()...")
            const test = new cv.Mat()
            test.delete()
            cvReady = true
            log("opencv", "probe succeeded, WASM ready")
            resolve()
            return
        } catch {
            log("opencv", "probe failed, waiting for onRuntimeInitialized")
            // Not ready yet, wait for callback
        }

        cv.onRuntimeInitialized = () => {
            cvReady = true
            log("opencv", "onRuntimeInitialized fired, WASM ready")
            resolve()
        }
    })
}
