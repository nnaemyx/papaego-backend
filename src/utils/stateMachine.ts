export const transitions: Record<string, string[]> = {
  INITIATED: ["CUSTOMER_VERIFIED"],
  CUSTOMER_VERIFIED: ["QUOTED"],
  QUOTED: ["SENT_TO_CUSTOMER", "EXPIRED"],
  SENT_TO_CUSTOMER: ["CUSTOMER_CONFIRMED", "EXPIRED"],
  CUSTOMER_CONFIRMED: ["AWAITING_PAYMENT"],
  AWAITING_PAYMENT: ["PAYMENT_CONFIRMED", "FLAGGED"],
  FLAGGED: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["PAYMENT_CONFIRMED", "CANCELLED"],
  PAYMENT_CONFIRMED: ["COMPLETED"]
};

export function canTransition(from: string, to: string) {
  return transitions[from]?.includes(to);
}

export function assertTransition(from: string, to: string) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition from ${from} to ${to}`);
  }
}
