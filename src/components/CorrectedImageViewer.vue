<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue"
import type { Point } from "@/types"

const props = defineProps<{
    imageUrl: string
    scalePxPerMm: number
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLCanvasElement | null>(null)

const img = ref<HTMLImageElement | null>(null)
const imgLoaded = ref(false)

// View state
const viewScale = ref(1)
const viewOffsetX = ref(0)
const viewOffsetY = ref(0)

// Tool state
const activeTool = ref<"none" | "measure">("none")
const showGrid = ref(false)
const gridSpacingMm = ref(10)

// Measurement state
const measurePoints = ref<Point[]>([])
const measureHistory = ref<{ a: Point; b: Point; distMm: number }[]>([])

// Touch/pan state
let isPanning = false
let panStart = { x: 0, y: 0 }
let lastPinchDist = 0

const measureDistMm = computed(() => {
    if (measurePoints.value.length < 2) return null
    const [a, b] = measurePoints.value as [Point, Point]
    const dxPx = b.x - a.x
    const dyPx = b.y - a.y
    const distPx = Math.hypot(dxPx, dyPx)
    return distPx / props.scalePxPerMm
})

function loadImg() {
    const image = new Image()
    image.onload = () => {
        img.value = image
        imgLoaded.value = true
        fitToContainer()
        redraw()
    }
    image.src = props.imageUrl
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

    const fit = Math.min(cw / i.naturalWidth, ch / i.naturalHeight) * 0.95
    viewScale.value = fit
    viewOffsetX.value = (cw - i.naturalWidth * fit) / 2
    viewOffsetY.value = (ch - i.naturalHeight * fit) / 2
}

function redraw() {
    drawImage()
    drawOverlay()
}

function drawImage() {
    const canvas = canvasRef.value
    const image = img.value
    if (!canvas || !image) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.translate(viewOffsetX.value, viewOffsetY.value)
    ctx.scale(viewScale.value, viewScale.value)
    ctx.drawImage(image, 0, 0)
    ctx.restore()
}

function drawOverlay() {
    const canvas = overlayRef.value
    const image = img.value
    if (!canvas || !image) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()

    // Grid
    if (showGrid.value) {
        drawGrid(ctx, image)
    }

    // Measurement history
    for (const m of measureHistory.value) {
        drawMeasureLine(ctx, m.a, m.b, m.distMm, "rgba(100,180,255,0.5)")
    }

    // Active measurement
    if (measurePoints.value.length >= 2) {
        const [a, b] = measurePoints.value as [Point, Point]
        drawMeasureLine(ctx, a, b, measureDistMm.value ?? 0, "#3b82f6")
    }

    // Measurement points
    for (const pt of measurePoints.value) {
        drawPoint(ctx, pt, "#3b82f6")
    }

    ctx.restore()
}

function drawGrid(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
) {
    const spacingPx = gridSpacingMm.value * props.scalePxPerMm
    if (spacingPx <= 0) return

    const w = image.naturalWidth
    const h = image.naturalHeight

    ctx.save()
    ctx.translate(viewOffsetX.value, viewOffsetY.value)
    ctx.scale(viewScale.value, viewScale.value)

    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)"
    ctx.lineWidth = 1 / viewScale.value

    // Vertical lines
    for (let x = 0; x <= w; x += spacingPx) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
    }
    // Horizontal lines
    for (let y = 0; y <= h; y += spacingPx) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
    }

    // Major lines every 5 intervals
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)"
    ctx.lineWidth = 1.5 / viewScale.value
    const major = spacingPx * 5
    for (let x = 0; x <= w; x += major) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
    }
    for (let y = 0; y <= h; y += major) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
    }

    // Labels on major lines
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)"
    const fontSize = Math.max(10, 12 / viewScale.value)
    ctx.font = `${String(fontSize)}px monospace`
    for (let x = major; x <= w; x += major) {
        const mm = x / props.scalePxPerMm
        ctx.fillText(mm.toFixed(0), x + 2 / viewScale.value, fontSize + 2 / viewScale.value)
    }
    for (let y = major; y <= h; y += major) {
        const mm = y / props.scalePxPerMm
        ctx.fillText(mm.toFixed(0), 2 / viewScale.value, y - 2 / viewScale.value)
    }

    ctx.restore()
}

