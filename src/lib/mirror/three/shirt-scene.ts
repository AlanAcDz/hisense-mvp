import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Euler,
  Group,
  LoadingManager,
  Material,
  Mesh,
  Object3D,
  OrthographicCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  JERSEY_FRONT_MODEL_URL,
  JERSEY_SLEEVES_MODEL_URL,
  SHIRT_CALIBRATION,
  SLEEVE_CALIBRATION,
} from '@/lib/mirror/constants';
import { smoothQuaternion, smoothVector3 } from '@/lib/mirror/pose/smoothing';
import type {
  ShirtCalibration,
  SleeveCalibration,
  SleeveTransform,
  StageSize,
  TorsoTransform,
} from '@/lib/mirror/types';
import { createProxyShirtGroup } from '@/lib/mirror/three/proxy-shirt';
import { createProxySleeveGroup } from '@/lib/mirror/three/proxy-sleeve';

interface ShirtSceneLoadResult {
  errorMessage: string | null;
  usedFallback: boolean;
}

export class ShirtSceneController {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: OrthographicCamera;
  private readonly shirtAnchor: Group;
  private readonly calibration: ShirtCalibration;
  private readonly sleeveCalibration: SleeveCalibration;
  private stageSize: StageSize = { width: 1, height: 1 };
  private modelRoot: Object3D | null = null;
  private modelSize = new Vector3(1, 1, 1);
  private currentPosition = new Vector3();
  private currentScale = new Vector3(1, 1, 1);
  private currentRotation = new Quaternion();
  private jerseyOpacity = 1;
  private calibrationQuaternion = new Quaternion();
  private sleeveCalibrationQuaternion = new Quaternion();

  private readonly leftSleeveAnchor: Group;
  private readonly rightSleeveAnchor: Group;
  private leftSleeveModelRoot: Object3D | null = null;
  private rightSleeveModelRoot: Object3D | null = null;
  private leftSleeveModelSize = new Vector3(1, 1, 1);
  private rightSleeveModelSize = new Vector3(1, 1, 1);
  private leftSleevePosition = new Vector3();
  private leftSleeveScale = new Vector3(1, 1, 1);
  private leftSleeveRotation = new Quaternion();
  private rightSleevePosition = new Vector3();
  private rightSleeveScale = new Vector3(1, 1, 1);
  private rightSleeveRotation = new Quaternion();

  constructor(
    calibration: ShirtCalibration = SHIRT_CALIBRATION,
    sleeveCalibration: SleeveCalibration = SLEEVE_CALIBRATION
  ) {
    this.calibration = calibration;
    this.sleeveCalibration = sleeveCalibration;
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new Scene();
    this.camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -2000, 2000);
    this.camera.position.z = 1000;

    this.shirtAnchor = new Group();
    this.shirtAnchor.visible = false;

    this.leftSleeveAnchor = new Group();
    this.leftSleeveAnchor.visible = false;

    this.rightSleeveAnchor = new Group();
    this.rightSleeveAnchor.visible = false;

    const ambient = new AmbientLight(0xffffff, 1.15);
    const keyLight = new DirectionalLight(0xffffff, 0.65);
    keyLight.position.set(0, 0, 1);

