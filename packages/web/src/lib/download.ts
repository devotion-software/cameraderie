import type { DownloadQuality } from '@cameraderie/shared';
import { API_URL } from './config';

/** Labels for the full quality picker (photo albums, mixed selections). */
export const QUALITY_OPTIONS: { value: DownloadQuality; label: string }[] = [
  { value: 'original', label: 'Original (best)' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

/** Videos only ever have one non-original tier, so offer a simpler choice. */
export const VIDEO_QUALITY_OPTIONS: { value: DownloadQuality; label: string }[] = [
  { value: 'original', label: 'Original (best)' },
  { value: 'high', label: 'Compressed' },
];

function qualityQuery(quality: DownloadQuality): string {
  return quality === 'original' ? '' : `?quality=${quality}`;
}

/** Download one media item's bytes at the given quality via an anchor click. */
export async function downloadOne(
  mediaId: string,
  filename: string,
  quality: DownloadQuality,
): Promise<void> {
  if (quality === 'original') {
    const res = await fetch(`${API_URL}/media/${mediaId}/download`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to download ${filename}`);
    const { url } = (await res.json()) as { url: string };
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    return;
  }

  const res = await fetch(`${API_URL}/media/${mediaId}/download${qualityQuery(quality)}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Failed to download ${filename}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** POST a batch of media ids to the zip endpoint at a given quality and save the result. */
export async function requestZip(
  mediaIds: string[],
  quality: DownloadQuality,
  filename: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/media/zip`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mediaIds, quality }),
  });
  if (!res.ok) throw new Error('Failed to build zip');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
