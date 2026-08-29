'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Clock, User, Trash2, Edit, Plus, AlertTriangle, Shield, Download,
  Filter, Activity, ToggleLeft, RefreshCw, ChevronDown, ChevronRight,
  X, FileText, Package, Settings, Users, Truck, Tag, Layers, RotateCcw
} from 'lucide-react'
import {
  buildFieldDiffLines,
  entriesForDisplay,
  hasMeaningfulOldValues,
  isNoisyAutoReason,
  normalizeEntityType,
} from '@/lib/auditPayload'

interface SimpleAuditDashboardProps {
  isMaster: boolean
  canRestore?: boolean
}

// ---------------------------------------------------------------------------
// Label maps
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Creación',
  UPDATE: 'Actualización',
  DELETE: 'Eliminación',
  BULK_DELETE: 'Eliminación masiva',
  BULK_UPDATE: 'Actualización masiva',
  BULK_TOGGLE: 'Cambio de estado masivo',
}

const ACTION_VERBS: Record<string, string> = {
  CREATE: 'creó',
  UPDATE: 'actualizó',
  DELETE: 'eliminó',
  BULK_DELETE: 'eliminó en masa',
  BULK_UPDATE: 'actualizó en masa',
  BULK_TOGGLE: 'cambió el estado de',
}

const ENTITY_LABELS: Record<string, string> = {
  order: 'Orden',
  orders: 'Orden',
  sale: 'Orden',
  user: 'Usuario',
  users: 'Usuario',
  field: 'Campo',
  fields: 'Campo',
  option: 'Opción',
  options: 'Opción',
  optionSet: 'Conjunto de opciones',
  optionSets: 'Conjunto de opciones',
  shipping: 'Envío',
  status: 'Estado',
  seller: 'Vendedor',
  sellers: 'Vendedor',
  config: 'Configuración',
  inventory: 'Inventario',
  inventoryitem: 'Inventario',
  client: 'Cliente',
  frequent_customer: 'Cliente frecuente',
  inventory_product: 'Producto',
}

const ENTITY_ARTICLE: Record<string, string> = {
  order: 'la orden',
  orders: 'la orden',
  sale: 'la orden',
  user: 'el usuario',
  users: 'el usuario',
  field: 'el campo',
  fields: 'el campo',
  option: 'la opción',
  options: 'la opción',
  optionSet: 'el conjunto de opciones',
  optionSets: 'el conjunto de opciones',
  shipping: 'el envío',
  status: 'el estado',
  seller: 'el vendedor',
  sellers: 'el vendedor',
  config: 'la configuración',
  inventory: 'el inventario',
  inventoryitem: 'el inventario',
  client: 'el cliente',
  frequent_customer: 'el cliente frecuente',
  inventory_product: 'el producto',
}

