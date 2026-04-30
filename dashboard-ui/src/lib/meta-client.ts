/**
 * Meta (Facebook) Graph API Client
 * Handles all communication with Facebook/Instagram Messenger APIs
 *
 * Server-side only — NEVER import this in client components
 */

import type {
    MetaConversation,
    MetaMessage,
    MetaPagedResponse,
    SendMessageRequest,
    SendMessageResponse,
} from "./meta-types";

const GRAPH_API_VERSION = "v19.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function getPageAccessToken(): string {
    const token = process.env.META_PAGE_ACCESS_TOKEN;
    if (!token) {
        throw new Error(
            "META_PAGE_ACCESS_TOKEN is not set. Add it to your .env.local file."
        );
    }
    return token;
}

function getPageId(): string {
    const pageId = process.env.META_PAGE_ID;
    if (!pageId) {
        throw new Error(
            "META_PAGE_ID is not set. Add it to your .env.local file."
        );
    }
    return pageId;
}

/**
 * Generic Graph API request helper
 */
async function graphRequest<T>(
    endpoint: string,
    options: {
        method?: "GET" | "POST" | "DELETE";
        params?: Record<string, string>;
        body?: unknown;
    } = {}
): Promise<T> {
    const { method = "GET", params = {}, body } = options;
    const token = getPageAccessToken();

    const url = new URL(`${GRAPH_API_BASE}${endpoint}`);
    url.searchParams.set("access_token", token);
    Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
    });

    const fetchOptions: RequestInit = {
        method,
        headers: {
            "Content-Type": "application/json",
        },
    };

    if (body && method === "POST") {
        fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Meta Graph API Error:", {
            status: response.status,
            endpoint,
            error: errorData,
        });
        throw new Error(
            `Meta API Error ${response.status}: ${errorData?.error?.message || response.statusText
            }`
        );
    }

    return response.json() as Promise<T>;
}

// ─── Conversations ───

/**
 * Get all conversations for the Page
 */
export async function getConversations(options: {
    limit?: number;
    after?: string;
    before?: string;
} = {}): Promise<MetaPagedResponse<MetaConversation>> {
    const { limit = 25, after, before } = options;
    const pageId = getPageId();

    const params: Record<string, string> = {
        fields: "id,updated_time,snippet,unread_count,participants",
        limit: String(limit),
    };

    if (after) params.after = after;
    if (before) params.before = before;

    return graphRequest<MetaPagedResponse<MetaConversation>>(
        `/${pageId}/conversations`,
        { params }
    );
}

/**
 * Get a single conversation by ID
 */
export async function getConversation(
    conversationId: string
): Promise<MetaConversation> {
    return graphRequest<MetaConversation>(`/${conversationId}`, {
        params: {
            fields:
                "id,updated_time,snippet,unread_count,participants,messages{id,message,created_time,from,to,attachments}",
        },
    });
}

// ─── Messages ───

/**
 * Get messages in a conversation
 */
export async function getMessages(
    conversationId: string,
    options: { limit?: number; after?: string } = {}
): Promise<MetaPagedResponse<MetaMessage>> {
    const { limit = 50, after } = options;

    const params: Record<string, string> = {
        fields: "id,message,created_time,from,to,attachments",
        limit: String(limit),
    };

    if (after) params.after = after;

    return graphRequest<MetaPagedResponse<MetaMessage>>(
        `/${conversationId}/messages`,
        { params }
    );
}

/**
 * Send a text message to a user via Send API
 */
export async function sendMessage(
    recipientId: string,
    text: string,
    messagingType: SendMessageRequest["messaging_type"] = "RESPONSE",
    tag?: SendMessageRequest["tag"]
): Promise<SendMessageResponse> {
    const pageId = getPageId();

    const payload: SendMessageRequest = {
        recipient: { id: recipientId },
        messaging_type: messagingType,
        message: { text },
    };

    if (tag) {
        payload.tag = tag;
    }

    return graphRequest<SendMessageResponse>(`/${pageId}/messages`, {
        method: "POST",
        body: payload,
    });
}

/**
 * Send an image attachment
 */
export async function sendImage(
    recipientId: string,
    imageUrl: string
): Promise<SendMessageResponse> {
    const pageId = getPageId();

    const payload: SendMessageRequest = {
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: {
            attachment: {
                type: "image",
                payload: { url: imageUrl, is_reusable: true },
            },
        },
    };

    return graphRequest<SendMessageResponse>(`/${pageId}/messages`, {
        method: "POST",
        body: payload,
    });
}

// ─── Page Info ───

/**
 * Get Page info
 */
export async function getPageInfo(): Promise<{
    id: string;
    name: string;
    picture?: { data: { url: string } };
}> {
    const pageId = getPageId();
    return graphRequest(`/${pageId}`, {
        params: { fields: "id,name,picture" },
    });
}

/**
 * Get the PSID (Page-Scoped User ID) of a user from conversation participants
 * Filters out the page itself from the participant list
 */
export function getCustomerFromParticipants(
    participants: MetaConversation["participants"],
    pageId?: string
): { id: string; name: string } | null {
    const pid = pageId || process.env.META_PAGE_ID || "";
    const customer = participants?.data?.find((p) => p.id !== pid);
    return customer ? { id: customer.id, name: customer.name } : null;
}
