import type { CropRotateState } from "@/types"

// Per-file-hash storage of the user's rotation + crop choices for the
// Crop & Rotate step. Mirrors the shape of `measurement-cache.ts`. We
// store fractional crop bounds (0..1) of the rotated image so the same
// crop applies cleanly after a re-deskew at a different output px/mm.

const KEY_PREFIX = "skwik-crop-"

export function saveCropRotate(hash: string, state: CropRotateState): void {
    try {
        localStorage.setItem(KEY_PREFIX + hash, JSON.stringify(state))
    } catch {
        // localStorage full or unavailable — silently ignore
    }
}

export function loadCropRotate(hash: string): CropRotateState | null {
    try {
        const raw = localStorage.getItem(KEY_PREFIX + hash)
        if (!raw) return null
        const parsed = JSON.parse(raw) as Partial<CropRotateState> | null
        if (!parsed || typeof parsed !== "object") return null
        const rot = parsed.rotationDeg
        const c = parsed.crop
        if (
            typeof rot !== "number" ||
            !c ||
            typeof c.left !== "number" ||
            typeof c.top !== "number" ||
            typeof c.right !== "number" ||
            typeof c.bottom !== "number"
        ) {
            return null
        }
        return { rotationDeg: rot, crop: { left: c.left, top: c.top, right: c.right, bottom: c.bottom } }
    } catch {
        return null
    }
}

export function clearCache(): void {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith(KEY_PREFIX)) toRemove.push(key)
    }
    for (const key of toRemove) localStorage.removeItem(key)
}
