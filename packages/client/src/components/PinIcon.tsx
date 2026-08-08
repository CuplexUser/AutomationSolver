/**
 * A pushpin with two genuinely different states.
 *
 * Every pin in the app used to be the 📌 emoji, which the font paints in colour
 * whatever the CSS says — so an unpinned control still looked lit, and the only
 * thing separating the two states was a one-pixel ring around the button. Here
 * the pin is drawn in `currentColor`: upright and filled when it is holding
 * something, tilted and hollow when it is not, which is the same distinction
 * every editor's pin makes and is readable without looking for the ring.
 */
export function PinIcon({ pinned, size = 13 }: { pinned: boolean; size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <g
        transform={pinned ? undefined : 'rotate(38 8 8)'}
        fill={pinned ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M5.2 2h5.6v1.5H9.5v3.2l2 2.6h-7l2-2.6V3.5H5.2Z" />
        <path d="M8 9.3v4.5" />
      </g>
    </svg>
  );
}
