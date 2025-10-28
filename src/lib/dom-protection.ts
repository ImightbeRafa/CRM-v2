/**
 * DOM Protection Utilities
 * 
 * This module provides utilities to prevent DOM manipulation errors
 * that can occur when React tries to manipulate DOM nodes that have
 * already been removed or are in an invalid state.
 */

import React from 'react';

// Track mounted components to prevent operations on unmounted components
const mountedComponents = new Set<string>();

// Track active timeouts and intervals for cleanup
const activeTimeouts = new Set<NodeJS.Timeout>();
const activeIntervals = new Set<NodeJS.Timeout>();

/**
 * Register a component as mounted
 */
export function registerMountedComponent(componentId: string): void {
  mountedComponents.add(componentId);
}

/**
 * Unregister a component as mounted
 */
export function unregisterMountedComponent(componentId: string): void {
  mountedComponents.delete(componentId);
}

/**
 * Check if a component is still mounted
 */
export function isComponentMounted(componentId: string): boolean {
  return mountedComponents.has(componentId);
}

/**
 * Safe setTimeout that automatically cleans up on component unmount
 */
export function safeSetTimeout(
  callback: () => void,
  delay: number,
  componentId: string
): NodeJS.Timeout | null {
  if (!isComponentMounted(componentId)) {
    return null;
  }

  const timeoutId = setTimeout(() => {
    if (isComponentMounted(componentId)) {
      callback();
    }
    activeTimeouts.delete(timeoutId);
  }, delay);

  activeTimeouts.add(timeoutId);
  return timeoutId;
}

/**
 * Safe setInterval that automatically cleans up on component unmount
 */
export function safeSetInterval(
  callback: () => void,
  delay: number,
  componentId: string
): NodeJS.Timeout | null {
  if (!isComponentMounted(componentId)) {
    return null;
  }

  const intervalId = setInterval(() => {
    if (isComponentMounted(componentId)) {
      callback();
    } else {
      clearInterval(intervalId);
      activeIntervals.delete(intervalId);
    }
  }, delay);

  activeIntervals.add(intervalId);
  return intervalId;
}

/**
 * Safe clearTimeout
 */
export function safeClearTimeout(timeoutId: NodeJS.Timeout | null): void {
  if (timeoutId) {
    clearTimeout(timeoutId);
    activeTimeouts.delete(timeoutId);
  }
}

/**
 * Safe clearInterval
 */
export function safeClearInterval(intervalId: NodeJS.Timeout | null): void {
  if (intervalId) {
    clearInterval(intervalId);
    activeIntervals.delete(intervalId);
  }
}

/**
 * Clean up all active timeouts and intervals
 */
export function cleanupAllTimers(): void {
  activeTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
  activeIntervals.forEach(intervalId => clearInterval(intervalId));
  activeTimeouts.clear();
  activeIntervals.clear();
}

/**
 * Safe state setter that only updates if component is mounted
 */
export function safeSetState<T>(
  setState: React.Dispatch<React.SetStateAction<T>>,
  newState: T | ((prevState: T) => T),
  componentId: string
): void {
  if (isComponentMounted(componentId)) {
    setState(newState);
  }
}

/**
 * Generate a unique component ID
 */
export function generateComponentId(prefix: string = 'component'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * DOM manipulation error handler
 */
export function handleDOMError(error: Error, componentId: string): void {
  if (error.name === 'NotFoundError' && error.message.includes('removeChild')) {
    console.error('🚨 DOM Manipulation Error Prevented:', {
      error: error.message,
      componentId,
      timestamp: new Date().toISOString(),
      mountedComponents: Array.from(mountedComponents),
      activeTimeouts: activeTimeouts.size,
      activeIntervals: activeIntervals.size
    });
    
    // Clean up any stale references
    unregisterMountedComponent(componentId);
  }
}

/**
 * React hook for DOM protection
 */
export function useDOMProtection(componentName: string = 'Unknown') {
  const componentId = React.useMemo(() => generateComponentId(componentName), [componentName]);
  
  React.useEffect(() => {
    registerMountedComponent(componentId);
    
    return () => {
      unregisterMountedComponent(componentId);
    };
  }, [componentId]);

  return {
    componentId,
    isMounted: () => isComponentMounted(componentId),
    safeSetTimeout: (callback: () => void, delay: number) => 
      safeSetTimeout(callback, delay, componentId),
    safeSetInterval: (callback: () => void, delay: number) => 
      safeSetInterval(callback, delay, componentId),
    safeSetState: <T>(setState: React.Dispatch<React.SetStateAction<T>>, newState: T | ((prevState: T) => T)) => 
      safeSetState(setState, newState, componentId)
  };
}

// Global error handler for DOM manipulation errors
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (event.error?.name === 'NotFoundError' && event.error?.message?.includes('removeChild')) {
      console.error('🚨 Global DOM Manipulation Error Caught:', {
        error: event.error.message,
        stack: event.error.stack,
        timestamp: new Date().toISOString(),
        url: window.location.href
      });
      
      // Clean up all timers to prevent further issues
      cleanupAllTimers();
    }
  });
}
