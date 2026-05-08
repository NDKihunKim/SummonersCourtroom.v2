## Stop the suggestions dropdown from overlapping the Riot disclaimer

### Root cause
- `src/components/SearchSuggestions.tsx` line 100 caps the dropdown at `max-h-[270px]` — roughly 6 rows of ~45px. With 7+ recent searches the list reaches its full 270px and visually extends down past the hero card, overlapping the footer disclaimer rendered by `AdFrame`.
- The dropdown is `absolute`, so it does not actually reflow the footer — but on the current 624px viewport the bottom of the dropdown lands on top of the disclaimer text, which reads as "pushing it out awkwardly".
- The dropdown already has `overflow-y-auto` internally, so shrinking the cap simply means the user scrolls inside the dropdown for entries 6+ instead of the dropdown spilling onto the footer.

### Change (1 line, in `src/components/SearchSuggestions.tsx`)

Line 100, replace:
```tsx
<ul id={listboxId} role="listbox" className="max-h-[270px] overflow-y-auto">
```
with a viewport-aware cap that always leaves room for the footer:
```tsx
<ul id={listboxId} role="listbox" className="max-h-[min(270px,40vh)] overflow-y-auto">
```

- On tall screens it still shows ~6 rows (270px cap wins).
- On the demo's 624px viewport, 40vh ≈ 250px → effectively the same density, but on shorter viewports it shrinks proportionally so the dropdown never reaches the disclaimer.
- Behavior for ≤6 recents is unchanged (list is shorter than the cap either way).

### Verification
- Add 7+ recent searches → dropdown shows scrollable list, footer disclaimer stays fully visible.
- Resize viewport shorter → dropdown shrinks instead of overlapping footer.

No changes to `AdFrame`, layout structure, or any other component.
