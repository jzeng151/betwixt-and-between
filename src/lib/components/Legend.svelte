<script lang="ts" module>
	/**
	 * Legend — toggleable list of relationship types (Phase 1B C4).
	 *
	 * The Legend acts as a HARD filter (locked C4 invariant): toggling a
	 * type off hides those edges entirely from the graph. Scrubber dimming
	 * remains a SOFT filter (visual fade only). The two layer cleanly:
	 * a hidden type stays hidden regardless of playhead, and a dimmed
	 * edge is dimmed only when the type is currently shown.
	 */
	import type { RelationshipType } from '$lib/server/db/schema.js';
	export type { RelationshipType };
</script>

<script lang="ts">
	import { REL_COLOR, REL_TYPES } from '$lib/relationship-colors.js';

	interface Props {
		/** Currently-enabled relationship types. Defaults to all types on. */
		enabled: Set<RelationshipType>;
		onToggle: (type: RelationshipType) => void;
	}

	let { enabled, onToggle }: Props = $props();
</script>

<div class="legend">
	<p class="legend-heading">Relationships</p>
	<ul class="legend-list">
		{#each REL_TYPES as type (type)}
			{@const on = enabled.has(type)}
			<li class="legend-row">
				<button
					class="legend-toggle"
					class:on
					title={on ? `Hide ${type.replace(/_/g, ' ')}` : `Show ${type.replace(/_/g, ' ')}`}
					aria-pressed={on}
					aria-label="Toggle {type.replace(/_/g, ' ')} edges"
					onclick={() => onToggle(type)}
				>
					<span class="swatch" style="--c:{REL_COLOR[type]}"></span>
					<span class="label">{type.replace(/_/g, ' ')}</span>
				</button>
			</li>
		{/each}
	</ul>
</div>

<style>
	.legend {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 10px;
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		font-family: var(--font-ui);
		font-size: 12px;
		min-width: 160px;
		pointer-events: auto;
	}

	.legend-heading {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.legend-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.legend-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 3px 6px;
		background: transparent;
		border: none;
		border-radius: 3px;
		color: var(--color-text);
		font-family: inherit;
		font-size: inherit;
		text-align: left;
		cursor: pointer;
		opacity: 0.4;
	}

	.legend-toggle.on {
		opacity: 1;
	}

	.legend-toggle:hover {
		background: var(--color-surface);
	}

	.swatch {
		width: 14px;
		height: 3px;
		background: var(--c);
		border-radius: 2px;
		flex-shrink: 0;
	}

	.label {
		text-transform: capitalize;
	}
</style>
