import type { Point } from "../game/simulation";
import type { OfficeRoster } from "./observation-departures";
import type { Phase } from "./observation-layout";

const labels: Record<Phase, string> = {
  thinking: "Working...", tool: "Using a tool", blocked: "Waiting for you", idle: "Ready",
};
const DEBOUNCE = 0.5;
const COOLDOWN = 8;
const DURATION = 3.5;
type Status = { phase: Phase; changed: number; spoken: number; pending: boolean; until: number; anchor: Point };
export type OfficeBubble = { id: string; text: string; index: number; anchor: Point; farewell: boolean; kind: "status" | "arrival" | "departure" };

export function bubbleBelongsToRoster(bubble: OfficeBubble, roster: OfficeRoster): boolean {
  if (bubble.kind !== "departure") return roster.members[bubble.index]?.id === bubble.id;
  const departure = roster.departures[bubble.index - roster.members.length];
  return departure?.member.id === bubble.id && departure.graceLeft === 0 && departure.confirmedMissing;
}

export function bubbleMatchesView(bubble: OfficeBubble, roster: OfficeRoster, view: { id: string; kind?: string; text: string | null }): boolean {
  return bubbleBelongsToRoster(bubble, roster) && bubble.id === view.id && bubble.kind === view.kind && bubble.text === view.text;
}

export class StatusBubbles {
  private entries = new Map<string, Status>();
  private greeted = new Set<string>();
  private greetings = new Map<string, { until: number; anchor: Point }>();

  update(roster: OfficeRoster, now: number, enabled = true): OfficeBubble[] {
    const retained = new Set([...roster.members, ...roster.departures.map(departure => departure.member)].map(member => member.id));
    for (const id of this.entries.keys()) if (!retained.has(id)) {
      this.entries.delete(id);
      this.greetings.delete(id);
    }
    for (const departure of roster.departures) this.greetings.delete(departure.member.id);
    const bubbles: OfficeBubble[] = [];
    roster.members.forEach((member, index) => {
      const agent = roster.agents[index];
      let status = this.entries.get(member.id);
      if (!status) {
        status = { phase: member.phase, changed: now, spoken: -Infinity, pending: member.phase === "blocked",
          until: 0, anchor: { x: agent.x, z: agent.z } };
        this.entries.set(member.id, status);
      } else if (status.phase !== member.phase) {
        status.phase = member.phase;
        status.changed = now;
        status.pending = true;
        status.until = 0;
      }
      if (agent.x === 100) return;
      if (agent.arriving && !this.greeted.has(member.id)) {
        this.greeted.add(member.id);
        this.greetings.set(member.id, { until: now + 2.5, anchor: { x: agent.x, z: agent.z } });
        status.spoken = now;
      }
      const greeting = this.greetings.get(member.id);
      if (greeting && now < greeting.until && member.phase !== "blocked") {
        bubbles.push({ id: member.id, text: "Hello!", index, anchor: greeting.anchor, farewell: false, kind: "arrival" });
        return;
      }
      if (agent.arriving && member.phase !== "blocked") return;
      if (status.pending && now - status.changed >= DEBOUNCE &&
        (member.phase === "blocked" || now - status.spoken >= COOLDOWN)) {
        status.pending = false;
        status.spoken = now;
        status.until = now + DURATION;
        status.anchor = { x: agent.x, z: agent.z };
      }
      if ((!status.pending && member.phase === "blocked") || now < status.until) {
        bubbles.push({ id: member.id, text: labels[member.phase], index, anchor: status.anchor, farewell: false, kind: "status" });
      }
    });
    roster.departures.forEach((departure, index) => {
      if (departure.graceLeft > 0 || !departure.confirmedMissing) return;
      bubbles.push({ id: departure.member.id, text: departure.phrase, index: roster.members.length + index,
        anchor: departure.anchor, farewell: true, kind: "departure" });
    });
    return enabled ? bubbles : [];
  }
}
