// Logistics chrome + phone layout. Rendered as a <style> by the logistics layout,
// so it only applies while a /logistics page is mounted.
export const LOGISTICS_CSS = `
                * { box-sizing: border-box; }
                body { margin: 0; }
                .lm-nav-link:hover {
                    background: rgba(255,255,255,0.07) !important;
                    color: #F2F2F2 !important;
                    border-color: rgba(255,255,255,0.1) !important;
                }
                .lm-glass {
                    background: rgba(255,255,255,0.05);
                    backdrop-filter: blur(16px);
                    -webkit-backdrop-filter: blur(16px);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 14px;
                }
                .lm-glass-hi {
                    background: rgba(255,255,255,0.08);
                    backdrop-filter: blur(24px);
                    -webkit-backdrop-filter: blur(24px);
                    border: 1px solid rgba(255,255,255,0.15);
                    border-radius: 14px;
                }
                input, select, textarea {
                    color-scheme: dark;
                }
                input::placeholder { color: rgba(255,255,255,0.25); }
                select option { background: #1a1a2e; color: #F2F2F2; }
                ::-webkit-scrollbar { width: 4px; height: 4px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes pulse-orb { 0%,100%{opacity:1} 50%{opacity:0.7} }

                .lm-mobile-nav { display: none; }
                .lm-stat-grid { grid-template-columns: repeat(6, 1fr); }

                .lm-mobile-nav-bar {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    border-bottom: 1px solid rgba(255,255,255,0.08);
                }
                .lm-mobile-menu-btn {
                    width: 40px;
                    height: 40px;
                    border-radius: 10px;
                    border: 1px solid rgba(255,255,255,0.1);
                    background: rgba(255,255,255,0.05);
                    color: #F2F2F2;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    flex-shrink: 0;
                }
                .lm-mobile-brand {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    min-width: 0;
                    flex: 1;
                }
                .lm-mobile-brand-icon {
                    width: 28px;
                    height: 28px;
                    border-radius: 8px;
                    background: linear-gradient(135deg, #6c3fff, #3b82f6);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .lm-mobile-brand-text { min-width: 0; }
                .lm-mobile-brand-title {
                    color: #F2F2F2;
                    font-weight: 700;
                    font-size: 13px;
                    margin: 0;
                    line-height: 1.2;
                }
                .lm-mobile-brand-section {
                    color: rgba(255,255,255,0.45);
                    font-size: 11px;
                    margin: 1px 0 0;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .lm-mobile-exit {
                    color: rgba(255,255,255,0.45);
                    text-decoration: none;
                    width: 40px;
                    height: 40px;
                    border-radius: 10px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .lm-mobile-drawer-backdrop {
                    position: fixed;
                    inset: 0;
                    z-index: 200;
                    border: none;
                    padding: 0;
                    margin: 0;
                    background: rgba(0,0,0,0.62);
                    cursor: pointer;
                }
                .lm-mobile-drawer {
                    position: fixed;
                    top: 0;
                    left: 0;
                    bottom: 0;
                    width: min(86vw, 320px);
                    z-index: 210;
                    background: #14141c;
                    border-right: 1px solid rgba(255,255,255,0.12);
                    display: flex;
                    flex-direction: column;
                    padding: 14px 12px calc(16px + env(safe-area-inset-bottom, 0px));
                    box-shadow: 18px 0 40px rgba(0,0,0,0.45);
                    overflow: hidden;
                }
                .lm-mobile-drawer-header {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 10px;
                    padding: 4px 4px 14px;
                    border-bottom: 1px solid rgba(255,255,255,0.08);
                }
                .lm-mobile-drawer-title {
                    color: #F2F2F2;
                    font-size: 15px;
                    font-weight: 700;
                    margin: 0;
                }
                .lm-mobile-drawer-email {
                    color: rgba(255,255,255,0.35);
                    font-size: 11px;
                    margin: 4px 0 0;
                    word-break: break-all;
                }
                .lm-mobile-drawer-links {
                    flex: 1;
                    overflow-y: auto;
                    padding: 12px 0;
                    min-height: 0;
                    -webkit-overflow-scrolling: touch;
                }
                .lm-mobile-drawer-link {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 12px 12px;
                    border-radius: 10px;
                    color: rgba(255,255,255,0.78);
                    text-decoration: none;
                    font-size: 14px;
                    font-weight: 500;
                    margin-bottom: 4px;
                    border: 1px solid transparent;
                    min-height: 44px;
                }
                .lm-mobile-drawer-link.is-active {
                    background: rgba(108,63,255,0.22);
                    color: #ffffff;
                    border-color: rgba(108,63,255,0.45);
                }
                .lm-mobile-drawer-footer {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px;
                    border-radius: 10px;
                    color: rgba(255,255,255,0.4);
                    text-decoration: none;
                    font-size: 12.5px;
                    border-top: 1px solid rgba(255,255,255,0.08);
                    margin-top: 4px;
                }

                @media (max-width: 768px) {
                    .lm-root {
                        flex-direction: column !important;
                        height: 100dvh !important;
                        min-height: 100dvh !important;
                        width: 100% !important;
                        max-width: 100vw !important;
                        min-width: 0 !important;
                        overflow: hidden !important;
                    }
                    .lm-sidebar { display: none !important; }
                    .lm-mobile-nav {
                        display: block;
                        position: sticky;
                        top: 0;
                        z-index: 30;
                        flex-shrink: 0;
                        width: 100%;
                        background: #0d0d0d;
                        border-bottom: 1px solid rgba(255,255,255,0.08);
                    }
                    .lm-main {
                        flex: 1 1 auto !important;
                        width: 100% !important;
                        max-width: 100% !important;
                        min-width: 0 !important;
                        min-height: 0 !important;
                        padding: 12px 12px calc(16px + env(safe-area-inset-bottom, 0px)) !important;
                        overflow-x: hidden !important;
                        overflow-y: auto !important;
                        -webkit-overflow-scrolling: touch;
                    }
                    .lm-stat-grid { grid-template-columns: repeat(2, 1fr) !important; }

                    .lm-dash-header {
                        flex-direction: column !important;
                        align-items: stretch !important;
                        gap: 12px !important;
                    }

                    .lm-carriers-page {
                        height: auto !important;
                        min-height: 0 !important;
                        overflow: visible !important;
                    }
                    .lm-carriers-header {
                        flex-direction: column !important;
                        align-items: stretch !important;
                        gap: 10px !important;
                    }
                    .lm-carriers-actions {
                        display: flex !important;
                        flex-wrap: wrap !important;
                        gap: 8px !important;
                    }
                    .lm-carriers-actions > button {
                        flex: 1 1 auto;
                        justify-content: center;
                    }
                    .lm-carriers-body {
                        flex-direction: column !important;
                        overflow: visible !important;
                        height: auto !important;
                        min-height: 0 !important;
                    }
                    .lm-carriers-boards {
                        order: 2;
                        overflow: visible !important;
                        padding-right: 0 !important;
                    }
                    .lm-carriers-unassigned {
                        order: 1;
                        width: 100% !important;
                        max-height: none !important;
                        overflow: visible !important;
                        margin-bottom: 4px;
                    }
                    .lm-carriers-unassigned-scroll {
                        max-height: 280px !important;
                        overflow-y: auto !important;
                    }
                    .lm-board-col {
                        min-width: min(78vw, 270px) !important;
                        flex: 0 0 min(78vw, 270px) !important;
                    }
                    .lm-board-scroll {
                        touch-action: pan-x pan-y !important;
                        -webkit-overflow-scrolling: touch;
                    }
                    .lm-archive-panel {
                        max-height: none !important;
                        height: auto !important;
                        min-height: 0 !important;
                    }
                    .lm-archive-list {
                        max-height: min(50vh, 420px);
                        overflow-y: auto !important;
                    }
                    .lm-archive-toolbar {
                        flex-direction: column !important;
                        align-items: stretch !important;
                        gap: 10px !important;
                    }
                    .lm-archive-toolbar-controls {
                        flex-wrap: wrap !important;
                        width: 100%;
                    }
                    .lm-archive-search {
                        width: 100% !important;
                        flex: 1 1 140px !important;
                    }
                    .lm-archive-search input {
                        width: 100% !important;
                    }
                    .lm-archive-row {
                        flex-wrap: wrap !important;
                    }
                    .lm-archive-row-actions {
                        width: 100%;
                        justify-content: flex-end;
                    }
                    .lm-location-grid {
                        grid-template-columns: 1fr !important;
                    }
                    .lm-verify-modal {
                        width: calc(100vw - 24px) !important;
                        max-width: none !important;
                        padding: 16px !important;
                        max-height: calc(100dvh - 24px) !important;
                    }
                }

                @media (max-width: 420px) {
                    .lm-stat-grid { grid-template-columns: repeat(2, 1fr) !important; }
                }

                /* ── Phone pass (2026-10-22): tables → cards, collapsing grids,
                   44px tap targets, 12px minimum text. Desktop is untouched. ── */
                @media (max-width: 768px) {
                    .lm-mobile-menu-btn, .lm-mobile-exit { width: 44px; height: 44px; }

                    /* Tables: each row is a card; LogisticsTableLabels writes the
                       column name into data-label. Opt out with .lm-keep-table. */
                    .lm-main table:not(.lm-keep-table) {
                        display: block !important;
                        width: 100% !important;
                        min-width: 0 !important;
                        overflow: visible !important;
                    }
                    .lm-main table:not(.lm-keep-table) thead { display: none !important; }
                    .lm-main table:not(.lm-keep-table) tbody,
                    .lm-main table:not(.lm-keep-table) tfoot { display: block !important; }
                    .lm-main table:not(.lm-keep-table) tr {
                        display: grid !important;
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                        gap: 8px 12px;
                        padding: 12px !important;
                        border-bottom: 1px solid rgba(255,255,255,0.08) !important;
                    }
                    .lm-main table:not(.lm-keep-table) td {
                        display: block !important;
                        padding: 0 !important;
                        width: auto !important;
                        min-width: 0 !important;
                        max-width: none !important;
                        white-space: normal !important;
                        overflow: visible !important;
                        text-overflow: clip !important;
                        overflow-wrap: anywhere;
                        border: none !important;
                    }
                    .lm-main table:not(.lm-keep-table) td[data-label]:not([data-label=""])::before {
                        content: attr(data-label);
                        display: block;
                        margin-bottom: 2px;
                        font-size: 11px;
                        font-weight: 700;
                        letter-spacing: 0.03em;
                        text-transform: uppercase;
                        color: rgba(255,255,255,0.4);
                    }
                    .lm-main table:not(.lm-keep-table) td[colspan] { grid-column: 1 / -1; }
                    /* Tables kept as tables scroll sideways inside their own box. */
                    .lm-main .lm-keep-table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }

                    /* Filter chips wrap; underline tab bars scroll sideways. */
                    .lm-main .lm-chip-row { flex-wrap: wrap; }
                    .lm-main .lm-tab-row { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
                    .lm-main .lm-tab-row > * { flex-shrink: 0; }

                    /* Hard-coded 3/4-column grids. */
                    .lm-main .lm-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
                    .lm-main .lm-grid-1 { grid-template-columns: minmax(0, 1fr) !important; }

                    /* Tap targets and text size (iOS: 16px fields never zoom). */
                    .lm-main button,
                    .lm-main select,
                    .lm-main a[role="button"] { min-height: 44px; }
                    .lm-main button { min-width: 44px; }
                    .lm-main input:not([type="checkbox"]):not([type="radio"]),
                    .lm-main select,
                    .lm-main textarea { min-height: 44px; font-size: 16px !important; }
                    .lm-main [style*="font-size:9"], .lm-main [style*="font-size: 9"],
                    .lm-main [style*="font-size:10"], .lm-main [style*="font-size: 10"],
                    .lm-main [style*="font-size:11px"], .lm-main [style*="font-size: 11px"],
                    .lm-main [style*="font-size:11.5"], .lm-main [style*="font-size: 11.5"] {
                        font-size: 12px !important;
                    }

                    /* Fixed modals: never wider or taller than the phone. */
                    .lm-modal {
                        width: calc(100vw - 24px) !important;
                        max-width: none !important;
                        max-height: calc(100dvh - 24px) !important;
                        overflow-y: auto !important;
                        padding: 16px !important;
                    }

                    /* Carriers board scroller must not widen its parents. */
                    .lm-carriers-boards, .lm-board-scroll { min-width: 0; max-width: 100%; }
                    .lm-board-scroll { scroll-snap-type: x proximity; }
                    .lm-board-col { scroll-snap-align: start; }
                }

                @media print {
                    .lm-sidebar { display: none !important; }
                    .lm-mobile-nav { display: none !important; }
                    .lm-orbs { display: none !important; }
                    .lm-root { overflow: visible !important; background: white !important; }
                    .lm-main { overflow: visible !important; padding: 0 !important; }
                    body { background: white !important; margin: 0; padding: 0; }
                }
            `;
