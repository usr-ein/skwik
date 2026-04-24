/**
 * solver.ts — alternating-minimization solver around cv.findHomography.
 *
 * Each datum is converted to point correspondences (src → dst) whose dst
 * positions are recomputed from the current H and the datum's shape
 * constraint on every outer iteration. findHomography then refines H (DLT
 * initial estimate + internal Levenberg-Marquardt). We loop until H stops
 * changing.
 *
 * Shape constraints per datum type:
 *   rectangle (primary) — hard-anchored axis-aligned destination
 *   rectangle (other)   — Procrustes-fit ideal (w × h) rect to projected corners
 *   line                — preserve projected midpoint + direction, rescale to L
 *   ellipse             — sample N points; radially snap projections to a circle
 *                         of known diameter centred on the projected
 *                         user-marked centre point
 *
 * Confidence is the per-datum weight; we realise it as correspondence
 * replication (findHomography has no native weighting).
 */

import cv from "@techstark/opencv-js"
import type {
    Datum,
    DatumReport,
    DatumType,
    EllipseDatum,
    LineDatum,
    Point,
    RectDatum,
} from "@/types"

// ─── Tunables ───────────────────────────────────────────────────────────────

/** Extra weight on primary-datum anchor correspondences, on top of its
 *  confidence. Keeps the output gauge (orientation/position) stable across
 *  iterations while still letting consistent secondary data nudge H. */
const PRIMARY_GAUGE_BOOST = 3

/** Points sampled per ellipse datum (more points = tighter fit but more
 *  replicated correspondences). 12 gives good angular coverage. */
const ELLIPSE_SAMPLES = 12

const MAX_OUTER_ITERS = 30

/** Convergence threshold: max entrywise change in H between successive
 *  iterations, relative to the largest entry of H. A relative metric
 *  treats the small perspective entries (h[6], h[7] ≈ 1e-4) and the O(1)
 *  affine entries on the same footing. */
const CONVERGENCE_TOL = 1e-6

// ─── 3×3 matrix helpers ─────────────────────────────────────────────────────

export type Mat3 = [number, number, number, number, number, number, number, number, number]

function readMat3x3(M: InstanceType<typeof cv.Mat>): Mat3 {
    const d: number[] = []
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            d.push(M.doubleAt(r, c))
        }
    }
    return d as Mat3
}

function projectPoint(h: Mat3, p: Point): Point {
    const w = h[6] * p.x + h[7] * p.y + h[8]
    return {
        x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
        y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
    }
}

function normalized(h: Mat3): Mat3 {
    const s = h[8] !== 0 ? h[8] : 1
    return h.map((v) => v / s) as Mat3
}

/** Relative max-entry change between two homographies, normalised by the
 *  larger-magnitude entry in either matrix. Returns a dimensionless fraction
 *  so a single convergence threshold is meaningful across affine and
 *  perspective parameters. */
function relativeMaxDiff(a: Mat3, b: Mat3): number {
    let diff = 0
    let scale = 0
    for (let i = 0; i < 9; i++) {
        const av = Math.abs(a[i] ?? 0)
        const bv = Math.abs(b[i] ?? 0)
        if (av > scale) scale = av
        if (bv > scale) scale = bv
        const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0))
        if (d > diff) diff = d
    }
    return scale > 0 ? diff / scale : diff
}

/** Inverse of a 3×3 homography (row-major). Returns null if singular. */
function invertMat3(h: Mat3): Mat3 | null {
    const a = h[0]
    const b = h[1]
    const c = h[2]
    const d = h[3]
    const e = h[4]
    const f = h[5]
    const g = h[6]
    const hh = h[7]
    const i = h[8]
    const det =
        a * (e * i - f * hh) -
        b * (d * i - f * g) +
        c * (d * hh - e * g)
    if (Math.abs(det) < 1e-20) return null
    const invDet = 1 / det
    return [
        (e * i - f * hh) * invDet,
        (c * hh - b * i) * invDet,
        (b * f - c * e) * invDet,
        (f * g - d * i) * invDet,
        (a * i - c * g) * invDet,
        (c * d - a * f) * invDet,
        (d * hh - e * g) * invDet,
        (b * g - a * hh) * invDet,
        (a * e - b * d) * invDet,
    ]
}

