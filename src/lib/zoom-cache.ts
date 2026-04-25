// Per-image zoom + pan state for the corrected-image canvas. Persisted
// so that revisiting the same upload restores the exact view the user
// last left it in. Keyed by file hash, same convention as datums and
// measurements.

const KEY_PREFIX = "skwik-zoom-"

export interface ZoomState {
    /** Canvas-px / image-px scale. */
    viewScale: number
    /** Image origin in canvas px (top-left of the image in canvas space). */
    viewOffsetX: number
    viewOffsetY: number
}

export function saveZoom(hash: string, zoom: ZoomState): void {
    try {
        localStorage.setItem(KEY_PREFIX + hash, JSON.stringify(zoom))
    } catch {
        // localStorage full or unavailable — silently ignore
    }
}

export function loadZoom(hash: string): ZoomState | null {
    try {
        const raw = localStorage.getItem(KEY_PREFIX + hash)
        if (!raw) return null
        return JSON.parse(raw) as ZoomState
    } catch {
        return null
    }
}

export function clearZoom(hash: string): void {
    try {
        localStorage.removeItem(KEY_PREFIX + hash)
    } catch {
        // ignore
    }
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
