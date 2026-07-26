import type { PuzzleSpec } from '../types.js';

export const drillClampFeed: PuzzleSpec = {
  kind: 'ladder',
  slug: 'drill-clamp-feed',
  title: 'Drill Station: Clamp & Feed',
  difficulty: 'easy',
  order: 29,
  category: 'drill',
  summary: 'Seal in one drilling stroke: clamp the part first, feed only once it is held.',
  briefing: [
    'First commissioning step on the drill station. Only two actuators are wired so',
    'far: the clamp that holds the work piece against the fixture stop, and the drill',
    'feed that plunges the head into it.',
    '',
    '## Equipment',
    '- X0 START: momentary push button. X1 E-STOP: maintained mushroom, normally closed.',
    '- X2 CLAMPED and X3 DRILL AT BOTTOM: machine-driven field sensors. You cannot',
    '  press them yourself.',
    '- Y0 CLAMP and Y1 DRILL FEED.',
    '- M0: run latch (see Working Registers).',
    '',
    '## Sequence of operation',
    '1. Press START with the E-Stop healthy. The clamp Y0 closes and holds. The',
    '   operator lets go of the button immediately, so the cycle has to seal itself in.',
    '2. Wait for CLAMPED (X2) to confirm the part is really held.',
    '3. Feed the drill Y1 down into it.',
    '4. At BOTTOM (X3) the cycle ends: drop the feed and release the clamp, so the head',
    '   retracts and the part can be taken out.',
    '5. The station stays idle until the next START.',
    '',
    '## Interlocks and safety',
    '- Never feed into an unclamped part. Gating Y1 on X2, rather than on the run latch',
    '  alone, is the point of this exercise.',
    '- The E-Stop is normally closed, so X1 reads ON while healthy. Pressing it must',
    '  drop both actuators at once.',
  ].join('\n'),
  hints: [
    'One rung builds the cycle: seal in a RUN bit M0 from (X0 OR M0) in series ' +
      'with X1 (NO), the healthy E-Stop, and a normally-closed X3, so reaching ' +
      'the bottom drops the whole cycle.',
    'Clamp Y0 is just a NO contact on M0, so it holds for the whole cycle and ' +
      'releases with it.',
    'Drill feed Y1 needs M0 AND X2 in series, both NO contacts. Gating the feed ' +
      'on the clamped sensor rather than on M0 alone is the whole point of the ' +
      'exercise.',
  ],
  devices: [
    { address: 'X0', label: 'Start', io: 'input', widget: 'momentary' },
    { address: 'X1', label: 'E-Stop', io: 'input', widget: 'estop', normallyClosed: true },
    { address: 'X2', label: 'Clamped', io: 'input', widget: 'sensor' },
    { address: 'X3', label: 'Drill At Bottom', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: 'Clamp', io: 'output', widget: 'lamp', color: '#38bdf8' },
    { address: 'Y1', label: 'Drill Feed', io: 'output', widget: 'motor', color: '#a78bfa' },
  ],
  registers: [
    { address: 'M0', label: 'Run latch', note: 'seals in the cycle until the feed bottoms out' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out', 'coil-set', 'coil-reset'],
  maxRungs: 6,
  processId: 'drill',
  scenarios: [
    {
      name: 'One sealed-in stroke',
      steps: [
        {
          label: 'Press Start: the clamp closes, the feed stays up',
          setInputs: { X0: true },
          holdMs: 150,
          expect: { Y0: true, Y1: false, X2: false },
        },
        {
          label: 'Release Start: the cycle stays sealed in',
          setInputs: { X0: false },
          holdMs: 150,
          expect: { Y0: true, Y1: false },
        },
        {
          label: 'Clamped: only now does the feed go down',
          holdMs: 500,
          expect: { X2: true, Y1: true, X3: false },
        },
        {
          label: 'Feed reaches the bottom: the cycle ends and everything releases',
          holdMs: 600,
          expect: { Y1: false, Y0: false },
        },
        {
          label: 'Machine stays idle until the next Start',
          holdMs: 800,
          expect: { Y0: false, Y1: false },
        },
      ],
    },
    {
      name: 'E-Stop aborts the stroke',
      steps: [
        {
          label: 'Press and release Start',
          setInputs: { X0: true },
          holdMs: 150,
          expect: { Y0: true },
        },
        {
          label: 'The stroke reaches the drilling phase on its own',
          setInputs: { X0: false },
          holdMs: 550,
          expect: { Y1: true },
        },
        {
          label: 'Hit E-Stop: clamp and feed drop at once',
          setInputs: { X1: false },
          holdMs: 150,
          expect: { Y0: false, Y1: false },
        },
        {
          label: 'Releasing the E-Stop must not restart the cycle on its own',
          setInputs: { X1: true },
          holdMs: 400,
          expect: { Y0: false, Y1: false },
        },
      ],
    },
  ],
};
