import { Quaternion, Vector3 } from 'three'
import type { SleeveTransform } from '@/lib/mirror/types'

const SLEEVE_RENDER_TWIST = Math.PI

export function applySleeveRenderTwist(transform: SleeveTransform): SleeveTransform {
  return {
    ...transform,
    rotation: transform.rotation
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), SLEEVE_RENDER_TWIST)),
  }
}