// ─── Geometric helpers ──────────────────────────────────────────────────────

function dist(a: Point, b: Point): number {
    return Math.hypot(b.x - a.x, b.y - a.y)
}

function centroid(pts: Point[]): Point {
    let sx = 0
    let sy = 0
    for (const p of pts) {
        sx += p.x
        sy += p.y
    }
    return { x: sx / pts.length, y: sy / pts.length }
}

/**
 * Best rigid transform (rotation + translation, no scale) aligning src to dst.
 * Closed-form 2D Procrustes. Returns (R, t) with R @ src_i + t ≈ dst_i.
 */
function procrustes2D(
    src: Point[],
    dst: Point[],
): { cos: number; sin: number; tx: number; ty: number } {
    const cs = centroid(src)
    const cd = centroid(dst)
    let hxx = 0
    let hxy = 0
    let hyx = 0
    let hyy = 0
    for (let i = 0; i < src.length; i++) {
        const s = src[i]
        const d = dst[i]
        if (!s || !d) continue
        const sx = s.x - cs.x
        const sy = s.y - cs.y
        const dx = d.x - cd.x
        const dy = d.y - cd.y
        hxx += sx * dx
        hxy += sx * dy
        hyx += sy * dx
        hyy += sy * dy
    }
    // argmax over θ of tr(R · H^T) = cos·(hxx+hyy) + sin·(hyx−hxy)
    const theta = Math.atan2(hyx - hxy, hxx + hyy)
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    const tx = cd.x - (cos * cs.x - sin * cs.y)
    const ty = cd.y - (sin * cs.x + cos * cs.y)
    return { cos, sin, tx, ty }
}

function applyRT(
    p: Point,
    R: { cos: number; sin: number; tx: number; ty: number },
): Point {
    return {
        x: R.cos * p.x - R.sin * p.y + R.tx,
        y: R.sin * p.x + R.cos * p.y + R.ty,
    }
}

/**
 * Compute the 3×3 symmetric conic matrix E for an ellipse parameterised by
 * center and two (not necessarily orthogonal) conjugate semi-axes vA, vB.
 * Parametrically: p(t) = center + vA cos t + vB sin t. The ellipse's
 * quadratic form is (p − c)^T Q (p − c) = 1 with Q = (M M^T)^{-1} where
 * M = [vA | vB] (2×2). The homogeneous conic matrix is then assembled so
 * that [x y 1] E [x y 1]^T = 0 on the ellipse.
 */
function ellipseMatrix(
    center: Point,
    axisEndA: Point,
    axisEndB: Point,
): number[][] {
    const ax = axisEndA.x - center.x
    const ay = axisEndA.y - center.y
    const bx = axisEndB.x - center.x
    const by = axisEndB.y - center.y
    // M M^T = [[ax²+bx², ax·ay+bx·by], [·, ay²+by²]]
    const m00 = ax * ax + bx * bx
    const m01 = ax * ay + bx * by
    const m11 = ay * ay + by * by
    const det = m00 * m11 - m01 * m01
    if (Math.abs(det) < 1e-12) {
        throw new Error("Ellipse is degenerate (axes are collinear).")
    }
    // Q = (MM^T)^{-1}
    const q00 = m11 / det
    const q01 = -m01 / det
    const q11 = m00 / det
    const cx = center.x
    const cy = center.y
    // E (homogeneous): p^T E p = 0 with p = (x, y, 1)
    const e02 = -(q00 * cx + q01 * cy)
    const e12 = -(q01 * cx + q11 * cy)
    const e22 = q00 * cx * cx + 2 * q01 * cx * cy + q11 * cy * cy - 1
    return [
        [q00, q01, e02],
        [q01, q11, e12],
        [e02, e12, e22],
    ]
}

