# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: features.spec.ts >> Characters >> details section contains only Motivation and Notes — not Role
- Location: tests/e2e/features.spec.ts:153:2

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.window[aria-label="Elara"]').locator('.details .field-header')
Expected: 2
Received: 4
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" with timeout 5000ms
  - waiting for locator('.window[aria-label="Elara"]').locator('.details .field-header')
    9 × locator resolved to 4 elements
      - unexpected value "4"

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - dialog "Characters" [ref=e4]:
    - generic [ref=e5]:
      - button "Close" [ref=e6] [cursor=pointer]
      - button "Minimize" [ref=e7] [cursor=pointer]
      - button "Maximize" [ref=e8] [cursor=pointer]
    - generic: Characters
    - generic [ref=e10]:
      - textbox "Character name…" [ref=e12]
      - list [ref=e13]:
        - listitem [ref=e14]:
          - button "E Elara ›" [active] [ref=e15] [cursor=pointer]:
            - generic [ref=e16]: E
            - generic [ref=e18]: Elara
            - generic [ref=e19]: ›
  - dialog "Elara" [ref=e20]:
    - generic [ref=e21]:
      - button "Close" [ref=e22] [cursor=pointer]
      - button "Minimize" [ref=e23] [cursor=pointer]
      - button "Maximize" [ref=e24] [cursor=pointer]
    - generic: Elara
    - generic [ref=e26]:
      - generic [ref=e27]:
        - button "E" [ref=e28] [cursor=pointer]:
          - generic: E
          - img [ref=e30]
        - generic [ref=e32]:
          - heading "Elara Rename" [level=1] [ref=e33]:
            - generic [ref=e34]:
              - generic [ref=e35]: Elara
              - button "Rename" [ref=e36] [cursor=pointer]:
                - img [ref=e37]
          - generic [ref=e39]:
            - generic [ref=e40]:
              - generic [ref=e41]: Role
              - button "Edit role" [ref=e42] [cursor=pointer]:
                - img [ref=e43]
            - generic [ref=e45]:
              - generic [ref=e46]: Affiliation
              - button "Edit affiliation" [ref=e47] [cursor=pointer]:
                - img [ref=e48]
      - generic [ref=e50]:
        - paragraph [ref=e51]: Allies
        - button "+" [ref=e54] [cursor=pointer]
      - generic [ref=e55]:
        - paragraph [ref=e56]: Rivals
        - button "+" [ref=e59] [cursor=pointer]
      - generic [ref=e60]:
        - paragraph [ref=e61]: Mentors
        - button "+" [ref=e64] [cursor=pointer]
      - generic [ref=e65]:
        - paragraph [ref=e66]: Locations
        - button "+" [ref=e69] [cursor=pointer]
      - generic [ref=e70]:
        - paragraph [ref=e71]: Key Events
        - button "+" [ref=e74] [cursor=pointer]
      - separator [ref=e75]
      - generic [ref=e76]:
        - generic [ref=e78]: Timeline color
        - group "Timeline color" [ref=e79]:
          - button "#c8942a" [ref=e80] [cursor=pointer]
          - button "#2dd4bf" [ref=e81] [cursor=pointer]
          - button "#818cf8" [ref=e82] [cursor=pointer]
          - button "#86efac" [ref=e83] [cursor=pointer]
          - button "#f472b6" [ref=e84] [cursor=pointer]
          - button "#fbbf24" [ref=e85] [cursor=pointer]
          - button "#34d399" [ref=e86] [cursor=pointer]
          - button "#60a5fa" [ref=e87] [cursor=pointer]
          - textbox "#rrggbb" [ref=e88]
        - generic [ref=e90]: Show on timeline
        - radiogroup "Show on timeline" [ref=e91]:
          - generic [ref=e92] [cursor=pointer]:
            - radio "Name only" [ref=e93]
            - generic [ref=e94]: Name only
          - generic [ref=e95] [cursor=pointer]:
            - radio "Name + note snippet (default)" [checked] [ref=e96]
            - generic [ref=e97]: Name + note snippet (default)
          - generic [ref=e98] [cursor=pointer]:
            - radio "Custom field" [ref=e99]
            - generic [ref=e100]: Custom field
        - generic [ref=e101]:
          - generic [ref=e102]: Motivation
          - button "Edit" [ref=e103] [cursor=pointer]
        - paragraph [ref=e104]: Not set.
        - generic [ref=e105]:
          - generic [ref=e106]: Notes
          - button "Edit" [ref=e107] [cursor=pointer]
        - paragraph [ref=e108]: Not set.
  - generic [ref=e110]:
    - button "👤 Characters 2" [ref=e112] [cursor=pointer]:
      - generic [ref=e113]: 👤
      - generic [ref=e114]: Characters
      - generic [ref=e115]: "2"
    - button "🕸 Story Graph" [ref=e118] [cursor=pointer]:
      - generic [ref=e119]: 🕸
      - generic [ref=e120]: Story Graph
    - button "📅 Timeline" [ref=e122] [cursor=pointer]:
      - generic [ref=e123]: 📅
      - generic [ref=e124]: Timeline
    - button "🗺 World Map" [ref=e126] [cursor=pointer]:
      - generic [ref=e127]: 🗺
      - generic [ref=e128]: World Map
    - button "📝 Wiki" [ref=e130] [cursor=pointer]:
      - generic [ref=e131]: 📝
      - generic [ref=e132]: Wiki
