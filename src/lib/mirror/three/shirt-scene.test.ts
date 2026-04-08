import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Euler, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { SHIRT_CALIBRATION, SLEEVE_CALIBRATION } from '@/lib/mirror/constants';

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

  it('applies the sleeve calibration rotation to the loaded sleeve models', async () => {
    const torsoScene = new Group();
    torsoScene.add(createNamedMesh('torso', 0));

    const sleevesScene = new Group();
    sleevesScene.add(createNamedMesh('left-sleeve', -20));
    sleevesScene.add(createNamedMesh('right-sleeve', 20));

    loaderLoadAsync.mockResolvedValueOnce(torsoScene).mockResolvedValueOnce(sleevesScene);

    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController();

    const loadResult = await controller.loadShirtModel();

    const leftSleeveRoot = (controller as any).leftSleeveModelRoot as Group | null;
    const leftSleeveSize = (controller as any).leftSleeveModelSize as { x: number; y: number };
    const rightSleeveRoot = (controller as any).rightSleeveModelRoot as Group | null;
    const rightSleeveSize = (controller as any).rightSleeveModelSize as { x: number; y: number };
    const expectedRotation = new Quaternion().setFromEuler(new Euler(Math.PI, 0, 0));
    const expectedPivotX = leftSleeveSize.x * (0.5 + SLEEVE_CALIBRATION.lineOffset);

    expect(loadResult.usedFallback).toBe(false);
    expect(leftSleeveRoot).toBeTruthy();
    expect(rightSleeveRoot).toBeTruthy();
    expect(leftSleeveRoot?.quaternion.angleTo(expectedRotation)).toBeLessThan(1e-6);
    expect(rightSleeveRoot?.quaternion.angleTo(expectedRotation)).toBeLessThan(1e-6);
    expect(leftSleeveRoot?.position.x).toBeCloseTo(-expectedPivotX, 6);
    expect(leftSleeveRoot?.position.y).toBeCloseTo(leftSleeveSize.y / 2, 6);
    expect(rightSleeveRoot?.position.x).toBeCloseTo(expectedPivotX, 6);
    expect(rightSleeveRoot?.position.y).toBeCloseTo(rightSleeveSize.y / 2, 6);
  });

  it('keeps the loaded torso model facing forward with the default calibration', async () => {
    const torsoScene = new Group();
    torsoScene.add(createNamedMesh('torso', 0));

    const sleevesScene = new Group();
    sleevesScene.add(createNamedMesh('left-sleeve', -20));
    sleevesScene.add(createNamedMesh('right-sleeve', 20));

    loaderLoadAsync.mockResolvedValueOnce(torsoScene).mockResolvedValueOnce(sleevesScene);

    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController();

    const loadResult = await controller.loadShirtModel();

    const torsoModelRoot = (controller as any).modelRoot as Group | null;
    const expectedRotation = new Quaternion().setFromEuler(
      new Euler(
        SHIRT_CALIBRATION.baseRotation.x,
        SHIRT_CALIBRATION.baseRotation.y,
        SHIRT_CALIBRATION.baseRotation.z
      )
    );

    expect(loadResult.usedFallback).toBe(false);
    expect(torsoModelRoot).toBeTruthy();
    expect(torsoModelRoot?.quaternion.angleTo(expectedRotation)).toBeLessThan(1e-6);
  });

  it('positions sleeve anchors at the computed sleeve top so the mesh can pivot from the shoulder edge', async () => {
    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController(undefined, {
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      xOffset: 0.4,
      yOffset: 0.7,
      lineOffset: 0,
      zOffset: 0,
      baseRotation: { x: 0, y: 0, z: 0 },
    });
    await loadMockModels(controller);

    controller.resize({ width: 200, height: 200 });
    const sleeve = {
      center: { x: 80, y: 120 },
      lengthPx: 80,
      shoulderWidthPx: 60,
      elbowWidthPx: 50,
      rotation: new Quaternion(),
    };
    for (let iteration = 0; iteration < 12; iteration += 1) {
      controller.updateSleeves(sleeve, null);
    }

    const leftSleeveAnchor = (controller as any).leftSleeveAnchor as Group;
    const leftSleeveReferenceOffset = (controller as any).leftSleeveReferenceOffset as Vector3;
    const expectedReferenceX = 200 / 2 - 80;
    const expectedReferenceY = 200 / 2 - 120;
    const referencePoint = getSleeveReferencePoint(leftSleeveAnchor, leftSleeveReferenceOffset);

    expect(referencePoint.x).toBeCloseTo(expectedReferenceX, 2);
    expect(referencePoint.y).toBeCloseTo(expectedReferenceY, 2);
  });

  it('uses the default sleeve calibration for scale without extra screen-space drift', async () => {
    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController();
    await loadMockModels(controller);

    controller.resize({ width: 200, height: 200 });
    const sleeve = {
      center: { x: 100, y: 100 },
      lengthPx: 80,
      shoulderWidthPx: 60,
      elbowWidthPx: 50,
      rotation: new Quaternion(),
    };
    for (let iteration = 0; iteration < 12; iteration += 1) {
      controller.updateSleeves(sleeve, null);
    }

    const leftSleeveAnchor = (controller as any).leftSleeveAnchor as Group;
    const leftSleeveReferenceOffset = (controller as any).leftSleeveReferenceOffset as Vector3;
    const leftSleeveModelSize = (controller as any).leftSleeveModelSize as Vector3;
    const sleeveWidth = (60 + 50) / 2;
    const expectedScaleX = (sleeveWidth / leftSleeveModelSize.x) * SLEEVE_CALIBRATION.scaleX;
    const expectedScaleY = (80 / leftSleeveModelSize.y) * SLEEVE_CALIBRATION.scaleY;
    const expectedScaleZ = (sleeveWidth / leftSleeveModelSize.z) * SLEEVE_CALIBRATION.scaleZ;
    const referencePoint = getSleeveReferencePoint(leftSleeveAnchor, leftSleeveReferenceOffset);

    expect(referencePoint.x).toBeCloseTo(0, 2);
    expect(referencePoint.y).toBeCloseTo(0, 2);
    expect(leftSleeveAnchor.scale.x).toBeCloseTo(expectedScaleX, 2);
    expect(leftSleeveAnchor.scale.y).toBeCloseTo(expectedScaleY, 2);
    expect(leftSleeveAnchor.scale.z).toBeCloseTo(expectedScaleZ, 2);
  });

  it('keeps the tracked sleeve point aligned while the pivot moves around it during rotation', async () => {
    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController(undefined, {
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      xOffset: 0,
      yOffset: 0,
      lineOffset: 0,
      zOffset: 0,
      baseRotation: { x: 0, y: 0, z: 0 },
    });
    await loadMockModels(controller);

    controller.resize({ width: 200, height: 200 });

    const baseSleeve = {
      center: { x: 100, y: 100 },
      lengthPx: 1,
      shoulderWidthPx: 1,
      elbowWidthPx: 1,
      rotation: new Quaternion(),
    };

    for (let iteration = 0; iteration < 12; iteration += 1) {
      controller.updateSleeves(baseSleeve, null);
    }

    const leftSleeveAnchor = (controller as any).leftSleeveAnchor as Group;
    const leftSleeveReferenceOffset = (controller as any).leftSleeveReferenceOffset as Vector3;
    const anchorPositionBeforeRotation = leftSleeveAnchor.position.clone();
    const referenceBeforeRotation = getSleeveReferencePoint(leftSleeveAnchor, leftSleeveReferenceOffset);

    controller.updateSleeves(
      {
        ...baseSleeve,
        rotation: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2),
      },
      null
    );
    for (let iteration = 0; iteration < 11; iteration += 1) {
      controller.updateSleeves(
        {
          ...baseSleeve,
          rotation: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2),
        },
        null
      );
    }

    const referenceAfterRotation = getSleeveReferencePoint(leftSleeveAnchor, leftSleeveReferenceOffset);

    expect(leftSleeveAnchor.quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.1);
    expect(referenceAfterRotation.distanceTo(referenceBeforeRotation)).toBeLessThan(1e-4);
    expect(leftSleeveAnchor.position.distanceTo(anchorPositionBeforeRotation)).toBeGreaterThan(0.1);
  });
});

function createNamedMesh(name: string, x: number) {
  const mesh = new Mesh(new BoxGeometry(10, 10, 10), new MeshBasicMaterial());
  mesh.name = name;
  mesh.position.set(x, 0, 0);
  return mesh;
}

async function loadMockModels(controller: { loadShirtModel: () => Promise<unknown> }) {
  const torsoScene = new Group();
  torsoScene.add(createNamedMesh('torso', 0));

  const sleevesScene = new Group();
  sleevesScene.add(createNamedMesh('left-sleeve', -20));
  sleevesScene.add(createNamedMesh('right-sleeve', 20));

  loaderLoadAsync.mockResolvedValueOnce(torsoScene).mockResolvedValueOnce(sleevesScene);
  await controller.loadShirtModel();
}

function getSleeveReferencePoint(anchor: Group, referenceOffset: Vector3) {
  return anchor.position
    .clone()
    .add(referenceOffset.clone().multiply(anchor.scale).applyQuaternion(anchor.quaternion));
}
