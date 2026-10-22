import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { scoreBand } from "./constants";
import type { ReviewScore } from "./queries";

export function ScoreBadge({ score }: { score: string | number | null }) {
  const band = scoreBand(score);
  if (!band) return <span className="text-zinc-400">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular-nums font-medium">{Number(score).toFixed(2)}</span>
      <Badge tone={band.tone}>{band.label}</Badge>
    </span>
  );
}

/** The scored criteria of a review, read-only. */
export function ScoresTable({ scores, actions }: { scores: ReviewScore[]; actions?: (s: ReviewScore) => ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500">
          <tr>
            <th className="py-2 pr-4 font-medium">Criterion</th>
            <th className="py-2 pr-4 font-medium">Target</th>
            <th className="py-2 pr-4 font-medium">Achieved</th>
            <th className="py-2 pr-4 font-medium">Score</th>
            <th className="py-2 pr-4 font-medium">Comment</th>
            {actions && <th className="py-2 font-medium" />}
          </tr>
        </thead>
        <tbody>
          {scores.map((s) => (
            <tr key={s.id} className="border-b border-zinc-100 align-top last:border-0">
              <td className="py-2 pr-4 font-medium">{s.criterion}</td>
              <td className="py-2 pr-4">{s.target ?? "—"}</td>
              <td className="py-2 pr-4">{s.actual ?? "—"}</td>
              <td className="py-2 pr-4 tabular-nums">{s.score} / 5</td>
              <td className="py-2 pr-4 text-zinc-600">{s.comment ?? ""}</td>
              {actions && <td className="py-2">{actions(s)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TextBlock({ label, text }: { label: string; text: string | null }) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-0.5 whitespace-pre-line text-sm">{text || "—"}</p>
    </div>
  );
}
