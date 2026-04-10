import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as BGU from "three/addons/utils/BufferGeometryUtils.js";

const noise = `
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
   -0.577350269189626,
    0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(
    permute(i.y + vec3(0.0, i1.y, 1.0)) +
    i.x + vec3(0.0, i1.x, 1.0)
  );
  vec3 m = max(
    0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)),
    0.0
  );
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`;

const canvasRoot = document.getElementById("abyssCanvasRoot");

if (!canvasRoot) {
  throw new Error("Abyss canvas root was not found.");
}

const uniforms = {
  time: { value: 0 }
};

const toQuads = (geometry) => {
  const parameters = geometry.parameters;
  const segmentsX =
    (geometry.type === "TorusGeometry" ? parameters.tubularSegments : parameters.radialSegments) ||
    parameters.widthSegments ||
    parameters.thetaSegments ||
    (parameters.points ? parameters.points.length - 1 : 0) ||
    1;
  const segmentsY =
    (geometry.type === "TorusGeometry" ? parameters.radialSegments : parameters.tubularSegments) ||
    parameters.heightSegments ||
    parameters.phiSegments ||
    parameters.segments ||
    1;
  const indices = [];

  for (let row = 0; row < segmentsY + 1; row += 1) {
    let currentIndex = 0;
    let nextIndex = 0;

    for (let column = 0; column < segmentsX; column += 1) {
      currentIndex = (segmentsX + 1) * row + column;
      nextIndex = currentIndex + 1;
      const belowIndex = currentIndex + (segmentsX + 1);

      indices.push(currentIndex, nextIndex);

      if (belowIndex < (segmentsX + 1) * (segmentsY + 1) - 1) {
        indices.push(currentIndex, belowIndex);
      }
    }

    if (nextIndex + segmentsX + 1 <= (segmentsX + 1) * (segmentsY + 1) - 1) {
      indices.push(nextIndex, nextIndex + segmentsX + 1);
    }
  }

  geometry.setIndex(indices);
};

class SeaBed extends THREE.LineSegments {
  constructor() {
    const geometry = new THREE.PlaneGeometry(100, 100, 400, 400)
      .rotateX(-Math.PI * 0.5)
      .rotateY(Math.PI * 0.25);

    toQuads(geometry);

    const material = new THREE.MeshBasicMaterial({
      color: "#d0d0d0",
      onBeforeCompile: (shader) => {
        shader.uniforms.time = uniforms.time;
        shader.vertexShader = `
          uniform float time;
          varying float vN;
          varying vec3 vPos;
          ${noise}
          ${shader.vertexShader}
        `.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float t = time;
          float posX = position.x - mod(t, 2.0 * sqrt(2.0));
          transformed.x = posX;
          float xShift = posX + t;
          float n = snoise(vec2(xShift, position.z) * 0.1);
          vN = n;
          transformed.y = n * 1.0;
          vPos = transformed;`
        );
        shader.fragmentShader = `
          varying float vN;
          varying vec3 vPos;
          ${shader.fragmentShader}
        `.replace(
          "vec4 diffuseColor = vec4( diffuse, opacity );",
          `
          vec3 col = mix(diffuse, vec3(1.0), 1.0 - smoothstep(-0.5, 0.0, vN));
          col += vec3(0.22) * (1.0 - smoothstep(10.0, 15.0, length(vPos)));
          vec4 diffuseColor = vec4(col, opacity);`
        );
      }
    });

    super(geometry, material);
    this.position.y = -5;
  }
}

class Background extends THREE.Mesh {
  constructor(scene) {
    const geometry = new THREE.SphereGeometry(300);
    const material = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      fog: false,
      color: "white",
      map: (() => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1024;
        const context = canvas.getContext("2d");

        if (!context) {
          return null;
        }

        const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0.1, "#1a1a1a");
        gradient.addColorStop(0.4, `#${scene.background.getHexString()}`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 16;
        return texture;
      })()
    });

    super(geometry, material);
  }
}

class WaterStuff extends THREE.Group {
  constructor(mainThing) {
    super();
    this.mainThing = mainThing;
    this.time = 0;
    this.items = Array.from({ length: 2 }, (_, slot) => {
      const item = new Thing();
      const [lineSegment, points] = item.children;
      const isNear = slot === 0;

      if (lineSegment?.material) {
        lineSegment.material.opacity = isNear ? 0.64 : 0.34;
      }

      if (points?.material) {
        points.material.opacity = isNear ? 0.54 : 0.26;
        points.material.size = isNear ? 0.09 : 0.055;
      }

      this.setRandom(item, slot);
      this.add(item);
      return item;
    });
  }

