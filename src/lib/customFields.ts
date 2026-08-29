/**
 * Unified Custom Fields Service
 * 
 * This service provides consistent handling of custom fields across the entire application,
 * including the Telegram bot, order forms, and order details.
 * 
 * Custom fields are tenant-specific fields that businesses can configure for their specific needs.
 * They are stored in the customFields JSON column of the Order model.
 */

import { z } from 'zod';

// Types for custom fields
export interface CustomField {
  id: string;
  key: string;
  label: string;
  type: string; // Allow any string type from database
  required: boolean;
  order: number;
  optionSetId?: string | null;
  multiSelect: boolean;
  active: boolean;
  options?: Array<{
    id: string;
    label: string;
    value: string;
    priceDelta?: number;
  }>;
}

export interface BusinessInfoField {
  id: string;
  name: string;
  type: string;
  label: string;
  placeholder?: string | null;
  options?: string | null;
  required: boolean;
  order: number;
  isActive: boolean;
}

export interface CustomFieldsData {
  productFields: CustomField[];
  businessInfoFields: BusinessInfoField[];
}

/**
 * Extract custom fields from various data sources
 * This handles the different ways custom fields might be stored or passed
 */
export function extractCustomFields(data: any, customFieldsConfig: CustomFieldsData): Record<string, any> {
  const customFields: Record<string, any> = {};

  // Process product fields
  customFieldsConfig.productFields.forEach(field => {
    const value = getFieldValue(data, field.key);
    if (value !== undefined && value !== null && value !== '') {
      customFields[field.key] = sanitizeFieldValue(value, field.type);
    }
  });

  // Process business info fields
  customFieldsConfig.businessInfoFields.forEach(field => {
    const value = getFieldValue(data, field.name);
    if (value !== undefined && value !== null && value !== '') {
      customFields[field.name] = sanitizeFieldValue(value, field.type);
    }
  });

  return customFields;
}

/**
 * Get a field value from the order data
 * Checks multiple sources: customFields JSON, direct properties, productDetails
 */
function getFieldValue(data: any, fieldKey: string): any {
  // 1. Primary source: customFields JSON column
  if (data.customFields) {
    try {
      const customFieldsData = typeof data.customFields === 'string'
        ? JSON.parse(data.customFields)
        : data.customFields;

      if (customFieldsData[fieldKey] !== undefined && customFieldsData[fieldKey] !== null && customFieldsData[fieldKey] !== '') {
        return customFieldsData[fieldKey];
      }
    } catch (e) {
      // Ignore parsing errors
    }
  }

  // 2. Direct property on order (for legacy storage or product-level fields)
  if (data[fieldKey] !== undefined && data[fieldKey] !== null && data[fieldKey] !== '') {
    return data[fieldKey];
  }

  // 3. Fallback: productDetails JSON (legacy storage)
  if (data.productDetails) {
    try {
      const productDetails = typeof data.productDetails === 'string'
        ? JSON.parse(data.productDetails)
        : data.productDetails;

      // Check customFields within productDetails
      if (productDetails.customFields && productDetails.customFields[fieldKey] !== undefined) {
        return productDetails.customFields[fieldKey];
      }

      // Check direct property in productDetails
      if (productDetails[fieldKey] !== undefined) {
        return productDetails[fieldKey];
      }

      // Check if productDetails is an array (multiple products)
      if (Array.isArray(productDetails) && productDetails.length > 0) {
        // Get values from all products and join them
        const values = productDetails
          .map((p: any) => p[fieldKey])
          .filter((v: any) => v !== undefined && v !== null && v !== '');
        if (values.length > 0) {
          return values.join(', ');
        }
      }
    } catch (e) {
      // Ignore parsing errors
    }
  }

  return undefined;
}

/**
 * Sanitize a field value based on its type
 */
function sanitizeFieldValue(value: any, fieldType: string): any {
  if (value === null || value === undefined) {
    return null;
  }

  switch (fieldType) {
    case 'number':
      const num = Number(value);
      return isNaN(num) ? null : num;

    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        return value.toLowerCase() === 'true' || value === '1';
      }
      return Boolean(value);

    case 'date':
      if (value instanceof Date) return value.toISOString();
      if (typeof value === 'string') {
        const date = new Date(value);
        return isNaN(date.getTime()) ? null : date.toISOString();
      }
      return null;

    case 'select':
    case 'text':
    case 'email':
    case 'tel':
    case 'textarea':
    default:
      return String(value).trim();
  }
}

/**
 * Validate custom fields against their configuration
 */
