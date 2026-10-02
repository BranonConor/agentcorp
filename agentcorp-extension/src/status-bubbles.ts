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
export type OfficeBubble = { id: string; text: string; index: number; anchor: Point; farewell: boolean };

export class StatusBubbles {
  private entries = new Map<string, Status>();

  update(roster: OfficeRoster, now: number, enabled = true): OfficeBubble[] {
    const retained = new Set([...roster.members, ...roster.departures.map(departure => departure.member)].map(member => member.id));
    for (const id of this.entries.keys()) if (!retained.has(id)) this.entries.delete(id);
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
      if (agent.x === 100 || (agent.arriving && member.phase !== "blocked")) return;
      if (status.pending && now - status.changed >= DEBOUNCE &&
        (member.phase === "blocked" || now - status.spoken >= COOLDOWN)) {
        status.pending = false;
        status.spoken = now;
        status.until = now + DURATION;
        status.anchor = { x: agent.x, z: agent.z };
      }
      if ((!status.pending && member.phase === "blocked") || now < status.until) {
        bubbles.push({ id: member.id, text: labels[member.phase], index, anchor: status.anchor, farewell: false });
      }
    });
    roster.departures.forEach((departure, index) => {
      if (departure.graceLeft > 0) return;
      bubbles.push({ id: departure.member.id, text: departure.phrase, index: roster.members.length + index,
        anchor: departure.anchor, farewell: true });
    });
    return enabled ? bubbles : [];
  }
}
