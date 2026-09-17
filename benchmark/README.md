# Token benchmark

This benchmark compares direct reads with delegated reads and writes. It is the release gate in TODO.md section 2. If delegation costs more tokens, keep the result and note the cause.

## Fixed values

| Item | Value |
| --- | --- |
| Corpus | `benchmark/corpus/` at VERSION `1` |
| Threshold | `minLines: 100` for runs B and C. Run A loads no plugin. |
| Question files | `orders.ts` (209 lines), `inventory.ts` (180), `pricing.ts` (157) |
| Reference file | `reference.user.dto.ts` (45 lines). It stays under the threshold because the caller reads it directly in each run. |
| Primary model | Use one model for all three runs and record it. |
| Worker models | Leave unset or pin them. Use one choice for runs B and C and record it. |

Corpus commit SHA: _(fill in at record time from `git rev-parse --short HEAD` with a clean tree)_

## Setup

1. Run `scripts/benchmark-setup.sh` from the repository root.
2. Make sure that the script prints four `gate OK` lines. If a gate fails, stop and correct the corpus.
3. Use one run folder per test and start `opencode` inside that folder:
   - `/tmp/bl-bench-a` has no plugin. Use it for the baseline.
   - `/tmp/bl-bench-b` has the plugin with `minLines: 100`. Use it for delegated reads.
   - `/tmp/bl-bench-c` has the plugin with `minLines: 100`. Use it for delegated writes.

Do not start production OpenCode inside a run folder. Each folder is a throwaway fixture.

## Task 1: questions (runs A and B)

Copy the prompt below. In run A, answer it with direct `read` calls. In run B, send it to `@bulk-reader` first, then read only the cited sections with `offset/limit`.

```text
In corpus/qa/ there are three modules: orders.ts, inventory.ts, pricing.ts.
Answer with file paths and line numbers. Do not paste full files.
1. Which function computes the final order total, and what is the exact discount stack order?
2. Which stock states block a shipment, and where is that decided?
3. Which order status makes an order eligible for the overdue goodwill discount, and which function checks it?
4. What is the tax rate, and where is it applied?
```

A correct answer cites `finalTotalCents` with the coupon, tier, and overdue stack in `pricing.ts`. It cites `shippableStates` in `inventory.ts`. It cites status `submitted` with `isOverdue` in `orders.ts`. It cites `TAX_RATE` of `0.21`.

## Task 2: generation (runs A and C)

The spec is `corpus/gen/spec.md`. The reference is `corpus/gen/reference.user.dto.ts`.

1. In run A, read both files directly. Write `order.dto.ts` with `edit`. Type-check it.
2. In run C, read the reference file directly. Send this prompt to `@code-writer`:

```text
@code-writer Create order.dto.ts per corpus/gen/spec.md using corpus/gen/reference.user.dto.ts as the reference. Write the finished file with edit. Do not paste the code in chat.
```

3. Type-check the result. The generated code stays out of the caller context. That saving is the test.

## Recording

1. Copy `benchmark/results-template.md` to `benchmark/results.md`.
2. Fill in versions, models, and each token count.
3. Tick the benchmark box in TODO.md.
