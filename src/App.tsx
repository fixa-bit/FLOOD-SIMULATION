import React, { useEffect } from 'react';
import { FloodSimulation } from './embed/FloodSimulation';
import { parseUrlParameters } from './embed/urlParams';
import { initPostMessageBridge } from './embed/postMessageBridge';
import { useFloodStore } from './ui/store/useFloodStore';

export const App: React.FC = () => {
  const { loadPreset, setBounds, updateConfig, loadTerrainForBounds, startSimulation } = useFloodStore();

  useEffect(() => {
    // 1. Initialize iframe postMessage bridge
    const cleanupBridge = initPostMessageBridge();

    // 2. Parse URL parameters if present
    const urlConfig = parseUrlParameters();

    if (urlConfig.bounds) {
      setBounds(urlConfig.bounds);
      if (urlConfig.duration) updateConfig({ duration: urlConfig.duration });
      if (urlConfig.inflowDischarge) {
        updateConfig({
          inflows: [
            {
              id: 'url_inflow',
              gridX: 64,
              gridY: 32,
              lon: (urlConfig.bounds.west + urlConfig.bounds.east) / 2,
              lat: urlConfig.bounds.north - (urlConfig.bounds.north - urlConfig.bounds.south) * 0.2,
              baseDischarge: urlConfig.inflowDischarge,
              label: 'Custom Inflow',
            },
          ],
        });
      }
      loadTerrainForBounds(urlConfig.bounds, 256).then(() => {
        if (urlConfig.autoStart) {
          startSimulation();
        }
      });
    } else if (urlConfig.presetId) {
      loadPreset(urlConfig.presetId).then(() => {
        if (urlConfig.autoStart) {
          startSimulation();
        }
      });
    } else {
      // Default initial preset: Swat River Valley
      loadPreset('swat_river');
    }

    return () => {
      cleanupBridge();
    };
  }, []);

  return (
    <main className="w-screen h-screen overflow-hidden">
      <FloodSimulation />
    </main>
  );
};
