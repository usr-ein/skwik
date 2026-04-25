<script setup lang="ts">
withDefaults(
    defineProps<{
        size?: number
    }>(),
    {
        size: 28,
    }
)
</script>

<template>
    <span
        class="inline-flex items-center justify-center leading-none select-none"
        :style="{
            width: size + 'px',
            height: size + 'px',
            fontSize: Math.round(size * 0.9) + 'px',
        }"
        aria-label="Skwik logo"
        role="img"
    >📐</span>
</template>
