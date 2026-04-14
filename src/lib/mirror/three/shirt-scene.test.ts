import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Bone,
  BoxGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  MeshBasicMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from 'three';
import { SHIRT_CALIBRATION } from '@/lib/mirror/constants';

const rendererRender = vi.fn();
const loaderLoadAsync = vi.fn();

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');

  class MockWebGLRenderer {
    domElement = document.createElement('canvas');

    setClearColor() {}

    setPixelRatio() {}

    setSize() {}

    dispose() {}

    render(...args: unknown[]) {
      rendererRender(...args);
    }
  }

  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

vi.mock('three/examples/jsm/loaders/FBXLoader.js', () => {
  class MockFBXLoader {
    async loadAsync(url: string) {
      return loaderLoadAsync(url);
    }
  }

  return {
    FBXLoader: MockFBXLoader,
  };
});

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => {
  class MockGLTFLoader {
    async loadAsync(url: string) {
      return loaderLoadAsync(url);
    }
  }

  return {
    GLTFLoader: MockGLTFLoader,
  };
});

describe('ShirtSceneController', () => {
  beforeEach(() => {
    rendererRender.mockReset();
    loaderLoadAsync.mockReset();
  });

  it('loads a rigged garment and resolves arm controls from the skeleton', async () => {
    loaderLoadAsync.mockResolvedValueOnce({ scene: createRiggedScene() });

    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController();
    const loadResult = await controller.loadShirtModel();

    expect(loadResult.usedFallback).toBe(false);
    expect((controller as any).leftArmControl).toBeTruthy();
    expect((controller as any).rightArmControl).toBeTruthy();
  });

  it('keeps the loaded model root aligned with the default base rotation', async () => {
    loaderLoadAsync.mockResolvedValueOnce({ scene: createRiggedScene() });

    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController();
    await controller.loadShirtModel();

    const modelRoot = (controller as any).modelRoot as Group | null;
    const expectedRotation = new Quaternion().setFromEuler(
      new Euler(
        SHIRT_CALIBRATION.baseRotation.x,
        SHIRT_CALIBRATION.baseRotation.y,
        SHIRT_CALIBRATION.baseRotation.z
      )
    );

    expect(modelRoot).toBeTruthy();
    expect(modelRoot?.quaternion.angleTo(expectedRotation)).toBeLessThan(1e-6);
  });

  it('drives the arm bones from the rig pose instead of detached sleeve anchors', async () => {
    loaderLoadAsync.mockResolvedValueOnce({ scene: createRiggedScene() });

    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController();
    await controller.loadShirtModel();

    const leftBone = (controller as any).leftArmControl.bone as Bone;
    const rightBone = (controller as any).rightArmControl.bone as Bone;
    const leftBind = leftBone.quaternion.clone();
    const rightBind = rightBone.quaternion.clone();

    for (let index = 0; index < 12; index += 1) {
      controller.updateRigPose({
        leftArmZRotation: 1.8,
        rightArmZRotation: 0.5,
      });
    }

    expect(leftBone.quaternion.angleTo(leftBind)).toBeGreaterThan(0.1);
    expect(rightBone.quaternion.angleTo(rightBind)).toBeGreaterThan(0.1);
  });

  it('falls back to the proxy garment when the rigged asset cannot be loaded', async () => {
    loaderLoadAsync.mockRejectedValueOnce(new Error('load failed'));

    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController();
    const loadResult = await controller.loadShirtModel();

    expect(loadResult.usedFallback).toBe(true);
    expect(loadResult.errorMessage).toMatch(/proxy jersey/i);
  });
});

function createRiggedScene() {
  const root = new Bone();
  root.name = 'root';

  const chest = new Bone();
  chest.name = 'chest';
  chest.position.set(0, 2, 0);
  root.add(chest);

  const leftShoulder = new Bone();
  leftShoulder.name = 'left_shoulder';
  leftShoulder.position.set(-2, 0, 0);
  chest.add(leftShoulder);

  const leftArm = new Bone();
  leftArm.name = 'left_arm';
  leftArm.position.set(-3, -1, 0);
  leftShoulder.add(leftArm);

  const rightShoulder = new Bone();
  rightShoulder.name = 'right_shouler';
  rightShoulder.position.set(2, 0, 0);
  chest.add(rightShoulder);

  const rightArm = new Bone();
  rightArm.name = 'right_arm';
  rightArm.position.set(3, -1, 0);
  rightShoulder.add(rightArm);

  const skeleton = new Skeleton([root, chest, leftShoulder, leftArm, rightShoulder, rightArm]);
  const geometry = new BoxGeometry(10, 10, 10);
  const vertexCount = geometry.getAttribute('position').count;
  const skinIndices = new Uint16Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);

  for (let index = 0; index < vertexCount; index += 1) {
    skinIndices[index * 4] = 0;
    skinWeights[index * 4] = 1;
  }

  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeights, 4));

  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  mesh.bind(skeleton);

  const scene = new Group();
  scene.add(mesh);
  scene.add(root);
  return scene;
}
