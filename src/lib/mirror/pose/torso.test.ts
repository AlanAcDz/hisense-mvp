import { Euler } from 'three';
import {
  computeRigPose,
  computeTorsoTransform,
  createPoseFrame,
  getCoverLayout,
} from '@/lib/mirror/pose/torso';
import type { PoseLandmark2D, PoseLandmark3D } from '@/lib/mirror/types';

function buildNormalizedLandmarks(visibility = 0.98) {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility,
  })) satisfies PoseLandmark2D[];

  landmarks[11] = { x: 0.4, y: 0.3, z: 0, visibility };
  landmarks[12] = { x: 0.6, y: 0.3, z: 0, visibility };
  landmarks[13] = { x: 0.3, y: 0.47, z: 0, visibility };
  landmarks[14] = { x: 0.7, y: 0.47, z: 0, visibility };
  landmarks[15] = { x: 0.2, y: 0.64, z: 0, visibility };
  landmarks[16] = { x: 0.8, y: 0.64, z: 0, visibility };
  landmarks[23] = { x: 0.43, y: 0.7, z: 0, visibility };
  landmarks[24] = { x: 0.57, y: 0.7, z: 0, visibility };

  return landmarks;
}

function buildWorldLandmarks(visibility = 0.98) {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility,
  })) satisfies PoseLandmark3D[];

  landmarks[11] = { x: -0.18, y: -0.08, z: -0.25, visibility };
  landmarks[12] = { x: 0.18, y: -0.08, z: -0.23, visibility };
  landmarks[13] = { x: -0.34, y: 0.08, z: -0.18, visibility };
  landmarks[14] = { x: 0.34, y: 0.08, z: -0.17, visibility };
  landmarks[15] = { x: -0.48, y: 0.24, z: -0.17, visibility };
  landmarks[16] = { x: 0.48, y: 0.24, z: -0.16, visibility };
  landmarks[23] = { x: -0.14, y: 0.38, z: -0.2, visibility };
  landmarks[24] = { x: 0.14, y: 0.38, z: -0.19, visibility };

  return landmarks;
}

describe('torso transform', () => {
  it('computes torso center, width, and height from torso landmarks', () => {
    const poseFrame = createPoseFrame(buildNormalizedLandmarks(), buildWorldLandmarks(), 1000);
    const stageSize = { width: 1280, height: 720 };
    const coverLayout = getCoverLayout({ width: 1280, height: 720 }, stageSize);

    const transform = computeTorsoTransform(poseFrame, stageSize, coverLayout, {
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      xOffset: 0,
      yOffset: 0,
      zOffset: 0,
      depthScale: 120,
      baseRotation: { x: 0, y: 0, z: 0 },
    });

    expect(transform).not.toBeNull();
    expect(transform?.center.x).toBeCloseTo(640, 4);
    expect(transform?.center.y).toBeCloseTo(360, 4);
    expect(transform?.widthPx).toBeCloseTo(256, 4);
    expect(transform?.heightPx).toBeCloseTo(288, 4);
    expect(transform?.depth).toBeGreaterThan(0);
  });

  it('uses the full shoulder and hip bounds for dynamic torso scale', () => {
    const normalizedLandmarks = buildNormalizedLandmarks();
    normalizedLandmarks[11] = { x: 0.46, y: 0.32, z: 0, visibility: 0.98 };
    normalizedLandmarks[12] = { x: 0.54, y: 0.32, z: 0, visibility: 0.98 };
    normalizedLandmarks[23] = { x: 0.28, y: 0.73, z: 0, visibility: 0.98 };
    normalizedLandmarks[24] = { x: 0.72, y: 0.73, z: 0, visibility: 0.98 };

    const poseFrame = createPoseFrame(normalizedLandmarks, buildWorldLandmarks(), 1000);
    const stageSize = { width: 1280, height: 720 };
    const coverLayout = getCoverLayout({ width: 1280, height: 720 }, stageSize);
    const transform = computeTorsoTransform(poseFrame, stageSize, coverLayout);

    expect(transform).not.toBeNull();
    expect(transform?.widthPx).toBeCloseTo(563.2, 4);
    expect(transform?.heightPx).toBeCloseTo(295.2, 4);
  });

  it('hides the shirt transform when required torso visibility is too low', () => {
    const normalizedLandmarks = buildNormalizedLandmarks();
    normalizedLandmarks[24] = { ...normalizedLandmarks[24], visibility: 0.1 };

    const poseFrame = createPoseFrame(normalizedLandmarks, buildWorldLandmarks(), 1000);
    const stageSize = { width: 1280, height: 720 };
    const coverLayout = getCoverLayout({ width: 1280, height: 720 }, stageSize);

    expect(computeTorsoTransform(poseFrame, stageSize, coverLayout)).toBeNull();
  });

  it('keeps torso roll upright when mirrored camera semantics place the left shoulder on the right side', () => {
    const normalizedLandmarks = buildNormalizedLandmarks();
    normalizedLandmarks[11] = { x: 0.61, y: 0.3, z: 0, visibility: 0.98 };
    normalizedLandmarks[12] = { x: 0.39, y: 0.31, z: 0, visibility: 0.98 };
    normalizedLandmarks[23] = { x: 0.58, y: 0.7, z: 0, visibility: 0.98 };
    normalizedLandmarks[24] = { x: 0.42, y: 0.69, z: 0, visibility: 0.98 };

    const poseFrame = createPoseFrame(normalizedLandmarks, buildWorldLandmarks(), 1000);
    const stageSize = { width: 1280, height: 720 };
    const coverLayout = getCoverLayout({ width: 1280, height: 720 }, stageSize);
    const transform = computeTorsoTransform(poseFrame, stageSize, coverLayout);

    expect(transform).not.toBeNull();

    const roll = new Euler().setFromQuaternion(transform!.rotation).z;
    expect(Math.abs(roll)).toBeLessThan(Math.PI / 4);
  });
});

