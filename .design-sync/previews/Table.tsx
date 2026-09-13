import {
  Badge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@medcheckin/web';

const LINHAS = [
  { data: '12/03', dor: '7', sono: '4', sev: 'high' as const, rotulo: 'Alto' },
  { data: '11/03', dor: '5', sono: '6', sev: 'medium' as const, rotulo: 'Médio' },
  { data: '10/03', dor: '3', sono: '8', sev: 'low' as const, rotulo: 'Baixo' },
];

export function Historico() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          <TableHead>Dor</TableHead>
          <TableHead>Sono</TableHead>
          <TableHead>Severidade</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {LINHAS.map((l) => (
          <TableRow key={l.data}>
            <TableCell className="font-mono tabular-nums">{l.data}</TableCell>
            <TableCell className="font-mono tabular-nums">{l.dor}/10</TableCell>
            <TableCell className="font-mono tabular-nums">{l.sono}/10</TableCell>
            <TableCell>
              <Badge variant={l.sev}>{l.rotulo}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ComRodape() {
  return (
    <Table>
      <TableCaption>Doses registradas na última semana.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Produto</TableHead>
          <TableHead>Registradas</TableHead>
          <TableHead>Previstas</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Óleo full spectrum</TableCell>
          <TableCell className="font-mono tabular-nums">12</TableCell>
          <TableCell className="font-mono tabular-nums">14</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Cápsula 25mg</TableCell>
          <TableCell className="font-mono tabular-nums">6</TableCell>
          <TableCell className="font-mono tabular-nums">7</TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell className="font-mono tabular-nums">18</TableCell>
          <TableCell className="font-mono tabular-nums">21</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
