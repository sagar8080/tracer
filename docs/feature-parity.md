# Kivo feature coverage and Float parity

Updated October 13, 2026. Baseline: commit `1827dec`, with the current A0/A1 implementation tracked in [validation](validation.md). This register maps publicly documented Float workflows plus Kivo's requirements for human and agent operations to current implementation and delivery cycles. [Product design and iteration plan](product-design.md) retains C0–C14 capability expansion; [Human and agent system design](agentic-system-design.md) defines early A0–A4 adoption. Equivalent business workflows are required; differences in calculation or interaction must be explicit.

**Current status:** Implemented means development functionality exists with evidence in [validation](validation.md); Partial means a narrower workflow exists; Planned means the capability is absent. None of these labels establishes production readiness. **Float evidence:** linked product/help pages describe offered functionality; Announced identifies a roadmap item. Account-specific behavior, plan entitlements and practical limits require the C0 walkthrough. **Cycle:** the first delivery cycle is listed, with later expansion where needed. An implemented feature still has regression and operational gates.

## Scheduling

| ID | Required capability | Kivo today | Delivery | Float evidence |
| --- | --- | --- | --- | --- |
| SCH01 | Create, move, resize and delete assignments with pointer and keyboard | Implemented; date-based daily effort | C1 regression | [Scheduling][scheduling] |
| SCH02 | Express effort as daily hours, percentage, fixed total effort or a clock interval | Partial; daily minutes only | C2 | [Allocation formats][allocations] |
| SCH03 | Show confirmed, tentative, draft, completed and cancelled work distinctly | Partial; confirmed/tentative assignments | C2; project inheritance C4 | [Allocation states][allocations] |
| SCH04 | Duplicate, divide and reassign existing work | Partial; reassign through editing/drag | C2 | [Allocation tools][glossary] |
| SCH05 | Select and change multiple assignments; shift a project or phase | Planned | C2 selection; C4 project shift | [Bulk movement][bulk] |
| SCH06 | Undo and redo changes in a shared workspace | Partial; latest edit undo in browser demo only | C2 | [Undo during timeline shifts][bulk] |
| SCH07 | Repeat assignments with individual and future-occurrence edits | Planned | C2 | [Recurrence][recurrence] |
| SCH08 | Save personal and shared filter presets | Partial; search and team filter | C2 | [Schedule views][scheduling], [plan comparison][pricing] |
| SCH09 | Filter and group work by people, department, project, role, tags and status | Partial; people timeline and basic filters | C2 basic; C3/C4 structured fields | [Scheduling][scheduling], [project glossary][glossary] |
| SCH10 | Link dependent assignments and propagate timeline adjustments | Planned | C4 | [Linked work][links] |
| SCH11 | Add assignment notes and notify mentioned teammates | Partial; short assignment title | C2 notes; C10 mentions | [Allocation notes][allocations] |
| SCH12 | Show day-level overload, availability and explicit overtime work | Partial; overloads exist; zero-workday scheduling restricted | C3 | [Availability][capacity], [overtime behavior][allocations] |

## People and leave

| ID | Required capability | Kivo today | Delivery | Float evidence |
| --- | --- | --- | --- | --- |
| PEO01 | Maintain structured roles, departments, locations, skills and seniority | Partial; free-text role/team | C3 | [People configuration][capacity] |
| PEO02 | Schedule employees, contractors and placeholder resources | Partial; one undifferentiated person type | C3 | [Resource types][team] |
| PEO03 | Configure individual calendars, employment dates and organization calendar defaults | Partial; effective calendars and organization timezone | C3 | [Capacity settings][capacity], [work schedule][settings] |
| PEO04 | Request, review, reject and cancel leave with delegated reviewers | Partial; own requests and Owner/Admin approval | C3 | [Leave booking][leave-booking], [review settings][leave-settings] |
| PEO05 | Configure leave types, policy groups, allowances, accrual and carryover | Planned | C3 | [Leave policies][leave-settings] |
| PEO06 | Show balances and an auditable history of leave consumption | Planned | C3 | [Leave balances][leave-settings] |
| PEO07 | Assign regional holidays and workspace-specific holidays | Partial; manual organization holidays | C3 | [Regional calendars][capacity] |
| PEO08 | Record recurring absence and work-location or availability statuses | Partial; ordinary full/partial-day absence | C3 | [Repeating absence and status][recurrence], [status settings][settings] |
| PEO09 | Archive and reactivate people while retaining historical work | Planned; removal is not an archive lifecycle | C3 | [Archive behavior][archive] |
| PEO10 | Maintain experience profiles with evidence for staffing decisions | Planned | C3 manual skills; C13 experience assistance | [AI experience profiles][ai] — described as rolling out |

