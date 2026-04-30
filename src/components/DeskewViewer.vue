<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue"
import { useAppStore } from "@/stores/app"
import { deskewImage, waitForOpenCV } from "@/lib/deskew"
import type { Datum } from "@/types"
import { DEFAULT_SCALE_PX_PER_MM } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
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
import { loadSettings } from "@/lib/settings-cache"
import {
    loadMeasurements,
    saveMeasurements,
    scaleMeasurements,
} from "@/lib/measurement-cache"
import { patchUpload } from "@/lib/upload-cache"
import { clearZoom } from "@/lib/zoom-cache"

const store = useAppStore()
const previewUrl = ref<string | null>(null)
const error = ref("")
const hasRun = ref(false)
const cvReady = ref(false)
const cvLoading = ref(false)
const showAlgoDetails = ref(false)
const scaleInput = ref(String(store.scalePxPerMm))
const scaleValid = computed(() => {
    const n = Number(scaleInput.value)
    return Number.isFinite(n) && n > 0
})

watch(scaleInput, (v) => {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) {
        store.scalePxPerMm = n
    }
})

/** Max dimension (px) of the auto-suggested output. Picked so default
 *  exports stay under a few MB and OpenCV's WASM doesn't choke. */
const AUTO_SCALE_TARGET_DIM = 2000

/** Estimate the image-pixels-per-mm implied by a single datum. Picks the
 *  best datum by type priority (rect > line > ellipse) and then confidence.
 *  Returns null if no datum gives a usable scale. */
function pickScaleRef(): { srcPxPerMm: number } | null {
    const axisFlagged = store.datums.find(
        (d) =>
            (d.type === "rectangle" && d.isAxisReference) ||
            (d.type === "line" && d.axisRole),
    )
    const best =
        axisFlagged ??
        [...store.datums].sort((a, b) => {
            const rank = (d: Datum) =>
                d.type === "rectangle"
                    ? 0
                    : d.type === "ellipse"
                      ? 1
                      : 2
            const r = rank(a) - rank(b)
            if (r !== 0) return r
            return b.confidence - a.confidence
        })[0]
    if (!best) return null
    if (best.type === "rectangle") {
        if (best.widthMm <= 0 || best.heightMm <= 0) return null
        const c = best.corners
        const srcW = Math.max(
            Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y),
            Math.hypot(c[2].x - c[3].x, c[2].y - c[3].y),
        )
        const srcH = Math.max(
            Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y),
            Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y),
        )
        const sx = srcW / best.widthMm
        const sy = srcH / best.heightMm
        return { srcPxPerMm: Math.max(sx, sy) }
    }
    if (best.type === "line") {
        if (best.lengthMm <= 0) return null
        const L = Math.hypot(
            best.endpoints[1].x - best.endpoints[0].x,
            best.endpoints[1].y - best.endpoints[0].y,
        )
        return { srcPxPerMm: L / best.lengthMm }
    }
    if (best.diameterMm <= 0) return null
    // Approximate the ellipse's "diameter" as max of the two semi-axis lengths × 2
    const vA = Math.hypot(
        best.axisEndA.x - best.center.x,
        best.axisEndA.y - best.center.y,
    )
    const vB = Math.hypot(
        best.axisEndB.x - best.center.x,
        best.axisEndB.y - best.center.y,
    )
    return { srcPxPerMm: (2 * Math.max(vA, vB)) / best.diameterMm }
}

function computeAutoScale(): number {
    const img = store.loadedImage
    const ref = pickScaleRef()
    if (!img || !ref || ref.srcPxPerMm <= 0) return DEFAULT_SCALE_PX_PER_MM

    // The full warped output is roughly the source image scaled by
    // (outputPxPerMm / srcPxPerMm). Pick outputPxPerMm so the larger of
    // the two output dimensions lands at AUTO_SCALE_TARGET_DIM; floor so
    // the shown value round-trips through the integer-only input; clamp
    // at 1 to avoid useless 0 px/mm.
    const imgMaxDim = Math.max(img.naturalWidth, img.naturalHeight)
    if (imgMaxDim <= 0) return DEFAULT_SCALE_PX_PER_MM
    const target =
        (AUTO_SCALE_TARGET_DIM * ref.srcPxPerMm) / imgMaxDim
    return Math.max(1, Math.floor(target))
}

onMounted(() => {
    const cached = loadSettings()
    if (cached && cached.scalePxPerMm !== DEFAULT_SCALE_PX_PER_MM) {
        // Only use cached scale if it was explicitly set before
        scaleInput.value = String(cached.scalePxPerMm)
    } else {
        // Auto-compute a sensible default scale
        const auto = computeAutoScale()
        store.scalePxPerMm = auto
        scaleInput.value = String(auto)
    }
    // Re-create the preview URL if a deskew result is already cached on the
    // store (e.g. user navigated back from Measure).
    if (store.deskewResult) {
        previewUrl.value = URL.createObjectURL(
            store.deskewResult.correctedImageBlob,
        )
        hasRun.value = true
    }
})

