/**
 * Role-Based Access Control (RBAC)
 * 
 * Defines permissions for each role and provides helper functions
 * to check access in pages and API routes
 */

// Available permissions in the system
export type Permission =
  | 'view_dashboard'
  | 'view_sales'
  | 'create_sales'
  | 'update_sales'
  | 'delete_sales'
  | 'export_sales'
  | 'view_production'
  | 'update_production'
  | 'view_statistics'
  | 'export_statistics'
  | 'view_config'
  | 'update_config'
  | 'manage_users'
  | 'invite_users'
  | 'manage_tenant'
  | 'manage_billing';

// Role definitions (matching Prisma schema)
export type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'SALES' | 'PRODUCTION' | 'VIEWER';

// Permission mappings for each role
export const rolePermissions: Record<Role, Permission[]> = {
  OWNER: [
    // Full access to everything
    'view_dashboard',
    'view_sales',
    'create_sales',
    'update_sales',
    'delete_sales',
    'export_sales',
    'view_production',
    'update_production',
    'view_statistics',
    'export_statistics',
    'view_config',
    'update_config',
    'manage_users',
    'invite_users',
    'manage_tenant',
    'manage_billing',
  ],
  ADMIN: [
    // Everything except tenant/billing management
    'view_dashboard',
    'view_sales',
    'create_sales',
    'update_sales',
    'delete_sales',
    'export_sales',
    'view_production',
    'update_production',
    'view_statistics',
    'export_statistics',
    'view_config',
    'update_config',
    'manage_users',
    'invite_users',
  ],
  MANAGER: [
    // Sales, production, and statistics
    'view_dashboard',
    'view_sales',
    'create_sales',
    'update_sales',
    'export_sales',
    'view_production',
    'update_production',
    'view_statistics',
    'export_statistics',
    'view_config', // allow read-only access to config for sales UI
  ],
  SALES: [
    // Sales module only
    'view_dashboard',
    'view_sales',
    'create_sales',
    'update_sales',
    'view_config', // allow reading product fields/options
  ],
  PRODUCTION: [
    // Production module only
    'view_dashboard',
    'view_production',
    'update_production',
  ],
  VIEWER: [
    // Read-only access
    'view_dashboard',
    'view_sales',
    'view_production',
    'view_statistics',
  ],
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions[role]?.includes(permission) ?? false;
}

/**
 * Check if a role can access a route
 */
export function canAccessRoute(role: Role, route: string): boolean {
  const routePermissions: Record<string, Permission> = {
    '/home': 'view_dashboard',
    '/ventas': 'view_sales',
    '/produccion': 'view_production',
    '/estadisticas': 'view_statistics',
    '/config': 'view_config',
  };

  const requiredPermission = routePermissions[route];
  if (!requiredPermission) {
    // Route not protected, allow access
    return true;
  }

  return hasPermission(role, requiredPermission);
}

/**
 * Get user-friendly role name
 */
export function getRoleName(role: Role): string {
  const roleNames: Record<Role, string> = {
    OWNER: 'Propietario',
    ADMIN: 'Administrador',
    MANAGER: 'Gerente',
    SALES: 'Ventas',
    PRODUCTION: 'Producción',
    VIEWER: 'Visualizador',
  };
  return roleNames[role] || role;
}

/**
 * Get role color for UI badges
 */
export function getRoleColor(role: Role): string {
  const roleColors: Record<Role, string> = {
    OWNER: 'bg-purple-100 text-purple-800',
    ADMIN: 'bg-blue-100 text-blue-800',
    MANAGER: 'bg-green-100 text-green-800',
    SALES: 'bg-yellow-100 text-yellow-800',
    PRODUCTION: 'bg-orange-100 text-orange-800',
    VIEWER: 'bg-gray-100 text-gray-800',
  };
  return roleColors[role] || 'bg-gray-100 text-gray-800';
}

/**
 * Check if user can perform an action based on their role
 */
export class RBACChecker {
  constructor(private role: Role) {}

  can(permission: Permission): boolean {
    return hasPermission(this.role, permission);
  }

  canAccessRoute(route: string): boolean {
    return canAccessRoute(this.role, route);
  }

  canManageUsers(): boolean {
    return this.can('manage_users');
  }

  canManageTenant(): boolean {
    return this.can('manage_tenant');
  }

  canUpdateConfig(): boolean {
    return this.can('update_config');
  }

  canCreateSales(): boolean {
    return this.can('create_sales');
  }

  canDeleteSales(): boolean {
    return this.can('delete_sales');
  }

  canUpdateProduction(): boolean {
    return this.can('update_production');
  }

  getRoleName(): string {
    return getRoleName(this.role);
  }

  getRoleColor(): string {
    return getRoleColor(this.role);
  }
}

/**
 * Create an RBAC checker for a given role
 */
export function createRBACChecker(role: Role): RBACChecker {
  return new RBACChecker(role);
}

/**
 * API route permission requirements
 * Maps API routes to required permissions
 */
export const apiPermissions: Record<string, Permission> = {
  // Orders/Sales
  'GET /api/orders': 'view_sales',
  'POST /api/orders': 'create_sales',
  'PUT /api/orders': 'update_sales',
  'DELETE /api/orders': 'delete_sales',

  // Users
  'GET /api/users': 'manage_users',
  'POST /api/users': 'invite_users',
  'PUT /api/users': 'manage_users',
  'DELETE /api/users': 'manage_users',

  // Config
  'GET /api/config/*': 'view_config',
  'POST /api/config/*': 'update_config',
  'PUT /api/config/*': 'update_config',
  'DELETE /api/config/*': 'update_config',

  // Statistics
  'GET /api/estadisticas/*': 'view_statistics',
};

/**
 * Check if a role can access an API endpoint
 */
export function canAccessAPI(role: Role, method: string, path: string): boolean {
  const key = `${method} ${path}`;
  const permission = apiPermissions[key];

  if (!permission) {
    // No specific permission required, allow access
    return true;
  }

  return hasPermission(role, permission);
}

