<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { MousePointer2, Hand, StickyNote, Type, Square, Circle, ArrowUpRight, Pencil, Frame, ImagePlus, Link, Undo2, Redo2, Trash2, Copy, Minus, Plus, Maximize, MoreHorizontal, Spline, LockKeyhole } from 'lucide-svelte';
  import { entities } from '$lib/stores/entities.js';
  import { worldMaps, worldMapStore } from '$lib/features/map/store.js';
  import ContextMenu from '$lib/os/ContextMenu.svelte';
  import StoryPicker from './StoryPicker.svelte';
  import { whiteboardCommands, type WhiteboardCommand } from './commands.js';
  import { windowStore } from '$lib/os/windows-store.js';
  import { boardList, boardDrafts, activeBoardId, loadBoards, loadBoard, createBoard, editBoard, saveBoard, undoBoard, deleteBoard, flushBoards, uploadBoardImage } from './store.js';
  import { emptyDocument, moveElements, assignFrame, isElementLocked, deleteSelected, duplicateSelected, alignElements, alignmentRoots, connectorGeometry, type BoardDocument, type BoardElement, type ElementType, type Point } from './model.js';

  const tools = [{ id: 'select', label: 'Select', icon: MousePointer2 }, { id: 'pan', label: 'Pan', icon: Hand }, { id: 'sticky', label: 'Sticky note', icon: StickyNote }, { id: 'text', label: 'Text', icon: Type }, { id: 'rectangle', label: 'Rectangle', icon: Square }, { id: 'ellipse', label: 'Ellipse', icon: Circle }, { id: 'arrow', label: 'Arrow', icon: ArrowUpRight }, { id: 'pen', label: 'Pen', icon: Pencil }, { id: 'frame', label: 'Frame', icon: Frame }];
  let tool = $state('select'), selected = $state<string[]>([]), error = $state('');
  let connectFrom = $state<string | null>(null);
  let marquee = $state<{ x: number; y: number; width: number; height: number } | null>(null);
  let loading = $state(true), busy = $state(false), newName = $state(''), showCreate = $state(false), showReferences = $state(false);
  let referencePosition: Point | null = null;
  let contextMenu = $state<{ x: number; y: number; position: Point } | null>(null);
  let textInput: HTMLTextAreaElement | undefined = $state();
  let nameInput: HTMLInputElement | undefined = $state();
  let picker: { focus: () => void } | undefined = $state();
  let confirmAction = $state<'delete' | 'reload' | null>(null);
  let canvas = $state<SVGSVGElement>(null!), fileInput = $state<HTMLInputElement>(null!);
  let width = $state(800), height = $state(500), preview = $state<BoardDocument | null>(null);
  let gesture: { id: number; start: Point; client: Point; original: BoardDocument; source: BoardDocument; boardId: string; selection: string[]; element?: string; resize?: boolean; additive?: boolean; mode: string } | null = null;
  const board = $derived($activeBoardId ? $boardDrafts[$activeBoardId] : undefined);
  const document = $derived(preview ?? board?.document ?? emptyDocument());
  const selection = $derived(document.elements.filter(e => selected.includes(e.id)));
  const chosen = $derived(selection.length === 1 ? selection[0] : undefined);
  const locked = $derived(!!chosen && isElementLocked(document.elements, chosen));
  const editable = $derived(selection.filter(e => !isElementLocked(document.elements, e)));
  const canAlign = $derived(alignmentRoots(document.elements, selected).length >= 2);
  $effect(() => { if (connectFrom && !document.elements.some(e => e.id === connectFrom && e.type !== 'connector')) connectFrom = null; });
  const lockOwners = $derived([...new Set(selection.flatMap(e => [e.locked ? e.id : '', e.frameId && document.elements.find(f => f.id === e.frameId)?.locked ? e.frameId : '']).filter(Boolean))]);
  const alignments = ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const;
  const ordered = $derived([...document.elements.filter(e => e.type === 'frame'), ...document.elements.filter(e => e.type === 'connector'), ...document.elements.filter(e => e.type !== 'frame' && e.type !== 'connector')]);
  const ready = $derived(!!board && !loading && !busy);
  const actions: WhiteboardCommand[] = $derived([
    { id: 'new-board', name: 'New board', disabled: loading || busy, run: () => { showCreate = true; void tick().then(() => nameInput?.focus()); } },
    ...(['sticky', 'text', 'rectangle', 'ellipse', 'frame'] as const).map(type => ({
      id: `add-${type}`, name: `Add ${type === 'sticky' ? 'sticky note' : type}`, disabled: !ready,
      run: () => { add(type, contextMenu?.position ?? center()); canvas.focus(); }
    })),
    { id: 'add-from-story', name: 'Add from story', disabled: !ready, run: () => { referencePosition = contextMenu?.position ?? center(); showReferences = true; void tick().then(() => picker?.focus()); } },
    { id: 'upload-image', name: 'Upload image', disabled: !ready, run: () => fileInput.click() },
    { id: 'select', name: 'Select elements', disabled: !ready, run: () => { tool = 'select'; connectFrom = null; canvas.focus(); } },
    { id: 'select-all', name: 'Select all elements', disabled: !ready || !document.elements.length, run: () => { selected = document.elements.map(e => e.id); tool = 'select'; canvas.focus(); } },
    { id: 'pan', name: 'Pan canvas', disabled: !ready, run: () => { tool = 'pan'; canvas.focus(); } },
    { id: 'pen', name: 'Draw with pen', disabled: !ready, run: () => { tool = 'pen'; canvas.focus(); } },
    { id: 'arrow', name: 'Draw arrow', disabled: !ready, run: () => { tool = 'arrow'; canvas.focus(); } },
    { id: 'connect', name: 'Connect selected elements', disabled: !ready || selection.length !== 2 || selection.some(e => e.type === 'connector'), run: () => connect(selection[0].id, selection[1].id) },
    { id: 'connector', name: 'Draw attached connector', disabled: !ready, run: () => { connectFrom = chosen?.type !== 'connector' ? chosen?.id ?? null : null; tool = 'connector'; canvas.focus(); } },
    { id: 'edit-text', name: 'Edit text', disabled: !ready || !chosen || locked || ['image', 'pen', 'arrow', 'reference'].includes(chosen.type), run: () => textInput?.focus() },
    { id: 'open-reference', name: 'Open source', disabled: !ready || chosen?.type !== 'reference' || !referenceTarget(chosen), run: () => chosen && openReference(chosen) },
    { id: 'view-connections', name: 'View connections', disabled: !ready || chosen?.target?.kind !== 'entity' || !referenceTarget(chosen), run: () => chosen?.target && windowStore.openFocusedGraph([chosen.target.id]) },
    { id: 'duplicate', name: selection.length > 1 ? 'Duplicate selection' : 'Duplicate element', disabled: !ready || !selection.length, run: () => { duplicate(); canvas.focus(); } },
    { id: 'front', name: 'Bring to front', disabled: !ready || !editable.some(e => !['frame', 'connector'].includes(e.type)), run: () => reorder(true) },
    { id: 'back', name: 'Send to back', disabled: !ready || !editable.some(e => !['frame', 'connector'].includes(e.type)), run: () => reorder(false) },
    { id: 'lock', name: 'Lock selection', disabled: !ready || !editable.length, run: () => setLocked(true) },
    { id: 'unlock', name: 'Unlock selection', disabled: !ready || !lockOwners.length, run: () => setLocked(false) },
    ...alignments.map(alignment => ({ id: `align-${alignment}`, name: `Align ${alignment}`, disabled: !ready || !canAlign, run: () => align(alignment) })),
    { id: 'remove', name: selection.length > 1 ? 'Delete selection' : chosen?.type === 'reference' ? 'Remove from board' : 'Delete element', disabled: !ready || !editable.length, run: () => { remove(); canvas.focus(); } },
    { id: 'undo', name: 'Undo whiteboard change', disabled: !ready || !board?.undo.length, run: () => { if (board) undoBoard(board.id); canvas.focus(); } },
    { id: 'redo', name: 'Redo whiteboard change', disabled: !ready || !board?.redo.length, run: () => { if (board) undoBoard(board.id, true); canvas.focus(); } },
    { id: 'zoom-in', name: 'Zoom in', disabled: !ready, run: () => zoom(1.25) },
    { id: 'zoom-out', name: 'Zoom out', disabled: !ready, run: () => zoom(0.8) },
    { id: 'fit', name: 'Fit board', disabled: !ready, run: fit }
  ]);
  const contextItems = $derived((selection.length
    ? ['open-reference', 'view-connections', 'edit-text', 'connect', 'duplicate', 'front', 'back', 'lock', 'unlock', ...(selection.length > 1 ? alignments.map(a => `align-${a}`) : []), 'remove', 'undo', 'redo']
    : ['add-sticky', 'add-text', 'add-rectangle', 'add-ellipse', 'add-frame', 'add-from-story', 'upload-image', 'select-all', 'undo', 'redo', 'fit'])
    .map(id => actions.find(action => action.id === id)!)
    .filter(action => !['open-reference', 'view-connections', 'edit-text', 'connect', 'lock', 'unlock'].includes(action.id) || !action.disabled)
    .map(action => ({ label: action.name, disabled: action.disabled, onSelect: action.run })));
  $effect(() => { whiteboardCommands.set(actions); });


  function fail(cause: unknown) { error = cause instanceof Error ? cause.message : 'Something went wrong. Try again.'; }
  async function load() {
    loading = true; error = ''; confirmAction = null; contextMenu = null; showReferences = false; selected = []; connectFrom = null;
    try { await Promise.all([loadBoards(), worldMapStore.loadMaps()]); const id = $activeBoardId ?? $boardList[0]?.id; if (id) { await loadBoard(id); activeBoardId.set(id); } }
    catch (cause) { fail(cause); } finally { loading = false; }
  }
  onMount(() => { void load(); });
  onDestroy(() => { whiteboardCommands.set([]); void flushBoards().catch(() => {}); });
  async function switchBoard(id: string) {
    if (loading || busy) return;
    loading = true; confirmAction = null; contextMenu = null; showReferences = false; selected = []; connectFrom = null; marquee = null; preview = null; gesture = null; error = '';
    try { await loadBoard(id); activeBoardId.set(id); } catch (cause) { fail(cause); } finally { loading = false; }
  }
  async function create() {
    if (!newName.trim() || busy) return;
    busy = true; error = '';
    try { await createBoard(newName.trim()); newName = ''; showCreate = false; showReferences = false; contextMenu = null; selected = []; connectFrom = null; confirmAction = null; } catch (cause) { fail(cause); } finally { busy = false; }
  }
  function commit(next: BoardDocument, history = true) {
    if (!board || loading || busy) return false;
    try { editBoard(board.id, $state.snapshot(next), undefined, history); error = ''; return true; } catch (cause) { fail(cause); return false; }
  }
  function updateElement(values: Partial<BoardElement>) {
    if (!chosen || locked) return;
    const moved = moveElements(document.elements, chosen.id, (values.x ?? chosen.x) - chosen.x, (values.y ?? chosen.y) - chosen.y);
    commit({ ...document, elements: assignFrame(moved.map(e => e.id === chosen.id ? { ...e, ...values } : e), chosen.id) });
  }
  function stickyText(color: string) {
    const rgb = color.match(/[0-9a-f]{2}/gi)!.map(v => { const n = parseInt(v, 16) / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? '#000000' : '#ffffff';
  }
  function remove() {
    if (!editable.length) return;
    const elements = deleteSelected(document.elements, selected);
    if (elements.length === document.elements.length) { error = 'Unlock the selected elements and their attached connectors before deleting them.'; return; }
    if (commit({ ...document, elements })) selected = selected.filter(id => elements.some(e => e.id === id));
  }
  function duplicate() {
    if (!selection.length) return;
    const copy = duplicateSelected(document.elements, selected);
    if (commit({ ...document, elements: copy.elements })) selected = copy.selected;
  }
  function setLocked(value: boolean) {
    const ids = value ? editable.map(e => e.id) : lockOwners;
    if (commit({ ...document, elements: document.elements.map(e => ids.includes(e.id) ? { ...e, locked: value } : e) })) canvas.focus();
  }
  function align(alignment: typeof alignments[number]) {
    if (!canAlign) return;
    if (commit({ ...document, elements: alignElements(document.elements, selected, alignment) })) canvas.focus();
  }
  function connect(fromId: string, toId: string) {
    const from = document.elements.find(e => e.id === fromId), to = document.elements.find(e => e.id === toId);
    if (!from || !to || from.type === 'connector' || to.type === 'connector') return;
    const element: BoardElement = { id: crypto.randomUUID(), type: 'connector', fromId, toId, text: '', arrow: 'end', color: '#c8942a', x: from.x, y: from.y, width: 1, height: 1 };
    if (commit({ ...document, elements: [...document.elements, element] })) { selected = [element.id]; connectFrom = null; tool = 'select'; canvas.focus(); }
  }
  function selectElement(id: string, additive = false) {
    if (tool === 'connector') {
      if (document.elements.find(e => e.id === id)?.type === 'connector') return;
      if (connectFrom) connect(connectFrom, id); else { connectFrom = id; selected = [id]; }
    } else selected = additive ? selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id] : [id];
  }
  function bounds(element: BoardElement) {
    return element.type === 'connector' ? connectorGeometry(element, document.elements)?.bounds ?? element : element;
  }
  function point(event: { clientX: number; clientY: number }): Point {
    const rect = canvas.getBoundingClientRect(), v = document.viewport;
    return { x: (event.clientX - rect.left) / v.zoom + v.x, y: (event.clientY - rect.top) / v.zoom + v.y };
  }
  function center(): Point { return { x: document.viewport.x + width / document.viewport.zoom / 2, y: document.viewport.y + height / document.viewport.zoom / 2 }; }
  function add(type: ElementType, position = center()) {
    const element: BoardElement = { id: crypto.randomUUID(), type, ...position, width: type === 'frame' ? 440 : 200, height: type === 'frame' ? 320 : type === 'text' ? 90 : 150, color: '#c8942a', text: type === 'sticky' ? 'New idea' : type === 'frame' ? 'Section' : type === 'text' ? 'Text' : '' };
    let elements = assignFrame([...document.elements, element], element.id);
    if (type === 'frame') for (const item of elements) if (item.type !== 'frame' && !item.frameId) elements = assignFrame(elements, item.id);
    if (commit({ ...document, elements })) { selected = [element.id]; tool = 'select'; }
  }
  function addReferences(targets: Array<NonNullable<BoardElement['target']>>) {
    const position = referencePosition ?? center();
    if (targets.some(target => !referenceTarget({ target }))) { error = 'An item is no longer available. Refresh the story and try again.'; return false; }
    const columns = Math.max(1, Math.min(3, targets.length, Math.floor((width / document.viewport.zoom - 32) / 220)));
    const start = { x: Math.max(document.viewport.x + 16, position.x - (columns * 220 - 20) / 2), y: Math.max(document.viewport.y + 16, position.y - 45) };
    const added: BoardElement[] = targets.map((target, index) => ({ id: crypto.randomUUID(), type: 'reference', target,
      x: start.x + (index % columns) * 220, y: start.y + Math.floor(index / columns) * 110, width: 200, height: 90, color: '#c8942a' }));
    let elements = [...document.elements, ...added];
    for (const item of added) elements = assignFrame(elements, item.id);
    if (!added.length || !commit({ ...document, elements })) return false;
    selected = [added[0].id]; tool = 'select'; return true;
  }
  function closeReferences() { showReferences = false; referencePosition = null; void tick().then(() => canvas?.focus()); }
  function reorder(front: boolean) {
    const moving = editable.filter(e => !['frame', 'connector'].includes(e.type));
    if (!moving.length) return;
    const others = document.elements.filter(e => !moving.includes(e));
    commit({ ...document, elements: front ? [...others, ...moving] : [...moving, ...others] }); canvas.focus();
  }
  function openMenu(event: MouseEvent) {
    event.preventDefault(); event.stopPropagation();
    if (!ready) return;
    finish(true);
    const target = event.target as Element;
    const id = target.closest('[data-element-id]')?.getAttribute('data-element-id');
    if (!id) selected = []; else if (!selected.includes(id)) selected = [id];
    contextMenu = { x: event.clientX, y: event.clientY, position: point(event) };
  }
  function keyboardMenu(target: Element) {
    const element = target.closest('[data-element-id]');
    const id = element?.getAttribute('data-element-id');
    if (id && !selected.includes(id)) selected = [id];
    const rect = (element ?? canvas).getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    contextMenu = { x, y, position: point({ clientX: x, clientY: y }) };
  }
  function down(event: PointerEvent) {
    if (!board || loading || busy || gesture || event.button > 1) return;
    const target = event.target as Element;
    if (target.closest('button')) return;
    event.preventDefault(); canvas.focus();
    const id = target.closest('[data-element-id]')?.getAttribute('data-element-id') ?? undefined;
    const start = point(event), original = structuredClone($state.snapshot(document));
    const initial = { id: event.pointerId, start, client: { x: event.clientX, y: event.clientY }, original, source: board.document, boardId: board.id, selection: [...selected] };
    if (tool === 'pan' || event.button === 1) gesture = { ...initial, mode: 'pan' };
    else if (tool === 'connector') { if (id) selectElement(id); return; }
    else if (tool === 'select') {
      if (!id) {
        gesture = { ...initial, mode: 'marquee', additive: event.shiftKey };
        if (!event.shiftKey) selected = [];
      } else {
        if (event.shiftKey || !selected.includes(id)) selectElement(id, event.shiftKey);
        if (!selected.includes(id) || isElementLocked(document.elements, id) || document.elements.find(e => e.id === id)?.type === 'connector') return;
        gesture = { ...initial, selection: [...selected], element: id, resize: selected.length === 1 && !!target.closest('[data-resize]'), mode: 'move' };
      }
    } else if (tool === 'sticky' || tool === 'text') { add(tool, start); return; }
    else {
      const element: BoardElement = { id: crypto.randomUUID(), type: tool as ElementType, ...start, width: 1, height: 1, color: '#c8942a', ...(tool === 'pen' ? { points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] } : {}), ...(tool === 'frame' ? { text: 'Section' } : {}) };
      selected = [element.id]; preview = { ...original, elements: [...original.elements, element] };
      gesture = { ...initial, element: element.id, mode: tool };
    }
    canvas.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const g = gesture; if (!g || g.id !== event.pointerId) return;
    const dx = (event.clientX - g.client.x) / g.original.viewport.zoom, dy = (event.clientY - g.client.y) / g.original.viewport.zoom;
    if (g.mode === 'pan') preview = { ...g.original, viewport: { ...g.original.viewport, x: g.original.viewport.x - dx, y: g.original.viewport.y - dy } };
    else if (g.mode === 'marquee') {
      if (Math.hypot(event.clientX - g.client.x, event.clientY - g.client.y) < 3) return;
      marquee = { x: Math.min(g.start.x, g.start.x + dx), y: Math.min(g.start.y, g.start.y + dy), width: Math.abs(dx), height: Math.abs(dy) };
      selected = [...new Set([...(g.additive ? g.selection : []), ...document.elements.filter(e => {
        const b = bounds(e); return b.x >= marquee!.x && b.y >= marquee!.y && b.x + b.width <= marquee!.x + marquee!.width && b.y + b.height <= marquee!.y + marquee!.height;
      }).map(e => e.id)])];
    }
    else if (g.mode === 'move') preview = { ...g.original, elements: g.resize ? g.original.elements.map(e => e.id === g.element ? { ...e, width: Math.max(20, e.width + dx), height: Math.max(20, e.height + dy) } : e) : moveElements(g.original.elements, g.selection, dx, dy) };
    else if (preview) preview = { ...preview, elements: preview.elements.map(e => e.id !== g.element ? e : g.mode === 'pen' ? { ...e, points: [...(e.points ?? []), { x: dx, y: dy }].slice(0, 10000), width: Math.max(1, Math.abs(dx)), height: Math.max(1, Math.abs(dy)) } : { ...e, x: Math.min(g.start.x, g.start.x + dx), y: Math.min(g.start.y, g.start.y + dy), width: Math.max(1, Math.abs(dx)), height: Math.max(1, Math.abs(dy)), ...(g.mode === 'arrow' ? { points: [{ x: dx < 0 ? Math.abs(dx) : 0, y: dy < 0 ? Math.abs(dy) : 0 }, { x: dx < 0 ? 0 : dx, y: dy < 0 ? 0 : dy }] } : {}) }) };
  }
  function finish(cancel = false) {
    const g = gesture; if (!g) return;
    let next = preview;
    preview = null; gesture = null; marquee = null;
    if (canvas.hasPointerCapture(g.id)) canvas.releasePointerCapture(g.id);
    if (cancel) { selected = g.selection; return; }
    if (!next || g.mode === 'marquee') return;
    if (board?.id !== g.boardId || board.document !== g.source) { error = 'The board changed during this gesture. Your other changes are kept; try the gesture again.'; return; }
    if (g.mode === 'pen') next = { ...next, elements: next.elements.map(e => {
      if (e.id !== g.element) return e;
      const points = e.points!, x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
      return { ...e, x: e.x + x, y: e.y + y, width: Math.max(1, ...points.map(p => p.x - x)), height: Math.max(1, ...points.map(p => p.y - y)), points: points.map(p => ({ x: p.x - x, y: p.y - y })) };
    }) };
    if (g.mode === 'frame') {
      const frame = next.elements.find(e => e.id === g.element)!;
      next = { ...next, elements: next.elements.map(e => !['frame', 'connector'].includes(e.type) && !isElementLocked(next!.elements, e) && !e.frameId && e.x >= frame.x && e.y >= frame.y + 28 && e.x + e.width <= frame.x + frame.width && e.y + e.height <= frame.y + frame.height ? { ...e, frameId: frame.id } : e) };
    } else for (const id of g.mode === 'move' ? g.selection : g.element ? [g.element] : []) next = { ...next, elements: assignFrame(next.elements, id) };
    commit(next, g.mode !== 'pan'); if (g.mode !== 'pan' && g.mode !== 'move' && g.mode !== 'pen') tool = 'select';
  }
  function zoom(factor: number, anchor = center()) {
    const v = document.viewport, zoom = Math.max(0.1, Math.min(4, v.zoom * factor));
    commit({ ...document, viewport: { zoom, x: anchor.x - (anchor.x - v.x) * v.zoom / zoom, y: anchor.y - (anchor.y - v.y) * v.zoom / zoom } }, false);
  }
  function wheel(event: WheelEvent) {
    if (!board || gesture) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, point(event));
    else commit({ ...document, viewport: { ...document.viewport, x: document.viewport.x + event.deltaX / document.viewport.zoom, y: document.viewport.y + event.deltaY / document.viewport.zoom } }, false);
  }
  function fit() {
    if (!document.elements.length) { commit(emptyDocument(), false); return; }
    const allBounds = document.elements.map(bounds);
    const minX = Math.min(...allBounds.map(e => e.x)) - 40, minY = Math.min(...allBounds.map(e => e.y)) - 40;
    const maxX = Math.max(...allBounds.map(e => e.x + e.width)) + 40, maxY = Math.max(...allBounds.map(e => e.y + e.height)) + 40;
    commit({ ...document, viewport: { x: minX, y: minY, zoom: Math.max(0.1, Math.min(2, width / (maxX - minX), height / (maxY - minY))) } }, false);
  }
  function keydown(event: KeyboardEvent) {
    if (gesture) { finish(event.key === 'Escape'); if (event.key === 'Escape') { event.preventDefault(); return; } }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') contextMenu = null;
    if (busy || loading || (event.target as Element).closest('[role=menu]')) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && ready) { event.preventDefault(); event.stopPropagation(); keyboardMenu(event.target as Element); return; }
    if (event.key === 'Escape') { contextMenu = null; if (gesture) { finish(true); return; } selected = []; connectFrom = null; tool = 'select'; showReferences = false; confirmAction = null; return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && board) { event.preventDefault(); undoBoard(board.id, event.shiftKey); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && event.target === canvas) { event.preventDefault(); selected = document.elements.map(e => e.id); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selection.length) { event.preventDefault(); duplicate(); return; }
    if (event.key === 'Delete' && selection.length) { event.preventDefault(); remove(); }
    if (event.key === 'Enter' && event.target === canvas && ['sticky', 'text', 'rectangle', 'ellipse', 'frame'].includes(tool)) { event.preventDefault(); add(tool as ElementType); }
    if (event.key.startsWith('Arrow') && event.target === canvas) {
      event.preventDefault(); const step = event.shiftKey ? 1 : 10, dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      if (selection.length) {
        if (!editable.some(e => e.type !== 'connector')) return;
        let elements = moveElements(document.elements, selected, dx, dy);
        for (const id of selected) elements = assignFrame(elements, id);
        commit({ ...document, elements });
      } else commit({ ...document, viewport: { ...document.viewport, x: document.viewport.x + dx, y: document.viewport.y + dy } }, false);
    }
  }
  function referenceTarget(e: Pick<BoardElement, 'target'>) { return e.target?.kind === 'map' ? $worldMaps.find(m => m.id === e.target?.id) : $entities.find(n => n.id === e.target?.id); }
  function referenceName(e: BoardElement) { return referenceTarget(e)?.name ?? 'Reference unavailable'; }
  function openReference(e: BoardElement) {
    const target = e.target; if (!target) return;
    if (target.kind === 'map') { if ($worldMaps.some(m => m.id === target.id)) windowStore.openMap(target.id); }
    else if (target.kind === 'graph') { if ($entities.some(n => n.id === target.id)) windowStore.openFocusedGraph([target.id]); }
    else { const entity = $entities.find(n => n.id === target.id); if (entity) windowStore.openForEntity(entity.id, entity.type); }
  }
  async function upload(file?: File) {
    if (!file || !board || busy) return;
    const id = board.id, position = center(); busy = true; error = '';
    try {
      await uploadBoardImage(id, file, position);
    } catch (cause) { fail(cause); } finally { busy = false; if (fileInput) fileInput.value = ''; }
  }
  function download() {
    if (!board) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ name: board.name, document: board.document }, null, 2)], { type: 'application/json' }));
    const link = window.document.createElement('a'); link.href = url; link.download = `${board.name.replace(/[^a-z0-9-]/gi, '_')}.json`; link.click(); URL.revokeObjectURL(url);
  }
  async function confirm() {
    if (!board || busy) return; const id = board.id; busy = true;
    try { if (confirmAction === 'delete') { await deleteBoard(id); } else { await loadBoard(id, true); } selected = []; connectFrom = null; confirmAction = null; }
    catch (cause) { fail(cause); } finally { busy = false; }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Keyboard shortcuts bubble from the canvas and its tools.) -->
