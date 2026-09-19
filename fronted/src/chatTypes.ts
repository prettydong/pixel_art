import type { Conversation as ServerConversation, Message as ServerMessage } from "@pixel/contracts";

export type ToolStatus = "pending" | "submitted" | "expired";
export type ToolResult =
  | { toolId: string; type: "single"; value: string }
  | { toolId: string; type: "multi"; value: string[] }
  | { toolId: string; type: "confirm"; value: boolean }
  | { toolId: string; type: "form"; value: Record<string, string | number> };
type ToolBase = { id: string; title: string; description?: string; status: ToolStatus; result?: ToolResult };
export type ToolOption = { value: string; label: string; description?: string };
export type ToolField = { id: string; label: string; type: "text" | "number"; required?: boolean; min?: number; max?: number };
export type InteractiveTool = ToolBase & (
  | { type: "single"; options: ToolOption[] }
  | { type: "multi"; options: ToolOption[] }
  | { type: "confirm"; confirmLabel?: string; cancelLabel?: string }
  | { type: "form"; fields: ToolField[] }
);
export type UnavailableTool = { id: string; type: "unavailable"; title: string; status: "expired" };
export type MessageTool = InteractiveTool | UnavailableTool;
export type Message = ServerMessage & { tools?: MessageTool[]; delivery?: "streaming" | "complete" | "stopped" };
export type Conversation = Omit<ServerConversation, "messages"> & { messages: Message[] };
