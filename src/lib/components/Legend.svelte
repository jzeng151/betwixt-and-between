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
	import { REL_COLOR, REL_EDGE_STYLE, REL_TYPES } from '$lib/relationship-colors.js';

	interface Props {
		/** Currently-enabled relationship types. Defaults to all types on. */
		enabled: Set<RelationshipType>;
		onToggle: (type: RelationshipType) => void;
		/** Types that have at least one rendered edge on the current graph,
		 *  computed BEFORE the `enabled` filter is applied. Rows whose type
		 *  is absent here render dimmed + italic so the user sees at a
		 *  glance which connections actually exist in this view. Optional;
		 *  if omitted, all types are treated as present. */
		presentTypes?: Set<RelationshipType>;
		/** Edge-label visibility on the host canvas; the small `Aa` button
		 *  in this header flips it. Optional — when omitted the button is
		 *  hidden so the Legend stays a pure relationship filter for hosts
		 *  that don't render edge labels. */
		edgeLabelsVisible?: boolean;
		onToggleEdgeLabels?: () => void;
	}

	let {
		enabled,
		onToggle,
		presentTypes,
		edgeLabelsVisible,
		onToggleEdgeLabels
	}: Props = $props();
</script>

<div class="legend">
	<div class="legend-header">
		<p class="legend-heading">Relationships</p>
		{#if onToggleEdgeLabels}
			<button
				type="button"
				class="legend-edge-labels"
				class:on={edgeLabelsVisible}
				title={edgeLabelsVisible ? 'Hide edge labels' : 'Show edge labels'}
				aria-label={edgeLabelsVisible ? 'Hide edge labels' : 'Show edge labels'}
				aria-pressed={edgeLabelsVisible}
				onclick={() => onToggleEdgeLabels?.()}
			>Aa</button>
		{/if}
	</div>
	<!-- Shared marker definition for legend swatches that need an
	     arrowhead (mentor_of, caused_by). Color-inheriting via
	     context-stroke so one marker covers every type. -->
	<svg class="legend-defs" aria-hidden="true">
		<defs>
			<marker
				id="legend-arrow"
				viewBox="0 0 10 10"
				refX="10"
				refY="5"
				markerWidth="5"
				markerHeight="5"
				orient="auto"
				markerUnits="strokeWidth"
			>
				<path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
			</marker>
		</defs>
	</svg>
	<ul class="legend-list">
		{#each REL_TYPES as type (type)}
			{@const on = enabled.has(type)}
			{@const present = presentTypes ? presentTypes.has(type) : true}
			{@const style = REL_EDGE_STYLE[type]}
			<li class="legend-row">
				<button
					class="legend-toggle"
					class:on
					class:absent={!present}
					title={!present
						? `${type.replace(/_/g, ' ')} (no edges of this type on the current graph)`
						: on
							? `Hide ${type.replace(/_/g, ' ')}`
							: `Show ${type.replace(/_/g, ' ')}`}
					aria-pressed={on}
					aria-label="Toggle {type.replace(/_/g, ' ')} edges"
					onclick={() => onToggle(type)}
				>
					<!-- Swatch is a 14×8 SVG line that mirrors the on-canvas
					     stroke pattern (solid / dashed / dotted) so the legend
					     becomes self-explanatory: users can match the swatch
					     to the rendered edge by both color and pattern. -->
					<svg class="swatch" viewBox="0 0 14 8" aria-hidden="true">
						<line
							x1="0"
							y1="4"
							x2={style.arrow ? 11 : 14}
							y2="4"
							stroke={REL_COLOR[type]}
							stroke-width={style.width}
							stroke-dasharray={style.dasharray ?? undefined}
							marker-end={style.arrow ? 'url(#legend-arrow)' : undefined}
						/>
					</svg>
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

	.legend-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.legend-heading {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.legend-edge-labels {
		width: 22px;
		height: 22px;
		padding: 0;
		border-radius: 4px;
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		font-family: var(--font-ui);
		font-size: 11px;
		font-weight: 600;
		line-height: 1;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: border-color 0.1s, color 0.1s;
	}
	.legend-edge-labels:hover { border-color: var(--color-accent); color: var(--color-accent); }
	.legend-edge-labels.on { border-color: var(--color-accent); color: var(--color-accent); }

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

	/* Type has zero rendered edges on the current graph. Layered ON TOP
	   of the on/off opacity above so a row that's both ON and ABSENT
	   reads dimmer than a normal ON row, and a row that's both OFF and
	   ABSENT reads dimmer still. Italic + reduced opacity. */
	.legend-toggle.absent {
		opacity: 0.3;
		font-style: italic;
	}

	.legend-toggle:hover {
		background: var(--color-surface);
	}

	.swatch {
		width: 14px;
		height: 8px;
		flex-shrink: 0;
		overflow: visible;
	}

	/* Hidden defs container — width:0 so it doesn't claim layout
	   space, but `display:none` would prevent the marker from
	   resolving via `url(#…)` so we use opacity:0 + tiny dimensions. */
	.legend-defs {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
	}

	.label {
		text-transform: capitalize;
	}
</style>
