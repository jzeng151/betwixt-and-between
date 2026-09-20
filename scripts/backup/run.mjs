import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

const exec = promisify(execFile);
const DAY = 86400000;
const IMAGE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}_\d{13}\.(?:png|jpe?g|webp)$/i;
const HASH = /^[0-9a-f]{64}$/;
const SNAPSHOT = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;
async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function command(program, args, env = process.env) {
  try {
    return (await exec(program, args, { env, maxBuffer: 256 * 1024 * 1024 })).stdout;
  } catch (error) {
    // Child errors can include connection strings and data. Report only the tool and exit code.
    throw new Error(`${program} failed (exit ${error.code ?? 'unknown'}); backup/cleanup stopped`);
  }
}
const rclone = (...args) => command('rclone', args);
const list = async (path) => JSON.parse(await rclone('lsjson', path, '--recursive', '--files-only'));

export function imageReferences(text) {
  return new Set(text.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}_\d{13}\.(?:png|jpe?g|webp)/gi) ?? []);
}

export function validateManifest(value, id) {
  if (!SNAPSHOT.test(id) || value.version !== 1 || value.id !== id ||
      !Number.isFinite(Date.parse(value.createdAt)) || !HASH.test(value.databaseHash) ||
      typeof value.monthly !== 'boolean' || !Array.isArray(value.images)) {
    throw new Error(`Invalid backup manifest: ${id}`);
  }
  for (const image of value.images) {
    if (!IMAGE.test(image.key) || !HASH.test(image.hash)) throw new Error(`Invalid image manifest: ${id}`);
  }
  return value;
}

export function expiredSnapshots(manifests, now) {
  const month = new Date(now);
  month.setUTCDate(1);
  month.setUTCHours(0, 0, 0, 0);
  month.setUTCMonth(month.getUTCMonth() - 11);
  const latest = [...manifests].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  return manifests.filter((m) => m !== latest && Date.parse(m.createdAt) < now - 30 * DAY &&
    !(m.monthly && Date.parse(m.createdAt) >= month.getTime()));
}

export function orphanImages(objects, references, now, unreferenced = {}) {
  return objects.filter((o) => IMAGE.test(o.Path) && !references.has(o.Path) &&
    Number.isFinite(Date.parse(o.ModTime)) && Date.parse(o.ModTime) < now - 7 * DAY &&
    unreferenced[o.Path]?.modifiedAt === o.ModTime &&
    Date.parse(unreferenced[o.Path]?.since) < now - 7 * DAY);
}

async function verifiedCopy(local, remote, scratch, exists = false) {
  if (!exists) await rclone('copyto', local, remote, '--immutable');
  await rclone('copyto', remote, scratch, '--ignore-times');
  if (await fileHash(local) !== await fileHash(scratch)) throw new Error('Backup round-trip checksum mismatch');
}

