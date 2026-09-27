import type { TourStep } from './steps';
import { spotlight } from './spotlight';

export interface TourControl { id: string; label: string; kind: string; disabled: boolean; }
export interface TourAction { controlId: string; action: "click" | "fill"; value?: string; }

// Never export field values, free-form page text, or credentials to the voice model.
const secret = /password|secret|token|api.?key|private.?key|seed|mnemonic|card.?number|cvv|cvc/i;
export const isSensitiveControl = (label: string, type = "") => secret.test(label) || ["password", "hidden", "file"].includes(type);

export class TourInterface {
  private controls = new Map<string, HTMLElement>();
  private generation = 0;
  private clearHighlight?: () => void;
  constructor(private root: () => HTMLElement | null) {}

  private roots(): HTMLElement[] {
    const root = this.root();
    if (!root) return [];
    // Many panels render their editors in a React portal outside the panel node.
    const dialogs = root.ownerDocument?.querySelectorAll<HTMLElement>('[role="dialog"], dialog[open]');
    return [root, ...Array.from(dialogs || []).filter(el => !root.contains(el) && !el.closest('[data-tour-private]'))];
  }

  reset() { this.controls.clear(); this.generation++; this.clearHighlight?.(); }

  inspect(): TourControl[] {
    this.reset();
    return [...new Set(this.roots().flatMap(root => Array.from(root.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [role="tab"], [role="button"], summary'))))]
      .filter(el => el.getClientRects().length > 0 && !el.closest('[aria-hidden="true"], [hidden], [data-tour-private]'))
      .flatMap((el, index) => {
        const input = el as HTMLInputElement;
        const label = (el.getAttribute("aria-label") || el.getAttribute("title") ||
          (input.labels?.length ? Array.from(input.labels).map(l => l.textContent).join(" ") : "") ||
          el.getAttribute("placeholder") || (['BUTTON', 'A', 'SUMMARY'].includes(el.tagName) || el.getAttribute('role') ? el.textContent : '') || el.getAttribute('name') || '').trim().slice(0, 140);
        if (!label || isSensitiveControl(`${label} ${el.id} ${el.getAttribute('name') || ''}`, input.type)) return [];
        const id = `${this.generation}:${index}`;
        this.controls.set(id, el);
        return [{ id, label, kind: el.getAttribute('role') || input.type || el.tagName.toLowerCase(), disabled: !!input.disabled || el.getAttribute('aria-disabled') === 'true' }];
      }).slice(0, 150);
  }

  private resolve(id: string): HTMLElement {
    const el = this.controls.get(id);
    if (!el || !el.isConnected || !this.roots().some(root => root.contains(el)) || !el.getClientRects().length) throw new Error("Control changed. Inspect the panel again.");
    if ((el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true') throw new Error("This control is disabled.");
    return el;
  }

  highlight(id: string) {
    const el = this.resolve(id);
    this.clearHighlight?.();
    this.clearHighlight = spotlight(el, el.getAttribute('aria-label') || 'Explore this control');
    return "Control highlighted.";
  }

  async walkthrough(step: TourStep): Promise<{ status: 'shown' | 'unavailable'; reason?: string }> {
    this.reset();
    const generation = this.generation, root = this.root(), panel = root?.getAttribute?.('data-panel');
    const assertCurrent = () => {
      if (generation !== this.generation || !root || root !== this.root() || !root.isConnected || root.getAttribute?.('data-panel') !== panel) throw new Error('The panel changed. Restart this step.');
    };
    const find = (target: string) => {
      // Bindings are authored in TSX, not inferred from model-generated labels/selectors.
      if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,119}$/.test(target)) throw new Error('Invalid walkthrough binding.');
      const matches = Array.from(root!.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`))
        .filter(el => el.getClientRects().length && !el.closest('[hidden],[aria-hidden="true"],[data-tour-private]'));
      if (matches.length > 1) throw new Error(`Ambiguous walkthrough binding: ${target}`);
      return matches[0];
    };
    const wait = async (test: () => HTMLElement | undefined) => {
      const until = Date.now() + 3000;
      do {
        assertCurrent(); const found = test(); if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 60));
      } while (Date.now() < until);
      return undefined;
    };
    for (const action of step.actions) {
      assertCurrent();
      // Catalog cards and Back buttons unmount when their destination opens.
      // Verify the explicitly authored destination, including on a resumed step.
      const destination = action.type === 'activate' ? action.destination : undefined;
      const activeDestination = () => {
        if (!destination) return undefined;
        const target = find(destination.target);
        return target?.getAttribute('data-tour-active') === 'true' ? target : undefined;
      };
      if (activeDestination()) continue;
      const el = await wait(() => find(action.resource.target));
      if (!el) {
        if (step.optional) return { status: 'unavailable', reason: step.optional };
        throw new Error(`The ${step.title} view is not available yet. Retry when the panel has loaded, or skip this step yourself.`);
      }
      assertCurrent();
      if (action.type === 'activate') {
        if (el.tagName !== 'BUTTON' || el.getAttribute('data-tour-action') !== 'activate' || el.closest('a[href]')) throw new Error('This binding is not approved for automatic view navigation.');
        if (destination && el.getAttribute('data-tour-destination') !== destination.target) throw new Error('This navigation destination is not approved by the control.');
        if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') {
          if (step.optional) return { status: 'unavailable', reason: step.optional };
          throw new Error('This view is disabled.');
        }
        // Never toggle an already active tab; verify React committed the destination before narrating.
        if (destination || el.getAttribute('data-tour-active') !== 'true') el.click();
        const activated = await wait(() => {
          if (destination) return activeDestination();
          const current = find(action.resource.target); return current?.getAttribute('data-tour-active') === 'true' ? current : undefined;
        });
        if (!activated) throw new Error('The view did not open. Retry this step.');
      } else {
        this.clearHighlight?.(); this.clearHighlight = spotlight(el, step.title);
      }
    }
    return { status: 'shown' };
  }

  describe(action: TourAction) {
    const el = this.resolve(action.controlId);
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent?.slice(0, 140) || el.getAttribute('name') || el.tagName;
    if (isSensitiveControl(`${label} ${el.id} ${el.getAttribute('name') || ''}`, (el as HTMLInputElement).type)) throw new Error('Enter sensitive information yourself.');
    return `${action.action === 'fill' ? 'Enter text in' : 'Activate'} “${label}”`;
  }

  // Called only by the user's Apply button, never directly by an agent tool.
  apply(action: TourAction) {
    this.describe(action);
    const el = this.resolve(action.controlId);
    if (action.action === 'click') {
      // Links outside this panel can unmount the guide. The user opens those directly.
      if (el.closest('a[href]')) throw new Error('Open this link directly to leave the panel.');
      el.click();
    } else {
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) throw new Error('This control does not accept text.');
      if ((el as HTMLInputElement).readOnly) throw new Error('This field is read-only.');
      const prototype = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (!setter) throw new Error('This field cannot be edited by the guide.');
      setter.call(el, String(action.value || '').slice(0, 4000));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.reset();
  }
}
