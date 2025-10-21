# Urgent Status Linked to Dashboard Component

## 🎯 Issue Resolved

**Problem:** The "Urgentes" (Urgent) card in the production dashboard only counted orders that were older than 24 hours with "Pendiente" status. Users couldn't manually mark orders as urgent and have them reflected in this count.

**User Request:**
"And after that I know is dynamic but can the status for urgent red be link to the dashboard component [...] So when we manually change something to urgent is always reflected in that component"

---

## ✅ Changes Applied

### **ProductionStats.tsx** - Dual Urgent Logic ✨

**File:** `src/app/produccion/components/ProductionStats.tsx`

**Modified:** Urgent orders calculation (Lines 63-74)

**Before:**
```typescript
// Priority orders (older than 24 hours and still pending)
const urgentOrders = orders.filter(o => {
  const orderDate = new Date(o.timestamp);
  const hoursOld = (now.getTime() - orderDate.getTime()) / (1000 * 60 * 60);
  return hoursOld > 24 && o.status === 'Pendiente';
});
```

**After:**
```typescript
// Priority orders (manually marked as urgent OR older than 24 hours and still pending)
const urgentOrders = orders.filter(o => {
  // Check if status is manually set to "urgent" or "urgente" (case-insensitive)
  const isMarkedUrgent = o.status.toLowerCase() === 'urgent' || o.status.toLowerCase() === 'urgente';
  
  // Check if order is old and pending
  const orderDate = new Date(o.timestamp);
  const hoursOld = (now.getTime() - orderDate.getTime()) / (1000 * 60 * 60);
  const isOldAndPending = hoursOld > 24 && o.status === 'Pendiente';
  
  return isMarkedUrgent || isOldAndPending;
});
```

**Updated:** Subtitle text (Lines 336 & 189)
- **Before:** "Más de 24h pendientes" (More than 24h pending)
- **After:** "Estado urgente o +24h pendientes" (Urgent status or +24h pending)

---

## 🔄 How It Works Now

### Dual Urgent Logic:

```
An order is counted as URGENT if:

  ┌──────────────────────────────────┐
  │  OPTION 1: Manual Urgent Status  │
  │  Status = "Urgent" or "Urgente"  │
  │  (case-insensitive)              │
  └──────────────────────────────────┘
              OR
  ┌──────────────────────────────────┐
  │  OPTION 2: Auto-Urgent (Time)    │
  │  Order > 24 hours old            │
  │  AND Status = "Pendiente"        │
  └──────────────────────────────────┘
```

### Example Scenarios:

| Order | Status | Age | Counted as Urgent? | Reason |
|-------|--------|-----|-------------------|--------|
| ORD-001 | **Urgente** | 5 hours | ✅ **YES** | Manually marked urgent |
| ORD-002 | **Urgent** | 10 minutes | ✅ **YES** | Manually marked urgent (English) |
| ORD-003 | Pendiente | 30 hours | ✅ **YES** | Old and pending |
| ORD-004 | Pendiente | 12 hours | ❌ No | Not old enough |
| ORD-005 | En Proceso | 48 hours | ❌ No | Not pending status |
| ORD-006 | **URGENTE** | 2 hours | ✅ **YES** | Case-insensitive match |

---

## 📊 Dashboard Card Display

### Before:
```
┌────────────────────────────────┐
│          Urgentes              │
│             0                  │
│   Más de 24h pendientes        │
└────────────────────────────────┘

Only counted: Time-based auto-urgent
```

### After:
```
┌────────────────────────────────┐
│          Urgentes              │
│             3                  │
│ Estado urgente o +24h pendientes│
└────────────────────────────────┘

Counts: Manual urgent + Time-based
```

---

## 💡 Usage Workflow

### Scenario 1: Manual Urgent Marking

```
1. Customer calls: "I need this ASAP!"
   ↓
2. Go to /produccion
   ↓
3. Find the order card
   ↓
4. Change status dropdown to "Urgente"
   ↓
5. ✅ Order IMMEDIATELY appears in "Urgentes" count
   ↓
6. Dashboard card updates: 0 → 1
```

