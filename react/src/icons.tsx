// Inline SVG icons. currentColor throughout, aria-hidden: every button that
// shows one carries its own label.

interface IconProps {
  size?: number;
}

const base = (size: number) =>
  ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, focusable: false }) as const;

export function ChatIcon({ size = 24 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M12 21a9 9 0 1 0-8.05-4.97L3 21l4.97-.95A8.96 8.96 0 0 0 12 21Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloseIcon({ size = 24 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlaneIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M21 4 3 11l6.5 2.5M21 4l-4 16-7.5-6.5M21 4 9.5 13.5V19l3-3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SendIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DeliveredIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="m2 13 4 4L16 7M12 15l2 2L22 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HomeIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M4 11.5 12 5l8 6.5M6 10v9h4.5v-5h3v5H18v-9"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronRightIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PaperclipIcon({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="m20 11.5-8.1 8.1a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FileIcon({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z M14 3v5h5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ClipboardIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 13h6M9 17h4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ClockIcon({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
