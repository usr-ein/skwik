<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue"
import { useMediaQuery } from "@vueuse/core"
import { nanoid } from "nanoid"
import type { Point } from "@/types"
import type {
    LineMeasurement,
    RectMeasurement,
    EllipseMeasurement,
    CircleMeasurement,
    AngleMeasurement,
    Measurement,
} from "@/types/measurements"
import { getDatumColor } from "@/lib/datums"
import { useAppStore } from "@/stores/app"
import { loadMeasurements, saveMeasurements } from "@/lib/measurement-cache"

const props = defineProps<{
    imageUrl: string
    scalePxPerMm: number
}>()

const isMobile = useMediaQuery("(max-width: 767px)")

// Mirror the datum-editor precedent: leave more vertical room for the mobile
// toolbar/chrome than desktop. Keep the canvas and the side list the same
// height so they align on desktop.
const canvasHeightClass = computed(() =>
    isMobile.value ? "h-[calc(100vh-14rem)]" : "h-[calc(100vh-12rem)]",
)

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
type ToolMode = "none" | "line" | "rectangle" | "ellipse" | "circle" | "angle"
const activeTool = ref<ToolMode>("none")
const showGrid = ref(false)
const gridSpacingMm = ref(10)

// Measurement types live in `@/types/measurements` so the cache module and
// other consumers can share them. Geometry is in image space so it stays
// invariant under pan/zoom and survives redraws without reprojection.

const store = useAppStore()

const measurements = ref<Measurement[]>([])
const selectedId = ref<string | null>(null)
// Monotonically increasing counter so deleting a measurement doesn't recolor
// the remaining ones. Each new measurement claims the next palette slot.
// Reset on cache load to `max(loaded.colorIndex) + 1` so newly-added
// measurements continue the sequence rather than reusing old colors.
let colorCounter = 0

function seedFromCache() {
    const hash = store.fileHash
    if (!hash) {
        measurements.value = []
        selectedId.value = null
        colorCounter = 0
        return
    }
    const loaded = loadMeasurements(hash)
    if (loaded && loaded.length > 0) {
        measurements.value = loaded
        selectedId.value = null
        let maxIdx = -1
        for (const m of loaded) {
            if (m.colorIndex > maxIdx) maxIdx = m.colorIndex
        }
        colorCounter = maxIdx + 1
    } else {
        measurements.value = []
        selectedId.value = null
        colorCounter = 0
    }
}

// In-progress placement points (image space) while a placement tool is active.
const placementPoints = ref<Point[]>([])
// Cursor position in image space for the live preview of an in-progress
// placement. Null when the pointer is off-canvas.
const placementCursor = ref<Point | null>(null)

// Touch/pan state
let isPanning = false
let panStart = { x: 0, y: 0 }
let lastPinchDist = 0

// Drag state for moving/reshaping committed measurements. We don't gate
// drag-start on a movement threshold — handles begin tracking the cursor
// on the very first move event so positioning feels precise (matches
// Konva's behaviour in the datum editor). A pure click without movement
// never enters pointerMove, so selection on its own remains drift-free.
type DragMode = "none" | "move" | "handle"
interface DragState {
    mode: DragMode
    measurementId: string
    // For "handle" drag: which handle of the measurement we grabbed.
    handleKey: string | null
    // Image-space coord where the drag started (cursor position).
    startImg: Point
    // Snapshot of the measurement at drag start, for delta-based updates.
    startSnapshot: Measurement
}
let dragState: DragState | null = null

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

    if (showGrid.value) {
        drawGrid(ctx, image)
    }

    const rt = makeLiveCtx()

    // Draw unselected first (faint) so the selected measurement always sits
    // on top with full opacity and its handles aren't occluded.
    for (const m of measurements.value) {
        if (m.id === selectedId.value) continue
        drawMeasurement(ctx, m, false, rt)
    }
    const selected = measurements.value.find((m) => m.id === selectedId.value)
    if (selected) drawMeasurement(ctx, selected, true, rt)

    // Placement preview overlaying everything, in the active tool's color
    // slot (= next palette slot the new measurement will claim).
    if (activeTool.value !== "none" && placementPoints.value.length > 0) {
        drawPlacementPreview(ctx)
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

    for (let x = 0; x <= w; x += spacingPx) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
    }
    for (let y = 0; y <= h; y += spacingPx) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
    }

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

// Render context for drawing measurements. The live overlay constructs one
// from the current view transform; the export path constructs its own so
// the same draw helpers can paint into an offscreen canvas at any scale.
//   scale/offsetX/offsetY: the image→canvas affine to apply.
//   strokeMul: multiplier on stroke widths, font sizes, and handle radii.
//     1 keeps the on-screen visual; >1 scales them up so they read at the
//     same relative size when exporting at a higher pixel resolution.
//   drawHandles: live overlay draws interactive control points; export
//     suppresses them since they're UI, not annotation.
//   drawSelectionDecorations: live overlay highlights the selected
//     measurement with a white outline + dashed unselected siblings;
//     export draws every measurement at full opacity, no dashing.
interface RenderCtx {
    scale: number
    offsetX: number
    offsetY: number
    strokeMul: number
    drawHandles: boolean
    drawSelectionDecorations: boolean
}

function makeLiveCtx(): RenderCtx {
    return {
        scale: viewScale.value,
        offsetX: viewOffsetX.value,
        offsetY: viewOffsetY.value,
        strokeMul: 1,
        drawHandles: true,
        drawSelectionDecorations: true,
    }
}

function imgToCtx(pt: Point, t: RenderCtx): Point {
    return {
        x: pt.x * t.scale + t.offsetX,
        y: pt.y * t.scale + t.offsetY,
    }
}

function imgToScreen(pt: Point): Point {
    return {
        x: pt.x * viewScale.value + viewOffsetX.value,
        y: pt.y * viewScale.value + viewOffsetY.value,
    }
}

function screenToImg(sx: number, sy: number): Point {
    return {
        x: (sx - viewOffsetX.value) / viewScale.value,
        y: (sy - viewOffsetY.value) / viewScale.value,
    }
}

// Per-measurement dimensions, all in millimetres.
function lineLengthMm(m: LineMeasurement): number {
    const dx = m.b.x - m.a.x
    const dy = m.b.y - m.a.y
    return Math.hypot(dx, dy) / props.scalePxPerMm
}

function ellipseAxesMm(m: EllipseMeasurement): { semiMajor: number; semiMinor: number } {
    // Using |vA| and |vB| as semi-axes directly. This assumes the user drew
    // roughly perpendicular conjugate axes, which is the common case on a
    // deskewed image. A full Q = (M M^T)^{-1} eigendecomposition would be
    // more accurate for skewed inputs but is overkill here.
    const lenA = Math.hypot(m.axisEndA.x - m.center.x, m.axisEndA.y - m.center.y) / props.scalePxPerMm
    const lenB = Math.hypot(m.axisEndB.x - m.center.x, m.axisEndB.y - m.center.y) / props.scalePxPerMm
    return {
        semiMajor: Math.max(lenA, lenB),
        semiMinor: Math.min(lenA, lenB),
    }
}

function circleRadiusMm(m: CircleMeasurement): number {
    const dx = m.edge.x - m.center.x
    const dy = m.edge.y - m.center.y
    return Math.hypot(dx, dy) / props.scalePxPerMm
}

function angleDegrees(m: AngleMeasurement): number {
    const ax = m.armA.x - m.vertex.x
    const ay = m.armA.y - m.vertex.y
    const bx = m.armB.x - m.vertex.x
    const by = m.armB.y - m.vertex.y
    const dot = ax * bx + ay * by
    const cross = ax * by - ay * bx
    // atan2 gives signed angle; we report the unsigned magnitude because
    // "angle between two rays" is orientation-agnostic.
    const rad = Math.atan2(Math.abs(cross), dot)
    return (rad * 180) / Math.PI
}

// Width = mean of TL→TR and BL→BR (the two "horizontal" sides under the
// stored ordering). Height = mean of TL→BL and TR→BR. This averages out
// minor non-rectangular skew the user may introduce while reshaping.
function rectDimensionsMm(m: RectMeasurement): { widthMm: number; heightMm: number } {
    const [tl, tr, br, bl] = m.corners
    const wTop = Math.hypot(tr.x - tl.x, tr.y - tl.y)
    const wBot = Math.hypot(br.x - bl.x, br.y - bl.y)
    const hLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y)
    const hRight = Math.hypot(br.x - tr.x, br.y - tr.y)
    return {
        widthMm: (wTop + wBot) / 2 / props.scalePxPerMm,
        heightMm: (hLeft + hRight) / 2 / props.scalePxPerMm,
    }
}

