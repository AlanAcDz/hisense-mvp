import {
  buildCalibrationPreviewScene,
  cloneRigCalibration,
  cloneShirtCalibration,
  DEFAULT_CALIBRATION_PREVIEW_POSE,
} from '@/lib/mirror/calibration'

describe('buildCalibrationPreviewScene', () => {
  const stageSize = { width: 960, height: 720 }

  it('keeps visible left and right arms on their matching sides', () => {
    const scene = buildCalibrationPreviewScene(stageSize, DEFAULT_CALIBRATION_PREVIEW_POSE)

    expect(scene).not.toBeNull()
    expect(scene!.overlay.leftShoulder.x).toBeLessThan(scene!.overlay.rightShoulder.x)
    expect(scene!.rigPose.leftArmZRotation).not.toBeNull()
    expect(scene!.rigPose.rightArmZRotation).not.toBeNull()
    expect(scene!.rigPose.leftArmZRotation!).toBeGreaterThan(scene!.rigPose.rightArmZRotation!)
  })

  it('applies the same shirt root offsets used by the live mirror helpers', () => {
    const neutralShirtCalibration = cloneShirtCalibration()
    neutralShirtCalibration.yOffset = 0

    const adjustedShirtCalibration = cloneShirtCalibration()
    adjustedShirtCalibration.yOffset = -0.2

    const neutralScene = buildCalibrationPreviewScene(
      stageSize,
      DEFAULT_CALIBRATION_PREVIEW_POSE,
      neutralShirtCalibration,
    )
    const adjustedScene = buildCalibrationPreviewScene(
      stageSize,
      DEFAULT_CALIBRATION_PREVIEW_POSE,
      adjustedShirtCalibration,
    )

    expect(neutralScene).not.toBeNull()
    expect(adjustedScene).not.toBeNull()
    expect(adjustedScene!.torsoTransform.center.y).toBeLessThan(neutralScene!.torsoTransform.center.y - 20)
  })

  it('changes the generated rig pose when the preview arm angles change', () => {
    const loweredArms = {
      ...DEFAULT_CALIBRATION_PREVIEW_POSE,
      leftArmAngleDeg: 145,
      rightArmAngleDeg: 35,
    }
    const raisedArms = {
      ...DEFAULT_CALIBRATION_PREVIEW_POSE,
      leftArmAngleDeg: 190,
      rightArmAngleDeg: -10,
    }

    const loweredScene = buildCalibrationPreviewScene(stageSize, loweredArms)
    const raisedScene = buildCalibrationPreviewScene(stageSize, raisedArms)

    expect(loweredScene).not.toBeNull()
    expect(raisedScene).not.toBeNull()
    expect(raisedScene!.rigPose.leftArmZRotation).not.toBe(loweredScene!.rigPose.leftArmZRotation)
    expect(raisedScene!.rigPose.rightArmZRotation).not.toBe(loweredScene!.rigPose.rightArmZRotation)
  })

  it('copies rig calibration values independently', () => {
    const rigCalibration = cloneRigCalibration()
    rigCalibration.leftArmZRotationOffset = 0.25

    const copy = cloneRigCalibration(rigCalibration)
    copy.leftArmZRotationOffset = -0.5

    expect(rigCalibration.leftArmZRotationOffset).toBe(0.25)
  })
})
