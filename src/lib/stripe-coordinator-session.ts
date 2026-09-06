/**
 * OAuth tokens authorize server requests; they do not authenticate a newly
 * initialized Stripe SDK coordinator. Only reuse a coordinator whose own
 * authenticate callback succeeded, with the complete customer context.
 */
export function canReuseStripeCoordinatorSession(input: {
  coordinator: object | null;
  authenticatedCoordinator: object | null;
  customerId: string | null;
  oauthToken: string | null;
  buyerWallet: string | null;
}): boolean {
  return Boolean(
    input.coordinator
    && input.coordinator === input.authenticatedCoordinator
    && input.customerId
    && input.oauthToken
    && input.buyerWallet
  );
}
