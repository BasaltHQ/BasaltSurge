"use client";

import { useEffect, useState } from 'react';

export type Permission =
  | 'dashboard'
  | 'scheduling'
  | 'inventory'
  | 'invoicing'
  | 'inventory:financial' // Financial data like costs, purchase orders
  | 'team'
  | 'team:performance' // View performance ratings and analytics
  | 'team:management' // Add/edit/delete users, reset passwords
  | 'analytics'
  | 'analytics:detailed' // Detailed reports and financial analytics
  | 'settings'
  | 'settings:users' // User management
  | 'settings:system' // System configuration
  | 'roster'
  | 'menu'
  | 'robotic-fleets'
  | 'hostpro' // Access HostPro module
  | 'admin';

export type Role = 'Super Admin' | 'Manager' | 'Shift Supervisor' | 'Staff';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  permissions: Permission[];
}

// Define comprehensive role-based permissions
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  'Super Admin': [
    'dashboard',
    'scheduling',
    'inventory',
    'inventory:financial',
    'team',
    'team:performance',
    'team:management',
    'analytics',
    'analytics:detailed',
    'settings',
    'settings:users',
    'settings:system',
    'roster',
    'menu',
    'robotic-fleets',
    'hostpro',
    'admin'
  ],
  'Manager': [
    'dashboard',
    'scheduling',
    'inventory',
    'inventory:financial',
    'team',
    'team:performance',
    'analytics',
    'analytics:detailed',
    'roster',
    'menu',
    'robotic-fleets',
    'hostpro'
  ],
  'Shift Supervisor': [
    'dashboard',
    'scheduling',
    'inventory', // Basic inventory view for shift needs
    'team', // Basic team info but no detailed performance
    'roster',
    'hostpro'
  ],
  'Staff': [
    'dashboard', // Very limited access
    'inventory' // Allow basic inventory access for staff
  ]
};

export function usePermissions() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get user from localStorage/session
    const userData = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    if (userData) {
      try {
        const parsedUser = JSON.parse(userData);
        setUser(parsedUser);
      } catch (error) {
        console.error('Failed to parse user data:', error);
      }
    }

    // Sync with server to get latest status/permissions
    const syncWithServer = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (data.authed && (data.shopStatus === 'approved' || data.isTeamMember)) {
            // If server says approved or team member, ensure local user reflects assigned role
            const current = userData ? JSON.parse(userData) : {};
            if (current.role !== 'Manager' && current.role !== 'Super Admin') {
              const assignedRole: Role = data.isPlatformAdmin ? 'Super Admin' : (data.roles?.includes('merchant_admin') || data.roles?.includes('manager') ? 'Manager' : 'Staff');
              const updated = { ...current, role: assignedRole, permissions: ROLE_PERMISSIONS[assignedRole] };
              setUser(updated);
              localStorage.setItem('user', JSON.stringify(updated));
            }
          }
        }
      } catch (e) {
        console.error('Permission sync failed', e);
      } finally {
        setLoading(false);
      }
    };

    syncWithServer();
  }, []);

  const hasPermission = (permission: Permission): boolean => {
    if (!user) return false;

    // Super Admin has all permissions
    if (user.role === 'Super Admin') return true;

    // Check explicit permissions array first
    if (user.permissions && user.permissions.includes(permission)) return true;

    // Fall back to role-based permissions
    const rolePermissions = ROLE_PERMISSIONS[user.role] || [];
    return rolePermissions.includes(permission);
  };

  const hasAnyPermission = (permissions: Permission[]): boolean => {
    return permissions.some(permission => hasPermission(permission));
  };

  const hasAllPermissions = (permissions: Permission[]): boolean => {
    return permissions.every(permission => hasPermission(permission));
  };

  const hasRole = (roles: Role | Role[]): boolean => {
    if (!user) return false;
    const roleArray = Array.isArray(roles) ? roles : [roles];
    return roleArray.includes(user.role);
  };

  // Helper functions for common permission checks
  const canViewFinancialData = (): boolean => {
    return hasAnyPermission(['inventory:financial', 'analytics:detailed']);
  };

  const canManageUsers = (): boolean => {
    return hasPermission('team:management') || hasPermission('settings:users');
  };

  const canViewPerformanceData = (): boolean => {
    return hasPermission('team:performance');
  };

  const canAccessSettings = (): boolean => {
    return hasAnyPermission(['settings', 'settings:users', 'settings:system']);
  };

  const isAdmin = (): boolean => {
    return hasRole(['Super Admin', 'Manager']);
  };

  const isSuperAdmin = (): boolean => {
    return hasRole('Super Admin');
  };

  return {
    user,
    loading,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    hasRole,
    canViewFinancialData,
    canManageUsers,
    canViewPerformanceData,
    canAccessSettings,
    isAdmin,
    isSuperAdmin,
    permissions: user ? ROLE_PERMISSIONS[user.role] || [] : [],
    role: user?.role || null
  };
}
