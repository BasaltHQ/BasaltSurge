import type { TourBrand } from './branding';

/** A preferred name is display data, never an agent instruction. */
export function cleanTourName(value: string): string {
  return String(value || '').normalize('NFC').replace(/[<>\r\n{}\[\]`\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 60).trim();
}

export function tourIntroduction(brand: TourBrand, name: string): string {
  const greeting = cleanTourName(name);
  return `Welcome${greeting ? `, ${greeting}` : ''}. I'm Daniel, your AI guide to ${brand.platformName}. ` +
    "I'll walk you through the panels you can access, highlighting the important controls as we go. " +
    "You can interrupt me at any time, and we'll leave room for your questions at the end of each panel. " +
    "You'll choose when to continue to the next panel. Let's begin.";
}
