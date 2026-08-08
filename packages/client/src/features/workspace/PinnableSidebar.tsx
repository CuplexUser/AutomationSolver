import { useEffect, useState, type ReactNode } from 'react';

/**
 * The work order, demoted from a column to a tab.
 *
 * On a station puzzle the briefing can afford a permanent third of the screen.
 * On a plant it cannot: the thing the player is reading against is the machine,
 * and a manual that is only consulted now and then should not cost the plant a
 * third of its width for the whole session. So it has three states — a closed
 * tab, an overlay that floats above the workspace, and pinned, where it takes
 * real layout space back and pushes the workspace over.
 *
 * Pinned-ness is a preference and outlives the puzzle; whether it is *open*
 * right now does not.
 */
export function PinnableSidebar({
  title,
  side = 'right',
  storageKey,
  children,
}: {
  title: string;
  side?: 'left' | 'right';
  storageKey: string;
  children: ReactNode;
}) {
  const [pinned, setPinned] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(storageKey) === '1';
  });
  const [open, setOpen] = useState(pinned);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, pinned ? '1' : '0');
  }, [storageKey, pinned]);

  // Unpinning collapses back to the tab rather than leaving an overlay behind
  // with no obvious way to tell the two states apart.
  const unpin = () => {
    setPinned(false);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        className={`sidebar-tab sidebar-${side}`}
        onClick={() => setOpen(true)}
        title={`Show the ${title.toLowerCase()}`}
        aria-expanded={false}
      >
        <span className="sidebar-tab-text">{title}</span>
      </button>
    );
  }

  return (
    <aside
      className={`work-sidebar sidebar-${side}${pinned ? ' pinned' : ' floating'}`}
      aria-label={title}
    >
      <header className="ws-head">
        <span className="eyebrow">{title}</span>
        <span className="fw-spacer" />
        <button
          className={`fw-btn${pinned ? ' on' : ''}`}
          onClick={() => (pinned ? unpin() : setPinned(true))}
          aria-pressed={pinned}
          title={pinned ? 'Unpin — let it float over the plant' : 'Pin — keep it beside the plant'}
        >
          📌
        </button>
        <button
          className="fw-btn"
          onClick={() => {
            setOpen(false);
            setPinned(false);
          }}
          title="Hide"
          aria-label={`Hide the ${title.toLowerCase()}`}
        >
          ✕
        </button>
      </header>
      <div className="ws-body">{children}</div>
    </aside>
  );
}
