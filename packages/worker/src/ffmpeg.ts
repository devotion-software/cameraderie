import { spawn } from 'node:child_process';
import { loadEnv } from './env.js';

function ffmpegBin(): string {
  return loadEnv().FFMPEG_PATH || 'ffmpeg';
}
function ffprobeBin(): string {
  return loadEnv().FFPROBE_PATH || 'ffprobe';
}

function run(
  bin: string,
  args: string[],
  timeoutSeconds: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // `timeout` kills the child with `killSignal` once the wall-clock limit is hit,
    // so a hung/runaway decode can't pin a worker slot indefinitely.
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutSeconds * 1000,
      killSignal: 'SIGKILL',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else if (signal)
        reject(
          new Error(
            `${bin} killed by ${signal} (timeout ${timeoutSeconds}s): ${stderr.slice(-500)}`,
          ),
        );
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/**
 * Input options that MUST precede `-i`. Restricting the protocol whitelist to
 * local protocols blocks SSRF / remote-URL fetches: a crafted file that probes as
 * HLS/DASH/concat can no longer make ffmpeg open http/tcp/rtmp targets.
 */
const INPUT_GUARD = ['-protocol_whitelist', 'file,crypto,data'];

export interface ProbeResult {
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/** Read dimensions + duration of a video (or image) file. */
export async function probe(inputPath: string): Promise<ProbeResult> {
  const env = loadEnv();
  const { stdout } = await run(
    ffprobeBin(),
    [
      '-v',
      'error',
      ...INPUT_GUARD,
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height:format=duration',
      '-of',
      'json',
      inputPath,
    ],
    env.FFPROBE_TIMEOUT_SECONDS,
  );
  const json = JSON.parse(stdout) as {
    streams?: { width?: number; height?: number }[];
    format?: { duration?: string };
  };
  const stream = json.streams?.[0];
  const durationSec = json.format?.duration ? Number.parseFloat(json.format.duration) : null;
  return {
    width: stream?.width ?? null,
    height: stream?.height ?? null,
    durationMs:
      durationSec !== null && !Number.isNaN(durationSec) ? Math.round(durationSec * 1000) : null,
  };
}

/**
 * Extract a single representative frame to a PNG file.
 *
 * `seekSeconds` skips a little into the input first so video thumbnails don't
 * grab a black lead-in frame. Still-image inputs (a RAW's embedded preview, or
 * a HEIC libvips can't decode) have no lead-in to skip — seeking past their
 * single frame produces an empty output — so callers extracting from a still
 * must pass 0.
 */
export async function extractFrame(
  inputPath: string,
  outputPath: string,
  seekSeconds = 1,
): Promise<void> {
  const env = loadEnv();
  await run(
    ffmpegBin(),
    [
      '-timelimit',
      String(env.FFMPEG_TIMEOUT_SECONDS),
      '-threads',
      String(env.FFMPEG_THREADS),
      ...INPUT_GUARD,
      ...(seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-update',
      '1',
      '-f',
      'image2',
      '-y',
      outputPath,
    ],
    env.FFMPEG_TIMEOUT_SECONDS,
  );
}

/** Transcode a streamable H.264 preview, scaled down, with faststart. */
export async function transcodePreview(
  inputPath: string,
  outputPath: string,
  maxEdge: number,
  crf: number,
): Promise<void> {
  const env = loadEnv();
  await run(
    ffmpegBin(),
    [
      '-timelimit',
      String(env.FFMPEG_TIMEOUT_SECONDS),
      '-threads',
      String(env.FFMPEG_THREADS),
      ...INPUT_GUARD,
      '-i',
      inputPath,
      '-vf',
      `scale='if(gt(iw,ih),min(${maxEdge},iw),-2)':'if(gt(iw,ih),-2,min(${maxEdge},ih))'`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      String(crf),
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      '-y',
      outputPath,
    ],
    env.FFMPEG_TIMEOUT_SECONDS,
  );
}
