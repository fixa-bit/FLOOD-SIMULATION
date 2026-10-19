import * as THREE from 'three';

export const TerrainVertexShader = `
  uniform sampler2D uElevationMap;
  uniform float uVerticalExaggeration;

  varying vec2 vUv;
  varying float vElevation;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;

  void main() {
    vUv = uv;

    float elev = texture2D(uElevationMap, uv).r;
    vElevation = elev;

    vec3 displaced = vec3(position.x, elev * uVerticalExaggeration, position.z);
    vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
    vWorldPosition = worldPos.xyz;
    vNormal = normalMatrix * normal;

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const TerrainFragmentShader = `
  uniform sampler2D uTextureMap;
  uniform sampler2D uElevationMap;
  uniform int uTextureMode; // 0: Satellite, 1: OSM Map, 2: Hillshade / Hypsometric
  uniform float uMinElevation;
  uniform float uMaxElevation;
  uniform vec3 uSunDirection;

  varying vec2 vUv;
  varying float vElevation;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;

  // Hypsometric tint palette for elevation
  vec3 getHypsometricColor(float normElev) {
    vec3 c0 = vec3(0.24, 0.45, 0.28); // Lowland green
    vec3 c1 = vec3(0.55, 0.62, 0.35); // Yellow-green
    vec3 c2 = vec3(0.78, 0.68, 0.45); // Khaki sand
    vec3 c3 = vec3(0.52, 0.44, 0.35); // Mountain brown
    vec3 c4 = vec3(0.85, 0.88, 0.92); // Alpine snow / rock

    if (normElev < 0.2) return mix(c0, c1, normElev / 0.2);
    if (normElev < 0.45) return mix(c1, c2, (normElev - 0.2) / 0.25);
    if (normElev < 0.75) return mix(c2, c3, (normElev - 0.45) / 0.3);
    return mix(c3, c4, (normElev - 0.75) / 0.25);
  }

  void main() {
    vec3 sunDir = normalize(uSunDirection);
    float diff = max(0.25, dot(normalize(vNormal), sunDir));

    if (uTextureMode == 2) {
      // Analytical Hillshade & Hypsometric Tint
      float range = max(1.0, uMaxElevation - uMinElevation);
      float normE = clamp((vElevation - uMinElevation) / range, 0.0, 1.0);
      vec3 hypoColor = getHypsometricColor(normE);
      vec3 shaded = hypoColor * (0.45 + 0.55 * diff);
      gl_FragColor = vec4(shaded, 1.0);
      return;
    }

    // Satellite or OSM Map draped texture
    vec4 texColor = texture2D(uTextureMap, vUv);
    vec3 litColor = texColor.rgb * (0.55 + 0.45 * diff);
    gl_FragColor = vec4(litColor, 1.0);
  }
`;

export function createTerrainMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: TerrainVertexShader,
    fragmentShader: TerrainFragmentShader,
    uniforms: {
      uElevationMap: { value: null },
      uTextureMap: { value: null },
      uVerticalExaggeration: { value: 1.5 },
      uTextureMode: { value: 0 }, // Default Satellite
      uMinElevation: { value: 0.0 },
      uMaxElevation: { value: 1000.0 },
      uSunDirection: { value: new THREE.Vector3(0.4, 0.9, 0.3) },
    },
    side: THREE.DoubleSide,
  });
}
