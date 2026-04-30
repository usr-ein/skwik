<script setup lang="ts">
import { ref } from "vue"
import { useAppStore } from "@/stores/app"
import {
    RECT_PRESETS,
    CIRCLE_PRESETS,
    createRectDatum,
    createLineDatum,
    createEllipseDatum,
    getDatumColor,
} from "@/lib/datums"
import type { ConfidenceScore, Datum, RectDatum } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const store = useAppStore()

// Raw input buffers for the mm-dimension fields, keyed `${datumId}.${field}`.
// We need a separate buffer because parsing "21," (a typo or a comma-locale
// keystroke) gives NaN — without this map, writing NaN to the datum and
// reading `String(d.widthMm)` back gives "NaN" in the input on next render,
// which is worse than letting the user finish typing. The buffer is dropped
// for a field whenever the stored numeric value diverges from the buffered
// parse, signalling an external mutation (preset button, rect-dim swap).
const dimRawInputs = ref(new Map<string, string>())

function dimKey(id: string, field: string): string {
    return `${id}.${field}`
}

type DimField = "widthMm" | "heightMm" | "lengthMm" | "diameterMm"

function readDim(datum: Datum, field: DimField): number {
    const stored = (datum as unknown as Record<string, unknown>)[field]
    return typeof stored === "number" ? stored : NaN
}

function dimDisplay(datum: Datum, field: DimField): string {
    const storedNum = readDim(datum, field)
    const buffered = dimRawInputs.value.get(dimKey(datum.id, field))
    if (buffered !== undefined) {
        if (!Number.isFinite(storedNum) || Number(buffered) === storedNum) {
            return buffered
        }
        // External mutation — drop the buffer so the new stored value
        // shows up on the next render.
        dimRawInputs.value.delete(dimKey(datum.id, field))
    }
    return Number.isFinite(storedNum) ? String(storedNum) : ""
}

function dimInput(datum: Datum, field: DimField, v: string | number) {
    const raw = String(v)
    dimRawInputs.value.set(dimKey(datum.id, field), raw)
    // Number("") and Number("21,") both return NaN — the canProceedToStep4
    // gate filters those out, so we don't have to here.
    store.updateDatum(datum.id, { [field]: Number(raw) } as Partial<Datum>)
}

function dimValid(datum: Datum, field: DimField): boolean {
    const stored = readDim(datum, field)
    return Number.isFinite(stored) && stored > 0
}

function imageCenter() {
    const img = store.loadedImage
    if (!img) return { x: 400, y: 300 }
    return { x: img.naturalWidth / 2, y: img.naturalHeight / 2 }
}

function nextRectIndex(): number {
    return store.datums.filter((d) => d.type === "rectangle").length + 1
}

function nextLineIndex(): number {
    return store.datums.filter((d) => d.type === "line").length + 1
}

function nextEllipseIndex(): number {
    return store.datums.filter((d) => d.type === "ellipse").length + 1
}

function addRect(presetLabel?: string) {
    const preset = presetLabel
        ? RECT_PRESETS.find((p) => p.label === presetLabel)
        : undefined
    store.addDatum(createRectDatum(imageCenter(), nextRectIndex(), preset))
}

function addLine() {
    store.addDatum(createLineDatum(imageCenter(), nextLineIndex()))
}

function addCircle(presetLabel?: string) {
    const preset = presetLabel
        ? CIRCLE_PRESETS.find((p) => p.label === presetLabel)
        : undefined
    store.addDatum(
        createEllipseDatum(imageCenter(), nextEllipseIndex(), preset),
    )
}

function updateField(datum: Datum, field: string, value: string | number) {
    store.updateDatum(datum.id, { [field]: value })
}

function swapRectDims(datum: RectDatum) {
    store.updateDatum(datum.id, {
        widthMm: datum.heightMm,
        heightMm: datum.widthMm,
    })
}

function updateConfidence(datum: Datum, val: number[] | undefined) {
    if (!val) return
    const v = val[0]
    if (v !== undefined && v >= 1 && v <= 5) {
        store.updateDatum(datum.id, { confidence: v as ConfidenceScore })
    }
}

function formatDimensions(datum: Datum): string {
    if (datum.type === "rectangle") {
        return `${String(datum.widthMm)} \u00D7 ${String(datum.heightMm)} mm`
    }
    if (datum.type === "line") {
        return `${String(datum.lengthMm)} mm`
    }
    return `⌀ ${String(datum.diameterMm)} mm`
}

function typeBadge(datum: Datum): string {
    if (datum.type === "rectangle") return "Rect"
    if (datum.type === "line") return "Line"
    return "Circle"
}