## Project scoping

| ID | Required capability | Kivo today | Delivery | Float evidence |
| --- | --- | --- | --- | --- |
| PRJ01 | Manage project identity, client, owner, team, codes, tags and notes | Partial; project name, client label, color | C4 | [Project structure][projects], [job codes][pricing] |
| PRJ02 | Model phases, tasks and milestones in a project timeline | Planned | C4 | [Project planning][project-planning] |
| PRJ03 | Configure project stages under draft, tentative, confirmed, completed and cancelled states | Partial; three fixed project statuses | C4 | [Project stages][glossary] |
| PRJ04 | Create projects from reusable structures and staffing templates | Planned | C4 | [Project templates][project-planning] |
| PRJ05 | Estimate by role and retain unfilled staffing requirements | Planned | C4 | [Role-based estimation][estimation] |
| PRJ06 | Set billability at project, phase or task level and preserve attribution | Partial; actual-time billable flag only | C4; financial rules C6 | [Billability][allocations] |
| PRJ07 | Save estimates, select a baseline and compare later delivery | Planned | C4 hour baselines; C6 economics; C8 alternatives | [Estimate snapshots][estimates] |
| PRJ08 | Shift project or phase dates with dependent work and milestones | Planned | C4 | [Project movement][bulk] |
| PRJ09 | Archive and restore projects without losing history | Partial; completion status, no archive lifecycle | C4 | [Project management][glossary] |
| PRJ10 | Track pipeline demand separately from confirmed work | Partial; tentative assignments excluded from committed load | C4 stages; C8 demand scenarios | [Project planning][project-planning] |

## Time tracking

| ID | Required capability | Kivo today | Delivery | Float evidence |
| --- | --- | --- | --- | --- |
| TIM01 | Record actual effort against projects and tasks | Partial; project entries, billable flag and notes | C5 task attribution | [Time tracking][time] |
| TIM02 | Submit, review and lock periods; govern corrections | Partial; weekly approval locks, no approved correction flow | C5 | [Timesheet locking][time] |
| TIM03 | Suggest actual entries from planned work with quick confirmation | Planned | C5 | [Prefilled time][time] |
| TIM04 | Configure optional automatic recording for recurring work | Planned | C5 | [Automatic logging][time] |
| TIM05 | Set submission deadlines and reminders | Planned | C5 | [Timesheet deadlines][time] |
| TIM06 | Start, pause, resume and stop a timer across sessions | Planned | C5 | [Web timer][time] |

## Project economics

| ID | Required capability | Kivo today | Delivery | Float evidence |
| --- | --- | --- | --- | --- |
| FIN01 | Resolve role, person, client, project and phase rate overrides | Partial; current person cost and project bill rate | C6 | [Rate setup][capacity], [project rates][projects] |
| FIN02 | Calculate budgets for no-budget, fixed hours, fixed fee, time and materials, and retainers | Partial; one hour budget | C6 | [Budget models][project-planning], [budget definitions][glossary] |
| FIN03 | Use project currencies and explicit exchange rates | Planned; USD only | C6 | [Project currencies][projects] |
| FIN04 | Track non-labor costs, billability, quantities and applicable markups | Planned | C6 | [Expenses][expenses] |
| FIN05 | Compare estimated, scheduled and actual cost and fee values | Planned | C6 calculation; C7 reporting | [Estimation][estimation], [financial reports][reports] |
| FIN06 | Forecast completion cost, budget consumption and delivery margin | Planned | C6 calculation; C7 reporting | [Profitability][profitability], [reports][reports] |
| FIN07 | Preserve dated rates, approved financial facts and historical baselines | Planned | C6 | Kivo integrity requirement; [Float rates][projects] establish the rate workflow, not Kivo's immutability contract |
| FIN08 | Govern financial access separately from planning access | Partial; only Owner/Admin see rates | C3 scopes; C6 money-specific permissions | [Access policy][access] |

