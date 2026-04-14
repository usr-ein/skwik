<script setup lang="ts">
import { ref } from "vue";
import { useAppStore } from "@/stores/app";
import { loadImage } from "@/lib/image-loader";
import { extractExif } from "@/lib/exif";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const store = useAppStore();
const isDragging = ref(false);
const error = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

const ACCEPTED = ".jpg,.jpeg,.heic,.heif";

async function handleFile(file: File) {
  error.value = "";
  store.isProcessing = true;
  store.processingStatus = "Reading file...";

  try {
    const { image, convertedFile } = await loadImage(file, (status) => {
      store.processingStatus = status;
    });

    store.processingStatus = "Extracting EXIF data...";
    const exif = await extractExif(file);

    store.setImage(convertedFile, image);
    store.setExif(exif);
    store.goToStep(2);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load image";
  } finally {
    store.isProcessing = false;
    store.processingStatus = "";
  }
}

function onDrop(e: DragEvent) {
  isDragging.value = false;
  const file = e.dataTransfer?.files[0];
  if (file) handleFile(file);
}

function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) handleFile(file);
}
</script>

<template>
  <div class="flex min-h-[60vh] items-center justify-center">
    <Card class="w-full max-w-lg">
      <CardHeader class="text-center">
        <CardTitle class="text-2xl">Upload an Image</CardTitle>
        <CardDescription>
          Drop a JPG or HEIC image, or click to browse. HEIC files will be converted
          automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          class="relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors"
          :class="
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-primary/50'
          "
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onDrop"
          @click="fileInput?.click()"
        >
          <template v-if="store.isProcessing">
            <div class="flex flex-col items-center gap-3 p-6">
              <Progress :model-value="50" class="w-48" />
              <p class="text-sm text-muted-foreground">{{ store.processingStatus }}</p>
            </div>
          </template>
          <template v-else>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="mb-3 text-muted-foreground"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" x2="12" y1="3" y2="15" />
            </svg>
            <p class="text-sm text-muted-foreground">
              Drag &amp; drop or
              <span class="font-medium text-primary underline">browse</span>
            </p>
            <p class="mt-1 text-xs text-muted-foreground/70">JPG, JPEG, HEIC, HEIF</p>
          </template>

          <input
            ref="fileInput"
            type="file"
            :accept="ACCEPTED"
            class="hidden"
            @change="onFileSelect"
          />
        </div>

        <p v-if="error" class="mt-3 text-center text-sm text-destructive">
          {{ error }}
        </p>
      </CardContent>
    </Card>
  </div>
</template>
