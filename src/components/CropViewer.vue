<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue"
import { useAppStore } from "@/stores/app"
import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { saveCropRotate, loadCropRotate } from "@/lib/crop-cache"
import { rotatedBboxSize } from "@/lib/crop-transform"
import type { Point } from "@/types"

// Crop & Rotate step.
//   * The user picks an arbitrary rotation in degrees (-180..180).
//   * Rotation is applied first, around the deskewed image's centre.
//     The rotated bitmap's axis-aligned bounding box is the canvas the
//     crop rectangle lives in.
//   * The crop rectangle is then dragged via 8 handles (4 corners + 4
//     edge midpoints). It's stored as fractions of the rotated bbox so
//     the same crop survives a re-deskew at a different output px/mm.
//
// Persistence: identical pattern to measurement-cache.ts, keyed by
// `store.fileHash`. We write to localStorage on every change.

const store = useAppStore()

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLCanvasElement | null>(null)

const img = ref<HTMLImageElement | null>(null)
const imgUrl = ref<string | null>(null)
// Set when the deskew blob fails to decode — corrupt result, OOM in the
// decoder, or unsupported format. We surface a small fallback UI so the
// user can navigate back to step 4 and retry instead of staring at a
// permanently blank canvas.
const loadError = ref(false)

// Single source of truth: `store.cropRotate`. Rotations and crop drags
// update the store directly so the live state and the persisted state
// can never drift mid-interaction. localStorage is only written on
// explicit commit (drag end, rotation change, unmount) via
// `flushToCache()` — that keeps the store hot without thrashing the
// disk on every pointermove.
const rotationDeg = computed(() => store.cropRotate.rotationDeg)
const cropLeft = computed(() => store.cropRotate.crop.left)
const cropTop = computed(() => store.cropRotate.crop.top)
const cropRight = computed(() => store.cropRotate.crop.right)
const cropBottom = computed(() => store.cropRotate.crop.bottom)

function setRotationOnly(deg: number) {
    store.setCropRotate({ ...store.cropRotate, rotationDeg: deg })
}

function setCropOnly(crop: {
    left: number
    top: number
    right: number
    bottom: number
}) {
    store.setCropRotate({ ...store.cropRotate, crop })
}

// Live-fit transform from rotated-bbox space → screen canvas pixels.
// Recomputed on resize / rotation change so the user always sees the
// whole bbox + a bit of breathing room.
const fitScale = ref(1)
const fitOffsetX = ref(0)
const fitOffsetY = ref(0)

const HANDLE_HIT_PX = 14

const rotBbox = computed(() => {
    const i = img.value
    if (!i) return { rotW: 1, rotH: 1 }
    return rotatedBboxSize(i.naturalWidth, i.naturalHeight, rotationDeg.value)
})

function flushToCache() {
    if (!store.fileHash) return
    saveCropRotate(store.fileHash, store.cropRotate)
}

function loadImage(url: string) {
    const el = new Image()
    el.onload = () => {
        loadError.value = false
        img.value = el
        fitToContainer()
        redraw()
    }
    el.onerror = () => {
        loadError.value = true
    }
    el.src = url
}

function fitToContainer() {
    const c = containerRef.value
    const i = img.value
    if (!c || !i) return
    const cw = c.clientWidth
    const ch = c.clientHeight
    if (canvasRef.value) {
        canvasRef.value.width = cw
        canvasRef.value.height = ch
    }
    if (overlayRef.value) {
        overlayRef.value.width = cw
        overlayRef.value.height = ch
    }
    const { rotW, rotH } = rotBbox.value
    const fit = Math.min(cw / rotW, ch / rotH) * 0.9
    fitScale.value = fit
    fitOffsetX.value = (cw - rotW * fit) / 2
    fitOffsetY.value = (ch - rotH * fit) / 2
}

function rotatedToScreen(p: Point): Point {
    return {
        x: p.x * fitScale.value + fitOffsetX.value,
        y: p.y * fitScale.value + fitOffsetY.value,
    }
}

function screenToRotated(sx: number, sy: number): Point {
    return {
        x: (sx - fitOffsetX.value) / fitScale.value,
        y: (sy - fitOffsetY.value) / fitScale.value,
    }
}

