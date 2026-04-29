import { composeCaptureFrame } from '@/lib/mirror/capture/compose-capture';

describe('composeCaptureFrame', () => {
  it('composes layers in background, user, shirt, arm overlay, pose order', () => {
    const createElement = document.createElement.bind(document);
    const drawOrder: string[] = [];
    const outputCanvas = createElement('canvas');

    Object.defineProperty(outputCanvas, 'getContext', {
      configurable: true,
      value: () => ({
        clearRect: vi.fn(),
        drawImage: (source: HTMLCanvasElement) => {
          drawOrder.push(source.dataset.layer ?? 'unknown');
        },
      }),
    });
    Object.defineProperty(outputCanvas, 'toDataURL', {
      configurable: true,
      value: () => 'data:image/jpeg;base64,mock',
    });

    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'canvas') {
        return outputCanvas;
      }
      return createElement(tagName);
    }) as typeof document.createElement);

    const backgroundCanvas = createElement('canvas');
    backgroundCanvas.dataset.layer = 'background';
    const foregroundCanvas = createElement('canvas');
    foregroundCanvas.dataset.layer = 'foreground';
    const rendererCanvas = createElement('canvas');
    rendererCanvas.dataset.layer = 'shirt';
    const armOverlayCanvas = createElement('canvas');
    armOverlayCanvas.dataset.layer = 'arm-overlay';
    const poseCanvas = createElement('canvas');
    poseCanvas.dataset.layer = 'pose';

    const dataUrl = composeCaptureFrame({
      backgroundCanvas,
      foregroundCanvas,
      rendererCanvas,
      armOverlayCanvas,
      poseCanvas,
      outputWidth: 960,
      outputHeight: 540,
      showPosePoints: true,
    });

    expect(dataUrl).toBe('data:image/jpeg;base64,mock');
    expect(drawOrder).toEqual(['background', 'foreground', 'shirt', 'arm-overlay', 'pose']);

    createElementSpy.mockRestore();
  });
});
