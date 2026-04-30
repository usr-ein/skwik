<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue"
import { useAppStore } from "@/stores/app"
import { Button } from "@/components/ui/button"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import CorrectedImageViewer from "@/components/CorrectedImageViewer.vue"
import type { ImagePreTransform } from "@/types"
// `defineExpose` in CorrectedImageViewer makes these methods available on
// the template ref, but Vue's ComponentPublicInstance type doesn't surface
// them automatically — we type the ref explicitly so the call is checked.
type CorrectedImageViewerRef = InstanceType<typeof CorrectedImageViewer> & {
    exportWithMeasurements: (opts: {
        scope: "full" | "view"
        includeScaleBar: boolean
    }) => Promise<Blob>
}
import { loadSettings, saveSettings } from "@/lib/settings-cache"
import {
    rotatedBboxSize,
    cropPixels,
    renderRotatedCropped,
} from "@/lib/crop-transform"
import { patchUpload } from "@/lib/upload-cache"

const store = useAppStore()
const resultUrl = ref<string | null>(null)
const imageTransform = ref<ImagePreTransform | null>(null)
const viewerRef = ref<CorrectedImageViewerRef | null>(null)
const error = ref("")
const includeScaleBar = ref(false)

// Debounce timer for the recent-uploads thumbnail. Measurement
// dragging fires the watcher dozens of times a second; we only want
// one regen per ~500 ms idle period.
let previewTimer: ReturnType<typeof setTimeout> | null = null
const PREVIEW_DEBOUNCE_MS = 500
const PREVIEW_MAX_WIDTH = 400

function downscaleToPreview(srcBlob: Blob): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(srcBlob)
        const el = new Image()
        el.onload = () => {
            try {
                const w = el.naturalWidth
                const h = el.naturalHeight
                if (w <= 0 || h <= 0) {
                    reject(new Error("Empty preview source"))
                    return
                }
                const ratio = Math.min(1, PREVIEW_MAX_WIDTH / w)
                const tw = Math.max(1, Math.round(w * ratio))
                const th = Math.max(1, Math.round(h * ratio))
                const c = document.createElement("canvas")
                c.width = tw
                c.height = th
                const ctx = c.getContext("2d")
                if (!ctx) {
                    reject(new Error("No 2D context"))
                    return
                }
                ctx.drawImage(el, 0, 0, tw, th)
                c.toBlob((b) => {
                    if (b) resolve(b)
                    else reject(new Error("preview toBlob failed"))
                }, "image/png")
            } finally {
                URL.revokeObjectURL(url)
            }
        }
        el.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error("preview load failed"))
        }
        el.src = url
    })
}

async function regeneratePreview() {
    const viewer = viewerRef.value
    const hash = store.fileHash
    if (!viewer || !hash) return
    try {
        const annotated = await viewer.exportWithMeasurements({
            scope: "full",
            includeScaleBar: false,
        })
        const preview = await downscaleToPreview(annotated)
        await patchUpload(hash, { previewBlob: preview })
    } catch {
        // Preview is a nice-to-have — never block the user on a failure.
    }
}

function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = setTimeout(() => {
        previewTimer = null
        void regeneratePreview()
    }, PREVIEW_DEBOUNCE_MS)
}

// Render the rotation + crop applied to the deskew result and surface
// it as an object URL + transform for CorrectedImageViewer. We keep
// the stored measurements in pre-rotate, pre-crop deskewed-image
// space, and pass a pre-transform so the viewer can draw them on the
// cropped bitmap correctly. Recomputed on entry to Measure.
async function buildTransformedSource() {
    const result = store.deskewResult
    if (!result) return
    const url = URL.createObjectURL(result.correctedImageBlob)
    try {
        const image = await new Promise<HTMLImageElement>(
            (resolve, reject) => {
                const el = new Image()
                el.onload = () => {
                    resolve(el)
                }
                el.onerror = () => {
                    reject(new Error("Failed to load deskewed image"))
                }
                el.src = url
            },
        )
        const state = store.cropRotate
        const rot = rotatedBboxSize(
            image.naturalWidth,
            image.naturalHeight,
            state.rotationDeg,
        )
        const px = cropPixels(state, rot)
        const out = renderRotatedCropped(image, state)
        const blob = await new Promise<Blob>((resolve, reject) => {
            out.toBlob((b) => {
                if (b) resolve(b)
                else reject(new Error("Crop render failed"))
            }, "image/png")
        })
        if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
        resultUrl.value = URL.createObjectURL(blob)
        imageTransform.value = {
            rotationDeg: state.rotationDeg,
            srcW: image.naturalWidth,
            srcH: image.naturalHeight,
            rotW: rot.rotW,
            rotH: rot.rotH,
            cropX: px.cropX,
            cropY: px.cropY,
        }
        schedulePreview()
    } finally {
        URL.revokeObjectURL(url)
    }
}

