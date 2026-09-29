import type { TourLesson } from './catalog';
import { parseTourSteps } from './steps';

export type TourCatalog = Record<string, TourLesson>;

/** Small, explicit Markdown contract, usable by server discovery and authoring tests. */
export function parseTourDocument(markdown: string, href: string): { panel: string; lesson: TourLesson } {
  const marker = markdown.match(/^\s*<!--\s*tour\s+([\s\S]*?)-->/);
  if (!marker) throw new Error('Missing <!-- tour {"panel":"panelKey","order":100} --> metadata.');
  let metadata: { panel?: unknown; order?: unknown };
  try { metadata = JSON.parse(marker[1]); } catch { throw new Error('Tour metadata must be valid JSON.'); }
  if (!metadata || typeof metadata.panel !== 'string' || !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(metadata.panel)) throw new Error('Invalid tour panel key.');
  if (metadata.order !== undefined && (typeof metadata.order !== 'number' || !Number.isFinite(metadata.order) || metadata.order < 0)) throw new Error('Tour order must be a nonnegative number.');
  const body = markdown.slice(marker[0].length).replace(/\r\n/g, '\n');
  const title = body.match(/^# (.+)$/m)?.[1]?.trim();
  const sections = new Map<string, string>();
  for (const match of body.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)) {
    const heading = match[1].trim().toLowerCase();
    if (sections.has(heading)) throw new Error(`Duplicate section: ${heading}`);
    sections.set(heading, match[2].trim());
  }
  const summary = sections.get('overview'), walkthrough = sections.get('walkthrough'), takeaway = sections.get('takeaway');
  if (!title || !summary || !walkthrough || !takeaway) throw new Error('Tour guides require a title, Overview, Walkthrough and Takeaway.');
  const explore = walkthrough.split('\n').filter(line => /^[-*] /.test(line)).map(line => line.slice(2).trim());
  if (!explore.length) throw new Error('Walkthrough requires at least one bullet point.');
  if (summary.length > 4000 || takeaway.length > 2000 || explore.length > 20 || explore.some(point => point.length > 2000)) throw new Error('Tour lesson exceeds its content limits.');
  const actions = sections.get('actions');
  let steps;
  if (actions) {
    const json = actions.match(/^```json\s*\n([\s\S]*?)\n```$/);
    if (!json) throw new Error('Actions must be a single fenced JSON array.');
    try { steps = parseTourSteps(JSON.parse(json[1])); } catch (error) { throw new Error(`Actions: ${error instanceof Error ? error.message : 'Invalid JSON'}`); }
  }
  const tokens = (summary + walkthrough + takeaway + (actions || '')).match(/\{\{[^}]+\}\}/g) || [];
  for (const token of tokens) if (!/^\{\{(brandName|platformName|panelTitle|sectionTitle)\}\}$/.test(token)) throw new Error(`Unsupported tour token: ${token}`);
  return { panel: metadata.panel, lesson: { title, summary, explore, takeaway, steps, order: metadata.order as number | undefined, documentationHref: href } };
}

export function compileTourDocuments(documents: { markdown: string; href: string }[]): TourCatalog {
  const catalog: TourCatalog = Object.create(null);
  for (const document of documents) {
    let parsed: ReturnType<typeof parseTourDocument>;
    try { parsed = parseTourDocument(document.markdown, document.href); }
    catch (error) { throw new Error(`${document.href}: ${error instanceof Error ? error.message : 'Invalid guide'}`); }
    if (Object.hasOwn(catalog, parsed.panel)) throw new Error(`Duplicate tour panel: ${parsed.panel}`);
    catalog[parsed.panel] = parsed.lesson;
  }
  return catalog;
}
