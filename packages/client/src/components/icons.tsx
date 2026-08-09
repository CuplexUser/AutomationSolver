/**
 * The workspace rail's icons.
 *
 * Drawn rather than typed, for the reason `PinIcon` is: an emoji is painted by
 * the font in its own colour and ignores the state of the control it sits in.
 * All of these are 16-grid, `currentColor`, and sized by the caller.
 */

function Icon({ size = 15, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      {children}
    </svg>
  );
}

/** The operator panel: a lamp, a readout and two pushbuttons. */
export function PanelIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.6" />
      <circle cx="4.6" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <path d="M7.6 5.2h4.2M7.6 7h4.2" />
      <path d="M3.8 10.6h2.6M9.4 10.6h2.6" />
    </Icon>
  );
}

/** Clearing the desk: the windows go away. */
export function DeskIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="1.4" y="2.8" width="8.4" height="7" rx="1.2" />
      <path d="M1.4 5h8.4" />
      <path d="M10.6 10.2l4 4M14.6 10.2l-4 4" />
    </Icon>
  );
}

/** Globals: a tag, because a variable is a name tied onto an address. */
export function TagIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M8.4 1.8H12.7a1.5 1.5 0 0 1 1.5 1.5v4.3l-6.4 6.4a1.5 1.5 0 0 1-2.1 0L1.8 9.7a1.5 1.5 0 0 1 0-2.1Z" />
      <circle cx="11" cy="5" r="1.1" />
    </Icon>
  );
}

/** Save: the floppy every editor still draws. */
export function SaveIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M2.6 4a1.4 1.4 0 0 1 1.4-1.4h6.2l3.2 3.2V12a1.4 1.4 0 0 1-1.4 1.4H4A1.4 1.4 0 0 1 2.6 12Z" />
      <path d="M5.4 2.6v3.2h4.4V2.6" />
      <path d="M5.4 13.4V9.6h5.2v3.8" />
    </Icon>
  );
}

/** Submit: hand it in and have it marked. */
export function SubmitIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M2.8 8.4l3.4 3.4L13.2 4.6" />
    </Icon>
  );
}
