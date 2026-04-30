import type { CropRotateState } from "@/types"

// Geometry helpers for the Crop & Rotate step. The pipeline:
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

/** Render the deskewed bitmap onto a fresh canvas with rotation and
 *  fractional crop applied. Output canvas dims match the cropped sub-
 *  rectangle in pixels. Used to feed Measure/preview/exports. */
export function renderRotatedCropped(
    image: HTMLImageElement | HTMLCanvasElement,
    state: CropRotateState,
): HTMLCanvasElement {
    const srcW = "naturalWidth" in image ? image.naturalWidth : image.width
    const srcH = "naturalHeight" in image ? image.naturalHeight : image.height
    const rot = rotatedBboxSize(srcW, srcH, state.rotationDeg)
    const px = cropPixels(state, rot)

    const out = document.createElement("canvas")
    out.width = Math.round(px.cropW)
    out.height = Math.round(px.cropH)
    const ctx = out.getContext("2d")
    if (!ctx) return out

    // Draw with the deskewed-bitmap-centre→rotated-bbox-centre transform,
    // then translate so the crop's top-left corner becomes (0, 0).
    ctx.save()
    ctx.translate(-px.cropX, -px.cropY)
    ctx.translate(rot.rotW / 2, rot.rotH / 2)
    ctx.rotate((state.rotationDeg * Math.PI) / 180)
    ctx.drawImage(image, -srcW / 2, -srcH / 2)
    ctx.restore()
    return out
}
