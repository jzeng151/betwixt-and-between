import type { BoardElement } from './model.js';

export type GraphCapture = {
  background: string;
  nodes: Array<{ id: string; name: string; type: string; x: number; y: number; width: number; height: number;
    color: string; fill: string; border: string; opacity: number; dashed: boolean; font: string; typeFont: string; typeColor: string }>;
  edges: Array<{ id: string; fromId: string; toId: string; x1: number; y1: number; x2: number; y2: number;
    color: string; opacity: number; width: number; dash: string; arrow: boolean; label: string; labelOpacity: number; labelSize: number }>;
};

export function graphBounds(graph: GraphCapture, context?: CanvasRenderingContext2D) {
  if (!graph.nodes.length) throw new Error('This graph has no visible entities to add.');
  const xs = graph.nodes.flatMap(n => [n.x, n.x + n.width]), ys = graph.nodes.flatMap(n => [n.y, n.y + n.height]);
  if (context) for (const edge of graph.edges) {
    const margin = edge.width * (edge.arrow ? 6 : 1);
    xs.push(edge.x1 - margin, edge.x1 + margin, edge.x2 - margin, edge.x2 + margin);
    ys.push(edge.y1 - margin, edge.y1 + margin, edge.y2 - margin, edge.y2 + margin);
    if (!edge.label) continue;
    context.font = `${edge.labelSize}px Inter, Segoe UI, sans-serif`;
    const text = context.measureText(edge.label), x = (edge.x1 + edge.x2) / 2, y = (edge.y1 + edge.y2) / 2 - edge.labelSize / 2;
    xs.push(x - text.width / 2, x + text.width / 2);
    ys.push(y - text.actualBoundingBoxAscent, y + text.actualBoundingBoxDescent);
  }
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function graphCaption(name: string, options: { time: number | null; hardFilter: boolean; hideOutOfScope: boolean; ghostTrails: boolean; labels: boolean; relationships: string[] }) {
  return `${name}. Story time: ${options.time === null ? 'all times' : options.time.toFixed(3).replace(/\.?0+$/, '')}. ${options.hardFilter ? 'Hide' : 'Dim'} inactive edges; ${options.hideOutOfScope ? 'hide' : 'dim'} inactive entities; ghost trails ${options.ghostTrails ? 'on' : 'off'}; labels ${options.labels ? 'on' : 'off'}. Relationship filters: ${options.relationships.length ? options.relationships.map(r => r.replace(/_/g, ' ')).join(', ') : 'none'}. Captured ${new Date().toISOString()}.`.slice(0, 10000);
}

// Canvas resolves themed CSS colors before they reach the document's hex-only validator.
export function colorHex(color: string) {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  return '#' + [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('');
}

export function graphDiagram(graph: GraphCapture, name: string, caption: string): BoardElement[] {
  const bounds = graphBounds(graph), frameId = crypto.randomUUID();
  const scale = 2;
  const nodes: BoardElement[] = graph.nodes.map(n => ({ id: crypto.randomUUID(), type: 'reference',
    target: { kind: 'entity', id: n.id }, x: 32 + (n.x - bounds.x) * scale, y: 60 + (n.y - bounds.y) * scale,
    width: Math.max(200, n.width), height: Math.max(70, n.height), color: n.color,
    opacity: n.opacity, dashed: n.dashed, frameId }));
  const nodeIds = new Map(graph.nodes.map((n, i) => [n.id, nodes[i].id]));
  const pairs = new Map<string, GraphCapture['edges']>();
  for (const edge of graph.edges) {
    const key = [edge.fromId, edge.toId].sort().join('|');
    pairs.set(key, [...(pairs.get(key) ?? []), edge]);
  }
  const edges: BoardElement[] = graph.edges.filter(e => nodeIds.has(e.fromId) && nodeIds.has(e.toId)).map((edge): BoardElement => {
    const peers = pairs.get([edge.fromId, edge.toId].sort().join('|'))!.toSorted((a, b) => a.id.localeCompare(b.id));
    const offset = (peers.findIndex(e => e.id === edge.id) - (peers.length - 1) / 2) * 48;
    return { id: crypto.randomUUID(), type: 'connector', fromId: nodeIds.get(edge.fromId)!, toId: nodeIds.get(edge.toId)!,
      x: 0, y: 0, width: 1, height: 1, color: edge.color, opacity: edge.opacity,
      text: edge.label, arrow: edge.arrow ? 'end' : 'none', dashed: !!edge.dash,
      bend: edge.fromId < edge.toId ? offset : -offset, frameId };
  });
  const width = Math.max(440, ...nodes.map(n => n.x + n.width + 32));
  const bottom = Math.max(...nodes.map(n => n.y + n.height)) + 24;
  const captionHeight = Math.max(116, Math.ceil(caption.length / ((width - 48) / 8)) * 22);
  if (width > 20000 || bottom + captionHeight + 24 > 20000) throw new Error('This graph is too spread out for an editable diagram. Move its nodes closer or send a snapshot.');
  return [{ id: frameId, type: 'frame', x: 0, y: 0, width, height: bottom + captionHeight + 24, color: '#c8942a', text: name },
    ...edges, ...nodes,
    { id: crypto.randomUUID(), type: 'text', x: 24, y: bottom, width: width - 48, height: captionHeight, color: '#c8942a', text: caption, frameId }];
}

export async function graphSnapshot(graph: GraphCapture, name: string): Promise<File> {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not create a graph image. Try the editable diagram instead.');
  const bounds = graphBounds(graph, ctx), padding = 32;
  const width = bounds.width + padding * 2, height = bounds.height + padding * 2;
  // ponytail: cap raster exports at 4,096px per side; tiled export if larger prints are needed.
  const scale = Math.min(2, 4096 / width, 4096 / height);
  canvas.width = Math.max(1, Math.ceil(width * scale)); canvas.height = Math.max(1, Math.ceil(height * scale));
  ctx.scale(scale, scale); ctx.fillStyle = graph.background; ctx.fillRect(0, 0, width, height);
  ctx.translate(padding - bounds.x, padding - bounds.y);
  for (const e of graph.edges) {
    ctx.globalAlpha = e.opacity; ctx.strokeStyle = e.color; ctx.fillStyle = e.color; ctx.lineWidth = e.width;
    ctx.setLineDash(e.dash ? e.dash.split(/[ ,]+/).map(Number) : []);
    ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke();
    if (e.arrow) {
      const angle = Math.atan2(e.y2 - e.y1, e.x2 - e.x1), size = 6 * e.width;
      ctx.save(); ctx.translate(e.x2, e.y2); ctx.rotate(angle); ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(-size, -size / 2); ctx.lineTo(-size, size / 2); ctx.closePath(); ctx.fill(); ctx.restore();
    }
    if (e.label) {
      ctx.globalAlpha = e.labelOpacity; ctx.font = `${e.labelSize}px Inter, Segoe UI, sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(e.label, (e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2 - e.labelSize / 2);
    }
  }
  for (const n of graph.nodes) {
    ctx.globalAlpha = n.opacity; ctx.fillStyle = n.fill; ctx.strokeStyle = n.border; ctx.lineWidth = 1.5;
    ctx.setLineDash(n.dashed ? [5, 3] : []); ctx.beginPath(); ctx.roundRect(n.x, n.y, n.width, n.height, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = n.color; ctx.font = n.font; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(n.name, n.x + 10, n.y + n.height / 2);
    const nameWidth = ctx.measureText(n.name).width;
    ctx.font = n.typeFont; ctx.fillStyle = n.typeColor;
    ctx.fillText(n.type, n.x + 16 + nameWidth, n.y + n.height / 2);
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not create the graph image. Try again.')), 'image/png'));
  return new File([blob], `${name.replace(/[^a-z0-9_-]/gi, '_')}.png`, { type: 'image/png' });
}
