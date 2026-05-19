export const PAYMENT_STATUS = Object.freeze({
  UNPAID: "UNPAID",
  PAID: "PAID",
  PREPAID: "PREPAID",
  CAMPAIGN: "CAMPAIGN",
  MEMBERSHIP: "MEMBERSHIP",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",

  // Backward compatibility for existing records/controllers during migration.
  PENDING: "PENDING",
});

export const PAYMENT_STATUS_VALUES = Object.freeze(Object.values(PAYMENT_STATUS));
