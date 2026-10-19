import type { ReactNode, SVGProps } from "react";

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
export const Plus = icon(<path d="M12 5v14M5 12h14" />);
export const Search = icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></>);
export const Settings2 = icon(<><path d="M20 7h-9M14 17H4" /><circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" /></>);
/** The asterisk mark used for the brand and the working indicator. */
export const Spark = icon(<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" strokeWidth={2.6} />);
export const Square = icon(<rect x="6" y="6" width="12" height="12" rx="2" />);
export const BarChart = icon(<path d="M3 3v18h18M8 17v-4M13 17V8M18 17v-7" />);
export const Chip = icon(<><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="10" y="10" width="4" height="4" rx=".5" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>);
export const Repair = icon(<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z" />);
export const Trash2 = icon(<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />);
export const X = icon(<path d="M18 6 6 18M6 6l12 12" />);
