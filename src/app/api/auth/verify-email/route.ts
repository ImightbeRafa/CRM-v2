import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json(
      { error: 'Token is required' },
      { status: 400 }
    );
  }

  try {
    console.log(`🔍 Verifying email token: ${token?.substring(0, 8)}...`);
    console.log(`🔍 Full token length: ${token?.length}`);
    console.log(`🔍 Current time: ${new Date().toISOString()}`);
    
    // Find user with this token (using raw query to handle the mapped fields)
    // Try camelCase first (Prisma mapped format), then snake_case as fallback
    let user: any = null;
    try {
      user = await prisma.$queryRaw`
        SELECT * FROM "User" 
        WHERE "emailVerificationToken" = ${token}
        AND "emailVerificationTokenExpires" > NOW()
        LIMIT 1
      `;
      console.log(`✅ Query successful with camelCase columns`);
    } catch (queryError) {
      console.log('⚠️ camelCase query failed, trying snake_case...');
      // Fallback to snake_case column names
      try {
        user = await prisma.$queryRaw`
          SELECT * FROM "User" 
          WHERE "email_verification_token" = ${token}
          AND "email_verification_token_expires" > NOW()
          LIMIT 1
        `;
        console.log(`✅ Query successful with snake_case columns`);
      } catch (fallbackError) {
        console.error('❌ Both query formats failed:', fallbackError);
        throw queryError; // Throw original error
      }
    }

    if (!user || (Array.isArray(user) && user.length === 0)) {
      console.error('❌ Invalid or expired token. Checking if token exists at all...');
      
      // Check if token exists but expired (try both column name formats)
      let expiredUser: any = null;
      try {
        expiredUser = await prisma.$queryRaw`
          SELECT * FROM "User" 
          WHERE "emailVerificationToken" = ${token}
          LIMIT 1
        `;
      } catch {
        try {
          expiredUser = await prisma.$queryRaw`
            SELECT * FROM "User" 
            WHERE "email_verification_token" = ${token}
            LIMIT 1
          `;
        } catch {
          // Ignore - token not found
        }
      }
      
      if (expiredUser && (Array.isArray(expiredUser) ? expiredUser.length > 0 : expiredUser)) {
        console.error('⚠️ Token found but has expired');
        return NextResponse.json(
          { error: 'Verification token has expired. Please request a new verification email.' },
          { status: 400 }
        );
      }
      
      console.error('❌ Token not found in database');
      return NextResponse.json(
        { error: 'Invalid verification token. Please check your email and try again.' },
        { status: 400 }
      );
    }

    const userData = Array.isArray(user) ? user[0] : user;
    console.log(`✅ Token valid for user: ${userData.email}`);

    // Create tenant and update user in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create tenant
      const tenant = await tx.tenant.create({
        data: {
          name: `${userData.username || userData.email.split('@')[0]}'s Organization`,
          slug: userData.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-'),
          plan: 'FREE',
          isActive: true,
          trialEndsAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
        }
      });

      // Update user with tenant info and mark as active using raw query for mapped fields
      await tx.$executeRaw`
        UPDATE "User" 
        SET 
          "active" = true,
          "emailVerified" = NOW(),
          "defaultTenantId" = ${tenant.id},
          "emailVerificationToken" = NULL,
          "emailVerificationTokenExpires" = NULL
        WHERE id = ${userData.id}
      `;

      // Create membership
      await tx.membership.create({
        data: {
          userId: userData.id,
          tenantId: tenant.id,
          role: 'OWNER',
          isActive: true,
          joinedAt: new Date().toISOString()
        }
      });

      // Create default order statuses for the new tenant
      // Use transaction client directly to bypass tenant context requirement
      try {
        const { DEFAULT_ORDER_STATUSES } = await import('@/lib/default-statuses');
        await tx.orderStatus.createMany({
          data: DEFAULT_ORDER_STATUSES.map(status => ({
            ...status,
            tenantId: tenant.id,
            isActive: true,
          })),
          skipDuplicates: true
        });
        console.log(`✅ Created default order statuses for tenant: ${tenant.id}`);
      } catch (statusError) {
        console.error('⚠️ Failed to create default order statuses:', statusError);
        // Don't fail the entire verification if status creation fails
      }

      // Get updated user with memberships
      const updatedUser = await tx.user.findUnique({
        where: { id: userData.id },
        include: { memberships: true }
      });

      return { user: updatedUser, tenant };
    });

    if (!result.user) {
      throw new Error('User not found after verification');
    }

    console.log(`✅ Email verification completed for: ${userData.email}`);
    console.log(`✅ Tenant created: ${result.tenant.id} - ${result.tenant.name}`);
    console.log(`✅ User activated: ${result.user.id}`);

    return NextResponse.json({ 
      success: true,
      message: 'Email verified and account activated successfully',
      userId: result.user.id,
      tenantId: result.tenant.id,
      tenantName: result.tenant.name
    });
  } catch (error) {
    console.error('Email verification error:', error);
    return NextResponse.json(
      { error: 'Failed to verify email' },
      { status: 500 }
    );
  }
}
