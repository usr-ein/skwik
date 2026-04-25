<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue"
import { useMediaQuery } from "@vueuse/core"
import { nanoid } from "nanoid"
import type { Point } from "@/types"
import { getDatumColor } from "@/lib/datums"

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
type ToolMode = "none" | "line" | "ellipse" | "angle"
const activeTool = ref<ToolMode>("none")
const showGrid = ref(false)
const gridSpacingMm = ref(10)

// Measurement types. Geometry lives in image space so it is invariant under
// pan/zoom and survives redraws without reprojection.
interface BaseMeasurement {
    id: string
    colorIndex: number
}
interface LineMeasurement extends BaseMeasurement {
    type: "line"
    a: Point
    b: Point
}
interface EllipseMeasurement extends BaseMeasurement {
    type: "ellipse"
    center: Point
    axisEndA: Point
    axisEndB: Point
}
interface AngleMeasurement extends BaseMeasurement {
    type: "angle"
    vertex: Point
    armA: Point
    armB: Point
}
type Measurement = LineMeasurement | EllipseMeasurement | AngleMeasurement

const measurements = ref<Measurement[]>([])
const selectedId = ref<string | null>(null)
// Monotonically increasing counter so deleting a measurement doesn't recolor
// the remaining ones. Each new measurement claims the next palette slot.
let colorCounter = 0

// In-progress placement points (image space) while a placement tool is active.
const placementPoints = ref<Point[]>([])
// Cursor position in image space for the live preview of an in-progress
// placement. Null when the pointer is off-canvas.
const placementCursor = ref<Point | null>(null)

// Touch/pan state
let isPanning = false
let panStart = { x: 0, y: 0 }
let lastPinchDist = 0

// Drag state for moving/reshaping committed measurements.
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
    // Did this pointer down actually move? Used to distinguish click vs drag.
    moved: boolean
}
let dragState: DragState | null = null
// Pixel threshold in screen space before a press becomes a drag. Small enough
// that intentional drags feel responsive; large enough that a shaky click
// still registers as a click.
const DRAG_THRESHOLD_PX = 3

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

    // Draw unselected first (faint) so the selected measurement always sits
    // on top with full opacity and its handles aren't occluded.
    for (const m of measurements.value) {
        if (m.id === selectedId.value) continue
        drawMeasurement(ctx, m, false)
    }
    const selected = measurements.value.find((m) => m.id === selectedId.value)
    if (selected) drawMeasurement(ctx, selected, true)

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

function formatMm(v: number): string {
    return v >= 10 ? v.toFixed(1) : v.toFixed(2)
}

function formatArea(v: number): string {
    if (v >= 1000) return v.toFixed(0)
    if (v >= 100) return v.toFixed(1)
    return v.toFixed(2)
}

function measurementLabel(m: Measurement): string {
    if (m.type === "line") {
        return `${formatMm(lineLengthMm(m))} mm`
    }
    if (m.type === "ellipse") {
        const { semiMajor, semiMinor } = ellipseAxesMm(m)
        const area = Math.PI * semiMajor * semiMinor
        return `${formatMm(semiMajor)}×${formatMm(semiMinor)} mm · ${formatArea(area)} mm²`
    }
    return `${angleDegrees(m).toFixed(1)}°`
}

function measurementTypeLabel(m: Measurement): string {
    if (m.type === "line") return "Line"
    if (m.type === "ellipse") return "Ellipse"
    return "Angle"
}

// Anchor point in image space where we place the label. Chosen per type so
// the label sits in a predictable, non-occluding position.
function labelAnchor(m: Measurement): Point {
    if (m.type === "line") {
        return { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 }
    }
    if (m.type === "ellipse") {
        return m.center
    }
    return m.vertex
}

// Label rectangle in screen space. Width depends on text so we measure with
// the same ctx we are about to render with. Height is fixed for uniformity.
function labelRect(
    ctx: CanvasRenderingContext2D,
    m: Measurement,
): { x: number; y: number; w: number; h: number; textX: number; textY: number } {
    const anchor = imgToScreen(labelAnchor(m))
    const text = measurementLabel(m)
    ctx.save()
    ctx.font = "bold 13px monospace"
    const tw = ctx.measureText(text).width
    ctx.restore()
    const pad = 6
    const h = 20
    const w = tw + pad * 2
    // Offset the label above the anchor so it doesn't sit on top of a handle.
    const offsetY = m.type === "angle" ? 22 : 14
    const x = anchor.x - w / 2
    const y = anchor.y - h / 2 - offsetY
    return { x, y, w, h, textX: anchor.x, textY: anchor.y - offsetY }
}

