/**
 * ellipse-fit.ts — algebraic least-squares ellipse fit from N≥5 points.
 *
 * Solves the conic `a·x² + b·xy + c·y² + d·x + e·y + f = 0` by fixing
 * `f = −1` (i.e. solving `a·x² + b·xy + c·y² + d·x + e·y = 1`) after
 * data-normalising points to centroid = 0 / RMS distance = 1. This is
 * numerically well-behaved for the 5–20-point user-placed case we need,
 * and does not require SVD. Fit can silently degenerate to a hyperbola
 * if the user's points don't look like an ellipse — we detect that and
 * return null.
 */

import type { Point } from "@/types"

interface EllipseFit {
    center: Point
    /** Offset vector from center to the semi-major axis endpoint. */
    semiMajor: Point
    /** Offset vector from center to the semi-minor axis endpoint
     *  (perpendicular to semiMajor). */
    semiMinor: Point
}

export function fitEllipse(points: Point[]): EllipseFit | null {
    if (points.length < 5) return null

    // ── Data normalisation: centroid to origin, mean distance to 1. ─────
    let sx = 0
    let sy = 0
    for (const p of points) {
        sx += p.x
        sy += p.y
    }
    const cx = sx / points.length
    const cy = sy / points.length
    let meanDist = 0
    for (const p of points) {
        meanDist += Math.hypot(p.x - cx, p.y - cy)
    }
    meanDist /= points.length
    if (meanDist < 1e-9) return null
    const s = 1 / meanDist

    // ── 5×5 normal equations: Σ rᵢ·rᵢᵀ · p = Σ rᵢ, where rᵢ is the
    //    row [x², xy, y², x, y] in normalised coords and the RHS is 1
    //    (the −f term we fixed). ──────────────────────────────────────
    const M: number[][] = [
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
    ]
    const v: number[] = [0, 0, 0, 0, 0]
    for (const p of points) {
        const nx = (p.x - cx) * s
        const ny = (p.y - cy) * s
        const r = [nx * nx, nx * ny, ny * ny, nx, ny]
        for (let i = 0; i < 5; i++) {
            v[i] = (v[i] ?? 0) + (r[i] ?? 0)
            for (let j = 0; j < 5; j++) {
                const row = M[i] as number[]
                row[j] = (row[j] ?? 0) + (r[i] ?? 0) * (r[j] ?? 0)
            }
        }
    }

    const sol = solve5(M, v)
    if (!sol) return null
    const aN = sol[0] ?? 0
    const bN = sol[1] ?? 0
    const cN = sol[2] ?? 0
    const dN = sol[3] ?? 0
    const eN = sol[4] ?? 0

    // ── Un-normalise back to original image coords. ─────────────────────
    // x' = (x − cx)·s ; y' = (y − cy)·s ; the conic
    //   aN·x'² + bN·x'y' + cN·y'² + dN·x' + eN·y' − 1 = 0
    // expands to `a x² + b xy + c y² + d x + e y + f = 0` with
    const s2 = s * s
    const a = aN * s2
    const b = bN * s2
    const c = cN * s2
    const d = dN * s - 2 * aN * s2 * cx - bN * s2 * cy
    const e = eN * s - bN * s2 * cx - 2 * cN * s2 * cy
    const f =
        aN * s2 * cx * cx +
        bN * s2 * cx * cy +
        cN * s2 * cy * cy -
        dN * s * cx -
        eN * s * cy -
        1

    // ── Geometric extraction. ───────────────────────────────────────────
    // Quadratic-form matrix is [[a, b/2], [b/2, c]] because the xy coef
    // is split symmetrically; det = ac − b²/4. An ellipse needs det > 0.
    const det = a * c - (b * b) / 4
    if (det <= 0) return null

    // Center from ∇F = 0:
    //   2a·x₀ + b·y₀ + d = 0
    //   b·x₀ + 2c·y₀ + e = 0
    const denom = 4 * a * c - b * b
    if (Math.abs(denom) < 1e-20) return null
    const x0 = (b * e - 2 * c * d) / denom
    const y0 = (b * d - 2 * a * e) / denom

    // Constant after centering: F(x₀, y₀) = f − (a·x₀² + b·x₀·y₀ + c·y₀²),
    // so the centered form is a·u² + b·uv + c·v² = K where K = -F(x₀, y₀).
    const K = a * x0 * x0 + b * x0 * y0 + c * y0 * y0 - f
    if (K <= 0) return null

    // Eigen-decompose the quadratic-form matrix to get semi-axis directions.
    // λ₁ ≥ λ₂ ≥ 0 ; semi-axis length = √(K / λ). Smaller λ → semi-major.
    const trace = a + c
    const diff = a - c
    const disc = Math.sqrt(diff * diff + b * b)
    const lMax = (trace + disc) / 2
    const lMin = (trace - disc) / 2
    if (lMin <= 0) return null
    const rMajor = Math.sqrt(K / lMin)
    const rMinor = Math.sqrt(K / lMax)

    // Eigenvector for lMin (semi-major axis direction):
    //   (a − lMin) vₓ + (b/2) v_y = 0   ⇒   v = (b/2, lMin − a)
    // If b is ≈ 0 the matrix is already diagonal, so axes are aligned.
    let ux = 0
    let uy = 0
    if (Math.abs(b) > 1e-12) {
        ux = b / 2
        uy = lMin - a
    } else if (a <= c) {
        ux = 1
        uy = 0
    } else {
        ux = 0
        uy = 1
    }
    const n = Math.hypot(ux, uy)
    if (n < 1e-12) return null
    ux /= n
    uy /= n

    return {
        center: { x: x0, y: y0 },
        semiMajor: { x: ux * rMajor, y: uy * rMajor },
        // 90° rotation gives the perpendicular (semi-minor) direction.
        semiMinor: { x: -uy * rMinor, y: ux * rMinor },
    }
}

/** 5×5 linear solve via Gauss-Jordan elimination with partial pivoting.
 *  Returns null if the matrix is (near-)singular. */
function solve5(M: number[][], v: number[]): number[] | null {
    const n = 5
    const aug: number[][] = []
    for (let i = 0; i < n; i++) {
        const row = M[i] as number[]
        aug.push([row[0] ?? 0, row[1] ?? 0, row[2] ?? 0, row[3] ?? 0, row[4] ?? 0, v[i] ?? 0])
    }
    for (let col = 0; col < n; col++) {
        let pivot = col
        let pivotAbs = Math.abs((aug[col] as number[])[col] ?? 0)
        for (let r = col + 1; r < n; r++) {
            const vv = Math.abs((aug[r] as number[])[col] ?? 0)
            if (vv > pivotAbs) {
                pivotAbs = vv
                pivot = r
            }
        }
        if (pivotAbs < 1e-12) return null
        if (pivot !== col) {
            const tmp = aug[col]
            aug[col] = aug[pivot] as number[]
            aug[pivot] = tmp as number[]
        }
        const pivRow = aug[col] as number[]
        const pv = pivRow[col] as number
        for (let c2 = col; c2 <= n; c2++) {
            pivRow[c2] = (pivRow[c2] as number) / pv
        }
        for (let r = 0; r < n; r++) {
            if (r === col) continue
            const rr = aug[r] as number[]
            const factor = rr[col] as number
            if (factor === 0) continue
            for (let c2 = col; c2 <= n; c2++) {
                rr[c2] = (rr[c2] as number) - factor * (pivRow[c2] as number)
            }
        }
    }
    return aug.map((row) => (row as number[])[n] as number)
}
