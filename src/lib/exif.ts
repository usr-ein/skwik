import exifr from "exifr";
import type { ExifData } from "@/types";

export async function extractExif(file: File): Promise<ExifData> {
  try {
    const raw = await exifr.parse(file, {
      tiff: true,
      exif: true,
      gps: true,
      ifd0: { pick: ["Make", "Model", "Orientation", "ImageWidth", "ImageHeight"] },
    });

    if (!raw) return {};

    return {
      make: raw.Make as string | undefined,
      model: raw.Model as string | undefined,
      lensModel: raw.LensModel as string | undefined,
      focalLength: raw.FocalLength as number | undefined,
      focalLengthIn35mm: raw.FocalLengthIn35mmFormat as number | undefined,
      orientation: raw.Orientation as number | undefined,
      imageWidth: (raw.ImageWidth ?? raw.ExifImageWidth) as number | undefined,
      imageHeight: (raw.ImageHeight ?? raw.ExifImageHeight) as
        | number
        | undefined,
      exposureTime: raw.ExposureTime as number | undefined,
      fNumber: raw.FNumber as number | undefined,
      iso: raw.ISO as number | undefined,
      dateTimeOriginal: raw.DateTimeOriginal
        ? String(raw.DateTimeOriginal)
        : undefined,
      gpsLatitude: raw.latitude as number | undefined,
      gpsLongitude: raw.longitude as number | undefined,
    };
  } catch {
    console.warn("EXIF extraction failed");
    return {};
  }
}

export function orientationLabel(orientation: number | undefined): string {
  switch (orientation) {
    case 1:
      return "Normal";
    case 2:
      return "Mirrored horizontal";
    case 3:
      return "Rotated 180\u00B0";
    case 4:
      return "Mirrored vertical";
    case 5:
      return "Mirrored horizontal + rotated 270\u00B0";
    case 6:
      return "Rotated 90\u00B0 CW";
    case 7:
      return "Mirrored horizontal + rotated 90\u00B0";
    case 8:
      return "Rotated 270\u00B0 CW";
    default:
      return "Unknown";
  }
}
