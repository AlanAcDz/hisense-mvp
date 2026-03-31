import type { Quaternion } from 'three';

export interface PoseLandmark2D {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface PoseLandmark3D {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface TorsoLandmarks {
  leftShoulder: PoseLandmark2D;
  rightShoulder: PoseLandmark2D;
  leftHip: PoseLandmark2D;
  rightHip: PoseLandmark2D;
  leftShoulderWorld: PoseLandmark3D;
  rightShoulderWorld: PoseLandmark3D;
  leftHipWorld: PoseLandmark3D;
  rightHipWorld: PoseLandmark3D;
  minimumVisibility: number;
}

export interface ArmLandmarks {
  shoulder: PoseLandmark2D;
  elbow: PoseLandmark2D;
  shoulderWorld: PoseLandmark3D;
  elbowWorld: PoseLandmark3D;
  minimumVisibility: number;
}

export interface PoseFrame {
  normalizedLandmarks: PoseLandmark2D[];
  worldLandmarks: PoseLandmark3D[];
  timestamp: number;
  torso: TorsoLandmarks | null;
  leftArm: ArmLandmarks | null;
  rightArm: ArmLandmarks | null;
}

export interface SegmentationFrame {
  width: number;
  height: number;
  alpha: Float32Array;
  timestamp: number;
}

export interface BackgroundMatte {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
  coverage: number;
  timestamp: number;
}

export interface LandmarkerFrame {
  poseFrame: PoseFrame | null;
  segmentationFrame: SegmentationFrame | null;
}

export interface StageSize {
  width: number;
  height: number;
}

export interface CoverLayout {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface TorsoTransform {
  center: Point2D;
  topCenter: Point2D;
  bottomCenter: Point2D;
  widthPx: number;
  heightPx: number;
  depth: number;
  rotation: Quaternion;
}

export interface SleeveTransform {
  center: Point2D;
  lengthPx: number;
  shoulderWidthPx: number;
  elbowWidthPx: number;
  rotation: Quaternion;
}

export type BackgroundMode = 'loading' | 'active' | 'paused';

export interface MirrorSceneState {
  cameraError: string | null;
  poseError: string | null;
  poseModelLoading: boolean;
  shirtAssetLoading: boolean;
  shirtAssetError: string | null;
  backgroundMode: BackgroundMode;
  backgroundGuidance: string | null;
}

export interface CaptureCompositionOptions {
  backgroundCanvas: HTMLCanvasElement | null;
  foregroundCanvas: HTMLCanvasElement | null;
  rendererCanvas: HTMLCanvasElement;
  poseCanvas: HTMLCanvasElement | null;
  outputWidth: number;
  outputHeight: number;
  showPosePoints: boolean;
}

export interface ShirtCalibration {
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  xOffset: number;
  yOffset: number;
  zOffset: number;
  depthScale: number;
  baseRotation: {
    x: number;
    y: number;
    z: number;
  };
}

export interface SleeveCalibration {
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  zOffset: number;
  baseRotation: {
    x: number;
    y: number;
    z: number;
  };
}