  setRandom(object, slot = 0) {
    const center = this.mainThing ? this.mainThing.position : new THREE.Vector3(0, 0, 0);
    const isNear = slot === 0;
    const anchorAngle = (slot * Math.PI) + (Math.random() - 0.5) * 0.34;
    const distance = isNear ? 3.2 + Math.random() * 0.9 : 6.8 + Math.random() * 1.8;
    const yOffset = isNear ? -0.55 + Math.random() * 1.4 : -1.25 + Math.random() * 2.2;
    const baseScale = isNear ? 0.2 + Math.random() * 0.1 : 0.14 + Math.random() * 0.08;
    const baseRotation = new THREE.Euler(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    );

    object.position.set(
      center.x + Math.cos(anchorAngle) * distance,
      center.y + yOffset,
      center.z + Math.sin(anchorAngle) * distance
    );
    object.rotation.copy(baseRotation);
    object.scale.set(baseScale, baseScale, baseScale);

    object.userData.homeAngle = anchorAngle;
    object.userData.homeDistance = distance;
    object.userData.baseHeight = yOffset;
    object.userData.baseRotation = baseRotation;
    object.userData.baseScale = baseScale;
    object.userData.phase = Math.random() * Math.PI * 2;
    object.userData.orbitSpeed = isNear ? 0.09 + Math.random() * 0.035 : -(0.06 + Math.random() * 0.03);
    object.userData.radiusBreathAmp = isNear ? 0.22 + Math.random() * 0.15 : 0.35 + Math.random() * 0.22;
    object.userData.bobSpeed = isNear ? 0.34 + Math.random() * 0.24 : 0.24 + Math.random() * 0.2;
    object.userData.bobAmp = isNear ? 0.12 + Math.random() * 0.12 : 0.1 + Math.random() * 0.12;
    object.userData.pulseSpeed = isNear ? 0.64 + Math.random() * 0.35 : 0.42 + Math.random() * 0.26;
    object.userData.pulseAmp = isNear ? 0.028 + Math.random() * 0.018 : 0.016 + Math.random() * 0.014;
    object.userData.danceAmpX = isNear ? 0.26 + Math.random() * 0.14 : 0.44 + Math.random() * 0.2;
    object.userData.danceAmpZ = isNear ? 0.18 + Math.random() * 0.12 : 0.34 + Math.random() * 0.18;
    object.userData.danceSpeed = isNear ? 0.9 + Math.random() * 0.3 : 0.62 + Math.random() * 0.24;
    object.userData.tiltAmp = isNear ? 0.12 + Math.random() * 0.06 : 0.08 + Math.random() * 0.05;
    object.userData.profile = isNear ? "near" : "far";
  }

  update(delta) {
    this.time += delta;
    const center = this.mainThing ? this.mainThing.position : new THREE.Vector3(0, 0, 0);

    this.items.forEach((item) => {
      const data = item.userData;
      const t = this.time;
      const phase = data.phase || 0;

      const orbitAngle = (data.homeAngle || 0) + t * (data.orbitSpeed || 0.08);
      const radiusBreath = Math.sin(t * 0.2 + phase) * (data.radiusBreathAmp || 0.3);
      const distance = (data.homeDistance || 5) + radiusBreath;
      const homeX = center.x + Math.cos(orbitAngle) * distance;
      const homeZ = center.z + Math.sin(orbitAngle) * distance;
      const danceX = Math.sin(t * (data.danceSpeed || 0.8) + phase) * (data.danceAmpX || 0.28);
      const danceZ = Math.cos(t * ((data.danceSpeed || 0.8) * 0.9) + phase * 1.2) * (data.danceAmpZ || 0.22);
      const currentX = homeX + danceX;
      const currentZ = homeZ + danceZ;

      const lookAheadT = t + 0.06;
      const aheadOrbitAngle = (data.homeAngle || 0) + lookAheadT * (data.orbitSpeed || 0.08);
      const aheadRadiusBreath = Math.sin(lookAheadT * 0.2 + phase) * (data.radiusBreathAmp || 0.3);
      const aheadDistance = (data.homeDistance || 5) + aheadRadiusBreath;
      const aheadHomeX = center.x + Math.cos(aheadOrbitAngle) * aheadDistance;
      const aheadHomeZ = center.z + Math.sin(aheadOrbitAngle) * aheadDistance;
      const aheadDanceX = Math.sin(lookAheadT * (data.danceSpeed || 0.8) + phase) * (data.danceAmpX || 0.28);
      const aheadDanceZ = Math.cos(lookAheadT * ((data.danceSpeed || 0.8) * 0.9) + phase * 1.2) * (data.danceAmpZ || 0.22);
      const aheadX = aheadHomeX + aheadDanceX;
      const aheadZ = aheadHomeZ + aheadDanceZ;
      const travelAngle = Math.atan2(aheadZ - currentZ, aheadX - currentX);
      const mainSync = Math.sin(uniforms.time.value + phase * 0.35);

      item.position.x = currentX;
      item.position.z = currentZ;
      item.position.y =
        center.y +
        (data.baseHeight || 0) +
        Math.sin(t * (data.bobSpeed || 0.5) + phase) * (data.bobAmp || 0.18) +
        mainSync * 0.08 +
        Math.sin(t * 0.15 + phase * 0.7) * 0.1;

      if (data.baseRotation) {
        item.rotation.x = data.baseRotation.x + mainSync * 0.08;
        item.rotation.y = travelAngle + Math.sin(t * 0.23 + phase) * 0.1;
        item.rotation.z = data.baseRotation.z + mainSync * (data.tiltAmp || 0.12);
      }

      const pulse = 1 + mainSync * (data.pulseAmp || 0.03);
      const baseScale = data.baseScale || 0.4;
      const spread = 1 + Math.cos(uniforms.time.value * 0.8 + phase) * 0.02;
      item.scale.set(baseScale * spread, baseScale * pulse, baseScale * spread);
    });
  }
}

