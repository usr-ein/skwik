<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue"
import { useAppStore } from "@/stores/app"
import { loadImage } from "@/lib/image-loader"
import { extractExif } from "@/lib/exif"
import { hashFile } from "@/lib/file-hash"
import { loadDatums, clearCache, getCacheSize } from "@/lib/datum-cache"
import {
    clearCache as clearMeasurementCache,
    loadMeasurements,
} from "@/lib/measurement-cache"
import {
    saveUpload,
    loadUpload,
    listUploads,
    deleteUpload,
    clearUploads,
    type UploadRecord,
} from "@/lib/upload-cache"
import { clearCache as clearZoomCache } from "@/lib/zoom-cache"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

const store = useAppStore()
const isDragging = ref(false)
const error = ref("")
const fileInput = ref<HTMLInputElement | null>(null)
const cacheCount = ref(0)
const confirmingClear = ref(false)
const recentUploads = ref<UploadRecord[]>([])
const recentUrls = ref<Map<string, string>>(new Map())

const ACCEPTED = "image/*,.heic,.heif"
// Auto-revert the "Are you sure?" prompt after this long of inactivity
// so a stray first click can't be confirmed minutes later.
const CLEAR_CONFIRM_TIMEOUT_MS = 4000

let confirmTimer: ReturnType<typeof setTimeout> | null = null

const dateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
})

// Only show entries that have a deskew result — those are the ones a
// click can meaningfully drop the user back into Measure with. Uploads
// that never reached deskew remain saved (so re-uploading the same file
// still hits the cache) but don't clutter the gallery.
const completedUploads = computed(() =>
    recentUploads.value.filter(
        (u) => u.correctedBlob !== undefined && u.diagnostics !== undefined,
    ),
)

onMounted(async () => {
    cacheCount.value = getCacheSize()
    await refreshRecentUploads()
})

onUnmounted(() => {
    if (confirmTimer) clearTimeout(confirmTimer)
    for (const url of recentUrls.value.values()) URL.revokeObjectURL(url)
})

async function refreshRecentUploads() {
    try {
        const all = await listUploads()
        // Revoke any URLs whose entries no longer exist (e.g. after a
        // delete) before refreshing the map.
        const nextHashes = new Set(all.map((u) => u.hash))
        for (const [hash, url] of recentUrls.value) {
            if (!nextHashes.has(hash)) {
                URL.revokeObjectURL(url)
                recentUrls.value.delete(hash)
            }
        }
        // Mint preview URLs for every entry; we keep them alive for the
        // lifetime of this page mount (revoked in onUnmounted).
        for (const u of all) {
            if (!recentUrls.value.has(u.hash)) {
                const preview = u.correctedBlob ?? u.originalBlob
                recentUrls.value.set(u.hash, URL.createObjectURL(preview))
            }
        }
        recentUploads.value = all
    } catch {
        recentUploads.value = []
    }
}

function formatDate(ms: number): string {
    return dateFormatter.format(new Date(ms))
}

function previewUrlFor(hash: string): string {
    return recentUrls.value.get(hash) ?? ""
}

function handleClearCacheClick() {
    if (confirmingClear.value) {
        clearCache()
        clearMeasurementCache()
        clearZoomCache()
        // IndexedDB clear is async but the UI doesn't depend on its
        // completion — fire and forget, then reload the gallery.
        void clearUploads().then(() => refreshRecentUploads())
        cacheCount.value = 0
        confirmingClear.value = false
        if (confirmTimer) {
            clearTimeout(confirmTimer)
            confirmTimer = null
        }
        return
    }
    confirmingClear.value = true
    if (confirmTimer) clearTimeout(confirmTimer)
    confirmTimer = setTimeout(() => {
        confirmingClear.value = false
        confirmTimer = null
    }, CLEAR_CONFIRM_TIMEOUT_MS)
}

async function handleDeleteUpload(hash: string, ev: Event) {
    ev.stopPropagation()
    try {
        await deleteUpload(hash)
        await refreshRecentUploads()
    } catch {
        // ignore — UI will reflect on next refresh
    }
}

