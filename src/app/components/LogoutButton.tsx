'use client';
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

export default function LogoutButton({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: '/auth/signin' })}
        className={
          className ||
          "inline-flex items-center gap-1.5 min-h-[44px] min-w-[44px] px-2.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors text-sm font-medium"
        }
        aria-label="Cerrar sesión"
      >
        <LogOut className="w-4 h-4" />
        <span>Salir</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: '/auth/signin' })}
      className={
        className ||
        "inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors min-h-[44px]"
      }
      aria-label="Cerrar sesión"
    >
      <LogOut className="w-4 h-4 mr-2" />
      Cerrar sesión
    </button>
  );
}
