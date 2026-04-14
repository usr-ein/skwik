import { defineStore } from "pinia"
import { ref, computed } from "vue"
import type { AppStep, Datum, DeskewResult, ExifData } from "@/types"
import { DEFAULT_SCALE_PX_PER_MM } from "@/types"

export const useAppStore = defineStore("app", () => {
    const currentStep = ref<AppStep>(1)
    const originalFile = ref<File | null>(null)
    const loadedImage = ref<HTMLImageElement | null>(null)
    const exifData = ref<ExifData>({})
    const datums = ref<Datum[]>([])
    const deskewResult = ref<DeskewResult | null>(null)
    const isProcessing = ref(false)
    const processingStatus = ref("")
    const selectedDatumId = ref<string | null>(null)
    const scalePxPerMm = ref(DEFAULT_SCALE_PX_PER_MM)

    const canProceedToStep2 = computed(() => loadedImage.value !== null)
    const canProceedToStep3 = computed(() => canProceedToStep2.value)
    const canProceedToStep4 = computed(() => {
        if (!canProceedToStep3.value || datums.value.length === 0) return false
        return datums.value.every((d) => {
            if (d.type === "rectangle") return d.widthMm > 0 && d.heightMm > 0
            return d.lengthMm > 0
        })
    })

    function setImage(file: File, image: HTMLImageElement) {
        originalFile.value = file
        loadedImage.value = image
    }

    function setExif(data: ExifData) {
        exifData.value = data
    }

    function goToStep(step: AppStep) {
        currentStep.value = step
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

    function removeDatum(id: string) {
        datums.value = datums.value.filter((d) => d.id !== id)
        if (selectedDatumId.value === id) {
            selectedDatumId.value = datums.value[0]?.id ?? null
        }
    }

    function setResult(result: DeskewResult) {
        deskewResult.value = result
    }

    function reset() {
        currentStep.value = 1
        originalFile.value = null
        loadedImage.value = null
        exifData.value = {}
        datums.value = []
        deskewResult.value = null
        isProcessing.value = false
        processingStatus.value = ""
        selectedDatumId.value = null
        scalePxPerMm.value = DEFAULT_SCALE_PX_PER_MM
    }

    return {
        currentStep,
        originalFile,
        loadedImage,
        exifData,
        datums,
        deskewResult,
        isProcessing,
        processingStatus,
        selectedDatumId,
        scalePxPerMm,
        canProceedToStep2,
        canProceedToStep3,
        canProceedToStep4,
        setImage,
        setExif,
        goToStep,
        addDatum,
        updateDatum,
        removeDatum,
        setResult,
        reset,
    }
})