// Shoelace area of the quadrilateral, sign-stripped — handles skewed/
// reshaped rectangles correctly. Crossed quads will give a smaller area
// (common shoelace behaviour); we accept that since we don't auto-reorder.
function rectAreaMm2(m: RectMeasurement): number {
    const [p0, p1, p2, p3] = m.corners
    const cross =
        p0.x * p1.y - p1.x * p0.y +
        p1.x * p2.y - p2.x * p1.y +
        p2.x * p3.y - p3.x * p2.y +
        p3.x * p0.y - p0.x * p3.y
    const areaPx2 = Math.abs(cross) / 2
    return areaPx2 / (props.scalePxPerMm * props.scalePxPerMm)
}

function formatMm(v: number): string {
    return v >= 10 ? v.toFixed(1) : v.toFixed(2)
}

function formatArea(v: number): string {
    if (v >= 1000) return v.toFixed(0)
    if (v >= 100) return v.toFixed(1)
    return v.toFixed(2)
}

// Spec for rectangle area readout: 0 decimals when ≥ 100 mm², else 1.
function formatRectArea(v: number): string {
    if (v >= 100) return v.toFixed(0)
    return v.toFixed(1)
}

function measurementLabel(m: Measurement): string {
    if (m.type === "line") {
        return `${formatMm(lineLengthMm(m))} mm`
    }
    if (m.type === "rectangle") {
        const { widthMm, heightMm } = rectDimensionsMm(m)
        const area = rectAreaMm2(m)
        return `${widthMm.toFixed(1)} × ${heightMm.toFixed(1)} mm · ${formatRectArea(area)} mm²`
    }
    if (m.type === "ellipse") {
        const { semiMajor, semiMinor } = ellipseAxesMm(m)
        const area = Math.PI * semiMajor * semiMinor
        return `${formatMm(semiMajor)}×${formatMm(semiMinor)} mm · ${formatArea(area)} mm²`
    }
    if (m.type === "circle") {
        const r = circleRadiusMm(m)
        const diameter = 2 * r
        const area = Math.PI * r * r
        return `⌀ ${diameter.toFixed(1)} mm · ${formatRectArea(area)} mm²`
    }
    return `${angleDegrees(m).toFixed(1)}°`
}

function measurementTypeLabel(m: Measurement): string {
    if (m.type === "line") return "Line"
    if (m.type === "rectangle") return "Rect"
    if (m.type === "ellipse") return "Ellipse"
    if (m.type === "circle") return "Circle"
    return "Angle"
}

// Side-panel summary uses the shorter "w×h mm" without the area suffix per
// the spec — a separate format from the on-canvas label.
function measurementSummaryValue(m: Measurement): string {
    if (m.type === "rectangle") {
        const { widthMm, heightMm } = rectDimensionsMm(m)
        return `${widthMm.toFixed(1)}×${heightMm.toFixed(1)} mm`
    }
    if (m.type === "circle") {
        const diameter = 2 * circleRadiusMm(m)
        return `⌀ ${diameter.toFixed(1)} mm`
    }
    return measurementLabel(m)
}

// Anchor point in image space where we place the label. Chosen per type so
// the label sits in a predictable, non-occluding position.
function labelAnchor(m: Measurement): Point {
    if (m.type === "line") {
        return { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 }
    }
    if (m.type === "rectangle") {
        const [p0, p1, p2, p3] = m.corners
        return {
            x: (p0.x + p1.x + p2.x + p3.x) / 4,
            y: (p0.y + p1.y + p2.y + p3.y) / 4,
        }
    }
    if (m.type === "ellipse") {
        return m.center
    }
    if (m.type === "circle") {
        return m.center
    }
    return m.vertex
}

// Label rectangle in canvas space. Width depends on text so we measure with
// the same ctx we are about to render with. Sizes scale with strokeMul so
// labels stay legible when exporting at a higher pixel resolution.
function labelRect(
    ctx: CanvasRenderingContext2D,
    m: Measurement,
    rt: RenderCtx,
): { x: number; y: number; w: number; h: number; textX: number; textY: number; fontPx: number } {
    const anchor = imgToCtx(labelAnchor(m), rt)
    const text = measurementLabel(m)
    const fontPx = 13 * rt.strokeMul
    ctx.save()
    ctx.font = `bold ${String(fontPx)}px monospace`
    const tw = ctx.measureText(text).width
    ctx.restore()
    const pad = 6 * rt.strokeMul
    const h = 20 * rt.strokeMul
    const w = tw + pad * 2
    // Offset the label above the anchor so it doesn't sit on top of a handle.
    const offsetY = (m.type === "angle" ? 22 : 14) * rt.strokeMul
    const x = anchor.x - w / 2
    const y = anchor.y - h / 2 - offsetY
    return { x, y, w, h, textX: anchor.x, textY: anchor.y - offsetY, fontPx }
}

function drawMeasurement(
    ctx: CanvasRenderingContext2D,
    m: Measurement,
    isSelected: boolean,
    rt: RenderCtx,
) {
    const baseColor = getDatumColor(m.colorIndex)
    const decorate = rt.drawSelectionDecorations
    const strokeColor = decorate && isSelected ? "#ffffff" : baseColor
    const lineAlpha = decorate ? (isSelected ? 1.0 : 0.8) : 1.0
    const lineWidth = (decorate && isSelected ? 3 : 2) * rt.strokeMul

    ctx.save()
    ctx.globalAlpha = lineAlpha

    if (m.type === "line") {
        drawLineGeometry(ctx, m, strokeColor, baseColor, lineWidth, isSelected, rt)
    } else if (m.type === "rectangle") {
        drawRectGeometry(ctx, m, strokeColor, baseColor, lineWidth, isSelected, rt)
    } else if (m.type === "ellipse") {
        drawEllipseGeometry(ctx, m, strokeColor, baseColor, lineWidth, isSelected, rt)
    } else if (m.type === "circle") {
        drawCircleGeometry(ctx, m, strokeColor, baseColor, lineWidth, isSelected, rt)
    } else {
        drawAngleGeometry(ctx, m, strokeColor, baseColor, lineWidth, isSelected, rt)
    }

    ctx.globalAlpha = 1.0
    drawLabel(ctx, m, baseColor, isSelected, rt)
    ctx.restore()
}

// Selected items in the live view + everything in export mode draw solid;
// unselected items in the live view get a dashed stroke to fade them back.
function applyDash(ctx: CanvasRenderingContext2D, isSelected: boolean, rt: RenderCtx) {
    if (rt.drawSelectionDecorations && !isSelected) {
        ctx.setLineDash([6 * rt.strokeMul, 3 * rt.strokeMul])
    } else {
        ctx.setLineDash([])
    }
}

function drawLineGeometry(
    ctx: CanvasRenderingContext2D,
    m: LineMeasurement,
    strokeColor: string,
    handleColor: string,
    lineWidth: number,
    isSelected: boolean,
    rt: RenderCtx,
) {
    const sa = imgToCtx(m.a, rt)
    const sb = imgToCtx(m.b, rt)
    ctx.beginPath()
    ctx.moveTo(sa.x, sa.y)
    ctx.lineTo(sb.x, sb.y)
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = lineWidth
    applyDash(ctx, isSelected, rt)
    ctx.stroke()
    ctx.setLineDash([])
    if (rt.drawHandles) {
        drawHandle(ctx, sa, handleColor, isSelected, false, rt)
        drawHandle(ctx, sb, handleColor, isSelected, false, rt)
    }
}

function drawRectGeometry(
    ctx: CanvasRenderingContext2D,
    m: RectMeasurement,
    strokeColor: string,
    handleColor: string,
    lineWidth: number,
    isSelected: boolean,
    rt: RenderCtx,
) {
    const screenCorners = m.corners.map((p) => imgToCtx(p, rt))
    ctx.beginPath()
    for (let i = 0; i < screenCorners.length; i++) {
        const p = screenCorners[i]
        if (!p) continue
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
    }
    ctx.closePath()
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = lineWidth
    applyDash(ctx, isSelected, rt)
    ctx.stroke()
    ctx.setLineDash([])
    // Don't fill the interior — keeps what's underneath visible, matching
    // the line/ellipse/angle visual style.
    if (rt.drawHandles) {
        for (const p of screenCorners) {
            drawHandle(ctx, p, handleColor, isSelected, false, rt)
        }
    }
}

