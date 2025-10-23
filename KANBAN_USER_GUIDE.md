# 📋 **GUÍA RÁPIDA: VISTA KANBAN EN PRODUCCIÓN**

## 🎯 **¿Qué es la Vista Kanban?**

La Vista Kanban es una forma visual de gestionar pedidos, similar a Trello. Puedes **arrastrar y soltar** pedidos entre columnas de estado para actualizar su progreso.

---

## 🚀 **CÓMO EMPEZAR:**

### **Paso 1: Accede a Producción**
```
Menú → Producción
```

### **Paso 2: Cambia a Vista Kanban**
En la parte superior, verás 3 botones de vista:

```
┌─────┬─────┬─────┐
│ 📊  │ 📋  │ 📱  │
│Grid │Kanbn│List │
└─────┴─────┴─────┘
```

👉 **Haz clic en el botón del medio** (📋) para activar la Vista Kanban.

---

## 🎨 **ENTENDIENDO LA VISTA:**

### **Columnas de Estado:**

Verás columnas horizontales, cada una representa un estado:

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ 🟡 PENDIENTE│  │ 🔵 EN PROC  │  │ 🟢 COMPLETADO│  │ 🟣 ENVIADO  │
│    (5)      │  │    (12)     │  │    (8)      │  │    (15)     │
├─────────────┤  ├─────────────┤  ├─────────────┤  ├─────────────┤
│ [Pedido 1]  │  │ [Pedido 6]  │  │ [Pedido 14] │  │ [Pedido 22] │
│ [Pedido 2]  │  │ [Pedido 7]  │  │ [Pedido 15] │  │ [Pedido 23] │
│ [Pedido 3]  │  │ [Pedido 8]  │  │ [Pedido 16] │  │ [Pedido 24] │
│ [Pedido 4]  │  │ [Pedido 9]  │  │ [Pedido 17] │  │ [Pedido 25] │
│ [Pedido 5]  │  │ [Pedido 10] │  │ [Pedido 18] │  │ [Pedido 26] │
│             │  │ [Pedido 11] │  │ [Pedido 19] │  │     ...     │
│             │  │ [Pedido 12] │  │ [Pedido 20] │  │             │
│             │  │ [Pedido 13] │  │ [Pedido 21] │  │             │
└─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
```

El número `(5)` indica cuántos pedidos hay en ese estado.

---

## 🎮 **CÓMO USAR:**

### **✅ Mover un Pedido:**

1. **Encuentra el pedido** que deseas mover
2. **Haz clic y mantén presionado** en el ícono de agarre (`⋮⋮`) en la esquina superior izquierda de la tarjeta
3. **Arrastra** la tarjeta a la columna de destino
4. **Suelta** la tarjeta en la nueva columna
5. **Confirmación**: Verás un mensaje de éxito ✅

```
┌─────────────┐          ┌─────────────┐
│ PENDIENTE   │          │ EN PROCESO  │
├─────────────┤          ├─────────────┤
│ ⋮⋮ #001     │  ━━━>    │             │
│   Cliente A │          │             │
│   Producto X│          │             │
│   ₡5,000    │          │             │
└─────────────┘          └─────────────┘

        ↓ ARRASTRAR Y SOLTAR ↓

