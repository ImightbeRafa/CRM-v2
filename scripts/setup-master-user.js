#!/usr/bin/env node

/**
 * Setup Master User Script for Vercel Deployment
 * This script ensures the master user is created after database migration
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function setupMasterUser() {
  try {
    console.log('🔧 Setting up master user...');
    
    // Get master user credentials from environment variables
    const masterUsername = process.env.MASTER_USERNAME || 'admin';
    const masterPassword = process.env.MASTER_PASSWORD || 'admin123';
    
    console.log(`📝 Master username: ${masterUsername}`);
    
    // Check if master user already exists
    const existingMaster = await prisma.user.findFirst({
      where: { 
        role: 'MASTER',
        active: true
      }
    });
    
    if (existingMaster) {
      console.log('✅ Master user already exists:', existingMaster.username);
      return;
    }
    
    // Hash the master password
    console.log('🔐 Hashing master password...');
    const hashedPassword = await bcrypt.hash(masterPassword, 12);
    
    // Create master user
    console.log('👤 Creating master user...');
    const masterUser = await prisma.user.create({
      data: {
        username: masterUsername,
        password: hashedPassword,
        role: 'MASTER',
        active: true
      }
    });
    
    console.log('✅ Master user created successfully!');
    console.log(`   Username: ${masterUser.username}`);
    console.log(`   Role: ${masterUser.role}`);
    console.log(`   ID: ${masterUser.id}`);
    
  } catch (error) {
    console.error('❌ Error setting up master user:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the setup
setupMasterUser();
