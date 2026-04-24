/**
 * deskew.ts — perspective correction pipeline.
 *
 * Delegates the homography solve to src/lib/solver.ts (alternating
 * minimization around cv.findHomography, which internally runs
 * Levenberg-Marquardt). This file handles I/O: image loading,
 * output-bounds computation, warp, PNG export, progress reporting.
 */

import cv from "@techstark/opencv-js"
import type {
    DeskewDiagnostics,
    DeskewInput,
    DeskewResult,
    Point,
} from "@/types"
import { solveHomographyForDatums, type Mat3 } from "@/lib/solver"

// Max output dimension in pixels to avoid WASM OOM
// 12288 = ~576MB RGBA at square, but actual images are rarely square
const MAX_OUTPUT_DIM = 12288

// ─── Small helpers ──────────────────────────────────────────────────────────

function projectPoints(h: Mat3, pts: Point[]): Point[] {
    return pts.map((p) => {
        const w = h[6] * p.x + h[7] * p.y + h[8]
        return {
            x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
            y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
        }
    })
}

function mul3x3(A: Mat3, B: Mat3): Mat3 {
    const R: number[] = Array<number>(9).fill(0)
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            let sum = 0
            for (let k = 0; k < 3; k++) {
                sum += (A[r * 3 + k] ?? 0) * (B[k * 3 + c] ?? 0)
            }
            R[r * 3 + c] = sum
        }
    }
    return R as Mat3
}

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

const log = (tag: string, ...args: unknown[]) => {
    console.log(`[deskew:${tag}]`, ...args)
}

// ─── Core ───────────────────────────────────────────────────────────────────

export async function deskewImage(
    input: DeskewInput,
): Promise<DeskewResult> {
    const { image, datums, scalePxPerMm: scale, onProgress } = input
    log(
        "start",
        `${String(datums.length)} datums, scale=${String(scale)} px/mm`,
    )

    const TOTAL_STEPS = 5
    const progress = async (step: number, label: string) => {
        log("progress", `[${String(step + 1)}/${String(TOTAL_STEPS)}] ${label}`)
        onProgress?.(step, TOTAL_STEPS, label)
        await new Promise((r) => {
            requestAnimationFrame(r)
        })
    }
    if (datums.length === 0) throw new Error("No datums provided.")

    // Load source image into a canvas
    let srcCanvas: HTMLCanvasElement
    if (image instanceof HTMLCanvasElement) {
        srcCanvas = image
        log("input", `canvas ${String(image.width)}×${String(image.height)}`)
    } else {
        srcCanvas = document.createElement("canvas")
        srcCanvas.width = image.naturalWidth
        srcCanvas.height = image.naturalHeight
        log(
            "input",
            `img ${String(image.naturalWidth)}×${String(image.naturalHeight)}`,
        )
        const ctx = srcCanvas.getContext("2d")
        if (!ctx) throw new Error("Failed to get 2d context")
        ctx.drawImage(image, 0, 0)
    }

    await progress(0, "Loading image into OpenCV")

    const mats: InstanceType<typeof cv.Mat>[] = []
    const track = <T extends InstanceType<typeof cv.Mat>>(m: T): T => {
        mats.push(m)
        return m
    }

    try {
        const src = track(cv.imread(srcCanvas))
        const imgW = src.cols
        const imgH = src.rows
        log(
            "cv.imread",
            `${String(imgW)}×${String(imgH)}, channels=${String(src.channels())}`,
        )

        // ========================================================
        // STEP 1 — Solve homography (outer loop around findHomography)
        // ========================================================
        await progress(1, "Solving homography")
        const solved = solveHomographyForDatums(datums, scale)
        const H = solved.H
        log(
            "solve",
            `primary=${solved.primaryLabel} (${solved.primaryType}), iters=${String(solved.iterations)}, rms=${solved.rmsPercent.toFixed(3)}%`,
        )

        // ========================================================
        // STEP 2 — Compute output bounds and translation shift
        // ========================================================
        await progress(2, "Computing output bounds")
        const imgCorners: Point[] = [
            { x: 0, y: 0 },
            { x: imgW, y: 0 },
            { x: 0, y: imgH },
            { x: imgW, y: imgH },
        ]
        const warped = projectPoints(H, imgCorners)

        let xMin = Infinity
        let yMin = Infinity
        let xMax = -Infinity
        let yMax = -Infinity
        for (const c of warped) {
            xMin = Math.min(xMin, c.x)
            yMin = Math.min(yMin, c.y)
            xMax = Math.max(xMax, c.x)
            yMax = Math.max(yMax, c.y)
        }

        let outW = Math.ceil(xMax - xMin)
        let outH = Math.ceil(yMax - yMin)
        log(
            "bounds",
            `x=[${xMin.toFixed(1)},${xMax.toFixed(1)}], y=[${yMin.toFixed(1)},${yMax.toFixed(1)}]`,
        )
        if (outW <= 0 || outH <= 0) {
            throw new Error(
                `Invalid output dimensions: ${String(outW)}×${String(outH)}`,
            )
        }
        let downscale = 1
        if (outW > MAX_OUTPUT_DIM || outH > MAX_OUTPUT_DIM) {
            downscale = MAX_OUTPUT_DIM / Math.max(outW, outH)
            outW = Math.ceil(outW * downscale)
            outH = Math.ceil(outH * downscale)
            log("bounds", `clamped by ${downscale.toFixed(4)} → ${String(outW)}×${String(outH)}`)
        }

        // Compose a shift (translation + optional downscale) with H so the
        // top-left corner of the warped image lands at (0, 0).
        const tShift: Mat3 = [
            downscale,
            0,
            -xMin * downscale,
            0,
            downscale,
            -yMin * downscale,
            0,
            0,
            1,
        ]
        const mOutData = mul3x3(tShift, H)
        const mOut = track(cv.matFromArray(3, 3, cv.CV_64FC1, mOutData))

        // ========================================================
        // STEP 3 — Warp
        // ========================================================
        await progress(3, "Warping image")
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

        // ========================================================
        // STEP 4 — Export
        // ========================================================
        await progress(4, "Encoding output")
        const outCanvas = document.createElement("canvas")
        outCanvas.width = outW
        outCanvas.height = outH
        cv.imshow(outCanvas, dstMat)
        const blob = await canvasToBlob(outCanvas, "image/png", 0.95)
        log("export", `blob ${String(Math.round(blob.size / 1024))} KB`)

        const diagnostics: DeskewDiagnostics = {
            primaryDatum: solved.primaryLabel,
            iterations: solved.iterations,
            finalRMSPercent: solved.rmsPercent,
            perDatum: solved.reports,
            outputWidthPx: outW,
            outputHeightPx: outH,
        }

        return { correctedImageBlob: blob, diagnostics }
    } finally {
        for (const m of mats) {
            try {
                m.delete()
            } catch {
                // already deleted — ignore
            }
        }
    }
}

// ─── OpenCV init ────────────────────────────────────────────────────────────

let cvReady = false

/** Wait for OpenCV WASM to initialize. Call once at app startup. */
export function waitForOpenCV(): Promise<void> {
    return new Promise<void>((resolve) => {
        if (cvReady) {
            resolve()
            return
        }
        try {
            const test = new cv.Mat()
            test.delete()
            cvReady = true
            resolve()
            return
        } catch {
            // Runtime not ready yet
        }
        cv.onRuntimeInitialized = () => {
            cvReady = true
            resolve()
        }
    })
}
