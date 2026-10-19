import { useEffect, useRef, useState } from 'react';

export function useChartViewport() {
  const viewport = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(400);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setAvailable(Math.max(1, Math.floor(element.clientWidth)));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  return { viewport, available };
}

export function revealChartCell(element: HTMLDivElement, x: number, y: number, width: number, height: number) {
  const left = x, top = y, right = x + width, bottom = y + height;
  if (left < element.scrollLeft) element.scrollLeft = left;
  else if (right > element.scrollLeft + element.clientWidth) element.scrollLeft = right - element.clientWidth;
  if (top < element.scrollTop) element.scrollTop = top;
  else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight;
}
