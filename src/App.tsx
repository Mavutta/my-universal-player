import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, 
  List, Search, Plus, Music, Volume2, VolumeX,
  Disc, Heart, Share2, MoreHorizontal, X, Trash2, 
  GripVertical, LayoutGrid, Users, Folder, Settings,
  ChevronRight, ChevronDown, FolderOpen, Sliders,
  Check, Save, RotateCcw, Maximize2, Minimize2,
  Library, Mic2, Zap, Clock, TrendingUp, Award
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Track, Playlist, AudioSettings, PlayerState } from './lib/types';
import { extractMetadata } from './lib/metadata';
import { isNativelySupported, decodeToWav, isLossless } from './lib/audio';
import { cn, formatTime } from './lib/utils';
import Visualizer from './components/Visualizer';
import AudioConsole from './components/AudioConsole';
import { AudioEngine } from './lib/audioEngine';
import { db } from './lib/db';
import { EQ_PRESETS } from './lib/constants';

export default function App() {
  // --- Persistence ---
  const tracks = useLiveQuery(() => db.tracks.toArray()) || [];
  const playlists = useLiveQuery(() => db.playlists.toArray()) || [];

  // --- State ---
  const [nowPlayingQueue, setNowPlayingQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);
  const [activeTab, setActiveTab] = useState<PlayerState['activeTab']>('tracks');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);
  const [isNewPlaylistModalOpen, setIsNewPlaylistModalOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [tracksToAddToPlaylist, setTracksToAddToPlaylist] = useState<Track[]>([]);
  const [isAddToPlaylistModalOpen, setIsAddToPlaylistModalOpen] = useState(false);
  const [isDeleteConfirmationModalOpen, setIsDeleteConfirmationModalOpen] = useState(false);
  const [isEQModalOpen, setIsEQModalOpen] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>('');
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('favorites');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  
  // Audio Settings
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(() => {
    const saved = localStorage.getItem('audioSettings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Basic validation to ensure we don't have NaN in critical numeric fields
        if (
          Array.isArray(parsed.eqGains) && 
          parsed.eqGains.every((v: any) => typeof v === 'number' && Number.isFinite(v)) &&
          typeof parsed.preAmpGain === 'number' && Number.isFinite(parsed.preAmpGain) &&
          typeof parsed.stereoWidenerAmount === 'number' && Number.isFinite(parsed.stereoWidenerAmount)
        ) {
          return parsed;
        }
      } catch (e) {
        console.error('Failed to parse audio settings', e);
      }
    }
    return {
      eqGains: EQ_PRESETS.Flat,
      preAmpGain: 0,
      isReverbEnabled: false,
      isCompressionEnabled: true,
      isLimiterEnabled: true,
      isStereoWidenerEnabled: false,
      isMonoEnabled: false,
      isNormalizationEnabled: true,
      stereoWidenerAmount: 0.5,
      crossfadeTime: 0, // Default to gapless (0s)
    };
  });

  // --- Refs ---
  const audio1Ref = useRef<HTMLAudioElement>(null);
  const audio2Ref = useRef<HTMLAudioElement>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeAudioRef = useRef<1 | 2>(1);
  const preloadedTrackIdRef = useRef<string | null>(null);

  const currentTrack = currentIndex >= 0 ? nowPlayingQueue[currentIndex] : null;

  // --- Initialization ---
  useEffect(() => {
    if (audio1Ref.current && audio2Ref.current && !engineRef.current) {
      engineRef.current = new AudioEngine(audio1Ref.current, audio2Ref.current);
      engineRef.current.setEQ(audioSettings.eqGains);
      engineRef.current.setCompression(audioSettings.isCompressionEnabled);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('audioSettings', JSON.stringify(audioSettings));
    if (engineRef.current) {
      engineRef.current.setEQ(audioSettings.eqGains);
      engineRef.current.setPreAmp(audioSettings.preAmpGain);
      engineRef.current.setCompression(audioSettings.isCompressionEnabled);
      engineRef.current.setLimiter(audioSettings.isLimiterEnabled);
      engineRef.current.setStereoWidener(audioSettings.isStereoWidenerEnabled, audioSettings.stereoWidenerAmount);
      engineRef.current.setMono(audioSettings.isMonoEnabled);
      engineRef.current.setNormalization(audioSettings.isNormalizationEnabled);
    }
  }, [audioSettings]);

  useEffect(() => {
    localStorage.setItem('favorites', JSON.stringify(Array.from(favorites)));
  }, [favorites]);

  // --- Library Logic ---
  const favoriteTracks = useMemo(() => {
    return tracks.filter(t => favorites.has(t.id));
  }, [tracks, favorites]);

  const recentlyAdded = useMemo(() => {
    return [...tracks].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 50);
  }, [tracks]);

  const mostPlayed = useMemo(() => {
    return [...tracks].sort((a, b) => (b.playCount || 0) - (a.playCount || 0)).filter(t => (t.playCount || 0) > 0).slice(0, 50);
  }, [tracks]);

  const highResOnly = useMemo(() => {
    return tracks.filter(t => (t.sampleRate || 0) > 48000);
  }, [tracks]);

  const albums = useMemo(() => {
    const groups: Record<string, Track[]> = {};
    tracks.forEach(t => {
      const key = t.album || 'Unknown Album';
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return groups;
  }, [tracks]);

  const artists = useMemo(() => {
    const groups: Record<string, Track[]> = {};
    tracks.forEach(t => {
      const key = t.artist || 'Unknown Artist';
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return groups;
  }, [tracks]);

  const genres = useMemo(() => {
    const groups: Record<string, Track[]> = {};
    tracks.forEach(t => {
      const key = t.genre || 'Unknown Genre';
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return groups;
  }, [tracks]);

  const folderTree = useMemo(() => {
    const tree: any = {};
    tracks.forEach(t => {
      const parts = (t.path || t.file.name).split('/');
      let current = tree;
      parts.forEach((part, i) => {
        if (i === parts.length - 1) {
          if (!current._files) current._files = [];
          current._files.push(t);
        } else {
          if (!current[part]) current[part] = {};
          current = current[part];
        }
      });
    });
    return tree;
  }, [tracks]);

  // --- Handlers ---
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsLoading(true);
    const newTracks: Track[] = [];
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      const supportedExts = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'webm'];
      
      if (!file.type.startsWith('audio/') && (!ext || !supportedExts.includes(ext))) continue;
      
      const metadata = await extractMetadata(file);
      const track: Track = {
        id: crypto.randomUUID(),
        file,
        title: metadata.title || file.name.replace(/\.[^/.]+$/, ""),
        artist: metadata.artist || 'Unknown Artist',
        album: metadata.album || 'Unknown Album',
        genre: metadata.genre || 'Unknown Genre',
        duration: metadata.duration || 0,
        coverUrl: metadata.coverUrl,
        format: metadata.format || file.type || ext || 'unknown',
        trackNumber: metadata.trackNumber,
        path: (file as any).webkitRelativePath || file.name,
        isFavorite: false,
        playCount: 0,
        addedAt: Date.now(),
        sampleRate: metadata.sampleRate || 0
      };
      newTracks.push(track);
    }
    
    if (newTracks.length > 0) {
      await db.tracks.bulkAdd(newTracks);
    }
    setIsLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleFavorite = async (trackId: string) => {
    const newFavorites = new Set(favorites);
    if (newFavorites.has(trackId)) {
      newFavorites.delete(trackId);
    } else {
      newFavorites.add(trackId);
    }
    setFavorites(newFavorites);
    await db.tracks.update(trackId, { isFavorite: newFavorites.has(trackId) });
  };

  const playNextTrack = (track: Track) => {
    const newQueue = [...nowPlayingQueue];
    newQueue.splice(currentIndex + 1, 0, track);
    setNowPlayingQueue(newQueue);
  };

  const addToQueue = (track: Track) => {
    setNowPlayingQueue([...nowPlayingQueue, track]);
  };

  const clearQueue = () => {
    setNowPlayingQueue([]);
    setCurrentIndex(-1);
    setIsPlaying(false);
    if (audio1Ref.current) audio1Ref.current.src = '';
    if (audio2Ref.current) audio2Ref.current.src = '';
  };

  const preloadNextTrack = async (track: Track) => {
    preloadedTrackIdRef.current = track.id;
    const nextAudio = activeAudioRef.current === 1 ? audio2Ref.current : audio1Ref.current;
    if (!nextAudio) return;

    let url: string;
    if (isNativelySupported(track.file)) {
      url = URL.createObjectURL(track.file);
    } else {
      try {
        const wavBlob = await decodeToWav(track.file);
        url = URL.createObjectURL(wavBlob);
      } catch (err) {
        console.error('Pre-decoding failed', err);
        return;
      }
    }
    nextAudio.src = url;
    nextAudio.load();
  };

  const playTrack = useCallback(async (track: Track, queue: Track[] = tracks) => {
    setNowPlayingQueue(queue);
    const index = queue.findIndex(t => t.id === track.id);
    
    const nextAudio = activeAudioRef.current === 1 ? audio2Ref.current : audio1Ref.current;
    const currentAudio = activeAudioRef.current === 1 ? audio1Ref.current : audio2Ref.current;

    if (!nextAudio || !currentAudio) return;

    // Check if already pre-loaded
    if (preloadedTrackIdRef.current !== track.id) {
      let url: string;
      if (isNativelySupported(track.file)) {
        url = URL.createObjectURL(track.file);
      } else {
        setIsLoading(true);
        try {
          const wavBlob = await decodeToWav(track.file);
          url = URL.createObjectURL(wavBlob);
        } catch (err) {
          console.error('Decoding failed', err);
          setIsLoading(false);
          return;
        }
        setIsLoading(false);
      }
      nextAudio.src = url;
      nextAudio.load();
    }

    if (audioSettings.crossfadeTime > 0) {
      engineRef.current?.crossfade(activeAudioRef.current === 1 ? 2 : 1, audioSettings.crossfadeTime);
      nextAudio.play();
      activeAudioRef.current = activeAudioRef.current === 1 ? 2 : 1;
      
      setTimeout(() => {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }, audioSettings.crossfadeTime * 1000);
    } else {
      // Gapless transition
      currentAudio.pause();
      nextAudio.play();
      activeAudioRef.current = activeAudioRef.current === 1 ? 2 : 1;
    }

    setCurrentIndex(index);
    setIsPlaying(true);
    engineRef.current?.resume();
    preloadedTrackIdRef.current = null; // Reset pre-load ref

    // Increment play count
    await db.tracks.update(track.id, { playCount: (track.playCount || 0) + 1 });
  }, [tracks, audioSettings.crossfadeTime]);

  const togglePlay = () => {
    const audio = activeAudioRef.current === 1 ? audio1Ref.current : audio2Ref.current;
    if (!audio) return;
    if (isPlaying) audio.pause();
    else audio.play();
    setIsPlaying(!isPlaying);
  };

  const skipNext = useCallback(() => {
    if (nowPlayingQueue.length === 0) return;
    let nextIndex;
    if (isShuffle) {
      nextIndex = Math.floor(Math.random() * nowPlayingQueue.length);
    } else {
      nextIndex = (currentIndex + 1) % nowPlayingQueue.length;
    }
    playTrack(nowPlayingQueue[nextIndex], nowPlayingQueue);
  }, [nowPlayingQueue, isShuffle, currentIndex, playTrack]);

  const playPrev = () => {
    if (nowPlayingQueue.length === 0) return;
    const prevIndex = (currentIndex - 1 + nowPlayingQueue.length) % nowPlayingQueue.length;
    playTrack(nowPlayingQueue[prevIndex], nowPlayingQueue);
  };

  const createPlaylist = async () => {
    if (!newPlaylistName.trim()) return;
    await db.playlists.add({
      id: Math.random().toString(36).substr(2, 9),
      name: newPlaylistName.trim(),
      trackIds: [],
      createdAt: Date.now()
    });
    setNewPlaylistName('');
    setIsNewPlaylistModalOpen(false);
  };

  const addTrackToPlaylist = async (playlistId: string) => {
    if (tracksToAddToPlaylist.length === 0) return;
    const playlist = await db.playlists.get(playlistId);
    if (playlist) {
      const newTrackIds = tracksToAddToPlaylist.map(t => t.id);
      const updatedTrackIds = [...new Set([...playlist.trackIds, ...newTrackIds])];
      await db.playlists.update(playlistId, { trackIds: updatedTrackIds });
    }
    setTracksToAddToPlaylist([]);
    setIsAddToPlaylistModalOpen(false);
  };

  const handleBulkDelete = async () => {
    if (selectedTrackIds.size === 0) return;
    setIsDeleteConfirmationModalOpen(true);
  };

  const confirmBulkDelete = async () => {
    const idsToDelete = Array.from(selectedTrackIds);
    
    // 1. Delete from DB
    await db.tracks.bulkDelete(idsToDelete);
    
    // 2. Remove from now playing queue
    const newQueue = nowPlayingQueue.filter(t => !selectedTrackIds.has(t.id));
    if (newQueue.length !== nowPlayingQueue.length) {
      if (currentTrack && selectedTrackIds.has(currentTrack.id)) {
        setIsPlaying(false);
        setCurrentIndex(-1);
        if (audio1Ref.current) audio1Ref.current.src = '';
        if (audio2Ref.current) audio2Ref.current.src = '';
      }
      setNowPlayingQueue(newQueue);
      if (currentTrack && !selectedTrackIds.has(currentTrack.id)) {
        const newIdx = newQueue.findIndex(t => t.id === currentTrack.id);
        setCurrentIndex(newIdx);
      }
    }

    // 3. Remove from all playlists
    const allPlaylists = await db.playlists.toArray();
    for (const p of allPlaylists) {
      const updatedTrackIds = p.trackIds.filter(id => !selectedTrackIds.has(id));
      if (updatedTrackIds.length !== p.trackIds.length) {
        await db.playlists.update(p.id, { trackIds: updatedTrackIds });
      }
    }

    setSelectedTrackIds(new Set());
    setIsDeleteConfirmationModalOpen(false);
  };

  const handleBulkAddToPlaylist = () => {
    const selectedTracks = tracks.filter(t => selectedTrackIds.has(t.id));
    setTracksToAddToPlaylist(selectedTracks);
    setIsAddToPlaylistModalOpen(true);
  };

  const toggleTrackSelection = (id: string) => {
    const newSelection = new Set(selectedTrackIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedTrackIds(newSelection);
  };

  // --- Audio Events ---
  useEffect(() => {
    const audio1 = audio1Ref.current;
    const audio2 = audio2Ref.current;
    if (!audio1 || !audio2) return;

    const handleTimeUpdate = (e: Event) => {
      const audio = e.target as HTMLAudioElement;
      if ((activeAudioRef.current === 1 && audio === audio1) || (activeAudioRef.current === 2 && audio === audio2)) {
        setCurrentTime(audio.currentTime);
        setDuration(audio.duration);

        // Pre-load next track 5 seconds before end
        if (audio.duration > 0 && audio.duration - audio.currentTime < 5) {
          const nextIndex = (currentIndex + 1) % nowPlayingQueue.length;
          const nextTrack = nowPlayingQueue[nextIndex];
          if (nextTrack && preloadedTrackIdRef.current !== nextTrack.id) {
            preloadNextTrack(nextTrack);
          }
        }
      }
    };

    const handleEnded = () => {
      if (isRepeat) {
        const audio = activeAudioRef.current === 1 ? audio1 : audio2;
        audio.currentTime = 0;
        audio.play();
      } else {
        skipNext();
      }
    };

    audio1.addEventListener('timeupdate', handleTimeUpdate);
    audio2.addEventListener('timeupdate', handleTimeUpdate);
    audio1.addEventListener('ended', handleEnded);
    audio2.addEventListener('ended', handleEnded);

    return () => {
      audio1.removeEventListener('timeupdate', handleTimeUpdate);
      audio2.removeEventListener('timeupdate', handleTimeUpdate);
      audio1.removeEventListener('ended', handleEnded);
      audio2.removeEventListener('ended', handleEnded);
    };
  }, [skipNext, isRepeat]);

  // Volume
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setVolume(isMuted ? 0 : volume);
    }
  }, [volume, isMuted]);

  // --- Render Helpers ---
  const renderTabContent = () => {
    const filteredTracks = tracks.filter(t => 
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.artist.toLowerCase().includes(searchQuery.toLowerCase())
    );

    switch (activeTab) {
      case 'tracks':
        return (
          <div className="space-y-4 pb-32">
            {filteredTracks.length > 0 && (
              <div className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-xl border border-white/10">
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => {
                      if (selectedTrackIds.size === filteredTracks.length) {
                        setSelectedTrackIds(new Set());
                      } else {
                        setSelectedTrackIds(new Set(filteredTracks.map(t => t.id)));
                      }
                    }}
                    className={cn(
                      "w-5 h-5 rounded border transition-all flex items-center justify-center",
                      selectedTrackIds.size === filteredTracks.length && filteredTracks.length > 0
                        ? "bg-emerald-500 border-emerald-500" 
                        : "border-white/20 hover:border-white/40"
                    )}
                  >
                    {selectedTrackIds.size === filteredTracks.length && filteredTracks.length > 0 && <Check size={14} className="text-black" />}
                  </button>
                  <span className="text-sm font-medium text-white/60">
                    {selectedTrackIds.size > 0 ? `${selectedTrackIds.size} selected` : 'Select All'}
                  </span>
                </div>
                {selectedTrackIds.size > 0 && (
                  <button 
                    onClick={() => setSelectedTrackIds(new Set())}
                    className="text-xs text-white/40 hover:text-white transition-colors"
                  >
                    Clear Selection
                  </button>
                )}
              </div>
            )}
            <div className="space-y-2">
              {filteredTracks.map((track) => (
                <TrackItem 
                  key={track.id} 
                  track={track} 
                  isActive={currentTrack?.id === track.id}
                  isSelected={selectedTrackIds.has(track.id)}
                  isFavorite={favorites.has(track.id)}
                  onClick={() => {
                    if (selectedTrackIds.size > 0) {
                      toggleTrackSelection(track.id);
                    } else {
                      playTrack(track, tracks);
                    }
                  }}
                  onSelect={() => toggleTrackSelection(track.id)}
                  onToggleFavorite={() => toggleFavorite(track.id)}
                  isPlaying={isPlaying}
                  onAddToPlaylist={() => {
                    setTracksToAddToPlaylist([track]);
                    setIsAddToPlaylistModalOpen(true);
                  }}
                  onPlayNext={() => playNextTrack(track)}
                  onAddToQueue={() => addToQueue(track)}
                />
              ))}
            </div>
          </div>
        );
      case 'favorites':
        return (
          <div className="space-y-6 pb-32">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-3xl font-bold flex items-center gap-3">
                <Heart className="text-red-500" fill="currentColor" size={32} />
                Favorites
              </h2>
              <button 
                onClick={() => favoriteTracks.length > 0 && playTrack(favoriteTracks[0], favoriteTracks)}
                className="px-6 py-3 bg-red-500 text-white rounded-xl font-bold hover:bg-red-400 transition-colors flex items-center gap-2"
              >
                <Play size={20} fill="currentColor" />
                Play All
              </button>
            </div>
            <div className="space-y-2">
              {favoriteTracks.length === 0 ? (
                <div className="text-center py-20 text-white/20">
                  <Heart size={64} className="mx-auto mb-4 opacity-10" />
                  <p>No favorites yet. Heart some tracks to see them here!</p>
                </div>
              ) : (
                favoriteTracks.map((track) => (
                  <TrackItem 
                    key={track.id} 
                    track={track} 
                    isActive={currentTrack?.id === track.id}
                    isSelected={selectedTrackIds.has(track.id)}
                    isFavorite={true}
                    onClick={() => playTrack(track, favoriteTracks)}
                    onSelect={() => toggleTrackSelection(track.id)}
                    onToggleFavorite={() => toggleFavorite(track.id)}
                    isPlaying={isPlaying}
                    onAddToPlaylist={() => {
                      setTracksToAddToPlaylist([track]);
                      setIsAddToPlaylistModalOpen(true);
                    }}
                    onPlayNext={() => playNextTrack(track)}
                    onAddToQueue={() => addToQueue(track)}
                  />
                ))
              )}
            </div>
          </div>
        );
      case 'albums':
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 pb-32">
            {Object.entries(albums).map(([name, albumTracks]) => (
              <div key={name} className="group cursor-pointer" onClick={() => playTrack(albumTracks[0], albumTracks)}>
                <div className="aspect-square rounded-2xl bg-white/5 overflow-hidden mb-3 relative">
                  {albumTracks[0].coverUrl ? (
                    <img src={albumTracks[0].coverUrl} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/10"><Disc size={64} /></div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Play fill="white" size={32} />
                  </div>
                </div>
                <h3 className="font-semibold truncate">{name}</h3>
                <p className="text-sm text-white/40 truncate">{albumTracks[0].artist}</p>
              </div>
            ))}
          </div>
        );
      case 'artists':
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 pb-32">
            {Object.entries(artists).map(([name, artistTracks]) => (
              <div key={name} className="flex flex-col items-center text-center group cursor-pointer" onClick={() => playTrack(artistTracks[0], artistTracks)}>
                <div className="w-32 h-32 md:w-40 md:h-40 rounded-full bg-white/5 overflow-hidden mb-4 relative border-4 border-transparent group-hover:border-emerald-500/50 transition-all">
                  {artistTracks[0].coverUrl ? (
                    <img src={artistTracks[0].coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/10"><Users size={48} /></div>
                  )}
                </div>
                <h3 className="font-semibold truncate w-full">{name}</h3>
                <p className="text-sm text-white/40">{artistTracks.length} tracks</p>
              </div>
            ))}
          </div>
        );
      case 'genres':
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 pb-32">
            {Object.entries(genres).map(([name, genreTracks]) => (
              <div key={name} className="group cursor-pointer" onClick={() => playTrack(genreTracks[0], genreTracks)}>
                <div className="aspect-square rounded-2xl bg-white/5 overflow-hidden mb-3 relative flex items-center justify-center">
                  <div className="w-full h-full bg-gradient-to-br from-emerald-500/20 to-emerald-900/40 flex items-center justify-center text-emerald-500">
                    <Music size={64} />
                  </div>
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Play fill="white" size={32} />
                  </div>
                </div>
                <h3 className="font-semibold truncate">{name}</h3>
                <p className="text-sm text-white/40 truncate">{genreTracks.length} tracks</p>
              </div>
            ))}
          </div>
        );
      case 'playlists':
        return (
          <div className="space-y-6 pb-32">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Your Playlists</h2>
              <button 
                onClick={() => setIsNewPlaylistModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-black rounded-lg font-semibold hover:bg-emerald-400 transition-colors"
              >
                <Plus size={18} /> New Playlist
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {playlists.map(p => (
                <div key={p.id} className="p-4 bg-white/5 rounded-2xl border border-white/10 flex items-center justify-between group">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-500">
                      <List size={24} />
                    </div>
                    <div>
                      <h3 className="font-semibold">{p.name}</h3>
                      <p className="text-sm text-white/40">{p.trackIds.length} tracks</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => {
                        const playlistTracks = tracks.filter(t => p.trackIds.includes(t.id));
                        if (playlistTracks.length > 0) playTrack(playlistTracks[0], playlistTracks);
                      }}
                      className="p-2 hover:bg-white/10 rounded-lg"
                    >
                      <Play size={18} />
                    </button>
                    <button 
                      onClick={() => db.playlists.delete(p.id)}
                      className="p-2 hover:bg-red-500/20 text-white/40 hover:text-red-500 rounded-lg"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      case 'settings':
        return <SettingsView settings={audioSettings} onUpdate={setAudioSettings} onReset={() => db.tracks.clear()} />;
      case 'folders':
        return (
          <div className="space-y-6 pb-32">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-3xl font-bold flex items-center gap-3">
                <Folder className="text-emerald-500" size={32} />
                Folder Browser
              </h2>
            </div>
            <FolderBrowser tree={folderTree} onPlayTrack={(t) => playTrack(t, tracks)} />
          </div>
        );
      case 'recentlyAdded':
        return (
          <div className="space-y-6 pb-32">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-3xl font-bold flex items-center gap-3">
                <Clock className="text-emerald-500" size={32} />
                Recently Added
              </h2>
              <button 
                onClick={() => recentlyAdded.length > 0 && playTrack(recentlyAdded[0], recentlyAdded)}
                className="px-6 py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-colors flex items-center gap-2"
              >
                <Play size={20} fill="currentColor" />
                Play All
              </button>
            </div>
            <div className="space-y-2">
              {recentlyAdded.map((track) => (
                <TrackItem 
                  key={track.id} 
                  track={track} 
                  isActive={currentTrack?.id === track.id}
                  isSelected={selectedTrackIds.has(track.id)}
                  isFavorite={favorites.has(track.id)}
                  onClick={() => playTrack(track, recentlyAdded)}
                  onSelect={() => toggleTrackSelection(track.id)}
                  onToggleFavorite={() => toggleFavorite(track.id)}
                  isPlaying={isPlaying}
                  onAddToPlaylist={() => {
                    setTracksToAddToPlaylist([track]);
                    setIsAddToPlaylistModalOpen(true);
                  }}
                  onPlayNext={() => playNextTrack(track)}
                  onAddToQueue={() => addToQueue(track)}
                />
              ))}
            </div>
          </div>
        );
      case 'mostPlayed':
        return (
          <div className="space-y-6 pb-32">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-3xl font-bold flex items-center gap-3">
                <Zap className="text-emerald-500" size={32} />
                Most Played
              </h2>
              <button 
                onClick={() => mostPlayed.length > 0 && playTrack(mostPlayed[0], mostPlayed)}
                className="px-6 py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-colors flex items-center gap-2"
              >
                <Play size={20} fill="currentColor" />
                Play All
              </button>
            </div>
            <div className="space-y-2">
              {mostPlayed.map((track) => (
                <TrackItem 
                  key={track.id} 
                  track={track} 
                  isActive={currentTrack?.id === track.id}
                  isSelected={selectedTrackIds.has(track.id)}
                  isFavorite={favorites.has(track.id)}
                  onClick={() => playTrack(track, mostPlayed)}
                  onSelect={() => toggleTrackSelection(track.id)}
                  onToggleFavorite={() => toggleFavorite(track.id)}
                  isPlaying={isPlaying}
                  onAddToPlaylist={() => {
                    setTracksToAddToPlaylist([track]);
                    setIsAddToPlaylistModalOpen(true);
                  }}
                  onPlayNext={() => playNextTrack(track)}
                  onAddToQueue={() => addToQueue(track)}
                />
              ))}
            </div>
          </div>
        );
      case 'highResOnly':
        return (
          <div className="space-y-6 pb-32">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-3xl font-bold flex items-center gap-3">
                <Music size={32} className="text-emerald-500" />
                High-Res Only
              </h2>
              <button 
                onClick={() => highResOnly.length > 0 && playTrack(highResOnly[0], highResOnly)}
                className="px-6 py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-colors flex items-center gap-2"
              >
                <Play size={20} fill="currentColor" />
                Play All
              </button>
            </div>
            <div className="space-y-2">
              {highResOnly.map((track) => (
                <TrackItem 
                  key={track.id} 
                  track={track} 
                  isActive={currentTrack?.id === track.id}
                  isSelected={selectedTrackIds.has(track.id)}
                  isFavorite={favorites.has(track.id)}
                  onClick={() => playTrack(track, highResOnly)}
                  onSelect={() => toggleTrackSelection(track.id)}
                  onToggleFavorite={() => toggleFavorite(track.id)}
                  isPlaying={isPlaying}
                  onAddToPlaylist={() => {
                    setTracksToAddToPlaylist([track]);
                    setIsAddToPlaylistModalOpen(true);
                  }}
                  onPlayNext={() => playNextTrack(track)}
                  onAddToQueue={() => addToQueue(track)}
                />
              ))}
            </div>
          </div>
        );
      case 'console':
        return <AudioConsole settings={audioSettings} onUpdate={setAudioSettings} analyzer={engineRef.current?.getAnalyzer() || null} />;
      default:
        return null;
    }
  };

  return (
    <div className="h-screen bg-[#050505] text-white font-sans selection:bg-emerald-500/30 overflow-hidden flex flex-col">
      <audio ref={audio1Ref} />
      <audio ref={audio2Ref} />
      
      {/* Header */}
      <header className="h-20 border-b border-white/5 flex items-center justify-between px-8 backdrop-blur-md bg-black/20 sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Music className="text-black" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tighter">SONIC</h1>
            <p className="text-[10px] text-white/20 uppercase tracking-[0.2em] font-bold">High-Fidelity Audio</p>
          </div>
        </div>
        <div className="relative w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" size={18} />
          <input 
            type="text" 
            placeholder="Search library..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-4 focus:outline-none focus:border-emerald-500/50 transition-colors"
          />
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 bg-white/5 hover:bg-emerald-500 hover:text-black border border-white/10 rounded-xl flex items-center gap-2 transition-all group"
          >
            <FolderOpen size={18} className="group-hover:scale-110 transition-transform" />
            <span className="hidden sm:inline">Scan Folder</span>
          </button>
          <input 
            ref={fileInputRef} 
            type="file" 
            multiple 
            className="hidden" 
            onChange={handleFileSelect} 
            {...({ webkitdirectory: "", directory: "" } as any)}
          />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
          >
            {renderTabContent()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <div className="relative z-30">
        <nav className="h-20 bg-white/5 backdrop-blur-2xl border-t border-white/10 flex items-center md:justify-around justify-start overflow-x-auto no-scrollbar px-6 scroll-smooth nav-mask md:[mask-image:none]">
          <NavButton icon={<Music />} label="Tracks" active={activeTab === 'tracks'} onClick={() => setActiveTab('tracks')} />
          <NavButton icon={<Clock />} label="Recent" active={activeTab === 'recentlyAdded'} onClick={() => setActiveTab('recentlyAdded')} />
          <NavButton icon={<TrendingUp />} label="Top" active={activeTab === 'mostPlayed'} onClick={() => setActiveTab('mostPlayed')} />
          <NavButton icon={<Award />} label="Hi-Res" active={activeTab === 'highResOnly'} onClick={() => setActiveTab('highResOnly')} />
          <NavButton icon={<LayoutGrid />} label="Albums" active={activeTab === 'albums'} onClick={() => setActiveTab('albums')} />
          <NavButton icon={<Users />} label="Artists" active={activeTab === 'artists'} onClick={() => setActiveTab('artists')} />
          <NavButton icon={<Heart />} label="Favorites" active={activeTab === 'favorites'} onClick={() => setActiveTab('favorites')} />
          <NavButton icon={<List />} label="Playlists" active={activeTab === 'playlists'} onClick={() => setActiveTab('playlists')} />
          <NavButton icon={<Folder />} label="Folders" active={activeTab === 'folders'} onClick={() => setActiveTab('folders')} />
          <NavButton icon={<Zap />} label="Console" active={activeTab === 'console'} onClick={() => setActiveTab('console')} />
          <NavButton icon={<Settings />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>
      </div>

      {/* Mini-Player / Full-Screen Player */}
      <AnimatePresence>
        {currentTrack && selectedTrackIds.size === 0 && (
          <motion.div 
            layout
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            className={cn(
              "fixed bottom-20 left-0 right-0 z-50 transition-all duration-500 ease-in-out",
              isPlayerExpanded ? "h-[calc(100vh-80px)] bottom-20 bg-black" : "h-24 bg-black/40 backdrop-blur-3xl border-t border-white/10"
            )}
          >
            {isPlayerExpanded ? (
              <div className="h-full flex flex-col p-8 overflow-hidden">
                <div className="flex justify-between items-center mb-8">
                  <button onClick={() => setIsPlayerExpanded(false)} className="p-2 hover:bg-white/10 rounded-full"><Minimize2 /></button>
                  <h2 className="text-sm font-bold tracking-widest text-white/40 uppercase">Now Playing</h2>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setIsEQModalOpen(true)}
                      className="p-2 hover:bg-white/10 rounded-full transition-colors"
                      title="Equalizer"
                    >
                      <Settings size={20} />
                    </button>
                    <button className="p-2 hover:bg-white/10 rounded-full"><MoreHorizontal /></button>
                  </div>
                </div>

                <div className="flex-1 flex flex-col md:flex-row gap-12 items-center overflow-hidden">
                  {/* Visualizer & Art */}
                  <div className="flex-1 w-full flex flex-col items-center gap-8">
                    <div className="w-full max-w-md aspect-square rounded-3xl overflow-hidden shadow-2xl border border-white/10 relative">
                      {currentTrack.coverUrl ? (
                        <img src={currentTrack.coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full bg-zinc-900 flex items-center justify-center text-white/10"><Disc size={200} /></div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 h-32">
                        <Visualizer analyzer={engineRef.current?.getAnalyzer() || null} isPlaying={isPlaying} />
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-3 mb-2">
                        <h2 className="text-4xl font-bold">{currentTrack.title}</h2>
                        {isLossless(currentTrack.format, currentTrack.file.name) && (
                          <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 text-[10px] font-bold rounded uppercase tracking-widest border border-emerald-500/20">Hi-Res</span>
                        )}
                      </div>
                      <p className="text-xl text-white/40">{currentTrack.artist}</p>
                    </div>
                  </div>

                  {/* Queue */}
                  <div className="w-full md:w-96 h-full flex flex-col bg-white/5 rounded-3xl border border-white/10 overflow-hidden">
                    <div className="p-4 border-b border-white/10 flex items-center justify-between">
                      <h3 className="font-bold flex items-center gap-2"><List size={18} /> Up Next</h3>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-white/40">{nowPlayingQueue.length} tracks</span>
                        <button 
                          onClick={clearQueue}
                          className="text-xs text-red-500 hover:text-red-400 font-bold uppercase tracking-widest transition-colors"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                      <Reorder.Group axis="y" values={nowPlayingQueue} onReorder={setNowPlayingQueue} className="space-y-1">
                        {nowPlayingQueue.map((t, idx) => (
                          <Reorder.Item 
                            key={t.id} 
                            value={t}
                            className={cn(
                              "p-3 rounded-xl flex items-center gap-3 group cursor-grab active:cursor-grabbing",
                              currentIndex === idx ? "bg-emerald-500/10" : "hover:bg-white/5"
                            )}
                          >
                            <GripVertical size={16} className="text-white/10 group-hover:text-white/40" />
                            <div className="flex-1 overflow-hidden">
                              <p className={cn("text-sm font-medium truncate", currentIndex === idx ? "text-emerald-500" : "text-white")}>{t.title}</p>
                              <p className="text-xs text-white/40 truncate">{t.artist}</p>
                            </div>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                const newQueue = nowPlayingQueue.filter(track => track.id !== t.id);
                                setNowPlayingQueue(newQueue);
                                if (currentIndex === idx) skipNext();
                                else if (currentIndex > idx) setCurrentIndex(currentIndex - 1);
                              }}
                              className="p-1 text-white/20 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                            >
                              <X size={16} />
                            </button>
                          </Reorder.Item>
                        ))}
                      </Reorder.Group>
                    </div>
                  </div>
                </div>

                {/* Controls */}
                <div className="mt-8 space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-mono text-white/40">
                      <span>{formatTime(currentTime)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                    <div className="relative h-1.5 bg-white/10 rounded-full group cursor-pointer">
                      <div className="absolute top-0 left-0 h-full bg-emerald-500 rounded-full" style={{ width: `${(currentTime / duration) * 100}%` }} />
                      <input 
                        type="range" min="0" max={duration || 0} value={currentTime}
                        onChange={(e) => {
                          const time = parseFloat(e.target.value);
                          setCurrentTime(time);
                          const audio = activeAudioRef.current === 1 ? audio1Ref.current : audio2Ref.current;
                          if (audio) audio.currentTime = time;
                        }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-12">
                    <button onClick={() => setIsShuffle(!isShuffle)} className={cn("transition-colors", isShuffle ? "text-emerald-500" : "text-white/40 hover:text-white")}><Shuffle size={24} /></button>
                    <button onClick={playPrev} className="text-white hover:scale-110 transition-transform"><SkipBack size={48} fill="currentColor" /></button>
                    <button 
                      onClick={togglePlay}
                      className="w-20 h-20 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl shadow-white/10"
                    >
                      {isPlaying ? <Pause size={40} fill="currentColor" /> : <Play size={40} fill="currentColor" className="ml-2" />}
                    </button>
                    <button onClick={skipNext} className="text-white hover:scale-110 transition-transform"><SkipForward size={48} fill="currentColor" /></button>
                    <button onClick={() => setIsRepeat(!isRepeat)} className={cn("transition-colors", isRepeat ? "text-emerald-500" : "text-white/40 hover:text-white")}><Repeat size={24} /></button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center px-8 gap-8">
                <div className="flex-1 flex items-center gap-4 cursor-pointer" onClick={() => setIsPlayerExpanded(true)}>
                  <div className="w-14 h-14 rounded-xl bg-white/5 overflow-hidden flex-shrink-0 relative">
                    {currentTrack.coverUrl ? (
                      <img src={currentTrack.coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white/10"><Disc size={24} /></div>
                    )}
                  </div>
                  <div className="overflow-hidden">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold truncate">{currentTrack.title}</h4>
                      {isLossless(currentTrack.format, currentTrack.file.name) && (
                        <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-500 text-[8px] font-bold rounded uppercase tracking-widest border border-emerald-500/20 flex-shrink-0">Hi-Res</span>
                      )}
                    </div>
                    <p className="text-sm text-white/40 truncate">{currentTrack.artist}</p>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <button onClick={playPrev} className="text-white/60 hover:text-white transition-colors"><SkipBack size={24} fill="currentColor" /></button>
                  <button 
                    onClick={togglePlay}
                    className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
                  >
                    {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
                  </button>
                  <button onClick={skipNext} className="text-white/60 hover:text-white transition-colors"><SkipForward size={24} fill="currentColor" /></button>
                  <button onClick={() => setIsPlayerExpanded(true)} className="p-2 text-white/40 hover:text-white"><Maximize2 size={18} /></button>
                </div>

                <div className="w-48 flex items-center gap-3 group">
                  <button onClick={() => setIsMuted(!isMuted)} className="text-white/40 hover:text-white">
                    {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <div className="flex-1 relative h-1 bg-white/10 rounded-full">
                    <div className="absolute top-0 left-0 h-full bg-white/60 rounded-full group-hover:bg-emerald-500 transition-colors" style={{ width: `${volume * 100}%` }} />
                    <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading Overlay */}
      <AnimatePresence>
        {isLoading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110] flex flex-col items-center justify-center gap-6">
            <div className="w-16 h-16 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
            <p className="text-lg font-medium">Processing Library...</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New Playlist Modal */}
      <AnimatePresence>
        {isNewPlaylistModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[120] flex items-center justify-center p-4"
            onClick={() => setIsNewPlaylistModalOpen(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-3xl p-8 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-2xl font-bold mb-6">Create New Playlist</h2>
              <input 
                autoFocus
                type="text" 
                placeholder="Playlist Name"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createPlaylist()}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 mb-8 focus:outline-none focus:border-emerald-500 transition-colors"
              />
              <div className="flex gap-4">
                <button 
                  onClick={() => setIsNewPlaylistModalOpen(false)}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={createPlaylist}
                  className="flex-1 py-3 bg-emerald-500 text-black hover:bg-emerald-400 rounded-xl font-semibold transition-colors"
                >
                  Create
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add to Playlist Modal */}
      <AnimatePresence>
        {isAddToPlaylistModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[120] flex items-center justify-center p-4"
            onClick={() => setIsAddToPlaylistModalOpen(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-3xl p-8 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-2xl font-bold mb-2">Add to Playlist</h2>
              <p className="text-white/40 mb-6 truncate">
                {tracksToAddToPlaylist.length === 1 
                  ? `"${tracksToAddToPlaylist[0].title}"` 
                  : `${tracksToAddToPlaylist.length} tracks selected`}
              </p>
              
              <div className="space-y-4 mb-8">
                {playlists.length === 0 ? (
                  <p className="text-center py-8 text-white/20 italic">No playlists found</p>
                ) : (
                  <div className="space-y-4">
                    <div className="relative">
                      <select 
                        value={selectedPlaylistId}
                        onChange={(e) => setSelectedPlaylistId(e.target.value)}
                        className="w-full p-4 bg-white/5 border border-white/10 rounded-xl appearance-none focus:outline-none focus:border-emerald-500/50 transition-colors cursor-pointer"
                      >
                        <option value="" disabled className="bg-zinc-900">Select a playlist...</option>
                        {playlists.map(p => (
                          <option key={p.id} value={p.id} className="bg-zinc-900">
                            {p.name} ({p.trackIds.length} tracks)
                          </option>
                        ))}
                      </select>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-white/40">
                        <ChevronRight size={20} className="rotate-90" />
                      </div>
                    </div>

                    <button 
                      disabled={!selectedPlaylistId}
                      onClick={() => {
                        addTrackToPlaylist(selectedPlaylistId);
                        setSelectedPlaylistId('');
                      }}
                      className={cn(
                        "w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all",
                        selectedPlaylistId 
                          ? "bg-emerald-500 text-black hover:bg-emerald-400" 
                          : "bg-white/5 text-white/20 cursor-not-allowed"
                      )}
                    >
                      <Plus size={20} />
                      Add to Selected Playlist
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => {
                    setIsAddToPlaylistModalOpen(false);
                    setSelectedPlaylistId('');
                  }}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    setIsAddToPlaylistModalOpen(false);
                    setSelectedPlaylistId('');
                    setIsNewPlaylistModalOpen(true);
                  }}
                  className="flex-1 py-3 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500 hover:text-black rounded-xl font-semibold transition-all"
                >
                  New Playlist
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {isDeleteConfirmationModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[130] flex items-center justify-center p-4"
            onClick={() => setIsDeleteConfirmationModalOpen(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-3xl p-8 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 mb-6">
                <Trash2 size={32} />
              </div>
              <h2 className="text-2xl font-bold mb-2">Delete Tracks?</h2>
              <p className="text-white/40 mb-8">
                Are you sure you want to delete {selectedTrackIds.size} tracks? This will permanently remove them from your library and all playlists.
              </p>
              
              <div className="flex gap-4">
                <button 
                  onClick={() => setIsDeleteConfirmationModalOpen(false)}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmBulkDelete}
                  className="flex-1 py-3 bg-red-500 text-white hover:bg-red-400 rounded-xl font-semibold transition-colors"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selection Toolbar */}
      <AnimatePresence>
        {selectedTrackIds.size > 0 && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 bg-zinc-900 border border-emerald-500/30 rounded-2xl px-6 py-4 flex items-center gap-8 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center gap-3 pr-8 border-r border-white/10">
              <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-black font-bold text-sm">
                {selectedTrackIds.size}
              </div>
              <span className="font-medium">Selected</span>
            </div>
            
            <div className="flex items-center gap-4">
              <button 
                onClick={handleBulkAddToPlaylist}
                className="flex items-center gap-2 px-4 py-2 hover:bg-white/5 rounded-xl transition-colors"
              >
                <Plus size={18} className="text-emerald-500" />
                <span>Add to Playlist</span>
              </button>
              <button 
                onClick={handleBulkDelete}
                className="flex items-center gap-2 px-4 py-2 hover:bg-red-500/10 text-red-500 rounded-xl transition-colors"
              >
                <Trash2 size={18} />
                <span>Delete</span>
              </button>
              <button 
                onClick={() => setSelectedTrackIds(new Set())}
                className="p-2 hover:bg-white/5 rounded-xl transition-colors text-white/40"
              >
                <X size={18} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
        .nav-mask { mask-image: linear-gradient(to right, black 85%, transparent 100%); }
      `}</style>
    </div>
  );
}

// --- Sub-components ---

function NavButton({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [active]);

  return (
    <button 
      ref={ref}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 transition-all group relative px-4 min-w-[72px] flex-shrink-0",
        active ? "text-emerald-500" : "text-white/40 hover:text-white"
      )}
    >
      <div className={cn("transition-transform group-hover:scale-110", active && "scale-110")}>{icon}</div>
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      {active && <motion.div layoutId="nav-active" className="absolute -top-2 w-1 h-1 bg-emerald-500 rounded-full" />}
    </button>
  );
}

function TrackItem({ 
  track, isActive, isSelected, isFavorite, onClick, onSelect, onToggleFavorite, isPlaying, onAddToPlaylist, onPlayNext, onAddToQueue 
}: { 
  track: Track, isActive: boolean, isSelected: boolean, isFavorite: boolean, onClick: () => void, onSelect: () => void, onToggleFavorite: () => void, isPlaying: boolean, onAddToPlaylist: () => void, onPlayNext: () => void, onAddToQueue: () => void 
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div
      className={cn(
        "w-full p-3 rounded-xl flex items-center gap-4 transition-all group relative",
        isActive ? "bg-emerald-500/10 border border-emerald-500/20" : "hover:bg-white/5 border border-transparent",
        isSelected && "bg-emerald-500/20 border-emerald-500/40"
      )}
    >
      <div className="flex items-center gap-3">
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className={cn(
            "w-5 h-5 rounded border transition-all flex items-center justify-center",
            isSelected ? "bg-emerald-500 border-emerald-500" : "border-white/20 group-hover:border-white/40"
          )}
        >
          {isSelected && <Check size={14} className="text-black" />}
        </button>
        <div 
          onClick={onClick}
          className="w-12 h-12 rounded-lg bg-white/5 flex-shrink-0 overflow-hidden flex items-center justify-center relative cursor-pointer"
        >
          {track.coverUrl ? (
            <img src={track.coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <Music size={20} className="text-white/20" />
          )}
          {isActive && isPlaying && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div className="flex gap-0.5 items-end h-4">
                <motion.div animate={{ height: [4, 16, 4] }} transition={{ repeat: Infinity, duration: 0.6 }} className="w-0.5 bg-emerald-500" />
                <motion.div animate={{ height: [10, 4, 10] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-0.5 bg-emerald-500" />
                <motion.div animate={{ height: [4, 12, 4] }} transition={{ repeat: Infinity, duration: 0.7 }} className="w-0.5 bg-emerald-500" />
              </div>
            </div>
          )}
        </div>
      </div>
      <div onClick={onClick} className="flex-1 text-left overflow-hidden cursor-pointer">
        <div className="flex items-center gap-2">
          <p className={cn("font-medium truncate", isActive ? "text-emerald-400" : "text-white")}>{track.title}</p>
          {isLossless(track.format, track.file.name) && (
            <span className="px-1 py-0.5 bg-emerald-500/10 text-emerald-500 text-[7px] font-bold rounded uppercase tracking-widest border border-emerald-500/20 flex-shrink-0">Hi-Res</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-white/40 truncate">
          <span>{track.artist} • {track.album}</span>
          {track.playCount && track.playCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] bg-white/5 px-1.5 rounded-full">
              <Zap size={10} className="text-emerald-500" /> {track.playCount}
            </span>
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className={cn(
            "p-2 transition-all",
            isFavorite ? "text-red-500" : "text-white/10 hover:text-white/40"
          )}
        >
          <motion.div whileTap={{ scale: 1.5 }}>
            <Heart size={18} fill={isFavorite ? "currentColor" : "none"} />
          </motion.div>
        </button>
        
        <div className="text-xs font-mono text-white/20 hidden sm:block">{formatTime(track.duration)}</div>
        
        <div className="relative">
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setIsMenuOpen(!isMenuOpen);
            }}
            className="p-2 text-white/20 hover:text-white hover:bg-white/10 rounded-lg transition-all"
          >
            <MoreHorizontal size={18} />
          </button>
          
          <AnimatePresence>
            {isMenuOpen && (
              <>
                <div className="fixed inset-0 z-[100]" onClick={() => setIsMenuOpen(false)} />
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  className="absolute right-0 bottom-full mb-2 w-48 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl z-[101] overflow-hidden"
                >
                  <button 
                    onClick={(e) => { e.stopPropagation(); onPlayNext(); setIsMenuOpen(false); }}
                    className="w-full p-3 text-left hover:bg-white/5 flex items-center gap-3 text-sm"
                  >
                    <Zap size={16} className="text-emerald-500" />
                    Play Next
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onAddToQueue(); setIsMenuOpen(false); }}
                    className="w-full p-3 text-left hover:bg-white/5 flex items-center gap-3 text-sm"
                  >
                    <List size={16} className="text-emerald-500" />
                    Add to Queue
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onAddToPlaylist(); setIsMenuOpen(false); }}
                    className="w-full p-3 text-left hover:bg-white/5 flex items-center gap-3 text-sm"
                  >
                    <Plus size={16} className="text-emerald-500" />
                    Add to Playlist
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function FolderBrowser({ tree, onPlayTrack }: { tree: any, onPlayTrack: (t: Track) => void }) {
  const [path, setPath] = useState<string[]>([]);
  
  const currentFolder = useMemo(() => {
    let current = tree;
    path.forEach(p => current = current[p]);
    return current;
  }, [tree, path]);

  const folders = Object.keys(currentFolder).filter(k => k !== '_files');
  const files = currentFolder._files || [];

  return (
    <div className="space-y-4 pb-32">
      <div className="flex items-center gap-2 text-sm text-white/40 mb-6">
        <button onClick={() => setPath([])} className="hover:text-white">Root</button>
        {path.map((p, i) => (
          <React.Fragment key={p}>
            <ChevronRight size={14} />
            <button onClick={() => setPath(path.slice(0, i + 1))} className="hover:text-white">{p}</button>
          </React.Fragment>
        ))}
      </div>
      
      <div className="grid grid-cols-1 gap-1">
        {folders.map(f => (
          <button 
            key={f} 
            onClick={() => setPath([...path, f])}
            className="w-full p-4 rounded-xl hover:bg-white/5 flex items-center gap-4 transition-colors"
          >
            <Folder className="text-emerald-500/60" size={24} />
            <span className="font-medium">{f}</span>
            <ChevronRight size={18} className="ml-auto text-white/20" />
          </button>
        ))}
        {files.map((t: Track) => (
          <button 
            key={t.id} 
            onClick={() => onPlayTrack(t)}
            className="w-full p-4 rounded-xl hover:bg-white/5 flex items-center gap-4 transition-colors group"
          >
            <Music className="text-white/20 group-hover:text-emerald-500 transition-colors" size={24} />
            <div className="flex flex-col items-start overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{t.title}</span>
                {isLossless(t.format, t.file.name) && (
                  <span className="px-1 py-0.5 bg-emerald-500/10 text-emerald-500 text-[7px] font-bold rounded uppercase tracking-widest border border-emerald-500/20 flex-shrink-0">Hi-Res</span>
                )}
              </div>
              <span className="text-xs text-white/40 truncate">{t.artist}</span>
            </div>
            <span className="ml-auto text-xs font-mono text-white/20">{formatTime(t.duration)}</span>
          </button>
        ))}
        {folders.length === 0 && files.length === 0 && (
          <div className="text-center py-20 text-white/20">
            <FolderOpen size={48} className="mx-auto mb-4 opacity-10" />
            <p>This folder is empty</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsView({ settings, onUpdate, onReset }: { settings: AudioSettings, onUpdate: (s: AudioSettings) => void, onReset: () => void }) {
  const activePreset = useMemo(() => {
    for (const [name, gains] of Object.entries(EQ_PRESETS)) {
      if (JSON.stringify(gains) === JSON.stringify(settings.eqGains)) return name;
    }
    return 'Custom';
  }, [settings.eqGains]);

  return (
    <div className="max-w-2xl space-y-12 pb-32">
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold flex items-center gap-3"><Sliders className="text-emerald-500" /> 10-Band Equalizer</h2>
          <div className="flex gap-2">
            <PresetBtn 
              label="Bass Boost" 
              icon={<Zap size={14} />} 
              active={activePreset === 'Bass Boost'}
              onClick={() => onUpdate({ ...settings, eqGains: EQ_PRESETS['Bass Boost'] })} 
            />
            <PresetBtn 
              label="Vocal" 
              icon={<Mic2 size={14} />} 
              active={activePreset === 'Vocal'}
              onClick={() => onUpdate({ ...settings, eqGains: EQ_PRESETS['Vocal'] })} 
            />
            <PresetBtn 
              label="Electronic" 
              icon={<Zap size={14} />} 
              active={activePreset === 'Electronic'}
              onClick={() => onUpdate({ ...settings, eqGains: EQ_PRESETS['Electronic'] })} 
            />
            <PresetBtn 
              label="Flat" 
              icon={<RotateCcw size={14} />} 
              active={activePreset === 'Flat'}
              onClick={() => onUpdate({ ...settings, eqGains: EQ_PRESETS['Flat'] })} 
            />
            <PresetBtn 
              label="Custom" 
              icon={<Sliders size={14} />} 
              active={activePreset === 'Custom'}
              onClick={() => {}} // Custom is just a label for manual adjustments
            />
          </div>
        </div>
        <div className="flex justify-between items-end h-48 gap-2 bg-white/5 p-6 rounded-2xl border border-white/10">
          {settings.eqGains.map((gain, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-4 h-full">
              <div className="flex-1 relative w-1.5 bg-white/10 rounded-full overflow-hidden">
                <div 
                  className="absolute bottom-1/2 left-0 right-0 bg-emerald-500 rounded-full transition-all"
                  style={{ height: `${(Math.abs(gain) / 12) * 50}%`, bottom: gain >= 0 ? '50%' : `calc(50% - ${(Math.abs(gain) / 12) * 50}%)` }}
                />
                <input 
                  type="range" min="-12" max="12" step="1" value={gain}
                  onChange={(e) => {
                    const newGains = [...settings.eqGains];
                    newGains[i] = parseInt(e.target.value);
                    onUpdate({ ...settings, eqGains: newGains });
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [writing-mode:bt-lr]"
                  style={{ appearance: 'slider-vertical' as any }}
                />
              </div>
              <span className="text-[10px] font-mono text-white/40">{gain > 0 ? `+${gain}` : gain}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 bg-white/5 rounded-2xl border border-white/10 space-y-4">
          <h3 className="font-bold flex items-center gap-2"><Volume2 size={18} className="text-emerald-500" /> Sound Effects</h3>
          <div className="space-y-3">
            <Toggle label="Reverb" active={settings.isReverbEnabled} onToggle={() => onUpdate({ ...settings, isReverbEnabled: !settings.isReverbEnabled })} />
            <Toggle label="Dynamic Compression" active={settings.isCompressionEnabled} onToggle={() => onUpdate({ ...settings, isCompressionEnabled: !settings.isCompressionEnabled })} />
          </div>
        </div>
        <div className="p-6 bg-white/5 rounded-2xl border border-white/10 space-y-4">
          <h3 className="font-bold flex items-center gap-2"><RotateCcw size={18} className="text-emerald-500" /> Playback</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-white/60">Crossfade</span>
                <span className="text-emerald-500 font-mono">{settings.crossfadeTime}s</span>
              </div>
              <input 
                type="range" min="0" max="10" step="1" value={settings.crossfadeTime}
                onChange={(e) => onUpdate({ ...settings, crossfadeTime: parseInt(e.target.value) })}
                className="w-full accent-emerald-500"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="pt-6 border-t border-white/10">
        <div className="bg-red-500/5 border border-red-500/10 rounded-2xl p-6 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-red-500">Danger Zone</h3>
            <p className="text-xs text-red-500/40">This will permanently delete your library database</p>
          </div>
          <button 
            onClick={onReset}
            className="px-6 py-3 bg-red-500 text-white rounded-xl font-bold hover:bg-red-400 transition-all flex items-center gap-2"
          >
            <Trash2 size={18} /> Clear Library
          </button>
        </div>
      </section>
    </div>
  );
}

function PresetBtn({ label, icon, active, onClick }: { label: string, icon: React.ReactNode, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick} 
      className={cn(
        "px-3 py-1 border rounded-lg text-xs flex items-center gap-2 transition-colors",
        active 
          ? "bg-emerald-500/20 border-emerald-500 text-emerald-500" 
          : "bg-white/5 hover:bg-white/10 border-white/10 text-white/60 hover:text-white"
      )}
    >
      {icon} {label}
    </button>
  );
}

function Toggle({ label, active, onToggle }: { label: string, active: boolean, onToggle: () => void }) {
  return (
    <button 
      onClick={onToggle}
      className="w-full flex items-center justify-between group"
    >
      <span className="text-sm text-white/60 group-hover:text-white transition-colors">{label}</span>
      <div className={cn(
        "w-10 h-5 rounded-full relative transition-colors",
        active ? "bg-emerald-500" : "bg-white/10"
      )}>
        <motion.div 
          animate={{ x: active ? 20 : 2 }}
          className="absolute top-1 w-3 h-3 bg-white rounded-full shadow-lg"
        />
      </div>
    </button>
  );
}