function drawEllipseGeometry(
    ctx: CanvasRenderingContext2D,
    m: EllipseMeasurement,
    strokeColor: string,
    handleColor: string,
    lineWidth: number,
    isSelected: boolean,
    rt: RenderCtx,
) {
    // Parametric draw using the two conjugate axis vectors; handles the
    // general (non-perpendicular) case the datum editor also uses.
    const c = imgToCtx(m.center, rt)
    const a = imgToCtx(m.axisEndA, rt)
    const b = imgToCtx(m.axisEndB, rt)
    const vAx = a.x - c.x
    const vAy = a.y - c.y
    const vBx = b.x - c.x
    const vBy = b.y - c.y

    ctx.beginPath()
    const N = 72
    for (let i = 0; i <= N; i++) {
        const t = (2 * Math.PI * i) / N
        const cs = Math.cos(t)
        const sn = Math.sin(t)
        const x = c.x + vAx * cs + vBx * sn
        const y = c.y + vAy * cs + vBy * sn
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = lineWidth
    applyDash(ctx, isSelected, rt)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.save()
    ctx.globalAlpha *= 0.5
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(a.x, a.y)
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = 1 * rt.strokeMul
    ctx.stroke()
    ctx.restore()

    if (rt.drawHandles) {
        drawHandle(ctx, c, handleColor, isSelected, true, rt)
        drawHandle(ctx, a, handleColor, isSelected, false, rt)
        drawHandle(ctx, b, handleColor, isSelected, false, rt)
    }
}

function drawCircleGeometry(
    ctx: CanvasRenderingContext2D,
    m: CircleMeasurement,
    strokeColor: string,
    handleColor: string,
    lineWidth: number,
    isSelected: boolean,
    rt: RenderCtx,
) {
    // True circle: radius is the canvas-space distance from center to edge
    // under the active RenderCtx affine. Drawing in canvas space (rather
    // than image space + ctx.scale) keeps the stroke width consistent at
    // any zoom level, matching the line/ellipse style.
    const c = imgToCtx(m.center, rt)
    const e = imgToCtx(m.edge, rt)
    const r = Math.hypot(e.x - c.x, e.y - c.y)

    ctx.beginPath()
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = lineWidth
    applyDash(ctx, isSelected, rt)
    ctx.stroke()
    ctx.setLineDash([])

    // Faint radius hint, mirroring the ellipse's axis hint lines.
    ctx.save()
    ctx.globalAlpha *= 0.5
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(e.x, e.y)
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = 1 * rt.strokeMul
    ctx.stroke()
    ctx.restore()

    if (rt.drawHandles) {
        drawHandle(ctx, c, handleColor, isSelected, true, rt)
        drawHandle(ctx, e, handleColor, isSelected, false, rt)
    }
}

function drawAngleGeometry(
    ctx: CanvasRenderingContext2D,
    m: AngleMeasurement,
    strokeColor: string,
    handleColor: string,
    lineWidth: number,
    isSelected: boolean,
    rt: RenderCtx,
) {
    const v = imgToCtx(m.vertex, rt)
    const a = imgToCtx(m.armA, rt)
    const b = imgToCtx(m.armB, rt)

    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(v.x, v.y)
    ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = lineWidth
    applyDash(ctx, isSelected, rt)
    ctx.stroke()
    ctx.setLineDash([])

    const lenA = Math.hypot(a.x - v.x, a.y - v.y)
    const lenB = Math.hypot(b.x - v.x, b.y - v.y)
    const arcR = Math.max(16 * rt.strokeMul, Math.min(lenA, lenB) * 0.3)
    if (lenA > 2 && lenB > 2) {
        const thetaA = Math.atan2(a.y - v.y, a.x - v.x)
        const thetaB = Math.atan2(b.y - v.y, b.x - v.x)
        // Always sweep the short way around so the arc visualises the angle
        // the number reports (0–180°).
        let delta = thetaB - thetaA
        while (delta > Math.PI) delta -= 2 * Math.PI
        while (delta < -Math.PI) delta += 2 * Math.PI
        ctx.save()
        ctx.globalAlpha *= 0.6
        ctx.beginPath()
        ctx.arc(v.x, v.y, arcR, thetaA, thetaA + delta, delta < 0)
        ctx.strokeStyle = strokeColor
        ctx.lineWidth = 1.5 * rt.strokeMul
        ctx.stroke()
        ctx.restore()
    }

    if (rt.drawHandles) {
        drawHandle(ctx, v, handleColor, isSelected, true, rt)
        drawHandle(ctx, a, handleColor, isSelected, false, rt)
        drawHandle(ctx, b, handleColor, isSelected, false, rt)
    }
}

// Handle rendering follows the datum-editor precedent: a filled color center
// ringed in white. Size and alpha depend on the measurement's selection
// state so the user always sees where to grab, but unselected handles stay
// visually quiet.
//   unselected: 3 px radius @ 0.5 alpha
//   selected primary (center/vertex): 8 px radius, full alpha, thicker ring
//   selected secondary: 6.5 px radius, full alpha
// The invisible hit region (HANDLE_HIT_PX) is wider than any of these so
// grabbing is forgiving even on tiny unselected dots.
function drawHandle(
    ctx: CanvasRenderingContext2D,
    s: Point,
    color: string,
    isSelected: boolean,
    primary: boolean,
    rt: RenderCtx,
) {
    ctx.save()
    if (isSelected && rt.drawSelectionDecorations) {
        const r = (primary ? 8 : 6.5) * rt.strokeMul
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 2 * rt.strokeMul
        ctx.stroke()
    } else {
        if (rt.drawSelectionDecorations) ctx.globalAlpha = 0.5
        ctx.beginPath()
        ctx.arc(s.x, s.y, 3 * rt.strokeMul, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 1 * rt.strokeMul
        ctx.stroke()
    }
    ctx.restore()
}

function drawLabel(
    ctx: CanvasRenderingContext2D,
    m: Measurement,
    baseColor: string,
    isSelected: boolean,
    rt: RenderCtx,
) {
    const rect = labelRect(ctx, m, rt)
    const decorate = rt.drawSelectionDecorations
    const labelAlpha = decorate ? (isSelected ? 1.0 : 0.5) : 1.0
    ctx.save()
    ctx.globalAlpha = labelAlpha
    // In export mode every label uses the measurement's own colour for the
    // pill — it's the only signal that ties a label to its geometry without
    // the live highlight.
    ctx.fillStyle = decorate
        ? isSelected
            ? baseColor
            : "rgba(0, 0, 0, 0.75)"
        : baseColor
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 4 * rt.strokeMul)
    ctx.fill()
    if (decorate && isSelected) {
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 1 * rt.strokeMul
        ctx.stroke()
    }
    ctx.font = `bold ${String(rect.fontPx)}px monospace`
    ctx.fillStyle = "#ffffff"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(measurementLabel(m), rect.textX, rect.textY)
    ctx.textAlign = "start"
    ctx.textBaseline = "alphabetic"
    ctx.restore()
}

function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
) {
    const rr = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.lineTo(x + w - rr, y)
    ctx.arcTo(x + w, y, x + w, y + rr, rr)
    ctx.lineTo(x + w, y + h - rr)
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
    ctx.lineTo(x + rr, y + h)
    ctx.arcTo(x, y + h, x, y + h - rr, rr)
    ctx.lineTo(x, y + rr)
    ctx.arcTo(x, y, x + rr, y, rr)
    ctx.closePath()
}

