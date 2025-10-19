/* eslint-disable no-console */
const path = require('path')
const fs = require('fs')
const XLSX = require('xlsx')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

// Normalize header keys: lower, no accents, underscores
function normalizeKey(key) {
	if (!key) return ''
	return key
		.toString()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.replace(/__+/g, '_')
}

// Map common Spanish column names to Order fields (keys must be normalized)
const headerMap = {
	// Identifiers
	'orderid': 'orderId',
	'id_pedido': 'orderId',
	'numero_orden': 'orderId',
	'orden': 'orderId',
	// Types and status
	'tipo': 'orderType',
    'tipo_pedido': 'orderType',
    'ea': 'orderType',
    'ra': 'orderType',
	'estado': 'status',
	'estatus': 'status',
	'entrega': 'delivery',
	// Customer
	'cliente': 'customerName',
	'nombre_cliente': 'customerName',
	'username': 'username',
	'usuario': 'username',
	'telefono': 'phone',
	'phone': 'phone',
    'email': 'email',
    'correo': 'email',
    'nombre': 'customerName',
	'negocio': 'business',
	'empresa': 'business',
	// Product
	'producto': 'product',
	'cantidad': 'quantity',
    'tamano': 'size',
	'color': 'color',
	'empaque': 'packaging',
	'packaging': 'packaging',
	'personalizacion': 'customization',
	'personalizacion_detalle': 'customization',
	'customizacion': 'customization',
	'comentarios': 'comments',
	'comentario': 'comments',
	// Money
	'total': 'total',
	'iva': 'iva',
	'envio': 'shippingCost',
	'costo_envio': 'shippingCost',
	'costo_producto': 'productCost',
	'precio_producto': 'productCost',
	// Funnel and address
	'embudo': 'funnel',
	'funnel': 'funnel',
	'direccion': 'address',
	'provincia': 'province',
	'canton': 'canton',
	'distrito': 'district',
	'mensajeria': 'courier',
	'courier': 'courier',
	// Dates
	'fecha_esperada': 'expectedDate',
    'dia_de_venta': 'saleDate',
    'fecha_venta': 'saleDate',
    'timestamp': 'timestamp',
	'fecha_acordada': 'agreedDate',
	'fecha_retirada': 'pickupDate',
	// Seller
	'vendedor': 'seller',
}

const numericFields = new Set(['quantity', 'total', 'iva', 'shippingCost', 'productCost'])

function excelDateToISO(val) {
	// Accept ISO string directly
	if (!val) return ''
	if (typeof val === 'string') {
		const s = val.trim()
		if (!s) return ''
		const d = new Date(s)
		return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10)
	}
	if (typeof val === 'number') {
		// Excel serial date to JS Date (UTC-ish)
		const ms = Math.round((val - 25569) * 86400 * 1000)
		return new Date(ms).toISOString().slice(0, 10)
	}
	return ''
}

function toNumber(val) {
	if (val === null || val === undefined || val === '') return 0
	const n = Number(String(val).toString().replace(/[^0-9.-]/g, ''))
	return isNaN(n) ? 0 : n
}

function mapRowToOrder(rawRow) {
	const mapped = {}
	for (const [k, v] of Object.entries(rawRow)) {
		const norm = normalizeKey(k)
		const target = headerMap[norm] || norm
		mapped[target] = v
	}
	// Coerce types
	for (const f of numericFields) {
		if (mapped[f] !== undefined) mapped[f] = toNumber(mapped[f])
	}
	mapped.expectedDate = excelDateToISO(mapped.expectedDate)
	mapped.saleDate = excelDateToISO(mapped.saleDate)
	mapped.agreedDate = excelDateToISO(mapped.agreedDate)
	mapped.pickupDate = excelDateToISO(mapped.pickupDate)

    // Defaults / inference
    if (!mapped.orderType) {
        if (mapped.agreedDate || mapped.pickupDate) mapped.orderType = 'RA'
        else mapped.orderType = 'EA'
    }
	if (!mapped.status) mapped.status = 'Pendiente'
	if (!mapped.customerName) mapped.customerName = 'Cliente sin nombre'

	return mapped
}