/** Sample N image-space points along the user-drawn ellipse. */
function sampleEllipse(
    center: Point,
    axisEndA: Point,
    axisEndB: Point,
    n: number,
): Point[] {
    const vAx = axisEndA.x - center.x
    const vAy = axisEndA.y - center.y
    const vBx = axisEndB.x - center.x
    const vBy = axisEndB.y - center.y
    const out: Point[] = []
    for (let i = 0; i < n; i++) {
        const t = (2 * Math.PI * i) / n
        const c = Math.cos(t)
        const s = Math.sin(t)
        out.push({
            x: center.x + vAx * c + vBx * s,
            y: center.y + vAy * c + vBy * s,
        })
    }
    return out
}

// ─── Primary selection (gauge) ──────────────────────────────────────────────

/** The "primary" datum fixes the output gauge (rotation, translation, scale)
 *  and provides the 4-point warm-start for the homography. We prefer
 *  rectangles (strongest gauge: 4 corners, aspect ratio), then ellipses
 *  (4 conjugate-axis samples fully pin H), then lines (weakest: only 2 real
 *  correspondences + synthetic perpendiculars). Within a type class, higher
 *  confidence and larger image size break ties. */
type Primary =
    | { kind: "rect"; datum: RectDatum }
    | { kind: "line"; datum: LineDatum }
    | { kind: "ellipse"; datum: EllipseDatum }

function pickPrimary(datums: Datum[]): Primary {
    if (datums.length === 0) throw new Error("No datums provided.")

    // User-flagged world-axis reference wins regardless of type priority.
    for (const d of datums) {
        if (d.type === "rectangle" && d.isAxisReference) {
            return { kind: "rect", datum: d }
        }
        if (d.type === "line" && d.axisRole) {
            return { kind: "line", datum: d }
        }
    }

    const typeRank = (d: Datum): number =>
        d.type === "rectangle" ? 0 : d.type === "ellipse" ? 1 : 2
    const sizeKey = (d: Datum): number => {
        if (d.type === "rectangle")
            return (
                dist(d.corners[0], d.corners[1]) *
                dist(d.corners[0], d.corners[3])
            )
        if (d.type === "line") return dist(d.endpoints[0], d.endpoints[1])
        return dist(d.center, d.axisEndA) * dist(d.center, d.axisEndB)
    }
    const sorted = [...datums].sort((a, b) => {
        const tr = typeRank(a) - typeRank(b)
        if (tr !== 0) return tr
        if (b.confidence !== a.confidence)
            return b.confidence - a.confidence
        return sizeKey(b) - sizeKey(a)
    })
    const best = sorted[0] as Datum
    if (best.type === "rectangle") return { kind: "rect", datum: best }
    if (best.type === "line") return { kind: "line", datum: best }
    return { kind: "ellipse", datum: best }
}

function primaryLabel(primary: Primary): string {
    return primary.datum.label
}

// ─── Correspondence builders per datum type ─────────────────────────────────

interface Correspondence {
    src: Point
    dst: Point
    weight: number // integer replication count
}

function primaryRectCorrespondences(
    rect: RectDatum,
    scale: number,
): Correspondence[] {
    const w = rect.widthMm * scale
    const h = rect.heightMm * scale
    // Corner order TL, TR, BR, BL matches the RectDatum contract
    const targets: [Point, Point, Point, Point] = [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
    ]
    const weight = Math.max(
        1,
        Math.round(rect.confidence * PRIMARY_GAUGE_BOOST),
    )
    return rect.corners.map((src, i) => ({
        src,
        dst: targets[i] as Point,
        weight,
    }))
}

/** Line primary: 2 real endpoints + 2 synthetic perpendicular points at
 *  the same image-space distance. Fixes the along-line scale exactly and
 *  assumes isotropic image scale perpendicular to the line (good warm-start;
 *  LM refines if other datums contradict it). */
