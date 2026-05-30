// Slice 4 PR-E — frame-rate-independent exponential smoothing.
//
// Eases `current` toward `target` by a fraction k = 1 − e^(−Δt/τ), where Δt is
// the frame delta in ms and τ the time constant. Unlike a fixed per-frame lerp
// (`current += (target-current)*0.2`), this settles in the same wall-clock time
// regardless of refresh rate — two 8ms frames advance the same as one 16ms
// frame. Never overshoots: k ∈ [0, 1) for Δt ≥ 0, so the result stays within
// [current, target].
export function easeToward(current: number, target: number, deltaMs: number, tauMs: number): number {
	if (tauMs <= 0) return target;
	const k = 1 - Math.exp(-Math.max(0, deltaMs) / tauMs);
	return current + (target - current) * k;
}