onMounted(() => {
    const cached = loadSettings()
    if (cached) {
        includeScaleBar.value = cached.includeScaleBar
    }

    if (store.deskewResult) {
        void buildTransformedSource()
    } else {
        // No result yet — bounce back to Deskew. Should never happen via
        // normal navigation since the Next button is gated, but if a user
        // edits the URL or hot-reloads we don't want to render an empty
        // viewer.
        store.goToStep(4)
    }
})

onUnmounted(() => {
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
    if (previewTimer) {
        clearTimeout(previewTimer)
        previewTimer = null
    }
})

watch(includeScaleBar, () => {
    saveSettings({
        scalePxPerMm: store.scalePxPerMm,
        includeScaleBar: includeScaleBar.value,
    })
})

function addScaleBar(image: HTMLImageElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const iw = image.naturalWidth
        const ih = image.naturalHeight
        const scale = store.scalePxPerMm

        const unit = Math.max(iw / 100, 8)
        const barHeightPx = Math.round(unit * 5)
        const canvas = document.createElement("canvas")
        canvas.width = iw
        canvas.height = ih + barHeightPx

        const ctx = canvas.getContext("2d")
        if (!ctx) {
            reject(new Error("No 2D context"))
            return
        }

        ctx.drawImage(image, 0, 0)

        ctx.fillStyle = "#000"
        ctx.fillRect(0, ih, iw, barHeightPx)

        const imgWidthMm = iw / scale
        const niceSteps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
        const targetMm = imgWidthMm * 0.2
        let barMm = niceSteps[0] ?? 10
        for (const s of niceSteps) {
            barMm = s
            if (s >= targetMm) break
        }
        const barWidthPx = barMm * scale

        const margin = Math.round(unit * 2)
        const barX = margin
        const barY = ih + barHeightPx / 2
        const barThick = Math.max(Math.round(unit * 0.6), 4)
        const tickH = Math.round(unit * 1.5)
        const tickW = Math.max(2, Math.round(unit * 0.15))

        ctx.fillStyle = "#fff"
        ctx.fillRect(barX, barY - barThick / 2, barWidthPx, barThick)
        ctx.fillRect(barX, barY - tickH / 2, tickW, tickH)
        ctx.fillRect(
            barX + barWidthPx - tickW,
            barY - tickH / 2,
            tickW,
            tickH,
        )

        const fontSize = Math.round(unit * 1.4)
        ctx.font = `bold ${String(fontSize)}px monospace`
        ctx.fillStyle = "#fff"
        ctx.textAlign = "center"
        ctx.textBaseline = "bottom"
        ctx.fillText(
            `${String(barMm)} mm`,
            barX + barWidthPx / 2,
            barY - tickH / 2 - Math.round(unit * 0.3),
        )

        const smallFont = Math.round(unit * 1)
        ctx.textAlign = "right"
        ctx.textBaseline = "middle"
        ctx.font = `${String(smallFont)}px monospace`
        ctx.fillStyle = "rgba(255,255,255,0.6)"
        ctx.fillText(`${String(scale)} px/mm`, iw - margin, barY)

        canvas.toBlob((b) => {
            if (b) resolve(b)
            else reject(new Error("toBlob failed"))
        }, "image/png")
    })
}

async function download() {
    if (!store.deskewResult || !resultUrl.value) return

    // Download the post-crop, post-rotation bitmap so the file matches
    // what the user has been looking at in the Measure step. When the
    // user kept the defaults (no rotation, full-image crop) this is
    // bit-identical to the original deskew blob (modulo PNG re-encode).
    let blob: Blob = await fetch(resultUrl.value).then((r) => r.blob())

    if (includeScaleBar.value) {
        const imgUrl = URL.createObjectURL(blob)
        try {
            const image = await new Promise<HTMLImageElement>(
                (resolve, reject) => {
                    const el = new Image()
                    el.onload = () => {
                        resolve(el)
                    }
                    el.onerror = () => {
                        reject(new Error("Failed to load image"))
                    }
                    el.src = imgUrl
                },
            )
            blob = await addScaleBar(image)
        } finally {
            URL.revokeObjectURL(imgUrl)
        }
    }

    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const baseName =
        store.originalFile?.name.replace(/\.[^.]+$/, "") ?? "output"
    a.download = `${baseName}-skwik.png`
    a.click()
    URL.revokeObjectURL(url)
}

