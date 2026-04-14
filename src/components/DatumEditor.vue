<script setup lang="ts">
import { ref, computed } from "vue";
import { useMediaQuery } from "@vueuse/core";
import { useAppStore } from "@/stores/app";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import DatumCanvas from "@/components/DatumCanvas.vue";
import DatumPanel from "@/components/DatumPanel.vue";

const store = useAppStore();
const sheetOpen = ref(false);
const isMobile = useMediaQuery("(max-width: 767px)");

const canvasHeight = computed(() =>
  isMobile.value ? "h-[calc(100vh-14rem)]" : "h-[calc(100vh-12rem)]",
);
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <h2 class="text-xl font-semibold">Place Datums</h2>
        <p class="hidden text-sm text-muted-foreground sm:block">
          Add reference shapes on the image and enter their real-world dimensions.
        </p>
      </div>
      <div class="flex shrink-0 gap-2">
        <Button variant="outline" size="sm" @click="store.goToStep(2)">Back</Button>
        <Button size="sm" :disabled="!store.canProceedToStep4" @click="store.goToStep(4)">
          Next
        </Button>
      </div>
    </div>

    <!-- Single layout: canvas always present, sidebar conditionally placed -->
    <div
      class="grid gap-4"
      :class="isMobile ? 'grid-cols-1' : 'grid-cols-[1fr_360px]'"
      :style="{ height: isMobile ? undefined : 'calc(100vh - 12rem)' }"
    >
      <div :class="canvasHeight">
        <DatumCanvas />
      </div>

      <!-- Desktop: inline sidebar -->
      <DatumPanel v-if="!isMobile" />
    </div>

    <!-- Mobile: bottom sheet for datums -->
    <Sheet v-if="isMobile" v-model:open="sheetOpen">
      <SheetTrigger as-child>
        <Button variant="outline" class="w-full">
          Datums ({{ store.datums.length }})
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="ml-2"
          >
            <path d="m18 15-6-6-6 6" />
          </svg>
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" class="h-[75vh] overflow-hidden rounded-t-xl">
        <SheetHeader>
          <SheetTitle>Datums</SheetTitle>
        </SheetHeader>
        <div class="h-[calc(75vh-4rem)] overflow-y-auto">
          <DatumPanel />
        </div>
      </SheetContent>
    </Sheet>
  </div>
</template>