onUnmounted(() => {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})

// Progress tracking
const progressStep = ref(0)
const progressTotal = ref(7)
const progressLabel = ref("")
const progressPercent = computed(() =>
    progressTotal.value > 0
        ? Math.round((progressStep.value / progressTotal.value) * 100)
        : 0,
)

// Estimated output size — accounts for full warped image, not just datum
const MAX_RGBA_MB = 512
const estimatedOutput = computed(() => {
    const ref = pickScaleRef()
    const img = store.loadedImage
    if (!ref || !img || store.scalePxPerMm <= 0 || ref.srcPxPerMm <= 0)
        return null

    // source-pixels-per-mm implied by the datum vs. requested output px/mm
    const avgScale = store.scalePxPerMm / ref.srcPxPerMm

    const w = Math.round(img.naturalWidth * avgScale)
    const h = Math.round(img.naturalHeight * avgScale)
    const mb = (w * h * 4) / (1024 * 1024)
    return { w, h, mb }
})

const tooLarge = computed(
    () => (estimatedOutput.value?.mb ?? 0) > MAX_RGBA_MB,
)

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
        progressStep.value = 0
        progressLabel.value = "Starting..."
        // Yield to let the browser repaint the spinner before heavy work
        await new Promise((r) => {
            requestAnimationFrame(r)
        })
        await new Promise((r) => {
            requestAnimationFrame(r)
        })

        const newScale = store.scalePxPerMm
        const oldScale = store.lastDeskewScale

        const result = await deskewImage({
            image: store.loadedImage,
            datums: store.datums,
            exif: store.exifData,
            scalePxPerMm: newScale,
            onProgress: (step, total, label) => {
                progressStep.value = step
                progressTotal.value = total
                progressLabel.value = label
                store.processingStatus = label
            },
        })

        // If the user changed the output scale between runs, the new
        // corrected image is a different size — rescale any measurements
        // already cached for this image so they stay anchored to the same
        // physical features. CorrectedImageViewer reads from cache on
        // mount, so writing here is enough; no in-memory state to sync.
        // The cached zoom/pan also no longer makes sense once the image
        // dimensions change, so we drop it and let fitToContainer pick
        // a fresh default.
        if (
            oldScale !== null &&
            oldScale > 0 &&
            oldScale !== newScale &&
            store.fileHash
        ) {
            const cached = loadMeasurements(store.fileHash)
            if (cached && cached.length > 0) {
                const scaled = scaleMeasurements(cached, newScale / oldScale)
                saveMeasurements(store.fileHash, scaled)
            }
            clearZoom(store.fileHash)
        }

        store.setResult(result, newScale)

        if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
        previewUrl.value = URL.createObjectURL(result.correctedImageBlob)

        // Persist the deskew artefacts onto the upload record so the
        // Recent Uploads gallery can reopen straight into Measure. Best
        // effort: an IndexedDB failure shouldn't break the visible flow.
        if (store.fileHash) {
            try {
                await patchUpload(store.fileHash, {
                    correctedBlob: result.correctedImageBlob,
                    diagnostics: result.diagnostics,
                    scalePxPerMm: newScale,
                })
            } catch {
                // ignore — gallery just won't include this entry
            }
        }
    } catch (e) {
        error.value = e instanceof Error ? e.message : "Deskew failed"
    } finally {
        store.isProcessing = false
        store.processingStatus = ""
    }
}
</script>

