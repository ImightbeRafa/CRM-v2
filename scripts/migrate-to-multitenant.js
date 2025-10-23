/* eslint-disable no-console */
/**
 * Migration Script: Single-Tenant → Multi-Tenant
 * 
 * This script migrates your existing data to the multi-tenant schema.
 * It creates a default "Legacy" tenant and assigns all existing data to it.
 * 
 * IMPORTANT: Run this AFTER applying the new schema!
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function migrateToMultiTenant() {
  try {
    console.log('🚀 Starting multi-tenant migration...\n')

    // Step 1: Create default tenant for existing data
    console.log('📝 Creating default tenant...')
    const defaultTenant = await prisma.tenant.upsert({
      where: { slug: 'default' },
      update: {},
      create: {
        name: 'Legacy Data',
        slug: 'default',
        plan: 'PRO', // Give them pro for migration
        isActive: true,
        settings: {
          isMigrated: true,
          migratedAt: new Date().toISOString(),
          note: 'This is your original data migrated to multi-tenant structure'
        }
      }
    })

    console.log(`✅ Created tenant: ${defaultTenant.name} (${defaultTenant.id})\n`)

    // Step 2: Get existing user (admin)
    console.log('👤 Checking for existing users...')
    const existingUser = await prisma.user.findFirst()
    
    if (existingUser) {
      console.log(`   Found user: ${existingUser.email || existingUser.username}`)
      
      // Create membership for existing user as OWNER
      const membership = await prisma.membership.upsert({
        where: {
          userId_tenantId: {
            userId: existingUser.id,
            tenantId: defaultTenant.id
          }
        },
        update: {},
        create: {
          userId: existingUser.id,
          tenantId: defaultTenant.id,
          role: 'OWNER',
          isActive: true,
          joinedAt: new Date()
        }
      })
      
      console.log(`✅ Created OWNER membership for user\n`)
    } else {
      console.log('⚠️  No existing users found\n')
    }

    // Step 3: Migrate Orders
    console.log('📦 Migrating orders...')
    const ordersToUpdate = await prisma.order.findMany({
      where: { tenantId: null }
    })
    
    if (ordersToUpdate.length > 0) {
      for (const order of ordersToUpdate) {
        await prisma.order.update({
          where: { id: order.id },
          data: { tenantId: defaultTenant.id }
        })
      }
      console.log(`✅ Migrated ${ordersToUpdate.length} orders\n`)
    } else {
      console.log(`   No orders to migrate\n`)
    }

    // Step 4: Migrate Clients
    console.log('👥 Migrating clients...')
    const clientsToUpdate = await prisma.client.findMany({
      where: { tenantId: null }
    })
    
    if (clientsToUpdate.length > 0) {
      for (const client of clientsToUpdate) {
        await prisma.client.update({
          where: { id: client.id },
          data: { tenantId: defaultTenant.id }
        })
      }
      console.log(`✅ Migrated ${clientsToUpdate.length} clients\n`)
    } else {
      console.log(`   No clients to migrate\n`)
    }

    // Step 5: Migrate other models (sellers, shipping, etc.)
    const migrations = [
      { model: 'seller', name: 'Sellers' },
      { model: 'shippingMethod', name: 'Shipping Methods' },
      { model: 'inventoryItem', name: 'Inventory Items' },
      { model: 'productOptionSet', name: 'Product Option Sets' },
      { model: 'productField', name: 'Product Fields' },
      { model: 'businessInfo', name: 'Business Info' },
      { model: 'orderStatus', name: 'Order Statuses' },
      { model: 'shippingConfig', name: 'Shipping Configs' },
      { model: 'shippingGuia', name: 'Shipping Guias' },
      { model: 'auditLog', name: 'Audit Logs' },
    ]

    for (const { model, name } of migrations) {
      console.log(`🔄 Migrating ${name}...`)
      try {
        const records = await prisma[model].findMany({
          where: { tenantId: null }
        })
        
        if (records.length > 0) {
          for (const record of records) {
            await prisma[model].update({
              where: { id: record.id },
              data: { tenantId: defaultTenant.id }
            })
          }
          console.log(`✅ Migrated ${records.length} ${name.toLowerCase()}\n`)
        } else {
          console.log(`   No ${name.toLowerCase()} to migrate\n`)
        }
      } catch (error) {
        if (error.code === 'P2025') {
          console.log(`   No ${name.toLowerCase()} found\n`)
        } else {
          console.error(`❌ Error migrating ${name}:`, error.message)
        }
      }
    }

    // Final Summary
    console.log('\n' + '='.repeat(60))
    console.log('🎉 MIGRATION COMPLETE!')
    console.log('='.repeat(60))
    console.log('')
    console.log('Summary:')
    console.log(`  Tenant Created: ${defaultTenant.name}`)
    console.log(`  Slug: ${defaultTenant.slug}`)
    console.log(`  Plan: ${defaultTenant.plan}`)
    console.log(`  ID: ${defaultTenant.id}`)
    console.log('')
    console.log('Next Steps:')
    console.log('  1. Verify data in Prisma Studio: npx prisma studio')
    console.log('  2. Test application: npm run dev')
    console.log('  3. Login and verify all data is visible')
    console.log('')
    console.log('⚠️  Save your tenant ID for testing:')
    console.log(`    TENANT_ID="${defaultTenant.id}"`)
    console.log('')

  } catch (error) {
    console.error('\n❌ Migration failed:', error)
    console.error('\nFull error:', error)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

// Run migration
migrateToMultiTenant()

