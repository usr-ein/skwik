<script setup lang="ts">
import { useAppStore } from "@/stores/app"
import {
    RECT_PRESETS,
    createRectDatum,
    createLineDatum,
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

function addRect(presetLabel?: string) {
    const preset = presetLabel
        ? RECT_PRESETS.find((p) => p.label === presetLabel)
        : undefined
    store.addDatum(createRectDatum(imageCenter(), nextRectIndex(), preset))
}

function addLine() {
    store.addDatum(createLineDatum(imageCenter(), nextLineIndex()))
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
    return `${String(datum.lengthMm)} mm`
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
                <div class="grid grid-cols-2 gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        class="w-full"
                        @click="addRect()"
                    >
                        + Rectangle
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        class="w-full"
                        @click="addLine"
                    >
                        + Line
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
                                {{
                                    datum.type === "rectangle" ? "Rect" : "Line"
                                }}
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
                                :model-value="
                                    String((datum as RectDatum).widthMm)
                                "
                                type="number"
                                min="1"
                                class="mt-1 h-8 text-sm"
                                @update:model-value="
                                    (v: string | number) =>
                                        updateField(datum, 'widthMm', Number(v))
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
                                :model-value="
                                    String((datum as RectDatum).heightMm)
                                "
                                type="number"
                                min="1"
                                class="mt-1 h-8 text-sm"
                                @update:model-value="
                                    (v: string | number) =>
                                        updateField(
                                            datum,
                                            'heightMm',
                                            Number(v),
                                        )
                                "
                                @click.stop
                            />
                        </div>
                    </div>
                    <div v-else>
                        <Label class="text-xs">Length (mm)</Label>
                        <Input
                            :model-value="String(datum.lengthMm)"
                            type="number"
                            min="1"
                            class="mt-1 h-8 text-sm"
                            @update:model-value="
                                (v: string | number) =>
                                    updateField(datum, 'lengthMm', Number(v))
                            "
                            @click.stop
                        />
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
