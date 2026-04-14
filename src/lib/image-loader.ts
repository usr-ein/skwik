import { isHeic, heicTo } from "heic-to"

function isHeicFile(file: File): boolean {
    const ext = file.name.toLowerCase()
    if (ext.endsWith(".heic") || ext.endsWith(".heif")) return true
    return file.type === "image/heic" || file.type === "image/heif"
}

export async function loadImage(
    file: File,
    onProgress?: (status: string) => void,
): Promise<{ image: HTMLImageElement; convertedFile: File }> {
    let processedFile = file

    if (isHeicFile(file)) {
        onProgress?.("Checking HEIC format...")

        if (await isHeic(file)) {
            onProgress?.("Converting HEIC to JPEG...")
            const jpegBlob = await heicTo({
                blob: file,
                type: "image/jpeg",
                quality: 0.92,
            })

            processedFile = new File(
                [jpegBlob],
                file.name.replace(/\.hei[cf]$/i, ".jpg"),
                { type: "image/jpeg" },
            )
        }
    }

    onProgress?.("Loading image...")
    const image = await createImageElement(processedFile)
    return { image, convertedFile: processedFile }
}

function createImageElement(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        // Keep the object URL alive — the img.src must remain valid for later
        // rendering in <img> tags and on the Konva canvas.
        const url = URL.createObjectURL(file)

        img.onload = () => {
            resolve(img)
        }
        img.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error("Failed to load image"))
        }
        img.src = url
    })
}
