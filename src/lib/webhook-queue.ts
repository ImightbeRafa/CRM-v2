/**
 * Simple in-memory webhook queue with retry logic
 * 
 * For production, consider using:
 * - BullMQ with Redis for distributed queuing
 * - Vercel Queue for serverless
 * - AWS SQS for cloud-native
 * 
 * This implementation provides basic reliability for webhook processing
 */

interface WebhookJob {
  id: string;
  payload: any;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  lastAttempt?: Date;
  error?: string;
}

class WebhookQueue {
  private queue: Map<string, WebhookJob> = new Map();
  private processing: Set<string> = new Set();
  private readonly MAX_ATTEMPTS = 3;
  private readonly RETRY_DELAYS = [1000, 5000, 15000]; // 1s, 5s, 15s

  /**
   * Add webhook to queue for processing
   */
  async enqueue(payload: any): Promise<string> {
    const jobId = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const job: WebhookJob = {
      id: jobId,
      payload,
      attempts: 0,
      maxAttempts: this.MAX_ATTEMPTS,
      createdAt: new Date()
    };

    this.queue.set(jobId, job);
    console.log(`[WebhookQueue] Enqueued job ${jobId}`);

    // Start processing immediately
    this.processJob(jobId).catch(err => {
      console.error(`[WebhookQueue] Error processing job ${jobId}:`, err);
    });

    return jobId;
  }

  /**
   * Process a webhook job with retry logic
   */
  private async processJob(jobId: string): Promise<void> {
    const job = this.queue.get(jobId);
    if (!job || this.processing.has(jobId)) {
      return;
    }

    this.processing.add(jobId);
    job.attempts++;
    job.lastAttempt = new Date();

    try {
      console.log(`[WebhookQueue] Processing job ${jobId} (attempt ${job.attempts}/${job.maxAttempts})`);

      // Process webhook logic here
      await this.handleWebhook(job.payload);

      // Success - remove from queue
      this.queue.delete(jobId);
      this.processing.delete(jobId);
      console.log(`[WebhookQueue] Job ${jobId} completed successfully`);

    } catch (error: any) {
      job.error = error.message;
      this.processing.delete(jobId);

      if (job.attempts >= job.maxAttempts) {
        // Max attempts reached - log failure and remove
        console.error(`[WebhookQueue] Job ${jobId} failed after ${job.maxAttempts} attempts:`, error);
        this.queue.delete(jobId);
        
        // Store failed webhook in database for manual review
        await this.logFailedWebhook(job);
      } else {
        // Retry with exponential backoff
        const delay = this.RETRY_DELAYS[job.attempts - 1] || this.RETRY_DELAYS[this.RETRY_DELAYS.length - 1];
        console.log(`[WebhookQueue] Job ${jobId} failed, retrying in ${delay}ms`);
        
        setTimeout(() => {
          this.processJob(jobId);
        }, delay);
      }
    }
  }

  /**
   * Handle webhook processing (implement actual logic here)
   */
  private async handleWebhook(payload: any): Promise<void> {
    // This will be implemented by the webhook route
    // For now, throw to allow testing retry logic
    throw new Error('Not implemented - webhook handler should be provided');
  }

  /**
   * Log failed webhook for manual review
   */
  private async logFailedWebhook(job: WebhookJob): Promise<void> {
    try {
      const { prisma } = await import('@/lib/db');
      
      await prisma.webhookLog.create({
        data: {
          tenantId: job.payload.tenantId || 'unknown',
          level: 'error',
          message: `Webhook processing failed after ${job.maxAttempts} attempts`,
          data: JSON.stringify({
            jobId: job.id,
            payload: job.payload,
            error: job.error,
            attempts: job.attempts
          }),
          source: 'tilopay-webhook-queue'
        }
      });
    } catch (err) {
      console.error('[WebhookQueue] Failed to log failed webhook:', err);
    }
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      queued: this.queue.size,
      processing: this.processing.size,
      jobs: Array.from(this.queue.values()).map(job => ({
        id: job.id,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        createdAt: job.createdAt,
        lastAttempt: job.lastAttempt,
        error: job.error
      }))
    };
  }
}

// Singleton instance
export const webhookQueue = new WebhookQueue();