function drawPlacementPreview(ctx: CanvasRenderingContext2D) {
    const color = getDatumColor(colorCounter)
    const pts = placementPoints.value
    const cursor = placementCursor.value

    ctx.save()
    ctx.globalAlpha = 0.9
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 2
    ctx.setLineDash([4, 3])

    const sPts = pts.map(imgToScreen)
    const sCursor = cursor ? imgToScreen(cursor) : null

    if (activeTool.value === "line" && sPts.length >= 1 && sPts[0] && sCursor) {
        ctx.beginPath()
        ctx.moveTo(sPts[0].x, sPts[0].y)
        ctx.lineTo(sCursor.x, sCursor.y)
        ctx.stroke()
    } else if (activeTool.value === "rectangle" && sPts.length >= 1 && sPts[0] && sCursor) {
        const a = sPts[0]
        const b = sCursor
        ctx.beginPath()
        ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y)
        ctx.stroke()
    } else if (activeTool.value === "ellipse" && sPts.length >= 1 && sPts[0]) {
        const center = sPts[0]
        const endA = sPts[1] ?? sCursor
        if (endA) {
            ctx.beginPath()
            ctx.moveTo(center.x, center.y)
            ctx.lineTo(endA.x, endA.y)
            ctx.stroke()
        }
        if (sPts.length >= 2 && sPts[1] && sCursor) {
            const a = sPts[1]
            const b = sCursor
            ctx.beginPath()
            ctx.moveTo(center.x, center.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
            const vAx = a.x - center.x
            const vAy = a.y - center.y
            const vBx = b.x - center.x
            const vBy = b.y - center.y
            ctx.beginPath()
            const N = 72
            for (let i = 0; i <= N; i++) {
                const t = (2 * Math.PI * i) / N
                const cs = Math.cos(t)
                const sn = Math.sin(t)
                const x = center.x + vAx * cs + vBx * sn
                const y = center.y + vAy * cs + vBy * sn
                if (i === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
            }
            ctx.stroke()
        }
    } else if (activeTool.value === "circle" && sPts.length >= 1 && sPts[0] && sCursor) {
        const center = sPts[0]
        const r = Math.hypot(sCursor.x - center.x, sCursor.y - center.y)
        ctx.beginPath()
        ctx.moveTo(center.x, center.y)
        ctx.lineTo(sCursor.x, sCursor.y)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(center.x, center.y, r, 0, Math.PI * 2)
        ctx.stroke()
    } else if (activeTool.value === "angle" && sPts.length >= 1 && sPts[0]) {
        const v = sPts[0]
        const a = sPts[1] ?? sCursor
        if (a) {
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(v.x, v.y)
            ctx.stroke()
        }
        if (sPts.length >= 2 && sPts[1] && sCursor) {
            ctx.beginPath()
            ctx.moveTo(v.x, v.y)
            ctx.lineTo(sCursor.x, sCursor.y)
            ctx.stroke()
        }
    }
    ctx.setLineDash([])
    for (const sp of sPts) {
        ctx.beginPath()
        ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2)
        ctx.fill()
    }
    ctx.restore()
}

function getCanvasXY(e: MouseEvent | Touch): { x: number; y: number } {
    const rect = overlayRef.value?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

// Hit-testing helpers. All thresholds are in screen pixels so they feel
// consistent to the user regardless of zoom level.
// Generous invisible hotspot around each handle so precision grabs feel
// forgiving on small unselected dots. Larger than any rendered handle.
const HANDLE_HIT_PX = 14
const LINE_HIT_PX = 6
const ELLIPSE_HIT_PX = 7
const CIRCLE_HIT_PX = 6

function pointToSegmentDistance(
    p: Point,
    a: Point,
    b: Point,
): number {
    const abx = b.x - a.x
    const aby = b.y - a.y
    const len2 = abx * abx + aby * aby
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2
    t = Math.max(0, Math.min(1, t))
    const qx = a.x + t * abx
    const qy = a.y + t * aby
    return Math.hypot(p.x - qx, p.y - qy)
}

// Standard ray-cast point-in-polygon. Works for any simple quadrilateral
// (including reshaped non-rect cases) and gracefully degrades to a small
// or zero region for crossed quads — which is what we want, since a
// "crossed" rectangle is effectively user error.
function pointInPolygon(p: Point, poly: Point[]): boolean {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i++) {
        const pi = poly[i]
        const pj = poly[j]
        if (!pi || !pj) continue
        const intersect =
            pi.y > p.y !== pj.y > p.y &&
            p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x
        if (intersect) inside = !inside
    }
    return inside
}

// Returns the min screen-space distance from cursor to the ellipse curve.
// Sampled parametrically; 96 samples is overkill for hit-testing but cheap.
function ellipseCurveDistance(
    cursor: Point,
    m: EllipseMeasurement,
): number {
    const c = imgToScreen(m.center)
    const a = imgToScreen(m.axisEndA)
    const b = imgToScreen(m.axisEndB)
    const vAx = a.x - c.x
    const vAy = a.y - c.y
    const vBx = b.x - c.x
    const vBy = b.y - c.y
    let best = Infinity
    const N = 96
    for (let i = 0; i < N; i++) {
        const t = (2 * Math.PI * i) / N
        const cs = Math.cos(t)
        const sn = Math.sin(t)
        const x = c.x + vAx * cs + vBx * sn
        const y = c.y + vAy * cs + vBy * sn
        const d = Math.hypot(cursor.x - x, cursor.y - y)
        if (d < best) best = d
    }
    return best
}

interface HitResult {
    measurementId: string
    // "handle" means the user grabbed a specific control point.
    // "geometry" means they grabbed the line/curve/arms — whole-measurement drag.
    // "label" means they clicked the label — selection only (drag moves whole).
    kind: "handle" | "geometry" | "label"
    handleKey: string | null
}

function getHandlePositions(m: Measurement): { key: string; pt: Point }[] {
    if (m.type === "line") {
        return [
            { key: "a", pt: m.a },
            { key: "b", pt: m.b },
        ]
    }
    if (m.type === "rectangle") {
        return [
            { key: "c0", pt: m.corners[0] },
            { key: "c1", pt: m.corners[1] },
            { key: "c2", pt: m.corners[2] },
            { key: "c3", pt: m.corners[3] },
        ]
    }
    if (m.type === "ellipse") {
        return [
            { key: "center", pt: m.center },
            { key: "axisEndA", pt: m.axisEndA },
            { key: "axisEndB", pt: m.axisEndB },
        ]
    }
    if (m.type === "circle") {
        return [
            { key: "center", pt: m.center },
            { key: "edge", pt: m.edge },
        ]
    }
    return [
        { key: "vertex", pt: m.vertex },
        { key: "armA", pt: m.armA },
        { key: "armB", pt: m.armB },
    ]
}

function hitTest(cursorScreen: Point): HitResult | null {
    const ctx = overlayRef.value?.getContext("2d")
    if (!ctx) return null

    // Check the selected measurement first — its label is visually on top,
    // so its hit region should win ties.
    const ordered: Measurement[] = []
    const sel = measurements.value.find((m) => m.id === selectedId.value)
    if (sel) ordered.push(sel)
    for (const m of measurements.value) {
        if (m.id !== selectedId.value) ordered.push(m)
    }

    // Priority 1: handles (selected first, so you can always grab the active
    // measurement's handle even if it overlaps another). Handles beat geometry
    // so precision grabs on endpoints always win over a line-body grab.
    for (const m of ordered) {
        for (const h of getHandlePositions(m)) {
            const s = imgToScreen(h.pt)
            if (Math.hypot(cursorScreen.x - s.x, cursorScreen.y - s.y) <= HANDLE_HIT_PX) {
                return { measurementId: m.id, kind: "handle", handleKey: h.key }
            }
        }
    }

    // Priority 2: labels.
    const liveRt = makeLiveCtx()
    for (const m of ordered) {
        const rect = labelRect(ctx, m, liveRt)
        if (
            cursorScreen.x >= rect.x &&
            cursorScreen.x <= rect.x + rect.w &&
            cursorScreen.y >= rect.y &&
            cursorScreen.y <= rect.y + rect.h
        ) {
            return { measurementId: m.id, kind: "label", handleKey: null }
        }
    }

    // Priority 3: geometry bodies.
    for (const m of ordered) {
        if (m.type === "line") {
            const sa = imgToScreen(m.a)
            const sb = imgToScreen(m.b)
            if (pointToSegmentDistance(cursorScreen, sa, sb) <= LINE_HIT_PX) {
                return { measurementId: m.id, kind: "geometry", handleKey: null }
            }
        } else if (m.type === "rectangle") {
            const sc = m.corners.map(imgToScreen)
            // Edge-near test for thin grabs along the border.
            let edgeHit = false
            for (let i = 0; i < 4; i++) {
                const a = sc[i]
                const b = sc[(i + 1) % 4]
                if (a && b && pointToSegmentDistance(cursorScreen, a, b) <= LINE_HIT_PX) {
                    edgeHit = true
                    break
                }
            }
            // Interior-fill test so a big rect is grabbable from anywhere
            // inside, not just along the 6px edge band.
            if (edgeHit || pointInPolygon(cursorScreen, sc)) {
                return { measurementId: m.id, kind: "geometry", handleKey: null }
            }
        } else if (m.type === "ellipse") {
            if (ellipseCurveDistance(cursorScreen, m) <= ELLIPSE_HIT_PX) {
                return { measurementId: m.id, kind: "geometry", handleKey: null }
            }
        } else if (m.type === "circle") {
            // Edge: near the circumference. Interior: anywhere inside the
            // circle, so big circles are easy to grab without precision.
            const c = imgToScreen(m.center)
            const e = imgToScreen(m.edge)
            const radius = Math.hypot(e.x - c.x, e.y - c.y)
            const distToCenter = Math.hypot(cursorScreen.x - c.x, cursorScreen.y - c.y)
            if (
                Math.abs(distToCenter - radius) <= CIRCLE_HIT_PX ||
                distToCenter <= radius
            ) {
                return { measurementId: m.id, kind: "geometry", handleKey: null }
            }
        } else {
            const v = imgToScreen(m.vertex)
            const a = imgToScreen(m.armA)
            const b = imgToScreen(m.armB)
            if (
                pointToSegmentDistance(cursorScreen, v, a) <= LINE_HIT_PX ||
                pointToSegmentDistance(cursorScreen, v, b) <= LINE_HIT_PX
            ) {
                return { measurementId: m.id, kind: "geometry", handleKey: null }
            }
        }
    }

    return null
}

