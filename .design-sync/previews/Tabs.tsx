import { Tabs, TabsContent, TabsList, TabsTrigger } from '@medcheckin/web';

export function Padrao() {
  return (
    <div className="w-[460px]">
      <Tabs defaultValue="hoje">
        <TabsList>
          <TabsTrigger value="hoje">Hoje</TabsTrigger>
          <TabsTrigger value="semana">7 dias</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="hoje" className="pt-3 text-sm text-muted-foreground">
          Check-in respondido às 08:14. Dor 4/10, sono 7/10.
        </TabsContent>
        <TabsContent value="semana" className="pt-3 text-sm text-muted-foreground">
          Média de dor 5,2 na semana.
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function Linha() {
  return (
    <div className="w-[460px]">
      <Tabs defaultValue="sintomas">
        <TabsList variant="line">
          <TabsTrigger value="sintomas">Sintomas</TabsTrigger>
          <TabsTrigger value="doses">Doses</TabsTrigger>
          <TabsTrigger value="alertas">Alertas</TabsTrigger>
        </TabsList>
        <TabsContent value="sintomas" className="pt-3 text-sm text-muted-foreground">
          Série diária dos sintomas monitorados.
        </TabsContent>
      </Tabs>
    </div>
  );
}
