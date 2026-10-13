# Kivo design system — Quiet Canvas

Status: canonical project theme, adopted October 13, 2026. Apply this system to every new screen and interaction. Changes to the theme should update this document and the shared tokens together.

## Product feeling

Kivo should feel like arranging work on a shared canvas. The people and their plans are the interface. Navigation, filters, and editing support that work with little ceremony. A resource manager should see what needs attention and act where they are looking.

The design reference is [Linear's product presentation](https://linear.app/homepage) and its account of [reducing noise and aligning application chrome](https://linear.app/now/how-we-redesigned-the-linear-ui). Our interpretation is continuity, alignment, restrained contrast, and contextual detail. Kivo retains its own planning model and visual identity.

## Surface hierarchy

Use three surfaces only:

1. Navigation rail (`--sidebar`, #141517): workspace switcher, four primary destinations, project shortcuts, settings, and local-workspace status.
2. Work canvas (`--paper`, #191a1d): one continuous surface extending to the viewport edges. A single 54px header establishes location and primary action; a single contextual toolbar contains date navigation, search, and filters.
3. Transient surfaces (`--panel`, #212226): menus, composer, notifications, and help. These may have a border and shadow because they float above the canvas.

The canvas has one perimeter. Lists, tables, timeline, and capacity rows sit directly on it. Do not add dashboard-card grids, nested bordered panels, decorative statistic tiles, duplicate page headings, separate breadcrumb bars, or extra status strips. Use whitespace and subtle row dividers to group information. Empty canvas is useful breathing room.

Keep view titles small and structural. Place high-level capacity information in the bottom status line; show deeper capacity analysis in Capacity. Export belongs in the actions menu. Explain rules in context, accessible descriptions, or help instead of permanent instructional paragraphs.

## Tokens and typography

The source of truth is `apps/web/src/app/globals.css`, beginning with `:root`.

| Token                     | Role                                                                   |
| ------------------------- | ---------------------------------------------------------------------- |
| `--ink` #e9eaed           | Primary content                                                        |
| `--muted` #a0a1aa         | Secondary text                                                         |
| `--subtle` #777983        | Tertiary labels and hints; never the only signal for a critical action |
| `--line` #ffffff0d        | Row and surface separators                                             |
| `--line-strong` #ffffff1a | Floating surfaces and focused controls                                 |
| `--accent` #a6a3f5        | Focus, selection, active filters, and today                            |
| `--action` #6d67cf        | Primary action                                                         |
| `--warning` #d7ae7d       | Capacity conflicts                                                     |
| `--danger` #e9a0ab        | Destructive actions and errors                                         |

Use self-hosted Geist Sans throughout. Default text is 13px; primary data is 12–13px; metadata is 11–12px. Page titles are 14px/550. Composer titles are 21px/450. Use tabular numbers for hours, dates, and utilization. Avoid all-caps labels, oversized dashboard numbers, decorative serif type, and invented branded terms in product copy.

Use a 4px spacing rhythm. Sidebar width is 216px; desktop canvas padding is 24px. Keep icon baselines and text edges aligned across the header, toolbar, and data. Standard icons are 14–16px. Control corners are 5–6px, floating menus 8px, composer 12px. Avatars are circles.

Project colors identify work consistently across shortcuts, allocations, and project lists. They should be muted and derived from the shared sage/lilac/blue/peach/rose tokens. Navigation stays neutral. Do not use additional accent colors or gradients for decoration.

## Interaction grammar

- **Act at the point of intent:** clicking an empty date opens a composer with that person and day; dragging a date range pre-fills inclusive start and end dates. Touch uses click-to-create and the date editor rather than fighting vertical scrolling.
- **Continuous dragging:** moving an allocation follows the pointer in both axes; the receiving person row is highlighted. On release, the move snaps to whole dates and commits. Resize follows the pointer and commits a date on release. Escape and pointer cancellation discard the gesture.
- **One composer:** all entity editing uses the same centered, focus-managed dialog. Lead with the content/name, then compact property rows; put the primary save action at bottom right. Cmd/Ctrl+Enter submits with native validation. Escape dismisses. Keep the underlying workspace in place.
- **Progressive disclosure:** ordinary daily load is revealed on row hover or focus; overloads stay visible. Resize handles and row actions appear on hover/focus and remain available on touch. Financial fields belong in their relevant editor or view, not the global chrome.
- **Predictable feedback:** local changes persist before reporting success; API mode retains its authoritative save/refetch contract. Retain error messages, disabled/busy behavior, and local undo. Appearance changes must never imply collaboration, authentication, or persistence that does not exist.
- **No animation tax:** hover changes use 120ms, menus 140ms, view changes 160ms, composer/sidebar 200ms with the shared ease. Animate opacity and small transforms. Never delay input or save to finish animation; never animate every row on filter changes. Respect `prefers-reduced-motion`.

## Responsive and accessible behavior

At narrower widths, the sidebar becomes an icon rail with accessible labels. The sidebar can also be collapsed for more planning space. The schedule and data tables scroll inside their own region; the document must not scroll horizontally. On mobile, toolbar controls wrap and the people column stays pinned.

Preserve visible keyboard focus, semantic buttons, form labels, Radix focus trapping/restoration, keyboard alternatives to drag/resize, readable error feedback, and reduced motion. Hidden hover controls must remain reachable with a keyboard. Do not replace accessibility with tooltip-only interactions.

## Public product page

The public homepage uses the same Quiet Canvas colors, self-hosted Geist, project palette and restrained interaction grammar. Its editorial type scale is separate from application chrome: 40–80px hero, 32–56px section headings, and 13–16px explanatory copy. This scale is for the marketing feature only; workspace headers and data retain their compact hierarchy.

Use one continuous page, generous spacing, thin section dividers and real product examples. Bordered figures represent product artifacts, not feature-card grids. Navigation and signup remain clear at desktop and mobile sizes. Keep the public story about customer work; technical contracts belong in relevant help, not the hero. Illustrative data must be labelled. Never invent customers, testimonials, performance statistics, pricing, certifications or capabilities. Public examples reuse the application's pure calculations and do not access or mutate a tenant.

The homepage at `/` remains available when signed in. `/app` owns the authenticated workspace; signup/login return there and invitation acceptance preserves its selected organization. The marketing feature owns its components and scoped styles rather than adding page-specific rules to global workspace CSS.

### Public-page motion

Show the work instead of adding more explanatory paragraphs: a moving allocation, capacity filling, planned/recorded comparisons and a shared-plan illustration. Keep each example labelled as illustrative. Marketing motion belongs to `features/marketing`; it never writes planning records or expands the workspace's animation timings.

Use short, finite entrances (400–800ms), small transforms, chart growth and responsive hover/press feedback. Scroll reveals enhance already-visible server content; JavaScript failure must not leave text hidden. Native anchors scroll smoothly without intercepting navigation. Preview and workflow scenes reserve consistent space to avoid layout jumps.

Automatic tours have visible pause/play controls and seven-second scene intervals. Manual selection, focus inside an example and pointer interaction stop advancement; hidden documents and offscreen examples suspend timers. Hovering the workflow illustration temporarily holds playback. Reduced motion disables automatic tours, entrances and smooth scrolling while preserving manual tabs, chart perspectives and disclosures. Each example owns playback through the small shared hook, with observer/listener/timer cleanup and no animation dependency.

Product illustrations use inline SVG components under `features/marketing/illustrations`. Animate the relevant parts: allocation/cursor groups move together, bars fill below accurate capacity limits, and short signals travel along shared-plan paths. Keep labels and semantic descriptions available, reserve viewBox space, and remove secondary cursor labels on narrow screens. Continuous SVG sequences have pause/play controls and pause their CSS animations offscreen without resetting the scene. Reduced motion renders the complete static composition. Use native SVG/CSS rather than video, raster frame sequences or an animation dependency for these small diagrams; the actual interactive product preview stays semantic HTML.

## Acceptance checklist for future work

- The screen reads as one canvas, with one location header and one contextual toolbar.
- Each persistent control earns its place in the current task; secondary actions are disclosed on demand.
- New UI uses shared tokens and established components instead of one-off card styles.
- Data is legible and warnings remain visible without hover; colors also have text/icon meaning.
- Create, edit, cancel, failure, and empty states follow the same grammar.
- Keyboard focus, reduced motion, narrow screens, and pointer gestures still work.
- Inspect the actual rendered desktop and mobile UI; a successful build alone does not validate feel.
