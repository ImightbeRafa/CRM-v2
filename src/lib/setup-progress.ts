import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export const SETUP_STEP_IDS = [
  'welcome-business',
  'order-status',
  'shipping-correos',
  'first-product',
  'completion',
] as const;

export type SetupStepId = typeof SETUP_STEP_IDS[number];
export type SetupProgressAction = 'visit' | 'complete' | 'skip' | 'dismiss' | 'finish' | 'restart';

const OPTIONAL_STEPS = new Set<SetupStepId>(['shipping-correos', 'first-product']);
const SAFE_RETURN_PREFIXES = ['/dashboard', '/ventas', '/produccion', '/estadisticas', '/config', '/setup-wizard'];

export interface SetupProgressView {
  currentStep: SetupStepId;
  completedSteps: SetupStepId[];
  skippedSteps: SetupStepId[];
  status: 'in_progress' | 'dismissed' | 'completed';
  dismissedAt: string | null;
  completedAt: string | null;
  revision: number;
}

export class SetupProgressError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = 'SetupProgressError';
  }
}

export function isSetupStepId(value: unknown): value is SetupStepId {
  return typeof value === 'string' && (SETUP_STEP_IDS as readonly string[]).includes(value);
}

function stepList(value: unknown): SetupStepId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isSetupStepId))];
}

export function safeSetupReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return '/dashboard'; }
  if (decoded.startsWith('//') || decoded.includes('://') || decoded.startsWith('/logistics')) return '/dashboard';
  return SAFE_RETURN_PREFIXES.some(prefix => decoded === prefix || decoded.startsWith(`${prefix}?`))
    ? decoded
    : '/dashboard';
}

export function firstIncompleteSetupStep(completed: SetupStepId[], skipped: SetupStepId[]): SetupStepId {
  const resolved = new Set([...completed, ...skipped]);
  return SETUP_STEP_IDS.find(step => step !== 'completion' && !resolved.has(step)) || 'completion';
}

function serialize(row: {
  currentStep: string | null;
  completedSteps: Prisma.JsonValue;
  skippedSteps: Prisma.JsonValue;
  status: string;
  dismissedAt: Date | null;
  completedAt: Date | null;
  revision: number;
} | null): SetupProgressView {
  const completedSteps = stepList(row?.completedSteps);
  const skippedSteps = stepList(row?.skippedSteps).filter(step => !completedSteps.includes(step));
  const currentStep = isSetupStepId(row?.currentStep)
    ? row.currentStep
    : firstIncompleteSetupStep(completedSteps, skippedSteps);
  const status = row?.status === 'completed' || row?.status === 'dismissed' ? row.status : 'in_progress';
  return {
    currentStep,
    completedSteps,
    skippedSteps,
    status,
    dismissedAt: row?.dismissedAt?.toISOString() || null,
    completedAt: row?.completedAt?.toISOString() || null,
    revision: row?.revision || 0,
  };
}

export async function readSetupProgress(tenantId: string) {
  return serialize(await prisma.tenantSetupProgress.findUnique({ where: { tenantId } }));
}

export async function mutateSetupProgress(input: {
  tenantId: string;
  action: SetupProgressAction;
  step?: unknown;
  expectedRevision?: unknown;
}) {
  const step = input.step === undefined ? undefined : (isSetupStepId(input.step) ? input.step : null);
  if (input.step !== undefined && !step) {
    throw new SetupProgressError('INVALID_SETUP_STEP', 'Unknown setup step', 400);
  }
  if (input.action === 'skip' && (!step || !OPTIONAL_STEPS.has(step))) {
    throw new SetupProgressError('SETUP_STEP_NOT_SKIPPABLE', 'This setup step cannot be skipped', 400);
  }
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new SetupProgressError('SETUP_REVISION_REQUIRED', 'expectedRevision is required', 400);
  }

  return prisma.$transaction(async tx => {
    const existing = await tx.tenantSetupProgress.findUnique({ where: { tenantId: input.tenantId } });
    const current = serialize(existing);
    if (current.revision !== expectedRevision) {
      throw new SetupProgressError('STALE_SETUP_PROGRESS', 'Setup progress changed in another tab', 409);
    }

    const now = new Date();
    let completedSteps = [...current.completedSteps];
    let skippedSteps = [...current.skippedSteps];
    let currentStep = current.currentStep;
    let status: SetupProgressView['status'] = current.status;
    let dismissedAt = existing?.dismissedAt || null;
    let completedAt = existing?.completedAt || null;

    if (input.action === 'restart') {
      completedSteps = [];
      skippedSteps = [];
      currentStep = 'welcome-business';
      status = 'in_progress';
      dismissedAt = null;
      completedAt = null;
    } else if (input.action === 'dismiss') {
      status = 'dismissed';
      dismissedAt = now;
    } else if (input.action === 'finish') {
      completedSteps = [...new Set([...completedSteps, 'completion' as SetupStepId])];
      currentStep = 'completion';
      status = 'completed';
      dismissedAt = null;
      completedAt = now;
    } else if (step) {
      currentStep = step;
      status = 'in_progress';
      dismissedAt = null;
      if (input.action === 'complete') {
        completedSteps = [...new Set([...completedSteps, step])];
        skippedSteps = skippedSteps.filter(value => value !== step);
      } else if (input.action === 'skip') {
        skippedSteps = [...new Set([...skippedSteps, step])];
        completedSteps = completedSteps.filter(value => value !== step);
        currentStep = firstIncompleteSetupStep(completedSteps, skippedSteps);
      }
    }

    const nextRevision = current.revision + 1;
    const data = {
      currentStep,
      completedSteps,
      skippedSteps,
      status,
      dismissedAt,
      completedAt,
      revision: nextRevision,
    };

    if (!existing) {
      try {
        return serialize(await tx.tenantSetupProgress.create({ data: { tenantId: input.tenantId, ...data } }));
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new SetupProgressError('STALE_SETUP_PROGRESS', 'Setup progress changed in another tab', 409);
        }
        throw error;
      }
    }

    const changed = await tx.tenantSetupProgress.updateMany({
      where: { tenantId: input.tenantId, revision: current.revision },
      data,
    });
    if (changed.count !== 1) {
      throw new SetupProgressError('STALE_SETUP_PROGRESS', 'Setup progress changed in another tab', 409);
    }
    return serialize(await tx.tenantSetupProgress.findUnique({ where: { tenantId: input.tenantId } }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
