import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, 
  List, Search, Plus, Music, Volume2, VolumeX,
  Disc, Heart, Share2, MoreHorizontal, X, Trash2, 
  GripVertical, LayoutGrid, Users, Folder, Settings,
  ChevronRight, ChevronDown, FolderOpen, Sliders,
  Check, Save, RotateCcw, Maximize2, Minimize2,
  Library, Mic2, Zap
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Track, Playlist, AudioSettings, PlayerState } from './lib/types';
import { extractMetadata } from './lib/metadata';
import { isNativelySupported, decodeToWav } from './lib/audio';
import { cn, formatTime } from './lib/utils';
import Visualizer from './components/Visualizer';
import { AudioEngine } from './lib/audioEngine';
import { db } from './lib/db';

const EQ_PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass Boost': [8, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  Vocal: [-2, -1, 0, 2, 4, 4, 2, 0, -1, -2],
  Electronic: [6, 4, 0, -2, -2, 0, 2, 4, 6, 8],
};

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
  
  // Audio Settings
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(() => {
    const saved = localStorage.getItem('audioSettings');
    return saved ? JSON.parse(saved) : {
      eqGains: EQ_PRESETS.Flat,
      isReverbEnabled: false,
      isCompressionEnabled: true,
      crossfadeTime: 0, // Default to gapless (0s)
    };
  });

  // --- Refs ---
  const audio1Ref = useRef<HTMLAudioElement>(null);
  const audio2Ref = useRef<HTMLAudioElement>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeAudioRef = useRef<1 | 2>(1);

  const currentTrack = currentIndex >= 0 ? nowPlayingQueue[currentIndex] : null;

  // --- Initialization ---
  useEffect(() => {
    if (audio1Ref.current && audio2Ref.current && !engineRef.current) {
      engineRef.current = new AudioEngine(audio1Ref.current, audio2Ref.current);
      engineRef.current.setEQ(audioSettings.eqGains);
      engineRef.current.setReverb(audioSettings.isReverbEnabled);
      engineRef.current.setCompression(audioSettings.isCompressionEnabled);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('audioSettings', JSON.stringify(audioSettings));
    if (engineRef.current) {
      engineRef.current.setEQ(audioSettings.eqGains);
      engineRef.current.setReverb(audioSettings.isReverbEnabled);
      engineRef.current.setCompression(audioSettings.isCompressionEnabled);
    }
  }, [audioSettings]);

  // --- Library Logic ---
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
    for (const file of files) {
      const metadata = await extractMetadata(file);
      await db.tracks.add({
        id: Math.random().toString(36).substr(2, 9),
        file,
        title: metadata.title || file.name,
        artist: metadata.artist || 'Unknown Artist',
        album: metadata.album || 'Unknown Album',
        genre: metadata.genre || 'Unknown Genre',
        duration: metadata.duration || 0,
        coverUrl: metadata.coverUrl,
        format: file.type,
        trackNumber: metadata.trackNumber,
        path: (file as any).webkitRelativePath || file.name,
      });
    }
    setIsLoading(false);
  };

  const playTrack = useCallback(async (track: Track, queue: Track[] = tracks) => {
    setNowPlayingQueue(queue);
    const index = queue.findIndex(t => t.id === track.id);
    
    const nextAudio = activeAudioRef.current === 1 ? audio2Ref.current : audio1Ref.current;
    const currentAudio = activeAudioRef.current === 1 ? audio1Ref.current : audio2Ref.current;

    if (!nextAudio || !currentAudio) return;

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
  }, [tracks, audioSettings.crossfadeTime]);

  const togglePlay = () => {
    const audio = activeAudioRef.current === 1 ? audio1Ref.current : audio2Ref.current;
    if (!audio) return;
    if (isPlaying) audio.pause();
    else audio.play();
    setIsPlaying(!isPlaying);
  };

  const playNext = useCallback(() => {
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
      }
    };

    const handleEnded = () => {
      if (isRepeat) {
        const audio = activeAudioRef.current === 1 ? audio1 : audio2;
        audio.currentTime = 0;
        audio.play();
      } else {
        playNext();
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
  }, [playNext, isRepeat]);

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
          <div className="space-y-2 pb-32">
            {filteredTracks.map((track) => (
              <TrackItem 
                key={track.id} 
                track={track} 
                isActive={currentTrack?.id === track.id}
                onClick={() => playTrack(track, tracks)}
                isPlaying={isPlaying}
              />
            ))}
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
      case 'folders':
        return <FolderBrowser tree={folderTree} onPlayTrack={(t) => playTrack(t, tracks)} />;
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
                onClick={() => {
                  const name = prompt('Playlist Name:');
                  if (name) db.playlists.add({ id: Math.random().toString(), name, trackIds: [], createdAt: Date.now() });
                }}
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
                    <button className="p-2 hover:bg-white/10 rounded-lg"><Play size={18} /></button>
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
          <h1 className="text-xl font-bold tracking-tighter">SONIC</h1>
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
            className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl flex items-center gap-2 transition-all"
          >
            <Plus size={18} /> Import
          </button>
          <input ref={fileInputRef} type="file" multiple accept="audio/*" className="hidden" onChange={handleFileSelect} />
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
      <nav className="h-20 bg-white/5 backdrop-blur-2xl border-t border-white/10 flex items-center justify-around px-6 z-30">
        <NavButton icon={<Music />} label="Tracks" active={activeTab === 'tracks'} onClick={() => setActiveTab('tracks')} />
        <NavButton icon={<LayoutGrid />} label="Albums" active={activeTab === 'albums'} onClick={() => setActiveTab('albums')} />
        <NavButton icon={<Users />} label="Artists" active={activeTab === 'artists'} onClick={() => setActiveTab('artists')} />
        <NavButton icon={<Music />} label="Genres" active={activeTab === 'genres'} onClick={() => setActiveTab('genres')} />
        <NavButton icon={<List />} label="Playlists" active={activeTab === 'playlists'} onClick={() => setActiveTab('playlists')} />
        <NavButton icon={<Folder />} label="Folders" active={activeTab === 'folders'} onClick={() => setActiveTab('folders')} />
        <NavButton icon={<Settings />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
      </nav>

      {/* Mini-Player / Full-Screen Player */}
      <AnimatePresence>
        {currentTrack && (
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
                  <button className="p-2 hover:bg-white/10 rounded-full"><MoreHorizontal /></button>
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
                      <h2 className="text-4xl font-bold mb-2">{currentTrack.title}</h2>
                      <p className="text-xl text-white/40">{currentTrack.artist}</p>
                    </div>
                  </div>

                  {/* Queue */}
                  <div className="w-full md:w-96 h-full flex flex-col bg-white/5 rounded-3xl border border-white/10 overflow-hidden">
                    <div className="p-4 border-b border-white/10 flex items-center justify-between">
                      <h3 className="font-bold flex items-center gap-2"><List size={18} /> Up Next</h3>
                      <span className="text-xs text-white/40">{nowPlayingQueue.length} tracks</span>
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
                                if (currentIndex === idx) playNext();
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
                    <button onClick={playNext} className="text-white hover:scale-110 transition-transform"><SkipForward size={48} fill="currentColor" /></button>
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
                    <h4 className="font-semibold truncate">{currentTrack.title}</h4>
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
                  <button onClick={playNext} className="text-white/60 hover:text-white transition-colors"><SkipForward size={24} fill="currentColor" /></button>
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

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
      `}</style>
    </div>
  );
}

// --- Sub-components ---

function NavButton({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 transition-all group relative px-4",
        active ? "text-emerald-500" : "text-white/40 hover:text-white"
      )}
    >
      <div className={cn("transition-transform group-hover:scale-110", active && "scale-110")}>{icon}</div>
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      {active && <motion.div layoutId="nav-active" className="absolute -top-2 w-1 h-1 bg-emerald-500 rounded-full" />}
    </button>
  );
}

function TrackItem({ track, isActive, onClick, isPlaying }: { track: Track, isActive: boolean, onClick: () => void, isPlaying: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full p-3 rounded-xl flex items-center gap-4 transition-all group",
        isActive ? "bg-emerald-500/10 border border-emerald-500/20" : "hover:bg-white/5 border border-transparent"
      )}
    >
      <div className="w-12 h-12 rounded-lg bg-white/5 flex-shrink-0 overflow-hidden flex items-center justify-center relative">
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
      <div className="flex-1 text-left overflow-hidden">
        <p className={cn("font-medium truncate", isActive ? "text-emerald-400" : "text-white")}>{track.title}</p>
        <p className="text-sm text-white/40 truncate">{track.artist} • {track.album}</p>
      </div>
      <div className="text-xs font-mono text-white/20">{formatTime(track.duration)}</div>
      <button className="p-2 text-white/20 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"><MoreHorizontal size={18} /></button>
    </button>
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
            <span className="font-medium">{t.title}</span>
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
        <button 
          onClick={onReset}
          className="px-6 py-3 bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl font-semibold hover:bg-red-500 hover:text-white transition-all flex items-center gap-2"
        >
          <Trash2 size={18} /> Clear Library Cache
        </button>
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
