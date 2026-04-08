import { Quaternion, Vector3 } from 'three'
import { applySleeveRenderTwist } from '@/lib/mirror/sleeve-render'

describe('applySleeveRenderTwist', () => {
  it('preserves the sleeve axis while flipping the local right axis', () => {
    const baseRotation = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      new Vector3(0.4, -0.9, 0).normalize(),
    )

    const twisted = applySleeveRenderTwist({
      center: { x: 0, y: 0 },
      lengthPx: 100,
      shoulderWidthPx: 30,
      elbowWidthPx: 24,
      rotation: baseRotation,
    })

    const baseUp = new Vector3(0, 1, 0).applyQuaternion(baseRotation).normalize()
    const twistedUp = new Vector3(0, 1, 0).applyQuaternion(twisted.rotation).normalize()
    const baseRight = new Vector3(1, 0, 0).applyQuaternion(baseRotation).normalize()
    const twistedRight = new Vector3(1, 0, 0).applyQuaternion(twisted.rotation).normalize()

    expect(twistedUp.angleTo(baseUp)).toBeLessThan(1e-6)
    expect(twistedRight.angleTo(baseRight.clone().multiplyScalar(-1))).toBeLessThan(1e-6)
  })
})