function imgToScreen(pt: Point): Point {
    return {
        x: pt.x * viewScale.value + viewOffsetX.value,
        y: pt.y * viewScale.value + viewOffsetY.value,
    }
}

function drawMeasureLine(
    ctx: CanvasRenderingContext2D,
    a: Point,
    b: Point,
    distMm: number,
    color: string,
) {
    const sa = imgToScreen(a)
    const sb = imgToScreen(b)

    ctx.beginPath()
    ctx.moveTo(sa.x, sa.y)
    ctx.lineTo(sb.x, sb.y)
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.setLineDash([6, 3])
    ctx.stroke()
    ctx.setLineDash([])

    // Label
    const mx = (sa.x + sb.x) / 2
    const my = (sa.y + sb.y) / 2
    const label = distMm >= 10
        ? `${distMm.toFixed(1)} mm`
        : `${distMm.toFixed(2)} mm`

    ctx.font = "bold 13px monospace"
    const metrics = ctx.measureText(label)
    const pad = 4
    const tw = metrics.width + pad * 2
    const th = 18

    ctx.fillStyle = "rgba(0, 0, 0, 0.75)"
    ctx.fillRect(mx - tw / 2, my - th / 2 - 10, tw, th)
    ctx.fillStyle = "#fff"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(label, mx, my - 10)
    ctx.textAlign = "start"
    ctx.textBaseline = "alphabetic"
}

function drawPoint(
    ctx: CanvasRenderingContext2D,
    pt: Point,
    color: string,
) {
    const s = imgToScreen(pt)
    ctx.beginPath()
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = "#fff"
    ctx.lineWidth = 1.5
    ctx.stroke()
}

// Convert screen coords to image coords
function screenToImg(sx: number, sy: number): Point {
    return {
        x: (sx - viewOffsetX.value) / viewScale.value,
        y: (sy - viewOffsetY.value) / viewScale.value,
    }
}

