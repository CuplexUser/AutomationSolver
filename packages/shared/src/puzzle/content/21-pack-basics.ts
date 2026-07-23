import type { PuzzleSpec } from '../types.js';

export const packBasics: PuzzleSpec = {
  kind: 'ladder',
  slug: 'pack-basics',
  title: 'Packer: Match & Push Pairs',
  difficulty: 'easy',
  order: 21,
  category: 'packaging',
  summary: 'Boxes arrive on two lanes — when a pair lines up at the stop, push it into section 2.',
  briefing: [
    'Welcome to the box packer. The feed belt runs continuously and the machine',
    'starts empty: boxes enter on TWO lanes and ride to an end stop. The lanes are',
    'not in step: sensors BOX NEAR (X14) and BOX FAR (X15) tell you when each',
    'lane\'s box has reached the stop.',
    '',
    'The 2-PACK PUSHER (Y0) is a double-acting pneumatic cylinder: energize it and it',
    'EXTENDS, drop it and a spring RETRACTS it. Its end sensors are IN (X0) and OUT',
    '(X1). One full stroke shoves the matched pair off the belt into section 2;',
    'push with only ONE box at the stop and it goes in askew and jams the machine.',
    'While the plate is away, its L-gate blocks the lanes, so arriving boxes hold',
    'short of the stop until the pusher is home again.',
    '',
    'Make the pusher give every matched pair one clean, full stroke: extend only',
    'once BOTH boxes are at the stop, hold the stroke to the OUT sensor, then let',
    'it spring home for the next pair. Boxes leave the sensors the moment the plate',
    'starts moving, so a bare X14·X15 → Y0 rung lets go mid-stroke: seal the',
    'stroke in and let OUT (X1) break the seal.',
  ].join('\n'),
  hints: [
    'This is the classic seal-in with a twist: start on X14 AND X15, hold via a Y0 ' +
      'branch, and put a normally-closed X1 in series to end the stroke.',
    'One rung is enough: (X14·X15 ∥ Y0) · X1(NC) → Y0.',
    'The machine refeeds itself — after the pusher comes home, the next two boxes ' +
      'advance to the stop and the same rung fires again. Two strokes stage a 4-pack.',
  ],
  devices: [
    { address: 'X14', label: 'Box at Stop (near)', io: 'input', widget: 'sensor' },
    { address: 'X15', label: 'Box at Stop (far)', io: 'input', widget: 'sensor' },
    { address: 'X0', label: '2-Pack In', io: 'input', widget: 'sensor' },
    { address: 'X1', label: '2-Pack Out', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: '2-Pack Pusher', io: 'output', widget: 'motor', color: '#38bdf8' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out'],
  maxRungs: 2,
  processId: 'packaging',
  scenarios: [
    {
      name: 'Every matched pair gets one full stroke',
      steps: [
        {
          label: 'Machine starts empty — boxes still travelling',
          holdMs: 500,
          expect: { Y0: false, X14: false },
        },
        {
          label: 'Near box at the stop, far box still coming — no push yet',
          holdMs: 800,
          expect: { X14: true, X15: false, Y0: false },
        },
        { label: 'Pair matched — pusher strokes out', holdMs: 500, expect: { Y0: true } },
        {
          label: 'Pair delivered to section 2 — pusher springs home',
          holdMs: 800,
          expect: { Y0: false },
          expectMachine: { sec2: 2, jam: false },
        },
        { label: 'Next pair lines up — second stroke', holdMs: 700, expect: { Y0: true } },
        {
          label: 'Four boxes staged in two steps',
          holdMs: 1000,
          expect: { Y0: false },
          expectMachine: { sec2: 4, jam: false },
        },
      ],
    },
    {
      name: 'No premature stroke while the lanes fill',
      steps: [
        { label: 'Belt running, nothing at the stop yet — pusher rests', holdMs: 1000, expect: { Y0: false, X14: false } },
      ],
    },
  ],
};
