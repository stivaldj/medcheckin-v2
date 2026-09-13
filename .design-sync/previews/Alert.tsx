import { Alert, AlertAction, AlertDescription, AlertTitle, Button } from '@medcheckin/web';
import { TriangleAlertIcon, InfoIcon } from 'lucide-react';

export function ComIcone() {
  return (
    <div className="w-[460px]">
      <Alert>
        <InfoIcon />
        <AlertTitle>Rotina alterada</AlertTitle>
        <AlertDescription>
          As mudanças passam a valer no próximo check-in da paciente.
        </AlertDescription>
      </Alert>
    </div>
  );
}

export function Destrutivo() {
  return (
    <div className="w-[460px]">
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Três dias sem check-in</AlertTitle>
        <AlertDescription>
          A paciente não responde desde 12/03. Considere contato ativo antes de ajustar a dose.
        </AlertDescription>
      </Alert>
    </div>
  );
}

export function ComAcao() {
  return (
    <div className="w-[460px]">
      <Alert>
        <TriangleAlertIcon />
        <AlertTitle>Dor acima do limiar</AlertTitle>
        <AlertDescription>Média de 7,4 nos últimos três dias.</AlertDescription>
        <AlertAction>
          <Button size="xs" variant="ghost">
            Dispensar
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}

export function SemIcone() {
  return (
    <div className="w-[460px]">
      <Alert>
        <AlertTitle>Consentimento LGPD registrado</AlertTitle>
        <AlertDescription>Assinado em 02/03, válido por 12 meses.</AlertDescription>
      </Alert>
    </div>
  );
}
