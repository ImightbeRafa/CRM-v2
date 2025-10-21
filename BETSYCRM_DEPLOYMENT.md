# 🚀 Betsy CRM - betsycrm.com Deployment Guide

## 🌐 Domain Configuration

**Production URL**: `https://betsycrm.com`

## 🔧 Environment Variables for Vercel

### **Required Variables:**

```bash
# NextAuth Configuration
NEXTAUTH_SECRET=your-production-secret-key-here
NEXTAUTH_URL=https://betsycrm.com

# Database Configuration
DATABASE_URL=your-production-database-url

# Authentication Settings
AUTH_DEMO_MODE=false
MASTER_EMAIL=admin@betsycrm.com
MASTER_PASSWORD=your-secure-master-password
```

### **Security Recommendations:**

1. **NEXTAUTH_SECRET**: Generate a strong secret (32+ characters)
   ```bash
   # Generate with OpenSSL
   openssl rand -base64 32
   ```

2. **MASTER_PASSWORD**: Use a strong, unique password
   - Minimum 12 characters
   - Mix of letters, numbers, and symbols
   - Example: `BetsyCRM2024!Secure`

3. **Database Security**: Ensure your database is properly secured
   - Use strong database credentials
   - Enable SSL connections
   - Restrict access to Vercel IPs if possible

## 🗄️ Database Options for betsycrm.com

### **Option 1: Vercel Postgres (Recommended)**
1. Add Vercel Postgres to your project
2. Use the connection string provided by Vercel
3. Format: `postgresql://username:password@host:port/database`

### **Option 2: External Database**
- **PlanetScale**: `mysql://username:password@host:port/database`
- **Supabase**: `postgresql://username:password@host:port/database`
- **Railway**: `postgresql://username:password@host:port/database`

## 📋 Deployment Steps

### **1. Vercel Project Setup**
1. Connect your GitHub repository
2. Set the domain to `betsycrm.com`
3. Configure environment variables (see above)

### **2. Database Setup**
```bash
# After deployment, run:
npx prisma db push
```

### **3. Initial Configuration**
1. Visit `https://betsycrm.com`
2. Login with master credentials
3. Configure business fields in `/config`
4. Create additional users for your team

## 🔒 Security Configuration

### **CORS Settings**
- Origin: `https://betsycrm.com`
- Credentials: Enabled
- Methods: GET, POST, PUT, DELETE, OPTIONS

### **SSL/TLS**
- Automatic HTTPS with Vercel
- Secure cookies enabled
- HSTS headers configured

## 📊 Performance Optimization

### **Vercel Configuration**
- **Framework**: Next.js 14.0.4
- **Node Version**: >=18.18.0
- **Regions**: sfo1 (San Francisco)
- **Function Timeout**: 30 seconds
- **Build Command**: `npm run build`

### **Caching Strategy**
- Static pages: CDN cached
- API routes: Server-side rendering
- Database queries: Optimized with Prisma

## 🎯 Post-Deployment Checklist

- [ ] Domain configured (`betsycrm.com`)
- [ ] Environment variables set
- [ ] Database connected and migrated
- [ ] Master user can login
- [ ] Business fields configured
- [ ] Team users created
- [ ] SSL certificate active
- [ ] Performance monitoring enabled

## 🚨 Important Notes

1. **Domain Verification**: Ensure `betsycrm.com` is properly configured in Vercel
2. **DNS Settings**: Point your domain to Vercel's servers
3. **SSL Certificate**: Vercel automatically provides SSL
4. **Backup Strategy**: Consider database backups for production data
5. **Monitoring**: Set up error tracking and performance monitoring

## 📞 Support

If you encounter any issues during deployment:
1. Check Vercel deployment logs
2. Verify environment variables
3. Test database connectivity
4. Review application logs

**Your Betsy CRM will be live at: `https://betsycrm.com`** 🎉