function primaryLineCorrespondences(
    line: LineDatum,
    scale: number,
): Correspondence[] {
    const L = line.lengthMm * scale
    const p0 = line.endpoints[0]
    const p1 = line.endpoints[1]
    const dx = p1.x - p0.x
    const dy = p1.y - p0.y
    // 90° left-rotated copy of the line, same image length
    const p2: Point = { x: p0.x - dy, y: p0.y + dx }
    const p3: Point = { x: p1.x - dy, y: p1.y + dx }
    const srcPts: [Point, Point, Point, Point] = [p0, p1, p2, p3]

    // Default: line defines world +x. With axisRole === "y", endpoints land
    // along world +y and the synthetic perpendicular lands along +x.
    const targets: [Point, Point, Point, Point] =
        line.axisRole === "y"
            ? [
                  { x: 0, y: 0 },
                  { x: 0, y: L },
                  { x: L, y: 0 },
                  { x: L, y: L },
              ]
            : [
                  { x: 0, y: 0 },
                  { x: L, y: 0 },
                  { x: 0, y: L },
                  { x: L, y: L },
              ]
    const weight = Math.max(
        1,
        Math.round(line.confidence * PRIMARY_GAUGE_BOOST),
    )
    return srcPts.map((src, i) => ({
        src,
        dst: targets[i] as Point,
        weight,
    }))
}

/** Ellipse primary: 4 points on the user-drawn ellipse at t = 0, π/2, π,
 *  3π/2 (= center ± vA, center ± vB). Anchored to a world-circle of the
 *  known diameter. Fixes translation + rotation + scale via the axisEndA
 *  direction convention. */
function primaryEllipseCorrespondences(
    ellipse: EllipseDatum,
    scale: number,
): Correspondence[] {
    const r = (ellipse.diameterMm * scale) / 2
    const c = ellipse.center
    const vAx = ellipse.axisEndA.x - c.x
    const vAy = ellipse.axisEndA.y - c.y
    const vBx = ellipse.axisEndB.x - c.x
    const vBy = ellipse.axisEndB.y - c.y
    // Axes must not be (near-)collinear — otherwise the 4 anchor points are
    // collinear and getPerspectiveTransform gives a garbage homography.
    const cross = vAx * vBy - vAy * vBx
    if (Math.abs(cross) < 1e-6) {
        throw new Error(
            `Ellipse "${ellipse.label}" has collinear axes; drag its handles apart before solving.`,
        )
    }
    const srcPts: [Point, Point, Point, Point] = [
        { x: c.x + vAx, y: c.y + vAy }, // t = 0    → (+r, 0)
        { x: c.x + vBx, y: c.y + vBy }, // t = π/2  → (0, +r)
        { x: c.x - vAx, y: c.y - vAy }, // t = π    → (−r, 0)
        { x: c.x - vBx, y: c.y - vBy }, // t = 3π/2 → (0, −r)
    ]
    const targets: [Point, Point, Point, Point] = [
        { x: r, y: 0 },
        { x: 0, y: r },
        { x: -r, y: 0 },
        { x: 0, y: -r },
    ]
    const weight = Math.max(
        1,
        Math.round(ellipse.confidence * PRIMARY_GAUGE_BOOST),
    )
    return srcPts.map((src, i) => ({
        src,
        dst: targets[i] as Point,
        weight,
    }))
}

function primaryAnchors(primary: Primary, scale: number): Correspondence[] {
    if (primary.kind === "rect")
        return primaryRectCorrespondences(primary.datum, scale)
    if (primary.kind === "line")
        return primaryLineCorrespondences(primary.datum, scale)
    return primaryEllipseCorrespondences(primary.datum, scale)
}

function secondaryRectCorrespondences(
    rect: RectDatum,
    H: Mat3,
    scale: number,
): Correspondence[] {
    const w = rect.widthMm * scale
    const h = rect.heightMm * scale
    // Ideal (w × h) rect in local frame, same corner order
    const ideal: Point[] = [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
    ]
    // Project the user corners through current H to output space
    const projected = rect.corners.map((c) => projectPoint(H, c))
    // Best rigid placement of the ideal rect to those projections
    const rt = procrustes2D(ideal, projected)
    const targets = ideal.map((p) => applyRT(p, rt))
    const weight = Math.max(1, rect.confidence)
    return rect.corners.map((src, i) => ({
        src,
        dst: targets[i] as Point,
        weight,
    }))
}

