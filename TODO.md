# TODO

**This file is the only work list.** Everything in `docs/` is reference material: it explains how
something already works, or what a design settled and why. None of it is a queue. If a piece of
work is not a checkbox here, it is not scheduled, whatever a roadmap paragraph elsewhere might
imply.

## How to use it

1. **Take the top unchecked box of the highest-priority section that is not blocked.** Priority is
   the section, not the order within it; inside a section the items are usually in dependency
   order, and where they are, it says so.
2. **Read the reference doc named on the item before starting.** Every box carries a pointer,
   because the *why* is deliberately not duplicated here.
3. **Tick the box in the same change that ships the work**, and move anything worth keeping (a
   measurement, a rule the code now enforces, a thing that turned out to be false) into the
   reference doc the item pointed at. This file records what is left, never what was learned.
4. **A new idea becomes a box here or it does not exist.** Adding a "next steps" paragraph to a
   design doc is how a second queue gets started, and this file exists because that happened.

Reference docs, and what each is for:

| Doc | Answers |
|---|---|
| [`docs/FEATURE-MAP.md`](docs/FEATURE-MAP.md) | Where does capability X live, and why is it built that way? |
| [`docs/VARIABLES-AND-POUS.md`](docs/VARIABLES-AND-POUS.md) | The symbol table, scopes and player-authored POUs. |
| [`docs/FACTORY.md`](docs/FACTORY.md) | The excavator plant: vision, two process models, what each puzzle settled. |
| [`docs/FACTORY-LINE-DESIGN.md`](docs/FACTORY-LINE-DESIGN.md) | The line's floor plan, spine, timings and measured levers. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | The historical record of how the phases landed. **Not a queue.** |

---

## P1 — Finish variables and POUs

The engine and the UI are both built, and the excavator line is now written in names: puzzles 48 to
53 set `symbols: 'optional'`, so the symbol picker, the variables pane and the declarations the
sections ship are all reachable in the game. What is left is handing the player storage of their
own, and that is one change rather than two — `owns` is a fence keyed on a section name, and
puzzle 52 opens two sections at once, so no memory pool can be inside both blocks until
`writableOutputs` replaces it. P2's first box belongs in the same pass. Reference:
[`docs/VARIABLES-AND-POUS.md`](docs/VARIABLES-AND-POUS.md), whose build order this section
finishes (steps 1 to 6 are done).

- [x] **Mount `VariablesPanel`.** The component is finished (228 lines: add, delete, rename,
      comment, and it shows the address the next declaration *would* take) and is imported by
      nothing. Needs a locals table per POU window and one globals table at project level in
      `FactoryPlay`, plus somewhere to open them from. Until this ships, nothing else in this
      section is worth anything.
      → `packages/client/src/features/ladder/VariablesPanel.tsx`, `pages/play/FactoryPlay.tsx`
- [x] **POU tree editing** under `pouAuthoring: 'player'` — add, rename, delete, drag to reorder,
      with fixture slots pinned and id collisions rejected at assembly. `assembleProject` already
      implements the merge rule; this is the UI for it. → VARIABLES-AND-POUS §"Player-authored POUs"
- [x] **Declare-from-error quick fix.** `"OutfeedBusy is not declared"` should offer to open the
      variables pane with the name filled in and the kind guessed from where the element sits: a
      coil implies a bit, a MOV destination implies a word. → VARIABLES-AND-POUS §UI item 4
- [x] **Convert `factory-line-programs.ts` to symbols.** 118 rungs of raw addresses became
      declared names, and puzzles 48 to 53 turned `symbols` on at `'optional'` so they resolve.
      → VARIABLES-AND-POUS §"The conversion"
- [ ] **Reauthor puzzles 48 to 53 against `symbols: 'required'`.** Swap `owns` for
      `writableOutputs` on player code (fixture slots keep `owns`), give every puzzle a
      `memoryPools` block — which is blocked on that swap, since 52 opens two sections and no pool
      fits inside both `owns` blocks — publish the spine's interface as globals (`SpineReady`,
      `WeldReleaseOk`, `FrameAtJig`, `BoomAtJig`, `SpineBlockedAt`), and drop the
      `registers: [{ address: 'M0', ... }]` working-address lists from the specs, since working
      storage becomes the player's to name. → VARIABLES-AND-POUS §"The three tiers" and
      §"What replaces `owns`"; the worked example is the spine's interface table
- [ ] **Hand the capstone its task schedule.** Puzzle 53 sets `taskAssignment: 'player'`, which
      already exists and is already validated. A spine polled on a 200 ms task reacts up to 200 ms
      late at every one of twelve zone handshakes. → VARIABLES-AND-POUS §Tasks
- [x] **Document the whole feature in FEATURE-MAP.** It currently contains no mention of
      variables, scopes, `VarDecl`, globals or symbol resolution, which is why the gap was
      invisible from the outside. → `docs/FEATURE-MAP.md` §3

---

## P2 — The excavator line's remaining debt

The category is complete and playable: seven puzzles, 47 through 53, all green. What is left is
one design debt and the scene detail. Reference: [`docs/FACTORY.md`](docs/FACTORY.md) §"Known
open" and [`docs/FACTORY-LINE-DESIGN.md`](docs/FACTORY-LINE-DESIGN.md) §5a and §8.

