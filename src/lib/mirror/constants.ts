import type { ShirtCalibration, SleeveCalibration } from '@/lib/mirror/types'

function withBaseUrl(path: string) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

export const JERSEY_FRONT_MODEL_URL = withBaseUrl('/assets/models/hisense-jersey-front.glb')
export const JERSEY_SLEEVES_MODEL_URL = withBaseUrl('/assets/models/hisense-jersey-sleeves.glb')
export const BACKGROUND_ASSET_URL = withBaseUrl('/assets/backgrounds/hisense-football-stadium-2026.jpg')
export const LANDMARK_INDICES = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftHip: 23,
  rightHip: 24,
} as const

export const REQUIRED_TORSO_INDICES = Object.values(LANDMARK_INDICES)
export const TORSO_VISIBILITY_THRESHOLD = 0.5
export const DETECTION_INTERVAL_MS = 16
export const POSE_CONFIDENCE = {
  minPoseDetectionConfidence: 0.6,
  minPosePresenceConfidence: 0.6,
  minTrackingConfidence: 0.5,
}
export const BACKGROUND_MASK_STALE_MS = 96
export const BACKGROUND_MASK_THRESHOLD = 0.48
export const BACKGROUND_MASK_ALPHA_CURVE = 0.85
export const BACKGROUND_MASK_DILATION_RADIUS = 2
export const BACKGROUND_MASK_FEATHER_PASSES = 3
export const BACKGROUND_MASK_DRAW_BLUR_PX = 1.5
export const BACKGROUND_MASK_MIN_COVERAGE = 0.015

export const SHIRT_CALIBRATION: ShirtCalibration = {
  scaleX: 1.55,
  scaleY: 1.2,
  scaleZ: 2.5,
  xOffset: 0,
  yOffset: -0.09,
  zOffset: 0,
  depthScale: 120,
  baseRotation: {
    x: 0,
    y: Math.PI,
    z: 0,
  },
}

export const SLEEVE_CALIBRATION: SleeveCalibration = {
  scaleX: 1.38,
  scaleY: 1.08,
  scaleZ: 1.34,
  yOffset: 0.34,
  zOffset: 14,
  baseRotation: {
    x: Math.PI,
    y: 0,
    z: 0,
  },
}

export const POSE_CONNECTIONS: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7],
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8],
  [9, 10],
  [11, 12],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [15, 21],
  [17, 19],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [16, 22],
  [18, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [24, 26],
  [25, 27],
  [26, 28],
  [27, 29],
  [28, 30],
  [29, 31],
  [30, 32],
  [27, 31],
  [28, 32],
]
