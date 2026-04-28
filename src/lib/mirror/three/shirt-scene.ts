import {
  AmbientLight,
  Bone,
  Box3,
  Color,
  DoubleSide,
  DirectionalLight,
  Euler,
  Group,
  LoadingManager,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  Quaternion,
  Scene,
  SkinnedMesh,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinnedModel } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  JERSEY_RIGGED_MODEL_URL,
  RIG_CALIBRATION,
  SHIRT_CALIBRATION,
} from '@/lib/mirror/constants';
import { smoothQuaternion, smoothVector3 } from '@/lib/mirror/pose/smoothing';
import type {
  Point2D,
  RigCalibration,
  RigPose,
  ShirtCalibration,
  StageSize,
  TorsoTransform,
} from '@/lib/mirror/types';
import { createProxyShirtGroup } from '@/lib/mirror/three/proxy-shirt';

interface ShirtSceneLoadResult {
  errorMessage: string | null;
  usedFallback: boolean;
}

interface ControlledBone {
  bone: Bone;
  childBone: Bone;
  bindQuaternion: Quaternion;
  restAngle: number;
  axisSign: 1 | -1;
}

interface ModelAnchorMetrics {
  leftShoulder: Vector3;
  rightShoulder: Vector3;
  leftHip: Vector3;
  rightHip: Vector3;
  leftArm: Vector3 | null;
  rightArm: Vector3 | null;
  torsoCenter: Vector3;
  shoulderWidth: number;
  torsoHeight: number;
}

const Z_AXIS = new Vector3(0, 0, 1);
const LEFT_ARM_ALIASES = ['left_shoulder', 'left_shouler', 'left_upper_arm', 'left_arm'] as const;
const RIGHT_ARM_ALIASES = ['right_shoulder', 'right_shouler', 'right_upper_arm', 'right_arm'] as const;
const LEFT_SHOULDER_ANCHOR_ALIASES = ['left_shoulder', 'left_shouler'] as const;
const RIGHT_SHOULDER_ANCHOR_ALIASES = ['right_shoulder', 'right_shouler'] as const;
const LEFT_HIP_ANCHOR_ALIASES = ['left_hip'] as const;
const RIGHT_HIP_ANCHOR_ALIASES = ['right_hip'] as const;
const LEFT_ARM_ANCHOR_ALIASES = ['left_arm'] as const;
const RIGHT_ARM_ANCHOR_ALIASES = ['right_arm'] as const;

export class ShirtSceneController {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: OrthographicCamera;
  private readonly shirtAnchor: Group;
  private calibration: ShirtCalibration;
  private rigCalibration: RigCalibration;
  private stageSize: StageSize = { width: 1, height: 1 };
  private modelRoot: Object3D | null = null;
  private rigModelSource: Object3D | null = null;
  private modelSize = new Vector3(1, 1, 1);
  private currentPosition = new Vector3();
  private currentScale = new Vector3(1, 1, 1);
  private currentRotation = new Quaternion();
  private currentTorsoTransform: TorsoTransform | null = null;
  private currentRigPose: RigPose | null = null;
  private jerseyOpacity = 1;
  private calibrationQuaternion = new Quaternion();
  private leftArmControl: ControlledBone | null = null;
  private rightArmControl: ControlledBone | null = null;
  private modelAnchors: ModelAnchorMetrics | null = null;

  constructor(
    calibration: ShirtCalibration = SHIRT_CALIBRATION,
    rigCalibration: RigCalibration = RIG_CALIBRATION
  ) {
    this.calibration = cloneShirtCalibration(calibration);
    this.rigCalibration = cloneRigCalibration(rigCalibration);
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

    const ambient = new AmbientLight(0xffffff, 0.5);
    const keyLight = new DirectionalLight(0xffffff, 1.05);
    keyLight.position.set(0.85, 0.35, 1.2);
    const fillLight = new DirectionalLight(0xd7ecff, 0.45);
    fillLight.position.set(-1.1, 0.2, 0.7);
    const topLight = new DirectionalLight(0xfff4de, 0.28);
    topLight.position.set(0, 1, 0.45);

    this.scene.add(ambient, keyLight, fillLight, topLight, this.shirtAnchor);
    this.refreshCalibrationQuaternion();
  }