- [ ] **Give the spine a lever: put the booth's infeed on a zone.** Measured, the conveyor and the
      store both cost the plant exactly zero however badly they are written, because neither
      blocks the station setting the pace. A zone between the portal and the booth skid is the
      only fix, and it moves an address and `stepPortal`'s place rule that all six line puzzles
      are written against. **Do it together with the P1 reauthor or not at all** — one pass
      through those specs, not two. → FACTORY-LINE-DESIGN §5a option 1
- [ ] **Re-model the cells**, one at a time, inside the footprints §2 fixes. The scene draws all
      eight cells, the spine and every zone's live contents; what is missing is detail inside the
      boxes. → FACTORY-LINE-DESIGN §8 step 6
- [ ] **Blender per cell**, replacing procedural geometry where a GLB earns its download. The
      fixed footprints and named anchors are what make this a swap rather than a redesign.
      → FACTORY-LINE-DESIGN §8 step 7

---

## P3 — Engine and content growth

The leftovers of the original Phase 3, plus the last item of the analog plan. Each is independent
of the others and of P1. Reference: [`docs/ROADMAP.md`](docs/ROADMAP.md).

- [ ] **Off-delay and retentive timers.** The last unshipped instructions on the original list.
      Each needs engine support, validator support, an editor glyph, and at least one puzzle that
      genuinely *requires* it rather than merely permits it. `ElementType` currently stops at
      `timer` (on-delay) and `counter`.
- [ ] **Fault-injection scenarios.** An overload trips mid-cycle, a sensor sticks. Tests whether a
      program is robust rather than merely correct on the happy path. Note the existing constraint:
      a scenario cannot force an input the process model derives, so this needs a way for a step to
      tell the *plant* to misbehave, not just to drive an X.
- [ ] **The `finishing` category (`paint` process model).** Atomizing pressure and paint flow as
      lagged loops, plus four CMYK dosing pumps trimmed against a color sensor sitting *downstream
      of the mixer*, so the loops have real dead time and a naive high gain oscillates. Four
      puzzles ending in a batch of parts in different colors, with purge waste costing performance
      marks. → ROADMAP §"Next: the rest of the analog plan"
- [ ] **Packaging jam recovery.** `jam` latches forever today; a reset input plus scenarios that
      recover from a provoked jam is a fifth puzzle for that category. → ROADMAP §packaging

---

## P4 — Craft and competition

Nothing here is blocked and nothing here is urgent. It is the original Phase 4, and it only pays
off once the content library is deep, which it now is.

- [ ] **Scoring beyond pass/fail** — rung count, instruction count, scan-time efficiency, beside
      the existing 85 correctness + 15 performance.
- [ ] **Leaderboards** per puzzle on those metrics.
- [ ] **Solution sharing** — read-only permalinks to a program.
- [ ] **Daily or weekly challenge** — one rotating puzzle.

---

## Deliberately not doing

Recorded so nobody re-proposes them, and so a future decision to reverse one is a decision rather
than a drift.

- **`FUNCTION_BLOCK` / `FUNCTION`.** A reusable instantiable block is a good lesson and a much
  larger change: instance data, a call element in the rung grid, and a second scope kind. It is the
  obvious step *after* P1, not part of it. → VARIABLES-AND-POUS §"Where this sits against IEC"
- **Purely symbolic variables, arrays, structs, `VAR_INPUT`/`VAR_OUTPUT`.** Every variable here
  stays located and shows its address, because the game teaches a platform where `M40` is a real
  thing an engineer reads off a monitor.
- **A fourth transport mechanism on the line** (AGVs, overhead monorail), **a second parallel
  machine**, and **a roof with trusses**. → FACTORY-LINE-DESIGN §9
- **Feature-flagging one factory process model instead of two.** Tried, worked, and was wrong: the
  flow differs rather than the fittings, and splitting is what leaves puzzle 47 provably untouched.
  → FACTORY.md §"Two plants, deliberately"

---

## Shipped

The short version. Each phase's account lives in [`docs/ROADMAP.md`](docs/ROADMAP.md).

- [x] Phase 0 — monorepo, shared engine, puzzle schema, validator, grader, server with auth and
      authoritative grading, React client, first six puzzles.
- [x] Phase 1 — the editor stopped being the limiting factor: in-place editing, keyboard-first
      placement, the three-column workspace, the first two Blender machine views.
- [x] Phase 2 — replay, the trace strip, progressive hints, puzzle-map progression, multiple save
      slots per puzzle.
- [x] Phase 3, instruction set — `D` registers, compare contacts, `MOV`, arithmetic and a real
      `PID` block, with analog devices, raw-count transmitters and `control`/`parIae` grading.
      *(Off-delay and retentive timers are the remainder; see P3.)*
- [x] Phase 5 — the second puzzle genre. `kind: 'cabinet'`, a netlist document, a continuity
      solver, schematic and panel editors, and six wiring puzzles, all graded through the same
      scenario machinery.
- [x] Eleven ladder categories and 53 puzzles, every one with a canonical solution in
      `grade.test.ts` or `gradeCabinet.test.ts`.
- [x] POUs and tasks — `LadderProject` over `LadderProgram`, `toProject` as the single boundary,
      per-task edge images, and `intervalMs` forced onto the grading grid.
- [x] Variables and scopes, engine half — `VarDecl`, locals and globals, the allocator,
      `resolveProject`, `runnableProject`, the validation rules, and the symbol picker on the
      device field. *(The rest is P1.)*
- [x] The excavator plant — two process models, seven program sections, a twelve-zone conveyor the
      player programs, and seven puzzles from commissioning tutorial to whole-plant capstone.