    this.scene.add(ambient, keyLight, this.shirtAnchor, this.leftSleeveAnchor, this.rightSleeveAnchor);
    this.calibrationQuaternion.setFromEuler(
      new Euler(calibration.baseRotation.x, calibration.baseRotation.y, calibration.baseRotation.z)
    );
    this.sleeveCalibrationQuaternion.setFromEuler(
      new Euler(
        sleeveCalibration.baseRotation.x,
        sleeveCalibration.baseRotation.y,
        sleeveCalibration.baseRotation.z
      )
    );
  }

  get canvas() {
    return this.renderer.domElement;
  }

  async loadShirtModel() {
    const manager = new LoadingManager();
    const fallbackMessages: string[] = [];

    try {
      const jerseyFront = await loadModelAsset(JERSEY_FRONT_MODEL_URL, manager);
      this.attachTorsoModel(selectTorsoModel(jerseyFront));
    } catch (error) {
      this.attachTorsoModel(createProxyShirtGroup());
      fallbackMessages.push(
        error instanceof Error
          ? `${error.message} Using proxy jersey body instead.`
          : 'Could not load the jersey body model. Using proxy jersey body instead.'
      );
    }

    try {
      const jerseySleeves = await loadModelAsset(JERSEY_SLEEVES_MODEL_URL, manager);
      const { leftSleeve, rightSleeve } = selectSleeveModels(jerseySleeves);
      this.attachSleeveModels(rightSleeve, leftSleeve);
    } catch (error) {
      this.attachSleeveModels(createProxySleeveGroup(), createProxySleeveGroup());
      fallbackMessages.push(
        error instanceof Error
          ? `${error.message} Using proxy sleeves instead.`
          : 'Could not load the sleeve model. Using proxy sleeves instead.'
      );
    }

    return {
      errorMessage: fallbackMessages.length > 0 ? fallbackMessages.join(' ') : null,
      usedFallback: fallbackMessages.length > 0,
    } satisfies ShirtSceneLoadResult;
  }

  resize(stageSize: StageSize) {
    this.stageSize = stageSize;
    this.camera.left = -stageSize.width / 2;
    this.camera.right = stageSize.width / 2;
    this.camera.top = stageSize.height / 2;
    this.camera.bottom = -stageSize.height / 2;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(stageSize.width, stageSize.height, false);
  }

  setJerseyOpacity(opacity: number) {
    this.jerseyOpacity = opacity;
    this.applyJerseyOpacity();
  }

  updateShirtTransform(transform: TorsoTransform | null) {
    if (!this.modelRoot || !transform) {
      this.shirtAnchor.visible = false;
      return;
    }

    this.shirtAnchor.visible = true;

    const targetPosition = new Vector3(
      this.stageSize.width / 2 - transform.center.x + transform.widthPx * this.calibration.xOffset,
      this.stageSize.height / 2 - transform.center.y,
      this.calibration.zOffset + transform.depth * this.calibration.depthScale
    );
    const scaleXFactor = (transform.widthPx / this.modelSize.x) * this.calibration.scaleX;
    const scaleYFactor = (transform.heightPx / this.modelSize.y) * this.calibration.scaleY;
    const targetScale = new Vector3(
      scaleXFactor,
      scaleYFactor,
      Math.min(scaleXFactor, scaleYFactor) * this.calibration.scaleZ
    );
    const targetRotation = new Quaternion().copy(transform.rotation);

    this.currentPosition = smoothVector3(this.currentPosition, targetPosition, 0.65);
    this.currentScale = smoothVector3(this.currentScale, targetScale, 0.6);
    this.currentRotation = smoothQuaternion(this.currentRotation, targetRotation, 0.65);

    this.shirtAnchor.position.copy(this.currentPosition);
    this.shirtAnchor.scale.copy(this.currentScale);
    this.shirtAnchor.quaternion.copy(this.currentRotation);
  }

  updateSleeves(
    leftSleeve: SleeveTransform | null,
    rightSleeve: SleeveTransform | null
  ) {
    this.applySleeve(this.leftSleeveAnchor, leftSleeve, 'left');
    this.applySleeve(this.rightSleeveAnchor, rightSleeve, 'right');
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }

  private applySleeve(
    anchor: Group,
    sleeve: SleeveTransform | null,
    side: 'left' | 'right'
  ) {
    if (!sleeve) {
      anchor.visible = false;
      return;
    }

    anchor.visible = true;

    const modelSize = side === 'left' ? this.leftSleeveModelSize : this.rightSleeveModelSize;
    const sleeveWidth = (sleeve.shoulderWidthPx + sleeve.elbowWidthPx) / 2;
    const horizontalDirection = side === 'left' ? -1 : 1;
    const targetPosition = new Vector3(
      this.stageSize.width / 2 -
        sleeve.center.x +
        sleeveWidth * this.sleeveCalibration.xOffset * horizontalDirection,
      this.stageSize.height / 2 - sleeve.center.y + sleeveWidth * this.sleeveCalibration.yOffset,
      this.shirtAnchor.position.z + this.sleeveCalibration.zOffset
    );
    const targetScale = new Vector3(
      (sleeveWidth / Math.max(modelSize.x, 0.001)) * this.sleeveCalibration.scaleX,
      (sleeve.lengthPx / Math.max(modelSize.y, 0.001)) * this.sleeveCalibration.scaleY,
      (sleeveWidth / Math.max(modelSize.z, 0.001)) * this.sleeveCalibration.scaleZ
    );

    const targetRotation = new Quaternion().copy(sleeve.rotation);

    if (side === 'left') {
      this.leftSleevePosition = smoothVector3(this.leftSleevePosition, targetPosition, 0.65);
      this.leftSleeveScale = smoothVector3(this.leftSleeveScale, targetScale, 0.6);
      this.leftSleeveRotation = smoothQuaternion(this.leftSleeveRotation, targetRotation, 0.65);
      anchor.position.copy(this.leftSleevePosition);
      anchor.scale.copy(this.leftSleeveScale);
      anchor.quaternion.copy(this.leftSleeveRotation);
    } else {
      this.rightSleevePosition = smoothVector3(this.rightSleevePosition, targetPosition, 0.65);
      this.rightSleeveScale = smoothVector3(this.rightSleeveScale, targetScale, 0.6);
      this.rightSleeveRotation = smoothQuaternion(this.rightSleeveRotation, targetRotation, 0.65);
      anchor.position.copy(this.rightSleevePosition);
      anchor.scale.copy(this.rightSleeveScale);
      anchor.quaternion.copy(this.rightSleeveRotation);
    }
  }

  private attachTorsoModel(nextModel: Object3D) {
    const { modelRoot, size } = this.replaceAnchorModel(
      this.shirtAnchor,
      this.modelRoot,
      nextModel,
      this.calibrationQuaternion
    );

    this.modelRoot = modelRoot;
    this.modelSize = size;
    this.currentScale.set(1, 1, 1);
    this.currentPosition.set(0, 0, 0);
    this.currentRotation.identity();
    this.applyJerseyOpacity();
  }

  private applyJerseyOpacity() {
    if (!this.modelRoot) {
      return;
    }

    this.modelRoot.traverse((node) => {
      if (!isMeshObject(node)) {
        return;
      }

      if (Array.isArray(node.material)) {
        node.material.forEach((material) => applyOpacityToMaterial(material, this.jerseyOpacity));
        return;
      }

      if (node.material) {
        applyOpacityToMaterial(node.material, this.jerseyOpacity);
      }
    });
  }

  private attachSleeveModels(leftSleeve: Object3D, rightSleeve: Object3D) {
    const leftAttachment = this.replaceAnchorModel(
      this.leftSleeveAnchor,
      this.leftSleeveModelRoot,
      leftSleeve,
      this.sleeveCalibrationQuaternion
    );
    const rightAttachment = this.replaceAnchorModel(
      this.rightSleeveAnchor,
      this.rightSleeveModelRoot,
      rightSleeve,
      this.sleeveCalibrationQuaternion
    );

    this.leftSleeveModelRoot = leftAttachment.modelRoot;
    this.leftSleeveModelSize = leftAttachment.size;
    this.rightSleeveModelRoot = rightAttachment.modelRoot;
    this.rightSleeveModelSize = rightAttachment.size;
    this.leftSleevePosition.set(0, 0, 0);
    this.leftSleeveScale.set(1, 1, 1);
    this.leftSleeveRotation.identity();
    this.rightSleevePosition.set(0, 0, 0);
    this.rightSleeveScale.set(1, 1, 1);
    this.rightSleeveRotation.identity();
  }

  private replaceAnchorModel(
    anchor: Group,
    currentModelRoot: Object3D | null,
    nextModel: Object3D,
    baseQuaternion: Quaternion
  ) {
    if (currentModelRoot) {
      anchor.remove(currentModelRoot);
    }

    const modelContainer = new Group();
    modelContainer.add(nextModel);

    const box = new Box3().setFromObject(modelContainer);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    nextModel.position.sub(center);
    modelContainer.quaternion.copy(baseQuaternion);
    anchor.add(modelContainer);

    return {
      modelRoot: modelContainer,
      size: new Vector3(
        Math.max(size.x, 0.001),
        Math.max(size.y, 0.001),
        Math.max(size.z, 0.001)
      ),
    };
  }
}

