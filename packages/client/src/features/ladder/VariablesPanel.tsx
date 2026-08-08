import { useMemo, useState } from 'react';
import {
  allocateAddress,
  isValidVarName,
  VAR_KIND_DEVICE,
  type LadderPuzzleSpec,
  type VarDecl,
  type VarKind,
} from '@automationsolver/shared';
import { GLOBAL_SCOPE, useEditor, varsIn } from './editorStore';

/**
 * The declaration table: one for a POU's locals, one for the project's globals.
 *
 * Deliberately shows the address it allocated rather than hiding it. In IEC a
 * `VAR` need not be located at all and the compiler places it where it likes;
 * here every variable is located, because the game is teaching a platform where
 * `M40` is a real thing an engineer reads off a monitor screen. The name is for
 * the program, the address is for the person standing at the panel, and a player
 * who never sees the second one has not learned the platform.
 */

const KIND_LABEL: Record<VarKind, string> = {
  bool: 'Bit',
  int: 'Word',
  timer: 'Timer',
  counter: 'Counter',
};

const KINDS: VarKind[] = ['bool', 'int', 'timer', 'counter'];

export interface VariablesPanelProps {
  spec: LadderPuzzleSpec;
  /** A POU id, or `GLOBAL_SCOPE`. */
  scope: string;
  /** Heading, e.g. `CONV locals` or `Globals`. */
  title: string;
  /** A read-only section's table is shown but not edited. */
  readOnly?: boolean;
}

export function VariablesPanel({ spec, scope, title, readOnly = false }: VariablesPanelProps) {
  const project = useEditor((s) => s.project);
  const addVar = useEditor((s) => s.addVar);
  const removeVar = useEditor((s) => s.removeVar);
  const patchVar = useEditor((s) => s.patchVar);

  const vars = varsIn(project, scope);
  const [draftName, setDraftName] = useState('');
  const [draftKind, setDraftKind] = useState<VarKind>('bool');

  const nextAddress = useMemo(
    () => allocateAddress(spec, project, draftKind),
    [spec, project, draftKind],
  );

  const trimmed = draftName.trim();
  const clash = vars.some((v) => v.name.trim().toLowerCase() === trimmed.toLowerCase());
  const nameOk = trimmed !== '' && isValidVarName(trimmed);
  const canAdd = !readOnly && nameOk && !clash && nextAddress !== null;

  const problem = (): string | null => {
    if (trimmed === '') return null;
    if (!isValidVarName(trimmed)) {
      return /^[XYMTCD]\d+$/i.test(trimmed)
        ? `${trimmed} is an address, not a name. Give it one that says what it does.`
        : 'Start with a letter or underscore, then letters, digits or underscores.';
    }
    if (clash) return `${trimmed} is already declared here.`;
    if (nextAddress === null) return `No ${KIND_LABEL[draftKind].toLowerCase()} addresses left.`;
    return null;
  };

  const submit = (): void => {
    if (!canAdd || nextAddress === null) return;
    addVar(scope, { name: trimmed, kind: draftKind, address: nextAddress });
    setDraftName('');
  };

  const message = problem();

  return (
    <section className="vars-panel" aria-label={title}>
      <header className="vars-head">
        <h3>{title}</h3>
        <span className="vars-count">{vars.length}</span>
      </header>

      {vars.length === 0 ? (
        <p className="vars-empty">
          {readOnly
            ? 'This program declares nothing of its own.'
            : scope === GLOBAL_SCOPE
              ? 'Nothing published yet. A global is how one program tells the others what it is doing.'
              : 'Nothing declared yet. A local is yours alone — no other program can name it.'}
        </p>
      ) : (
        <table className="vars-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>At</th>
              <th>Comment</th>
              {!readOnly && <th aria-label="Remove" />}
            </tr>
          </thead>
          <tbody>
            {vars.map((decl) => (
              <VarRow
                key={decl.address}
                decl={decl}
                readOnly={readOnly}
                onRename={(name) => patchVar(scope, decl.name, { name })}
                onComment={(comment) => patchVar(scope, decl.name, { comment })}
                onRemove={() => removeVar(scope, decl.name)}
              />
            ))}
          </tbody>
        </table>
      )}

      {!readOnly && (
        <div className="vars-add">
          <input
            className="field mono compact"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="NewName"
            aria-label={`New variable in ${title}`}
            spellCheck={false}
          />
          <select
            className="field mono compact"
            value={draftKind}
            onChange={(e) => setDraftKind(e.target.value as VarKind)}
            aria-label="Type"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]} ({VAR_KIND_DEVICE[k]})
              </option>
            ))}
          </select>
          {/* The address it would take, before it takes it. Allocation is not a
              surprise the player finds out about afterwards. */}
          <span className="vars-next mono" aria-live="polite">
            {nextAddress ?? '—'}
          </span>
          <button className="btn small" onClick={submit} disabled={!canAdd}>
            Declare
          </button>
        </div>
      )}
      {message && <p className="vars-problem">{message}</p>}
    </section>
  );
}

function VarRow({
  decl,
  readOnly,
  onRename,
  onComment,
  onRemove,
}: {
  decl: VarDecl;
  readOnly: boolean;
  onRename: (name: string) => void;
  onComment: (comment: string) => void;
  onRemove: () => void;
}) {
  // A shipped declaration is a fixture's published interface. Renaming one would
  // rename it only here, and the program that publishes it would go on writing
  // the address under the old name.
  const locked = readOnly || decl.fixed === true;
  return (
    <tr className={locked ? 'is-locked' : undefined}>
      <td>
        {locked ? (
          <span className="mono">{decl.name}</span>
        ) : (
          <input
            className="field mono compact"
            value={decl.name}
            onChange={(e) => onRename(e.target.value)}
            aria-label={`Name of ${decl.name}`}
            spellCheck={false}
          />
        )}
      </td>
      <td className="mono vars-kind">{KIND_LABEL[decl.kind]}</td>
      <td>
        <span className={`vars-addr dev-${decl.address[0]}`}>{decl.address}</span>
      </td>
      <td>
        {locked ? (
          <span className="vars-comment">{decl.comment ?? ''}</span>
        ) : (
          <input
            className="field compact"
            value={decl.comment ?? ''}
            onChange={(e) => onComment(e.target.value)}
            placeholder="what it is for"
            aria-label={`Comment on ${decl.name}`}
          />
        )}
      </td>
      {!readOnly && (
        <td>
          {!locked && (
            <button
              className="btn small ghost"
              onClick={onRemove}
              title={`Delete ${decl.name}`}
              aria-label={`Delete ${decl.name}`}
            >
              ×
            </button>
          )}
        </td>
      )}
    </tr>
  );
}
