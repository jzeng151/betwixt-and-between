// Seed dataset: The Prestige by Christopher Priest (1995).
//
// Two rival Victorian-era stage magicians — Alfred Borden and Rupert
// Angier — and the secrets they keep, framed by their modern-day
// descendants uncovering the truth at Caldlow Hall.
//
// Five acts mirror the novel's framing structure (Andrew Westley /
// Borden's journal / Olivia / Angier's journal / Kate Angier).
// Relationships intentionally include multi-rel cases (Cutter is
// mentor to both Borden and Angier; rivalries cross with alliances)
// to exercise the GraphCanvas fan-out logic. Two characters share
// the same color to exercise the duplicate-color UX.
//
// Entities carry `data._seed = 'prestige'` for idempotent re-seeding.
import type { SeedStory } from './types.js';

export const PRESTIGE: SeedStory = {
  metadata: {
    title: 'The Prestige',
    author: 'Christopher Priest',
    seedKey: 'prestige',
    description:
      "Two rival Victorian magicians and the impossible secrets behind their signature illusions. Five framing-narrative acts: Andrew Westley investigates → Borden's journal → Olivia's interlude → Angier's journal → Kate Angier closes the frame."
  },

  acts: [
    {
      name: 'Act 1: Andrew Westley',
      position: 1,
      summary:
        "Modern frame. Andrew Westley, a journalist with vague memories of having a twin brother, is sent to Caldlow Hall in Derbyshire on an assignment that turns into something stranger than reporting."
    },
    {
      name: "Act 2: Alfred Borden's Journal",
      position: 2,
      summary:
        "Victorian. Borden's coded memoir: apprenticed under Cutter, marries Sarah, invents 'The New Transported Man,' begins a feud with Angier that defines both their careers — and lives a secret that even his wife never knows."
    },
    {
      name: 'Act 3: Olivia Svenson',
      position: 3,
      summary:
        'Brief Victorian interlude. The woman caught between the two magicians narrates the cost of having loved both.'
    },
    {
      name: "Act 4: Rupert Angier's Journal",
      position: 4,
      summary:
        "Victorian. Angier's account: Julia's death in the water-tank, the obsession with replicating Borden's trick, the journey to Colorado Springs, and the apparatus that finally beats Borden — at a price no one understood until Caldlow."
    },
    {
      name: 'Act 5: Kate Angier',
      position: 5,
      summary:
        'Modern frame. Kate Angier reveals what she saw as a child in the Caldlow vault and what is still down there.'
    }
  ],

  locations: [
    {
      name: 'London',
      summary: 'The Victorian theater circuit where both magicians built their reputations.'
    },
    {
      name: 'Pangbourne',
      summary: "Riverside town outside London where Sarah Borden raises Nicholas — and where Borden's twin lives in the meantime."
    },
    {
      name: "Hesketh Unwin's Theatre",
      summary: 'The London variety house that hosts most of the rivalry pieces during their early careers.'
    },
    {
      name: 'Caldlow Hall',
      summary: "The Angier ancestral estate in Derbyshire. Hereditary seat of Lord Caldlow — Rupert Angier's secret aristocratic identity. Vast cellar."
    },
    {
      name: 'Colorado Springs',
      summary: 'Tesla\'s American laboratory, accessible only by a long rail journey. Where the apparatus is built.'
    },
    {
      name: "Tesla's Lab",
      summary: 'A hangar-sized building of coils, generators, and arcing electricity. The duplicating apparatus is assembled, tested on a cat, and shipped from here.'
    },
    {
      name: 'New York',
      summary: 'Edison territory; vaudeville circuit. Tesla loses the AC-vs-DC war here while Angier waits in Colorado.'
    },
    {
      name: 'The Caldlow Vault',
      summary: 'The cellar beneath Caldlow Hall. What Andrew finds there in Act 5 is the final answer to the trick.'
    }
  ],

  characters: [
    // Borden's circle
    {
      name: 'Alfred Borden',
      role: 'Protagonist',
      affiliation: 'Magician',
      motivation:
        "To perform the perfect illusion. To protect the secret that makes 'The Transported Man' impossible.",
      notes:
        "Stage name 'Le Professeur de la Magie.' Workmanlike, taciturn, devoted to craft. Half of a shared identity he and his brother have lived since childhood.",
      color: '#c8942a',
      timelineLabel: { mode: 'name-and-note' }
    },
    {
      name: 'Frederick Borden',
      role: 'Supporting',
      affiliation: 'Magician (hidden)',
      motivation: "To keep the secret of the shared identity at any cost — even his own life.",
      notes:
        "Alfred's twin. Lives a half-life: the public name belongs to whichever of them is on stage. Stays in Pangbourne with Sarah while Alfred performs, and vice versa.",
      color: '#c8942a',
      timelineLabel: { mode: 'name-and-note' }
    },
    {
      name: 'Sarah Borden',
      role: 'Supporting',
      affiliation: 'Borden household',
      motivation: 'To love a husband who is sometimes inexplicably a stranger.',
      notes:
        "Marries Alfred in good faith. Comes to feel the shifts — bruised by them — and never gets the explanation.",
      color: '#f472b6',
      timelineLabel: { mode: 'name-only' }
    },
    {
      name: 'Nicholas Borden',
      role: 'Supporting',
      affiliation: 'Borden household',
      motivation: 'A child of the deception, raised under it.',
      notes: "Alfred and Sarah's son. The line that descends to Andrew Westley.",
      color: '#86efac',
      timelineLabel: { mode: 'name-only' }
    },
    {
      name: 'John Henry Cutter',
      role: 'Mentor',
      affiliation: 'Independent ingenieur',
      motivation: 'To build the apparatus the trick requires, and keep his name off the playbill.',
      notes:
        'The engineer behind the cabinets, mirrors, and machinery. Apprenticed Borden first, then sold his services to Angier. Bridges both circles uneasily.',
      color: '#fbbf24',
      timelineLabel: { mode: 'name-and-note' }
    },
    {
      name: 'Olivia Svenson',
      role: 'Ally',
      affiliation: "Angier's stage company → Borden's",
      motivation: 'To survive in a world where two men are using her against each other.',
      notes:
        "Stage assistant. Begins as Angier's plant inside Borden's company, falls for Borden, switches sides, and loses both.",
      color: '#818cf8',
      timelineLabel: { mode: 'name-and-note' }
    },

    // Angier's circle
    {
      name: 'Rupert Angier',
      role: 'Protagonist',
      affiliation: 'Magician (and secretly Lord Caldlow)',
      motivation:
        "To match — and surpass — Borden's signature illusion. To never again lose what Julia represented.",
      notes:
        "Stage name 'The Great Danton.' Born Rupert Caldlow; performs under an assumed name to avoid his hereditary title. Polished, theatrical, ruthless.",
      color: '#2dd4bf',
      timelineLabel: { mode: 'name-and-note' }
    },
    {
      name: 'Julia Angier',
      role: 'Supporting',
      affiliation: "Angier's stage company",
      motivation: 'To assist her husband in the act, including the underwater escape.',
      notes:
        "Rupert's first wife and on-stage assistant. Killed during the water-tank illusion when a sabotaged knot fails to release. Her death is the seed of the rivalry's escalation.",
      color: '#60a5fa',
      timelineLabel: { mode: 'name-only' }
    },
    {
      name: 'Hugh Angier',
      role: 'Supporting',
      affiliation: 'House of Caldlow',
      motivation: 'To keep the family name from disgracing itself with theatrical work.',
      notes:
        "Rupert's father. The reason 'Rupert Angier' exists at all — the title 'Lord Caldlow' must remain off any playbill.",
      color: '#94a3b8',
      timelineLabel: { mode: 'name-only' }
    },

    // The inventors
    {
      name: 'Nikola Tesla',
      role: 'Mentor',
      affiliation: 'Independent inventor',
      motivation: 'To prove the apparatus can do what theory says it can.',
      notes:
        "Builds the duplicating machine for Angier in Colorado Springs. Genius, financially precarious, hounded by Edison. Treats the commission as a serious physics problem.",
      color: '#34d399',
      timelineLabel: { mode: 'name-and-note' }
    },
    {
      name: 'Alley',
      role: 'Supporting',
      affiliation: "Tesla's lab",
      motivation: 'Loyal lieutenant; runs the machinery Tesla designs.',
      notes:
        "Tesla's lab assistant. Attends every test of the apparatus, including the cat. Knows what the device actually does.",
      color: '#86efac',
      timelineLabel: { mode: 'name-only' }
    },
    {
      name: 'Thomas Edison',
      role: 'Antagonist',
      affiliation: 'Edison Electric',
      motivation: 'To bury Tesla and the AC system under DC.',
      notes:
        'Off-stage antagonist. His pressure on the Colorado Springs lab forecloses Angier\'s window with Tesla.',
      color: '#ef4444',
      timelineLabel: { mode: 'name-only' }
    },

    // Modern frame
    {
      name: 'Andrew Westley',
      role: 'Protagonist',
      affiliation: 'Journalist',
      motivation: 'To find his lost twin. To explain the half-memories he has carried since childhood.',
      notes:
        "Adopted descendant of Nicholas Borden. Sent to Caldlow Hall on an assignment that becomes the inheritance he didn't know he had.",
      color: '#a855f7',
      timelineLabel: { mode: 'name-and-note' }
    },
    {
      name: 'Kate Angier',
      role: 'Protagonist',
      affiliation: 'House of Caldlow',
      motivation: "To finish what her great-grandfather couldn't, and to tell someone what she saw as a child.",
      notes:
        "Rupert Angier's great-granddaughter. Lives at Caldlow Hall as the last of the line. Custodian of the journals.",
      color: '#fb7185',
      timelineLabel: { mode: 'name-and-note' }
    },
    {
      name: 'Nick Westley',
      role: 'Supporting',
      affiliation: 'Westley family',
      motivation: 'To raise Andrew without telling him what was lost.',
      notes: "Andrew's adoptive father. Hands him the manuscript that starts the modern frame.",
      color: '#94a3b8',
      timelineLabel: { mode: 'name-only' }
    },
    {
      name: 'Lady Katherine Angier',
      role: 'Supporting',
      affiliation: 'House of Caldlow',
      motivation: 'To preserve what is left of the estate.',
      notes: "Kate's grandmother. Lived through the worst years at Caldlow.",
      color: '#94a3b8',
      timelineLabel: { mode: 'name-only' }
    },

    // Supporting Victorian
    {
      name: 'Hesketh Unwin',
      role: 'Supporting',
      affiliation: "Hesketh Unwin's Theatre",
      motivation: 'To book the act that fills the house tonight.',
      notes:
        "Theater manager. The booking arbiter who plays Borden and Angier off each other for ticket sales.",
      color: '#94a3b8',
      timelineLabel: { mode: 'name-only' }
    },
    {
      name: 'Ching Ling Foo',
      role: 'Supporting',
      affiliation: 'Touring magician',
      motivation: 'To preserve the secret of his own illusion by living the lie completely.',
      notes:
        "Real Chinese magician whose 'Disappearing Fish-Bowl' act runs on the same kind of total-life secret as Borden's twin pact. Borden recognizes the method on first viewing.",
      color: '#fbbf24',
      timelineLabel: { mode: 'name-and-note' }
    }
  ],

  events: [
    // Act 1 — Andrew's modern frame
    {
      name: 'Andrew receives the Borden manuscript',
      summary:
        "Nick Westley hands Andrew an old, partially-decoded journal — Alfred Borden's memoir — and the magazine assignment that goes with it."
    },
    {
      name: 'Andrew arrives at Caldlow Hall',
      summary:
        'After the long drive into Derbyshire, Andrew meets the heir to the estate at the gate.'
    },
    {
      name: 'Andrew meets Kate Angier',
      summary:
        'The two descendants compare what each was told and what each was not. Kate has her great-grandfather\'s journal too.'
    },

    // Act 2 — Borden's journal
    {
      name: "Borden apprenticed to Cutter",
      summary: "Young Alfred enters Cutter's workshop and learns how the cabinets really work."
    },
    {
      name: "Borden sees Ching Ling Foo perform",
      summary:
        "Borden recognizes the secret of the 'Disappearing Fish-Bowl' instantly — and resolves to build a trick that requires the same kind of total commitment."
    },
    {
      name: 'Borden marries Sarah',
      summary: 'A small ceremony. The arrangement with the brother is already in place.'
    },
    {
      name: "Borden invents 'The New Transported Man'",
      summary:
        'Two cabinets, two stages, one man — apparently. The trick instantly outclasses Angier\'s illusions and starts the rivalry.'
    },
    {
      name: 'Julia Angier dies in the water tank',
      summary:
        "Sabotaged knot, stage assistant Borden in the wings; Julia drowns before the cabinet can be opened. Angier blames Borden directly."
    },
    {
      name: 'Angier sabotages Borden\'s bullet catch',
      summary:
        "Retaliation. Borden takes the shot in the hand, loses two fingers, performs through the bandages."
    },
    {
      name: 'Olivia switches sides',
      summary:
        "Angier sends Olivia into Borden's company as a spy; she ends up loving Borden and refusing to report back."
    },
    {
      name: 'Sarah breaks down',
      summary:
        "She has felt the shifts in her husband for years and finally cannot reconcile them. The household never recovers."
    },

    // Act 3 — Olivia
    {
      name: "Olivia's confession",
      summary:
        'Briefly — to herself, to a confidant, to no one — Olivia narrates the impossible position she has been kept in by both magicians.'
    },

    // Act 4 — Angier's journal
    {
      name: "Angier travels to Colorado Springs",
      summary:
        "Convinced Borden's trick is technological, not theatrical, Angier crosses the Atlantic with letters of credit and finds Tesla."
    },
    {
      name: 'Tesla agrees to build the apparatus',
      summary:
        "Tesla treats the commission as physics. Alley supervises construction. The lab works through the night."
    },
    {
      name: 'The cat test',
      summary:
        'A cat is sent through the apparatus. There are now two cats — but one is wrong. Angier sees what the device does, and what it costs, and orders construction completed anyway.'
    },
    {
      name: 'Edison shuts down the Colorado lab',
      summary:
        "Tesla's funding evaporates under Edison's pressure. The completed apparatus is crated and shipped to Angier in London just before the lab closes."
    },
    {
      name: "Angier debuts 'In a Flash'",
      summary:
        "The apparatus illusion. A sphere of arcing electricity, a flash, and the magician appears at the back of the gallery — instantly. Borden cannot explain it."
    },
    {
      name: 'The drowning duplicates',
      summary:
        "Each performance produces a man at the back of the gallery and a man in the trapdoored tank below the stage. The original drowns. A new Angier walks home."
    },
    {
      name: "Borden infiltrates Angier's stage",
      summary:
        "Determined to learn the secret, Borden gets backstage during a performance, sees the tank, and writes what he sees into his journal."
    },

    // Act 5 — Kate's frame, Andrew's descent
    {
      name: 'Kate as a child sees the cellar',
      summary:
        'Caldlow Hall, decades ago. A small Kate watches something in the cellar that she has never been able to describe out loud. The journal pages around this memory are the ones missing from her copy.'
    },
    {
      name: 'Andrew descends to the Caldlow vault',
      summary:
        "With Kate's permission, Andrew opens the cellar door under the kitchen passage and goes down."
    },
    {
      name: "Andrew meets what's still there",
      summary:
        'The duplicates Angier created — the ones the apparatus left intact when their originals drowned — never decayed. The vault is full of them. One of them is still aware.'
    }
  ],

  scenes: [
    // Act 1 — Andrew Westley (3 scenes)
    {
      name: 'The manuscript arrives',
      parentAct: 'Act 1: Andrew Westley',
      summary: 'Nick Westley hands Andrew the journal and the magazine assignment.'
    },
    {
      name: 'Drive to Caldlow',
      parentAct: 'Act 1: Andrew Westley',
      summary: 'Long road into Derbyshire. Andrew rereads the partially-decoded passages.'
    },
    {
      name: 'Meeting Kate at the gate',
      parentAct: 'Act 1: Andrew Westley',
      summary: 'First conversation between the two descendants. They compare what each was told.'
    },

    // Act 2 — Borden's journal (7 scenes)
    {
      name: 'Apprenticeship under Cutter',
      parentAct: "Act 2: Alfred Borden's Journal",
      summary: 'Borden enters the workshop and learns how the cabinets really work.'
    },
    {
      name: 'Recognizing the Chinese magician',
      parentAct: "Act 2: Alfred Borden's Journal",
      summary: "Borden sees Ching Ling Foo's act and grasps the kind of trick that requires a whole hidden life."
    },
    {
      name: 'Marriage and the early years',
      parentAct: "Act 2: Alfred Borden's Journal",
      summary: 'Borden marries Sarah; the brother arrangement is already in place. Nicholas is born.'
    },
    {
      name: 'The Transported Man debuts',
      parentAct: "Act 2: Alfred Borden's Journal",
      summary: "The signature illusion goes on stage at Hesketh Unwin's. Angier sees it and cannot reproduce it."
    },
    {
      name: 'The Julia incident',
      parentAct: "Act 2: Alfred Borden's Journal",
      summary: "Borden was the assistant tying the underwater knot. Julia drowns. Angier blames him and never lets it go."
    },
    {
      name: 'The bullet-catch retaliation',
      parentAct: "Act 2: Alfred Borden's Journal",
      summary: "Angier sabotages Borden's bullet catch. Borden loses two fingers and performs through the bandages."
    },
    {
      name: "Sarah's collapse",
      parentAct: "Act 2: Alfred Borden's Journal",
      summary: 'The years of feeling her husband shift between two men finally undo Sarah.'
    },

    // Act 3 — Olivia (1 scene; the act is brief)
    {
      name: 'Olivia between two men',
      parentAct: 'Act 3: Olivia Svenson',
      summary: 'A single tight chapter from her view: spy, lover, betrayer, none of which she chose entirely.'
    },

    // Act 4 — Angier's journal (7 scenes)
    {
      name: 'After Julia',
      parentAct: "Act 4: Rupert Angier's Journal",
      summary: 'Grief, blame, and the resolve to ruin Borden however long it takes.'
    },
    {
      name: 'The decision to go to America',
      parentAct: "Act 4: Rupert Angier's Journal",
      summary: 'Convinced the Transported Man is technological, not theatrical, Angier sails for Colorado with letters of credit.'
    },
    {
      name: 'Tesla in Colorado',
      parentAct: "Act 4: Rupert Angier's Journal",
      summary: 'First meeting at the lab. Tesla treats the commission as physics; Angier treats it as desperation.'
    },
    {
      name: 'The cat test',
      parentAct: "Act 4: Rupert Angier's Journal",
      summary: 'A cat is sent through the apparatus. There are now two cats — but one is wrong. Angier orders construction completed anyway.'
    },
    {
      name: 'Edison closes in',
      parentAct: "Act 4: Rupert Angier's Journal",
      summary: "Tesla's funding evaporates under Edison's pressure. The completed apparatus is crated and shipped just before the lab closes."
    },
    {
      name: "'In a Flash' on stage",
      parentAct: "Act 4: Rupert Angier's Journal",
      summary: 'The apparatus illusion debuts. Borden cannot explain it.'
    },
    {
      name: 'The vault accumulates',
      parentAct: "Act 4: Rupert Angier's Journal",
      summary: 'Each performance leaves a body in the tank below the stage. Angier ships them to Caldlow.'
    },

    // Act 5 — Kate Angier (3 scenes)
    {
      name: "Kate's childhood memory",
      parentAct: 'Act 5: Kate Angier',
      summary: 'The cellar at Caldlow, decades ago. A small Kate sees what she has never been able to describe out loud.'
    },
    {
      name: 'The descent',
      parentAct: 'Act 5: Kate Angier',
      summary: 'Andrew opens the cellar door under the kitchen passage and goes down with Kate.'
    },
    {
      name: 'The vault revealed',
      parentAct: 'Act 5: Kate Angier',
      summary: 'The duplicates Angier left intact never decayed. One of them is still aware. The novel ends here.'
    }
  ],

  relationships: [
    // Core rivalries
    { from: 'Alfred Borden', to: 'Rupert Angier', type: 'rivals' },
    { from: 'Nikola Tesla', to: 'Thomas Edison', type: 'rivals' },

    // The twin pact (multi-rel: brothers + co-conspirators)
    { from: 'Alfred Borden', to: 'Frederick Borden', type: 'allied_with' },

    // Mentors (Cutter is the multi-mentor case → fan-out test)
    { from: 'John Henry Cutter', to: 'Alfred Borden', type: 'mentor_of' },
    { from: 'John Henry Cutter', to: 'Rupert Angier', type: 'mentor_of' },
    { from: 'Nikola Tesla', to: 'Rupert Angier', type: 'mentor_of' },

    // Borden circle alliances
    { from: 'Alfred Borden', to: 'Sarah Borden', type: 'allied_with' },
    { from: 'Alfred Borden', to: 'John Henry Cutter', type: 'allied_with' },
    { from: 'Frederick Borden', to: 'Sarah Borden', type: 'allied_with' },
    { from: 'Sarah Borden', to: 'Nicholas Borden', type: 'allied_with' },
    { from: 'Olivia Svenson', to: 'Alfred Borden', type: 'allied_with' },

    // Angier circle alliances
    { from: 'Rupert Angier', to: 'John Henry Cutter', type: 'allied_with' },
    { from: 'Rupert Angier', to: 'Julia Angier', type: 'allied_with' },
    { from: 'Rupert Angier', to: 'Hugh Angier', type: 'allied_with' },
    { from: 'Rupert Angier', to: 'Olivia Svenson', type: 'allied_with' },
    { from: 'Nikola Tesla', to: 'Alley', type: 'allied_with' },

    // The Olivia triangle: she allies BOTH (multi-rel cross)
    // (Olivia → Borden allied_with already above.) Adding Angier ↔ Olivia
    // already exists; the rivalry pair Borden ↔ Angier is via her too.

    // Modern frame
    { from: 'Andrew Westley', to: 'Kate Angier', type: 'allied_with' },
    { from: 'Andrew Westley', to: 'Nick Westley', type: 'allied_with' },
    { from: 'Kate Angier', to: 'Lady Katherine Angier', type: 'allied_with' },

    // Located_at — Victorian
    { from: 'Alfred Borden', to: 'London', type: 'located_at' },
    { from: 'Frederick Borden', to: 'Pangbourne', type: 'located_at' },
    { from: 'Sarah Borden', to: 'Pangbourne', type: 'located_at' },
    { from: 'Nicholas Borden', to: 'Pangbourne', type: 'located_at' },
    { from: 'John Henry Cutter', to: 'London', type: 'located_at' },
    { from: 'Rupert Angier', to: 'London', type: 'located_at' },
    { from: 'Rupert Angier', to: 'Caldlow Hall', type: 'located_at' },
    { from: 'Julia Angier', to: 'London', type: 'located_at' },
    { from: 'Hugh Angier', to: 'Caldlow Hall', type: 'located_at' },
    { from: 'Nikola Tesla', to: 'Colorado Springs', type: 'located_at' },
    { from: 'Alley', to: 'Colorado Springs', type: 'located_at' },
    { from: 'Thomas Edison', to: 'New York', type: 'located_at' },
    { from: 'Olivia Svenson', to: 'London', type: 'located_at' },
    { from: 'Hesketh Unwin', to: 'London', type: 'located_at' },
    { from: 'Ching Ling Foo', to: 'London', type: 'located_at' },

    // Located_at — Modern
    { from: 'Andrew Westley', to: 'London', type: 'located_at' },
    { from: 'Kate Angier', to: 'Caldlow Hall', type: 'located_at' },

    // Events take_place_at locations
    { from: 'Andrew arrives at Caldlow Hall', to: 'Caldlow Hall', type: 'takes_place_at' },
    { from: 'Andrew meets Kate Angier', to: 'Caldlow Hall', type: 'takes_place_at' },
    { from: 'Borden apprenticed to Cutter', to: 'London', type: 'takes_place_at' },
    { from: 'Borden sees Ching Ling Foo perform', to: "Hesketh Unwin's Theatre", type: 'takes_place_at' },
    { from: 'Borden marries Sarah', to: 'Pangbourne', type: 'takes_place_at' },
    { from: "Borden invents 'The New Transported Man'", to: "Hesketh Unwin's Theatre", type: 'takes_place_at' },
    { from: 'Julia Angier dies in the water tank', to: "Hesketh Unwin's Theatre", type: 'takes_place_at' },
    { from: 'Angier sabotages Borden\'s bullet catch', to: "Hesketh Unwin's Theatre", type: 'takes_place_at' },
    { from: 'Sarah breaks down', to: 'Pangbourne', type: 'takes_place_at' },
    { from: "Angier travels to Colorado Springs", to: 'Colorado Springs', type: 'takes_place_at' },
    { from: 'Tesla agrees to build the apparatus', to: "Tesla's Lab", type: 'takes_place_at' },
    { from: 'The cat test', to: "Tesla's Lab", type: 'takes_place_at' },
    { from: 'Edison shuts down the Colorado lab', to: 'Colorado Springs', type: 'takes_place_at' },
    { from: "Angier debuts 'In a Flash'", to: "Hesketh Unwin's Theatre", type: 'takes_place_at' },
    { from: 'The drowning duplicates', to: "Hesketh Unwin's Theatre", type: 'takes_place_at' },
    { from: "Borden infiltrates Angier's stage", to: "Hesketh Unwin's Theatre", type: 'takes_place_at' },
    { from: 'Kate as a child sees the cellar', to: 'The Caldlow Vault', type: 'takes_place_at' },
    { from: 'Andrew descends to the Caldlow vault', to: 'The Caldlow Vault', type: 'takes_place_at' },
    { from: "Andrew meets what's still there", to: 'The Caldlow Vault', type: 'takes_place_at' },

    // Caused_by — the causal spine of the rivalry
    {
      from: 'Angier sabotages Borden\'s bullet catch',
      to: 'Julia Angier dies in the water tank',
      type: 'caused_by'
    },
    {
      from: 'Olivia switches sides',
      to: "Borden invents 'The New Transported Man'",
      type: 'caused_by'
    },
    {
      from: 'Sarah breaks down',
      to: 'Olivia switches sides',
      type: 'caused_by'
    },
    {
      from: "Angier travels to Colorado Springs",
      to: "Borden invents 'The New Transported Man'",
      type: 'caused_by'
    },
    {
      from: 'Tesla agrees to build the apparatus',
      to: "Angier travels to Colorado Springs",
      type: 'caused_by'
    },
    {
      from: 'The cat test',
      to: 'Tesla agrees to build the apparatus',
      type: 'caused_by'
    },
    {
      from: 'Edison shuts down the Colorado lab',
      to: 'The cat test',
      type: 'caused_by'
    },
    {
      from: "Angier debuts 'In a Flash'",
      to: 'Edison shuts down the Colorado lab',
      type: 'caused_by'
    },
    {
      from: 'The drowning duplicates',
      to: "Angier debuts 'In a Flash'",
      type: 'caused_by'
    },
    {
      from: "Borden infiltrates Angier's stage",
      to: "Angier debuts 'In a Flash'",
      type: 'caused_by'
    },
    {
      from: 'Andrew descends to the Caldlow vault',
      to: 'Andrew meets Kate Angier',
      type: 'caused_by'
    },
    {
      from: "Andrew meets what's still there",
      to: 'Andrew descends to the Caldlow vault',
      type: 'caused_by'
    },

    // POV — each Act's scenes are narrated by a specific character.
    // (Schema: pov_of points FROM Event/Scene → TO Character.)
    { from: 'The manuscript arrives', to: 'Andrew Westley', type: 'pov_of' },
    { from: 'Drive to Caldlow', to: 'Andrew Westley', type: 'pov_of' },
    { from: 'Meeting Kate at the gate', to: 'Andrew Westley', type: 'pov_of' },

    { from: 'Apprenticeship under Cutter', to: 'Alfred Borden', type: 'pov_of' },
    { from: 'Recognizing the Chinese magician', to: 'Alfred Borden', type: 'pov_of' },
    { from: 'Marriage and the early years', to: 'Alfred Borden', type: 'pov_of' },
    { from: 'The Transported Man debuts', to: 'Alfred Borden', type: 'pov_of' },
    { from: 'The Julia incident', to: 'Alfred Borden', type: 'pov_of' },
    { from: 'The bullet-catch retaliation', to: 'Alfred Borden', type: 'pov_of' },
    { from: "Sarah's collapse", to: 'Alfred Borden', type: 'pov_of' },

    { from: 'Olivia between two men', to: 'Olivia Svenson', type: 'pov_of' },

    { from: 'After Julia', to: 'Rupert Angier', type: 'pov_of' },
    { from: 'The decision to go to America', to: 'Rupert Angier', type: 'pov_of' },
    { from: 'Tesla in Colorado', to: 'Rupert Angier', type: 'pov_of' },
    { from: 'The cat test', to: 'Rupert Angier', type: 'pov_of' },
    { from: 'Edison closes in', to: 'Rupert Angier', type: 'pov_of' },
    { from: "'In a Flash' on stage", to: 'Rupert Angier', type: 'pov_of' },
    { from: 'The vault accumulates', to: 'Rupert Angier', type: 'pov_of' },

    { from: "Kate's childhood memory", to: 'Kate Angier', type: 'pov_of' },
    { from: 'The descent', to: 'Andrew Westley', type: 'pov_of' },
    { from: 'The vault revealed', to: 'Andrew Westley', type: 'pov_of' }
  ],

  intervals: [
    // Modern-frame characters
    { character: 'Andrew Westley', fromAct: 'Act 1: Andrew Westley', toAct: 'Act 1: Andrew Westley' },
    { character: 'Andrew Westley', fromAct: 'Act 5: Kate Angier', toAct: 'Act 5: Kate Angier' },
    { character: 'Kate Angier', fromAct: 'Act 1: Andrew Westley', toAct: 'Act 1: Andrew Westley' },
    { character: 'Kate Angier', fromAct: 'Act 5: Kate Angier', toAct: 'Act 5: Kate Angier' },
    { character: 'Nick Westley', fromAct: 'Act 1: Andrew Westley', toAct: 'Act 1: Andrew Westley' },
    { character: 'Lady Katherine Angier', fromAct: 'Act 5: Kate Angier', toAct: 'Act 5: Kate Angier' },

    // Borden's circle — span Act 2 through Act 4 with appropriate gaps
    { character: 'Alfred Borden', fromAct: "Act 2: Alfred Borden's Journal", toAct: "Act 4: Rupert Angier's Journal" },
    { character: 'Frederick Borden', fromAct: "Act 2: Alfred Borden's Journal", toAct: 'Act 3: Olivia Svenson' },
    {
      character: 'Sarah Borden',
      fromAct: "Act 2: Alfred Borden's Journal",
      toAct: "Act 2: Alfred Borden's Journal",
      fromScene: 'Marriage and the early years',
      toScene: "Sarah's collapse"
    },
    {
      character: 'Nicholas Borden',
      fromAct: "Act 2: Alfred Borden's Journal",
      toAct: "Act 2: Alfred Borden's Journal",
      fromScene: 'Marriage and the early years',
      toScene: "Sarah's collapse"
    },
    { character: 'John Henry Cutter', fromAct: "Act 2: Alfred Borden's Journal", toAct: "Act 4: Rupert Angier's Journal" },
    { character: 'Olivia Svenson', fromAct: "Act 2: Alfred Borden's Journal", toAct: "Act 4: Rupert Angier's Journal" },
    { character: 'Hesketh Unwin', fromAct: "Act 2: Alfred Borden's Journal", toAct: "Act 4: Rupert Angier's Journal" },
    { character: 'Ching Ling Foo', fromAct: "Act 2: Alfred Borden's Journal", toAct: "Act 2: Alfred Borden's Journal" },

    // Angier's circle
    { character: 'Rupert Angier', fromAct: "Act 2: Alfred Borden's Journal", toAct: "Act 4: Rupert Angier's Journal" },
    {
      character: 'Julia Angier',
      fromAct: "Act 2: Alfred Borden's Journal",
      toAct: "Act 2: Alfred Borden's Journal",
      fromScene: 'The Transported Man debuts',
      toScene: 'The Julia incident'
    },
    { character: 'Hugh Angier', fromAct: "Act 4: Rupert Angier's Journal", toAct: "Act 4: Rupert Angier's Journal" },

    // Inventors
    { character: 'Nikola Tesla', fromAct: "Act 4: Rupert Angier's Journal", toAct: "Act 4: Rupert Angier's Journal" },
    { character: 'Alley', fromAct: "Act 4: Rupert Angier's Journal", toAct: "Act 4: Rupert Angier's Journal" },
    { character: 'Thomas Edison', fromAct: "Act 4: Rupert Angier's Journal", toAct: "Act 4: Rupert Angier's Journal" }
  ]
};