function applyOpacityToMaterial(material: Material, opacity: number) {
  const candidate = material as Material & { opacity?: number; transparent?: boolean };
  candidate.opacity = opacity;
  candidate.transparent = opacity < 0.999;
  material.needsUpdate = true;
}

function isMeshObject(node: Object3D): node is Mesh {
  return (node as Mesh).isMesh === true;
}

function cloneWorldSpaceNode(node: Object3D) {
  node.updateWorldMatrix(true, false);
  const clone = node.clone(true);
  clone.position.set(0, 0, 0);
  clone.quaternion.identity();
  clone.scale.set(1, 1, 1);
  clone.applyMatrix4(node.matrixWorld);
  return clone;
}

function collectRenderableParts(root: Object3D) {
  const parts: Array<{ center: Vector3; node: Object3D }> = [];
  root.updateWorldMatrix(true, true);

  root.traverse((child) => {
    const renderableChild = child as Object3D & {
      geometry?: object;
      isMesh?: boolean;
      isSkinnedMesh?: boolean;
    };
    if (!renderableChild.geometry || (!renderableChild.isMesh && !renderableChild.isSkinnedMesh)) {
      return;
    }

    const box = new Box3().setFromObject(child);
    if (box.isEmpty()) {
      return;
    }

    const center = box.getCenter(new Vector3());
    parts.push({
      center,
      node: cloneWorldSpaceNode(child),
    });
  });

  return parts;
}

