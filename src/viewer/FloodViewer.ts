import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BoundingBox, DataSource, DemData, OsmBuilding, OsmRoad, SimulationFrame, RiskLevel } from '../core/types';
import { createTerrainMaterial } from './terrainMaterial';
import { createWaterMaterial } from './waterShader';
import { loadDrapedTexture, TextureMode } from './textureFetcher';
import { calculateRiskLevel } from '../core/analysis/riskZones';
import { rasterizeBuildings, buildingWaterDepth } from '../core/sim/buildingObstacles';

export interface ViewerOptions {
  sourceLines?: string[];
  onTextureSource?: (source: DataSource) => void;
  container: HTMLDivElement;
  bounds: BoundingBox;
  dem: DemData;
  buildings?: OsmBuilding[];
  roads?: OsmRoad[];
  onInspectCell?: (data: {
    gridX: number;
    gridY: number;
    lon: number;
    lat: number;
    elevation: number;
    elevationMeters: number;
    waterDepth: number;
    currentWaterDepthMeters: number;
    velocity: number;
    currentVelocityMetersPerSec: number;
    riskLevel: RiskLevel;
  }) => void;
}

export type CameraPreset = 'top' | 'oblique' | 'flood';

export class FloodViewer {
  container: HTMLDivElement;
  bounds: BoundingBox;
  dem: DemData;
  buildings: OsmBuilding[] = [];
  buildingExposureCells = new Map<string, number[]>();
  roads: OsmRoad[] = [];
  onInspectCell?: ViewerOptions['onInspectCell'];
  onTextureSource?: ViewerOptions['onTextureSource'];
  sourceLines: string[];
  displaySourceLabel = 'Display imagery loading';
  recordingCanvas: HTMLCanvasElement | null = null;

  // Three.js Core
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  clock: THREE.Clock;

  // Meshes & Materials
  terrainMesh: THREE.Mesh | null = null;
  waterMesh: THREE.Mesh | null = null;
  terrainMaterial: THREE.ShaderMaterial | null = null;
  waterMaterial: THREE.ShaderMaterial | null = null;

  // Textures
  elevationTexture: THREE.DataTexture | null = null;
  depthTexture: THREE.DataTexture | null = null;
  velocityTexture: THREE.DataTexture | null = null;
  satelliteTexture: THREE.CanvasTexture | null = null;
  osmTexture: THREE.CanvasTexture | null = null;

  // Layers
  buildingMeshes: THREE.Mesh[] = [];
  roadLines: THREE.LineSegments | null = null;
  velocityArrowsGroup: THREE.Group | null = null;

  // State
  currentFrame: SimulationFrame | null = null;
  verticalExaggeration = 1.5;
  activeTextureMode: TextureMode = 'satellite';
  layerMode = 0; // 0: Realistic Water, 1: Depth Heatmap, 2: Risk Zones
  layersVisible = {
    water: true,
    buildings: true,
    roads: true,
    velocity: false,
    riskZones: false,
  };

  // Dimensions
  worldWidth = 1000;
  worldDepth = 1000;

  // Animation & Recording
  animationFrameId: number | null = null;
  mediaRecorder: MediaRecorder | null = null;
  recordedChunks: Blob[] = [];

  // Raycaster for inspection
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  private pointerDownX = 0;
  private pointerDownY = 0;
  private pointerDownTime = 0;

  // Smooth camera transition
  targetCameraPos: THREE.Vector3 | null = null;
  targetLookAt: THREE.Vector3 | null = null;

