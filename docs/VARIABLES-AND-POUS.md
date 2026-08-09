# Variables, Scopes and Player-Authored POUs

How a program stops being a list of addresses and becomes a symbol table with scopes: global
variables the sections publish to each other, local variables private to one POU, and POUs the
player creates rather than fills in.

Companion to [FACTORY-LINE-DESIGN.md](./FACTORY-LINE-DESIGN.md), which is the plant this exists to
serve. This one is engine and model work and outlives the factory.

> **Reference, not a queue.** This is the design; the work left to do on it is
> [`TODO.md`](../TODO.md) **P1**, which is the project's current top priority. The build order at
> the end of this document records what each step *was* and whether it landed. Do not treat it as
> the checklist — the boxes are in `TODO.md`, and the engine half being done while the feature
> stays unreachable from the UI is exactly the gap two queues produced.

## Why

The immediate ask is the zoned conveyor. `CONV` is one section that six others have to coordinate
with: the weld bay may not roll a part out onto a zone that is occupied, final assembly may not
call a part that is not at the head of its lane, and everybody wants to know whether the spine is
backed up. Under a flat device space the only way to express that is a documented convention —
"M160 means the spine will take a part" — enforced by nothing.

The second reason is a bug this session already produced. `PORTAL_CYCLE` used `M41` for a step
latch while `STORE_TUNED` drove `M41` as a level coil meaning "there is room in a boom lane", and
because both blocks lived in one flat section the collision was invisible until the rack filled
and the portal stalled for good. With the portal as its own POU and its step chain **local to it**,
that collision is not a bug that got caught. It is unrepresentable.

That is the whole argument for scopes over ownership fences: a fence detects the collision, a
scope makes it impossible.

## The three tiers

Every name in a program resolves through exactly one of these, in this order.

| Tier | Declared by | Visible to | Backed by |
|---|---|---|---|
| **Local** | the POU that owns it | that POU only | allocated `M` / `D` / `T` / `C` |
| **Global** | the project (player), or the puzzle when a fixture publishes one | every POU | allocated `M` / `D` / `T` / `C` |
| **Plant** | the puzzle's `devices` list, and only that | every POU, read-only for inputs | fixed `X` / `Y` / analog `D` |

The plant tier is the user's rule made concrete: **a puzzle declares actual sensors and actuators
and nothing else.** No more `registers: [{ address: 'M0', label: 'Plant run' }]`. Working storage
is the player's to name and the allocator's to place.

### Plant symbols

`PuzzleDevice` gains an optional `symbol`. When absent it is derived from `label` by stripping
non-identifier characters and pascal-casing, so the 46 existing puzzles need no edits:

```
{ address: 'X4', label: 'Frame Blank Ready' }   ->  FrameBlankReady
{ address: 'Y3', label: 'Torch' }               ->  Torch
{ address: 'D1', label: 'Film Thickness' }      ->  FilmThickness
```

Derivation collisions are a puzzle-authoring error and `validateSpec` reports them, the same way a
malformed `owns` range does today.

## `VarDecl`

```ts
/** A name over an address. Allocated once, stored, never recomputed. */
export interface VarDecl {
  name: string;
  /** Picks the pool: bool -> M, int -> D, timer -> T, counter -> C. */
  kind: 'bool' | 'int' | 'timer' | 'counter';
  /** Assigned at declaration time and saved with the program. */
  address: string;
  comment?: string;
  /** Shipped by the puzzle: the player may read it but not rename, move or delete it. */
  fixed?: boolean;
}
```

`Pou` gains `vars?: VarDecl[]` (its locals). `LadderProject` gains `globals?: VarDecl[]`. Both
optional, so every program that exists today is already a valid one.

`kind` and "which pool" are the same choice, which is why there is no separate type system. The
device family already carries the type: an `M` is a bit, a `D` is a 16-bit signed word, a `T` is a
timer. Declaring `kind: 'int'` and getting a `D` is not a mapping, it is the same statement twice.

### Allocation

The spec declares the pools the player may draw from:

