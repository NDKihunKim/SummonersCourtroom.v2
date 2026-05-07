## Add Runes to Recent Matches

Display each match's keystone (primary) rune and secondary rune tree icon between the summoner spells and the item grid in `MatchCard`.

### Layout

```text
[Spells 2x1] | [Runes 2x1] | [Items 3x2] | [Trinket]
  Flash         Keystone      ...
  Teleport      SecondaryTree ...
```

### Changes

1. **`src/server/riot.ts`** — extend `RiotMatchParticipant` with the `perks` subset:
   ```ts
   perks?: {
     styles: Array<{
       description: "primaryStyle" | "subStyle";
       style: number; // tree id (e.g. 8000 Precision)
       selections: Array<{ perk: number; ... }>; // selections[0].perk = keystone for primary
     }>;
   }
   ```

2. **`src/lib/match-types.ts`** — add to `Match`:
   ```ts
   runes?: { keystoneId: number; secondaryStyleId: number };
   ```
   Optional for backward compat with cached rows.

3. **`src/functions/match-history.functions.ts`** — in `normaliseMatch`, extract from `me.perks.styles`:
   - keystone = primary style's `selections[0].perk`
   - secondary = subStyle's `style`

4. **`src/lib/ddragon.ts`** — add helpers using the Community Dragon CDN (Data Dragon doesn't serve individual perk PNGs cleanly; CommunityDragon does and is widely used):
   ```ts
   runeIconUrl(perkId)        // keystone icon
   runeStyleIconUrl(styleId)  // tree icon (Precision, Domination, etc.)
   ```
   Source: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/...`

5. **New `src/components/RuneIcons.tsx`** — mirrors `SummonerSpells` shape: 2×1 stacked tiles (keystone on top, secondary tree below), same size prop, broken-image fallback to muted placeholder.

6. **`src/components/MatchCard.tsx`** — insert `<RuneIcons runes={match.runes} />` and a divider between `<SummonerSpells>` and `<ItemGrid>`.

### Notes

- Cached matches without `runes` render empty placeholders (no crash).
- No DB/migration changes needed.
- The summoner-cache table likely stores serialized matches; old cached entries will simply omit runes until refreshed.

### Technical details

- CommunityDragon URL pattern (lowercase): `/perk-images/styles/precision/conqueror/conqueror.png` — but the simpler stable form keyed by id is `/perk-images/styles/{styleSlug}/{perkSlug}.png` which requires a lookup table. The robust id-keyed alternative used by most third-party LoL sites: `https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/{styleId}_{name}.png` is unreliable. We'll use CommunityDragon's id-resolved endpoint:
  - Keystone: `https://raw.communitydragon.org/latest/game/assets/perks/styles/{styleId}/{perkId}/{perkId}.png` — fallback to a small id→path map for the ~13 keystones + 5 trees baked into `ddragon.ts`.
- If you'd prefer to skip the lookup map, we can use the `cdragon` JSON manifest fetched once per session (similar to `useDDragonVersion`) — say the word and I'll go that route instead.