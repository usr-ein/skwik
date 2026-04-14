<script setup lang="ts">
import { useAppStore } from "@/stores/app";
import StepIndicator from "@/components/StepIndicator.vue";
import ImageUpload from "@/components/ImageUpload.vue";
import ExifViewer from "@/components/ExifViewer.vue";
import DatumEditor from "@/components/DatumEditor.vue";
import ResultViewer from "@/components/ResultViewer.vue";
import ThemeToggle from "@/components/ThemeToggle.vue";

const store = useAppStore();
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <header
      class="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <div class="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <h1 class="text-lg font-semibold tracking-tight">Skwik</h1>
        <div class="flex items-center gap-4">
          <StepIndicator />
          <ThemeToggle />
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-7xl px-4 py-6">
      <ImageUpload v-if="store.currentStep === 1" />
      <ExifViewer v-else-if="store.currentStep === 2" />
      <DatumEditor v-else-if="store.currentStep === 3" />
      <ResultViewer v-else-if="store.currentStep === 4" />
    </main>
  </div>
</template>
