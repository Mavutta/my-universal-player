import React, { useState, useRef, useEffect, useCallback, ChangeEvent } from 'react';
import { 
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, 
  List, Search, Plus, Music, Volume2, VolumeX,
  Disc, Heart, Share2, MoreHorizontal, X, Trash2, GripVertical
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { Track, PlayerState } from './lib/types';
import { extractMetadata } from './lib/metadata';
import { isNativelySupported, decodeToWav } from './lib/audio';
import { cn, formatTime } from './lib/utils';
import Visualizer from './components/Visualizer';

export default function App() {
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'library' | 'queue'>('library');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentTrack = currentIndex >= 0 ? playlist[currentIndex] : null;

  // Handle file selection
  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsLoading(true);
    const newTracks: Track[] = [];

    for (const file of files as File[]) {
      const metadata = await extractMetadata(file);
      newTracks.push({
        id: Math.random().toString(36).substr(2, 9),
        file,
        title: metadata.title || file.name,
        artist: metadata.artist || 'Unknown Artist',
        album: metadata.album || 'Unknown Album',
        duration: metadata.duration || 0,
        coverUrl: metadata.coverUrl,
        format: file.type,
        trackNumber: metadata.trackNumber,
      });
    }

    setPlaylist(prev => [...prev, ...newTracks]);
    if (currentIndex === -1) setCurrentIndex(0);
    setIsLoading(false);
  };

  // Play/Pause toggle
  const togglePlay = () => {
    if (!audioRef.current || currentIndex === -1) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  // Next/Prev track
  const playNext = useCallback(() => {
    if (playlist.length === 0) return;
    if (isShuffle) {
      setCurrentIndex(Math.floor(Math.random() * playlist.length));
    } else {
      setCurrentIndex(prev => (prev + 1) % playlist.length);
    }
  }, [playlist.length, isShuffle]);

  const playPrev = () => {
    if (playlist.length === 0) return;
    setCurrentIndex(prev => (prev - 1 + playlist.length) % playlist.length);
  };

  const removeTrack = (id: string) => {
    const indexToRemove = playlist.findIndex(t => t.id === id);
    if (indexToRemove === -1) return;
    
    const newPlaylist = playlist.filter(t => t.id !== id);
    setPlaylist(newPlaylist);
    
    if (indexToRemove === currentIndex) {
      if (newPlaylist.length === 0) {
        setCurrentIndex(-1);
        setIsPlaying(false);
      } else {
        setCurrentIndex(prev => prev % newPlaylist.length);
      }
    } else if (indexToRemove < currentIndex) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleReorderQueue = (newQueue: Track[]) => {
    const newPlaylist = [...playlist.slice(0, currentIndex + 1), ...newQueue];
    setPlaylist(newPlaylist);
  };

  // Handle track change
  useEffect(() => {
    if (!audioRef.current || currentIndex === -1) return;

    const track = playlist[currentIndex];
    const playTrack = async () => {
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

      audioRef.current!.src = url;
      audioRef.current!.play();
      setIsPlaying(true);
    };

    playTrack();
  }, [currentIndex, playlist]);

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleDurationChange = () => setDuration(audio.duration);
    const handleEnded = () => {
      if (isRepeat) {
        audio.currentTime = 0;
        audio.play();
      } else {
        playNext();
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [playNext, isRepeat]);

  // Volume control
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  const filteredPlaylist = playlist.filter(track => 
    track.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    track.artist.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-emerald-500/30 overflow-hidden flex flex-col md:flex-row">
      <audio ref={audioRef} />
      
      {/* Sidebar / Playlist */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.aside 
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            className="w-full md:w-80 h-full md:h-screen bg-white/5 backdrop-blur-xl border-r border-white/10 flex flex-col z-20"
          >
            <div className="p-6 flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
                  <Music className="text-emerald-500" />
                  {sidebarTab === 'library' ? 'Library' : 'Up Next'}
                </h2>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setSidebarTab(sidebarTab === 'library' ? 'queue' : 'library')}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white"
                    title={sidebarTab === 'library' ? 'Show Queue' : 'Show Library'}
                  >
                    <List size={20} className={sidebarTab === 'queue' ? 'text-emerald-500' : ''} />
                  </button>
                  <button 
                    onClick={() => setIsSidebarOpen(false)}
                    className="md:hidden p-2 hover:bg-white/10 rounded-full transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {sidebarTab === 'library' ? (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
                    <input 
                      type="text" 
                      placeholder="Search tracks..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-4 focus:outline-none focus:border-emerald-500/50 transition-colors"
                    />
                  </div>

                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-emerald-500/20"
                  >
                    <Plus size={20} />
                    Add Tracks
                  </button>
                </>
              ) : (
                <div className="text-sm text-white/40 font-medium">
                  {playlist.length - (currentIndex + 1)} tracks remaining
                </div>
              )}
              <input 
                ref={fileInputRef}
                type="file" 
                multiple 
                accept="audio/*" 
                className="hidden" 
                onChange={handleFileSelect}
              />
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-6 custom-scrollbar">
              {sidebarTab === 'library' ? (
                <div className="space-y-2">
                  {filteredPlaylist.map((track) => (
                    <button
                      key={track.id}
                      onClick={() => setCurrentIndex(playlist.indexOf(track))}
                      className={cn(
                        "w-full p-3 rounded-xl flex items-center gap-3 transition-all group",
                        currentIndex === playlist.indexOf(track) 
                          ? "bg-emerald-500/20 border border-emerald-500/30" 
                          : "hover:bg-white/5 border border-transparent"
                      )}
                    >
                      <div className="w-10 h-10 rounded-lg bg-white/10 flex-shrink-0 overflow-hidden flex items-center justify-center">
                        {track.coverUrl ? (
                          <img src={track.coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <Music size={18} className="text-white/40" />
                        )}
                      </div>
                      <div className="flex-1 text-left overflow-hidden">
                        <p className={cn(
                          "text-sm font-medium truncate",
                          currentIndex === playlist.indexOf(track) ? "text-emerald-400" : "text-white"
                        )}>
                          {track.title}
                        </p>
                        <p className="text-xs text-white/40 truncate">{track.artist}</p>
                      </div>
                      {currentIndex === playlist.indexOf(track) && isPlaying && (
                        <div className="flex gap-0.5 items-end h-3">
                          <motion.div animate={{ height: [4, 12, 4] }} transition={{ repeat: Infinity, duration: 0.6 }} className="w-0.5 bg-emerald-500" />
                          <motion.div animate={{ height: [8, 4, 8] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-0.5 bg-emerald-500" />
                          <motion.div animate={{ height: [4, 10, 4] }} transition={{ repeat: Infinity, duration: 0.7 }} className="w-0.5 bg-emerald-500" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <Reorder.Group 
                  axis="y" 
                  values={playlist.slice(currentIndex + 1)} 
                  onReorder={handleReorderQueue}
                  className="space-y-2"
                >
                  {playlist.slice(currentIndex + 1).map((track) => (
                    <Reorder.Item
                      key={track.id}
                      value={track}
                      className="w-full p-3 bg-white/5 border border-white/10 rounded-xl flex items-center gap-3 group cursor-default"
                    >
                      <div className="text-white/20 cursor-grab active:cursor-grabbing">
                        <GripVertical size={18} />
                      </div>
                      <div className="w-10 h-10 rounded-lg bg-white/10 flex-shrink-0 overflow-hidden flex items-center justify-center">
                        {track.coverUrl ? (
                          <img src={track.coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <Music size={18} className="text-white/40" />
                        )}
                      </div>
                      <div className="flex-1 text-left overflow-hidden">
                        <p className="text-sm font-medium truncate text-white">{track.title}</p>
                        <p className="text-xs text-white/40 truncate">{track.artist}</p>
                      </div>
                      <button 
                        onClick={() => removeTrack(track.id)}
                        className="p-2 text-white/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={18} />
                      </button>
                    </Reorder.Item>
                  ))}
                  {playlist.length <= currentIndex + 1 && (
                    <div className="text-center py-12 text-white/20">
                      <p>Queue is empty</p>
                    </div>
                  )}
                </Reorder.Group>
              )}
              {playlist.length === 0 && sidebarTab === 'library' && (
                <div className="text-center py-12 text-white/20">
                  <Disc size={48} className="mx-auto mb-4 opacity-10" />
                  <p>Your playlist is empty</p>
                </div>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Player View */}
      <main className="flex-1 relative flex flex-col items-center justify-center p-6 md:p-12">
        {!isSidebarOpen && (
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="absolute top-6 left-6 p-3 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 transition-all z-10"
          >
            <List size={24} />
          </button>
        )}

        <div className="max-w-md w-full flex flex-col items-center gap-12">
          {/* Album Art Visualization */}
          <div 
            className="relative group cursor-zoom-in" 
            onClick={() => currentTrack && setIsZoomed(true)}
          >
            <div className="absolute inset-0 bg-emerald-500/20 blur-[100px] rounded-full opacity-50 group-hover:opacity-80 transition-opacity" />
            <motion.div 
              layoutId="album-art"
              animate={{ 
                rotate: isPlaying ? 360 : 0,
                scale: isPlaying ? 1.05 : 1
              }}
              transition={{ 
                rotate: { duration: 20, repeat: Infinity, ease: "linear" },
                scale: { duration: 0.5 }
              }}
              className="relative w-64 h-64 md:w-80 md:h-80 rounded-full border-8 border-white/5 shadow-2xl overflow-hidden flex items-center justify-center bg-zinc-900"
            >
              {currentTrack?.coverUrl ? (
                <img src={currentTrack.coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="flex flex-col items-center gap-4 text-white/20">
                  <Disc size={120} strokeWidth={1} />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-tr from-black/40 to-transparent pointer-events-none" />
              <div className="absolute w-4 h-4 bg-[#0a0a0a] rounded-full border-2 border-white/10 shadow-inner" />
            </motion.div>
          </div>

          {/* Track Info */}
          <div className="text-center space-y-2 w-full">
            <motion.h1 
              key={currentTrack?.id}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="text-3xl md:text-4xl font-bold tracking-tight truncate px-4"
            >
              {currentTrack?.title || 'No Track Selected'}
            </motion.h1>
            <motion.p 
              key={currentTrack?.artist}
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="text-lg text-white/60"
            >
              {currentTrack?.artist || 'Select a file to begin'}
            </motion.p>
          </div>

          {/* Progress Bar */}
          <div className="w-full space-y-4">
            <Visualizer audioRef={audioRef} isPlaying={isPlaying} />
            <div className="relative h-1.5 w-full bg-white/10 rounded-full overflow-hidden group cursor-pointer">
              <div 
                className="absolute top-0 left-0 h-full bg-emerald-500 transition-all duration-100"
                style={{ width: `${(currentTime / duration) * 100}%` }}
              />
              <input 
                type="range" 
                min="0" 
                max={duration || 0} 
                value={currentTime}
                onChange={(e) => {
                  const time = parseFloat(e.target.value);
                  setCurrentTime(time);
                  if (audioRef.current) audioRef.current.currentTime = time;
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
            <div className="flex justify-between text-xs font-medium text-white/40">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Main Controls */}
          <div className="flex flex-col gap-8 w-full">
            <div className="flex items-center justify-between px-4">
              <button 
                onClick={() => setIsShuffle(!isShuffle)}
                className={cn("p-2 transition-colors", isShuffle ? "text-emerald-500" : "text-white/40 hover:text-white")}
              >
                <Shuffle size={20} />
              </button>
              <div className="flex items-center gap-6 md:gap-10">
                <button onClick={playPrev} className="p-2 text-white/60 hover:text-white transition-colors active:scale-90">
                  <SkipBack size={32} fill="currentColor" />
                </button>
                <button 
                  onClick={togglePlay}
                  className="w-20 h-20 rounded-full bg-white text-black flex items-center justify-center shadow-xl shadow-white/10 hover:scale-105 active:scale-95 transition-all"
                >
                  {isPlaying ? <Pause size={36} fill="currentColor" /> : <Play size={36} fill="currentColor" className="ml-1" />}
                </button>
                <button onClick={playNext} className="p-2 text-white/60 hover:text-white transition-colors active:scale-90">
                  <SkipForward size={32} fill="currentColor" />
                </button>
              </div>
              <button 
                onClick={() => setIsRepeat(!isRepeat)}
                className={cn("p-2 transition-colors", isRepeat ? "text-emerald-500" : "text-white/40 hover:text-white")}
              >
                <Repeat size={20} />
              </button>
            </div>

            {/* Volume & Actions */}
            <div className="flex items-center gap-6 bg-white/5 backdrop-blur-lg p-4 rounded-3xl border border-white/10">
              <button onClick={() => setIsMuted(!isMuted)} className="text-white/60 hover:text-white transition-colors">
                {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
              <div className="flex-1 relative h-1 bg-white/10 rounded-full group cursor-pointer">
                <div 
                  className="absolute top-0 left-0 h-full bg-white/40 rounded-full group-hover:bg-emerald-500 transition-colors"
                  style={{ width: `${volume * 100}%` }}
                />
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.01"
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>
              <div className="flex items-center gap-4 text-white/40">
                <button className="hover:text-white transition-colors"><Heart size={20} /></button>
                <button className="hover:text-white transition-colors"><Share2 size={20} /></button>
                <button className="hover:text-white transition-colors"><MoreHorizontal size={20} /></button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Loading Overlay */}
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex flex-col items-center justify-center gap-6"
          >
            <div className="relative">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                className="w-20 h-20 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full"
              />
              <Disc className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-emerald-500 animate-pulse" size={32} />
            </div>
            <div className="text-center">
              <h3 className="text-xl font-bold">Decoding Audio</h3>
              <p className="text-white/40 text-sm">Optimizing for universal playback...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Zoomed Album Art Overlay */}
      <AnimatePresence>
        {isZoomed && currentTrack && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-2xl z-[60] flex items-center justify-center p-6 md:p-12"
            onClick={() => setIsZoomed(false)}
          >
            <motion.button 
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              onClick={(e) => {
                e.stopPropagation();
                setIsZoomed(false);
              }}
              className="absolute top-8 right-8 p-4 bg-white/10 hover:bg-white/20 rounded-full border border-white/10 transition-all z-[70]"
            >
              <X size={32} />
            </motion.button>
            
            <motion.div 
              layoutId="album-art"
              className="relative w-full max-w-2xl aspect-square rounded-3xl overflow-hidden shadow-2xl border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              {currentTrack.coverUrl ? (
                <img src={currentTrack.coverUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-full h-full bg-zinc-900 flex items-center justify-center text-white/10">
                  <Disc size={200} strokeWidth={1} />
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-black/80 to-transparent">
                <h2 className="text-3xl font-bold">{currentTrack.title}</h2>
                <p className="text-xl text-white/60">{currentTrack.artist}</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}
