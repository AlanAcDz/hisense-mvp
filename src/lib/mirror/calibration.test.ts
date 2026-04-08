import { Quaternion, Vector3 } from 'three'
import {
  buildCalibrationPreviewScene,
  cloneShirtCalibration,
  cloneSleeveCalibration,
  DEFAULT_CALIBRATION_PREVIEW_POSE,
} from '@/lib/mirror/calibration'

describe('buildCalibrationPreviewScene', () => {
  const stageSize = { width: 960, height: 720 }

  it('keeps visible left and right sleeves on their matching sides', () => {
    const scene = buildCalibrationPreviewScene(stageSize, DEFAULT_CALIBRATION_PREVIEW_POSE)

    expect(scene).not.toBeNull()
    expect(scene!.overlay.leftShoulder.x).toBeLessThan(scene!.overlay.rightShoulder.x)
    expect(scene!.leftSleeveTransform.center.x).toBeGreaterThan(scene!.rightSleeveTransform.center.x)
  })

  it('applies the same shirt and sleeve offsets used by the live mirror helpers', () => {
    const neutralShirtCalibration = cloneShirtCalibration()
    neutralShirtCalibration.yOffset = 0

    const adjustedShirtCalibration = cloneShirtCalibration()
    adjustedShirtCalibration.yOffset = -0.2

    const neutralSleeveCalibration = cloneSleeveCalibration()
    neutralSleeveCalibration.xOffset = 0
    neutralSleeveCalibration.yOffset = 0

    const adjustedSleeveCalibration = cloneSleeveCalibration()
    adjustedSleeveCalibration.xOffset = 0.45
    adjustedSleeveCalibration.yOffset = 1

    const neutralScene = buildCalibrationPreviewScene(
      stageSize,
      DEFAULT_CALIBRATION_PREVIEW_POSE,
      neutralShirtCalibration,
      neutralSleeveCalibration,
    )
    const adjustedScene = buildCalibrationPreviewScene(
      stageSize,
      DEFAULT_CALIBRATION_PREVIEW_POSE,
      adjustedShirtCalibration,
      adjustedSleeveCalibration,
    )

    expect(neutralScene).not.toBeNull()
    expect(adjustedScene).not.toBeNull()
    expect(adjustedScene!.torsoTransform.center.y).toBeLessThan(neutralScene!.torsoTransform.center.y - 20)

    const leftSleeveShift = Math.hypot(
      adjustedScene!.leftSleeveTransform.center.x - neutralScene!.leftSleeveTransform.center.x,
      adjustedScene!.leftSleeveTransform.center.y - neutralScene!.leftSleeveTransform.center.y,
    )
    expect(leftSleeveShift).toBeGreaterThan(10)
  })

  it('moves the sleeve farther down the arm when the preview anchor ratio increases', () => {
    const neutralSleeveCalibration = cloneSleeveCalibration()
    neutralSleeveCalibration.xOffset = 0
    neutralSleeveCalibration.yOffset = 0

    const nearAnchorScene = buildCalibrationPreviewScene(
      stageSize,
      DEFAULT_CALIBRATION_PREVIEW_POSE,
      cloneShirtCalibration(),
      neutralSleeveCalibration,
      0.1,
    )
    const farAnchorScene = buildCalibrationPreviewScene(
      stageSize,
      DEFAULT_CALIBRATION_PREVIEW_POSE,
      cloneShirtCalibration(),
      neutralSleeveCalibration,
      0.4,
    )

    expect(nearAnchorScene).not.toBeNull()
    expect(farAnchorScene).not.toBeNull()
    expect(farAnchorScene!.leftSleeveTransform.center.x).toBeGreaterThan(
      nearAnchorScene!.leftSleeveTransform.center.x,
    )
    expect(farAnchorScene!.leftSleeveTransform.center.y).toBeGreaterThan(
      nearAnchorScene!.leftSleeveTransform.center.y,
    )
  })

  it('adds the shared render twist without changing the sleeve axis', () => {
    const scene = buildCalibrationPreviewScene(stageSize, DEFAULT_CALIBRATION_PREVIEW_POSE)

    expect(scene).not.toBeNull()

    const shoulder = {
      x: stageSize.width - scene!.overlay.leftShoulder.x,
      y: scene!.overlay.leftShoulder.y,
    }
    const elbow = {
      x: stageSize.width - scene!.overlay.leftElbow.x,
      y: scene!.overlay.leftElbow.y,
    }
    const armDirection = new Vector3(elbow.x - shoulder.x, elbow.y - shoulder.y, 0).normalize()
    const shoulderDirection = armDirection.clone().multiplyScalar(-1)
    const untwistedRotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), shoulderDirection)

    const untwistedUp = new Vector3(0, 1, 0).applyQuaternion(untwistedRotation).normalize()
    const previewUp = new Vector3(0, 1, 0).applyQuaternion(scene!.leftSleeveTransform.rotation).normalize()
    const untwistedRight = new Vector3(1, 0, 0).applyQuaternion(untwistedRotation).normalize()
    const previewRight = new Vector3(1, 0, 0).applyQuaternion(scene!.leftSleeveTransform.rotation).normalize()

    expect(previewUp.angleTo(untwistedUp)).toBeLessThan(1e-6)
    expect(previewRight.angleTo(untwistedRight.clone().multiplyScalar(-1))).toBeLessThan(1e-6)
  })
})
