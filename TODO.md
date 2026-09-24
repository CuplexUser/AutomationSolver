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
| [`docs/COLD-CHAIN.md`](docs/COLD-CHAIN.md) | The AGV distribution center: the plant, index registers and queues, the six puzzles. |
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

## Factory refinement

The excavator line's scene, as against its programs. Raised from play rather than from a design
doc: the section cameras were framing structure instead of machines. Reference:
[`docs/FACTORY-LINE-DESIGN.md`](docs/FACTORY-LINE-DESIGN.md) §6, which now records what the
measurement found.

- [x] **Get the section cameras out of the roof.** All seven station presets stood 5.0 to 10.9 m
      up against the design's own 1.4 to 3.4 m rule, four of them outside the building looking
      through a backface-culled wall, and the paint preset put the lens 0.1 to 0.5 m from the
      aisle service run and shot half a frame of pipe. Fixed by adding `maxEyeY` (there was a
      floor and no ceiling, so rule 1 was a comment), pulling the standoffs in to 12 to 16 m, and
      re-bearing every eye onto open floor. → FACTORY-LINE-DESIGN §6 "Rule 1 was stated and not
      enforced"
- [x] **Stop the presets framing their subject through a fence.** Every cell is enclosed —
      `CellGuard` fences three sides of weld, store and assembly, the booth has three walls and a
      glazed face, the oven is a tunnel — so a bearing that ignores the opening shoots the whole
      shot through 2.2 m of woven mesh. Store crossed its own west guard, and the portal preset
      crossed the store's east guard because the rail's mid-point is 0.5 m *inside* it. Both
      re-beared to come in through the open side. → FACTORY-LINE-DESIGN §6 "A cell is a box with
      one opening"
- [x] **Put the drum bank back inside the shed, and the rack parts back on the deck.** Same
      mistake twice: a box's `z0` is its *north* edge, so `BOOTH.z0 - 1.4` put the four paint
      drums and the purge pot 0.4 m through the building's north wall. Separately, parts in the
      gravity lanes floated 0.33 to 0.47 m over the rollers because their height came from an
      independent term rather than from the lane's own fall. → FACTORY-LINE-DESIGN §6 "Two
      placement bugs"
- [x] **Turn every guard fence the right way round.** `FenceRun` builds along local x but took its
      bearing from the `atan2(dx, dz)` its z-built neighbours use, so every fence in the plant was
      rotated 90 degrees about its own centre — the weld bay's west guard ran through the
      positioner, its north guard reached five metres past the building wall, the store's ran
      lengthwise through the rack. One line. → FACTORY-LINE-DESIGN §6 "Every guard fence was
      rotated 90 degrees"
- [x] **Stand the floating beams on the floor.** Seven service risers hung from the tray and
      stopped 2.4 m up over the walkway; the booth's gun mast started 0.8 m up. Both now reach the
      slab, and the risers end in a disconnect. → FACTORY-LINE-DESIGN §6
- [x] **Turn the scene audit into a test.** `tests/scene-audit.spec.ts` now checks
      outside-the-building AABBs, camera eye-height/floor bounds and sight-line blocking against the
      live `/dev/line` scene; the dumping half moved into `features/sim/factoryLine/audit.ts` and
      `camera.tsx` gained `resolveFocusEye` so the test and `SectionCamera` share one calculation.
      Floating geometry and coplanar faces stay manual — both cried wolf on legitimate wall/ceiling
      fixtures against the real dump. → FACTORY-LINE-DESIGN §6 "How this was found"
- [ ] **Sweep `rowB.tsx` with the same three checks.** Row A has now been through outside-the-box,
      floating and coplanar; the south row has only been through them incidentally, as part of the
      whole-plant dump. Nothing has looked at whether its props sit inside their own footprints.
      → FACTORY-LINE-DESIGN §6 "Two placement bugs"
- [ ] **Give the booth a second opening.** Its camera is the one still boxed in: one glazed face
      on the south and the skid 2 m behind it leaves a single usable bearing, so the shot cannot
      obey rule 3 no matter how it is tuned. A roll-up door or a glazed return on the east face
      is a cell-interior change and belongs with the re-model. → FACTORY-LINE-DESIGN §6 and §8
      step 6
