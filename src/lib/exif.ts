import exifr from "exifr"
import type { ExifData } from "@/types"

interface ExifrResult {
    Make?: string
    Model?: string
    LensModel?: string
    FocalLength?: number
    FocalLengthIn35mmFormat?: number
    Orientation?: number
    ImageWidth?: number
    ExifImageWidth?: number
    ImageHeight?: number
    ExifImageHeight?: number
    ExposureTime?: number
    FNumber?: number
    ISO?: number
    DateTimeOriginal?: Date | string
    latitude?: number
    longitude?: number
}

export async function extractExif(file: File): Promise<ExifData> {
    try {
        const raw = (await exifr.parse(file, {
            tiff: true,
            exif: true,
            gps: true,
            ifd0: {
                pick: [
                    "Make",
                    "Model",
                    "Orientation",
                    "ImageWidth",
                    "ImageHeight",
                ],
            },
        })) as ExifrResult | undefined

        if (!raw) return {}

        return {
            make: raw.Make,
            model: raw.Model,
            lensModel: raw.LensModel,
            focalLength: raw.FocalLength,
            focalLengthIn35mm: raw.FocalLengthIn35mmFormat,
            orientation: raw.Orientation,
            imageWidth: raw.ImageWidth ?? raw.ExifImageWidth,
            imageHeight: raw.ImageHeight ?? raw.ExifImageHeight,
            exposureTime: raw.ExposureTime,
            fNumber: raw.FNumber,
            iso: raw.ISO,
            dateTimeOriginal: raw.DateTimeOriginal
                ? String(raw.DateTimeOriginal)
                : undefined,
            gpsLatitude: raw.latitude,
            gpsLongitude: raw.longitude,
        }
    } catch {
        console.warn("EXIF extraction failed")
        return {}
    }
}

export function orientationLabel(orientation: number | undefined): string {
    switch (orientation) {
        case 1:
            return "Normal"
        case 2:
            return "Mirrored horizontal"
        case 3:
            return "Rotated 180\u00B0"
        case 4:
            return "Mirrored vertical"
        case 5:
            return "Mirrored horizontal + rotated 270\u00B0"
        case 6:
            return "Rotated 90\u00B0 CW"
        case 7:
            return "Mirrored horizontal + rotated 90\u00B0"
        case 8:
            return "Rotated 270\u00B0 CW"
        default:
            return "Unknown"
    }
}