<template>
    <div class="mx-auto max-w-4xl space-y-6">
        <div class="flex items-center justify-between gap-2">
            <div>
                <h2 class="text-xl font-semibold">Deskew</h2>
                <p class="text-sm text-muted-foreground">
                    Set the output scale and run perspective correction.
                </p>
            </div>
            <div class="flex shrink-0 gap-2">
                <Button variant="outline" @click="store.goToStep(3)"
                    >Back</Button
                >
                <Button
                    :disabled="!store.canProceedToStep5"
                    @click="store.goToStep(5)"
                    >Next: Crop</Button
                >
            </div>
        </div>

        <!-- Scale setting -->
        <Card>
            <CardHeader>
                <CardTitle class="text-base">Output Scale</CardTitle>
                <CardDescription>
                    Pixels per millimeter in the corrected output image.
                    Higher = larger output.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div class="flex items-center gap-3">
                    <Label>Scale</Label>
                    <Input
                        :model-value="scaleInput"
                        type="number"
                        min="1"
                        step="1"
                        class="w-28 font-mono"
                        :class="
                            scaleValid
                                ? ''
                                : 'border-destructive ring-destructive/30 ring-2'
                        "
                        @update:model-value="
                            (v: string | number) =>
                                (scaleInput = String(v))
                        "
                    />
                    <span class="font-mono text-sm text-muted-foreground"
                        >px/mm</span
                    >
                </div>
                <!-- Estimated output size -->
                <div
                    v-if="estimatedOutput"
                    class="mt-3 space-y-1 text-sm"
                    :class="
                        tooLarge
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                    "
                >
                    <p>
                        Est. output:
                        <span class="font-mono"
                            >~{{ estimatedOutput.w }}&times;{{
                                estimatedOutput.h
                            }}px</span
                        >
                        &ensp;&mdash;&ensp;
                        <span class="font-mono"
                            >~{{
                                estimatedOutput.mb.toFixed(0)
                            }} MB</span
                        >
                        RAM
                    </p>
                    <p v-if="!scaleValid" class="font-medium text-destructive">
                        Enter a valid scale &gt; 0.
                    </p>
                    <p v-else-if="tooLarge" class="font-medium">
                        Exceeds {{ MAX_RGBA_MB }} MB limit &mdash;
                        lower the scale or use a smaller source image.
                    </p>
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
                        class="font-normal"
                    >
                        {{ datum.label }}
                        <span class="ml-1 font-mono text-xs">{{
                            datum.type === "rectangle"
                                ? `${datum.widthMm}×${datum.heightMm}mm`
                                : datum.type === "line"
                                  ? `${datum.lengthMm}mm`
                                  : `⌀${datum.diameterMm}mm`
                        }}</span>
                        <span class="ml-1 text-muted-foreground"
                            >conf {{ datum.confidence }}/5</span
                        >
                    </Badge>
                </div>
                <p
                    v-if="store.datums.length === 0"
                    class="mt-3 text-sm text-destructive"
                >
                    Add at least one datum (rectangle, line, or circle) to run
                    the correction.
                </p>
            </CardContent>
        </Card>

        <!-- Run button + progress -->
        <div class="flex flex-col items-center gap-3">
            <Button
                size="lg"
                :disabled="
                    store.isProcessing ||
                    store.datums.length === 0 ||
                    tooLarge ||
                    !scaleValid
                "
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

            <!-- Progress bar -->
            <div
                v-if="store.isProcessing"
                class="w-full max-w-sm space-y-1.5"
            >
                <Progress :model-value="progressPercent" class="h-2" />
                <p
                    class="text-center font-mono text-xs text-muted-foreground"
                >
                    [{{ progressStep + 1 }}/{{ progressTotal }}]
                    {{ progressLabel }}
                </p>
            </div>
        </div>

        <p v-if="error" class="text-center text-sm text-destructive">
            {{ error }}
        </p>

        <!-- Result -->
        <template v-if="store.deskewResult && previewUrl">
            <!-- Diagnostics -->
            <Card>
                <CardHeader>
                    <CardTitle class="text-base">Diagnostics</CardTitle>
                    <CardDescription>
                        Primary reference:
                        <strong>{{
                            store.deskewResult.diagnostics.primaryDatum
                        }}</strong>
                        <span class="mx-1 text-muted-foreground/50"
                            >|</span
                        >
                        Output:
                        <span class="font-mono"
                            >{{
                                store.deskewResult.diagnostics.outputWidthPx
                            }}&times;{{
                                store.deskewResult.diagnostics.outputHeightPx
                            }}px</span
                        >
                        <span class="mx-1 text-muted-foreground/50"
                            >|</span
                        >
                        <span class="font-mono"
                            >{{
                                (
                                    store.deskewResult.diagnostics
                                        .outputWidthPx / store.scalePxPerMm
                                ).toFixed(1)
                            }}&times;{{
                                (
                                    store.deskewResult.diagnostics
                                        .outputHeightPx / store.scalePxPerMm
                                ).toFixed(1)
                            }}mm</span
                        >
                        <span class="mx-1 text-muted-foreground/50"
                            >|</span
                        >
                        <span class="font-mono"
                            >{{
                                (
                                    store.deskewResult.correctedImageBlob
                                        .size /
                                    1024 /
                                    1024
                                ).toFixed(1)
                            }} MB</span
                        >
                    </CardDescription>
                </CardHeader>
                <CardContent class="space-y-4">
                    <!-- Solver summary -->
                    <div class="grid grid-cols-2 gap-4">
                        <div
                            class="rounded-md border border-border/50 p-3"
                        >
                            <p
                                class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                            >
                                Residual (RMS)
                            </p>
                            <p class="font-mono text-lg font-semibold">
                                {{
                                    store.deskewResult.diagnostics.finalRMSPercent.toFixed(
                                        3,
                                    )
                                }}%
                            </p>
                            <p
                                class="font-mono text-xs text-muted-foreground"
                            >
                                across all datums
                            </p>
                        </div>
                        <div
                            class="rounded-md border border-border/50 p-3"
                        >
                            <p
                                class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                            >
                                Iterations
                            </p>
                            <p class="font-mono text-lg font-semibold">
                                {{
                                    store.deskewResult.diagnostics.iterations
                                }}
                            </p>
                            <p
                                class="font-mono text-xs text-muted-foreground"
                            >
                                outer alternating passes
                            </p>
                        </div>
                    </div>

                    <!-- Per-datum table -->
                    <Table
                        v-if="
                            store.deskewResult.diagnostics.perDatum.length >
                            0
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
                                <TableHead class="text-right"
                                    >Error</TableHead
                                >
                                <TableHead>Residual breakdown</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow
                                v-for="report in store.deskewResult
                                    .diagnostics.perDatum"
                                :key="report.label"
                            >
                                <TableCell class="font-medium">{{
                                    report.label
                                }}</TableCell>
                                <TableCell>
                                    <Badge
                                        variant="outline"
                                        class="text-xs"
                                        >{{ report.type }}</Badge
                                    >
                                </TableCell>
                                <TableCell class="font-mono text-right">{{
                                    report.expectedMm.toFixed(2)
                                }}</TableCell>
                                <TableCell class="font-mono text-right">{{
                                    report.measuredMm.toFixed(2)
                                }}</TableCell>
                                <TableCell
                                    class="font-mono text-right"
                                    :class="
                                        report.errorPercent > 5
                                            ? 'text-destructive'
                                            : report.errorPercent > 1
                                              ? 'text-amber-500'
                                              : ''
                                    "
                                >
                                    {{ report.errorPercent.toFixed(2) }}%
                                </TableCell>
                                <TableCell
                                    class="font-mono text-xs text-muted-foreground"
                                >
                                    {{ report.details }}
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <!-- Algorithm explanation -->
            <Card class="border-border/40">
                <CardContent class="pb-5 pt-5">
                    <button
                        class="flex w-full items-center gap-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                        @click="
                            showAlgoDetails = !showAlgoDetails
                        "
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
                            class="shrink-0 transition-transform duration-200"
                            :class="
                                showAlgoDetails
                                    ? 'rotate-90'
                                    : ''
                            "
                        >
                            <path d="m9 18 6-6-6-6" />
                        </svg>
                        How the algorithm works
                    </button>
                    <div
                        v-show="showAlgoDetails"
                        class="mt-4 pl-6"
                    >
                        <ol
                            class="list-decimal space-y-2 text-sm leading-relaxed text-muted-foreground marker:font-semibold marker:text-foreground/60"
                        >
                            <li>
                                The highest-confidence rectangle
                                gives a closed-form warm start via
                                <code
                                    class="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground"
                                    >cv::getPerspectiveTransform</code
                                >, fixing the output
                                orientation.
                            </li>
                            <li>
                                Each datum is turned into
                                <strong
                                    class="text-foreground/80"
                                    >shape-based point
                                    correspondences</strong
                                >
                                whose target positions are
                                recomputed from the current
                                homography on every outer pass:
                                Procrustes-fit ideal rectangles,
                                midpoint-preserving line rescales,
                                and radially-snapped ellipse
                                samples that force circles to stay
                                circular.
                            </li>
                            <li>
                                <code
                                    class="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground"
                                    >cv::findHomography</code
                                >
                                refines the homography by
                                Levenberg&ndash;Marquardt on those
                                correspondences; confidence drives
                                per-datum replication. The loop
                                stops once the homography stops
                                moving.
                            </li>
                            <li>
                                A single
                                <code
                                    class="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground"
                                    >cv::warpPerspective</code
                                >
                                produces the output at the
                                requested px/mm scale.
                            </li>
                        </ol>
                    </div>
                </CardContent>
            </Card>

            <!-- Deskewed preview -->
            <Card>
                <CardHeader>
                    <CardTitle class="text-base"
                        >Deskewed Preview</CardTitle
                    >
                    <CardDescription>
                        Continue to <strong>Crop</strong> to rotate and
                        crop the result before measuring.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div
                        class="flex items-center justify-center overflow-hidden rounded-md bg-muted"
                    >
                        <img
                            :src="previewUrl"
                            alt="Deskewed image preview"
                            class="max-h-[480px] w-full object-contain"
                        />
                    </div>
                </CardContent>
            </Card>

            <div class="flex justify-center pb-8">
                <Button size="lg" @click="store.goToStep(5)">
                    Continue to Crop
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
                        class="ml-2"
                    >
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                    </svg>
                </Button>
            </div>
        </template>
    </div>
</template>
