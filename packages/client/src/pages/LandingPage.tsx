import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function LandingPage() {
  const { user } = useAuth();
  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">PLC Training Bench · Ladder Logic</span>
          <h1 className="hero-title">
            Wire the logic.
            <br />
            Watch it <span className="hl">run</span>.
          </h1>
          <p className="hero-sub">
            Program a Mitsubishi-style PLC to solve real motor-control problems — start/stop
            seal-ins, emergency stops, timers, counters. Build a rung, hit run, and see the power
            flow light up your machine.
          </p>
          <div className="hero-cta">
            <Link to="/puzzles" className="btn btn-primary">
              Enter the bench
            </Link>
            {!user && (
              <Link to="/login" className="btn btn-ghost">
                Create an account
              </Link>
            )}
          </div>
        </div>
        <HeroLadder />
      </section>

      <section className="feature-row">
        <Feature
          k="01"
          title="Authentic ladder editor"
          body="Normally-open and normally-closed contacts, coils, set/reset, on-delay timers and counters — placed on a real rung grid with series and parallel branches."
        />
        <Feature
          k="02"
          title="A live simulation"
          body="Every scan is deterministic. Toggle inputs on the operator panel and watch energized rungs glow and lamps illuminate in real time."
        />
        <Feature
          k="03"
          title="Graded like the real job"
          body="Each puzzle runs scripted test scenarios on the server. Solve the behavior, not just one lucky press, and your progress is saved."
        />
      </section>
    </div>
  );
}

function Feature({ k, title, body }: { k: string; title: string; body: string }) {
  return (
    <article className="feature">
      <span className="feature-k">{k}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function HeroLadder() {
  return (
    <div className="hero-ladder inset" aria-hidden>
      <svg viewBox="0 0 420 160" width="100%">
        {/* rails */}
        <line x1="16" y1="20" x2="16" y2="140" className="hl-rail hl-flow" />
        <line x1="404" y1="20" x2="404" y2="140" className="hl-rail" />
        {/* rung wire */}
        <line x1="16" y1="60" x2="404" y2="60" className="hl-wire hl-flow" />
        {/* NO contact */}
        <g className="hl-flow">
          <line x1="120" y1="46" x2="120" y2="74" className="hl-sym" />
          <line x1="150" y1="46" x2="150" y2="74" className="hl-sym" />
        </g>
        {/* NC contact */}
        <g className="hl-flow" style={{ animationDelay: '0.3s' }}>
          <line x1="230" y1="46" x2="230" y2="74" className="hl-sym" />
          <line x1="260" y1="46" x2="260" y2="74" className="hl-sym" />
          <line x1="228" y1="76" x2="262" y2="44" className="hl-sym" />
        </g>
        {/* coil */}
        <g className="hl-flow" style={{ animationDelay: '0.6s' }}>
          <path d="M348 44 A18 18 0 0 0 348 76" className="hl-sym" />
          <path d="M372 44 A18 18 0 0 1 372 76" className="hl-sym" />
        </g>
        <text x="135" y="98" className="hl-addr">X0</text>
        <text x="245" y="98" className="hl-addr">X1</text>
        <text x="360" y="98" className="hl-addr">Y0</text>
      </svg>
    </div>
  );
}
