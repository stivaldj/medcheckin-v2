import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@medcheckin/web';

// A legenda fica abaixo da tabela e só faz sentido junto dela.
export function ComTabela() {
  return (
    <Table>
      <TableCaption>Doses registradas na última semana.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Dia</TableHead>
          <TableHead>Doses</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>11/03</TableCell>
          <TableCell className="font-mono tabular-nums">2</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>12/03</TableCell>
          <TableCell className="font-mono tabular-nums">1</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
