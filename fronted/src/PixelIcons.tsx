import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

// Every contour follows a 16 × 16 grid. No curved or diagonal strokes.
function icon(path: string) {
  return function PixelIcon({
    className = "",
    ...props
  }: IconProps) {
    return (
      <svg
        {...props}
        className={`pixel-icon ${className}`}
        width={16}
        height={16}
        viewBox="0 0 16 16"
        fill="currentColor"
        shapeRendering="crispEdges"
        aria-hidden="true"
        focusable="false"
      >
        <path d={path} fillRule="evenodd" />
      </svg>
    );
  };
}

export const ArrowUp = icon("M7 2h2v2h2v2h2v2h-2V6H9v8H7V6H5v2H3V6h2V4h2z");
export const ArrowRight = icon(
  "M8 2h2v2h2v2h2v4h-2v2h-2v2H8v-2h2v-2H2V6h8V4H8z",
);
export const Check = icon(
  "M12 3h2v4h-2v2h-2v2H8v2H6v-2H4V9H2V7h2v2h2v2h2V9h2V7h2z",
);
export const ChevronDown = icon(
  "M2 5h2v2h2v2h4V7h2V5h2v4h-2v2h-2v2H6v-2H4V9H2z",
);
export const ChevronRight = icon(
  "M5 2h2v2h2v2h2v4H9v2H7v2H5v-2h2v-2h2V6H7V4H5z",
);
export const Command = icon(
  "M2 2h5v3h2V2h5v5h-3v2h3v5H9v-3H7v3H2V9h3V7H2zm2 2v1h1V4zm7 0v1h1V4zM7 7v2h2V7zm-3 4v1h1v-1zm7 0v1h1v-1z",
);
export const Copy = icon("M1 1h10v3H9V3H3v6H1zm4 4h10v10H5zm2 2v6h6V7z");
export const Download = icon(
  "M7 1h2v6h3v2h-2v2H6V9H4V7h3zM2 11h2v2h8v-2h2v4H2z",
);
export const Ellipsis = icon("M1 7h3v3H1zm5 0h3v3H6zm5 0h3v3h-3z");
export const Folder = icon("M1 2h6v2h8v10H1zm2 4v6h10V6z");
export const Menu = icon("M2 3h12v2H2zm0 4h12v2H2zm0 4h12v2H2z");
export const MessageSquare = icon("M1 2h14v10H7v2H5v2H3v-4H1zm2 2v6h10V4z");
export const PanelLeftClose = icon(
  "M1 2h14v12H1zm2 2v8h2V4zm4 0v8h6V4zM9 6h2v4H9V9H8V7h1z",
);
export const Paperclip = icon(
  "M6 1h6v2h2v8h-2v2h-2v2H4v-2H2V7h2v6h6v-2h2V3H6v2H4V3h2zm0 4h4v6H6zm2 2v2h1V7z",
);
export const Plus = icon("M7 2h2v5h5v2H9v5H7V9H2V7h5z");
export const Search = icon(
  "M3 1h6v2h2v6H9v2H3V9H1V3h2zm0 2v6h6V3zm8 7h2v2h2v3h-3v-2h-2v-2h1z",
);
export const Settings2 = icon(
  "M4 1h2v2h2v2H6v2H4V5H1V3h3zm6 2h5v2h-5zM9 8h2v2h4v2h-4v2H9v-2H7v-2h2zm-8 2h4v2H1z",
);
export const Sparkles = icon(
  "M6 1h2v3h2v2h3v2h-3v2H8v3H6v-3H4V8H1V6h3V4h2zm6 10h2v2h2v2h-2v1h-2v-1h-2v-2h2z",
);
export const Square = icon("M3 3h10v10H3z");
export const BarChart = icon("M1 1h2v12h12v2H1zm4 7h2v3H5zm4-4h2v7H9zm4-3h2v10h-2z");
export const Chip = icon("M4 1h2v2h4V1h2v2h1v1h2v2h-2v4h2v2h-2v1h-1v2h-2v-2H6v2H4v-2H3v-1H1v-2h2V6H1V4h2V3h1zm1 4v6h6V5zm2 2h2v2H7z");
export const Repair = icon("M1 1h6v2H3v10h10V9h2v6H1zm10 0h2v3h3v2h-3v3h-2V6H8V4h3zM5 8h2v3H5z");
export const Trash2 = icon("M5 1h6v2h4v2H1V3h4zM3 6h2v7h2V6h2v7h2V6h2v9H3z");
export const X = icon(
  "M2 2h2v2h2v2h4V4h2V2h2v2h-2v2h-2v4h2v2h2v2h-2v-2h-2v-2H6v2H4v2H2v-2h2v-2h2V6H4V4H2z",
);