async function importOrders(xlsxPath) {
	console.log('📥 Reading file:', xlsxPath)
	if (!fs.existsSync(xlsxPath)) throw new Error(`File not found: ${xlsxPath}`)
	const book = XLSX.readFile(xlsxPath)
	const sheetName = book.SheetNames[0]
	const sheet = book.Sheets[sheetName]
	const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
	console.log(`📄 Sheet: ${sheetName} | Rows: ${rows.length}`)

	let created = 0, updated = 0, skipped = 0
	for (const row of rows) {
		try {
			const data = mapRowToOrder(row)
			// Generate orderId if missing
			if (!data.orderId || String(data.orderId).trim().length === 0) {
				const typePrefix = data.orderType || 'EA'
				data.orderId = `${typePrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
			}
            // Parse timestamp if provided in sheet (supports Excel serial or ISO)
            let parsedTimestamp = null
            const tsVal = row['TimeStamp'] || row['timestamp'] || data.timestamp
            if (tsVal !== undefined && tsVal !== '') {
                if (typeof tsVal === 'number') {
                    const ms = Math.round((tsVal - 25569) * 86400 * 1000)
                    parsedTimestamp = new Date(ms)
                } else {
                    const dt = new Date(String(tsVal))
                    if (!isNaN(dt.getTime())) parsedTimestamp = dt
                }
            }

            // Upsert by orderId (unique)
            const res = await prisma.order.upsert({
				where: { orderId: data.orderId },
				update: {
					orderType: data.orderType,
					status: data.status,
					delivery: data.delivery || 'Pendiente',
					customerName: data.customerName,
					username: data.username || '',
					phone: data.phone || '',
					email: data.email || '',
					business: data.business || '',
					product: data.product || '',
					quantity: toNumber(data.quantity || 0),
					size: data.size || '',
					color: data.color || '',
					packaging: data.packaging || '',
					customization: data.customization || '',
					comments: data.comments || '',
					total: toNumber(data.total || 0),
					iva: toNumber(data.iva || 0),
					shippingCost: toNumber(data.shippingCost || 0),
					productCost: toNumber(data.productCost || 0),
					funnel: data.funnel || '',
					address: data.address || '',
					province: data.province || '',
					canton: data.canton || '',
					district: data.district || '',
					courier: data.courier || '',
					expectedDate: data.expectedDate || '',
					saleDate: data.saleDate || '',
					agreedDate: data.agreedDate || '',
					pickupDate: data.pickupDate || '',
                    seller: data.seller || '',
                    timestamp: parsedTimestamp || new Date(),
				},
				create: {
					orderId: data.orderId,
					orderType: data.orderType,
					status: data.status,
					delivery: data.delivery || 'Pendiente',
					customerName: data.customerName,
					username: data.username || '',
					phone: data.phone || '',
					email: data.email || '',
					business: data.business || '',
					product: data.product || '',
					quantity: toNumber(data.quantity || 0),
					size: data.size || '',
					color: data.color || '',
					packaging: data.packaging || '',
					customization: data.customization || '',
					comments: data.comments || '',
					total: toNumber(data.total || 0),
					iva: toNumber(data.iva || 0),
					shippingCost: toNumber(data.shippingCost || 0),
					productCost: toNumber(data.productCost || 0),
					funnel: data.funnel || '',
					address: data.address || '',
					province: data.province || '',
					canton: data.canton || '',
					district: data.district || '',
					courier: data.courier || '',
					expectedDate: data.expectedDate || '',
					saleDate: data.saleDate || '',
					agreedDate: data.agreedDate || '',
					pickupDate: data.pickupDate || '',
                    seller: data.seller || '',
                    timestamp: parsedTimestamp || new Date(),
				},
			})
			if (res) {
				// If record existed (updatedAt not present on model), assume updated when find first by orderId exists
				// Heuristic: if created just now (first loop), count as created when upsert create path
				created++ // Counting all as created simplifies feedback for mass import
			}
		} catch (err) {
			console.error('Row import failed:', err.message)
			skipped++
		}
	}

	console.log(`✅ Import complete. Created: ${created}, Skipped: ${skipped}`)
}

async function main() {
	try {
		const xlsxArg = process.argv[2]
		const defaultPath = path.resolve(__dirname, '..', 'Pedidos.xlsx')
		const xlsxPath = xlsxArg ? path.resolve(process.cwd(), xlsxArg) : defaultPath
		await importOrders(xlsxPath)
	} catch (err) {
		console.error('❌ Import error:', err)
		process.exitCode = 1
	} finally {
		await prisma.$disconnect()
	}
}

main()


