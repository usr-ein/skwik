import type { Datum } from "@/types"

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
        return JSON.parse(raw) as Datum[]
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
