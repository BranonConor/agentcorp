import type { Agent } from "../game/simulation";

export type Phase = "idle" | "thinking" | "tool" | "blocked";
export type Member = { id: string; phase: Phase; present: true };

export function newAgent(id: number): Agent {
  return { id, state: "idle", x: 100, z: 100, target: { x: 100, z: 100 },
    route: [], workLeft: 0, workTotal: 0, visitedContext: false, arriving: true };
}

/** Keep visible agents at their desks when heartbeat priority changes. */
export function arrangeObservation(
  previous: readonly Member[], agents: readonly Agent[], incoming: readonly Member[],
): { members: Member[]; agents: Agent[] } {
  const fresh = new Map(incoming.map(member => [member.id, member]));
  if (fresh.size !== incoming.length) throw new Error("Duplicate observed session ID.");
  const previousAgents = new Map(previous.map((member, index) => [member.id, agents[index]]));
  const members: Member[] = [];
  for (const member of previous) {
    const updated = fresh.get(member.id);
    if (updated) {
      members.push(updated);
      fresh.delete(member.id);
    }
  }
  members.push(...fresh.values());
  const nextAgents = members.map((member, index) => {
    const agent = previousAgents.get(member.id) ?? newAgent(index);
    agent.id = index;
    return agent;
  });
  return { members, agents: nextAgents };
}