```ts
memoryPools?: {
  bool?: string;     // 'M0-M399'
  int?: string;      // 'D20-D199'
  timer?: string;    // 'T0-T99'
  counter?: string;  // 'C0-C79'
};
```

A new variable takes the **lowest free index in its pool**. The address is then written into the
declaration and never recomputed, which is what makes renaming free, reordering free, and a saved
solution stable. Deleting a variable returns its index to the pool.

Allocation happening once, at declaration, rather than at assemble time is the determinism
property: the client and the server both read an address that is already written down, so there is
no allocator whose output they could disagree about.

### Naming rules

- `[A-Za-z_][A-Za-z0-9_]{0,23}`
- Unique within a scope, case-insensitively, because every real PLC tool is
- **Must not look like an address.** `M40` as a variable name is rejected, because the literal
  fallback below would make it ambiguous.

## Resolution

One pass, in `shared`, between assembly and the engine:

```
assembleProject(spec, submission)   ->  resolveProject(project, spec)   ->  new SimEngine(...)
```

`resolveProject` rewrites every element's `device` and every entry in `operands` from a name to an
address, POU by POU, and returns a project the engine can run. For each name, in a given POU:

1. that POU's `vars`
2. the project's `globals`
3. the puzzle's plant symbols
4. **the literal address itself**, if it parses as one and the spec allows it

`K` literals (`K500`) are left alone, as are addresses already in address form.

Step 4 is the compatibility hinge and it is the same trick `toProject` used. An undeclared `M40`
still *is* `M40`, so every existing puzzle, every saved solution slot and the Pages demo resolve to
exactly the bytes they resolve to today. The engine never learns that variables exist.

The spec chooses how strict step 4 is:

```ts
symbols?: 'off' | 'optional' | 'required';   // default 'off'
```

- `'off'` — no resolution pass runs at all. Puzzles 01 to 47.
- `'optional'` — names resolve if declared, addresses always work. Puzzles 48 to 53 today.
- `'required'` — an undeclared name that is a bare address is an error in player-written code.
  Where puzzles 48 to 53 are going; see the build order's step 7.

Fixture POUs shipped by the puzzle are always resolved leniently, whatever the setting: they are
content, not an answer, and holding them to the player's rule would only ever break a puzzle.

## What replaces `owns`

`PouSlot.owns` fences what a *named* section may write. Once the player creates their own POUs the
puzzle no longer knows their names, so the fence has nothing to attach to. It splits in two:

**Shipped fixture slots keep `owns`.** They have known ids and it still does its job.

**Player code is fenced at the program boundary instead.** The spec declares which actuators the
whole submission may drive:

```ts
writableOutputs?: string[];   // ['Y28-Y41'] for the conveyor puzzle
```

Everything else falls out of scoping. A player POU cannot touch another POU's locals because it
cannot name them, so the discipline `owns` was approximating is now structural. What is left for
validation is the part scoping cannot express, which is exactly the part that matters: **which
motors this program is allowed to start.**

Three rules the server enforces on any submitted declaration, because a hand-written payload is
not obliged to have come from our editor:

1. Every `address` lies inside its `kind`'s declared pool.
2. **No two declarations anywhere in the project share an address**, locals in different POUs
   included.
3. No declaration points at an `X`, a `Y`, or an analog device address.

Rule 2 is stronger than "unique within a scope", and deliberately. **Names are scoped; memory is
not.** The engine holds one flat image, so two POUs whose locals both landed on `M0` would be
sharing one bit while reading as though each had its own — which is the `M41` collision again,
rebuilt by the allocator that was supposed to prevent it. Scoping buys the naming discipline;
distinct allocation is what actually buys the isolation.

Rule 3 is the security one. Without it a submission could declare `{ name: 'Torch', address: 'Y3' }`
as a local and drive the weld torch from a section with no business doing so.

## Player-authored POUs

```ts
pouAuthoring?: 'fixed' | 'player';   // default 'fixed'
maxPous?: number;
```

Under `'player'` the tree gains add, rename, delete and reorder. Shipped fixture slots stay pinned:
they cannot be renamed or deleted, and a player POU whose id collides with one is rejected at
assembly rather than silently overwriting it — the same rule, and for the same reason, as
non-editable sections always coming from the spec.

