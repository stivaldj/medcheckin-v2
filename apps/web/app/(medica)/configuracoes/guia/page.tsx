import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireUserPage } from '@/lib/session';
import { PrintButton } from '@/components/medica/PrintButton';

export const dynamic = 'force-dynamic';

function Passo({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">
        {n}
      </span>
      <div className="space-y-1.5">
        <p className="text-lg font-semibold">{titulo}</p>
        <div className="space-y-1.5 text-[15px] leading-relaxed">{children}</div>
      </div>
    </li>
  );
}

/** E9.3 — guia da médica: do primeiro paciente ao dia a dia, com os nomes exatos das telas. */
export default async function GuiaMedicaPage() {
  await requireUserPage();
  return (
    <div className="mx-auto max-w-2xl space-y-8 print:max-w-none" data-testid="guide-doctor">
      <style>{`@media print { header, nav, .no-print { display: none !important; } main { padding: 0 !important } @page { margin: 14mm } }`}</style>
      <div className="no-print flex items-center justify-between">
        <Link href="/configuracoes" className="text-sm underline">
          ← voltar às configurações
        </Link>
        <PrintButton />
      </div>
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Guia da médica</h1>
        <p className="mt-1 text-muted-foreground">
          Do primeiro paciente ao dia a dia. Os nomes em negrito são os da tela.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Primeiro paciente (uma vez por paciente)</h2>
        <ol className="space-y-6">
          <Passo n={1} titulo="Entrar">
            <p>
              Na tela de entrada, digite seu e-mail. Abra o link que chega no e-mail{' '}
              <strong>no mesmo computador</strong>.
            </p>
          </Passo>
          <Passo n={2} titulo="Cadastrar o paciente">
            <p>
              <strong>Pacientes</strong> → <strong>Novo paciente</strong>. Em{' '}
              <strong>Quem responde e recebe alarmes</strong>, cadastre o cuidador junto.
            </p>
            <p>
              Se o paciente usa o celular do cuidador: deixe só o cuidador respondendo e recebendo
              alarmes. Na página do paciente dá para marcar{' '}
              <strong>Usa o celular de outra pessoa da casa</strong>.
            </p>
          </Passo>
          <Passo n={3} titulo="Montar a rotina de alarmes">
            <p>
              Na página do paciente, aba <strong>A configuração</strong> →{' '}
              <strong>Rotina de alarmes</strong> → <strong>Novo período</strong>. Um horário por
              linha, com o que tomar escrito do jeito que a família entende.
            </p>
          </Passo>
          <Passo n={4} titulo="Conferir perguntas e horário do check-in">
            <p>
              No card <strong>Questionário</strong>: horário (manhã ou noite) e perguntas extras, se
              precisar.
            </p>
          </Passo>
          <Passo n={5} titulo="Configurar o celular na consulta">
            <p>
              No card <strong>Respondentes</strong>, a pessoa lê o <strong>QR code</strong> com a
              câmera do celular e segue os passos da tela. Se preferir, clique em{' '}
              <strong>Imprimir guia com QR</strong> e entregue a folha.
            </p>
            <p>
              <strong>Antes de ela ir embora</strong>, recarregue a página e confira os quatro
              itens: Convite aceito · App instalado · Avisos ativos ·{' '}
              <strong>Teste confirmado</strong>. Sem o último ✓, os lembretes podem não chegar.
            </p>
            <p>
              Fora da consulta: <strong>Enviar por WhatsApp</strong> manda o link com as instruções.
            </p>
          </Passo>
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Dia a dia</h2>
        <ol className="space-y-6">
          <Passo n={1} titulo="Abrir a tela Hoje">
            <p>
              <strong>Precisa de você agora</strong> (alertas), <strong>Não respondeu</strong> e{' '}
              <strong>Só informação</strong>, tudo numa tela só.
            </p>
          </Passo>
          <Passo n={2} titulo="Alerta sempre fecha com conduta">
            <p>
              Abra o alerta e use <strong>Resolver com conduta</strong>. Sem escrever a conduta, não
              fecha. Fica no histórico do paciente.
            </p>
          </Passo>
          <Passo n={3} titulo="Mudou a dose?">
            <p>
              <strong>Medicações e dose vigente</strong> → <strong>Ajustar dose</strong>. O gráfico{' '}
              <strong>Sintoma × dose</strong> marca o ajuste. Se mudou a rotina,{' '}
              <strong>Replicar período</strong> e edite os horários.
            </p>
          </Passo>
        </ol>
      </section>

      <section className="space-y-3 rounded-2xl bg-muted/60 p-5">
        <h2 className="text-lg font-semibold">Quando algo não chega</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed">
          <li>
            Veja em <strong>Respondentes</strong> qual item está sem ✓. Peça para a pessoa abrir o
            app e tocar em <strong>Ativar os avisos</strong> ou <strong>testar de novo</strong>.
          </li>
          <li>
            Perdeu ou trocou de celular: <strong>Novo link</strong> (o antigo para de funcionar) e
            um QR novo.
          </li>
          <li>
            Na mesma casa, <strong>um celular = uma pessoa</strong> recebendo avisos.
          </li>
        </ul>
      </section>
    </div>
  );
}
