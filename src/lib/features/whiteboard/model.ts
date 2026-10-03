export type Point = { x: number; y: number };
export const ELEMENT_TYPES = ['sticky', 'text', 'rectangle', 'ellipse', 'arrow', 'pen', 'image', 'reference', 'frame', 'connector'] as const;
export type ElementType = typeof ELEMENT_TYPES[number];
export type BoardElement = Point & {
  id: string; type: ElementType; width: number; height: number; color: string;
  text?: string; points?: Point[]; url?: string;
  target?: { kind: 'entity' | 'map' | 'graph'; id: string };
  frameId?: string | null;
  locked?: boolean; opacity?: number;
  fromId?: string; toId?: string; arrow?: 'none' | 'end' | 'both'; dashed?: boolean; bend?: number;
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
    if ((e.locked !== undefined && typeof e.locked !== 'boolean') || (e.opacity !== undefined && !finite(e.opacity, 0, 1)) || (e.dashed !== undefined && typeof e.dashed !== 'boolean')) return 'Invalid element appearance.';
    if (e.type === 'connector') {
      if (!id(e.fromId) || !id(e.toId)) return 'Invalid connector endpoints.';
      if ((e.arrow !== undefined && !['none', 'end', 'both'].includes(e.arrow)) || (e.bend !== undefined && !finite(e.bend, -20000, 20000))) return 'Invalid connector style.';
    }
    if (e.type === 'pen' || e.type === 'arrow' || e.points !== undefined) {
      if (!Array.isArray(e.points) || e.points.length < 2 || e.points.length > 10000 || e.points.some(p => !p || !finite(p.x, -20000, 20000) || !finite(p.y, -20000, 20000))) return 'Invalid stroke.';
      points += e.points.length;
    }
    if (e.type === 'image' && (typeof e.url !== 'string' || !/^\/api\/maps\/file\/[0-9a-f-]{36}_\d{13}\.(png|jpe?g|webp)$/i.test(e.url))) return 'Use an uploaded image.';
    if ((e.type === 'reference' || e.target !== undefined) && (!e.target || !['entity', 'map', 'graph'].includes(e.target.kind) || !id(e.target.id))) return 'Invalid reference.';
  }
  const byId = new Map(d.elements.map(e => [e.id, e]));
  for (const e of d.elements) {
    if (e.frameId && (e.type === 'frame' || byId.get(e.frameId)?.type !== 'frame')) return 'Invalid frame membership.';
    if (e.type === 'connector' && [e.fromId, e.toId].some(endpoint => !endpoint || !byId.has(endpoint) || byId.get(endpoint)?.type === 'connector')) return 'Connectors must join existing board elements.';
  }
  try {
    if (points > 50000 || new TextEncoder().encode(JSON.stringify(d)).length > 2 * 1024 * 1024) return 'This board is full. Start another board to keep drawing.';
  } catch { return 'Invalid board document.'; }
  return null;
}

export function isElementLocked(elements: BoardElement[], element: BoardElement | string): boolean {
  const item = typeof element === 'string' ? elements.find(e => e.id === element) : element;
  return !!(item?.locked || (item?.frameId && elements.find(e => e.id === item.frameId)?.locked));
}

export function moveElements(elements: BoardElement[], selected: string | readonly string[], dx: number, dy: number): BoardElement[] {
  const ids = new Set(typeof selected === 'string' ? [selected] : selected);
  return elements.map(e => e.type !== 'connector' && !isElementLocked(elements, e) && (ids.has(e.id) || !!e.frameId && ids.has(e.frameId)) ? { ...e, x: e.x + dx, y: e.y + dy } : e);
}

export function deleteSelected(elements: BoardElement[], selected: readonly string[]): BoardElement[] {
  const removing = new Set(selected.filter(id => !isElementLocked(elements, id)));
  for (const e of elements) if (e.type === 'connector' && isElementLocked(elements, e)) {
    removing.delete(e.fromId!); removing.delete(e.toId!);
  }
  return elements.filter(e => !removing.has(e.id) && !(e.type === 'connector' && (removing.has(e.fromId!) || removing.has(e.toId!))))
    .map(e => e.frameId && removing.has(e.frameId) ? { ...e, frameId: null } : e);
}

export function duplicateSelected(elements: BoardElement[], selected: readonly string[], dx = 24, dy = 24): { elements: BoardElement[]; selected: string[] } {
  const ids = new Set(selected);
  for (const e of elements) if (e.frameId && ids.has(e.frameId)) ids.add(e.id);
  for (const e of elements) if (e.type === 'connector' && ids.has(e.fromId!) && ids.has(e.toId!)) ids.add(e.id);
  const copied = new Map(elements.filter(e => ids.has(e.id)).map(e => [e.id, crypto.randomUUID()]));
  const copies = elements.filter(e => copied.has(e.id)).map(e => ({ ...e, id: copied.get(e.id)!, x: e.x + dx, y: e.y + dy, locked: false,
    frameId: e.frameId ? copied.get(e.frameId) ?? (isElementLocked(elements, e.frameId) ? null : e.frameId) : e.frameId,
    ...(e.type === 'connector' ? { fromId: copied.get(e.fromId!) ?? e.fromId, toId: copied.get(e.toId!) ?? e.toId } : {})
  }));
  const copyIds = new Set<string>(copied.values());
  // Connectors follow their endpoints, so a lone copy needs a different curve.
  for (const e of copies) if (e.type === 'connector' && !copyIds.has(e.fromId!) && !copyIds.has(e.toId!)) e.bend = (e.bend ?? 0) + ((e.bend ?? 0) > 20000 - 48 ? -48 : 48);
  let result = [...elements, ...copies];
  for (const e of copies) if (!e.frameId || !copyIds.has(e.frameId)) result = assignFrame(result, e.id);
  return { elements: result, selected: selected.flatMap(id => copied.has(id) ? [copied.get(id)!] : []) };
}