function drawMeasurement(
    ctx: CanvasRenderingContext2D,
    m: Measurement,
    isSelected: boolean,
) {
    const baseColor = getDatumColor(m.colorIndex)
    const strokeColor = isSelected ? "#ffffff" : baseColor
    const lineAlpha = isSelected ? 1.0 : 0.8
    const lineWidth = isSelected ? 3 : 2

    ctx.save()
    ctx.globalAlpha = lineAlpha

    if (m.type === "line") {
        drawLineGeometry(ctx, m, strokeColor, baseColor, lineWidth, isSelected)
    } else if (m.type === "ellipse") {
        drawEllipseGeometry(ctx, m, strokeColor, baseColor, lineWidth, isSelected)
    } else {
        drawAngleGeometry(ctx, m, strokeColor, baseColor, lineWidth, isSelected)
    }

    ctx.globalAlpha = 1.0
    drawLabel(ctx, m, baseColor, isSelected)
    ctx.restore()
}

function drawLineGeometry(
    ctx: CanvasRenderingContext2D,
    m: LineMeasurement,
    strokeColor: string,
    handleColor: string,
    lineWidth: number,
    isSelected: boolean,
) {
    const sa = imgToScreen(m.a)
    const sb = imgToScreen(m.b)
    ctx.beginPath()
    ctx.moveTo(sa.x, sa.y)
    ctx.lineTo(sb.x, sb.y)
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = lineWidth
    ctx.setLineDash(isSelected ? [] : [6, 3])
    ctx.stroke()
    ctx.setLineDash([])
    drawHandle(ctx, sa, handleColor, isSelected)
    drawHandle(ctx, sb, handleColor, isSelected)
}

function drawEllipseGeometry(
    ctx: CanvasRenderingContext2D,
    m: EllipseMeasurement,
    strokeColor: string,
    handleColor: string,
    lineWidth: number,
    isSelected: boolean,
) {
    // Parametric draw using the two conjugate axis vectors; handles the
    // general (non-perpendicular) case the datum editor also uses.
    const c = imgToScreen(m.center)
    const a = imgToScreen(m.axisEndA)
    const b = imgToScreen(m.axisEndB)
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
    ctx.setLineDash(isSelected ? [] : [6, 3])
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
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()

    drawHandle(ctx, c, handleColor, isSelected, true)
    drawHandle(ctx, a, handleColor, isSelected)
    drawHandle(ctx, b, handleColor, isSelected)
}

function drawAngleGeometry(
    ctx: CanvasRenderingContext2D,
    m: AngleMeasurement,
    strokeColor: string,
    handleColor: string,
    lineWidth: number,
    isSelected: boolean,
) {
    const v = imgToScreen(m.vertex)
    const a = imgToScreen(m.armA)
    const b = imgToScreen(m.armB)

    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(v.x, v.y)
    ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = lineWidth
    ctx.setLineDash(isSelected ? [] : [6, 3])
    ctx.stroke()
    ctx.setLineDash([])

    const lenA = Math.hypot(a.x - v.x, a.y - v.y)
    const lenB = Math.hypot(b.x - v.x, b.y - v.y)
    const arcR = Math.max(16, Math.min(lenA, lenB) * 0.3)
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
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.restore()
    }

    drawHandle(ctx, v, handleColor, isSelected, true)
    drawHandle(ctx, a, handleColor, isSelected)
    drawHandle(ctx, b, handleColor, isSelected)
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
    primary = false,
) {
    ctx.save()
    if (isSelected) {
        const r = primary ? 8 : 6.5
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 2
        ctx.stroke()
    } else {
        ctx.globalAlpha = 0.5
        ctx.beginPath()
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 1
        ctx.stroke()
    }
    ctx.restore()
}

