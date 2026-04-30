import type { CropRotateState } from "@/types"
import { rotatedBboxSize, cropPixels } from "@/lib/crop-transform"

// DOM rasterisation for the Crop & Rotate pipeline. Kept separate from
// `crop-transform.ts` so the pure geometry helpers (rotatedBboxSize,
// cropPixels) stay portable — no canvas / DOM dependency, importable from
// a worker or a Node-based test.

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
