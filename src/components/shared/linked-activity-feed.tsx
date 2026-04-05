"use client";

import { useState, useCallback, useEffect } from "react";
import {
  MessageSquare,
  Mail,
  Mic,
  Paperclip,
  Image,
  FileText,
  Phone,
  Edit3,
  Link2,
  LinkIcon,
  AlertTriangle,
  CheckCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Unlink,
  ThumbsUp,
} from "lucide-react";

interface Props {
  entityType: "Ticket" | "Enquiry" | "OrderGroup" | "BacklogCase";
  entityId: string;
}

interface InboundEvent {
  id: string;
  eventType: string;
  sourceType: string;
  sender: string | null;
  senderPhone: string | null;
  senderEmail: string | null;
  receivedAt: string;
  rawText: string | null;
  subject: string | null;
  linkStatus: string;
  linkConfidence: number | string | null;
  linkReasons: string[];
  provisionalLink: boolean;
  linkedEntityType: string | null;
}

const EVENT_ICONS: Record<string, any> = {
  WHATSAPP_MESSAGE: MessageSquare,
  EMAIL: Mail,
  VOICE_NOTE: Mic,
  ATTACHMENT: Paperclip,
  MEDIA_IMAGE: Image,
  MEDIA_PDF: FileText,
  MEDIA_DOCUMENT: FileText,
  PHONE_CALL: Phone,
  MANUAL_NOTE: Edit3,
};

const LINK_STATUS_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
  LINKED_HIGH: { color: "#00CC66", icon: CheckCircle, label: "HIGH" },
  LINKED_MEDIUM: { color: "#FFAA00", icon: AlertTriangle, label: "MEDIUM" },
  NEEDS_REVIEW: { color: "#FF6600", icon: Clock, label: "REVIEW" },
  NEW_ENQUIRY_CANDIDATE: { color: "#4488FF", icon: LinkIcon, label: "NEW" },
  UNPROCESSED: { color: "#555555", icon: Clock, label: "PENDING" },
};

export function LinkedActivityFeed({ entityType, entityId }: Props) {
  const [events, setEvents] = useState<InboundEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/commercial/link-resolver?entityType=${entityType}&entityId=${entityId}&limit=100`
      );
      const data = await res.json();
      setEvents(data.events || []);
    } catch (err) {
      console.error("Failed to load linked events:", err);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const handleConfirm = async (id: string) => {
    await fetch("/api/commercial/link-resolver", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inboundEventId: id, action: "confirm" }),
    });
    loadEvents();
  };

  const handleUnlink = async (id: string) => {
    await fetch("/api/commercial/link-resolver", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inboundEventId: id, action: "unlink" }),
    });
    loadEvents();
  };

  if (loading) {
    return <div className="text-[10px] text-[#555555] bb-mono py-2">Loading activity...</div>;
  }

  if (events.length === 0) {
    return <div className="text-[10px] text-[#555555] bb-mono py-2">No linked inbound activity.</div>;
  }

  return (
    <div className="space-y-1">
      <div className="text-[9px] font-bold tracking-[0.2em] text-[#FF6600] bb-mono border-b border-[#333333] pb-1 mb-1 flex items-center gap-1.5">
        <Link2 className="h-3 w-3" />
        LINKED ACTIVITY ({events.length})
      </div>

      {events.map((event) => {
        const Icon = EVENT_ICONS[event.eventType] || MessageSquare;
        const statusCfg = LINK_STATUS_CONFIG[event.linkStatus] || LINK_STATUS_CONFIG.UNPROCESSED;
        const StatusIcon = statusCfg.icon;
        const isExpanded = expandedId === event.id;

        return (
          <div key={event.id} className="border border-[#2A2A2A] rounded">
            <button
              onClick={() => setExpandedId(isExpanded ? null : event.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-[#1A1A1A] transition-colors"
            >
              {isExpanded ? <ChevronDown className="h-2.5 w-2.5 text-[#555555]" /> : <ChevronRight className="h-2.5 w-2.5 text-[#555555]" />}
              <Icon className="h-3 w-3 text-[#666666] shrink-0" />
              <span className="text-[10px] text-[#888888] bb-mono w-20 shrink-0">
                {new Date(event.receivedAt).toLocaleDateString("en-GB")}
              </span>
              <span className="text-[10px] text-[#CCCCCC] bb-mono truncate flex-1">
                {event.sender || "Unknown"}: {(event.rawText || event.subject || "—").slice(0, 80)}
              </span>
              <StatusIcon className="h-3 w-3 shrink-0" style={{ color: statusCfg.color }} />
              {event.provisionalLink && (
                <span className="text-[8px] px-1 py-0.5 rounded bg-[#FFAA0015] text-[#FFAA00] bb-mono">PROVISIONAL</span>
              )}
            </button>

            {isExpanded && (
              <div className="px-3 py-2 border-t border-[#1A1A1A] space-y-2">
                {/* Full text */}
                {event.rawText && (
                  <div className="text-[10px] text-[#CCCCCC] bb-mono whitespace-pre-wrap max-h-24 overflow-y-auto">
                    {event.rawText}
                  </div>
                )}

                {/* Link reasons */}
                {event.linkReasons.length > 0 && (
                  <div className="space-y-0.5">
                    <div className="text-[8px] font-bold tracking-wider text-[#666666] bb-mono">LINK REASONS</div>
                    {event.linkReasons.map((r, i) => (
                      <div key={i} className="text-[9px] text-[#888888] bb-mono flex items-center gap-1">
                        <CheckCircle className="h-2.5 w-2.5 text-[#00CC66]" />
                        {r}
                      </div>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1 border-t border-[#1A1A1A]">
                  {event.provisionalLink && (
                    <button
                      onClick={() => handleConfirm(event.id)}
                      className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded bg-[#00CC6615] text-[#00CC66] hover:bg-[#00CC6630] bb-mono"
                    >
                      <ThumbsUp className="h-2.5 w-2.5" /> Confirm
                    </button>
                  )}
                  <button
                    onClick={() => handleUnlink(event.id)}
                    className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded bg-[#FF444415] text-[#FF4444] hover:bg-[#FF444430] bb-mono"
                  >
                    <Unlink className="h-2.5 w-2.5" /> Unlink
                  </button>
                  <div className="ml-auto text-[8px] text-[#444444] bb-mono">
                    {event.eventType} · {event.sourceType} · conf: {Number(event.linkConfidence || 0)}%
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
