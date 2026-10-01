// Bloom. The world is drawn into a high-range buffer instead of straight to the screen, so a neon tube or
// a lamp can be several times brighter than white. Whatever is brighter than a sunlit wall is pulled out,
// blurred at two sizes (a tight glow and a wide haze) and added back; then the whole picture is tone mapped
// once on its way to the screen, with the finish a lens gives a picture: corners a little darker, a trace of
// grain, slightly deeper contrast. Costs one extra full-size buffer and six small passes; a graphics setting.
import * as THREE from 'three';

const VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const pass = (fragment, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: fragment, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    // Needs to be able to draw into half-float buffers; everything that can run the game can.
    this.supported = renderer.capabilities.isWebGL2 !== false;
    this.enabled = this.supported;
    const hdr = { type: THREE.HalfFloatType, depthBuffer: false };
    this.world = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
    this.tight = [new THREE.WebGLRenderTarget(2, 2, hdr), new THREE.WebGLRenderTarget(2, 2, hdr)];
    this.wide = [new THREE.WebGLRenderTarget(2, 2, hdr), new THREE.WebGLRenderTarget(2, 2, hdr)];
    this.size = new THREE.Vector2();
    // Keep what is brighter than `uFrom`, easing in over `uKnee`, and shrink it to a quarter of the screen.
    this.pick = pass(`uniform sampler2D uMap; uniform vec2 uStep; uniform float uFrom; uniform float uKnee; varying vec2 vUv;
      vec3 bright(vec2 uv) { vec3 c = min(texture2D(uMap, uv).rgb, vec3(40.0)); float l = max(c.r, max(c.g, c.b)); return c * smoothstep(uFrom, uFrom + uKnee, l); }
      void main() { gl_FragColor = vec4((bright(vUv + uStep * vec2(-1.0, -1.0)) + bright(vUv + uStep * vec2(1.0, -1.0)) + bright(vUv + uStep * vec2(-1.0, 1.0)) + bright(vUv + uStep)) * 0.25, 1.0); }`,
    { uMap: { value: null }, uStep: { value: new THREE.Vector2() }, uFrom: { value: 2.3 }, uKnee: { value: 1.6 } });
    // A nine-tap Gaussian, run once across and once down.
    this.blur = pass(`uniform sampler2D uMap; uniform vec2 uDir; varying vec2 vUv;
      void main() { vec3 c = texture2D(uMap, vUv).rgb * 0.227;
        c += (texture2D(uMap, vUv + uDir * 1.385).rgb + texture2D(uMap, vUv - uDir * 1.385).rgb) * 0.316;
        c += (texture2D(uMap, vUv + uDir * 3.231).rgb + texture2D(uMap, vUv - uDir * 3.231).rgb) * 0.0703;
        gl_FragColor = vec4(c, 1.0); }`,
    { uMap: { value: null }, uDir: { value: new THREE.Vector2() } });
    // World plus glow, tone mapped and encoded for the screen.
    this.mix = pass(`uniform sampler2D uWorld; uniform sampler2D uTight; uniform sampler2D uWide; uniform float uGlow; uniform float uGrade; uniform float uSeed; varying vec2 vUv;
      void main() { vec3 c = texture2D(uWorld, vUv).rgb + (texture2D(uTight, vUv).rgb * 0.6 + texture2D(uWide, vUv).rgb * 0.75) * uGlow;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        vec3 shown = gl_FragColor.rgb;
        // A gentle S through the middle, and colour kept where the curve would wash it out.
        vec3 curved = shown * shown * (3.0 - 2.0 * shown);
        shown = mix(shown, curved, 0.16 * uGrade);
        float grey = dot(shown, vec3(0.299, 0.587, 0.114));
        shown = mix(vec3(grey), shown, 1.0 + 0.07 * uGrade);
        vec2 q = (vUv - 0.5) * vec2(1.0, 0.86);
        shown *= 1.0 - 0.24 * uGrade * smoothstep(0.34, 0.86, length(q));
        float grain = fract(sin(dot(gl_FragCoord.xy + uSeed, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        shown += grain * 0.014 * uGrade * (1.0 - grey * 0.6);
        gl_FragColor.rgb = shown;
      }`,
    { uWorld: { value: this.world.texture }, uTight: { value: null }, uWide: { value: null }, uGlow: { value: 0.55 }, uGrade: { value: 1 }, uSeed: { value: 0 } }, { toneMapped: true });
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blur);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  // Point the renderer at the high-range buffer. The caller clears it and draws the world.
  begin() {
    const renderer = this.renderer;
    renderer.getDrawingBufferSize(this.size);
    const w = this.size.x, h = this.size.y;
    if (this.world.width !== w || this.world.height !== h) {
      this.world.setSize(w, h);
      for (const target of this.tight) target.setSize(Math.max(2, w >> 2), Math.max(2, h >> 2));
      for (const target of this.wide) target.setSize(Math.max(2, w >> 3), Math.max(2, h >> 3));
    }
    renderer.setRenderTarget(this.world);
  }

  draw(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  // Pull the glow out, blur it, and put the finished picture on the screen.
  end() {
    const [tightA, tightB] = this.tight, [wideA, wideB] = this.wide;
    this.pick.uniforms.uMap.value = this.world.texture;
    this.pick.uniforms.uStep.value.set(1 / this.world.width, 1 / this.world.height);
    this.draw(this.pick, tightA);
    const blur = (from, to, x, y) => { this.blur.uniforms.uMap.value = from.texture; this.blur.uniforms.uDir.value.set(x, y); this.draw(this.blur, to); };
    blur(tightA, tightB, 1 / tightA.width, 0);
    blur(tightB, tightA, 0, 1 / tightA.height);
    blur(tightA, wideA, 1.5 / tightA.width, 0);
    blur(wideA, wideB, 0, 2 / wideA.height);
    blur(wideB, wideA, 2 / wideA.width, 0);
    this.mix.uniforms.uTight.value = tightA.texture;
    this.mix.uniforms.uWide.value = wideA.texture;
    this.mix.uniforms.uSeed.value = (this.mix.uniforms.uSeed.value + 17.13) % 289;
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.draw(this.mix, null);
  }
}
