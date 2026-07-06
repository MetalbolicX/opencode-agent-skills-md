/**
 * Local interfaces for the OpenCode hook payload shapes this plugin
 * actually consumes.
 *
 * These intentionally mirror only the narrow slice of the SDK types
 * the plugin reads — defining them locally (rather than importing the
 * SDK's broad `UserMessage` / `Part` / `Event` types) keeps the
 * adapter resilient to upstream shape changes and lets us narrow
 * untyped runtime payloads safely.
 *
 * Internal only: this module is not re-exported from `src/index.ts`.
 */

/** A text-bearing chat part. `text` is optional because some parts carry metadata only. */
export interface ChatTextPart {
  type: "text";
  text?: string;
  synthetic?: boolean;
}

/** Minimal shape of the `chat.message` output payload the plugin reads. */
export interface ChatMessageOutput {
  message: {
    sessionID: string;
    model?: string;
    agent?: string;
  };
  parts: unknown[];
}

/** `session.compacted` event payload. */
export interface SessionCompactedEvent {
  type: "session.compacted";
  properties: { sessionID: string };
}

/** `session.deleted` event payload. */
export interface SessionDeletedEvent {
  type: "session.deleted";
  properties: { info: { id: string } };
}

/** Discriminated union of the session lifecycle events this plugin handles. */
export type SessionEvent = SessionCompactedEvent | SessionDeletedEvent;

/**
 * Narrow input shape for the `experimental.chat.system.transform` hook.
 *
 * The hook lets the plugin mutate the system prompt that the SDK
 * assembles for the next chat turn. We only read the message/session
 * identity — the actual system mutation lives on the output side.
 */
export interface SystemTransformInput {
  sessionID?: string;
  model?: { providerID: string; modelID: string };
  agent?: string;
}

/**
 * Narrow output shape for the `experimental.chat.system.transform` hook.
 *
 * `system` is the array of system prompt fragments the SDK is
 * assembling; appending here is non-destructive and composes with
 * every other plugin/system entry that the SDK is layering in.
 */
export interface SystemTransformOutput {
  system: string[];
}

/**
 * Narrow input shape for the `tool.definition` hook.
 *
 * `toolID` is the OpenCode identifier of the tool whose definition
 * the SDK is about to expose to the model. The plugin only reads the
 * identifier; the actual annotation lives on the output side.
 */
export interface ToolDefinitionInput {
  toolID: string;
}

/**
 * Narrow output shape for the `tool.definition` hook.
 *
 * The plugin only mutates `description` for tools in the
 * `PREFERENCE_TOOL_IDS` set; `parameters` is preserved verbatim. Per
 * the SDK contract, the hook is non-canceling — it can only enrich
 * the existing description, never replace it.
 */
export interface ToolDefinitionOutput {
  description: string;
  parameters: unknown;
}

/** Type guard: narrows `unknown` to `ChatTextPart` when `part.type === "text"`. */
export const isChatTextPart = (part: unknown): part is ChatTextPart => {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "text"
  );
};

/** Type guard: narrows `unknown` to `SessionCompactedEvent`. */
export const isSessionCompactedEvent = (event: unknown): event is SessionCompactedEvent => {
  return (
    typeof event === "object" &&
    event !== null &&
    (event as { type?: unknown }).type === "session.compacted"
  );
};

/** Type guard: narrows `unknown` to `SessionDeletedEvent`. */
export const isSessionDeletedEvent = (event: unknown): event is SessionDeletedEvent => {
  return (
    typeof event === "object" &&
    event !== null &&
    (event as { type?: unknown }).type === "session.deleted"
  );
};