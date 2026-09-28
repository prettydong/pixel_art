import { generateSpatialWafer, type GenerationOptions } from '@pixel/contracts/wafer-spatial';
import type { WaferLayout } from '@pixel/contracts/wafer-data';

const worker = self as unknown as { onmessage: ((event: MessageEvent<{ layout: WaferLayout; options: GenerationOptions }>) => void) | null; postMessage: (value: unknown, transfer?: Transferable[]) => void };
worker.onmessage = event => {
  try {
    const result = generateSpatialWafer(event.data.layout, event.data.options);
    worker.postMessage({ bytes: result.bytes, generation: result.generation, summary: result.summary }, [result.bytes.buffer as ArrayBuffer]);
  } catch (error) { worker.postMessage({ error: error instanceof Error ? error.message : '生成失败' }); }
};
