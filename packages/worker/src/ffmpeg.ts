import { spawn } from 'node:child_process';
import { loadEnv } from './env.js';

function ffmpegBin(): string {
  return loadEnv().FFMPEG_PATH || 'ffmpeg';
}
function ffprobeBin(): string {
  return loadEnv().FFPROBE_PATH || 'ffprobe';
}

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

export interface ProbeResult {
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/** Read dimensions + duration of a video (or image) file. */
export async function probe(inputPath: string): Promise<ProbeResult> {
  const { stdout } = await run(ffprobeBin(), [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height:format=duration',
    '-of',
    'json',
    inputPath,
  ]);
  const json = JSON.parse(stdout) as {
    streams?: { width?: number; height?: number }[];
    format?: { duration?: string };
  };
  const stream = json.streams?.[0];
  const durationSec = json.format?.duration ? Number.parseFloat(json.format.duration) : null;
  return {
    width: stream?.width ?? null,
    height: stream?.height ?? null,
    durationMs: durationSec !== null && !Number.isNaN(durationSec) ? Math.round(durationSec * 1000) : null,
  };
}

/** Extract a single representative frame to a PNG file. */
export async function extractFrame(inputPath: string, outputPath: string): Promise<void> {
  // Seek a little in so we don't grab a black lead-in frame.
  await run(ffmpegBin(), [
    '-ss',
    '1',
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-f',
    'image2',
    '-y',
    outputPath,
  ]);
}

/** Transcode a streamable H.264 preview, scaled down, with faststart. */
export async function transcodePreview(
  inputPath: string,
  outputPath: string,
  maxEdge: number,
  crf: number,
): Promise<void> {
  await run(ffmpegBin(), [
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
  ]);
}