`assembleProject` becomes:

- every non-editable slot, taken from the spec, always
- every editable slot the spec named, taken from the submission if present
- every POU the submission added, in its own order, provided the id is free

### An added POU has to be scheduled, too

The list above was not sufficient and the gap was invisible until the tree could
actually make a program. **The spec's tasks cannot name a section the player invented after the
puzzle was written**, and under `taskAssignment: 'fixed'` the tasks come from the spec — so every
added POU arrived at the grader in no task at all, present in the project, shown in the tree, and
never run. It surfaced only as `checkTasks`' warning, on a submission.

So assembly appends the added POUs to the **first task**, in the order they were added. That is the
answer a player would give if asked, which is why they are not asked, and it is the same rule the
client's `addPou` had already been applying optimistically. Under `taskAssignment: 'player'` nothing
is appended: the schedule is then the answer, so leaving a program out of every task is a choice
and the existing warning is the right response to it.

Two consequences worth knowing:

- **Scan order for added POUs is `project.pous` order**, because that is the order assembly appends
  them in. Reordering one in the tree therefore has to move it in *both* `project.pous` and the
  task's list, or the tree would show an order the engine does not run. `movePou` does both.
- **The player's POUs are a contiguous tail.** Slots come first, in spec order, and additions after
  — in `initialProject`, in `assembleProject` and in the editor's own `addPou`. The tree relies on
  it: a move is only offered between two of the player's own programs, since a slot's place in the
  task comes from the spec and moving past one would be a reorder the grader does not perform.

## Tasks

Puzzles 48 to 52 keep one fixed `MAIN` task and a fixed scan order, so the lesson stays the
station. Puzzle 53 sets `taskAssignment: 'player'`, which already exists, and hands over the
arrangement. That is the capstone's last lever and a real one: a spine polled on a 200 ms task
reacts up to 200 ms late at every zone handshake, which on twelve zones is seconds a machine.

The existing invariant is unchanged and still enforced: **`intervalMs` must be an integer multiple
of `GRADE_DT`.**

## Worked example: the spine's interface

This is the thing the whole change is for. `CONV` publishes a handful of globals; every other
section reads them and writes none of them.

> **Not built yet, and deliberately.** The conversion (step 6) shipped exactly one global,
> `PlantRun` at `M0`, because that one already existed as a convention six sections were following.
> Everything in the table below is *new behaviour* — rungs that do not exist in `CONV_TUNED` today
> — so it belongs to step 7, where the puzzles that ask for it are authored, and not to a rename
> that had to ship the same machine counts it started with.

| Global | Kind | Published by | Read by |
|---|---|---|---|
| `SpineReady` | bool | CONV | WELD, ASSY |
| `SpineBlockedAt` | int | CONV | SUP (the amber lamp), TEST |
| `WeldReleaseOk` | bool | CONV | WELD |
| `FrameAtJig` | bool | CONV | ASSY |
| `BoomAtJig` | bool | CONV | ASSY |

And inside `CONV`, everything that makes it work is **local** and invisible to anyone else:

```
CONV locals:   Z1Held  Z2Held ... Z12Held    (bool, M0..M11)
               SortStep                       (int,  D20)
               ReleaseDelay                   (timer, T0)
```

The weld bay then reads like a sentence rather than like a memory map:

```
LD  Running  AND  WeldReleaseOk  AND NOT  FixtureBusy   ->   SET  ReleaseCycle
```

Compare the same rung today: `LD M0 AND M164 AND NOT M12 -> SET M15`, correct and unreadable, with
`M164` meaning what it means only because a comment said so.

## Where this sits against IEC 61131-3

This is deliberately the standard's model, simplified only where the simplification costs a player
nothing. Naming it here so the vocabulary in the UI and the briefings can be the real vocabulary.

