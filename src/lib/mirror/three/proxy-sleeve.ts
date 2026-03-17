import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';

export function createProxySleeveGroup() {
  const geometry = new CylinderGeometry(0.5, 0.35, 1, 12, 1, false);

  const material = new MeshStandardMaterial({
    color: 0x1bb3ff,
    roughness: 0.62,
    metalness: 0.08,
  });

  const mesh = new Mesh(geometry, material);
  const group = new Group();
  group.add(mesh);

  return group;
}
