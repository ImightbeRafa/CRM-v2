/**
 * Row-locked read-modify-write for chat_agent_layer_v1.
 * Audit stays outside this transaction (P2028).
 */

import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  chatAgentLayerConfigToJson,
  parseChatAgentLayerConfig,
} from '@/lib/soft-ai/agent-config'
import {
  CHAT_AGENT_LAYER_V1_FLAG,
  DEFAULT_CHAT_AGENT_LAYER_CONFIG,
  type ChatAgentLayerConfig,
} from '@/lib/soft-ai/agent-types'

type FlagTx = {
  tenantFeatureFlag: {
    upsert: (args: {
      where: { scope_key: { scope: string; key: string } }
      create: {
        tenantId: string
        scope: string
        key: string
        enabled: boolean
        config: Prisma.InputJsonValue
      }
      update: { tenantId: string }
    }) => Promise<unknown>
    update: (args: {
      where: { scope_key: { scope: string; key: string } }
      data: { config: Prisma.InputJsonValue }
    }) => Promise<unknown>
  }
  $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>
}

export type ChatAgentLayerFlagDb = {
  $transaction: <T>(fn: (tx: FlagTx) => Promise<T>) => Promise<T>
}

export async function mutateChatAgentLayerConfig(
  tenantId: string,
  mutate: (before: ChatAgentLayerConfig) => ChatAgentLayerConfig | Promise<ChatAgentLayerConfig>,
  db?: ChatAgentLayerFlagDb,
): Promise<{ before: ChatAgentLayerConfig; after: ChatAgentLayerConfig }> {
  const client = db ?? (prisma as unknown as ChatAgentLayerFlagDb)
  return client.$transaction(async (tx) => {
    await tx.tenantFeatureFlag.upsert({
      where: {
        scope_key: { scope: tenantId, key: CHAT_AGENT_LAYER_V1_FLAG },
      },
      create: {
        tenantId,
        scope: tenantId,
        key: CHAT_AGENT_LAYER_V1_FLAG,
        enabled: false,
        config: chatAgentLayerConfigToJson(DEFAULT_CHAT_AGENT_LAYER_CONFIG) as Prisma.InputJsonValue,
      },
      update: { tenantId },
    })
    const rows = await tx.$queryRaw<Array<{ config: unknown }>>`
      SELECT config
      FROM "TenantFeatureFlag"
      WHERE scope = ${tenantId} AND key = ${CHAT_AGENT_LAYER_V1_FLAG}
      FOR UPDATE
    `
    const before = parseChatAgentLayerConfig(rows[0]?.config)
    const after = await mutate(before)
    await tx.tenantFeatureFlag.update({
      where: { scope_key: { scope: tenantId, key: CHAT_AGENT_LAYER_V1_FLAG } },
      data: { config: chatAgentLayerConfigToJson(after) as Prisma.InputJsonValue },
    })
    return { before, after }
  })
}
