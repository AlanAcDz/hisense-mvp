import { Quaternion, Vector3 } from 'three';

export function smoothNumber(previous: number, target: number, alpha: number) {
  return previous + (target - previous) * alpha;
}

export function smoothVector3(previous: Vector3, target: Vector3, alpha: number) {
  return previous.clone().lerp(target, alpha);
}

export function smoothQuaternion(previous: Quaternion, target: Quaternion, alpha: number) {
  return previous.clone().slerp(target, alpha);
}
