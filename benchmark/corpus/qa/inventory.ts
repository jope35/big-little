// Frozen benchmark corpus — Q&A task, file 2 of 3.
// Do not edit after 2026-09-17 without bumping benchmark/corpus/VERSION.
export type StockState =
  | "in_stock"
  | "low_stock"
  | "reserved"
  | "backordered"
  | "discontinued";

export interface StockEntry {
  sku: string;
  warehouse: string;
  state: StockState;
  onHand: number;
  reserved: number;
}

export interface ShipmentCheck {
  shippable: boolean;
  blockingSku: string | null;
  reason: string | null;
}

// Only these states may leave the warehouse on a shipment.
// Everything else blocks packing, no matter what orders.ts says.
const SHIPPABLE_STATES: ReadonlySet<StockState> = new Set([
  "in_stock",
  "low_stock",
]);

export function shippableStates(): StockState[] {
  return [...SHIPPABLE_STATES];
}

export function isShippableState(state: StockState): boolean {
  return SHIPPABLE_STATES.has(state);
}

export function availableUnits(entry: StockEntry): number {
  return Math.max(0, entry.onHand - entry.reserved);
}

export function reserve(
  entry: StockEntry,
  quantity: number
): { entry: StockEntry; ok: boolean } {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { entry, ok: false };
  }
  if (entry.state === "discontinued") return { entry, ok: false };
  if (availableUnits(entry) < quantity) return { entry, ok: false };
  const next: StockEntry = {
    ...entry,
    reserved: entry.reserved + quantity,
    state: entry.state === "in_stock" && entry.onHand - entry.reserved - quantity < 10
      ? "low_stock"
      : entry.state,
  };
  return { entry: next, ok: true };
}

export function release(entry: StockEntry, quantity: number): StockEntry {
  return {
    ...entry,
    reserved: Math.max(0, entry.reserved - quantity),
  };
}

export function receive(
  entry: StockEntry,
  quantity: number
): { entry: StockEntry; ok: boolean } {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { entry, ok: false };
  }
  if (entry.state === "discontinued") return { entry, ok: false };
  const onHand = entry.onHand + quantity;
  const state: StockState =
    entry.state === "backordered" ? "low_stock" : entry.state;
  return { entry: { ...entry, onHand, state }, ok: true };
}

// A shipment is blocked when ANY line's stock entry is missing or
// sits in a non-shippable state. Callers pass one entry per order line.
export function checkShipment(entries: StockEntry[]): ShipmentCheck {
  for (const entry of entries) {
    if (!isShippableState(entry.state)) {
      return {
        shippable: false,
        blockingSku: entry.sku,
        reason: `sku ${entry.sku} is ${entry.state}`,
      };
    }
    if (availableUnits(entry) <= 0) {
      return {
        shippable: false,
        blockingSku: entry.sku,
        reason: `sku ${entry.sku} has no available units`,
      };
    }
  }
  return { shippable: true, blockingSku: null, reason: null };
}

export function groupByWarehouse(entries: StockEntry[]): Map<string, StockEntry[]> {
  const groups = new Map<string, StockEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.warehouse) ?? [];
    list.push(entry);
    groups.set(entry.warehouse, list);
  }
  return groups;
}

export function restockNeeded(entry: StockEntry, threshold: number): boolean {
  if (entry.state === "discontinued") return false;
  return availableUnits(entry) < threshold;
}

export function markDiscontinued(entry: StockEntry): StockEntry {
  return { ...entry, state: "discontinued", reserved: 0 };
}

export function summarizeStock(entry: StockEntry): string {
  return `${entry.sku}@${entry.warehouse} [${entry.state}] ${availableUnits(entry)} avail`;
}

export function totalAvailable(entries: StockEntry[], sku: string): number {
  return entries
    .filter((e) => e.sku === sku && isShippableState(e.state))
    .reduce((sum, e) => sum + availableUnits(e), 0);
}

export interface TransferRequest {
  sku: string;
  from: string;
  to: string;
  quantity: number;
}

export function transfer(
  entries: StockEntry[],
  req: TransferRequest
): { entries: StockEntry[]; ok: boolean; error: string | null } {
  const source = entries.find((e) => e.sku === req.sku && e.warehouse === req.from);
  const dest = entries.find((e) => e.sku === req.sku && e.warehouse === req.to);
  if (!source) return { entries, ok: false, error: `no source ${req.sku}@${req.from}` };
  if (!dest) return { entries, ok: false, error: `no dest ${req.sku}@${req.to}` };
  if (source.state === "discontinued") {
    return { entries, ok: false, error: `source ${req.sku} is discontinued` };
  }
  if (availableUnits(source) < req.quantity) {
    return { entries, ok: false, error: `insufficient units of ${req.sku}` };
  }
  return {
    entries: entries.map((e) => {
      if (e === source) return { ...e, onHand: e.onHand - req.quantity };
      if (e === dest) {
        const received = receive(e, req.quantity);
        return received.entry;
      }
      return e;
    }),
    ok: true,
    error: null,
  };
}

export function snapshot(entries: StockEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of entries) {
    out[`${entry.sku}@${entry.warehouse}`] = availableUnits(entry);
  }
  return out;
}

export function lowStockReport(entries: StockEntry[], threshold: number): StockEntry[] {
  return entries.filter((e) => restockNeeded(e, threshold));
}