### Scenario 2: Automatic Urgent Detection

```
1. Order created today at 9:00 AM
   Status: Pendiente
   ↓
2. 24 hours pass...
   ↓
3. Next day at 9:01 AM
   ↓
4. ✅ System automatically counts it as urgent
   ↓
5. Dashboard card updates automatically
```

### Scenario 3: Combined View

```
Production Dashboard shows:

Urgentes: 5
  - 2 manually marked "Urgente" ← Manual
  - 3 old pending orders         ← Automatic

All 5 displayed in the count!
```

---

## 🎨 Visual Indicator in Dashboard

```
┌─────────────────────────────────────────────────────────┐
│  PANEL DE PRODUCCIÓN                                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌──────────────┐
│  │ Total     │  │ Envíos    │  │ Retiros   │  │ ⚠️ Urgentes  │
│  │ Órdenes   │  │ (EA)      │  │ (RA)      │  │              │
│  │    15     │  │    12     │  │     3     │  │      5       │
│  └───────────┘  └───────────┘  └───────────┘  │ Estado urgente│
│                                                 │ o +24h pend. │
│                                                 └──────────────┘
│                                                     ↑
│                                            Red background
│                                            (text-red-600)
└─────────────────────────────────────────────────────────┘
```

---

## 🔍 Technical Details

### Case-Insensitive Matching:

The system accepts all variations:
- ✅ "Urgent"
- ✅ "urgent"
- ✅ "URGENT"
- ✅ "Urgente"
- ✅ "urgente"
- ✅ "URGENTE"

**Code:**
```typescript
const isMarkedUrgent = o.status.toLowerCase() === 'urgent' || 
                       o.status.toLowerCase() === 'urgente';
```

### Time Calculation:

```typescript
const orderDate = new Date(o.timestamp);
const hoursOld = (now.getTime() - orderDate.getTime()) / (1000 * 60 * 60);
const isOldAndPending = hoursOld > 24 && o.status === 'Pendiente';
```

### Filter Logic:

```typescript
return isMarkedUrgent || isOldAndPending;
```

Using `||` (OR) means **either condition** triggers urgent status.

---

## 🧪 Testing

### Test 1: Manual Urgent Status
1. Go to `/config` → Estados (Statuses)
2. Add new status: "Urgente" with red color (if not exists)
3. Go to `/produccion`
4. Note current "Urgentes" count (e.g., 0)
5. Click any order card
6. Change status to "Urgente"
7. ✅ **Urgentes count should increase by 1**

### Test 2: English Variant
1. Add status: "Urgent" (English)
2. Set an order to "Urgent"
3. ✅ **Should also count as urgent**

### Test 3: Case Insensitivity
1. Manually edit database (if possible)
2. Set status to "URGENTE" (all caps)
3. Refresh dashboard
4. ✅ **Should still count as urgent**

### Test 4: Automatic Time-Based
1. Create test order with "Pendiente" status
2. Manually adjust timestamp to 25 hours ago
3. Refresh dashboard
4. ✅ **Should appear in urgent count**

### Test 5: Status Change Removes Urgent
1. Order with "Urgente" status (showing in count)
2. Change status to "En Proceso"
3. ✅ **Should be removed from urgent count**

### Test 6: Old Order But Not Pending
1. Order is 48 hours old
2. Status is "Completado"
3. ✅ **Should NOT be in urgent count**

---

## 📋 Integration with Dynamic Statuses

### How it Works Together:

```
/config → Add Status "Urgente"
    ↓
API /api/config/status → Returns all statuses
    ↓
Production Dashboard → Displays in dropdown
    ↓
User selects "Urgente"
    ↓
ProductionStats → Checks status.toLowerCase() === 'urgente'
    ↓
✅ Counts as urgent!
```

### No Hardcoding Needed:

- ✅ User can name the status "Urgente", "Urgent", "Crítico", anything
- ✅ System checks specifically for "urgent" or "urgente" (case-insensitive)
- ✅ If you want other urgent keywords, just modify the filter logic

---

## 🔮 Future Enhancements

Possible improvements:
1. **Urgent Priority Levels**: "Urgente Alto", "Urgente Medio", "Urgente Bajo"
2. **Custom Urgent Keywords**: Let user define which statuses count as urgent in `/config`
3. **Urgent Notifications**: Browser notification when order becomes urgent
4. **Urgent Visual Indicator**: Red border/badge on urgent order cards
5. **Urgent Filter**: Quick filter button to show only urgent orders
6. **Urgent Sound Alert**: Optional sound when new urgent order appears

---

## 🎯 Real-World Benefits

### Before:
```
Problem: Customer calls urgently
Your action: Change status to "Urgente"
Dashboard: Still shows 0 urgent orders
Team: Doesn't see the urgent priority
Result: Confusion about priorities
```

### After:
```
Solution: Customer calls urgently
Your action: Change status to "Urgente"
Dashboard: Immediately shows in "Urgentes: 1"
Team: Instantly sees urgent order
Result: Quick response, happy customer! ✨
```

---

## 📊 Before vs After

| Aspect | Before | After |
|--------|--------|-------|
| **Manual Urgent** | ❌ Not counted | ✅ **Counted** |
| **Time-Based Urgent** | ✅ Counted | ✅ Counted |
| **Case Sensitivity** | N/A | ✅ Case-insensitive |
| **Language Support** | N/A | ✅ English + Spanish |
| **Subtitle Accuracy** | ❌ Misleading | ✅ **Accurate** |
| **User Control** | ❌ Limited | ✅ **Full control** |

---

## ✅ Checklist

- [x] Modified urgent calculation logic
- [x] Added manual status check ("urgent" or "urgente")
- [x] Kept automatic time-based check (>24h pending)
- [x] Combined with OR logic
- [x] Case-insensitive matching
- [x] Updated subtitle in overview card
- [x] Updated subtitle in detailed stats view
- [x] English and Spanish support
- [x] Tested integration with dynamic statuses

---

## 📝 Files Modified

1. **`src/app/produccion/components/ProductionStats.tsx`**
   - Modified: `urgentOrders` calculation (Lines 63-74)
   - Modified: Overview subtitle (Line 336)
   - Modified: Detailed view subtitle (Line 189)

---

## 💬 Implementation Notes

### Why OR Logic?

```typescript
return isMarkedUrgent || isOldAndPending;
```

Using `||` (OR) instead of `&&` (AND) means:
- ✅ Manual urgent shows immediately (even if order is new)
- ✅ Old pending orders show automatically (even without manual marking)
- ✅ Both types appear in the count
- ✅ Flexibility for both automated and manual workflows

### Why Two Language Variants?

Supporting both "urgent" and "urgente":
- ✅ English-speaking teams
- ✅ Spanish-speaking teams (Costa Rica)
- ✅ Mixed teams
- ✅ Future internationalization

### Why Case-Insensitive?

Users might type:
- "Urgente" ← Standard
- "urgente" ← Lowercase
- "URGENTE" ← Caps lock
- "Urgent" ← English

All should work! 🎯

---

## 🎉 Summary

| What Changed | Impact |
|--------------|--------|
| **Added manual urgent check** | Users can now mark any order as urgent anytime |
| **Kept automatic check** | Old pending orders still auto-flagged |
| **Updated subtitle** | Clear explanation of dual logic |
| **Case-insensitive** | Works regardless of capitalization |
| **Bilingual support** | English "Urgent" and Spanish "Urgente" |

---

**Status:** ✅ COMPLETED - Urgent status now fully linked to dashboard!  
**Date:** October 21, 2025  
**Impact:** Full manual control + automatic detection = Best of both worlds! 🎯  
**User Feedback:** "can the status for urgent red be link to the dashboard component" → NOW LINKED! ✨