function commitPlacement() {
    const pts = placementPoints.value
    if (activeTool.value === "line" && pts.length === 2) {
        const [a, b] = pts as [Point, Point]
        const id = nanoid()
        measurements.value.push({
            id,
            type: "line",
            colorIndex: colorCounter,
            a,
            b,
        })
        colorCounter += 1
        selectedId.value = id
        placementPoints.value = []
    } else if (activeTool.value === "rectangle" && pts.length === 2) {
        const [p1, p2] = pts as [Point, Point]
        // Normalise so corners are TL/TR/BR/BL regardless of click order.
        const minX = Math.min(p1.x, p2.x)
        const maxX = Math.max(p1.x, p2.x)
        const minY = Math.min(p1.y, p2.y)
        const maxY = Math.max(p1.y, p2.y)
        const id = nanoid()
        measurements.value.push({
            id,
            type: "rectangle",
            colorIndex: colorCounter,
            corners: [
                { x: minX, y: minY },
                { x: maxX, y: minY },
                { x: maxX, y: maxY },
                { x: minX, y: maxY },
            ],
        })
        colorCounter += 1
        selectedId.value = id
        placementPoints.value = []
    } else if (activeTool.value === "ellipse" && pts.length === 3) {
        const [center, axisEndA, axisEndB] = pts as [Point, Point, Point]
        const id = nanoid()
        measurements.value.push({
            id,
            type: "ellipse",
            colorIndex: colorCounter,
            center,
            axisEndA,
            axisEndB,
        })
        colorCounter += 1
        selectedId.value = id
        placementPoints.value = []
    } else if (activeTool.value === "circle" && pts.length === 2) {
        const [center, edge] = pts as [Point, Point]
        const id = nanoid()
        measurements.value.push({
            id,
            type: "circle",
            colorIndex: colorCounter,
            center,
            edge,
        })
        colorCounter += 1
        selectedId.value = id
        placementPoints.value = []
    } else if (activeTool.value === "angle" && pts.length === 3) {
        const [vertex, armA, armB] = pts as [Point, Point, Point]
        const id = nanoid()
        measurements.value.push({
            id,
            type: "angle",
            colorIndex: colorCounter,
            vertex,
            armA,
            armB,
        })
        colorCounter += 1
        selectedId.value = id
        placementPoints.value = []
    }
}

function handlePlacementClick(imgPt: Point) {
    if (activeTool.value === "none") return
    placementPoints.value.push(imgPt)
    const needed =
        activeTool.value === "line" ||
        activeTool.value === "rectangle" ||
        activeTool.value === "circle"
            ? 2
            : 3
    if (placementPoints.value.length >= needed) {
        commitPlacement()
    }
}

function cancelPlacement() {
    placementPoints.value = []
    drawOverlay()
}

function setTool(tool: ToolMode) {
    if (activeTool.value === tool) {
        activeTool.value = "none"
        placementPoints.value = []
    } else {
        activeTool.value = tool
        placementPoints.value = []
        selectedId.value = null
    }
    drawOverlay()
}

function deleteMeasurement(id: string) {
    measurements.value = measurements.value.filter((m) => m.id !== id)
    if (selectedId.value === id) selectedId.value = null
    drawOverlay()
}

function selectMeasurement(id: string | null) {
    selectedId.value = id
    drawOverlay()
}

function clearMeasurements() {
    measurements.value = []
    selectedId.value = null
    placementPoints.value = []
    drawOverlay()
}

// Clones a measurement so we can capture a drag-start snapshot. Plain spread
// wouldn't deep-copy the nested Point objects, which we mutate per frame.
function cloneMeasurement(m: Measurement): Measurement {
    if (m.type === "line") {
        return { ...m, a: { ...m.a }, b: { ...m.b } }
    }
    if (m.type === "rectangle") {
        return {
            ...m,
            corners: [
                { ...m.corners[0] },
                { ...m.corners[1] },
                { ...m.corners[2] },
                { ...m.corners[3] },
            ],
        }
    }
    if (m.type === "ellipse") {
        return {
            ...m,
            center: { ...m.center },
            axisEndA: { ...m.axisEndA },
            axisEndB: { ...m.axisEndB },
        }
    }
    if (m.type === "circle") {
        return {
            ...m,
            center: { ...m.center },
            edge: { ...m.edge },
        }
    }
    return {
        ...m,
        vertex: { ...m.vertex },
        armA: { ...m.armA },
        armB: { ...m.armB },
    }
}

