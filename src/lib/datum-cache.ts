import type { Datum, EllipseDatum, Point } from "@/types"

const KEY_PREFIX = "skwik-datums-"

export function saveDatums(hash: string, datums: Datum[]): void {
    try {
        localStorage.setItem(
            KEY_PREFIX + hash,
            JSON.stringify(datums),
        )
    } catch {
        // localStorage full or unavailable — silently ignore
    }
}

export function loadDatums(hash: string): Datum[] | null {
    try {
        const raw = localStorage.getItem(KEY_PREFIX + hash)
        if (!raw) return null
        const parsed = JSON.parse(raw) as Datum[]
        return parsed.map(migrateDatum)
    } catch {
        return null
    }
}

/** Legacy ellipse datums stored only center+axisEndA+axisEndB (pre 8-point
 *  fit). On load, synthesize 8 sample points from those axes so the new
 *  fit-based pipeline has something to work with. */
function migrateDatum(d: Datum): Datum {
    if (d.type !== "ellipse") return d
    const e = d as EllipseDatum
    if (Array.isArray(e.points) && e.points.length >= 5) return e
    const vAx = e.axisEndA.x - e.center.x
    const vAy = e.axisEndA.y - e.center.y
    const vBx = e.axisEndB.x - e.center.x
    const vBy = e.axisEndB.y - e.center.y
    const N = 8
    const points: Point[] = []
    for (let i = 0; i < N; i++) {
        const t = (2 * Math.PI * i) / N
        const cs = Math.cos(t)
        const sn = Math.sin(t)
        points.push({
            x: e.center.x + vAx * cs + vBx * sn,
            y: e.center.y + vAy * cs + vBy * sn,
        })
    }
    return { ...e, points }
}

export function clearCache(): void {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith(KEY_PREFIX)) {
            toRemove.push(key)
        }
    }
    for (const key of toRemove) {
        localStorage.removeItem(key)
    }
}

export function getCacheSize(): number {
    let count = 0
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith(KEY_PREFIX)) {
            count++
        }
    }
    return count
}
