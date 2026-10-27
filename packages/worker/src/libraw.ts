import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { loadEnv } from './env.js';

function dcrawBin(): string {
  return loadEnv().DCRAW_EMU_PATH || 'dcraw_emu';
}

/**
 * Decode a camera RAW file to a TIFF that libvips/sharp can read, using libraw's
 * `dcraw_emu`. This gives a real demosaiced rendering of the sensor data —
 * better than pulling the embedded JPEG preview — while leaving the original
 * RAW untouched.
 *
 * `dcraw_emu -T -o 1 -w <input>` writes `<input>.tiff` (sRGB, camera white
 * balance). Returns the output path.
 */
export async function decodeRawToTiff(inputPath: string): Promise<string> {
  await run(dcrawBin(), ['-T', '-o', '1', '-w', inputPath], loadEnv().DCRAW_TIMEOUT_SECONDS);
  const out = `${inputPath}.tiff`;
  await access(out); // throws if dcraw_emu produced nothing
  return out;
}

function run(bin: string, args: string[], timeoutSeconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // Wall-clock kill: a pathological RAW (huge demosaic / hang) can't pin a slot.
    const child = spawn(bin, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: timeoutSeconds * 1000,
      killSignal: 'SIGKILL',
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else if (signal)
        reject(new Error(`${bin} killed by ${signal} (timeout ${timeoutSeconds}s): ${stderr.slice(-500)}`));
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}
