import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Euler, Group, Mesh, MeshBasicMaterial, Quaternion } from 'three';

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
});

function createNamedMesh(name: string, x: number) {
  const mesh = new Mesh(new BoxGeometry(10, 10, 10), new MeshBasicMaterial());
  mesh.name = name;
  mesh.position.set(x, 0, 0);
  return mesh;
}
