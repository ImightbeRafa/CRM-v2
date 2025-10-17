// Quick script to seed test data
// Run with: node scripts/seed-test-data.js

async function seedData() {
  console.log('🌱 Seeding test data...')
  
  try {
    const response = await fetch('http://localhost:3000/api/seed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'populate' })
    })
    
    const result = await response.json()
    
    if (result.status === 'success') {
      console.log('✅ Sales test data seeded successfully!')
      console.log('\n📊 Created:')
      console.log(`   - ${result.data.users} users`)
      console.log(`   - ${result.data.sellers} sellers`)
      console.log(`   - ${result.data.shippingMethods} shipping methods`)
      console.log(`   - ${result.data.optionSets} option sets`)
      console.log(`   - ${result.data.productFields} product fields`)
      console.log(`   - ${result.data.orders} sample orders`)
      console.log('\n💰 Sales Summary:')
      console.log(`   - Total Value: ₡${result.data.totalValue?.toLocaleString() || 'N/A'}`)
      console.log(`   - Completed: ${result.data.completedOrders} orders`)
      console.log(`   - In Process: ${result.data.inProcessOrders} orders`)
      console.log(`   - Pending: ${result.data.pendingOrders} orders`)
      console.log('\n🔑 Test Accounts:')
      console.log('   Master: master / master123')
      console.log('   User 1: user1 / user1123')
      console.log('   User 2: user2 / user2123')
      console.log('   User 3: user3 / user3123')
      console.log('\n🎯 What you can test:')
      console.log('   - View orders in /produccion')
      console.log('   - Check statistics in /estadisticas')
      console.log('   - Create new sales in /ventas')
      console.log('   - Manage users in /config?tab=users')
    } else {
      console.error('❌ Error:', result.error)
    }
  } catch (error) {
    console.error('❌ Failed to seed data:', error.message)
    console.log('\n💡 Make sure the dev server is running: npm run dev')
  }
}

async function resetData() {
  console.log('🗑️  Resetting all data...')
  
  try {
    const response = await fetch('http://localhost:3000/api/seed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'reset' })
    })
    
    const result = await response.json()
    
    if (result.status === 'success') {
      console.log('✅ All data reset successfully!')
    } else {
      console.error('❌ Error:', result.error)
    }
  } catch (error) {
    console.error('❌ Failed to reset data:', error.message)
    console.log('\n💡 Make sure the dev server is running: npm run dev')
  }
}

// Check command line argument
const action = process.argv[2]

if (action === 'reset') {
  resetData()
} else if (action === 'populate' || !action) {
  seedData()
} else {
  console.log('Usage:')
  console.log('  node scripts/seed-test-data.js          # Populate test data')
  console.log('  node scripts/seed-test-data.js populate # Populate test data')
  console.log('  node scripts/seed-test-data.js reset    # Reset all data')
}

