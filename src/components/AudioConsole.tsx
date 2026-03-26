import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { 
  Zap, Sliders, Activity, Volume2, 
  Maximize, Minimize, Shield, 
  ToggleLeft, ToggleRight,
  RotateCcw, Save
} from 'lucide-react';
import { AudioSettings } from '../lib/types';
import { EQ_PRESETS } from '../lib/constants';
import { cn } from '../lib/utils';

interface AudioConsoleProps {
  settings: AudioSettings;
  onUpdate: (settings: AudioSettings) => void;
  analyzer: AnalyserNode | null;
}

const FREQUENCIES = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

export default function AudioConsole({ settings, onUpdate, analyzer }: AudioConsoleProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    if (!analyzer || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const bufferLength = analyzer.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyzer.getByteFrequencyData(dataArray);

      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        
        // Color based on frequency
        const hue = (i / bufferLength) * 360;
        ctx.fillStyle = `hsla(${hue}, 70%, 50%, 0.8)`;
        
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }

      // Draw frequency labels
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.font = '10px monospace';
      [31, 125, 500, 2000, 8000, 16000].forEach(freq => {
        const xPos = (Math.log10(freq) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)) * canvas.width;
        ctx.fillText(freq >= 1000 ? `${freq/1000}k` : freq.toString(), xPos, canvas.height - 5);
      });
    };

    draw();
    return () => cancelAnimationFrame(animationRef.current);
  }, [analyzer]);

  const handleEqChange = (index: number, value: number) => {
    const newGains = [...settings.eqGains];
    newGains[index] = value;
    onUpdate({ ...settings, eqGains: newGains });
  };

  const resetEq = () => {
    onUpdate({ ...settings, eqGains: new Array(10).fill(0), preAmpGain: 0 });
  };

  return (
    <div className="space-y-8 pb-32">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-emerald-500/20 rounded-2xl flex items-center justify-center text-emerald-500">
            <Zap size={28} />
          </div>
          <div>
            <h2 className="text-3xl font-bold tracking-tighter">Audiophile Console</h2>
            <p className="text-sm text-white/40 uppercase tracking-widest font-bold">32-Bit Floating Point DSP</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={resetEq}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-colors text-sm font-bold uppercase tracking-widest"
          >
            <RotateCcw size={16} /> Reset
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-black rounded-xl transition-colors text-sm font-bold uppercase tracking-widest">
            <Save size={16} /> Save Preset
          </button>
        </div>
      </header>

      {/* Spectrum Analyzer */}
      <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 overflow-hidden relative group">
        <div className="absolute top-4 left-6 flex items-center gap-2 text-white/20 text-[10px] font-bold uppercase tracking-[0.3em]">
          <Activity size={12} /> Real-time FFT Spectrum
        </div>
        <canvas ref={canvasRef} width={1200} height={200} className="w-full h-48 opacity-80" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* EQ Section */}
        <div className="lg:col-span-2 bg-zinc-900/50 border border-white/5 rounded-3xl p-8">
          <div className="flex items-center justify-between mb-12">
            <h3 className="font-bold flex items-center gap-2 text-white/60 uppercase tracking-widest text-sm">
              <Sliders size={18} className="text-emerald-500" /> 10-Band Parametric EQ
            </h3>
            <div className="flex gap-2">
              {Object.keys(EQ_PRESETS).map(p => (
                <button 
                  key={p} 
                  onClick={() => onUpdate({ ...settings, eqGains: EQ_PRESETS[p as keyof typeof EQ_PRESETS] })}
                  className="px-3 py-1 bg-white/5 hover:bg-emerald-500/20 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-between items-end h-64 gap-2">
            {/* Pre-Amp */}
            <div className="flex flex-col items-center gap-4 mr-8">
              <VerticalFader 
                label="Pre" 
                value={settings.preAmpGain} 
                min={-15} 
                max={15} 
                onChange={(v) => onUpdate({ ...settings, preAmpGain: v })}
                color="emerald"
              />
              <span className="text-[10px] font-bold text-white/20 uppercase">Pre-Amp</span>
            </div>

            {/* EQ Bands */}
            {FREQUENCIES.map((freq, i) => (
              <VerticalFader 
                key={freq}
                label={freq}
                value={settings.eqGains[i]}
                min={-12}
                max={12}
                onChange={(v) => handleEqChange(i, v)}
              />
            ))}
          </div>
        </div>

        {/* DSP Controls */}
        <div className="space-y-6">
          <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 space-y-6">
            <h3 className="font-bold flex items-center gap-2 text-white/60 uppercase tracking-widest text-sm">
              <Shield size={18} className="text-emerald-500" /> Protection & Dynamics
            </h3>
            
            <DSPTogglable 
              icon={<Shield size={16} />}
              label="Master Soft Limiter"
              description="Prevents digital clipping"
              active={settings.isLimiterEnabled}
              onToggle={() => onUpdate({ ...settings, isLimiterEnabled: !settings.isLimiterEnabled })}
            />

            <DSPTogglable 
              icon={<Volume2 size={16} />}
              label="Auto Normalization"
              description="Consistent track loudness"
              active={settings.isNormalizationEnabled}
              onToggle={() => onUpdate({ ...settings, isNormalizationEnabled: !settings.isNormalizationEnabled })}
            />

            <DSPTogglable 
              icon={<Activity size={16} />}
              label="Dynamics Compressor"
              description="Normalizes dynamic range"
              active={settings.isCompressionEnabled}
              onToggle={() => onUpdate({ ...settings, isCompressionEnabled: !settings.isCompressionEnabled })}
            />
          </div>

          <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 space-y-6">
            <h3 className="font-bold flex items-center gap-2 text-white/60 uppercase tracking-widest text-sm">
              <Maximize size={18} className="text-emerald-500" /> Spatial Imaging
            </h3>

            <DSPTogglable 
              icon={<Maximize size={16} />}
              label="Stereo Widener"
              description="Expands soundstage"
              active={settings.isStereoWidenerEnabled}
              onToggle={() => onUpdate({ ...settings, isStereoWidenerEnabled: !settings.isStereoWidenerEnabled })}
            />

            {settings.isStereoWidenerEnabled && (
              <div className="space-y-2 px-2">
                <div className="flex justify-between text-[10px] font-bold text-white/40 uppercase">
                  <span>Width</span>
                  <span>{Math.round(settings.stereoWidenerAmount * 100)}%</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.01" 
                  value={settings.stereoWidenerAmount}
                  onChange={(e) => onUpdate({ ...settings, stereoWidenerAmount: parseFloat(e.target.value) })}
                  className="w-full accent-emerald-500"
                />
              </div>
            )}

            <DSPTogglable 
              icon={<Minimize size={16} />}
              label="Mono Mode"
              description="Sum L/R channels"
              active={settings.isMonoEnabled}
              onToggle={() => onUpdate({ ...settings, isMonoEnabled: !settings.isMonoEnabled })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function VerticalFader({ label, value, min, max, onChange, color = "white" }: { 
  label: string, 
  value: number, 
  min: number, 
  max: number, 
  onChange: (v: number) => void,
  color?: "white" | "emerald"
}) {
  return (
    <div className="flex flex-col items-center gap-3 h-full group">
      <span className={cn(
        "text-[10px] font-mono font-bold transition-colors",
        value !== 0 ? "text-emerald-500" : "text-white/20"
      )}>
        {value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1)}
      </span>
      <div className="relative flex-1 w-8 bg-white/5 rounded-full overflow-hidden border border-white/5">
        <div 
          className={cn(
            "absolute bottom-0 left-0 right-0 transition-all duration-100",
            color === "emerald" ? "bg-emerald-500/40" : "bg-white/10 group-hover:bg-emerald-500/20"
          )}
          style={{ height: `${((value - min) / (max - min)) * 100}%` }}
        />
        <input 
          type="range"
          min={min}
          max={max}
          step="0.1"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [writing-mode:bt-lr] appearance-slider-vertical"
          style={{ transform: 'rotate(-90deg)', width: '160px', height: '32px', position: 'absolute', top: '64px', left: '-64px' }}
        />
        {/* Zero line */}
        <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-white/10 pointer-events-none" />
      </div>
      <span className="text-[10px] font-bold text-white/40 uppercase tracking-tighter">{label}</span>
    </div>
  );
}

function DSPTogglable({ icon, label, description, active, onToggle }: {
  icon: React.ReactNode,
  label: string,
  description: string,
  active: boolean,
  onToggle: () => void
}) {
  return (
    <button 
      onClick={onToggle}
      className={cn(
        "w-full p-4 rounded-2xl border transition-all flex items-center justify-between group",
        active ? "bg-emerald-500/10 border-emerald-500/30" : "bg-white/5 border-white/5 hover:border-white/10"
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
          active ? "bg-emerald-500 text-black" : "bg-white/5 text-white/40 group-hover:text-white"
        )}>
          {icon}
        </div>
        <div className="text-left">
          <p className={cn("text-sm font-bold uppercase tracking-widest", active ? "text-emerald-500" : "text-white/60")}>{label}</p>
          <p className="text-[10px] text-white/20 uppercase font-bold">{description}</p>
        </div>
      </div>
      {active ? <ToggleRight className="text-emerald-500" /> : <ToggleLeft className="text-white/20" />}
    </button>
  );
}
