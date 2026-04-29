import type { Tensor } from '@tensorflow/tfjs';
import type { CoverLayout, StageSize } from '@/lib/mirror/types';

interface TfjsGpuData {
  tensorRef: Tensor;
  texture?: WebGLTexture;
  texShape?: [number, number];
}

export interface TfjsWebGLBackend {
  getGPGPUContext?: () => {
    gl?: WebGLRenderingContext | WebGL2RenderingContext;
  };
  readToGPU?: (dataId: object, options?: { customTexShape?: [number, number] }) => TfjsGpuData;
}

interface RvmWebGLForegroundRenderOptions {
  alphaSize: {
    width: number;
    height: number;
  };
  alphaTensor: Tensor;
  backend: TfjsWebGLBackend;
  coverLayout: CoverLayout;
  mirror?: boolean;
  source: HTMLCanvasElement;
  stageSize: StageSize;
}

interface UniformLocations {
  alpha: WebGLUniformLocation;
  alphaSize: WebGLUniformLocation;
  alphaTexShape: WebGLUniformLocation;
  cover: WebGLUniformLocation;
  mirror: WebGLUniformLocation;
  source: WebGLUniformLocation;
  stageSize: WebGLUniformLocation;
}

interface WebGLStateSnapshot {
  activeTexture: number;
  arrayBuffer: WebGLBuffer | null;
  blendEnabled: boolean;
  depthTestEnabled: boolean;
  elementArrayBuffer: WebGLBuffer | null;
  framebuffer: WebGLFramebuffer | null;
  program: WebGLProgram | null;
  scissorBox: Int32Array;
  scissorTestEnabled: boolean;
  stencilTestEnabled: boolean;
  texture0: WebGLTexture | null;
  texture1: WebGLTexture | null;
  unpackFlipY: boolean;
  vaoExtension: OES_vertex_array_object | null;
  vertexArray: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null;
  viewport: Int32Array;
}

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision highp float;

uniform sampler2D u_source;
uniform sampler2D u_alpha;
uniform vec2 u_stageSize;
uniform vec2 u_alphaSize;
uniform vec2 u_alphaTexShape;
uniform vec4 u_cover;
uniform float u_mirror;

float sampleDenseAlphaAt(vec2 pixel) {
  vec2 alphaPixel = clamp(pixel, vec2(0.0), u_alphaSize - vec2(1.0));
  float flatIndex = alphaPixel.y * u_alphaSize.x + alphaPixel.x;
  float texelIndex = floor(flatIndex / 4.0);
  float texelColumn = mod(texelIndex, u_alphaTexShape.x);
  float texelRow = floor(texelIndex / u_alphaTexShape.x);
  vec2 packedUv = vec2(
    (texelColumn + 0.5) / u_alphaTexShape.x,
    (texelRow + 0.5) / u_alphaTexShape.y
  );
  vec4 packedAlpha = texture2D(u_alpha, packedUv);
  float channel = mod(flatIndex, 4.0);

  if (channel < 0.5) {
    return packedAlpha.r;
  }
  if (channel < 1.5) {
    return packedAlpha.g;
  }
  if (channel < 2.5) {
    return packedAlpha.b;
  }
  return packedAlpha.a;
}

float sampleAlpha(vec2 alphaUv) {
  if (
    alphaUv.x < 0.0 ||
    alphaUv.y < 0.0 ||
    alphaUv.x > 1.0 ||
    alphaUv.y > 1.0
  ) {
    return 0.0;
  }

  vec2 alphaPosition = alphaUv * u_alphaSize - vec2(0.5);
  vec2 basePixel = floor(alphaPosition);
  vec2 blend = alphaPosition - basePixel;

  float topLeft = sampleDenseAlphaAt(basePixel);
  float topRight = sampleDenseAlphaAt(basePixel + vec2(1.0, 0.0));
  float bottomLeft = sampleDenseAlphaAt(basePixel + vec2(0.0, 1.0));
  float bottomRight = sampleDenseAlphaAt(basePixel + vec2(1.0, 1.0));

  return mix(
    mix(topLeft, topRight, blend.x),
    mix(bottomLeft, bottomRight, blend.x),
    blend.y
  );
}