describe('rig pose', () => {
  it('computes mirrored arm lift angles relative to the torso roll', () => {
    const poseFrame = createPoseFrame(buildNormalizedLandmarks(), buildWorldLandmarks(), 1000);
    const stageSize = { width: 1280, height: 720 };
    const coverLayout = getCoverLayout({ width: 1280, height: 720 }, stageSize);
    const torsoTransform = computeTorsoTransform(poseFrame, stageSize, coverLayout);
    const rigPose = computeRigPose(poseFrame, torsoTransform, stageSize, coverLayout);

    expect(rigPose).not.toBeNull();
    expect(rigPose?.leftArmZRotation).toBeCloseTo(-0.763038, 4);
    expect(rigPose?.rightArmZRotation).toBeCloseTo(-2.378555, 4);
    expect(rigPose?.torsoRoll).toBeCloseTo(0, 4);
  });

  it('keeps sleeve rotation centered on the shoulder-elbow line when the wrist bends', () => {
    const normalizedLandmarks = buildNormalizedLandmarks();
    normalizedLandmarks[11] = { x: 0.4, y: 0.4, z: 0, visibility: 0.98 };
    normalizedLandmarks[13] = { x: 0.34, y: 0.22, z: 0, visibility: 0.98 };
    normalizedLandmarks[15] = { x: 0.47, y: 0.08, z: 0, visibility: 0.98 };

    const bentWrist = buildNormalizedLandmarks();
    bentWrist[11] = normalizedLandmarks[11];
    bentWrist[13] = normalizedLandmarks[13];
    bentWrist[15] = { x: 0.22, y: 0.08, z: 0, visibility: 0.98 };

    const worldLandmarks = buildWorldLandmarks();
    const stageSize = { width: 1280, height: 720 };
    const coverLayout = getCoverLayout({ width: 1280, height: 720 }, stageSize);
    const torsoTransform = computeTorsoTransform(
      createPoseFrame(normalizedLandmarks, worldLandmarks, 1000),
      stageSize,
      coverLayout
    );
    const straightWristPose = computeRigPose(
      createPoseFrame(normalizedLandmarks, worldLandmarks, 1000),
      torsoTransform,
      stageSize,
      coverLayout
    );
    const bentWristPose = computeRigPose(
      createPoseFrame(bentWrist, worldLandmarks, 1000),
      torsoTransform,
      stageSize,
      coverLayout
    );

    expect(straightWristPose?.leftArmZRotation).not.toBeNull();
    expect(bentWristPose?.leftArmZRotation).not.toBeNull();
    expect(bentWristPose!.leftArmZRotation!).toBeCloseTo(straightWristPose!.leftArmZRotation!, 6);
  });

  it('returns null arm rotations when the arm landmarks are not visible', () => {
    const normalizedLandmarks = buildNormalizedLandmarks();
    normalizedLandmarks[13] = { ...normalizedLandmarks[13], visibility: 0.1 };

    const poseFrame = createPoseFrame(normalizedLandmarks, buildWorldLandmarks(), 1000);
    const stageSize = { width: 1280, height: 720 };
    const coverLayout = getCoverLayout({ width: 1280, height: 720 }, stageSize);
    const torsoTransform = computeTorsoTransform(poseFrame, stageSize, coverLayout);
    const rigPose = computeRigPose(poseFrame, torsoTransform, stageSize, coverLayout);

    expect(rigPose).not.toBeNull();
    expect(rigPose?.leftArmZRotation).toBeNull();
    expect(rigPose?.rightArmZRotation).not.toBeNull();
  });
});