function lineCorrespondences(
    line: LineDatum,
    H: Mat3,
    scale: number,
): Correspondence[] {
    const expected = line.lengthMm * scale
    const p0 = projectPoint(H, line.endpoints[0])
    const p1 = projectPoint(H, line.endpoints[1])
    const measured = dist(p0, p1)
    if (measured < 1e-6) {
        // Degenerate line, no useful correspondence this iteration
        return []
    }
    const mx = (p0.x + p1.x) / 2
    const my = (p0.y + p1.y) / 2
    const ux = (p1.x - p0.x) / measured
    const uy = (p1.y - p0.y) / measured
    const halfL = expected / 2
    const target0: Point = { x: mx - ux * halfL, y: my - uy * halfL }
    const target1: Point = { x: mx + ux * halfL, y: my + uy * halfL }
    const weight = Math.max(1, line.confidence)
    return [
        { src: line.endpoints[0], dst: target0, weight },
        { src: line.endpoints[1], dst: target1, weight },
    ]
}

function ellipseCorrespondences(
    ellipse: EllipseDatum,
    H: Mat3,
    scale: number,
): Correspondence[] {
    const r = (ellipse.diameterMm * scale) / 2
    const samples = sampleEllipse(
        ellipse.center,
        ellipse.axisEndA,
        ellipse.axisEndB,
        ELLIPSE_SAMPLES,
    )
    const projected = samples.map((p) => projectPoint(H, p))
    // Snap radially around the projected center of the world circle.
    // Under general perspective the centroid of boundary-point projections
    // is NOT the image of the center (it drifts with the foreshortening),
    // so we use the image of the user-marked center directly.
    const c = projectPoint(H, ellipse.center)
    const weight = Math.max(1, ellipse.confidence)
    const out: Correspondence[] = []
    for (let i = 0; i < samples.length; i++) {
        const src = samples[i]
        const q = projected[i]
        if (!src || !q) continue
        const dx = q.x - c.x
        const dy = q.y - c.y
        const d = Math.hypot(dx, dy)
        if (d < 1e-6) continue
        out.push({
            src,
            dst: { x: c.x + (dx / d) * r, y: c.y + (dy / d) * r },
            weight,
        })
    }
    return out
}

function buildCorrespondences(
    datums: Datum[],
    primary: Primary,
    H: Mat3,
    scale: number,
): Correspondence[] {
    const all: Correspondence[] = []
    for (const d of datums) {
        if (d === primary.datum) {
            all.push(...primaryAnchors(primary, scale))
            continue
        }
        if (d.type === "rectangle") {
            all.push(...secondaryRectCorrespondences(d, H, scale))
        } else if (d.type === "line") {
            all.push(...lineCorrespondences(d, H, scale))
        } else {
            all.push(...ellipseCorrespondences(d, H, scale))
        }
    }
    return all
}

// ─── findHomography wrapper ─────────────────────────────────────────────────

function solveHomography(
    correspondences: Correspondence[],
): Mat3 | null {
    // Replicate by weight to emulate per-correspondence weighting
    const src: number[] = []
    const dst: number[] = []
    let n = 0
    for (const c of correspondences) {
        for (let i = 0; i < c.weight; i++) {
            src.push(c.src.x, c.src.y)
            dst.push(c.dst.x, c.dst.y)
            n++
        }
    }
    if (n < 4) return null
    const srcMat = cv.matFromArray(n, 1, cv.CV_32FC2, src)
    const dstMat = cv.matFromArray(n, 1, cv.CV_32FC2, dst)
    let H: InstanceType<typeof cv.Mat> | null = null
    try {
        H = cv.findHomography(srcMat, dstMat, 0)
        if (H.rows !== 3 || H.cols !== 3) return null
        return normalized(readMat3x3(H))
    } finally {
        srcMat.delete()
        dstMat.delete()
        if (H) H.delete()
    }
}

