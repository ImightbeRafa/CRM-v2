import { exec } from 'child_process';
import { promisify } from 'util';
import { list } from '@vercel/blob';
import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const execAsync = promisify(exec);
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL not found in .env');
  process.exit(1);
}

const sql = postgres(connectionString, {
  ssl: 'require',
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
});

// Function to list available backups
async function listAvailableBackups() {
  console.log('📋 Fetching available backups...\n');
  
  try {
    const { blobs } = await list({
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    
    const backups = blobs
      .filter(blob => blob.name.startsWith('daily-backup-'))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    console.log('📊 AVAILABLE BACKUPS:');
    console.log('═══════════════════════════════════════');
    
    if (backups.length === 0) {
      console.log('❌ No backups found');
      return [];
    }
    
    backups.forEach((backup, index) => {
      const date = new Date(backup.createdAt).toLocaleDateString();
      const time = new Date(backup.createdAt).toLocaleTimeString();
      const size = (backup.size / 1024 / 1024).toFixed(2);
      
      console.log(`${index + 1}. ${backup.name}`);
      console.log(`   📅 Date: ${date} ${time}`);
      console.log(`   📊 Size: ${size} MB`);
      console.log(`   🔗 URL: ${backup.url}`);
      console.log('');
    });
    
    return backups;
  } catch (error) {
    console.error('❌ Error listing backups:', error);
    throw error;
  }
}

// Function to download backup from Vercel Blob
async function downloadBackup(backupUrl) {
  console.log('⬇️ Downloading backup...');
  
  try {
    const response = await fetch(backupUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const backupData = await response.text();
    console.log(`✅ Backup downloaded: ${(backupData.length / 1024 / 1024).toFixed(2)} MB`);
    
    return backupData;
  } catch (error) {
    console.error('❌ Error downloading backup:', error);
    throw error;
  }
}

// Function to restore database from backup
async function restoreDatabase(backupData) {
  console.log('🔄 Restoring database...');
  
  try {
    // Create temporary file for the backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tempFile = `/tmp/restore-${timestamp}.sql`;
    
    // Write backup data to temporary file
    await fs.writeFile(tempFile, backupData);
    
    console.log('📝 Backup written to temporary file');
    
    // Restore using psql
    const restoreCommand = `psql "${connectionString}" -f "${tempFile}"`;
    
    console.log('🔄 Executing database restore...');
    const { stdout, stderr } = await execAsync(restoreCommand);
    
    if (stderr && !stderr.includes('WARNING')) {
      console.error('⚠️ Restore warnings:', stderr);
    }
    
    console.log('✅ Database restored successfully');
    
    // Clean up temporary file
    try {
      await fs.unlink(tempFile);
      console.log('🧹 Temporary file cleaned up');
    } catch (error) {
      console.log('⚠️ Could not delete temporary file:', error.message);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error restoring database:', error);
    throw error;
  }
}

// Function to verify restore integrity
async function verifyRestore() {
  console.log('🔍 Verifying restore integrity...');
  
  try {
    // Check if key tables exist and have data
    const tables = ['User', 'Tenant', 'Membership', 'Order', 'Client'];
    const results = {};
    
    for (const table of tables) {
      try {
        const result = await sql`SELECT COUNT(*) as count FROM "${table}"`;
        results[table] = result[0].count;
        console.log(`✅ ${table}: ${result[0].count} records`);
      } catch (error) {
        console.log(`❌ ${table}: Table not found or error`);
        results[table] = 0;
      }
    }
    
    const totalRecords = Object.values(results).reduce((sum, count) => sum + count, 0);
    
    if (totalRecords > 0) {
      console.log(`✅ Restore verification passed: ${totalRecords} total records`);
      return true;
    } else {
      console.log('❌ Restore verification failed: No data found');
      return false;
    }
  } catch (error) {
    console.error('❌ Error verifying restore:', error);
    return false;
  }
}

// Interactive restore function
async function interactiveRestore() {
  console.log('⏳ Starting interactive restore process...\n');
  
  try {
    console.log('═══════════════════════════════════════');
    console.log('🔄 DATABASE RESTORE PROCESS');
    console.log('═══════════════════════════════════════\n');
    
    // Step 1: List available backups
    const backups = await listAvailableBackups();
    
    if (backups.length === 0) {
      console.log('❌ No backups available for restore');
      return;
    }
    
    // Step 2: Select backup (use latest by default)
    const selectedBackup = backups[0];
    console.log(`🎯 Selected backup: ${selectedBackup.name}`);
    console.log(`📅 Created: ${new Date(selectedBackup.createdAt).toLocaleString()}`);
    console.log(`📊 Size: ${(selectedBackup.size / 1024 / 1024).toFixed(2)} MB\n`);
    
    // Step 3: Download backup
    const backupData = await downloadBackup(selectedBackup.url);
    
    // Step 4: Confirm restore
    console.log('⚠️  WARNING: This will completely replace your current database!');
    console.log('⚠️  Make sure you have a current backup before proceeding.\n');
    
    // Step 5: Restore database
    await restoreDatabase(backupData);
    
    // Step 6: Verify restore
    const isValid = await verifyRestore();
    
    if (!isValid) {
      throw new Error('Restore verification failed');
    }
    
    console.log('\n═══════════════════════════════════════');
    console.log('🎉 RESTORE COMPLETE!');
    console.log('═══════════════════════════════════════\n');
    console.log(`✅ Database restored from: ${selectedBackup.name}`);
    console.log(`📅 Backup date: ${new Date(selectedBackup.createdAt).toLocaleString()}`);
    console.log(`⏰ Restored: ${new Date().toISOString()}\n`);
    
    return {
      success: true,
      backupName: selectedBackup.name,
      backupDate: selectedBackup.createdAt,
      restoredAt: new Date().toISOString(),
    };
    
  } catch (error) {
    console.error('\n❌ RESTORE FAILED!');
    console.error('═══════════════════════════════════════');
    console.error(`Error: ${error.message}`);
    console.error('\n🔧 Troubleshooting:');
    console.error('   1. Check DATABASE_URL is correct');
    console.error('   2. Check BLOB_READ_WRITE_TOKEN is set');
    console.error('   3. Check database connection');
    console.error('   4. Check backup file integrity\n');
    
    throw error;
  } finally {
    await sql.end();
  }
}

// Function to restore from specific backup URL
async function restoreFromUrl(backupUrl) {
  console.log('⏳ Starting restore from URL...\n');
  
  try {
    console.log('═══════════════════════════════════════');
    console.log('🔄 DATABASE RESTORE FROM URL');
    console.log('═══════════════════════════════════════\n');
    
    // Download backup
    const backupData = await downloadBackup(backupUrl);
    
    // Restore database
    await restoreDatabase(backupData);
    
    // Verify restore
    const isValid = await verifyRestore();
    
    if (!isValid) {
      throw new Error('Restore verification failed');
    }
    
    console.log('\n✅ Restore from URL completed successfully!');
    
    return {
      success: true,
      restoredAt: new Date().toISOString(),
    };
    
  } catch (error) {
    console.error('\n❌ RESTORE FROM URL FAILED!');
    console.error(`Error: ${error.message}`);
    throw error;
  } finally {
    await sql.end();
  }
}

// Run restore if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const backupUrl = process.argv[2];
  
  if (backupUrl) {
    restoreFromUrl(backupUrl)
      .then((result) => {
        console.log('🎯 Restore result:', result);
        process.exit(0);
      })
      .catch((error) => {
        console.error('💥 Restore failed:', error);
        process.exit(1);
      });
  } else {
    interactiveRestore()
      .then((result) => {
        console.log('🎯 Restore result:', result);
        process.exit(0);
      })
      .catch((error) => {
        console.error('💥 Restore failed:', error);
        process.exit(1);
      });
  }
}

export { interactiveRestore, restoreFromUrl, listAvailableBackups };