export function alignmentRoots(elements: BoardElement[], selected: readonly string[]): BoardElement[] {
  const ids = new Set(selected);
  return elements.filter(e => ids.has(e.id) && e.type !== 'connector' && !isElementLocked(elements, e) && (!e.frameId || !ids.has(e.frameId)));
}

export function alignElements(elements: BoardElement[], selected: readonly string[], alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): BoardElement[] {
  const roots = alignmentRoots(elements, selected);
  if (roots.length < 2) return elements;
  const left = Math.min(...roots.map(e => e.x)), top = Math.min(...roots.map(e => e.y));
  const right = Math.max(...roots.map(e => e.x + e.width)), bottom = Math.max(...roots.map(e => e.y + e.height));
  let aligned = roots.reduce((result, e) => moveElements(result, e.id,
    alignment === 'left' ? left - e.x : alignment === 'right' ? right - e.x - e.width : alignment === 'center' ? (left + right - e.width) / 2 - e.x : 0,
    alignment === 'top' ? top - e.y : alignment === 'bottom' ? bottom - e.y - e.height : alignment === 'middle' ? (top + bottom - e.height) / 2 - e.y : 0
  ), elements);
  for (const e of roots) aligned = assignFrame(aligned, e.id);
  return aligned;
}

export function assignFrame(elements: BoardElement[], selected: string): BoardElement[] {
  const item = elements.find(e => e.id === selected);
  if (!item || item.type === 'frame' || item.type === 'connector' || isElementLocked(elements, item)) return elements;
  const frame = elements.findLast(e => e.type === 'frame' && !e.locked && item.x >= e.x && item.y >= e.y + 28 && item.x + item.width <= e.x + e.width && item.y + item.height <= e.y + e.height);
  return elements.map(e => e.id === selected ? { ...e, frameId: frame?.id ?? null } : e);
}

export function connectorGeometry(connector: BoardElement, elements: BoardElement[]): { path: string; label: Point; start: Point; end: Point; bounds: Point & { width: number; height: number } } | null {
  const from = elements.find(e => e.id === connector.fromId), to = elements.find(e => e.id === connector.toId);
  if (connector.type !== 'connector' || !from || !to || from.type === 'connector' || to.type === 'connector') return null;
  const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 }, b = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  function border(element: BoardElement, center: Point, toward: Point): Point {
    const dx = toward.x - center.x, dy = toward.y - center.y;
    const scale = element.type === 'ellipse' ? 1 / Math.hypot(dx / (element.width / 2), dy / (element.height / 2)) : 1 / Math.max(Math.abs(dx) / (element.width / 2), Math.abs(dy) / (element.height / 2));
    return { x: center.x + dx * scale, y: center.y + dy * scale };
  }
  let start: Point, end: Point, controls: Point[], path: string, label: Point;
  const distance = Math.hypot(b.x - a.x, b.y - a.y), bend = connector.bend ?? 0;
  if (from.id === to.id || distance < 0.001) {
    const direction = bend < 0 ? -1 : 1, radius = Math.max(40, from.width * 0.6, from.height * 0.6) + Math.abs(bend);
    start = border(from, a, { x: a.x + direction, y: a.y }); end = border(to, b, { x: b.x, y: b.y - direction });
    controls = [{ x: start.x + radius * direction, y: start.y - radius * direction }, { x: end.x + radius * direction, y: end.y - radius * direction }];
    path = `M ${start.x} ${start.y} C ${controls[0].x} ${controls[0].y} ${controls[1].x} ${controls[1].y} ${end.x} ${end.y}`;
    label = { x: (start.x + 3 * controls[0].x + 3 * controls[1].x + end.x) / 8, y: (start.y + 3 * controls[0].y + 3 * controls[1].y + end.y) / 8 };
  } else {
    const control = { x: (a.x + b.x) / 2 - (b.y - a.y) / distance * bend, y: (a.y + b.y) / 2 + (b.x - a.x) / distance * bend };
    start = border(from, a, control); end = border(to, b, control); controls = [control];
    path = `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
    label = { x: (start.x + 2 * control.x + end.x) / 4, y: (start.y + 2 * control.y + end.y) / 4 };
  }
  const points = [start, end, ...controls];
  if (connector.text) points.push({ x: label.x - 100, y: label.y - 18 }, { x: label.x + 100, y: label.y + 30 });
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { path, label, start, end, bounds: { x, y, width: Math.max(1, ...points.map(p => p.x - x)), height: Math.max(1, ...points.map(p => p.y - y)) } };
}
