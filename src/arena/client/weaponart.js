// Spec renders of each weapon for the armoury and killcam card: the first-person
// model, arms removed, drawn as a lit silhouette with its edges traced in frost.
import * as THREE from 'three';
import { buildWeapon } from './viewmodel.js';

const cache = new Map();
let stage = null;

function ensureStage() {
  if (stage) return stage;
  const canvas = document.createElement('canvas');
  canvas.width = 720; canvas.height = 300;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#dbe7ef', '#10161b', 1.6));
  const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(3, 4, 2); scene.add(key);
  const rim = new THREE.DirectionalLight('#ffb547', 1.2); rim.position.set(-3, 1, -4); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(18, canvas.width / canvas.height, 0.05, 50);
  stage = { canvas, renderer, scene, camera };
  return stage;
}

export function weaponArt(id) {
  if (cache.has(id)) return cache.get(id);
  let url = '';
  try {
    const { canvas, renderer, scene, camera } = ensureStage();
    const model = buildWeapon(id, '#ffb547');
    model.children.filter((child) => child.userData.arm).forEach((arm) => model.remove(arm));
    const fill = new THREE.MeshStandardMaterial({ color: '#4a5864', roughness: 0.5, metalness: 0.3 });
    const edge = new THREE.LineBasicMaterial({ color: '#e6edf1', transparent: true, opacity: 0.85 });
    model.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const glowing = mesh.material.emissiveIntensity > 0;
      mesh.material = glowing ? new THREE.MeshBasicMaterial({ color: '#ffb547' }) : fill;
      if (!glowing) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 28), edge));
    });
    // Three-quarter side view, barrel to the right, framed to the model's length.
    model.rotation.set(0.06, -0.42, 0);
    scene.add(model);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    const span = Math.max(Math.hypot(size.x, size.z), size.y * camera.aspect);
    const distance = (span / 2) * 1.12 / Math.tan(hfov / 2) + size.x;
    camera.position.set(center.x + distance, center.y + distance * 0.18, center.z);
    camera.lookAt(center);
    renderer.render(scene, camera);
    url = canvas.toDataURL('image/png');
    scene.remove(model);
    model.traverse((mesh) => { if (mesh.geometry) mesh.geometry.dispose(); });
    fill.dispose(); edge.dispose();
  } catch { url = ''; }
  cache.set(id, url);
  return url;
}
