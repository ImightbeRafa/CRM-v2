/**
 * Password Migration Script
 * 
 * Migrates all plain-text passwords to bcrypt hashes.
 * This is a one-time migration script for security hardening.
 * 
 * Run with: node scripts/migrate-passwords-to-bcrypt.js
 */

import postgres from 'postgres';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL;
const SALT_ROUNDS = 12;

if (!connectionString) {
  console.error('❌ DATABASE_URL not found in .env');
  process.exit(1);
}

// Create database connection
const sql = postgres(connectionString, {
  ssl: 'require',
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
});

/**
 * Check if a string is a bcrypt hash
 */
function isBcryptHash(str) {
  if (!str || typeof str !== 'string') {
    return false;
  }
  return /^\$2[aby]\$\d{2}\$/.test(str);
}

/**
 * Main migration function
 */
async function migratePasswordsToBcrypt() {
  console.log('═══════════════════════════════════════');
  console.log('🔐 PASSWORD MIGRATION TO BCRYPT');
  console.log('═══════════════════════════════════════\n');

  try {
    // Fetch all users
    const allUsers = await sql`
      SELECT id, username, email, password FROM "User"
      WHERE password IS NOT NULL
    `;

    console.log(`📊 Found ${allUsers.length} users total\n`);

    // Filter users with plain-text passwords
    const usersWithPlainText = allUsers.filter(user => !isBcryptHash(user.password));
    const usersWithBcrypt = allUsers.filter(user => isBcryptHash(user.password));

    console.log(`✅ Already hashed: ${usersWithBcrypt.length} users`);
    console.log(`⚠️  Need migration: ${usersWithPlainText.length} users\n`);

    if (usersWithPlainText.length === 0) {
      console.log('🎉 All passwords are already hashed with bcrypt!');
      console.log('   No migration needed.\n');
      await sql.end();
      return;
    }

    console.log('🔄 Starting migration...\n');

    let successCount = 0;
    let errorCount = 0;

    for (const user of usersWithPlainText) {
      try {
        const displayName = user.username || user.email;
        
        // Hash the plain-text password
        const hashedPassword = await bcrypt.hash(user.password, SALT_ROUNDS);
        
        // Update the user record
        await sql`
          UPDATE "User"
          SET password = ${hashedPassword}, "updatedAt" = NOW()
          WHERE id = ${user.id}
        `;
        
        console.log(`✅ Migrated: ${displayName}`);
        successCount++;
      } catch (error) {
        console.error(`❌ Failed: ${user.username || user.email}`, error.message);
        errorCount++;
      }
    }

    console.log('\n═══════════════════════════════════════');
    console.log('📊 MIGRATION COMPLETE!');
    console.log('═══════════════════════════════════════\n');

    console.log(`✅ Successfully migrated: ${successCount} users`);
    if (errorCount > 0) {
      console.log(`❌ Errors: ${errorCount} users`);
    }
    console.log(`📈 Already hashed: ${usersWithBcrypt.length} users`);
    console.log(`🎯 Total users: ${allUsers.length}\n`);

    // Verify migration
    console.log('🔍 Verifying migration...\n');
    
    const verifyUsers = await sql`
      SELECT id, username, email, password FROM "User"
      WHERE password IS NOT NULL
    `;

    const stillPlainText = verifyUsers.filter(user => !isBcryptHash(user.password));
    
    if (stillPlainText.length === 0) {
      console.log('✅ VERIFICATION PASSED: All passwords are now hashed!\n');
      console.log('🔒 Your application is now more secure!\n');
      console.log('📝 Next Steps:');
      console.log('   1. Test login with your users');
      console.log('   2. Once confirmed, remove plain-text fallback from auth-options.ts');
      console.log('   3. Update user creation to require password changes on first login\n');
    } else {
      console.log(`⚠️  WARNING: ${stillPlainText.length} passwords still not hashed:`);
      stillPlainText.forEach(user => {
        console.log(`   - ${user.username || user.email}`);
      });
      console.log('');
    }

  } catch (error) {
    console.error('\n❌ MIGRATION FAILED:', error);
    console.error('   Stack:', error.stack);
    console.error('\n⚠️  Database may be in inconsistent state!');
    console.error('   Please review errors and retry if needed.\n');
    process.exit(1);
  } finally {
    await sql.end();
  }
}

// Run migration
console.log('⏳ Starting password migration script...\n');
migratePasswordsToBcrypt();