- [ ] **Stop free orbit leaving the building.** `polarRange` and `panBounds` still let a player
      orbit outside the north and west walls, which are single-sided planes — from behind, they
      vanish and the plant floats. Either make the two walls double-sided or tighten the orbit
      bounds to the slab. → FACTORY-LINE-DESIGN §6 "Overview stays orbitable"
- [ ] **Re-tune the elevations once the cells are re-modelled.** At the current standoffs
      `maxEyeY` binds at every viewport aspect, so the authored elevations do nothing but set the
      bearing's sign. That is the right trade today and worth revisiting when there is interior
      detail worth looking down at. → FACTORY-LINE-DESIGN §6

---

## Factory workspace UX debt

Raised from play against the plant workspace, not from a design doc — see
[`docs/FEATURE-MAP.md`](docs/FEATURE-MAP.md) §5 "The plant workspace" for what exists today.
None of this touches the simulation engine.

- [x] **Unpinning the ladder toolbar leaves no way back to it but scrolling all the way up.**
      Reported live against a POU window: unpinned is meant to let the toolbar scroll away with
      the program, but a long section then buries it with no shortcut back. `LadderEditor.tsx`
      now watches `paletteRef` with an `IntersectionObserver` and, only once unpinned and
      actually out of view, renders a small sticky `▴ Toolbar` strip that scrolls it back into
      view on click. Same fix serves both contexts the toolbar renders in (the play column's
      `.play-main` and a window's own `.ladder-scroll`), since intersection is clipped by
      whichever one actually scrolls either way. → `packages/client/src/features/ladder/LadderEditor.tsx`,
      `styles/ladder-editor.css`
- [x] **High prio: give the plant workspace project export/import and save-slot switching.**
      `FactoryPlay.tsx` gained a `__slots` tool window (same idiom as the operator panel and
      globals — a rail button toggles a `FloatingWindow`) wrapping the existing `SlotsPanel`
      unmodified, wired to the workspace's own `project`/`initialProject(spec)`. Left
      `enableImportExport` off by default: it's a cross-cutting setting shared with every
      single-program puzzle, and flipping its default is a separate call from wiring the panel
      in. Verified end-to-end on `factory-conveyor`: switch, create and minimize/restore a slot,
      then confirm export/import appear only once the setting is turned on.
      Along the way, found and fixed a real bug this surfaced: the server's `projectSchema`
      predated symbols and capped `device`/`operands` at 8 characters (rejects any declared name
      longer than that — the excavator line's own converted programs use names up to 20) and had
      no `vars`/`globals` fields at all, so a multi-POU save would either hard-fail or silently
      drop every declaration. Fixed in `validation.ts`, with a regression test in `app.test.ts`.
      → `packages/client/src/features/slots/SlotsPanel.tsx`, `pages/play/FactoryPlay.tsx`,
      `packages/server/src/validation.ts`
- [x] **Fix: picking a symbol from address-field autocomplete silently no-ops.** Root cause was
      `slotAccepts` calling `parseAddress` alone, which only matches literal addresses — a picked
      name never got past it. `CellFields.tsx` gained `resolveDeviceKind` (address or, given
      `choices`, a declared name) and `normalizeDeviceValue`/`normalizeOperandValue` (store a
      literal uppercased, a name in the case the player chose); `LadderEditor.tsx`'s
      `changeAddress`, `changeOperand`, `place()` and `wordPayload` all route through them now.
      Verified end-to-end on `factory-conveyor`: declaring a name and picking it from the
      dropdown now visibly retypes the placed element. → `packages/client/src/features/ladder/CellFields.tsx`,
      `LadderEditor.tsx`
- [ ] **Investigate: Stop mid-simulation changes "state of operation" after Run has been
      activated once.** Reported against the commissioning tutorial. The stage bar
      (`.ws-stage-bar` in `FactoryPlay.tsx`) and the operator panel's SCANNING/HALTED indicator
      both read the same `activeRunner.running` from `useSimRunner.ts`, which on the surface
      keeps them in sync — but `activeRunner` is `replay.runner ?? runner`, so the interaction
      between a completed run and a subsequent replay/restart is the likely place a stale
      reference or stale `running` value shows through. Needs reproduction against
      `factory-supervisor` before a fix. → `packages/client/src/pages/play/FactoryPlay.tsx`,
      `features/sim/useSimRunner.ts`
- [x] **Scroll the submitted result into view.** `ResultsCard` now carries a ref and a
      `scrollIntoView({ behavior: 'smooth', block: 'nearest' })` effect keyed on `result`/`pending`,
      firing the moment a submission resolves. → `packages/client/src/pages/play/BriefColumn.tsx`
      (`ResultsCard`)
- [x] **Give device chips and address fields a name-aware, adaptive display.** Widened
      `.field.compact` (84px → 200px, enough for a declared name at its 24-character limit — 132px
      was tried first and still clipped `PickLaneSelect`) and `.field.operand` (76px → 160px,
      dropping its forced `text-transform: uppercase`, which mangled a name's case); added the
      missing ellipsis rule to `HmiPanel.tsx`'s `.widget-name`. The chip row itself stays bare
      addresses — asked, and the answer was that the picker fix above is the real fix, widening
      chips would fight the original "too much space" complaint. A second overlap instance turned
      up live in the ladder cell's own on-canvas SVG label (`CellView.tsx`'s `.cell-addr`, not
      `.widget-name` as first assumed): added `overflow: hidden` on the cell's SVG so a long name
      clips instead of bleeding into the next cell, a length-based `addrFontSize` shrink tier, and
      a `title` tooltip carrying the full `describeElement()` text. → `packages/client/src/features/ladder/LadderEditor.tsx`,
      `CellView.tsx`, `styles/ladder-editor.css`, `features/sim/HmiPanel.tsx`, `styles/widgets.css`
- [x] **Auto-minimize for `FloatingWindow`s.** Manual only, per the design call: a minimize button
      (alongside pin/maximize/close) collapses a window to a pill in `WindowTabStrip`, a
      `position: fixed` taskbar along the bottom of the plant workspace (z-index above even an
      on-top window's band, so the one way back is never itself buried); clicking the pill restores
      it. `useWindows.ts` gained a `minimized` set and `isMinimized`/`minimize`/`restore`, alongside
      the existing open/focus/z-order bookkeeping — geometry stays owned by the window itself, so a
      restored window reopens exactly where it was. No auto-minimize-on-blur pass; that's future
      work if wanted. → `packages/client/src/features/workspace/FloatingWindow.tsx`,
      `useWindows.ts`, `pages/play/FactoryPlay.tsx`
- [x] **Right-click and double-click actions in the ladder grid.** Per the design call: right-click
      opens a small `.cell-menu` (Insert column before/after, Delete element) at the pointer;
      double-click selects the cell and focuses its address or first operand field, the same box a
      single click into the toolbar already reaches. `CellView`/`RungView` gained
      `onContextMenu`/`onDoubleClick` passthroughs. → `packages/client/src/features/ladder/CellView.tsx`,
      `RungView.tsx`, `LadderEditor.tsx`
- [x] **Insert a series element mid-rung without hand-shifting everything after it.**
      `editorStore.ts` gained `insertCol(pou, rung, col)` — splices a blank column in and shifts
      any `vlink` at or past it right by one (a vlink's `col` is a node *boundary*, not an element,
      so this is the only part of the insert that isn't a plain array splice). Reachable via
      Shift+I (mirroring I for insert-rung) or the right-click menu above. →
      `packages/client/src/features/ladder/editorStore.ts` (`insertCol`)
- [x] **Quick fix: disable text selection on the Operator panel.** Added
      `user-select: none` (`-webkit-` prefixed) to `.hmi`. →
      `packages/client/src/styles/hmi.css`
- [x] **Low prio: shift rows/columns within a rung.** `editorStore.ts` gained `moveCol`/`moveRow` —
      adjacent-swap only, cell contents move but `vlinks` are left alone (a vlink's `row`/`col`
      names a boundary position, not the element occupying it, so a swap needs no vlink remap).
      Reachable via Alt+arrow on the selected cell. → `packages/client/src/features/ladder/editorStore.ts`
- [x] **The grid edits existed but nobody could find them.** Raised live: "would it be possible to
      insert a column after the compare and before the move" — which had been one right-click away
      since the two boxes above shipped. Diagnosis was discoverability, so the collapsed
      `<details>Shortcuts</details>` at the foot of the palette became a real help sheet,
      `LadderHelp.tsx`, opened with `?`/`F1` or the `?` button in the toolbar's prefs group (which
      stays on screen when the palette is folded away). Grouped by intent rather than by key, with
      the mouse actions given equal weight to the keys. → `packages/client/src/features/ladder/LadderHelp.tsx`,
      `LadderEditor.tsx`, `styles/ladder-editor.css`
- [x] **Undo/redo for the ladder editor.** The structural edits are the ones most likely to go
      wrong and were all one-way. `editorStore.ts` gained an `undoable` zustand middleware that
      snapshots `{project, selected, marks}` before anything changes `project` — wrapping `set`
      rather than editing twenty action bodies, so a mutation added later is undoable by default.
      Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, plus visible ↶ ↷ buttons in the toolbar. →
      `packages/client/src/features/ladder/editorStore.ts` (`undoable`), `LadderEditor.tsx`
- [x] **The inverses of the grid's grow operations.** `removeCol`, `removeRow` and `moveColTo`
      (splice-out/splice-in, so a column can travel further than one place, unlike `moveCol`'s
      swap). `insertCol` now also remaps `selected.col`, which it alone did not. Reachable from
      the cell menu's new "Delete column", the rung header's `−row`/`−col`, and Alt+drag. →
      `packages/client/src/features/ladder/editorStore.ts`, `RungView.tsx`, `LadderEditor.tsx`
- [x] **Multi-select, and acting on the lot at once.** `marks` alongside `selected` (which stays
      the anchor, so every existing read path is untouched): Ctrl+click toggles a cell,
      Shift+click sweeps a rectangle, dragging from an empty cell rubber-bands one. Delete, cut,
      copy, paste, drag and *field retyping* all act on the whole selection —
      `patchCells(positions, patch, applies)` writes only the fields an instruction actually uses.
      → `packages/client/src/features/ladder/editorStore.ts`, `LadderEditor.tsx`
- [x] **Drag blocks and columns with the pointer.** `useGridGestures.ts`: drag a filled cell to
      carry that block (or the whole selection) anywhere in the section, Ctrl to copy instead of
      move; Alt+drag carries the whole column. Pointer events, not HTML5 DnD, and cells are
      hit-tested with `elementFromPoint` off a `data-cell` attribute rather than by arithmetic,
      because the grid sits under a zoom transform. →
      `packages/client/src/features/ladder/useGridGestures.ts`, `CellView.tsx`, `RungView.tsx`
- [x] **The client had no unit tests at all.** Added a vitest config and
      `editorStore.test.ts` (42 tests) covering the rung index arithmetic, which is the kind that
      fails silently — `evaluateRung` skips an out-of-range vlink rather than throwing. `npm test`
      at the root now runs it after shared and server. →
      `packages/client/vitest.config.ts`, `packages/client/src/features/ladder/editorStore.test.ts`

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
- [ ] **A throughput-graded warehouse level.** Optimizing the crane's travel is the best idea in
      the category and nothing currently measures it: every warehouse scenario grades on `until`
      milestones and the three failure latches, so a program that always takes the furthest slot
      scores the same 100 as one that never does. The distance registers were the stand-in for
      that and have just been removed from `asrs-replenish` for being unused ceremony. What
      replaces them is a `parMs` scenario on a level built for it — a rack seeded so the nearest
      slot and the lowest bay disagree, both lines calling so the ordering inverts, and par set
      from the optimized cycle so the 15 performance marks taper against a naive one that still
      passes. The taper is what makes "optimized" and "simple" two visibly different results
      instead of two greens. → FEATURE-MAP §`warehouse` (the distance-register note) and
      §"Grading" for `parMs` / `PAR_SLACK`
- [ ] **Packaging jam recovery.** `jam` latches forever today; a reset input plus scenarios that
      recover from a provoked jam is a fifth puzzle for that category. → ROADMAP §packaging

---

## P3b — Cold Chain Hub (the warehouse sequel)

A food distribution center run by a fleet of AGVs: the player posts transport orders and owns the
flows and the FIFO/LIFO storage policy, never the vehicles. Six puzzles, 54 to 59. In dependency
order. Reference: [`docs/COLD-CHAIN.md`](docs/COLD-CHAIN.md), which records every decision below
and gets what each step measures.

- [x] **Index registers, grammar.** `Z0`–`Z7` as a `DeviceKind`, `D100Z0` operands, `ValueRef`'s
      `Z`/`DZ` variants and `parseWordTarget`/`effectiveAddress`/`staticBase`.
      → COLD-CHAIN §"Index registers"; `ladder/types.ts`, `address.ts`, `value.ts`
- [x] **Index registers and `SFWRP`/`SFRDP`/`POPP` in the engine.** All-or-nothing operation
      errors, the per-instance pulse memory, `opDiagnostics`, the runtime write fence and
      `engineFor`. The 53 shipped puzzles must trace byte-identically before and after (a
      scratchpad digest of every canonical solution, demo and validation result).
      → COLD-CHAIN §"Two engine additions"; `sim/scanCycle.ts`
- [x] **Validator, symbols and grader for both.** The `indexRegisters` gate, operand roles, queue
      heads and `n`, static overlap checks, `writtenAddresses` feeding both ownership checks,
      Z-shaped names banned, the operation-error sentence on failing steps. Same byte-identity bar.
      → COLD-CHAIN §"Two engine additions"; `puzzle/validate.ts`, `symbols.ts`, `project.ts`, `grade.ts`
- [x] **Server schema** accepts the three queue types; round-trip test. → `server/src/validation.ts`
- [x] **Editor support.** Fields, glyphs, palette entries, help sheet, `Z` chips and rows, the
      live operation-error banner. → `client/src/features/ladder/`, FEATURE-MAP §1 and §5
- [x] **The `distribution` plant.** Locations, the fleet manager's mailbox, AGV kinematics on the
      loop, the latches, the stocktake download. Sub-step invariance test first.
      → COLD-CHAIN §"The plant"; `puzzle/processes/distribution.ts`
- [x] **54 `dc-dispatch`** (tutorial, with demo). → COLD-CHAIN §"The puzzles"
- [x] **55 `dc-label`.** → COLD-CHAIN §"The puzzles"
- [x] **56 `dc-flow-lanes`.** → COLD-CHAIN §"The puzzles"
- [x] **57 `dc-ripening`**, the first sectioned one. → COLD-CHAIN §"The puzzles"
- [x] **58 `dc-drive-in`.** → COLD-CHAIN §"The puzzles"
- [x] **59 `dc-hub`**, the capstone, `parMs`-graded. → COLD-CHAIN §"The puzzles"
- [ ] **Grade the capstone without holding the server up.** `dc-hub` still takes about 2.4 s to
      grade on the request thread (down from 4.7 s; the engine and plant work is done). Grading in
      a `worker_threads` worker would stop the thread blocking, but the API is a Vercel function,
      so it needs the worker file bundled into it: decide that, then build it.
      → COLD-CHAIN §"What was measured"; `server/src/routes/puzzles.ts`
- [x] **The Blender kit** `Automation-cold-storage-assets.blend` → `dc-kit.glb`, build script saved
      beside it.
      → COLD-CHAIN §"The 3D view"
- [x] **`Distribution3D`** and its `MachineView` branch, panel and plant-workspace layouts.
      → COLD-CHAIN §"The 3D view"
- [x] **Tell the outside world.** FEATURE-MAP's content table and category ranges, `README.md`
      and `site/index.html` counts. → FEATURE-MAP §"Puzzle content"

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
- **Purely symbolic variables, symbolic arrays, structs, `VAR_INPUT`/`VAR_OUTPUT`.** Every
  variable here stays located and shows its address, because the game teaches a platform where
  `M40` is a real thing an engineer reads off a monitor. Mitsubishi index registers (`D100Z0`,
  P3b) are not an exception: they are located addressing, and `ARRAY[1..4] OF INT` stays out.
- **A fourth transport mechanism on the excavator line** (AGVs, overhead monorail), **a second
  parallel machine**, and **a roof with trusses**. → FACTORY-LINE-DESIGN §9. AGVs belong to the
  Cold Chain Hub (P3b), a separate plant; this entry is about the line.
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
