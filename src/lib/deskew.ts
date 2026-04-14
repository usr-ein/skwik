import type { DeskewInput, DeskewResult } from "@/types";

/**
 * Placeholder deskew algorithm.
 *
 * TODO: Replace with actual perspective-correction implementation.
 * The algorithm should:
 * 1. Use datum measurements to compute a homography matrix
 * 2. Apply lens distortion correction using EXIF focal length data
 * 3. Warp the image to produce a corrected output
 */
export async function deskewImage(input: DeskewInput): Promise<DeskewResult> {
  const canvas = document.createElement("canvas");
  canvas.width = input.imageData.width;
  canvas.height = input.imageData.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot get 2D context");

  ctx.drawImage(input.imageData, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))),
      "image/jpeg",
      0.95,
    );
  });

  const corrections: string[] = [];

  if (input.exif.focalLength) {
    corrections.push(
      `Lens: ${input.exif.lensModel ?? "unknown"} @ ${input.exif.focalLength}mm`,
    );
  }

  corrections.push(`${input.datums.length} datum(s) used for calibration`);
  corrections.push("Placeholder: no actual correction applied yet");

  return {
    correctedImageBlob: blob,
    appliedCorrections: corrections,
  };
}
