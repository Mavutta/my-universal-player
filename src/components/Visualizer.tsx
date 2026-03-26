import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  analyzer: AnalyserNode | null;
  isPlaying: boolean;
}

export default function Visualizer({ analyzer, isPlaying }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    if (!analyzer || !canvasRef.current) return;

    const bufferLength = analyzer.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyzer.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;

        const gradient = ctx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
        gradient.addColorStop(0, '#10b981'); // emerald-500
        gradient.addColorStop(1, 'rgba(16, 185, 129, 0.1)');

        ctx.fillStyle = gradient;
        
        // Rounded top for bars
        ctx.beginPath();
        ctx.roundRect(x, canvas.height - barHeight, barWidth, barHeight, [4, 4, 0, 0]);
        ctx.fill();

        x += barWidth + 2;
      }
    };

    if (isPlaying) {
      draw();
    } else {
      cancelAnimationFrame(animationRef.current);
    }

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [analyzer, isPlaying]);

  return (
    <canvas 
      ref={canvasRef} 
      width={600} 
      height={120} 
      className="w-full h-24 opacity-40 pointer-events-none"
    />
  );
}
