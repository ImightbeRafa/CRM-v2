import { exec } from 'child_process';
import { promisify } from 'util';
import { put, list, del } from '@vercel/blob';
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

// Function to create PostgreSQL dump
async function createDatabaseDump() {
  console.log('🔄 Creating database dump...');
  
  try {
    // Create a temporary file for the dump
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tempFile = `/tmp/backup-${timestamp}.sql`;
    
    // Create PostgreSQL dump command
    const dumpCommand = `pg_dump "${connectionString}" --no-owner --no-privileges --clean --if-exists`;
    
    console.log('📊 Executing database dump...');
    const { stdout, stderr } = await execAsync(dumpCommand);
    
    if (stderr && !stderr.includes('WARNING')) {
      console.error('⚠️ Dump warnings:', stderr);
    }
    
    // Write dump to temporary file
    await fs.writeFile(tempFile, stdout);
    
    console.log('✅ Database dump created successfully');
    return { filePath: tempFile, data: stdout };
  } catch (error) {
    console.error('❌ Error creating database dump:', error);
    throw error;
  }
}

// Function to upload backup to Vercel Blob
async function uploadBackupToBlob(filePath, data) {
  console.log('☁️ Uploading backup to Vercel Blob...');
  
  try {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `daily-backup-${timestamp}.sql`;
    
    // Upload to Vercel Blob
    const blob = await put(filename, data, {
      access: 'private',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    
    console.log(`✅ Backup uploaded successfully: ${blob.url}`);
    console.log(`   📁 Filename: ${filename}`);
    console.log(`   📊 Size: ${(data.length / 1024 / 1024).toFixed(2)} MB`);
    
    return blob;
  } catch (error) {
    console.error('❌ Error uploading to Vercel Blob:', error);
    throw error;
  }
}

// Function to clean up old backups (retention policy)
async function cleanupOldBackups() {
  console.log('🧹 Cleaning up old backups...');
  
  try {
    const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '30');
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    console.log(`🗑️ Deleting backups older than ${retentionDays} days...`);
    
    // List all backups
    const { blobs } = await list({
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    
    let deletedCount = 0;
    let totalSize = 0;
    
    for (const blob of blobs) {
      if (blob.name.startsWith('daily-backup-')) {
        const backupDate = new Date(blob.createdAt);
        
        if (backupDate < cutoffDate) {
          await del(blob.url, {
            token: process.env.BLOB_READ_WRITE_TOKEN,
          });
          
          console.log(`🗑️ Deleted old backup: ${blob.name}`);
          deletedCount++;
          totalSize += blob.size;
        }
      }
    }
    
    console.log(`✅ Cleanup complete:`);
    console.log(`   🗑️ Deleted: ${deletedCount} old backups`);
    console.log(`   💾 Freed: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    // Don't throw - cleanup failure shouldn't stop backup
  }
}

// Function to verify backup integrity
async function verifyBackup(blob) {
  console.log('🔍 Verifying backup integrity...');
  
  try {
    // Download and check the backup
    const response = await fetch(blob.url);
    const backupData = await response.text();
    
    // Basic integrity checks
    const hasCreateTable = backupData.includes('CREATE TABLE');
    const hasInsertInto = backupData.includes('INSERT INTO');
    const hasData = backupData.length > 1000; // At least 1KB of data
    
    if (hasCreateTable && hasInsertInto && hasData) {
      console.log('✅ Backup integrity verified');
      return true;
    } else {
      console.log('❌ Backup integrity check failed');
      return false;
    }
  } catch (error) {
    console.error('❌ Error verifying backup:', error);
    return false;
  }
}

// Main backup function
async function createDailyBackup() {
  console.log('⏳ Starting daily backup process...\n');
  
  try {
    console.log('═══════════════════════════════════════');
    console.log('🔄 DAILY BACKUP PROCESS');
    console.log('═══════════════════════════════════════\n');
    
    // Step 1: Create database dump
    const { filePath, data } = await createDatabaseDump();
    
    // Step 2: Upload to Vercel Blob
    const blob = await uploadBackupToBlob(filePath, data);
    
    // Step 3: Verify backup integrity
    const isValid = await verifyBackup(blob);
    
    if (!isValid) {
      throw new Error('Backup integrity verification failed');
    }
    
    // Step 4: Clean up old backups
    await cleanupOldBackups();
    
    // Step 5: Clean up temporary file
    try {
      await fs.unlink(filePath);
      console.log('🧹 Temporary file cleaned up');
    } catch (error) {
      console.log('⚠️ Could not delete temporary file:', error.message);
    }
    
    console.log('\n═══════════════════════════════════════');
    console.log('🎉 BACKUP COMPLETE!');
    console.log('═══════════════════════════════════════\n');
    console.log(`✅ Backup created: ${blob.url}`);
    console.log(`📊 Size: ${(data.length / 1024 / 1024).toFixed(2)} MB`);
    console.log(`🔒 Retention: ${process.env.BACKUP_RETENTION_DAYS || '30'} days`);
    console.log(`⏰ Created: ${new Date().toISOString()}\n`);
    
    return {
      success: true,
      url: blob.url,
      filename: blob.pathname,
      size: data.length,
      createdAt: new Date().toISOString(),
    };
    
  } catch (error) {
    console.error('\n❌ BACKUP FAILED!');
    console.error('═══════════════════════════════════════');
    console.error(`Error: ${error.message}`);
    console.error('\n🔧 Troubleshooting:');
    console.error('   1. Check DATABASE_URL is correct');
    console.error('   2. Check BLOB_READ_WRITE_TOKEN is set');
    console.error('   3. Check database connection');
    console.error('   4. Check Vercel Blob permissions\n');
    
    throw error;
  } finally {
    await sql.end();
  }
}

// Run backup if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createDailyBackup()
    .then((result) => {
      console.log('🎯 Backup result:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Backup failed:', error);
      process.exit(1);
    });
}

export { createDailyBackup, cleanupOldBackups, verifyBackup };
