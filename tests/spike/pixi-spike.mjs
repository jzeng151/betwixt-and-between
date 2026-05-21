/**
 * Pre-Slice 0 spike — automated validation script.
 *
 * Runs Chromium against the dev server on :5173 (boot it before running this).
 * Reports pass/fail per acceptance criterion to stdout as JSON.
 *
 * Criteria 1 (mount), 3 (reactivity) are fully automated here.
 * Criterion 2 (no leaked Application instances across 10 nav cycles) is
 *   APPROXIMATED via `performance.memory.usedJSHeapSize` + forced GC, not a real
 *   retained-Application count. The real check requires manual heap snapshots.
 * Criterion 4 (HMR) is not exercised here — manual only.
 *
 * Usage:
 *   npm run dev   # in another terminal
 *   node tests/spike/pixi-spike.mjs
 *
 * Deletes with the spike branch's /spike-pixi route.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.SPIKE_BASE_URL ?? 'http://localhost:5173';
const NAV_CYCLES = 10;

const results = {
  base: BASE,
  navCycles: NAV_CYCLES,
  consoleErrors: [],
  pageErrors: [],
  criteria: {},
};

function record(name, status, detail) {
  results.criteria[name] = { status, ...detail };
}

// Reuse the chromium-1208 binary already on disk. Newer Playwright wants
// chromium-1217 but the binary on disk is API-compatible enough for the
// spike's read-only DevTools probes.
const EXEC_PATH = process.env.PW_CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`;
const browser = await chromium.launch({
  executablePath: EXEC_PATH,
  args: ['--js-flags=--expose-gc'],
});
const context = await browser.newContext();
const page = await context.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') results.consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => results.pageErrors.push(String(err)));
results.failedRequests = [];
page.on('requestfailed', (req) => {
  results.failedRequests.push({ url: req.url(), failure: req.failure()?.errorText });
});
page.on('response', (res) => {
  if (res.status() >= 400) results.failedRequests.push({ url: res.url(), status: res.status() });
});

try {
  // -------------------------------------------------------------------------
  // Criterion 1 — Mount
  // -------------------------------------------------------------------------
  await page.goto(`${BASE}/spike-pixi`, { waitUntil: 'networkidle' });
  // svelte-pixi mounts the Pixi canvas inside .stage-wrap > canvas
  await page.locator('[data-testid="stage-wrap"] canvas').first().waitFor({ timeout: 10_000 });
  const initialCount = await page.locator('[data-testid="count"]').innerText();
  const hasCanvas = (await page.locator('[data-testid="stage-wrap"] canvas').count()) === 1;
  // Filter out /favicon.ico probes — Chrome auto-requests it but the project
  // only ships favicon.svg. Pre-existing baseline 404 unrelated to the spike.
  const spikeConsoleErrors = results.consoleErrors.filter(
    (e) => !/Failed to load resource.*status of 404/i.test(e)
  );
  const mountPass = hasCanvas && spikeConsoleErrors.length === 0 && results.pageErrors.length === 0;
  record('1-mount', mountPass ? 'PASS' : 'FAIL', {
    hasCanvas,
    initialCount,
    spikeConsoleErrors,
    ignoredErrors: results.consoleErrors.filter((e) => !spikeConsoleErrors.includes(e)),
    pageErrors: [...results.pageErrors],
  });

  // -------------------------------------------------------------------------
  // Criterion 3 — Reactivity (canvas updates within one frame)
  // -------------------------------------------------------------------------
  // Snapshot canvas pixels before mutation, then after.
  const canvas = page.locator('[data-testid="stage-wrap"] canvas').first();

  // For canvas diff: grab a center pixel via getImageData. svelte-pixi uses
  // WebGL; getImageData on a WebGL canvas requires preserveDrawingBuffer to
  // read after the next swap. Pixi v8 enables this only with explicit option.
  // We work around by comparing a small screenshot region instead, which
  // captures the composited pixels.
  async function canvasBytes() {
    return canvas.screenshot({ type: 'png' });
  }
  function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  const before = await canvasBytes();

  // Add 3 items, wait one frame, count == 6
  for (let i = 0; i < 3; i++) await page.getByTestId('add').click();
  await page.waitForTimeout(50); // one+ frame budget
  const countAfterAdd = await page.locator('[data-testid="count"]').innerText();
  const afterAdd = await canvasBytes();

  // Remove 2 items, count == 4
  for (let i = 0; i < 2; i++) await page.getByTestId('remove').click();
  await page.waitForTimeout(50);
  const countAfterRemove = await page.locator('[data-testid="count"]').innerText();
  const afterRemove = await canvasBytes();

  // Recolor all — canvas pixels should change but count stays
  await page.getByTestId('recolor').click();
  await page.waitForTimeout(50);
  const countAfterRecolor = await page.locator('[data-testid="count"]').innerText();
  const afterRecolor = await canvasBytes();

  const reactivityPass =
    countAfterAdd === 'Items: 6' &&
    countAfterRemove === 'Items: 4' &&
    countAfterRecolor === 'Items: 4' &&
    !bytesEqual(before, afterAdd) &&
    !bytesEqual(afterAdd, afterRemove) &&
    !bytesEqual(afterRemove, afterRecolor);

  record('3-reactivity', reactivityPass ? 'PASS' : 'FAIL', {
    countAfterAdd,
    countAfterRemove,
    countAfterRecolor,
    canvasChangedOnAdd: !bytesEqual(before, afterAdd),
    canvasChangedOnRemove: !bytesEqual(afterAdd, afterRemove),
    canvasChangedOnRecolor: !bytesEqual(afterRemove, afterRecolor),
  });

  // -------------------------------------------------------------------------
  // Criterion 2 — Lifecycle (APPROXIMATED)
  // -------------------------------------------------------------------------
  // Navigate / ↔ /spike-pixi NAV_CYCLES times. Force GC. Compare heap size.
  // This is NOT the real retained-Application count; that requires a manual
  // Chrome DevTools heap snapshot diff.
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');

  async function heapBaseline() {
    // Trigger GC several times to let weak refs collect.
    for (let i = 0; i < 3; i++) {
      await cdp.send('HeapProfiler.collectGarbage');
      await page.waitForTimeout(50);
    }
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: 'performance.memory ? performance.memory.usedJSHeapSize : -1',
      returnByValue: true,
    });
    return result.value;
  }

  // Start on /spike-pixi (already there). Capture baseline.
  await page.goto(`${BASE}/spike-pixi`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="stage-wrap"] canvas').first().waitFor();
  const heapBefore = await heapBaseline();

  for (let i = 0; i < NAV_CYCLES; i++) {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.goto(`${BASE}/spike-pixi`, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="stage-wrap"] canvas').first().waitFor();
  }

  // Count Pixi.Application instances retained on the heap (approximation).
  // We probe via querying global Pixi if exposed, else use heap totals only.
  const heapAfter = await heapBaseline();
  const heapDeltaMb = ((heapAfter - heapBefore) / (1024 * 1024)).toFixed(2);

  // Try to query retained Application count via Pixi-internal weak collections.
  // svelte-pixi doesn't expose a registry; this returns -1 if we can't probe.
  const probedRetained = await page.evaluate(() => {
    // Returns -1 to signal "could not probe". Real check is heap snapshot.
    return -1;
  });

  // Heuristic threshold: under 5MB growth across 10 cycles is "probably no leak."
  // A real leaked Application would retain its WebGL context, ~2-5MB each.
  const heapLikelyClean = heapAfter > 0 && heapAfter - heapBefore < 5 * 1024 * 1024;
  record('2-lifecycle', heapLikelyClean ? 'AUTO-PASS-APPROX' : 'AUTO-FAIL-APPROX', {
    heapBeforeBytes: heapBefore,
    heapAfterBytes: heapAfter,
    heapDeltaMb: Number(heapDeltaMb),
    note: 'APPROX only. Real validation = manual Chrome DevTools heap snapshot diff per spike doc.',
    probedRetained,
  });

  // -------------------------------------------------------------------------
  // Criterion 4 — HMR
  // -------------------------------------------------------------------------
  record('4-hmr', 'MANUAL-PENDING', {
    note: 'Requires human edit-save-observe loop. See findings doc § Manual runbook.',
  });

  // Final summary
  results.consoleErrors = [...new Set(results.consoleErrors)]; // dedupe
  results.summary = Object.fromEntries(Object.entries(results.criteria).map(([k, v]) => [k, v.status]));
  console.log(JSON.stringify(results, null, 2));

  const allAutomatedPass = ['1-mount', '3-reactivity'].every((c) => results.criteria[c].status === 'PASS') &&
    results.criteria['2-lifecycle'].status === 'AUTO-PASS-APPROX';
  process.exitCode = allAutomatedPass ? 0 : 1;
} catch (err) {
  console.error('SPIKE SCRIPT ERROR:', err);
  results.fatalError = String(err);
  console.log(JSON.stringify(results, null, 2));
  process.exitCode = 2;
} finally {
  await browser.close();
}
