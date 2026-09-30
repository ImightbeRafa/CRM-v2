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
  '025': '025_chat_inbox_uniques.sql',
  '026': '026_chat_automation_jobs.sql',
  '027': '027_chat_agents.sql',
  '027b': '027b_chat_agent_introduction_names.sql',
  '028': '028_chat_agent_knowledge_actions.sql',
  '029': '029_chat_agent_playbooks_assets.sql',
  '030': '030_tenant_invites.sql',
  '031': '031_chat_message_sender_user.sql',
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
  '026': ['ChatAutomationJob', 'ChatAutomationDelivery'],
  '027': ['ChatAgent', 'ChatAgentBinding', 'ChatAgentTurn'],
  '027b': [],
  '028': [
    'ChatKnowledgeSource',
    'ChatAgentKnowledgeSource',
    'ChatAgentSuggestion',
    'ChatAgentPendingAction',
  ],
  '029': ['ChatAgentShortcut', 'ChatAgentAsset', 'ChatAgentShortcutAsset'],
  '030': ['TenantInvite'],
  '031': [],
};

export const EXPECTED_COLUMNS = {
  '031': [['ChatMessage', 'senderUserId']],
  '027b': [['ChatAgent', 'introductionNames']],
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
  '029': [
    ['ChatAgent', 'brandFacts'],
    ['ChatAgent', 'replyStyle'],
    ['ChatAgent', 'activeHours'],
    ['ChatAgent', 'replyDelay'],
    ['ChatAgentTurn', 'outputManifest'],
    ['ChatAgentTurn', 'decisionTrace'],
    ['ChatAgentTurn', 'shortcutKey'],
    ['ChatAgentTurn', 'intent'],
    ['ChatAgentTurn', 'testSessionId'],
    ['ChatAgentSuggestion', 'attachments'],
  ],
  '026': [
    ['ChatMessage', 'mediaBlobPath'],
    ['ChatMessage', 'mediaCacheStatus'],
    ['ChatMessage', 'mediaSizeBytes'],
    ['ChatMessage', 'mediaCachedAt'],
    ['ChatMessage', 'mediaErrorCode'],
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

export const EXPECTED_INDEXES_025 = [
  'ChatMessage_socialAccountId_providerMessageId_uidx',
  'SocialAccount_platform_accountId_active_uidx',
];

export const EXPECTED_INDEXES_026 = [
  'ChatAutomationJob_status_availableAt_createdAt_idx',
  'ChatAutomationJob_tenantId_status_idx',
  'ChatAutomationJob_conversationId_status_createdAt_idx',
  'ChatAutomationDelivery_status_updatedAt_idx',
];

export const EXPECTED_INDEXES_027 = [
  'ChatAgent_tenantId_status_idx',
  'ChatAgentBinding_one_tenant_default_uidx',
  'ChatAgentBinding_one_social_account_uidx',
  'ChatAgentBinding_tenantId_socialAccountId_isActive_idx',
  'ChatAgentBinding_tenantId_agentId_idx',
  'ChatAgentTurn_tenantId_createdAt_idx',
  'ChatAgentTurn_agentId_createdAt_idx',
  'ChatAgentTurn_conversationId_createdAt_idx',
  'ChatAgentTurn_status_createdAt_output_partial_idx',
  'ChatAutomationJob_conversation_single_flight_idx',
];

export const EXPECTED_INDEXES_029 = [
  'InventoryItem_tenantId_id_uidx',
  'ChatAgentShortcut_tenantId_agentId_isActive_idx',
  'ChatAgentAsset_tenantId_status_idx',
  'ChatAgentTurn_tenantId_testSessionId_idx',
];

export const EXPECTED_INDEXES_028 = [
  'ChatKnowledgeSource_tenantId_kind_status_idx',
  'ChatKnowledgeSource_tenantId_socialAccountId_status_idx',
  'ChatKnowledgeSource_status_createdAt_body_partial_idx',
  'ChatAgentKnowledgeSource_tenantId_agentId_priority_idx',
  'ChatAgentKnowledgeSource_tenantId_sourceId_idx',
  'ChatAgentSuggestion_tenantId_conversationId_status_idx',
  'ChatAgentSuggestion_status_expiresAt_idx',
  'ChatAgentSuggestion_status_createdAt_content_partial_idx',
  'ChatAgentPendingAction_tenantId_conversationId_status_idx',
  'ChatAgentPendingAction_status_expiresAt_idx',
];

/** 025 is gated - never part of default apply; verify only when BETSY_V2_REQUIRE_025=1. */
/** 026 Soft AI queue is gated like 025 — never part of DEFAULT_APPLY_FILES. */
/** 027 Soft Agent Layer is gated like 026 — never part of DEFAULT_APPLY_FILES. */
/** 027b introductionNames is gated like 027 — never part of DEFAULT_APPLY_FILES. */
/** 028 Soft Agent knowledge / suggestions / pending actions is gated — never DEFAULT_APPLY_FILES. */
/** 029 playbooks / brand facts / assets is gated — never DEFAULT_APPLY_FILES. Do not apply without CoS. */
/** 030 TenantInvite is gated — never DEFAULT_APPLY_FILES. */
/** 031 ChatMessage.senderUserId is gated — never DEFAULT_APPLY_FILES. */
export const EXPECTED_SEQUENCE_024 = 'ChatConversation_revision_seq';
export const EXPECTED_TRIGGER_024 = 'ChatConversation_revision_trg';

/** Forbidden in 024 - these belong to gated migration 025. */
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
  'ChatAutomationJob',
  'ChatAutomationDelivery',
  'ChatAgent',
  'ChatAgentBinding',
  'ChatAgentTurn',
  'ChatKnowledgeSource',
  'ChatAgentKnowledgeSource',
  'ChatAgentSuggestion',
  'ChatAgentPendingAction',
  'ChatAgentShortcut',
  'ChatAgentAsset',
  'ChatAgentShortcutAsset',
  'TenantInvite',
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
  ['ChatMessage', 'mediaBlobPath'],
  ['ChatMessage', 'mediaCacheStatus'],
  ['ChatMessage', 'senderUserId'],
];
