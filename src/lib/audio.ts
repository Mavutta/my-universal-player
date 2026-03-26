import { FLACDecoder } from '@wasm-audio-decoders/flac';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;

export async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;
  ffmpeg = new FFmpeg();
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  return ffmpeg;
}

/**
 * Decodes audio using specialized WASM decoders or FFmpeg fallback
 */
export async function decodeToWav(file: File): Promise<Blob> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  try {
    if (ext === 'flac') {
      const decoder = new FLACDecoder();
      const result = await decoder.decode(uint8Array);
      return pcmToWav(result.channelData, result.sampleRate);
    }
  } catch (e) {
    console.warn(`Specialized decoder failed for ${ext}, falling back to FFmpeg`, e);
  }

  // Fallback to FFmpeg for other formats (ALAC, AIFF, etc.)
  const ffmpeg = await getFFmpeg();
  const inputName = `input.${ext}`;
  const outputName = 'output.wav';

  await ffmpeg.writeFile(inputName, uint8Array);
  await ffmpeg.exec(['-i', inputName, '-acodec', 'pcm_s16le', '-ar', '48000', outputName]);
  
  const data = await ffmpeg.readFile(outputName);
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);
  
  return new Blob([data], { type: 'audio/wav' });
}

/**
 * Helper to convert PCM data to WAV Blob
 */
function pcmToWav(channelData: Float32Array[], sampleRate: number): Blob {
  const numChannels = channelData.length;
  const length = channelData[0].length * numChannels * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  view.setUint32(4, length - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length - 44, true);

  let offset = 44;
  for (let i = 0; i < channelData[0].length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const s = Math.max(-1, Math.min(1, channelData[channel][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export function isNativelySupported(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!ext) return false;
  const audio = document.createElement('audio');
  const canPlay = audio.canPlayType(file.type || `audio/${ext}`);
  return canPlay === 'probably' || canPlay === 'maybe';
}

export function isLossless(format: string, fileName: string): boolean {
  const f = format.toLowerCase();
  const ext = fileName.split('.').pop()?.toLowerCase();
  return (
    f.includes('flac') || f.includes('wav') || f.includes('alac') || f.includes('aiff') ||
    ['flac', 'wav', 'alac', 'aiff'].includes(ext || '')
  );
}
