import { assignCheckout, receiptAssignment, type CheckoutExperiment } from "./checkout-experiment";

export async function optionalCheckoutDocument(container: any, id: string, wallet: string) {
  try { return (await container.item(id, wallet).read()).resource || null; }
  catch (error: any) { if (Number(error.code || error.statusCode) === 404) return null; throw error; }
}

export async function pinCheckoutAssignment(container: any, id: string, wallet: string, requested: unknown, fallback: unknown, expose = false) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const receipt = await optionalCheckoutDocument(container, `receipt:${id}`, wallet);
    if (!receipt || receipt.type !== "receipt") throw Object.assign(new Error("Receipt not found."), { status: 404 });
    const experiment: CheckoutExperiment | null = receipt.checkoutAssignedAt || !receipt.brandKey ? null
      : await optionalCheckoutDocument(container, "checkout:experiment", receipt.brandKey);
    const assignment = assignCheckout(receipt, experiment, requested, fallback, Date.now());
    if (expose && requested !== assignment.checkoutVersion) throw Object.assign(new Error("Checkout version changed. Reload the receipt."), { status: 409 });
    const changes = receipt.checkoutAssignedAt ? {} : assignment;
    const patch = Object.entries({ ...changes, ...(expose && !receipt.checkoutExposedAt ? { checkoutExposedAt: Date.now() } : {}) })
      .map(([key, value]) => ({ op: "set", path: `/${key}`, value }));
    if (!patch.length) return receiptAssignment(receipt);
    try {
      await container.item(receipt.id, wallet).patch(patch, {
        matchFields: { checkoutAssignedAt: receipt.checkoutAssignedAt ?? null, checkoutVersion: receipt.checkoutVersion ?? null, checkoutExposedAt: receipt.checkoutExposedAt ?? null,
          ...(!receipt.checkoutAssignedAt ? { stripeSessionId: receipt.stripeSessionId ?? null, status: receipt.status ?? null, transactionHash: receipt.transactionHash ?? null, stripePaymentAttemptSessionId: receipt.stripePaymentAttemptSessionId ?? null } : {}),
        },
        ...(receipt._etag ? { accessCondition: { type: "IfMatch", condition: receipt._etag } } : {}),
      });
      return receiptAssignment({ ...receipt, ...Object.fromEntries(patch.map(item => [item.path.slice(1), item.value])) });
    } catch (error: any) { if (Number(error.code || error.statusCode) !== 412) throw error; }
  }
  throw Object.assign(new Error("Receipt changed. Please retry."), { status: 409 });
}
