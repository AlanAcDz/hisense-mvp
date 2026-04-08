import {
  LANDMARK_INDICES,
  SHIRT_CALIBRATION,
  SLEEVE_CALIBRATION,
} from '@/lib/mirror/constants'
import { computeSleeveTransform, computeTorsoTransform } from '@/lib/mirror/pose/torso'
import { applySleeveRenderTwist } from '@/lib/mirror/sleeve-render'
import type {
  Point2D,
  PoseFrame,
  PoseLandmark2D,
  PoseLandmark3D,
  ShirtCalibration,
  SleeveCalibration,
  SleeveTransform,
  StageSize,
  TorsoTransform,
} from '@/lib/mirror/types'

export interface CalibrationPreviewPose {
  torsoCenterX: number
  torsoCenterY: number
  torsoWidth: number
  torsoHeight: number
  torsoDepth: number
  torsoRollDeg: number
  torsoYawDeg: number
  armLength: number
  leftArmAngleDeg: number
  rightArmAngleDeg: number
}

export const DEFAULT_TORSO_OPACITY = 1
export const DEFAULT_SLEEVE_OPACITY = 1

export const DEFAULT_CALIBRATION_PREVIEW_POSE: CalibrationPreviewPose = {
  torsoCenterX: 0.5,
  torsoCenterY: 0.5,
  torsoWidth: 0.34,
  torsoHeight: 0.44,
  torsoDepth: 0.18,
  torsoRollDeg: 0,
  torsoYawDeg: 0,
  armLength: 0.29,
  leftArmAngleDeg: 118,
  rightArmAngleDeg: 62,
}

export interface CalibrationPreviewOverlay {
  torsoPolygon: Point2D[]
  leftShoulder: Point2D
  rightShoulder: Point2D
  leftHip: Point2D
  rightHip: Point2D
  leftElbow: Point2D
  rightElbow: Point2D
}

export interface CalibrationPreviewScene {
  torsoTransform: TorsoTransform
  leftSleeveTransform: SleeveTransform
  rightSleeveTransform: SleeveTransform
  overlay: CalibrationPreviewOverlay
}

export function cloneShirtCalibration(calibration: ShirtCalibration = SHIRT_CALIBRATION): ShirtCalibration {
  return {
    ...calibration,
    baseRotation: {
      ...calibration.baseRotation,
    },
  }
}

export function cloneSleeveCalibration(
  calibration: SleeveCalibration = SLEEVE_CALIBRATION,
): SleeveCalibration {
  return {
    ...calibration,
    baseRotation: {
      ...calibration.baseRotation,
    },
  }
}

export function buildCalibrationPreviewScene(
  stageSize: StageSize,
  pose: CalibrationPreviewPose,
  shirtCalibration: ShirtCalibration = SHIRT_CALIBRATION,
  sleeveCalibration: SleeveCalibration = SLEEVE_CALIBRATION,
): CalibrationPreviewScene | null {
  if (!stageSize.width || !stageSize.height) {
    return null
  }

  const overlay = buildVisibleOverlay(stageSize, pose)
  const rawOverlay = mirrorOverlay(overlay, stageSize.width)
  const poseFrame = buildPreviewPoseFrame(rawOverlay, stageSize, pose)
  const coverLayout = {
    width: stageSize.width,
    height: stageSize.height,
    offsetX: 0,
    offsetY: 0,
  }
  const torsoTransform = computeTorsoTransform(poseFrame, stageSize, coverLayout, shirtCalibration)

  if (!torsoTransform) {
    return null
  }

  const leftSleeveTransform = computeSleeveTransform(
    poseFrame.leftArm,
    torsoTransform,
    stageSize,
    coverLayout,
    sleeveCalibration,
  )
  const rightSleeveTransform = computeSleeveTransform(
    poseFrame.rightArm,
    torsoTransform,
    stageSize,
    coverLayout,
    sleeveCalibration,
  )

  if (!leftSleeveTransform || !rightSleeveTransform) {
    return null
  }

  return {
    torsoTransform,
    leftSleeveTransform: applySleeveRenderTwist(leftSleeveTransform),
    rightSleeveTransform: applySleeveRenderTwist(rightSleeveTransform),
    overlay,
  }
}

