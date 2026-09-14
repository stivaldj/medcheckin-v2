'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  BellRingIcon,
  CheckIcon,
  CompassIcon,
  CopyIcon,
  EllipsisVerticalIcon,
  LoaderIcon,
  ShareIcon,
  SquarePlusIcon,
} from 'lucide-react';
import type { RespondentTodayView } from '@medcheckin/core';

import { api, ApiError } from '@/lib/client';
import { detectBrowser, type BrowserInfo } from '@/lib/browser-detect';
import { subscribePush, pushSupported, registerServiceWorker } from '@/lib/push-client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export const CONSENT_VERSION = 'v1';

type Step =
  | 'loading'
  | 'welcome'
  | 'consent'
  | 'returning'
  | 'browser'
  | 'install'
  | 'notify'
  | 'test'
  | 'done'
  | 'shared';

type Props =
  | {
      mode: 'invite';
      token: string;
      name: string;
      kind: string;
      patientName: string;
      clinicName: string;
      alreadyAccepted: boolean;
    }
  | { mode: 'help' };

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/** Tela de um passo: título grande, texto curto, ações no fim. Quem usa pode estar com dor ou sono. */
function Screen({
  title,
  children,
  actions,
  testId,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  testId: string;
}) {
  return (
    <section className="space-y-6" data-testid={testId}>
      <h1 className="text-2xl leading-tight font-semibold tracking-tight text-balance">{title}</h1>
      <div className="space-y-4 text-[17px] leading-relaxed">{children}</div>
      {actions && <div className="space-y-3 pt-2">{actions}</div>}
    </section>
  );
}

/** Passo numerado com o ícone que a pessoa vai procurar na tela do celular. */
function Instruction({ n, icon, children }: { n: number; icon?: ReactNode; children: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-sm font-semibold text-primary-foreground">
        {n}
      </span>
      <div className="flex-1 pt-0.5">
        {children}
        {icon && (
          <span className="mt-2 flex w-fit items-center justify-center rounded-lg border bg-card p-2.5 text-primary shadow-sm">
            {icon}
          </span>
        )}
      </div>
    </li>
  );
}

const big = 'h-14 w-full text-base';

async function thisDeviceSubscribed() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration('/p/');
  return !!(reg && (await reg.pushManager.getSubscription()));
}

