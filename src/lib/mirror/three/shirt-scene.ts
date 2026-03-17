import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Euler,
  Group,
  LoadingManager,
  Object3D,
  OrthographicCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SHIRT_CALIBRATION, SHIRT_MODEL_URL } from '@/lib/mirror/constants';
import { smoothQuaternion, smoothVector3 } from '@/lib/mirror/pose/smoothing';
import type { ShirtCalibration, SleeveTransform, StageSize, TorsoTransform } from '@/lib/mirror/types';
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
  private stageSize: StageSize = { width: 1, height: 1 };
  private modelRoot: Object3D | null = null;
  private modelSize = new Vector3(1, 1, 1);
  private currentPosition = new Vector3();
  private currentScale = new Vector3(1, 1, 1);
  private currentRotation = new Quaternion();
  private calibrationQuaternion = new Quaternion();

  private readonly leftSleeveAnchor: Group;
  private readonly rightSleeveAnchor: Group;
  private leftSleevePosition = new Vector3();
  private leftSleeveScale = new Vector3(1, 1, 1);
  private leftSleeveRotation = new Quaternion();
  private rightSleevePosition = new Vector3();
  private rightSleeveScale = new Vector3(1, 1, 1);
  private rightSleeveRotation = new Quaternion();

  constructor(calibration: ShirtCalibration = SHIRT_CALIBRATION) {
    this.calibration = calibration;
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
    this.leftSleeveAnchor.add(createProxySleeveGroup());

    this.rightSleeveAnchor = new Group();
    this.rightSleeveAnchor.visible = false;
    this.rightSleeveAnchor.add(createProxySleeveGroup());

    const ambient = new AmbientLight(0xffffff, 1.15);
    const keyLight = new DirectionalLight(0xffffff, 0.65);
    keyLight.position.set(0, 0, 1);

    this.scene.add(ambient, keyLight, this.shirtAnchor, this.leftSleeveAnchor, this.rightSleeveAnchor);
    this.calibrationQuaternion.setFromEuler(
      new Euler(calibration.baseRotation.x, calibration.baseRotation.y, calibration.baseRotation.z)
    );
  }

  get canvas() {
    return this.renderer.domElement;
  }

  async loadShirtModel() {
    const manager = new LoadingManager();
    const loader = new GLTFLoader(manager);

    try {
      const gltf = await loader.loadAsync(SHIRT_MODEL_URL);
      this.attachModel(gltf.scene);
      return {
        errorMessage: null,
        usedFallback: false,
      } satisfies ShirtSceneLoadResult;
    } catch (error) {
      this.attachModel(createProxyShirtGroup());
      return {
        errorMessage:
          error instanceof Error
            ? `${error.message} Using proxy shirt geometry instead.`
            : 'Could not load shirt model. Using proxy shirt geometry instead.',
        usedFallback: true,
      } satisfies ShirtSceneLoadResult;
    }
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

    const targetPosition = new Vector3(
      this.stageSize.width / 2 - sleeve.center.x,
      this.stageSize.height / 2 - sleeve.center.y,
      this.shirtAnchor.position.z
    );

    const targetScale = new Vector3(
      sleeve.shoulderWidthPx,
      sleeve.lengthPx,
      sleeve.elbowWidthPx
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

  private attachModel(nextModel: Object3D) {
    if (this.modelRoot) {
      this.shirtAnchor.remove(this.modelRoot);
    }

    const modelContainer = new Group();
    modelContainer.add(nextModel);

    const box = new Box3().setFromObject(modelContainer);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    nextModel.position.sub(center);
    modelContainer.quaternion.copy(this.calibrationQuaternion);

    this.modelRoot = modelContainer;
    this.modelSize = new Vector3(
      Math.max(size.x, 0.001),
      Math.max(size.y, 0.001),
      Math.max(size.z, 0.001)
    );

    this.currentScale.set(1, 1, 1);
    this.currentPosition.set(0, 0, 0);
    this.currentRotation.identity();
    this.shirtAnchor.add(modelContainer);
  }
}
