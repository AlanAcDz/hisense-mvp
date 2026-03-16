import {
  type Vector2,
  BufferGeometry,
  ExtrudeGeometry,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshStandardMaterial,
  Shape,
  Vector3,
} from 'three';

export function createProxyShirtGroup() {
  const shape = new Shape();
  shape.moveTo(-0.9, 1.05);
  shape.lineTo(-1.22, 0.58);
  shape.lineTo(-0.94, 0.1);
  shape.lineTo(-0.55, 0.33);
  shape.lineTo(-0.46, -1.36);
  shape.lineTo(0.46, -1.36);
  shape.lineTo(0.55, 0.33);
  shape.lineTo(0.94, 0.1);
  shape.lineTo(1.22, 0.58);
  shape.lineTo(0.9, 1.05);
  shape.lineTo(0.38, 0.85);
  shape.lineTo(0.16, 0.52);
  shape.lineTo(-0.16, 0.52);
  shape.lineTo(-0.38, 0.85);
  shape.closePath();

  const collar = new Shape();
  collar.moveTo(-0.22, 0.8);
  collar.absellipse(0, 0.84, 0.28, 0.19, Math.PI, 0, true);
  shape.holes.push(collar);

  const geometry = new ExtrudeGeometry(shape, {
    depth: 0.18,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -0.09);

  const bodyMaterial = new MeshStandardMaterial({
    color: 0x1bb3ff,
    roughness: 0.62,
    metalness: 0.08,
  });

  const shirtMesh = new Mesh(geometry, bodyMaterial);

  const outlinePoints = shape
    .getPoints(32)
    .map((point: Vector2) => new Vector3(point.x, point.y, 0.11));
  const outline = new LineLoop(
    new BufferGeometry().setFromPoints(outlinePoints),
    new LineBasicMaterial({ color: 0xb7efff, transparent: true, opacity: 0.55 })
  );

  const group = new Group();
  group.add(shirtMesh);
  group.add(outline);

  return group;
}
