<script setup lang="ts">
import { ref } from "vue"
import { useAppStore } from "@/stores/app"
import { deskewImage, waitForOpenCV } from "@/lib/deskew"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

const store = useAppStore()
const resultUrl = ref<string | null>(null)
const error = ref("")
const hasRun = ref(false)
const cvReady = ref(false)
const cvLoading = ref(false)

async function ensureOpenCV() {
    if (cvReady.value) return
    cvLoading.value = true
    store.processingStatus = "Loading OpenCV WASM..."
    await waitForOpenCV()
    cvReady.value = true
    cvLoading.value = false
}

async function runDeskew() {
    if (!store.loadedImage) return

    error.value = ""
    store.isProcessing = true
    hasRun.value = true

    try {
        await ensureOpenCV()

        store.processingStatus = "Running perspective correction..."

        const result = await deskewImage({
            image: store.loadedImage,
            datums: store.datums,
            exif: store.exifData,
            scalePxPerMm: store.scalePxPerMm,
        })

        store.setResult(result)

        if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
        resultUrl.value = URL.createObjectURL(result.correctedImageBlob)
    } catch (e) {
        error.value = e instanceof Error ? e.message : "Deskew failed"
    } finally {
        store.isProcessing = false
        store.processingStatus = ""
    }
}

function download() {
    if (!resultUrl.value) return
    const a = document.createElement("a")
    a.href = resultUrl.value
    a.download = `skwik-${store.originalFile?.name ?? "output"}.png`
    a.click()
}

function hasRects(): boolean {
    return store.datums.some((d) => d.type === "rectangle")
}
</script>

