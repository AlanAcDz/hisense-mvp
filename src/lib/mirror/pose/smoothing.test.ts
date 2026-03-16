import { Quaternion, Vector3 } from 'three';
import { smoothNumber, smoothQuaternion, smoothVector3 } from '@/lib/mirror/pose/smoothing';

describe('smoothing helpers', () => {
  it('smooths numbers toward the target without overshooting', () => {
    expect(smoothNumber(0, 10, 0.25)).toBeCloseTo(2.5, 5);
    expect(smoothNumber(8, 10, 0.5)).toBeCloseTo(9, 5);
  });

  it('smooths vectors toward the target', () => {
    const smoothed = smoothVector3(new Vector3(0, 0, 0), new Vector3(10, -10, 4), 0.2);

    expect(smoothed.x).toBeCloseTo(2, 5);
    expect(smoothed.y).toBeCloseTo(-2, 5);
    expect(smoothed.z).toBeCloseTo(0.8, 5);
  });

  it('smooths quaternions without freezing orientation changes', () => {
    const start = new Quaternion();
    const target = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const smoothed = smoothQuaternion(start, target, 0.5);

    expect(start.angleTo(smoothed)).toBeGreaterThan(0);
    expect(smoothed.angleTo(target)).toBeLessThan(start.angleTo(target));
  });
});