| IEC 61131-3 / GX Works | Here | Note |
|---|---|---|
| `VAR_GLOBAL` | project `globals` | Same role: the interface between POUs |
| `VAR` | POU `vars` | Same role: private working storage |
| POU (`PROGRAM`) | `Pou` | We have only this one POU class |
| `TASK` with interval and priority | `TaskDef` | Already implemented, already enforced |
| Located variable `AT %MX40` | `VarDecl.address` | Always located, never purely symbolic |
| Elementary types `BOOL`, `INT` | `kind: 'bool' \| 'int'` | Plus `timer` and `counter` |

Four things the standard has that this deliberately does not:

- **No `FUNCTION_BLOCK` or `FUNCTION`.** A reusable, instantiable block is a genuinely good lesson
  and a much larger change: instance data, a call element in the rung grid, and a second scope
  kind. It is the obvious next step, not this one.
- **No purely symbolic variables.** In IEC a `VAR` need not be located; the compiler places it and
  you never see where. Every variable here is located and shows its address, because the game is
  teaching a platform where `M40` is a real thing an engineer reads off a monitor screen. The
  address stays visible as secondary text everywhere the name appears.
- **No derived types, arrays or structs.** `Z1Held … Z12Held` rather than `ZoneHeld : ARRAY[1..12]`.
  Arrays need indexed addressing in the rung model, which the engine has no notion of.
- **No `VAR_INPUT` / `VAR_OUTPUT` on a POU.** With no callable blocks there is no call to pass
  parameters through; globals are the interface.

## Compatibility

Additive throughout, and deliberately so.

- `vars` and `globals` are optional; a program without them is unchanged.
- `symbols` defaults to `'off'`, so no resolution pass runs for puzzles 01 to 47.
- `pouAuthoring` defaults to `'fixed'`.
- Saved `solution_slots` rows need **no migration**. An old project has no declarations, so every
  name in it is a bare address, and step 4 of resolution returns it untouched.
- The Pages demo is untouched: puzzle 02 stays `symbols: 'off'`.

The one conversion is `content/factory-line-programs.ts`, whose 118 rungs are now symbolic. Puzzle
47 keeps its raw-address sections. Puzzles 48 to 53 are `symbols: 'optional'`, which is additive in
both directions: their shipped sections resolve by name, and a slot saved against any of them
before the conversion is a program of bare addresses that step 4 hands straight back.

## UI

Four pieces, in the order they are worth building:

1. **Symbol picker on the device field.** A combobox over the in-scope table, showing the name
   with its address as secondary text. This is the piece that makes the feature usable; without it
   declaring a variable is worse than typing `M40`.
2. **Variables pane.** A table per POU for locals and one at project level for globals: name,
   kind, address (read-only), comment. Add and delete. `fixed` rows are shown greyed with their
   publisher named.

   Mounted in `FactoryPlay`, in the two places the two scopes belong. **Globals hang off the
   project**, so they are a row at the top of the program tree, above the tasks, opening their own
   floating window. They were first put in the rail's action block beside the operator panel, and
   that was wrong twice over: the actions block is `margin-top: auto`, so on a short viewport it
   sits below the fold of a scrolling rail, and nothing about "save, submit, clear the desk"
   suggests a declaration table lives there. The tree is where a player already looks to see how
   the program is put together, and a global is exactly that.

   **Locals hang off a POU**, so each section window carries a `VAR n` toggle in its title bar next
   to `READ ONLY`, and the table opens as a drawer *under* that section's ladder rather than
   replacing it: a declaration is read while a rung is being written, so a mode that hides the rung
   defeats the point of putting the table there at all. The drawer takes the height its table needs
   up to `min(60%, 320px)` and the ladder takes the rest — **and `.ladder-scroll`'s 280 px floor has
   to be relaxed inside it**, because that floor is a rule about the play *column*, where the ladder
   is the page. Left standing in a 420 px window it won the space and pushed the drawer's Declare
   row out through the bottom of the frame. A pre-written section's drawer is read-only — it is the
   handshake the player is coding against, not their storage.

   The whole affordance is hidden when `symbols` is `'off'`, and that is not politeness. Under
   `'off'` no resolution pass runs, so a name the player declared would reach the engine still
   spelled as a name and match nothing. There is no safe way to offer the pane on a puzzle written
   in raw addresses, so it is not offered. This is why mounting it changes nothing a player can see
   until step 7 lands: no shipped puzzle sets `symbols` yet.
