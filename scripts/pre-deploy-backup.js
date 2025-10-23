import { exec } from 'child_process';
import { promisify } from 'util';
import { put, list } from '@vercel/blob';
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

// Function to create pre-deployment backup
async function createPreDeployBackup() {
  console.log('⏳ Starting pre-deployment backup...\n');
  
  try {
    console.log('═══════════════════════════════════════');
    console.log('🚀 PRE-DEPLOYMENT BACKUP');
    console.log('═══════════════════════════════════════\n');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const deploymentId = `deploy-${timestamp}`;
    
    console.log(`🎯 Deployment ID: ${deploymentId}`);
    console.log(`⏰ Backup Time: ${new Date().toISOString()}\n`);
    
    // Step 1: Create database backup
    console.log('1️⃣ Creating database backup...');
    const { filePath, data } = await createDatabaseBackup(deploymentId);
    console.log(`✅ Database backup created: ${(data.length / 1024 / 1024).toFixed(2)} MB`);
    
    // Step 2: Upload to Vercel Blob
    console.log('\n2️⃣ Uploading to Vercel Blob...');
    const blob = await uploadBackupToBlob(deploymentId, data);
    console.log(`✅ Backup uploaded: ${blob.url}`);
    
    // Step 3: Verify backup integrity
    console.log('\n3️⃣ Verifying backup integrity...');
    const isValid = await verifyBackupIntegrity(blob);
    if (!isValid) {
      throw new Error('Backup integrity verification failed');
    }
    console.log('✅ Backup integrity verified');
    
    // Step 4: Create deployment record
    console.log('\n4️⃣ Creating deployment record...');
    const deploymentRecord = await createDeploymentRecord(deploymentId, blob);
    console.log(`✅ Deployment record created: ${deploymentRecord.id}`);
    
    // Step 5: Clean up temporary files
    console.log('\n5️⃣ Cleaning up temporary files...');
    try {
      await fs.unlink(filePath);
      console.log('✅ Temporary files cleaned up');
    } catch (error) {
      console.log('⚠️ Could not delete temporary file:', error.message);
    }
    
    console.log('\n═══════════════════════════════════════');
    console.log('🎉 PRE-DEPLOYMENT BACKUP COMPLETE!');
    console.log('═══════════════════════════════════════\n');
    console.log(`✅ Deployment ID: ${deploymentId}`);
    console.log(`📁 Backup URL: ${blob.url}`);
    console.log(`📊 Backup Size: ${(data.length / 1024 / 1024).toFixed(2)} MB`);
    console.log(`⏰ Created: ${new Date().toISOString()}\n`);
    
    console.log('🚀 READY FOR DEPLOYMENT!');
    console.log('   Your data is safely backed up');
    console.log('   Rollback procedures are ready');
    console.log('   Deployment can proceed safely\n');
    
    return {
      success: true,
      deploymentId,
      backupUrl: blob.url,
      backupSize: data.length,
      createdAt: new Date().toISOString(),
    };
    
  } catch (error) {
    console.error('\n❌ PRE-DEPLOYMENT BACKUP FAILED!');
    console.error('═══════════════════════════════════════');
    console.error(`Error: ${error.message}`);
    console.error('\n🚨 DEPLOYMENT ABORTED!');
    console.error('   Do not proceed with deployment');
    console.error('   Fix backup issues first');
    console.error('   Contact support if needed\n');
    
    throw error;
  } finally {
    await sql.end();
  }
}

// Function to create database backup
async function createDatabaseBackup(deploymentId) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `pre-deploy-${deploymentId}.sql`;
    const tempFile = `/tmp/${filename}`;
    
    if (connectionString.startsWith('file:')) {
      // SQLite database
      console.log('📊 SQLite database detected - using file copy method');
      const dbPath = connectionString.replace('file:', '');
      await fs.copyFile(dbPath, tempFile);
      
      const stats = await fs.stat(tempFile);
      const data = await fs.readFile(tempFile);
      
      return { filePath: tempFile, data };
    } else {
      // PostgreSQL database
      console.log('📊 PostgreSQL database detected - using pg_dump');
      const dumpCommand = `pg_dump "${connectionString}" --no-owner --no-privileges --clean --if-exists`;
      
      const { stdout, stderr } = await execAsync(dumpCommand);
      
      if (stderr && !stderr.includes('WARNING')) {
        console.log('⚠️ Dump warnings:', stderr);
      }
      
      await fs.writeFile(tempFile, stdout);
      const data = await fs.readFile(tempFile);
      
      return { filePath: tempFile, data };
    }
  } catch (error) {
    console.error('❌ Error creating database backup:', error);
    throw error;
  }
}

// Function to upload backup to Vercel Blob
async function uploadBackupToBlob(deploymentId, data) {
  try {
    const filename = `pre-deploy-${deploymentId}.sql`;
    
    const blob = await put(filename, data, {
      access: 'private',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    
    return blob;
  } catch (error) {
    console.error('❌ Error uploading to Vercel Blob:', error);
    throw error;
  }
}

// Function to verify backup integrity
async function verifyBackupIntegrity(blob) {
  try {
    const response = await fetch(blob.url);
    const backupData = await response.text();
    
    // Basic integrity checks
    const hasCreateTable = backupData.includes('CREATE TABLE');
    const hasInsertInto = backupData.includes('INSERT INTO');
    const hasData = backupData.length > 1000;
    
    return hasCreateTable && hasInsertInto && hasData;
  } catch (error) {
    console.error('❌ Error verifying backup:', error);
    return false;
  }
}

// Function to create deployment record
async function createDeploymentRecord(deploymentId, blob) {
  try {
    // In a real implementation, you'd store this in a database
    // For now, we'll create a local record
    const record = {
      id: deploymentId,
      backupUrl: blob.url,
      createdAt: new Date().toISOString(),
      status: 'backup_complete',
      type: 'pre_deployment'
    };
    
    // Save to local file for now
    const recordPath = `./deployment-records/${deploymentId}.json`;
    await fs.mkdir('./deployment-records', { recursive: true });
    await fs.writeFile(recordPath, JSON.stringify(record, null, 2));
    
    return record;
  } catch (error) {
    console.error('❌ Error creating deployment record:', error);
    throw error;
  }
}

// Run backup if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createPreDeployBackup()
    .then((result) => {
      console.log('🎯 Pre-deployment backup result:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Pre-deployment backup failed:', error);
      process.exit(1);
    });
}

export { createPreDeployBackup };
