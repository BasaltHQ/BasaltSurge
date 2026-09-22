/** A reset invalidates work even while the React component remains mounted. */
export function createOnrampLifetime() {
  let generation = 0;
  return {
    invalidate() { generation += 1; },
    capture() {
      const captured = generation;
      return () => captured === generation;
    },
  };
}

export async function waitForOnrampRun<T>(work: PromiseLike<T> | T, isCurrent: () => boolean): Promise<T> {
  try {
    return await work;
  } finally {
    if (!isCurrent()) {
      throw Object.assign(new Error("Checkout was reset"), { code: "onramp_run_cancelled" });
    }
  }
}