function axisBadge(datum: Datum): string | null {
    if (datum.type === "rectangle" && datum.isAxisReference) return "axis"
    if (datum.type === "line" && datum.axisRole === "x") return "+x"
    if (datum.type === "line" && datum.axisRole === "y") return "+y"
    if (datum.type === "ellipse" && datum.isPrimary) return "primary"
    return null
}
</script>

<template>
    <div class="flex h-full flex-col gap-4 overflow-y-auto p-4">
        <!-- Add datum controls -->
        <Card class="shrink-0">
            <CardHeader class="pb-3">
                <CardTitle class="text-sm">Add Datum</CardTitle>
            </CardHeader>
            <CardContent class="space-y-3">
                <div class="grid grid-cols-3 gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        class="w-full"
                        @click="addRect()"
                    >
                        + Rect
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        class="w-full"
                        @click="addLine"
                    >
                        + Line
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        class="w-full"
                        @click="addCircle()"
                    >
                        + Circle
                    </Button>
                </div>
                <div class="flex flex-wrap gap-1.5">
                    <Button
                        v-for="preset in RECT_PRESETS"
                        :key="preset.label"
                        variant="secondary"
                        size="sm"
                        class="h-7 text-xs"
                        @click="addRect(preset.label)"
                    >
                        {{ preset.label }}
                    </Button>
                    <Button
                        v-for="preset in CIRCLE_PRESETS"
                        :key="`circle-${preset.label}`"
                        variant="secondary"
                        size="sm"
                        class="h-7 text-xs"
                        @click="addCircle(preset.label)"
                    >
                        ⌀ {{ preset.label }}
                    </Button>
                </div>
            </CardContent>
        </Card>

        <Separator />

        <!-- Datum list -->
        <div class="space-y-3">
            <p
                class="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
                Datums ({{ store.datums.length }})
            </p>

            <p
                v-if="store.datums.length === 0"
                class="text-sm text-muted-foreground"
            >
                No datums added yet. Use the controls above.
            </p>

            <Card
                v-for="(datum, idx) in store.datums"
                :key="datum.id"
                class="cursor-pointer transition-colors"
                :class="
                    store.selectedDatumId === datum.id
                        ? 'ring-2 ring-primary'
                        : 'hover:bg-accent/50'
                "
                @click="store.selectedDatumId = datum.id"
            >
                <CardContent class="space-y-3 pt-4">
                    <!-- Header -->
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <div
                                class="h-3 w-3 rounded-full"
                                :style="{ backgroundColor: getDatumColor(idx) }"
                            />
                            <Badge variant="outline" class="text-xs">
                                {{ typeBadge(datum) }}
                            </Badge>
                            <Badge
                                v-if="axisBadge(datum)"
                                variant="default"
                                class="text-xs"
                            >
                                {{ axisBadge(datum) }}
                            </Badge>
                            <span class="text-xs text-muted-foreground">{{
                                formatDimensions(datum)
                            }}</span>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            class="h-6 w-6 text-destructive"
                            @click.stop="store.removeDatum(datum.id)"
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
                                <path d="M3 6h18" />
                                <path
                                    d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"
                                />
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                            </svg>
                        </Button>
                    </div>

                    <!-- Label -->
                    <div>
                        <Label class="text-xs">Label</Label>
                        <Input
                            :model-value="datum.label"
                            class="mt-1 h-8 text-sm"
                            @update:model-value="
                                (v: string | number) =>
                                    updateField(datum, 'label', String(v))
                            "
                            @click.stop
                        />
                    </div>

                    <!-- Dimensions -->
                    <div
                        v-if="datum.type === 'rectangle'"
                        class="grid grid-cols-[1fr_auto_1fr] items-end gap-2"
                    >
                        <div>
                            <Label class="text-xs">Width (mm)</Label>
                            <Input
                                :model-value="dimDisplay(datum, 'widthMm')"
                                type="text"
                                inputmode="decimal"
                                class="mt-1 h-8 text-sm"
                                :class="
                                    dimValid(datum, 'widthMm')
                                        ? ''
                                        : 'border-destructive ring-2 ring-destructive/30'
                                "
                                @update:model-value="
                                    (v: string | number) =>
                                        dimInput(datum, 'widthMm', v)
                                "
                                @click.stop
                            />
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            class="h-8 w-8 shrink-0 text-muted-foreground"
                            title="Swap width and height"
                            aria-label="Swap width and height"
                            @click.stop="swapRectDims(datum as RectDatum)"
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
                                <polyline points="17 1 21 5 17 9" />
                                <path d="M3 11V9a2 2 0 0 1 2-2h16" />
                                <polyline points="7 23 3 19 7 15" />
                                <path d="M21 13v2a2 2 0 0 1-2 2H3" />
                            </svg>
                        </Button>
                        <div>
                            <Label class="text-xs">Height (mm)</Label>
                            <Input
                                :model-value="dimDisplay(datum, 'heightMm')"
                                type="text"
                                inputmode="decimal"
                                class="mt-1 h-8 text-sm"
                                :class="
                                    dimValid(datum, 'heightMm')
                                        ? ''
                                        : 'border-destructive ring-2 ring-destructive/30'
                                "
                                @update:model-value="
                                    (v: string | number) =>
                                        dimInput(datum, 'heightMm', v)
                                "
                                @click.stop
                            />
                        </div>
                    </div>
                    <div v-else-if="datum.type === 'line'">
                        <Label class="text-xs">Length (mm)</Label>
                        <Input
                            :model-value="dimDisplay(datum, 'lengthMm')"
                            type="text"
                            inputmode="decimal"
                            class="mt-1 h-8 text-sm"
                            :class="
                                dimValid(datum, 'lengthMm')
                                    ? ''
                                    : 'border-destructive ring-2 ring-destructive/30'
                            "
                            @update:model-value="
                                (v: string | number) =>
                                    dimInput(datum, 'lengthMm', v)
                            "
                            @click.stop
                        />
                    </div>
                    <div v-else>
                        <Label class="text-xs">Diameter (mm)</Label>
                        <Input
                            :model-value="dimDisplay(datum, 'diameterMm')"
                            type="text"
                            inputmode="decimal"
                            class="mt-1 h-8 text-sm"
                            :class="
                                dimValid(datum, 'diameterMm')
                                    ? ''
                                    : 'border-destructive ring-2 ring-destructive/30'
                            "
                            @update:model-value="
                                (v: string | number) =>
                                    dimInput(datum, 'diameterMm', v)
                            "
                            @click.stop
                        />
                    </div>

                    <!-- World-axis role -->
                    <div
                        v-if="datum.type === 'rectangle'"
                        class="flex items-center justify-between"
                    >
                        <Label class="text-xs">World axis reference</Label>
                        <label
                            class="flex cursor-pointer items-center gap-1.5"
                            @click.stop
                        >
                            <input
                                type="checkbox"
                                class="accent-primary"
                                :checked="datum.isAxisReference ?? false"
                                @change="
                                    (e) =>
                                        store.setAxisRole(
                                            datum.id,
                                            (e.target as HTMLInputElement)
                                                .checked
                                                ? 'rect'
                                                : null,
                                        )
                                "
                            />
                            <span class="text-xs text-muted-foreground"
                                >Use</span
                            >
                        </label>
                    </div>
                    <div v-else-if="datum.type === 'line'">
                        <Label class="text-xs">World axis</Label>
                        <div class="mt-1 grid grid-cols-3 gap-1">
                            <button
                                v-for="opt in [
                                    { value: null, label: 'None' },
                                    { value: 'x', label: 'X' },
                                    { value: 'y', label: 'Y' },
                                ]"
                                :key="String(opt.value)"
                                type="button"
                                class="h-7 rounded-md border text-xs font-medium transition-colors"
                                :class="
                                    (datum.axisRole ?? null) === opt.value
                                        ? 'border-primary bg-primary/10 text-primary'
                                        : 'border-border text-muted-foreground hover:bg-accent'
                                "
                                @click.stop="
                                    store.setAxisRole(
                                        datum.id,
                                        opt.value as
                                            | 'x'
                                            | 'y'
                                            | null,
                                    )
                                "
                            >
                                {{ opt.label }}
                            </button>
                        </div>
                    </div>
                    <div
                        v-else-if="datum.type === 'ellipse'"
                        class="flex items-center justify-between"
                    >
                        <Label class="text-xs">Primary reference</Label>
                        <label
                            class="flex cursor-pointer items-center gap-1.5"
                            @click.stop
                        >
                            <input
                                type="checkbox"
                                class="accent-primary"
                                :checked="datum.isPrimary ?? false"
                                @change="
                                    (e) =>
                                        store.setAxisRole(
                                            datum.id,
                                            (e.target as HTMLInputElement)
                                                .checked
                                                ? 'ellipse'
                                                : null,
                                        )
                                "
                            />
                            <span class="text-xs text-muted-foreground"
                                >Use</span
                            >
                        </label>
                    </div>

                    <!-- Confidence -->
                    <div>
                        <div class="flex items-center justify-between">
                            <Label class="text-xs">Confidence</Label>
                            <span
                                class="text-xs font-medium text-muted-foreground"
                            >
                                {{ datum.confidence }} / 5
                            </span>
                        </div>
                        <Slider
                            :model-value="[datum.confidence]"
                            :min="1"
                            :max="5"
                            :step="1"
                            class="mt-2"
                            @update:model-value="
                                (v: number[] | undefined) =>
                                    updateConfidence(datum, v)
                            "
                            @click.stop
                        />
                    </div>
                </CardContent>
            </Card>
        </div>
    </div>
</template>
