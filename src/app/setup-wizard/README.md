# Setup Wizard - User Guide & Developer Documentation

## Overview
The Setup Wizard guides new users through the initial configuration of their Betsy CRM tenant. It features a multi-step process with improved UX including unsaved changes detection, confirmation dialogs, and flexible navigation.

## User Features

### ✅ Unsaved Changes Detection
- **Visual indicator**: Animated badge appears in header when there are unsaved changes
- **Exit protection**: Warning dialog before exiting with unsaved changes
- **Navigation protection**: Confirmation before moving to next/previous step
- **Browser protection**: Warns before closing/refreshing browser tab with unsaved changes

### 🚀 Flexible Navigation
- **Forward navigation**: "Siguiente" button to move forward
- **Backward navigation**: "Anterior" button to go back (always enabled except first step)
- **Skip optional steps**: "Omitir" button for optional steps
- **Exit anytime**: "Salir" button in header redirects to dashboard

### 📊 Progress Tracking
- **Visual progress bar**: Shows overall completion percentage
- **Step indicators**: Sidebar with all steps, showing completed/current/pending status
- **Completion badges**: Green checkmarks for completed steps

### 💾 Save Behavior
- Each step saves independently when you click "Guardar" or the step's save button
- Saved data is persisted immediately to database
- Can exit and return later - progress is maintained
- Optional steps can be skipped and completed later from Config page

## Steps

1. **Bienvenido** (Welcome) - Required, informational only
2. **Información del Negocio** (Business Info) - Optional, custom business fields
3. **Campos Personalizados** (Custom Fields) - Optional, product custom fields
4. **Estados de Pedidos** (Order Status) - Required, workflow statuses
5. **Inventario** (Inventory) - Optional, products and stock
6. **Clientes Frecuentes** (Frequent Clients) - Optional, common customers
7. **Productos Frecuentes** (Frequent Products) - Optional, product catalog
8. **Vendedores** (Sellers) - Optional, sales team
9. **Configuración de Envíos** (Shipping) - Optional, delivery methods
10. **¡Listo!** (Completion) - Required, marks wizard as complete

## Developer Documentation

### Architecture

#### Main Component: `SetupWizard.tsx`
Manages the overall wizard state and navigation flow.

**Key State Variables:**
```typescript
const [currentStepIndex, setCurrentStepIndex] = useState(0);
const [steps, setSteps] = useState<WizardStep[]>(...);
const [canProceed, setCanProceed] = useState(false);
const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
const [showExitDialog, setShowExitDialog] = useState(false);
const [showNavigationDialog, setShowNavigationDialog] = useState(false);
```

**Key Functions:**
- `markCompleted()` - Mark current step as completed, clears unsaved changes
- `markUnsavedChanges(boolean)` - Track when step has unsaved changes
- `handleNext()` - Navigate forward (with unsaved changes check)
- `handleBack()` - Navigate backward (with unsaved changes check)
- `handleExit()` - Exit to dashboard (with unsaved changes check)
- `confirmNavigation()` - Proceed with navigation, discarding changes
- `confirmExit()` - Exit wizard, discarding changes

### Creating a New Step Component

Each step must implement the `WizardStepProps` interface:

```typescript
export interface WizardStepProps {
  onNext: () => void;                              // Navigate to next step
  onSkip: () => void;                              // Skip this step (if optional)
  onBack: () => void;                              // Navigate to previous step
  markCompleted: () => void;                       // Mark this step as completed
  markUnsavedChanges: (hasChanges: boolean) => void; // Track unsaved changes
  isFirst: boolean;                                // Is this the first step?
  isLast: boolean;                                 // Is this the last step?
}
```

#### Example Step Implementation:

```typescript
'use client';

import React, { useState, useEffect } from 'react';
import { WizardStepProps } from '../SetupWizard';

export function MyStep({ onNext, markCompleted, markUnsavedChanges }: WizardStepProps) {
  const [data, setData] = useState<MyData[]>([]);
  const [initialData, setInitialData] = useState<MyData[]>([]);
  const [loading, setLoading] = useState(false);

  // Load existing data on mount
  useEffect(() => {
    loadExistingData();
  }, []);

  // Track changes
  useEffect(() => {
    const hasChanges = JSON.stringify(data) !== JSON.stringify(initialData);
    markUnsavedChanges(hasChanges);
  }, [data, initialData, markUnsavedChanges]);

  const loadExistingData = async () => {
    try {
      const response = await fetch('/api/my-endpoint');
      if (response.ok) {
        const result = await response.json();
        if (result.status === 'success' && result.data?.length > 0) {
          setData(result.data);
          setInitialData(result.data); // Store initial state
          markCompleted(); // Mark as completed if data exists
        }
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      // Save to API
      for (const item of data) {
        const response = await fetch('/api/my-endpoint', {
          method: item.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });
        
        if (!response.ok) {
          throw new Error('Failed to save');
        }
      }

      // Success!
      markCompleted();
      setInitialData(data); // Update initial state
      markUnsavedChanges(false); // Clear unsaved changes flag
      
      // Auto-advance after short delay
      setTimeout(onNext, 800);
    } catch (error) {
      console.error('Error saving:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Your step UI here */}
      
      <Button onClick={handleSave} disabled={loading}>
        {loading ? 'Guardando...' : 'Guardar y Continuar'}
      </Button>
    </div>
  );
}
```

### Best Practices

#### 1. Always Track Unsaved Changes
```typescript
useEffect(() => {
  const hasChanges = JSON.stringify(data) !== JSON.stringify(initialData);
  markUnsavedChanges(hasChanges);
}, [data, initialData, markUnsavedChanges]);
```

#### 2. Store Initial State
```typescript
const [data, setData] = useState<MyData[]>([]);
const [initialData, setInitialData] = useState<MyData[]>([]);
```

#### 3. Clear Unsaved Changes on Save
```typescript
markCompleted();
setInitialData(data); // Sync initial state
markUnsavedChanges(false); // Clear flag
```

#### 4. Auto-Complete Informational Steps
For steps without forms (like Welcome or Completion):
```typescript
useEffect(() => {
  markCompleted();
}, [markCompleted]);
```

#### 5. Validate Before Saving
```typescript
const invalidItems = data.filter(item => !item.name);
if (invalidItems.length > 0) {
  toast({
    title: 'Campos incompletos',
    description: 'Por favor completa todos los campos.',
    variant: 'destructive'
  });
  return;
}
```

### UI Components Used

- **Card** - Main container for step content
- **Button** - Actions (save, next, skip, back)
- **Badge** - Optional label, unsaved changes indicator
- **Progress** - Overall wizard progress bar
- **AlertDialog** - Confirmation dialogs for unsaved changes
- **Toast** - Success/error notifications
- **Input, Label, Select** - Form controls

### API Integration

Each step should:
1. **Load** existing data on mount (GET request)
2. **Save** data when user clicks save (POST/PUT requests)
3. **Handle errors** gracefully with user-friendly messages
4. **Mark as completed** after successful save

### Testing Checklist

- [ ] Step loads existing data correctly
- [ ] Unsaved changes are detected when editing
- [ ] Warning appears when trying to navigate with unsaved changes
- [ ] Warning appears when trying to exit with unsaved changes
- [ ] Warning appears when trying to close browser with unsaved changes
- [ ] Data saves correctly to API
- [ ] Step marks as completed after save
- [ ] Unsaved changes indicator clears after save
- [ ] Can skip optional steps
- [ ] Can go back to previous steps
- [ ] Progress bar updates correctly
- [ ] Sidebar shows correct step status

## Troubleshooting

### Issue: Unsaved changes not being tracked
**Solution**: Ensure you're calling `markUnsavedChanges()` in a `useEffect` that watches your data state.

### Issue: Confirmation dialog not showing
**Solution**: Make sure you're calling `markUnsavedChanges(true)` when data changes.

### Issue: Step doesn't mark as completed
**Solution**: Call `markCompleted()` after successful API save.

### Issue: Navigation not working
**Solution**: Don't call `onNext()` directly - let the wizard handle navigation after `markCompleted()`.

## Future Improvements

- [ ] Add step-by-step progress persistence to local storage
- [ ] Add "Save Draft" button for partial progress
- [ ] Add bulk import for common configurations
- [ ] Add step validation before allowing navigation
- [ ] Add keyboard shortcuts (Ctrl+S to save, etc.)
- [ ] Add step templates/presets
- [ ] Add undo/redo functionality within steps