function redraw() {
    drawImage()
    drawOverlay()
}

function drawImage() {
    const canvas = canvasRef.value
    const i = img.value
    if (!canvas || !i) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const { rotW, rotH } = rotBbox.value

    ctx.save()
    // Place rotated-bbox origin at fit offset, then scale.
    ctx.translate(fitOffsetX.value, fitOffsetY.value)
    ctx.scale(fitScale.value, fitScale.value)
    // Rotation around the bbox centre — cancels back to deskewed-image
    // axis-aligned drawing offset by (rotW-srcW)/2 etc.
    ctx.translate(rotW / 2, rotH / 2)
    ctx.rotate((rotationDeg.value * Math.PI) / 180)
    ctx.drawImage(i, -i.naturalWidth / 2, -i.naturalHeight / 2)
    ctx.restore()
}

function cropRectScreen(): { x: number; y: number; w: number; h: number } {
    const { rotW, rotH } = rotBbox.value
    const tl = rotatedToScreen({ x: cropLeft.value * rotW, y: cropTop.value * rotH })
    const br = rotatedToScreen({ x: cropRight.value * rotW, y: cropBottom.value * rotH })
    return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }
}

function drawOverlay() {
    const canvas = overlayRef.value
    const i = img.value
    if (!canvas || !i) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const r = cropRectScreen()

    // Dim everything outside the crop rect with a 50% black overlay.
    // Draw a full-canvas dark fill with a punched-out hole — fillRect +
    // even-odd fill is overkill; clipping with two rects is simpler.
    ctx.save()
    ctx.fillStyle = "rgba(0,0,0,0.55)"
    ctx.fillRect(0, 0, canvas.width, r.y)
    ctx.fillRect(0, r.y + r.h, canvas.width, canvas.height - (r.y + r.h))
    ctx.fillRect(0, r.y, r.x, r.h)
    ctx.fillRect(r.x + r.w, r.y, canvas.width - (r.x + r.w), r.h)
    ctx.restore()

    // Crop rectangle outline.
    ctx.save()
    ctx.strokeStyle = "#fff"
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 4])
    ctx.strokeRect(r.x, r.y, r.w, r.h)
    ctx.restore()

    // Rule-of-thirds guides — light grey, no dash.
    ctx.save()
    ctx.strokeStyle = "rgba(255,255,255,0.25)"
    ctx.lineWidth = 1
    for (let k = 1; k < 3; k++) {
        const x = r.x + (r.w * k) / 3
        ctx.beginPath()
        ctx.moveTo(x, r.y)
        ctx.lineTo(x, r.y + r.h)
        ctx.stroke()
        const y = r.y + (r.h * k) / 3
        ctx.beginPath()
        ctx.moveTo(r.x, y)
        ctx.lineTo(r.x + r.w, y)
        ctx.stroke()
    }
    ctx.restore()

    // Handle dots: 4 corners + 4 edge midpoints.
    const handles = handlePositionsScreen()
    ctx.save()
    ctx.fillStyle = "#fff"
    ctx.strokeStyle = "rgba(0,0,0,0.5)"
    ctx.lineWidth = 1
    for (const h of handles) {
        ctx.beginPath()
        ctx.arc(h.pt.x, h.pt.y, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
    }
    ctx.restore()
}

type HandleKey =
    | "tl" | "tr" | "br" | "bl"
    | "t" | "r" | "b" | "l"

function handlePositionsScreen(): { key: HandleKey; pt: Point }[] {
    const r = cropRectScreen()
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    return [
        { key: "tl", pt: { x: r.x, y: r.y } },
        { key: "tr", pt: { x: r.x + r.w, y: r.y } },
        { key: "br", pt: { x: r.x + r.w, y: r.y + r.h } },
        { key: "bl", pt: { x: r.x, y: r.y + r.h } },
        { key: "t", pt: { x: cx, y: r.y } },
        { key: "r", pt: { x: r.x + r.w, y: cy } },
        { key: "b", pt: { x: cx, y: r.y + r.h } },
        { key: "l", pt: { x: r.x, y: cy } },
    ]
}

