import type { JSX } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { WireLengthRow } from "@/lib/cabinet-wiring";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The conductor lengths per cross-section under the layout drawing, with the installation slack
 * included. Hook-free: `LayoutSection.astro` renders it without hydration, and the layout editor island
 * renders it hydrated so it can hide it while the layout has unsaved changes.
 */
interface Props {
  lengths: readonly WireLengthRow[];
  /** The slack share the lengths include, in percent. */
  slackPercent: number;
}

const s = t.layout.section;
const headClass = "h-9 text-xs font-medium text-muted-foreground";
const cellClass = "py-2 align-top";

export function WireLengthsTable({ lengths, slackPercent }: Props): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{s.lengthsTitle}</h3>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className={cn(headClass, "pl-4")}>
                {s.lengthsColumns.crossSection}
              </TableHead>
              <TableHead scope="col" className={headClass}>
                {s.lengthsColumns.conductor}
              </TableHead>
              <TableHead scope="col" className={headClass}>
                {s.lengthsColumns.usage}
              </TableHead>
              <TableHead scope="col" className={cn(headClass, "text-right")}>
                {s.lengthsColumns.count}
              </TableHead>
              <TableHead scope="col" className={cn(headClass, "pr-4 text-right")}>
                {s.lengthsColumns.length}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lengths.map((row) => (
              <TableRow key={`${String(row.crossSectionMm2)}:${row.wireClass}`}>
                <TableCell className={cn(cellClass, "pl-4 font-mono whitespace-nowrap tabular-nums")}>
                  {s.crossSection(row.crossSectionMm2)}
                </TableCell>
                <TableCell className={cellClass}>{s.wireClasses[row.wireClass]}</TableCell>
                <TableCell className={cn(cellClass, "text-muted-foreground")}>
                  {row.kinds.map((kind) => s.conductorKinds[kind]).join(s.kindsSeparator)}
                </TableCell>
                <TableCell className={cn(cellClass, "text-right font-mono tabular-nums")}>{row.count}</TableCell>
                <TableCell className={cn(cellClass, "pr-4 text-right font-mono whitespace-nowrap tabular-nums")}>
                  {s.metres(row.totalMm / 1000)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-muted-foreground text-xs">{s.lengthsNote(slackPercent)}</p>
    </div>
  );
}