// Download the corrected image with measurement annotations baked in.
// scope="full": natural-resolution image + overlay → `-measured.png`.
// scope="view": current viewport (zoom/pan) + overlay → `-measured-view.png`.
// Both honour the existing `includeScaleBar` toggle. View export's bar is
// sized for the on-screen pixel scale (image-px/mm × CSS view scale) so it
// represents the same physical mm length the user is actually looking at.
async function downloadMeasured(scope: "full" | "view") {
    const viewer = viewerRef.value
    if (!viewer || !store.deskewResult) return
    try {
        const blob = await viewer.exportWithMeasurements({
            scope,
            includeScaleBar: includeScaleBar.value,
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        const baseName =
            store.originalFile?.name.replace(/\.[^.]+$/, "") ?? "output"
        a.download =
            scope === "full"
                ? `${baseName}-measured.png`
                : `${baseName}-measured-view.png`
        a.click()
        URL.revokeObjectURL(url)
    } catch (e) {
        error.value =
            e instanceof Error ? e.message : "Measured export failed"
    }
}
</script>

<template>
    <!-- Break out of <main>'s max-w-7xl so the Measure step spans the full
         viewport width — annotation work benefits from the extra room. -->
    <div class="relative left-1/2 w-screen -translate-x-1/2 space-y-4 px-4">
        <!-- Padded right of the fork-me ribbon on desktop so the title
             text isn't clipped underneath it. -->
        <div class="md:pl-5">
            <h2 class="text-xl font-semibold">Measure</h2>
            <p class="text-sm text-muted-foreground">
                Annotate the corrected image and download.
            </p>
        </div>

        <!-- Toolbar row: Back arrow on far left, downloads in the middle,
             "Start over" zone (dashed New Image) on the far right. -->
        <div class="flex flex-wrap items-center justify-between gap-3">
            <Button
                variant="ghost"
                size="icon"
                class="shrink-0"
                aria-label="Back to Crop"
                title="Back to Crop"
                @click="store.goToStep(5)"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M19 12H5" />
                    <path d="m12 19-7-7 7-7" />
                </svg>
            </Button>

            <div class="flex flex-wrap items-center gap-3">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger as-child>
                            <label
                                class="flex cursor-pointer items-center gap-2 select-none"
                            >
                                <input
                                    v-model="includeScaleBar"
                                    type="checkbox"
                                    class="h-4 w-4 accent-primary"
                                />
                                <span
                                    class="text-sm text-muted-foreground"
                                    >Scale bar</span
                                >
                            </label>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" class="max-w-xs">
                            Appends a black bar at the bottom of the
                            exported image with a measurement scale and
                            px/mm annotation.
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <div class="mx-1 h-6 w-px bg-border" />
                <Button @click="download">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="mr-2"
                    >
                        <path
                            d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
                        />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" x2="12" y1="15" y2="3" />
                    </svg>
                    PNG
                </Button>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger as-child>
                            <Button
                                variant="secondary"
                                @click="downloadMeasured('full')"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    class="mr-2"
                                >
                                    <path
                                        d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
                                    />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" x2="12" y1="15" y2="3" />
                                    <path d="M3 3h6" />
                                </svg>
                                Full + measurements
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" class="max-w-xs">
                            Source image at full resolution with every
                            measurement (lines, rectangles, ellipses,
                            angles) and labels rendered on top.
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger as-child>
                            <Button
                                variant="secondary"
                                @click="downloadMeasured('view')"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    class="mr-2"
                                >
                                    <rect
                                        x="3"
                                        y="3"
                                        width="18"
                                        height="18"
                                        rx="2"
                                    />
                                    <path d="M9 9h6v6H9z" />
                                </svg>
                                View + measurements
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" class="max-w-xs">
                            Captures exactly what's visible in the viewer
                            (current zoom and pan) with every measurement
                            rendered on top.
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>

            <!-- Dashed transparent styling marks this as a deliberate,
                 destructive-of-state action so it isn't mis-clicked
                 while reaching for a download. -->
            <Button
                variant="outline"
                class="border-dashed bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                @click="store.reset()"
                >Start Over</Button
            >
        </div>

        <p v-if="error" class="text-sm text-destructive">
            {{ error }}
        </p>

        <!-- Full-width corrected image with measurement tools -->
        <Card v-if="resultUrl">
            <CardHeader>
                <CardTitle class="text-base">Corrected Image</CardTitle>
            </CardHeader>
            <CardContent>
                <CorrectedImageViewer
                    ref="viewerRef"
                    :image-url="resultUrl"
                    :scale-px-per-mm="store.scalePxPerMm"
                    :image-transform="imageTransform ?? undefined"
                    @measurements-changed="schedulePreview"
                />
            </CardContent>
        </Card>
    </div>
</template>
