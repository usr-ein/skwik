<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useAppStore } from "@/stores/app";
import { getDatumColor } from "@/lib/datums";
import type { Datum, Point } from "@/types";

const store = useAppStore();

const containerRef = ref<HTMLDivElement | null>(null);
const stageWidth = ref(800);
const stageHeight = ref(600);

const scale = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);

// Touch state for pinch-to-zoom
let lastPinchDist = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };

const imageConfig = computed(() => {
  const img = store.loadedImage;
  if (!img) return null;
  return {
    image: img,
    x: 0,
    y: 0,
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
});

const stageConfig = computed(() => ({
  width: stageWidth.value,
  height: stageHeight.value,
  scaleX: scale.value,
  scaleY: scale.value,
  x: offsetX.value,
  y: offsetY.value,
  draggable: false,
}));

function datumIndex(datum: Datum): number {
  return store.datums.findIndex((d) => d.id === datum.id);
}

function getPointConfigs(datum: Datum, dIdx: number) {
  const color = getDatumColor(dIdx);
  const isSelected = store.selectedDatumId === datum.id;
  const points = datum.type === "rectangle" ? datum.corners : datum.endpoints;
  const radius = isSelected ? 10 : 7;

  return points.map((pt, pIdx) => ({
    x: pt.x,
    y: pt.y,
    radius: radius / scale.value,
    fill: color,
    stroke: isSelected ? "#fff" : color,
    strokeWidth: 2 / scale.value,
    draggable: true,
    _datumId: datum.id,
    _pointIndex: pIdx,
    hitStrokeWidth: 20 / scale.value,
  }));
}

function getLineConfigs(datum: Datum, dIdx: number) {
  const color = getDatumColor(dIdx);
  const isSelected = store.selectedDatumId === datum.id;

  if (datum.type === "line") {
    return [
      {
        points: [
          datum.endpoints[0].x,
          datum.endpoints[0].y,
          datum.endpoints[1].x,
          datum.endpoints[1].y,
        ],
        stroke: color,
        strokeWidth: (isSelected ? 3 : 2) / scale.value,
        dash: isSelected ? [] : [8 / scale.value, 4 / scale.value],
      },
    ];
  }

  // Rectangle: draw 4 edges
  const c = datum.corners;
  const pts = [c[0], c[1], c[2], c[3], c[0]].flatMap((p) => [p.x, p.y]);
  return [
    {
      points: pts,
      stroke: color,
      strokeWidth: (isSelected ? 3 : 2) / scale.value,
      closed: true,
      dash: isSelected ? [] : [8 / scale.value, 4 / scale.value],
    },
  ];
}

function getLabelConfig(datum: Datum, dIdx: number) {
  const color = getDatumColor(dIdx);
  let pos: Point;

  if (datum.type === "rectangle") {
    pos = {
      x: (datum.corners[0].x + datum.corners[2].x) / 2,
      y: (datum.corners[0].y + datum.corners[2].y) / 2,
    };
  } else {
    pos = {
      x: (datum.endpoints[0].x + datum.endpoints[1].x) / 2,
      y: (datum.endpoints[0].y + datum.endpoints[1].y) / 2 - 20 / scale.value,
    };
  }

  return {
    x: pos.x,
    y: pos.y,
    text: datum.label,
    fontSize: 14 / scale.value,
    fill: color,
    fontStyle: "bold",
    align: "center" as const,
    offsetX: (datum.label.length * 7) / 2 / scale.value,
  };
}

function onPointDragMove(e: { target: { x: () => number; y: () => number; attrs: { _datumId: string; _pointIndex: number } } }) {
  const { _datumId, _pointIndex } = e.target.attrs;
  const datum = store.datums.find((d) => d.id === _datumId);
  if (!datum) return;

  const newPos: Point = { x: e.target.x(), y: e.target.y() };

  if (datum.type === "rectangle") {
    const newCorners = [...datum.corners] as [Point, Point, Point, Point];
    newCorners[_pointIndex] = newPos;
    store.updateDatum(_datumId, { corners: newCorners });
  } else {
    const newEndpoints = [...datum.endpoints] as [Point, Point];
    newEndpoints[_pointIndex] = newPos;
    store.updateDatum(_datumId, { endpoints: newEndpoints });
  }
}

function onPointClick(datumId: string) {
  store.selectedDatumId = datumId;
}

// Zoom with mouse wheel
function onWheel(e: WheelEvent) {
  e.preventDefault();
  const scaleBy = 1.08;
  const oldScale = scale.value;
  const newScale =
    e.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;

  const clampedScale = Math.max(0.05, Math.min(10, newScale));

  const rect = containerRef.value?.getBoundingClientRect();
  if (!rect) return;

  const pointerX = e.clientX - rect.left;
  const pointerY = e.clientY - rect.top;

  const mousePointTo = {
    x: (pointerX - offsetX.value) / oldScale,
    y: (pointerY - offsetY.value) / oldScale,
  };

  scale.value = clampedScale;
  offsetX.value = pointerX - mousePointTo.x * clampedScale;
  offsetY.value = pointerY - mousePointTo.y * clampedScale;
}

// Touch handlers for pinch-to-zoom and pan
function getTouchDistance(t1: Touch, t2: Touch): number {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

function getTouchCenter(t1: Touch, t2: Touch): { x: number; y: number } {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  };
}

function onTouchStart(e: TouchEvent) {
  if (e.touches.length === 2) {
    e.preventDefault();
    lastPinchDist = getTouchDistance(e.touches[0]!, e.touches[1]!);
  } else if (e.touches.length === 1) {
    // Single-finger pan (only if not on a point)
    const target = e.target as HTMLElement;
    if (!target.closest(".konvajs-content")) return;
    isPanning = true;
    panStart = { x: e.touches[0]!.clientX - offsetX.value, y: e.touches[0]!.clientY - offsetY.value };
  }
}

function onTouchMove(e: TouchEvent) {
  if (e.touches.length === 2) {
    e.preventDefault();
    const dist = getTouchDistance(e.touches[0]!, e.touches[1]!);
    const center = getTouchCenter(e.touches[0]!, e.touches[1]!);

    const rect = containerRef.value?.getBoundingClientRect();
    if (!rect) return;

    const scaleFactor = dist / lastPinchDist;
    const oldScale = scale.value;
    const newScale = Math.max(0.05, Math.min(10, oldScale * scaleFactor));

    const cx = center.x - rect.left;
    const cy = center.y - rect.top;

    const mousePointTo = {
      x: (cx - offsetX.value) / oldScale,
      y: (cy - offsetY.value) / oldScale,
    };

    scale.value = newScale;
    offsetX.value = cx - mousePointTo.x * newScale;
    offsetY.value = cy - mousePointTo.y * newScale;

    lastPinchDist = dist;
  } else if (e.touches.length === 1 && isPanning) {
    offsetX.value = e.touches[0]!.clientX - panStart.x;
    offsetY.value = e.touches[0]!.clientY - panStart.y;
  }
}

function onTouchEnd() {
  lastPinchDist = 0;
  isPanning = false;
}

// Fit image to canvas on mount
function fitToCanvas() {
  const img = store.loadedImage;
  const container = containerRef.value;
  if (!img || !container) return;

  const cw = container.clientWidth;
  const ch = container.clientHeight;
  stageWidth.value = cw;
  stageHeight.value = ch;

  const fitScale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight) * 0.9;
  scale.value = fitScale;
  offsetX.value = (cw - img.naturalWidth * fitScale) / 2;
  offsetY.value = (ch - img.naturalHeight * fitScale) / 2;
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  fitToCanvas();
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (!containerRef.value) return;
      const cw = containerRef.value.clientWidth;
      const ch = containerRef.value.clientHeight;
      // Skip if the container is hidden (0-sized)
      if (cw === 0 || ch === 0) return;
      // Re-fit whenever the container size actually changes
      fitToCanvas();
    });
    resizeObserver.observe(containerRef.value);
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
});