  get canvas() {
    return this.renderer.domElement;
  }

  async loadShirtModel() {
    const manager = new LoadingManager();

    try {
      const riggedModel = await loadModelAsset(JERSEY_RIGGED_MODEL_URL, manager);
      validateRiggedModel(riggedModel);
      this.rigModelSource = riggedModel;
      this.attachRiggedModel(cloneRigModel(this.rigModelSource));

      return {
        errorMessage: null,
        usedFallback: false,
      } satisfies ShirtSceneLoadResult;
    } catch (error) {
      this.attachRiggedModel(createProxyShirtGroup());

      return {
        errorMessage:
          error instanceof Error
            ? `${error.message} Using proxy jersey instead.`
            : 'Could not load the rigged jersey model. Using proxy jersey instead.',
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

  setJerseyOpacity(opacity: number) {
    this.jerseyOpacity = opacity;
    this.applyJerseyOpacity();
  }

  setCalibrations(calibration: ShirtCalibration, rigCalibration: RigCalibration) {
    const nextCalibration = cloneShirtCalibration(calibration);
    const shouldReattachModel = !sameEuler(this.calibration.baseRotation, nextCalibration.baseRotation);

    this.calibration = nextCalibration;
    this.rigCalibration = cloneRigCalibration(rigCalibration);
    this.refreshCalibrationQuaternion();

    if (shouldReattachModel && this.rigModelSource) {
      this.attachRiggedModel(cloneRigModel(this.rigModelSource));
    }

    this.updateShirtTransform(this.currentTorsoTransform);
    this.updateRigPose(this.currentRigPose);
  }

  updateShirtTransform(transform: TorsoTransform | null) {
    this.currentTorsoTransform = transform;
    if (!this.modelRoot || !transform) {
      this.shirtAnchor.visible = false;
      return;
    }

    this.shirtAnchor.visible = true;

    const anchoredTransform = this.computeAnchoredTransform(transform);
    const targetPosition = new Vector3(
      this.stageSize.width / 2 - transform.center.x + transform.widthPx * this.calibration.xOffset,
      this.stageSize.height / 2 - transform.center.y,
      this.calibration.zOffset + transform.depth * this.calibration.depthScale
    );
    const scaleXFactor = (transform.widthPx / this.modelSize.x) * this.calibration.scaleX;
    const scaleYFactor = (transform.heightPx / this.modelSize.y) * this.calibration.scaleY;
    const targetScale = anchoredTransform?.scale ?? new Vector3(
      scaleXFactor,
      scaleYFactor,
      Math.min(scaleXFactor, scaleYFactor) * this.calibration.scaleZ
    );
    const targetRotation = new Quaternion().copy(transform.rotation);
    const resolvedTargetPosition = anchoredTransform?.position ?? targetPosition;

    this.currentPosition = smoothVector3(this.currentPosition, resolvedTargetPosition, 0.65);
    this.currentScale = smoothVector3(this.currentScale, targetScale, 0.6);
    this.currentRotation = smoothQuaternion(this.currentRotation, targetRotation, 0.65);

    const viewScale = getCameraViewScale(this.currentScale);
    this.camera.zoom = viewScale;
    this.camera.updateProjectionMatrix();

    this.shirtAnchor.position.set(
      this.currentPosition.x / viewScale,
      this.currentPosition.y / viewScale,
      this.currentPosition.z / viewScale
    );
    this.shirtAnchor.scale.set(
      this.currentScale.x / viewScale,
      this.currentScale.y / viewScale,
      this.currentScale.z / viewScale
    );
    this.shirtAnchor.quaternion.copy(this.currentRotation);
  }

  updateRigPose(rigPose: RigPose | null) {
    this.currentRigPose = rigPose;
    const smoothedTorsoRoll = new Euler().setFromQuaternion(this.currentRotation).z;
    this.applyBoneRotation(
      this.leftArmControl,
      rigPose?.leftArmZRotation === null || rigPose?.leftArmZRotation === undefined
        ? null
        : compensateAngleForAnchorScale(
            rigPose.leftArmZRotation,
            smoothedTorsoRoll,
            this.currentScale
          ),
      this.rigCalibration.leftArmZRotationOffset
    );
    this.applyBoneRotation(
      this.rightArmControl,
      rigPose?.rightArmZRotation === null || rigPose?.rightArmZRotation === undefined
        ? null
        : compensateAngleForAnchorScale(
            rigPose.rightArmZRotation,
            smoothedTorsoRoll,
            this.currentScale
          ),
      this.rigCalibration.rightArmZRotationOffset
    );
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }

  private refreshCalibrationQuaternion() {
    this.calibrationQuaternion.setFromEuler(
      new Euler(
        this.calibration.baseRotation.x,
        this.calibration.baseRotation.y,
        this.calibration.baseRotation.z
      )
    );
  }

  private applyBoneRotation(
    control: ControlledBone | null,
    targetAngle: number | null,
    angleOffset: number
  ) {
    if (!control) {
      return;
    }

    const deltaAngle =
      targetAngle === null
        ? 0
        : normalizeAngle(targetAngle - control.restAngle + angleOffset);
    const targetQuaternion = control.bindQuaternion.clone().multiply(
      new Quaternion().setFromAxisAngle(Z_AXIS, control.axisSign * deltaAngle)
    );

    control.bone.quaternion.copy(
      smoothQuaternion(control.bone.quaternion, targetQuaternion, 0.78)
    );
  }

  private attachRiggedModel(nextModel: Object3D) {
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

    const rigControls = resolveRigControls(modelRoot);
    this.leftArmControl = rigControls.leftArmControl;
    this.rightArmControl = rigControls.rightArmControl;
    this.modelAnchors = resolveModelAnchorMetrics(modelRoot, this.shirtAnchor);

    this.applyRenderDefaults();
    this.applyJerseyOpacity();
  }

  private computeAnchoredTransform(transform: TorsoTransform) {
    if (!this.modelAnchors) {
      return null;
    }

    const targetAnchors = transform.anchors;
    const targetLeftShoulder = screenPointToWorld(targetAnchors.leftShoulder, this.stageSize);
    const targetRightShoulder = screenPointToWorld(targetAnchors.rightShoulder, this.stageSize);
    const targetLeftHip = screenPointToWorld(targetAnchors.leftHip, this.stageSize);
    const targetRightHip = screenPointToWorld(targetAnchors.rightHip, this.stageSize);
    const targetShoulderCenter = targetLeftShoulder.clone().add(targetRightShoulder).multiplyScalar(0.5);
    const targetHipCenter = targetLeftHip.clone().add(targetRightHip).multiplyScalar(0.5);
    const targetTorsoCenter = targetShoulderCenter.clone().add(targetHipCenter).multiplyScalar(0.5);
    const targetShoulderWidth = targetLeftShoulder.distanceTo(targetRightShoulder);
    const targetTorsoHeight = targetShoulderCenter.distanceTo(targetHipCenter);
    const rotation = new Quaternion().copy(transform.rotation);

    if (
      targetShoulderWidth < 1 ||
      targetTorsoHeight < 1 ||
      this.modelAnchors.shoulderWidth < 1e-6 ||
      this.modelAnchors.torsoHeight < 1e-6
    ) {
      return null;
    }

    const scaleXFactor = (targetShoulderWidth / this.modelAnchors.shoulderWidth) * this.calibration.scaleX;
    const scaleYFactor = (targetTorsoHeight / this.modelAnchors.torsoHeight) * this.calibration.scaleY;
    const scaleZFactor = Math.min(Math.abs(scaleXFactor), Math.abs(scaleYFactor)) * this.calibration.scaleZ;
    const scale = new Vector3(scaleXFactor, scaleYFactor, scaleZFactor);
    const modelTorsoOffset = this.modelAnchors.torsoCenter
      .clone()
      .multiply(scale)
      .applyQuaternion(rotation);

    targetTorsoCenter.x += transform.widthPx * this.calibration.xOffset;
    targetTorsoCenter.y -= transform.heightPx * this.calibration.yOffset;
    targetTorsoCenter.z = this.calibration.zOffset + transform.depth * this.calibration.depthScale;

    return {
      position: targetTorsoCenter.sub(modelTorsoOffset),
      scale,
    };
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

  private applyRenderDefaults() {
    if (!this.modelRoot) {
      return;
    }

    this.modelRoot.traverse((node) => {
      if ((node as SkinnedMesh).isSkinnedMesh) {
        const skinnedMesh = node as SkinnedMesh;
        skinnedMesh.frustumCulled = false;
        skinnedMesh.visible = true;
      }

      if (!isMeshObject(node)) {
        return;
      }

      if (Array.isArray(node.material)) {
        node.material = node.material.map((material) => createRuntimeMaterial(material));
        return;
      }

      node.material = createRuntimeMaterial(node.material);
    });
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

    const rawAnchors = resolveRawModelAnchors(modelContainer);
    if (rawAnchors) {
      nextModel.position.sub(getModelTorsoCenter(rawAnchors));
    } else {
      const box = new Box3().setFromObject(modelContainer);
      const center = box.getCenter(new Vector3());
      nextModel.position.sub(center);
    }

    modelContainer.updateWorldMatrix(true, true);
    modelContainer.quaternion.copy(baseQuaternion);
    applyAnchorBasisCorrection(modelContainer);
    modelContainer.updateWorldMatrix(true, true);

    const adjustedBounds = new Box3().setFromObject(modelContainer);
    const adjustedSize = adjustedBounds.getSize(new Vector3());
    anchor.add(modelContainer);

    return {
      modelRoot: modelContainer,
      size: new Vector3(
        Math.max(adjustedSize.x, 0.001),
        Math.max(adjustedSize.y, 0.001),
        Math.max(adjustedSize.z, 0.001)
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

function isMeshObject(node: Object3D): node is Mesh | SkinnedMesh {
  return (node as Mesh).isMesh === true || (node as SkinnedMesh).isSkinnedMesh === true;
}

function applyAnchorBasisCorrection(modelRoot: Object3D) {
  const anchors = resolveRawModelAnchors(modelRoot);
  if (!anchors) {
    return;
  }

  const shoulderAxis = anchors.rightShoulder.clone().sub(anchors.leftShoulder);
  const rawTorsoAxis = anchors.rightHip
    .clone()
    .add(anchors.leftHip)
    .multiplyScalar(0.5)
    .sub(anchors.rightShoulder.clone().add(anchors.leftShoulder).multiplyScalar(0.5));

  if (shoulderAxis.lengthSq() < 1e-6 || rawTorsoAxis.lengthSq() < 1e-6) {
    return;
  }

  shoulderAxis.normalize();
  const torsoAxis = rawTorsoAxis.sub(
    shoulderAxis.clone().multiplyScalar(rawTorsoAxis.dot(shoulderAxis))
  );
  if (torsoAxis.lengthSq() < 1e-6) {
    return;
  }
  torsoAxis.normalize();

  const sourceZ = shoulderAxis.clone().cross(torsoAxis).normalize();
  if (sourceZ.lengthSq() < 1e-6) {
    return;
  }

  const sourceY = sourceZ.clone().cross(shoulderAxis).normalize();
  const sourceBasis = new Matrix4().makeBasis(shoulderAxis, sourceY, sourceZ);
  const targetBasis = new Matrix4().makeBasis(
    new Vector3(-1, 0, 0),
    new Vector3(0, -1, 0),
    new Vector3(0, 0, 1)
  );
  const correctionMatrix = targetBasis.multiply(sourceBasis.invert());
  const correction = new Quaternion().setFromRotationMatrix(correctionMatrix);
  modelRoot.quaternion.premultiply(correction);
}

function resolveRawModelAnchors(root: Object3D) {
  root.updateWorldMatrix(true, true);
  const objectsByName = new Map<string, Object3D>();

  root.traverse((node) => {
    objectsByName.set(node.name.toLowerCase(), node);
  });

  const leftShoulder = getObjectLocalPosition(root, findObjectByAliases(objectsByName, LEFT_SHOULDER_ANCHOR_ALIASES));
  const rightShoulder = getObjectLocalPosition(root, findObjectByAliases(objectsByName, RIGHT_SHOULDER_ANCHOR_ALIASES));
  const leftHip = getObjectLocalPosition(root, findObjectByAliases(objectsByName, LEFT_HIP_ANCHOR_ALIASES));
  const rightHip = getObjectLocalPosition(root, findObjectByAliases(objectsByName, RIGHT_HIP_ANCHOR_ALIASES));

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return null;
  }

  return {
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
  };
}

function getModelTorsoCenter(anchors: {
  leftShoulder: Vector3;
  rightShoulder: Vector3;
  leftHip: Vector3;
  rightHip: Vector3;
}) {
  const shoulderCenter = anchors.leftShoulder.clone().add(anchors.rightShoulder).multiplyScalar(0.5);
  const hipCenter = anchors.leftHip.clone().add(anchors.rightHip).multiplyScalar(0.5);

  return shoulderCenter.add(hipCenter).multiplyScalar(0.5);
}

function cloneShirtCalibration(calibration: ShirtCalibration): ShirtCalibration {
  return {
    ...calibration,
    baseRotation: {
      ...calibration.baseRotation,
    },
  };
}

function cloneRigCalibration(calibration: RigCalibration): RigCalibration {
  return {
    ...calibration,
  };
}

function sameEuler(
  first: { x: number; y: number; z: number },
  second: { x: number; y: number; z: number }
) {
  return first.x === second.x && first.y === second.y && first.z === second.z;
}

function normalizeAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function compensateAngleForAnchorScale(
  screenAngle: number,
  anchorRoll: number,
  anchorScale: Vector3
) {
  const relativeAngle = normalizeAngle(screenAngle - anchorRoll);
  const scaleX = Math.max(Math.abs(anchorScale.x), 1e-6);
  const scaleY = Math.max(Math.abs(anchorScale.y), 1e-6);

  return Math.atan2(
    Math.sin(relativeAngle) / scaleY,
    Math.cos(relativeAngle) / scaleX
  );
}

function getCameraViewScale(anchorScale: Vector3) {
  return Math.max(Math.min(Math.abs(anchorScale.x), Math.abs(anchorScale.y)), 1e-6);
}

function validateRiggedModel(root: Object3D) {
  let hasSkinnedMesh = false;

  root.traverse((node) => {
    if ((node as SkinnedMesh).isSkinnedMesh) {
      hasSkinnedMesh = true;
    }
  });

  if (!hasSkinnedMesh) {
    throw new Error('The jersey model did not include a skinned mesh.');
  }
}

function resolveRigControls(root: Object3D) {
  root.updateWorldMatrix(true, true);
  const bonesByName = new Map<string, Bone>();

  root.traverse((node) => {
    if ((node as Bone).isBone) {
      bonesByName.set(node.name.toLowerCase(), node as Bone);
    }
  });

  return {
    // The rig is authored in anatomical space for a front-facing jersey, so the
    // model's left arm bone appears on the viewer's right side. We resolve the
    // controls by visual side so the mirrored experience matches user movement.
    leftArmControl: createControlledBone(findBoneByAliases(bonesByName, RIGHT_ARM_ALIASES)),
    rightArmControl: createControlledBone(findBoneByAliases(bonesByName, LEFT_ARM_ALIASES)),
  };
}

function resolveModelAnchorMetrics(root: Object3D, anchor: Object3D): ModelAnchorMetrics | null {
  anchor.updateWorldMatrix(true, true);
  root.updateWorldMatrix(true, true);
  const objectsByName = new Map<string, Object3D>();

  root.traverse((node) => {
    objectsByName.set(node.name.toLowerCase(), node);
  });

  const leftShoulder = getObjectLocalPosition(anchor, findObjectByAliases(objectsByName, LEFT_SHOULDER_ANCHOR_ALIASES));
  const rightShoulder = getObjectLocalPosition(anchor, findObjectByAliases(objectsByName, RIGHT_SHOULDER_ANCHOR_ALIASES));
  const leftHip = getObjectLocalPosition(anchor, findObjectByAliases(objectsByName, LEFT_HIP_ANCHOR_ALIASES));
  const rightHip = getObjectLocalPosition(anchor, findObjectByAliases(objectsByName, RIGHT_HIP_ANCHOR_ALIASES));

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return null;
  }

  const shoulderCenter = leftShoulder.clone().add(rightShoulder).multiplyScalar(0.5);
  const hipCenter = leftHip.clone().add(rightHip).multiplyScalar(0.5);
  const torsoCenter = shoulderCenter.clone().add(hipCenter).multiplyScalar(0.5);
  const shoulderWidth = leftShoulder.distanceTo(rightShoulder);
  const torsoHeight = shoulderCenter.distanceTo(hipCenter);

  if (shoulderWidth < 1e-6 || torsoHeight < 1e-6) {
    return null;
  }

  return {
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
    leftArm: getObjectLocalPosition(anchor, findObjectByAliases(objectsByName, LEFT_ARM_ANCHOR_ALIASES)),
    rightArm: getObjectLocalPosition(anchor, findObjectByAliases(objectsByName, RIGHT_ARM_ANCHOR_ALIASES)),
    torsoCenter,
    shoulderWidth,
    torsoHeight,
  };
}

function findObjectByAliases(
  objectsByName: Map<string, Object3D>,
  aliases: readonly string[]
) {
  for (const alias of aliases) {
    const match = objectsByName.get(alias.toLowerCase());
    if (match) {
      return match;
    }
  }

  return null;
}

function getObjectLocalPosition(root: Object3D, object: Object3D | null) {
  if (!object) {
    return null;
  }

  return root.worldToLocal(object.getWorldPosition(new Vector3()));
}

function screenPointToWorld(point: Point2D, stageSize: StageSize) {
  return new Vector3(
    stageSize.width / 2 - point.x,
    stageSize.height / 2 - point.y,
    0
  );
}

function findBoneByAliases(
  bonesByName: Map<string, Bone>,
  aliases: readonly string[]
) {
  for (const alias of aliases) {
    const match = bonesByName.get(alias.toLowerCase());
    if (match) {
      return match;
    }
  }

  return null;
}

function createControlledBone(bone: Bone | null): ControlledBone | null {
  if (!bone) {
    return null;
  }

  const { controlBone, childBone } = selectArmControlBone(bone);
  if (!childBone) {
    return null;
  }

  const bindQuaternion = controlBone.quaternion.clone();
  const restAngle = getChildWorldAngle(controlBone, childBone);
  const restDirection = childBone
    .getWorldPosition(new Vector3())
    .sub(controlBone.getWorldPosition(new Vector3()))
    .normalize();

  if (restDirection.lengthSq() < 1e-6) {
    return null;
  }

  const sampleRotation = new Quaternion().setFromAxisAngle(Z_AXIS, 0.1);
  controlBone.quaternion.copy(bindQuaternion.clone().multiply(sampleRotation));
  controlBone.updateWorldMatrix(true, true);
  const rotatedAngle = getChildWorldAngle(controlBone, childBone);
  const axisSign = normalizeAngle(rotatedAngle - restAngle) >= 0 ? 1 : -1;
  controlBone.quaternion.copy(bindQuaternion);
  controlBone.updateWorldMatrix(true, true);

  return {
    bone: controlBone,
    childBone,
    bindQuaternion,
    restAngle,
    axisSign,
  };
}

function selectArmControlBone(bone: Bone) {
  const directChild = bone.children.find((child) => (child as Bone).isBone) as Bone | undefined;
  const parentBone = bone.parent && (bone.parent as Bone).isBone ? (bone.parent as Bone) : null;

  // Prefer the resolved shoulder bone when it already owns the upper-arm child.
  // Some rigs insert helper/clavicle joints above the shoulder, and rotating the
  // parent helper produces a visible angle translation between the sleeve and the
  // tracked arm line.
  if (directChild) {
    return {
      controlBone: bone,
      childBone: directChild,
    };
  }

  if (parentBone && !isTorsoBone(parentBone)) {
    return {
      controlBone: parentBone,
      childBone: bone,
    };
  }

  return {
    controlBone: bone,
    childBone: bone,
  };
}

function isTorsoBone(bone: Bone) {
  const normalizedName = bone.name.toLowerCase();
  return (
    normalizedName.includes('root') ||
    normalizedName.includes('spine') ||
    normalizedName.includes('chest') ||
    normalizedName.includes('torso') ||
    normalizedName.includes('neck')
  );
}

function getChildWorldAngle(bone: Bone, childBone: Bone) {
  const childDirection = childBone
    .getWorldPosition(new Vector3())
    .sub(bone.getWorldPosition(new Vector3()))
    .normalize();

  return Math.atan2(childDirection.y, childDirection.x);
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
    return normalizeImportedScene(model.scene);
  }

  throw new Error(`Unsupported jersey model format ".${extension}" for ${url}`);
}

function cloneRigModel(model: Object3D) {
  return cloneSkinnedModel(model);
}

function createRuntimeMaterial(source: Material) {
  const candidate = source as Material & {
    map?: Texture | null;
    color?: Color;
    emissiveMap?: Texture | null;
    normalMap?: Texture | null;
    roughnessMap?: Texture | null;
    metalnessMap?: Texture | null;
  };

  const material = new MeshStandardMaterial({
    color: candidate.color ? candidate.color.clone() : new Color(0xffffff),
    map: candidate.map ?? null,
    emissiveMap: candidate.emissiveMap ?? null,
    normalMap: candidate.normalMap ?? null,
    roughnessMap: candidate.roughnessMap ?? null,
    metalnessMap: candidate.metalnessMap ?? null,
    roughness: 0.82,
    metalness: 0.06,
    side: DoubleSide,
  });

  return material;
}

function normalizeImportedScene(scene: Object3D) {
  const commonScale = getCommonTopLevelScale(scene);
  if (commonScale && Math.abs(commonScale - 1) > 1e-3) {
    scene.scale.multiplyScalar(1 / commonScale);
  }

  const commonQuaternion = getCommonTopLevelQuaternion(scene);
  if (commonQuaternion && commonQuaternion.angleTo(new Quaternion()) > 1e-3) {
    scene.quaternion.multiply(commonQuaternion.clone().invert());
  }

  return scene;
}

function getCommonTopLevelScale(scene: Object3D) {
  const children = scene.children;
  if (!children.length) {
    return null;
  }

  let commonScale: number | null = null;

  for (const child of children) {
    const { x, y, z } = child.scale;
    if (Math.abs(x - y) > 1e-4 || Math.abs(x - z) > 1e-4) {
      return null;
    }

    if (commonScale === null) {
      commonScale = x;
      continue;
    }

    if (Math.abs(commonScale - x) > 1e-4) {
      return null;
    }
  }

  return commonScale;
}

function getCommonTopLevelQuaternion(scene: Object3D) {
  const children = scene.children;
  if (!children.length) {
    return null;
  }

  let commonQuaternion: Quaternion | null = null;

  for (const child of children) {
    if (commonQuaternion === null) {
      commonQuaternion = child.quaternion.clone();
      continue;
    }

    if (commonQuaternion.angleTo(child.quaternion) > 1e-4) {
      return null;
    }
  }

  return commonQuaternion;
}

function getModelExtension(url: string) {
  const normalizedUrl = url.split('?')[0]?.split('#')[0] ?? url;
  const extension = normalizedUrl.split('.').pop()?.toLowerCase();

  if (!extension) {
    throw new Error(`Could not determine model format for ${url}`);
  }

  return extension;
}