function getCanvasXY(e: MouseEvent | Touch): { x: number; y: number } {
    const rect = overlayRef.value?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function onCanvasClick(e: MouseEvent) {
    if (activeTool.value !== "measure") return

    const { x, y } = getCanvasXY(e)
    const imgPt = screenToImg(x, y)

    if (measurePoints.value.length < 2) {
        measurePoints.value.push(imgPt)
    } else {
        // Save previous measurement and start new
        const [a, b] = measurePoints.value as [Point, Point]
        measureHistory.value.push({
            a,
            b,
            distMm: measureDistMm.value ?? 0,
        })
        measurePoints.value = [imgPt]
    }
    drawOverlay()
}

function onWheel(e: WheelEvent) {
    e.preventDefault()
    const scaleBy = 1.08
    const oldScale = viewScale.value
    const newScale = e.deltaY < 0
        ? oldScale * scaleBy
        : oldScale / scaleBy
    const clamped = Math.max(0.05, Math.min(20, newScale))

    const { x: px, y: py } = getCanvasXY(e)
    const imgPt = screenToImg(px, py)

    viewScale.value = clamped
    viewOffsetX.value = px - imgPt.x * clamped
    viewOffsetY.value = py - imgPt.y * clamped
    redraw()
}

function onMouseDown(e: MouseEvent) {
    if (activeTool.value === "measure") return
    isPanning = true
    panStart = { x: e.clientX - viewOffsetX.value, y: e.clientY - viewOffsetY.value }
}

function onMouseMove(e: MouseEvent) {
    if (!isPanning) return
    viewOffsetX.value = e.clientX - panStart.x
    viewOffsetY.value = e.clientY - panStart.y
    redraw()
}

function onMouseUp() {
    isPanning = false
}

function onTouchStart(e: TouchEvent) {
    const t0 = e.touches[0]
    const t1 = e.touches[1]
    if (e.touches.length === 2 && t0 && t1) {
        e.preventDefault()
        lastPinchDist = Math.hypot(
            t1.clientX - t0.clientX,
            t1.clientY - t0.clientY,
        )
    } else if (e.touches.length === 1 && t0 && activeTool.value !== "measure") {
        isPanning = true
        panStart = {
            x: t0.clientX - viewOffsetX.value,
            y: t0.clientY - viewOffsetY.value,
        }
    }
}

function onTouchMove(e: TouchEvent) {
    const t0 = e.touches[0]
    const t1 = e.touches[1]
    if (e.touches.length === 2 && t0 && t1) {
        e.preventDefault()
        const dist = Math.hypot(
            t1.clientX - t0.clientX,
            t1.clientY - t0.clientY,
        )
        const factor = dist / lastPinchDist
        const oldScale = viewScale.value
        const newScale = Math.max(0.05, Math.min(20, oldScale * factor))

        const rect = overlayRef.value?.getBoundingClientRect()
        if (!rect) return
        const cx = (t0.clientX + t1.clientX) / 2 - rect.left
        const cy = (t0.clientY + t1.clientY) / 2 - rect.top
        const imgPt = screenToImg(cx, cy)

        viewScale.value = newScale
        viewOffsetX.value = cx - imgPt.x * newScale
        viewOffsetY.value = cy - imgPt.y * newScale

        lastPinchDist = dist
        redraw()
    } else if (e.touches.length === 1 && t0 && isPanning) {
        viewOffsetX.value = t0.clientX - panStart.x
        viewOffsetY.value = t0.clientY - panStart.y
        redraw()
    }
}

function onTouchEnd() {
    isPanning = false
    lastPinchDist = 0
}

function toggleMeasure() {
    if (activeTool.value === "measure") {
        activeTool.value = "none"
    } else {
        activeTool.value = "measure"
        measurePoints.value = []
    }
    drawOverlay()
}

function clearMeasurements() {
    measurePoints.value = []
    measureHistory.value = []
    drawOverlay()
}

// Scale bar export
function exportWithScaleBar(): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const image = img.value
        if (!image) {
            console.error("[scale-bar] img.value is null")
            reject(new Error("No image loaded for scale bar export"))
            return
        }

        const iw = image.naturalWidth
        const ih = image.naturalHeight
        console.log(`[scale-bar] image ${String(iw)}×${String(ih)}, scale=${String(props.scalePxPerMm)} px/mm`)

        // Scale font/bar sizes relative to image width
        const unit = Math.max(iw / 100, 8)
        const barHeightPx = Math.round(unit * 5)
        const canvas = document.createElement("canvas")
        canvas.width = iw
        canvas.height = ih + barHeightPx

        const ctx = canvas.getContext("2d")
        if (!ctx) {
            reject(new Error("No 2D context"))
            return
        }

        // Draw image
        ctx.drawImage(image, 0, 0)

        // Draw bar background
        ctx.fillStyle = "#000"
        ctx.fillRect(0, ih, iw, barHeightPx)

        // Determine a nice scale bar length (~20% of image width)
        const imgWidthMm = iw / props.scalePxPerMm
        const niceSteps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
        const targetMm = imgWidthMm * 0.2
        let barMm = niceSteps[0] ?? 10
        for (const s of niceSteps) {
            barMm = s
            if (s >= targetMm) break
        }
        const barWidthPx = barMm * props.scalePxPerMm

        const margin = Math.round(unit * 2)
        const barX = margin
        const barY = ih + barHeightPx / 2
        const barThick = Math.max(Math.round(unit * 0.6), 4)
        const tickH = Math.round(unit * 1.5)

        console.log(`[scale-bar] barMm=${String(barMm)}, barWidthPx=${barWidthPx.toFixed(0)}, barHeight=${String(barHeightPx)}, unit=${unit.toFixed(1)}`)

        // Draw bar
        ctx.fillStyle = "#fff"
        ctx.fillRect(barX, barY - barThick / 2, barWidthPx, barThick)

        // End ticks
        ctx.fillRect(barX, barY - tickH / 2, Math.max(2, unit * 0.15), tickH)
        ctx.fillRect(barX + barWidthPx - Math.max(2, unit * 0.15), barY - tickH / 2, Math.max(2, unit * 0.15), tickH)

        // Label above bar
        const fontSize = Math.round(unit * 1.4)
        const label = `${String(barMm)} mm`
        ctx.font = `bold ${String(fontSize)}px monospace`
        ctx.fillStyle = "#fff"
        ctx.textAlign = "center"
        ctx.textBaseline = "bottom"
        ctx.fillText(label, barX + barWidthPx / 2, barY - tickH / 2 - Math.round(unit * 0.3))

        // Scale info on the right
        const smallFont = Math.round(unit * 1)
        ctx.textAlign = "right"
        ctx.textBaseline = "middle"
        ctx.font = `${String(smallFont)}px monospace`
        ctx.fillStyle = "rgba(255,255,255,0.6)"
        ctx.fillText(
            `${String(props.scalePxPerMm)} px/mm`,
            iw - margin,
            barY,
        )

        canvas.toBlob((b) => {
            console.log(`[scale-bar] blob: ${b ? String(Math.round(b.size / 1024)) + " KB" : "NULL"}`)
            if (b) resolve(b)
            else reject(new Error("toBlob failed"))
        }, "image/png")
    })
}

