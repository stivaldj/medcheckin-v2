import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@medcheckin/web';

// Célula só existe dentro de uma linha; isolada não tem o que mostrar.
export function NaLinha() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          <TableHead>Dor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-mono tabular-nums">12/03</TableCell>
          <TableCell className="font-mono tabular-nums">7/10</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-mono tabular-nums">11/03</TableCell>
          <TableCell className="font-mono tabular-nums">5/10</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
