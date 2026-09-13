import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@medcheckin/web';

// TableHead é a célula de cabeçalho: só se lê em contraste com o corpo da tabela.
export function NoCabecalho() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Produto</TableHead>
          <TableHead>Dose</TableHead>
          <TableHead>Período</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Óleo full spectrum</TableCell>
          <TableCell>2 gotas</TableCell>
          <TableCell>Manhã e noite</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
