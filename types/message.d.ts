/**
 * Type declarations for NormalizedMessage and associated structures.
 */

export type AuthorRole = 'streamer' | 'moderator' | null;

export interface MessageAuthor {
  /** Display name of the message sender */
  name: string;
  /** Direct URL to author avatar image, or null if absent */
  avatar: string | null;
  /** Confirmed Boosty author role ('streamer' | 'moderator' | null) */
  role: AuthorRole;
}

export interface MessageReply {
  /** Author name of the referenced parent message */
  author: string;
  /** Text content of the referenced parent message */
  text: string;
}

export interface TextSegment {
  type: 'text';
  text: string;
}

export interface EmojiSegment {
  type: 'emoji';
  id: string | null;
  alt: string;
  url: string;
}

export interface MentionSegment {
  type: 'mention';
  userId: string | null;
  displayName: string;
}

export type MessageSegment = TextSegment | EmojiSegment | MentionSegment;

export interface NormalizedMessage {
  /** Unique message identifier (platform-native ID or deterministic fallback) */
  id: string;
  /** Source platform identifier ('boosty') */
  platform: string;
  /** Structured author information */
  author: MessageAuthor;
  /** Sanitized message text content */
  text: string;
  /** Structured inline message segments (text, custom emoji, mention), or null for legacy messages */
  segments: MessageSegment[] | null;
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

export function normalizeAuthorRole(rawRole: any): AuthorRole;

export function isSafeEmojiUrl(url: any): boolean;

export function normalizeSegments(rawSegments: any): MessageSegment[] | null;

export function normalizeIncomingMessage(
  raw: Record<string, any>,
  options?: NormalizationOptions
): NormalizedMessage;

export function validateNormalizedMessage(message: any): ValidationResult;
