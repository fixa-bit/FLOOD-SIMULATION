import React, { useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  RotateCcw,
  XCircle,
  Loader2,
} from 'lucide-react';
import { useFloodStore } from '../store/useFloodStore';

function formatSimTime(seconds: number): string {
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const AnimationPlayer: React.FC = () => {
  const {
    status,
    frames,
    currentFrameIndex,
    isPlaying,
    playbackSpeed,
    isLooping,
    config,
    progressPercent,
    progressStage,
    pause,
    togglePlay,
    seekFrame,
    setPlaybackSpeed,
    toggleLoop,
    resetSimulation,
    cancelSimulation,
  } = useFloodStore();

  const totalFrames = frames.length;
  const currentFrame = frames[currentFrameIndex];
  const currentTimeSec = currentFrame ? currentFrame.simulatedTimeSeconds : 0;
  const totalDurationSec = config.duration;

  // Playback timer loop
  const animRef = useRef<number | null>(null);
  const lastTickTime = useRef<number>(Date.now());

  useEffect(() => {
    if (!isPlaying || totalFrames <= 1) return;

    const intervalMs = 1000 / (15 * playbackSpeed); // ~15-60 fps scaled by speed

    const tick = () => {
      const now = Date.now();
      if (now - lastTickTime.current >= intervalMs) {
        lastTickTime.current = now;
        const nextIndex = currentFrameIndex + 1;
        if (nextIndex >= totalFrames) {
          if (isLooping) {
            seekFrame(0);
          } else {
            pause();
          }
        } else {
          seekFrame(nextIndex);
        }
      }
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);

    return () => {
      if (animRef.current !== null) {
        cancelAnimationFrame(animRef.current);
      }
    };
  }, [isPlaying, currentFrameIndex, totalFrames, playbackSpeed, isLooping]);

  // If simulation is computing
  if (status === 'simulating' || status === 'loading_terrain') {
    return (
      <div className="w-full bg-slate-900/95 backdrop-blur-xl border-t border-slate-700/80 px-6 py-3 flex items-center justify-between gap-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-200">
              {status === 'loading_terrain' ? 'Preparing 3D Terrain' : 'Simulating Hydrodynamics'}
            </span>
            <span className="text-[11px] text-slate-400 font-mono">{progressStage}</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex-1 max-w-xl flex items-center gap-3">
          <div className="flex-1 bg-slate-800 rounded-full h-2.5 overflow-hidden border border-slate-700">
            <div
              className="bg-gradient-to-r from-sky-500 to-blue-500 h-full rounded-full transition-all duration-150"
              style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
            />
          </div>
          <span className="text-xs font-mono font-medium text-sky-400 w-12 text-right">
            {progressPercent.toFixed(0)}%
          </span>
        </div>

        <button
          onClick={cancelSimulation}
          className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 border border-red-500/50 text-red-300 rounded-lg text-xs font-medium transition flex items-center gap-1.5"
        >
          <XCircle className="w-3.5 h-3.5" />
          <span>Cancel</span>
        </button>
      </div>
    );
  }

  const speedOptions: (1 | 2 | 4 | 8)[] = [1, 2, 4, 8];

  return (
    <div className="w-full bg-slate-900/90 backdrop-blur-xl border-t border-slate-700/80 px-6 py-2.5 flex flex-col md:flex-row items-center justify-between gap-4 shadow-2xl select-none">
      {/* Left controls: Play, Pause, Reset, Step */}
      <div className="flex items-center gap-2">
        <button
          onClick={resetSimulation}
          disabled={totalFrames === 0}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition disabled:opacity-30"
          title="Reset Simulation"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <button
          onClick={() => seekFrame(Math.max(0, currentFrameIndex - 1))}
          disabled={totalFrames <= 1 || currentFrameIndex === 0}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition disabled:opacity-30"
          title="Step Backward"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          onClick={togglePlay}
          disabled={totalFrames === 0}
          className="p-3 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white rounded-xl shadow-lg shadow-sky-500/25 transition disabled:opacity-30"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
        </button>

        <button
          onClick={() => seekFrame(Math.min(totalFrames - 1, currentFrameIndex + 1))}
          disabled={totalFrames <= 1 || currentFrameIndex === totalFrames - 1}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition disabled:opacity-30"
          title="Step Forward"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        <button
          onClick={toggleLoop}
          className={`p-2 rounded-lg transition ${
            isLooping ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40' : 'text-slate-400 hover:text-white'
          }`}
          title={isLooping ? 'Looping enabled' : 'Looping disabled'}
        >
          <Repeat className="w-4 h-4" />
        </button>
      </div>

      {/* Center: Timeline Scrub Slider & Simulated Time */}
      <div className="flex-1 w-full max-w-2xl flex items-center gap-4">
        <span className="text-xs font-mono font-semibold text-sky-400 w-16 text-right">
          {formatSimTime(currentTimeSec)}
        </span>

        <div className="relative flex-1 flex items-center">
          <input
            type="range"
            min={0}
            max={Math.max(0, totalFrames - 1)}
            value={currentFrameIndex}
            onChange={(e) => seekFrame(parseInt(e.target.value, 10))}
            disabled={totalFrames <= 1}
            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400 border border-slate-700/80 focus:outline-none"
          />
        </div>

        <span className="text-xs font-mono text-slate-400 w-16">
          {formatSimTime(totalDurationSec)}
        </span>
      </div>

      {/* Right controls: Speed multiplier & Frame count */}
      <div className="flex items-center gap-3">
        <div className="flex items-center bg-slate-800/90 rounded-lg p-0.5 border border-slate-700">
          {speedOptions.map((speed) => (
            <button
              key={speed}
              onClick={() => setPlaybackSpeed(speed)}
              className={`px-2 py-1 rounded text-[11px] font-mono font-medium transition ${
                playbackSpeed === speed
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {speed}x
            </button>
          ))}
        </div>

        <div className="text-[11px] font-mono text-slate-400 bg-slate-800/50 px-2 py-1 rounded border border-slate-700/60 hidden sm:block">
          Frame: {totalFrames > 0 ? `${currentFrameIndex + 1}/${totalFrames}` : '0/0'}
        </div>
      </div>
    </div>
  );
};
