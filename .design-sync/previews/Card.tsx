import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@medcheckin/web';

export function Completo() {
  return (
    <Card className="w-[380px]">
      <CardHeader>
        <CardTitle>Alertas abertos</CardTitle>
        <CardDescription>Últimos 7 dias</CardDescription>
        <CardAction>
          <Button size="xs" variant="ghost">
            Ver todos
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <span>Dor acima do limiar</span>
          <Badge variant="high">Alto</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span>Três dias sem check-in</span>
          <Badge variant="critical">Crítico</Badge>
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button size="sm" variant="outline">
          Dispensar
        </Button>
        <Button size="sm">Revisar</Button>
      </CardFooter>
    </Card>
  );
}

export function Simples() {
  return (
    <Card className="w-[300px]">
      <CardHeader>
        <CardTitle>Adesão</CardTitle>
        <CardDescription>Doses registradas na semana</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="font-heading text-3xl font-medium">86%</div>
      </CardContent>
    </Card>
  );
}

export function Denso() {
  return (
    <Card size="sm" className="w-[280px]">
      <CardHeader>
        <CardTitle>Próxima dose</CardTitle>
        <CardDescription>Hoje, 20:00</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        CBD 200mg/ml — 2 gotas sublinguais.
      </CardContent>
    </Card>
  );
}
