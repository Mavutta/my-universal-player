import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

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
  const inputName = 'input' + file.name.substring(file.name.lastIndexOf('.'));
  const outputName = 'output.wav';

  await ffmpeg.writeFile(inputName, await fetchFile(file));
  
  // Convert to WAV
  // -i input -acodec pcm_s16le -ar 44100 output.wav
  await ffmpeg.exec(['-i', inputName, '-acodec', 'pcm_s16le', '-ar', '44100', outputName]);
  
  const data = await ffmpeg.readFile(outputName);
  return new Blob([data], { type: 'audio/wav' });
}

/**
 * Checks if a file format is natively supported by the browser.
 */
export function isNativelySupported(file: File): boolean {
  const audio = document.createElement('audio');
  return audio.canPlayType(file.type) !== '';
}
