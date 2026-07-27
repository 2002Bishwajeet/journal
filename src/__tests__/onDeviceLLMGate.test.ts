// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { isOnDeviceLLMAvailable } from '@/lib/featureFlags';

const UA = {
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  iPhoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  androidPhoneChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  androidTabletChrome:
    'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  // iPadOS 13+ masquerades as desktop Safari; maxTouchPoints is the only tell.
  iPadOSDesktopMode:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
};

function setPlatform(opts: { ua: string; webgpu: boolean; maxTouchPoints?: number }) {
  Object.defineProperty(navigator, 'userAgent', { value: opts.ua, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value: opts.maxTouchPoints ?? 0,
    configurable: true,
  });
  if (opts.webgpu) {
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
  } else {
    Reflect.deleteProperty(navigator, 'gpu');
  }
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'gpu');
});

describe('isOnDeviceLLMAvailable', () => {
  it('should allow a desktop browser that exposes WebGPU', () => {
    setPlatform({ ua: UA.macChrome, webgpu: true });
    expect(isOnDeviceLLMAvailable()).toBe(true);

    setPlatform({ ua: UA.windowsChrome, webgpu: true });
    expect(isOnDeviceLLMAvailable()).toBe(true);
  });

  it('should refuse a desktop browser without WebGPU', () => {
    setPlatform({ ua: UA.macChrome, webgpu: false });
    expect(isOnDeviceLLMAvailable()).toBe(false);
  });

  it('should refuse iOS, which has no WebGPU in WKWebView', () => {
    setPlatform({ ua: UA.iPhoneSafari, webgpu: false });
    expect(isOnDeviceLLMAvailable()).toBe(false);
  });

  it('should refuse a phone even when WebGPU is present', () => {
    setPlatform({ ua: UA.androidPhoneChrome, webgpu: true });
    expect(isOnDeviceLLMAvailable()).toBe(false);

    setPlatform({ ua: UA.iPhoneSafari, webgpu: true });
    expect(isOnDeviceLLMAvailable()).toBe(false);
  });

  it('should refuse an Android tablet, whose UA carries no Mobile token', () => {
    setPlatform({ ua: UA.androidTabletChrome, webgpu: true });
    expect(isOnDeviceLLMAvailable()).toBe(false);
  });

  it('should refuse iPadOS in desktop mode via maxTouchPoints', () => {
    setPlatform({ ua: UA.iPadOSDesktopMode, webgpu: true, maxTouchPoints: 5 });
    expect(isOnDeviceLLMAvailable()).toBe(false);
  });

  it('should not mistake a touchscreen desktop for a tablet', () => {
    setPlatform({ ua: UA.windowsChrome, webgpu: true, maxTouchPoints: 10 });
    expect(isOnDeviceLLMAvailable()).toBe(true);
  });
});

describe('initWebLLM gating', () => {
  it('should return false without loading the model when the platform is gated', async () => {
    setPlatform({ ua: UA.iPhoneSafari, webgpu: false });
    const { initWebLLM, isWebLLMReady } = await import('@/lib/webllm/engine');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await initWebLLM()).toBe(false);
    expect(isWebLLMReady()).toBe(false);
    // Bailed out on the gate, not on a failed model load.
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    warn.mockRestore();
    error.mockRestore();
  });
});
