<script setup lang="ts">
import { useAppStore } from "@/stores/app"
import StepIndicator from "@/components/StepIndicator.vue"
import ImageUpload from "@/components/ImageUpload.vue"
import ExifViewer from "@/components/ExifViewer.vue"
import DatumEditor from "@/components/DatumEditor.vue"
import DeskewViewer from "@/components/DeskewViewer.vue"
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

        <header
            class="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        >
            <div
                class="mx-auto grid h-14 max-w-7xl grid-cols-3 items-center px-4"
            >
                <div><!-- spacer for ribbon --></div>
                <div class="flex items-center justify-center gap-2">
                    <SkwikLogo :size="28" />
                    <h1
                        class="font-mono text-lg font-semibold tracking-tight"
                    >
                        Skwik
                    </h1>
                    <span
                        class="hidden text-[10px] font-medium uppercase tracking-widest text-muted-foreground sm:inline"
                        >Perspective Correction</span
                    >
                </div>
                <div class="flex items-center justify-end gap-4">
                    <StepIndicator />
                    <ThemeToggle />
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
            <MeasureViewer v-else-if="store.currentStep === 5" />
        </main>

        <footer
            class="fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-background/95 py-3 text-center text-xs text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/60"
        >
            Made by
            <a
                href="https://github.com/usr-ein"
                target="_blank"
                rel="noopener"
                class="underline underline-offset-2 transition-colors hover:text-foreground"
                >Samuel Prevost</a
            >
        </footer>
    </div>
</template>
