import { describe, it, expect, afterEach, vi } from 'vitest';
import { getDeviceType } from '@/hooks/useDeviceType';

describe('getDeviceType', () => {
  afterEach(() => vi.unstubAllGlobals());

  const at = (width: number, height: number) => {
    vi.stubGlobal('window', { innerWidth: width, innerHeight: height });
    return getDeviceType();
  };

  it('makes a small tablet from 640 px, so iPhone Duo\'s inner display gets two panes (#1289)', () => {
    expect(at(639, 951)).toBe('mobile');
    expect(at(640, 951)).toBe('tablet');
    expect(at(669, 951)).toBe('tablet');
    expect(at(1023, 1366)).toBe('tablet');
    expect(at(1024, 1366)).toBe('desktop');
  });

  it('keeps a phone held sideways a phone (#832)', () => {
    expect(at(852, 393)).toBe('mobile');
    expect(at(852, 500)).toBe('tablet');
  });
});