function applyDrag(
    original: Measurement,
    mode: DragMode,
    handleKey: string | null,
    dx: number,
    dy: number,
): Measurement {
    if (mode === "move") {
        if (original.type === "line") {
            return {
                ...original,
                a: { x: original.a.x + dx, y: original.a.y + dy },
                b: { x: original.b.x + dx, y: original.b.y + dy },
            }
        }
        if (original.type === "rectangle") {
            return {
                ...original,
                corners: [
                    { x: original.corners[0].x + dx, y: original.corners[0].y + dy },
                    { x: original.corners[1].x + dx, y: original.corners[1].y + dy },
                    { x: original.corners[2].x + dx, y: original.corners[2].y + dy },
                    { x: original.corners[3].x + dx, y: original.corners[3].y + dy },
                ],
            }
        }
        if (original.type === "ellipse") {
            return {
                ...original,
                center: { x: original.center.x + dx, y: original.center.y + dy },
                axisEndA: { x: original.axisEndA.x + dx, y: original.axisEndA.y + dy },
                axisEndB: { x: original.axisEndB.x + dx, y: original.axisEndB.y + dy },
            }
        }
        if (original.type === "circle") {
            return {
                ...original,
                center: { x: original.center.x + dx, y: original.center.y + dy },
                edge: { x: original.edge.x + dx, y: original.edge.y + dy },
            }
        }
        return {
            ...original,
            vertex: { x: original.vertex.x + dx, y: original.vertex.y + dy },
            armA: { x: original.armA.x + dx, y: original.armA.y + dy },
            armB: { x: original.armB.x + dx, y: original.armB.y + dy },
        }
    }
    if (mode === "handle" && handleKey) {
        if (original.type === "line") {
            if (handleKey === "a") return { ...original, a: { x: original.a.x + dx, y: original.a.y + dy } }
            if (handleKey === "b") return { ...original, b: { x: original.b.x + dx, y: original.b.y + dy } }
        } else if (original.type === "rectangle") {
            // Constrain to an axis-aligned rectangle: the dragged corner
            // follows the cursor, the diagonally-opposite corner stays put,
            // and the two adjacent corners are recomputed from the cross of
            // (dragged.x, opp.y) and (opp.x, dragged.y) so the shape stays
            // rectangular. Corner indices stay stable — c0 is still the
            // logical TL even if the box flips through itself.
            const cornerIdx: 0 | 1 | 2 | 3 | null =
                handleKey === "c0" ? 0 :
                handleKey === "c1" ? 1 :
                handleKey === "c2" ? 2 :
                handleKey === "c3" ? 3 : null
            if (cornerIdx !== null) {
                const moving = {
                    x: original.corners[cornerIdx].x + dx,
                    y: original.corners[cornerIdx].y + dy,
                }
                const oppIdx = ((cornerIdx + 2) % 4) as 0 | 1 | 2 | 3
                const opp = { ...original.corners[oppIdx] }
                const next: [Point, Point, Point, Point] = [
                    { x: 0, y: 0 },
                    { x: 0, y: 0 },
                    { x: 0, y: 0 },
                    { x: 0, y: 0 },
                ]
                next[cornerIdx] = moving
                next[oppIdx] = opp
                if (cornerIdx === 0 || cornerIdx === 2) {
                    // TL ↔ BR diagonal: TR=(BR.x, TL.y), BL=(TL.x, BR.y).
                    const tl = next[0]
                    const br = next[2]
                    next[1] = { x: br.x, y: tl.y }
                    next[3] = { x: tl.x, y: br.y }
                } else {
                    // TR ↔ BL diagonal: TL=(BL.x, TR.y), BR=(TR.x, BL.y).
                    const tr = next[1]
                    const bl = next[3]
                    next[0] = { x: bl.x, y: tr.y }
                    next[2] = { x: tr.x, y: bl.y }
                }
                return { ...original, corners: next }
            }
        } else if (original.type === "ellipse") {
            if (handleKey === "center") {
                // Dragging the ellipse center translates the whole ellipse so
                // the axis endpoints keep their conjugate relationship.
                return {
                    ...original,
                    center: { x: original.center.x + dx, y: original.center.y + dy },
                    axisEndA: { x: original.axisEndA.x + dx, y: original.axisEndA.y + dy },
                    axisEndB: { x: original.axisEndB.x + dx, y: original.axisEndB.y + dy },
                }
            }
            if (handleKey === "axisEndA") {
                return { ...original, axisEndA: { x: original.axisEndA.x + dx, y: original.axisEndA.y + dy } }
            }
            if (handleKey === "axisEndB") {
                return { ...original, axisEndB: { x: original.axisEndB.x + dx, y: original.axisEndB.y + dy } }
            }
        } else if (original.type === "circle") {
            if (handleKey === "center") {
                // Dragging the center translates the whole circle so the
                // radius is preserved.
                return {
                    ...original,
                    center: { x: original.center.x + dx, y: original.center.y + dy },
                    edge: { x: original.edge.x + dx, y: original.edge.y + dy },
                }
            }
            if (handleKey === "edge") {
                // Edge follows the cursor; center stays put → radius changes.
                return { ...original, edge: { x: original.edge.x + dx, y: original.edge.y + dy } }
            }
        } else {
            if (handleKey === "vertex") {
                // Like ellipse center: dragging vertex carries the arms so the
                // angle shape is preserved.
                return {
                    ...original,
                    vertex: { x: original.vertex.x + dx, y: original.vertex.y + dy },
                    armA: { x: original.armA.x + dx, y: original.armA.y + dy },
                    armB: { x: original.armB.x + dx, y: original.armB.y + dy },
                }
            }
            if (handleKey === "armA") {
                return { ...original, armA: { x: original.armA.x + dx, y: original.armA.y + dy } }
            }
            if (handleKey === "armB") {
                return { ...original, armB: { x: original.armB.x + dx, y: original.armB.y + dy } }
            }
        }
    }
    return original
}

function updateMeasurement(id: string, next: Measurement) {
    const idx = measurements.value.findIndex((m) => m.id === id)
    if (idx === -1) return
    measurements.value[idx] = next
}

// Hit-test-first press handler, mirroring Konva's behaviour in the datum
// editor: a click on an existing shape always wins over the stage's own
// drag/pan, AND over any active placement tool. Returns "measurement" if
// we picked up an existing measurement (caller suppresses the trailing
// click so a placement tool doesn't commit a spurious point), "pan" if
// the press should start a stage pan, and "placement" if the press
// landed on empty space while a placement tool is active (caller does
// nothing — the click event will commit the placement).
function pointerDown(
    screenX: number,
    screenY: number,
): "measurement" | "pan" | "placement" {
    const cursor = { x: screenX, y: screenY }
    const hit = hitTest(cursor)
    if (hit) {
        selectedId.value = hit.measurementId
        const target = measurements.value.find((m) => m.id === hit.measurementId)
        if (target) {
            const mode: DragMode = hit.kind === "handle" ? "handle" : "move"
            dragState = {
                mode,
                measurementId: target.id,
                handleKey: hit.handleKey,
                startImg: screenToImg(screenX, screenY),
                startSnapshot: cloneMeasurement(target),
            }
        }
        drawOverlay()
        return "measurement"
    }
    // Empty-space press.
    if (activeTool.value !== "none") return "placement"
    if (selectedId.value !== null) {
        selectedId.value = null
        drawOverlay()
    }
    return "pan"
}

function pointerMove(screenX: number, screenY: number): boolean {
    if (!dragState) return false
    const nowImg = screenToImg(screenX, screenY)
    const dxImg = nowImg.x - dragState.startImg.x
    const dyImg = nowImg.y - dragState.startImg.y
    const next = applyDrag(
        dragState.startSnapshot,
        dragState.mode,
        dragState.handleKey,
        dxImg,
        dyImg,
    )
    updateMeasurement(dragState.measurementId, next)
    drawOverlay()
    return true
}

function pointerUp() {
    dragState = null
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

// Once a press starts on the canvas we listen at the window level so the
// drag survives the cursor leaving the canvas (or moving faster than the
// browser's canvas-bound event firing). Re-attached on each press, removed
// when the drag/pan ends.
function attachWindowDragListeners() {
    window.addEventListener("mousemove", onWindowMouseMove)
    window.addEventListener("mouseup", onWindowMouseUp)
}

function detachWindowDragListeners() {
    window.removeEventListener("mousemove", onWindowMouseMove)
    window.removeEventListener("mouseup", onWindowMouseUp)
}

// True between an existing-measurement-grab on mousedown and the trailing
// click event the browser will fire. Suppresses the placement-tool click
// so grabbing a prior measurement doesn't commit a spurious new point.
let suppressNextClick = false

function onMouseDown(e: MouseEvent) {
    const { x, y } = getCanvasXY(e)
    suppressNextClick = false
    const outcome = pointerDown(x, y)
    if (outcome === "measurement") {
        suppressNextClick = true
    } else if (outcome === "pan") {
        isPanning = true
        panStart = { x: e.clientX - viewOffsetX.value, y: e.clientY - viewOffsetY.value }
    }
    if (dragState || isPanning) attachWindowDragListeners()
}

function onWindowMouseMove(e: MouseEvent) {
    if (dragState) {
        const { x, y } = getCanvasXY(e)
        pointerMove(x, y)
        return
    }
    if (isPanning) {
        viewOffsetX.value = e.clientX - panStart.x
        viewOffsetY.value = e.clientY - panStart.y
        redraw()
    }
}

function onWindowMouseUp() {
    pointerUp()
    isPanning = false
    detachWindowDragListeners()
}

function onMouseMove(e: MouseEvent) {
    // While a drag/pan is in flight the window listener handles motion;
    // here we only need the placement-preview cursor.
    if (dragState || isPanning) return
    if (activeTool.value !== "none") {
        const { x, y } = getCanvasXY(e)
        placementCursor.value = screenToImg(x, y)
        drawOverlay()
    }
}

function onMouseUp() {
    // Mouseup that lands inside the canvas — covered by the window listener
    // too, but we keep this so a quick click without movement still ends
    // cleanly even if for some reason the window handler misses.
    if (dragState || isPanning) {
        pointerUp()
        isPanning = false
        detachWindowDragListeners()
    }
}

function onMouseLeave() {
    // Don't end the drag here — the window listener takes over while the
    // cursor is outside the canvas. Just clear the placement preview.
    placementCursor.value = null
    drawOverlay()
}

function onClick(e: MouseEvent) {
    if (suppressNextClick) {
        // Press picked up an existing measurement — the trailing click
        // is part of that gesture, not a placement.
        suppressNextClick = false
        return
    }
    if (activeTool.value === "none") return
    const { x, y } = getCanvasXY(e)
    const imgPt = screenToImg(x, y)
    handlePlacementClick(imgPt)
    drawOverlay()
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
        // Cancel any in-progress drag when a second finger lands; pinch takes
        // priority.
        pointerUp()
        isPanning = false
    } else if (e.touches.length === 1 && t0) {
        const { x, y } = getCanvasXY(t0)
        // Always hit-test first so a tap on an existing handle reshapes
        // it even when a placement tool is active.
        suppressNextClick = false
        const outcome = pointerDown(x, y)
        if (outcome === "measurement") {
            suppressNextClick = true
        } else if (outcome === "placement") {
            placementCursor.value = screenToImg(x, y)
        } else if (outcome === "pan") {
            isPanning = true
            panStart = {
                x: t0.clientX - viewOffsetX.value,
                y: t0.clientY - viewOffsetY.value,
            }
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
    } else if (e.touches.length === 1 && t0) {
        const { x, y } = getCanvasXY(t0)
        if (dragState) {
            e.preventDefault()
            pointerMove(x, y)
            return
        }
        if (activeTool.value !== "none") {
            placementCursor.value = screenToImg(x, y)
            drawOverlay()
            return
        }
        if (isPanning) {
            viewOffsetX.value = t0.clientX - panStart.x
            viewOffsetY.value = t0.clientY - panStart.y
            redraw()
        }
    }
}

function onTouchEnd() {
    // Placement on touch relies on the browser-synthesized click that fires
    // after a tap with no preventDefault — same as the original file did.
    pointerUp()
    isPanning = false
    lastPinchDist = 0
    drawOverlay()
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
        if (activeTool.value !== "none" && placementPoints.value.length > 0) {
            cancelPlacement()
            return
        }
        if (activeTool.value !== "none") {
            activeTool.value = "none"
            drawOverlay()
            return
        }
        if (selectedId.value !== null) {
            selectedId.value = null
            drawOverlay()
        }
        return
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId.value) {
        // Only handle when the overlay is the active context; text inputs
        // inside the toolbar need Backspace for editing.
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return
        e.preventDefault()
        deleteMeasurement(selectedId.value)
    }
}

