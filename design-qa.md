# Hire checkout design QA

## Evidence

- Source visual truth: `/Users/gilbertsahumada/.codex/generated_images/01a04417-5867-7670-9a65-9a100da5e719/exec-94b66e12-d21b-4e31-9854-3c83215ce6c3.png`
- Browser implementation: `/Users/gilbertsahumada/projects/bnb-agent-marketplace/design-qa-implementation.jpg`
- Full-view comparison: `/tmp/bnb-agent-hire-design-qa-comparison-final.jpg`
- Route and state: `http://localhost:3000/hire/303779`, Mainnet quote not requested, wallet disconnected, permissions collapsed.
- Browser viewport and density: 1707 × 960 CSS pixels at device scale 1.
- Source pixels: 1487 × 1058. Implementation pixels: 1707 × 960.
- Normalization: the app-owned implementation region was cropped to 1260 × 896 after removing shell chrome and outer gutters; the source was resized to the same 1260 × 896 canvas. The combined comparison places source left and implementation right.

## Full-view comparison

The implementation preserves the selected direction's hierarchy: compact agent identity, one four-step checkout, only the current step expanded, one primary action, a read-only summary, progressive disclosure for permissions, and verified job history. The existing marketplace shell remains outside the normalized comparison.

The mock's editable requirement/budget selectors were intentionally rendered as read-only quote inputs. The current seller contract does not accept buyer-authored values; interactive controls would falsely promise unsupported behavior. The job history remains full-width below the checkout so real multi-row histories keep readable transaction links rather than being compressed into the narrow summary rail.

## Focused comparison

No extra focused crop was required: after normalization, the compact header, current Quote step, summary values, CTA, status colors and disclosure row are readable in the combined full-view image.

## Comparison history

### First pass

- [P2] The self-declared slug wrapped inside the summary and made the identity hard to scan. Fixed by applying a presentation-only title case to lowercase hyphenated names while preserving Agent ID and the exact trust8004 destination.
- [P2] `Check required` beside an executable `Request quote` implied two separate prerequisites. Fixed with `Verified on quote`, because requesting the signed quote performs the current seller check.
- [P2] The generic summary grid reserved 11rem for labels inside a 20rem rail, forcing values to wrap aggressively. Fixed with a dedicated 5rem/value summary grid.

### Final pass

- Fonts and typography: existing marketplace heading/body families, weights and antialiasing are preserved; the oversized slug heading is removed.
- Spacing and layout rhythm: left checkout and 20rem sticky summary match the selected two-column composition; cards collapse to one column below `lg` and the identity row stacks below `sm`.
- Colors and visual tokens: existing black/graphite surfaces, gray dividers, BNB yellow current action, mint verification and muted locked states match the source direction.
- Image and icon fidelity: the production `AgentAvatar` and existing icon library are used; no placeholder raster, handcrafted SVG or CSS illustration was introduced.
- Copy and content: permanent explanatory paragraphs and raw token units are absent from the embedded route. Labels describe state and next action directly.
- Interaction: permissions were expanded and collapsed successfully in the in-app browser. Quote request, retry, refresh, wallet preparation, funding and tracking transitions are exercised with mocked network/wallet tests; the live CTA was not invoked because it would contact the seller and persist shared evidence.
- Console/runtime: the final route rendered without an error boundary. The development log retains the already-known BNB SDK dynamic-dependency warning and earlier Fast Refresh noise; neither blocks the final page.

## Remaining differences

- [P3] The generated mock includes decorative network/agent icons in the summary. The implementation reuses the existing production icon and avatar system instead of introducing mock-only assets.
- [P3] The generated mock places an empty jobs tile in the narrow rail. The implementation gives job rows full width to support non-empty histories.

## Implementation checklist

- [x] One primary CTA for the current state.
- [x] Quote → Review → Fund → Track progression.
- [x] Compact identity and trust8004 handoff.
- [x] Normalized quote, wallet and network summary.
- [x] Progressive disclosure for contracts and permissions.
- [x] Responsive single-column fallback.
- [x] Verified ERC-8183 job history retained.

final result: passed
