/** GamCiv AI — shared types for the edge functions (contract with SQL). */

export type ComplaintUrgency = "critical" | "high" | "normal" | "low";
export type ComplaintChannel = "whatsapp" | "web" | "sms";
export type ComplaintStatus =
  | "submitted"
  | "received"
  | "assigned"
  | "in_progress"
  | "waiting_info"
  | "forwarded"
  | "resolved"
  | "citizen_confirmation"
  | "closed"
  | "rejected"
  | "escalated"
  | "reopened";

/** Args for rpc submit_complaint (p_-prefixed params, PostgREST convention). */
export interface SubmitComplaintArgs {
  p_title: string | null;
  p_description: string;
  p_category_hint: string | null;
  p_urgency_hint: ComplaintUrgency | null;
  p_lat: number | null;
  p_lng: number | null;
  p_region: string | null;
  p_council_area: string | null;
  p_ward: string | null;
  p_photo_url: string | null;
  p_channel: ComplaintChannel;
  p_citizen_name: string | null;
  p_citizen_phone: string | null;
  p_is_anonymous: boolean;
  p_ai_category: string | null;
  p_ai_urgency: ComplaintUrgency | null;
  p_confidence: number | null;
  p_external_id: string | null;
}

/** Result of rpc submit_complaint. */
export interface SubmitComplaintResult {
  tracking_no: string;
  status: "received";
  institution: string;
  institution_name: string;
  department: string | null;
  expected_response_at: string;
  confidence: number | null;
  sensitive: boolean;
  group_id: number | null;
}

/** Mirrors the DB enum notif_channel (0001_schema.sql). */
export type NotificationChannel = "whatsapp" | "sms" | "email";
/**
 * Mirrors the DB enum notif_status: pending (awaiting pickup), sent, failed
 * (+ 'sending', added in 0010c_columns.sql, while the worker holds the claim).
 */
export type NotificationStatus = "pending" | "sent" | "failed" | "sending";

export interface NotificationRow {
  id: number;
  complaint_id: number;
  channel: NotificationChannel;
  recipient: string;
  message: string;
  status: NotificationStatus;
  provider_ref: string | null;
  error: string | null;
  attempts: number;
  last_attempt_at: string | null;
  sent_at: string | null;
}

/** GOWA webhook -> intake function response body. */
export interface IntakeOutcome {
  status: "accepted" | "rejected";
  tracking_no?: string;
  institution?: string;
  department?: string | null;
  expected_response_at?: string;
  confidence?: number | null;
  sensitive?: boolean;
  reason?: string;
}

/** notify-out request/response bodies. */
export interface NotifyOutRequest {
  notification_id: number;
}

export interface NotifyOutResult {
  status: "sent" | "failed" | "noop";
  channel?: NotificationChannel;
  provider_ref?: string | null;
  reason?: string;
}

// ---------------------------------------------------------------------------
// GOWA webhook envelope (go-whatsapp-web-multidevice v9.6)
// ---------------------------------------------------------------------------

/** Top-level GOWA webhook envelope. */
export interface GowaEnvelope {
  event: string;
  device_id?: string;
  session_id?: string;
  payload?: Record<string, unknown>;
}

/** Message event payload fields consumed by intake (subset). */
export interface GowaMessagePayload {
  id?: string;
  chat_id?: string;
  from?: string;
  from_lid?: string;
  sender_display_name?: string;
  from_name?: string;
  timestamp?: string | number;
  is_from_me?: boolean;
  /** Text body; also carries image captions. */
  body?: string;
  /** v9.6: string file path with auto-download, or object with url/path/caption. */
  image?: string | { url?: string; path?: string; caption?: string };
  /**
   * v9.6 voice/audio notes (voice = PTT, both arrive as audio): with
   * auto-download a relative path string ("statics/media/x.ogg"), otherwise
   * an object carrying the media url.
   */
  audio?: string | { url?: string; path?: string };
  location?: {
    degreesLatitude?: number;
    degreesLongitude?: number;
    name?: string;
    address?: string;
  };
}