function selectTorsoModel(root: Object3D) {
  const parts = collectRenderableParts(root).sort(
    (first, second) => Math.abs(first.center.x) - Math.abs(second.center.x)
  );

  return parts[0]?.node ?? root.clone(true);
}

function selectSleeveModels(root: Object3D) {
  const parts = collectRenderableParts(root).sort((first, second) => first.center.x - second.center.x);
  const leftSleeve = parts[0]?.node ?? createProxySleeveGroup();
  const rightSleeveSource = parts[parts.length - 1]?.node ?? createProxySleeveGroup();
  const rightSleeve = rightSleeveSource === leftSleeve ? rightSleeveSource.clone(true) : rightSleeveSource;

  return {
    leftSleeve,
    rightSleeve,
  };
}

async function loadModelAsset(url: string, manager: LoadingManager) {
  const extension = getModelExtension(url);

  if (extension === 'fbx') {
    const loader = new FBXLoader(manager);
    return loader.loadAsync(url);
  }

  if (extension === 'glb' || extension === 'gltf') {
    const loader = new GLTFLoader(manager);
    const model = await loader.loadAsync(url);
    return model.scene;
  }

  throw new Error(`Unsupported jersey model format ".${extension}" for ${url}`);
}

function getModelExtension(url: string) {
  const normalizedUrl = url.split('?')[0]?.split('#')[0] ?? url;
  const extension = normalizedUrl.split('.').pop()?.toLowerCase();

  if (!extension) {
    throw new Error(`Could not determine model format for ${url}`);
  }

  return extension;
}
