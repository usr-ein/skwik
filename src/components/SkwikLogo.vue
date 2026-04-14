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
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        :width="size"
        :height="size"
        aria-label="Skwik squirrel logo"
    >
        <!-- Tail (fluffy, curling up behind) -->
        <path
            d="M50 52 Q58 40 54 28 Q52 22 48 20
               Q55 18 56 12 Q56 8 52 10
               Q48 12 46 18"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            opacity="0.7"
        />

        <!-- Body -->
        <ellipse
            cx="32"
            cy="46"
            rx="12"
            ry="10"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
        />

        <!-- Head -->
        <ellipse
            cx="32"
            cy="28"
            rx="12"
            ry="13"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
        />

        <!-- Ear tufts -->
        <path
            d="M22 18 Q18 10 14 12 Q12 16 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        />
        <path
            d="M42 18 Q46 10 50 12 Q52 16 44 20"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        />

        <!-- Eyes -->
        <circle
            cx="27"
            cy="26"
            r="3"
            fill="currentColor"
        />
        <circle
            cx="37"
            cy="26"
            r="3"
            fill="currentColor"
        />
        <!-- Eye shine -->
        <circle cx="28.2" cy="25" r="1" fill="var(--background, #fff)" />
        <circle cx="38.2" cy="25" r="1" fill="var(--background, #fff)" />

        <!-- Nose -->
        <ellipse
            cx="32"
            cy="32"
            rx="2"
            ry="1.5"
            fill="currentColor"
        />

        <!-- Cheeks -->
        <ellipse
            cx="24"
            cy="32"
            rx="4"
            ry="3"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
            opacity="0.3"
        />
        <ellipse
            cx="40"
            cy="32"
            rx="4"
            ry="3"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
            opacity="0.3"
        />

        <!-- Mouth -->
        <path
            d="M30 34 Q32 36 34 34"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
        />

        <!-- Arms holding ruler -->
        <path
            d="M20 42 L12 38"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
        />
        <path
            d="M44 42 L52 38"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
        />

        <!-- Ruler (held diagonally) -->
        <rect
            x="4"
            y="34"
            width="22"
            height="4"
            rx="0.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            transform="rotate(-15 15 36)"
        />
        <!-- Ruler tick marks -->
        <line
            x1="8" y1="34" x2="8" y2="36"
            stroke="currentColor"
            stroke-width="1"
            transform="rotate(-15 15 36)"
        />
        <line
            x1="12" y1="34" x2="12" y2="36"
            stroke="currentColor"
            stroke-width="1"
            transform="rotate(-15 15 36)"
        />
        <line
            x1="16" y1="34" x2="16" y2="36"
            stroke="currentColor"
            stroke-width="1"
            transform="rotate(-15 15 36)"
        />
        <line
            x1="20" y1="34" x2="20" y2="36"
            stroke="currentColor"
            stroke-width="1"
            transform="rotate(-15 15 36)"
        />

        <!-- Safety goggles on forehead -->
        <path
            d="M22 20 Q27 17 32 18 Q37 17 42 20"
            fill="none"
            stroke="#f59e0b"
            stroke-width="2"
            stroke-linecap="round"
        />
        <!-- Goggle lenses -->
        <ellipse
            cx="26"
            cy="20"
            rx="3.5"
            ry="2.5"
            fill="none"
            stroke="#f59e0b"
            stroke-width="1.5"
        />
        <ellipse
            cx="38"
            cy="20"
            rx="3.5"
            ry="2.5"
            fill="none"
            stroke="#f59e0b"
            stroke-width="1.5"
        />
        <!-- Goggle bridge -->
        <path
            d="M29.5 20 Q32 19 34.5 20"
            fill="none"
            stroke="#f59e0b"
            stroke-width="1.2"
        />
        <!-- Goggle lens tint -->
        <ellipse
            cx="26"
            cy="20"
            rx="2.5"
            ry="1.5"
            fill="#f59e0b"
            opacity="0.15"
        />
        <ellipse
            cx="38"
            cy="20"
            rx="2.5"
            ry="1.5"
            fill="#f59e0b"
            opacity="0.15"
        />

        <!-- Hard hat -->
        <path
            d="M18 16 Q18 6 32 5 Q46 6 46 16"
            fill="none"
            stroke="#f59e0b"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
        />
        <!-- Hat brim -->
        <path
            d="M16 16 L48 16"
            stroke="#f59e0b"
            stroke-width="2"
            stroke-linecap="round"
        />
        <!-- Hat dome highlight -->
        <path
            d="M26 9 Q32 7 38 9"
            fill="none"
            stroke="#fbbf24"
            stroke-width="1.5"
            stroke-linecap="round"
            opacity="0.6"
        />

        <!-- Feet -->
        <ellipse
            cx="26"
            cy="56"
            rx="4"
            ry="2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
        />
        <ellipse
            cx="38"
            cy="56"
            rx="4"
            ry="2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
        />
    </svg>
</template>