<!-- Whiteboard extends the desktop's existing Operate surface: compact tools around a pan/zoom workspace, story-owned material as the focus. Live references open existing editors; frames group without imposing narrative structure. -->
<div class="whiteboard" onkeydown={keydown} role="region" aria-label="Whiteboard workspace">
  <div class="board-bar">
    <label>Board <select aria-label="Current board" value={$activeBoardId ?? ''} disabled={loading || busy} onchange={e => switchBoard(e.currentTarget.value)}><option value="" disabled>Select a board</option>{#each $boardList as entry}<option value={entry.id}>{entry.name}</option>{/each}</select></label>
    <button onclick={() => { showCreate = !showCreate; }} disabled={busy}>New board</button>
    {#if board}<span class="save-state" role="status">{board.saving ? 'Saving…' : board.error ? 'Not saved' : board.dirty ? 'Unsaved changes' : 'Saved'}</span>{/if}
  </div>
  {#if showCreate || (!loading && !$boardList.length)}<form class="create" onsubmit={e => { e.preventDefault(); void create(); }}><label>Name <input aria-label="New board name" bind:this={nameInput} bind:value={newName} maxlength="100" placeholder="Ideas for Act II" required disabled={busy} /></label><button disabled={busy || !newName.trim()}>Create board</button></form>{/if}
  {#if error}<div class="message" role="alert">{error}<button onclick={load} disabled={busy}>Retry loading</button></div>{/if}
  {#if board?.error}<div class="message" role="alert">{board.error} Your draft is kept in this session.<button onclick={() => board && saveBoard(board.id)}>Retry save</button><button onclick={download}>Download draft</button><button onclick={() => { confirmAction = 'reload'; }}>Reload saved board</button></div>{/if}
  {#if confirmAction}<div class="message" role="alert">{confirmAction === 'delete' ? 'Delete this board and all its elements?' : 'Discard this draft and reload the saved board?'}<button onclick={confirm} disabled={busy}>Confirm {confirmAction}</button><button onclick={() => { confirmAction = null; }}>Cancel</button></div>{/if}
  {#if loading}<p role="status">Loading boards…</p>{:else if board}
    <div class="tools" role="toolbar" aria-label="Drawing tools">
      {#each tools as item}<button title={item.label} aria-label={item.label} aria-pressed={tool === item.id} disabled={busy} onclick={() => { tool = item.id; selected = []; connectFrom = null; }}><item.icon size={17} /><span>{item.label}</span></button>{/each}
      <button title="Connect two elements" aria-label="Connector" aria-pressed={tool === 'connector'} disabled={busy} onclick={() => { tool = 'connector'; connectFrom = null; }}><Spline size={17} /><span>Connector</span></button>
      <button title="Upload image" aria-label="Upload image" disabled={busy} onclick={() => fileInput.click()}><ImagePlus size={17} /></button><input class="file" bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onchange={e => upload(e.currentTarget.files?.[0])} />
      <button title="Add from story" aria-label="Add from story" aria-pressed={showReferences} disabled={busy} onclick={() => { if (showReferences) closeReferences(); else { referencePosition = center(); showReferences = true; } }}><Link size={17} /><span>Add from story</span></button>
      <button aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!board.undo.length || busy} onclick={() => board && undoBoard(board.id)}><Undo2 size={17} /></button><button aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!board.redo.length || busy} onclick={() => board && undoBoard(board.id, true)}><Redo2 size={17} /></button>
      <button aria-label="Canvas actions" title="Canvas actions (Shift+F10)" disabled={busy} onclick={e => keyboardMenu(e.currentTarget)}><MoreHorizontal size={17} /></button>
    </div>
    {#if tool === 'connector'}<p class="tool-instruction" role="status">{connectFrom ? 'Choose the second element to connect. Escape cancels.' : 'Choose the first element, then the second. Tab and Enter work too.'}</p>{/if}
    {#if showReferences}<StoryPicker bind:this={picker} disabled={!ready} onAdd={addReferences} onClose={closeReferences} />{/if}
    <div class="stage" bind:clientWidth={width} bind:clientHeight={height}>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (The application canvas supports keyboard drawing, selection, and movement.) -->
      <svg bind:this={canvas} role="application" aria-label="Whiteboard canvas" tabindex="0" viewBox={`${document.viewport.x} ${document.viewport.y} ${width / document.viewport.zoom} ${height / document.viewport.zoom}`} oncontextmenu={openMenu} onpointerdown={down} onpointermove={move} onpointerup={() => finish()} onpointercancel={() => finish(true)} onwheel={wheel}>
        <defs><pattern id="whiteboard-dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--color-border)" /></pattern><marker id="whiteboard-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" /></marker></defs>
        <rect x={document.viewport.x} y={document.viewport.y} width={width / document.viewport.zoom} height={height / document.viewport.zoom} fill="url(#whiteboard-dots)" />
        {#each ordered as element (element.id)}
          {@const geometry = element.type === 'connector' ? connectorGeometry(element, document.elements) : null}
          {@const box = geometry?.bounds ?? { x: 0, y: 0, width: element.width, height: element.height }}
          {@const isLocked = isElementLocked(document.elements, element)}
          <g data-element-id={element.id} data-locked={isLocked || undefined} transform={`translate(${geometry ? 0 : element.x},${geometry ? 0 : element.y})`} role="button" tabindex="0" aria-pressed={selected.includes(element.id)} aria-describedby={isLocked ? `locked-${element.id}` : undefined} aria-label={`${element.type}: ${element.type === 'reference' ? referenceName(element) : element.text || element.type}`} onkeydown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectElement(element.id, e.shiftKey); canvas.focus(); } }} ondblclick={() => { if (element.type === 'reference') openReference(element); else selected = [element.id]; }}>
            {#if isLocked}<desc id={`locked-${element.id}`}>Locked</desc>{/if}
            <g opacity={element.opacity ?? 1}>
            {#if geometry}
              <path d={geometry.path} fill="none" stroke="transparent" stroke-width="16" />
              <path data-connector-id={element.id} d={geometry.path} fill="none" stroke={element.color} stroke-width="2" stroke-dasharray={element.dashed ? '6 4' : undefined} marker-start={element.arrow === 'both' ? 'url(#whiteboard-arrow)' : undefined} marker-end={element.arrow !== 'none' ? 'url(#whiteboard-arrow)' : undefined} />
              {#if element.text}<foreignObject x={geometry.label.x - 100} y={geometry.label.y - 18} width="200" height="48"><div class="connector-label"><span>{element.text}</span></div></foreignObject>{/if}
            {:else if element.type === 'ellipse'}<ellipse cx={element.width / 2} cy={element.height / 2} rx={element.width / 2} ry={element.height / 2} fill="transparent" stroke={element.color} stroke-width="2" />
            {:else if element.type === 'pen' || element.type === 'arrow'}<polyline points={(element.points ?? [{ x: 0, y: element.height }, { x: element.width, y: 0 }]).map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={element.color} stroke-width="3" stroke-linecap="round" stroke-linejoin="round" marker-end={element.type === 'arrow' ? 'url(#whiteboard-arrow)' : undefined} />
            {:else if element.type === 'image'}<image href={element.url} width={element.width} height={element.height} preserveAspectRatio="xMidYMid meet" />
            {:else}<rect width={element.width} height={element.height} rx={element.type === 'sticky' ? 2 : 4} fill={element.type === 'sticky' ? element.color : element.type === 'reference' ? 'var(--color-surface-2)' : 'transparent'} stroke={element.type === 'text' ? 'none' : element.color} stroke-width="1" stroke-dasharray={element.type === 'frame' || element.dashed ? '6 4' : undefined} />{/if}
            {#if ['sticky', 'text', 'frame', 'rectangle', 'ellipse', 'reference'].includes(element.type)}<foreignObject x="10" y="6" width={Math.max(1, element.width - 20)} height={element.type === 'frame' ? 24 : Math.max(1, element.height - 12)}><div class="element-text" class:sticky={element.type === 'sticky'} style:color={element.type === 'sticky' ? stickyText(element.color) : 'var(--color-text)'}>{#if element.type === 'reference'}<button class="reference-link" disabled={!referenceTarget(element)} onpointerdown={e => e.stopPropagation()} onclick={() => openReference(element)}>{referenceName(element)}</button><small>{element.target?.kind === 'graph' ? 'Focused graph' : element.target?.kind === 'map' ? 'Map' : $entities.find(e => e.id === element.target?.id)?.type ?? 'Deleted entity'}</small>{:else}{element.text}{/if}</div></foreignObject>{/if}
            </g>
            {#if selected.includes(element.id)}<rect class="selection" x={box.x - 3} y={box.y - 3} width={box.width + 6} height={box.height + 6} fill="none" stroke="var(--color-focus)" stroke-width="2" pointer-events="none" />{#if selected.length === 1 && !isLocked && !['pen', 'arrow', 'connector'].includes(element.type)}<rect data-resize="true" x={element.width - 5} y={element.height - 5} width="10" height="10" fill="var(--color-focus)" style="cursor:nwse-resize" />{/if}{/if}
            {#if isLocked && element.type !== 'connector'}<g transform={`translate(${box.x + box.width - 15},${box.y + 3})`} pointer-events="none"><LockKeyhole size={12} color={element.type === 'sticky' ? stickyText(element.color) : 'var(--color-text)'} /></g>{/if}
          </g>
        {/each}
        {#if marquee}<rect data-marquee x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} fill="var(--color-focus)" fill-opacity="0.1" stroke="var(--color-focus)" stroke-width={1 / document.viewport.zoom} pointer-events="none" />{/if}
      </svg>
      {#if !document.elements.length}<div class="empty"><strong>Room for unfinished ideas</strong><p>Choose a sticky note, draw a shape, or add a live reference. Drag a frame around related ideas to move them together.</p></div>{/if}
      {#if selection.length}<aside aria-label={chosen ? 'Selected element' : 'Selected elements'}>
        <strong>{chosen ? chosen.type === 'reference' ? referenceName(chosen) : 'Selected element' : `${selection.length} selected`}</strong>
        {#if selection.length !== editable.length}<small>{selection.length - editable.length} locked. Unlock to edit or move.</small>{/if}
        {#if editable.length}<button onclick={() => setLocked(true)}>Lock selection</button>{/if}
        {#if lockOwners.length}<button onclick={() => setLocked(false)}>Unlock selection</button>{/if}
        {#if chosen}<fieldset disabled={locked}>
          {#if !['image', 'pen', 'arrow', 'reference'].includes(chosen.type)}<label>{chosen.type === 'connector' ? 'Label' : 'Text'}<textarea bind:this={textInput} aria-label="Element text" value={chosen.text ?? ''} maxlength="10000" oninput={e => updateElement({ text: e.currentTarget.value })}></textarea></label>{/if}
          <label>Color<input type="color" value={chosen.color} onchange={e => updateElement({ color: e.currentTarget.value })} /></label>
          {#if chosen.type === 'connector'}
            {#each ['fromId', 'toId'] as endpoint}<label>{endpoint === 'fromId' ? 'From' : 'To'}<select aria-label={`Connector ${endpoint === 'fromId' ? 'from' : 'to'}`} value={chosen[endpoint as 'fromId' | 'toId']} onchange={e => updateElement({ [endpoint]: e.currentTarget.value })}>{#each document.elements.filter(e => e.type !== 'connector') as target}<option value={target.id}>{target.type === 'reference' ? referenceName(target) : target.text || target.type}</option>{/each}</select></label>{/each}
            <label>Arrow direction<select aria-label="Arrow direction" value={chosen.arrow ?? 'end'} onchange={e => updateElement({ arrow: e.currentTarget.value as 'none' | 'end' | 'both' })}><option value="none">None</option><option value="end">To endpoint</option><option value="both">Both ends</option></select></label>
            <label class="inline"><input type="checkbox" checked={chosen.dashed ?? false} onchange={e => updateElement({ dashed: e.currentTarget.checked })} />Dashed</label>
            <label>Curve<input aria-label="Connector curve" type="number" min="-2000" max="2000" value={chosen.bend ?? 0} onchange={e => updateElement({ bend: e.currentTarget.valueAsNumber })} /></label>
          {:else}<div class="dimensions">{#each (['pen', 'arrow'].includes(chosen.type) ? ['x', 'y'] : ['x', 'y', 'width', 'height']) as field}<label>{field}<input aria-label={`Element ${field}`} type="number" step="any" value={Number(chosen[field as 'x' | 'y' | 'width' | 'height'].toFixed(1))} onchange={e => updateElement({ [field]: e.currentTarget.valueAsNumber })} /></label>{/each}</div>{/if}
        </fieldset>{/if}
        {#if selection.length > 1}
          <label>Align<select aria-label="Align selection" disabled={!canAlign} value="" onchange={e => { align(e.currentTarget.value as typeof alignments[number]); e.currentTarget.value = ''; }}><option value="" disabled>Choose alignment</option>{#each alignments as alignment}<option value={alignment}>{alignment[0].toUpperCase() + alignment.slice(1)}</option>{/each}</select></label>
          {#if selection.length === 2 && selection.every(e => e.type !== 'connector')}<button onclick={() => connect(selection[0].id, selection[1].id)}>Connect selected elements</button>{/if}
        {/if}
        <div><button aria-label={chosen ? 'Duplicate element' : 'Duplicate selection'} title="Duplicate (Ctrl/Cmd+D)" onclick={duplicate}><Copy size={16} /></button><button aria-label={chosen ? chosen.type === 'reference' ? 'Remove from board' : 'Delete element' : 'Delete selection'} title={chosen?.type === 'reference' ? 'Remove from board' : 'Delete'} disabled={!editable.length} onclick={remove}><Trash2 size={16} /></button></div>
      </aside>{/if}
    </div>
    <footer><label>Name <input aria-label="Board name" value={board.name} maxlength="100" onchange={e => { if (board && e.currentTarget.value.trim()) editBoard(board.id, board.document, e.currentTarget.value.trim()); }} /></label><button aria-label="Delete board" title="Delete board" onclick={() => { confirmAction = 'delete'; }}><Trash2 size={15} /></button><span class="hint">Shift-click or drag to select · Scroll to pan · Ctrl/⌘ scroll to zoom</span><button aria-label="Zoom out" onclick={() => zoom(0.8)}><Minus size={16} /></button><output aria-label="Zoom">{Math.round(document.viewport.zoom * 100)}%</output><button aria-label="Zoom in" onclick={() => zoom(1.25)}><Plus size={16} /></button><button aria-label="Fit board" title="Fit board" onclick={fit}><Maximize size={16} /></button></footer>
  {:else if !showCreate && $boardList.length}<p>Select a board to keep working.</p>{/if}
  {#if contextMenu}<ContextMenu items={contextItems} x={contextMenu.x} y={contextMenu.y} onClose={() => { contextMenu = null; }} />{/if}
</div>

<style>
  .whiteboard { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--color-text); background: var(--color-surface); font: 12px var(--font-ui); overflow: auto; }
  button, input, select, textarea { font: inherit; color: var(--color-text); border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-surface-2); }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 30px; padding: 5px 8px; cursor: pointer; }
  button:hover { background: var(--color-surface); }
  button:disabled { opacity: 0.45; cursor: default; }
  button[aria-pressed='true'] { outline: 2px solid var(--color-focus); outline-offset: -2px; }
  input, select, textarea { padding: 5px 7px; min-width: 0; }
  label { display: flex; align-items: center; gap: 6px; }
  .board-bar, .create, .tools, footer { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--color-border); }
  .board-bar select { max-width: 240px; }
  .save-state { margin-left: auto; color: var(--color-text-muted); }
  .tools { gap: 3px; }
  .tools button span { font-size: 11px; }
  .file { display: none; }
  .message { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; color: var(--color-danger); }
  .stage { position: relative; flex: 1; min-height: 160px; overflow: hidden; background: var(--color-desktop); }
  svg[role='application'] { display: block; width: 100%; height: 100%; touch-action: none; }
  .element-text { font: 15px var(--font-ui); white-space: pre-wrap; overflow-wrap: anywhere; height: 100%; overflow: hidden; }
  .element-text.sticky { font-weight: 500; }
  .element-text small { display: block; font-size: 11px; }
  .reference-link { display: block; border: 0; padding: 0; background: transparent; text-align: left; font: 18px var(--font-display); text-decoration: underline; text-underline-offset: 3px; }
  aside { position: absolute; top: 10px; right: 10px; width: 180px; max-height: calc(100% - 20px); overflow: auto; scrollbar-color: var(--color-border) var(--color-surface); padding: 10px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 4px; display: flex; flex-direction: column; gap: 9px; }
  aside label { flex-direction: column; align-items: stretch; }
  aside textarea { min-height: 70px; resize: vertical; }
  fieldset { display: flex; flex-direction: column; gap: 9px; min-width: 0; border: 0; margin: 0; padding: 0; }
  fieldset:disabled { opacity: 0.55; }
  aside .inline { flex-direction: row; align-items: center; }
  input[type='checkbox'] { accent-color: var(--color-focus); }
  .tool-instruction { margin: 0; padding: 6px 10px; color: var(--color-text-muted); }
  .connector-label { text-align: center; font: 12px var(--font-ui); overflow: hidden; max-height: 48px; overflow-wrap: anywhere; }
  .connector-label span { display: inline-block; max-width: 100%; padding: 3px 5px; color: var(--color-text); background: var(--color-desktop); border-radius: 3px; }
  .dimensions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .dimensions input { width: 100%; box-sizing: border-box; }
  small { color: var(--color-text-muted); }
  .empty { position: absolute; inset: 35% auto auto 8%; width: min(360px, 70%); pointer-events: none; }
  .empty strong { font: 22px var(--font-display); }
  .empty p { color: var(--color-text-muted); line-height: 1.6; }
  footer { border-bottom: 0; border-top: 1px solid var(--color-border); }
  footer input { width: 120px; }
  .hint { flex: 1; color: var(--color-text-muted); font-size: 11px; }
  output { font-variant-numeric: tabular-nums; }
</style>
