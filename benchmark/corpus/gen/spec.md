# Generation task spec (frozen)

Create `order.dto.ts` next to the reference file. Mirror the reference
(`reference.user.dto.ts`) exactly. Use the same export order, the same
naming style, and the same error message style. Add no new patterns and
no new dependencies.

## Target interface `OrderDto`

| Field | Type | Rule |
| --- | --- | --- |
| `id` | `string` | required |
| `customerId` | `string` | required |
| `status` | `"draft" \| "submitted" \| "paid" \| "packed" \| "shipped" \| "delivered" \| "cancelled" \| "refunded"` | required |
| `totalCents` | `number` | a non-negative integer |
| `couponCode` | `string \| null` | a discount code |
| `createdAt` | `string` | a valid date string |

## Target functions

Write each function in the shape of its reference twin:

- `validateOrderDto(dto: OrderDto): string[]` returns one error string per broken rule.
- `serializeOrderDto(dto: OrderDto): string` converts the object to text.
- `deserializeOrderDto(raw: string): OrderDto` throws `invalid OrderDto: ...` when validation fails.
- `summarizeOrderDto(dto: OrderDto): string` returns one line in this form: `<id> [<status>] $<dollars with 2 decimals>`.
- `isShippableOrder(dto: OrderDto): boolean` returns true only when the status is `"packed"`.

## Acceptance

`npx tsc --noEmit --strict` passes on both files. A round trip through
`deserializeOrderDto(serializeOrderDto(x))` returns an object that
deep-equals `x`.
