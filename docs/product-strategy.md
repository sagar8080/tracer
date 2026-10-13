# Kivo product direction and competitive research

Updated October 13, 2026. [Product design and iteration plan](product-design.md) defines full feature scope and capability expansion. [Human and agent system design](agentic-system-design.md) defines the early adoption sequence and shared operational contracts. [Feature coverage and Float parity](feature-parity.md) maps requirements, implementation status and delivery. Use these together for implementation decisions.

Kivo helps humans and agents answer: **Can we commit to this work, deliver it profitably and keep the plan reliable as conditions change?** Agents can observe, plan, act and verify within explicit delegated authority; people retain manual control and resolve exceptions. The initial customer hypothesis is a 10–100-person service team maintaining its weekly resource plan in Excel.

## Initial customer adoption

Start with one planner and a supported workbook. Reconcile people/projects/effort, explain overloads, preserve a readable spreadsheet export and let the planner delegate continuous monitoring and bounded future-work adjustments. First support declared tabular and weekly layouts; uncertain inputs stay visible. Do not require every employee to sign up before the planner receives value.

During coexistence, agree which planning fields Kivo owns. Re-import is a previewed reconciliation, not an unrestricted two-way overwrite. The initial product promise is a trustworthy weekly plan with less maintenance. Broader project economics, complex policies, connectors and native clients follow customer adoption while retaining their full roadmap obligations.

## Competitive baseline

Float connects staffing, project scope, actual delivery and project economics. Its public product/help pages document advanced scheduling, leave policies, estimates, financial reporting, integrations and mobile clients. Its AI page distinguishes shipped staffing assistance, experience-profile rollout, a beta MCP connector and exploratory project creation. This is a public-documentation baseline; workflow/entitlement comparisons belong to the C0 walkthrough. [Float product overview](https://www.float.com/), [Float AI](https://www.float.com/ai).

Kivo's required scope includes equivalent documented business workflows plus the additional requirements in the feature register. A timeline alone, a generic assistant, or lower pricing does not establish a competitive advantage. Paid adoption requires the planning workflow, trustworthy financials, easy switching and dependable operations to work together.

## Product hypotheses

1. **Faster repeat work.** A continuous scheduling canvas, keyboard actions, saved views, predictable dragging and previewed bulk operations can shorten weekly planning. Compare matched customer tasks before making a speed claim.
2. **Clear consequences.** Capacity and financial changes should explain the exact calendar days, work, rates and assumptions behind them. A manager should be able to inspect the source and act from that context.
3. **Safe replanning.** Draft alternatives, compare them against a baseline, then apply one authorized version-checked change. Avoid moving commitments, actuals or historical costs through an implicit side effect.
4. **Easy switching.** Preview imports, preserve source mappings, reconcile totals and flag unsupported semantics. A team should understand the quality of its migrated plan before relying on it.
5. **Understandable pricing.** Test a clear resource/seat policy with unscheduled account access and readable bills. Set commercial prices only after willingness-to-pay, operating cost and support requirements are measured.
6. **Useful delegated autonomy.** Run defined planning outcomes continuously and commit only within granted scope, impact and cost limits. Measure verified completion, avoidable human effort, inappropriate escalation and cost per useful outcome; chat volume is not success.

These are proposed advantages to validate; they are not claims that Float lacks similar capabilities.

## Product and architecture commitments

All screens use [Quiet Canvas](design-system.md): a continuous work surface, contextual controls, focused composers, restrained color and progressive disclosure. Scheduling, projects, workforce, time, financials and scenarios share that interaction grammar.

Keep capability rules, application workflows, transport and provider implementations separate. Every independent process has its own executable crate. New boundaries arrive with their first real workflow. Atomic tenant authorization, version checks, mutation, audit, receipt and committed event remain one PostgreSQL transaction. [Architecture](architecture.md).

Agents have their own principal, accountable owner, delegation and run history. Built-in and external agents share human business contracts, with policy/budget/fencing checks on effects. Operating agents and scheduled delivery resources remain distinct. Agent slots, usage and accepted outputs are not employee hours or automatically approved actuals.

The selected infrastructure remains Neon PostgreSQL, optional Upstash and private Neon Object Storage through its S3-compatible API. PostgreSQL owns application truth and analytics. The experiment does not need an additional analytics database or broker. Capacity and service costs are measured explicitly before offering a supported paid envelope.

## Current product and delivery order

Kivo has a development implementation of organization setup/access, scheduling, calendars/time off, member self-service, timesheet approval, leave approval and hour reporting. Financial forecasting, broad integrations, billing, enterprise policy and native clients remain planned. Executed evidence and its limits are recorded in [Validation](validation.md).

The immediate sequence is C0 baseline/fixtures, A0 principal/tool contracts, A1 workbook onboarding, A2 continuous observation and A3 delegated replanning. A4 adds one verified human/agent delivery workflow. Early cycles deliver narrow parts of the retained C1–C14 capability roadmap; completed contracts are reused as scheduling, workforce, projects, actuals, financials and ecosystem coverage expand. Agent operations are a foundation, not a late C13 addition. [Early cycles](agentic-system-design.md#early-delivery-cycles), [full iteration sequence](product-design.md#iteration-sequence).

## Customer validation

Recruit five resource managers from the initial segment. Have each recreate or import a realistic plan, staff a new project, move future work after a delay, resolve an overload and explain remaining availability and cost. Proposed gates are four of five completing core tasks unaided, no confusion between tentative and confirmed work, and at least 30% lower median time for matched tasks against their existing process. Record dataset, training, errors and learning effects alongside the comparison.

Commercial validation requires three teams to migrate real plans, use Kivo for four consecutive weeks and agree to pay. Observation pilots follow A1/A2; live delegated effects require A3 authority/recovery and operational gates before customer reliance. First-value time under 15 minutes on supported workbooks is a proposed target. Track planning effort saved, corrections, verified agent outcomes, inference cost, retained workspaces and support burden.

Functional parity, production readiness and commercial differentiation are separate gates. Complete the documented feature register before claiming parity; complete operational/security/recovery gates before selling a supported service; demonstrate customer outcomes before claiming superiority.
