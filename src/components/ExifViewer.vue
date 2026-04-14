<script setup lang="ts">
import { useAppStore } from "@/stores/app"
import { orientationLabel } from "@/lib/exif"
import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

const store = useAppStore()

interface ExifRow {
    label: string
    value: string | undefined
}

function getExifRows(): ExifRow[] {
    const e = store.exifData
    return [
        { label: "Camera Make", value: e.make },
        { label: "Camera Model", value: e.model },
        { label: "Lens", value: e.lensModel },
        {
            label: "Focal Length",
            value: e.focalLength ? `${String(e.focalLength)}mm` : undefined,
        },
        {
            label: "Focal Length (35mm eq.)",
            value: e.focalLengthIn35mm
                ? `${String(e.focalLengthIn35mm)}mm`
                : undefined,
        },
        {
            label: "Orientation",
            value: e.orientation ? orientationLabel(e.orientation) : undefined,
        },
        {
            label: "Image Size",
            value:
                e.imageWidth && e.imageHeight
                    ? `${String(e.imageWidth)} \u00D7 ${String(e.imageHeight)}`
                    : undefined,
        },
        {
            label: "Aperture",
            value: e.fNumber ? `f/${String(e.fNumber)}` : undefined,
        },
        {
            label: "ISO",
            value: e.iso ? String(e.iso) : undefined,
        },
        {
            label: "Exposure",
            value: e.exposureTime
                ? e.exposureTime < 1
                    ? `1/${String(Math.round(1 / e.exposureTime))}s`
                    : `${String(e.exposureTime)}s`
                : undefined,
        },
        { label: "Date Taken", value: e.dateTimeOriginal },
        {
            label: "GPS",
            value:
                e.gpsLatitude != null && e.gpsLongitude != null
                    ? `${e.gpsLatitude.toFixed(5)}, ${e.gpsLongitude.toFixed(5)}`
                    : undefined,
        },
    ].filter((r) => r.value != null)
}
</script>

<template>
    <div class="mx-auto max-w-3xl space-y-6">
        <div class="flex items-center justify-between">
            <div>
                <h2 class="text-xl font-semibold">Image &amp; EXIF Data</h2>
                <p class="text-sm text-muted-foreground">
                    Review camera and lens information extracted from the image.
                </p>
            </div>
            <div class="flex gap-2">
                <Button variant="outline" @click="store.goToStep(1)"
                    >Back</Button
                >
                <Button @click="store.goToStep(3)">Next: Add Datums</Button>
            </div>
        </div>

        <div class="grid gap-6 md:grid-cols-2">
            <!-- Image preview -->
            <Card>
                <CardHeader>
                    <CardTitle class="text-base">Preview</CardTitle>
                    <CardDescription>{{
                        store.originalFile?.name
                    }}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div
                        class="flex items-center justify-center overflow-hidden rounded-md bg-muted"
                    >
                        <img
                            v-if="store.loadedImage"
                            :src="store.loadedImage.src"
                            alt="Uploaded image preview"
                            class="max-h-[400px] w-full object-contain"
                        />
                    </div>
                </CardContent>
            </Card>

            <!-- EXIF table -->
            <Card>
                <CardHeader>
                    <CardTitle class="text-base">EXIF Metadata</CardTitle>
                    <CardDescription>
                        <template v-if="getExifRows().length > 0">
                            Extracted from the image file
                        </template>
                        <template v-else>
                            No EXIF data found in this image.
                        </template>
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Table v-if="getExifRows().length > 0">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Property</TableHead>
                                <TableHead>Value</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow
                                v-for="row in getExifRows()"
                                :key="row.label"
                            >
                                <TableCell class="font-medium">{{
                                    row.label
                                }}</TableCell>
                                <TableCell>{{ row.value }}</TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>

        <!-- Info card about lens correction -->
        <Card>
            <CardContent class="pt-6">
                <div class="flex gap-3">
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
                        class="mt-0.5 shrink-0 text-primary"
                    >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 16v-4" />
                        <path d="M12 8h.01" />
                    </svg>
                    <div class="text-sm text-muted-foreground">
                        <p class="font-medium text-foreground">
                            Lens Correction Info
                        </p>
                        <p class="mt-1">
                            <template v-if="store.exifData.focalLength">
                                This image was shot at
                                <strong
                                    >{{ store.exifData.focalLength }}mm</strong
                                >
                                <template v-if="store.exifData.lensModel">
                                    with a
                                    <strong>{{
                                        store.exifData.lensModel
                                    }}</strong> </template
                                >. The deskew algorithm can use this to correct
                                barrel/pincushion distortion.
                            </template>
                            <template v-else>
                                No focal length data found. The algorithm will
                                rely solely on datum measurements for
                                perspective correction.
                            </template>
                        </p>
                    </div>
                </div>
            </CardContent>
        </Card>
    </div>
</template>
