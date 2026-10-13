# Kivo product direction and competitive research

Kivo should first help a resource manager answer one question: **Can we commit to this work without overloading the team?** Start with service teams of 10–100 people that plan weekly across several client projects. This is a proposed initial segment to validate with interviews, not an established market finding.

The first milestone connects organizations, people, projects, and allocations in a working scheduling workspace. It is a development foundation, not Float parity or a production SaaS release.

## Float baseline

Reviewed October 12, 2026. These are publicly documented capabilities, not findings from a hands-on account audit.

| Area                | Documented Float capability                                                                                                                                 | Implication for Kivo                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduling          | Hour or percentage allocation, drag-and-drop adjustments, tentative work, filters, saved views, live capacity warnings                                      | Make creation and adjustment equally accessible with pointer and keyboard. [Scheduling](https://www.float.com/product/scheduling)                    |
| Capacity            | Individual working hours and days, part-time capacity, time off, regional holidays, roles, skills, rates                                                    | Capacity must come from working calendars, not a universal 40-hour week. [Capacity planning](https://www.float.com/product/capacity-planning)        |
| Projects            | Phases, tasks, milestones, reusable templates, stages, staffing recommendations, and different budget models                                                | Keep scope, committed allocations, and actual delivery separate. [Project planning](https://www.float.com/product/project-planning)                  |
| Time                | Timesheets prefilled from plans, submission deadlines, locking, recurring work, and a timer                                                                 | Prefill suggestions; never silently convert planned hours into actuals. [Time tracking](https://www.float.com/product/time-tracking)                 |
| Financial reporting | Planned versus actual work, budget burn, revenue, cost, margin, people and finance dashboards                                                               | Historical rate snapshots and clear metric definitions precede profitability claims. [Reports](https://www.float.com/product/reports-and-dashboards) |
| Ecosystem           | Public integration catalog and developer API                                                                                                                | Distinguish native connectors from third-party automation. [Integrations](https://www.float.com/integrations), [API](https://developer.float.com/)   |
| Packaging           | Public pricing is per scheduled person; the rendered page shows Starter $7 and Pro $12 per person/month, with monthly/annual controls; Enterprise is custom | Billing cadence was not confirmed through the toggle. Recheck before making a price comparison. [Pricing](https://www.float.com/pricing)             |

Float's own positioning connects people, project scope, and delivery profitability. A faster timeline alone is unlikely to be enough differentiation. [Float product overview](https://www.float.com/)

## Product hypotheses to validate

1. **Explainable capacity decisions.** Show the exact days and assignments behind a conflict. Suggest alternatives with available hours and matching skills; require an explicit user decision before moving work.
2. **Fast repeat workflows.** Keyboard creation, predictable drag behavior, bulk edits with previews, and useful saved views. Measure task completion against the customer's current process, rather than claiming superiority from visual polish.
3. **Trustworthy numbers.** Explain the denominator, tentative-work policy, work calendar, and rate basis beside each metric. Never describe planned work as actual revenue.
4. **Predictable pricing.** Test a clear scheduled-person model with free viewers and readable bills. Do not finalize a price before testing willingness to pay, gross margin, and support costs.

## Information architecture

| Surface               | Primary decision                         | First milestone                                                                                  | Later expansion                                                                    |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Schedule              | Who works on what, when?                 | People rows, two-week calendar, create/edit/move/resize, daily conflicts, search and team filter | Project grouping, saved views, bulk operations, milestones, recurring allocations  |
| Projects              | Is work staffed within the plan?         | Client, status, hour budget, bill rate, committed planned hours, assigned people                 | Phases, cost and revenue budgets, baselines, financial forecasts                   |
| People                | Who can do the work?                     | Role, team, effective weekly calendars, time off, cost rate                                                          | Skills, contract dates, leave approvals, regional holiday feeds, archive               |
| Capacity              | Where is there room or pressure?         | Daily net availability, overload drill-down, effective calendars, time off and workspace holidays                | Demand scenarios, hiring forecasts, explainable staffing options                   |
| Time                  | What actually happened?                  | Deferred                                                                                         | Weekly actuals, approval and locks, planned-versus-actual reconciliation           |
| Reports               | What requires a decision?                | Deferred beyond operational capacity                                                             | Utilization and margin trends, filters, source drill-down, exports                 |
| Organization settings | Who can access and govern the workspace? | Name, timezone, create/switch organizations                                                      | Invitations, authenticated memberships, roles, billing, integrations, audit viewer |

Do not expose empty navigation destinations pretending to be completed functionality. Schedule is the landing surface; creation opens a focused centered composer without losing planning context. All screens follow the canonical [Quiet Canvas design system](design-system.md).

## Scheduling rules

Dates are inclusive date-only values. An organization timezone defines “today”; planning arithmetic uses UTC calendar dates to avoid daylight-saving shifts. A range cannot exceed 367 inclusive dates. The default is Monday–Friday with person-specific daily minutes. Effective-dated working calendars override the baseline with seven Monday–Sunday minute values, including weekend work. Allocation effort is integer minutes in 15-minute increments.

Confirmed planned minutes are summed per person, per working day. Tentative allocations remain visible but do not consume committed capacity. Time off and workspace holidays reduce calendar capacity; overlapping daily reductions use the maximum and never exceed the workday. Leave does not erase planned effort. Utilization is confirmed minutes divided by net calendar capacity; zero-capacity utilization is shown as a dash. A conflict is any individual day over capacity, even when the two-week utilization is below 100%. Availability is the sum of each day's nonnegative remaining capacity; therefore availability is not necessarily total capacity minus planned work when overloads exist.

Example: an eight-hour worker has ten hours on Monday and none on Tuesday. For these two days, utilization is 62.5%, overload is two hours on Monday, and usable availability is eight hours on Tuesday. Showing only the average would hide the operational problem.

Overloads are warnings in this milestone. A manager may intentionally save them and rebalance afterward. Non-working days do not accrue effort; an allocation must contain at least one working day from its person’s effective calendar. Calendar edits recalculate affected planned effort, while leave preserves that effort and can create overloads. Effective calendar records are editable, and baseline person capacity still uses last-write-wins. Immutable historical capacity and rate snapshots remain necessary before financial reporting is shipped.

## Incremental delivery and acceptance gates

| Phase                            | Deliverable                                                                                                                                        | Gate before moving on                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — Planning foundation          | Current local workspace, domain rules, SQL model, development API                                                                                  | CRUD and persistence, daily conflict math, keyboard alternatives, schema constraints, stale allocation rejection, visual QA                            |
| 2 — Shared scheduling            | Production identity, invitations, authorization matrix, effective calendars, leave, holidays, safe archive, API pagination, WebSocket invalidation | Two real users cannot cross tenant or rate-visibility boundaries; reconnect recovers missed revisions; a stale editor cannot overwrite another planner |
| 3 — Delivery actuals             | Timesheets, approvals, deadlines, locking, billable flags                                                                                          | Approved actuals cannot be changed without an auditable reopen; no plans become actuals automatically                                                  |
| 4 — Economics                    | Rate history, currencies, budget models, realized versus forecast margin                                                                           | Hand-calculated reference projects reconcile; changing a current rate cannot rewrite historical costs                                                  |
| 5 — Interoperability and billing | Stripe entitlements, calendar connector, CSV import, PM connector                                                                                  | Signed and idempotent webhooks, previewed imports, token handling, retries, duplicate prevention, reconciliation after outages                         |
| 6 — Intelligent planning         | Scenarios, explainable staffing and capacity forecasts                                                                                             | Recommendations identify evidence and assumptions; users can preview, reject, and undo changes                                                         |

Before a paid pilot: complete authenticated tenant isolation, tested backup/restore, operational logging, failure recovery, accessibility review, tenant quotas, privacy controls, and a documented support process. Upstash Redis currently supports request rate limiting; caching and fan-out follow measured need. Neon PostgreSQL remains the source of truth, and Neon Object Storage stores private files through its S3-compatible API. See [provider setup](provider-setup.md) for the implemented development boundary.

## Customer validation

Recruit five resource managers from the target segment. Have each import or recreate a real two-week plan, staff a new project, move work after a delay, find an overload, and explain remaining availability. Proposed acceptance targets: four of five complete the core tasks unaided, median create/edit time under 20 seconds, and no participant mistakes tentative work for a commitment. These are experiment criteria, not measured results.

Only claim a workflow advantage after measuring it. Capture adoption by weekly planning activity, successful allocation changes, retained workspaces, and actual pilot willingness to pay; do not substitute page views for planning value.
