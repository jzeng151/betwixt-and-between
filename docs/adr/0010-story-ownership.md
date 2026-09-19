# Story ownership

Stories own the narrative tables; accounts own stories and appearance profiles. The migration creates each account's first story with the account's existing ownership UUID, then changes narrative foreign keys to reference stories. Application fields become storyId; the physical user_id column names remain so the old Worker can serve the original story between migration and deployment. Entity IDs, map history, and relationships remain unchanged. A user-insert trigger creates the first story for new accounts through every signup path.

Each tab selects its story in the URL and sends that ID on API requests. The server verifies account ownership before using the existing narrative isolation checks. An omitted selector opens the original story. A shared active-story cookie would let one tab redirect another tab's writes, so switching instead saves this tab's pending work and loads a fresh document. Window snapshots are scoped to account and story; the original story retains its existing snapshot key. Profiles remain account-wide.

Account export now uses format version 2. It includes the stories table and all owned stories' data, with storyId replacing userId on narrative rows. Version 1 downloads keep their original meaning. Story deletion, moving entities between stories, and importing exports are separate operations and are not exposed in this release.

Apply migration 0029 before deploying this Worker. It is compatible with the previous Worker: original-story reads/writes still use the same UUID and columns. Rolling the Worker back hides additional stories without deleting their data.
