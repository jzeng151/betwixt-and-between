import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { backup, expiredSnapshots, imageReferences, orphanImages, validateManifest } from '../../scripts/backup/run.mjs';

const DAY = 86400000;
const key = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}_1750000000000.png`;

test('retention preserves recent, monthly, and last-known-good snapshots', () => {
  const now = Date.parse('2026-09-20T06:00:00Z');
  const snapshots = [
    { id: 'daily', createdAt: '2026-09-19T06:00:00Z', monthly: false },
    { id: 'old-daily', createdAt: '2026-08-01T06:00:00Z', monthly: false },
    { id: 'monthly', createdAt: '2025-10-01T06:00:00Z', monthly: true },
    { id: 'expired-month', createdAt: '2025-09-01T06:00:00Z', monthly: true }
  ];
  assert.deepEqual(expiredSnapshots(snapshots, now).map((m) => m.id), ['old-daily', 'expired-month']);
  assert.deepEqual(expiredSnapshots([snapshots[1]], now), []);
  assert.deepEqual(expiredSnapshots([], now), []);
});

test('cleanup protects references, new uploads, unknown keys and invalid dates', () => {
  const now = Date.now();
  const objects = [1, 2, 3].map((n) => ({ Path: key(n), ModTime: new Date(now - 8 * DAY).toISOString() }));
  objects.push({ Path: key(4), ModTime: new Date(now).toISOString() });
  objects.push({ Path: key(5), ModTime: 'invalid' });
  objects.push({ Path: 'unmanaged.png', ModTime: '2000-01-01' });
  const refs = imageReferences(JSON.stringify({ maps: [`/api/maps/file/${key(1)}`, `/api/maps/file/${key(1)}`], note: `![map](/api/maps/file/${key(2)})` }));
  assert.deepEqual(orphanImages(objects, refs, now, Object.fromEntries(objects.map((o) => [o.Path, { since: new Date(now - 8 * DAY).toISOString(), modifiedAt: o.ModTime }]))).map((o) => o.Path), [key(3)]);
  assert.throws(() => validateManifest({ version: 1 }, '../other'), /Invalid/);
});

test('restore destination and pooled source are rejected before accessing storage', async () => {
  const before = { source: process.env.DATABASE_URL, restore: process.env.RESTORE_DATABASE_URL };
  try {
    process.env.DATABASE_URL = 'postgres://user:disposable@ep-test-pooler.us-east-2.aws.neon.tech/app';
    process.env.RESTORE_DATABASE_URL = 'postgres://postgres@127.0.0.1/betwixt_restore_check';
    await assert.rejects(backup(), /direct Neon connection/);
    process.env.RESTORE_DATABASE_URL = 'postgres://postgres@production.example/betwixt_restore_check';
    await assert.rejects(backup(), /loopback database/);
  } finally {
    if (before.source === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = before.source;
    if (before.restore === undefined) delete process.env.RESTORE_DATABASE_URL; else process.env.RESTORE_DATABASE_URL = before.restore;
  }
});

test('encrypted remote round-trip restores data; cleanup waits for verified backup and preserves shared images',
  { skip: !process.env.BACKUP_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.BACKUP_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'test requires loopback Postgres');
  const admin = postgres(url.href, { max: 1, onnotice: () => {} });
  const sourceName = `backup_test_${Date.now()}`;
  const sourceUrl = new URL(url); sourceUrl.pathname = `/${sourceName}`;
  const restoreUrl = new URL(url); restoreUrl.pathname = '/betwixt_restore_check';
  const work = await mkdtemp(join(tmpdir(), 'backup-test-'));
  const before = { ...process.env };
  let source; let createdRestore = false;
  const cli = (...args) => execFileSync('rclone', args, { encoding: 'utf8' });
  try {
    await admin`create database ${admin(sourceName)}`;
    await admin`create database betwixt_restore_check`; createdRestore = true;
    source = postgres(sourceUrl.href, { max: 1, onnotice: () => {} });
    await source`create table stories (id integer primary key, name text)`;
    await source`create table entities (id integer primary key, data jsonb)`;
    await source`create table world_maps (id integer primary key, base_image_url text)`;
    await source`insert into stories values (1, 'Harbour')`;
    await source`insert into world_maps values (1, ${`/api/maps/file/${key(1)}`}), (2, ${`/api/maps/file/${key(1)}`})`;
    await source`insert into entities values (1, ${JSON.stringify({ body: `![Old map](/api/maps/file/${key(2)})` })}::jsonb)`;
    const uploads = join(work, 'uploads'); const encrypted = join(work, 'encrypted');
    await mkdir(uploads); await mkdir(encrypted);
    for (const n of [1, 2, 3, 4]) {
      await writeFile(join(uploads, key(n)), n < 3 ? 'same-image' : `image-${n}`);
      if (n < 4) await utimes(join(uploads, key(n)), new Date(Date.now() - (8 + n) * DAY), new Date(Date.now() - (8 + n) * DAY));
    }
    const password = cli('obscure', 'disposable-backup-test-password').trim();
    const config = join(work, 'rclone.conf');
    await writeFile(config, `[backup]\ntype = crypt\nremote = ${encrypted}\npassword = ${password}\n[uploads]\ntype = alias\nremote = ${uploads}\n`, { mode: 0o600 });
    Object.assign(process.env, { RCLONE_CONFIG: config, DATABASE_URL: sourceUrl.href,
      RESTORE_DATABASE_URL: restoreUrl.href, BACKUP_PRUNE: 'true', IMAGE_CLEANUP: 'false' });
    await backup();
    assert.ok((await readdir(uploads)).includes(key(3)), 'preview must not delete');
    let inventory = JSON.parse(cli('lsjson', 'backup:', '-R', '--files-only'));
    assert.equal(inventory.filter((o) => o.Path.startsWith('images/')).length, 1, 'identical bytes stored once');
    assert.ok(Date.parse(inventory.find((o) => o.Path.startsWith('images/')).ModTime) > Date.now() - DAY,
      'backup grace starts when copied, even for old source images');
    const manifestPath = inventory.find((o) => o.Path.endsWith('/manifest.json')).Path;
    const manifest = JSON.parse(cli('cat', `backup:${manifestPath}`));
    assert.deepEqual(manifest.images.map((i) => i.key), [key(1), key(2)]);
    const restored = postgres(restoreUrl.href, { max: 1 });
    assert.equal((await restored`select name from stories`)[0].name, 'Harbour');
    assert.equal((await restored`select count(*)::int as n from world_maps`)[0].n, 2);
    await restored.end();

    const corrupt = join(work, 'corrupt-image');
    await writeFile(corrupt, 'bad!-image');
    cli('copyto', corrupt, `backup:images/${manifest.images[0].hash}`, '--ignore-times');
    await assert.rejects(backup(), /checksum mismatch/);
    assert.ok((await readdir(uploads)).includes(key(3)));
    cli('copyto', join(uploads, key(1)), `backup:images/${manifest.images[0].hash}`, '--ignore-times');

    // A failed restore check must not prune backups or source images.
    process.env.IMAGE_CLEANUP = 'true';
    await assert.rejects(backup(), /must be empty/);
    assert.ok((await readdir(uploads)).includes(key(3)));
    assert.equal(JSON.parse(cli('lsjson', 'backup:', '-R', '--files-only')).filter((o) => o.Path.endsWith('/manifest.json')).length, 1);

    // Old daily-only assets expire; a retained monthly snapshot protects its assets.
    const old = new Date(Date.now() - 50 * DAY);
    const oldIds = ['20260701T000000Z-00000001', '20260701T000000Z-00000002'];
    for (const [i, oldId] of oldIds.entries()) {
      const hash = String(i + 1).repeat(64);
      const fixture = join(work, `historic-${i}`);
      await writeFile(fixture, 'old image');
      await utimes(fixture, old, old);
      cli('copyto', fixture, `backup:images/${hash}`);
      cli('copyto', fixture, `backup:snapshots/${oldId}/database.dump`);
      await writeFile(fixture, JSON.stringify({ version: 1, id: oldId, createdAt: old.toISOString(),
        databaseHash: 'a'.repeat(64), monthly: i === 1, images: [{ key: key(90 + i), hash }] }));
      cli('copyto', fixture, `backup:snapshots/${oldId}/manifest.json`);
    }
    await admin`drop database betwixt_restore_check`;
    await admin`create database betwixt_restore_check`;
    await source`delete from world_maps where id = 1`;
    await backup({ now: new Date(Date.now() + 8 * DAY) });
    const remaining = await readdir(uploads);
    assert.ok(remaining.includes(key(1)), 'duplicate map still uses shared image');
    assert.ok(remaining.includes(key(2)), 'note references are live references');
    assert.ok(!remaining.includes(key(4)), 'previously new upload becomes eligible after eight days unreferenced');
    assert.ok(!remaining.includes(key(3)), 'old orphan removed');
    inventory = JSON.parse(cli('lsjson', 'backup:', '-R', '--files-only'));
    assert.equal(inventory.filter((o) => o.Path.startsWith('images/')).length, 2);
    assert.ok(!inventory.some((o) => o.Path === `images/${'1'.repeat(64)}`));
    assert.ok(inventory.some((o) => o.Path === `images/${'2'.repeat(64)}`));
    assert.ok(!inventory.some((o) => o.Path.includes(oldIds[0])));
    assert.equal(inventory.filter((o) => o.Path.endsWith('/manifest.json')).length, 3);
    assert.equal(inventory.filter((o) => o.Path.endsWith('/manifest.json')).map((o) => JSON.parse(cli('cat', `backup:${o.Path}`))).filter((m) => m.monthly && m.createdAt.slice(0, 7) === new Date().toISOString().slice(0, 7)).length, 1);
    assert.ok(!(await readdir(encrypted)).includes('images'), 'remote names are encrypted');
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in before)) delete process.env[name];
    Object.assign(process.env, before);
    if (source) await source.end();
    await admin`drop database if exists ${admin(sourceName)}`;
    if (createdRestore) await admin`drop database betwixt_restore_check`;
    await admin.end();
    await rm(work, { recursive: true, force: true });
  }
});