// Reopen a past upload straight in Measure. Replays the upload pipeline
// from the cached blob (the original image is needed if the user later
// goes back to Datums or Deskew), then stitches the cached deskew
// artefacts and datums onto the store before navigating.
async function restoreUpload(hash: string) {
    error.value = ""
    store.isProcessing = true
    store.processingStatus = "Loading saved image..."

    try {
        const record = await loadUpload(hash)
        if (!record) {
            error.value = "Saved upload no longer available"
            return
        }
        if (!record.correctedBlob || !record.diagnostics) {
            error.value = "Saved upload has no deskew result"
            return
        }
        const file = new File([record.originalBlob], record.filename, {
            type: record.mimeType,
        })
        const { image, convertedFile } = await loadImage(file, (status) => {
            store.processingStatus = status
        })

        const cachedDatums = loadDatums(hash) ?? []
        const cachedMeasurements = loadMeasurements(hash) ?? []

        store.setFileHash(hash)
        store.setImage(convertedFile, image)
        store.setExif(record.exif)
        store.datums = cachedDatums
        if (record.scalePxPerMm) {
            store.scalePxPerMm = record.scalePxPerMm
        }
        store.setResult(
            {
                correctedImageBlob: record.correctedBlob,
                diagnostics: record.diagnostics,
            },
            record.scalePxPerMm ?? store.scalePxPerMm,
        )

        if (cachedMeasurements.length > 0 || cachedDatums.length > 0) {
            const parts: string[] = []
            if (cachedDatums.length > 0) {
                parts.push(
                    `${String(cachedDatums.length)} datum${cachedDatums.length === 1 ? "" : "s"}`,
                )
            }
            if (cachedMeasurements.length > 0) {
                parts.push(
                    `${String(cachedMeasurements.length)} measurement${cachedMeasurements.length === 1 ? "" : "s"}`,
                )
            }
            store.cacheRestoreMessage = `Restored ${parts.join(" and ")}`
            setTimeout(() => {
                store.cacheRestoreMessage = ""
            }, 4000)
        }

        // Bump max step so the indicator surfaces every prior step as
        // navigable, just like a freshly-completed run would.
        store.goToStep(5)
    } catch (e) {
        error.value =
            e instanceof Error ? e.message : "Failed to reopen image"
    } finally {
        store.isProcessing = false
        store.processingStatus = ""
    }
}

async function handleFile(file: File) {
    error.value = ""
    store.isProcessing = true
    store.processingStatus = "Reading file..."

    try {
        const { image, convertedFile } = await loadImage(
            file,
            (status) => {
                store.processingStatus = status
            },
        )

        store.processingStatus = "Extracting EXIF data..."
        const exif = await extractExif(file)

        store.processingStatus = "Computing file hash..."
        const hash = await hashFile(file)
        store.setFileHash(hash)

        const cached = loadDatums(hash)
        if (cached && cached.length > 0) {
            store.datums = cached
            store.cacheRestoreMessage =
                `Restored ${String(cached.length)} datum${cached.length === 1 ? "" : "s"} from cache`
            setTimeout(() => {
                store.cacheRestoreMessage = ""
            }, 4000)
        }

        // Persist the upload so it shows up in the recent gallery and
        // can be reopened later. We save the post-conversion JPEG (not
        // the original HEIC) since that's what the rest of the app
        // expects to load. Existing entries are merged so we keep any
        // prior deskew artefacts attached to the same hash.
        const existing = await loadUpload(hash).catch(() => null)
        await saveUpload({
            hash,
            filename: convertedFile.name,
            mimeType: convertedFile.type,
            uploadedAt: existing?.uploadedAt ?? Date.now(),
            originalBlob: convertedFile,
            exif,
            correctedBlob: existing?.correctedBlob,
            diagnostics: existing?.diagnostics,
            scalePxPerMm: existing?.scalePxPerMm,
        }).catch(() => {
            // IndexedDB unavailable or quota exceeded — non-fatal,
            // gallery just won't include this upload.
        })

        store.setImage(convertedFile, image)
        store.setExif(exif)
        store.goToStep(2)
    } catch (e) {
        error.value =
            e instanceof Error ? e.message : "Failed to load image"
    } finally {
        store.isProcessing = false
        store.processingStatus = ""
    }
}

