import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(`../../src-tauri/icons/${file}`, import.meta.url));
const config = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));

const pngSize = (file: string) => {
  const png = read(file);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
};

describe('desktop icons (scripts/generate-desktop-icons.mjs)', () => {
  it('has every PNG size the bundle config and Linux need', () => {
    expect(pngSize('32x32.png')).toEqual([32, 32]);
    expect(pngSize('64x64.png')).toEqual([64, 64]);
    expect(pngSize('128x128.png')).toEqual([128, 128]);
    expect(pngSize('128x128@2x.png')).toEqual([256, 256]);
    expect(pngSize('icon.png')).toEqual([512, 512]);
  });

  it('has a Windows icon with every size from 16 to 256 px', () => {
    const ico = read('icon.ico');
    expect(ico.readUInt16LE(2)).toBe(1);
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16] || 256);
    expect(sizes).toEqual(expect.arrayContaining([16, 32, 48, 256]));
  });

  it('has a macOS icon', () => {
    expect(read('icon.icns').subarray(0, 4).toString()).toBe('icns');
  });

  it('lists only icons that exist', () => {
    for (const icon of config.bundle.icon as string[]) {
      expect(() => read(icon.replace('icons/', ''))).not.toThrow();
    }
  });
});