## Reports and decision surfaces

| ID | Required capability | Kivo today | Delivery | Float evidence |
| --- | --- | --- | --- | --- |
| REP01 | Compare planned, recorded and approved hours with utilization | Implemented for hour reports | C7 expanded dimensions | [Actuals and utilization][reports] |
| REP02 | Explore results by client, project, phase, task, person, department and role | Partial; person/project tables and dates | C7 | [Report breakdowns][reports], [project details][glossary] |
| REP03 | Explain budget consumption, cost, fees, expenses and margins | Partial; lifetime approved hour-budget use | C7 | [Finance reports][reports] |
| REP04 | Provide operations and finance overviews within the same visual system | Partial; capacity and hour report views | C7 | [Operational and financial dashboards][reports] |
| REP05 | Compare baseline estimates, current plans and actual delivery | Partial; planned versus recorded/approved hours | C7; scenario deltas C8 | [Baseline reporting][estimates] |
| REP06 | Export selected report data with consistent filters and totals | Partial; schedule/hour CSV | C7; durable large exports C9 | [Estimate exports][estimates], [expense exports][expenses] |

## Access and organization administration

| ID | Required capability | Kivo today | Delivery | Float evidence |
| --- | --- | --- | --- | --- |
| GOV01 | Sign in, invite members and administer organization access | Implemented; Auth0, canonical local login/callback recovery, verified invitations and tenant roles | C0 regression; C12 hardening | [Team access][access] |
| GOV02 | Distinguish account access from scheduled resources and support unscheduled guests | Implemented separation; explicit enrollment | C3 lifecycle; C12 billing | [People and guests][team] |
| GOV03 | Scope visibility and management by person, department and project | Partial; A0 agents have project/tool scopes; human roles have organization-wide read access | A0 agent scopes; C3/C4 human scopes | [Scoped manager/member access][access] |
| GOV04 | Delegate review, finance, billing and security permissions explicitly | Partial; fixed organization roles | C3 review; C6 finance; C12 billing/security | [Access controls][access]; additional customization is also Announced on [pricing][pricing] |
| GOV05 | Inspect activity with actor, action, affected record and filters | Partial; backend audit records, no activity UI | C2 command history; C7 activity view | [Activity feed][activity] |
| GOV06 | Enforce enterprise sign-in, approved domains and multifactor authentication | Partial; hosted Auth0 login, no enforced enterprise policy | C12 | [Security settings][settings], [plan comparison][pricing] |
| GOV07 | Configure working week, display formats, statuses and personal appearance | Partial; timezone, calendars and one canonical dark theme | C3 calendar controls; C14 appearance | [Organization settings][settings], [personal preferences][personal] |
| GOV08 | Administer subscriptions, seats, invoices and payment methods | Planned | C12 | [Billing settings][settings] |
| GOV09 | Provide onboarding, support, account export/deletion and documented service terms | Partial; setup/enrollment and development docs | C12 | [Service offering][pricing], [account administration][settings] |

## Interoperability

