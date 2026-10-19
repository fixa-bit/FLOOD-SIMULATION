# FloodSim: 3D Interactive Hydrodynamic Flood Simulator

**FloodSim** is a high-performance, standalone 3D hydraulic flood simulation engine built with **Vite, React, TypeScript, Three.js, and MapLibre GL JS**. It enables users to select **ANY** area on Earth, automatically stitches free global digital elevation models (DEM), extracts 3D urban infrastructure, and simulates physically accurate flood inundation using a 2D shallow-water local-inertial solver running in a Web Worker.

Designed for seamless integration into the **FloodGuard** disaster management platform.

---

## Architecture

The codebase is organized into decoupled layers:

```
/src/core         Pure TypeScript, ZERO React or DOM dependencies
  ├── terrain/    DEM fetching, Terrarium decoding, resampling, pit filling, flow accumulation
  ├── sim/        Local-inertial 2D Saint-Venant hydraulic solver & Web Worker
  ├── analysis/   OSM infrastructure parsing (Overpass), risk zones, GeoJSON/JSON export
  └── types.ts    Unified configuration and state interfaces
/src/viewer       Three.js 3D WebGL renderer (terrain shader, water shader, building extrusion, raycasting)
/src/ui           React UI components (Autodesk InfraWorks animation player, collapsible panels, charts, map)
/src/embed        Integration layer (React component, iframe postMessage API, URL parameter parser)
```

---

## Key Features

1. **Global Area Selection (MapLibre GL JS)**:
   - Search any location on Earth via Nominatim geocoding.
   - Preset demo regions: **Swat River Valley**, **Nowshera (Kabul River)**, **Indus River (Sukkur Barrage)**, and **Boulder Canyon (USA)**.
   - Enforces $2 \times 2\text{ km}$ to $20 \times 20\text{ km}$ domains with dynamic compute time estimations.

2. **Automated Terrain Pipeline**:
   - Fetches and stitches AWS Terrarium DEM tiles:
     $$\text{Elevation (m)} = (R \times 256 + G + B / 256) - 32768$$
   - Resamples to regular $256 \times 256$ or $512 \times 512$ grids.
   - Cleans nodata, ocean boundaries, and performs priority-flood depression pit-filling.
   - D8 flow accumulation auto-detects valley channels and suggests upstream river inlet points.
   - Client-side IndexedDB caching for instant reloads.

3. **2D Local-Inertial Shallow Water Solver**:
   - Implements the Bates et al. (2010) / de Almeida et al. (2012) formulation of Saint-Venant shallow water equations.
   - Semi-implicit treatment of Manning's friction roughness ($n = 0.035$).
   - Exact two-pass donor-cell flux limiter guaranteeing strict non-negativity and machine-precision mass conservation.
   - Adaptive CFL timestep calculation:
     $$\Delta t = \alpha \frac{\Delta x}{\sqrt{g h} + |v|}$$
   - Point inflows (constant, rising-falling, flash flood, custom time series) + uniform rainfall hyetographs (mm/hr).
   - Runs in a background Web Worker with zero-copy `ArrayBuffer` transfers.

4. **3D Three.js Visualization**:
   - Semi-transparent water shader with depth coloring (light cyan $\to$ deep navy blue), shoreline edge fade, animated wave ripples, and specular lighting.
   - Draped high-resolution Esri World Imagery satellite tiles, OpenStreetMap tiles, or analytical hypsometric hillshading.
   - 3D extruded OpenStreetMap buildings that turn alert red when submerged $> 0.3\text{m}$.
   - Live dashboard metrics: inundated area ($\text{km}^2$), submerged road length ($\text{km}$), flooded buildings, and mass conservation error %.
   - Orbit controls with camera presets: Top-Down, Oblique 45°, and Inflow Source zoom.
   - Interactive click-to-inspect popup with Recharts time-series depth hydrographs.
   - High-resolution PNG snapshots and WebM video recording.

---

## Getting Started

