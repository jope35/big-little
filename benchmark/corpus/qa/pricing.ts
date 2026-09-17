// Frozen benchmark corpus — Q&A task, file 3 of 3.
// Do not edit after 2026-09-17 without bumping benchmark/corpus/VERSION.
export interface DiscountInput {
  subtotalCents: number;
  couponCode: string | null;
  isOverdue: boolean;
  customerTier: "standard" | "silver" | "gold";
}

export interface DiscountResult {
  discountCents: number;
  reason: string;
}

// Goodwill rate for overdue submitted orders (see orders.ts isOverdue).
export const OVERDUE_DISCOUNT_RATE = 0.05;

const COUPON_RATES: Record<string, number> = {
  SAVE10: 0.1,
  SAVE20: 0.2,
};

const TIER_RATES: Record<DiscountInput["customerTier"], number> = {
  standard: 0,
  silver: 0.03,
  gold: 0.07,
};

// Discount stack order is fixed: coupon first, then tier, then overdue.
// Each step applies to the remainder after the previous step.
export function discountBreakdown(input: DiscountInput): {
  couponCents: number;
  tierCents: number;
  overdueCents: number;
} {
  let remainder = input.subtotalCents;
  let couponCents = 0;
  if (input.couponCode !== null) {
    const rate = COUPON_RATES[input.couponCode] ?? 0;
    couponCents = Math.floor(remainder * rate);
    remainder -= couponCents;
  }
  const tierCents = Math.floor(remainder * TIER_RATES[input.customerTier]);
  remainder -= tierCents;
  const overdueCents = input.isOverdue ? Math.floor(remainder * OVERDUE_DISCOUNT_RATE) : 0;
  return { couponCents, tierCents, overdueCents };
}

export function discountFor(input: DiscountInput): DiscountResult {
  const { couponCents, tierCents, overdueCents } = discountBreakdown(input);
  const total = couponCents + tierCents + overdueCents;
  const parts: string[] = [];
  if (couponCents > 0) parts.push(`coupon ${input.couponCode}`);
  if (tierCents > 0) parts.push(`tier ${input.customerTier}`);
  if (overdueCents > 0) parts.push("overdue goodwill");
  return {
    discountCents: total,
    reason: parts.length > 0 ? parts.join(" + ") : "no discount",
  };
}

export const TAX_RATE = 0.21;

export function taxCents(netCents: number): number {
  if (netCents < 0) throw new Error("net must not be negative");
  return Math.round(netCents * TAX_RATE);
}

export interface TotalInput extends DiscountInput {
  shippingCents: number;
}

export interface TotalBreakdown {
  subtotalCents: number;
  discountCents: number;
  netCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
}

// THE final-total function for the benchmark Q&A task.
// Reads the order subtotal via a callback so this module stays
// decoupled from orders.ts.
export function finalTotalCents(
  input: TotalInput,
  getSubtotal: () => number
): TotalBreakdown {
  const subtotalCents = getSubtotal();
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    throw new Error("subtotal must be a non-negative integer");
  }
  const { discountCents } = discountFor(input);
  const netCents = subtotalCents - discountCents;
  const tax = taxCents(netCents);
  const totalCents = netCents + tax + input.shippingCents;
  return {
    subtotalCents,
    discountCents,
    netCents,
    taxCents: tax,
    shippingCents: input.shippingCents,
    totalCents,
  };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function isFreeShipping(total: TotalBreakdown, thresholdCents: number): boolean {
  return total.netCents >= thresholdCents;
}

export function isKnownCoupon(code: string): boolean {
  return code in COUPON_RATES;
}

export function couponRate(code: string): number {
  return COUPON_RATES[code] ?? 0;
}

export function tierRate(tier: DiscountInput["customerTier"]): number {
  return TIER_RATES[tier];
}

// Quote a batch of orders sharing one discount context shape.
// The caller supplies one subtotal getter per order so bulk reads
// stay out of this module.
export function quoteMany(
  inputs: TotalInput[],
  getSubtotal: (index: number) => number
): TotalBreakdown[] {
  return inputs.map((input, index) =>
    finalTotalCents(input, () => getSubtotal(index))
  );
}

export function grandTotal(totals: TotalBreakdown[]): number {
  return totals.reduce((sum, t) => sum + t.totalCents, 0);
}

export function savingsRate(total: TotalBreakdown): number {
  if (total.subtotalCents === 0) return 0;
  return total.discountCents / total.subtotalCents;
}

export function describeTotal(total: TotalBreakdown): string {
  return (
    `subtotal ${formatCents(total.subtotalCents)}, ` +
    `discount -${formatCents(total.discountCents)}, ` +
    `tax +${formatCents(total.taxCents)}, ` +
    `shipping +${formatCents(total.shippingCents)} = ` +
    formatCents(total.totalCents)
  );
}
