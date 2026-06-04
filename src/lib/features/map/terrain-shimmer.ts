// World Map v3 Slice 6 (T1) — terrain shimmer filter (PREMISE EXPERIMENT).
//
// Codex's outside-voice challenge: "flat colored cells CAN be animated — a
// layer shader / ripple overlay could make terrain breathe without converting
// it to thousands of sprites." This filter tests exactly that. It applies a
// subtle horizontal UV ripple to whatever is rendered beneath it (the existing
// flat-color terrain Graphics), driven by the shared anim-controller clock.
//
// If running this and watching the terrain "breathe" reads as alive enough,
// the sprite-terrain rewrite (Slice 6's biggest cost) may be unnecessary — a
// huge scope save. If it reads as flat/wrong, sprites are justified. THAT is
// the call this experiment exists to inform; it is not committed UI.
//
// WebGL target: PixiStage inits with no renderer `preference`, and pixi.js
// 8.18.1 autoDetectRenderer renderPriority is ["webgl","webgpu","canvas"], so
// this app runs WebGL — a glProgram-only filter is correct here. If WebGPU is
// ever opted into (preference:'webgpu'), this needs a matching gpuProgram.
//
// VERIFY ON FIRST RUN: type-check cannot validate GLSL. If the console shows a
// shader-compile/link error, it is almost certainly the custom-uniform block
// binding (the one fiddly Pixi v8 detail). The fallback is the commented
// ColorMatrix brightness-pulse at the bottom, which uses only the built-in
// filter API and cannot mis-bind.

type PixiModule = typeof import('pixi.js');
type PixiFilter = import('pixi.js').Filter;

export type TerrainShimmer = {
	filter: PixiFilter;
	/** Push the anim-controller clock (seconds) into the shader uniform. */
	setTime(seconds: number): void;
	destroy(): void;
};

// Standard Pixi v8 filter vertex shader (maps aPosition → clip space + the
// input-texture UV). Lifted from the Pixi v8 filter contract; do not edit.
const VERTEX = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void ) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void ) {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

// Custom uniforms are declared as PLAIN individual uniforms, matching Pixi v8's
// own built-in filters (see node_modules/pixi.js/.../noise/noise.frag.js, which
// declares `uniform float uNoise;` directly — NOT a `uniform { ... }` interface
// block). An interface block forces GLSL ES 3.00 syntax that Pixi compiles as ES
// 1.00, producing "interface blocks supported in GLSL ES 3.00 and above only".
// The `resources.shimmer` group below feeds these by name; Pixi handles the UBO
// wrapping internally. No `#version` directive — Pixi prepends it.
const FRAGMENT = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uAmplitude;
uniform float uFrequency;

void main(void) {
    vec2 uv = vTextureCoord;
    // Horizontal ripple whose phase varies down the screen (uv.y) and over
    // time. Amplitude is in UV space (~0.006 = a few px on a 1k texture) so
    // the motion is a subtle shimmer, not a wobble.
    float offset = sin(uv.y * uFrequency + uTime) * uAmplitude;
    finalColor = texture(uTexture, uv + vec2(offset, 0.0));
}
`;

/**
 * Build the terrain shimmer filter. Pass the dynamically-imported PIXI module
 * (the layer imports pixi.js lazily, client-only).
 *
 * Attach via `layer.filters = [shimmer.filter]` and feed the clock each frame:
 *   anim.register((t) => shimmer.setTime(t))
 */
export function createTerrainShimmerFilter(PIXI: PixiModule): TerrainShimmer {
	const filter = new PIXI.Filter({
		glProgram: PIXI.GlProgram.from({
			vertex: VERTEX,
			fragment: FRAGMENT,
			name: 'terrain-shimmer'
		}),
		resources: {
			shimmer: {
				uTime: { value: 0, type: 'f32' },
				// Tunable. Keep small — this is "breathing", not "wobbling".
				// Reduced per feedback: a faint shimmer, not a visible ripple.
				uAmplitude: { value: 0.0022, type: 'f32' },
				uFrequency: { value: 14.0, type: 'f32' }
			}
		}
	});

	return {
		filter,
		setTime(seconds: number): void {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(filter.resources as any).shimmer.uniforms.uTime = seconds;
		},
		destroy(): void {
			try {
				filter.destroy();
			} catch (_) {
				/* may already be destroyed with its container */
			}
		}
	};
}

// FALLBACK (zero mis-bind risk) if the custom shader errors on first run:
// a brightness pulse using the built-in ColorMatrixFilter. Swap
// createTerrainShimmerFilter for this to confirm the anim-controller wiring
// works independent of custom-GLSL correctness.
//
// export function createTerrainPulse(PIXI: PixiModule): TerrainShimmer {
// 	const filter = new PIXI.ColorMatrixFilter();
// 	return {
// 		filter,
// 		setTime(seconds) { filter.brightness(1 + Math.sin(seconds) * 0.05, false); },
// 		destroy() { try { filter.destroy(); } catch (_) { /* */ } }
// 	};
// }
