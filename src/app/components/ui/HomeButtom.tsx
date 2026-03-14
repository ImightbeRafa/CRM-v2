'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ShoppingCart, Factory, BarChart } from 'lucide-react';

const NavigationMenu = () => {
  const pathname = usePathname();

  const menuItems = [
    { path: '/dashboard', label: 'Inicio', icon: Home },
    { path: '/ventas', label: 'Ventas', icon: ShoppingCart },
    { path: '/produccion', label: 'Producción', icon: Factory },
    { path: '/estadisticas', label: 'Estadísticas', icon: BarChart },
  ];

  const isActivePath = (path: string) => pathname === path;

  return (
    <nav className="flex items-center gap-4 p-2 bg-white rounded-lg shadow-sm">
      {menuItems.map((item) => {
        const Icon = item.icon;
        const isActive = isActivePath(item.path);
        
        return (
          <Link
            key={item.path}
            href={item.path}
            prefetch={false}
            className={`
              group flex items-center gap-2 px-4 py-2 rounded-lg
              transition-all duration-200 ease-in-out
              ${isActive 
                ? 'bg-brand-gradient text-white cursor-default pointer-events-none shadow-md' 
                : 'text-muted-foreground hover:bg-blue-50 hover:text-blue-600 active:scale-95'}
            `}
            onClick={(e) => {
              // Prevent navigation if already on this path
              if (isActive) {
                e.preventDefault();
              }
            }}
          >
            <Icon 
              className={`
                transition-transform group-hover:-translate-x-1
                ${isActive ? '' : 'group-hover:text-blue-500'}
              `}
              size={20}
            />
            <span className="font-medium">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  );
};

export default NavigationMenu;