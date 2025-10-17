# Betsy CRM

Sistema CRM moderno para gestión de ventas y producción con enfoque en facilidad de uso y trazabilidad completa.

## 🚀 Características Principales

### Gestión de Ventas
- 📝 Formularios EA/RA para captura de pedidos
- 👥 Gestión de clientes y vendedores
- 📊 Dashboard de ventas con estadísticas
- 🔄 Seguimiento de estados de pedidos

### Sistema de Auditoría
- 📋 Historial completo de cambios
- 👤 Trazabilidad de usuarios
- 🔍 Seguimiento de modificaciones
- 📈 Reportes de actividad

### Gestión de Configuración
- ⚙️ Campos personalizables de productos
- 🏷️ Conjuntos de opciones configurables
- 🚚 Métodos de envío personalizables
- 👥 Gestión de usuarios y roles

## 🛠️ Stack Técnico

- **Frontend**: Next.js 14 + TypeScript
- **Base de Datos**: SQLite + Prisma ORM
- **Autenticación**: NextAuth.js
- **UI**: Tailwind CSS + shadcn/ui
- **Despliegue**: Vercel/Cloudflare

## 🚀 Instalación Rápida

### Requisitos
- Node.js >=18.18.0
- npm

### Variables de Entorno
```env
NEXTAUTH_SECRET=your-secret-key
NEXT_PUBLIC_SCRIPT_URL=your-google-apps-script-url
```

### Instalación
```bash
# Clonar repositorio
git clone [repository-url]
cd Betsy

# Instalar dependencias
npm install

# Configurar base de datos
npx prisma db push

# Iniciar desarrollo
npm run dev
```

## 📁 Estructura del Proyecto

```
Betsy/
├── src/
│   ├── app/
│   │   ├── ventas/          # Módulo de ventas
│   │   ├── produccion/      # Módulo de producción
│   │   ├── config/          # Configuración del sistema
│   │   ├── api/             # API endpoints
│   │   └── components/      # Componentes reutilizables
│   ├── lib/                 # Utilidades y configuración
│   └── types/               # Definiciones TypeScript
├── prisma/                  # Esquema de base de datos
└── public/                  # Archivos estáticos
```

## 🔧 Comandos de Desarrollo

```bash
# Desarrollo
npm run dev

# Construcción
npm run build

# Base de datos
npx prisma db push
npx prisma studio
```

## ✨ Estado del Proyecto

### ✅ Completado
- Sistema de autenticación
- Formularios EA/RA
- Dashboard de ventas
- Sistema de auditoría
- Gestión de configuración
- Operaciones masivas

### 🔧 En Refinamiento
- Optimización de auditoría
- Mejoras de UX
- Limpieza de código

---

**Betsy CRM** - Sistema moderno para gestión de ventas y producción