```

# Test source

```ts
  66  | 		await request.post('/api/entities', { data: { type: 'Note', name: 'First Note' } });
  67  | 		await request.post('/api/entities', { data: { type: 'Note', name: 'Second Note' } });
  68  | 		await page.goto('/');
  69  | 
  70  | 		await page.click('button[title="Wiki"]');
  71  | 		const win = page.locator('.window[aria-label="Wiki"]');
  72  | 		await expect(win).toBeVisible();
  73  | 
  74  | 		await win.locator('.note-item', { hasText: 'Second Note' }).click();
  75  | 		await expect(win.locator('.note-title')).toHaveText('Second Note');
  76  | 	});
  77  | 
  78  | 	test('no search results shows "No results." message', async ({ page, request }) => {
  79  | 		await request.post('/api/entities', { data: { type: 'Note', name: 'Alpha Note' } });
  80  | 		await page.goto('/');
  81  | 
  82  | 		await page.click('button[title="Wiki"]');
  83  | 		const win = page.locator('.window[aria-label="Wiki"]');
  84  | 		await expect(win).toBeVisible();
  85  | 
  86  | 		await win.locator('input[aria-label="Search notes"]').fill('zzznomatch');
  87  | 		await expect(win.locator('.empty-sidebar')).toHaveText('No results.');
  88  | 	});
  89  | });
  90  | 
  91  | test.describe('Characters', () => {
  92  | 	test.beforeEach(async ({ page, request }) => {
  93  | 		await clearEntities(request);
  94  | 		await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
  95  | 		await page.goto('/');
  96  | 	});
  97  | 
  98  | 	test('character list shows role badge and affiliation when set', async ({ page, request }) => {
  99  | 		const char = await (
  100 | 			await request.post('/api/entities', { data: { type: 'Character', name: 'Elara' } })
  101 | 		).json();
  102 | 		await request.patch(`/api/entities/${char.id}`, {
  103 | 			data: { data: { role: 'Protagonist', affiliation: 'The Conclave' } }
  104 | 		});
  105 | 		await page.goto('/');
  106 | 
  107 | 		await page.click('button[title="Characters"]');
  108 | 		const win = page.locator('.window[aria-label="Characters"]');
  109 | 		await expect(win.locator('.char-role-badge').first()).toHaveText('Protagonist', { timeout: 3000 });
  110 | 		await expect(win.locator('.char-affiliation').first()).toHaveText('The Conclave');
  111 | 	});
  112 | 
  113 | 	test('set role via header pencil → badge appears in header', async ({ page, request }) => {
  114 | 		await request.post('/api/entities', { data: { type: 'Character', name: 'Elara' } });
  115 | 		await page.goto('/');
  116 | 
  117 | 		await page.click('button[title="Characters"]');
  118 | 		const listWin = page.locator('.window[aria-label="Characters"]');
  119 | 		await expect(listWin.locator('.char-row')).toHaveCount(1, { timeout: 3000 });
  120 | 		await listWin.locator('.char-row').first().click();
  121 | 
  122 | 		const detailWin = page.locator('.window[aria-label="Elara"]');
  123 | 		await expect(detailWin).toBeVisible();
  124 | 
  125 | 		// Hover to reveal the pencil, force-click since opacity:0 until hover
  126 | 		await detailWin.locator('.header-meta').hover();
  127 | 		await detailWin.locator('button[title="Edit role"]').click({ force: true });
  128 | 		await detailWin.locator('.hfield-select').selectOption('Antagonist');
  129 | 
  130 | 		await expect(detailWin.locator('.role-badge')).toHaveText('Antagonist', { timeout: 3000 });
  131 | 	});
  132 | 
  133 | 	test('set affiliation via header pencil → text appears in header', async ({ page, request }) => {
  134 | 		await request.post('/api/entities', { data: { type: 'Character', name: 'Elara' } });
  135 | 		await page.goto('/');
  136 | 
  137 | 		await page.click('button[title="Characters"]');
  138 | 		const listWin = page.locator('.window[aria-label="Characters"]');
  139 | 		await expect(listWin.locator('.char-row')).toHaveCount(1, { timeout: 3000 });
  140 | 		await listWin.locator('.char-row').first().click();
  141 | 
  142 | 		const detailWin = page.locator('.window[aria-label="Elara"]');
  143 | 		await expect(detailWin).toBeVisible();
  144 | 
  145 | 		await detailWin.locator('.header-meta').hover();
  146 | 		await detailWin.locator('button[title="Edit affiliation"]').click({ force: true });
  147 | 		await detailWin.locator('.hfield-input').fill('The Conclave');
  148 | 		await detailWin.locator('.hfield-input').press('Enter');
  149 | 
  150 | 		await expect(detailWin.locator('.hfield-text')).toHaveText('The Conclave', { timeout: 3000 });
  151 | 	});
  152 | 
  153 | 	test('details section contains only Motivation and Notes — not Role', async ({ page, request }) => {
  154 | 		await request.post('/api/entities', { data: { type: 'Character', name: 'Elara' } });
  155 | 		await page.goto('/');
  156 | 
  157 | 		await page.click('button[title="Characters"]');
  158 | 		const listWin = page.locator('.window[aria-label="Characters"]');
  159 | 		await expect(listWin.locator('.char-row')).toHaveCount(1, { timeout: 3000 });
  160 | 		await listWin.locator('.char-row').first().click();
  161 | 
  162 | 		const detailWin = page.locator('.window[aria-label="Elara"]');
  163 | 		await expect(detailWin).toBeVisible();
  164 | 
  165 | 		// Two field headers: Motivation + Notes. Role lives in the header, not here.
> 166 | 		await expect(detailWin.locator('.details .field-header')).toHaveCount(2);
      |                                                             ^ Error: expect(locator).toHaveCount(expected) failed
  167 | 		await expect(detailWin.locator('.details')).not.toContainText('Role');
  168 | 	});
  169 | });
  170 | 
  171 | test.describe('World Map', () => {
  172 | 	test.beforeEach(async ({ page, request }) => {
  173 | 		await clearEntities(request);
  174 | 		await page.addInitScript(() => localStorage.setItem('tutorial-dismissed', 'true'));
  175 | 		await page.goto('/');
  176 | 	});
  177 | 
  178 | 	test('empty state → create location → card appears', async ({ page }) => {
  179 | 		await page.click('button[title="World Map"]');
  180 | 		const win = page.locator('.window[aria-label="World Map"]');
  181 | 		await expect(win).toBeVisible();
  182 | 
  183 | 		await expect(win.locator('.empty-state')).toBeVisible();
  184 | 		await expect(win.locator('.empty-state p')).toContainText('No locations yet');
  185 | 
  186 | 		await win.locator('.empty-state button').click();
  187 | 		await expect(win.locator('.loc-card')).toHaveCount(1, { timeout: 3000 });
  188 | 		await expect(win.locator('.loc-name').first()).toHaveText('New Location');
  189 | 	});
  190 | 
  191 | 	test('second location added via actions-row button', async ({ page }) => {
  192 | 		await page.click('button[title="World Map"]');
  193 | 		const win = page.locator('.window[aria-label="World Map"]');
  194 | 		await expect(win).toBeVisible();
  195 | 
  196 | 		await win.locator('.empty-state button').click();
  197 | 		await expect(win.locator('.loc-card')).toHaveCount(1, { timeout: 3000 });
  198 | 
  199 | 		await win.locator('.actions-row button').click();
  200 | 		await expect(win.locator('.loc-card')).toHaveCount(2, { timeout: 3000 });
  201 | 	});
  202 | 
  203 | 	test('location card shows linked character chip', async ({ page, request }) => {
  204 | 		const loc = await (
  205 | 			await request.post('/api/entities', { data: { type: 'Location', name: 'The Ashenveil' } })
  206 | 		).json();
  207 | 		const char = await (
  208 | 			await request.post('/api/entities', { data: { type: 'Character', name: 'Scout' } })
  209 | 		).json();
  210 | 		await request.post('/api/relationships', {
  211 | 			data: { fromId: char.id, toId: loc.id, type: 'located_at' }
  212 | 		});
  213 | 		await page.goto('/');
  214 | 
  215 | 		await page.click('button[title="World Map"]');
  216 | 		const win = page.locator('.window[aria-label="World Map"]');
  217 | 		await expect(win.locator('.loc-name').first()).toHaveText('The Ashenveil', { timeout: 3000 });
  218 | 		await expect(win.locator('.entity-chip').first()).toContainText('Scout');
  219 | 	});
  220 | 
  221 | 	test('multiple locations each get their own card', async ({ page, request }) => {
  222 | 		await request.post('/api/entities', { data: { type: 'Location', name: 'Ashenveil' } });
  223 | 		await request.post('/api/entities', { data: { type: 'Location', name: 'The Citadel' } });
  224 | 		await request.post('/api/entities', { data: { type: 'Location', name: 'Duskport' } });
  225 | 		await page.goto('/');
  226 | 
  227 | 		await page.click('button[title="World Map"]');
  228 | 		const win = page.locator('.window[aria-label="World Map"]');
  229 | 		await expect(win).toBeVisible();
  230 | 		await expect(win.locator('.loc-card')).toHaveCount(3, { timeout: 3000 });
  231 | 	});
  232 | });
  233 | 
```