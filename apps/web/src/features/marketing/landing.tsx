import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Bot,
  ChevronDown,
} from "lucide-react";
import { ProductPreview } from "./product-preview";
import { Header, Wordmark } from "./header";
import { PageMotion } from "./motion";
import { WorkflowStory } from "./workflow-story";
import { CapacityStory } from "./capacity-story";
import { TeamVisual } from "./team-visual";
import s from "./landing.module.css";

const faqs = [
  {
    question: "How do I get started?",
    answer:
      "Create an account and choose a personal or team workspace. Add your people and projects, set working hours, and start planning. You can invite your team when you’re ready.",
  },
  {
    question: "Can my team work from the same plan?",
    answer:
      "Yes. Shared workspaces keep schedules, projects and people together, with live updates and roles for owners, administrators, planners, members and viewers. Scheduling profiles and account access are managed separately.",
  },
  {
    question: "Can we track actual hours?",
    answer:
      "Team members can record time against projects and submit weekly timesheets. Owners and administrators can review them. Reports show planned, recorded and approved hours separately, and can be exported as CSV.",
  },
  {
    question: "How does agent access work?",
    answer:
      "An owner or administrator gives an agent expiring access to selected projects. Agents can read schedules and capacity, or propose allocation moves through the API and MCP. Your team can inspect and review those proposals. Proposals do not change the live schedule.",
  },
  {
    question: "Can we bring our spreadsheet?",
    answer:
      "Workbook import and reconciliation are the next development milestone. Today, you can create your planning data in Kivo and export hours reports as CSV. Spreadsheet import is not available yet.",
  },
  {
    question: "What stage is Kivo at?",
    answer:
      "Kivo is in early development, with scheduling, capacity, time tracking, team workspaces and agent proposals available to explore. Pricing and the wider rollout are still being defined.",
  },
];
export function Landing({
  authEnabled,
  signedIn,
}: {
  authEnabled: boolean;
  signedIn: boolean;
}) {
  const startHref =
    signedIn || !authEnabled
      ? "/app"
      : "/auth/login?screen_hint=signup&returnTo=%2Fapp";
  const loginHref =
    signedIn || !authEnabled ? "/app" : "/auth/login?returnTo=%2Fapp";
  return (
    <PageMotion>
      <div className={s.page}>
        <a className={s.skipLink} href="#main-content">
          Skip to content
        </a>
        <div className={`${s.container} ${s.navShell}`}>
          <Header
            startHref={startHref}
            loginHref={loginHref}
            loginLabel={signedIn ? "Open workspace" : "Log in"}
          />
        </div>
        <main id="main-content">
          <section
            className={`${s.hero} ${s.container}`}
            aria-labelledby="hero-title"
          >
            <div className={s.heroGrid}>
              <div>
                <p className={s.eyebrow}>
                  <span /> Resource planning for modern teams
                </p>
                <h1 id="hero-title">
                  Know who’s free.
                  <br />
                  <span>Plan what’s next.</span>
                </h1>
              </div>
              <div className={s.heroCopy}>
                <p>
                  A shared plan for people, projects, and the week ahead. See
                  capacity. Move work. Make room.
                </p>
                <div className={s.heroActions}>
                  <a className={s.button} href={startHref}>
                    {signedIn ? "Open your workspace" : "Start planning"}
                    <ArrowUpRight size={16} />
                  </a>
                  <a className={s.textLink} href="#product">
                    Explore the product <ArrowRight size={16} />
                  </a>
                </div>
                <span className={s.earlyAccess}>Kivo is in early access.</span>
              </div>
            </div>
            <div id="product" className={s.productAnchor}>
              <div className={s.previewIntro}>
                <span>
                  <i /> A clearer week starts here
                </span>
                <span>
                  Explore the product tour below <ArrowRight size={12} />
                </span>
              </div>
              <ProductPreview />
            </div>
          </section>
          <section
            className={`${s.teamStrip} ${s.container}`}
            id="teams"
            aria-label="Who Kivo is for"
          >
            <p>
              For teams whose best work <br />
              depends on people.
            </p>
            <div>
              <span>Design studios</span>
              <span>Product teams</span>
              <span>Consultancies</span>
              <span>In-house teams</span>
            </div>
          </section>
          <section
            className={`${s.section} ${s.container}`}
            aria-labelledby="planning-title"
          >
            <div className={s.sectionHeading} data-reveal>
              <p className={s.eyebrow}>A little clarity goes a long way</p>
              <h2 id="planning-title">
                Less time coordinating.
                <br />
                <span>More room for the work.</span>
              </h2>
            </div>
            <WorkflowStory />
          </section>
          <section
            className={`${s.story} ${s.container}`}
            id="why-kivo"
            aria-labelledby="capacity-title"
          >
            <div className={s.storyCopy} data-reveal>
              <p className={s.eyebrow}>See the pressure before it builds</p>
              <h2 id="capacity-title">
                A full schedule
                <br />
                isn’t the full picture.
              </h2>
              <p>
                The team might have room. One person might not. Bring working
                hours, leave, and overlapping projects into the same picture.
              </p>
              <ul>
                <li>
                  <Check size={16} />
                  Availability based on working calendars
                </li>
                <li>
                  <Check size={16} />
                  Overloads visible on the days they happen
                </li>
                <li>
                  <Check size={16} />
                  Time off reflected in the shared plan
                </li>
              </ul>
            </div>
            <CapacityStory />
          </section>
          <section
            className={`${s.agentsSection} ${s.container}`}
            id="agents"
            aria-labelledby="agents-title"
          >
            <div className={s.storyCopy} data-reveal>
              <p className={s.eyebrow}>Built for people. Ready for agents.</p>
              <h2 id="agents-title">
                Your planning tools.
                <br />
                <span>Your agents, too.</span>
              </h2>
              <p>
                Give an agent access to the projects it needs. Let it inspect
                capacity and suggest a move, with the source plan and its impact
                ready for your team to review.
              </p>
              <a href="#faq" className={s.textLink}>
                How agent access works <ArrowRight size={16} />
              </a>
            </div>
            <figure className={s.agentFigure} data-reveal>
              <div className={s.agentIdentity}>
                <span>
                  <Bot size={18} />
                </span>
                <div>
                  <strong>Weekly planning agent</strong>
                  <small>Atlas rebrand · Proposal access</small>
                </div>
                <span className={s.proposalTag}>Proposal</span>
              </div>
              <div
                className={s.agentSteps}
                aria-label="Agent proposal workflow"
              >
                <span>
                  <Check size={11} />
                  Read the plan
                </span>
                <i />
                <span>
                  <Check size={11} />
                  Suggest a move
                </span>
                <i />
                <span className={s.agentPending}>Team review</span>
              </div>
              <h3>Give the review room to breathe.</h3>
              <p>Move the design review to a day with more availability.</p>
              <div className={s.proposalDates}>
                <span>
                  <small>Current</small>Monday, Oct 19
                </span>
                <ArrowRight size={16} />
                <span>
                  <small>Suggested</small>Tuesday, Oct 20
                </span>
              </div>
              <details className={s.proposalDetails}>
                <summary>
                  Inspect the proposal <ChevronDown size={14} />
                </summary>
                <dl>
                  <div>
                    <dt>Person</dt>
                    <dd>Maya Chen</dd>
                  </div>
                  <div>
                    <dt>Daily effort</dt>
                    <dd>2 hours, unchanged</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>Schedule revision 24</dd>
                  </div>
                  <div>
                    <dt>Decision</dt>
                    <dd>Pending team review</dd>
                  </div>
                </dl>
              </details>
              <figcaption>
                <span>
                  <Check size={13} />
                  Live plan unchanged
                </span>
                <span>Illustrative proposal</span>
              </figcaption>
            </figure>
          </section>
          <section
            className={`${s.workTogether} ${s.container}`}
            aria-labelledby="together-title"
          >
            <p className={s.eyebrow}>One workspace. A shared understanding.</p>
            <h2 id="together-title">A plan worth sharing.</h2>
            <p>
              A shared plan for your team, with clear roles and live updates.
            </p>
            <TeamVisual />
            <div className={s.teamPromises}>
              <span>
                <Check size={15} />
                Personal and team workspaces
              </span>
              <span>
                <Check size={15} />
                Role-based access
              </span>
              <span>
                <Check size={15} />
                Live schedule updates
              </span>
            </div>
          </section>
          <section
            className={`${s.faq} ${s.container}`}
            id="faq"
            aria-labelledby="faq-title"
          >
            <div>
              <p className={s.eyebrow}>A few useful details</p>
              <h2 id="faq-title">
                Before you <br />
                make room.
              </h2>
            </div>
            <div className={s.faqList}>
              {faqs.map((faq) => (
                <details key={faq.question}>
                  <summary>
                    {faq.question}
                    <span aria-hidden="true">+</span>
                  </summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </section>
          <section
            className={`${s.closing} ${s.container}`}
            aria-labelledby="closing-title"
          >
            <div>
              <p className={s.eyebrow}>Your next good week starts here</p>
              <h2 id="closing-title">Make room for better work.</h2>
            </div>
            <a className={s.button} href={startHref}>
              {signedIn ? "Open your workspace" : "Get started with Kivo"}
              <ArrowUpRight size={17} />
            </a>
          </section>
        </main>
        <footer className={`${s.footer} ${s.container}`}>
          <div>
            <a href="/" aria-label="Kivo home">
              <Wordmark />
            </a>
            <p>People, projects, and a little more clarity.</p>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#product">Product</a>
            <a href="#agents">For agents</a>
            <a href="#faq">Getting started</a>
            <a href={loginHref}>{signedIn ? "Workspace" : "Log in"}</a>
          </nav>
          <div className={s.footerBase}>
            <span>© {new Date().getFullYear()} Kivo</span>
            <span>
              <i />
              Built for the way work is changing.
            </span>
          </div>
        </footer>
      </div>
    </PageMotion>
  );
}
