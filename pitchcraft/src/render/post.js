import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Post-processing.
 *
 * Three passes, in the order a broadcast camera would apply them:
 *
 *  1. bloom      — floodlights and the goal netting under them actually glare.
 *                  Threshold is set high so only genuinely bright pixels lift;
 *                  a low threshold turns the whole pitch into fog.
 *  2. grade      — lift/gamma/gain colour grading, a vignette, and a touch of
 *                  chromatic aberration at the frame edge. This is the pass
 *                  that makes the image look photographed rather than
 *                  rasterised: an ungraded render has no black point and no
 *                  falloff, so every part of the frame competes for attention.
 *  3. output     — tone map + sRGB, done once at the end of the chain rather
 *                  than by the renderer, so bloom operates in linear space.
 *
 * The whole chain is optional: `quality: 'low'` renders straight to the canvas
 * with no composer allocated at all, which is what mobile defaults to.
 */

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.42 },
    uAberration: { value: 0.0016 },
    uLift: { value: new THREE.Vector3(0.005, 0.008, 0.02) },
    uGain: { value: new THREE.Vector3(1.03, 1.0, 0.97) },
    uSaturation: { value: 1.12 },
    uContrast: { value: 1.06 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uAberration;
    uniform vec3 uLift;
    uniform vec3 uGain;
    uniform float uSaturation;
    uniform float uContrast;
    varying vec2 vUv;

    void main() {
      vec2 centred = vUv - 0.5;
      float r2 = dot(centred, centred);

      // Lateral chromatic aberration: channels sampled at slightly different
      // radii, scaled by r^2 so the centre of frame stays perfectly sharp.
      vec2 offset = centred * r2 * uAberration;
      vec3 color = vec3(
        texture2D(tDiffuse, vUv + offset).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - offset).b
      );

      // Lift / gain, then contrast about mid-grey.
      color = color * uGain + uLift;
      color = (color - 0.5) * uContrast + 0.5;

      // Saturation against Rec.709 luma.
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, uSaturation);

      // Vignette: smooth radial falloff, never fully black at the corner.
      float vig = 1.0 - uVignette * smoothstep(0.18, 0.78, r2);
      color *= vig;

      gl_FragColor = vec4(max(color, 0.0), 1.0);
    }
  `,
};

// Threshold is high on purpose. At 0.85 the painted pitch markings — near-white
// at 0.94 opacity — crossed it and glowed like neon tubing. Only the floodlight
// heads and their glow sprites should be lifting.
const PRESETS = {
  high: { bloomStrength: 0.5, bloomRadius: 0.55, bloomThreshold: 1.02, resolutionScale: 1 },
  medium: { bloomStrength: 0.4, bloomRadius: 0.5, bloomThreshold: 1.06, resolutionScale: 0.75 },
};

export class PostPipeline {
  /**
   * @returns {PostPipeline|null} null when the quality tier renders direct.
   */
  static create(renderer, scene, camera, quality) {
    const preset = PRESETS[quality];
    if (!preset) return null;
    try {
      return new PostPipeline(renderer, scene, camera, preset);
    } catch (err) {
      // A composer needs float render targets. If they are unavailable we would
      // rather lose the grade than lose the game.
      console.warn('post-processing unavailable, rendering direct:', err);
      return null;
    }
  }

  constructor(renderer, scene, camera, preset) {
    this.renderer = renderer;
    this.preset = preset;

    // Bloom must see linear light, so the renderer stops tone-mapping and the
    // OutputPass takes it over at the end of the chain.
    this.previousToneMapping = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.setSize(size.x, size.y);

    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x * preset.resolutionScale, size.y * preset.resolutionScale),
      preset.bloomStrength,
      preset.bloomRadius,
      preset.bloomThreshold
    );
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    const output = new OutputPass();
    this.composer.addPass(output);
    this.output = output;
  }

  /** Swap the camera the RenderPass draws from (celebration cuts, camera modes). */
  setCamera(camera) {
    this.composer.passes[0].camera = camera;
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
    this.bloom.setSize(width * this.preset.resolutionScale, height * this.preset.resolutionScale);
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.renderer.toneMapping = this.previousToneMapping;
    this.composer.dispose();
  }
}
