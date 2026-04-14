<script setup lang="ts">
import { useAppStore } from "@/stores/app";
import { Badge } from "@/components/ui/badge";

const store = useAppStore();

const steps = [
  { num: 1 as const, label: "Upload" },
  { num: 2 as const, label: "EXIF" },
  { num: 3 as const, label: "Datums" },
  { num: 4 as const, label: "Result" },
];
</script>

<template>
  <nav class="flex items-center gap-1" aria-label="Steps">
    <template v-for="(step, i) in steps" :key="step.num">
      <Badge
        :variant="store.currentStep === step.num ? 'default' : 'outline'"
        class="cursor-default select-none text-xs"
        :class="{
          'opacity-40': store.currentStep < step.num,
        }"
      >
        {{ step.num }}. {{ step.label }}
      </Badge>
      <span v-if="i < steps.length - 1" class="text-muted-foreground">&middot;</span>
    </template>
  </nav>
</template>
