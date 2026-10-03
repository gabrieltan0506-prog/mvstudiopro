/** A request identity exists before enqueue, so refresh can also cancel a late submission. */
export const KNOWLEDGE_CARD_PAGE_ACTIONS = ["knowledge_card_distill", "knowledge_card_derive_level", "platform_composite_sheet_progress"] as const;
export type KnowledgeCardPageAction = typeof KNOWLEDGE_CARD_PAGE_ACTIONS[number];
export const KNOWLEDGE_CARD_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
