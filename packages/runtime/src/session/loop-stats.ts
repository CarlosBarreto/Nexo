import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { LoopStats, ToolCallRecord } from "@houston/runtime-client";

/**
 * Per-prompt ReAct-loop telemetry, aggregated from events pi already emits.
 * One instance per prompt, shared by the two per-turn subscribers (chat.ts
 * and turn-session.ts) so both paths emit identical `loop_stats` frames.
 *
 * `observe` sees the RAW pi event, before toWire's filter — pi's
 * `turn_start` (one per model request in the loop) is dropped by toWire, so
 * counting must happen here. Tool tallies come from the subscriber's
 * existing ToolCallRecord list at finish time; duration brackets the whole
 * prompt() call.
 */
export class LoopStatsAccumulator {
  private steps = 0;
  private readonly startedMs = Date.now();

  observe(e: AgentSessionEvent): void {
    if (e.type === "turn_start") this.steps++;
  }

  finish(tools: ToolCallRecord[]): LoopStats {
    return {
      tool_calls: tools.length,
      tool_errors: tools.filter((t) => t.isError).length,
      steps: this.steps,
      duration_ms: Date.now() - this.startedMs,
    };
  }
}
