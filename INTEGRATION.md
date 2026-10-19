# FloodSim Integration Guide for FloodGuard

This guide outlines how to integrate **FloodSim** into the **FloodGuard** disaster management platform. FloodSim is built from day one as an independent, modular hydraulic simulation engine with multiple seamless integration paths.

---

## 1. Integration Methods

### Method A: Embeddable React Component
The most direct and powerful integration for React-based FloodGuard frontends.

#### Installation / Import
Ensure `floodsim` is included in your project dependencies or monorepo workspace:

```tsx
import React from 'react';
import { FloodSimulation, BoundingBox, SimulationConfig } from 'floodsim';

export const FloodGuardAnalyticsPage: React.FC = () => {
  const swatBounds: BoundingBox = {
    west: 72.30,
    south: 34.74,
    east: 72.38,
    north: 34.82,
  };

  const simulationConfig: Partial<SimulationConfig> = {
    duration: 3600, // 1 hour
    manningsN: 0.035,
    inflowPreset: 'rising_falling',
    inflows: [
      {
        id: 'inflow_sensor_station_12',
        gridX: 68,
        gridY: 18,
        lon: 72.321,
        lat: 34.805,
        baseDischarge: 950, // m3/s from FloodGuard real-time telemetry
        label: 'Sensor Station 12 (Swat River)',
      },
    ],
    rainfall: {
      intensityMmPerHour: 40, // from FloodGuard Doppler radar forecast
      durationSeconds: 1800,
    },
  };

  const handleSimulationResult = (result: {
    stats: any;
    summaryJson: string;
    geoJson: string;
  }) => {
    console.log('Flooded Buildings Count:', result.stats.affectedBuildingsCount);
    console.log('Peak Inundation Extent (GeoJSON):', result.geoJson);

    // Send result to FloodGuard backend / alert dispatch
  };

  return (
    <div className="w-full h-[800px] rounded-2xl overflow-hidden border border-slate-800">
      <FloodSimulation
        bounds={swatBounds}
        config={simulationConfig}
        onResult={handleSimulationResult}
        onError={(err) => console.error('FloodSim Error:', err)}
        theme={{
          primaryColor: '#0ea5e9',
          surfaceColor: '#0f172a',
          textColor: '#f8fafc',
        }}
      />
    </div>
  );
};
```

---

### Method B: Iframe / postMessage API
Ideal for micro-frontends or embedding FloodSim across different origins or legacy systems without coupling runtime dependencies.

#### Iframe HTML
```html
<iframe
  id="floodsim-frame"
  src="https://floodsim.yourdomain.com/?preset=swat_river"
  width="100%"
  height="750"
  frameborder="0"
  allow="fullscreen"
></iframe>
```

#### Parent Window (FloodGuard) Communication Controller
```typescript
const iframe = document.getElementById('floodsim-frame') as HTMLIFrameElement;

// 1. Listen for outgoing messages from FloodSim
window.addEventListener('message', (event) => {
  if (event.data?.source !== 'FloodSim') return;

  switch (event.data.type) {
    case 'ready':
      console.log('FloodSim iframe engine is ready');
      // Configure custom area or hydrographs
      setCustomFloodScenario();
      break;

    case 'progress':
      console.log(`Simulation Progress: ${event.data.payload.percent}% (${event.data.payload.stage})`);
      break;

    case 'finished':
      console.log('Simulation complete! Summary metrics:', event.data.stats);
      console.log('GeoJSON Flood Boundary:', event.data.payload.geoJson);
      break;

    case 'error':
      console.error('FloodSim error:', event.data.error);
      break;
  }
});

// 2. Send commands to FloodSim
function setCustomFloodScenario() {
  // Update Area
  iframe.contentWindow?.postMessage({
    type: 'setArea',
    bounds: { west: 71.93, south: 33.97, east: 72.03, north: 34.05 },
  }, '*');

  // Inject real gauge time-series from FloodGuard
  iframe.contentWindow?.postMessage({
    type: 'setConfig',
    config: {
      duration: 7200,
      manningsN: 0.032,
    },
  }, '*');

  // Trigger solver execution
  iframe.contentWindow?.postMessage({ type: 'run' }, '*');
}

// Playback controls from external toolbar
function playSimulation() {
  iframe.contentWindow?.postMessage({ type: 'play' }, '*');
}

function pauseSimulation() {
  iframe.contentWindow?.postMessage({ type: 'pause' }, '*');
}
```

---

### Method C: Deep-Linking with URL Parameters
Launch FloodSim pre-configured with a single URL string for sharing, email reports, or direct navigation from FloodGuard alerts:

#### URL Parameter Specification
- `preset`: Preset demo ID (`swat_river`, `nowshera_kabul`, `indus_sukkur`, `boulder_canyon`)
- `bbox`: Bounding box `minLon,minLat,maxLon,maxLat`
- `inflow`: Base discharge in $m^3/s$
- `duration`: Simulation time in seconds
- `rain`: Rainfall intensity in $mm/hr$
- `autostart`: Set `true` to immediately initiate terrain fetch and solver execution

#### Examples
- Launch Swat River with 1200 m³/s flash flood:
  ```
  https://floodsim.app/?preset=swat_river&inflow=1200&autostart=true
  ```
- Launch custom area in Nowshera with intense 50 mm/hr monsoon rainfall:
  ```
  https://floodsim.app/?bbox=71.9300,33.9700,72.0300,34.0500&rain=50&duration=7200&autostart=true
  ```

---

## 2. Real Data Injection: Hydrometric Telemetry & Rainfall

FloodGuard can inject real hydrograph time-series from river gauges and Doppler rainfall predictions directly into the solver:

```typescript
import { InflowPoint, HydrographPoint } from 'floodsim';

const observedHydrograph: HydrographPoint[] = [
  { timeSeconds: 0, dischargeM3PerSec: 350 },
  { timeSeconds: 900, dischargeM3PerSec: 720 },
  { timeSeconds: 1800, dischargeM3PerSec: 1650 }, // Crest
  { timeSeconds: 2700, dischargeM3PerSec: 1100 },
  { timeSeconds: 3600, dischargeM3PerSec: 500 },
];

const sensorInflow: InflowPoint = {
  id: 'gauge_swat_chakdara',
  gridX: 68,
  gridY: 18,
  lon: 72.321,
  lat: 34.805,
  baseDischarge: 350,
  customHydrograph: observedHydrograph,
};
```

---

## 3. Results Export & GIS Integration

FloodSim exports standard GIS artifacts compatible with Mapbox, MapLibre, Leaflet, or ArcGIS:

1. **GeoJSON Flood Extent Polygon**:
   Exported at resolution cells with properties:
   - `depth_m`: Local water depth in meters
   - `hazard`: `'low' | 'medium' | 'high'`
2. **JSON Summary Report**:
   Contains total inundated area ($\text{km}^2$), affected building count, damaged road length ($\text{km}$), and mass balance conservation error percentage.

---

## 4. Theme Customization via CSS Variables

FloodSim inherits the look and feel of FloodGuard via standard CSS variables:

```css
:root {
  --flood-primary: #0284c7;       /* FloodGuard Brand Blue */
  --flood-surface: #0b1329;       /* Dark Navy Background */
  --flood-panel: rgba(11, 19, 41, 0.92);
  --flood-panel-border: rgba(30, 58, 138, 0.4);
  --flood-text: #f8fafc;
}
```
