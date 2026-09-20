import { useLayoutEffect, useRef } from "react";
import { getPixelUnit } from "./pixelGrid";

/** Clip a second ink layer; the original text stays selectable and readable. */
export function UserMessageText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const unit = getPixelUnit();
      const width = Math.ceil(element.getBoundingClientRect().width / unit);
      // Both ends and every animation step land on an integer design pixel.
      element.style.setProperty("--shine-end", `${width}rem`);
      element.style.setProperty("--shine-steps", String(width + 24));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [text]);

  return (
    <span className="user-message-text" ref={ref}>
      {text}
      <span className="user-message-shine" aria-hidden="true">{text}</span>
    </span>
  );
}