3. **POU tree editing.** Add, rename, delete, reorder. Pinned rows for fixture slots.

   In `PouExplorer`, and only under `pouAuthoring: 'player'`. A player row carries four small
   controls beside the open-button — up, down, rename, delete — as siblings of it rather than
   children, since a button inside a button is not a thing and the row itself has always been what
   opens the section. Adding asks for a **name and nothing else**: the id is derived from it,
   uniquified against everything taken, and never shown, because it exists so that a task and a
   save slot have something stable to point at and a player made to invent one would be inventing
   the wrong thing. A rename therefore never moves the id.

   Reordering is the two arrow buttons, not a drag. That is what `RungView` already uses for the
   same job one level down, it needs no keyboard fallback bolted on afterwards, and the list it
   acts on is four or five rows long. The arrows are enabled only between two of the player's own
   programs; see §"An added POU has to be scheduled, too" for why the pinned slots are not
   merely a courtesy.
4. **Declare-from-error.** The `"OutfeedBusy is not declared"` validation message carries a
   quick-fix that opens the variables pane with the name filled in and a kind guessed from where
   the element sits — a coil implies a bit, a `MOV` destination implies a word.

   `missingDeclarations(spec, project)` in `symbols.ts` is the shared half: it re-runs resolution,
   keeps the `undeclared` issues, and reads the kind off the element that used the name. The
   element already says it unambiguously — a timer's device is a timer, a `MOV`'s destination is a
   word, an operand of any word block is a value, everything else that takes a device takes a bit —
   so asking the player to pick a type they have already implied is a question with one right
   answer. Names no declaration could fix (`has space`, anything that reads as an address) are left
   out: a quick fix that cannot be applied is worse than none, and the validation message is
   already saying the right thing about those.

   It runs **as the player types, not on submit.** The whole point is that the fix is a declaration
   they were going to write anyway, and a message that arrives after a submission is a lap too
   late. So the section window's `VAR` badge carries the count, and the drawer behind it lists each
   name as a chip. Clicking one fills the draft — name and kind — and stops there, because *which*
   table it lands in is the decision the player is actually making. The globals window offers the
   same names deduplicated across sections, which is the case a global exists for.

## Build order

Steps 1 to 4 are `shared` only and ship behind `symbols: 'off'`, so nothing in the game changes
until a puzzle opts in.

1. **Done.** `VarDecl`, the optional fields on `Pou` and `LadderProject`, symbol derivation from
   `PuzzleDevice`.
2. **Done.** `resolveProject`, plus the test that runs every shipped ladder puzzle through
   assembly and resolution and asserts the result is deep-equal to what went in — and that
   `resolveProject` returns the *same object by reference* wherever `symbols` is off.
3. **Done.** Validation: pool membership, address collisions, rule 3, `writableOutputs`, and the
   never-write-a-field-input rule that came with it.
4. **Done.** `assembleProject` for player-authored POUs, the id-collision rule, and the
   shipped-globals merge.
   - Also `runnableProject`, which was not in the original plan and should have been. Three places
     build a `SimEngine` — the grader, the client's live scan and its reset path — and if any two
     of them assembled or resolved differently, the client and the server would silently disagree
     about the program. They now all go through one function. The editor deliberately does *not*
     resolve: it keeps the player's names, because names are what they typed.
5. **Done.** Client: symbol picker, variables pane, POU tree editing and declare-from-error.
   Nothing a player can see changes until step 7, because no shipped puzzle sets `symbols` yet.
   - `SymbolField` is a combobox over the in-scope table, keyboard-navigable, showing each name
     with its address and where it came from. The address also echoes inside the box once a name
     resolves, so naming a device never means hiding where it lives. This one is reachable:
     `CellFields` renders it and `FactoryPlay` feeds it `symbolChoicesFor(spec, project, pouId)`.
   - `VariablesPanel` is the declaration table, and it shows the address the *next* declaration
     would take before it takes it. Allocation is not something the player finds out about
     afterwards. It is mounted in `FactoryPlay` — a rail tool and a window for the globals, a
     title-bar toggle and a drawer per section for the locals. See §UI item 2 for why each scope
     is attached where it is.
   - `symbolChoicesFor` and `filterChoices` live in `shared` rather than the client, because the
     client has no unit-test runner and these are pure functions that deserve one.
