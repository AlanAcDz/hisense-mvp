import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Bone,
  BoxGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
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

    expect(loadResult).toEqual({ errorMessage: null, usedFallback: false });
    expect((controller as any).leftArmControl).toBeTruthy();
    expect((controller as any).rightArmControl).toBeTruthy();
    expect((controller as any).leftArmControl.bone.name).toBe('right_shouler');
    expect((controller as any).rightArmControl.bone.name).toBe('left_shoulder');
  });

  it('normalizes the loaded model root to the named anchor basis', async () => {
    loaderLoadAsync.mockResolvedValueOnce({ scene: createRiggedScene() });

    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController();
    await controller.loadShirtModel();

    const modelAnchors = (controller as any).modelAnchors as {
      leftShoulder: Vector3;
      rightShoulder: Vector3;
      leftHip: Vector3;
      rightHip: Vector3;
    } | null;
    const shoulderCenter = modelAnchors!.leftShoulder
      .clone()
      .add(modelAnchors!.rightShoulder)
      .multiplyScalar(0.5);
    const hipCenter = modelAnchors!.leftHip
      .clone()
      .add(modelAnchors!.rightHip)
      .multiplyScalar(0.5);

    expect(modelAnchors).toBeTruthy();
    expect(modelAnchors!.leftShoulder.y).toBeCloseTo(modelAnchors!.rightShoulder.y, 6);
    expect(hipCenter.x).toBeCloseTo(shoulderCenter.x, 6);
    expect(hipCenter.y).toBeLessThan(shoulderCenter.y);
  });

  it('centers rigged models from named torso anchors instead of mesh bounds', async () => {
    loaderLoadAsync.mockResolvedValueOnce({
      scene: createRiggedScene({ geometryOffsetY: -1000 }),
    });

    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController();
    await controller.loadShirtModel();

    const modelAnchors = (controller as any).modelAnchors as {
      torsoCenter: Vector3;
    } | null;

    expect(modelAnchors).toBeTruthy();
    expect(modelAnchors!.torsoCenter.length()).toBeLessThan(1e-6);
  });

  it('fits named model anchors to the detected torso points', async () => {
    loaderLoadAsync.mockResolvedValueOnce({ scene: createRiggedScene() });

    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController({
      ...SHIRT_CALIBRATION,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      xOffset: 0,
      yOffset: 0,
      zOffset: 0,
      depthScale: 0,
      baseRotation: { x: 0, y: 0, z: 0 },
    });
    await controller.loadShirtModel();
    controller.resize({ width: 1000, height: 800 });

    const transform = {
      center: { x: 580, y: 420 },
      topCenter: { x: 580, y: 220 },
      bottomCenter: { x: 580, y: 620 },
      anchors: {
        leftShoulder: { x: 400, y: 220 },
        rightShoulder: { x: 760, y: 220 },
        leftHip: { x: 436, y: 620 },
        rightHip: { x: 724, y: 620 },
        leftArm: { x: 260, y: 340 },
        rightArm: { x: 900, y: 340 },
      },
      widthPx: 360,
      heightPx: 400,
      depth: 0,
      rotation: new Quaternion(),
    };

    for (let index = 0; index < 30; index += 1) {
      controller.updateShirtTransform(transform);
    }
    (controller as any).shirtAnchor.updateWorldMatrix(true, true);

    const anchor = (controller as any).shirtAnchor as Group;
    const cameraZoom = (controller as any).camera.zoom as number;
    const modelAnchors = (controller as any).modelAnchors as {
      leftShoulder: Vector3;
      rightShoulder: Vector3;
      leftHip: Vector3;
      rightHip: Vector3;
      leftArm: Vector3 | null;
      rightArm: Vector3 | null;
    };

    expect(modelAnchors.leftArm).toBeTruthy();
    expect(modelAnchors.rightArm).toBeTruthy();
    expect(projectAnchorPoint(anchor, modelAnchors.leftShoulder, cameraZoom).distanceTo(screenToWorld(transform.anchors.leftShoulder))).toBeLessThan(1);
    expect(projectAnchorPoint(anchor, modelAnchors.rightShoulder, cameraZoom).distanceTo(screenToWorld(transform.anchors.rightShoulder))).toBeLessThan(1);
    expect(projectAnchorPoint(anchor, modelAnchors.leftHip, cameraZoom).distanceTo(screenToWorld(transform.anchors.leftHip))).toBeLessThan(16);
    expect(projectAnchorPoint(anchor, modelAnchors.rightHip, cameraZoom).distanceTo(screenToWorld(transform.anchors.rightHip))).toBeLessThan(16);
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
        torsoRoll: 0,
      });
    }

    expect(leftBone.quaternion.angleTo(leftBind)).toBeGreaterThan(0.1);
    expect(rightBone.quaternion.angleTo(rightBind)).toBeGreaterThan(0.1);
  });

  it('keeps the sleeve bone aligned to the requested screen angle under non-uniform torso scale', async () => {
    loaderLoadAsync.mockResolvedValueOnce({ scene: createRiggedScene() });

    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController(SHIRT_CALIBRATION, {
      leftArmZRotationOffset: 0,
      rightArmZRotationOffset: 0,
    });
    await controller.loadShirtModel();

    const anchor = (controller as any).shirtAnchor as Group;
    const scale = new Vector3(2.4, 1, 1);
    const roll = 0.35;
    const targetScreenAngle = 0.12;
    anchor.scale.copy(scale);
    anchor.quaternion.setFromEuler(new Euler(0, 0, roll));
    (controller as any).currentScale.copy(scale);
    (controller as any).currentRotation.copy(anchor.quaternion);

    for (let index = 0; index < 50; index += 1) {
      controller.updateRigPose({
        leftArmZRotation: targetScreenAngle,
        rightArmZRotation: null,
        torsoRoll: roll,
      });
    }

    const control = (controller as any).leftArmControl as {
      bone: Bone;
      childBone: Bone;
      bindQuaternion: Quaternion;
      restAngle: number;
      axisSign: 1 | -1;
    };
    const rotationDelta = control.bindQuaternion.clone().invert().multiply(control.bone.quaternion);
    const localArmAngle =
      control.restAngle + new Euler().setFromQuaternion(rotationDelta).z * control.axisSign;
    const scaledDirection = new Vector3(
      Math.cos(localArmAngle) * scale.x,
      Math.sin(localArmAngle) * scale.y,
      0
    ).applyQuaternion(anchor.quaternion);
    const screenAngle = Math.atan2(
      scaledDirection.y,
      scaledDirection.x
    );

    expect(screenAngle).toBeCloseTo(targetScreenAngle, 2);
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

function createRiggedScene({ geometryOffsetY = 0 } = {}) {
  const root = new Bone();
  root.name = 'root';

  const chest = new Bone();
  chest.name = 'chest';
  chest.position.set(0, 2, 0);
  root.add(chest);

  const leftJoint = new Bone();
  leftJoint.name = 'joint6';
  leftJoint.position.set(-1, 0.2, 0);
  chest.add(leftJoint);

  const leftShoulder = new Bone();
  leftShoulder.name = 'left_shoulder';
  leftShoulder.position.set(-1, -0.2, 0);
  leftJoint.add(leftShoulder);

  const leftArm = new Bone();
  leftArm.name = 'left_arm';
  leftArm.position.set(-3, -1, 0);
  leftShoulder.add(leftArm);

  const rightJoint = new Bone();
  rightJoint.name = 'joint10';
  rightJoint.position.set(1, 0.2, 0);
  chest.add(rightJoint);

  const rightShoulder = new Bone();
  rightShoulder.name = 'right_shouler';
  rightShoulder.position.set(1, -0.2, 0);
  rightJoint.add(rightShoulder);

  const rightArm = new Bone();
  rightArm.name = 'right_arm';
  rightArm.position.set(3, -1, 0);
  rightShoulder.add(rightArm);

  const leftHip = new Bone();
  leftHip.name = 'left_hip';
  leftHip.position.set(-1.6, 4.4, 0);
  root.add(leftHip);

  const rightHip = new Bone();
  rightHip.name = 'right_hip';
  rightHip.position.set(1.6, 4.4, 0);
  root.add(rightHip);

  const skeleton = new Skeleton([
    root,
    chest,
    leftJoint,
    leftShoulder,
    leftArm,
    rightJoint,
    rightShoulder,
    rightArm,
    leftHip,
    rightHip,
  ]);
  const geometry = new BoxGeometry(10, 10, 10);
  if (geometryOffsetY !== 0) {
    geometry.translate(0, geometryOffsetY, 0);
  }
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

function screenToWorld(point: { x: number; y: number }) {
  return new Vector3(500 - point.x, 400 - point.y, 0);
}

function projectAnchorPoint(anchor: Object3D, localPoint: Vector3, cameraZoom = 1) {
  return localPoint
    .clone()
    .multiply(anchor.scale)
    .applyQuaternion(anchor.quaternion)
    .add(anchor.position)
    .multiplyScalar(cameraZoom);
}
