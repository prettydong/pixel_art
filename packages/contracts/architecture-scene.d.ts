export const architectureSceneProtocol: 'pixel-architecture-scene/v1';
export const architectureColorTokens: readonly string[];
type Box = { id: string; x: number; y: number; width: number; height: number };
export type ArchitectureNode =
  | (Box & { type: 'rect'; fill: string; label?: string })
  | (Box & { type: 'divider'; color: string; label: string })
  | (Box & { type: 'text'; text: string; color: string })
  | { id: string; type: 'grid'; x: number; y: number; rows: number; cols: number; cellWidth: number; cellHeight: number; lineWidth: number; lineColor: string; fill: string; label: string };
export type ArchitectureScene = {
  protocol: typeof architectureSceneProtocol; architectureId: string; fingerprint: string; title: string; description: string;
  canvas: { width: number; height: number; background: string; physicalPixelsPerUnit: 3 };
  font: { family: 'Fusion Pixel'; size: 12; lineHeight: 16; weight: 400 };
  draw?: { file: 'draw.mjs'; grid: { rows: number; cols: number; lineColor: string; fill: string }; records: { label: string; geometry: string; color: string }[] };
  palette: Record<string, string>; nodes: ArchitectureNode[]; assumptions: string[];
};
export function validateArchitectureScene(input: unknown): ArchitectureScene;
