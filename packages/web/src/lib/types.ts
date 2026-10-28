/** Mirrors the API response shapes (see packages/api/src/serialize.ts). */

import type { DownloadQuality } from '@cameraderie/shared';

export interface Group {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  coverMediaId: string | null;
  coverThumbnailUrl: string | null;
  createdAt: string;
  myRole?: 'owner' | 'admin' | 'member';
  mediaCount: number;
  photoCount: number;
  videoCount: number;
  totalBytes: number;
}

export interface MediaItem {
  id: string;
  groupId: string;
  uploaderId: string;
  uploaderName: string | null;
  uploaderAvatarUrl: string | null;
  kind: 'image' | 'raw' | 'video';
  state: 'pending' | 'uploading' | 'processing' | 'ready' | 'failed';
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  capturedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  apertureF: number | null;
  shutterSpeedSec: number | null;
  iso: number | null;
  focalLengthMm: number | null;
  flash: string | null;
  orientation: string | null;
  exposureProgram: string | null;
  whiteBalance: string | null;
  createdAt: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  favouriteCount: number;
  favourited: boolean;
}

export interface MediaLocation {
  id: string;
  kind: 'image' | 'raw' | 'video';
  filename: string;
  latitude: number;
  longitude: number;
}

export interface Member {
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
  name: string;
  email: string;
  image: string | null;
  avatarUrl: string | null;
  photoCount: number;
}

export interface Invite {
  id: string;
  code: string;
  inviteeEmail: string | null;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  plan: string;
  acceptedTermsAt: string | null;
  avatarUrl: string | null;
  defaultKeepGps: boolean;
  defaultKeepCameraExif: boolean;
  defaultDownloadQuality: DownloadQuality;
}

export interface Usage {
  usedBytes: number;
  quotaBytes: number;
  plan: string;
  readOnly: boolean;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  canCreateGroups: boolean;
  canInviteMembers: boolean;
  disabledAt: string | null;
  createdAt: string;
}
