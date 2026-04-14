export interface Point {
  x: number;
  y: number;
}

export interface RectDatum {
  id: string;
  type: "rectangle";
  corners: [Point, Point, Point, Point]; // TL, TR, BR, BL
  widthMm: number;
  heightMm: number;
  confidence: 1 | 2 | 3 | 4 | 5;
  label: string;
}

export interface LineDatum {
  id: string;
  type: "line";
  endpoints: [Point, Point];
  lengthMm: number;
  confidence: 1 | 2 | 3 | 4 | 5;
  label: string;
}

export type Datum = RectDatum | LineDatum;

export type ConfidenceScore = 1 | 2 | 3 | 4 | 5;

export interface ExifData {
  make?: string;
  model?: string;
  lensModel?: string;
  focalLength?: number;
  focalLengthIn35mm?: number;
  orientation?: number;
  imageWidth?: number;
  imageHeight?: number;
  exposureTime?: number;
  fNumber?: number;
  iso?: number;
  dateTimeOriginal?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
}

export interface DeskewInput {
  imageData: HTMLCanvasElement;
  datums: Datum[];
  exif: ExifData;
}

export interface DeskewResult {
  correctedImageBlob: Blob;
  appliedCorrections: string[];
}

export type AppStep = 1 | 2 | 3 | 4;

/** Pixels per centimeter in the image. Used for initial datum placement scaling. */
export const DEFAULT_SCALE_PX_PER_CM = 50;

export interface RectPreset {
  label: string;
  widthMm: number;
  heightMm: number;
}
