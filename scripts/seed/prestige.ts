// Seed dataset: The Prestige (2006 film, dir. Christopher Nolan).
//
// Two rival Victorian-era stage magicians — Robert Angier and Alfred
// Borden — and the impossible secrets they keep. Five acts follow the
// story's chronological spine; the film itself is non-linear (nested
// diary readings), but the underlying timeline is linear.
//
// Entity aliases to set via the UI after seeding:
//   Fallon → Frederick Borden  (revealed Act 5)
//   Lord Caldlow → Robert Angier  (revealed Act 4)
//
// The twin pair (Alfred / Frederick) and the Caldlow alias are the
// primary test cases for the spotlight revealedAtPosition system.
import type { SeedStory } from './types.js';

export const PRESTIGE: SeedStory = {
  metadata: {
    title: 'The Prestige',
    author: 'Christopher Nolan',
    seedKey: 'prestige',
    description:
      "Two rival Victorian magicians and the impossible secrets behind their signature illusions. Five acts: the pledge (shared origins, Julia's death), the turn (rival acts, escalating sabotage), obsession (the spy gambit, Colorado), the prestige (Tesla's machine, nightly drowning), the secret (trial, execution, the vault)."
  },

  acts: [
    {
      name: 'Act 1: The Pledge',
      position: 1,
      summary:
        "London, 1890s. Robert Angier and Alfred Borden are young assistants working under ingenieur Cutter. During a water-tank escape, Borden ties the wrong knot — or refuses to say which he tied — and Julia McCullough drowns. The rivalry is born."
    },
    {
      name: 'Act 2: The Turn',
      position: 2,
      summary:
        "Both men build solo acts. Angier becomes the polished showman 'The Great Danton'; Borden becomes the technically brilliant 'The Professor.' Borden debuts 'The Transported Man' — two cabinets, instant transposition — and Angier cannot explain it. Sabotage escalates on both sides. Sarah senses something wrong with the man she married."
    },
    {
      name: 'Act 3: Obsession',
      position: 3,
      summary:
        "Angier's attempts to copy the Transported Man using a drunken double fail. He sends Olivia to infiltrate Borden's company; she falls for Borden and refuses to report back. Borden plants a coded diary with a single clue: 'Tesla.' Sarah can no longer reconcile the two men she's been married to. Angier books passage to Colorado Springs."
    },
    {
      name: 'Act 4: The Prestige',
      position: 4,
      summary:
        "Angier finds Tesla and commissions a duplicating machine. Edison's men destroy the lab, but the machine ships to London first. Angier debuts 'The Real Transported Man' — lightning, a flash, and he appears in the gallery. The secret: each performance produces a duplicate who walks home while the original drowns in a trap-door tank below the stage. Borden sneaks backstage, witnesses the drowning, and is arrested for murder."
    },
    {
      name: 'Act 5: The Secret',
      position: 5,
      summary:
        "Borden is tried and sentenced. Lord Caldlow — Angier in his aristocratic disguise — visits Borden in prison and buys his secret diary. Cutter takes Jess to safety. Alfred Borden is hanged. The surviving twin, Frederick, follows Angier to the estate vault and kills him. The vault is full of water tanks, each holding a drowned copy of Angier."
    }
  ],

  locations: [
    {
      name: 'London',
      summary: 'The Victorian theater circuit where Angier and Borden built their careers — music halls, back-street workshops, and the grand Orpheum.'
    },
    {
      name: 'The Orpheum Theatre',
      summary: "The West End stage where both men premiered their signature illusions and where Angier's final act plays every night to a sold-out house."
    },
    {
      name: 'Colorado Springs',
      summary: "Tesla's remote American outpost. A long rail journey from any city. Where the duplicating machine is designed and built."
    },
    {
      name: "Tesla's Laboratory",
      summary: 'A vast, high-ceilinged hangar of coils and generators outside Colorado Springs. The machine fills one end of it. Edison\'s men burn the building down.'
    },
    {
      name: "Lord Caldlow's Estate",
      summary: "Angier's secret aristocratic property — the identity he performs under when he needs money or power without revealing he is The Great Danton. The vault beneath it holds the proof of the trick."
    },
    {
      name: 'Newgate Prison',
      summary: "Where Alfred Borden waits to be hanged for the murder of Robert Angier. Lord Caldlow visits him here."
    }
  ],

  characters: [
    // Angier's circle
    {
      name: 'Robert Angier',
      role: 'Protagonist',
      affiliation: 'The Great Danton',
      motivation:
        'To match — then surpass — Borden\'s signature illusion. To make Borden pay for Julia\'s death. To perform the perfect trick no matter the cost.',
      notes:
        "Stage name 'The Great Danton.' Secretly born into the aristocracy; uses his title 'Lord Caldlow' as a cover identity when needed. Polished, theatrical, and willing to die — repeatedly — for the prestige.",
      color: '#2dd4bf',
      timelineLabel: { mode: 'name-and-note' }
    },
    {
      name: 'Lord Caldlow',
      role: 'Alias',
      affiliation: 'House of Caldlow',
      motivation: "To keep Angier's aristocratic identity separate from his stage career — and later to operate as a free agent after his 'death.'",
      notes:
        "Angier's aristocratic alias. Uses this identity to commission Tesla, acquire the estate vault, buy Borden's diary, and visit him in prison. Revealed as Angier in Act 4.",
      color: '#2dd4bf',
      timelineLabel: { mode: 'name-and-note' }
    },
    {
      name: 'Cutter',
      role: 'Mentor',
      affiliation: 'Independent ingenieur',
      motivation: 'To build the most convincing illusion possible. To stay loyal to the man who pays him — until he can no longer pretend not to know what that costs.',
      notes:
        "The engineer and ingenieur behind every apparatus. He trained both Angier and Borden early on. Narrates the film's framing device about the three parts of a trick. Ultimately saves Jess.",
      color: '#fbbf24',
      timelineLabel: { mode: 'name-and-note' }
    },
    {
      name: 'Julia McCullough',
      role: 'Supporting',
      affiliation: "Angier's stage company",
      motivation: "To assist her husband's act — including the water-tank escape she trusts him to get right.",
      notes:
        "Angier's wife and on-stage assistant. Drowns when Borden ties the wrong knot (or refuses to say which he tied) during a water-tank trick. Her death is the catalyst for everything that follows.",
      color: '#60a5fa',
      timelineLabel: { mode: 'name-only' }
    },
    {
      name: 'Olivia Wenscombe',
      role: 'Ally',
      affiliation: "Angier's company → Borden's",
      motivation: 'To survive in a world run by two men who both use her. To eventually choose for herself.',
      notes:
        "Stage assistant. Angier sends her to infiltrate Borden's act as a spy. She genuinely falls for Borden and refuses to betray him. Each man assumes she still belongs to him.",
      color: '#818cf8',
      timelineLabel: { mode: 'name-and-note' }
    },

    // Borden's circle
    {
      name: 'Alfred Borden',
      role: 'Protagonist',
      affiliation: 'The Professor',
      motivation:
        "To perform the perfect illusion. To protect the secret that makes 'The Transported Man' impossible. To be a good father to Jess.",
      notes:
        "Stage name 'The Professor.' Workmanlike, technically brilliant, taciturn. One half of a shared identity he and his brother have lived since childhood. The 'Alfred' who loved Sarah; does not know which knot he tied the night Julia died.",
      color: '#f59e0b',
      timelineLabel: { mode: 'name-and-note' }
    },
    {
      name: 'Frederick Borden',
      role: 'Supporting',
      affiliation: 'The Professor (hidden)',
      motivation:
        "To keep the secret at any cost — including his own freedom. To protect Jess after Alfred dies.",
      notes:
        "Alfred's twin. Operates as 'Fallon,' Borden's silent, scarred assistant. The two have shared one life since childhood, alternating stage time. The 'Frederick' who did not love Sarah. Knows exactly which knot was tied the night Julia died.",
      color: '#f59e0b',
      timelineLabel: { mode: 'name-and-note' }
    },
    {
      name: 'Fallon',
      role: 'Alias',
      affiliation: "The Professor's act",
      motivation: "To be invisible. To serve as Alfred's assistant without anyone asking who he is.",
      notes:
        "The name and persona Frederick Borden uses to exist in plain sight. Borden's silent, scarred assistant. Revealed as Frederick in Act 5.",
      color: '#f59e0b',
      timelineLabel: { mode: 'name-only' }
    },
    {
      name: 'Sarah',
      role: 'Supporting',
      affiliation: 'Borden household',
      motivation: 'To love a husband who is sometimes inexplicably a stranger.',
      notes:
        "Alfred's wife. Perceptive enough to feel the shifts in her husband — that some days he loves her completely and others he is somewhere else entirely. She dies never knowing the explanation.",
      color: '#f472b6',
      timelineLabel: { mode: 'name-only' }
    },
    {
      name: 'Jess',
      role: 'Supporting',
      affiliation: 'Borden household',
      motivation: 'To have her father.',
      notes:
        "Alfred and Sarah's young daughter. The girl Cutter is explaining the trick to in the film's opening framing device. Ultimately taken to safety by Cutter after Alfred is hanged.",
      color: '#86efac',
      timelineLabel: { mode: 'name-only' }
    },

    // Inventors
    {
      name: 'Nikola Tesla',
      role: 'Mentor',
      affiliation: 'Independent inventor',
      motivation: 'To prove what electricity can do. To work on a problem large enough to be worth the cost.',
      notes:
        "Builds the duplicating machine for Angier in Colorado Springs. Financially precarious, hounded by Edison. Treats the commission as a serious physics problem, not a magic trick. Warns Angier that the machine is dangerous.",
      color: '#34d399',
      timelineLabel: { mode: 'name-and-note' }
    },
    {
      name: 'Alley',
      role: 'Supporting',
      affiliation: "Tesla's laboratory",
      motivation: "Loyal to Tesla. Runs what Tesla builds.",
      notes:
        "Tesla's assistant. Present for every test of the duplicating machine. The one who receives Angier when he arrives in Colorado and manages the practical side of the commission.",
      color: '#6ee7b7',
      timelineLabel: { mode: 'name-only' }
    },

    // The double
    {
      name: 'Gerald Root',
      role: 'Supporting',
      affiliation: "Angier's stage company",
      motivation: 'To earn a fee and avoid work.',
      notes:
        "A drunken actor who resembles Angier well enough to serve as his double for a version of the Transported Man. Unreliable and self-serving — refuses to commit to the act the way the illusion requires. Forces Angier to find another solution.",
      color: '#94a3b8',
      timelineLabel: { mode: 'name-only' }
    }
  ],

  events: [
    // Act 1
    {
      name: "Julia drowns in the water tank",
      summary:
        "During a water-tank escape performance, the knot on Julia's wrist restraints does not release. She drowns before the tank can be opened. Borden was the assistant who tied the knot. He will later say he cannot remember which knot he used that night."
    },

    // Act 2
    {
      name: "Borden debuts The Transported Man",
      summary:
        "Borden premieres his signature illusion: he enters a cabinet on one side of the stage and instantly appears from a cabinet on the other side. The crowd is thunderstruck. Angier watches and cannot explain it."
    },
    {
      name: "The bullet catch sabotage",
      summary:
        "Angier secretly switches the marked bullet in Borden's bullet-catch trick. When Borden fires, the gun is loaded with an unmarked ball — the trick appears to fail. Borden loses two fingers and performs through the bandages."
    },
    {
      name: "Borden destroys Angier's Transported Man",
      summary:
        "Borden sabotages Angier's version of the trick mid-performance. The illusion collapses on stage. Angier is humiliated in front of a full house."
    },

    // Act 3
    {
      name: "Olivia defects to Borden",
      summary:
        "Angier sent Olivia to infiltrate Borden's company as a spy. She reports back for a time, then falls for Borden and refuses to continue. Angier is left without any intelligence on how the trick actually works."
    },
    {
      name: "Sarah takes her life",
      summary:
        "Unable to reconcile the two men she has been living with — the one who loves her and the one who is merely tolerating her — Sarah hangs herself. Alfred is left to raise Jess alone."
    },
    {
      name: "Tesla builds the duplicating machine",
      summary:
        "Tesla and Alley complete the machine for Angier in the Colorado Springs laboratory. It works: objects placed inside are duplicated. The original and the copy both exist afterward. Angier understands the implication immediately."
    },
    {
      name: "Angier debuts The Real Transported Man",
      summary:
        "Angier's new act at the Orpheum: he walks into a crackling sphere of electricity, there is a blinding flash, and he appears a moment later at the back of the gallery. The crowd is in awe. Borden cannot explain it."
    },
    {
      name: "Borden witnesses the drowning",
      summary:
        "Borden sneaks backstage during one of Angier's performances and discovers the trap-door tank below the stage. He sees an Angier drown. He is arrested at the scene and charged with the murder of Robert Angier."
    }
  ],

  scenes: [
    // Act 1: The Pledge
    {
      name: 'Assistants at the water tank',
      parentAct: 'Act 1: The Pledge',
      summary:
        "Angier and Borden work as assistants for an evening's variety act. Cutter is the ingenieur. The two young men argue over methods; Borden believes in total commitment, Angier in presentation."
    },
    {
      name: "The knot",
      parentAct: 'Act 1: The Pledge',
      summary:
        "Borden ties the restraint for Julia's underwater escape. The knot does not release. By the time the tank is broken open, Julia is dead."
    },
    {
      name: "Blame and dismissal",
      parentAct: 'Act 1: The Pledge',
      summary:
        "Angier screams at Borden: 'You killed her.' Cutter tells Borden the act can no longer employ him. Borden says he cannot remember which knot he tied. The two men part as enemies."
    },

    // Act 2: The Turn
    {
      name: 'The Great Danton is born',
      parentAct: 'Act 2: The Turn',
      summary:
        "Angier rebuilds with Cutter as his ingenieur. They design a polished, theatrical show with Olivia as his new assistant. Angier becomes 'The Great Danton' — smooth, crowd-pleasing, technically dependent on Cutter."
    },
    {
      name: 'The Professor takes the stage',
      parentAct: 'Act 2: The Turn',
      summary:
        "Borden opens his own act with Fallon as his sole assistant. Rougher and less showy than Angier, but technically brilliant. The act builds a reputation before anyone notices Borden is doing things that shouldn't be possible."
    },
    {
      name: 'The Transported Man',
      parentAct: 'Act 2: The Turn',
      summary:
        "Borden debuts his signature illusion: instant transposition between two cabinets across the stage. Angier is in the audience. He is stunned. From this moment, his obsession with understanding and beating the trick defines his life."
    },
    {
      name: 'The bullet catch',
      parentAct: 'Act 2: The Turn',
      summary:
        "Angier switches Borden's marked bullet. The catch fails; Borden shoots his own fingers. He performs through the bandages for weeks. Each man now owes the other a scar."
    },
    {
      name: "Sarah's question",
      parentAct: 'Act 2: The Turn',
      summary:
        "Borden comes home after a performance. Sarah asks if he loves her. He says: 'Not today.' She already knows — some days she is loved completely, and others she is a stranger to the man she married."
    },

    // Act 3: Obsession
    {
      name: 'Gerald Root fails the trick',
      parentAct: 'Act 3: Obsession',
      summary:
        "Angier hires Gerald Root as his double for a version of the Transported Man. Root is meant to appear from the far cabinet while Angier appears in the gallery. Root, drunk and careless, keeps going to the wrong door. The act is a disaster."
    },
    {
      name: 'Olivia goes undercover',
      parentAct: 'Act 3: Obsession',
      summary:
        "Angier sends Olivia to audition for Borden's act. She gets the job. She reports back: Borden uses no double; Fallon is always present but seems more like a partner than an assistant."
    },
    {
      name: 'Olivia chooses Borden',
      parentAct: 'Act 3: Obsession',
      summary:
        "Olivia stops sending reports. When Angier confronts her, she tells him she is staying with Borden. She gives him something anyway — the one real clue from Borden's diary: a single word in the cipher. 'Tesla.'"
    },
    {
      name: "Sarah's last morning",
      parentAct: 'Act 3: Obsession',
      summary:
        "Sarah hangs herself. She leaves nothing in writing. Alfred comes home to find her and Jess alone in the house."
    },
    {
      name: 'The journey to Colorado',
      parentAct: 'Act 3: Obsession',
      summary:
        "Angier crosses the Atlantic and rides west to Colorado Springs, armed with money and letters of introduction. He is going to find Nikola Tesla and commission whatever it takes to beat Borden's trick."
    },

    // Act 4: The Prestige
    {
      name: 'Angier meets Tesla',
      parentAct: 'Act 4: The Prestige',
      summary:
        "Alley greets Angier at the laboratory gate. Tesla agrees to take the commission. He makes no promises but treats it as a physics problem worth solving. Angier waits in Colorado Springs while the work begins."
    },
    {
      name: 'The machine is completed',
      parentAct: 'Act 4: The Prestige',
      summary:
        "The machine works. Tesla demonstrates with a top hat: the original remains inside, a perfect copy appears across the room. Angier asks what happens to the original. Tesla tells him both are real."
    },
    {
      name: "Edison's men destroy the lab",
      parentAct: 'Act 4: The Prestige',
      summary:
        "Agents hired by Edison sabotage the laboratory — burning the equipment, killing the work. Angier ships the machine back to London just before the building is gutted. Tesla is ruined."
    },
    {
      name: 'The Real Transported Man',
      parentAct: 'Act 4: The Prestige',
      summary:
        "The Orpheum. Angier walks into a crackling cage of electricity. A flash. He appears at the back of the gallery. The house erupts. It is the greatest trick London has ever seen. Borden sits in the stalls unable to breathe."
    },
    {
      name: 'Below the stage',
      parentAct: 'Act 4: The Prestige',
      summary:
        "Borden breaks into the theater after hours and finds a trap-door below the stage position. A water tank. He returns during a live show, watches from the wings as an Angier enters the machine — and an Angier plunges through the trap into the tank below. He is arrested at the scene."
    },

    // Act 5: The Secret
    {
      name: 'The trial',
      parentAct: 'Act 5: The Secret',
      summary:
        "Borden is tried for the murder of Robert Angier. The prosecution shows the jury the water tank. The defense cannot explain what Borden was doing there. He is convicted and sentenced to hang."
    },
    {
      name: 'Lord Caldlow visits the cell',
      parentAct: 'Act 5: The Secret',
      summary:
        "A well-dressed aristocrat, Lord Caldlow, appears at Borden's cell and offers to buy his secret — the method behind the Transported Man — in exchange for arranging his daughter's care. Borden, with nothing left to protect, begins to talk."
    },
    {
      name: "Cutter takes Jess",
      parentAct: 'Act 5: The Secret',
      summary:
        "Cutter, disgusted by what he has helped Angier become, takes Jess away from the estate and to safety. He has understood for some time who Lord Caldlow really is."
    },
    {
      name: 'The hanging',
      parentAct: 'Act 5: The Secret',
      summary:
        "Alfred Borden is hanged at Newgate. The Alfred who loved Sarah. The one who, on some days, did not know which knot he tied."
    },
    {
      name: 'The vault',
      parentAct: 'Act 5: The Secret',
      summary:
        "Frederick Borden — free now that Alfred is dead — follows Angier into the estate vault. The vault is full of water tanks. Each holds a drowned copy of Angier, perfectly preserved. Frederick shoots Angier and watches him die. 'Now you're looking at me,' Borden says. 'Were you watching closely?'"
    }
  ],

  relationships: [
    // Core rivalry
    { from: 'Robert Angier', to: 'Alfred Borden', type: 'rivals' },

    // Mentors
    { from: 'Cutter', to: 'Robert Angier', type: 'mentor_of' },
    { from: 'Cutter', to: 'Alfred Borden', type: 'mentor_of' },
    { from: 'Nikola Tesla', to: 'Robert Angier', type: 'mentor_of' },

    // Angier's alliances
    { from: 'Robert Angier', to: 'Cutter', type: 'allied_with' },
    { from: 'Robert Angier', to: 'Julia McCullough', type: 'allied_with' },
    { from: 'Robert Angier', to: 'Olivia Wenscombe', type: 'allied_with' },
    { from: 'Robert Angier', to: 'Gerald Root', type: 'allied_with' },

    // Borden's alliances
    { from: 'Alfred Borden', to: 'Frederick Borden', type: 'allied_with' },
    { from: 'Alfred Borden', to: 'Sarah', type: 'allied_with' },
    { from: 'Alfred Borden', to: 'Jess', type: 'allied_with' },
    { from: 'Frederick Borden', to: 'Jess', type: 'allied_with' },
    { from: 'Olivia Wenscombe', to: 'Alfred Borden', type: 'allied_with' },

    // Tesla's circle
    { from: 'Nikola Tesla', to: 'Alley', type: 'allied_with' },

    // Cutter ends up protecting Jess
    { from: 'Cutter', to: 'Jess', type: 'allied_with' },

    // Locations
    { from: 'Robert Angier', to: 'London', type: 'located_at' },
    { from: 'Robert Angier', to: "Lord Caldlow's Estate", type: 'located_at' },
    { from: 'Alfred Borden', to: 'London', type: 'located_at' },
    { from: 'Frederick Borden', to: 'London', type: 'located_at' },
    { from: 'Cutter', to: 'London', type: 'located_at' },
    { from: 'Julia McCullough', to: 'London', type: 'located_at' },
    { from: 'Olivia Wenscombe', to: 'London', type: 'located_at' },
    { from: 'Sarah', to: 'London', type: 'located_at' },
    { from: 'Jess', to: 'London', type: 'located_at' },
    { from: 'Gerald Root', to: 'London', type: 'located_at' },
    { from: 'Nikola Tesla', to: 'Colorado Springs', type: 'located_at' },
    { from: 'Alley', to: 'Colorado Springs', type: 'located_at' },
    { from: 'Alfred Borden', to: 'Newgate Prison', type: 'located_at' },

    // Events take_place_at
    { from: 'Julia drowns in the water tank', to: 'London', type: 'takes_place_at' },
    { from: 'Borden debuts The Transported Man', to: 'The Orpheum Theatre', type: 'takes_place_at' },
    { from: 'The bullet catch sabotage', to: 'The Orpheum Theatre', type: 'takes_place_at' },
    { from: 'Borden destroys Angier\'s Transported Man', to: 'The Orpheum Theatre', type: 'takes_place_at' },
    { from: 'Olivia defects to Borden', to: 'London', type: 'takes_place_at' },
    { from: 'Sarah takes her life', to: 'London', type: 'takes_place_at' },
    { from: 'Tesla builds the duplicating machine', to: "Tesla's Laboratory", type: 'takes_place_at' },
    { from: 'Angier debuts The Real Transported Man', to: 'The Orpheum Theatre', type: 'takes_place_at' },
    { from: 'Borden witnesses the drowning', to: 'The Orpheum Theatre', type: 'takes_place_at' },

    // Scenes take_place_at
    { from: 'Assistants at the water tank', to: 'London', type: 'takes_place_at' },
    { from: 'The knot', to: 'London', type: 'takes_place_at' },
    { from: 'Blame and dismissal', to: 'London', type: 'takes_place_at' },
    { from: 'The Great Danton is born', to: 'London', type: 'takes_place_at' },
    { from: 'The Professor takes the stage', to: 'London', type: 'takes_place_at' },
    { from: 'The Transported Man', to: 'The Orpheum Theatre', type: 'takes_place_at' },
    { from: 'The bullet catch', to: 'The Orpheum Theatre', type: 'takes_place_at' },
    { from: "Sarah's question", to: 'London', type: 'takes_place_at' },
    { from: 'Gerald Root fails the trick', to: 'The Orpheum Theatre', type: 'takes_place_at' },
    { from: 'Olivia goes undercover', to: 'London', type: 'takes_place_at' },
    { from: 'Olivia chooses Borden', to: 'London', type: 'takes_place_at' },
    { from: "Sarah's last morning", to: 'London', type: 'takes_place_at' },
    { from: 'The journey to Colorado', to: 'Colorado Springs', type: 'takes_place_at' },
    { from: 'Angier meets Tesla', to: "Tesla's Laboratory", type: 'takes_place_at' },
    { from: 'The machine is completed', to: "Tesla's Laboratory", type: 'takes_place_at' },
    { from: "Edison's men destroy the lab", to: "Tesla's Laboratory", type: 'takes_place_at' },
    { from: 'The Real Transported Man', to: 'The Orpheum Theatre', type: 'takes_place_at' },
    { from: 'Below the stage', to: 'The Orpheum Theatre', type: 'takes_place_at' },
    { from: 'The trial', to: 'London', type: 'takes_place_at' },
    { from: 'Lord Caldlow visits the cell', to: 'Newgate Prison', type: 'takes_place_at' },
    { from: 'Cutter takes Jess', to: "Lord Caldlow's Estate", type: 'takes_place_at' },
    { from: 'The hanging', to: 'Newgate Prison', type: 'takes_place_at' },
    { from: 'The vault', to: "Lord Caldlow's Estate", type: 'takes_place_at' },

    // Causal spine
    {
      from: 'Borden debuts The Transported Man',
      to: 'Julia drowns in the water tank',
      type: 'caused_by',
      label: 'obsession triggered by'
    },
    {
      from: 'The bullet catch sabotage',
      to: 'Julia drowns in the water tank',
      type: 'caused_by',
      label: 'retaliation for'
    },
    {
      from: 'Borden destroys Angier\'s Transported Man',
      to: 'The bullet catch sabotage',
      type: 'caused_by'
    },
    {
      from: 'Olivia defects to Borden',
      to: 'Borden debuts The Transported Man',
      type: 'caused_by',
      label: 'Angier sent spy after seeing'
    },
    {
      from: 'Tesla builds the duplicating machine',
      to: 'Olivia defects to Borden',
      type: 'caused_by',
      label: '"Tesla" clue came from'
    },
    {
      from: 'Angier debuts The Real Transported Man',
      to: 'Tesla builds the duplicating machine',
      type: 'caused_by'
    },
    {
      from: 'Borden witnesses the drowning',
      to: 'Angier debuts The Real Transported Man',
      type: 'caused_by'
    },
    {
      from: 'Sarah takes her life',
      to: 'Olivia defects to Borden',
      type: 'caused_by',
      label: 'Olivia replaced Sarah as Borden\'s support'
    },

    // POV — scenes narrated through a specific character's eyes
    { from: 'Assistants at the water tank', to: 'Cutter', type: 'pov_of' },
    { from: 'The knot', to: 'Robert Angier', type: 'pov_of' },
    { from: 'Blame and dismissal', to: 'Robert Angier', type: 'pov_of' },
    { from: 'The Great Danton is born', to: 'Robert Angier', type: 'pov_of' },
    { from: 'The Professor takes the stage', to: 'Alfred Borden', type: 'pov_of' },
    { from: 'The Transported Man', to: 'Robert Angier', type: 'pov_of' },
    { from: 'The bullet catch', to: 'Alfred Borden', type: 'pov_of' },
    { from: "Sarah's question", to: 'Sarah', type: 'pov_of' },
    { from: 'Gerald Root fails the trick', to: 'Robert Angier', type: 'pov_of' },
    { from: 'Olivia goes undercover', to: 'Olivia Wenscombe', type: 'pov_of' },
    { from: 'Olivia chooses Borden', to: 'Olivia Wenscombe', type: 'pov_of' },
    { from: "Sarah's last morning", to: 'Alfred Borden', type: 'pov_of' },
    { from: 'The journey to Colorado', to: 'Robert Angier', type: 'pov_of' },
    { from: 'Angier meets Tesla', to: 'Robert Angier', type: 'pov_of' },
    { from: 'The machine is completed', to: 'Robert Angier', type: 'pov_of' },
    { from: "Edison's men destroy the lab", to: 'Nikola Tesla', type: 'pov_of' },
    { from: 'The Real Transported Man', to: 'Alfred Borden', type: 'pov_of' },
    { from: 'Below the stage', to: 'Alfred Borden', type: 'pov_of' },
    { from: 'The trial', to: 'Alfred Borden', type: 'pov_of' },
    { from: 'Lord Caldlow visits the cell', to: 'Alfred Borden', type: 'pov_of' },
    { from: 'Cutter takes Jess', to: 'Cutter', type: 'pov_of' },
    { from: 'The hanging', to: 'Cutter', type: 'pov_of' },
    { from: 'The vault', to: 'Frederick Borden', type: 'pov_of' }
  ],

  intervals: [
    // Angier — present Acts 1–4; Act 5 only in the vault (dying)
    { character: 'Robert Angier', fromAct: 'Act 1: The Pledge', toAct: 'Act 4: The Prestige' },
    {
      character: 'Robert Angier',
      fromAct: 'Act 5: The Secret',
      toAct: 'Act 5: The Secret',
      fromScene: 'Lord Caldlow visits the cell',
      toScene: 'The vault'
    },

    // Lord Caldlow alias — surfaces late Act 4 and Act 5
    {
      character: 'Lord Caldlow',
      fromAct: 'Act 4: The Prestige',
      toAct: 'Act 5: The Secret',
      fromScene: 'The Real Transported Man',
      toScene: 'Lord Caldlow visits the cell'
    },

    // Cutter — present throughout, last act saving Jess
    { character: 'Cutter', fromAct: 'Act 1: The Pledge', toAct: 'Act 5: The Secret' },

    // Julia — dies in Act 1
    {
      character: 'Julia McCullough',
      fromAct: 'Act 1: The Pledge',
      toAct: 'Act 1: The Pledge',
      fromScene: 'Assistants at the water tank',
      toScene: 'The knot'
    },

    // Olivia — enters Act 2, defects to Borden Act 3, fades Act 4
    { character: 'Olivia Wenscombe', fromAct: 'Act 2: The Turn', toAct: 'Act 4: The Prestige' },

    // Alfred Borden — present Acts 1–5 (executed Act 5)
    { character: 'Alfred Borden', fromAct: 'Act 1: The Pledge', toAct: 'Act 5: The Secret' },

    // Frederick Borden — present behind the scenes throughout, visible Act 5
    { character: 'Frederick Borden', fromAct: 'Act 1: The Pledge', toAct: 'Act 5: The Secret' },

    // Fallon alias — visible Acts 2–4 as Borden's assistant
    { character: 'Fallon', fromAct: 'Act 2: The Turn', toAct: 'Act 4: The Prestige' },

    // Sarah — Acts 2–3 (dies Act 3)
    { character: 'Sarah', fromAct: 'Act 2: The Turn', toAct: 'Act 3: Obsession' },

    // Jess — Acts 2–5
    { character: 'Jess', fromAct: 'Act 2: The Turn', toAct: 'Act 5: The Secret' },

    // Tesla and Alley — Acts 3–4
    { character: 'Nikola Tesla', fromAct: 'Act 3: Obsession', toAct: 'Act 4: The Prestige' },
    { character: 'Alley', fromAct: 'Act 3: Obsession', toAct: 'Act 4: The Prestige' },

    // Gerald Root — Act 3 only
    { character: 'Gerald Root', fromAct: 'Act 3: Obsession', toAct: 'Act 3: Obsession' }
  ]
};
