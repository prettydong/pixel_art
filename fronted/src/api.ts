import type { ApiError, FileRecord } from '@pixel/contracts';

export class RequestError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}
export const apiUrl = (path: string) => `${import.meta.env.BASE_URL}api${path}`;
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    credentials: 'same-origin', ...options,
    headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as ApiError | null;
    if (response.status === 401) window.dispatchEvent(new Event('pixel:unauthorized'));
    throw new RequestError(data?.error?.message || `请求失败（${response.status}）`, response.status, data?.error?.code || 'request_failed');
  }
  return response.json() as Promise<T>;
}
export const fileUrl = (file: FileRecord) => file.kind === 'upload'
  ? apiUrl(`/uploads/${encodeURIComponent(file.id)}`)
  : apiUrl(`/conversations/${encodeURIComponent(file.conversationId ?? '')}/files/${encodeURIComponent(file.id)}`);
export const errorText = (error: unknown) => error instanceof Error ? error.message : '请求失败，请重试';
// getRandomValues also works on an internal HTTP development origin.
export function requestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
