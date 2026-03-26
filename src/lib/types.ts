export interface Track {
  id: string;
  file: File;
  title: string;
  artist: string;
  album: string;
  genre: string;
  duration: number;
  coverUrl?: string;
  format: string;
  trackNumber?: number;
  path?: string; // For folder navigation
  isFavorite?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

export interface AudioSettings {
  eqGains: number[]; // 10 values for 10 bands
  preAmpGain: number; // in dB
  isReverbEnabled: boolean;
  isCompressionEnabled: boolean;
  isLimiterEnabled: boolean;
  isStereoWidenerEnabled: boolean;
  isMonoEnabled: boolean;
  isNormalizationEnabled: boolean;
  stereoWidenerAmount: number; // 0 to 1
  crossfadeTime: number;
}

export interface PlayerState {
  currentTrackIndex: number;
  isPlaying: boolean;
  volume: number;
  isShuffle: boolean;
  isRepeat: boolean;
  currentTime: number;
  duration: number;
  activeTab: 'tracks' | 'albums' | 'artists' | 'genres' | 'playlists' | 'folders' | 'settings' | 'favorites' | 'console';
}
