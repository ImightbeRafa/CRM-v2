# Betsy CRM - Sistema de Gestión de Ventas

Un sistema CRM completo para gestión de ventas, pedidos y clientes con funcionalidades avanzadas de auditoría y configuración.

## 🚀 Características Principales

### 📊 **Gestión de Ventas**
- Formulario optimizado para creación de pedidos (EA/RA)
- Sugerencias inteligentes de productos y clientes frecuentes
- Dashboard de ventas en tiempo real
- Gestión de estados de pedidos
- Cálculo automático de totales e IVA

### 👥 **Gestión de Usuarios**
- Sistema de roles (MASTER/REGULAR)
- Autenticación segura con NextAuth.js
- Gestión completa de usuarios desde panel de administración
- Auditoría de acciones de usuarios

### 📈 **Panel de Producción**
- Vista unificada de todos los pedidos
- Filtros avanzados por estado, tipo y fecha
- Actualización de estados en tiempo real
- Generación de guías de envío

### 🔍 **Sistema de Auditoría**
- Registro completo de todas las acciones del sistema
- Filtros por fecha, usuario y tipo de acción
- Paginación para manejo de grandes volúmenes de datos
- Exportación de logs de auditoría

### ⚙️ **Configuración Avanzada**
- Gestión de productos y clientes recurrentes
- Configuración de campos personalizados
- Métodos de envío configurables
- Panel de administración completo

## 🛠️ Tecnologías

- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes, Prisma ORM
- **Base de Datos**: SQLite (desarrollo) / PostgreSQL (producción)
- **Autenticación**: NextAuth.js
- **UI Components**: Radix UI, Lucide React

## 🗄️ Estructura de la Base de Datos

### Modelos Principales

- **Order**: Pedidos de venta con toda la información del cliente y producto
- **User**: Usuarios del sistema con roles y permisos
- **AuditLog**: Registro de auditoría de todas las acciones
- **FrequentProduct**: Productos recurrentes para sugerencias
- **FrequentCustomer**: Clientes frecuentes para autocompletado

## 🔐 Autenticación y Roles

### Roles de Usuario
- **MASTER**: Acceso completo al sistema, gestión de usuarios, configuración
- **REGULAR**: Acceso a ventas y producción, sin acceso a configuración

### Configuración de Usuarios
- Los usuarios MASTER pueden crear, editar y eliminar otros usuarios
- Contraseña por defecto para nuevos usuarios: `password123`
- Sistema de activación/desactivación de usuarios

## 📱 Funcionalidades por Módulo

### 🏠 **Dashboard Principal**
- Resumen de ventas del día
- Acceso rápido a todas las funcionalidades
- Navegación intuitiva

### 💰 **Módulo de Ventas**
- Formulario optimizado para creación de pedidos
- Sugerencias inteligentes basadas en historial
- Validación automática de campos requeridos
- Cálculo automático de totales

### 🏭 **Módulo de Producción**
- Vista de todos los pedidos con filtros
- Actualización de estados de pedidos
- Generación de guías de envío
- Seguimiento de pedidos EA y RA

### ⚙️ **Módulo de Configuración**
- Gestión de usuarios y roles
- Configuración de productos recurrentes
- Configuración de clientes frecuentes
- Panel de auditoría avanzado

## 📊 Monitoreo y Auditoría

### Sistema de Auditoría
- Registro automático de todas las acciones
- Filtros por fecha, usuario y tipo de acción
- Paginación para manejo de grandes volúmenes
- Exportación de logs

### Métricas Disponibles
- Total de ventas por día/mes
- Usuarios más activos
- Productos más vendidos
- Estados de pedidos

---

**Betsy CRM** - Sistema de gestión de ventas optimizado para productividad y eficiencia.