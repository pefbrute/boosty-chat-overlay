/**
 * Type declarations for NormalizedMessage and associated structures.
 */

export interface MessageAuthor {
  /** Display name of the message sender */
  name: string;
  /** Direct URL to author avatar image, or null if absent */
  avatar: string | null;
}

export interface MessageReply {
  /** Author name of the referenced parent message */
  author: string;
  /** Text content of the referenced parent message */
  text: string;
}

export interface NormalizedMessage {
  /** Unique message identifier (platform-native ID or deterministic fallback) */
  id: string;
  /** Source platform identifier ('boosty') */
  platform: string;
  /** Structured author information */
  author: MessageAuthor;
  /** Sanitized message text content */
  text: string;
  /** Optional reply quote context */
  reply: MessageReply | null;
  /** Time of publication on platform, or null */
  publishedAt: string | null;
  /** Ingestion timestamp on server in milliseconds */
  receivedAt: number;
  /** Sequential server SSE event ID for replay and reconnects */
  eventId?: string;
}

export interface NormalizationOptions {
  defaultPlatform?: string;
  receivedAt?: number;
  eventId?: string;
  generateId?: () => string;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  message?: NormalizedMessage;
}

export function normalizeIncomingMessage(
  raw: Record<string, any>,
  options?: NormalizationOptions
): NormalizedMessage;

export function validateNormalizedMessage(message: any): ValidationResult;
