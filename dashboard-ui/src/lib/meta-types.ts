/**
 * TypeScript types for Meta (Facebook) Graph API
 * Used by chat module for Messenger/Instagram messaging
 */

// ─── Conversation Types ───

export interface MetaConversation {
    id: string;
    /** Updated time ISO string */
    updated_time: string;
    /** Snippet of last message */
    snippet?: string;
    /** Unread count */
    unread_count?: number;
    /** Participants in the conversation */
    participants?: {
        data: MetaParticipant[];
    };
    /** Messages in the conversation */
    messages?: {
        data: MetaMessage[];
        paging?: MetaPaging;
    };
}

export interface MetaParticipant {
    id: string;
    name: string;
    email?: string;
}

// ─── Message Types ───

export interface MetaMessage {
    id: string;
    message: string;
    created_time: string;
    from: {
        id: string;
        name: string;
    };
    to?: {
        data: Array<{ id: string; name: string }>;
    };
    /** Attachments (images, files, etc.) */
    attachments?: {
        data: MetaAttachment[];
    };
}

export interface MetaAttachment {
    id: string;
    mime_type: string;
    name?: string;
    size?: number;
    /** Image/file URL data */
    image_data?: {
        url: string;
        width: number;
        height: number;
        preview_url?: string;
    };
    file_url?: string;
}

// ─── Send API Types ───

export interface SendMessageRequest {
    recipient: {
        id: string;
    };
    messaging_type: "RESPONSE" | "UPDATE" | "MESSAGE_TAG";
    message: {
        text?: string;
        attachment?: {
            type: "image" | "audio" | "video" | "file";
            payload: {
                url: string;
                is_reusable?: boolean;
            };
        };
    };
    tag?: "CONFIRMED_EVENT_UPDATE" | "POST_PURCHASE_UPDATE" | "ACCOUNT_UPDATE" | "HUMAN_AGENT";
}

export interface SendMessageResponse {
    recipient_id: string;
    message_id: string;
}

// ─── Webhook Types ───

export interface WebhookEvent {
    object: "page" | "instagram";
    entry: WebhookEntry[];
}

export interface WebhookEntry {
    id: string;
    time: number;
    messaging?: WebhookMessaging[];
}

export interface WebhookMessaging {
    sender: { id: string };
    recipient: { id: string };
    timestamp: number;
    message?: {
        mid: string;
        text?: string;
        attachments?: Array<{
            type: "image" | "audio" | "video" | "file" | "fallback";
            payload: {
                url?: string;
                sticker_id?: number;
            };
        }>;
        quick_reply?: {
            payload: string;
        };
    };
    delivery?: {
        mids: string[];
        watermark: number;
    };
    read?: {
        watermark: number;
    };
}

// ─── Pagination ───

export interface MetaPaging {
    cursors?: {
        before: string;
        after: string;
    };
    next?: string;
    previous?: string;
}

export interface MetaPagedResponse<T> {
    data: T[];
    paging?: MetaPaging;
}

// ─── Tag for conversations ───

export type ConversationTag =
    | "new"
    | "pending"
    | "ordered"
    | "shipped"
    | "completed"
    | "spam"
    | "vip";

export interface ConversationTagInfo {
    label: string;
    color: string;
    bgColor: string;
}

export const CONVERSATION_TAGS: Record<ConversationTag, ConversationTagInfo> = {
    new: { label: "Mới", color: "#3B82F6", bgColor: "#EFF6FF" },
    pending: { label: "Đang xử lý", color: "#F59E0B", bgColor: "#FFFBEB" },
    ordered: { label: "Đã đặt", color: "#8B5CF6", bgColor: "#F5F3FF" },
    shipped: { label: "Đang giao", color: "#06B6D4", bgColor: "#ECFEFF" },
    completed: { label: "Hoàn thành", color: "#10B981", bgColor: "#ECFDF5" },
    spam: { label: "Spam", color: "#EF4444", bgColor: "#FEF2F2" },
    vip: { label: "VIP", color: "#F97316", bgColor: "#FFF7ED" },
};

// ─── Internal App Types ───

export interface ChatConversation extends MetaConversation {
    /** Customer (non-page participant) */
    customer?: MetaParticipant;
    /** Local tag */
    tag?: ConversationTag;
    /** Platform source */
    platform: "facebook" | "instagram";
    /** Page ID this conversation belongs to */
    page_id: string;
}

export interface ChatState {
    conversations: ChatConversation[];
    activeConversationId: string | null;
    messages: MetaMessage[];
    isLoading: boolean;
    isSending: boolean;
    error: string | null;
}