// ─── Post-fit residual reporting ────────────────────────────────────────────

interface RawReport {
    label: string
    type: DatumType
    expectedMm: number
    measuredMm: number
    residuals: number[] // dimensionless fractions
    details: string
}

function residualForLine(
    line: LineDatum,
    H: Mat3,
    scale: number,
    isPrimary: boolean,
): RawReport {
    const p0 = projectPoint(H, line.endpoints[0])
    const p1 = projectPoint(H, line.endpoints[1])
    const measuredMm = dist(p0, p1) / scale
    const residual =
        line.lengthMm > 0
            ? (measuredMm - line.lengthMm) / line.lengthMm
            : 0
    const prefix = isPrimary ? "primary · " : ""
    return {
        label: line.label,
        type: "line",
        expectedMm: line.lengthMm,
        measuredMm,
        residuals: [residual],
        details: `${prefix}length ${(residual * 100).toFixed(2)}%`,
    }
}

function residualForRect(
    rect: RectDatum,
    H: Mat3,
    scale: number,
    isPrimary: boolean,
): RawReport {
    const p = rect.corners.map((c) => projectPoint(H, c))
    const w = rect.widthMm
    const h = rect.heightMm
    const sides = [
        { got: dist(p[0] as Point, p[1] as Point) / scale, exp: w }, // TL-TR
        { got: dist(p[1] as Point, p[2] as Point) / scale, exp: h }, // TR-BR
        { got: dist(p[2] as Point, p[3] as Point) / scale, exp: w }, // BR-BL
        { got: dist(p[3] as Point, p[0] as Point) / scale, exp: h }, // BL-TL
    ]
    const edgeRes = sides.map((s) => (s.exp > 0 ? (s.got - s.exp) / s.exp : 0))
    // Perpendicularity at TL and TR: cosine between adjacent edges
    const e0x = (p[1] as Point).x - (p[0] as Point).x
    const e0y = (p[1] as Point).y - (p[0] as Point).y
    const e1x = (p[3] as Point).x - (p[0] as Point).x
    const e1y = (p[3] as Point).y - (p[0] as Point).y
    const e2x = (p[2] as Point).x - (p[1] as Point).x
    const e2y = (p[2] as Point).y - (p[1] as Point).y
    const cosTL =
        (e0x * e1x + e0y * e1y) /
        (Math.hypot(e0x, e0y) * Math.hypot(e1x, e1y) + 1e-12)
    const cosTR =
        (-e0x * e2x + -e0y * e2y) /
        (Math.hypot(e0x, e0y) * Math.hypot(e2x, e2y) + 1e-12)
    const residuals = [...edgeRes, cosTL, cosTR]
    const avgEdge =
        (Math.abs(edgeRes[0] ?? 0) +
            Math.abs(edgeRes[1] ?? 0) +
            Math.abs(edgeRes[2] ?? 0) +
            Math.abs(edgeRes[3] ?? 0)) /
        4
    // |cos θ| ≈ |90° − θ| in radians for small deviations; convert to degrees
    const perpDeg =
        ((Math.asin(Math.min(1, Math.abs(cosTL))) +
            Math.asin(Math.min(1, Math.abs(cosTR)))) /
            2) *
        (180 / Math.PI)
    const measuredWidth =
        ((sides[0]?.got ?? 0) + (sides[2]?.got ?? 0)) / 2
    const prefix = isPrimary ? "primary · " : ""
    return {
        label: rect.label,
        type: "rectangle",
        expectedMm: w,
        measuredMm: measuredWidth,
        residuals,
        details: `${prefix}edge ${(avgEdge * 100).toFixed(2)}%, perp Δ${perpDeg.toFixed(2)}°`,
    }
}

