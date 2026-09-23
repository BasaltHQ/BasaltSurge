
export const sessionStorageDecorator = {
  getItem(key: string): string | null {
    if (typeof window === "undefined") return null;
    if (key.startsWith("stripe_onramp_session_id")) {
      return window.sessionStorage.getItem(key);
    }
    return window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    if (typeof window === "undefined") return;
    if (key.startsWith("stripe_onramp_session_id")) {
      window.sessionStorage.setItem(key, value);
      return;
    }
    window.localStorage.setItem(key, value);
    window.sessionStorage.setItem(key, value);
  },
  removeItem(key: string): void {
    if (typeof window === "undefined") return;
    if (key.startsWith("stripe_onramp_session_id")) {
      window.sessionStorage.removeItem(key);
      return;
    }
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  }
};

export const sessionStorage = sessionStorageDecorator;
