import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import MiniDesktop from '../../src/lib/components/landing/MiniDesktop.svelte';
import MiniWindow from '../../src/lib/components/landing/MiniWindow.svelte';
import MiniGraph from '../../src/lib/components/landing/MiniGraph.svelte';
import MiniTimeline from '../../src/lib/components/landing/MiniTimeline.svelte';
import MiniMap from '../../src/lib/components/landing/MiniMap.svelte';

describe('MiniWindow', () => {
  it('renders title text', () => {
    const { getByText } = render(MiniWindow, { title: 'Characters', active: false });
    expect(getByText('Characters')).toBeDefined();
  });

  it('applies active class when active=true', () => {
    const { container } = render(MiniWindow, { title: 'Test', active: true });
    const el = container.querySelector('.mini-window');
    expect(el?.classList.contains('active')).toBe(true);
  });

  it('does not apply active class when active=false', () => {
    const { container } = render(MiniWindow, { title: 'Test', active: false });
    const el = container.querySelector('.mini-window');
    expect(el?.classList.contains('active')).toBe(false);
  });
});

describe('MiniGraph', () => {
  it('renders an SVG with nodes', () => {
    const { container } = render(MiniGraph, { active: true });
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(container.querySelectorAll('circle').length).toBeGreaterThan(0);
  });

  it('has active class when active=true', () => {
    const { container } = render(MiniGraph, { active: true });
    expect(container.querySelector('.mini-graph')?.classList.contains('active')).toBe(true);
  });
});

describe('MiniTimeline', () => {
  it('renders act bars', () => {
    const { getByText } = render(MiniTimeline, { active: true });
    expect(getByText('Act I')).toBeDefined();
    expect(getByText('Act II')).toBeDefined();
    expect(getByText('Act III')).toBeDefined();
  });

  it('has active class when active=true', () => {
    const { container } = render(MiniTimeline, { active: true });
    expect(container.querySelector('.mini-timeline')?.classList.contains('active')).toBe(true);
  });
});

describe('MiniMap', () => {
  it('renders region labels', () => {
    const { getAllByText } = render(MiniMap, { active: true });
    expect(getAllByText('Northern Reach').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('Thornfield').length).toBeGreaterThanOrEqual(1);
  });

  it('has active class when active=true', () => {
    const { container } = render(MiniMap, { active: true });
    expect(container.querySelector('.mini-map')?.classList.contains('active')).toBe(true);
  });
});

describe('MiniDesktop', () => {
  it('renders all four windows', () => {
    const { container } = render(MiniDesktop, {
      activeSections: new Set(['characters', 'graph', 'timeline', 'map'])
    });
    expect(container.querySelectorAll('.mini-window').length).toBe(4);
  });

  it('renders with empty activeSections', () => {
    const { container } = render(MiniDesktop, { activeSections: new Set<string>() });
    expect(container.querySelector('.mini-desktop')).not.toBeNull();
  });
});
