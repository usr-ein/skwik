export async function hashFile(file: File): Promise<string> {
    // Use file metadata as a fast, unique-enough key.
    // crypto.subtle is unavailable on HTTP or some mobile browsers.
    if (
        typeof crypto !== "undefined" &&
        crypto.subtle &&
        typeof crypto.subtle.digest === "function"
    ) {
        try {
            const buffer = await file.arrayBuffer()
            const hashBuffer = await crypto.subtle.digest(
                "SHA-256",
                buffer,
            )
            const hashArray = Array.from(new Uint8Array(hashBuffer))
            return hashArray
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("")
        } catch {
            // Fall through to metadata-based hash
        }
    }

    // Fallback: name + size + lastModified
    return `${file.name}-${String(file.size)}-${String(file.lastModified)}`
}