┌─────────────┐          ┌─────────────┐
│ PENDIENTE   │          │ EN PROCESO  │
├─────────────┤          ├─────────────┤
│             │          │ ⋮⋮ #001     │
│             │          │   Cliente A │
│             │          │   Producto X│
│             │          │   ₡5,000    │
└─────────────┘          └─────────────┘
```

### **📖 Ver Detalles de un Pedido:**

- **Haz clic** en cualquier parte de la tarjeta (excepto el ícono de agarre)
- Se abrirá una ventana modal con todos los detalles del pedido
- Puedes ver y editar la información completa

---

## 🏷️ **INFORMACIÓN EN LAS TARJETAS:**

Cada tarjeta muestra:

```
┌──────────────────────────┐
│ ⋮⋮ #12345       [URGENTE]│  ← Número de pedido + Prioridad
│                          │
│ 👤 Juan Pérez            │  ← Nombre del cliente
│ 📞 8888-8888             │  ← Teléfono
│                          │
│ 📦 Camiseta Personalizada│  ← Producto
│ 📍 San José              │  ← Ubicación (solo EA)
│                          │
│ [EA]              ₡5,000 │  ← Tipo y Total
│ 📅 15 Oct                │  ← Fecha
└──────────────────────────┘
```

### **Indicadores Especiales:**

- 🔴 **Borde rojo**: Pedido urgente (más de 3 días)
- 🏷️ **Badge "URGENTE"**: Pedido prioritario
- 📍 **Ubicación**: Solo se muestra para pedidos EA (Envíos)

---

## 🎯 **CASOS DE USO:**

### **1. Procesar un Pedido Nuevo:**
```
PENDIENTE → EN PROCESO
```
Cuando empiezas a trabajar en un pedido, arrástralo de "Pendiente" a "En Proceso".

### **2. Completar un Pedido:**
```
EN PROCESO → COMPLETADO
```
Cuando terminas la producción, muévelo a "Completado".

### **3. Enviar un Pedido:**
```
COMPLETADO → ENVIADO
```
Después de despachar, muévelo a "Enviado".

### **4. Confirmar Entrega:**
```
ENVIADO → ENTREGADO
```
Una vez confirmada la entrega, muévelo a "Entregado".

---

## 💡 **TIPS Y TRUCOS:**

### **✅ Buenas Prácticas:**

1. **Actualiza constantemente**: Mantén los pedidos en su estado real
2. **Revisa las urgencias**: Los pedidos con borde rojo necesitan atención inmediata
3. **Usa filtros**: Combina la vista Kanban con búsqueda y filtros
4. **Desplázate horizontalmente**: Usa el scroll para ver todas las columnas

### **⚡ Atajos:**

- **Buscar**: Usa la barra de búsqueda antes de cambiar a Kanban
- **Filtrar**: Aplica filtros de estado o fecha antes de ver el Kanban
- **Cambiar vista**: Alterna entre vistas según la tarea

---

## 🔄 **COMBINANDO VISTAS:**

### **Vista de Tabla** (📊)
**Mejor para**: Ver muchos detalles a la vez, exportar datos

### **Vista Kanban** (📋) ⭐
**Mejor para**: Gestionar flujo de trabajo, cambiar estados rápidamente

### **Vista Móvil** (📱)
**Mejor para**: Dispositivos móviles, proceso paso a paso

**💡 Consejo**: Usa la vista que mejor se adapte a tu tarea actual.

---

## ⚙️ **CARACTERÍSTICAS ESPECIALES:**

### **Búsqueda y Filtros:**
- La búsqueda funciona en la vista Kanban
- Los filtros de estado, fecha, etc. también funcionan
- Solo verás los pedidos que coincidan con tus filtros

### **Actualización Automática:**
- Los pedidos se actualizan automáticamente cada 30 segundos
- Los cambios de otros usuarios aparecerán automáticamente

### **Notificaciones:**
- ✅ **Verde**: Acción completada con éxito
- ❌ **Rojo**: Error (intenta de nuevo)

---

## ❓ **SOLUCIÓN DE PROBLEMAS:**

### **No puedo arrastrar una tarjeta:**
- ✅ Asegúrate de hacer clic en el ícono de agarre (`⋮⋮`)
- ✅ Mantén presionado el botón del mouse
- ✅ Verifica que tienes permisos de edición

### **La tarjeta vuelve a su lugar original:**
- ❌ Puede haber un error de conexión
- ✅ Revisa tu internet
- ✅ Intenta de nuevo

### **No veo todas las columnas:**
- ✅ Desplázate horizontalmente
- ✅ Usa la rueda del mouse o la barra de scroll

### **Los cambios no se guardan:**
- ✅ Verifica que aparezca la notificación de éxito
- ✅ Si no aparece, el cambio no se guardó
- ✅ Intenta nuevamente

---

## 🎓 **APRENDIZAJE PROGRESIVO:**

### **Nivel 1: Básico**
- Cambiar a vista Kanban
- Leer la información de las tarjetas
- Entender las columnas

### **Nivel 2: Intermedio**
- Arrastrar y soltar pedidos
- Ver detalles de pedidos
- Identificar urgencias

### **Nivel 3: Avanzado**
- Combinar con filtros y búsqueda
- Gestionar múltiples pedidos rápidamente
- Optimizar el flujo de trabajo

---

## 📞 **NECESITAS AYUDA?**

Si tienes problemas o preguntas:
1. Haz clic en el botón "**Guía de Uso**" en la parte superior
2. Consulta esta documentación
3. Contacta al administrador del sistema

---

## 🎉 **BENEFICIOS:**

✅ **Más rápido**: Cambiar estados con un solo movimiento  
✅ **Visual**: Ver el flujo completo de un vistazo  
✅ **Intuitivo**: Similar a herramientas populares como Trello  
✅ **Productivo**: Gestionar más pedidos en menos tiempo  

---

**¡Disfruta tu nueva Vista Kanban!** 🚀

---

**Actualizado:** Octubre 21, 2025  
**Versión:** 1.0  
**Compatible con:** Módulo de Producción de Betsy CRM