<template>
    <div class="mx-auto max-w-4xl space-y-6">
        <div class="flex items-center justify-between">
            <div>
                <h2 class="text-xl font-semibold">Process &amp; Download</h2>
                <p class="text-sm text-muted-foreground">
                    Set the output scale, run perspective correction, and
                    download.
                </p>
            </div>
            <Button variant="outline" @click="store.goToStep(3)">Back</Button>
        </div>

        <!-- Scale setting -->
        <Card>
            <CardHeader>
                <CardTitle class="text-base">Output Scale</CardTitle>
                <CardDescription>
                    Pixels per millimeter in the corrected output image. Higher
                    = larger output.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div class="flex items-center gap-3">
                    <Label>Scale</Label>
                    <Input
                        :model-value="String(store.scalePxPerMm)"
                        type="number"
                        min="1"
                        class="w-28"
                        @update:model-value="
                            (v: string | number) =>
                                (store.scalePxPerMm = Number(v) || 10)
                        "
                    />
                    <span class="text-sm text-muted-foreground">px / mm</span>
                </div>
            </CardContent>
        </Card>

        <!-- Summary of datums -->
        <Card>
            <CardHeader>
                <CardTitle class="text-base">Datum Summary</CardTitle>
                <CardDescription>
                    {{ store.datums.length }} datum(s) will be used for
                    calibration.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div class="flex flex-wrap gap-2">
                    <Badge
                        v-for="datum in store.datums"
                        :key="datum.id"
                        variant="outline"
                    >
                        {{ datum.label }}
                        ({{
                            datum.type === "rectangle"
                                ? `${datum.widthMm}\u00D7${datum.heightMm}mm`
                                : `${datum.lengthMm}mm`
                        }}) &mdash; confidence {{ datum.confidence }}/5
                    </Badge>
                </div>
                <p v-if="!hasRects()" class="mt-3 text-sm text-destructive">
                    At least one rectangle datum is required for perspective
                    correction.
                </p>
            </CardContent>
        </Card>

        <!-- Run button -->
        <div class="flex flex-col items-center gap-3">
            <Button
                size="lg"
                :disabled="store.isProcessing || !hasRects()"
                @click="runDeskew"
            >
                <template v-if="store.isProcessing">
                    <svg
                        class="mr-2 h-4 w-4 animate-spin"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                    >
                        <circle
                            class="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            stroke-width="4"
                        />
                        <path
                            class="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                    </svg>
                    {{ store.processingStatus || "Processing..." }}
                </template>
                <template v-else>
                    {{
                        hasRun
                            ? "Re-run Correction"
                            : "Run Perspective Correction"
                    }}
                </template>
            </Button>
        </div>

        <p v-if="error" class="text-center text-sm text-destructive">
            {{ error }}
        </p>

        <!-- Result -->
        <template v-if="store.deskewResult">
            <!-- Diagnostics -->
            <Card>
                <CardHeader>
                    <CardTitle class="text-base">Diagnostics</CardTitle>
                    <CardDescription>
                        Primary reference:
                        <strong>{{
                            store.deskewResult.diagnostics.primaryDatum
                        }}</strong>
                        &ensp;&bull;&ensp; Output:
                        {{
                            store.deskewResult.diagnostics.outputWidthPx
                        }}&times;{{
                            store.deskewResult.diagnostics.outputHeightPx
                        }}px
                    </CardDescription>
                </CardHeader>
                <CardContent class="space-y-4">
                    <!-- Axis corrections -->
                    <div class="grid grid-cols-2 gap-4">
                        <div class="rounded-md border p-3">
                            <p
                                class="text-xs font-medium text-muted-foreground"
                            >
                                X-axis correction
                            </p>
                            <p class="text-lg font-semibold">
                                {{
                                    (
                                        store.deskewResult.diagnostics
                                            .xCorrection.ratio * 100
                                    ).toFixed(2)
                                }}%
                            </p>
                            <p class="text-xs text-muted-foreground">
                                weight:
                                {{
                                    store.deskewResult.diagnostics.xCorrection.totalWeight.toFixed(
                                        1,
                                    )
                                }}
                            </p>
                        </div>
                        <div class="rounded-md border p-3">
                            <p
                                class="text-xs font-medium text-muted-foreground"
                            >
                                Y-axis correction
                            </p>
                            <p class="text-lg font-semibold">
                                {{
                                    (
                                        store.deskewResult.diagnostics
                                            .yCorrection.ratio * 100
                                    ).toFixed(2)
                                }}%
                            </p>
                            <p class="text-xs text-muted-foreground">
                                weight:
                                {{
                                    store.deskewResult.diagnostics.yCorrection.totalWeight.toFixed(
                                        1,
                                    )
                                }}
                            </p>
                        </div>
                    </div>

                    <!-- Per-datum table -->
                    <Table
                        v-if="
                            store.deskewResult.diagnostics.perDatum.length > 0
                        "
                    >
                        <TableHeader>
                            <TableRow>
                                <TableHead>Datum</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead class="text-right"
                                    >Expected (mm)</TableHead
                                >
                                <TableHead class="text-right"
                                    >Measured (mm)</TableHead
                                >
                                <TableHead class="text-right">Error</TableHead>
                                <TableHead>Axis</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow
                                v-for="report in store.deskewResult.diagnostics
                                    .perDatum"
                                :key="report.label"
                            >
                                <TableCell class="font-medium">{{
                                    report.label
                                }}</TableCell>
                                <TableCell>
                                    <Badge variant="outline" class="text-xs">{{
                                        report.type
                                    }}</Badge>
                                </TableCell>
                                <TableCell class="text-right">{{
                                    report.expectedMm.toFixed(1)
                                }}</TableCell>
                                <TableCell class="text-right">{{
                                    report.measuredMm.toFixed(1)
                                }}</TableCell>
                                <TableCell
                                    class="text-right"
                                    :class="
                                        report.errorPercent > 5
                                            ? 'text-destructive'
                                            : ''
                                    "
                                >
                                    {{ report.errorPercent.toFixed(1) }}%
                                </TableCell>
                                <TableCell>{{
                                    report.axisContribution
                                }}</TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <!-- Corrected image -->
            <Card>
                <CardHeader>
                    <CardTitle class="text-base">Corrected Image</CardTitle>
                </CardHeader>
                <CardContent>
                    <div
                        class="flex items-center justify-center overflow-hidden rounded-md bg-muted"
                    >
                        <img
                            v-if="resultUrl"
                            :src="resultUrl"
                            alt="Corrected image"
                            class="max-h-[500px] w-full object-contain"
                        />
                    </div>
                </CardContent>
            </Card>

            <div class="flex justify-center pb-8">
                <Button size="lg" @click="download">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="mr-2"
                    >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" x2="12" y1="15" y2="3" />
                    </svg>
                    Download PNG
                </Button>
            </div>
        </template>
    </div>
</template>
