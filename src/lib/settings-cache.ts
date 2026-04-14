export interface SkwikSettings {
    scalePxPerMm: number
    includeScaleBar: boolean
}

const KEY = "skwik-settings"

export function saveSettings(settings: SkwikSettings): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
        // localStorage full or unavailable — silently ignore
    }
}

export function loadSettings(): SkwikSettings | null {
    try {
        const raw = localStorage.getItem(KEY)
        if (!raw) return null
        return JSON.parse(raw) as SkwikSettings
    } catch {
        return null
    }
}
