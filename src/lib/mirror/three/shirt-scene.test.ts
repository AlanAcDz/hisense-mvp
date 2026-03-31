import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Euler, Group, Mesh, MeshBasicMaterial, Quaternion } from 'three';
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

    loaderLoadAsync
      .mockResolvedValueOnce({ scene: torsoScene })
      .mockResolvedValueOnce({ scene: sleevesScene });

    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController();

    await controller.loadShirtModel();

    const leftSleeveRoot = (controller as any).leftSleeveModelRoot as Group | null;
    const expectedRotation = new Quaternion().setFromEuler(new Euler(Math.PI, 0, 0));

    expect(leftSleeveRoot).toBeTruthy();
    expect(leftSleeveRoot?.quaternion.angleTo(expectedRotation)).toBeLessThan(1e-6);
  });

  it('keeps the loaded torso model facing forward with the default calibration', async () => {
    const torsoScene = new Group();
    torsoScene.add(createNamedMesh('torso', 0));

    const sleevesScene = new Group();
    sleevesScene.add(createNamedMesh('left-sleeve', -20));
    sleevesScene.add(createNamedMesh('right-sleeve', 20));

    loaderLoadAsync
      .mockResolvedValueOnce({ scene: torsoScene })
      .mockResolvedValueOnce({ scene: sleevesScene });

    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController();

    await controller.loadShirtModel();

    const torsoModelRoot = (controller as any).modelRoot as Group | null;
    const expectedRotation = new Quaternion().setFromEuler(
      new Euler(
        SHIRT_CALIBRATION.baseRotation.x,
        SHIRT_CALIBRATION.baseRotation.y,
        SHIRT_CALIBRATION.baseRotation.z
      )
    );

    expect(torsoModelRoot).toBeTruthy();
    expect(torsoModelRoot?.quaternion.angleTo(expectedRotation)).toBeLessThan(1e-6);
  });

  it('applies the sleeve y offset as an upward screen-space lift', async () => {
    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController(undefined, {
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      yOffset: 0.34,
      zOffset: 0,
      baseRotation: { x: 0, y: 0, z: 0 },
    });

    controller.resize({ width: 200, height: 200 });
    controller.updateSleeves(
      {
        center: { x: 100, y: 100 },
        lengthPx: 80,
        shoulderWidthPx: 60,
        elbowWidthPx: 50,
        rotation: new Quaternion(),
      },
      null
    );

    const leftSleeveAnchor = (controller as any).leftSleeveAnchor as Group;

    expect(leftSleeveAnchor.position.y).toBeCloseTo(12.16, 2);
  });

  it('uses the default sleeve calibration for larger sleeves and a higher lift', async () => {
    const { ShirtSceneController } = await import('@/lib/mirror/three/shirt-scene');
    const controller = new ShirtSceneController();

    controller.resize({ width: 200, height: 200 });
    controller.updateSleeves(
      {
        center: { x: 100, y: 100 },
        lengthPx: 80,
        shoulderWidthPx: 60,
        elbowWidthPx: 50,
        rotation: new Quaternion(),
      },
      null
    );

    const leftSleeveAnchor = (controller as any).leftSleeveAnchor as Group;
    const sleeveWidth = (60 + 50) / 2;
    const expectedScaleX = 1 + (sleeveWidth * SLEEVE_CALIBRATION.scaleX - 1) * 0.6;
    const expectedScaleY = 1 + (80 * SLEEVE_CALIBRATION.scaleY - 1) * 0.6;
    const expectedScaleZ = 1 + (sleeveWidth * SLEEVE_CALIBRATION.scaleZ - 1) * 0.6;

    expect(leftSleeveAnchor.position.y).toBeCloseTo(18.23, 2);
    expect(leftSleeveAnchor.scale.x).toBeCloseTo(expectedScaleX, 4);
    expect(leftSleeveAnchor.scale.y).toBeCloseTo(expectedScaleY, 4);
    expect(leftSleeveAnchor.scale.z).toBeCloseTo(expectedScaleZ, 4);
  });
});

function createNamedMesh(name: string, x: number) {
  const mesh = new Mesh(new BoxGeometry(10, 10, 10), new MeshBasicMaterial());
  mesh.name = name;
  mesh.position.set(x, 0, 0);
  return mesh;
}