export function buildCalibrationSnippet({
  shirtCalibration,
  sleeveCalibration,
}: {
  shirtCalibration: ShirtCalibration
  sleeveCalibration: SleeveCalibration
}) {
  return `export const SHIRT_CALIBRATION: ShirtCalibration = {
  scaleX: ${formatNumber(shirtCalibration.scaleX)},
  scaleY: ${formatNumber(shirtCalibration.scaleY)},
  scaleZ: ${formatNumber(shirtCalibration.scaleZ)},
  xOffset: ${formatNumber(shirtCalibration.xOffset)},
  yOffset: ${formatNumber(shirtCalibration.yOffset)},
  zOffset: ${formatNumber(shirtCalibration.zOffset)},
  depthScale: ${formatNumber(shirtCalibration.depthScale)},
  baseRotation: {
    x: ${formatNumber(shirtCalibration.baseRotation.x)},
    y: ${formatNumber(shirtCalibration.baseRotation.y)},
    z: ${formatNumber(shirtCalibration.baseRotation.z)},
  },
}

export const SLEEVE_CALIBRATION: SleeveCalibration = {
  scaleX: ${formatNumber(sleeveCalibration.scaleX)},
  scaleY: ${formatNumber(sleeveCalibration.scaleY)},
  scaleZ: ${formatNumber(sleeveCalibration.scaleZ)},
  xOffset: ${formatNumber(sleeveCalibration.xOffset)},
  yOffset: ${formatNumber(sleeveCalibration.yOffset)},
  lineOffset: ${formatNumber(sleeveCalibration.lineOffset)},
  zOffset: ${formatNumber(sleeveCalibration.zOffset)},
  leftZRotationOffset: ${formatNumber(sleeveCalibration.leftZRotationOffset)},
  rightZRotationOffset: ${formatNumber(sleeveCalibration.rightZRotationOffset)},
  baseRotation: {
    x: ${formatNumber(sleeveCalibration.baseRotation.x)},
    y: ${formatNumber(sleeveCalibration.baseRotation.y)},
    z: ${formatNumber(sleeveCalibration.baseRotation.z)},
  },
}`
}

function formatNumber(value: number) {
  return Number(value.toFixed(6)).toString()
}

function buildVisibleOverlay(stageSize: StageSize, pose: CalibrationPreviewPose): CalibrationPreviewOverlay {
  const minDimension = Math.min(stageSize.width, stageSize.height)
  const torsoCenter = {
    x: stageSize.width * pose.torsoCenterX,
    y: stageSize.height * pose.torsoCenterY,
  }
  const torsoWidthPx = minDimension * pose.torsoWidth
  const torsoHeightPx = minDimension * pose.torsoHeight
  const halfWidth = torsoWidthPx / 2
  const halfHeight = torsoHeightPx / 2
  const roll = toRadians(pose.torsoRollDeg)
  const armLengthPx = minDimension * pose.armLength

  const leftShoulder = rotatePoint(
    { x: torsoCenter.x - halfWidth, y: torsoCenter.y - halfHeight },
    torsoCenter,
    roll,
  )
  const rightShoulder = rotatePoint(
    { x: torsoCenter.x + halfWidth, y: torsoCenter.y - halfHeight },
    torsoCenter,
    roll,
  )
  const rightHip = rotatePoint(
    { x: torsoCenter.x + halfWidth * 0.76, y: torsoCenter.y + halfHeight },
    torsoCenter,
    roll,
  )
  const leftHip = rotatePoint(
    { x: torsoCenter.x - halfWidth * 0.76, y: torsoCenter.y + halfHeight },
    torsoCenter,
    roll,
  )

  return {
    torsoPolygon: [leftShoulder, rightShoulder, rightHip, leftHip],
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
    leftElbow: pointAlongAngle(leftShoulder, pose.leftArmAngleDeg, armLengthPx),
    rightElbow: pointAlongAngle(rightShoulder, pose.rightArmAngleDeg, armLengthPx),
  }
}

function mirrorOverlay(overlay: CalibrationPreviewOverlay, stageWidth: number): CalibrationPreviewOverlay {
  return {
    torsoPolygon: overlay.torsoPolygon.map((point) => mirrorPoint(point, stageWidth)),
    leftShoulder: mirrorPoint(overlay.leftShoulder, stageWidth),
    rightShoulder: mirrorPoint(overlay.rightShoulder, stageWidth),
    leftHip: mirrorPoint(overlay.leftHip, stageWidth),
    rightHip: mirrorPoint(overlay.rightHip, stageWidth),
    leftElbow: mirrorPoint(overlay.leftElbow, stageWidth),
    rightElbow: mirrorPoint(overlay.rightElbow, stageWidth),
  }
}

