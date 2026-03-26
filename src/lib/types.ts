export interface Track {
  id: string;
  file: File;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl?: string;
  format: string;
  trackNumber?: number;
}

export interface PlayerState {
  currentTrackIndex: number;
  isPlaying: boolean;
  volume: number;
  isShuffle: boolean;
  isRepeat: boolean;
  currentTime: number;
  duration: number;
}