export async function backup({ now = new Date() } = {}) {
  const sourceUrl = process.env.DATABASE_URL;
  const restoreUrl = process.env.RESTORE_DATABASE_URL;
  if (!sourceUrl || !restoreUrl) throw new Error('DATABASE_URL and RESTORE_DATABASE_URL are required');
  const restore = new URL(restoreUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(restore.hostname) ||
      restore.pathname !== '/betwixt_restore_check' || sourceUrl === restoreUrl) {
    throw new Error('Restore check requires a separate loopback database named betwixt_restore_check');
  }
  const source = new URL(sourceUrl);
  if (['localhost', '127.0.0.1', '[::1]'].includes(source.hostname) &&
      (source.port || '5432') === (restore.port || '5432') && source.pathname === restore.pathname) {
    throw new Error('Source and restore-check database must differ');
  }
  if (source.hostname.endsWith('.neon.tech') && source.hostname.split('.')[0].endsWith('-pooler')) {
    throw new Error('Backups require a direct Neon connection, not the transaction pooler');
  }
  const config = JSON.parse(await rclone('config', 'dump'));
  if (config.backup?.type !== 'crypt' || config.backup?.no_data_encryption === 'true' || !config.uploads) {
    throw new Error('Configure an encrypted backup: remote and an uploads: remote');
  }
  const work = await mkdtemp(join(tmpdir(), 'betwixt-backup-'));
  const sql = postgres(sourceUrl, { max: 1, max_lifetime: 0, onnotice: () => {} });
  const check = postgres(restoreUrl, { max: 1, max_lifetime: 0, onnotice: () => {} });
  try {
    // Serializes manual and scheduled runs, including retention and source-image cleanup.
    const [{ locked }] = await sql`select pg_try_advisory_lock(194729, 1) as locked`;
    if (!locked) throw new Error('Another backup is running');
    const existing = await list('backup:');
    const manifests = [];
    for (const item of existing.filter((o) => /^snapshots\/[^/]+\/manifest\.json$/.test(o.Path))) {
      const id = item.Path.split('/')[1];
      manifests.push(validateManifest(JSON.parse(await rclone('cat', `backup:${item.Path}`)), id));
    }
    const id = `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${crypto.randomUUID().slice(0, 8)}`;
    const dump = join(work, 'database.dump');
    await command('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', dump, '--dbname', sourceUrl]);
    // Read references from the exact dump, including URLs in notes/JSON, not a later live query.
    const text = join(work, 'references.sql');
    await command('pg_restore', ['--data-only', `--file=${text}`, dump]);
    const references = new Set();
    let tail = '';
    for await (const chunk of createReadStream(text, { encoding: 'utf8' })) {
      const part = tail + chunk;
      for (const key of imageReferences(part)) references.add(key);
      tail = part.slice(-128); // preserve filenames split across stream chunks
    }
    const objects = await list('uploads:');
    const previous = [...manifests].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    const unreferencedImages = {};
    for (const object of objects) {
      if (!IMAGE.test(object.Path) || references.has(object.Path)) continue;
      const prior = previous?.unreferencedImages?.[object.Path];
      unreferencedImages[object.Path] = prior?.modifiedAt === object.ModTime
        ? prior : { since: now.toISOString(), modifiedAt: object.ModTime };
    }
    const manifest = {
      version: 1, id, createdAt: now.toISOString(), databaseHash: await fileHash(dump), unreferencedImages,
      monthly: !manifests.some((m) => m.monthly && m.createdAt.slice(0, 7) === now.toISOString().slice(0, 7)),
      images: []
    };
    const storedImages = new Set(existing.filter((o) => o.Path.startsWith('images/')).map((o) => o.Path.slice(7)));
    for (const key of [...references].sort()) {
      const local = join(work, 'image');
      await rclone('copyto', `uploads:${key}`, local, '--ignore-times');
      const hash = await fileHash(local);
      await verifiedCopy(local, `backup:images/${hash}`, join(work, 'roundtrip-image'), storedImages.has(hash));
      storedImages.add(hash);
      manifest.images.push({ key, hash });
    }
    const remote = `backup:snapshots/${id}`;
    const downloaded = join(work, 'roundtrip.dump');
    await verifiedCopy(dump, `${remote}/database.dump`, downloaded);
    const [{ count }] = await check`select count(*)::int as count from pg_tables where schemaname not in ('pg_catalog', 'information_schema')`;
    if (count !== 0) throw new Error('Restore-check database must be empty');
    await command('pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', 'betwixt_restore_check', downloaded], {
      ...process.env, PGHOST: restore.hostname.replace(/[\[\]]/g, ''), PGPORT: restore.port || '5432',
      PGUSER: decodeURIComponent(restore.username), PGPASSWORD: decodeURIComponent(restore.password),
      PGDATABASE: 'betwixt_restore_check'
    });
    // A complete restore must include the application's core tables.
    await check`select (select count(*) from stories), (select count(*) from entities), (select count(*) from world_maps)`;
    const file = join(work, 'manifest.json');
    await writeFile(file, JSON.stringify(manifest));
    // Commit marker: absent until database restoration AND all image round-trips succeed.
    await verifiedCopy(file, `${remote}/manifest.json`, join(work, 'roundtrip-manifest'));
    console.log(`Verified backup ${id}: ${references.size} referenced images`);

    const all = [...manifests, manifest];
    const expired = expiredSnapshots(all, now.getTime());
    if (process.env.BACKUP_PRUNE === 'true') {
      for (const m of expired) {
        // Remove the commit marker first. If interrupted, images remain conservatively retained this run.
        await rclone('deletefile', `backup:snapshots/${m.id}/manifest.json`, '--b2-hard-delete');
        await rclone('deletefile', `backup:snapshots/${m.id}/database.dump`, '--b2-hard-delete');
      }
      const committed = new Set(all.map((m) => m.id));
      for (const object of existing) {
        const match = /^snapshots\/([^/]+)\/database\.dump$/.exec(object.Path);
        if (match && SNAPSHOT.test(match[1]) && !committed.has(match[1]) &&
            Date.parse(object.ModTime) < now.getTime() - 7 * DAY) {
          await rclone('deletefile', `backup:${object.Path}`, '--b2-hard-delete');
        }
      }
      const retained = all.filter((m) => !expired.includes(m));
      const hashes = new Set(retained.flatMap((m) => m.images.map((i) => i.hash)));
      for (const object of existing) {
        if (/^images\/[0-9a-f]{64}$/.test(object.Path) && !hashes.has(object.Path.slice(7)) &&
            Date.parse(object.ModTime) < now.getTime() - 7 * DAY) {
          await rclone('deletefile', `backup:${object.Path}`, '--b2-hard-delete');
        }
      }
    } else console.log(`Retention preview: ${expired.length} expired snapshots; deletion disabled`);

    // Most runs have nothing eligible; avoid scanning/locking the live database then.
    if (!orphanImages(objects, new Set(), now.getTime(), unreferencedImages).length) {
      console.log('Image cleanup: no files past the seven-day unreferenced grace period');
      return;
    }
    // Freeze live references only during destructive cleanup, not during backup or preview.
    await sql.begin(async (tx) => {
      await tx`set local idle_in_transaction_session_timeout = '0'`;
      await tx`set local lock_timeout = '5s'`;
      const tables = await tx`select tablename from pg_tables where schemaname = 'public' order by tablename`;
      if (!tables.some((t) => t.tablename === 'world_maps')) throw new Error('Missing world_maps table');
      // ponytail: SHARE locks briefly pause writes; use tracked asset references if cleanup grows slow.
      if (process.env.IMAGE_CLEANUP === 'true') {
        for (const { tablename } of tables) await tx`lock table ${tx(`public.${tablename}`)} in share mode`;
      }
      const live = new Set();
      for (const { tablename } of tables) {
        for await (const rows of tx`select row_to_json(t)::text as data from ${tx(`public.${tablename}`)} t`.cursor(100)) {
          for (const row of rows) for (const key of imageReferences(row.data)) live.add(key);
        }
      }
      const candidates = orphanImages(objects, live, now.getTime(), unreferencedImages).slice(0, 100);
      console.log(`Image cleanup: ${candidates.length} unreferenced files older than seven days`);
      if (process.env.IMAGE_CLEANUP === 'true') {
        for (const object of candidates) await rclone('deletefile', `uploads:${object.Path}`);
      } else console.log('Image deletion disabled');
    });
  } finally {
    await sql.end();
    await check.end();
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backup().catch((error) => {
    // Never log database driver errors or child stderr: they can contain customer data/secrets.
    console.error(error instanceof Error && error.constructor === Error ? error.message : 'Backup failed; no further cleanup performed');
    process.exitCode = 1;
  });
}
