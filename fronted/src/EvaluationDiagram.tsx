type DiagramKind = "data" | "architecture" | "repair";

const descriptions: Record<DiagramKind, string> = {
  data: "失效分布示意：阵列中标出失效单元，下方展示分布柱形。",
  architecture: "冗余架构示意：四个存储分区，每个分区配置独立的冗余行和冗余列。",
  repair: "行替换示意：将包含失效单元的一行映射至备用行。",
};

// Native design-pixel geometry: 144 × 112 units, rendered at 144rem × 112rem.
// These diagrams illustrate the entry points; they are not evaluation results.
export function EvaluationDiagram({ kind }: { kind: DiagramKind }) {
  return (
    <svg
      className="evaluation-diagram"
      width="144"
      height="112"
      viewBox="0 0 144 112"
      shapeRendering="crispEdges"
      role="img"
      aria-label={descriptions[kind]}
    >
      <path className="diagram-frame" d="M0 8h2V2h6V0h128v2h6v6h2v96h-2v6h-6v2H8v-2H2v-6H0z" />
      <path className="diagram-ground" d="M4 8h4V4h128v4h4v96h-4v4H8v-4H4z" />
      {kind === "data" && (
        <>
          <rect className="diagram-frame" x="12" y="12" width="84" height="64" />
          {Array.from({ length: 48 }, (_, i) => (
            <rect
              key={i}
              className={[11, 19, 27, 30, 38].includes(i) ? "diagram-fault" : "diagram-cell"}
              x={15 + (i % 8) * 10} y={15 + Math.floor(i / 8) * 10}
              width="8" height="8"
            />
          ))}
          <rect className="diagram-scan" x="14" y="14" width="80" height="2" />
          <path className="diagram-ink" d="M104 14h26v2h-26zm0 6h18v2h-18zm0 6h22v2h-22z" />
          {[12, 22, 16].map((width, i) => (
            <rect key={i} className="diagram-accent" x="104" y={40 + i * 10} width={width} height="6" />
          ))}
          {[6, 10, 18, 10, 6, 14, 8, 4].map((height, i) => (
            <rect key={i} className="diagram-accent" x={15 + i * 10} y={98 - height} width="8" height={height} />
          ))}
          <path className="diagram-ink" d="M12 100h84v2H12zm92-12h6v6h-6zm10 0h16v2h-16zm0 4h10v2h-10z" />
        </>
      )}
      {kind === "architecture" && (
        <>
          {Array.from({ length: 8 }, (_, i) => (
            <g key={i} className="diagram-ink">
              <rect x={26 + i * 12} y="8" width="4" height="8" />
              <rect x={26 + i * 12} y="96" width="4" height="8" />
            </g>
          ))}
          <rect className="diagram-ink" x="12" y="16" width="120" height="80" />
          <rect className="diagram-ground" x="14" y="18" width="116" height="76" />
          {Array.from({ length: 4 }, (_, bank) => (
            <g key={bank} transform={`translate(${20 + (bank % 2) * 56} ${24 + Math.floor(bank / 2) * 36})`}>
              <rect className="diagram-frame" width="48" height="28" />
              {Array.from({ length: 15 }, (_, cell) => (
                <rect key={cell} className="diagram-cell" x={3 + (cell % 5) * 7} y={3 + Math.floor(cell / 5) * 6} width="5" height="4" />
              ))}
              <g className="diagram-resource" style={{ animationDelay: `${bank * 180}ms` }}>
                <rect x="39" y="3" width="6" height="16" />
                <rect x="3" y="22" width="42" height="3" />
              </g>
            </g>
          ))}
        </>
      )}
      {kind === "repair" && (
        <>
          <rect className="diagram-frame" x="10" y="20" width="56" height="56" />
          {Array.from({ length: 25 }, (_, i) => (
            <rect
              key={i}
              className={i === 12 ? "diagram-fault" : "diagram-cell"}
              x={13 + (i % 5) * 10} y={23 + Math.floor(i / 5) * 10}
              width="8" height="8"
            />
          ))}
          <path className="diagram-accent" d="M10 41h56v2H10zm0 10h56v2H10zm56-5h12v-18h12v2H80v18H66zm20-21h3v2h3v4h-3v2h-3v-3h-2v-2h2z" />
          <rect className="diagram-packet" x="66" y="45" width="3" height="3" />
          <rect className="diagram-frame" x="94" y="20" width="40" height="18" />
          {Array.from({ length: 5 }, (_, i) => (
            <rect key={i} className="diagram-accent" x={97 + i * 7} y="24" width="5" height="10" />
          ))}
          <path className="diagram-frame" d="M94 44h40v2H94zm0 6h28v2H94zm0 6h34v2H94z" />
          <path className="diagram-ink" d="M36 80h2v10h56v2H36z" />
          <path className="diagram-accent" d="M100 86h4v4h4v-4h4v-4h4v-4h4v8h-4v4h-4v4h-4v4h-4v-4h-4z" />
        </>
      )}
    </svg>
  );
}
