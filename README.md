# Skwik

Client-side image deskewing tool. Upload a photo taken at an angle, place reference measurements on known objects, and get a perspective-corrected output with real-world scale.

Everything runs in the browser -- no server, no uploads.

## How it works

1. **Upload** a JPG or HEIC image (HEIC is converted automatically)
2. **Review EXIF** data -- camera, lens, focal length
3. **Place datums** on the image -- rectangles or lines with known real-world dimensions
4. **Run correction** -- OpenCV.js computes a perspective transform and outputs a corrected image

### The algorithm

The highest-confidence rectangle datum defines the initial perspective correction via `getPerspectiveTransform`. All other datums (rectangles and lines) are projected through that transform and measured. Per-axis weighted scale corrections are computed from the discrepancies, folded back into the destination rectangle, and a single clean `warpPerspective` produces the output. One matrix, one warp, no post-hoc distortion.

Datum confidence scores (1--5) act as weights in the correction.

## Quick start

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`.

## Build

```bash
pnpm build      # type-check + production build
pnpm preview    # serve the build locally
```

## Lint & format

```bash
pnpm lint       # eslint (strict TS + Vue)
pnpm lint:fix   # auto-fix
pnpm format     # prettier
pnpm type-check # vue-tsc
```

## Stack

| Layer | Tech |
|---|---|
| Framework | Vue 3 + TypeScript (strict) |
| Build | Vite |
| Components | shadcn-vue + Tailwind CSS v4 |
| Canvas | Konva.js + vue-konva |
| CV | OpenCV.js 4.12 (WASM) |
| HEIC | heic-to |
| EXIF | exifr |
| State | Pinia |

## Datum presets

Rectangles: A3, A4, A5, A6, 15x10 cm. Custom dimensions supported. Lines: any length.

## How Skwik compares

There are plenty of tools that do *part* of what Skwik does, but none that combine everything:

| Tool | Client-side | Multi-datum weighting | Real-world mm scale | Measurement tools | Scale bar export |
|---|:---:|:---:|:---:|:---:|:---:|
| [**Skwik**](https://serv.e1n.sh/git/sam1902/skwik) | ✅ | ✅ | ✅ | ✅ | ✅ |
| [MYOG Perspective Correction](https://www.myogtutorials.com/free-online-image-perspective-correction-tool/) | ✅ | ❌ | ✅ | ❌ | ❌ |
| [PerspectiveFix](https://oathanrex.github.io/perspective-fix/) | ✅ | ❌ | ❌ | ❌ | ❌ |
| [PicFix.pro](https://picfix.pro/) | ✅ | ❌ | ❌ | ❌ | ❌ |
| [ImageOnline Perspective](https://imageonline.io/perspective-tool/) | ✅ | ❌ | ❌ | ❌ | ❌ |
| [Toolschimp Image Measure](https://www.toolschimp.com/image-measure) | ✅ | ❌ | ✅ | ✅ | ❌ |
| [Aspose Deskew](https://products.aspose.app/imaging/image-deskew) | ❌ | ❌ | ❌ | ❌ | ❌ |

Most deskew tools just pull 4 corners to a rectangle without any real-world dimensions -- the output has no scale. Most measurement tools calibrate against a single reference and don't correct perspective. Skwik uses multiple weighted datums (rectangles + lines, each with a confidence score) to solve both problems in one pass, and lets you measure distances or export with a scale bar on the corrected image.

## License

MIT
