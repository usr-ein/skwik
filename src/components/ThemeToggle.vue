<script setup lang="ts">
import { ref, onMounted } from "vue"
import { Button } from "@/components/ui/button"

const isDark = ref(false)

onMounted(() => {
    isDark.value =
        document.documentElement.classList.contains("dark") ||
        (!document.documentElement.classList.contains("light") &&
            window.matchMedia("(prefers-color-scheme: dark)").matches)
    applyTheme()
})

function toggle() {
    isDark.value = !isDark.value
    applyTheme()
}

function applyTheme() {
    document.documentElement.classList.toggle("dark", isDark.value)
}
</script>

<template>
    <Button
        variant="ghost"
        size="icon"
        @click="toggle"
        aria-label="Toggle theme"
    >
        <svg
            v-if="isDark"
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" />
            <path d="m19.07 4.93-1.41 1.41" />
        </svg>
        <svg
            v-else
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
    </Button>
</template>