interface DragState {
    handle: HandleKey | "body"
    /** Crop in fractions at drag start, used as the base for delta updates. */
    startLeft: number
    startTop: number
    startRight: number
    startBottom: number
    /** Pointer position in rotated-bbox space at drag start. */
    startRot: Point
}
let drag: DragState | null = null

function pickHandle(sx: number, sy: number): HandleKey | null {
    for (const h of handlePositionsScreen()) {
        if (Math.hypot(sx - h.pt.x, sy - h.pt.y) <= HANDLE_HIT_PX) return h.key
    }
    return null
}

function onPointerDown(ev: PointerEvent) {
    const canvas = overlayRef.value
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const sx = ev.clientX - rect.left
    const sy = ev.clientY - rect.top
    const handle = pickHandle(sx, sy)
    const r = cropRectScreen()
    const insideBody =
        handle === null &&
        sx >= r.x && sx <= r.x + r.w &&
        sy >= r.y && sy <= r.y + r.h
    if (!handle && !insideBody) return
    canvas.setPointerCapture(ev.pointerId)
    drag = {
        handle: handle ?? "body",
        startLeft: cropLeft.value,
        startTop: cropTop.value,
        startRight: cropRight.value,
        startBottom: cropBottom.value,
        startRot: screenToRotated(sx, sy),
    }
}

function onPointerMove(ev: PointerEvent) {
    if (!drag) return
    const canvas = overlayRef.value
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const sx = ev.clientX - rect.left
    const sy = ev.clientY - rect.top
    const cur = screenToRotated(sx, sy)
    const { rotW, rotH } = rotBbox.value
    const dx = (cur.x - drag.startRot.x) / rotW
    const dy = (cur.y - drag.startRot.y) / rotH

    const minSize = 0.05 // 5% minimum width/height to keep the crop usable.
    let l = drag.startLeft
    let t = drag.startTop
    let r2 = drag.startRight
    let b = drag.startBottom

    const k = drag.handle
    if (k === "body") {
        const w = drag.startRight - drag.startLeft
        const h = drag.startBottom - drag.startTop
        let nl = drag.startLeft + dx
        let nt = drag.startTop + dy
        nl = Math.min(Math.max(nl, 0), 1 - w)
        nt = Math.min(Math.max(nt, 0), 1 - h)
        l = nl
        t = nt
        r2 = nl + w
        b = nt + h
    } else {
        if (k === "tl" || k === "l" || k === "bl") {
            l = Math.min(Math.max(drag.startLeft + dx, 0), drag.startRight - minSize)
        }
        if (k === "tr" || k === "r" || k === "br") {
            r2 = Math.min(Math.max(drag.startRight + dx, drag.startLeft + minSize), 1)
        }
        if (k === "tl" || k === "t" || k === "tr") {
            t = Math.min(Math.max(drag.startTop + dy, 0), drag.startBottom - minSize)
        }
        if (k === "bl" || k === "b" || k === "br") {
            b = Math.min(Math.max(drag.startBottom + dy, drag.startTop + minSize), 1)
        }
    }

    setCropOnly({ left: l, top: t, right: r2, bottom: b })
    drawOverlay()
}

function onPointerUp(ev: PointerEvent) {
    const canvas = overlayRef.value
    if (canvas?.hasPointerCapture(ev.pointerId)) {
        canvas.releasePointerCapture(ev.pointerId)
    }
    if (drag) {
        drag = null
        flushToCache()
    }
}

function resetCrop() {
    store.resetCropRotate()
    flushToCache()
    fitToContainer()
    redraw()
}

function onRotationInput(v: number) {
    if (!Number.isFinite(v)) return
    // Clamp to [-180, 180] and normalise so the slider/spinbox can't escape.
    const clamped = Math.min(Math.max(v, -180), 180)
    setRotationOnly(clamped)
    fitToContainer()
    redraw()
    flushToCache()
}

function rotateBy(delta: number) {
    onRotationInput(rotationDeg.value + delta)
}

let resizeObs: ResizeObserver | null = null

