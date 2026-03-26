import * as mm from 'music-metadata-browser';
import { Track } from './types';

export async function extractMetadata(file: File): Promise<Partial<Track>> {
  try {
    const metadata = await mm.parseBlob(file);
    const { common, format } = metadata;
    
    let coverUrl: string | undefined;
    if (common.picture && common.picture.length > 0) {
      const picture = common.picture[0];
      const blob = new Blob([picture.data], { type: picture.format });
      coverUrl = URL.createObjectURL(blob);
    }

    return {
      title: common.title || file.name.replace(/\.[^/.]+$/, ""),
      artist: common.artist || 'Unknown Artist',
      album: common.album || 'Unknown Album',
      duration: format.duration || 0,
      coverUrl,
      format: file.type || 'audio/unknown',
      trackNumber: common.track.no || undefined,
    };
  } catch (error) {
    console.error('Error extracting metadata:', error);
    return {
      title: file.name.replace(/\.[^/.]+$/, ""),
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      duration: 0,
      format: file.type || 'audio/unknown',
    };
  }
}
