## Fix `ZodError: limit must be ≤ 10` on suggestions

### Root cause
- `src/routes/index.tsx` (line 110) calls `useSuggestions({ ..., limit: 12 })`.
- `src/hooks/useSuggestions.ts` derives `indexLimit = limit - localItems.length` (up to 12) and passes it to the `getSuggestionsFromIndex` server function.
- `src/functions/summoner-cache.functions.ts` line 490 validates with `z.number().int().min(1).max(10)` — anything >10 throws.

This shipped with a recent bump from 10 → 12 on the client without updating the server schema.

### Change (1 line, no feature/code touched)
In `src/functions/summoner-cache.functions.ts` line 490:

```ts
limit: z.number().int().min(1).max(25).optional(),
```

Raising to 25 (vs. exactly 12) gives headroom if the dropdown grows again, and the function's own internal default/usage already handles arbitrary small values safely.

### Verification
- Reload `/`, type a partial Riot ID — suggestions render with no ZodError in console / server logs.
- No other callers of `getSuggestionsFromIndex` exist (rg confirms only `useSuggestions.ts` uses it).

No prior business logic, UI, or types are touched.
