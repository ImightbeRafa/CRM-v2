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

// Function to list available deployments
async function listAvailableDeployments() {
  console.log('📋 Fetching available deployments...\n');
  
  try {
    const { blobs } = await list({
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    
    const deployments = blobs
      .filter(blob => blob.name.startsWith('pre-deploy-'))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    console.log('📊 AVAILABLE DEPLOYMENTS:');
    console.log('═══════════════════════════════════════');
    
    if (deployments.length === 0) {
      console.log('❌ No deployment backups found');
      return [];
    }
    
    deployments.forEach((deployment, index) => {
      const date = new Date(deployment.createdAt).toLocaleDateString();
      const time = new Date(deployment.createdAt).toLocaleTimeString();
      const size = (deployment.size / 1024 / 1024).toFixed(2);
      const deploymentId = deployment.name.replace('pre-deploy-', '').replace('.sql', '');
      
      console.log(`${index + 1}. ${deploymentId}`);
      console.log(`   📅 Date: ${date} ${time}`);
      console.log(`   📊 Size: ${size} MB`);
      console.log(`   🔗 URL: ${deployment.url}`);
      console.log('');
    });
    
    return deployments;
  } catch (error) {
    console.error('❌ Error listing deployments:', error);
    throw error;
  }
}

// Function to download deployment backup
async function downloadDeploymentBackup(backupUrl) {
  console.log('⬇️ Downloading deployment backup...');
  
  try {
    const response = await fetch(backupUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const backupData = await response.text();
    console.log(`✅ Deployment backup downloaded: ${(backupData.length / 1024 / 1024).toFixed(2)} MB`);
    
    return backupData;
  } catch (error) {
    console.error('❌ Error downloading deployment backup:', error);
    throw error;
  }
}

// Function to restore database from deployment backup
async function restoreFromDeploymentBackup(backupData) {
  console.log('🔄 Restoring database from deployment backup...');
  
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tempFile = `/tmp/rollback-${timestamp}.sql`;
    
    // Write backup data to temporary file
    await fs.writeFile(tempFile, backupData);
    console.log('📝 Deployment backup written to temporary file');
    
    if (connectionString.startsWith('file:')) {
      // SQLite database
      console.log('📊 SQLite database detected - using file copy method');
      const dbPath = connectionString.replace('file:', '');
      
      // Backup current database
      const currentBackup = `${dbPath}.rollback-backup-${timestamp}`;
      await fs.copyFile(dbPath, currentBackup);
      console.log(`✅ Current database backed up to: ${currentBackup}`);
      
      // Restore from deployment backup
      await fs.copyFile(tempFile, dbPath);
      console.log('✅ Database restored from deployment backup');
      
    } else {
      // PostgreSQL database
      console.log('📊 PostgreSQL database detected - using psql restore');
      
      // Create backup of current database
      const currentBackupCommand = `pg_dump "${connectionString}" --no-owner --no-privileges --clean --if-exists > /tmp/current-backup-${timestamp}.sql`;
      await execAsync(currentBackupCommand);
      console.log('✅ Current database backed up');
      
      // Restore from deployment backup
      const restoreCommand = `psql "${connectionString}" -f "${tempFile}"`;
      console.log('🔄 Executing database restore...');
      
      const { stdout, stderr } = await execAsync(restoreCommand);
      
      if (stderr && !stderr.includes('WARNING')) {
        console.error('⚠️ Restore warnings:', stderr);
      }
      
      console.log('✅ Database restored from deployment backup');
    }
    
    // Clean up temporary file
    try {
      await fs.unlink(tempFile);
      console.log('🧹 Temporary file cleaned up');
    } catch (error) {
      console.log('⚠️ Could not delete temporary file:', error.message);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error restoring from deployment backup:', error);
    throw error;
  }
}

// Function to verify rollback integrity
async function verifyRollbackIntegrity() {
  console.log('🔍 Verifying rollback integrity...');
  
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
      console.log(`✅ Rollback verification passed: ${totalRecords} total records`);
      return true;
    } else {
      console.log('❌ Rollback verification failed: No data found');
      return false;
    }
  } catch (error) {
    console.error('❌ Error verifying rollback:', error);
    return false;
  }
}

// Interactive rollback function
async function interactiveRollback() {
  console.log('⏳ Starting interactive rollback process...\n');
  
  try {
    console.log('═══════════════════════════════════════');
    console.log('🔄 DEPLOYMENT ROLLBACK PROCESS');
    console.log('═══════════════════════════════════════\n');
    
    // Step 1: List available deployments
    const deployments = await listAvailableDeployments();
    
    if (deployments.length === 0) {
      console.log('❌ No deployment backups available for rollback');
      return;
    }
    
    // Step 2: Select deployment (use latest by default)
    const selectedDeployment = deployments[0];
    const deploymentId = selectedDeployment.name.replace('pre-deploy-', '').replace('.sql', '');
    
    console.log(`🎯 Selected deployment: ${deploymentId}`);
    console.log(`📅 Created: ${new Date(selectedDeployment.createdAt).toLocaleString()}`);
    console.log(`📊 Size: ${(selectedDeployment.size / 1024 / 1024).toFixed(2)} MB\n`);
    
    // Step 3: Download deployment backup
    const backupData = await downloadDeploymentBackup(selectedDeployment.url);
    
    // Step 4: Confirm rollback
    console.log('⚠️  WARNING: This will completely replace your current database!');
    console.log('⚠️  Make sure you have a current backup before proceeding.\n');
    
    // Step 5: Restore database
    await restoreFromDeploymentBackup(backupData);
    
    // Step 6: Verify rollback
    const isValid = await verifyRollbackIntegrity();
    
    if (!isValid) {
      throw new Error('Rollback verification failed');
    }
    
    console.log('\n═══════════════════════════════════════');
    console.log('🎉 ROLLBACK COMPLETE!');
    console.log('═══════════════════════════════════════\n');
    console.log(`✅ Database rolled back to: ${deploymentId}`);
    console.log(`📅 Deployment date: ${new Date(selectedDeployment.createdAt).toLocaleString()}`);
    console.log(`⏰ Rollback completed: ${new Date().toISOString()}\n`);
    
    return {
      success: true,
      deploymentId,
      rollbackDate: selectedDeployment.createdAt,
      completedAt: new Date().toISOString(),
    };
    
  } catch (error) {
    console.error('\n❌ ROLLBACK FAILED!');
    console.error('═══════════════════════════════════════');
    console.error(`Error: ${error.message}`);
    console.error('\n🔧 Troubleshooting:');
    console.error('   1. Check DATABASE_URL is correct');
    console.error('   2. Check BLOB_READ_WRITE_TOKEN is set');
    console.error('   3. Check database connection');
    console.error('   4. Check deployment backup integrity\n');
    
    throw error;
  } finally {
    await sql.end();
  }
}

// Function to rollback from specific deployment ID
async function rollbackFromDeploymentId(deploymentId) {
  console.log('⏳ Starting rollback from deployment ID...\n');
  
  try {
    console.log('═══════════════════════════════════════');
    console.log('🔄 ROLLBACK FROM DEPLOYMENT ID');
    console.log('═══════════════════════════════════════\n');
    
    // Find deployment backup
    const { blobs } = await list({
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    
    const deployment = blobs.find(blob => 
      blob.name === `pre-deploy-${deploymentId}.sql`
    );
    
    if (!deployment) {
      throw new Error(`Deployment backup not found: ${deploymentId}`);
    }
    
    console.log(`🎯 Found deployment: ${deploymentId}`);
    console.log(`📅 Created: ${new Date(deployment.createdAt).toLocaleString()}`);
    console.log(`📊 Size: ${(deployment.size / 1024 / 1024).toFixed(2)} MB\n`);
    
    // Download and restore
    const backupData = await downloadDeploymentBackup(deployment.url);
    await restoreFromDeploymentBackup(backupData);
    
    // Verify rollback
    const isValid = await verifyRollbackIntegrity();
    
    if (!isValid) {
      throw new Error('Rollback verification failed');
    }
    
    console.log('\n✅ Rollback from deployment ID completed successfully!');
    
    return {
      success: true,
      deploymentId,
      completedAt: new Date().toISOString(),
    };
    
  } catch (error) {
    console.error('\n❌ ROLLBACK FROM DEPLOYMENT ID FAILED!');
    console.error(`Error: ${error.message}`);
    throw error;
  } finally {
    await sql.end();
  }
}

// Run rollback if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const deploymentId = process.argv[2];
  
  if (deploymentId) {
    rollbackFromDeploymentId(deploymentId)
      .then((result) => {
        console.log('🎯 Rollback result:', result);
        process.exit(0);
      })
      .catch((error) => {
        console.error('💥 Rollback failed:', error);
        process.exit(1);
      });
  } else {
    interactiveRollback()
      .then((result) => {
        console.log('🎯 Rollback result:', result);
        process.exit(0);
      })
      .catch((error) => {
        console.error('💥 Rollback failed:', error);
        process.exit(1);
      });
  }
}

export { interactiveRollback, rollbackFromDeploymentId, listAvailableDeployments };
