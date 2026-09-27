/** Published docs reference these bindings; arbitrary selectors, scripts and URLs are never executable. */
export interface TourResource {
  target: string;
  source: string;
}
export interface TourStep {
  id: string;
  title: string;
  brief: string;
  extended: string;
  mode?: 'extended';
  optional?: string;
  actions: { type: 'activate' | 'highlight'; resource: TourResource; destination?: TourResource }[];
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z][a-zA-Z0-9._-]{0,119}$/.test(v);
const prose = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 3000;
export function parseTourSteps(value: unknown): TourStep[] {
  if (!Array.isArray(value) || !value.length || value.length > 60) throw new Error('Actions must contain 1–60 steps.');
  const ids = new Set<string>();
  for (const step of value) {
    if (!object(step) || !identifier(step.id) || ids.has(step.id)) throw new Error('Each action step requires a unique stable id.');
    if (Object.keys(step).some(key => !['id', 'title', 'brief', 'extended', 'mode', 'optional', 'actions'].includes(key))) throw new Error('Unknown walkthrough step field.');
    ids.add(step.id);
    if (!prose(step.title) || !prose(step.brief) || !prose(step.extended)) throw new Error(`Step ${step.id} needs title, brief and extended explanations.`);
    if (step.mode !== undefined && step.mode !== 'extended') throw new Error('Step mode must be extended or omitted.');
    if (step.optional !== undefined && !prose(step.optional)) throw new Error('Optional steps need an availability explanation.');
    if (!Array.isArray(step.actions) || !step.actions.length || step.actions.length > 8) throw new Error('Each step needs 1–8 actions.');
    if (step.actions.at(-1)?.type !== 'highlight') throw new Error('Each step must end with a highlight.');
    for (const action of step.actions) {
      if (!object(action) || !['activate', 'highlight'].includes(String(action.type)) || !object(action.resource)) throw new Error('Only activate and highlight actions are supported.');
      if (action.destination !== undefined && (action.type !== 'activate' || !object(action.destination))) throw new Error('Only activate actions can declare a destination resource.');
      for (const resource of [action.resource, ...(action.destination ? [action.destination as Record<string, unknown>] : [])]) {
        const { target, source } = resource;
        if (!identifier(target) || typeof source !== 'string' || !/^src\/[a-zA-Z0-9_()/.\[\]-]+\.tsx$/.test(source) || source.includes('..')) throw new Error('Actions require a stable target and repository TSX source.');
        if (Object.keys(resource).some(k => !['target', 'source'].includes(k))) throw new Error('Unknown resource fields; selectors, URLs and code are not allowed.');
      }
      if (Object.keys(action).some(k => !['type', 'resource', 'destination'].includes(k))) throw new Error('Unknown action fields; selectors, URLs and code are not allowed.');
    }
  }
  return value as TourStep[];
}

export const stepsForMode = (steps: readonly TourStep[] = [], mode: 'brief' | 'extended') => steps.filter(s => mode === 'extended' || s.mode !== 'extended');
