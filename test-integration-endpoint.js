/**
 * Integration Endpoint Test Script
 * 
 * This script tests the /api/integration/orders/create endpoint
 * to ensure it's working correctly before connecting real websites.
 * 
 * Usage:
 * 1. First, create an API key in the dashboard at /config/integrations
 * 2. Replace YOUR_API_KEY_HERE with your actual API key
 * 3. Run: node test-integration-endpoint.js
 */

const API_KEY = 'bts_fE4OvsQwkKFf3emKPNGSDSSs2b1zzhH9RnplCu2E4axXMcnX6900f1Eq6Pqn'; // Replace with your actual API key
const API_URL = 'http://localhost:3000/api/integration/orders/create';

// Sample order data matching the expected structure
const sampleOrder = {
  orderId: `TEST-${Date.now()}`, // Unique order ID
  customer: {
    name: 'José Luis Rodríguez-Martínez O\'Brien',
    phone: '+506 2222-3333',
    email: 'jose.rodriguez+test@gmail.com',
  },
  product: {
    name: 'Kit Especial "Deluxe" 3-en-1 (Edición Limitada)',
    quantity: 5,
    unitPrice: '₡7.999,99',
  },
  shipping: {
    cost: 'GRATIS',
    address: {
      province: 'Cartago',
      canton: 'La Unión',
      district: 'Tres Ríos',
      fullAddress: 'Del Mall San Pedro, 200m este, 50m norte, edificio azul, apartamento 3B',
    },
  },
  total: '₡39.999,95',
  payment: {
    method: 'Transferencia Bancaria',
    transactionId: `BANK-TRANSFER-${Date.now()}`,
    status: 'PENDIENTE',
    date: new Date().toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' }),
  },
  source: 'Mi Tienda Online - Checkout v3.2',
  metadata: {
    testRun: true,
    timestamp: new Date().toISOString(),
    version: 3,
    specialChars: 'Testing: áéíóú ñ "quotes" \'apostrophes\' & symbols!',
    campaign: 'Black Friday 2024',
  },
};

async function testIntegrationEndpoint() {
  console.log('🧪 Testing Betsy Integration Endpoint\n');
  console.log('📍 Endpoint:', API_URL);
  console.log('🔑 API Key:', API_KEY.substring(0, 10) + '...\n');

  if (API_KEY === 'YOUR_API_KEY_HERE') {
    console.error('❌ ERROR: Please replace YOUR_API_KEY_HERE with your actual API key');
    console.log('\n📝 Steps to get an API key:');
    console.log('   1. Go to http://localhost:3000/config/integrations');
    console.log('   2. Click "Nueva API Key"');
    console.log('   3. Copy the generated key');
    console.log('   4. Replace YOUR_API_KEY_HERE in this script\n');
    process.exit(1);
  }

  console.log('📦 Sending test order data...\n');
  console.log('Order Details:');
  console.log('  - Order ID:', sampleOrder.orderId);
  console.log('  - Customer:', sampleOrder.customer.name);
  console.log('  - Product:', sampleOrder.product.name);
  console.log('  - Total:', sampleOrder.total);
  console.log('  - Location:', `${sampleOrder.shipping.address.province}, ${sampleOrder.shipping.address.canton}\n`);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify(sampleOrder),
    });

    const result = await response.json();

    console.log('📊 Response Status:', response.status, response.statusText);
    console.log('📄 Response Body:', JSON.stringify(result, null, 2));

    if (response.ok) {
      console.log('\n✅ SUCCESS! Order created in Betsy CRM');
      console.log('   - CRM Order ID:', result.crmOrderId);
      console.log('   - External Order ID:', result.orderId);
      console.log('\n🎉 Integration endpoint is working correctly!');
      console.log('📍 Check your orders at: http://localhost:3000/produccion');
    } else {
      console.log('\n❌ FAILED! Order was not created');
      console.log('   Error:', result.error);
      
      if (result.details) {
        console.log('   Validation errors:', JSON.stringify(result.details, null, 2));
      }

      if (response.status === 401) {
        console.log('\n💡 Tip: Check that your API key is correct and active');
      } else if (response.status === 400) {
        console.log('\n💡 Tip: Check the data format matches the expected structure');
      } else if (response.status === 409) {
        console.log('\n💡 Tip: This order ID already exists. Try running the script again (it generates a new ID)');
      }
    }
  } catch (error) {
    console.log('\n❌ ERROR: Failed to connect to the API');
    console.log('   Message:', error.message);
    console.log('\n💡 Troubleshooting:');
    console.log('   - Make sure the dev server is running (npm run dev)');
    console.log('   - Check that the API URL is correct:', API_URL);
    console.log('   - Verify your network connection');
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

// Run the test
testIntegrationEndpoint().catch(console.error);