function residualForEllipse(
    ellipse: EllipseDatum,
    H: Mat3,
    scale: number,
    isPrimary: boolean,
): RawReport {
    // E is the image-space ellipse conic; H maps image → output. The
    // output-space conic we want to check for circularity is therefore
    //     C = H^{-T} · E · H^{-1}
    // (points q on C iff H^{-1}·q lands on E). Using H^T·E·H computes the
    // wrong conic and produces meaningless diagnostic numbers.
    const E = ellipseMatrix(ellipse.center, ellipse.axisEndA, ellipse.axisEndB)
    const Hi = invertMat3(H)
    const zeroReport: RawReport = {
        label: ellipse.label,
        type: "ellipse",
        expectedMm: ellipse.diameterMm,
        measuredMm: 0,
        residuals: [0, 0, 0],
        details: "(H singular, cannot compute)",
    }
    if (!Hi) return zeroReport
    const HiT = [
        [Hi[0], Hi[3], Hi[6]],
        [Hi[1], Hi[4], Hi[7]],
        [Hi[2], Hi[5], Hi[8]],
    ]
    const Hm = [
        [Hi[0], Hi[1], Hi[2]],
        [Hi[3], Hi[4], Hi[5]],
        [Hi[6], Hi[7], Hi[8]],
    ]
    // C = HiT · E · Hm    (= H^{-T} E H^{-1})
    const EH: number[][] = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
    ]
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            let s = 0
            for (let k = 0; k < 3; k++) {
                s += (E[i]?.[k] ?? 0) * (Hm[k]?.[j] ?? 0)
            }
            ;(EH[i] as number[])[j] = s
        }
    }
    const C: number[][] = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
    ]
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            let s = 0
            for (let k = 0; k < 3; k++) {
                s += (HiT[i]?.[k] ?? 0) * (EH[k]?.[j] ?? 0)
            }
            ;(C[i] as number[])[j] = s
        }
    }
    const a = C[0]?.[0] ?? 0
    const b = C[0]?.[1] ?? 0
    const c = C[1]?.[1] ?? 0
    const d = C[0]?.[2] ?? 0
    const e = C[1]?.[2] ?? 0
    const f = C[2]?.[2] ?? 0
    const sum = a + c
    const iso = sum !== 0 ? (a - c) / sum : 0
    const skew = sum !== 0 ? (2 * b) / sum : 0
    const rExp = (ellipse.diameterMm * scale) / 2

    // Geometric-mean radius from the general (possibly non-circular) conic.
    // After centring, the conic is u^T A u = K with A = [[a, b], [b, c]] and
    //     K = a·x0² + 2b·x0·y0 + c·y0² − f,  (x0, y0) = −A^{-1}(d, e).
    // Semi-axes are √(K/λ_±), so √(semi_major · semi_minor) = √(K / √det A).
    // This coincides with the circle radius when a = c and b = 0, and stays
    // meaningful (= area-equivalent radius) while the solver drives the
    // conic toward being a circle.
    const det = a * c - b * b
    let rMeasured = 0
    if (det > 0) {
        const x0 = (b * e - c * d) / det
        const y0 = (b * d - a * e) / det
        const K = a * x0 * x0 + 2 * b * x0 * y0 + c * y0 * y0 - f
        if (K > 0) rMeasured = Math.sqrt(K / Math.sqrt(det))
    }
    // The dia residual drives the solver; we divide by rExp for scale-free.
    // When the conic is still clearly non-circular the per-axis semi-axes
    // differ, so we penalise by the geometric-mean radius — which is what
    // we want to land at rExp once iso/skew have been driven to zero.
    const diaRes = rExp > 0 ? (rMeasured - rExp) / rExp : 0
    const prefix = isPrimary ? "primary · " : ""
    return {
        label: ellipse.label,
        type: "ellipse",
        expectedMm: ellipse.diameterMm,
        measuredMm: (rMeasured * 2) / scale,
        residuals: [iso, skew, diaRes],
        details: `${prefix}iso ${(iso * 100).toFixed(2)}%, skew ${(skew * 100).toFixed(2)}%, dia ${(diaRes * 100).toFixed(2)}%`,
    }
}

