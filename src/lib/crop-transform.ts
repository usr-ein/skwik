import type { CropRotateState } from "@/types"

// Pure geometry helpers for the Crop & Rotate step. The pipeline:
//   1. Start in "deskewed image space" (the bitmap produced by the
//      solver, dimensions deskewW × deskewH).
//   2. Rotate around the deskewed image's centre by `rotationDeg`.
//      The rotated bitmap is the axis-aligned bounding box of the
//      rotated rectangle (rotW × rotH); the original corners get
//      translated so the bbox starts at (0, 0).
//   3. Crop a sub-rectangle of that rotated bitmap, defined by
//      fractions `crop.left/top/right/bottom` of its size.
// Measurements live in deskewed-image space; the renderer composes this
// transform on top of the live pan/zoom to project them onto the cropped
// bitmap, which is what the user is actually looking at.
//
// DOM rasterisation lives in `crop-render.ts`. This module stays pure so
// the geometry can run in a worker / be tested without a canvas mock.

interface RotatedSize {
    rotW: number
    rotH: number
}

/** Bounding box dimensions of `srcW × srcH` rotated by `rotationDeg`
 *  around its centre. */
export function rotatedBboxSize(
    srcW: number,
    srcH: number,
    rotationDeg: number,
): RotatedSize {
    const r = (rotationDeg * Math.PI) / 180
    const c = Math.abs(Math.cos(r))
    const s = Math.abs(Math.sin(r))
    return {
        rotW: srcW * c + srcH * s,
        rotH: srcW * s + srcH * c,
    }
}

interface CropPixels {
    cropX: number
    cropY: number
    cropW: number
    cropH: number
}

/** Pixel-space crop rect on the rotated bitmap, derived from the
 *  fractional crop. Clamped to the rotated bbox so a stale fraction
 *  never produces a negative-size crop. */
export function cropPixels(
    state: CropRotateState,
    rot: RotatedSize,
): CropPixels {
    const left = Math.min(Math.max(state.crop.left, 0), 1)
    const top = Math.min(Math.max(state.crop.top, 0), 1)
    const right = Math.min(Math.max(state.crop.right, left), 1)
    const bottom = Math.min(Math.max(state.crop.bottom, top), 1)
    return {
        cropX: left * rot.rotW,
        cropY: top * rot.rotH,
        cropW: Math.max(1, (right - left) * rot.rotW),
        cropH: Math.max(1, (bottom - top) * rot.rotH),
    }
}