function onDrop(e: DragEvent) {
    isDragging.value = false
    const file = e.dataTransfer?.files[0]
    if (file) void handleFile(file)
}

function onFileSelect(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) void handleFile(file)
}
</script>

<template>
    <div class="flex min-h-[60vh] items-start justify-center pt-12">
        <div class="w-full max-w-2xl space-y-6">
            <Card class="relative">
                <!-- Clear-cache lives top-right of the upload card so it's
                     visible without scrolling but doesn't compete with the
                     primary drop target. Two-step confirm: first click
                     arms it; second click within
                     CLEAR_CONFIRM_TIMEOUT_MS commits. -->
                <Button
                    v-if="cacheCount > 0"
                    variant="ghost"
                    size="sm"
                    class="absolute right-2 top-2 h-7 gap-1.5 text-xs"
                    :class="
                        confirmingClear
                            ? 'text-destructive hover:text-destructive'
                            : 'text-muted-foreground/60 hover:text-destructive'
                    "
                    @click="handleClearCacheClick"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
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
                    {{
                        confirmingClear
                            ? "Are you sure?"
                            : `Clear cache (${String(cacheCount)})`
                    }}
                </Button>
                <CardHeader class="text-center">
                    <CardTitle class="text-lg">Load Source Image</CardTitle>
                    <CardDescription>
                        Drop any image (JPG, PNG, WebP, HEIC, …), or click
                        to browse. HEIC is converted automatically.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                <div
                    class="relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors"
                    :class="
                        isDragging
                            ? 'border-primary bg-primary/5'
                            : 'border-muted-foreground/25 hover:border-primary/50'
                    "
                    @dragover.prevent="isDragging = true"
                    @dragleave.prevent="isDragging = false"
                    @drop.prevent="onDrop"
                    @click="fileInput?.click()"
                >
                    <template v-if="store.isProcessing">
                        <div class="flex flex-col items-center gap-3 p-6">
                            <Progress :model-value="50" class="w-48" />
                            <p class="text-sm text-muted-foreground">
                                {{ store.processingStatus }}
                            </p>
                        </div>
                    </template>
                    <template v-else>
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="48"
                            height="48"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            class="mb-3 text-muted-foreground"
                        >
                            <path
                                d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
                            />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" x2="12" y1="3" y2="15" />
                        </svg>
                        <p class="text-sm text-muted-foreground">
                            Drag &amp; drop or
                            <span class="font-medium text-primary underline"
                                >browse</span
                            >
                        </p>
                        <p
                            class="mt-1 font-mono text-xs text-muted-foreground/60"
                        >
                            .jpg .jpeg .png .webp .gif .heic .heif
                        </p>
                    </template>

                    <input
                        ref="fileInput"
                        type="file"
                        :accept="ACCEPTED"
                        class="hidden"
                        @change="onFileSelect"
                    />
                </div>

                <p
                    v-if="error"
                    class="mt-3 text-center text-sm text-destructive"
                >
                    {{ error }}
                </p>
                </CardContent>
            </Card>

            <!-- Recent uploads — only rendered when there's something to
                 show. Each tile reopens the image directly into Measure
                 with its datums, measurements, scale and last canvas
                 zoom restored. -->
            <section v-if="completedUploads.length > 0" class="space-y-3">
                <p
                    class="text-xs font-medium uppercase tracking-wider text-muted-foreground/70"
                >
                    Recent uploads
                </p>
                <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <button
                        v-for="upload in completedUploads"
                        :key="upload.hash"
                        type="button"
                        class="group relative overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary/60 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        @click="restoreUpload(upload.hash)"
                    >
                        <div
                            class="aspect-video w-full overflow-hidden bg-muted"
                        >
                            <img
                                :src="previewUrlFor(upload.hash)"
                                :alt="upload.filename"
                                class="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                                loading="lazy"
                            />
                        </div>
                        <div class="space-y-0.5 p-2">
                            <p class="truncate text-xs font-medium text-foreground">
                                {{ upload.filename }}
                            </p>
                            <p class="truncate font-mono text-[10px] text-muted-foreground">
                                {{ formatDate(upload.uploadedAt) }}
                            </p>
                        </div>
                        <button
                            type="button"
                            class="absolute right-1 top-1 rounded-md bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100 focus:outline-none"
                            title="Remove from recent uploads"
                            aria-label="Remove from recent uploads"
                            @click="(e) => handleDeleteUpload(upload.hash, e)"
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
                                <path d="M18 6 6 18" />
                                <path d="m6 6 12 12" />
                            </svg>
                        </button>
                    </button>
                </div>
            </section>

            <div class="space-y-2 text-left">
                <p class="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Example</p>
                <div class="grid grid-cols-2 gap-4">
                    <div class="space-y-1.5">
                        <img
                            src="/example-before.jpg"
                            alt="Before: angled photograph with reference paper laid flat"
                            class="w-full rounded-md border border-border object-cover"
                        />
                        <p class="text-xs text-muted-foreground">Before &mdash; angled shot</p>
                    </div>
                    <div class="space-y-1.5">
                        <img
                            src="/example-after.jpg"
                            alt="After: perspective-corrected top-down view"
                            class="w-full rounded-md border border-border object-cover"
                        />
                        <p class="text-xs text-muted-foreground">After &mdash; corrected perspective</p>
                    </div>
                </div>
                <div class="space-y-1.5">
                    <img
                        src="/example-measured.jpg"
                        alt="Measure: the corrected image with measurement annotations baked in"
                        class="w-full rounded-md border border-border object-cover"
                    />
                    <p class="text-xs text-muted-foreground">Measured &mdash; annotations baked in</p>
                </div>
            </div>

            <div class="space-y-2 text-left">
                <p class="text-sm leading-relaxed text-muted-foreground">
                    Correct perspective distortion in photographs using
                    known reference dimensions. Useful when you need to
                    use a photo as a scale reference for design work,
                    measure objects from photographs, or recover accurate
                    geometry from angled shots.
                </p>
            </div>

            <div class="space-y-4 text-left">
                <h3 class="text-sm font-medium text-foreground">How it works</h3>
                <p class="text-sm leading-relaxed text-muted-foreground">
                    Place an object with known dimensions (a ruler, credit card, or A4 sheet) next to the subject
                    you want to photograph. Take the picture from any angle. Skwik uses the reference object to
                    compute a perspective transform and produce a corrected, front-facing image with accurate
                    proportions.
                </p>
                <p class="text-sm leading-relaxed text-muted-foreground">
                    This is especially handy for reverse-engineering enclosure cutouts, measuring parts you
                    can't easily reach, or getting a dimensionally accurate top-down view without a tripod.
                </p>

                <h3 class="mt-8 text-sm font-medium text-foreground">Tips for best results</h3>
                <ul class="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
                    <li>
                        <strong class="text-foreground/80">Use a large, rigid rectangle with precise dimensions.</strong>
                        An A4 magazine cover works well. Plain paper is acceptable but can bend or curl,
                        which degrades accuracy.
                    </li>
                    <li>
                        <strong class="text-foreground/80">Lay everything on a flat surface.</strong>
                        Both the subject and the reference object must sit on the same plane.
                    </li>
                    <li>
                        <strong class="text-foreground/80">Shoot from as high up as possible and zoom in.</strong>
                        Stand on a chair or stool and hold your phone at arm's length above the scene.
                        Use optical zoom (2&times; or more) to narrow the field of view &mdash; this compresses
                        perspective closer to an orthogonal projection and makes the correction more accurate.
                    </li>
                </ul>

                <!-- Side-view illustration: person on chair photographing downward -->
                <div class="mt-4 flex justify-center">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 360 260"
                        class="w-full max-w-xl"
                        role="img"
                        aria-label="Side-view illustration: a person standing on a chair holds a phone high, zooming in on an object on the ground below"
                    >
                        <!-- Ground line -->
                        <line x1="0" y1="240" x2="360" y2="240" stroke="currentColor" stroke-width="1.5" class="text-border" />

                        <!-- Object on the ground directly below phone (centered at x=180) -->
                        <rect x="145" y="230" width="70" height="10" rx="2"
                              class="text-primary" fill="currentColor" opacity="0.18"
                              stroke="currentColor" stroke-width="1.2" />
                        <rect x="165" y="224" width="30" height="16" rx="1"
                              fill="none" stroke="currentColor" stroke-width="0.8"
                              stroke-dasharray="3 2" class="text-muted-foreground" />
                        <text x="170" y="245" font-size="7" class="text-muted-foreground" fill="currentColor">ref</text>

                        <!-- Chair (simple side-view) -->
                        <g class="text-muted-foreground" stroke="currentColor" stroke-width="1.5" fill="none">
                            <!-- seat -->
                            <line x1="150" y1="170" x2="190" y2="170" />
                            <!-- legs -->
                            <line x1="153" y1="170" x2="150" y2="240" />
                            <line x1="187" y1="170" x2="190" y2="240" />
                            <!-- back rest -->
                            <line x1="150" y1="170" x2="147" y2="125" />
                            <line x1="147" y1="125" x2="157" y2="125" />
                        </g>

                        <!-- Person (stick figure standing on the chair) -->
                        <g class="text-foreground" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round">
                            <!-- head -->
                            <circle cx="170" cy="102" r="9" />
                            <!-- body -->
                            <line x1="170" y1="111" x2="170" y2="150" />
                            <!-- legs on chair seat -->
                            <line x1="170" y1="150" x2="160" y2="170" />
                            <line x1="170" y1="150" x2="180" y2="170" />
                            <!-- arms reaching forward/down holding phone -->
                            <polyline points="170,125 183,115 180,108" />
                            <!-- other arm at side for balance -->
                            <line x1="170" y1="125" x2="152" y2="140" />
                        </g>

                        <!-- Phone in hand (held out, pointing straight down) -->
                        <rect x="175" y="100" width="10" height="16" rx="2"
                              class="text-foreground" fill="currentColor" opacity="0.85" />
                        <!-- small lens dot -->
                        <circle cx="180" cy="116" r="1.5" class="text-background" fill="currentColor" />

                        <!-- Camera FOV cone — wide angle (faded, dashed) pointing straight down -->
                        <polygon points="180,116 124,238 236,238"
                                 fill="currentColor" class="text-muted-foreground" opacity="0.06" />
                        <line x1="180" y1="116" x2="124" y2="238"
                              stroke="currentColor" stroke-width="0.8" stroke-dasharray="4 3"
                              class="text-muted-foreground" opacity="0.3" />
                        <line x1="180" y1="116" x2="236" y2="238"
                              stroke="currentColor" stroke-width="0.8" stroke-dasharray="4 3"
                              class="text-muted-foreground" opacity="0.3" />

                        <!-- Camera FOV cone — zoomed in (narrow, stronger) pointing straight down -->
                        <polygon points="180,116 155,230 205,230"
                                 fill="currentColor" class="text-primary" opacity="0.10" />
                        <line x1="180" y1="116" x2="155" y2="230"
                              stroke="currentColor" stroke-width="1.2"
                              class="text-primary" opacity="0.6" />
                        <line x1="180" y1="116" x2="205" y2="230"
                              stroke="currentColor" stroke-width="1.2"
                              class="text-primary" opacity="0.6" />

                        <!-- Labels -->
                        <text x="238" y="230" font-size="8" class="text-muted-foreground" fill="currentColor">wide angle</text>
                        <text x="238" y="240" font-size="7" class="text-muted-foreground" fill="currentColor">(more distortion)</text>
                        <text x="207" y="215" font-size="8" class="text-primary" fill="currentColor" font-weight="600">zoomed in</text>

                        <!-- Small arrow showing "higher = better" -->
                        <g class="text-muted-foreground" stroke="currentColor" stroke-width="1" opacity="0.5">
                            <line x1="50" y1="230" x2="50" y2="105" />
                            <polyline points="45,112 50,105 55,112" fill="none" />
                        </g>
                        <text x="28" y="168" font-size="7" class="text-muted-foreground" fill="currentColor"
                              transform="rotate(-90 40 168)">higher is better</text>
                    </svg>
                </div>

            </div>
        </div>
    </div>
</template>