  constructor(options: ViewerOptions) {
    this.container = options.container;
    this.bounds = options.bounds;
    this.dem = options.dem;
    this.buildings = options.buildings || [];
    const obstacles = rasterizeBuildings(this.buildings, this.bounds, this.dem.width, this.dem.height);
    this.buildings.forEach((building, i) => this.buildingExposureCells.set(building.id, obstacles.exposureCells[i]));
    this.roads = options.roads || [];
    this.onInspectCell = options.onInspectCell;
    this.onTextureSource = options.onTextureSource;
    this.sourceLines = options.sourceLines ?? [this.dem.source?.label ?? 'Terrain source unknown', 'Infrastructure source unknown'];

    this.clock = new THREE.Clock();

    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0f1d);
    this.scene.fog = new THREE.FogExp2(0x0a0f1d, 0.0003);

    // 2. Camera setup
    const aspect = this.container.clientWidth / (this.container.clientHeight || 1);
    this.camera = new THREE.PerspectiveCamera(45, aspect, 1, 10000);
    this.camera.position.set(0, 900, 1100);

    // 3. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // For snapshots and recordings
    });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.container.appendChild(this.renderer.domElement);

    // 4. Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI * 0.47; // Prevent going beneath terrain
    this.controls.minDistance = 50;
    this.controls.maxDistance = 4500;
    this.controls.target.set(0, 0, 0);

    // 5. Lighting
    this.setupLighting();

    // 6. Build Terrain and Water meshes
    this.buildTerrainAndWater();

    // 7. Build 3D Buildings & Roads
    this.buildBuildings();
    this.buildRoads();

    // 8. Event listeners
    window.addEventListener('resize', this.onResize);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);

    // 9. Start render loop
    this.animate();

    // Initial texture load
    this.setTextureMode('satellite');
  }

  private setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.4);
    sunLight.position.set(600, 1200, 400);
    this.scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0x88bbff, 0.4);
    fillLight.position.set(-600, 400, -600);
    this.scene.add(fillLight);
  }

  private buildTerrainAndWater() {
    const { width, height, elevation, minElevation, maxElevation } = this.dem;

    // Create DataTextures for elevation, depth, velocity
    const elevBuffer = new Float32Array(width * height);
    // Normalize elevation to meters offset relative to minElevation
    for (let i = 0; i < elevation.length; i++) {
      elevBuffer[i] = elevation[i] - minElevation;
    }

    this.elevationTexture = new THREE.DataTexture(
      elevBuffer,
      width,
      height,
      THREE.RedFormat,
      THREE.FloatType
    );
    this.elevationTexture.needsUpdate = true;

    // Depth DataTexture
    const depthBuffer = new Float32Array(width * height);
    this.depthTexture = new THREE.DataTexture(
      depthBuffer,
      width,
      height,
      THREE.RedFormat,
      THREE.FloatType
    );
    this.depthTexture.needsUpdate = true;

    // Velocity DataTexture (RGBA: R=speed, G=vx_norm, B=vy_norm, A=1.0)
    const velBuffer = new Float32Array(width * height * 4);
    this.velocityTexture = new THREE.DataTexture(
      velBuffer,
      width,
      height,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    this.velocityTexture.needsUpdate = true;

    // Geometry: X is horizontal, Z is vertical, Y is elevation
    const geomWidth = 1000;
    const geomDepth = 1000;
    this.worldWidth = geomWidth;
    this.worldDepth = geomDepth;

    // Create plane geometries oriented horizontally on X-Z plane
    const terrainGeom = new THREE.PlaneGeometry(geomWidth, geomDepth, width - 1, height - 1);
    terrainGeom.rotateX(-Math.PI / 2);

    this.terrainMaterial = createTerrainMaterial();
    this.terrainMaterial.uniforms.uElevationMap.value = this.elevationTexture;
    this.terrainMaterial.uniforms.uVerticalExaggeration.value = this.verticalExaggeration;
    this.terrainMaterial.uniforms.uMinElevation.value = 0;
    this.terrainMaterial.uniforms.uMaxElevation.value = maxElevation - minElevation;

    this.terrainMesh = new THREE.Mesh(terrainGeom, this.terrainMaterial);
    this.scene.add(this.terrainMesh);

    // Water Mesh
    const waterGeom = new THREE.PlaneGeometry(geomWidth, geomDepth, width - 1, height - 1);
    waterGeom.rotateX(-Math.PI / 2);

    this.waterMaterial = createWaterMaterial();
    this.waterMaterial.uniforms.uElevationMap.value = this.elevationTexture;
    this.waterMaterial.uniforms.uDepthMap.value = this.depthTexture;
    this.waterMaterial.uniforms.uVelocityMap.value = this.velocityTexture;
    this.waterMaterial.uniforms.uVerticalExaggeration.value = this.verticalExaggeration;

    this.waterMesh = new THREE.Mesh(waterGeom, this.waterMaterial);
    this.scene.add(this.waterMesh);
  }

  private buildBuildings() {
    if (!this.buildings || this.buildings.length === 0) return;

    const { width, height, minElevation } = this.dem;
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.5,
      metalness: 0.1,
    });

    for (const b of this.buildings) {
      const bldgH = Math.max(3, b.height);
      const bldgGeom = new THREE.BoxGeometry(6, bldgH, 6);
      const mesh = new THREE.Mesh(bldgGeom, baseMat.clone());

      const normX = b.gridX / (width - 1);
      const normY = b.gridY / (height - 1);

      const posX = (normX - 0.5) * this.worldWidth;
      const posZ = (normY - 0.5) * this.worldDepth;
      const elev = (b.elevation - minElevation) * this.verticalExaggeration;

      mesh.position.set(posX, elev + bldgH * 0.5, posZ);
      mesh.userData = { building: b, isFlooded: false };

      this.scene.add(mesh);
      this.buildingMeshes.push(mesh);
    }
  }

  private buildRoads() {
    if (!this.roads || this.roads.length === 0) return;

    const { width, height, minElevation, elevation } = this.dem;
    const points: THREE.Vector3[] = [];

    for (const r of this.roads) {
      if (r.coordinates.length < 2) continue;

      for (let i = 0; i < r.coordinates.length - 1; i++) {
        const c1 = r.coordinates[i];
        const c2 = r.coordinates[i + 1];

        const u1 = (c1[0] - this.bounds.west) / (this.bounds.east - this.bounds.west);
        const v1 = (this.bounds.north - c1[1]) / (this.bounds.north - this.bounds.south);
        const u2 = (c2[0] - this.bounds.west) / (this.bounds.east - this.bounds.west);
        const v2 = (this.bounds.north - c2[1]) / (this.bounds.north - this.bounds.south);

        const gx1 = Math.max(0, Math.min(width - 1, Math.floor(u1 * (width - 1))));
        const gy1 = Math.max(0, Math.min(height - 1, Math.floor(v1 * (height - 1))));
        const gx2 = Math.max(0, Math.min(width - 1, Math.floor(u2 * (width - 1))));
        const gy2 = Math.max(0, Math.min(height - 1, Math.floor(v2 * (height - 1))));

        const elev1 = (elevation[gy1 * width + gx1] - minElevation) * this.verticalExaggeration + 1.2;
        const elev2 = (elevation[gy2 * width + gx2] - minElevation) * this.verticalExaggeration + 1.2;

        const p1 = new THREE.Vector3((u1 - 0.5) * this.worldWidth, elev1, (v1 - 0.5) * this.worldDepth);
        const p2 = new THREE.Vector3((u2 - 0.5) * this.worldWidth, elev2, (v2 - 0.5) * this.worldDepth);

        points.push(p1, p2);
      }
    }

    if (points.length > 0) {
      const roadGeom = new THREE.BufferGeometry().setFromPoints(points);
      const roadMat = new THREE.LineBasicMaterial({
        color: 0xf1f5f9,
        linewidth: 2,
        transparent: true,
        opacity: 0.85,
      });
      this.roadLines = new THREE.LineSegments(roadGeom, roadMat);
      this.scene.add(this.roadLines);
    }
  }

  /**
   * Set draped terrain texture mode: 'satellite' | 'osm' | 'hillshade'
   */
  async setTextureMode(mode: TextureMode) {
    this.activeTextureMode = mode;
    if (!this.terrainMaterial) return;

    if (mode === 'hillshade') {
      this.terrainMaterial.uniforms.uTextureMode.value = 2;
      this.reportTextureSource({ kind: 'derived', label: 'Hillshade derived from terrain (not imagery)' });
      return;
    }

    if (mode === 'satellite') {
      this.terrainMaterial.uniforms.uTextureMode.value = 0;
      if (!this.satelliteTexture) {
        this.satelliteTexture = await loadDrapedTexture(this.bounds, 'satellite');
      }
      if (this.satelliteTexture) {
        if (this.activeTextureMode !== mode) return;
        this.terrainMaterial.uniforms.uTextureMap.value = this.satelliteTexture;
        this.reportTextureSource(this.satelliteTexture.userData.source);
      }
      return;
    }

    if (mode === 'osm') {
      this.terrainMaterial.uniforms.uTextureMode.value = 1;
      if (!this.osmTexture) {
        this.osmTexture = await loadDrapedTexture(this.bounds, 'osm');
      }
      if (this.osmTexture) {
        if (this.activeTextureMode !== mode) return;
        this.terrainMaterial.uniforms.uTextureMap.value = this.osmTexture;
        this.reportTextureSource(this.osmTexture.userData.source);
      }
    }
  }

  /**
   * Update vertical exaggeration slider (1x - 5x)
   */
  setVerticalExaggeration(exaggeration: number) {
    this.verticalExaggeration = exaggeration;
    if (this.terrainMaterial) {
      this.terrainMaterial.uniforms.uVerticalExaggeration.value = exaggeration;
    }
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uVerticalExaggeration.value = exaggeration;
    }

    // Update building positions to match new vertical height
    const { minElevation } = this.dem;
    for (const mesh of this.buildingMeshes) {
      const b = mesh.userData.building as OsmBuilding;
      const bldgH = Math.max(3, b.height);
      const elev = (b.elevation - minElevation) * exaggeration;
      mesh.position.y = elev + bldgH * 0.5;
    }
  }

  /**
   * Update layer display mode: 0: Realistic Water, 1: Depth Heatmap, 2: Risk Zones
   */
  setWaterLayerMode(mode: number) {
    this.layerMode = mode;
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uLayerMode.value = mode;
    }
  }

  /**
   * Set max depth for legend & color ramp scaling
   */
  setMaxDepthLegend(maxDepth: number) {
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uMaxDepth.value = Math.max(0.2, maxDepth);
    }
  }

  /**
   * Toggle layer visibility
   */
  setLayerVisibility(layer: 'water' | 'buildings' | 'roads' | 'velocity' | 'riskZones', visible: boolean) {
    this.layersVisible[layer] = visible;

    if (layer === 'water' && this.waterMesh) {
      this.waterMesh.visible = visible;
    }
    if (layer === 'buildings') {
      for (const m of this.buildingMeshes) m.visible = visible;
    }
    if (layer === 'roads' && this.roadLines) {
      this.roadLines.visible = visible;
    }
    if (layer === 'riskZones') {
      this.setWaterLayerMode(visible ? 2 : 0);
    }
  }

  /**
   * Receive streamed or scrubbed simulation frame
   */
  updateSimulationFrame(frame: SimulationFrame) {
    this.currentFrame = frame;

    const { depth, velocity, vx, vy } = frame;

    // 1. Update Depth Texture
    if (this.depthTexture) {
      const buffer = this.depthTexture.image.data as unknown as Float32Array;
      buffer.set(depth);
      this.depthTexture.needsUpdate = true;
    }

    // 2. Update Velocity Texture
    if (this.velocityTexture) {
      const buffer = this.velocityTexture.image.data as unknown as Float32Array;
      for (let i = 0; i < depth.length; i++) {
        const offset = i * 4;
        const spd = velocity[i];
        buffer[offset] = spd; // R = speed
        if (spd > 0.01) {
          buffer[offset + 1] = (vx[i] / spd) * 0.5 + 0.5; // G = norm vx
          buffer[offset + 2] = (vy[i] / spd) * 0.5 + 0.5; // B = norm vy
        } else {
          buffer[offset + 1] = 0.5;
          buffer[offset + 2] = 0.5;
        }
        buffer[offset + 3] = 1.0;
      }
      this.velocityTexture.needsUpdate = true;
    }

    // 3. Update Building flood states and visual coloring
    const floodThreshold = 0.3; // 0.3m threshold
    for (const mesh of this.buildingMeshes) {
      const b = mesh.userData.building as OsmBuilding;
      const cellDepth = buildingWaterDepth(b, this.buildingExposureCells.get(b.id) ?? [], depth, this.dem.elevation);

      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (cellDepth >= floodThreshold) {
        if (!mesh.userData.isFlooded) {
          mesh.userData.isFlooded = true;
          mat.color.setHex(0xef4444); // Bright alert red
          mat.emissive.setHex(0x7f1d1d);
        }
      } else {
        if (mesh.userData.isFlooded) {
          mesh.userData.isFlooded = false;
          mat.color.setHex(0x94a3b8);
          mat.emissive.setHex(0x000000);
        }
      }
    }
  }

  /**
   * Smooth camera transition to presets
   */
  setCameraPreset(preset: CameraPreset) {
    if (preset === 'top') {
      this.targetCameraPos = new THREE.Vector3(0, 1400, 0);
      this.targetLookAt = new THREE.Vector3(0, 0, 0);
    } else if (preset === 'oblique') {
      this.targetCameraPos = new THREE.Vector3(0, 750, 950);
      this.targetLookAt = new THREE.Vector3(0, 0, 0);
    } else if (preset === 'flood') {
      this.targetCameraPos = new THREE.Vector3(0, 350, 400);
      this.targetLookAt = new THREE.Vector3(0, 50, -100);
    }
  }

  /**
   * Pointer down handler to track click start position and time
   */
  private onPointerDown = (event: PointerEvent) => {
    if (event.button === 0) {
      this.pointerDownX = event.clientX;
      this.pointerDownY = event.clientY;
      this.pointerDownTime = Date.now();
    }
  };

  /**
   * Pointer up handler: triggers inspection only on click (no drag)
   */
  private onPointerUp = (event: PointerEvent) => {
    // Only inspect on primary left click
    if (event.button !== 0 || !this.onInspectCell || !this.terrainMesh) return;

    // Distinguish click from camera orbit/pan drag
    const dx = event.clientX - this.pointerDownX;
    const dy = event.clientY - this.pointerDownY;
    const dist = Math.hypot(dx, dy);
    const elapsed = Date.now() - this.pointerDownTime;

    // If mouse moved > 6px or was held > 450ms, user was dragging/orbiting camera
    if (dist > 6 || elapsed > 450) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.terrainMesh);

    if (intersects.length > 0 && intersects[0].uv) {
      const uv = intersects[0].uv;
      const { width, height, elevation } = this.dem;

      const gx = Math.min(width - 1, Math.max(0, Math.floor(uv.x * width)));
      const gy = Math.min(height - 1, Math.max(0, Math.floor((1 - uv.y) * height)));
      const idx = gy * width + gx;

      const elev = elevation[idx] ?? 0;
      const curDepth = this.currentFrame ? (this.currentFrame.depth[idx] ?? 0) : 0;
      const curVel = this.currentFrame ? (this.currentFrame.velocity[idx] ?? 0) : 0;

      const lon = this.bounds.west + uv.x * (this.bounds.east - this.bounds.west);
      const lat = this.bounds.south + uv.y * (this.bounds.north - this.bounds.south);
      const risk = calculateRiskLevel(curDepth, curVel);

      this.onInspectCell({
        gridX: gx,
        gridY: gy,
        lon,
        lat,
        elevation: elev,
        elevationMeters: elev,
        waterDepth: curDepth,
        currentWaterDepthMeters: curDepth,
        velocity: curVel,
        currentVelocityMetersPerSec: curVel,
        riskLevel: risk,
      });
    }
  };

  /**
   * Save PNG snapshot of current 3D view
   */
  takeSnapshot(): string {
    this.renderer.render(this.scene, this.camera);
    const canvas = document.createElement('canvas');
    this.drawLabeledCanvas(canvas);
    return canvas.toDataURL('image/png');
  }

  private reportTextureSource(source: DataSource) {
    this.displaySourceLabel = source.label;
    this.onTextureSource?.(source);
  }

  private drawLabeledCanvas(canvas: HTMLCanvasElement) {
    const rendered = this.renderer.domElement;
    const lines = [...this.sourceLines, this.displaySourceLabel];
    const footer = lines.length * 20 + 12;
    if (canvas.width !== rendered.width || canvas.height !== rendered.height + footer) {
      canvas.width = rendered.width; canvas.height = rendered.height + footer;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(rendered, 0, 0);
    ctx.fillStyle = '#020617'; ctx.fillRect(0, rendered.height, canvas.width, footer);
    ctx.fillStyle = '#fde68a'; ctx.font = '13px sans-serif';
    lines.forEach((line, i) => ctx.fillText(line, 8, rendered.height + 20 + i * 20, canvas.width - 16));
  }

  /**
   * Start recording WebM video stream of the simulation
   */
  startRecording(): boolean {
    if (typeof MediaRecorder === 'undefined') return false;

    try {
      this.recordingCanvas = document.createElement('canvas');
      this.drawLabeledCanvas(this.recordingCanvas);
      const stream = this.recordingCanvas.captureStream?.(30);
      if (!stream) return false;

      this.recordedChunks = [];
      this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.mediaRecorder.start();
      return true;
    } catch {
      this.recordingCanvas = null;
      return false;
    }
  }

  /**
   * Stop recording and download WebM video file
   */
  stopRecording(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return;

    this.mediaRecorder.onstop = () => {
      const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `floodsim_record_${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      this.mediaRecorder?.stream.getTracks().forEach(track => track.stop());
      this.recordingCanvas = null;
    };

    this.mediaRecorder.stop();
  }

  private onResize = () => {
    if (!this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / (height || 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    const elapsed = this.clock.getElapsedTime();

    // Update water ripple time uniform
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uTime.value = elapsed;
    }

    // Smooth camera interpolation
    if (this.targetCameraPos && this.targetLookAt) {
      this.camera.position.lerp(this.targetCameraPos, 0.06);
      this.controls.target.lerp(this.targetLookAt, 0.06);

      if (this.camera.position.distanceTo(this.targetCameraPos) < 1.0) {
        this.targetCameraPos = null;
        this.targetLookAt = null;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.recordingCanvas) this.drawLabeledCanvas(this.recordingCanvas);
  };

  /**
   * Clean up all Three.js geometries, textures, materials, and listeners
   */
  dispose() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    window.removeEventListener('resize', this.onResize);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);

    this.controls.dispose();

    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      this.terrainMaterial?.dispose();
    }

    if (this.waterMesh) {
      this.waterMesh.geometry.dispose();
      this.waterMaterial?.dispose();
    }

    for (const m of this.buildingMeshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }

    this.roadLines?.geometry.dispose();
    (this.roadLines?.material as THREE.Material)?.dispose();

    this.elevationTexture?.dispose();
    this.depthTexture?.dispose();
    this.velocityTexture?.dispose();
    this.satelliteTexture?.dispose();
    this.osmTexture?.dispose();

    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
