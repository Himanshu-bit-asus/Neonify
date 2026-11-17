"use client";

import { useEffect, useRef } from "react";
import { usePlayer } from "@/components/player-provider";
import { cn } from "@/lib/utils";

interface AudioVisualizerProps {
  className?: string;
  barCount?: number;
  height?: number;
  compact?: boolean;
}

export function AudioVisualizer({
  className,
  barCount = 32,
  height = 48,
  compact = false,
}: AudioVisualizerProps) {
  const { playing, getAudioFrequencyData } = usePlayer();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let isRunning = true;

    const render = () => {
      if (!isRunning) return;

      // Only animate if document is visible and playing to preserve CPU/battery
      if (document.visibilityState !== "visible" || !playing) {
        // Clear or draw idle flat line
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (compact) {
          ctx.fillStyle = "rgba(190, 242, 100, 0.25)";
          const barWidth = canvas.width / barCount;
          for (let i = 0; i < barCount; i++) {
            ctx.fillRect(i * barWidth + 1, canvas.height - 3, Math.max(1, barWidth - 2), 3);
          }
        }
        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }

      const freqData = getAudioFrequencyData();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const totalBars = barCount;
      const barWidth = canvas.width / totalBars;

      for (let i = 0; i < totalBars; i++) {
        // Map bar index to frequency bin
        let val = 0;
        if (freqData && freqData.length > 0) {
          const binIndex = Math.floor((i / totalBars) * (freqData.length * 0.75));
          val = freqData[binIndex] || 0;
        } else {
          // Synthetic subtle bounce if direct media source is CORS restricted
          val = Math.sin(Date.now() / 200 + i * 0.4) * 50 + 60;
        }

        const percent = val / 255;
        const barHeight = Math.max(3, percent * canvas.height);
        const x = i * barWidth;
        const y = canvas.height - barHeight;

        // Gradient for neon look
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0, "#84cc16"); // Lime
        gradient.addColorStop(0.6, "#bef264"); // Neon lime
        gradient.addColorStop(1, "#a855f7"); // Purple peak

        ctx.fillStyle = gradient;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x + 1, y, Math.max(1, barWidth - 2), barHeight, [2, 2, 0, 0]);
        } else {
          ctx.rect(x + 1, y, Math.max(1, barWidth - 2), barHeight);
        }
        ctx.fill();
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      isRunning = false;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [barCount, compact, getAudioFrequencyData, playing]);

  return (
    <canvas
      ref={canvasRef}
      width={barCount * 4}
      height={height}
      className={cn("pointer-events-none block", className)}
    />
  );
}
