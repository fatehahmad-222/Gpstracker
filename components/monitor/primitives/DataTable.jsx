"use client";

import { useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown, Settings2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { TableSkeleton, EmptyState } from "@/components/monitor/states";

/**
 * Data-table wrapper for the monitor module.
 *
 * Uses TanStack Table for sorting/column-visibility and TanStack Virtual for
 * row virtualisation past `virtualizeAfter`. Everything visual is ours, so the
 * table matches the module's tokens instead of a library's default styling.
 *
 * Sticky header and sticky first column are handled with plain CSS
 * (`position: sticky`) — no library feature needed, and it keeps the wide
 * Command Center scrolling horizontally without losing context.
 */

const DEFAULT_COLUMN = {
  size: 160,
  minSize: 80,
};

export function DataTable({
  data = [],
  columns = [],
  loading = false,
  error = null,
  onRetry = null,
  empty = { title: "Nothing to show", hint: null },
  virtualizeAfter = 200,
  rowHeight = 44,
  stickyFirstColumn = true,
  initialSort = [],
  getRowId,
  onRowClick,
  /**
   * Detail row rendered beneath the matching row: `{ id, content }`.
   * `id` is matched against the row id to decide which row is open, and
   * `content` is the node rendered in the full-width cell below it.
   */
  expandedRow = null,
  columnVisibility,
  onColumnVisibilityChange,
  toolbar = null,
  caption,
  className,
}) {
  const scrollRef = useRef(null);
  const [sorting, setSorting] = useState(initialSort);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
  });

  const rows = table.getRowModel().rows;
  const virtualize = rows.length > virtualizeAfter;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    enabled: virtualize,
  });

  const visibleColumnCount = table.getVisibleLeafColumns().length;

  if (error) {
    return <ErrorTable message={error} onRetry={onRetry} />;
  }

  return (
    <div className={cn("min-w-0", className)}>
      {toolbar ? <div className="mb-3">{toolbar}</div> : null}

      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-mon">
        <div
          ref={scrollRef}
          className="relative overflow-auto"
          style={virtualize ? { maxHeight: 560 } : undefined}
        >
          <table className="w-full border-collapse text-left text-[12.5px]">
            {caption ? <caption className="sr-only">{caption}</caption> : null}

            <thead
              className="sticky top-0 z-20 bg-surface-2 text-label font-semibold uppercase text-ink-dim"
              style={virtualize ? { position: "sticky" } : undefined}
            >
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    const canSort = header.column.getCanSort();
                    const isFirst = header.column.id === table.getVisibleLeafColumns()[0]?.id;

                    return (
                      <th
                        key={header.id}
                        scope="col"
                        style={header.getSize() ? { width: header.getSize(), minWidth: header.getSize() } : undefined}
                        className={cn(
                          "border-b border-line px-3 py-2.5 font-semibold",
                          canSort && "cursor-pointer select-none hover:text-ink",
                          isFirst && stickyFirstColumn && "left-0 z-10 bg-surface-2"
                        )}
                        aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                      >
                        {header.isPlaceholder ? null : (
                          <button
                            type="button"
                            disabled={!canSort}
                            onClick={header.column.getToggleSortingHandler()}
                            className="flex items-center gap-1 disabled:cursor-default"
                          >
                            <span className="truncate">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                            </span>
                            {canSort ? (
                              sorted === "asc" ? (
                                <ArrowUp size={11} aria-hidden="true" />
                              ) : sorted === "desc" ? (
                                <ArrowDown size={11} aria-hidden="true" />
                              ) : (
                                <ChevronsUpDown size={11} className="opacity-40" aria-hidden="true" />
                              )
                            ) : null}
                          </button>
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={visibleColumnCount} className="p-4">
                    <TableSkeleton rows={6} cols={Math.min(visibleColumnCount, 8)} />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumnCount} className="p-4">
                    <EmptyState
                      title={empty.title}
                      hint={empty.hint}
                      icon={empty.icon}
                      action={empty.action}
                      compact
                    />
                  </td>
                </tr>
              ) : (
                <>
                  {(virtualize ? virtualizer.getVirtualItems() : rows).map((virtualRow) => {
                    const row = virtualRow.row ?? virtualRow;
                    const rowIndex = virtualRow.index ?? rows.indexOf(row);
                    const isExpanded = expandedRow?.id === row.id;

                    return (
                      <TableRow
                        key={row.id}
                        row={row}
                        rowIndex={rowIndex}
                        virtualize={virtualize}
                        virtualRow={virtualRow}
                        virtualizer={virtualizer}
                        table={table}
                        stickyFirstColumn={stickyFirstColumn}
                        onRowClick={onRowClick}
                        isExpanded={isExpanded}
                        expandedRow={isExpanded ? expandedRow : null}
                        columns={table.getVisibleLeafColumns()}
                      />
                    );
                  })}
                </>
              )}
            </tbody>
          </table>

          {virtualize ? (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }} aria-hidden="true" />
          ) : null}
        </div>

        <ColumnToggleBar
          table={table}
          trigger={
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3 py-1.5 text-[11px] font-semibold text-ink-dim transition hover:border-brand/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Settings2 size={12} />
              Columns ({visibleColumnCount})
            </button>
          }
        />
      </div>
    </div>
  );
}

