import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { FloodViewer, CameraPreset } from '../../viewer/FloodViewer';
import { useFloodStore } from '../store/useFloodStore';
import { Loader2 } from 'lucide-react';
import { dataSources } from '../../core/analysis/dataSources';

export interface FloodViewport3DHandle {
  setCameraPreset: (preset: CameraPreset) => void;
  takeSnapshot: () => void;
  toggleRecording: () => boolean;
}

export const FloodViewport3D = forwardRef<FloodViewport3DHandle>((_, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<FloodViewer | null>(null);

  const {
    dem,
    bounds,
    buildings,
    roads,
    infrastructureSource,
    frames,
    currentFrameIndex,
    verticalExaggeration,
    textureMode,
    waterLayerMode,
    maxDepthLegend,
    layersVisible,
    setInspectedCell,
    setImagerySource,
    status,
    progressStage,
  } = useFloodStore();

  const [isRecording, setIsRecording] = useState(false);

  // Initialize FloodViewer when DEM is loaded
  useEffect(() => {
    if (!containerRef.current || !dem) return;
    let active = true;
    setImagerySource(undefined);

    // Dispose old viewer
    if (viewerRef.current) {
      viewerRef.current.dispose();
      viewerRef.current = null;
    }

    const viewer = new FloodViewer({
      container: containerRef.current,
      bounds,
      dem,
      buildings,
      roads,
      sourceLines: [dataSources({ dem, buildings, roads, infrastructureSource }).terrain.label,
        dataSources({ dem, buildings, roads, infrastructureSource }).infrastructure.label],
      onTextureSource: source => { if (active) setImagerySource(source); },
      onInspectCell: (data) => {
        setInspectedCell(data);
      },
    });

    viewerRef.current = viewer;

    // Apply current store state
    viewer.setVerticalExaggeration(verticalExaggeration);
    viewer.setTextureMode(textureMode);
    viewer.setWaterLayerMode(waterLayerMode);
    viewer.setMaxDepthLegend(maxDepthLegend);

    return () => {
      active = false;
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [dem, bounds]);

  // Synchronize simulation frame updates
  useEffect(() => {
    if (!viewerRef.current || frames.length === 0) return;
    const frame = frames[currentFrameIndex];
    if (frame) {
      viewerRef.current.updateSimulationFrame(frame);
    }
  }, [frames, currentFrameIndex]);

  // Synchronize vertical exaggeration
  useEffect(() => {
    viewerRef.current?.setVerticalExaggeration(verticalExaggeration);
  }, [verticalExaggeration]);

  // Synchronize texture mode
  useEffect(() => {
    viewerRef.current?.setTextureMode(textureMode);
  }, [textureMode]);

  // Synchronize water layer mode
  useEffect(() => {
    viewerRef.current?.setWaterLayerMode(waterLayerMode);
  }, [waterLayerMode]);

  // Synchronize max depth
  useEffect(() => {
    viewerRef.current?.setMaxDepthLegend(maxDepthLegend);
  }, [maxDepthLegend]);

  // Synchronize layer visibility
  useEffect(() => {
    if (!viewerRef.current) return;
    viewerRef.current.setLayerVisibility('water', layersVisible.water);
    viewerRef.current.setLayerVisibility('buildings', layersVisible.buildings);
    viewerRef.current.setLayerVisibility('roads', layersVisible.roads);
  }, [layersVisible]);

  // Expose camera presets and media actions via ref
  useImperativeHandle(ref, () => ({
    setCameraPreset: (preset: CameraPreset) => {
      viewerRef.current?.setCameraPreset(preset);
    },
    takeSnapshot: () => {
      if (!viewerRef.current) return;
      const dataUrl = viewerRef.current.takeSnapshot();
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `floodsim_snapshot_${Date.now()}.png`;
      a.click();
    },
    toggleRecording: () => {
      if (!viewerRef.current) return false;
      if (isRecording) {
        viewerRef.current.stopRecording();
        setIsRecording(false);
        return false;
      } else {
        const started = viewerRef.current.startRecording();
        setIsRecording(started);
        return started;
      }
    },
  }));

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden">
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Loading overlay if loading terrain */}
      {status === 'loading_terrain' && (
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md z-40 flex flex-col items-center justify-center gap-3 select-none">
          <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
          <span className="text-sm font-semibold text-slate-200">Processing 3D Terrain & Hydrology</span>
          <span className="text-xs text-slate-400 font-mono">{progressStage}</span>
        </div>
      )}
    </div>
  );
});
