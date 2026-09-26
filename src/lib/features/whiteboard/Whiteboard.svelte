<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { MousePointer2, Hand, StickyNote, Type, Square, Circle, ArrowUpRight, Pencil, Frame, ImagePlus, Link, Undo2, Redo2, Trash2, Copy, Minus, Plus, Maximize } from 'lucide-svelte';
  import { entities } from '$lib/stores/entities.js';
  import { worldMaps, worldMapStore } from '$lib/features/map/store.js';
  import { windowStore } from '$lib/os/windows-store.js';
  import { boardList, boardDrafts, activeBoardId, loadBoards, loadBoard, createBoard, editBoard, saveBoard, undoBoard, deleteBoard, flushBoards, uploadBoardImage } from './store.js';
  import { emptyDocument, moveElements, assignFrame, type BoardDocument, type BoardElement, type ElementType, type Point } from './model.js';

  const tools = [{ id: 'select', label: 'Select', icon: MousePointer2 }, { id: 'pan', label: 'Pan', icon: Hand }, { id: 'sticky', label: 'Sticky note', icon: StickyNote }, { id: 'text', label: 'Text', icon: Type }, { id: 'rectangle', label: 'Rectangle', icon: Square }, { id: 'ellipse', label: 'Ellipse', icon: Circle }, { id: 'arrow', label: 'Arrow', icon: ArrowUpRight }, { id: 'pen', label: 'Pen', icon: Pencil }, { id: 'frame', label: 'Frame', icon: Frame }];
  let tool = $state('select'), selected = $state<string | null>(null), error = $state('');
  let loading = $state(true), busy = $state(false), newName = $state(''), showCreate = $state(false), showReferences = $state(false), referenceQuery = $state('');
  let confirmAction = $state<'delete' | 'reload' | null>(null);
  let canvas = $state<SVGSVGElement>(null!), fileInput = $state<HTMLInputElement>(null!);
  let width = $state(800), height = $state(500), preview = $state<BoardDocument | null>(null);
  let gesture: { id: number; start: Point; client: Point; original: BoardDocument; element?: string; resize?: boolean; mode: string } | null = null;
  const board = $derived($activeBoardId ? $boardDrafts[$activeBoardId] : undefined);
  const document = $derived(preview ?? board?.document ?? emptyDocument());
  const chosen = $derived(document.elements.find(e => e.id === selected));
  const ordered = $derived([...document.elements.filter(e => e.type === 'frame'), ...document.elements.filter(e => e.type !== 'frame')]);
  const references = $derived([
    ...$entities.filter(e => e.type !== 'Note' || !e.data.isFolder).flatMap(e => [{ kind: 'entity' as const, id: e.id, name: e.name, label: e.type }, { kind: 'graph' as const, id: e.id, name: e.name, label: 'Focused graph' }]),
    ...$worldMaps.map(m => ({ kind: 'map' as const, id: m.id, name: m.name, label: 'Map' }))
  ].filter(r => `${r.name} ${r.label}`.toLowerCase().includes(referenceQuery.toLowerCase())).slice(0, 40));

  function fail(cause: unknown) { error = cause instanceof Error ? cause.message : 'Something went wrong. Try again.'; }
  async function load() {
    loading = true; error = ''; confirmAction = null;
    try { await Promise.all([loadBoards(), worldMapStore.loadMaps()]); const id = $activeBoardId ?? $boardList[0]?.id; if (id) { await loadBoard(id); activeBoardId.set(id); } }
    catch (cause) { fail(cause); } finally { loading = false; }
  }
  onMount(() => { void load(); });
  onDestroy(() => { void flushBoards().catch(() => {}); });
  async function switchBoard(id: string) {
    if (loading || busy) return;
    loading = true; confirmAction = null; selected = null; preview = null; gesture = null; error = '';
    try { await loadBoard(id); activeBoardId.set(id); } catch (cause) { fail(cause); } finally { loading = false; }
  }
  async function create() {
    if (!newName.trim() || busy) return;
    busy = true; error = '';
    try { await createBoard(newName.trim()); newName = ''; showCreate = false; selected = null; confirmAction = null; } catch (cause) { fail(cause); } finally { busy = false; }
  }
  function commit(next: BoardDocument, history = true) {
    if (!board || loading || busy) return;
    try { editBoard(board.id, $state.snapshot(next), undefined, history); error = ''; } catch (cause) { fail(cause); }
  }
  function updateElement(values: Partial<BoardElement>) {
    if (!chosen) return;
    const moved = moveElements(document.elements, chosen.id, (values.x ?? chosen.x) - chosen.x, (values.y ?? chosen.y) - chosen.y);
    commit({ ...document, elements: assignFrame(moved.map(e => e.id === selected ? { ...e, ...values } : e), chosen.id) });
  }
  function stickyText(color: string) {
    const rgb = color.match(/[0-9a-f]{2}/gi)!.map(v => { const n = parseInt(v, 16) / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? '#000000' : '#ffffff';
  }
  function remove() {
    if (!chosen) return;
    commit({ ...document, elements: document.elements.filter(e => e.id !== selected).map(e => e.frameId === selected ? { ...e, frameId: null } : e) }); selected = null;
  }
  function duplicate() {
    if (!chosen) return;
    const id = crypto.randomUUID();
    const copies = document.elements.filter(e => e.id === chosen.id || e.frameId === chosen.id).map(e => ({ ...e, id: e.id === chosen.id ? id : crypto.randomUUID(), x: e.x + 24, y: e.y + 24, frameId: e.frameId === chosen.id ? id : e.frameId }));
    commit({ ...document, elements: assignFrame([...document.elements, ...copies], id) }); selected = id;
  }
  function point(event: { clientX: number; clientY: number }): Point {
    const rect = canvas.getBoundingClientRect(), v = document.viewport;
    return { x: (event.clientX - rect.left) / v.zoom + v.x, y: (event.clientY - rect.top) / v.zoom + v.y };
  }
  function center(): Point { return { x: document.viewport.x + width / document.viewport.zoom / 2, y: document.viewport.y + height / document.viewport.zoom / 2 }; }
  function add(type: ElementType, position = center(), extra: Partial<BoardElement> = {}) {
    const element: BoardElement = { id: crypto.randomUUID(), type, ...position, width: type === 'frame' ? 440 : 200, height: type === 'frame' ? 320 : type === 'text' || type === 'reference' ? 90 : 150, color: '#c8942a', text: type === 'sticky' ? 'New idea' : type === 'frame' ? 'Section' : type === 'text' ? 'Text' : '', ...extra };
    commit({ ...document, elements: assignFrame([...document.elements, element], element.id) }); selected = element.id; tool = 'select'; return element;
  }
  function down(event: PointerEvent) {
    if (!board || loading || busy || event.button > 1) return;
    const target = event.target as Element;
    if (target.closest('button')) return;
    event.preventDefault(); canvas.focus();
    const id = target.closest('[data-element-id]')?.getAttribute('data-element-id') ?? undefined;
    const start = point(event), original = structuredClone($state.snapshot(document));
    if (tool === 'pan' || event.button === 1) gesture = { id: event.pointerId, start, client: { x: event.clientX, y: event.clientY }, original, mode: 'pan' };
    else if (tool === 'select') {
      selected = id ?? null;
      if (!id) return;
      gesture = { id: event.pointerId, start, client: { x: event.clientX, y: event.clientY }, original, element: id, resize: !!target.closest('[data-resize]'), mode: 'move' };
    } else if (tool === 'sticky' || tool === 'text') { add(tool, start); return; }
    else {
      const element: BoardElement = { id: crypto.randomUUID(), type: tool as ElementType, ...start, width: 1, height: 1, color: '#c8942a', ...(tool === 'pen' ? { points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] } : {}), ...(tool === 'frame' ? { text: 'Section' } : {}) };
      selected = element.id; preview = { ...original, elements: [...original.elements, element] };
      gesture = { id: event.pointerId, start, client: { x: event.clientX, y: event.clientY }, original, element: element.id, mode: tool };
    }
    canvas.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const g = gesture; if (!g || g.id !== event.pointerId) return;
    const dx = (event.clientX - g.client.x) / g.original.viewport.zoom, dy = (event.clientY - g.client.y) / g.original.viewport.zoom;
    if (g.mode === 'pan') preview = { ...g.original, viewport: { ...g.original.viewport, x: g.original.viewport.x - dx, y: g.original.viewport.y - dy } };
    else if (g.mode === 'move') preview = { ...g.original, elements: g.resize ? g.original.elements.map(e => e.id === g.element ? { ...e, width: Math.max(20, e.width + dx), height: Math.max(20, e.height + dy) } : e) : moveElements(g.original.elements, g.element!, dx, dy) };
    else if (preview) preview = { ...preview, elements: preview.elements.map(e => e.id !== g.element ? e : g.mode === 'pen' ? { ...e, points: [...(e.points ?? []), { x: dx, y: dy }].slice(0, 10000), width: Math.max(1, Math.abs(dx)), height: Math.max(1, Math.abs(dy)) } : { ...e, x: Math.min(g.start.x, g.start.x + dx), y: Math.min(g.start.y, g.start.y + dy), width: Math.max(1, Math.abs(dx)), height: Math.max(1, Math.abs(dy)), ...(g.mode === 'arrow' ? { points: [{ x: dx < 0 ? Math.abs(dx) : 0, y: dy < 0 ? Math.abs(dy) : 0 }, { x: dx < 0 ? 0 : dx, y: dy < 0 ? 0 : dy }] } : {}) }) };
  }
  function finish(cancel = false) {
    const g = gesture; if (!g) return;
    let next = preview;
    preview = null; gesture = null;
    if (canvas.hasPointerCapture(g.id)) canvas.releasePointerCapture(g.id);
    if (cancel || !next) return;
    if (g.mode === 'pen') next = { ...next, elements: next.elements.map(e => {
      if (e.id !== g.element) return e;
      const points = e.points!, x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
      return { ...e, x: e.x + x, y: e.y + y, width: Math.max(1, ...points.map(p => p.x - x)), height: Math.max(1, ...points.map(p => p.y - y)), points: points.map(p => ({ x: p.x - x, y: p.y - y })) };
    }) };
    if (g.mode === 'frame') {
      const frame = next.elements.find(e => e.id === g.element)!;
      next = { ...next, elements: next.elements.map(e => e.type !== 'frame' && !e.frameId && e.x >= frame.x && e.y >= frame.y + 28 && e.x + e.width <= frame.x + frame.width && e.y + e.height <= frame.y + frame.height ? { ...e, frameId: frame.id } : e) };
    } else if (g.element) next = { ...next, elements: assignFrame(next.elements, g.element) };
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
    const minX = Math.min(...document.elements.map(e => e.x)) - 40, minY = Math.min(...document.elements.map(e => e.y)) - 40;
    const maxX = Math.max(...document.elements.map(e => e.x + e.width)) + 40, maxY = Math.max(...document.elements.map(e => e.y + e.height)) + 40;
    commit({ ...document, viewport: { x: minX, y: minY, zoom: Math.max(0.1, Math.min(2, width / (maxX - minX), height / (maxY - minY))) } }, false);
  }
  function keydown(event: KeyboardEvent) {
    if (busy || loading) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    if (event.key === 'Escape') { finish(true); selected = null; tool = 'select'; showReferences = false; confirmAction = null; return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && board) { event.preventDefault(); undoBoard(board.id, event.shiftKey); return; }
    if (event.key === 'Delete' && chosen) { event.preventDefault(); remove(); }
    if (event.key === 'Enter' && event.target === canvas && ['sticky', 'text', 'rectangle', 'ellipse', 'frame'].includes(tool)) { event.preventDefault(); add(tool as ElementType); }
    if (event.key.startsWith('Arrow') && event.target === canvas) {
      event.preventDefault(); const step = event.shiftKey ? 1 : 10, dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      commit(chosen ? { ...document, elements: assignFrame(moveElements(document.elements, chosen.id, dx, dy), chosen.id) } : { ...document, viewport: { ...document.viewport, x: document.viewport.x + dx, y: document.viewport.y + dy } }, !!chosen);
    }
  }
  function referenceTarget(e: BoardElement) { return e.target?.kind === 'map' ? $worldMaps.find(m => m.id === e.target?.id) : $entities.find(n => n.id === e.target?.id); }
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
    try { if (confirmAction === 'delete') { await deleteBoard(id); } else { await loadBoard(id, true); } selected = null; confirmAction = null; }
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
  {#if showCreate || (!loading && !$boardList.length)}<form class="create" onsubmit={e => { e.preventDefault(); void create(); }}><label>Name <input aria-label="New board name" bind:value={newName} maxlength="100" placeholder="Ideas for Act II" required disabled={busy} /></label><button disabled={busy || !newName.trim()}>Create board</button></form>{/if}
  {#if error}<div class="message" role="alert">{error}<button onclick={load} disabled={busy}>Retry loading</button></div>{/if}
  {#if board?.error}<div class="message" role="alert">{board.error} Your draft is kept in this session.<button onclick={() => board && saveBoard(board.id)}>Retry save</button><button onclick={download}>Download draft</button><button onclick={() => { confirmAction = 'reload'; }}>Reload saved board</button></div>{/if}
  {#if confirmAction}<div class="message" role="alert">{confirmAction === 'delete' ? 'Delete this board and all its elements?' : 'Discard this draft and reload the saved board?'}<button onclick={confirm} disabled={busy}>Confirm {confirmAction}</button><button onclick={() => { confirmAction = null; }}>Cancel</button></div>{/if}
  {#if loading}<p role="status">Loading boards…</p>{:else if board}
    <div class="tools" role="toolbar" aria-label="Drawing tools">
      {#each tools as item}<button title={item.label} aria-label={item.label} aria-pressed={tool === item.id} disabled={busy} onclick={() => { tool = item.id; selected = null; }}><item.icon size={17} /><span>{item.label}</span></button>{/each}
      <button title="Upload image" aria-label="Upload image" disabled={busy} onclick={() => fileInput.click()}><ImagePlus size={17} /></button><input class="file" bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onchange={e => upload(e.currentTarget.files?.[0])} />
      <button title="Add reference" aria-label="Add reference" aria-pressed={showReferences} disabled={busy} onclick={() => { showReferences = !showReferences; }}><Link size={17} /></button>
      <button aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!board.undo.length || busy} onclick={() => board && undoBoard(board.id)}><Undo2 size={17} /></button><button aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!board.redo.length || busy} onclick={() => board && undoBoard(board.id, true)}><Redo2 size={17} /></button>
    </div>
    {#if showReferences}<div class="references"><label>Find a reference <input bind:value={referenceQuery} placeholder="Character, map, or graph" /></label><div>{#each references as ref}<button onclick={() => { add('reference', center(), { target: { kind: ref.kind, id: ref.id } }); showReferences = false; }}>{ref.name}<small>{ref.label}</small></button>{/each}{#if !references.length}<p>No matching references. Create an entity or map first.</p>{/if}</div></div>{/if}
    <div class="stage" bind:clientWidth={width} bind:clientHeight={height}>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (The application canvas supports keyboard drawing, selection, and movement.) -->
      <svg bind:this={canvas} role="application" aria-label="Whiteboard canvas" tabindex="0" viewBox={`${document.viewport.x} ${document.viewport.y} ${width / document.viewport.zoom} ${height / document.viewport.zoom}`} onpointerdown={down} onpointermove={move} onpointerup={() => finish()} onpointercancel={() => finish(true)} onwheel={wheel}>
        <defs><pattern id="whiteboard-dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--color-border)" /></pattern><marker id="whiteboard-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" /></marker></defs>
        <rect x={document.viewport.x} y={document.viewport.y} width={width / document.viewport.zoom} height={height / document.viewport.zoom} fill="url(#whiteboard-dots)" />
        {#each ordered as element (element.id)}
          <g data-element-id={element.id} transform={`translate(${element.x},${element.y})`} role="button" tabindex="0" aria-label={`${element.type}: ${element.type === 'reference' ? referenceName(element) : element.text || element.type}`} onkeydown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selected = element.id; canvas.focus(); } }} ondblclick={() => { if (element.type === 'reference') openReference(element); else selected = element.id; }}>
            {#if element.type === 'ellipse'}<ellipse cx={element.width / 2} cy={element.height / 2} rx={element.width / 2} ry={element.height / 2} fill="transparent" stroke={element.color} stroke-width="2" />
            {:else if element.type === 'pen' || element.type === 'arrow'}<polyline points={(element.points ?? [{ x: 0, y: element.height }, { x: element.width, y: 0 }]).map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={element.color} stroke-width="3" stroke-linecap="round" stroke-linejoin="round" marker-end={element.type === 'arrow' ? 'url(#whiteboard-arrow)' : undefined} />
            {:else if element.type === 'image'}<image href={element.url} width={element.width} height={element.height} preserveAspectRatio="xMidYMid meet" />
            {:else}<rect width={element.width} height={element.height} rx={element.type === 'sticky' ? 2 : 4} fill={element.type === 'sticky' ? element.color : element.type === 'reference' ? 'var(--color-surface-2)' : 'transparent'} stroke={element.type === 'text' ? 'none' : element.color} stroke-width="1" stroke-dasharray={element.type === 'frame' ? '6 4' : undefined} />{/if}
            {#if ['sticky', 'text', 'frame', 'rectangle', 'ellipse', 'reference'].includes(element.type)}<foreignObject x="10" y="6" width={Math.max(1, element.width - 20)} height={element.type === 'frame' ? 24 : Math.max(1, element.height - 12)}><div class="element-text" class:sticky={element.type === 'sticky'} style:color={element.type === 'sticky' ? stickyText(element.color) : 'var(--color-text)'}>{#if element.type === 'reference'}<button class="reference-link" disabled={!referenceTarget(element)} onpointerdown={e => e.stopPropagation()} onclick={() => openReference(element)}>{referenceName(element)}</button><small>{element.target?.kind === 'graph' ? 'Focused graph' : element.target?.kind === 'map' ? 'Map' : $entities.find(e => e.id === element.target?.id)?.type ?? 'Deleted entity'}</small>{:else}{element.text}{/if}</div></foreignObject>{/if}
            {#if selected === element.id}<rect class="selection" x="-3" y="-3" width={element.width + 6} height={element.height + 6} fill="none" stroke="var(--color-focus)" stroke-width="2" pointer-events="none" />{#if !['pen', 'arrow'].includes(element.type)}<rect data-resize="true" x={element.width - 5} y={element.height - 5} width="10" height="10" fill="var(--color-focus)" style="cursor:nwse-resize" />{/if}{/if}
          </g>
        {/each}
      </svg>
      {#if !document.elements.length}<div class="empty"><strong>Room for unfinished ideas</strong><p>Choose a sticky note, draw a shape, or add a live reference. Drag a frame around related ideas to move them together.</p></div>{/if}
      {#if chosen}<aside aria-label="Selected element"><strong>{chosen.type === 'reference' ? referenceName(chosen) : 'Selected element'}</strong>{#if !['image', 'pen', 'arrow', 'reference'].includes(chosen.type)}<label>Text<textarea aria-label="Element text" value={chosen.text ?? ''} maxlength="10000" oninput={e => updateElement({ text: e.currentTarget.value })}></textarea></label>{/if}<label>Color<input type="color" value={chosen.color} onchange={e => updateElement({ color: e.currentTarget.value })} /></label><div class="dimensions">{#each (['pen', 'arrow'].includes(chosen.type) ? ['x', 'y'] : ['x', 'y', 'width', 'height']) as field}<label>{field}<input aria-label={`Element ${field}`} type="number" step="any" value={Number(chosen[field as 'x' | 'y' | 'width' | 'height'].toFixed(1))} onchange={e => updateElement({ [field]: e.currentTarget.valueAsNumber })} /></label>{/each}</div><div><button aria-label="Duplicate element" title="Duplicate" onclick={duplicate}><Copy size={16} /></button><button aria-label="Delete element" title="Delete" onclick={remove}><Trash2 size={16} /></button></div></aside>{/if}
    </div>
    <footer><label>Name <input aria-label="Board name" value={board.name} maxlength="100" onchange={e => { if (board && e.currentTarget.value.trim()) editBoard(board.id, board.document, e.currentTarget.value.trim()); }} /></label><button aria-label="Delete board" title="Delete board" onclick={() => { confirmAction = 'delete'; }}><Trash2 size={15} /></button><span class="hint">Drag to draw · Scroll to pan · Ctrl/⌘ scroll to zoom</span><button aria-label="Zoom out" onclick={() => zoom(0.8)}><Minus size={16} /></button><output aria-label="Zoom">{Math.round(document.viewport.zoom * 100)}%</output><button aria-label="Zoom in" onclick={() => zoom(1.25)}><Plus size={16} /></button><button aria-label="Fit board" title="Fit board" onclick={fit}><Maximize size={16} /></button></footer>
  {:else if !showCreate && $boardList.length}<p>Select a board to keep working.</p>{/if}
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
  aside { position: absolute; top: 10px; right: 10px; width: 180px; max-height: calc(100% - 20px); overflow: auto; padding: 10px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 4px; display: flex; flex-direction: column; gap: 9px; }
  aside label { flex-direction: column; align-items: stretch; }
  aside textarea { min-height: 70px; resize: vertical; }
  .dimensions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .dimensions input { width: 100%; box-sizing: border-box; }
  .references { padding: 10px; border-bottom: 1px solid var(--color-border); }
  .references > div { display: flex; flex-wrap: wrap; gap: 5px; max-height: 110px; overflow: auto; margin-top: 6px; }
  small { color: var(--color-text-muted); }
  .empty { position: absolute; inset: 35% auto auto 8%; width: min(360px, 70%); pointer-events: none; }
  .empty strong { font: 22px var(--font-display); }
  .empty p { color: var(--color-text-muted); line-height: 1.6; }
  footer { border-bottom: 0; border-top: 1px solid var(--color-border); }
  footer input { width: 120px; }
  .hint { flex: 1; color: var(--color-text-muted); font-size: 11px; }
  output { font-variant-numeric: tabular-nums; }
</style>
