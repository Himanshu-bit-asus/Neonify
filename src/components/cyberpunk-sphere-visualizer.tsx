"use client";

import { useEffect, useRef } from "react";
import { usePlayer } from "@/components/player-provider";
import { cn } from "@/lib/utils";

interface CyberpunkSphereVisualizerProps {
  className?: string;
}

export function CyberpunkSphereVisualizer({ className }: CyberpunkSphereVisualizerProps) {
  const { playing, getAudioFrequencyData } = usePlayer();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let isRunning = true;
    let rotationAngle = 0;

    // Define 3D wireframe sphere points
    const points: { x: number; y: number; z: number; origX: number; origY: number; origZ: number }[] = [];
    const numLat = 16;
    const numLon = 24;
    const radius = 95;

    for (let i = 0; i <= numLat; i++) {
      const theta = (i * Math.PI) / numLat;
      for (let j = 0; j < numLon; j++) {
        const phi = (j * 2 * Math.PI) / numLon;
        const x = radius * Math.sin(theta) * Math.cos(phi);
        const y = radius * Math.cos(theta);
        const z = radius * Math.sin(theta) * Math.sin(phi);
        points.push({ x, y, z, origX: x, origY: y, origZ: z });
      }
    }

    const render = () => {
      if (!isRunning) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const freqData = getAudioFrequencyData();
      let bassIntensity = 0;
      let midIntensity = 0;
      let highIntensity = 0;

      if (freqData && freqData.length > 0 && playing) {
        // Average bands
        bassIntensity = (freqData[1] + freqData[2] + freqData[3] + freqData[4]) / 4 / 255;
        midIntensity = (freqData[10] + freqData[12] + freqData[14]) / 3 / 255;
        highIntensity = (freqData[25] + freqData[28] + freqData[30]) / 3 / 255;
      } else if (playing) {
        // Ambient subtle harmonic motion
        bassIntensity = 0.25 + 0.15 * Math.sin(Date.now() / 250);
        midIntensity = 0.2 + 0.1 * Math.cos(Date.now() / 320);
        highIntensity = 0.15;
      }

      rotationAngle += 0.012 + bassIntensity * 0.025;

      const cosY = Math.cos(rotationAngle);
      const sinY = Math.sin(rotationAngle);
      const cosX = Math.cos(rotationAngle * 0.45);
      const sinX = Math.sin(rotationAngle * 0.45);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // Draw subtle glowing outer atmosphere
      const glowGrad = ctx.createRadialGradient(centerX, centerY, 15, centerX, centerY, radius * (1.3 + bassIntensity * 0.3));
      glowGrad.addColorStop(0, "rgba(163, 230, 53, 0.12)");
      glowGrad.addColorStop(0.5, "rgba(56, 189, 248, 0.06)");
      glowGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Project each 3D point
      const projected: { px: number; py: number; pz: number; pulseVal: number }[] = [];

      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        // Radial audio displacement
        const pulse = 1 + bassIntensity * 0.38 * Math.sin(i * 0.2 + rotationAngle * 3) + midIntensity * 0.18;
        const curX = pt.origX * pulse;
        const curY = pt.origY * pulse;
        const curZ = pt.origZ * pulse;

        // Rotate Y
        const x1 = curX * cosY + curZ * sinY;
        const z1 = -curX * sinY + curZ * cosY;

        // Rotate X
        const y2 = curY * cosX - z1 * sinX;
        const z2 = curY * sinX + z1 * cosX;

        // Perspective projection
        const fov = 280;
        const distance = fov + z2;
        const scale = fov / Math.max(distance, 50);

        const px = centerX + x1 * scale;
        const py = centerY + y2 * scale;

        projected.push({ px, py, pz: z2, pulseVal: pulse });
      }

      // Sort by Z for proper depth
      projected.sort((a, b) => a.pz - b.pz);

      // Render hologram vertices & rings
      for (let i = 0; i < projected.length; i++) {
        const p = projected[i];
        const alpha = Math.max(0.15, Math.min(0.95, (p.pz + radius) / (radius * 2)));

        ctx.beginPath();
        const size = Math.max(1.2, (p.pz + radius) * 0.02 + bassIntensity * 2);
        ctx.arc(p.px, p.py, size, 0, Math.PI * 2);

        if (p.pz > 0) {
          ctx.fillStyle = `rgba(190, 242, 100, ${alpha * 0.9})`; // Lime front
        } else {
          ctx.fillStyle = `rgba(168, 85, 247, ${alpha * 0.6})`; // Violet rear
        }
        ctx.fill();
      }

      // Orbit rings representing high & mid frequencies
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(rotationAngle * 0.8);
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 1.35 * (1 + highIntensity * 0.2), radius * 0.45, rotationAngle, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(56, 189, 248, ${0.25 + highIntensity * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      isRunning = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [getAudioFrequencyData, playing]);

  return (
    <div className={cn("relative flex flex-col items-center justify-center overflow-hidden rounded-3xl border border-lime-400/20 bg-gradient-to-b from-[#0a0f0a] to-[#040604] p-4", className)}>
      <div className="absolute left-4 top-4 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-lime-400 animate-ping" />
        <span className="text-[10px] font-black uppercase tracking-widest text-lime-300">
          Cyberpunk 3D Hologram Audio Node
        </span>
      </div>

      <canvas
        ref={canvasRef}
        width={340}
        height={260}
        className="block drop-shadow-[0_0_35px_rgba(163,230,53,0.3)]"
      />

      <div className="flex items-center gap-4 text-[10px] font-semibold text-zinc-400">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-lime-400" /> Bass Resonance
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-400" /> Depth Field
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> Orbital Freq
        </span>
      </div>
    </div>
  );
}
