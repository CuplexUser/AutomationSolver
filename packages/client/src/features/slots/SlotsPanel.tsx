import { useRef, useState } from 'react';
import type { PuzzleSpec } from '@automationsolver/shared';
import type { PuzzleProgram, SolutionSlot } from '../../api/client';
import { useCreateSlot, useDeleteSlot, useSettings, useUpdateSlot } from '../../api/queries';
import { useAuth } from '../../auth/AuthContext';
import {
  SLOT_FILE_EXTENSION,
  buildEnvelope,
  decodeSlotFile,
  encodeSlotFile,
} from './slotFile';

export function SlotsPanel({
  spec,
  slots,
  activeId,
  program,
  emptyProgram,
  onSelect,
  onClose,
}: {
  spec: PuzzleSpec;
  slots: SolutionSlot[];
  activeId: number | null;
  program: PuzzleProgram;
  /** A blank program of this puzzle's kind, for starting a slot from scratch. */
  emptyProgram: PuzzleProgram;
  onSelect: (id: number) => void;
  onClose: () => void;
}) {
  const createSlot = useCreateSlot(spec.slug);
  const updateSlot = useUpdateSlot(spec.slug);
  const deleteSlot = useDeleteSlot(spec.slug);
  const { data: settingsData } = useSettings();
  const { user } = useAuth();
  const importExportEnabled = settingsData?.settings.enableImportExport === true;
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportCurrent = async () => {
    const envelope = buildEnvelope(spec.slug, program, user, new Date());
    const url = URL.createObjectURL(await encodeSlotFile(envelope));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${spec.slug}${SLOT_FILE_EXTENSION}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    setImportError(null);
    let imported: PuzzleProgram;
    try {
      // The envelope's email and display name are read but intentionally not used yet.
      ({ program: imported } = await decodeSlotFile(file));
    } catch {
      setImportError('That file is not a saved program.');
      return;
    }
    createSlot.mutate(
      { program: imported, name: file.name.replace(/\.(ladder|json)$/i, '') },
      {
        onSuccess: (slot) => onSelect(slot.id),
        onError: () => setImportError('That file was rejected as an invalid program.'),
      },
    );
  };

  const commitRename = (id: number) => {
    if (renameValue.trim()) updateSlot.mutate({ id, name: renameValue.trim() });
    setRenamingId(null);
  };

  return (
    <div className="slots-panel panel">
      <div className="slots-head">
        <span className="eyebrow">Save Slots</span>
        <button className="icon-btn" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      <ul className="slots-list">
        {slots.map((s) => (
          <li key={s.id} className={s.id === activeId ? 'active' : ''}>
            {renamingId === s.id ? (
              <input
                className="field compact"
                value={renameValue}
                autoFocus
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(s.id);
                  else if (e.key === 'Escape') setRenamingId(null);
                }}
                onBlur={() => commitRename(s.id)}
              />
            ) : (
              <button className="slot-name" onClick={() => onSelect(s.id)}>
                {s.name}
                {s.isSubmitted && (
                  <span className="slot-submitted-mark" title="Submitted">
                    ✔
                  </span>
                )}
              </button>
            )}
            <span className="slot-time muted sm">{new Date(s.updatedAt).toLocaleDateString()}</span>
            <div className="slot-actions">
              <button
                className="icon-btn"
                title="Rename"
                onClick={() => {
                  setRenamingId(s.id);
                  setRenameValue(s.name);
                }}
              >
                ✎
              </button>
              <button
                className="icon-btn"
                title="Delete"
                disabled={slots.length <= 1}
                onClick={() => {
                  const fallback = slots.find((x) => x.id !== s.id);
                  deleteSlot.mutate(s.id, {
                    onSuccess: () => {
                      if (s.id === activeId && fallback) onSelect(fallback.id);
                    },
                  });
                }}
              >
                🗑
              </button>
            </div>
          </li>
        ))}
        {slots.length === 0 && <li className="muted sm">No saved slots yet.</li>}
      </ul>
      <div className="slots-new">
        <button
          className="btn btn-ghost full"
          disabled={createSlot.isPending}
          onClick={() =>
            createSlot.mutate({ program: emptyProgram }, { onSuccess: (slot) => onSelect(slot.id) })
          }
          title="Start this puzzle over in a fresh, empty slot"
        >
          + New (start fresh)
        </button>
        <button
          className="btn btn-ghost full"
          disabled={createSlot.isPending}
          onClick={() => createSlot.mutate({ program }, { onSuccess: (slot) => onSelect(slot.id) })}
        >
          + New slot from current program
        </button>
      </div>
      {importExportEnabled && (
        <div className="slots-import-export">
          <button className="btn btn-ghost full" onClick={() => void exportCurrent()}>
            ⬇ Export current
          </button>
          <button className="btn btn-ghost full" onClick={() => fileInputRef.current?.click()}>
            ⬆ Import…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ladder,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importFile(file);
            }}
          />
          {importError && <p className="auth-error sm">{importError}</p>}
        </div>
      )}
    </div>
  );
}
