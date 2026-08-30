import type { AgentService } from "@/src/application/ports/external-services";
import { GeminiAdkAgentService } from "@/src/infrastructure/agent/gemini-adk-agent-service";
import { getGeminiConfig } from "@/src/infrastructure/agent/gemini-config";

export function getAgentService(): AgentService {
  return new GeminiAdkAgentService(getGeminiConfig());
}
