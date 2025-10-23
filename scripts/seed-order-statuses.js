/* eslint-disable no-console */
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function seedOrderStatuses() {
  try {
    console.log('📋 Creating/updating order statuses...')

    const statuses = [
      { key: 'pendiente', label: 'Pendiente', color: '#EAB308', order: 1, isActive: true },
      { key: 'en_proceso', label: 'En Proceso', color: '#3B82F6', order: 2, isActive: true },
      { key: 'produccion', label: 'En Producción', color: '#8B5CF6', order: 3, isActive: true },
      { key: 'listo', label: 'Listo para Enviar', color: '#10B981', order: 4, isActive: true },
      { key: 'enviado', label: 'Enviado', color: '#06B6D4', order: 5, isActive: true },
      { key: 'completado', label: 'Completado', color: '#22C55E', order: 6, isActive: true },
      { key: 'cancelado', label: 'Cancelado', color: '#EF4444', order: 7, isActive: true },
    ]

    for (const status of statuses) {
      await prisma.orderStatus.upsert({
        where: { key: status.key },
        update: {
          label: status.label,
          color: status.color,
          order: status.order,
          isActive: status.isActive,
        },
        create: status,
      })
    }

    console.log('✅ Order statuses created/updated successfully!')
    console.log(`   Total statuses: ${statuses.length}`)

  } catch (error) {
    console.error('❌ Error:', error)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

seedOrderStatuses()

