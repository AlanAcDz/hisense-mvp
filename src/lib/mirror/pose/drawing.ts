import { LANDMARK_INDICES, POSE_CONNECTIONS } from '@/lib/mirror/constants';
import { mapNormalizedToStagePoint } from '@/lib/mirror/pose/torso';
import type { PoseFrame, StageSize } from '@/lib/mirror/types';
import type { CoverLayout } from '@/lib/mirror/types';

const TORSO_COLOR = '#56d8ff';
const LIMB_COLOR = 'rgba(255,255,255,0.72)';
const FACE_COLOR = 'rgba(255, 200, 95, 0.9)';

export function drawPoseOverlay(
  ctx: CanvasRenderingContext2D,
  poseFrame: PoseFrame | null,
  stageSize: StageSize,
  coverLayout: CoverLayout,
  showPosePoints: boolean
) {
  ctx.clearRect(0, 0, stageSize.width, stageSize.height);

  if (!showPosePoints || !poseFrame) {
    return;
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const [startIndex, endIndex] of POSE_CONNECTIONS) {
    const start = poseFrame.normalizedLandmarks[startIndex];
    const end = poseFrame.normalizedLandmarks[endIndex];
    if (!start || !end) {
      continue;
    }

    const startPoint = mapNormalizedToStagePoint(start, stageSize, coverLayout);
    const endPoint = mapNormalizedToStagePoint(end, stageSize, coverLayout);
    const isTorsoEdge =
      (startIndex === LANDMARK_INDICES.leftShoulder && endIndex === LANDMARK_INDICES.rightShoulder) ||
      (startIndex === LANDMARK_INDICES.leftShoulder && endIndex === LANDMARK_INDICES.leftHip) ||
      (startIndex === LANDMARK_INDICES.rightShoulder && endIndex === LANDMARK_INDICES.rightHip) ||
      (startIndex === LANDMARK_INDICES.leftHip && endIndex === LANDMARK_INDICES.rightHip);

    ctx.strokeStyle = isTorsoEdge ? TORSO_COLOR : LIMB_COLOR;
    ctx.lineWidth = isTorsoEdge ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(startPoint.x, startPoint.y);
    ctx.lineTo(endPoint.x, endPoint.y);
    ctx.stroke();
  }

  poseFrame.normalizedLandmarks.forEach((landmark, index) => {
    const point = mapNormalizedToStagePoint(landmark, stageSize, coverLayout);
    const isTorsoPoint = Object.values(LANDMARK_INDICES).includes(index as 11 | 12 | 23 | 24);
    ctx.fillStyle = isTorsoPoint ? TORSO_COLOR : index < 11 ? FACE_COLOR : '#ffffff';
    ctx.beginPath();
    ctx.arc(point.x, point.y, isTorsoPoint ? 6 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
}