function TableRow({
  row,
  rowIndex,
  virtualize,
  virtualRow,
  virtualizer,
  table,
  stickyFirstColumn,
  onRowClick,
  isExpanded,
  expandedRow,
  columns,
}) {
  const start = virtualize ? virtualRow.start : undefined;
  const totalCols = columns.length;

  return (
    <>
      <tr
        onClick={onRowClick ? () => onRowClick(row) : undefined}
        className={cn(
          "border-b border-line/70 transition hover:bg-brand-tint/40",
          isExpanded && "bg-brand-tint/50",
          onRowClick && "cursor-pointer"
        )}
        style={
          virtualize
            ? {
                position: "absolute",
                transform: `translateY(${virtualRow.start}px)`,
                width: "100%",
                display: "table",
                tableLayout: "fixed",
              }
            : undefined
        }
        data-row-index={virtualize ? virtualRow.index : undefined}
        ref={virtualize ? virtualizer.measureElement : undefined}
      >
        {row.getVisibleCells().map((cell, i) => (
          <td
            key={cell.id}
            className={cn(
              "truncate px-3 py-2.5 text-ink",
              i === 0 && stickyFirstColumn && "sticky left-0 z-10 bg-surface"
            )}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
      </tr>

      {isExpanded && expandedRow ? (
        <tr className="border-b border-line bg-surface-2">
          <td colSpan={totalCols} className="p-0">
            {expandedRow.content}
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** `<details>`-based column visibility menu — no portal, no extra state. */
function ColumnToggleBar({ table, trigger }) {
  const hideable = table
    .getAllLeafColumns()
    .filter((c) => c.getCanHide() && c.id !== "select");

  if (hideable.length <= 1) return null;

  return (
    <div className="flex items-center justify-end border-t border-line px-3 py-2">
      <details className="group relative">
        <summary className="list-none [&::-webkit-details-marker]:hidden">{trigger}</summary>
        <div className="absolute bottom-full right-0 z-30 mb-2 max-h-72 w-56 overflow-y-auto rounded-card border border-line bg-surface p-2 shadow-pop">
          <div className="mb-1.5 px-1 text-label font-semibold uppercase text-ink-dim">
            Visible columns
          </div>
          {hideable.map((column) => (
            <label
              key={column.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-ink hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={column.getIsVisible()}
                onChange={column.getToggleVisibilityHandler()}
                className="h-3.5 w-3.5 accent-[rgb(var(--brand))]"
              />
              <span className="truncate">{columnLabel(column)}</span>
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

function columnLabel(column) {
  const header = column.columnDef.header;
  if (typeof header === "string") return header;
  return column.id;
}

function ErrorTable({ message, onRetry }) {
  return (
    <div className="rounded-card border border-crit/30 bg-crit-tint/40 p-4">
      <p className="text-[13px] font-semibold text-crit">Could not load this data</p>
      <p className="mt-1 text-[12px] text-ink-dim">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-pill bg-crit px-3 py-1.5 text-[12px] font-semibold text-white"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

/**
 * Column factory so pages declare cells declaratively without repeating the
 * size/header boilerplate.
 */
export function columnDef(config) {
  return { size: DEFAULT_COLUMN.size, minSize: DEFAULT_COLUMN.minSize, ...config };
}

/** Numeric right-aligned cell with tabular figures. */
export function num(value, className) {
  return (
    <span className={cn("block text-right font-mono tabular-nums", className)}>
      {value == null ? "—" : value}
    </span>
  );
}