/**
 * Re-export useTenantSettings for easier currency formatting access
 * This allows components to just import useCurrency instead of the full context
 */

export { useTenantSettings as useCurrency } from '../contexts/TenantSettingsContext';