| ID | Required capability | Kivo today | Delivery | Float evidence |
| --- | --- | --- | --- | --- |
| EXT01 | Import people and projects; migrate schedules and actuals with validation | Partial A1; supported people/projects/allocations CSV/XLSX with reviewed reconciliation; actuals migration remains planned | A1 supported workbooks; C9 full migration | [People imports][team], [project import surface][glossary]; schedule/actual migration is Kivo's extension |
| EXT02 | Publish a documented API with credentials, pagination and deletion/change tracking | Partial; A0 documented credential exchange and paginated machine reads/proposals; existing durable revisions | A0 bounded machine contracts; C9 full API/change stream | [Public API and delete stream][api] |
| EXT03 | Connect Google Calendar and Outlook; publish an iCalendar feed | Planned | C10 | [Calendar catalog][integrations], [personal calendar settings][personal] |
| EXT04 | Deliver schedule changes, reminders and mentions through Slack and email | Planned; invitations are manually shared links | C5 email reminders; C10 Slack/mentions | [Personal notifications][personal], [Slack activity][slack] |
| EXT05 | Connect PM tools including Asana, Jira, Teamwork and Trello | Planned | C11 separate connector iterations | [Configured PM integrations][settings] |
| EXT06 | Support automation through Zapier and public events | Planned | C9 event contract; C11 automation connector | [Automation catalog][integrations] |
| EXT07 | Support the catalog's partner and automation routes for CRM, ERP and finance | Planned | C11 separate mapping/reconciliation iterations | [Catalog][integrations], [connected estimation][estimation] |
| EXT08 | Expose capacity and project insights to external assistants through MCP | Partial; scoped schedule/capacity and inert move proposals via configured bearer client | A0 read/propose; C13 expanded tools and hosted OAuth discovery | [Float MCP][ai] — beta |

Catalog coverage is tracked by route, not by logo. The current catalog names Aprimo and Karbon partner connections, Google Calendar, MCP, and Zapier routes for Asana, Basecamp, ClickUp, HubSpot and Jira. Company settings additionally describes Asana, Jira, Teamwork and Trello setup. Marketing pages also name tools such as NetSuite, Salesforce, Monday.com and Wrike without establishing their exact route in those passages. C0 records native, partner, automation or unconfirmed status for each; C11 supplies and verifies an equivalent business flow for every confirmed route. [Integration catalog][integrations], [configured integrations][settings], [capacity ecosystem][capacity], [estimation ecosystem][estimation].

## Assistance and mobile access

| ID | Required capability | Kivo today | Delivery | Float evidence |
| --- | --- | --- | --- | --- |
| AI01 | Recommend staff using role fit and availability | Planned | A2/A3 capacity options; C8/C13 full scope | [Smart assign][ai] — described as shipped |
| AI02 | Summarize experience with inspectable supporting work | Planned | C13 | [Experience insights][ai] — described as rolling out |
| AI03 | Answer operational questions in natural language | Planned | A2 scoped planning; C13 richer queries | [MCP insights][ai] — beta |
| AI04 | Turn a brief into a proposed project structure and staffing plan | Planned | A3 future-work intent; C13 full brief | [Intelligent kickoff][ai] — exploratory roadmap, not shipped parity |
| MOB01 | Use schedule, leave and time workflows on a narrow touchscreen | Partial; responsive browser checks passed | C10 installable web experience | [Mobile workflows][mobile] |
| MOB02 | Provide iOS and Android clients for personal work, leave, time and notifications | Planned | C14 | [Native apps][mobile] |
| MOB03 | Configure light, dark and system appearance without changing interaction grammar | Planned; Quiet Canvas dark only | C14 | [Appearance preferences][personal] |

## Additional Kivo requirements

These are product hypotheses and quality requirements, not claims that Float lacks the capability.

