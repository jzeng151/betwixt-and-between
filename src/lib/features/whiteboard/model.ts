export type Point = { x: number; y: number };
export const ELEMENT_TYPES = ['sticky', 'text', 'rectangle', 'ellipse', 'arrow', 'pen', 'image', 'reference', 'frame'] as const;
export type ElementType = typeof ELEMENT_TYPES[number];
export type BoardElement = Point & {
  id: string; type: ElementType; width: number; height: number; color: string;
  text?: string; points?: Point[]; url?: string;
  target?: { kind: 'entity' | 'map' | 'graph'; id: string };
  frameId?: string | null;
};
export type BoardDocument = { version: 1; elements: BoardElement[]; viewport: Point & { zoom: number } };
export type Board = { id: string; name: string; revision: number; document: BoardDocument };
export const emptyDocument = (): BoardDocument => ({ version: 1, elements: [], viewport: { x: 0, y: 0, zoom: 1 } });
const finite = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const id = (s: unknown) => typeof s === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);

export function documentError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'Invalid board document.';
  const d = value as BoardDocument;
  if (d.version !== 1 || !Array.isArray(d.elements) || d.elements.length > 1000) return 'A board supports up to 1,000 elements.';
  if (!d.viewport || !finite(d.viewport.x, -1e6, 1e6) || !finite(d.viewport.y, -1e6, 1e6) || !finite(d.viewport.zoom, 0.1, 4)) return 'Invalid viewport.';
  const ids = new Set<string>();
  let points = 0;
  for (const e of d.elements) {
    if (!e || !id(e.id) || ids.has(e.id) || !ELEMENT_TYPES.includes(e.type)) return 'Invalid or duplicate element.';
    ids.add(e.id);
    if (e.frameId !== undefined && e.frameId !== null && !id(e.frameId)) return 'Invalid frame membership.';
    if (!finite(e.x, -1e6, 1e6) || !finite(e.y, -1e6, 1e6) || !finite(e.width, 1, 20000) || !finite(e.height, 1, 20000)) return 'Invalid element bounds.';
    if (typeof e.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(e.color)) return 'Invalid element color.';
    if (e.text !== undefined && (typeof e.text !== 'string' || e.text.length > 10000)) return 'Keep element text under 10,000 characters.';
    if (e.type === 'pen' || e.type === 'arrow' || e.points !== undefined) {
      if (!Array.isArray(e.points) || e.points.length < 2 || e.points.length > 10000 || e.points.some(p => !p || !finite(p.x, -20000, 20000) || !finite(p.y, -20000, 20000))) return 'Invalid stroke.';
      points += e.points.length;
    }
    if (e.type === 'image' && (typeof e.url !== 'string' || !/^\/api\/maps\/file\/[0-9a-f-]{36}_\d{13}\.(png|jpe?g|webp)$/i.test(e.url))) return 'Use an uploaded image.';
    if ((e.type === 'reference' || e.target !== undefined) && (!e.target || !['entity', 'map', 'graph'].includes(e.target.kind) || !id(e.target.id))) return 'Invalid reference.';
  }
  for (const e of d.elements) if (e.frameId && (e.type === 'frame' || !d.elements.some(f => f.id === e.frameId && f.type === 'frame'))) return 'Invalid frame membership.';
  if (points > 50000 || new TextEncoder().encode(JSON.stringify(d)).length > 2 * 1024 * 1024) return 'This board is full. Start another board to keep drawing.';
  return null;
}

export function moveElements(elements: BoardElement[], selected: string, dx: number, dy: number): BoardElement[] {
  return elements.map(e => e.id === selected || e.frameId === selected ? { ...e, x: e.x + dx, y: e.y + dy } : e);
}

export function assignFrame(elements: BoardElement[], selected: string): BoardElement[] {
  const item = elements.find(e => e.id === selected);
  if (!item || item.type === 'frame') return elements;
  const frame = elements.findLast(e => e.type === 'frame' && item.x >= e.x && item.y >= e.y + 28 && item.x + item.width <= e.x + e.width && item.y + item.height <= e.y + e.height);
  return elements.map(e => e.id === selected ? { ...e, frameId: frame?.id ?? null } : e);
}
