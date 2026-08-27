import { useEffect, useRef } from 'react';

/** One instruction as the help sheet needs it — the palette's own shape, narrowed. */
export interface HelpInstruction {
  label: string;
  key: string;
  glyph: string;
}

interface HelpEntry {
  /** Keys or gestures, rendered as `<kbd>`s. */
  keys: string[];
  what: string;
}

interface HelpGroup {
  title: string;
  entries: HelpEntry[];
}

/**
 * Everything the grid can do, in one place.
 *
 * This list used to be a collapsed `<details>` at the foot of the instruction
 * palette, which is scrolled away most of the time and folded away the rest —
 * so the actions that only exist on the right-click menu were, in practice,
 * undiscoverable. Grouped by what the player is trying to *do*, because that is
 * how they arrive at it: "how do I move this block" is a question about the
 * rung's shape, not about a key.
 */
const GROUPS: HelpGroup[] = [
  {
    title: 'Selecting',
    entries: [
      { keys: ['Click'], what: 'Select a cell.' },
      { keys: ['←', '↑', '→', '↓'], what: 'Move the selected cell. Wraps on to the next rung at the edges.' },
      { keys: ['Ctrl', 'Click'], what: 'Add a cell to the selection, or take one out of it.' },
      { keys: ['Shift', 'Click'], what: 'Select every cell between the current one and the one clicked.' },
      {
        keys: ['Drag'],
        what: 'From an empty cell, sweep out a rectangle of cells to work on together.',
      },
      { keys: ['Esc'], what: 'Collapse a multi-cell selection, then deselect.' },
    ],
  },
  {
    title: 'Placing and editing',
    entries: [
      { keys: ['Double-click'], what: 'Select a cell and jump straight into its address or first operand.' },
      { keys: ['Enter'], what: 'Jump to the address field of the selected cell.' },
      { keys: ['Del'], what: 'Clear the selected cell, or every cell in the selection.' },
      { keys: ['B'], what: "Toggle a branch (vertical link) at the cell's left-hand node." },
      {
        keys: ['Ctrl', 'C / X / V'],
        what: 'Copy or cut the selection, then paste it with the selected cell as its top-left corner.',
      },
      {
        keys: ['Ctrl', 'Z'],
        what: 'Undo. Ctrl Shift Z or Ctrl Y redoes. Every grid edit is one step, however many cells it touched.',
      },
    ],
  },
  {
    title: 'Moving things',
    entries: [
      {
        keys: ['Drag'],
        what: 'From a filled cell, carry that block — or the whole selection — to another cell. Hold Ctrl to copy instead of move.',
      },
      { keys: ['Alt', 'Drag'], what: 'Carry the whole column to anywhere else along the rung.' },
      {
        keys: ['Alt', '← → ↑ ↓'],
        what: 'Swap the selected cell with the neighboring column or row, contents and all.',
      },
      { keys: ['Ctrl', '↑ / ↓'], what: 'Move the selected rung up or down.' },
    ],
  },
  {
    title: 'Rung structure',
    entries: [
      {
        keys: ['Right-click'],
        what: 'Open the cell menu: insert a column either side of this one, delete this column, or delete the element.',
      },
      { keys: ['A'], what: 'Add a rung at the end of the section.' },
      { keys: ['I'], what: 'Insert a rung directly after the selected one.' },
      {
        keys: ['Shift', 'I'],
        what: 'Insert a blank column before the selected cell, shifting the rest of the rung right.',
      },
      { keys: ['Shift', '→ / ↓'], what: 'Grow this rung by a column, or by a branch row.' },
      {
        keys: ['+col', '−row'],
        what: 'The buttons on the rung header grow and shrink it from the end; the rung number is on their left.',
      },
    ],
  },
  {
    title: 'View',
    entries: [
      { keys: ['Ctrl', '+ / − / 0'], what: 'Zoom in, out, or back to 100%.' },
      { keys: ['Fit'], what: 'Size the whole program to the window.' },
      { keys: ['?', 'F1'], what: 'Open this sheet.' },
    ],
  },
];

interface Props {
  /** The instructions this puzzle actually allows, so the key list matches the palette. */
  instructions: HelpInstruction[];
  onClose: () => void;
}

export function LadderHelp({ instructions, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the panel so Esc reaches it and a screen reader announces the dialog,
  // and put focus back where it was on the way out.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  // Captured, not bubbled: the editor's own window-level Esc handler would
  // otherwise deselect the cell on the same press that closes this sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="help-scrim" onPointerDown={onClose}>
      <div
        ref={panelRef}
        className="help-sheet panel"
        role="dialog"
        aria-modal="true"
        aria-label="Ladder editor help"
        tabIndex={-1}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="help-head">
          <h2>Editing a ladder</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close help">
            ✕
          </button>
        </header>

        <div className="help-body">
          <section className="help-group">
            <h3>Instructions</h3>
            <p className="help-note">
              Select a cell, then press a key — or click the button in the palette. Placing over an
              existing element replaces it.
            </p>
            <ul className="help-instr">
              {instructions.map((i) => (
                <li key={i.label}>
                  <span className="help-glyph">{i.glyph}</span>
                  <span className="help-instr-label">{i.label}</span>
                  <kbd>{i.key.toUpperCase()}</kbd>
                </li>
              ))}
            </ul>
          </section>

          {GROUPS.map((g) => (
            <section className="help-group" key={g.title}>
              <h3>{g.title}</h3>
              <dl className="help-keys">
                {g.entries.map((e) => (
                  <div key={e.what}>
                    <dt>
                      {e.keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </dt>
                    <dd>{e.what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          <section className="help-group help-wide">
            <h3>How a rung is read</h3>
            <p className="help-note">
              Power flows from the left rail rightward. Elements side by side are in series (both
              must conduct); a branch joins two rows into a parallel path (either will do). An
              energized output passes power on to its right, so a contact, a coil and a MOV can sit
              on one rung and read left to right.
            </p>
            <p className="help-note">
              A branch is drawn on the <em>boundary between two columns</em>, not on a cell. So
              inserting or deleting a column moves the branches after it along with the grid,
              because the number of boundaries changed — but dragging or swapping cells slides them
              past a branch that stays exactly where you drew it.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
