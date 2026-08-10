<script lang="ts">
	// Cinematic Spotlight (Slice 8) — punctuation FX overlay.
	//
	// Renders the frame-diff punctuation beats (punctuation-diff.ts) as decaying
	// Graphics over the map. Three kinds, one overlay + one ticker:
	//   - CONQUEST PULSE (PR1): an owner-flipped region gets a brief outline.
	//   - MARCH TRAIL (PR2): a moved placement leaves a fading additive streak
	//     from its previous to its new interpolated position.
	//   - CAUSAL RIPPLE (PR2, headline): a newly-lit caused_by edge pulses a bright
	//     dot travelling cause→effect along the edge, over a faint fading arc.
	//
	// Imperative by design (the PR0 invariant): WorldMap calls spawn*() when the
	// playback controller emits beats; each FX is a plain Graphics advanced in the
	// shared anim-controller tick — never $state. FX are destroyed on decay,
	// map switch, replay/interrupt (clearAll), and teardown, and are scoped to the
	// active mapId.
	//
	// pixi.js is dynamic-imported in onMount so this component's static module load
	// doesn't pull pixi into the Cloudflare Worker SSR bundle (same discipline as
	// the other Pixi layers).

	import { getContext, onDestroy, onMount } from 'svelte';
	import { PIXI_STAGE_CONTEXT, type PixiStageContext } from './pixi-context.js';
	import type { MapRegion } from './types.js';
	import type { ConquestFlip, MarchTrail, CausalRipple } from './punctuation-diff.js';

	type PixiModule = typeof import('pixi.js');
	type PixiContainer = import('pixi.js').Container;
	type PixiGraphics = import('pixi.js').Graphics;
	type PixiText = import('pixi.js').Text;

	let {
		regions,
		mapId,
		mapWidth = 0,
		mapHeight = 0,
		reducedMotion = false,
		onReady
	}: {
		regions: MapRegion[];
		mapId: string | null;
		// Source-image dims — march/ripple beats carry FRACTIONAL [0,1] positions
		// (the artifactOverrides / causalEdges convention); the layer multiplies by
		// these to reach the world px space the viewport draws in.
		mapWidth?: number;
		mapHeight?: number;
		// prefers-reduced-motion: jump-cut. Owner changes still read via the region
		// tint (which snaps under reduced motion); the moving FX are suppressed so
		// there's no motion to trigger on.
		reducedMotion?: boolean;
		// Fired once the caption pipeline can accept captions (Pixi imported +
		// captionContainer created). Lets the parent's caption $effect retry an
		// opening beat that arrived before the dynamic Pixi import finished, instead
		// of dropping it (Codex PR #72).
		onReady?: () => void;
	} = $props();

	const stageCtx = getContext<PixiStageContext>(PIXI_STAGE_CONTEXT);

	const FLASH_MS = 220;
	const FLASH_PEAK = 0.28;
	const MARCH_MS = 550; // trail decay — outlasts a flash so the path reads
	const MARCH_PEAK = 0.7;
	const RIPPLE_MS = 650; // ripple travel + decay — the longest, it's the headline
	const RIPPLE_PEAK = 0.9;
	const RIPPLE_DOT_R = 7; // travelling pulse radius (world px)
	// Defensive cap on concurrent FX Graphics. Normal playback spawns a handful of
	// beats per boundary; this only trips on a pathological authored world (e.g.
	// thousands of placements moving at one T), where it sheds new FX rather than
	// letting unbounded Graphics exhaust the GPU. Logged once, never silent.
	// (review: Codex unbounded-FX.)
	const MAX_FX = 240;
	let fxCapWarned = false;
	function fxCapped(): boolean {
		if (fx.length < MAX_FX) return false;
		if (!fxCapWarned) {
			fxCapWarned = true;
			console.warn(`PixiPunctuationLayer: FX cap (${MAX_FX}) reached — shedding excess beats this frame.`);
		}
		return true;
	}
	// Opt-in diagnostic (same gate as PixiRegionLayer): in the preview/E2E build
	// only when window.__SPOTLIGHT_DIAG__ is set, so the ship-gate spec can assert
	// FX actually fired under playback. Prod stays clean.
	const DIAG =
		import.meta.env.DEV ||
		(typeof window !== 'undefined' &&
			(window as unknown as { __SPOTLIGHT_DIAG__?: boolean }).__SPOTLIGHT_DIAG__ === true);

	let PIXI = $state<PixiModule | null>(null);
	let layer: PixiContainer | null = null;

	// Active FX. Plain array (not $state) — advanced imperatively in the ticker.
	// `delayMs` implements the simultaneous-beat stagger; `update(localT)` draws
	// this FX at local age `localT` (ms since its delay elapsed). Conquest/march
	// only re-alpha; ripple redraws its travelling dot each tick.
	type Fx = { g: PixiGraphics; ageMs: number; delayMs: number; durMs: number; update: (localT: number) => void };
	let fx: Fx[] = [];

	// Captions (T9): a screen-fixed lower-third title card on app.stage (NOT the
	// viewport — it must not pan/zoom). One caption at a time; a new one supersedes.
	const CAPTION_MS = 2600; // fade-in + hold + fade-out
	const CAPTION_FADE_IN = 200;
	const CAPTION_FADE_OUT = 500;
	const CAPTION_PEAK = 0.95;
	let captionContainer: PixiContainer | null = null;
	let caption: { g: PixiText; ageMs: number } | null = null;

	function regionPolyById(id: string): MapRegion | undefined {
		return regions.find((r) => r.id === id);
	}

	function bumpDiag(key: '__spotlightFlashCount' | '__spotlightMarchCount' | '__spotlightRippleCount'): void {
		if (!DIAG || typeof window === 'undefined') return;
		const w = window as unknown as Record<string, number | undefined>;
		w[key] = (w[key] ?? 0) + 1;
	}

	onMount(() => {
		let cancelled = false;
		(async () => {
			const mod = await import('pixi.js');
			if (cancelled) return;
			PIXI = mod;
		})();
		// Warm the Fraunces face (DESIGN.md's entity-name typeface) so the first
		// caption rasterizes in it rather than the serif fallback. Pixi canvas text
		// reads from the browser font set; Google Fonts loads with display=swap, so
		// without this nudge an early caption could paint as Georgia. Fire-and-forget.
		if (typeof document !== 'undefined' && document.fonts?.load) {
			document.fonts.load('italic 22px Fraunces').catch(() => {});
		}
		return () => {
			cancelled = true;
		};
	});

	// Create the overlay container once the app + viewport + pixi are ready, and
	// register the decay ticker on the SHARED anim-controller (single-ticker
	// invariant). Each frame ages every FX, lets it redraw, and destroys it on
	// completion.
	$effect(() => {
		const app = stageCtx.app;
		const anim = stageCtx.anim;
		const viewport = stageCtx.viewport;
		if (!app || !PIXI || !anim || !viewport) return;

		if (!layer) {
			layer = new PIXI.Container();
			// Non-interactive: FX must never steal a hit-test from regions/markers.
			layer.eventMode = 'none';
			viewport.addChild(layer);
		}
		// Caption container lives on the STAGE (screen space), so it stays a fixed
		// lower-third while the viewport pans/zooms under it.
		if (!captionContainer) {
			captionContainer = new PIXI.Container();
			captionContainer.eventMode = 'none';
			app.stage.addChild(captionContainer);
			// Caption pipeline is now live — let the parent retry any opening beat
			// that fired before the dynamic Pixi import finished (Codex PR #72).
			onReady?.();
		}

		const off = anim.register(() => {
			const dt = app.ticker.deltaMS;
			if (fx.length) {
				const survivors: Fx[] = [];
				for (const item of fx) {
					if (item.g.destroyed) continue;
					item.ageMs += dt;
					const localT = item.ageMs - item.delayMs;
					if (localT < 0) {
						item.g.alpha = 0; // staggered: not started yet
						survivors.push(item);
					} else if (localT >= item.durMs) {
						item.g.destroy(); // decay complete
					} else {
						item.update(localT);
						survivors.push(item);
					}
				}
				fx = survivors;
			}
			if (caption) {
				const c = caption;
				if (c.g.destroyed) {
					caption = null;
				} else {
					c.ageMs += dt;
					if (c.ageMs >= CAPTION_MS) {
						c.g.destroy();
						caption = null;
					} else {
						// Fade in, hold, fade out. Under reduced motion the envelope is
						// skipped (instant on/off) — captions are informational, so they
						// still show, just without the glide.
						const a = reducedMotion ? CAPTION_PEAK : captionAlpha(c.ageMs);
						c.g.alpha = a;
						// Re-anchor lower-center each tick (handles window resize).
						c.g.x = Math.round((app.screen.width - c.g.width) / 2);
						c.g.y = Math.round(app.screen.height - c.g.height - 28);
					}
				}
			}
		});
		return () => off();
	});

	// Caption alpha envelope over its lifetime.
	function captionAlpha(ageMs: number): number {
		if (ageMs < CAPTION_FADE_IN) return CAPTION_PEAK * (ageMs / CAPTION_FADE_IN);
		const outStart = CAPTION_MS - CAPTION_FADE_OUT;
		if (ageMs > outStart) return CAPTION_PEAK * (1 - (ageMs - outStart) / CAPTION_FADE_OUT);
		return CAPTION_PEAK;
	}

	// FX are scoped to a map: a map switch destroys any in-flight FX so they can't
	// bleed onto the new map. The caption is screen-space and titles the current
	// beat (which can span an auto map switch), so it is preserved — clearFx, not
	// clearAll (Codex PR #72). Reading mapId makes this $effect re-run on switch.
	$effect(() => {
		void mapId;
		clearFx();
	});

	/**
	 * Spawn a restrained outline pulse for each conquest flip. Called imperatively by WorldMap when
	 * the playback controller emits beats. No-op under reduced motion (jump-cut)
	 * or before pixi/layer are ready.
	 */
	export function spawnConquest(flips: ConquestFlip[]): void {
		if (reducedMotion || !PIXI || !layer) return;
		for (const flip of flips) {
			if (fxCapped()) break;
			const region = regionPolyById(flip.regionId);
			if (!region?.polygon || region.polygon.length < 3) continue;
			const flat: number[] = [];
			for (const [lat, lng] of region.polygon) flat.push(lng, lat); // → world [x, y]
			if (flat.length < 6) continue;
			const g: PixiGraphics = new PIXI.Graphics();
			g.poly(flat).stroke({ width: 3, color: 0xffffff, alpha: 1 });
			g.alpha = 0; // ticker raises it; staggered flips wait out their delay
			g.eventMode = 'none';
			layer.addChild(g);
			fx.push({
				g,
				ageMs: 0,
				delayMs: flip.staggerMs,
				durMs: FLASH_MS,
				update: (t) => {
					g.alpha = FLASH_PEAK * (1 - t / FLASH_MS);
				}
			});
			bumpDiag('__spotlightFlashCount');
		}
	}

	/**
	 * Spawn a fading streak for each march (placement that moved this frame). The
	 * streak is the segment the marker travelled; it fades over MARCH_MS.
	 */
	export function spawnMarch(marches: MarchTrail[]): void {
		if (reducedMotion || !PIXI || !layer || mapWidth <= 0 || mapHeight <= 0) return;
		for (const m of marches) {
			if (fxCapped()) break;
			const x0 = m.fromX * mapWidth;
			const y0 = m.fromY * mapHeight;
			const x1 = m.toX * mapWidth;
			const y1 = m.toY * mapHeight;
			const g: PixiGraphics = new PIXI.Graphics();
			g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 4, color: 0xffe08a, alpha: 1 });
			g.blendMode = 'add';
			g.alpha = 0;
			g.eventMode = 'none';
			layer.addChild(g);
			fx.push({
				g,
				ageMs: 0,
				delayMs: m.staggerMs,
				durMs: MARCH_MS,
				update: (t) => {
					g.alpha = MARCH_PEAK * (1 - t / MARCH_MS);
				}
			});
			bumpDiag('__spotlightMarchCount');
		}
	}

	/**
	 * Spawn a ripple for each newly-lit causal edge: a faint additive arc plus a
	 * bright dot travelling cause→effect (toPos→fromPos — fromPos is the effect
	 * centroid, projection.ts:298-308). Redrawn each tick over RIPPLE_MS.
	 */
	export function spawnRipple(ripples: CausalRipple[]): void {
		if (reducedMotion || !PIXI || !layer || mapWidth <= 0 || mapHeight <= 0) return;
		for (const r of ripples) {
			if (fxCapped()) break;
			// effect endpoint (arrow tail) and cause endpoint (arrow head), world px.
			const ex = r.fromX * mapWidth;
			const ey = r.fromY * mapHeight;
			const cx = r.toX * mapWidth;
			const cy = r.toY * mapHeight;
			const g: PixiGraphics = new PIXI.Graphics();
			g.blendMode = 'add';
			g.alpha = 1; // the FX fades itself via per-tick redraw, not container alpha
			g.eventMode = 'none';
			layer.addChild(g);
			fx.push({
				g,
				ageMs: 0,
				delayMs: r.staggerMs,
				durMs: RIPPLE_MS,
				update: (t) => {
					const f = t / RIPPLE_MS; // 0→1 travel + fade
					const px = cx + (ex - cx) * f; // cause → effect
					const py = cy + (ey - cy) * f;
					g.clear();
					// faint full-edge arc, fading out
					g.moveTo(cx, cy)
						.lineTo(ex, ey)
						.stroke({ width: 2, color: 0x9fd8ff, alpha: RIPPLE_PEAK * 0.35 * (1 - f) });
					// bright travelling pulse
					g.circle(px, py, RIPPLE_DOT_R).fill({ color: 0xdff1ff, alpha: RIPPLE_PEAK * (1 - f) });
				}
			});
			bumpDiag('__spotlightRippleCount');
		}
	}

	/**
	 * Show a caption title card (T9). Called imperatively by WorldMap when an Event
	 * becomes active at T. Supersedes any current caption. Shown even under reduced
	 * motion (informational text), just without the fade envelope.
	 *
	 * Returns true if the caption was shown, false if Pixi/the container isn't ready
	 * yet (so the caller can retry on a later tick rather than mark it as titled and
	 * skip it forever — Codex PR #72).
	 */
	export function spawnCaption(title: string): boolean {
		if (!PIXI || !captionContainer || !title) return false;
		if (caption && !caption.g.destroyed) caption.g.destroy();
		// Wrap long titles to the viewport. Without this a long Event name (or a
		// narrow window) renders as one over-wide line, and the lower-center anchor
		// just gives it a negative x — clipping both ends off-screen and making the
		// caption unreadable (Codex PR #72). Cap at ~86% of the screen width, with a
		// sane fallback if the app isn't measurable yet; align center so wrapped lines
		// stay centered under the existing anchor math (which uses g.width).
		const screenW = stageCtx.app?.screen.width ?? 720;
		const g: PixiText = new PIXI.Text({
			text: title,
			style: {
				fill: 0xf5f0e6,
				// Fraunces — the entity-name typeface (DESIGN.md --font-display);
				// captions title Events by their entity name. Georgia/serif is the
				// fallback while the web font warms (see onMount preload).
				fontFamily: 'Fraunces, Georgia, "Times New Roman", serif',
				fontSize: 22,
				fontStyle: 'italic',
				stroke: { color: 0x1a1a1a, width: 4 },
				dropShadow: { color: 0x000000, alpha: 0.6, blur: 3, distance: 1, angle: Math.PI / 2 },
				wordWrap: true,
				wordWrapWidth: Math.max(240, Math.round(screenW * 0.86)),
				align: 'center'
			}
		});
		g.eventMode = 'none';
		g.alpha = 0;
		captionContainer.addChild(g);
		caption = { g, ageMs: 0 };
		if (DIAG && typeof window !== 'undefined') {
			const w = window as unknown as { __spotlightCaptionCount?: number };
			w.__spotlightCaptionCount = (w.__spotlightCaptionCount ?? 0) + 1;
		}
		return true;
	}

	/** Destroy in-flight map-scoped FX (conquest/march/ripple). Does NOT touch the
	 * caption, which lives in screen space and titles the current beat — a beat can
	 * span an automatic map switch, so the switch must not truncate its caption
	 * (Codex PR #72). Used by the map-switch effect. */
	function clearFx(): void {
		for (const item of fx) {
			if (!item.g.destroyed) item.g.destroy();
		}
		fx = [];
	}

	/** Destroy only the screen-space caption, leaving map FX alone. Used when the
	 * playhead is dismissed to idle: no Event is active, so the previous Event's
	 * title must not linger on screen for its remaining lifetime (Codex PR #72). */
	export function clearCaption(): void {
		if (caption && !caption.g.destroyed) caption.g.destroy();
		caption = null;
	}

	/** Destroy every in-flight FX AND the caption (replay-from-start, interrupt,
	 * teardown). */
	export function clearAll(): void {
		clearFx();
		clearCaption();
	}

	onDestroy(() => {
		clearAll();
		if (layer) {
			try {
				layer.destroy({ children: true });
			} catch (_) {
				/* PixiStage may have destroyed the app first */
			}
			layer = null;
		}
		if (captionContainer) {
			try {
				captionContainer.destroy({ children: true });
			} catch (_) {
				/* app already destroyed */
			}
			captionContainer = null;
		}
	});
</script>
