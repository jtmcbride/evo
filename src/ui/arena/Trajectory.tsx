import type { Scenario } from "../../core/model";
import type { ComparisonArm } from "../../core/comparison";
export function Trajectory({
  scenario: s,
  arm,
  label,
  remaining,
}: {
  scenario: Scenario;
  arm: ComparisonArm;
  label: string;
  remaining?: boolean[];
}) {
  const first = arm.trajectory[0],
    last = arm.trajectory.at(-1)!;
  return (
    <figure className="comparison-trajectory">
      <figcaption>
        {label}
        <span>
          {arm.result.foodCollected} food · {arm.result.terminalReason}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${s.config.width} ${s.config.height}`}
        role="img"
        aria-label={`${label} trajectory from tick ${first.tick} to ${last.tick}`}
      >
        {s.obstacles.map((o) => (
          <rect
            key={o.id}
            x={o.x}
            y={o.y}
            width={o.width}
            height={o.height}
            className="comparison-obstacle"
          />
        ))}
        {s.food
          .filter((_, i) => !remaining || remaining[i])
          .map((f) => (
            <circle
              key={f.id}
              cx={f.x}
              cy={f.y}
              r={s.config.foodRadius}
              className="comparison-food"
            />
          ))}
        <polyline
          points={arm.trajectory.map((p) => `${p.x},${p.y}`).join(" ")}
          className="comparison-path"
        />
        <circle
          cx={first.x}
          cy={first.y}
          r={s.config.bodyRadius}
          className="comparison-start"
        />
        <circle
          cx={last.x}
          cy={last.y}
          r={s.config.bodyRadius}
          className="comparison-end"
        />
      </svg>
    </figure>
  );
}
