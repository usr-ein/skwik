<script setup lang="ts">
import { useAppStore } from "@/stores/app"
import type { AppStep } from "@/types"
import { Badge } from "@/components/ui/badge"

const store = useAppStore()

const steps: { num: AppStep; label: string }[] = [
    { num: 1, label: "Upload" },
    { num: 2, label: "EXIF" },
    { num: 3, label: "Datums" },
    { num: 4, label: "Deskew" },
    { num: 5, label: "Measure" },
]

function isReachable(num: AppStep): boolean {
    return num <= store.maxStepReached && num !== store.currentStep
}

function handleClick(num: AppStep) {
    if (isReachable(num)) {
        store.goToStep(num)
    }
}
</script>

<template>
    <nav class="flex items-center gap-1" aria-label="Steps">
        <template v-for="(step, i) in steps" :key="step.num">
            <button
                v-if="isReachable(step.num)"
                class="inline-flex shrink-0 items-center rounded-md border border-border px-2 py-0.5 font-mono text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                @click="handleClick(step.num)"
            >
                {{ step.label }}
            </button>
            <Badge
                v-else
                :variant="
                    store.currentStep === step.num
                        ? 'default'
                        : 'outline'
                "
                class="shrink-0 cursor-default select-none font-mono text-xs"
                :class="{
                    'opacity-40':
                        step.num > store.maxStepReached,
                }"
            >
                {{ step.label }}
            </Badge>
            <span
                v-if="i < steps.length - 1"
                class="text-xs text-muted-foreground/40"
                >&rsaquo;</span
            >
        </template>
    </nav>
</template>
