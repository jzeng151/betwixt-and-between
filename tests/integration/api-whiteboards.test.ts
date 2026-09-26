import { beforeAll, afterAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedTestUser } from '../helpers/test-db.js';
import { entities, stories, whiteboards } from '../../src/lib/server/db/schema.js';
import { GET as LIST, POST as CREATE } from '../../src/routes/api/whiteboards/+server.js';
import { GET, PUT, DELETE } from '../../src/routes/api/whiteboards/[id]/+server.js';
import { POST as UPLOAD } from '../../src/routes/api/whiteboards/[id]/upload-image/+server.js';
import { emptyDocument, type BoardDocument } from '../../src/lib/features/whiteboard/model.js';
let db: Awaited<ReturnType<typeof createTestDb>>, user: Awaited<ReturnType<typeof seedTestUser>>, otherStory: string;
beforeAll(async () => {
  db = await createTestDb(); user = await seedTestUser(db);
  const [story] = await db.insert(stories).values({ userId: user.id, name: 'Other story' }).returning(); otherStory = story.id;
});
afterAll(async () => { await db.$client.close(); });
function event(id = '', body: unknown = {}, story = user.id): any {
  return { locals: { db, user }, params: { id }, url: new URL('http://localhost/api/whiteboards'), request: new Request('http://localhost/api/whiteboards', { method: 'POST', headers: { 'x-story-id': story, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
}
it('creates named boards idempotently and isolates reads, writes, deletes, and uploads by story', async () => {
  const id = crypto.randomUUID();
  const first = await (await CREATE(event('', { id, name: 'Clues' }))).json();
  expect(await (await CREATE(event('', { id, name: 'Retry' }))).json()).toEqual(first);
  expect(await (await LIST(event())).json()).toContainEqual({ id, name: 'Clues' });
  expect(await (await LIST(event('', {}, otherStory))).json()).toEqual([]);
  for (const handler of [GET, DELETE, UPLOAD]) await expect(handler(event(id, {}, otherStory))).rejects.toMatchObject({ status: 404 });
  await expect(PUT(event(id, { name: 'Taken', revision: 0, document: emptyDocument() }, otherStory))).rejects.toMatchObject({ status: 404 });
  await expect(CREATE(event('', { id, name: 'Taken' }, otherStory))).rejects.toMatchObject({ status: 409 });
  await expect(LIST({ locals: { user: null } } as any)).rejects.toMatchObject({ status: 401 });
});
it('rejects stale saves and foreign references while preserving references whose targets were deleted', async () => {
  const id = crypto.randomUUID(); await CREATE(event('', { id, name: 'Plot' }));
  const [own, foreign] = await db.insert(entities).values([{ storyId: user.id, type: 'Character', name: 'Ada' }, { storyId: otherStory, type: 'Character', name: 'Secret' }]).returning();
  const document: BoardDocument = { ...emptyDocument(), elements: [{ id: crypto.randomUUID(), type: 'reference', x: 0, y: 0, width: 200, height: 90, color: '#123456', target: { kind: 'entity', id: foreign.id } }] };
  await expect(PUT(event(id, { name: 'Plot', revision: 0, document }))).rejects.toMatchObject({ status: 400 });
  document.elements[0].target!.id = own.id;
  const saved = await (await PUT(event(id, { name: 'Plot', revision: 0, document }))).json(); expect(saved.revision).toBe(1);
  await expect(PUT(event(id, { name: 'Stale', revision: 0, document }))).rejects.toMatchObject({ status: 409 });
  await db.delete(entities).where(eq(entities.id, own.id));
  expect((await (await PUT(event(id, { name: 'Kept', revision: 1, document }))).json()).revision).toBe(2);
  await DELETE(event(id)); expect(await db.select().from(whiteboards).where(eq(whiteboards.id, id))).toEqual([]);
});
it('rejects malformed drawings before saving and enforces the story board limit', async () => {
  const id = crypto.randomUUID(); await CREATE(event('', { id, name: 'Bounds' }));
  await expect(PUT(event(id, { name: 'Bounds', revision: 0, document: { ...emptyDocument(), elements: [{ type: 'pen', points: 'bad' }] } }))).rejects.toMatchObject({ status: 400 });
  await db.insert(whiteboards).values(Array.from({ length: 100 }, (_, i) => ({ storyId: otherStory, name: `Board ${i}` })));
  await expect(CREATE(event('', { id: crypto.randomUUID(), name: 'Overflow' }, otherStory))).rejects.toMatchObject({ status: 400 });
});
