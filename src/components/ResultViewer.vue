<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAppStore } from "@/stores/app";
import { deskewImage } from "@/lib/deskew";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const store = useAppStore();
const resultUrl = ref<string | null>(null);
const error = ref("");
const hasRun = ref(false);

async function runDeskew() {
  if (!store.loadedImage) return;

  error.value = "";
  store.isProcessing = true;
  store.processingStatus = "Running deskew algorithm...";
  hasRun.value = true;

  try {
    // Draw the loaded image onto a canvas to pass to the algorithm
    const canvas = document.createElement("canvas");
    canvas.width = store.loadedImage.naturalWidth;
    canvas.height = store.loadedImage.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Cannot get 2D context");
    ctx.drawImage(store.loadedImage, 0, 0);

    const result = await deskewImage({
      imageData: canvas,
      datums: store.datums,
      exif: store.exifData,
    });

    store.setResult(result);
    resultUrl.value = URL.createObjectURL(result.correctedImageBlob);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Deskew failed";
  } finally {
    store.isProcessing = false;
    store.processingStatus = "";
  }
}

function download() {
  if (!resultUrl.value) return;
  const a = document.createElement("a");
  a.href = resultUrl.value;
  a.download = `skwik-${store.originalFile?.name ?? "output"}.jpg`;
  a.click();
}

onMounted(() => {
  // Don't auto-run: let user set scale first
});
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-xl font-semibold">Process &amp; Download</h2>
        <p class="text-sm text-muted-foreground">
          Set the scale, run the deskew algorithm, and download the corrected image.
        </p>
      </div>
      <Button variant="outline" @click="store.goToStep(3)">Back</Button>
    </div>

    <!-- Scale setting (between step 3 and running the algo) -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base">Image Scale</CardTitle>
        <CardDescription>
          How many pixels represent 1 cm in the original image. This helps the algorithm
          interpret your datum measurements.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center gap-3">
          <Label>Scale</Label>
          <Input
            :model-value="String(store.scalePxPerCm)"
            type="number"
            min="1"
            class="w-28"
            @update:model-value="(v: string | number) => (store.scalePxPerCm = Number(v) || 50)"
          />
          <span class="text-sm text-muted-foreground">px / cm</span>
        </div>
      </CardContent>
    </Card>

    <!-- Summary of datums -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base">Datum Summary</CardTitle>
        <CardDescription>
          {{ store.datums.length }} datum(s) will be used for calibration.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex flex-wrap gap-2">
          <Badge v-for="datum in store.datums" :key="datum.id" variant="outline">
            {{ datum.label }}
            ({{ datum.type === "rectangle" ? `${datum.widthMm}\u00D7${datum.heightMm}mm` : `${datum.lengthMm}mm` }})
            &mdash; confidence {{ datum.confidence }}/5
          </Badge>
        </div>
      </CardContent>
    </Card>

    <!-- Run button -->
    <div class="flex justify-center">
      <Button size="lg" :disabled="store.isProcessing" @click="runDeskew">
        <template v-if="store.isProcessing">
          Processing...
        </template>
        <template v-else>
          {{ hasRun ? "Re-run Deskew" : "Run Deskew Algorithm" }}
        </template>
      </Button>
    </div>

    <p v-if="error" class="text-center text-sm text-destructive">{{ error }}</p>

    <!-- Result -->
    <template v-if="store.deskewResult">
      <Card>
        <CardHeader>
          <CardTitle class="text-base">Corrected Image</CardTitle>
          <CardDescription>
            <span
              v-for="(correction, i) in store.deskewResult.appliedCorrections"
              :key="i"
            >
              {{ correction }}<template v-if="i < store.deskewResult.appliedCorrections.length - 1">
                &ensp;&bull;&ensp;
              </template>
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div class="flex items-center justify-center overflow-hidden rounded-md bg-muted">
            <img
              v-if="resultUrl"
              :src="resultUrl"
              alt="Corrected image"
              class="max-h-[500px] w-full object-contain"
            />
          </div>
        </CardContent>
      </Card>

      <div class="flex justify-center">
        <Button size="lg" @click="download">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="mr-2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" x2="12" y1="15" y2="3" />
          </svg>
          Download Image
        </Button>
      </div>
    </template>
  </div>
</template>