onMounted(() => {
    if (!store.deskewResult) {
        store.goToStep(4)
        return
    }
    // Hydrate the store from cache if we have one; otherwise the store
    // already holds whatever was set the last time the user came through
    // (or `IDENTITY_CROP_ROTATE` on a fresh session). Either way the
    // computed refs above will surface the correct values.
    const cached = store.fileHash ? loadCropRotate(store.fileHash) : null
    if (cached) store.setCropRotate(cached)

    imgUrl.value = URL.createObjectURL(store.deskewResult.correctedImageBlob)
    loadImage(imgUrl.value)

    if (containerRef.value) {
        resizeObs = new ResizeObserver(() => {
            fitToContainer()
            redraw()
        })
        resizeObs.observe(containerRef.value)
    }
})

onUnmounted(() => {
    // The store is already canonical (drag handlers wrote through), but
    // localStorage only flushes on commit boundaries — if the user navigates
    // away mid-drag, push the current store state to disk so the cache
    // matches what's on screen.
    flushToCache()
    resizeObs?.disconnect()
    if (imgUrl.value) URL.revokeObjectURL(imgUrl.value)
})

watch(rotationDeg, () => {
    fitToContainer()
    redraw()
})

watch([cropLeft, cropTop, cropRight, cropBottom], () => {
    drawOverlay()
})

function next() {
    flushToCache()
    store.goToStep(6)
}
</script>

<template>
    <div class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
                <h2 class="text-xl font-semibold">Crop &amp; Rotate</h2>
                <p class="text-sm text-muted-foreground">
                    Optionally rotate and crop the deskewed image before
                    measuring.
                </p>
            </div>
            <div class="flex shrink-0 gap-2">
                <Button variant="outline" @click="store.goToStep(4)">Back</Button>
                <Button variant="outline" @click="resetCrop">Reset</Button>
                <Button @click="next">Next: Measure</Button>
            </div>
        </div>

        <Card>
            <CardHeader class="space-y-2">
                <CardTitle class="text-base">Rotation</CardTitle>
                <div class="flex flex-wrap items-center gap-3">
                    <input
                        type="range"
                        min="-180"
                        max="180"
                        step="0.1"
                        :value="rotationDeg"
                        class="h-2 w-full max-w-md flex-1 accent-primary"
                        @input="(e) => onRotationInput(Number((e.target as HTMLInputElement).value))"
                    />
                    <div class="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="sm"
                            class="h-8 px-2"
                            @click="rotateBy(-90)"
                            >-90°</Button
                        >
                        <Button
                            variant="outline"
                            size="sm"
                            class="h-8 px-2"
                            @click="rotateBy(-1)"
                            >-1°</Button
                        >
                        <input
                            type="number"
                            min="-180"
                            max="180"
                            step="0.1"
                            :value="rotationDeg.toFixed(1)"
                            class="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm"
                            @input="(e) => onRotationInput(Number((e.target as HTMLInputElement).value))"
                        />
                        <span class="text-sm text-muted-foreground">°</span>
                        <Button
                            variant="outline"
                            size="sm"
                            class="h-8 px-2"
                            @click="rotateBy(1)"
                            >+1°</Button
                        >
                        <Button
                            variant="outline"
                            size="sm"
                            class="h-8 px-2"
                            @click="rotateBy(90)"
                            >+90°</Button
                        >
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div
                    ref="containerRef"
                    class="relative h-[calc(100vh-22rem)] min-h-[320px] w-full overflow-hidden rounded-md bg-muted"
                >
                    <canvas
                        ref="canvasRef"
                        class="absolute inset-0"
                    />
                    <canvas
                        ref="overlayRef"
                        class="absolute inset-0 touch-none"
                        @pointerdown="onPointerDown"
                        @pointermove="onPointerMove"
                        @pointerup="onPointerUp"
                        @pointercancel="onPointerUp"
                    />
                    <div
                        v-if="loadError"
                        class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center"
                    >
                        <p class="text-sm font-medium text-destructive">
                            Failed to load the deskew result.
                        </p>
                        <p class="text-xs text-muted-foreground">
                            The image blob couldn't be decoded. Re-run the
                            perspective correction in the previous step.
                        </p>
                        <Button
                            variant="outline"
                            size="sm"
                            @click="store.goToStep(4)"
                            >Back to Deskew</Button
                        >
                    </div>
                </div>
            </CardContent>
        </Card>
    </div>
</template>
