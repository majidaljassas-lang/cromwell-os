/**
 * WhatsApp Message Parser
 *
 * Parses WhatsApp message payloads into structured commercial data.
 * One chat can feed multiple tickets — link fragments, not whole chats.
 */

import { extractEntities, extractLineCandidates, extractMonetaryValues, type ParsedEntity, type ParsedLineCandidate } from "./parser";
import { classifyMessage, type MessageClassification } from "./classifier";

export interface WhatsAppMessagePayload {
  message_id: string;
  chat_id?: string;
  chat_name?: string;
  sender_name?: string;
  sender_phone?: string;
  timestamp: string;
  message_text?: string;
  media_type?: string;
  media_url?: string;
  media_caption?: string;
  is_outbound?: boolean;
  is_group?: boolean;
  quoted_message_id?: string;
  voice_note_duration?: number;
}

export interface ParsedWhatsAppMessage {
  externalMessageId: string;
  chatId?: string;
  chatName?: string;
  senderName: string | null;
  senderPhone: string | null;
  timestamp: string;
  messageText: string;
  isOutbound: boolean;
  isGroup: boolean;
  isVoiceNote: boolean;
  voiceNoteDuration?: number;
  mediaType: string | null;
  mediaUrl: string | null;
  classification: MessageClassification;
  classificationConfidence: number;
  classificationReasons: string[];
  entities: ParsedEntity[];
  lineCandidates: ParsedLineCandidate[];
  monetaryValues: { value: number; context: string }[];
  contactGuess: string | null;
  siteGuess: string | null;
}

export function parseWhatsAppMessage(payload: WhatsAppMessagePayload): ParsedWhatsAppMessage {
  const messageText = payload.message_text || payload.media_caption || "";
  const isVoiceNote = payload.media_type === "audio" || payload.media_type === "ptt";

  // Classify message
  const { classification, confidence, reasons } = classifyMessage(messageText);

  // Extract entities
  const entities = extractEntities(messageText);

  // Extract line candidates
  const lineCandidates = extractLineCandidates(messageText);

  // Extract monetary values
  const monetaryValues = extractMonetaryValues(messageText);

  // Guess contact from sender
  const contactGuess = payload.sender_name || null;

  // Guess site from group chat name or message content
  const siteGuess = guessSiteFromChat(payload.chat_name, messageText);

  return {
    externalMessageId: payload.message_id,
    chatId: payload.chat_id,
    chatName: payload.chat_name,
    senderName: payload.sender_name || null,
    senderPhone: payload.sender_phone || null,
    timestamp: payload.timestamp,
    messageText,
    isOutbound: payload.is_outbound ?? false,
    isGroup: payload.is_group ?? false,
    isVoiceNote,
    voiceNoteDuration: payload.voice_note_duration,
    mediaType: payload.media_type || null,
    mediaUrl: payload.media_url || null,
    classification,
    classificationConfidence: confidence,
    classificationReasons: reasons,
    entities,
    lineCandidates,
    monetaryValues,
    contactGuess,
    siteGuess,
  };
}

function guessSiteFromChat(chatName?: string, messageText?: string): string | null {
  // Group chat names often contain site names
  if (chatName) {
    // Filter out generic group names
    const generic = ["family", "friends", "team", "office", "general"];
    if (!generic.some((g) => chatName.toLowerCase().includes(g))) {
      return chatName;
    }
  }

  // Look for site references in message text
  if (messageText) {
    const siteMatch = messageText.match(
      /(?:at|for|site|@)\s+([A-Z][a-zA-Z\s]{2,25}(?:Place|House|Court|Road|Street|Lane|Park|Gardens|Square|Tower|Building))/
    );
    if (siteMatch) return siteMatch[1].trim();
  }

  return null;
}