defineExpose({ exportWithScaleBar })

let resizeObs: ResizeObserver | null = null

onMounted(() => {
    loadImg()
    if (containerRef.value) {
        resizeObs = new ResizeObserver(() => {
            const c = containerRef.value
            if (!c || c.clientWidth === 0) return
            fitToContainer()
            redraw()
        })
        resizeObs.observe(containerRef.value)
    }
})

onUnmounted(() => {
    resizeObs?.disconnect()
})

watch(() => props.imageUrl, loadImg)
watch(showGrid, () => { drawOverlay() })
watch(gridSpacingMm, () => { drawOverlay() })
</script>

<template>
    <div class="space-y-3">
        <!-- Toolbar -->
        <div class="flex flex-wrap items-center gap-2 text-sm">
            <button
                class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors"
                :class="
                    activeTool === 'measure'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                "
                @click="toggleMeasure"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
                    <path d="m14.5 12.5 2-2" />
                    <path d="m11.5 9.5 2-2" />
                    <path d="m8.5 6.5 2-2" />
                    <path d="m17.5 15.5 2-2" />
                </svg>
                Measure
            </button>

            <button
                v-if="measureHistory.length > 0 || measurePoints.length > 0"
                class="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-destructive"
                @click="clearMeasurements"
            >
                Clear
            </button>

            <div class="mx-1 h-4 w-px bg-border" />

            <label
                class="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
            >
                <input
                    v-model="showGrid"
                    type="checkbox"
                    class="accent-primary"
                />
                Grid
            </label>

            <input
                v-if="showGrid"
                v-model.number="gridSpacingMm"
                type="number"
                min="1"
                max="1000"
                class="w-16 rounded-md border border-border bg-transparent px-2 py-1 font-mono text-xs"
            />
            <span
                v-if="showGrid"
                class="font-mono text-xs text-muted-foreground"
                >mm</span
            >
        </div>

        <!-- Measurement readout -->
        <div
            v-if="activeTool === 'measure'"
            class="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
        >
            <template v-if="measurePoints.length === 0">
                Click two points on the image to measure distance.
            </template>
            <template v-else-if="measurePoints.length === 1">
                Click a second point.
            </template>
            <template v-else-if="measureDistMm != null">
                Distance:
                <span class="font-mono font-semibold">
                    {{ measureDistMm >= 10
                        ? measureDistMm.toFixed(1)
                        : measureDistMm.toFixed(2)
                    }} mm
                </span>
                <span class="ml-2 text-muted-foreground">
                    (click to start a new measurement)
                </span>
            </template>
        </div>

        <!-- Canvas area -->
        <div
            ref="containerRef"
            class="relative h-[500px] overflow-hidden rounded-lg border border-border bg-muted"
            :class="activeTool === 'measure' ? 'cursor-crosshair' : 'cursor-grab'"
        >
            <canvas
                ref="canvasRef"
                class="absolute inset-0"
            />
            <canvas
                ref="overlayRef"
                class="absolute inset-0"
                @click="onCanvasClick"
                @wheel.prevent="onWheel"
                @mousedown="onMouseDown"
                @mousemove="onMouseMove"
                @mouseup="onMouseUp"
                @mouseleave="onMouseUp"
                @touchstart="onTouchStart"
                @touchmove="onTouchMove"
                @touchend="onTouchEnd"
            />
        </div>
    </div>
</template>
