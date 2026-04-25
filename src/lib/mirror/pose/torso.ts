import { Euler, Quaternion, Vector3 } from 'three';
import {
  LANDMARK_INDICES,
  SHIRT_CALIBRATION,
  TORSO_VISIBILITY_THRESHOLD,
} from '@/lib/mirror/constants';
import type {
  ArmLandmarks,
  CoverLayout,
  Point2D,
  PoseFrame,
  PoseLandmark2D,
  PoseLandmark3D,
  RigPose,
  ShirtCalibration,
  StageSize,
  TorsoLandmarks,
  TorsoTransform,
} from '@/lib/mirror/types';

function visibilityOf(landmark: PoseLandmark2D | PoseLandmark3D) {
  return landmark.visibility ?? 1;
}

function midpoint(a: PoseLandmark2D, b: PoseLandmark2D): Point2D {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function midpoint3D(a: PoseLandmark3D, b: PoseLandmark3D) {
  return new Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

function distance2D(a: Point2D, b: Point2D) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function getStableScreenAngle(a: Point2D, b: Point2D) {
  const start = a.x <= b.x ? a : b;
  const end = a.x <= b.x ? b : a;

  return Math.atan2(end.y - start.y, end.x - start.x);
}

function normalizeAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function blendAngles(first: number, second: number, secondWeight: number) {
  const weight = clamp01(secondWeight);
  return normalizeAngle(first + normalizeAngle(second - first) * weight);
}

export function getArmLandmarks(
  normalizedLandmarks: PoseLandmark2D[],
  worldLandmarks: PoseLandmark3D[],
  side: 'left' | 'right'
): ArmLandmarks | null {
  const shoulderIdx = side === 'left' ? LANDMARK_INDICES.leftShoulder : LANDMARK_INDICES.rightShoulder;
  const elbowIdx = side === 'left' ? LANDMARK_INDICES.leftElbow : LANDMARK_INDICES.rightElbow;
  const wristIdx = side === 'left' ? LANDMARK_INDICES.leftWrist : LANDMARK_INDICES.rightWrist;

  const shoulder = normalizedLandmarks[shoulderIdx];
  const elbow = normalizedLandmarks[elbowIdx];
  const wrist = normalizedLandmarks[wristIdx];
  const shoulderWorld = worldLandmarks[shoulderIdx];
  const elbowWorld = worldLandmarks[elbowIdx];
  const wristWorld = worldLandmarks[wristIdx];

  if (!shoulder || !elbow || !shoulderWorld || !elbowWorld) {
    return null;
  }

  return {
    shoulder,
    elbow,
    ...(wrist ? { wrist } : {}),
    shoulderWorld,
    elbowWorld,
    ...(wristWorld ? { wristWorld } : {}),
    minimumVisibility: Math.min(visibilityOf(shoulder), visibilityOf(elbow)),
  };
}

export function createPoseFrame(
  normalizedLandmarks: PoseLandmark2D[] | undefined,
  worldLandmarks: PoseLandmark3D[] | undefined,
  timestamp: number
): PoseFrame | null {
  if (!normalizedLandmarks?.length || !worldLandmarks?.length) {
    return null;
  }

  return {
    normalizedLandmarks,
    worldLandmarks,
    timestamp,
    torso: getTorsoLandmarks(normalizedLandmarks, worldLandmarks),
    leftArm: getArmLandmarks(normalizedLandmarks, worldLandmarks, 'left'),
    rightArm: getArmLandmarks(normalizedLandmarks, worldLandmarks, 'right'),
  };
}

export function getTorsoLandmarks(
  normalizedLandmarks: PoseLandmark2D[],
  worldLandmarks: PoseLandmark3D[]
): TorsoLandmarks | null {
  const leftShoulder = normalizedLandmarks[LANDMARK_INDICES.leftShoulder];
  const rightShoulder = normalizedLandmarks[LANDMARK_INDICES.rightShoulder];
  const leftHip = normalizedLandmarks[LANDMARK_INDICES.leftHip];
  const rightHip = normalizedLandmarks[LANDMARK_INDICES.rightHip];
  const leftShoulderWorld = worldLandmarks[LANDMARK_INDICES.leftShoulder];
  const rightShoulderWorld = worldLandmarks[LANDMARK_INDICES.rightShoulder];
  const leftHipWorld = worldLandmarks[LANDMARK_INDICES.leftHip];
  const rightHipWorld = worldLandmarks[LANDMARK_INDICES.rightHip];

  if (
    !leftShoulder ||
    !rightShoulder ||
    !leftHip ||
    !rightHip ||
    !leftShoulderWorld ||
    !rightShoulderWorld ||
    !leftHipWorld ||
    !rightHipWorld
  ) {
    return null;
  }

  return {
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
    leftShoulderWorld,
    rightShoulderWorld,
    leftHipWorld,
    rightHipWorld,
    minimumVisibility: Math.min(
      visibilityOf(leftShoulder),
      visibilityOf(rightShoulder),
      visibilityOf(leftHip),
      visibilityOf(rightHip)
    ),
  };
}

export function getCoverLayout(videoSize: StageSize, stageSize: StageSize): CoverLayout {
  const videoAspect = videoSize.width / videoSize.height;
  const stageAspect = stageSize.width / stageSize.height;

  if (videoAspect > stageAspect) {
    const height = stageSize.height;
    const width = height * videoAspect;
    return {
      width,
      height,
      offsetX: (stageSize.width - width) / 2,
      offsetY: 0,
    };
  }

  const width = stageSize.width;
  const height = width / videoAspect;
  return {
    width,
    height,
    offsetX: 0,
    offsetY: (stageSize.height - height) / 2,
  };
}

export function mapNormalizedToStagePoint(
  landmark: PoseLandmark2D,
  stageSize: StageSize,
  coverLayout: CoverLayout
): Point2D {
  return {
    x: coverLayout.offsetX + landmark.x * coverLayout.width,
    y: coverLayout.offsetY + landmark.y * coverLayout.height,
  };
}

export function computeTorsoTransform(
  poseFrame: PoseFrame | null,
  stageSize: StageSize,
  coverLayout: CoverLayout,
  calibration: ShirtCalibration = SHIRT_CALIBRATION
): TorsoTransform | null {
  if (!poseFrame?.torso || poseFrame.torso.minimumVisibility < TORSO_VISIBILITY_THRESHOLD) {
    return null;
  }

  const {
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
    leftShoulderWorld,
    rightShoulderWorld,
    leftHipWorld,
    rightHipWorld,
  } = poseFrame.torso;

  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const hipCenter = midpoint(leftHip, rightHip);
  const center = {
    x: (shoulderCenter.x + hipCenter.x) / 2,
    y: (shoulderCenter.y + hipCenter.y) / 2,
  };

  const shoulderStage = mapNormalizedToStagePoint({ ...shoulderCenter, z: 0 }, stageSize, coverLayout);
  const hipStage = mapNormalizedToStagePoint({ ...hipCenter, z: 0 }, stageSize, coverLayout);
  const leftShoulderStage = mapNormalizedToStagePoint(leftShoulder, stageSize, coverLayout);
  const rightShoulderStage = mapNormalizedToStagePoint(rightShoulder, stageSize, coverLayout);
  const leftHipStage = mapNormalizedToStagePoint(leftHip, stageSize, coverLayout);
  const rightHipStage = mapNormalizedToStagePoint(rightHip, stageSize, coverLayout);
  const centerStage = mapNormalizedToStagePoint({ ...center, z: 0 }, stageSize, coverLayout);

  const widthPx = distance2D(leftShoulderStage, rightShoulderStage);
  const heightPx = distance2D(shoulderStage, hipStage);

  const shoulderAngle = getStableScreenAngle(leftShoulderStage, rightShoulderStage);
  const hipAngle = getStableScreenAngle(leftHipStage, rightHipStage);
  const roll = (shoulderAngle + hipAngle) / 2;

  const shoulderDx = rightShoulderWorld.x - leftShoulderWorld.x;
  const shoulderDz = rightShoulderWorld.z - leftShoulderWorld.z;
  const hipDx = rightHipWorld.x - leftHipWorld.x;
  const hipDz = rightHipWorld.z - leftHipWorld.z;
  const yaw = (Math.atan2(shoulderDz, Math.abs(shoulderDx)) + Math.atan2(hipDz, Math.abs(hipDx))) / 2;

  const rotation = new Quaternion().setFromEuler(new Euler(0, yaw, roll));

  return {
    center: {
      x: centerStage.x,
      y: centerStage.y + heightPx * calibration.yOffset,
    },
    topCenter: shoulderStage,
    bottomCenter: hipStage,
    widthPx,
    heightPx,
    depth:
      -(
        leftShoulderWorld.z +
        rightShoulderWorld.z +
        leftHipWorld.z +
        rightHipWorld.z
      ) /
      4,
    rotation,
  };
}

function computeArmZRotation(
  arm: ArmLandmarks | null,
  stageSize: StageSize,
  coverLayout: CoverLayout
) {
  if (!arm || arm.minimumVisibility < TORSO_VISIBILITY_THRESHOLD) {
    return null;
  }

  const shoulderStage = mapNormalizedToStagePoint(arm.shoulder, stageSize, coverLayout);
  const elbowStage = mapNormalizedToStagePoint(arm.elbow, stageSize, coverLayout);
  const elbowAngle = Math.atan2(
    shoulderStage.y - elbowStage.y,
    shoulderStage.x - elbowStage.x
  );

  if (!arm.wrist || visibilityOf(arm.wrist) < TORSO_VISIBILITY_THRESHOLD) {
    return elbowAngle;
  }

  const wristStage = mapNormalizedToStagePoint(arm.wrist, stageSize, coverLayout);
  const wristAngle = Math.atan2(
    shoulderStage.y - wristStage.y,
    shoulderStage.x - wristStage.x
  );
  const shoulderToElbow = distance2D(shoulderStage, elbowStage);
  const shoulderToWrist = distance2D(shoulderStage, wristStage);
  if (shoulderToElbow < 1 || shoulderToWrist < shoulderToElbow * 0.75) {
    return elbowAngle;
  }

  const overheadInfluence = clamp01((shoulderStage.y - wristStage.y) / Math.max(shoulderToElbow, 1));
  const bendInfluence = clamp01(Math.abs(normalizeAngle(wristAngle - elbowAngle)) / (Math.PI / 2));
  const wristWeight = Math.min(0.35, overheadInfluence * 0.22 + bendInfluence * 0.12);

  return blendAngles(elbowAngle, wristAngle, wristWeight);
}

export function computeRigPose(
  poseFrame: PoseFrame | null,
  torsoTransform: TorsoTransform | null,
  stageSize: StageSize,
  coverLayout: CoverLayout
): RigPose | null {
  if (!poseFrame || !torsoTransform) {
    return null;
  }

  const torsoRoll = new Euler().setFromQuaternion(torsoTransform.rotation).z;

  return {
    leftArmZRotation: computeArmZRotation(
      poseFrame.leftArm,
      stageSize,
      coverLayout
    ),
    rightArmZRotation: computeArmZRotation(
      poseFrame.rightArm,
      stageSize,
      coverLayout
    ),
    torsoRoll,
  };
}
