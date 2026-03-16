import { Matrix4, Quaternion, Vector3 } from 'three';
import {
  LANDMARK_INDICES,
  SHIRT_CALIBRATION,
  TORSO_VISIBILITY_THRESHOLD,
} from '@/lib/mirror/constants';
import type {
  CoverLayout,
  Point2D,
  PoseFrame,
  PoseLandmark2D,
  PoseLandmark3D,
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
  const centerStage = mapNormalizedToStagePoint({ ...center, z: 0 }, stageSize, coverLayout);

  const widthPx = distance2D(leftShoulderStage, rightShoulderStage);
  const heightPx = distance2D(shoulderStage, hipStage);

  const shoulderCenterWorld = midpoint3D(leftShoulderWorld, rightShoulderWorld);
  const hipCenterWorld = midpoint3D(leftHipWorld, rightHipWorld);
  const rightAxis = new Vector3(
    rightShoulderWorld.x - leftShoulderWorld.x,
    rightShoulderWorld.y - leftShoulderWorld.y,
    rightShoulderWorld.z - leftShoulderWorld.z
  ).normalize();
  const downAxis = hipCenterWorld.clone().sub(shoulderCenterWorld).normalize();
  const forwardAxis = new Vector3().crossVectors(rightAxis, downAxis).normalize();
  const upAxis = new Vector3().crossVectors(forwardAxis, rightAxis).normalize();
  const basis = new Matrix4().makeBasis(rightAxis, upAxis, forwardAxis);
  const rotation = new Quaternion().setFromRotationMatrix(basis);

  return {
    center: {
      x: centerStage.x,
      y: centerStage.y + heightPx * calibration.yOffset,
    },
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