| ID | Required capability | Kivo today | Delivery | Acceptance intent |
| --- | --- | --- | --- | --- |
| DIF01 | Maintain fluid input and dragging on large schedules | Unbenchmarked | A0 pilot envelope; C1 large scale | Measured browser latency, bounded queries and repeatable dataset |
| DIF02 | Preview multi-record effects and commit or undo safely | Planned | A3 narrow actions; C2/C8 full scope | Atomic commands, version conflicts and authorized reversal |
| DIF03 | Explain capacity and financial changes down to their source | Partial; daily overload detail | A1/A2 capacity; C7/C8 financial | Inspectable calendar, effort, rate and assumption references |
| DIF04 | Compare alternative plans without changing the live plan | Planned | A3 scheduling; C8 full scope | Separate drafts, baseline revisions and authorized publication |
| DIF05 | Rebalance using ranked options with costs and trade-offs | Planned | A3 capacity; C8/C13 full scope | Deterministic feasible options; human or explicitly delegated commitment |
| DIF06 | Make switching reversible and quantify migration quality | Partial A1; staged dry run, cancellation before publication, source refresh and original/pinned CSV downloads; customer metrics and undo remain open | A1 workbook slice; C9 full scope | Dry run, mappings, reconciliation and a safe cancellation boundary |
| DIF07 | Publish understandable pricing and demonstrate planning value | Partial; public value page, pausable product/workflow tours, SVG illustrations and inspectable capacity examples; pricing pending | C0 public entry; C12 pricing and paid evidence | Inspectable seat usage, cost model and paid-pilot evidence |
| OPS01 | Prove restore, deployment recovery and tenant-safe observability | Partial; pilot container/release configuration, credential preflight and recovery runbook prepared; hosted smoke, monitoring and restore rehearsal remain open | C0 hosted pilot before A2; before A3 live effects; C12 broader service | Restore rehearsal, rollback runbook and monitored budgets |
| OPS02 | Enforce resource quotas and fair scheduling under load | Partial; request limiter and bounded pools | A0–A3 run/job limits; C1/C12 scale | Multi-tenant saturation and queue fairness tests |
| OPS03 | Preserve privacy through scopes, exports, integrations and assistant access | Partial; roles, rate redaction and A0 scoped tool queries | A0 agent scope; C3 human scope; all cycles | Server-side authorization at every read, write and delivery |
| OPS04 | Keep historical work when resources, memberships or projects change | Partial; membership removal preserves planning/time; A0 preserves human audit and receipt identities | A0 principal migration; C3/C4/C6 expansion | Explicit archive/correction policy and migration reconciliation |
| OPS05 | Deliver accessible workflows with understandable failure recovery | Partial; keyboard, reduced motion and browser smoke checks | Every cycle; formal gate C12 | Task-based accessibility review and failure-path testing |

## Human and agent operations

These are Kivo's product requirements, defined in [Human and agent system design](agentic-system-design.md). They do not assert that Float has or lacks the corresponding behavior. A0 implementation is a development slice; later runtime and live-effect requirements remain planned.

| ID | Required capability | Kivo today | Delivery | Acceptance intent |
| --- | --- | --- | --- | --- |
| AGT01 | Authenticate agents as distinct revocable service principals | Implemented A0; hashed credentials, short sessions, tenant binding and principal audits | A0 | No shared human/admin tokens; tenant binding and additive identity migration |
| AGT02 | Register versioned agent definitions with accountable owners | Implemented A0 registry/version history and human administration | A0; execution configuration A1/A2 | Definition, allowed tools and ownership survive restart and remain inspectable |
| AGT03 | Delegate scoped, expiring authority with narrowed child grants | Implemented A0 projects/tools/modes/expiry; parent and owner revocation | A0; effect budgets A3 | Parent revocation and grant intersection prevent escalation |
| AGT04 | Execute autonomously within policy and escalate exceptions | Partial; Observe/Propose authority only, no live effects | A0 policy; A3 live effects | Exact approval or active delegation, limits and current versions govern commit |
| AGT05 | Recover durable runs/steps with fenced execution leases | Partial A1 import/export jobs with fenced leases, retry/dead letters and cancellation; agent runs/steps remain A2 | A1/A2 | Restart, cancellation and expired-worker tests preserve one logical effect |
| AGT06 | Trigger bounded runs from events or schedules | Planned | A2 | Deduplication, causality/loop suppression, deadlines and tenant fairness |
| AGT07 | Verify committed outcomes and expose partial workflow results | Planned | A2/A3 | Completion requires evidence; uncertain external effects reconcile |
| AGT08 | Offer equivalent typed actions through human UI, API and MCP | Partial; shared bounded reads/proposals and human UI review; no action execution | A0 reads/proposals; A3 effects | Shared business rules, authority and result/error semantics |
| AGT09 | Interpret supported spreadsheets with cell-level source evidence | Implemented bounded A1 development slice; manual and three model adapters; real customer/model-quality gate open | A1 | Uncertain meanings and formula values are reviewed before publication |
| AGT10 | Reuse mappings and reconcile refreshed spreadsheets | Implemented A1 source/mapping reuse and version-protected refreshed-file preview; customer gate open | A1 | Newer human changes remain intact; unsupported source details stay visible |
| AGT11 | Let humans inspect, pause, cancel and resolve agent exceptions in context | Planned | A2/A3 | Clear activity and source detail; cancellation does not pretend to undo committed steps |
| AGT12 | Evaluate malicious input, revoked access and unsupported model claims | Partial; A0 unknown/extra arguments, isolation, escalation, revocation and stale-context tests | A0 contract cases; A1–A3 model/end-to-end | Source text cannot authorize tools or alter policy |
| AGT13 | Enforce cumulative cost/action budgets and conflict-safe recovery | Planned | A2 limits; A3 effect reservation | Concurrent runs/retries cannot overspend or double mutate |
| AGT14 | Model human and agent delivery resources with distinct units | Planned | A4 | Human minutes, agent slots/usage and readiness remain separate |
| AGT15 | Dispatch scoped work items with output lineage and verification | Planned | A4 | One narrow adapter, private artifacts, hashes and producer/run references |
| AGT16 | Accept outputs under explicit review rules and track usage/rework | Planned | A4; C6 commercial valuation | Generated output is not approved time/completed work; independent review where required |