const ROLE_LABELS: Record<string, string> = {
  MASTER: 'Administrador',
  REGULAR: 'Usuario',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENTITY_ICONS: Record<string, React.ReactNode> = {
  order: <Package className="w-3.5 h-3.5" />,
  user: <Users className="w-3.5 h-3.5" />,
  field: <Settings className="w-3.5 h-3.5" />,
  option: <Tag className="w-3.5 h-3.5" />,
  optionSet: <Layers className="w-3.5 h-3.5" />,
  shipping: <Truck className="w-3.5 h-3.5" />,
  status: <Layers className="w-3.5 h-3.5" />,
  seller: <Users className="w-3.5 h-3.5" />,
  client: <Users className="w-3.5 h-3.5" />,
  inventory: <Package className="w-3.5 h-3.5" />,
}

function getActionIcon(action: string) {
  switch (action) {
    case 'CREATE': return <Plus className="w-4 h-4" />
    case 'UPDATE': return <Edit className="w-4 h-4" />
    case 'DELETE':
    case 'BULK_DELETE': return <Trash2 className="w-4 h-4" />
    case 'BULK_UPDATE': return <Edit className="w-4 h-4" />
    case 'BULK_TOGGLE': return <ToggleLeft className="w-4 h-4" />
    default: return <Clock className="w-4 h-4" />
  }
}

function getActionAccent(action: string) {
  switch (action) {
    case 'CREATE':
      return {
        border: 'border-l-emerald-500',
        badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20',
        icon: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        dot: 'bg-emerald-500',
      }
    case 'UPDATE':
    case 'BULK_UPDATE':
      return {
        border: 'border-l-blue-500',
        badge: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 ring-blue-500/20',
        icon: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
        dot: 'bg-blue-500',
      }
    case 'DELETE':
    case 'BULK_DELETE':
      return {
        border: 'border-l-red-500',
        badge: 'bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/20',
        icon: 'bg-red-500/10 text-red-600 dark:text-red-400',
        dot: 'bg-red-500',
      }
    case 'BULK_TOGGLE':
      return {
        border: 'border-l-purple-500',
        badge: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 ring-purple-500/20',
        icon: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
        dot: 'bg-purple-500',
      }
    default:
      return {
        border: 'border-l-muted-foreground',
        badge: 'bg-muted text-muted-foreground ring-border',
        icon: 'bg-muted text-muted-foreground',
        dot: 'bg-muted-foreground',
      }
  }
}

function getRelativeTime(timestamp: string): string {
  const now = Date.now()
  const then = new Date(timestamp).getTime()
  const diffSec = Math.floor((now - then) / 1000)

  if (diffSec < 60) return 'hace un momento'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffHrs = Math.floor(diffMin / 60)
  if (diffHrs < 24) return `hace ${diffHrs}h`
  const diffDays = Math.floor(diffHrs / 24)
  if (diffDays === 1) return 'ayer'
  if (diffDays < 7) return `hace ${diffDays} días`
  if (diffDays < 30) return `hace ${Math.floor(diffDays / 7)} sem`
  return new Date(timestamp).toLocaleDateString('es-CR', { day: 'numeric', month: 'short' })
}

function formatExactTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString('es-CR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function buildSummary(log: any): string {
  const verb = ACTION_VERBS[log.action] || log.action.toLowerCase()
  const normalized = normalizeEntityType(String(log.entityType || ''))
  const entity = ENTITY_ARTICLE[normalized] || ENTITY_ARTICLE[log.entityType] || log.entityType
  const name = log.entityName ? ` "${log.entityName}"` : ''
  return `${verb} ${entity}${name}`
}

function getDateGroupLabel(timestamp: string): string {
  const d = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  if (d.toDateString() === today.toDateString()) return 'Hoy'
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer'
  return d.toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function groupByDate(logs: any[]): { label: string; logs: any[] }[] {
  const groups: { label: string; logs: any[] }[] = []
  let current: { label: string; logs: any[] } | null = null

  for (const log of logs) {
    const label = getDateGroupLabel(log.timestamp)
    if (!current || current.label !== label) {
      current = { label, logs: [] }
      groups.push(current)
    }
    current.logs.push(log)
  }
  return groups
}

function getUserInitial(name: string): string {
  return (name || '?').charAt(0).toUpperCase()
}

function summarizeDetailForCsv(log: any): string {
  const changeList = Array.isArray(log.oldValues?.changes) ? log.oldValues.changes : []
  if (changeList.length) return changeList.join(' | ')

  const isDelete = log.action === 'DELETE' || log.action === 'BULK_DELETE'
  const isCreate = log.action === 'CREATE'

  if (isDelete) {
    const deleted = entriesForDisplay(log.oldValues)
    if (deleted.length) return deleted.map((e) => `${e.label}: ${e.value}`).join(' | ')
  }

  if (isCreate) {
    const created = entriesForDisplay(log.newValues)
    if (created.length) return created.map((e) => `${e.label}: ${e.value}`).join(' | ')
  }

  const diffs =
    !isCreate && !isDelete && hasMeaningfulOldValues(log.oldValues)
      ? buildFieldDiffLines(log.oldValues, log.newValues)
      : []
  if (diffs.length) return diffs.join(' | ')

  const payload = entriesForDisplay(log.newValues)
  if (payload.length) return payload.map((e) => `${e.label}: ${e.value}`).join(' | ')

  return log.reason && !isNoisyAutoReason(log.reason) ? log.reason : ''
}

function logHasRenderableDetails(log: any): boolean {
  const changeList = Array.isArray(log.oldValues?.changes) ? log.oldValues.changes : []
  if (changeList.length > 0) return true
  if (log.reason && !isNoisyAutoReason(log.reason)) return true

  const isDelete = log.action === 'DELETE' || log.action === 'BULK_DELETE'
  const isCreate = log.action === 'CREATE'

  if (isDelete && entriesForDisplay(log.oldValues).length > 0) return true
  if (isCreate && entriesForDisplay(log.newValues).length > 0) return true

  if (
    !isCreate &&
    !isDelete &&
    hasMeaningfulOldValues(log.oldValues) &&
    buildFieldDiffLines(log.oldValues, log.newValues).length > 0
  ) {
    return true
  }

  if (
    (log.action === 'BULK_UPDATE' || log.action === 'BULK_TOGGLE' || log.action === 'UPDATE') &&
    entriesForDisplay(log.newValues).length > 0
  ) {
    return true
  }

  if (log.reason) return true
  return false
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KeyValueGrid({
  entries,
  tone = 'neutral',
}: {
  entries: { key: string; label: string; value: string }[]
  tone?: 'neutral' | 'create' | 'delete'
}) {
  if (entries.length === 0) return null
  const toneClass =
    tone === 'create'
      ? 'bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-500/20'
      : tone === 'delete'
        ? 'bg-red-500/5 dark:bg-red-500/10 border-red-500/20'
        : 'bg-muted/50 border-border'

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
      {entries.map((entry) => (
        <div key={entry.key} className={`text-xs rounded-md px-3 py-1.5 border ${toneClass}`}>
          <span className="font-medium text-foreground">{entry.label}:</span>{' '}
          <span className="text-muted-foreground break-words">{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

function LogDetailPanel({
  log,
  onRestore,
  restoring,
}: {
  log: any
  onRestore?: (log: any) => void
  restoring?: boolean
}) {
  const changeList: string[] = Array.isArray(log.oldValues?.changes) ? log.oldValues.changes : []
  const isDelete = log.action === 'DELETE' || log.action === 'BULK_DELETE'
  const isCreate = log.action === 'CREATE'
  const isBulkMutation = log.action === 'BULK_UPDATE' || log.action === 'BULK_TOGGLE'

  // Never invent N/A→ diffs for CREATE/DELETE or when there is no real before-state
  const fieldDiffs =
    !isCreate &&
    !isDelete &&
    changeList.length === 0 &&
    hasMeaningfulOldValues(log.oldValues)
      ? buildFieldDiffLines(log.oldValues, log.newValues)
      : []
  const allChanges = changeList.length > 0 ? changeList : fieldDiffs

  const deletedEntries = isDelete ? entriesForDisplay(log.oldValues) : []
  const createdEntries = isCreate ? entriesForDisplay(log.newValues) : []
  const updatePayloadEntries =
    !isDelete && !isCreate && allChanges.length === 0
      ? entriesForDisplay(log.newValues)
      : []

  const showReason =
    !!log.reason &&
    !(
      isNoisyAutoReason(log.reason) &&
      (allChanges.length > 0 ||
        deletedEntries.length > 0 ||
        createdEntries.length > 0 ||
        updatePayloadEntries.length > 0)
    )

  if (
    !showReason &&
    allChanges.length === 0 &&
    deletedEntries.length === 0 &&
    createdEntries.length === 0 &&
    updatePayloadEntries.length === 0
  ) {
    return (
      <p className="text-xs text-muted-foreground italic pl-11 pt-1">
        Sin detalles adicionales.
      </p>
    )
  }

  return (
    <div className="pl-11 pt-2 space-y-2 animate-in slide-in-from-top-1 duration-150">
      {showReason && (
        <div className="flex items-start gap-2 text-sm bg-muted/50 rounded-lg px-3 py-2">
          <FileText className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <span className="text-muted-foreground">{log.reason}</span>
        </div>
      )}

      {allChanges.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cambios</span>
          <div className="grid gap-1">
            {allChanges.map((change: string, idx: number) => (
              <div key={idx} className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-1.5 border border-border">
                {change}
              </div>
            ))}
          </div>
        </div>
      )}

      {createdEntries.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Datos creados</span>
          <KeyValueGrid entries={createdEntries} tone="create" />
        </div>
      )}

      {deletedEntries.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Datos eliminados</span>
          <KeyValueGrid entries={deletedEntries} tone="delete" />
        </div>
      )}

      {log.restore?.eligible && onRestore && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2">
          <div className="text-xs text-muted-foreground">
            Restaurable hasta {new Date(log.restore.expiresAt).toLocaleString('es-CR')}.
            No se repetirán facturas, guías, pagos ni movimientos de inventario.
          </div>
          <button
            type="button"
            onClick={() => onRestore(log)}
            disabled={restoring}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${restoring ? 'animate-spin' : ''}`} />
            {restoring ? 'Restaurando' : 'Restaurar'}
          </button>
        </div>
      )}

      {updatePayloadEntries.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isBulkMutation ? 'Datos actualizados' : 'Valores'}
          </span>
          <KeyValueGrid entries={updatePayloadEntries} tone="neutral" />
        </div>
      )}
    </div>
  )
}

function LogEntry({
  log,
  isExpanded,
  onToggle,
  onRestore,
  restoring,
}: {
  log: any
  isExpanded: boolean
  onToggle: () => void
  onRestore?: (log: any) => void
  restoring?: boolean
}) {
  const accent = getActionAccent(log.action)
  const hasDetails = logHasRenderableDetails(log)
  const normalizedType = normalizeEntityType(String(log.entityType || ''))
  const entityLabel =
    ENTITY_LABELS[normalizedType] ||
    ENTITY_LABELS[normalizedType.toLowerCase()] ||
    ENTITY_LABELS[log.entityType] ||
    log.entityType
  const entityIcon =
    ENTITY_ICONS[normalizedType] ||
    ENTITY_ICONS[normalizedType.toLowerCase()] ||
    ENTITY_ICONS[log.entityType] ||
    <FileText className="w-3 h-3" />

  return (
    <div className={`border-l-[3px] ${accent.border} bg-card hover:bg-muted/30 transition-colors duration-150 rounded-r-lg`}>
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-r-lg"
      >
        <div className="flex items-center gap-3">
          {/* User avatar */}
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${accent.icon}`}>
            {getUserInitial(log.userName)}
          </div>

          {/* Summary */}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground leading-snug">
              <span className="font-semibold">{log.userName}</span>{' '}
              <span className="text-muted-foreground">{buildSummary(log)}</span>
            </p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ring-inset ${accent.badge}`}>
                {getActionIcon(log.action)}
                {ACTION_LABELS[log.action] || log.action}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                {entityIcon}
                {entityLabel}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {ROLE_LABELS[log.userRole] || log.userRole}
              </span>
            </div>
          </div>

          {/* Timestamp + expand */}
          <div className="flex items-center gap-2 shrink-0">
            <span
              className="text-xs text-muted-foreground hidden sm:inline"
              title={formatExactTimestamp(log.timestamp)}
            >
              {getRelativeTime(log.timestamp)}
            </span>
            {hasDetails && (
              <span className="text-muted-foreground/60">
                {isExpanded
                  ? <ChevronDown className="w-4 h-4" />
                  : <ChevronRight className="w-4 h-4" />
                }
              </span>
            )}
          </div>
        </div>
      </button>

      {isExpanded && <LogDetailPanel log={log} onRestore={onRestore} restoring={restoring} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const ITEMS_PER_PAGE = 20

export function SimpleAuditDashboard({ isMaster, canRestore = false }: SimpleAuditDashboardProps) {
  const [logs, setLogs] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const [filters, setFilters] = useState({
    action: '',
    entityType: '',
    userRole: '',
    dateFrom: '',
    dateTo: '',
  })

  // Track active filter count for badge
  const activeFilterCount = useMemo(() => {
    return Object.values(filters).filter(Boolean).length
  }, [filters])

  // ----- Server-side fetch -----
  const fetchLogs = useCallback(async (page: number, currentFilters: typeof filters) => {
    try {
      const params = new URLSearchParams()
      params.set('limit', String(ITEMS_PER_PAGE))
      params.set('offset', String((page - 1) * ITEMS_PER_PAGE))

      if (currentFilters.action) params.set('action', currentFilters.action)
      if (currentFilters.entityType) params.set('entityType', currentFilters.entityType)
      if (currentFilters.userRole) params.set('userRole', currentFilters.userRole)
      if (currentFilters.dateFrom) params.set('dateFrom', currentFilters.dateFrom)
      if (currentFilters.dateTo) params.set('dateTo', currentFilters.dateTo)

      const res = await fetch(`/api/audit/logs?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = await res.json()
      if (data.status === 'success') {
        setLogs(data.data.logs || data.data || [])
        setTotal(data.data.total ?? 0)
      } else {
        setLogs([])
        setTotal(0)
      }
    } catch {
      setLogs([])
      setTotal(0)
    }
  }, [])

  useEffect(() => {
    if (!isMaster) return
    setLoading(true)
    fetchLogs(currentPage, filters).finally(() => setLoading(false))
  }, [isMaster, currentPage, filters, fetchLogs])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchLogs(currentPage, filters)
    setRefreshing(false)
  }, [currentPage, filters, fetchLogs])

  const handleRestore = useCallback(async (log: any) => {
    if (!canRestore || !log.restore?.eligible || restoringId) return
    if (!window.confirm('¿Restaurar esta orden? No se repetirán facturas, guías, pagos ni inventario.')) return
    setRestoringId(log.id)
    setRestoreError(null)
    try {
      const response = await fetch(`/api/audit/logs/${encodeURIComponent(log.id)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedDeletedAt: log.restore.expectedDeletedAt }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'No se pudo restaurar la orden')
      await fetchLogs(currentPage, filters)
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : 'No se pudo restaurar la orden')
    } finally {
      setRestoringId(null)
    }
  }, [canRestore, currentPage, fetchLogs, filters, restoringId])

  // ----- Filter handlers -----
  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    const { name, value } = e.target
    setFilters(prev => ({ ...prev, [name]: value }))
    setCurrentPage(1)
  }

  const clearFilters = () => {
    setFilters({ action: '', entityType: '', userRole: '', dateFrom: '', dateTo: '' })
    setCurrentPage(1)
  }

  // ----- Expand/collapse -----
  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ----- CSV export -----
  const handleExport = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      params.set('limit', '1000')
      params.set('offset', '0')
      if (filters.action) params.set('action', filters.action)
      if (filters.entityType) params.set('entityType', filters.entityType)
      if (filters.userRole) params.set('userRole', filters.userRole)
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
      if (filters.dateTo) params.set('dateTo', filters.dateTo)

      const res = await fetch(`/api/audit/logs?${params.toString()}`)
      if (!res.ok) throw new Error('Export failed')
      const data = await res.json()
      const rows: any[] = data.data?.logs || data.data || []

      if (rows.length === 0) return

      const headers = ['Fecha', 'Usuario', 'Rol', 'Acción', 'Entidad', 'Nombre', 'Razón', 'Detalle']
      const csvRows = rows.map(r => [
        new Date(r.timestamp).toISOString(),
        r.userName,
        ROLE_LABELS[r.userRole] || r.userRole,
        ACTION_LABELS[r.action] || r.action,
        ENTITY_LABELS[normalizeEntityType(r.entityType)] ||
          ENTITY_LABELS[String(r.entityType || '').toLowerCase()] ||
          r.entityType,
        r.entityName || '',
        r.reason || '',
        summarizeDetailForCsv(r),
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))

      const csv = [headers.join(','), ...csvRows].join('\n')
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `auditoria_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // silently fail
    }
  }, [filters])

  // ----- Derived data -----
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)
  const dateGroups = useMemo(() => groupByDate(logs), [logs])

  // ----- Access control -----
  if (!isMaster) {
    return (
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-6 dark:bg-yellow-500/5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-yellow-500/15 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-500" />
          </div>
          <div>
            <span className="text-foreground font-semibold">Acceso Restringido</span>
            <p className="text-muted-foreground text-sm mt-0.5">
              Solo los administradores pueden ver el historial de auditoría.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-brand-gradient text-white">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Auditoría</h2>
              <p className="text-sm text-muted-foreground">
                Registro de cambios del sistema
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Stats pills */}
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-xs font-medium text-muted-foreground">
              <Activity className="w-3.5 h-3.5" />
              {total} {total === 1 ? 'registro' : 'registros'}
            </span>

            {/* Actions */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Filter className="w-3.5 h-3.5" />
              Filtros
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? '' : 'Actualizar'}
            </button>
            <button
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      {restoreError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {restoreError}
        </div>
      )}

      {showFilters && (
        <div className="bg-card border border-border rounded-xl p-4 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Filtros</h3>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                <X className="w-3 h-3" /> Limpiar
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Acción</label>
              <select
                name="action"
                value={filters.action}
                onChange={handleFilterChange}
                className="w-full p-2 text-sm bg-background text-foreground border border-border rounded-lg focus:ring-2 focus:ring-primary/40 focus:border-primary"
              >
                <option value="">Todas</option>
                <option value="CREATE">Creación</option>
                <option value="UPDATE">Actualización</option>
                <option value="DELETE">Eliminación</option>
                <option value="BULK_DELETE">Eliminación masiva</option>
                <option value="BULK_UPDATE">Actualización masiva</option>
                <option value="BULK_TOGGLE">Cambio de estado</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Entidad</label>
              <select
                name="entityType"
                value={filters.entityType}
                onChange={handleFilterChange}
                className="w-full p-2 text-sm bg-background text-foreground border border-border rounded-lg focus:ring-2 focus:ring-primary/40 focus:border-primary"
              >
                <option value="">Todas</option>
                <option value="order">Orden</option>
                <option value="client">Cliente</option>
                <option value="user">Usuario</option>
                <option value="field">Campo</option>
                <option value="option">Opción</option>
                <option value="optionSet">Conjunto de opciones</option>
                <option value="shipping">Envío</option>
                <option value="status">Estado</option>
                <option value="seller">Vendedor</option>
                <option value="inventory">Inventario</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Rol</label>
              <select
                name="userRole"
                value={filters.userRole}
                onChange={handleFilterChange}
                className="w-full p-2 text-sm bg-background text-foreground border border-border rounded-lg focus:ring-2 focus:ring-primary/40 focus:border-primary"
              >
                <option value="">Todos</option>
                <option value="MASTER">Administrador</option>
                <option value="REGULAR">Usuario</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Desde</label>
              <input
                type="date"
                name="dateFrom"
                value={filters.dateFrom}
                onChange={handleFilterChange}
                className="w-full p-2 text-sm bg-background text-foreground border border-border rounded-lg focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Hasta</label>
              <input
                type="date"
                name="dateTo"
                value={filters.dateTo}
                onChange={handleFilterChange}
                className="w-full p-2 text-sm bg-background text-foreground border border-border rounded-lg focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
            </div>
          </div>
        </div>
      )}

      {/* Log list */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
            <span className="text-sm text-muted-foreground">Cargando auditoría...</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 px-4">
            <div className="p-3 bg-muted rounded-full w-14 h-14 mx-auto mb-3 flex items-center justify-center">
              <Activity className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">Sin registros</h3>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              {activeFilterCount > 0
                ? 'No hay registros que coincidan con los filtros aplicados.'
                : 'Los registros aparecerán aquí cuando se realicen cambios en el sistema.'}
            </p>
          </div>
        ) : (
          <div>
            {dateGroups.map(group => (
              <div key={group.label}>
                {/* Date header */}
                <div className="sticky top-0 z-[1] px-4 py-2 bg-muted/70 backdrop-blur-sm border-b border-border">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {group.label}
                  </span>
                </div>
                {/* Entries */}
                <div className="divide-y divide-border/60">
                  {group.logs.map(log => (
                    <LogEntry
                      key={log.id}
                      log={log}
                      isExpanded={expandedIds.has(log.id)}
                      onToggle={() => toggleExpand(log.id)}
                      onRestore={canRestore ? handleRestore : undefined}
                      restoring={restoringId === log.id}
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-border bg-muted/40 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {((currentPage - 1) * ITEMS_PER_PAGE) + 1}
                  –{Math.min(currentPage * ITEMS_PER_PAGE, total)} de {total}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Anterior
                  </button>
                  {getPaginationRange(currentPage, totalPages).map((p, i) =>
                    p === '...' ? (
                      <span key={`dot-${i}`} className="px-1 text-xs text-muted-foreground">...</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p as number)}
                        className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                          currentPage === p
                            ? 'bg-primary text-primary-foreground font-medium'
                            : 'border border-border hover:bg-muted'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Smart pagination range: [1, ..., 4, 5, 6, ..., 20]
function getPaginationRange(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const pages: (number | '...')[] = []

  if (current <= 4) {
    for (let i = 1; i <= 5; i++) pages.push(i)
    pages.push('...')
    pages.push(total)
  } else if (current >= total - 3) {
    pages.push(1)
    pages.push('...')
    for (let i = total - 4; i <= total; i++) pages.push(i)
  } else {
    pages.push(1)
    pages.push('...')
    for (let i = current - 1; i <= current + 1; i++) pages.push(i)
    pages.push('...')
    pages.push(total)
  }

  return pages
}
