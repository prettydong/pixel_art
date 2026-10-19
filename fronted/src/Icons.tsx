import { useId, type ReactNode, type SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

// Outline icons on a 24 × 24 canvas, drawn with round 2-unit strokes and shown at 16 px.
function icon(shape: ReactNode) {
  return function Icon({ className = "", ...props }: IconProps) {
    return (
      <svg
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
        className={`icon ${className}`}
      >
        {shape}
      </svg>
    );
  };
}

export const Alert = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 8v4.5M12 16h.01" /></>);
export const ArrowUp = icon(<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />);
export const ArrowRight = icon(<path d="M5 12h14M12.5 5.5 19 12l-6.5 6.5" />);
export const Check = icon(<path d="M20 6 9 17l-5-5" />);
export const ChevronDown = icon(<path d="m6 9 6 6 6-6" />);
export const ChevronRight = icon(<path d="m9 6 6 6-6 6" />);
export const Copy = icon(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>);
export const Download = icon(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />);
export const Ellipsis = icon(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>);
export const Folder = icon(<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);
export const Menu = icon(<path d="M4 6h16M4 12h16M4 18h16" />);
export const MessageSquare = icon(<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />);
export const PanelLeftClose = icon(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M16 15l-3-3 3-3" /></>);
export const Paperclip = icon(<path d="m20.5 11.5-8.4 8.4a5 5 0 0 1-7.1-7.1l8.4-8.4a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />);
export const Play = icon(<path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z" />);
export const Plus = icon(<path d="M12 5v14M5 12h14" />);
export const Search = icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></>);
export const Settings2 = icon(<><path d="M20 7h-9M14 17H4" /><circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" /></>);
export const Square = icon(<rect x="6" y="6" width="12" height="12" rx="2" />);
export const BarChart = icon(<path d="M3 3v18h18M8 17v-4M13 17V8M18 17v-7" />);
export const Chip = icon(<><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="10" y="10" width="4" height="4" rx=".5" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>);
export const Repair = icon(<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z" />);
export const Trash2 = icon(<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />);
export const X = icon(<path d="M18 6 6 18M6 6l12 12" />);
export const Sun = icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>);
export const Moon = icon(<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />);
export const Monitor = icon(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>);
export const Globe = icon(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>);
export const Zap = icon(<path d="M13 2 4 14h7l-1 8 9-12h-7z" />);
export const Database = icon(<><ellipse cx="12" cy="5.5" rx="8" ry="2.5" /><path d="M4 5.5v13c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-13M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5" /></>);
export const CornerDownLeft = icon(<path d="M20 4v7a4 4 0 0 1-4 4H5M9 10l-5 5 5 5" />);

/** The brand: a notched wafer with an iridescent sheen, a die grid and a few lit dies. */
export function WaferMark({ className = "", ...props }: IconProps) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" {...props} className={`wafer-mark ${className}`}>
      <defs>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c6cff" />
          <stop offset=".32" stopColor="#38bdf8" />
          <stop offset=".58" stopColor="#34d399" />
          <stop offset=".8" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#f472b6" />
        </linearGradient>
        <clipPath id={`${id}-clip`}><path d="M9.7 28.5A14 14 0 1 1 22.3 28.5Z" /></clipPath>
      </defs>
      <path d="M9.7 28.5A14 14 0 1 1 22.3 28.5Z" fill={`url(#${id}-sheen)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <path className="wafer-grid" d="M8 0v32M12 0v32M16 0v32M20 0v32M24 0v32M0 8h32M0 12h32M0 16h32M0 20h32M0 24h32" fill="none" />
        <rect className="wafer-die" x="12.6" y="8.6" width="2.8" height="2.8" rx=".5" />
        <rect className="wafer-die" x="20.6" y="12.6" width="2.8" height="2.8" rx=".5" />
        <rect className="wafer-die" x="8.6" y="16.6" width="2.8" height="2.8" rx=".5" />
        <rect className="wafer-die" x="16.6" y="20.6" width="2.8" height="2.8" rx=".5" />
      </g>
    </svg>
  );
}
