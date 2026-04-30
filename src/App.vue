<script setup lang="ts">
import { useAppStore } from "@/stores/app"
import StepIndicator from "@/components/StepIndicator.vue"
import ImageUpload from "@/components/ImageUpload.vue"
import ExifViewer from "@/components/ExifViewer.vue"
import DatumEditor from "@/components/DatumEditor.vue"
import DeskewViewer from "@/components/DeskewViewer.vue"
import CropViewer from "@/components/CropViewer.vue"
import MeasureViewer from "@/components/MeasureViewer.vue"
import ThemeToggle from "@/components/ThemeToggle.vue"
import SkwikLogo from "@/components/SkwikLogo.vue"

const store = useAppStore()
</script>

<template>
    <div class="min-h-screen bg-background text-foreground">
        <!-- Header lays out as a single h-14 row on desktop and stacks
             into title-row + stepper-row on mobile so the title doesn't
             collide with the stepper at narrow widths. The theme toggle
             stays in the desktop header but moves into the footer on
             mobile (see below). -->
        <header
            class="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        >
            <div class="mx-auto max-w-7xl px-4">
                <div
                    class="flex items-center justify-between gap-3 py-2 sm:grid sm:h-14 sm:grid-cols-3 sm:py-0"
                >
                    <div class="hidden sm:block">
                        <!-- left-column spacer for the 3-col grid -->
                    </div>
                    <div class="flex items-center gap-2 sm:justify-center">
                        <SkwikLogo :size="28" />
                        <h1
                            class="font-mono text-lg font-semibold tracking-tight"
                        >
                            Skwik
                        </h1>
                        <span
                            class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground"
                            >Perspective Correction</span
                        >
                    </div>
                    <div class="hidden items-center justify-end gap-4 sm:flex">
                        <StepIndicator />
                        <ThemeToggle />
                    </div>
                </div>
                <!-- Mobile-only stepper row. overflow-x-auto keeps the
                     page width sane if the labels still don't fit on
                     very narrow screens. -->
                <div
                    class="-mx-4 flex justify-center overflow-x-auto px-4 pb-2 sm:hidden"
                >
                    <StepIndicator />
                </div>
            </div>
        </header>

        <!-- Bottom padding clears the fixed footer so content never sits
             underneath it. Footer height ≈ py-3 + 1lh ≈ 2.5rem; add a
             small buffer. -->
        <main class="mx-auto max-w-7xl px-4 pb-16 pt-6">
            <ImageUpload v-if="store.currentStep === 1" />
            <ExifViewer v-else-if="store.currentStep === 2" />
            <DatumEditor v-else-if="store.currentStep === 3" />
            <DeskewViewer v-else-if="store.currentStep === 4" />
            <CropViewer v-else-if="store.currentStep === 5" />
            <MeasureViewer v-else-if="store.currentStep === 6" />
        </main>

        <!-- Footer is fixed to the bottom. On mobile we tuck the theme
             toggle into the right edge so it's reachable without
             eating into the header chrome; the toggle is absolutely
             positioned so it doesn't push the centered byline around. -->
        <footer
            class="fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-background/95 py-3 text-center text-xs text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/60"
        >
            <span class="inline-flex items-center gap-3">
                <span>
                    Made by
                    <a
                        href="https://github.com/usr-ein"
                        target="_blank"
                        rel="noopener"
                        class="underline underline-offset-2 transition-colors hover:text-foreground"
                        >Samuel Prevost</a
                    >
                </span>
                <span class="text-muted-foreground/50" aria-hidden="true"
                    >·</span
                >
                <a
                    href="https://github.com/usr-ein/skwik"
                    target="_blank"
                    rel="noopener"
                    class="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
                    title="Fork Skwik on GitHub"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                    >
                        <path
                            d="M12 0.5C5.65 0.5 0.5 5.65 0.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1-.02-1.95-3.2.69-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35 0.5 12 0.5z"
                        />
                    </svg>
                    Fork me on GitHub
                </a>
            </span>
            <div
                class="absolute bottom-1/2 right-2 translate-y-1/2 sm:hidden"
            >
                <ThemeToggle />
            </div>
        </footer>
    </div>
</template>
