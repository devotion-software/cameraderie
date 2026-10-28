export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** "f/2.8" — trims trailing zeros (f/2 rather than f/2.0). */
export function formatAperture(fNumber: number | null): string | null {
  if (fNumber == null) return null;
  return `f/${Number(fNumber.toFixed(1)).toString()}`;
}

/** "1/250 s" for fast exposures, "2.5 s" for slow ones. */
export function formatShutterSpeed(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  if (seconds < 1) return `1/${Math.round(1 / seconds)} s`;
  return `${Number(seconds.toFixed(1))} s`;
}

/** "50mm" — trims trailing zeros. */
export function formatFocalLength(mm: number | null): string | null {
  if (mm == null) return null;
  return `${Number(mm.toFixed(1))}mm`;
}
