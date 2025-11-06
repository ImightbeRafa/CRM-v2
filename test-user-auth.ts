// Test script to check user authentication status
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function checkUserAuth(email: string) {
  console.log(`\n🔍 Checking auth status for: ${email}\n`)
  
  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        memberships: {
          include: {
            tenant: {
              select: {
                id: true,
                name: true,
                slug: true,
                plan: true,
                isActive: true,
                subscriptionStatus: true,
                trialEndsAt: true
              }
            }
          }
        }
      }
    })
    
    if (!user) {
      console.log('❌ User not found')
      return
    }
    
    console.log('📧 User Info:')
    console.log(`   ID: ${user.id}`)
    console.log(`   Email: ${user.email}`)
    console.log(`   Name: ${user.name || user.username || 'N/A'}`)
    console.log(`   Active: ${user.active ? '✅' : '❌'}`)
    console.log(`   Email Verified: ${user.emailVerified ? '✅' : '❌'}`)
    console.log(`   Provider: ${user.provider || 'credentials'}`)
    console.log(`   Default Tenant ID: ${user.defaultTenantId || 'none'}`)
    
    console.log(`\n👥 Memberships (${user.memberships.length}):`)
    if (user.memberships.length === 0) {
      console.log('   ⚠️  No memberships found!')
    } else {
      user.memberships.forEach((m, i) => {
        console.log(`\n   Membership #${i + 1}:`)
        console.log(`      ID: ${m.id}`)
        console.log(`      Role: ${m.role}`)
        console.log(`      Active: ${m.isActive ? '✅' : '❌'}`)
        console.log(`      Tenant ID: ${m.tenantId}`)
        console.log(`      Joined: ${m.joinedAt}`)
        if (m.tenant) {
          console.log(`      Tenant Name: ${m.tenant.name}`)
          console.log(`      Tenant Slug: ${m.tenant.slug}`)
          console.log(`      Tenant Plan: ${m.tenant.plan}`)
          console.log(`      Tenant Active: ${m.tenant.isActive ? '✅' : '❌'}`)
        }
      })
    }
    
    // Check active memberships
    const activeMemberships = user.memberships.filter(m => m.isActive)
    console.log(`\n✅ Active Memberships: ${activeMemberships.length}`)
    
    if (activeMemberships.length === 0 && user.memberships.length > 0) {
      console.log('⚠️  User has memberships but none are active!')
      console.log('   This is likely why Google OAuth fails.')
    }
    
    if (user.defaultTenantId && activeMemberships.length === 0) {
      console.log('\n🔧 SUGGESTED FIX:')
      console.log(`   Run this to reactivate membership:`)
      console.log(`   
UPDATE "Membership" 
SET "isActive" = true 
WHERE "userId" = '${user.id}' 
  AND "tenantId" = '${user.defaultTenantId}';
      `)
    }
    
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// Get email from command line or use default
const email = process.argv[2] || 'peterfreud9@gmail.com'
checkUserAuth(email)
