import * as THREE from 'three';

export const WaterVertexShader = `
  uniform sampler2D uDepthMap;
  uniform sampler2D uElevationMap;
  uniform float uVerticalExaggeration;
  uniform float uMinDepthThreshold;
  uniform float uTime;

  varying vec2 vUv;
  varying float vDepth;
  varying float vElevation;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;

  void main() {
    vUv = uv;

    float elev = texture2D(uElevationMap, uv).r;
    float depth = texture2D(uDepthMap, uv).r;
    vDepth = depth;
    vElevation = elev;

    // Displace vertex: only if depth > threshold
    float yOffset = elev * uVerticalExaggeration;
    if (depth > uMinDepthThreshold) {
      // Add water depth + subtle animated wave ripple
      float ripple = sin(uv.x * 40.0 + uTime * 2.5) * cos(uv.y * 40.0 + uTime * 2.0) * 0.04;
      yOffset += (depth + ripple) * uVerticalExaggeration;
    } else {
      // Pull below terrain to avoid z-fighting on dry ground
      yOffset -= 0.5;
    }

    vec3 displacedPosition = vec3(position.x, yOffset, position.z);
    vec4 worldPos = modelMatrix * vec4(displacedPosition, 1.0);
    vWorldPosition = worldPos.xyz;
    vNormal = normalMatrix * normal;

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const WaterFragmentShader = `
  uniform sampler2D uDepthMap;
  uniform sampler2D uVelocityMap;
  uniform float uMaxDepth;
  uniform float uTime;
  uniform vec3 uColorShallow;
  uniform vec3 uColorDeep;
  uniform vec3 uLightDirection;
  uniform float uMinDepthThreshold;
  uniform int uLayerMode; // 0: Realistic Water, 1: Depth Heatmap, 2: Risk Zones

  varying vec2 vUv;
  varying float vDepth;
  varying float vElevation;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;

  // Simple procedural noise for ripples
  float waveNoise(vec2 p) {
    return sin(p.x * 25.0 + uTime * 1.8) * cos(p.y * 25.0 + uTime * 1.5) * 0.5 + 0.5;
  }

  void main() {
    float depth = texture2D(uDepthMap, vUv).r;

    // Discard dry cells
    if (depth < uMinDepthThreshold) {
      discard;
    }

    vec4 velData = texture2D(uVelocityMap, vUv);
    float speed = velData.r; // velocity magnitude
    vec2 flowDir = velData.gb; // vx, vy normalized

    // Normal perturbation based on flow and time
    vec2 waveCoords = vUv * 60.0 - flowDir * (uTime * 0.4);
    float wave = waveNoise(waveCoords);

    // Shoreline soft fade: smooth alpha transition for shallow edges
    float shorelineAlpha = smoothstep(uMinDepthThreshold, uMinDepthThreshold + 0.15, depth);

    if (uLayerMode == 1) {
      // Depth Heatmap mode: cyan -> green -> yellow -> red
      float normD = clamp(depth / max(0.5, uMaxDepth), 0.0, 1.0);
      vec3 heatColor;
      if (normD < 0.25) {
        heatColor = mix(vec3(0.1, 0.8, 1.0), vec3(0.1, 1.0, 0.4), normD / 0.25);
      } else if (normD < 0.5) {
        heatColor = mix(vec3(0.1, 1.0, 0.4), vec3(1.0, 0.9, 0.1), (normD - 0.25) / 0.25);
      } else if (normD < 0.75) {
        heatColor = mix(vec3(1.0, 0.9, 0.1), vec3(1.0, 0.4, 0.0), (normD - 0.5) / 0.25);
      } else {
        heatColor = mix(vec3(1.0, 0.4, 0.0), vec3(0.9, 0.1, 0.1), (normD - 0.75) / 0.25);
      }
      gl_FragColor = vec4(heatColor, 0.88 * shorelineAlpha);
      return;
    }

    if (uLayerMode == 2) {
      // Risk Zone mode (depth x velocity)
      float dv = depth * speed;
      vec3 riskColor;
      if (depth >= 1.0 || dv >= 0.6) {
        riskColor = vec3(0.93, 0.27, 0.27); // High Risk (Red)
      } else if (depth >= 0.3 || dv >= 0.3) {
        riskColor = vec3(0.96, 0.62, 0.07); // Medium Risk (Amber)
      } else {
        riskColor = vec3(0.52, 0.80, 0.09); // Low Risk (Lime)
      }
      gl_FragColor = vec4(riskColor, 0.85 * shorelineAlpha);
      return;
    }

    // Default mode: Semi-transparent realistic hydraulic water surface
    float depthFactor = clamp(depth / max(0.8, uMaxDepth), 0.0, 1.0);
    vec3 waterColor = mix(uColorShallow, uColorDeep, pow(depthFactor, 0.6));

    // Sun specular reflection
    vec3 lightDir = normalize(uLightDirection);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 normal = normalize(vNormal + vec3((wave - 0.5) * 0.15, 0.0, (wave - 0.5) * 0.15));
    vec3 halfVector = normalize(lightDir + viewDir);

    float NdotL = max(0.0, dot(normal, lightDir));
    float NdotH = max(0.0, dot(normal, halfVector));
    float specular = pow(NdotH, 64.0) * 0.6;

    // Foam at high velocity areas
    float foam = smoothstep(1.5, 3.5, speed) * 0.35 * wave;

    vec3 finalColor = waterColor * (0.65 + 0.35 * NdotL) + vec3(specular) + vec3(foam);
    float finalAlpha = clamp(0.55 + depthFactor * 0.35, 0.2, 0.9) * shorelineAlpha;

    gl_FragColor = vec4(finalColor, finalAlpha);
  }
`;

export function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: WaterVertexShader,
    fragmentShader: WaterFragmentShader,
    uniforms: {
      uDepthMap: { value: null },
      uElevationMap: { value: null },
      uVelocityMap: { value: null },
      uVerticalExaggeration: { value: 1.5 },
      uMinDepthThreshold: { value: 0.02 },
      uMaxDepth: { value: 3.0 },
      uTime: { value: 0.0 },
      uColorShallow: { value: new THREE.Color(0x38bdf8) }, // Light Cyan
      uColorDeep: { value: new THREE.Color(0x0369a1) },    // Deep Blue
      uLightDirection: { value: new THREE.Vector3(0.5, 1.0, 0.3) },
      uLayerMode: { value: 0 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}
