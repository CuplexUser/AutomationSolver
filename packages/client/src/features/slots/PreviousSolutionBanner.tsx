import { useState } from 'react';
import { slotApi } from '../../api/client';
import { useCreateSlot } from '../../api/queries';

/**
 * Shown when a fresh (no-slot) puzzle has a solved predecessor in the same
 * category — lets the player seed the editor from that prior solution
 * instead of rewriting logic they already solved. Category chains keep
 * addresses stable puzzle-to-puzzle (verified against the pick-place ramp),
 * so a predecessor's program is usually still valid, just incomplete.
 */
export function PreviousSolutionBanner({
  slug,
  previousPuzzle,
  onCopied,
}: {
  slug: string;
  previousPuzzle: { slug: string; title: string };
  onCopied: (slotId: number) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createSlot = useCreateSlot(slug);

  if (dismissed) return null;

  const copy = async () => {
    setLoading(true);
    setError(null);
    try {
      const { slots } = await slotApi.list(previousPuzzle.slug);
      const best =
        slots.filter((s) => s.isSubmitted).sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
        [...slots].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (!best) {
        setError('No saved solution found.');
        return;
      }
      const detail = await slotApi.get(previousPuzzle.slug, best.id);
      createSlot.mutate(
        { program: detail.program, name: `From ${previousPuzzle.title}` },
        {
          onSuccess: (slot) => {
            setDismissed(true);
            onCopied(slot.id);
          },
          onError: () => setError('Could not copy that solution.'),
        },
      );
    } catch {
      setError('Could not load that solution.');
    } finally {
      setLoading(false);
    }
  };

  const busy = loading || createSlot.isPending;

  return (
    <div className="panel prev-solution-banner">
      <p>
        Start from your solution to <strong>{previousPuzzle.title}</strong>?
      </p>
      {error && <p className="auth-error sm">{error}</p>}
      <div className="setting-row">
        <button className="btn btn-primary" disabled={busy} onClick={() => void copy()}>
          {busy ? 'Copying…' : 'Copy solution'}
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => setDismissed(true)}>
          Start blank
        </button>
      </div>
    </div>
  );
}