const placementHint = computed<string | null>(() => {
    if (activeTool.value === "none") return null
    const n = placementPoints.value.length
    if (activeTool.value === "line") {
        if (n === 0) return "Click the first endpoint."
        return "Click the second endpoint."
    }
    if (activeTool.value === "rectangle") {
        if (n === 0) return "Click the first corner."
        return "Click the opposite corner."
    }
    if (activeTool.value === "ellipse") {
        if (n === 0) return "Click the ellipse center."
        if (n === 1) return "Click the first semi-axis endpoint."
        return "Click the second semi-axis endpoint."
    }
    if (activeTool.value === "circle") {
        if (n === 0) return "Click the center."
        return "Click a point on the circumference."
    }
    if (n === 0) return "Click the angle vertex."
    if (n === 1) return "Click the first arm endpoint."
    return "Click the second arm endpoint."
})

const measurementSummaries = computed(() => {
    return measurements.value.map((m) => ({
        id: m.id,
        type: m.type,
        typeLabel: measurementTypeLabel(m),
        label: measurementSummaryValue(m),
        color: getDatumColor(m.colorIndex),
        selected: m.id === selectedId.value,
    }))
})

// Scale-bar primitive shared by the legacy `exportWithScaleBar` (image only)
// and the new `exportWithMeasurements` (image + overlay). Returns a fresh
// canvas of width=src.width, height=src.height + barHeight with the source
// blitted on top and the bar drawn into the bottom strip.
//   srcCanvas: the bitmap to ride on top of the bar (image, or image +
//     overlay in canvas-space).
//   pxPerMm: canvas-pixels per real-world millimetre. The bar's mm length
//     is picked from this so it represents the same physical span the
//     output bitmap does. For full-resolution exports this is the source
//     scale; for view exports this is `props.scalePxPerMm * viewScale`
//     because the viewport zoom changes how many canvas pixels span a mm.
function appendScaleBarCanvas(
    srcCanvas: HTMLCanvasElement,
    pxPerMm: number,
): HTMLCanvasElement {
    const iw = srcCanvas.width
    const ih = srcCanvas.height
    const unit = Math.max(iw / 100, 8)
    const barHeightPx = Math.round(unit * 5)
    const out = document.createElement("canvas")
    out.width = iw
    out.height = ih + barHeightPx
    const ctx = out.getContext("2d")
    if (!ctx) return srcCanvas
    ctx.drawImage(srcCanvas, 0, 0)
    ctx.fillStyle = "#000"
    ctx.fillRect(0, ih, iw, barHeightPx)

    const imgWidthMm = pxPerMm > 0 ? iw / pxPerMm : 0
    const niceSteps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
    const targetMm = imgWidthMm * 0.2
    let barMm = niceSteps[0] ?? 10
    for (const s of niceSteps) {
        barMm = s
        if (s >= targetMm) break
    }
    const barWidthPx = barMm * pxPerMm

    const margin = Math.round(unit * 2)
    const barX = margin
    const barY = ih + barHeightPx / 2
    const barThick = Math.max(Math.round(unit * 0.6), 4)
    const tickH = Math.round(unit * 1.5)
    const tickW = Math.max(2, Math.round(unit * 0.15))

    ctx.fillStyle = "#fff"
    ctx.fillRect(barX, barY - barThick / 2, barWidthPx, barThick)
    ctx.fillRect(barX, barY - tickH / 2, tickW, tickH)
    ctx.fillRect(
        barX + barWidthPx - tickW,
        barY - tickH / 2,
        tickW,
        tickH,
    )

    const fontSize = Math.round(unit * 1.4)
    ctx.font = `bold ${String(fontSize)}px monospace`
    ctx.fillStyle = "#fff"
    ctx.textAlign = "center"
    ctx.textBaseline = "bottom"
    ctx.fillText(
        `${String(barMm)} mm`,
        barX + barWidthPx / 2,
        barY - tickH / 2 - Math.round(unit * 0.3),
    )

    const smallFont = Math.round(unit * 1)
    ctx.textAlign = "right"
    ctx.textBaseline = "middle"
    ctx.font = `${String(smallFont)}px monospace`
    ctx.fillStyle = "rgba(255,255,255,0.6)"
    // Right-side annotation echoes the canvas-pixel scale so a viewer can
    // sanity-check it. We round to 2 decimals because the view-export scale
    // can be fractional; integer scales fall through to no-decimal.
    const pxPerMmText =
        Math.abs(pxPerMm - Math.round(pxPerMm)) < 1e-6
            ? String(Math.round(pxPerMm))
            : pxPerMm.toFixed(2)
    ctx.fillText(`${pxPerMmText} px/mm`, iw - margin, barY)

    return out
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((b) => {
            if (b) resolve(b)
            else reject(new Error("toBlob failed"))
        }, "image/png")
    })
}

// Legacy export: bare image + scale bar, no measurements. Preserved as-is
// for any caller still wired to it (currently none — ResultViewer's
// addScaleBar handles the no-measurements case directly).
function exportWithScaleBar(): Promise<Blob> {
    const image = img.value
    if (!image) return Promise.reject(new Error("No image loaded for scale bar export"))
    const iw = image.naturalWidth
    const ih = image.naturalHeight
    const base = document.createElement("canvas")
    base.width = iw
    base.height = ih
    const bctx = base.getContext("2d")
    if (!bctx) return Promise.reject(new Error("No 2D context"))
    bctx.drawImage(image, 0, 0)
    const out = appendScaleBarCanvas(base, props.scalePxPerMm)
    return canvasToBlob(out)
}