### Prerequisites
- Node.js 18+ (tested on Node v20/v22/v24)
- npm 9+

### Installation
```bash
npm install
```

### Development Server
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### Production Build
```bash
npm run build
```

### Run Unit Tests
```bash
npm run test
```
Executes the Vitest test suite testing DEM tile decoding, exact mass conservation under closed boundaries, and a 2D dam-break shockwave benchmark.

---

## Two Sample Test Scenarios

### Sample 1: Swat River Valley (Pakistan)
- **Location**: Mingora / Kabal, Khyber Pakhtunkhwa (`34.78° N, 72.34° E`)
- **Recommended Inflow**: `850 m³/s` base discharge, `2.8x` peak multiplier
- **Hydrograph Preset**: Rising-Falling Curve
- **Rainfall**: `35 mm/hr` for 30 minutes
- **Duration**: `3600s` (1 hour)
- **Observations**: Observe the rapid propagation of the flash flood wave through the steep mountain gorge, overtopping river banks, and flooding settlements along the valley floor.

### Sample 2: Nowshera / Kabul River Confluence (Pakistan)
- **Location**: Nowshera District (`34.01° N, 71.98° E`)
- **Recommended Inflow**: `1200 m³/s` base discharge, `2.2x` peak multiplier
- **Duration**: `7200s` (2 hours)
- **Observations**: High building density flood modeling. Observe broad alluvial plain expansion, critical road network submergence, and high vs medium hazard zones.

---

## Integration with FloodGuard

FloodSim provides three integration options (see [INTEGRATION.md](file:///d:/Projects/flood%20simulaTOR/INTEGRATION.md) for full code examples):
1. **React Component**: `<FloodSimulation bounds={...} config={...} onResult={...} />`
2. **Iframe / postMessage API**: Bidirectional messaging supporting `setArea`, `setConfig`, `run`, `play`, `pause`, and result events.
3. **Deep Link URL Parameters**: `?bbox=72.30,34.74,72.38,34.82&inflow=900&autostart=true`

---

## Assumptions & Limitations

1. **Educational & Screening Model**: FloodSim is designed for rapid interactive scenario modeling, emergency planning, and spatial screening. It is not a replacement for certified 1D/2D hydraulic engineering compliance studies (e.g., FEMA NFIP or HEC-RAS certified regulatory models).
2. **Local-Inertial Saint-Venant Approximation**: The model neglects convective advective acceleration $(v \cdot \nabla v)$. This approximation is valid for subcritical river and floodplain flow ($Fr < 1$), but does not capture transcritical transitions, hydraulic jumps, or 3D turbulence eddies.
3. **Digital Surface Model (DSM)**: Global satellite radar tiles (AW3D30/SRTM/Terrarium) capture the top of water surfaces and vegetation canopy rather than bathymetric channel bottoms. River bed depths beneath existing water bodies are approximated.
4. **Infiltration & Soil Porosity**: The solver models net effective rainfall and overland runoff. It does not solve multi-layer Richards soil percolation equations unless coupled with FloodGuard hydrologic loss models.
5. **Building Obstructions**: Building footprints are rasterized at DEM grid sample locations. Covered cells are impermeable, have no hydraulic storage, and block flow across every adjacent face. Footprints that cover no grid samples remain unresolved; use a finer grid for small buildings and narrow streets. Building height does not permit overtopping in this approximation. Flood exposure and red building coloring use exterior water-surface elevation relative to building ground level. Roof rainfall/runoff, doorway leakage, and internal filling are not modeled. Inlet discharge is distributed only over unblocked cells in its source kernel; an entirely blocked inlet raises an error.
6. **Initial Water**: When `DemData.initialWaterDepth` is supplied, it is copied through the worker into the solver and included in the initial mass balance. Entries must be finite, non-negative, and match the grid size. Solid building interiors start dry and exclude any supplied initial depth. The default terrain loader does not infer river depths from elevation tiles; without supplied depths, simulations start dry.