export function validateCustomFields(
  customFields: Record<string, any>,
  customFieldsConfig: CustomFieldsData
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check required product fields
  customFieldsConfig.productFields.forEach(field => {
    if (field.required) {
      const value = customFields[field.key];
      if (value === undefined || value === null || value === '') {
        errors.push(`El campo "${field.label}" es requerido`);
      }
    }
  });

  // Check required business info fields
  customFieldsConfig.businessInfoFields.forEach(field => {
    if (field.required) {
      const value = customFields[field.name];
      if (value === undefined || value === null || value === '') {
        errors.push(`El campo "${field.label}" es requerido`);
      }
    }
  });

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Format custom fields for Telegram bot display
 */
export function formatCustomFieldsForTelegram(
  customFields: Record<string, any>,
  customFieldsConfig: CustomFieldsData
): string[] {
  const lines: string[] = [];

  // Add product fields
  customFieldsConfig.productFields.forEach(field => {
    const value = customFields[field.key];
    if (value !== undefined && value !== null && value !== '') {
      const displayValue = formatFieldValueForDisplay(value, field.type);
      lines.push(`${field.label}: ${displayValue}`);
    }
  });

  // Add business info fields
  customFieldsConfig.businessInfoFields.forEach(field => {
    const value = customFields[field.name];
    if (value !== undefined && value !== null && value !== '') {
      const displayValue = formatFieldValueForDisplay(value, field.type);
      lines.push(`${field.label}: ${displayValue}`);
    }
  });

  return lines;
}

/**
 * Format a field value for display
 */
function formatFieldValueForDisplay(value: any, fieldType: string): string {
  switch (fieldType) {
    case 'boolean':
      return value ? 'Sí' : 'No';

    case 'date':
      try {
        const date = new Date(value);
        return date.toLocaleDateString('es-CR');
      } catch {
        return String(value);
      }

    case 'number':
      return Number(value).toLocaleString('es-CR');

    default:
      return String(value);
  }
}

/**
 * Get custom fields schema for AI tools (Telegram bot)
 * Returns proper Zod schemas that can be spread into z.object()
 */
export function getCustomFieldsSchema(customFieldsConfig: CustomFieldsData): Record<string, z.ZodTypeAny> {
  const schema: Record<string, z.ZodTypeAny> = {};

  // Add product fields to schema
  customFieldsConfig.productFields.forEach(field => {
    const description = field.type === 'date'
      ? `${field.label || field.key} (format: YYYY-MM-DD)`
      : field.label || field.key;

    let fieldSchema: z.ZodTypeAny;

    if (field.type === 'number') {
      fieldSchema = z.number().describe(description);
    } else if (field.type === 'boolean') {
      fieldSchema = z.boolean().describe(description);
    } else if ((field.type === 'select' || field.type === 'multiselect') && field.options && field.options.length > 0) {
      // Use z.enum for select fields so the AI knows valid values
      const optionValues = field.options.map((o: any) => String(o.value || o.label));
      if (optionValues.length > 0) {
        fieldSchema = z.enum(optionValues as [string, ...string[]]).describe(description);
      } else {
        fieldSchema = z.string().describe(description);
      }
    } else {
      fieldSchema = z.string().describe(description);
    }

    // Make optional if not required
    if (!field.required) {
      fieldSchema = fieldSchema.optional();
    }

    schema[field.key] = fieldSchema;
  });

  // Add business info fields to schema
  customFieldsConfig.businessInfoFields.forEach(field => {
    const description = field.type === 'date'
      ? `${field.label || field.name} (format: YYYY-MM-DD)`
      : field.label || field.name;

    let fieldSchema: z.ZodTypeAny;

    if (field.type === 'number') {
      fieldSchema = z.number().describe(description);
    } else if (field.type === 'boolean') {
      fieldSchema = z.boolean().describe(description);
    } else {
      fieldSchema = z.string().describe(description);
    }

    // Make optional if not required
    if (!field.required) {
      fieldSchema = fieldSchema.optional();
    }

    schema[field.name] = fieldSchema;
  });

  return schema;
}

/**
 * Check if a field key matches a configured custom field
 * Custom fields are tenant-defined - no hardcoded mappings
 */
export function shouldDisplayField(
  fieldKey: string,
  customFieldsConfig: CustomFieldsData
): boolean {
  // Check if it's a configured product field (exact key match)
  const productField = customFieldsConfig.productFields.find(
    f => f.key === fieldKey
  );
  if (productField && productField.active) {
    return true;
  }

  // Check if it's a configured business info field
  const businessField = customFieldsConfig.businessInfoFields.find(
    f => f.name === fieldKey
  );
  if (businessField && businessField.isActive) {
    return true;
  }

  return false;
}

/**
 * Get the label for a field
 */
export function getFieldLabel(
  fieldKey: string,
  customFieldsConfig: CustomFieldsData
): string {
  // Check product fields first
  const productField = customFieldsConfig.productFields.find(
    f => f.key.toLowerCase() === fieldKey.toLowerCase()
  );
  if (productField) {
    return productField.label || productField.key;
  }

  // Check business info fields
  const businessField = customFieldsConfig.businessInfoFields.find(
    f => f.name.toLowerCase() === fieldKey.toLowerCase()
  );
  if (businessField) {
    return businessField.label || businessField.name;
  }

  return fieldKey;
}
