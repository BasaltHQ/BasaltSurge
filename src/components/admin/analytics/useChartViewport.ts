"use client";
import { useEffect, useState } from "react";

/** SVG coordinates follow CSS pixels, keeping circles, labels and strokes undistorted. */
export function useChartViewport(minimum = 640) {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    if (!element) return;
    const update = () => {
      if (element.clientWidth > 0) setWidth(Math.max(minimum, Math.round(element.clientWidth)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, minimum]);
  return { ref, width };
}
