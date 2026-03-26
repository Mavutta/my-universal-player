import { AudioSettings } from './types';

export class AudioEngine {
  private context: AudioContext;
  private source1: MediaElementAudioSourceNode | null = null;
  private source2: MediaElementAudioSourceNode | null = null;
  private gain1: GainNode;
  private gain2: GainNode;
  private analyzer: AnalyserNode;
  private compressor: DynamicsCompressorNode;
  private eqFilters: BiquadFilterNode[] = [];
  private reverbNode: ConvolverNode;
  private reverbGain: GainNode;
  private masterGain: GainNode;

  private frequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  constructor(audio1: HTMLAudioElement, audio2: HTMLAudioElement) {
    this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.analyzer = this.context.createAnalyser();
    this.analyzer.fftSize = 512;

    this.compressor = this.context.createDynamicsCompressor();
    
    // Setup EQ
    this.frequencies.forEach((freq, i) => {
      const filter = this.context.createBiquadFilter();
      filter.type = i === 0 ? 'lowshelf' : i === this.frequencies.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1;
      filter.gain.value = 0;
      this.eqFilters.push(filter);
    });

    // Setup Reverb
    this.reverbNode = this.context.createConvolver();
    this.reverbGain = this.context.createGain();
    this.reverbGain.gain.value = 0;

    this.masterGain = this.context.createGain();

    // Setup Gains for crossfading
    this.gain1 = this.context.createGain();
    this.gain2 = this.context.createGain();
    this.gain1.gain.value = 1;
    this.gain2.gain.value = 0;

    // Connect sources
    this.source1 = this.context.createMediaElementSource(audio1);
    this.source2 = this.context.createMediaElementSource(audio2);
    
    this.source1.connect(this.gain1);
    this.source2.connect(this.gain2);

    // Connect to EQ chain
    let lastNode: AudioNode = this.gain1;
    this.gain1.connect(this.eqFilters[0]);
    this.gain2.connect(this.eqFilters[0]);
    
    lastNode = this.eqFilters[0];
    for (let i = 1; i < this.eqFilters.length; i++) {
      lastNode.connect(this.eqFilters[i]);
      lastNode = this.eqFilters[i];
    }

    // Compressor
    lastNode.connect(this.compressor);
    lastNode = this.compressor;

    // Reverb branch
    lastNode.connect(this.reverbGain);
    this.reverbGain.connect(this.reverbNode);
    this.reverbNode.connect(this.masterGain);

    // Main path
    lastNode.connect(this.masterGain);
    
    this.masterGain.connect(this.analyzer);
    this.analyzer.connect(this.context.destination);

    this.createReverbImpulse();
  }

  public crossfade(toSource: 1 | 2, duration: number) {
    const now = this.context.currentTime;
    if (toSource === 1) {
      this.gain1.gain.setTargetAtTime(1, now, duration / 4);
      this.gain2.gain.setTargetAtTime(0, now, duration / 4);
    } else {
      this.gain1.gain.setTargetAtTime(0, now, duration / 4);
      this.gain2.gain.setTargetAtTime(1, now, duration / 4);
    }
  }

  public setVolume(value: number) {
    this.masterGain.gain.setTargetAtTime(value, this.context.currentTime, 0.1);
  }

  private async createReverbImpulse() {
    // Create a simple synthetic impulse response for reverb
    const sampleRate = this.context.sampleRate;
    const length = sampleRate * 2; // 2 seconds
    const impulse = this.context.createBuffer(2, length, sampleRate);
    for (let i = 0; i < 2; i++) {
      const channelData = impulse.getChannelData(i);
      for (let j = 0; j < length; j++) {
        channelData[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 2);
      }
    }
    this.reverbNode.buffer = impulse;
  }

  public setEQ(gains: number[]) {
    gains.forEach((gain, i) => {
      if (this.eqFilters[i]) {
        this.eqFilters[i].gain.setTargetAtTime(gain, this.context.currentTime, 0.1);
      }
    });
  }

  public setCompression(enabled: boolean) {
    // DynamicsCompressor is always in chain, we just adjust its parameters to be "transparent" if disabled
    if (enabled) {
      this.compressor.threshold.setTargetAtTime(-24, this.context.currentTime, 0.1);
      this.compressor.knee.setTargetAtTime(30, this.context.currentTime, 0.1);
      this.compressor.ratio.setTargetAtTime(12, this.context.currentTime, 0.1);
      this.compressor.attack.setTargetAtTime(0.003, this.context.currentTime, 0.1);
      this.compressor.release.setTargetAtTime(0.25, this.context.currentTime, 0.1);
    } else {
      this.compressor.threshold.setTargetAtTime(0, this.context.currentTime, 0.1);
      this.compressor.ratio.setTargetAtTime(1, this.context.currentTime, 0.1);
    }
  }

  public setReverb(enabled: boolean) {
    this.reverbGain.gain.setTargetAtTime(enabled ? 0.5 : 0, this.context.currentTime, 0.1);
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
