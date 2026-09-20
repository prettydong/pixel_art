import { useEffect, useRef, useState } from 'react';
import { getPixelUnit } from './pixelGrid';

export function useChartViewport() {
  const viewport = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(400);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const unit = getPixelUnit();
      setAvailable(Math.max(1, Math.floor(element.clientWidth / unit)));
    };
    const observer = new ResizeObserver(measure);
    const grid = new MutationObserver(measure);
    observer.observe(element);
    grid.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    measure();
    return () => { observer.disconnect(); grid.disconnect(); };
  }, []);
  return { viewport, available };
}

export function revealChartCell(element: HTMLDivElement, x: number, y: number, width: number, height: number) {
  const unit = getPixelUnit();
  const left = x * unit, top = y * unit, right = (x + width) * unit, bottom = (y + height) * unit;
  if (left < element.scrollLeft) element.scrollLeft = left;
  else if (right > element.scrollLeft + element.clientWidth) element.scrollLeft = right - element.clientWidth;
  if (top < element.scrollTop) element.scrollTop = top;
  else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight;
}