void main() {
  vec2 stageCoord = vec2(gl_FragCoord.x, u_stageSize.y - gl_FragCoord.y);
  vec2 sourceUv = vec2(stageCoord.x / u_stageSize.x, 1.0 - stageCoord.y / u_stageSize.y);
  vec2 videoStageCoord = stageCoord;

  if (u_mirror > 0.5) {
    videoStageCoord.x = u_stageSize.x - stageCoord.x;
  }

  vec2 alphaUv = (videoStageCoord - u_cover.xy) / u_cover.zw;
  float alpha = clamp(sampleAlpha(alphaUv), 0.0, 1.0);
  vec4 sourceColor = texture2D(u_source, sourceUv);

  gl_FragColor = vec4(sourceColor.rgb, alpha);
}
`;

function compileShader(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  source: string
) {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Unable to create WebGL shader.');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Unknown WebGL shader compile error.';
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function createProgram(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
  const program = gl.createProgram();

  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error('Unable to create WebGL program.');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'Unknown WebGL program link error.';
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
}

function getUniformLocation(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  program: WebGLProgram,
  name: string
) {
  const location = gl.getUniformLocation(program, name);
  if (!location) {
    throw new Error(`Missing WebGL uniform: ${name}`);
  }

  return location;
}

function getBackendGl(backend: TfjsWebGLBackend) {
  return backend.getGPGPUContext?.().gl ?? null;
}

function isWebGL2(
  gl: WebGLRenderingContext | WebGL2RenderingContext
): gl is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
}

function getVaoExtension(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  return isWebGL2(gl) ? null : gl.getExtension('OES_vertex_array_object');
}

function getBoundVertexArray(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  extension: OES_vertex_array_object | null
) {
  if (isWebGL2(gl)) {
    return gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
  }

  return extension
    ? (gl.getParameter(extension.VERTEX_ARRAY_BINDING_OES) as WebGLVertexArrayObjectOES | null)
    : null;
}

function bindVertexArray(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  extension: OES_vertex_array_object | null,
  vertexArray: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null
) {
  if (isWebGL2(gl)) {
    gl.bindVertexArray(vertexArray as WebGLVertexArrayObject | null);
    return;
  }

  extension?.bindVertexArrayOES(vertexArray as WebGLVertexArrayObjectOES | null);
}

function snapshotWebGLState(gl: WebGLRenderingContext | WebGL2RenderingContext): WebGLStateSnapshot {
  const vaoExtension = getVaoExtension(gl);
  const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;

  gl.activeTexture(gl.TEXTURE0);
  const texture0 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  gl.activeTexture(gl.TEXTURE1);
  const texture1 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  gl.activeTexture(activeTexture);

  return {
    activeTexture,
    arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null,
    blendEnabled: gl.isEnabled(gl.BLEND),
    depthTestEnabled: gl.isEnabled(gl.DEPTH_TEST),
    elementArrayBuffer: gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING) as WebGLBuffer | null,
    framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
    scissorBox: gl.getParameter(gl.SCISSOR_BOX) as Int32Array,
    scissorTestEnabled: gl.isEnabled(gl.SCISSOR_TEST),
    stencilTestEnabled: gl.isEnabled(gl.STENCIL_TEST),
    texture0,
    texture1,
    unpackFlipY: gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean,
    vaoExtension,
    vertexArray: getBoundVertexArray(gl, vaoExtension),
    viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
  };
}

function setEnabled(gl: WebGLRenderingContext | WebGL2RenderingContext, capability: number, enabled: boolean) {
  if (enabled) {
    gl.enable(capability);
    return;
  }

  gl.disable(capability);
}

function restoreWebGLState(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  state: WebGLStateSnapshot
) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer);
  bindVertexArray(gl, state.vaoExtension, state.vertexArray);
  gl.viewport(state.viewport[0], state.viewport[1], state.viewport[2], state.viewport[3]);
  gl.scissor(state.scissorBox[0], state.scissorBox[1], state.scissorBox[2], state.scissorBox[3]);
  gl.useProgram(state.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.arrayBuffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.elementArrayBuffer);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, state.unpackFlipY);
  setEnabled(gl, gl.BLEND, state.blendEnabled);
  setEnabled(gl, gl.DEPTH_TEST, state.depthTestEnabled);
  setEnabled(gl, gl.SCISSOR_TEST, state.scissorTestEnabled);
  setEnabled(gl, gl.STENCIL_TEST, state.stencilTestEnabled);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, state.texture0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, state.texture1);
  gl.activeTexture(state.activeTexture);
}

export class RvmWebGLForegroundCompositor {
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private program: WebGLProgram | null = null;
  private sourceTexture: WebGLTexture | null = null;
  private uniforms: UniformLocations | null = null;
  private vaoExtension: OES_vertex_array_object | null = null;
  private vertexArray: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null = null;

  dispose() {
    if (!this.gl) {
      return;
    }

    if (this.positionBuffer) {
      this.gl.deleteBuffer(this.positionBuffer);
    }
    if (this.sourceTexture) {
      this.gl.deleteTexture(this.sourceTexture);
    }
    if (this.program) {
      this.gl.deleteProgram(this.program);
    }
    if (this.vertexArray) {
      if (isWebGL2(this.gl)) {
        this.gl.deleteVertexArray(this.vertexArray as WebGLVertexArrayObject);
      } else {
        this.vaoExtension?.deleteVertexArrayOES(this.vertexArray as WebGLVertexArrayObjectOES);
      }
    }

    this.gl = null;
    this.positionBuffer = null;
    this.program = null;
    this.sourceTexture = null;
    this.uniforms = null;
    this.vaoExtension = null;
    this.vertexArray = null;
  }

  render({
    alphaSize,
    alphaTensor,
    backend,
    coverLayout,
    mirror = true,
    source,
    stageSize,
  }: RvmWebGLForegroundRenderOptions) {
    if (
      !stageSize.width ||
      !stageSize.height ||
      !alphaSize.width ||
      !alphaSize.height ||
      !coverLayout.width ||
      !coverLayout.height ||
      !backend.readToGPU
    ) {
      return null;
    }

    const gl = getBackendGl(backend);
    const canvas = gl?.canvas;
    if (!gl || !canvas || !(canvas instanceof HTMLCanvasElement) || gl.isContextLost()) {
      return null;
    }
    if (!gl.getContextAttributes()?.alpha) {
      return null;
    }

    if (this.gl !== gl) {
      this.dispose();
      this.gl = gl;
    }

    const alphaGpu = backend.readToGPU(alphaTensor.dataId as object);
    if (!alphaGpu.texture || !alphaGpu.texShape) {
      alphaGpu.tensorRef.dispose();
      return null;
    }

    const previousState = snapshotWebGLState(gl);

    try {
      this.ensureResources(gl);

      if (!this.program || !this.positionBuffer || !this.sourceTexture || !this.uniforms) {
        return null;
      }

      if (canvas.width !== stageSize.width) {
        canvas.width = stageSize.width;
      }
      if (canvas.height !== stageSize.height) {
        canvas.height = stageSize.height;
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, stageSize.width, stageSize.height);
      gl.scissor(0, 0, stageSize.width, stageSize.height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.BLEND);
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this.program);
      if (!this.bindOwnVertexArray(gl)) {
        this.configurePositionAttribute(gl);
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, alphaGpu.texture);

      gl.uniform1i(this.uniforms.source, 0);
      gl.uniform1i(this.uniforms.alpha, 1);
      gl.uniform2f(this.uniforms.stageSize, stageSize.width, stageSize.height);
      gl.uniform2f(this.uniforms.alphaSize, alphaSize.width, alphaSize.height);
      gl.uniform2f(this.uniforms.alphaTexShape, alphaGpu.texShape[1], alphaGpu.texShape[0]);
      gl.uniform4f(
        this.uniforms.cover,
        coverLayout.offsetX,
        coverLayout.offsetY,
        coverLayout.width,
        coverLayout.height
      );
      gl.uniform1f(this.uniforms.mirror, mirror ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.flush();

      return canvas;
    } finally {
      restoreWebGLState(gl, previousState);
      alphaGpu.tensorRef.dispose();
    }
  }

  private ensureResources(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    if (!this.program) {
      this.program = createProgram(gl);
      this.uniforms = {
        alpha: getUniformLocation(gl, this.program, 'u_alpha'),
        alphaSize: getUniformLocation(gl, this.program, 'u_alphaSize'),
        alphaTexShape: getUniformLocation(gl, this.program, 'u_alphaTexShape'),
        cover: getUniformLocation(gl, this.program, 'u_cover'),
        mirror: getUniformLocation(gl, this.program, 'u_mirror'),
        source: getUniformLocation(gl, this.program, 'u_source'),
        stageSize: getUniformLocation(gl, this.program, 'u_stageSize'),
      };
    }

    if (!this.positionBuffer) {
      this.positionBuffer = gl.createBuffer();
      if (!this.positionBuffer) {
        throw new Error('Unable to create WebGL vertex buffer.');
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    if (!this.sourceTexture) {
      this.sourceTexture = gl.createTexture();
      if (!this.sourceTexture) {
        throw new Error('Unable to create WebGL source texture.');
      }

      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    this.ensureVertexArray(gl);
  }

  private configurePositionAttribute(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    if (!this.program || !this.positionBuffer) {
      return;
    }

    const positionLocation = gl.getAttribLocation(this.program, 'a_position');
    if (positionLocation < 0) {
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  }

  private bindOwnVertexArray(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    if (isWebGL2(gl)) {
      if (!this.vertexArray) {
        return false;
      }
      gl.bindVertexArray(this.vertexArray as WebGLVertexArrayObject);
      return true;
    }

    if (!this.vaoExtension || !this.vertexArray) {
      return false;
    }

    this.vaoExtension.bindVertexArrayOES(this.vertexArray as WebGLVertexArrayObjectOES);
    return true;
  }

  private ensureVertexArray(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    if (!this.program || !this.positionBuffer || this.vertexArray) {
      return;
    }

    if (isWebGL2(gl)) {
      this.vertexArray = gl.createVertexArray();
      if (!this.vertexArray) {
        return;
      }
      gl.bindVertexArray(this.vertexArray as WebGLVertexArrayObject);
      this.configurePositionAttribute(gl);
      gl.bindVertexArray(null);
      return;
    }

    this.vaoExtension = this.vaoExtension ?? gl.getExtension('OES_vertex_array_object');
    if (!this.vaoExtension) {
      return;
    }

    this.vertexArray = this.vaoExtension.createVertexArrayOES();
    if (!this.vertexArray) {
      return;
    }

    this.vaoExtension.bindVertexArrayOES(this.vertexArray as WebGLVertexArrayObjectOES);
    this.configurePositionAttribute(gl);
    this.vaoExtension.bindVertexArrayOES(null);
  }
}