export function SetupWizard(props: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('loading');
  const [info, setInfo] = useState<BrowserInfo | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [today, setToday] = useState<RespondentTodayView | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const installPrompt = useRef<InstallPromptEvent | null>(null);
  const [canPromptInstall, setCanPromptInstall] = useState(false);
  const [copied, setCopied] = useState(false);

  // --- passo "notify"
  const [notifyProblem, setNotifyProblem] = useState<
    null | 'denied' | 'unsupported' | 'taken' | 'unavailable' | 'error'
  >(null);

  // --- passo "test"
  const [testId, setTestId] = useState<string | null>(null);
  const [testState, setTestState] = useState<
    'idle' | 'waiting' | 'sent' | 'failed' | 'not_arrived'
  >('idle');
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);

  const loadToday = useCallback(async () => {
    const t = await api<RespondentTodayView>('/api/p/today');
    setToday(t);
    return t;
  }, []);

  /** Depois que há sessão: decide o próximo passo pelo que o celular e o servidor dizem. */
  const route = useCallback(
    async (b: BrowserInfo, isApp: boolean) => {
      const t = await loadToday();
      if (isApp && !t.setup.installed) {
        try {
          await api('/api/p/installed', { method: 'POST' });
        } catch (e) {
          // Não bloqueia a configuração, mas também não some: aparece na tela.
          setError(`Não conseguimos registrar a instalação: ${(e as Error).message}`);
        }
      }
      if (t.setup.device === 'shared') return setStep('shared');
      if (b.embedded) return setStep('browser');
      if (b.platform === 'ios' && !isApp) return setStep('install');
      if (b.platform === 'android' && !isApp && !t.setup.installed) return setStep('install');
      // "Avisos ativos" vale para ESTE aparelho: o servidor pode ter a inscrição de outro (no
      // iPhone, o Safari e o app da tela inicial são aparelhos diferentes para o navegador).
      if (t.setup.push_active && (await thisDeviceSubscribed())) {
        if (props.mode === 'invite' && t.setup.test_confirmed) return setStep('done');
        return setStep('test');
      }
      return setStep('notify');
    },
    [loadToday, props.mode],
  );

  const enter = useCallback(
    async (consent: boolean) => {
      if (props.mode !== 'invite') return;
      setBusy(true);
      setError(null);
      try {
        await api('/api/p/accept', {
          method: 'POST',
          json: { token: props.token, consentVersion: consent ? CONSENT_VERSION : undefined },
        });
        return true;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Não foi possível entrar. Tente de novo.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [props],
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      installPrompt.current = e as InstallPromptEvent;
      setCanPromptInstall(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    // O SW precisa estar registrado cedo: o Android só oferece "Instalar app" com ele ativo.
    if (pushSupported())
      registerServiceWorker().catch((e) =>
        setError(`Não foi possível preparar os avisos neste navegador: ${(e as Error).message}`),
      );

    const isApp =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      new URLSearchParams(window.location.search).get('app') === '1';
    const b = detectBrowser(navigator.userAgent, { standalone: isApp });
    setStandalone(isApp);
    setInfo(b);

    (async () => {
      try {
        if (props.mode === 'help') return await route(b, isApp);
        if (!props.alreadyAccepted) return setStep('welcome');
        // App aberto da tela inicial com convite já aceito: entra sozinho, sem tela de termo.
        if (isApp) {
          if (await enter(false)) await route(b, isApp);
          else setStep('returning');
          return;
        }
        setStep('returning');
      } catch (e) {
        setError(
          e instanceof ApiError && e.status === 401
            ? 'Sua sessão neste celular não foi encontrada. Leia de novo o QR code da clínica.'
            : `Não foi possível carregar: ${(e as Error).message}`,
        );
      }
    })();
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  // Acompanha o teste de aviso até sair (sent) ou falhar. Nunca "chegou" por conta própria.
  useEffect(() => {
    if (testState !== 'waiting' || !testId) return;
    const timer = setInterval(async () => {
      try {
        const s = await api<{ status: string; error?: string }>(`/api/p/push-test/${testId}`);
        if (s.status === 'sent') setTestState('sent');
        else if (s.status === 'failed') {
          setError(s.error ?? null);
          setTestState('failed');
        } else if (waitingSince && Date.now() - waitingSince > 90_000) setSlow(true);
      } catch (e) {
        setError((e as Error).message);
        setTestState('failed');
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [testState, testId, waitingSince]);

  async function activate() {
    setBusy(true);
    setError(null);
    setNotifyProblem(null);
    const r = await subscribePush();
    setBusy(false);
    if (r.ok) {
      try {
        await loadToday();
      } catch (e) {
        setError((e as Error).message);
      }
      setStep('test');
      return;
    }
    if (r.reason === 'error') setError(r.message ?? null);
    setNotifyProblem(r.reason);
  }

  async function sendTest() {
    setBusy(true);
    setError(null);
    setSlow(false);
    try {
      const { notificationId } = await api<{ notificationId: string }>('/api/p/push-test', {
        method: 'POST',
      });
      setTestId(notificationId);
      setWaitingSince(Date.now());
      setTestState('waiting');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'no_subscription') {
        setStep('notify');
        return;
      }
      setError(e instanceof ApiError ? e.message : 'Não foi possível pedir o teste.');
      setTestState('failed');
    } finally {
      setBusy(false);
    }
  }

  async function answerTest(arrived: boolean) {
    if (!testId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ confirmed: boolean }>(`/api/p/push-test/${testId}`, {
        method: 'POST',
        json: { arrived },
      });
      if (r.confirmed) setStep('done');
      else setTestState('not_arrived');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível registrar a resposta.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href.replace(/[?&]app=1/, ''));
      setError(null);
      setCopied(true);
    } catch {
      setError('Não deu para copiar. Toque e segure no endereço acima para copiar.');
    }
  }
  const later = (
    <Button
      variant="ghost"
      className="h-11 w-full text-muted-foreground"
      onClick={() => router.push('/p/hoje')}
      data-testid="setup-later"
    >
      Configurar depois
    </Button>
  );

  // --- progresso: numeração FIXA por convite. Quem volta (Safari → app da tela inicial) continua
  // de onde parou ("3 de 5" → "4 de 5"), em vez de a conta recomeçar e parecer que voltou atrás.
  const numbered: Step[] =
    props.mode === 'invite'
      ? [
          'welcome',
          'consent',
          ...(info && info.platform !== 'other' ? (['install'] as Step[]) : []),
          'notify',
          'test',
        ]
      : ['notify', 'test'];
  const current = step === 'browser' ? 'install' : step;
  const idx = numbered.indexOf(current);

  const errorBox = error && (
    <p
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      data-testid="setup-error"
    >
      {error}
    </p>
  );

  let body: ReactNode = null;
  const who = props.mode === 'invite' ? props.name : (today?.respondent.name ?? '');

  if (step === 'loading' && error) {
    body = null; // a mensagem de erro (abaixo) explica o que fazer
  } else if (step === 'loading') {
    body = (
      <div className="space-y-3" aria-busy="true">
        <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  } else if (step === 'welcome' && props.mode === 'invite') {
    body = (
      <Screen
        testId="setup-welcome"
        title={`Olá, ${props.name}`}
        actions={
          <Button className={big} onClick={() => setStep('consent')} data-testid="setup-start">
            Começar
          </Button>
        }
      >
        <p>
          {props.clinicName} convidou você para acompanhar{' '}
          {props.kind === 'patient' ? 'o seu tratamento' : `o tratamento de ${props.patientName}`}.
        </p>
        <p>
          Vamos deixar este celular pronto em <strong>poucos passos</strong>. É só seguir o que
          aparece na tela. Leva uns 3 minutos.
        </p>
      </Screen>
    );
  } else if (step === 'consent' && props.mode === 'invite') {
    body = (
      <Screen
        testId="setup-consent"
        title="Antes de começar"
        actions={
          <>
            <label className="flex items-start gap-3 rounded-lg border p-4 text-base">
              <Checkbox
                checked={agree}
                onCheckedChange={(v) => setAgree(v === true)}
                data-testid="agree"
                className="mt-0.5 size-5"
              />
              <span>Li e concordo.</span>
            </label>
            <Button
              className={big}
              disabled={!agree || busy}
              onClick={async () => {
                if ((await enter(true)) && info) {
                  try {
                    await route(info, standalone);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }
              }}
              data-testid="accept"
            >
              {busy ? 'Entrando…' : 'Aceitar e continuar'}
            </Button>
          </>
        }
      >
        <div className="rounded-xl border bg-muted/40 p-4 text-base" data-testid="consent-text">
          <h2 className="mb-2 font-semibold">Termo de consentimento ({CONSENT_VERSION})</h2>
          <ul className="list-disc space-y-2 pl-5">
            {/* Texto do termo v1 IGUAL ao aceito até aqui: mudar exige termo v2 e novo aceite
                (decisão da médica — ver ACHADOS). Só o layout mudou. */}
            <li>
              Suas respostas e confirmações de dose são registradas e vistas apenas pela equipe da
              clínica.
            </li>
            <li>
              As notificações são enviadas a este dispositivo; você pode desativá-las quando quiser.
            </li>
            <li>Você pode pedir a exportação ou a exclusão dos dados à clínica (LGPD).</li>
          </ul>
        </div>
      </Screen>
    );
  } else if (step === 'returning' && props.mode === 'invite') {
    body = (
      <Screen
        testId="setup-returning"
        title={`Olá de novo, ${props.name}`}
        actions={
          <Button
            className={big}
            disabled={busy}
            onClick={async () => {
              if ((await enter(false)) && info) {
                try {
                  await route(info, standalone);
                } catch (e) {
                  setError((e as Error).message);
                }
              }
            }}
            data-testid="accept"
          >
            {busy ? 'Entrando…' : 'Continuar neste celular'}
          </Button>
        }
      >
        <p>Você já aceitou o convite. Vamos só conferir se os avisos chegam neste celular.</p>
      </Screen>
    );
  } else if (step === 'browser' && info) {
    const app = info.embedded ?? 'outro aplicativo';
    body = (
      <Screen
        testId="setup-browser"
        title={info.platform === 'ios' ? 'Abra no Safari' : 'Abra no Chrome'}
        actions={
          <>
            <Button className={big} onClick={copyLink} data-testid="setup-copy">
              <CopyIcon /> {copied ? 'Link copiado!' : 'Copiar o link'}
            </Button>
            <Button
              variant="ghost"
              className="h-11 w-full text-muted-foreground"
              onClick={async () => {
                const semEmbutido = { ...info, embedded: null };
                setInfo(semEmbutido);
                try {
                  await route(semEmbutido, standalone);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
              data-testid="setup-browser-skip"
            >
              Já estou no {info.platform === 'ios' ? 'Safari' : 'Chrome'}, continuar
            </Button>
          </>
        }
      >
        <p>
          Você abriu o link dentro do <strong>{app}</strong>. Por aqui os avisos não funcionam.
        </p>
        <ol className="space-y-5">
          {info.platform === 'ios' ? (
            <>
              <Instruction n={1}>Toque em “Copiar o link”, aqui embaixo.</Instruction>
              <Instruction n={2} icon={<CompassIcon className="size-7" />}>
                Abra o <strong>Safari</strong> (a bússola azul).
              </Instruction>
              <Instruction n={3}>
                Toque na barra de endereço, segure o dedo e escolha <strong>Colar e Ir</strong>.
              </Instruction>
            </>
          ) : (
            <>
              <Instruction n={1} icon={<EllipsisVerticalIcon className="size-7" />}>
                Toque nos <strong>três pontinhos</strong>, no canto de cima.
              </Instruction>
              <Instruction n={2}>
                Escolha <strong>Abrir no Chrome</strong> (ou “Abrir no navegador”).
              </Instruction>
              <Instruction n={3}>
                Não achou? Toque em “Copiar o link” e cole no <strong>Chrome</strong>.
              </Instruction>
            </>
          )}
        </ol>
      </Screen>
    );
  } else if (step === 'install' && info) {
    if (info.platform === 'ios' && !info.iosPushSupported) {
      body = (
        <Screen testId="setup-ios-old" title="Atualize o iPhone primeiro">
          <p>
            Os avisos precisam de um iPhone com sistema <strong>16.4 ou mais novo</strong>.
          </p>
          <ol className="space-y-5">
            <Instruction n={1}>
              Abra <strong>Ajustes</strong> → <strong>Geral</strong> →{' '}
              <strong>Atualização de Software</strong>.
            </Instruction>
            <Instruction n={2}>Instale a atualização.</Instruction>
            <Instruction n={3}>Depois, leia de novo o QR code da clínica.</Instruction>
          </ol>
        </Screen>
      );
    } else if (info.platform === 'ios' && info.needsSafari) {
      body = (
        <Screen
          testId="setup-needs-safari"
          title="Abra no Safari"
          actions={
            <Button className={big} onClick={copyLink} data-testid="setup-copy">
              <CopyIcon /> {copied ? 'Link copiado!' : 'Copiar o link'}
            </Button>
          }
        >
          <p>No iPhone, o jeito mais simples de instalar é pelo Safari.</p>
          <ol className="space-y-5">
            <Instruction n={1}>Toque em “Copiar o link”.</Instruction>
            <Instruction n={2} icon={<CompassIcon className="size-7" />}>
              Abra o <strong>Safari</strong> (a bússola azul).
            </Instruction>
            <Instruction n={3}>
              Toque na barra de endereço, segure e escolha <strong>Colar e Ir</strong>.
            </Instruction>
          </ol>
        </Screen>
      );
    } else if (info.platform === 'ios') {
      body = (
        <Screen testId="setup-install-ios" title="Coloque o app na tela inicial">
          <ol className="space-y-6">
            <Instruction n={1} icon={<ShareIcon className="size-7" />}>
              Toque no botão <strong>Compartilhar</strong>. Ele fica embaixo, no meio da tela.
            </Instruction>
            <Instruction n={2} icon={<SquarePlusIcon className="size-7" />}>
              Role a lista para baixo e toque em <strong>Adicionar à Tela de Início</strong>.
            </Instruction>
            <Instruction n={3}>
              Toque em <strong>Adicionar</strong>, no canto de cima.
            </Instruction>
            <Instruction n={4}>
              <strong>Feche o Safari</strong> e toque no ícone <strong>MedCheck-in</strong> que
              apareceu na tela do celular.
            </Instruction>
          </ol>
          <p className="rounded-xl bg-muted/60 p-4 text-base">
            O app vai abrir já com o seu nome e continuar daqui. Não precisa aceitar de novo.
          </p>
        </Screen>
      );
    } else {
      body = (
        <Screen
          testId="setup-install-android"
          title="Instale o app no celular"
          actions={
            <>
              {canPromptInstall && (
                <Button
                  className={big}
                  data-testid="setup-install-prompt"
                  onClick={async () => {
                    const ev = installPrompt.current;
                    if (!ev) return;
                    await ev.prompt();
                    const { outcome } = await ev.userChoice;
                    installPrompt.current = null;
                    setCanPromptInstall(false);
                    if (outcome === 'accepted') setStep('notify');
                  }}
                >
                  Instalar o app
                </Button>
              )}
              <Button
                className={big}
                variant={canPromptInstall ? 'outline' : 'default'}
                onClick={() => setStep('notify')}
                data-testid="setup-install-done"
              >
                Já instalei, continuar
              </Button>
            </>
          }
        >
          {canPromptInstall ? (
            <p>Toque em “Instalar o app” e confirme. O ícone aparece na tela do celular.</p>
          ) : (
            <ol className="space-y-5">
              <Instruction n={1} icon={<EllipsisVerticalIcon className="size-7" />}>
                Toque nos <strong>três pontinhos</strong>, no canto de cima.
              </Instruction>
              <Instruction n={2}>
                Toque em <strong>Instalar app</strong> (ou “Adicionar à tela inicial”).
              </Instruction>
              <Instruction n={3}>
                Confirme em <strong>Instalar</strong>.
              </Instruction>
            </ol>
          )}
        </Screen>
      );
    }
  } else if (step === 'notify' && info) {
    const ios = info.platform === 'ios';
    body = (
      <Screen
        testId="setup-notify"
        title={notifyProblem === 'denied' ? 'Os avisos foram bloqueados' : 'Ative os avisos'}
        actions={
          <>
            {notifyProblem !== 'taken' && notifyProblem !== 'unavailable' && (
              <Button
                className={big}
                disabled={busy}
                onClick={activate}
                data-testid="setup-notify-go"
              >
                <BellRingIcon />{' '}
                {busy ? 'Ativando…' : notifyProblem ? 'Tentar de novo' : 'Ativar avisos'}
              </Button>
            )}
            {later}
          </>
        }
      >
        {!notifyProblem && (
          <>
            <p>É assim que chegam os lembretes de medicação e o check-in do dia.</p>
            <p className="rounded-xl bg-muted/60 p-4 text-base">
              Na próxima tela o celular vai perguntar se pode mandar notificações. Toque em{' '}
              <strong>Permitir</strong>.
            </p>
          </>
        )}
        {notifyProblem === 'denied' && (
          <>
            <p>Sem problema, dá para liberar:</p>
            <ol className="space-y-5" data-testid="setup-denied-help">
              {ios ? (
                <>
                  <Instruction n={1}>
                    Abra <strong>Ajustes</strong> → <strong>Notificações</strong>.
                  </Instruction>
                  <Instruction n={2}>
                    Toque em <strong>MedCheck-in</strong> e ligue{' '}
                    <strong>Permitir Notificações</strong>.
                  </Instruction>
                  <Instruction n={3}>Volte para cá e toque em “Tentar de novo”.</Instruction>
                </>
              ) : (
                <>
                  <Instruction n={1} icon={<EllipsisVerticalIcon className="size-7" />}>
                    Toque nos três pontinhos → <strong>Configurações</strong> →{' '}
                    <strong>Configurações do site</strong>.
                  </Instruction>
                  <Instruction n={2}>
                    Toque em <strong>Notificações</strong> e libere este site.
                  </Instruction>
                  <Instruction n={3}>Volte para cá e toque em “Tentar de novo”.</Instruction>
                </>
              )}
            </ol>
          </>
        )}
        {notifyProblem === 'unsupported' && (
          <p data-testid="setup-unsupported">
            {ios && !standalone
              ? 'No iPhone, os avisos só funcionam no app da tela inicial. Volte um passo: coloque o app na tela inicial e abra por ele.'
              : 'Este navegador não recebe avisos. Use o Chrome (Android) ou o Safari (iPhone).'}
          </p>
        )}
        {notifyProblem === 'taken' && (
          <p data-testid="setup-taken">
            Este celular já recebe os avisos de <strong>outra pessoa</strong> cadastrada. Na mesma
            casa, só uma pessoa usa o app em cada celular. Fale com a clínica.
          </p>
        )}
        {notifyProblem === 'unavailable' && (
          <p data-testid="setup-unavailable">
            Os avisos ainda não foram ligados no sistema da clínica. O problema não é o seu celular.
            Avise a clínica e volte a este passo depois.
          </p>
        )}
        {notifyProblem === 'error' && <p>Algo deu errado ao ativar. Tente de novo.</p>}
      </Screen>
    );
  } else if (step === 'test') {
    body = (
      <Screen
        testId="setup-test"
        title={
          testState === 'sent'
            ? 'Chegou o aviso?'
            : testState === 'not_arrived'
              ? 'Vamos conferir o celular'
              : testState === 'failed'
                ? 'Não conseguimos enviar'
                : 'Vamos testar'
        }
        actions={
          testState === 'sent' ? (
            <div className="grid grid-cols-2 gap-3">
              <Button
                className="h-14 text-base"
                disabled={busy}
                onClick={() => answerTest(true)}
                data-testid="setup-test-yes"
              >
                Sim, chegou
              </Button>
              <Button
                className="h-14 text-base"
                variant="outline"
                disabled={busy}
                onClick={() => answerTest(false)}
                data-testid="setup-test-no"
              >
                Não chegou
              </Button>
            </div>
          ) : testState === 'waiting' ? null : (
            <>
              <Button
                className={big}
                disabled={busy}
                onClick={sendTest}
                data-testid="setup-test-send"
              >
                {testState === 'idle' ? 'Enviar um aviso de teste' : 'Testar de novo'}
              </Button>
              {later}
            </>
          )
        }
      >
        {testState === 'idle' && (
          <p>Vamos mandar um aviso de teste para este celular. Pode levar até 1 minuto.</p>
        )}
        {testState === 'waiting' && (
          <div className="space-y-3" data-testid="setup-test-waiting">
            <p className="flex items-center gap-3">
              <LoaderIcon className="size-5 animate-spin" /> Enviando o teste…
            </p>
            {slow && (
              <p className="rounded-xl bg-muted/60 p-4 text-base">
                Está demorando mais que o normal. O sistema da clínica pode estar fora do ar. Espere
                mais um pouco ou tente de novo em alguns minutos.
              </p>
            )}
          </div>
        )}
        {testState === 'sent' && (
          <p>
            Enviamos um aviso escrito <strong>“Teste do MedCheck-in”</strong>. Olhe no alto da tela
            ou na tela bloqueada.
          </p>
        )}
        {testState === 'failed' && (
          <p>Tente de novo em alguns minutos. Se continuar, mostre esta tela para a clínica.</p>
        )}
        {testState === 'not_arrived' && (
          <ol className="space-y-5" data-testid="setup-not-arrived">
            <Instruction n={1}>
              O celular não pode estar no <strong>Não Perturbe</strong>, em <strong>Foco</strong> ou
              no silencioso.
            </Instruction>
            <Instruction n={2}>
              Nos <strong>Ajustes</strong> do celular, as notificações do{' '}
              <strong>{info?.platform === 'android' ? 'Chrome' : 'MedCheck-in'}</strong> precisam
              estar ligadas.
            </Instruction>
            {info?.platform === 'ios' && (
              <Instruction n={3}>
                Abra sempre pelo <strong>ícone MedCheck-in</strong> da tela inicial, não pelo
                Safari.
              </Instruction>
            )}
          </ol>
        )}
      </Screen>
    );
  } else if (step === 'done') {
    const patientName = props.mode === 'invite' ? props.patientName : today?.patient.name;
    const kind = props.mode === 'invite' ? props.kind : today?.respondent.kind;
    body = (
      <section
        className="flex flex-col items-center gap-3 py-8 text-center"
        data-testid="setup-done"
      >
        <span className="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <CheckIcon className="size-8" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Tudo pronto!</h1>
        <p className="text-[17px] leading-relaxed">
          Os lembretes de medicação e o check-in do dia vão chegar neste celular
          {kind === 'caregiver' && patientName ? `, para você responder por ${patientName}` : ''}.
        </p>
        <p className="text-base text-muted-foreground">
          Deixe o som do celular ligado nos horários de medicação.
        </p>
        <Button
          className={`${big} mt-4`}
          onClick={() => router.push('/p/hoje')}
          data-testid="setup-finish"
        >
          Ir para a tela de hoje
        </Button>
      </section>
    );
  } else if (step === 'shared') {
    body = (
      <Screen
        testId="setup-shared"
        title="Este acesso não usa celular próprio"
        actions={
          <Button className={big} onClick={() => router.push('/p/hoje')}>
            Ir para a tela de hoje
          </Button>
        }
      >
        <p>
          A clínica marcou que {who ? `${who} usa` : 'esta pessoa usa'} o celular de outra pessoa da
          casa. Os avisos chegam no celular de quem cuida.
        </p>
      </Screen>
    );
  }

  return (
    <div className="space-y-6" data-testid="setup-wizard" data-step={step}>
      {idx >= 0 && (
        <div className="space-y-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.round(((idx + 1) / numbered.length) * 100)}%` }}
            />
          </div>
          <p className="font-mono text-sm text-muted-foreground" data-testid="setup-progress">
            Passo {idx + 1} de {numbered.length}
          </p>
        </div>
      )}
      {body}
      {errorBox}
    </div>
  );
}
