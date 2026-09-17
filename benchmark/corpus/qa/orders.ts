// Frozen benchmark corpus — Q&A task, file 1 of 3.
// Do not edit after 2026-09-17 without bumping benchmark/corpus/VERSION.
export type OrderStatus =
  | "draft"
  | "submitted"
  | "paid"
  | "packed"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export interface OrderLine {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Order {
  id: string;
  customerId: string;
  status: OrderStatus;
  lines: OrderLine[];
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  couponCode: string | null;
}

// Terminal states: no further transition is legal once reached.
const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "delivered",
  "cancelled",
  "refunded",
]);

// Allowed forward transitions. Anything not listed here is rejected.
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["paid", "cancelled"],
  paid: ["packed", "refunded"],
  packed: ["shipped", "refunded"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
  refunded: [],
};

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function allowedNext(status: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[status] ?? [];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  if (isTerminal(from)) return false;
  return allowedNext(from).includes(to);
}

export interface TransitionResult {
  ok: boolean;
  order: Order | null;
  error: string | null;
}

export function transition(order: Order, to: OrderStatus, now: string): TransitionResult {
  if (!canTransition(order.status, to)) {
    return {
      ok: false,
      order: null,
      error: `illegal transition ${order.status} -> ${to}`,
    };
  }
  const next: Order = { ...order };
  if (to === "paid") next.paidAt = now;
  if (to === "shipped") next.shippedAt = now;
  next.status = to;
  return { ok: true, order: next, error: null };
}

export function lineTotalCents(line: OrderLine): number {
  if (line.quantity <= 0) throw new Error("quantity must be positive");
  if (line.unitPriceCents < 0) throw new Error("unit price must not be negative");
  return line.quantity * line.unitPriceCents;
}

export function subtotalCents(order: Order): number {
  return order.lines.reduce((sum, line) => sum + lineTotalCents(line), 0);
}

export function isOverdue(order: Order, nowIso: string, daysLimit: number): boolean {
  if (order.status !== "submitted") return false;
  const created = Date.parse(order.createdAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(created) || Number.isNaN(now)) return false;
  const ageDays = (now - created) / 86_400_000;
  return ageDays > daysLimit;
}

// Overdue submitted orders older than the limit qualify for a
// goodwill discount. The rate itself lives in pricing.ts.
export const OVERDUE_DISCOUNT_ELIGIBLE_STATUS: OrderStatus = "submitted";

export function validateOrder(order: Order): string[] {
  const errors: string[] = [];
  if (!order.id) errors.push("id is required");
  if (!order.customerId) errors.push("customerId is required");
  if (order.lines.length === 0) errors.push("at least one line is required");
  for (const [index, line] of order.lines.entries()) {
    if (!line.sku) errors.push(`line ${index}: sku is required`);
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      errors.push(`line ${index}: quantity must be a positive integer`);
    }
    if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
      errors.push(`line ${index}: unitPriceCents must be a non-negative integer`);
    }
  }
  if (order.paidAt !== null && order.status === "draft") {
    errors.push("draft order must not have paidAt set");
  }
  if (order.shippedAt !== null && order.paidAt === null) {
    errors.push("shipped order must have paidAt set");
  }
  return errors;
}

export function summarizeOrder(order: Order): string {
  const total = (subtotalCents(order) / 100).toFixed(2);
  return `${order.id} [${order.status}] ${order.lines.length} lines = $${total}`;
}

export function filterByStatus(orders: Order[], status: OrderStatus): Order[] {
  return orders.filter((o) => o.status === status);
}

export function requiresPayment(order: Order): boolean {
  return order.status === "submitted";
}

export function canShip(order: Order): boolean {
  // Payment is required, but stock gating lives in inventory.ts
  // (shippableStates) and the final total in pricing.ts (finalTotalCents).
  return order.status === "packed" && order.paidAt !== null;
}

export interface AuditEntry {
  orderId: string;
  from: OrderStatus;
  to: OrderStatus;
  at: string;
}

export function transitionMany(
  orders: Order[],
  to: OrderStatus,
  now: string
): { updated: Order[]; audit: AuditEntry[]; failed: string[] } {
  const updated: Order[] = [];
  const audit: AuditEntry[] = [];
  const failed: string[] = [];
  for (const order of orders) {
    const result = transition(order, to, now);
    if (result.ok && result.order !== null) {
      updated.push(result.order);
      audit.push({ orderId: order.id, from: order.status, to, at: now });
    } else {
      failed.push(order.id);
    }
  }
  return { updated, audit, failed };
}

export function serializeOrder(order: Order): string {
  return JSON.stringify(order);
}

export function deserializeOrder(raw: string): Order {
  const parsed = JSON.parse(raw) as Order;
  const errors = validateOrder(parsed);
  if (errors.length > 0) {
    throw new Error(`invalid order: ${errors.join("; ")}`);
  }
  return parsed;
}

export function orderAgeDays(order: Order, nowIso: string): number | null {
  const created = Date.parse(order.createdAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(created) || Number.isNaN(now)) return null;
  return Math.floor((now - created) / 86_400_000);
}

export function partitionOverdue(
  orders: Order[],
  nowIso: string,
  daysLimit: number
): { overdue: Order[]; current: Order[] } {
  const overdue: Order[] = [];
  const current: Order[] = [];
  for (const order of orders) {
    if (isOverdue(order, nowIso, daysLimit)) overdue.push(order);
    else current.push(order);
  }
  return { overdue, current };
}
