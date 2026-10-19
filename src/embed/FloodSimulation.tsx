import React, { useEffect, useRef } from 'react';
import { BoundingBox, FrameStats, SimulationConfig } from '../core/types';
import { useFloodStore } from '../ui/store/useFloodStore';
import { FloodViewport3D, FloodViewport3DHandle } from '../ui/viewport/FloodViewport3D';
import { AreaPickerMap } from '../ui/map/AreaPickerMap';
import { SidePanel } from '../ui/panels/SidePanel';
import { AnimationPlayer } from '../ui/player/AnimationPlayer';
import { StatisticsBar } from '../ui/panels/StatisticsBar';
import { DepthLegend } from '../ui/panels/DepthLegend';
import { InspectPopup } from '../ui/panels/InspectPopup';
import { ErrorBoundary } from '../ui/ErrorBoundary';

export interface FloodSimulationProps {
  bounds?: BoundingBox;
  config?: Partial<SimulationConfig>;
  onResult?: (result: { stats: FrameStats; summaryJson: string; geoJson: string }) => void;
  onError?: (error: string) => void;
  className?: string;
  theme?: {
    primaryColor?: string;
    surfaceColor?: string;
    textColor?: string;
  };
  hideSidePanel?: boolean;
}

export const FloodSimulation: React.FC<FloodSimulationProps> = ({
  bounds,
  config,
  onResult,
  onError,
  className = '',
  theme,
  hideSidePanel = false,
}) => {
  const viewportRef = useRef<FloodViewport3DHandle>(null);

  const {
    dem,
    status,
    errorMessage,
    is2DMode,
    setBounds,
    updateConfig,
    loadTerrainForBounds,
    loadPreset,
    exportSummaryJson,
    exportGeoJsonFile,
    frames,
  } = useFloodStore();

  // Initialize bounds and config if provided
  useEffect(() => {
    if (bounds) {
      setBounds(bounds);
      loadTerrainForBounds(bounds, config?.gridSize || 256);
    } else if (!dem) {
      // Default to first preset
      loadPreset('swat_river');
    }
  }, [bounds]);

  useEffect(() => {
    if (config) {
      updateConfig(config);
    }
  }, [config]);

  // Notify on result
  useEffect(() => {
    if (status === 'finished' && onResult && frames.length > 0) {
      const lastFrame = frames[frames.length - 1];
      const summaryJson = exportSummaryJson() || '';
      const geoJson = exportGeoJsonFile() || '';
      onResult({
        stats: lastFrame.stats,
        summaryJson,
        geoJson,
      });
    }
  }, [status]);

  // Notify on error
  useEffect(() => {
    if (status === 'error' && errorMessage && onError) {
      onError(errorMessage);
    }
  }, [status, errorMessage]);

  const customStyle: React.CSSProperties = {
    ...(theme?.primaryColor ? { '--flood-primary': theme.primaryColor } : {}),
    ...(theme?.surfaceColor ? { '--flood-surface': theme.surfaceColor } : {}),
    ...(theme?.textColor ? { '--flood-text': theme.textColor } : {}),
  } as any;

  return (
    <div
      style={customStyle}
      className={`relative w-full h-full overflow-hidden bg-slate-950 font-sans ${className}`}
    >
      {/* 2D Area Picker or 3D Simulation Viewport */}
      {is2DMode ? (
        <AreaPickerMap />
      ) : (
        <>
          <FloodViewport3D ref={viewportRef} />

          {/* Floating UI overlays */}
          {!hideSidePanel && (
            <SidePanel
              onCameraPreset={(preset) => viewportRef.current?.setCameraPreset(preset)}
              onSnapshot={() => viewportRef.current?.takeSnapshot()}
              onRecordToggle={() => viewportRef.current?.toggleRecording() ?? false}
            />
          )}

          {/* Top-Right Statistics Bar */}
          <div className="absolute top-4 right-4 z-20 hidden md:block">
            <StatisticsBar />
          </div>

          {/* Bottom-Right Depth Legend */}
          <div className="absolute bottom-20 right-4 z-20">
            <DepthLegend />
          </div>

          {/* Inspection Popup */}
          <ErrorBoundary fallbackTitle="Error displaying cell inspection">
            <InspectPopup />
          </ErrorBoundary>
        </>
      )}

      {/* Bottom Animation Player Bar */}
      <div className="absolute bottom-0 left-0 right-0 z-30">
        <AnimationPlayer />
      </div>
    </div>
  );
};