function buildPreviewPoseFrame(
  overlay: CalibrationPreviewOverlay,
  stageSize: StageSize,
  pose: CalibrationPreviewPose,
): PoseFrame {
  const normalizedLandmarks: PoseLandmark2D[] = Array.from({ length: 33 }, () =>
    buildNormalizedLandmark({ x: stageSize.width / 2, y: stageSize.height / 2 }, stageSize),
  )
  const worldLandmarks: PoseLandmark3D[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 1,
  }))

  const torsoWorld = buildTorsoWorldLandmarks(pose)
  const leftElbowWorld = buildWorldArmPoint(
    torsoWorld.leftShoulderWorld,
    overlay.leftShoulder,
    overlay.leftElbow,
    stageSize,
  )
  const rightElbowWorld = buildWorldArmPoint(
    torsoWorld.rightShoulderWorld,
    overlay.rightShoulder,
    overlay.rightElbow,
    stageSize,
  )

  normalizedLandmarks[LANDMARK_INDICES.leftShoulder] = buildNormalizedLandmark(overlay.leftShoulder, stageSize)
  normalizedLandmarks[LANDMARK_INDICES.rightShoulder] = buildNormalizedLandmark(overlay.rightShoulder, stageSize)
  normalizedLandmarks[LANDMARK_INDICES.leftElbow] = buildNormalizedLandmark(overlay.leftElbow, stageSize)
  normalizedLandmarks[LANDMARK_INDICES.rightElbow] = buildNormalizedLandmark(overlay.rightElbow, stageSize)
  normalizedLandmarks[LANDMARK_INDICES.leftHip] = buildNormalizedLandmark(overlay.leftHip, stageSize)
  normalizedLandmarks[LANDMARK_INDICES.rightHip] = buildNormalizedLandmark(overlay.rightHip, stageSize)

  worldLandmarks[LANDMARK_INDICES.leftShoulder] = torsoWorld.leftShoulderWorld
  worldLandmarks[LANDMARK_INDICES.rightShoulder] = torsoWorld.rightShoulderWorld
  worldLandmarks[LANDMARK_INDICES.leftHip] = torsoWorld.leftHipWorld
  worldLandmarks[LANDMARK_INDICES.rightHip] = torsoWorld.rightHipWorld
  worldLandmarks[LANDMARK_INDICES.leftElbow] = leftElbowWorld
  worldLandmarks[LANDMARK_INDICES.rightElbow] = rightElbowWorld

  return {
    normalizedLandmarks,
    worldLandmarks,
    timestamp: 0,
    torso: {
      leftShoulder: normalizedLandmarks[LANDMARK_INDICES.leftShoulder],
      rightShoulder: normalizedLandmarks[LANDMARK_INDICES.rightShoulder],
      leftHip: normalizedLandmarks[LANDMARK_INDICES.leftHip],
      rightHip: normalizedLandmarks[LANDMARK_INDICES.rightHip],
      leftShoulderWorld: torsoWorld.leftShoulderWorld,
      rightShoulderWorld: torsoWorld.rightShoulderWorld,
      leftHipWorld: torsoWorld.leftHipWorld,
      rightHipWorld: torsoWorld.rightHipWorld,
      minimumVisibility: 1,
    },
    leftArm: {
      shoulder: normalizedLandmarks[LANDMARK_INDICES.leftShoulder],
      elbow: normalizedLandmarks[LANDMARK_INDICES.leftElbow],
      shoulderWorld: torsoWorld.leftShoulderWorld,
      elbowWorld: leftElbowWorld,
      minimumVisibility: 1,
    },
    rightArm: {
      shoulder: normalizedLandmarks[LANDMARK_INDICES.rightShoulder],
      elbow: normalizedLandmarks[LANDMARK_INDICES.rightElbow],
      shoulderWorld: torsoWorld.rightShoulderWorld,
      elbowWorld: rightElbowWorld,
      minimumVisibility: 1,
    },
  }
}

function buildTorsoWorldLandmarks(pose: CalibrationPreviewPose) {
  const halfWidth = Math.max(pose.torsoWidth * 0.5, 0.001)
  const halfHeight = Math.max(pose.torsoHeight * 0.5, 0.001)
  const yaw = toRadians(pose.torsoYawDeg)
  const xExtent = halfWidth * Math.cos(yaw)
  const zExtent = halfWidth * Math.sin(yaw)
  const depthCenter = -pose.torsoDepth

  return {
    leftShoulderWorld: {
      x: -xExtent,
      y: -halfHeight,
      z: depthCenter - zExtent,
      visibility: 1,
    },
    rightShoulderWorld: {
      x: xExtent,
      y: -halfHeight,
      z: depthCenter + zExtent,
      visibility: 1,
    },
    leftHipWorld: {
      x: -xExtent * 0.76,
      y: halfHeight,
      z: depthCenter - zExtent,
      visibility: 1,
    },
    rightHipWorld: {
      x: xExtent * 0.76,
      y: halfHeight,
      z: depthCenter + zExtent,
      visibility: 1,
    },
  }
}

function buildNormalizedLandmark(point: Point2D, stageSize: StageSize): PoseLandmark2D {
  return {
    x: point.x / stageSize.width,
    y: point.y / stageSize.height,
    z: 0,
    visibility: 1,
  }
}

function buildWorldArmPoint(
  shoulderWorld: PoseLandmark3D,
  shoulder: Point2D,
  elbow: Point2D,
  stageSize: StageSize,
): PoseLandmark3D {
  return {
    x: shoulderWorld.x + (elbow.x - shoulder.x) / stageSize.width,
    y: shoulderWorld.y + (elbow.y - shoulder.y) / stageSize.height,
    z: shoulderWorld.z,
    visibility: 1,
  }
}

function mirrorPoint(point: Point2D, stageWidth: number): Point2D {
  return {
    x: stageWidth - point.x,
    y: point.y,
  }
}

function rotatePoint(point: Point2D, center: Point2D, angle: number): Point2D {
  const dx = point.x - center.x
  const dy = point.y - center.y

  return {
    x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  }
}

function pointAlongAngle(origin: Point2D, angleDeg: number, distance: number): Point2D {
  const angle = toRadians(angleDeg)
  return {
    x: origin.x + Math.cos(angle) * distance,
    y: origin.y + Math.sin(angle) * distance,
  }
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}
