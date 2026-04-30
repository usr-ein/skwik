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
        <!-- Gitea fork ribbon — top-left, desktop only -->
        <a
            href="https://serv.e1n.sh/git/sam1902/skwik"
            target="_blank"
            rel="noopener"
            class="github-fork-ribbon fixed left-0 top-0 z-[100] hidden md:block"
            data-ribbon="Fork me on Gitea"
            title="Fork me on Gitea"
            >Fork me on Gitea</a
        >

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
                        <!-- spacer for the fork-me ribbon -->
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
            <div
                class="absolute bottom-1/2 right-2 translate-y-1/2 sm:hidden"
            >
                <ThemeToggle />
            </div>
        </footer>
    </div>
</template>
