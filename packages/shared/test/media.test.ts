import { describe, it, expect } from 'vitest';
import {
  classifyMedia,
  extensionOf,
  originalKey,
  thumbnailKey,
  previewKey,
  beginUploadBody,
} from '@cameraderie/shared';

describe('classifyMedia', () => {
  it('classifies common images', () => {
    expect(classifyMedia('photo.jpg')).toBe('image');
    expect(classifyMedia('photo.HEIC')).toBe('image');
    expect(classifyMedia('scan.png', 'image/png')).toBe('image');
  });

  it('classifies RAW before generic image', () => {
    expect(classifyMedia('IMG_0001.dng')).toBe('raw');
    expect(classifyMedia('shot.CR3')).toBe('raw');
    expect(classifyMedia('x', 'image/x-sony-arw')).toBe('raw');
  });

  it('classifies videos by extension or mime', () => {
    expect(classifyMedia('clip.mov')).toBe('video');
    expect(classifyMedia('clip.mp4')).toBe('video');
    expect(classifyMedia('weird', 'video/webm')).toBe('video');
  });

  it('falls back to image for unknown types', () => {
    expect(classifyMedia('mystery')).toBe('image');
  });
});

describe('extensionOf', () => {
  it('extracts and lowercases the extension', () => {
    expect(extensionOf('a.JPG')).toBe('jpg');
    expect(extensionOf('a.b.c.mov')).toBe('mov');
  });
  it('returns empty when there is none', () => {
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('trailingdot.')).toBe('');
  });
});

describe('R2 keys', () => {
  const id = '1111';
  it('preserves the original extension', () => {
    expect(originalKey(id, 'a.MOV')).toBe('originals/1111/original.mov');
    expect(originalKey(id, 'noext')).toBe('originals/1111/original');
  });
  it('derives thumbnail + preview keys by media kind', () => {
    expect(thumbnailKey(id)).toBe('derivatives/1111/thumb.webp');
    expect(previewKey(id, 'image')).toBe('derivatives/1111/preview.webp');
    expect(previewKey(id, 'video')).toBe('derivatives/1111/preview.mp4');
  });
});

describe('beginUploadBody validation', () => {
  const base = {
    groupId: 'g1',
    filename: 'a.jpg',
    sizeBytes: 100,
    checksumSha256: 'a'.repeat(64),
  };
  it('accepts a valid body', () => {
    expect(beginUploadBody.safeParse(base).success).toBe(true);
  });
  it('rejects a bad checksum', () => {
    expect(beginUploadBody.safeParse({ ...base, checksumSha256: 'short' }).success).toBe(false);
  });
  it('rejects non-positive size', () => {
    expect(beginUploadBody.safeParse({ ...base, sizeBytes: 0 }).success).toBe(false);
  });
});
