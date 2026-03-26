import { AudioSettings } from './types';

export class AudioEngine {
  private context: AudioContext;
  private source1: MediaElementAudioSourceNode | null = null;
  private source2: MediaElementAudioSourceNode | null = null;
  private gain1: GainNode;
  private gain2: GainNode;
  private preAmp: GainNode;
  private eqFilters: BiquadFilterNode[] = [];
  private compressor: DynamicsCompressorNode;
  private limiter: DynamicsCompressorNode;
  private analyzer: AnalyserNode;
  
  // Stereo Widener & Mono nodes
  private splitter: ChannelSplitterNode;
  private merger: ChannelMergerNode;
  private leftDelay: DelayNode;
  private rightDelay: DelayNode;
  private stereoGain: GainNode;
  private monoGain: GainNode;
  private normalizationGain: GainNode;
  private widenerOutput: GainNode;

  private frequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  constructor(audio1: HTMLAudioElement, audio2: HTMLAudioElement) {
    // 1. Audiophile Audio Stack
    let sampleRate = 48000;
    try {
      const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (tempCtx.sampleRate >= 192000) sampleRate = 192000;
      else if (tempCtx.sampleRate >= 96000) sampleRate = 96000;
      tempCtx.close();
    } catch (e) {}

    this.context = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate,
      latencyHint: 'playback'
    });
    
    // 2. Sources & Crossfade Gains
    this.source1 = this.context.createMediaElementSource(audio1);
    this.source2 = this.context.createMediaElementSource(audio2);
    this.gain1 = this.context.createGain();
    this.gain2 = this.context.createGain();
    this.gain1.gain.value = 1;
    this.gain2.gain.value = 0;

    // 3. Pre-Amp (-15dB to +15dB)
    this.preAmp = this.context.createGain();
    this.preAmp.gain.value = 1; // 0dB

    // 4. 10-Band Parametric EQ
    this.frequencies.forEach((freq, i) => {
      const filter = this.context.createBiquadFilter();
      filter.type = i === 0 ? 'lowshelf' : i === this.frequencies.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.414;
      filter.gain.value = 0;
      this.eqFilters.push(filter);
    });

    // 5. Dynamics Compressor (Dynamics Processor)
    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 30;
    this.compressor.ratio.value = 12;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    // 6. Stereo Expander & Mono Logic
    this.splitter = this.context.createChannelSplitter(2);
    this.merger = this.context.createChannelMerger(2);
    this.leftDelay = this.context.createDelay();
    this.rightDelay = this.context.createDelay();
    this.stereoGain = this.context.createGain();
    this.monoGain = this.context.createGain();
    this.widenerOutput = this.context.createGain();

    this.leftDelay.delayTime.value = 0;
    this.rightDelay.delayTime.value = 0.02; 
    this.stereoGain.gain.value = 1;
    this.monoGain.gain.value = 0;

    // 7. Master Soft Limiter (Zero Clipping)
    this.limiter = this.context.createDynamicsCompressor();
    this.limiter.threshold.value = -1.0; 
    this.limiter.knee.value = 0; 
    this.limiter.ratio.value = 20; 
    this.limiter.attack.value = 0.003; 
    this.limiter.release.value = 0.1;

    // 8. Analyzer
    this.analyzer = this.context.createAnalyser();
    this.analyzer.fftSize = 1024;

    // --- Connections (32-bit Float Signal Chain) ---
    this.source1.connect(this.gain1);
    this.source2.connect(this.gain2);
    this.gain1.connect(this.preAmp);
    this.gain2.connect(this.preAmp);

    // EQ Chain
    let lastNode: AudioNode = this.preAmp;
    this.eqFilters.forEach(filter => {
      lastNode.connect(filter);
      lastNode = filter;
    });

    // Dynamics Processor
    lastNode.connect(this.compressor);
    lastNode = this.compressor;

    // Stereo Expander Path
    lastNode.connect(this.splitter);
    
    // Normal Stereo
    this.splitter.connect(this.merger, 0, 0);
    this.splitter.connect(this.merger, 1, 1);
    
    // Expanded Stereo
    this.splitter.connect(this.leftDelay, 0);
    this.splitter.connect(this.rightDelay, 1);
    this.leftDelay.connect(this.merger, 0, 0);
    this.rightDelay.connect(this.merger, 0, 1);
    
    // Mono Sum
    const monoSum = this.context.createGain();
    monoSum.gain.value = 0.5;
    this.splitter.connect(monoSum, 0);
    this.splitter.connect(monoSum, 1);
    monoSum.connect(this.monoGain);
    
    this.merger.connect(this.stereoGain);
    this.stereoGain.connect(this.widenerOutput);
    this.monoGain.connect(this.widenerOutput);
    
    // Normalization
    this.normalizationGain = this.context.createGain();
    this.normalizationGain.gain.value = 1;
    this.widenerOutput.connect(this.normalizationGain);
    lastNode = this.normalizationGain;

    // Soft Limiter
    lastNode.connect(this.limiter);
    lastNode = this.limiter;

    // Output
    lastNode.connect(this.analyzer);
    this.analyzer.connect(this.context.destination);
  }

  public crossfade(toSource: 1 | 2, duration: number) {
    const now = this.context.currentTime;
    let rampTime = Number.isFinite(duration) && duration > 0 ? duration / 2 : 0.01;
    if (rampTime > 10) rampTime = 10; // Cap ramp time to 10s
    
    if (toSource === 1) {
      this.gain1.gain.setTargetAtTime(1, now, rampTime);
      this.gain2.gain.setTargetAtTime(0, now, rampTime);
    } else {
      this.gain1.gain.setTargetAtTime(0, now, rampTime);
      this.gain2.gain.setTargetAtTime(1, now, rampTime);
    }
  }

  public setPreAmp(db: number) {
    if (!Number.isFinite(db)) return;
    const gain = Math.pow(10, db / 20);
    if (!Number.isFinite(gain)) return;
    this.preAmp.gain.setTargetAtTime(gain, this.context.currentTime, 0.1);
  }

  public setEQ(gains: number[]) {
    gains.forEach((gain, i) => {
      if (this.eqFilters[i] && Number.isFinite(gain)) {
        this.eqFilters[i].gain.setTargetAtTime(gain, this.context.currentTime, 0.1);
      }
    });
  }

  public setCompression(enabled: boolean) {
    if (enabled) {
      this.compressor.threshold.setTargetAtTime(-24, this.context.currentTime, 0.1);
      this.compressor.ratio.setTargetAtTime(12, this.context.currentTime, 0.1);
    } else {
      this.compressor.threshold.setTargetAtTime(0, this.context.currentTime, 0.1);
      this.compressor.ratio.setTargetAtTime(1, this.context.currentTime, 0.1);
    }
  }

  public setLimiter(enabled: boolean) {
    if (enabled) {
      this.limiter.threshold.setTargetAtTime(-0.5, this.context.currentTime, 0.1);
      this.limiter.ratio.setTargetAtTime(20, this.context.currentTime, 0.1);
    } else {
      this.limiter.threshold.setTargetAtTime(0, this.context.currentTime, 0.1);
      this.limiter.ratio.setTargetAtTime(1, this.context.currentTime, 0.1);
    }
  }

  public setMono(enabled: boolean) {
    const now = this.context.currentTime;
    if (enabled) {
      this.stereoGain.gain.setTargetAtTime(0, now, 0.1);
      this.monoGain.gain.setTargetAtTime(1, now, 0.1);
    } else {
      this.stereoGain.gain.setTargetAtTime(1, now, 0.1);
      this.monoGain.gain.setTargetAtTime(0, now, 0.1);
    }
  }

  public setNormalization(enabled: boolean) {
    const now = this.context.currentTime;
    // Boost quiet tracks, limiter will catch the peaks
    this.normalizationGain.gain.setTargetAtTime(enabled ? 1.4 : 1, now, 0.1);
  }

  public setStereoWidener(enabled: boolean, amount: number) {
    const now = this.context.currentTime;
    if (enabled && Number.isFinite(amount)) {
      this.rightDelay.delayTime.setTargetAtTime(0.005 + (amount * 0.025), now, 0.1);
    } else {
      this.rightDelay.delayTime.setTargetAtTime(0, now, 0.1);
    }
  }

  public setVolume(value: number) {
    if (!Number.isFinite(value)) return;
    // We'll use the pre-limiter gain for volume to keep the limiter effective
    this.widenerOutput.gain.setTargetAtTime(value, this.context.currentTime, 0.1);
  }

  public getAnalyzer() {
    return this.analyzer;
  }

  public async resume() {
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
  }
}
