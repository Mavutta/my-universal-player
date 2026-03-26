import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { Howl, Howler } from 'howler';

let ffmpeg: FFmpeg | null = null;

export async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;
  
  ffmpeg = new FFmpeg();
  
  // Load ffmpeg from CDN
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  
  return ffmpeg;
}

/**
 * Decodes non-native audio formats to WAV using FFmpeg WASM
 * so that the browser can play it.
 */
export async function decodeToWav(file: File): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const inputName = `input.${ext}`;
  const outputName = 'output.wav';

  await ffmpeg.writeFile(inputName, await fetchFile(file));
  
  // Convert to WAV
  // -i input -acodec pcm_s16le -ar 44100 output.wav
  await ffmpeg.exec(['-i', inputName, '-acodec', 'pcm_s16le', '-ar', '44100', outputName]);
  
  const data = await ffmpeg.readFile(outputName);
  // Cleanup
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);
  
  return new Blob([data], { type: 'audio/wav' });
}

/**
 * Checks if a file format is natively supported by the browser.
 */
export function isNativelySupported(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!ext) return false;

  // Use Howler's codec check for robust detection
  if (Howler.codecs(ext)) return true;
  
  const audio = document.createElement('audio');
  const canPlay = audio.canPlayType(file.type || `audio/${ext}`);
  
  return canPlay === 'probably' || canPlay === 'maybe';
}

/**
 * Checks if a format is lossless.
 */
export function isLossless(format: string, fileName: string): boolean {
  const f = format.toLowerCase();
  const ext = fileName.split('.').pop()?.toLowerCase();
  
  return (
    f.includes('flac') || 
    f.includes('wav') || 
    f.includes('alac') || 
    f.includes('aiff') ||
    ext === 'flac' ||
    ext === 'wav' ||
    ext === 'alac' ||
    ext === 'aiff'
  );
}