watch(() => store.loadedImage, fitToCanvas);
</script>

<template>
  <div
    ref="containerRef"
    class="h-full w-full touch-none overflow-hidden rounded-lg border border-border bg-muted"
    @wheel.prevent="onWheel"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
  >
    <v-stage :config="stageConfig">
      <v-layer>
        <!-- Background image -->
        <v-image v-if="imageConfig" :config="imageConfig" />

        <!-- Datum shapes -->
        <template v-for="datum in store.datums" :key="datum.id">
          <!-- Lines/edges -->
          <v-line
            v-for="(lineCfg, li) in getLineConfigs(datum, datumIndex(datum))"
            :key="`${datum.id}-line-${li}`"
            :config="lineCfg"
          />

          <!-- Center label -->
          <v-text :config="getLabelConfig(datum, datumIndex(datum))" />

          <!-- Draggable points -->
          <v-circle
            v-for="ptCfg in getPointConfigs(datum, datumIndex(datum))"
            :key="`${datum.id}-pt-${ptCfg._pointIndex}`"
            :config="ptCfg"
            @dragmove="onPointDragMove"
            @click="onPointClick(datum.id)"
            @tap="onPointClick(datum.id)"
          />
        </template>
      </v-layer>
    </v-stage>
  </div>
</template>
