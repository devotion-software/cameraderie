/** Mirrors the API response shapes (see packages/api/src/serialize.ts). */

export interface Group {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  myRole?: 'owner' | 'admin' | 'member';
}

export interface MediaItem {
  id: string;
  groupId: string;
  uploaderId: string;
  kind: 'image' | 'raw' | 'video';
  state: 'pending' | 'uploading' | 'processing' | 'ready' | 'failed';
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  capturedAt: string | null;
  createdAt: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  favouriteCount: number;
  favourited: boolean;
}

export interface Member {
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
  name: string;
  email: string;
  image: string | null;
}

export interface Usage {
  usedBytes: number;
  quotaBytes: number;
  plan: string;
  readOnly: boolean;
}