// New: export the deskewed image with all measurement annotations baked
// in. Two scopes:
//   "full": output is the source bitmap at its natural resolution. Stroke
//     widths / handle radii / font sizes are scaled up by
//     image.naturalWidth / overlay.width so the annotation reads at the
//     same visual weight as on screen relative to the image.
//   "view": output is the visible viewport at its current canvas pixel
//     dimensions. Image + measurements are drawn with the live transform,
//     i.e. exactly what the user sees. Stroke widths inherit screen size
//     (strokeMul=1).
// Handles, dashed/faded selection styling, and the placement preview are
// suppressed in both — those are interactive UI, not annotation.
//
// Filenames are decided by the caller; the function only returns the blob.
function exportWithMeasurements(opts: {
    scope: "full" | "view"
    includeScaleBar: boolean
}): Promise<Blob> {
    const image = img.value
    if (!image) return Promise.reject(new Error("No image loaded for export"))

    const out = document.createElement("canvas")
    let outCtx: CanvasRenderingContext2D | null
    let renderCtx: RenderCtx
    let scalePxPerMmForBar: number

    if (opts.scope === "full") {
        const iw = image.naturalWidth
        const ih = image.naturalHeight
        out.width = iw
        out.height = ih
        outCtx = out.getContext("2d")
        if (!outCtx) return Promise.reject(new Error("No 2D context"))
        outCtx.drawImage(image, 0, 0)

        // Scale annotation styling so it reads the same relative to the
        // image as on screen. The on-screen overlay canvas width is the
        // baseline; if export is twice as wide, strokes / fonts / handles
        // double too. Floor at 1 so a tiny overlay doesn't shrink things.
        const overlayW = overlayRef.value?.width ?? 1
        const strokeMul = Math.max(1, iw / Math.max(1, overlayW))
        renderCtx = {
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            strokeMul,
            drawHandles: false,
            drawSelectionDecorations: false,
        }
        scalePxPerMmForBar = props.scalePxPerMm
    } else {
        // View export: canvas matches the visible overlay; transform is
        // the live one so what's drawn is exactly what the user sees.
        const overlayW = overlayRef.value?.width ?? 1
        const overlayH = overlayRef.value?.height ?? 1
        out.width = overlayW
        out.height = overlayH
        outCtx = out.getContext("2d")
        if (!outCtx) return Promise.reject(new Error("No 2D context"))
        // Draw image at the live view transform — same affine the live
        // canvasRef is using.
        outCtx.save()
        outCtx.translate(viewOffsetX.value, viewOffsetY.value)
        outCtx.scale(viewScale.value, viewScale.value)
        outCtx.drawImage(image, 0, 0)
        outCtx.restore()
        renderCtx = {
            scale: viewScale.value,
            offsetX: viewOffsetX.value,
            offsetY: viewOffsetY.value,
            strokeMul: 1,
            drawHandles: false,
            drawSelectionDecorations: false,
        }
        // Effective canvas px per mm = image px per mm × CSS scale, since
        // the image is being painted at viewScale into the canvas.
        scalePxPerMmForBar = props.scalePxPerMm * viewScale.value
    }

    // Draw every measurement, no selection distinction.
    for (const m of measurements.value) {
        drawMeasurement(outCtx, m, false, renderCtx)
    }

    if (opts.includeScaleBar) {
        const withBar = appendScaleBarCanvas(out, scalePxPerMmForBar)
        return canvasToBlob(withBar)
    }
    return canvasToBlob(out)
}

defineExpose({ exportWithScaleBar, exportWithMeasurements })

let resizeObs: ResizeObserver | null = null

onMounted(() => {
    seedFromCache()
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
    window.addEventListener("keydown", onKeyDown)
})

onUnmounted(() => {
    resizeObs?.disconnect()
    window.removeEventListener("keydown", onKeyDown)
    detachWindowDragListeners()
})

watch(() => props.imageUrl, () => {
    // A new image (or the same image with a new object URL) means we should
    // re-seed from cache before triggering the redraw chain.
    seedFromCache()
    loadImg()
})
watch(showGrid, () => { drawOverlay() })
watch(gridSpacingMm, () => { drawOverlay() })
watch(() => props.scalePxPerMm, () => { drawOverlay() })

// Persist on every measurement mutation. localStorage writes are cheap at
// this scale; mirrors how DatumEditor.vue persists store.datums.
watch(
    measurements,
    (next) => {
        if (store.fileHash) {
            saveMeasurements(store.fileHash, next)
        }
    },
    { deep: true },
)
</script>

<template>
    <div class="space-y-3">
        <!-- Toolbar -->
        <div class="flex flex-wrap items-center gap-2 text-sm">
            <div class="inline-flex rounded-md border border-border p-0.5">
                <button
                    class="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors"
                    :class="
                        activeTool === 'line'
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                    "
                    @click="setTool('line')"
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
                        <line x1="4" y1="20" x2="20" y2="4" />
                        <circle cx="4" cy="20" r="1.5" />
                        <circle cx="20" cy="4" r="1.5" />
                    </svg>
                    Line
                </button>
                <button
                    class="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors"
                    :class="
                        activeTool === 'ellipse'
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                    "
                    @click="setTool('ellipse')"
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
                        <ellipse cx="12" cy="12" rx="9" ry="6" />
                    </svg>
                    Ellipse
                </button>
                <button
                    class="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors"
                    :class="
                        activeTool === 'circle'
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                    "
                    @click="setTool('circle')"
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
                        <circle cx="12" cy="12" r="8" />
                    </svg>
                    Circle
                </button>
                <button
                    class="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors"
                    :class="
                        activeTool === 'rectangle'
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                    "
                    @click="setTool('rectangle')"
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
                        <rect x="4" y="6" width="16" height="12" rx="1" />
                    </svg>
                    Rect
                </button>
                <button
                    class="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors"
                    :class="
                        activeTool === 'angle'
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                    "
                    @click="setTool('angle')"
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
                        <path d="M4 20 L20 20 L4 6 Z" fill="none" />
                        <path d="M10 20 a6 6 0 0 0 -3.5 -8.5" />
                    </svg>
                    Angle
                </button>
            </div>

            <button
                v-if="measurements.length > 0 || placementPoints.length > 0"
                class="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-destructive"
                @click="clearMeasurements"
            >
                Clear all
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

        <!-- Placement hint -->
        <div
            v-if="placementHint"
            class="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
        >
            {{ placementHint }}
            <span class="ml-2 text-xs text-muted-foreground">
                Press Escape to cancel.
            </span>
        </div>

        <!-- Canvas + side list. The parent ResultViewer clamps width to
             max-w-4xl; widening the canvas beyond that requires a parent
             change (see ResultViewer.vue root container). -->
        <div class="grid gap-3 md:grid-cols-[1fr_220px]">
            <div
                ref="containerRef"
                class="relative overflow-hidden rounded-lg border border-border bg-muted"
                :class="[
                    canvasHeightClass,
                    activeTool !== 'none' ? 'cursor-crosshair' : 'cursor-grab',
                ]"
            >
                <canvas
                    ref="canvasRef"
                    class="absolute inset-0"
                />
                <canvas
                    ref="overlayRef"
                    class="absolute inset-0 touch-none"
                    @click="onClick"
                    @wheel.prevent="onWheel"
                    @mousedown="onMouseDown"
                    @mousemove="onMouseMove"
                    @mouseup="onMouseUp"
                    @mouseleave="onMouseLeave"
                    @touchstart="onTouchStart"
                    @touchmove="onTouchMove"
                    @touchend="onTouchEnd"
                    @touchcancel="onTouchEnd"
                />
            </div>

            <!-- Measurement list -->
            <div
                class="flex flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-2"
                :class="canvasHeightClass"
            >
                <div
                    v-if="measurementSummaries.length === 0"
                    class="px-2 py-3 text-xs text-muted-foreground"
                >
                    No measurements yet. Pick a tool above and click on the image.
                </div>
                <div
                    v-for="m in measurementSummaries"
                    :key="m.id"
                    role="button"
                    tabindex="0"
                    class="group flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    :class="
                        m.selected
                            ? 'border-primary bg-primary/10'
                            : 'border-transparent hover:border-border hover:bg-muted'
                    "
                    @click="selectMeasurement(m.id)"
                    @keydown.enter.prevent="selectMeasurement(m.id)"
                    @keydown.space.prevent="selectMeasurement(m.id)"
                >
                    <span
                        class="inline-block h-3 w-3 shrink-0 rounded-full border border-border"
                        :style="{ backgroundColor: m.color }"
                    />
                    <span class="shrink-0 font-medium text-foreground">
                        {{ m.typeLabel }}
                    </span>
                    <span class="truncate font-mono text-muted-foreground">
                        {{ m.label }}
                    </span>
                    <button
                        type="button"
                        class="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                        :class="m.selected ? 'opacity-100' : ''"
                        title="Delete measurement"
                        @click.stop="deleteMeasurement(m.id)"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.5"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M18 6 6 18" />
                            <path d="m6 6 12 12" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
