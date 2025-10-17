import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// POST /api/seed - Seed database with mock data
export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json()
    
    if (action === 'reset') {
      // Reset all data
      await prisma.order.deleteMany()
      await prisma.productOption.deleteMany()
      await prisma.productOptionSet.deleteMany()
      await prisma.productField.deleteMany()
      await prisma.shippingMethod.deleteMany()
      await prisma.seller.deleteMany()
      await prisma.user.deleteMany()
      
      return NextResponse.json({ status: 'success', message: 'Base de datos reseteada' })
    }
    
    if (action === 'populate') {
      // Create master user
      const masterPassword = await bcrypt.hash('master123', 12)
      const masterUser = await prisma.user.upsert({
        where: { username: 'master' },
        update: {},
        create: {
          username: 'master',
          password: masterPassword,
          role: 'MASTER'
        }
      })
      
      // Create regular users
      const regularUsers = []
      for (let i = 1; i <= 3; i++) {
        const password = await bcrypt.hash(`user${i}123`, 12)
        const user = await prisma.user.create({
          data: {
            username: `user${i}`,
            password,
            role: 'REGULAR'
          }
        })
        regularUsers.push(user)
      }
      
      // Create sellers
      const sellers = await Promise.all([
        prisma.seller.create({ data: { name: 'Juan Pérez' } }),
        prisma.seller.create({ data: { name: 'María García' } }),
        prisma.seller.create({ data: { name: 'Carlos López' } }),
        prisma.seller.create({ data: { name: 'Ana Rodríguez' } })
      ])
      
      // Create shipping methods
      const shippingMethods = await Promise.all([
        prisma.shippingMethod.create({ 
          data: { name: 'Envío Estándar', carrier: 'Correos de Costa Rica', basePrice: 0 } 
        }),
        prisma.shippingMethod.create({ 
          data: { name: 'Envío Express', carrier: 'DHL', basePrice: 5000 } 
        }),
        prisma.shippingMethod.create({ 
          data: { name: 'Recogida en Tienda', basePrice: 0 } 
        })
      ])
      
      // Create option sets
      const colorSet = await prisma.productOptionSet.create({
        data: {
          key: 'colores',
          name: 'Colores Disponibles'
        }
      })
      
      const sizeSet = await prisma.productOptionSet.create({
        data: {
          key: 'tamaños',
          name: 'Tamaños'
        }
      })
      
      const materialSet = await prisma.productOptionSet.create({
        data: {
          key: 'materiales',
          name: 'Materiales'
        }
      })
      
      // Create options for color set
      await Promise.all([
        prisma.productOption.create({ data: { setId: colorSet.id, label: 'Rojo', value: 'red', priceDelta: 0 } }),
        prisma.productOption.create({ data: { setId: colorSet.id, label: 'Azul', value: 'blue', priceDelta: 0 } }),
        prisma.productOption.create({ data: { setId: colorSet.id, label: 'Verde', value: 'green', priceDelta: 0 } }),
        prisma.productOption.create({ data: { setId: colorSet.id, label: 'Negro', value: 'black', priceDelta: 0 } }),
        prisma.productOption.create({ data: { setId: colorSet.id, label: 'Blanco', value: 'white', priceDelta: 0 } }),
        prisma.productOption.create({ data: { setId: colorSet.id, label: 'Dorado', value: 'gold', priceDelta: 2000 } })
      ])
      
      // Create options for size set
      await Promise.all([
        prisma.productOption.create({ data: { setId: sizeSet.id, label: 'Pequeño', value: 'small', priceDelta: 0 } }),
        prisma.productOption.create({ data: { setId: sizeSet.id, label: 'Mediano', value: 'medium', priceDelta: 1000 } }),
        prisma.productOption.create({ data: { setId: sizeSet.id, label: 'Grande', value: 'large', priceDelta: 2000 } }),
        prisma.productOption.create({ data: { setId: sizeSet.id, label: 'Extra Grande', value: 'xl', priceDelta: 3000 } })
      ])
      
      // Create options for material set
      await Promise.all([
        prisma.productOption.create({ data: { setId: materialSet.id, label: 'Algodón', value: 'cotton', priceDelta: 0 } }),
        prisma.productOption.create({ data: { setId: materialSet.id, label: 'Poliester', value: 'polyester', priceDelta: 500 } }),
        prisma.productOption.create({ data: { setId: materialSet.id, label: 'Lino', value: 'linen', priceDelta: 1500 } }),
        prisma.productOption.create({ data: { setId: materialSet.id, label: 'Seda', value: 'silk', priceDelta: 5000 } })
      ])
      
      // Create product fields
      await Promise.all([
        prisma.productField.create({
          data: {
            key: 'nombre_producto',
            label: 'Nombre del Producto',
            type: 'text',
            required: true,
            order: 0
          }
        }),
        prisma.productField.create({
          data: {
            key: 'color',
            label: 'Color',
            type: 'select',
            required: true,
            order: 1,
            optionSetId: colorSet.id
          }
        }),
        prisma.productField.create({
          data: {
            key: 'tamaño',
            label: 'Tamaño',
            type: 'select',
            required: true,
            order: 2,
            optionSetId: sizeSet.id
          }
        }),
        prisma.productField.create({
          data: {
            key: 'material',
            label: 'Material',
            type: 'select',
            required: false,
            order: 3,
            optionSetId: materialSet.id
          }
        }),
        prisma.productField.create({
          data: {
            key: 'cantidad',
            label: 'Cantidad',
            type: 'number',
            required: true,
            order: 4
          }
        }),
        prisma.productField.create({
          data: {
            key: 'personalizado',
            label: '¿Es personalizado?',
            type: 'boolean',
            required: false,
            order: 5
          }
        }),
        prisma.productField.create({
          data: {
            key: 'comentarios',
            label: 'Comentarios Adicionales',
            type: 'text',
            required: false,
            order: 6
          }
        })
      ])
      
      // Create comprehensive sample orders with realistic business scenarios
      const sampleOrders = [
        // Completed EA Orders
        {
          orderId: 'EA-2024-001',
          orderType: 'EA',
          status: 'Completado',
          delivery: 'Entregado',
          customerName: 'Roberto Jiménez',
          username: 'roberto.jimenez',
          phone: '8888-1234',
          email: 'roberto@email.com',
          business: 'Tienda El Sol',
          product: 'Camisetas Personalizadas',
          quantity: 25,
          size: 'Mediano',
          color: 'Azul',
          packaging: 'Bolsa individual',
          customization: 'Logo empresa + nombre empleado',
          comments: 'Entrega urgente para evento corporativo',
          total: 125000,
          iva: 12500,
          shippingCost: 0,
          productCost: 100000,
          funnel: 'Facebook Ads',
          expectedDate: '2024-01-15',
          saleDate: '2024-01-10',
          courier: 'Correos de Costa Rica',
          seller: 'Juan Pérez',
          province: 'San José',
          canton: 'San José',
          district: 'Carmen',
          address: 'Av. Central, 100m este del Banco Nacional'
        },
        {
          orderId: 'EA-2024-002',
          orderType: 'EA',
          status: 'Completado',
          delivery: 'Entregado',
          customerName: 'Ana Rodríguez',
          username: 'ana.rodriguez',
          phone: '8888-2345',
          email: 'ana@restaurant.com',
          business: 'Restaurante La Luna',
          product: 'Delantales de Cocina',
          quantity: 12,
          size: 'Grande',
          color: 'Negro',
          packaging: 'Caja gruesa',
          customization: 'Nombre del restaurante bordado',
          comments: 'Material resistente al calor',
          total: 48000,
          iva: 4800,
          shippingCost: 5000,
          productCost: 38000,
          funnel: 'Referido',
          expectedDate: '2024-01-20',
          saleDate: '2024-01-15',
          courier: 'DHL',
          seller: 'María García',
          province: 'Cartago',
          canton: 'Cartago',
          district: 'Oriental',
          address: 'Calle 2, 50m norte del Parque Central'
        },
        {
          orderId: 'EA-2024-003',
          orderType: 'EA',
          status: 'Completado',
          delivery: 'Entregado',
          customerName: 'Carlos Mendoza',
          username: 'carlos.mendoza',
          phone: '8888-3456',
          email: 'carlos@gym.com',
          business: 'Gimnasio Power',
          product: 'Uniformes Deportivos',
          quantity: 20,
          size: 'Extra Grande',
          color: 'Rojo',
          packaging: 'Bolsa individual',
          customization: 'Logo del gimnasio + número',
          comments: 'Material transpirable y resistente',
          total: 100000,
          iva: 10000,
          shippingCost: 0,
          productCost: 80000,
          funnel: 'Instagram',
          expectedDate: '2024-01-25',
          saleDate: '2024-01-20',
          courier: 'Correos de Costa Rica',
          seller: 'Carlos López',
          province: 'Alajuela',
          canton: 'Alajuela',
          district: 'Central',
          address: 'Calle 1, 200m oeste del Mercado Central'
        },
        // In Process EA Orders
        {
          orderId: 'EA-2024-004',
          orderType: 'EA',
          status: 'En Proceso',
          delivery: 'En Proceso',
          customerName: 'Laura González',
          username: 'laura.gonzalez',
          phone: '8888-4567',
          email: 'laura@school.edu',
          business: 'Escuela San José',
          product: 'Uniformes Escolares',
          quantity: 50,
          size: 'Mediano',
          color: 'Azul',
          packaging: 'Caja gruesa',
          customization: 'Escudo de la escuela',
          comments: 'Urgente para inicio de clases',
          total: 200000,
          iva: 20000,
          shippingCost: 10000,
          productCost: 160000,
          funnel: 'Directo',
          expectedDate: '2024-02-05',
          saleDate: '2024-01-25',
          courier: 'DHL',
          seller: 'Ana Rodríguez',
          province: 'Heredia',
          canton: 'Heredia',
          district: 'Mercedes',
          address: 'Calle 3, frente al parque'
        },
        {
          orderId: 'EA-2024-005',
          orderType: 'EA',
          status: 'En Proceso',
          delivery: 'En Proceso',
          customerName: 'Miguel Torres',
          username: 'miguel.torres',
          phone: '8888-5678',
          email: 'miguel@hotel.com',
          business: 'Hotel Paradise',
          product: 'Ropa de Cama Personalizada',
          quantity: 30,
          size: 'Grande',
          color: 'Blanco',
          packaging: 'Caja gruesa',
          customization: 'Logo del hotel',
          comments: 'Material de alta calidad',
          total: 150000,
          iva: 15000,
          shippingCost: 8000,
          productCost: 120000,
          funnel: 'Google Ads',
          expectedDate: '2024-02-10',
          saleDate: '2024-01-28',
          courier: 'Correos de Costa Rica',
          seller: 'Juan Pérez',
          province: 'Puntarenas',
          canton: 'Puntarenas',
          district: 'Puntarenas',
          address: 'Playa Jacó, 100m de la playa'
        },
        // Pending EA Orders
        {
          orderId: 'EA-2024-006',
          orderType: 'EA',
          status: 'Pendiente',
          delivery: 'Pendiente',
          customerName: 'Sofia Herrera',
          username: 'sofia.herrera',
          phone: '8888-6789',
          email: 'sofia@clinic.com',
          business: 'Clínica Dental Sonrisa',
          product: 'Batas Médicas',
          quantity: 15,
          size: 'Mediano',
          color: 'Blanco',
          packaging: 'Bolsa individual',
          customization: 'Nombre del doctor',
          comments: 'Material fácil de lavar',
          total: 75000,
          iva: 7500,
          shippingCost: 3000,
          productCost: 60000,
          funnel: 'WhatsApp',
          expectedDate: '2024-02-15',
          saleDate: '2024-02-01',
          courier: 'DHL',
          seller: 'María García',
          province: 'San José',
          canton: 'Escazú',
          district: 'Escazú',
          address: 'Centro Comercial Multiplaza'
        },
        // RA Orders
        {
          orderId: 'RA-2024-001',
          orderType: 'RA',
          status: 'En Proceso',
          delivery: 'Pendiente',
          customerName: 'Pedro Vargas',
          username: 'pedro.vargas',
          phone: '8888-7890',
          email: 'pedro@bar.com',
          business: 'Bar El Refugio',
          product: 'Delantales de Bar',
          quantity: 8,
          size: 'Grande',
          color: 'Negro',
          packaging: 'Caja gruesa',
          customization: 'Logo del bar',
          comments: 'Material resistente a manchas',
          total: 40000,
          iva: 4000,
          shippingCost: 2000,
          productCost: 32000,
          funnel: 'Referido',
          agreedDate: '2024-02-20',
          pickupDate: '2024-02-25',
          seller: 'Carlos López',
          province: 'San José',
          canton: 'San José',
          district: 'Catedral',
          address: 'Barrio Amón, calle 5'
        },
        {
          orderId: 'RA-2024-002',
          orderType: 'RA',
          status: 'Pendiente',
          delivery: 'Pendiente',
          customerName: 'Isabel Morales',
          username: 'isabel.morales',
          phone: '8888-8901',
          email: 'isabel@spa.com',
          business: 'Spa Relax',
          product: 'Batas de Spa',
          quantity: 10,
          size: 'Mediano',
          color: 'Rosa',
          packaging: 'Bolsa individual',
          customization: 'Logo del spa',
          comments: 'Material suave y cómodo',
          total: 50000,
          iva: 5000,
          shippingCost: 0,
          productCost: 40000,
          funnel: 'Facebook',
          agreedDate: '2024-02-28',
          pickupDate: '2024-03-05',
          seller: 'Ana Rodríguez',
          province: 'Cartago',
          canton: 'Cartago',
          district: 'Occidental',
          address: 'Centro de Cartago, calle 1'
        }
      ]
      
      await prisma.order.createMany({
        data: sampleOrders
      })
      
      return NextResponse.json({ 
        status: 'success', 
        message: 'Datos de ventas de prueba creados exitosamente',
        data: {
          users: 4, // 1 master + 3 regular
          sellers: sellers.length,
          shippingMethods: shippingMethods.length,
          optionSets: 3,
          productFields: 7,
          orders: sampleOrders.length,
          totalValue: sampleOrders.reduce((sum, order) => sum + order.total, 0),
          completedOrders: sampleOrders.filter(o => o.status === 'Completado').length,
          inProcessOrders: sampleOrders.filter(o => o.status === 'En Proceso').length,
          pendingOrders: sampleOrders.filter(o => o.status === 'Pendiente').length
        }
      })
    }
    
    return NextResponse.json({ status: 'error', error: 'Acción no válida' }, { status: 400 })
  } catch (error) {
    console.error('Error seeding database:', error)
    return NextResponse.json({ status: 'error', error: 'Error al poblar la base de datos' }, { status: 500 })
  }
}