## Coverage rules

1. A cycle cannot close while one of its register entries is merely visually present. Its stated workflow, permissions, data rules and tests must pass.
2. Every implementation slice cites its IDs and parent A/C cycle. Early A cycles deliver named subsets; later C cycles retain their remaining coverage and do not rebuild completed contracts. Removing a requirement requires a recorded product decision.
3. Float parity is complete only after all documented capability rows pass equivalent workflow checks, all confirmed integration routes reconcile, and MOB02 ships on both platforms. Beta/rolling-out features retain their source status; exploratory AI04 is additional scope.
4. Commercial operations and certification are assessed separately. Implementing SSO or a security control does not establish SOC 2 certification, regulatory compliance or an SLA.
5. Recheck Float at each release boundary. Record changed behavior, entitlement or catalog routes here without resetting completed Kivo work.

[scheduling]: https://www.float.com/product/scheduling
[allocations]: https://support.float.com/en/articles/4188692-allocate-time
[capacity]: https://www.float.com/product/capacity-planning
[project-planning]: https://www.float.com/product/project-planning
[time]: https://www.float.com/product/time-tracking
[reports]: https://www.float.com/product/reports-and-dashboards
[pricing]: https://www.float.com/pricing
[ai]: https://www.float.com/ai
[integrations]: https://www.float.com/integrations
[bulk]: https://support.float.com/en/articles/28927-move-projects-phases-and-multiple-allocations-together
[links]: https://support.float.com/en/articles/5071179-link-allocations-together
[recurrence]: https://support.float.com/en/articles/5260455-repeat-an-allocation-a-time-off-or-a-status
[leave-booking]: https://support.float.com/en/articles/11470397-book-time-off
[leave-settings]: https://support.float.com/en/articles/13305294-time-off-settings
[team]: https://support.float.com/en/articles/10629140-your-team
[archive]: https://support.float.com/en/articles/28916-archive-a-person
[projects]: https://support.float.com/en/articles/4806377-projects
[glossary]: https://support.float.com/en/articles/8820706-the-float-glossary
[estimation]: https://www.float.com/product/project-cost-estimation
[estimates]: https://support.float.com/en/articles/11659845-project-estimates
[expenses]: https://support.float.com/en/articles/12285186-project-expenses
[profitability]: https://support.float.com/en/articles/13742802-budget-utilization-and-profitability
[access]: https://support.float.com/en/articles/14803456-manage-team-access-configure-users-and-their-permissions
[activity]: https://support.float.com/en/articles/1075182-activity-feed
[settings]: https://support.float.com/en/articles/8837442-company-settings
[personal]: https://support.float.com/en/articles/10346220-personal-settings
[api]: https://support.float.com/en/articles/55483-api
[slack]: https://support.float.com/en/articles/1496909-slack-team-messaging-float-activity-feed
[mobile]: https://www.float.com/download
