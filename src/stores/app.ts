import { defineStore } from "pinia"
import { ref, computed } from "vue"
import type { AppStep, Datum, DeskewResult, ExifData, Point } from "@/types"
import { DEFAULT_SCALE_PX_PER_MM } from "@/types"
import { loadSettings } from "@/lib/settings-cache"
import { fitEllipse } from "@/lib/ellipse-fit"

export const useAppStore = defineStore("app", () => {
    const cached = loadSettings()

    const currentStep = ref<AppStep>(1)
    const maxStepReached = ref<AppStep>(1)
    const originalFile = ref<File | null>(null)
    const loadedImage = ref<HTMLImageElement | null>(null)
    const exifData = ref<ExifData>({})
    const datums = ref<Datum[]>([])
    const deskewResult = ref<DeskewResult | null>(null)
    const isProcessing = ref(false)
    const processingStatus = ref("")
    const selectedDatumId = ref<string | null>(null)
    const scalePxPerMm = ref(
        cached?.scalePxPerMm ?? DEFAULT_SCALE_PX_PER_MM,
    )
    const fileHash = ref<string | null>(null)
    const cacheRestoreMessage = ref("")
    /** Output px/mm of the current `deskewResult`. Set whenever a deskew
     *  produces a new result; consumers compare against the live
     *  `scalePxPerMm` to detect when measurements need to be rescaled. */
    const lastDeskewScale = ref<number | null>(null)

    const canProceedToStep2 = computed(() => loadedImage.value !== null)
    const canProceedToStep3 = computed(() => canProceedToStep2.value)
    const canProceedToStep4 = computed(() => {
        if (!canProceedToStep3.value || datums.value.length === 0) return false
        return datums.value.every((d) => {
            if (d.type === "rectangle") return d.widthMm > 0 && d.heightMm > 0
            if (d.type === "line") return d.lengthMm > 0
            return d.diameterMm > 0
        })
    })
    const canProceedToStep5 = computed(
        () => canProceedToStep4.value && deskewResult.value !== null,
    )

    function setImage(file: File, image: HTMLImageElement) {
        originalFile.value = file
        loadedImage.value = image
    }

    function setExif(data: ExifData) {
        exifData.value = data
    }

    function goToStep(step: AppStep) {
        currentStep.value = step
        if (step > maxStepReached.value) {
            maxStepReached.value = step
        }
    }

    function addDatum(datum: Datum) {
        datums.value.push(datum)
        selectedDatumId.value = datum.id
    }

    function updateDatum(id: string, updates: Partial<Datum>) {
        const index = datums.value.findIndex((d) => d.id === id)
        const existing = datums.value[index]
        if (index !== -1 && existing) {
            datums.value[index] = {
                ...existing,
                ...updates,
            } as Datum
        }
    }

    /** Update an ellipse datum's points and refresh the cached best-fit
     *  ellipse (`center`/`axisEndA`/`axisEndB`). If the fit degenerates
     *  (fewer than 5 usable points, collinear, or the system is singular),
     *  we keep the previous cached axes so downstream consumers never see
     *  a garbage fit. */
    function updateEllipsePoints(id: string, points: Point[]) {
        const idx = datums.value.findIndex((d) => d.id === id)
        const existing = datums.value[idx]
        if (!existing || existing.type !== "ellipse") return
        const fit = fitEllipse(points)
        if (!fit) {
            datums.value[idx] = { ...existing, points }
            return
        }
        datums.value[idx] = {
            ...existing,
            points,
            center: fit.center,
            axisEndA: {
                x: fit.center.x + fit.semiMajor.x,
                y: fit.center.y + fit.semiMajor.y,
            },
            axisEndB: {
                x: fit.center.x + fit.semiMinor.x,
                y: fit.center.y + fit.semiMinor.y,
            },
        }
    }

    /** Set (or clear) the world-axis role on a datum, enforcing that at
     *  most one datum holds the role at a time.
     *  `role`: "rect"  → rectangle.isAxisReference = true
     *          "x"/"y" → line.axisRole = "x"|"y"
     *          null    → clear the role on `id` (no-op if it wasn't set). */
    function setAxisRole(
        id: string,
        role: "rect" | "x" | "y" | null,
    ) {
        // Clear any existing flag on other datums.
        for (let i = 0; i < datums.value.length; i++) {
            const d = datums.value[i]
            if (!d || d.id === id) continue
            if (d.type === "rectangle" && d.isAxisReference) {
                datums.value[i] = { ...d, isAxisReference: false }
            } else if (d.type === "line" && d.axisRole) {
                datums.value[i] = { ...d, axisRole: null }
            }
        }
        const idx = datums.value.findIndex((d) => d.id === id)
        if (idx === -1) return
        const target = datums.value[idx]
        if (!target) return
        if (role === null) {
            if (target.type === "rectangle") {
                datums.value[idx] = { ...target, isAxisReference: false }
            } else if (target.type === "line") {
                datums.value[idx] = { ...target, axisRole: null }
            }
            return
        }
        if (role === "rect" && target.type === "rectangle") {
            datums.value[idx] = { ...target, isAxisReference: true }
        } else if ((role === "x" || role === "y") && target.type === "line") {
            datums.value[idx] = { ...target, axisRole: role }
        }
    }

    function removeDatum(id: string) {
        datums.value = datums.value.filter((d) => d.id !== id)
        if (selectedDatumId.value === id) {
            selectedDatumId.value = datums.value[0]?.id ?? null
        }
    }

    function setResult(result: DeskewResult, scalePxPerMmUsed: number) {
        deskewResult.value = result
        lastDeskewScale.value = scalePxPerMmUsed
    }

    function setFileHash(hash: string) {
        fileHash.value = hash
    }

    function reset() {
        currentStep.value = 1
        maxStepReached.value = 1
        originalFile.value = null
        loadedImage.value = null
        exifData.value = {}
        datums.value = []
        deskewResult.value = null
        isProcessing.value = false
        processingStatus.value = ""
        selectedDatumId.value = null
        scalePxPerMm.value = DEFAULT_SCALE_PX_PER_MM
        fileHash.value = null
        cacheRestoreMessage.value = ""
        lastDeskewScale.value = null
    }

    return {
        currentStep,
        maxStepReached,
        originalFile,
        loadedImage,
        exifData,
        datums,
        deskewResult,
        isProcessing,
        processingStatus,
        selectedDatumId,
        scalePxPerMm,
        fileHash,
        cacheRestoreMessage,
        lastDeskewScale,
        canProceedToStep2,
        canProceedToStep3,
        canProceedToStep4,
        canProceedToStep5,
        setImage,
        setExif,
        goToStep,
        addDatum,
        updateDatum,
        updateEllipsePoints,
        setAxisRole,
        removeDatum,
        setResult,
        setFileHash,
        reset,
    }
})
