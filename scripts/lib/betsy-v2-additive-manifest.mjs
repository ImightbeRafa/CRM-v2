/**
 * Shared inventory for Betsy v2 additive SQL apply + verify scripts.
 * Keep FILES / expected tables / columns / indexes in one place.
 */
export const FILES = {
  '018': '018_betsy_v2_feature_flags.sql',
  '019': '019_betsy_v2_order_lifecycle.sql',
  '020': '020_betsy_v2_server_pagination.sql',
  '021': '021_betsy_v2_bot_inbox.sql',
  '022': '022_betsy_v2_order_archive.sql',
  '023': '023_betsy_v2_tenant_ui.sql',
  '024': '024_chat_inbox_conversations.sql',
};

export const DEFAULT_APPLY_FILES = '018,019,020,021,022,023,024';

export const EXPECTED_TABLES = {
  '018': ['TenantFeatureFlag'],
  '019': ['ClientIdentityConflict', 'OrderLifecycleOperation', 'OrderInventoryAllocation'],
  '020': ['TenantOrderStatusClassification'],
  '021': ['BotInboxMessage', 'BotInboxDelivery'],
  '022': [],
  '023': ['TenantSetupProgress'],
  '024': ['ChatConversation', 'ChatConversationReadState'],
};

export const EXPECTED_COLUMNS = {
  '019': [
    ['Order', 'clientId'],
    ['Order', 'lifecycleVersion'],
    ['Client', 'normalizedPhone'],
    ['Invoice', 'emailStatus'],
  ],
  '021': [
    ['BotSession', 'seatPolicy'],
    ['Invoice', 'sourceOperationKey'],
  ],
  '022': [
    ['Order', 'deletedAt'],
    ['Order', 'archiveMetadata'],
  ],
  '024': [
    ['SocialAccount', 'displayName'],
    ['SocialAccount', 'providerDisplayName'],
    ['SocialAccount', 'providerUsername'],
    ['SocialAccount', 'displayPhoneNumber'],
    ['SocialAccount', 'wabaId'],
    ['SocialAccount', 'pageId'],
    ['SocialAccount', 'avatarUrl'],
    ['SocialAccount', 'tokenStatus'],
    ['SocialAccount', 'tokenLastCheckedAt'],
    ['SocialAccount', 'subscribedAt'],
    ['SocialAccount', 'lastWebhookAt'],
    ['SocialAccount', 'lastSendAt'],
    ['SocialAccount', 'lastErrorAt'],
    ['SocialAccount', 'lastErrorCode'],
    ['SocialAccount', 'disconnectedAt'],
    ['ChatMessage', 'conversationId'],
    ['ChatMessage', 'providerMessageId'],
    ['ChatMessage', 'peerId'],
    ['ChatMessage', 'messageType'],
    ['ChatMessage', 'deliveryStatus'],
    ['ChatMessage', 'statusUpdatedAt'],
    ['ChatMessage', 'deliveredAt'],
    ['ChatMessage', 'readAt'],
    ['ChatMessage', 'failedAt'],
    ['ChatMessage', 'errorCode'],
    ['ChatMessage', 'providerMediaId'],
    ['ChatMessage', 'mediaMimeType'],
    ['ChatMessage', 'mediaFilename'],
    ['ChatMessage', 'duplicateOfMessageId'],
    ['ChatMessage', 'createdAt'],
    ['ChatMessage', 'updatedAt'],
    ['ChatConversation', 'revision'],
    ['ChatConversation', 'tags'],
    ['ChatConversation', 'inboundCount'],
    ['ChatConversation', 'messageCount'],
    ['ChatConversation', 'lastMessageAt'],
    ['ChatConversationReadState', 'readInboundCount'],
  ],
};

/** Index names introduced by 024 (non-unique only; 025 uniques are out of scope). */
export const EXPECTED_INDEXES_024 = [
  'SocialAccount_tenantId_isActive_platform_idx',
  'ChatConversation_tenantId_lastMessageAt_id_idx',
  'ChatConversation_tenantId_status_lm_id_idx',
  'ChatConversation_tenantId_account_lm_id_idx',
  'ChatConversation_tenant_assignee_status_lm_idx',
  'ChatConversation_tenantId_revision_idx',
  'ChatConversation_clientId_partial_idx',
  'ChatConversationReadState_tenantId_userId_idx',
  'ChatMessage_conversationId_sentAt_id_idx',
  'ChatMessage_socialAccountId_providerMessageId_idx',
  'ChatMessage_tenantId_createdAt_id_idx',
];

export const EXPECTED_SEQUENCE_024 = 'ChatConversation_revision_seq';
export const EXPECTED_TRIGGER_024 = 'ChatConversation_revision_trg';

/** Forbidden in 024 — these belong to gated migration 025. */
export const FORBIDDEN_025_INDEX_FRAGMENTS = [
  'providerMessageId',
  'platform_accountId',
];

export const VERIFY_CATALOG_TABLES = [
  'TenantFeatureFlag',
  'ClientIdentityConflict',
  'OrderLifecycleOperation',
  'OrderInventoryAllocation',
  'TenantOrderStatusClassification',
  'BotInboxMessage',
  'BotInboxDelivery',
  'TenantSetupProgress',
  'ChatConversation',
  'ChatConversationReadState',
];

export const VERIFY_CATALOG_COLUMNS = [
  ['Order', 'clientId'],
  ['Order', 'lifecycleVersion'],
  ['Order', 'deletedAt'],
  ['Order', 'archiveMetadata'],
  ['Client', 'normalizedPhone'],
  ['Client', 'normalizedEmail'],
  ['Invoice', 'emailStatus'],
  ['Invoice', 'sourceOperationKey'],
  ['BotSession', 'seatPolicy'],
  ['SocialAccount', 'displayName'],
  ['SocialAccount', 'tokenStatus'],
  ['SocialAccount', 'wabaId'],
  ['SocialAccount', 'pageId'],
  ['ChatMessage', 'conversationId'],
  ['ChatMessage', 'providerMessageId'],
  ['ChatMessage', 'peerId'],
  ['ChatMessage', 'duplicateOfMessageId'],
  ['ChatMessage', 'createdAt'],
  ['ChatConversation', 'revision'],
  ['ChatConversation', 'peerId'],
  ['ChatConversation', 'inboundCount'],
  ['ChatConversationReadState', 'readInboundCount'],
];
