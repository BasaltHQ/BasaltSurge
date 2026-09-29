"use client";

import { useEffect, useState } from 'react';
import type { TourCatalog } from '@/lib/admin-tour/documents';

export function useTourContent(enabled: boolean) {
  const [lessons, setLessons] = useState<TourCatalog | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setError('');
    void fetch('/api/docs/tour', { cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => { if (!data.lessons || typeof data.lessons !== 'object') throw new Error(); setLessons(data.lessons); })
      .catch(() => { if (!controller.signal.aborted) setError('Tour guides could not be loaded. Please try again.'); });
    return () => controller.abort();
  }, [enabled, revision]);
  return { lessons, error, retry: () => setRevision(value => value + 1) };
}
