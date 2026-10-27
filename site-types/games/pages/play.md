# Independent play

Read core/owner-standards-20261027.md. Keep the game viewport, side recommendations, immediate lower recommendations and bottom information. Desktop uses a 1200px content container, which shrinks responsively. Bottom game information shares that container's width and alignment. Recommendations stay mandatory; do not insert another toolbar/text module between the game and lower recommendations.

Use Image-generated refined flat game-themed loading artwork, local assets and generation evidence. Loading has purposeful motion and a progress bar: actual observable progress or a clearly indeterminate state. Never fake percentages/completion or equate iframe load with engine readiness. Exercise loading/failure/retry, real source-specific start/input and reduced-motion.

PC has no fullscreen button. There is no separate Back to detail button. Normal browser/exit/recovery navigation remains usable; do not trap game focus/pointer lock. Phones retain usable game space, clear pressed feedback on every interactive shell target and at most 24px visible text. Do not label pointer/synthetic touch as real hardware acceptance.

Map actual selectors and run bin/inspect-games.mjs, then independently view pixels and operate states; geometry alone does not verify art, progress truth or playability.
