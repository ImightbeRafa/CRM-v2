import { CorreosAutomation, convertOrderToCorreosFormat, OrderData } from './correosAutomation';
import { getTenantPrisma } from './prisma-tenant';
import { decrypt } from './encryption';
import fs from 'fs';
import path from 'path';

interface GuiaJob {
  id: string;
  tenantId: string;
  orderIds: string[];
  carrier: string;
  deliveryType: 'Domicilio' | 'Sucursal' | 'Punto de correo';
  status: 'queued' | 'processing' | 'completed' | 'failed';
}

class GuiaJobQueue {
  private queue: GuiaJob[] = [];
  private processing = false;

  async addJob(job: Omit<GuiaJob, 'id' | 'status'>): Promise<string> {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newJob: GuiaJob = {
      ...job,
      id: jobId,
      status: 'queued'
    };
    
    this.queue.push(newJob);
    console.log(`✓ Job queued: ${jobId} (${job.orderIds.length} orders)`);
    
    // Start processing if not already processing
    if (!this.processing) {
      this.processQueue();
    }
    
    return jobId;
  }

  private async processQueue() {
    if (this.processing) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const job = this.queue[0];
      
      try {
        console.log(`🔄 Processing job: ${job.id}`);
        job.status = 'processing';
        
        await this.processJob(job);
        
        job.status = 'completed';
        console.log(`✓ Job completed: ${job.id}`);
      } catch (error) {
        job.status = 'failed';
        console.error(`❌ Job failed: ${job.id}`, error);
      }
      
      // Remove from queue
      this.queue.shift();
    }
    
    this.processing = false;
  }

  private async processJob(job: GuiaJob) {
    const prisma = getTenantPrisma(job.tenantId);
    
    // Get shipping config
    const shippingConfig = await prisma.shippingConfig.findFirst({
      where: {
        carrier: job.carrier,
        isActive: true,
        tenantId: job.tenantId
      }
    });

    if (!shippingConfig || !shippingConfig.email || !shippingConfig.password) {
      throw new Error('Shipping configuration not found or incomplete');
    }

    // Get orders
    const orders = await prisma.order.findMany({
      where: {
        orderId: { in: job.orderIds },
        orderType: 'EA',
        tenantId: job.tenantId
      }
    });

    if (orders.length === 0) {
      throw new Error('No valid orders found');
    }

    // Decrypt password
    const decryptedPassword = decrypt(shippingConfig.password);

    // Initialize automation
    const automation = new CorreosAutomation(
      {
        email: shippingConfig.email,
        password: decryptedPassword
      },
      {
        idType: shippingConfig.senderIdType!,
        idNumber: shippingConfig.senderIdNumber!,
        name: shippingConfig.senderName!,
        phone: shippingConfig.senderPhone!,
        email: shippingConfig.senderEmail!,
        province: shippingConfig.senderProvince!,
        canton: shippingConfig.senderCanton!,
        district: shippingConfig.senderDistrict!,
        postalCode: shippingConfig.senderPostalCode!,
        address: shippingConfig.senderAddress!
      }
    );

    // Convert orders to Correos format
    const ordersData = orders.map(order => convertOrderToCorreosFormat(order, job.deliveryType));

    // Process each order
    for (let i = 0; i < ordersData.length; i++) {
      const orderData = ordersData[i];
      const order = orders[i];
      
      // Update progress
      await prisma.shippingGuia.updateMany({
        where: {
          orderId: orderData.orderId,
          tenantId: job.tenantId,
          status: 'queued'
        },
        data: {
          status: 'processing',
          progress: `Creating guía (${i + 1}/${ordersData.length})...`,
          tenantId: job.tenantId
        }
      });

      try {
        // Generate guía (using single method for now)
        const result = await automation.generateGuia(orderData);

        if (result.success && result.guiaNumber) {
          // Update with guía number
          await prisma.shippingGuia.updateMany({
            where: {
              orderId: orderData.orderId,
              tenantId: job.tenantId
            },
            data: {
              guiaNumber: result.guiaNumber,
              trackingNumber: result.trackingNumber,
              progress: 'Downloading PDF...',
              tenantId: job.tenantId
            }
          });

          // Check if PDF was downloaded
          const downloadPath = path.join(process.cwd(), 'downloads');
          const pdfFiles = fs.readdirSync(downloadPath).filter(f => f.endsWith('.pdf'));
          
          // Find the most recently created PDF (should be ours)
          if (pdfFiles.length > 0) {
            const latestPdf = pdfFiles[pdfFiles.length - 1];
            const pdfPath = path.join(downloadPath, latestPdf);
            const pdfData = fs.readFileSync(pdfPath);
            
            // Store PDF in database
            await prisma.shippingGuia.updateMany({
              where: {
                orderId: orderData.orderId,
                tenantId: job.tenantId
              },
              data: {
                status: 'completed',
                progress: 'Completed',
                pdfData: pdfData,
                pdfFileName: `guia-${result.guiaNumber}.pdf`,
                tenantId: job.tenantId
              }
            });

            // Delete PDF from server
            fs.unlinkSync(pdfPath);
          } else {
            // No PDF, but guía was created
            await prisma.shippingGuia.updateMany({
              where: {
                orderId: orderData.orderId,
                tenantId: job.tenantId
              },
              data: {
                status: 'completed',
                progress: 'Guía created (PDF not available)',
                tenantId: job.tenantId
              }
            });
          }

          // Update order status
          await prisma.order.update({
            where: {
              orderId: orderData.orderId,
              tenantId: job.tenantId
            },
            data: {
              status: 'Enviado',
              courier: job.carrier,
              tenantId: job.tenantId
            }
          });
        } else {
          // Failed to create guía
          await prisma.shippingGuia.updateMany({
            where: {
              orderId: orderData.orderId,
              tenantId: job.tenantId
            },
            data: {
              status: 'failed',
              errorMessage: result.error || 'Failed to create guía',
              tenantId: job.tenantId
            }
          });
        }
      } catch (error) {
        // Error processing this order
        await prisma.shippingGuia.updateMany({
          where: {
            orderId: orderData.orderId,
            tenantId: job.tenantId
          },
          data: {
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            tenantId: job.tenantId
          }
        });
      }
    }
  }

  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      jobs: this.queue.map(j => ({
        id: j.id,
        status: j.status,
        orderCount: j.orderIds.length
      }))
    };
  }
}

// Singleton instance
export const guiaJobQueue = new GuiaJobQueue();
