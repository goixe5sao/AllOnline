# Sân Khấu Online design system

The goal is a product that looks commercial and trustworthy, feels consistent page to page, and works well on mobile first (390 px) and on desktop (1440 px).
Direction: **"premium online theatre"**. Calm, dark surfaces like a hall before the show, a single warm "spotlight" accent, generous spacing, and clear hierarchy. Do not mix colours freely, and avoid emoji as decoration.

## Tokens (CSS custom properties on `:root`, redefined under `[data-theme="light"]`)
- **Colour (dark default):** `--bg #0B0D14`, `--surface #131722`, `--surface-2 #1A1F2D`, `--border #262C3D`, `--text #EEF0F6`, `--text-2 #A7AEC2`, `--text-3 #6F7891`.
  - Accent ("spotlight" amber): `--accent #F5B547`, `--accent-hover #FFC866`, `--on-accent #1A1206`.
  - Status: `--success #3DD68C`, `--warning #F5B547`, `--danger #F26D6D`, `--info #6BA8FF`. Each has a `-soft` background at about 14 % alpha.
- **Colour (light):** `--bg #F6F7FB`, `--surface #FFFFFF`, `--surface-2 #F0F2F7`, `--border #E2E5EE`, `--text #121521`, `--text-2 #4A5168`, `--text-3 #7A8199`, `--accent #D9901A`, `--on-accent #FFFFFF`. Check every text and accent pair for WCAG AA contrast.
- **Type:** "Be Vietnam Pro" via `next/font/google` (subsets latin + vietnamese), weights 400/500/600/700. Scale: 12/14/16/18/22/28/36/48. Line height is 1.5 for body and 1.2 for headings. Numbers use `font-variant-numeric: tabular-nums`.
- **Space:** a 4 px base: 4/8/12/16/20/24/32/40/56/80. **Radius:** 8 (inputs), 12 (cards), 16 (modals/hero), 999 (pills). **Shadow:** two levels only (`--shadow-1`, `--shadow-2`). **Motion:** 150–200 ms ease-out, and respect `prefers-reduced-motion`.
- **Layout:** container 1120 px max, side gutter 16 px on mobile and 24 px from 768 px. Breakpoints are 640/768/1024/1280. No horizontal scroll at 360 px.

## Components (`src/components/ui/*`, with styles in `src/app/ui.css`)
`Button` (primary / secondary / ghost / danger; sizes sm/md/lg; loading state; icon + label; 44 px min touch target), `Field` (label, hint, error) wrapping `Input / Select / Textarea / Checkbox / Radio-card`, `Card` (header / body / footer), `PageHeader` (title, subtitle, actions, breadcrumb), `Section`, `Tabs`, `Stepper`, `Badge` (status colours), `EmptyState`, `Skeleton`, `Toast`, `Modal/Sheet` (a bottom sheet on mobile), `DataList` (a table on desktop that becomes stacked cards on mobile), `Price` (VND formatting), and `StickyActionBar` (the main form action pinned to the bottom on mobile).
- Icons come only from lucide-react, at 16/20 px and stroke 1.75.
- Every interactive element has hover, focus-visible (2 px accent ring) and disabled states.
- Copy is Vietnamese, short and in sentence case. One primary action per screen.

## Rules for every page
1. A PageHeader on top. Content sits in Cards, with one clear primary CTA.
2. Forms are grouped into short sections. Inline validation shows next to the field, and errors explain how to fix them.
3. Loading uses Skeleton (no blank flashes). An empty list uses EmptyState with an action.
4. Mobile: one column, StickyActionBar for the main action, and no element narrower than the 44 px touch target.
5. Pages contain no inline hex colours and no ad-hoc pixel values. Use the tokens and components only.
6. The 3D room and home theatre scenes keep their own rendering; only the HTML overlays (toolbars, panels, dialogs) adopt this system.

## Review evidence
Every UI task saves screenshots at 390×844 and 1440×900, dark and light, to `docs/screenshots/ui/<page>-<w>-<theme>.png` (before/after when redesigning). Use the existing headless-browser tooling. Do not open 3D scenes with CPU rendering for long: one context at a time, and close it right away (the PC froze before).