function drawLabel(
    ctx: CanvasRenderingContext2D,
    m: Measurement,
    baseColor: string,
    isSelected: boolean,
) {
    const rect = labelRect(ctx, m)
    const labelAlpha = isSelected ? 1.0 : 0.5
    ctx.save()
    ctx.globalAlpha = labelAlpha
    ctx.fillStyle = isSelected ? baseColor : "rgba(0, 0, 0, 0.75)"
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 4)
    ctx.fill()
    if (isSelected) {
        ctx.strokeStyle = "#ffffff"
        ctx.lineWidth = 1
        ctx.stroke()
    }
    ctx.font = "bold 13px monospace"
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
    if (m.type === "ellipse") {
        return [
            { key: "center", pt: m.center },
            { key: "axisEndA", pt: m.axisEndA },
            { key: "axisEndB", pt: m.axisEndB },
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
    for (const m of ordered) {
        const rect = labelRect(ctx, m)
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
        } else if (m.type === "ellipse") {
            if (ellipseCurveDistance(cursorScreen, m) <= ELLIPSE_HIT_PX) {
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
    const needed = activeTool.value === "line" ? 2 : 3
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
    if (m.type === "ellipse") {
        return {
            ...m,
            center: { ...m.center },
            axisEndA: { ...m.axisEndA },
            axisEndB: { ...m.axisEndB },
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
        if (original.type === "ellipse") {
            return {
                ...original,
                center: { x: original.center.x + dx, y: original.center.y + dy },
                axisEndA: { x: original.axisEndA.x + dx, y: original.axisEndA.y + dy },
                axisEndB: { x: original.axisEndB.x + dx, y: original.axisEndB.y + dy },
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

function pointerDown(screenX: number, screenY: number): "measurement" | "pan" {
    const cursor = { x: screenX, y: screenY }
    const hit = hitTest(cursor)
    if (!hit) {
        // Empty-space click: deselect, fall through to pan behavior.
        if (selectedId.value !== null) {
            selectedId.value = null
            drawOverlay()
        }
        return "pan"
    }

    selectedId.value = hit.measurementId
    const target = measurements.value.find((m) => m.id === hit.measurementId)
    if (!target) {
        drawOverlay()
        return "measurement"
    }

    const mode: DragMode = hit.kind === "handle" ? "handle" : "move"
    dragState = {
        mode,
        measurementId: target.id,
        handleKey: hit.handleKey,
        startImg: screenToImg(screenX, screenY),
        startSnapshot: cloneMeasurement(target),
        moved: false,
    }
    drawOverlay()
    return "measurement"
}

function pointerMove(screenX: number, screenY: number): boolean {
    if (!dragState) return false
    const nowImg = screenToImg(screenX, screenY)
    const dxImg = nowImg.x - dragState.startImg.x
    const dyImg = nowImg.y - dragState.startImg.y
    if (!dragState.moved) {
        // Convert image-space delta back to screen-space via viewScale; easier
        // than tracking the original screen cursor separately.
        const screenDx = dxImg * viewScale.value
        const screenDy = dyImg * viewScale.value
        if (Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD_PX) return true
        dragState.moved = true
    }
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

function onMouseDown(e: MouseEvent) {
    const { x, y } = getCanvasXY(e)
    if (activeTool.value !== "none") {
        // Placement tools ignore mousedown; they commit on click so a user
        // can drag-scroll accidentally without placing a spurious point.
        return
    }
    const outcome = pointerDown(x, y)
    if (outcome === "pan") {
        isPanning = true
        panStart = { x: e.clientX - viewOffsetX.value, y: e.clientY - viewOffsetY.value }
    }
}

function onMouseMove(e: MouseEvent) {
    if (dragState) {
        const { x, y } = getCanvasXY(e)
        pointerMove(x, y)
        return
    }
    if (activeTool.value !== "none") {
        const { x, y } = getCanvasXY(e)
        placementCursor.value = screenToImg(x, y)
        drawOverlay()
        return
    }
    if (!isPanning) return
    viewOffsetX.value = e.clientX - panStart.x
    viewOffsetY.value = e.clientY - panStart.y
    redraw()
}

function onMouseUp() {
    pointerUp()
    isPanning = false
}

function onMouseLeave() {
    pointerUp()
    isPanning = false
    placementCursor.value = null
    drawOverlay()
}

function onClick(e: MouseEvent) {
    if (activeTool.value === "none") return
    // Guard against the click event that always follows a mousedown: if the
    // user panned or dragged, that wasn't a placement click. Here we have no
    // dragState at click-time because placements don't start one.
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
        if (activeTool.value !== "none") {
            placementCursor.value = screenToImg(x, y)
            return
        }
        const outcome = pointerDown(x, y)
        if (outcome === "pan") {
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
    if (activeTool.value === "ellipse") {
        if (n === 0) return "Click the ellipse center."
        if (n === 1) return "Click the first semi-axis endpoint."
        return "Click the second semi-axis endpoint."
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
        label: measurementLabel(m),
        color: getDatumColor(m.colorIndex),
        selected: m.id === selectedId.value,
    }))
})

// Scale bar export — unchanged from the previous version, preserved verbatim
// so downstream callers (ResultViewer) keep working if they ever wire it up.
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

        ctx.drawImage(image, 0, 0)

        ctx.fillStyle = "#000"
        ctx.fillRect(0, ih, iw, barHeightPx)

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

        ctx.fillStyle = "#fff"
        ctx.fillRect(barX, barY - barThick / 2, barWidthPx, barThick)

        ctx.fillRect(barX, barY - tickH / 2, Math.max(2, unit * 0.15), tickH)
        ctx.fillRect(barX + barWidthPx - Math.max(2, unit * 0.15), barY - tickH / 2, Math.max(2, unit * 0.15), tickH)

        const fontSize = Math.round(unit * 1.4)
        const label = `${String(barMm)} mm`
        ctx.font = `bold ${String(fontSize)}px monospace`
        ctx.fillStyle = "#fff"
        ctx.textAlign = "center"
        ctx.textBaseline = "bottom"
        ctx.fillText(label, barX + barWidthPx / 2, barY - tickH / 2 - Math.round(unit * 0.3))

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
    window.addEventListener("keydown", onKeyDown)
})

onUnmounted(() => {
    resizeObs?.disconnect()
    window.removeEventListener("keydown", onKeyDown)
})

watch(() => props.imageUrl, loadImg)
watch(showGrid, () => { drawOverlay() })
watch(gridSpacingMm, () => { drawOverlay() })
watch(() => props.scalePxPerMm, () => { drawOverlay() })
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