6. **Done.** `factory-line-programs.ts` is written in names, and puzzles 48 to 53 set
   `symbols: 'optional'` so the sections they ship resolve. See §"The conversion" below.
7. Author puzzles 48 to 53 against `symbols: 'required'`.

## The conversion

118 rungs of addresses became 118 rungs of names, and puzzles 48 to 53 turned `symbols` on at
`'optional'` so that the sections they ship can resolve. `'optional'` and not `'required'` because
those are two different changes: this one had to leave every saved slot and every canonical
solution running exactly the bytes it ran before, and the literal-address fallback is what makes
that free.

**Proving it was a rename.** The soak's machine counts were the plan and turned out to be the
weaker test. What was actually done: `git show HEAD:…/factory-line-programs.ts` into a scratch
module, then a temporary test that resolved each new program and asserted deep equality against its
pre-conversion self, cell for cell. That catches a rename the soak cannot — a bit swapped for
another bit that happens not to matter over a 300 s shift — and it is the technique to reach for
the next time a content file is rewritten in place. Both scratch files were deleted once green.

Four things the conversion settled that were not in the design:

- **One declaration list per section, serving both its programs.** `LINE_VARS` is keyed by section
  id, not by program, because a slot ships either PLAIN or TUNED and never both. Where the two
  genuinely disagreed the fix was to make them agree rather than to blur a name: `M102` meant "both
  parts are in" in `ASSEMBLY_PLAIN` and "the frame is in" in `ASSEMBLY_TUNED`, so plain was given
  the tuned program's `FrameIn` *and* `BoomIn`. That costs it a `SET BoomIn` and an `RST BoomIn`
  that nothing reads — the only two cells in the whole file that are not a rename, and worth it,
  because a name that means two things is worse than the address it replaced.
- **A name has to come from a tier, so `D16` and `D17` became plant devices.** Both sections had
  read them since the line was built and no puzzle declared them; there is no tier for "a register
  the plant writes and the spec never mentions", and a `VarDecl` pointing at one would be exactly
  what rule 3 forbids. They are `Frame In Jig` and `Boom In Jig` in `LINE_DEVICES` now.
- **The zone devices carry an explicit `symbol`.** Derived from the label, `Z1 Weld Outfeed` gives
  `Z1WeldOutfeed`, which names the place. The eye reports *occupied*, so it is `Z1Occupied`, and
  `NOT Z3Occupied` is a rung that says what it does. Derivation is a default, not a policy.
- **`resolveProject` takes a `SymbolSpec`, not a `LadderPuzzleSpec`.** Three callers are not a
  submission — the soak, the tempo harness and the client's dev preview all run the shipped
  programs with no puzzle behind them — and they would otherwise have had to invent a `PuzzleSpec`
  that does not exist. Resolution only ever needed `symbols` and `devices`. Those three now share
  one builder, `lineProject()` in `factory-line-sections.ts`, which is also the thing that stops
  them drifting: each had assembled the plant by hand, and the day the programs stopped being
  addresses, each was one silent step from running a plant with nothing wired to it.

**What step 7 has to clear up, and why it could not be done here.** A `memoryPool` has to sit
inside the open section's `owns` block while `owns` is still in force, or the allocator hands the
player an address their own section may not write and the error lands on a rung rather than on the
declaration that caused it. Puzzle 49 is the only one with pools for that reason, and they are
exactly `CONV`'s block. **Puzzle 52 is the proof `owns` has to go**: it opens `ASSY` and `TEST`
together, and no single pool can be inside both blocks at once. That is not a wart in the pool
design, it is `owns` being a fence keyed on a section name in a game where storage belongs to the
player.
