import { NEUTRAL_TOUR_BRAND, renderTourText, type TourBrand } from './branding';
import type { TourStep } from './steps';

/** Sidebar-derived capabilities, never a replacement for API authorization. */
export type TourRole = 'shopper' | 'merchant' | 'partner/admin' | 'platform';
export type TourMode = 'brief' | 'extended';
export interface TourStop {
  id: string;
  panel: string;
  title: string;
  section: string;
  role?: TourRole;
}
export interface TourNavigation {
  stops: TourStop[];
  brand: TourBrand;
  navigate: (id: string) => boolean;
}
export interface TourLesson {
  title?: string;
  summary: string;
  explore: string[];
  takeaway: string;
  order?: number;
  documentationHref?: string;
  steps?: TourStep[];
}

export function buildTour(stops: readonly TourStop[], lessons: Record<string, TourLesson> = {}): TourStop[] {
  const sections = [...new Set(stops.map(s => s.section))];
  // Responsibility determines section order; documents determine the learning order within it.
  const priority = (section: string) => section === 'Platform' ? 0 : section === 'Partner/Admin' ? 1 :
    stops.some(s => s.section === section && s.role === 'merchant') ? 2 : section === 'Apps' ? 3 :
    section === 'Shopper' ? 4 : section === 'Nodes' ? 5 : section === 'General' ? 6 : 7;
  const order = (panel: string) => Object.hasOwn(lessons, panel) ? lessons[panel].order ?? 1000 : 1000;
  return [...new Map(stops.filter(s => s.panel !== 'takeTour').map(s => [s.id, s])).values()]
    .sort((a, b) => priority(a.section) - priority(b.section) || sections.indexOf(a.section) - sections.indexOf(b.section) ||
      order(a.panel) - order(b.panel) || a.title.localeCompare(b.title));
}

export function tourRoles(stops: readonly TourStop[]): TourRole[] {
  return [...new Set(stops.flatMap(s => s.role ? [s.role] : []))];
}

export function getLesson(stop: TourStop, lessons: Record<string, TourLesson> = {}, brand = NEUTRAL_TOUR_BRAND): TourLesson {
  const lesson = Object.hasOwn(lessons, stop.panel) ? lessons[stop.panel] : {
    summary: `Explore ${stop.title} in ${stop.section}.`,
    explore: ['Inspect the available headings and controls.', 'Ask the guide about the workflow you want to learn.'],
    takeaway: 'Know where to return for this task.',
  };
  const render = (text: string) => renderTourText(text, brand, stop.title, stop.section);
  return { ...lesson, summary: render(lesson.summary), explore: lesson.explore.map(render), takeaway: render(lesson.takeaway),
    steps: lesson.steps?.map(step => ({ ...step, title: render(step.title), brief: render(step.brief), extended: render(step.extended) })) };
}