class Thing extends THREE.Group {
  constructor() {
    super();

    const baseGeometry = new THREE.SphereGeometry(3, 64, 32);
    const lineGeometry = new THREE.EdgesGeometry(baseGeometry, 0.5);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.75
    });
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    this.add(lines);

    const pointsGeometry = BGU.mergeVertices(
      baseGeometry.clone().deleteAttribute("uv").deleteAttribute("normal")
    );
    const pointsMaterial = new THREE.PointsMaterial({
      color: "#ffffff",
      size: 0.1,
      transparent: true
    });
    const points = new THREE.Points(pointsGeometry, pointsMaterial);
    this.add(points);

    [lineMaterial, pointsMaterial].forEach((material) => {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.time = uniforms.time;
        shader.vertexShader = `
          uniform float time;
          varying vec3 vPos;
          mat2 rot(float a) { return mat2(cos(a), sin(a), -sin(a), cos(a)); }
          ${shader.vertexShader}
        `.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          vec3 pos = position;
          vPos = pos;

          pos.y *= 0.05;

          float a = atan(pos.z, pos.x);
          float s = cos(a * 4.0);
          float r = s * 0.125 + 0.875;
          pos.xz *= r;

          pos.x -= smoothstep(0.0, 3.0, pos.x) * 0.75;

          float syncWave = sin(time * 1.25 + pos.x);

          float zSwaying = smoothstep(0.25, 2.0, abs(pos.z));
          mat2 zRot = rot(PI * 0.1 * zSwaying * syncWave * sign(pos.z));
          pos.yz *= zRot;

          pos.y += syncWave * 0.5 * ((1.0 - smoothstep(-3.0, 3.0, position.x)) * 0.5 + 0.5);
          transformed = pos;`
        );

        if (material.type === "PointsMaterial") {
          shader.fragmentShader = `
            varying vec3 vPos;
            ${shader.fragmentShader}
          `.replace(
            "vec4 diffuseColor = vec4( diffuse, opacity );",
            `
            vec2 uv = gl_PointCoord - 0.5;
            float pl = length(uv);
            float fw = length(fwidth(uv));
            float f = 1.0 - smoothstep(0.5 - fw, 0.5, pl);

            if (pl > 0.5) discard;

            vec3 bodyColor = mix(vec3(1.0), diffuse, smoothstep(2.0, 1.0, vPos.x));
            vec3 col = mix(bodyColor, diffuse, smoothstep(0.5, 1.0, abs(vPos.z)));
            vec4 diffuseColor = vec4(col, opacity * f);`
          );
        }
      };
    });

    this.position.y = 1;
  }
}

const scene = new THREE.Scene();
scene.background = new THREE.Color("#000000");
scene.fog = new THREE.Fog(scene.background, 8, 30);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
camera.position.set(0.5, 0.25, -1).setLength(7.25);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.domElement.setAttribute("aria-hidden", "true");
canvasRoot.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.maxDistance = 15;
controls.maxPolarAngle = Math.PI * 0.6;
controls.target.set(0, 0.8, 0);

const background = new Background(scene);
const thing = new Thing();
const seaBed = new SeaBed();
const waterStuff = new WaterStuff(thing);

scene.add(background);
scene.add(thing);
scene.add(seaBed);
scene.add(waterStuff);

const updateRendererSize = () => {
  const { clientWidth, clientHeight } = canvasRoot;

  if (!clientWidth || !clientHeight) {
    return;
  }

  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight, false);
};

updateRendererSize();

const resizeObserver = new ResizeObserver(() => {
  updateRendererSize();
});

resizeObserver.observe(canvasRoot);

const clock = new THREE.Clock();
let time = 0;

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  time += delta;
  uniforms.time.value = time * 1.25;
  controls.update();
  waterStuff.update(delta);
  renderer.render(scene, camera);
});

window.addEventListener(
  "pagehide",
  () => {
    resizeObserver.disconnect();
    renderer.setAnimationLoop(null);
    controls.dispose();
    renderer.dispose();
  },
  { once: true }
);