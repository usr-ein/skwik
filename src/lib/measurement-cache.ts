import type { Measurement } from "@/types/measurements"

const KEY_PREFIX = "skwik-measurements-"

export function saveMeasurements(
    hash: string,
    measurements: Measurement[],
): void {
    try {
        localStorage.setItem(
            KEY_PREFIX + hash,
            JSON.stringify(measurements),
        )
    } catch {
        // localStorage full or unavailable — silently ignore
    }
}

export function loadMeasurements(hash: string): Measurement[] | null {
    try {
        const raw = localStorage.getItem(KEY_PREFIX + hash)
        if (!raw) return null
        return JSON.parse(raw) as Measurement[]
    } catch {
        return null
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
