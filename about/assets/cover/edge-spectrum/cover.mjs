(() => {
  "use strict";

  const cover = document.querySelector("#about-who[data-edge-spectrum]");
  const art = cover.querySelector("#art");
  let coverVisible = true;
  new IntersectionObserver(([entry]) => {
    coverVisible = entry.isIntersecting;
  }).observe(cover);
  const headline = cover.querySelector("#headline");
  const context = headline.getContext("2d");
  const headlineOutline = cover.querySelector("#headline-outline");
  const outlineContext = headlineOutline.getContext("2d");
  const canvas = cover.querySelector("#glass");
  const roomCanvas = cover.querySelector("#room-light");
  const glassTools = cover.querySelector(".glass-tools");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const dots = [...cover.querySelectorAll(".dot")];
  const controls = [...cover.querySelectorAll(".arrow, .dot")];
  const quarterTurn = Math.PI / 2;
  const initialRotation = [0.34, 0.56, 0];
  const titleLines = Array.from(cover.querySelectorAll("#hero-title span"), line => line.textContent);
  const designedHeadline = [
    { family: "Anton", weight: 400, fontSize: 274, tracking: 12, centerX: 795, inkTop: 292 },
    { family: "Montserrat", weight: 800, fontSize: 140, tracking: -3, centerX: 793.5, inkTop: 557 }
  ];
  const designWidth = 1583;
  const designHeight = 993;
  const headlineHeightRatio = 0.205;
  const cameraDistance = 5.5;
  const cameraSpan = 0.535898;
  const lighting = "spectrum";
  let view = 1;
  let orientation = preset(view);
  let target = null;
  let pointer = null;
  let velocityX = 0;
  let velocityY = 0;
  let idleSince = performance.now() + 900;
  let lastFrame = 0;
  let renderer = null;

  function multiply([ax, ay, az, aw], [bx, by, bz, bw]) {
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz
    ];
  }

  function axisAngle(axis, angle) {
    const quaternion = [0, 0, 0, Math.cos(angle / 2)];
    quaternion[axis] = Math.sin(angle / 2);
    return quaternion;
  }

  function preset(index) {
    const [x, y, z] = initialRotation;
    const base = multiply(axisAngle(2, z), multiply(axisAngle(1, y), axisAngle(0, x)));
    return multiply(axisAngle(1, (index - 1) * quarterTurn), base);
  }

  function interpolate(from, to, amount) {
    let dot = from.reduce((sum, value, index) => sum + value * to[index], 0);
    const end = dot < 0 ? to.map(value => -value) : to;
    dot = Math.min(1, Math.abs(dot));
    if (dot > 0.9995) {
      const mixed = from.map((value, index) => value + amount * (end[index] - value));
      const length = Math.hypot(...mixed);
      return mixed.map(value => value / length);
    }
    const theta = Math.acos(dot);
    const denominator = Math.sin(theta);
    const startWeight = Math.sin((1 - amount) * theta) / denominator;
    const endWeight = Math.sin(amount * theta) / denominator;
    return from.map((value, index) => value * startWeight + end[index] * endWeight);
  }

  function inverseRotation([x, y, z, w]) {
    return [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)
    ];
  }

  function rotate(y, x) {
    orientation = multiply(axisAngle(0, x), multiply(axisAngle(1, y), orientation));
  }

  const projectionConstants = `
    const float distanceToCamera = ${cameraDistance};
    const float cameraSpan = ${cameraSpan};
    const float halfEdge = cameraSpan * distanceToCamera * 0.38 / 2.0;
    const float cornerRadius = 2.0 * halfEdge * 0.050;
    const float innerHalfEdge = halfEdge - cornerRadius;
  `;

  const vertexSource = `
    ${projectionConstants}
    attribute vec2 aPosition;
    uniform mat3 uInverseRotation;
    varying vec2 vProjectedCenter;

    void main() {
      vec2 lower = vec2(1.0);
      vec2 upper = vec2(-1.0);
      // The rounded cube is the convex hull of the eight corner spheres.
      for (int x = -1; x <= 1; x += 2) {
        for (int y = -1; y <= 1; y += 2) {
          for (int z = -1; z <= 1; z += 2) {
            vec3 corner = (vec3(float(x), float(y), float(z)) * innerHalfEdge) * uInverseRotation;
            float depth = distanceToCamera - corner.z;
            float tangentDenominator = depth * depth - cornerRadius * cornerRadius;
            vec2 tangentCenter = corner.xy * depth / tangentDenominator;
            vec2 tangentRadius = cornerRadius * sqrt(tangentDenominator + corner.xy * corner.xy) / tangentDenominator;
            lower = min(lower, tangentCenter - tangentRadius);
            upper = max(upper, tangentCenter + tangentRadius);
          }
        }
      }
      vProjectedCenter = (lower + upper) / (2.0 * cameraSpan);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const fragmentSource = `
    precision highp float;
    ${projectionConstants}

    uniform sampler2D uHeadline;
    uniform mat3 uInverseRotation;
    uniform vec2 uResolution;
    uniform float uAspect;
    uniform float uSceneScale;
    uniform bool uPrism;
    uniform bool uSpectralEdges;
    uniform bool uNearSpectrum;
    varying vec2 vProjectedCenter;

    // The outer dimensions stay equal at every corner radius.
    vec2 cubeInterval(vec3 origin, vec3 direction, float extent) {
      vec3 minimumDirection = mix(vec3(-0.00001), vec3(0.00001), step(0.0, direction));
      vec3 safeDirection = mix(minimumDirection, direction, step(vec3(0.00001), abs(direction)));
      vec3 a = (-extent - origin) / safeDirection;
      vec3 b = (extent - origin) / safeDirection;
      vec3 near = min(a, b);
      vec3 far = max(a, b);
      return vec2(max(near.x, max(near.y, near.z)), min(far.x, min(far.y, far.z)));
    }

    vec3 cornerOffset(vec3 point) {
      return abs(point) - innerHalfEdge;
    }

    float surfaceDistance(vec3 point) {
      vec3 offset = cornerOffset(point);
      return length(max(offset, 0.0)) + min(0.0, max(offset.x, max(offset.y, offset.z)))
             - cornerRadius;
    }

    float traceSurface(vec3 origin, vec3 direction, vec2 interval) {
      float distance = interval.x;
      for (int i = 0; i < 28; i++) {
        float gap = surfaceDistance(origin + direction * distance);
        if (gap <= halfEdge * 0.00035 || distance >= interval.y) break;
        distance += gap;
      }
      return distance;
    }

    vec3 faceNormal(vec3 point) {
      return normalize(max(vec3(0.0), cornerOffset(point)) * sign(point));
    }

    vec3 closestToSilhouette(vec3 origin, vec3 direction, vec2 interval) {
      // Minimize the ray's distance to the inner box that defines the bevel.
      for (int i = 0; i < 12; i++) {
        float t = (interval.x + interval.y) * 0.5;
        vec3 point = origin + direction * t;
        vec3 offset = point - clamp(point, -innerHalfEdge, innerHalfEdge);
        if (dot(offset, direction) < 0.0) interval.x = t;
        else interval.y = t;
      }
      return origin + direction * ((interval.x + interval.y) * 0.5);
    }

    float edgeLight(vec3 normal) {
      vec3 parts = abs(normal);
      return smoothstep(0.0, 0.22, 1.0 - max(parts.x, max(parts.y, parts.z)));
    }

    float textSample(vec2 uv) {
      return texture2D(uHeadline, uv).r;
    }

    float wavelengthSample(vec2 uv, vec2 spread, float offset) {
      vec2 center = uv + offset * spread;
      vec2 softness = 0.18 * spread;
      return 0.5 * textSample(center)
             + 0.25 * (textSample(center - softness) + textSample(center + softness));
    }

    vec3 spectralText(vec2 uv, vec2 spread) {
      // Sample the same refracted lettering at successive wavelength offsets.
      vec3 light = vec3(0.57, 0.035, 0.00) * wavelengthSample(uv, spread, 1.33);
      light += vec3(0.43, 0.19, 0.00) * wavelengthSample(uv, spread, 0.92);
      light += vec3(0.32, 0.45, 0.00) * wavelengthSample(uv, spread, 0.51);
      light += vec3(0.07, 0.51, 0.08) * wavelengthSample(uv, spread, 0.04);
      light += vec3(0.00, 0.32, 0.42) * wavelengthSample(uv, spread, -0.47);
      light += vec3(0.02, 0.10, 0.65) * wavelengthSample(uv, spread, -0.99);
      light += vec3(0.19, 0.015, 0.49) * wavelengthSample(uv, spread, -1.51);
      return light / vec3(1.60, 1.62, 1.64);
    }

    vec3 nearSpectrumText(vec2 uv, vec2 spread, vec2 point, vec3 normal) {
      vec3 spectrum = spectralText(uv, spread);
      // Keep the two nearby light colors from the soft version, then let the
      // spectrum show up along the refracted edge instead of as a beam.
      float warmSide = smoothstep(-0.34, 0.34, point.x + 0.17 * normal.x);
      vec3 nearbyColor = mix(vec3(0.08, 0.24, 0.98), vec3(1.0, 0.58, 0.12), warmSide);
      float edgeAmount = smoothstep(0.015, 0.16, length(spread) + 0.025 * abs(normal.z));
      vec3 tintedSpectrum = spectrum * mix(vec3(0.62), nearbyColor, 0.58);
      return mix(tintedSpectrum, spectrum, edgeAmount * 0.26);
    }

    vec3 dispersedText(vec2 uv, vec2 spread) {
      if (uSpectralEdges) return spectralText(uv, spread);
      vec3 channels = vec3(0.0);
      float totalWeight = 0.0;
      for (int i = 0; i < 12; i++) {
        float shift = (float(i) + 0.5) / 12.0 - 0.5;
        float weight = 1.0 - 2.5 * shift * shift;
        totalWeight += weight;
        channels += weight * vec3(
          textSample(uv + (1.0 + shift * 0.85) * spread),
          textSample(uv + shift * spread),
          textSample(uv - (1.15 + shift * 1.2) * spread)
        );
      }
      channels /= totalWeight;
      float warm = channels.r;
      float mid = channels.g;
      float cool = channels.b;
      return vec3(warm + 0.035 * cool, 0.68 * warm + 0.14 * mid + 0.18 * cool, cool);
    }

    float lightBand(float position, float center, float width) {
      float offset = (position - center) / width;
      return exp(-offset * offset);
    }

    vec3 prismBeam(vec2 point, vec3 transmission, vec3 normal) {
      float angle = 0.92 + 0.18 * transmission.x - 0.12 * normal.y;
      vec2 axis = vec2(cos(angle), sin(angle));
      float along = dot(point, axis);
      float across = dot(point, vec2(axis.y, -axis.x));
      float fan = mix(0.066, 0.111, smoothstep(-0.22, 0.26, along));
      float band = (across - 0.047 * along - 0.034 * transmission.y) / fan;
      float lengthFade = smoothstep(-0.27, -0.12, along) * (1.0 - smoothstep(0.17, 0.32, along));
      float cool = mix(0.38, 1.12, smoothstep(-0.21, 0.16, along));
      float warm = 1.0 - 0.87 * smoothstep(0.005, 0.24, along);

      vec3 light = vec3(0.16, 0.12, 1.0) * lightBand(band, -0.66, 0.39) * cool;
      light += vec3(0.02, 0.37, 1.0) * lightBand(band, -0.35, 0.30) * cool;
      light += vec3(0.03, 0.95, 1.0) * lightBand(band, -0.04, 0.22);
      light += vec3(0.30, 1.0, 0.48) * lightBand(band, 0.17, 0.21) * warm;
      light += vec3(1.0, 0.86, 0.15) * lightBand(band, 0.34, 0.23) * warm;
      light += vec3(1.0, 0.24, 0.05) * lightBand(band, 0.59, 0.28) * warm;
      light += vec3(1.0, 0.89, 0.68) * lightBand(band, 0.12, 0.09)
               * lightBand(along, -0.04, 0.16) * 0.62;
      light += vec3(0.20, 0.30, 0.86) * lightBand(band, -0.36, 1.24) * 0.19;
      return light * lengthFade;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / uResolution;
      vec2 aspect = vec2(uAspect, 1.0);
      vec2 centered = uv - 0.5;
      vec2 sceneToUv = uSceneScale / aspect;
      vec3 ray = normalize(vec3((centered / sceneToUv + vProjectedCenter) * cameraSpan, -1.0));
      vec3 origin = uInverseRotation * vec3(0.0, 0.0, distanceToCamera);
      vec3 localRay = uInverseRotation * ray;
      float pixelWidth = cameraSpan * distanceToCamera / (uSceneScale * uResolution.y);
      float edgeWidth = 0.72 * pixelWidth;
      vec2 interval = cubeInterval(origin, localRay, halfEdge + edgeWidth);
      if (interval.x >= interval.y) discard;

      float hit = traceSurface(origin, localRay, interval);
      vec3 entry = origin + localRay * hit;
      bool hitsSurface = hit < interval.y && surfaceDistance(entry) <= halfEdge * 0.0015;
      vec3 entryNormal = hitsSurface ? faceNormal(entry) : vec3(0.0);
      float coverage = 1.0;
      float grazing = min(0.97, sqrt(2.0 * edgeWidth / cornerRadius) + 0.12);
      if (!hitsSurface || -dot(localRay, entryNormal) < grazing) {
        vec3 closest = closestToSilhouette(origin, localRay, interval);
        float distance = surfaceDistance(closest);
        coverage = 1.0 - smoothstep(-edgeWidth, edgeWidth, distance);
        if (coverage <= 0.0) discard;
        if (!hitsSurface) {
          entryNormal = faceNormal(closest);
          entry = closest - distance * entryNormal;
        }
      }
      vec3 surface = entryNormal * uInverseRotation;
      vec3 inside = refract(localRay, entryNormal, 1.0 / 1.28);
      float far = cubeInterval(entry, inside, halfEdge).y;
      float exitHit = traceSurface(entry, -inside, vec2(-far, 0.0));
      vec3 exitPoint = entry - inside * exitHit;
      vec3 exitNormal = faceNormal(exitPoint);
      vec3 through = inside * uInverseRotation;
      vec3 outgoing = refract(inside, -exitNormal, 1.28);
      float reflection = 1.0 - smoothstep(0.01, 0.25, length(outgoing));
      vec3 outgoingWorld = mix(outgoing, reflect(inside, exitNormal), reflection) * uInverseRotation;

      float edge = edgeLight(entryNormal);
      float backEdge = edgeLight(exitNormal);
      float rim = pow(1.0 - clamp(dot(-ray, surface), 0.0, 1.0), 3.0);
      vec2 travel = (through.xy - ray.xy) * sceneToUv;
      vec2 bend = (outgoingWorld.xy - through.xy) * sceneToUv;
      vec2 sampleUv = 0.5 + centered * vec2(0.86, 0.98);
      sampleUv += travel * vec2(0.135, 0.090) + bend * (0.018 + backEdge * 0.012);
      vec2 fringe = travel * 0.041 - bend * 0.009 + centered * 0.028;
      if (uPrism) {
        vec2 point = centered / sceneToUv;
        vec3 beam = prismBeam(point, through, surface);
        vec3 bounced = prismBeam(point * 1.09 + vec2(0.057, 0.024), outgoingWorld, -surface);
        vec3 letters = vec3(
          textSample(sampleUv + fringe),
          textSample(sampleUv),
          textSample(sampleUv - fringe)
        );
        float neutral = dot(letters, vec3(0.24, 0.54, 0.22));
        float bevel = rim * 0.19 + edge * 0.13 + backEdge * 0.046;
        float grain = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
        float beamStrength = min(1.0, max(beam.r, max(beam.g, beam.b)));
        vec3 glass = vec3(0.039, 0.045, 0.053) + bevel * vec3(0.90, 0.96, 1.0);
        glass += mix(vec3(neutral), letters, 0.32) * (0.48 - 0.12 * rim) * (1.0 - 0.32 * beamStrength);
        glass += (beam * 0.91 + bounced * (0.12 + 0.30 * reflection + 0.28 * backEdge))
                 * (0.91 + grain * 0.18);
        gl_FragColor = vec4(clamp(glass, 0.0, 1.0) * coverage, coverage);
        return;
      }
      vec3 letters = uNearSpectrum
        ? nearSpectrumText(sampleUv, fringe, centered / sceneToUv, surface)
        : dispersedText(sampleUv, fringe);
      vec3 internal = uNearSpectrum
        ? nearSpectrumText(sampleUv - bend * 0.10 + travel * 0.09, -fringe * 1.1, centered / sceneToUv, -surface)
        : dispersedText(sampleUv - bend * 0.10 + travel * 0.09, -fringe * 1.1);

      float light = clamp(dot(surface, normalize(vec3(-0.45, 0.82, 0.75))), 0.0, 1.0);
      float softbox = pow(max(0.0, dot(surface, normalize(vec3(0.62, 0.93, 0.47)))), 10.0);
      float bevelLight = max(0.0, dot(surface, normalize(vec3(0.55, 0.76, 0.88))));
      vec3 body = vec3(0.055, 0.066, 0.084) + vec3(0.095, 0.099, 0.107) * light + softbox * 0.10;
      body += backEdge * vec3(0.045, 0.056, 0.07);
      body += (rim * 0.29 + edge * (0.12 + bevelLight * 0.12)) * vec3(0.91, 0.96, 1.0);
      vec3 color = body + letters * (0.88 - rim * 0.18);
      color += internal * (backEdge * 0.13 + reflection * 0.05);
      gl_FragColor = vec4(clamp(color, 0.0, 1.0) * coverage, coverage);
    }
  `;

  function createRoomLighting() {
    const light = roomCanvas.getContext("2d", { alpha: false });
    if (!light) return null;

    const wallZ = -2.8;
    const halfEdge = cameraSpan * cameraDistance * 0.19;
    const usesProjectedLight = () => lighting === "refined" || lighting === "outline";
    const emitters = [
      { ray: [-0.28, 0.25, -0.91], color: [62, 113, 255] },
      { ray: [-0.90, 0.32, 0.26], color: [255, 166, 45] },
      { ray: [0.28, -0.93, -0.23], color: [48, 103, 255] },
      { ray: [-0.36, -0.86, -0.35], color: [255, 182, 70] }
    ];
    const backdrop = document.createElement("canvas");
    const backdropContext = backdrop.getContext("2d", { alpha: false });
    const projection = document.createElement("canvas");
    const projectionContext = projection.getContext("2d", { alpha: false });
    let surfaceRows, projectedImage, projectedLight;
    let width, height, floorY, curveRadius, focalLength;

    function roomHit(oy, oz, dy, dz) {
      const curveY = floorY + curveRadius;
      const curveZ = wallZ + curveRadius;
      let time = Infinity;
      let normalY = 0;
      let normalZ = 1;

      if (dz < 0) {
        const wallTime = (wallZ - oz) / dz;
        if (wallTime > 0 && oy + dy * wallTime >= curveY) time = wallTime;
      }
      if (dy < 0) {
        const floorTime = (floorY - oy) / dy;
        if (floorTime > 0 && floorTime < time && oz + dz * floorTime >= curveZ) {
          time = floorTime;
          normalY = 1;
          normalZ = 0;
        }
      }

      // The quarter-cylinder is tangent to both the wall and the floor.
      const offsetY = oy - curveY;
      const offsetZ = oz - curveZ;
      const a = dy * dy + dz * dz;
      const b = offsetY * dy + offsetZ * dz;
      const c = offsetY * offsetY + offsetZ * offsetZ - curveRadius * curveRadius;
      const discriminant = b * b - a * c;
      if (a > 0 && discriminant >= 0) {
        const curveTime = (-b + Math.sqrt(discriminant)) / a;
        const hitY = offsetY + dy * curveTime;
        const hitZ = offsetZ + dz * curveTime;
        if (curveTime > 0 && curveTime < time && hitY <= 0 && hitZ <= 0) {
          time = curveTime;
          normalY = -hitY / curveRadius;
          normalZ = -hitZ / curveRadius;
        }
      }
      return { time, normalY, normalZ };
    }

    function shadeRoom() {
      const columns = backdrop.width = roomCanvas.width;
      const rows = backdrop.height = roomCanvas.height;
      const image = backdropContext.createImageData(columns, rows);
      const lightScale = Math.max(1, -floorY / 1.4);

      for (let row = 0; row < rows; row++) {
        const dy = (0.5 - (row + 0.5) / rows) * height / focalLength;
        const { time, normalY } = roomHit(0, cameraDistance, dy, -1);
        const y = dy * time;
        const z = cameraDistance - time;
        const floorWeight = normalY * normalY;
        const wallFalloff = Math.exp(-(((y / lightScale - 1.25) / 2.1) ** 2));
        const floorFalloff = Math.exp(-(((z - 0.38) / 2.9) ** 2));
        const shadowDepth = Math.exp(-(((z - 0.12) / 0.73) ** 2));
        const rowScale = width * time / focalLength;

        for (let column = 0; column < columns; column++) {
          const x = ((column + 0.5) / columns - 0.5) * rowScale;
          const wallLight = 5 + 25 * wallFalloff * Math.exp(-((x / (3.35 * lightScale)) ** 2));
          const floorLight = 8 + 50 * floorFalloff * Math.exp(-((x / (3.05 * lightScale)) ** 2));
          // The shadow lies in floor coordinates, so perspective flattens it towards the wall.
          const shadow = 1 - 0.47 * shadowDepth * Math.exp(-((x / 0.78) ** 2));
          const luminance = wallLight * (1 - floorWeight) + floorLight * shadow * floorWeight;
          const offset = (row * columns + column) * 4;
          image.data[offset] = luminance * 0.94;
          image.data[offset + 1] = luminance;
          image.data[offset + 2] = luminance * 1.075;
          image.data[offset + 3] = 255;
        }
      }
      backdropContext.putImageData(image, 0, 0);
    }

    // Measure along the wall, round the bend, and out onto the floor in one coordinate.
    function surfaceDistance(y, z, normalY, normalZ) {
      if (normalY === 0) return floorY + curveRadius - y;
      if (normalZ === 0) return curveRadius * (Math.PI / 2) + z - (wallZ + curveRadius);
      return curveRadius * Math.atan2(normalY, normalZ);
    }

    function layoutProjection() {
      const density = Math.min(0.46, Math.sqrt(150000 / (width * height)));
      const columns = projection.width = Math.ceil(width * density);
      const rows = projection.height = Math.ceil(height * density);
      projectedImage = projectionContext.createImageData(columns, rows);
      projectedLight = new Float32Array(columns * rows * 3);
      surfaceRows = Array.from({ length: rows }, (_, row) => {
        const dy = (0.5 - (row + 0.5) / rows) * height / focalLength;
        const { time, normalY, normalZ } = roomHit(0, cameraDistance, dy, -1);
        const step = width * time / (focalLength * columns);
        return {
          s: surfaceDistance(dy * time, cameraDistance - time, normalY, normalZ),
          firstX: (0.5 - columns / 2) * step,
          step,
          normalY,
          normalZ
        };
      });
    }

    function projectLight(x, s, spread, intensity, facing, dx, dy, dz, color) {
      const columns = projection.width;
      const depthRadius = spread * (1.08 + 0.53 * (1 - facing));
      const sideRadius = spread * 0.87;
      const slant = 0.37 * dx;
      const [red, green, blue] = color;
      for (let row = 0; row < surfaceRows.length; row++) {
        const surface = surfaceRows[row];
        const v = (surface.s - s) / depthRadius;
        const crossSection = 1 - v * v;
        if (crossSection <= 0) continue;
        const centerX = x + slant * v * spread;
        const radius = sideRadius * Math.sqrt(crossSection);
        const first = Math.max(0, Math.ceil((centerX - radius - surface.firstX) / surface.step));
        const last = Math.min(columns - 1, Math.floor((centerX + radius - surface.firstX) / surface.step));
        const alignment = Math.max(0, -(dy * surface.normalY + dz * surface.normalZ));
        const strength = intensity * (0.72 + 0.36 * Math.sqrt(alignment));
        const coreHeight = (v + 0.08) / 0.40;
        for (let column = first; column <= last; column++) {
          const u = (surface.firstX + column * surface.step - centerX) / sideRadius;
          const halo = Math.max(0, crossSection - u * u);
          const coreWidth = (u - 0.11 * v) / 0.54;
          const core = Math.max(0, 1 - coreWidth * coreWidth - coreHeight * coreHeight);
          const energy = strength * (0.83 * halo * halo + 0.72 * core * core * core);
          const offset = (row * columns + column) * 3;
          projectedLight[offset] += energy * red;
          projectedLight[offset + 1] += energy * green;
          projectedLight[offset + 2] += energy * blue;
        }
      }
    }

    function paintHit(nx, ny, nz, source) {
      const [ix, iy, iz] = source.ray;
      const incidence = ix * nx + iy * ny + iz * nz;
      // Incoming rays reflect; exit faces spread transmitted light forward.
      const bend = incidence < 0 ? -2 * incidence : 0.7;
      const dx = ix + bend * nx;
      const dy = iy + bend * ny;
      const dz = iz + bend * nz;
      const ox = halfEdge * nx;
      const oy = halfEdge * ny;
      const oz = halfEdge * nz;
      const { time, normalY, normalZ } = roomHit(oy, oz, dy, dz);
      if (!Number.isFinite(time)) return;

      const rayLength = Math.hypot(dx, dy, dz);
      const distance = time * rayLength;
      const x = ox + dx * time;
      const y = oy + dy * time;
      const depth = cameraDistance - oz - dz * time;
      if (depth < 0.55) return;

      const perspective = focalLength / depth;
      const screenX = width / 2 + x * perspective;
      const screenY = height / 2 - y * perspective;
      const spread = 0.56 + 0.14 * normalY + 0.145 * distance;
      const radius = spread * perspective;
      const depthSpread = radius * (1.16 * normalZ - y / depth * normalY);
      const shear = radius * x / depth * normalY;
      const facing = Math.max(0, -(dy * normalY + dz * normalZ) / rayLength);
      const intensity = Math.abs(incidence) * Math.sqrt(facing) * (incidence < 0 ? 0.92 : 0.52)
        / (1 + 0.095 * distance * distance);
      if (intensity < 0.012) return;

      if (usesProjectedLight()) {
        const s = surfaceDistance(y, cameraDistance - depth, normalY, normalZ);
        projectLight(x, s, spread, intensity, facing, dx / rayLength, dy / rayLength, dz / rayLength, source.color);
        return;
      }

      light.save();
      light.transform(radius, 0, shear, depthSpread, screenX, screenY);
      const pigment = source.color.join(" ");
      const wash = light.createRadialGradient(0, 0, 0, 0, 0, 1);
      wash.addColorStop(0, `rgb(${pigment} / ${intensity})`);
      wash.addColorStop(0.28, `rgb(${pigment} / ${intensity * 0.61})`);
      wash.addColorStop(0.65, `rgb(${pigment} / ${intensity * 0.13})`);
      wash.addColorStop(1, `rgb(${pigment} / 0)`);
      light.fillStyle = wash;
      light.fillRect(-1, -1, 2, 2);
      light.restore();
    }

    function drawProjection() {
      const pixels = projectedImage.data;
      for (let read = 0, write = 0; read < projectedLight.length; read += 3, write += 4) {
        pixels[write] = projectedLight[read];
        pixels[write + 1] = projectedLight[read + 1];
        pixels[write + 2] = projectedLight[read + 2];
        pixels[write + 3] = 255;
      }
      projectionContext.putImageData(projectedImage, 0, 0);
      light.drawImage(projection, 0, 0, width, height);
    }

    function drawSoftLight(matrix) {
      light.fillStyle = "#000";
      light.fillRect(0, 0, width, height);
      const radius = Math.min(focalLength * 0.29, width * 0.54, height * 0.5);
      for (const side of [-1, 1]) {
        const x = width / 2 + radius * (side * (0.50 + 0.10 * matrix[0]) + 0.16 * matrix[6]);
        const y = height / 2 + radius * (side * 0.31 * matrix[5] + 0.10 * matrix[7]);
        const color = side < 0 ? "53 107 255" : "255 177 67";
        const strength = 0.13 + 0.04 * side * matrix[2];
        light.save();
        light.translate(x, y);
        light.rotate(0.42 * matrix[1] - 0.28 * matrix[2]);
        light.scale(radius, radius * 0.86);
        const glow = light.createRadialGradient(0, 0, 0, 0, 0, 1);
        glow.addColorStop(0, `rgb(${color} / ${strength})`);
        glow.addColorStop(0.45, `rgb(${color} / ${strength * 0.39})`);
        glow.addColorStop(1, `rgb(${color} / 0)`);
        light.fillStyle = glow;
        light.fillRect(-1, -1, 2, 2);
        light.restore();
      }
    }

    let dimmedBackdropDrawn = false;
    return {
      layout(nextWidth, nextHeight, titleSize) {
        width = nextWidth;
        height = nextHeight;
        focalLength = Math.max(1, titleSize / (headlineHeightRatio * cameraSpan));
        floorY = -height * 0.24 * (cameraDistance - wallZ) / focalLength;
        curveRadius = Math.min(0.39, -floorY * 0.32);
        const density = Math.min(0.65, Math.sqrt(420000 / (width * height)));
        roomCanvas.width = Math.ceil(width * density);
        roomCanvas.height = Math.ceil(height * density);
        light.setTransform(roomCanvas.width / width, 0, 0, roomCanvas.height / height, 0, 0);
        dimmedBackdropDrawn = false;
        shadeRoom();
        layoutProjection();
      },
      draw(matrix) {
        const isPrism = lighting === "prism";
        if (isPrism && dimmedBackdropDrawn) return;
        dimmedBackdropDrawn = isPrism;
        if (lighting === "soft" || lighting === "near-spectrum") {
          drawSoftLight(matrix);
          return;
        }
        if (lighting === "spectrum") {
          light.fillStyle = "#000";
          light.fillRect(0, 0, width, height);
          return;
        }
        light.drawImage(backdrop, 0, 0, width, height);
        if (isPrism) {
          light.fillStyle = "rgba(0, 0, 0, 0.62)";
          light.fillRect(0, 0, width, height);
          return;
        }
        light.globalCompositeOperation = "screen";
        const useProjection = usesProjectedLight();
        if (useProjection) projectedLight.fill(0);
        for (let axis = 0; axis < 3; axis++) {
          const x = matrix[axis], y = matrix[axis + 3], z = matrix[axis + 6];
          for (const source of emitters) {
            paintHit(x, y, z, source);
            paintHit(-x, -y, -z, source);
          }
        }
        if (useProjection) drawProjection();
        light.globalCompositeOperation = "source-over";
      }
    };
  }

  function createRenderer() {
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: false });
    if (!gl) return null;
    const room = lighting === "spectrum" ? null : createRoomLighting();

    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(error);
      }
      return shader;
    }

    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(program, "uHeadline"), 0);

    const rotation = gl.getUniformLocation(program, "uInverseRotation");
    const resolution = gl.getUniformLocation(program, "uResolution");
    const aspect = gl.getUniformLocation(program, "uAspect");
    const sceneScale = gl.getUniformLocation(program, "uSceneScale");
    const prism = gl.getUniformLocation(program, "uPrism");
    const spectralEdges = gl.getUniformLocation(program, "uSpectralEdges");
    const nearSpectrum = gl.getUniformLocation(program, "uNearSpectrum");
    gl.clearColor(0, 0, 0, 0);

    return {
      layout(width, height, titleSize) {
        room?.layout(width, height, titleSize);
        const density = Math.min(devicePixelRatio, 1.5, Math.sqrt(2000000 / (width * height)));
        canvas.width = Math.round(width * density);
        canvas.height = Math.round(height * density);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(resolution, canvas.width, canvas.height);
        gl.uniform1f(aspect, width / height);
        gl.uniform1f(sceneScale, titleSize / (height * headlineHeightRatio));
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, headline);
      },
      draw() {
        const matrix = inverseRotation(orientation);
        room?.draw(matrix);
        gl.uniformMatrix3fv(rotation, false, matrix);
        gl.uniform1i(prism, Number(lighting === "prism"));
        gl.uniform1i(spectralEdges, Number(lighting === "spectrum"));
        gl.uniform1i(nearSpectrum, Number(lighting === "near-spectrum"));
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    };
  }

  function layout() {
    const { width, height } = art.getBoundingClientRect();
    if (!width || !height) return;
    const density = Math.min(devicePixelRatio, 2, Math.sqrt(4000000 / (width * height)));
    headline.width = Math.round(width * density);
    headline.height = Math.round(height * density);
    context.setTransform(headline.width / width, 0, 0, headline.height / height, 0, 0);
    headlineOutline.width = headline.width;
    headlineOutline.height = headline.height;
    outlineContext.setTransform(headline.width / width, 0, 0, headline.height / height, 0, 0);

    // Keep the glass at the same scale it used with the previous headline.
    const narrowSize = Math.min(width * 0.208, width * 0.072 + height * 0.053);
    const referenceSize = Math.min(height * headlineHeightRatio, Math.max(width * 0.122, narrowSize));
    context.font = `800 ${referenceSize}px Poppins, "Avenir Next", Arial, sans-serif`;
    const widest = Math.max(...titleLines.map(line => context.measureText(line).width));
    const titleWidth = Math.min(width * 0.84, width - 64);
    const glassSize = referenceSize * Math.min(1, titleWidth / widest);

    const scale = Math.min(width / designWidth, height / designHeight);
    context.fillStyle = "#f7f7f7";
    context.textAlign = "center";
    for (const [index, { family, weight, fontSize, tracking, centerX, inkTop }] of designedHeadline.entries()) {
      const text = titleLines[index];
      context.font = `${weight} ${fontSize * scale}px ${family}, "Arial Narrow", sans-serif`;
      context.letterSpacing = `${tracking * scale}px`;
      const metrics = context.measureText(text);
      const correction = (metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2;
      const x = width / 2 + (centerX - designWidth / 2) * scale;
      const top = height / 2 + (inkTop - designHeight / 2) * scale;
      const baseline = top + metrics.actualBoundingBoxAscent;
      context.fillText(text, x + correction, baseline);

      if (index === 0) {
        const lineBoxTop = height / 2 + (203 - designHeight / 2) * scale;
        const gradient = outlineContext.createLinearGradient(0, lineBoxTop, 0, lineBoxTop + 300 * 0.716346 * scale);
        gradient.addColorStop(0, "#fff");
        gradient.addColorStop(1, "#000");
        outlineContext.font = context.font;
        outlineContext.letterSpacing = context.letterSpacing;
        outlineContext.textAlign = context.textAlign;
        outlineContext.lineJoin = "round";
        outlineContext.strokeStyle = gradient;
        outlineContext.lineWidth = 2 * scale;
        const outlineBaseline = baseline - 61 * scale;
        outlineContext.strokeText(text, x + correction, outlineBaseline);
        outlineContext.globalCompositeOperation = "destination-out";
        outlineContext.fillText(text, x + correction, outlineBaseline);
      }
    }

    renderer?.layout(width, height, glassSize);
    renderer?.draw();
  }

  function setView(nextView) {
    view = nextView;
    dots.forEach((dot, index) => dot.setAttribute("aria-pressed", String(index === view)));
  }

  function settleOn(next, now = performance.now()) {
    velocityX = velocityY = 0;
    idleSince = now + 600;
    if (motion.matches) {
      orientation = next;
      target = null;
      renderer?.draw();
    } else {
      target = next;
    }
  }

  function turn(direction) {
    setView((view + direction + dots.length) % dots.length);
    settleOn(multiply(axisAngle(1, direction * quarterTurn), target ?? orientation));
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    if (coverVisible && renderer && !pointer) {
      if (target) {
        const amount = 1 - Math.pow(0.90, dt * 60);
        orientation = interpolate(orientation, target, amount);
        const closeness = Math.abs(orientation.reduce((sum, value, index) => sum + value * target[index], 0));
        if (closeness > 0.9999999) {
          orientation = target;
          target = null;
          idleSince = now + 600;
        }
        renderer.draw();
      } else if (!motion.matches && (Math.abs(velocityX) + Math.abs(velocityY) > 0.0001 || now > idleSince)) {
        const frames = dt * 60;
        const decay = Math.pow(0.94, frames);
        const drift = Math.min(1, Math.max(0, (now - idleSince) / 1000));
        rotate((velocityX + 0.0035 * drift) * frames, (velocityY + 0.0012 * drift) * frames);
        velocityX *= decay;
        velocityY *= decay;
        renderer.draw();
      }
    }
    requestAnimationFrame(tick);
  }

  function startRenderer() {
    try {
      renderer = createRenderer();
    } catch (error) {
      console.error("Unable to render the glass cube", error);
      renderer = null;
    }
    glassTools.hidden = !renderer;
    roomCanvas.hidden = !renderer || lighting === "spectrum";
    for (const control of controls) {
      control.disabled = !renderer;
      control.hidden = !renderer;
    }
    if (renderer) {
      art.tabIndex = 0;
      art.setAttribute("aria-label", "可旋转的玻璃方块，拖动或使用方向键旋转。");
    } else {
      art.removeAttribute("tabindex");
      art.removeAttribute("aria-label");
    }
    headlineOutline.hidden = lighting !== "spectrum" && lighting !== "soft";
    layout();
    cover.toggleAttribute("data-cover-ready", Boolean(renderer));
  }

  art.addEventListener("pointerdown", event => {
    if (!renderer || pointer || event.button !== 0) return;
    art.setPointerCapture(event.pointerId);
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() };
    target = null;
    velocityX = velocityY = 0;
    art.classList.add("dragging");
  });

  art.addEventListener("pointermove", event => {
    if (pointer?.id !== event.pointerId) return;
    const now = performance.now();
    const dx = (event.clientX - pointer.x) * 0.008;
    const dy = event.pointerType === "touch" ? 0 : (event.clientY - pointer.y) * 0.008;
    const frameFactor = 16.67 / Math.max(8, now - pointer.time);
    velocityX = Math.max(-0.22, Math.min(0.22, dx * frameFactor));
    velocityY = Math.max(-0.22, Math.min(0.22, dy * frameFactor));
    rotate(dx, dy);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.time = now;
    renderer?.draw();
  });

  function endDrag(event) {
    if (pointer?.id !== event.pointerId) return;
    const now = performance.now();
    if (event.type !== "pointerup" || now - pointer.time > 90) velocityX = velocityY = 0;
    pointer = null;
    idleSince = now + 600;
    art.classList.remove("dragging");
  }

  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    art.addEventListener(type, endDrag);
  }

  art.addEventListener("keydown", event => {
    const horizontal = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    const vertical = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (!horizontal && !vertical) return;
    event.preventDefault();
    event.stopPropagation();
    if (horizontal) turn(horizontal);
    if (vertical) settleOn(multiply(axisAngle(0, vertical * quarterTurn), target ?? orientation));
  });

  cover.querySelector("#prev").addEventListener("click", () => turn(-1));
  cover.querySelector("#next").addEventListener("click", () => turn(1));
  dots.forEach((dot, index) => dot.addEventListener("click", () => {
    setView(index);
    settleOn(preset(index));
  }));

  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    renderer = null;
    roomCanvas.hidden = true;
    cover.removeAttribute("data-cover-ready");
    glassTools.hidden = true;
    for (const control of controls) control.hidden = true;
    art.removeAttribute("tabindex");
  });
  canvas.addEventListener("webglcontextrestored", startRenderer);
  addEventListener("resize", layout, { passive: true });
  document.fonts?.addEventListener("loadingdone", layout);
  Promise.race([
    Promise.allSettled([
      document.fonts.load("800 100px Poppins"),
      ...designedHeadline.map(({ family, weight }) => document.fonts.load(`${weight} 100px ${family}`))
    ]),
    new Promise(resolve => setTimeout(resolve, 1300))
  ]).then(() => {
    startRenderer();
    requestAnimationFrame(tick);
  });
  layout();
})();
