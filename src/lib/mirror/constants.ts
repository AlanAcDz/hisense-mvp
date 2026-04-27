import type { RigCalibration, ShirtCalibration } from '@/lib/mirror/types'

function withBaseUrl(path: string) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

export const JERSEY_RIGGED_MODEL_URL = withBaseUrl('/assets/models/jersey_mexico_rig.glb')
export const BACKGROUND_VIDEO_ASSET_URL = withBaseUrl('/assets/backgrounds/background.mp4')
export const SCREENSAVER_VIDEO_ASSET_URL = withBaseUrl('/assets/backgrounds/screensaver.mp4')
export const MEDIAPIPE_WASM_URL = withBaseUrl('/assets/mediapipe/wasm')
export const LANDMARK_INDICES = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const

export const REQUIRED_TORSO_INDICES = [
  LANDMARK_INDICES.leftShoulder,
  LANDMARK_INDICES.rightShoulder,
  LANDMARK_INDICES.leftElbow,
  LANDMARK_INDICES.rightElbow,
  LANDMARK_INDICES.leftHip,
  LANDMARK_INDICES.rightHip,
]
export const TORSO_VISIBILITY_THRESHOLD = 0.5
export const DETECTION_INTERVAL_MS = 33
export const DETECTION_INPUT_LONG_EDGE_PX = 1024
export const POSE_MODEL_VARIANT = 'full'
export const POSE_MODEL_URLS = {
  full: withBaseUrl('/assets/mediapipe/models/pose_landmarker_full.task'),
} as const
export const POSE_MODEL_URL = POSE_MODEL_URLS[POSE_MODEL_VARIANT]
export const POSE_USE_GPU_DELEGATE = true
export const POSE_CONFIDENCE = {
  minPoseDetectionConfidence: 0.6,
  minPosePresenceConfidence: 0.6,
  minTrackingConfidence: 0.5,
}
export const BACKGROUND_MASK_STALE_MS = 50
export const BACKGROUND_MASK_THRESHOLD = 0.48
export const BACKGROUND_MASK_STAY_THRESHOLD = 0.4
export const BACKGROUND_MASK_ALPHA_CURVE = 0.85
export const BACKGROUND_MASK_JOINT_BILATERAL_ENABLED = true
export const BACKGROUND_MASK_JOINT_BILATERAL_RADIUS = 2
export const BACKGROUND_MASK_JOINT_BILATERAL_SIGMA_SPATIAL = 2
export const BACKGROUND_MASK_JOINT_BILATERAL_SIGMA_COLOR = 36
export const BACKGROUND_MASK_JOINT_BILATERAL_EDGE_THRESHOLD = 0.08
export const BACKGROUND_MASK_DILATION_RADIUS = 1
export const BACKGROUND_MASK_FEATHER_PASSES = 5
export const BACKGROUND_MASK_DRAW_BLUR_PX = 1
export const BACKGROUND_MASK_MIN_COVERAGE = 0.015

export const SHIRT_CALIBRATION: ShirtCalibration = {
  scaleX: 1.65,
  scaleY: 1.25,
  scaleZ: 2.5,
  xOffset: 0,
  yOffset: -0.05,
  zOffset: 0,
  depthScale: 120,
  baseRotation: {
    x: 0,
    y: 0,
    z: 0,
  },
}

export const RIG_CALIBRATION: RigCalibration = {
  // These offsets compensate for the sleeve meshes being authored at a stable
  // angle relative to the shoulder-arm bone chain in jersey_mexico_rig.glb.
  leftArmZRotationOffset: -0.971592653589793,
  rightArmZRotationOffset: 0.938407346410207,
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