function buildReports(
    datums: Datum[],
    primary: Primary,
    H: Mat3,
    scale: number,
): { reports: DatumReport[]; rmsPercent: number } {
    const raw: RawReport[] = datums.map((d) => {
        const isPrimary = d === primary.datum
        if (d.type === "line")
            return residualForLine(d, H, scale, isPrimary)
        if (d.type === "rectangle")
            return residualForRect(d, H, scale, isPrimary)
        return residualForEllipse(d, H, scale, isPrimary)
    })
    const reports: DatumReport[] = raw.map((r) => {
        const rms =
            Math.sqrt(
                r.residuals.reduce((s, x) => s + x * x, 0) /
                    Math.max(1, r.residuals.length),
            ) * 100
        return {
            label: r.label,
            type: r.type,
            expectedMm: r.expectedMm,
            measuredMm: r.measuredMm,
            errorPercent: rms,
            details: r.details,
        }
    })
    let sumSq = 0
    let n = 0
    for (const r of raw) {
        for (const x of r.residuals) {
            sumSq += x * x
            n++
        }
    }
    const rmsPercent = n > 0 ? Math.sqrt(sumSq / n) * 100 : 0
    return { reports, rmsPercent }
}

// ─── Public entry point ─────────────────────────────────────────────────────

interface SolverResult {
    /** 3×3 homography (row-major) mapping source-image px → output px. */
    H: Mat3
    /** Label of the datum used as the gauge reference (useful for UI). */
    primaryLabel: string
    /** Type of the primary, so callers can report it meaningfully. */
    primaryType: DatumType
    iterations: number
    reports: DatumReport[]
    rmsPercent: number
}

function warmStartH(primary: Primary, scale: number): Mat3 {
    const anchors = primaryAnchors(primary, scale)
    // Guaranteed 4 anchors for any primary kind
    const src = cv.matFromArray(
        4,
        1,
        cv.CV_32FC2,
        anchors.flatMap((c) => [c.src.x, c.src.y]),
    )
    const dst = cv.matFromArray(
        4,
        1,
        cv.CV_32FC2,
        anchors.flatMap((c) => [c.dst.x, c.dst.y]),
    )
    try {
        const M = cv.getPerspectiveTransform(src, dst)
        const h = normalized(readMat3x3(M))
        M.delete()
        return h
    } finally {
        src.delete()
        dst.delete()
    }
}

export function solveHomographyForDatums(
    datums: Datum[],
    scale: number,
): SolverResult {
    const primary = pickPrimary(datums)
    let H = warmStartH(primary, scale)

    let iterations = 0
    let Hprev: Mat3 | null = null
    let oscillationWarned = false
    for (let iter = 0; iter < MAX_OUTER_ITERS; iter++) {
        const corrs = buildCorrespondences(datums, primary, H, scale)
        const Hnew = solveHomography(corrs)
        iterations = iter + 1
        if (!Hnew) break
        const delta = relativeMaxDiff(H, Hnew)

        // Period-2 oscillation detection: if we're closer to two steps ago
        // than to one step ago, the outer loop is cycling between two H
        // values rather than converging. Alternating minimisation gives no
        // monotone-decrease guarantee (no coherent global objective), so
        // this can happen with adversarial datum combinations.
        if (
            !oscillationWarned &&
            Hprev &&
            iter >= 3 &&
            delta > CONVERGENCE_TOL
        ) {
            const deltaSkip = relativeMaxDiff(Hprev, Hnew)
            if (deltaSkip < delta * 0.25) {
                console.warn(
                    `[solver] outer loop appears to be oscillating (iter=${String(iter + 1)}, δ=${delta.toExponential(2)}, δ_skip=${deltaSkip.toExponential(2)}). Result may not be optimal.`,
                )
                oscillationWarned = true
            }
        }

        Hprev = H
        H = Hnew
        if (delta < CONVERGENCE_TOL) break
    }

    const { reports, rmsPercent } = buildReports(datums, primary, H, scale)
    return {
        H,
        primaryLabel: primaryLabel(primary),
        primaryType: primary.datum.type,
        iterations,
        reports,
        rmsPercent,
    }
}
