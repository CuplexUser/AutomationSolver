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
- `'optional'` — names resolve if declared, addresses always work.
- `'required'` — an undeclared name that is a bare address is an error in player-written code.
  Puzzles 48 to 53.

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

The one conversion is `content/factory-line-programs.ts`, whose 118 rungs become symbolic. Those
programs have never shipped inside a puzzle, so there are no saved slots pointing at them and the
conversion costs nothing but the edit. Puzzle 47 keeps its raw-address sections.

## UI

Four pieces, in the order they are worth building:

1. **Symbol picker on the device field.** A combobox over the in-scope table, showing the name
   with its address as secondary text. This is the piece that makes the feature usable; without it
   declaring a variable is worse than typing `M40`.
2. **Variables pane.** A table per POU for locals and one at project level for globals: name,
   kind, address (read-only), comment. Add and delete. `fixed` rows are shown greyed with their
   publisher named.
3. **POU tree editing.** Add, rename, delete, drag to reorder. Pinned rows for fixture slots.
4. **Declare-from-error.** The `"OutfeedBusy is not declared"` validation message carries a
   quick-fix that opens the variables pane with the name filled in and a kind guessed from where
   the element sits — a coil implies a bit, a `MOV` destination implies a word.

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
5. Client. **Symbol picker wired; variables pane written but not mounted**; POU tree editing and
   declare-from-error remain. See [`TODO.md`](../TODO.md) P1.
   - `SymbolField` is a combobox over the in-scope table, keyboard-navigable, showing each name
     with its address and where it came from. The address also echoes inside the box once a name
     resolves, so naming a device never means hiding where it lives. This one is reachable:
     `CellFields` renders it and `FactoryPlay` feeds it `symbolChoicesFor(spec, project, pouId)`.
   - `VariablesPanel` is the declaration table, and it shows the address the *next* declaration
     would take before it takes it. Allocation is not something the player finds out about
     afterwards. **It is imported by nothing**, so there is currently no way to open it and
     therefore no way to declare a variable at all — which makes every step above it dead code
     from a player's point of view. Mounting it is the first box of P1.
   - `symbolChoicesFor` and `filterChoices` live in `shared` rather than the client, because the
     client has no unit-test runner and these are pure functions that deserve one.
6. Convert `factory-line-programs.ts` to symbols; the soak test in `factoryLine.test.ts` is the
   proof the conversion changed no behaviour, since it must ship the same machine counts.
7. Author puzzles 48 to 53 against `symbols: 'required'`.

Step 6 is worth calling out: the soak harness already reports shipped counts for all seven
configurations, so a symbolic rewrite that is genuinely a rename produces byte-identical numbers.
That is the regression test for the conversion, and it exists already.
