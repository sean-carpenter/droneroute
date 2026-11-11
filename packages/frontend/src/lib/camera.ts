/**
 * Camera models and photogrammetry math (GSD, footprint, overlap spacing).
 * Everything here is a pure function of altitude above ground and the camera.
 */

export interface CameraModel {
  label: string;
  focalLengthMm: number;
  sensorWidthMm: number;
  sensorHeightMm: number;
  imageWidthPx: number;
  imageHeightPx: number;
  /** Shortest time between two photos the camera can sustain, in seconds. */
  minPhotoIntervalS: number;
}

/** Mavic 3E wide camera: 4/3 CMOS, 20 MP, 24 mm equivalent, mechanical shutter. */
export const MAVIC_3E_CAMERA: CameraModel = {
  label: "Mavic 3E wide",
  focalLengthMm: 12.3,
  sensorWidthMm: 17.3,
  sensorHeightMm: 13.0,
  imageWidthPx: 5280,
  imageHeightPx: 3956,
  minPhotoIntervalS: 0.7,
};

/** Cameras with known geometry, keyed by WPML payloadEnumValue. */
const CAMERAS_BY_PAYLOAD: Record<number, CameraModel> = {
  66: MAVIC_3E_CAMERA,
};

/**
 * Camera for a payload. `exact` is false when the payload has no known
 * geometry and the Mavic 3E wide camera is used as a stand-in.
 */
export function cameraForPayload(payloadEnumValue: number): {
  camera: CameraModel;
  exact: boolean;
} {
  const camera = CAMERAS_BY_PAYLOAD[payloadEnumValue];
  return camera
    ? { camera, exact: true }
    : { camera: MAVIC_3E_CAMERA, exact: false };
}

/** Ground sample distance in cm/px for a nadir image. */
export function gsdCmPerPx(
  altitudeAglM: number,
  camera: CameraModel = MAVIC_3E_CAMERA,
): number {
  return (
    ((altitudeAglM * camera.sensorWidthMm) /
      (camera.focalLengthMm * camera.imageWidthPx)) *
    100
  );
}

/** Altitude above ground (m) that yields the given GSD (cm/px). */
export function altitudeForGsd(
  gsdCm: number,
  camera: CameraModel = MAVIC_3E_CAMERA,
): number {
  return (
    ((gsdCm / 100) * camera.focalLengthMm * camera.imageWidthPx) /
    camera.sensorWidthMm
  );
}

/**
 * Ground footprint of one nadir image. Width is across the flight direction
 * (long sensor side), height is along it.
 */
export function footprintM(
  altitudeAglM: number,
  camera: CameraModel = MAVIC_3E_CAMERA,
): { widthM: number; heightM: number } {
  return {
    widthM: (altitudeAglM * camera.sensorWidthMm) / camera.focalLengthMm,
    heightM: (altitudeAglM * camera.sensorHeightMm) / camera.focalLengthMm,
  };
}

/** Flight-line spacing and photo interval for the given overlaps (0–1). */
export function spacingFromOverlap(
  altitudeAglM: number,
  sideOverlap: number,
  forwardOverlap: number,
  camera: CameraModel = MAVIC_3E_CAMERA,
): { lineSpacingM: number; photoIntervalM: number } {
  const { widthM, heightM } = footprintM(altitudeAglM, camera);
  const clamp = (v: number) => Math.min(0.95, Math.max(0, v));
  return {
    lineSpacingM: widthM * (1 - clamp(sideOverlap)),
    photoIntervalM: heightM * (1 - clamp(forwardOverlap)),
  };
}

/** Fastest ground speed (m/s) at which the camera can keep up with the interval. */
export function maxSpeedForInterval(
  photoIntervalM: number,
  camera: CameraModel = MAVIC_3E_CAMERA,
): number {
  return photoIntervalM / camera.minPhotoIntervalS;
}

export interface OverlapPreset {
  label: string;
  sideOverlap: number;
  forwardOverlap: number;
}

export const OVERLAP_PRESETS: OverlapPreset[] = [
  { label: "Quick (60/70)", sideOverlap: 0.6, forwardOverlap: 0.7 },
  { label: "Standard (75/75)", sideOverlap: 0.75, forwardOverlap: 0.75 },
  { label: "High detail (80/80)", sideOverlap: 0.8, forwardOverlap: 0.8 },
];
