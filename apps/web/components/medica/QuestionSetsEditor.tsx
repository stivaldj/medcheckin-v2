'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDownIcon, ChevronUpIcon, ListPlusIcon, Trash2Icon } from 'lucide-react';

import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from '@/components/ui/field';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item';
import { SimpleSelect } from '@/components/ui/simple-select';
import { Textarea } from '@/components/ui/textarea';
import { KIND_LABEL } from '@/lib/format';

type Q = {
  key?: string;
  label: string;
  kind: string;
  options: string[];
  unit: string | null;
  required: boolean;
  is_side_effect: boolean;
  condition_json: { when: string; op: string; value: unknown } | null;
  alert_threshold_json: { op: string; value: unknown } | null;
  score_direction: string | null;
  score_weight: number;
};
type QSet = { id: string; name: string; questions: Q[] };

const KIND_OPTIONS = Object.keys(KIND_LABEL).map((k) => ({ value: k, label: KIND_LABEL[k] }));
const OPS = ['>=', '>', '<=', '<', '==', '!='];
const OP_OPTIONS = OPS.map((o) => ({ value: o, label: o }));
const DIRECAO_OPTIONS = [
  { value: '', label: 'fora do score' },
  { value: 'higher_is_better', label: 'maior = melhor' },
  { value: 'lower_is_better', label: 'menor = melhor' },
];
const DIRECAO_CURTA: Record<string, string> = {
  higher_is_better: 'maior = melhor',
  lower_is_better: 'menor = melhor',
};
const PONTUAVEL = ['scale_0_10', 'yes_no'];

function slugPreview(label: string) {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

const emptyQ = (): Q => ({
  label: '',
  kind: 'scale_0_10',
  options: [],
  unit: null,
  required: true,
  is_side_effect: false,
  condition_json: null,
  alert_threshold_json: null,
  score_direction: null,
  score_weight: 1,
});

/**
 * O que esta pergunta faz, em uma linha — só o que está de fato ligado.
 *
 * Era aqui que a tela se perdia: todas as regras apareciam sempre, ligadas ou não, então cinco
 * perguntas viravam 35 controles na tela e nada dizia o que estava valendo.
 */
function resumo(q: Q): string {
  const partes = [KIND_LABEL[q.kind] ?? q.kind];
  if (q.kind === 'number' && q.unit) partes.push(`em ${q.unit}`);
  if (q.kind === 'choice' && q.options.filter(Boolean).length)
    partes.push(`${q.options.filter(Boolean).length} opções`);
  partes.push(q.required ? 'obrigatória' : 'opcional');
  if (q.alert_threshold_json?.op)
    partes.push(`alerta se ${q.alert_threshold_json.op} ${q.alert_threshold_json.value ?? ''}`);
  if (q.condition_json?.when)
    partes.push(
      `só se ${q.condition_json.when} ${q.condition_json.op} ${q.condition_json.value ?? ''}`,
    );
  if (q.score_direction)
    partes.push(`score ${DIRECAO_CURTA[q.score_direction]}, peso ${q.score_weight}`);
  if (q.is_side_effect) partes.push('efeito adverso');
  return partes.join(' · ');
}

function QuestionRow({
  q,
  i,
  total,
  anteriores,
  aberta,
  onToggle,
  upd,
  move,
  remove,
}: {
  q: Q;
  i: number;
  total: number;
  anteriores: string[];
  aberta: boolean;
  onToggle: (aberta: boolean) => void;
  upd: (patch: Partial<Q>) => void;
  move: (d: -1 | 1) => void;
  remove: () => void;
}) {
  const key = q.key ?? slugPreview(q.label);
  return (
    <Collapsible open={aberta} onOpenChange={onToggle}>
      <Item size="sm" data-testid={`question-${i}`} className="items-start">
        <ItemContent>
          <ItemTitle className="flex-wrap">
            {q.label || <span className="text-muted-foreground italic">Nova pergunta</span>}
          </ItemTitle>
          <ItemDescription className="font-mono text-xs">{resumo(q)}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="outline" className="font-mono">
            {key || '—'}
          </Badge>
          <div className="flex flex-col">
            <button
              type="button"
              className="rounded-sm px-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              onClick={() => move(-1)}
              disabled={i === 0}
              aria-label={`Subir “${q.label || 'nova pergunta'}”`}
            >
              <ChevronUpIcon className="size-3.5" />
            </button>
            <button
              type="button"
              className="rounded-sm px-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
              onClick={() => move(1)}
              disabled={i === total - 1}
              aria-label={`Descer “${q.label || 'nova pergunta'}”`}
            >
              <ChevronDownIcon className="size-3.5" />
            </button>
          </div>
          <CollapsibleTrigger
            render={
              <Button variant="ghost" size="sm">
                {aberta ? 'Fechar' : 'Editar'}
                <ChevronDownIcon className={`transition-transform ${aberta ? 'rotate-180' : ''}`} />
              </Button>
            }
          />
        </ItemActions>
      </Item>

      <CollapsibleContent>
        <div className="mt-1 mb-3 ml-4 rounded-lg border bg-muted/30 p-4">
          <FieldGroup>
            <FieldSet>
              <FieldLegend>Enunciado</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`q-${i}-label`}>Pergunta</FieldLabel>
                  <Input
                    id={`q-${i}-label`}
                    value={q.label}
                    onChange={(e) => upd({ label: e.target.value })}
                    placeholder="Como está sua dor hoje?"
                  />
                  <FieldDescription>
                    <span className="font-mono">{`chave: ${key || '—'}`}</span>
                    {q.key ? ' — imutável: mudar o enunciado preserva a série.' : ''}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`q-${i}-kind`}>Tipo de resposta</FieldLabel>
                  <SimpleSelect
                    id={`q-${i}-kind`}
                    value={q.kind}
                    onValueChange={(v) =>
                      upd({
                        kind: v,
                        score_direction: PONTUAVEL.includes(v) ? q.score_direction : null,
                      })
                    }
                    options={KIND_OPTIONS}
                  />
                </Field>
                {q.kind === 'choice' && (
                  <Field>
                    <FieldLabel htmlFor={`q-${i}-options`}>Opções</FieldLabel>
                    <Textarea
                      id={`q-${i}-options`}
                      rows={3}
                      value={q.options.join('\n')}
                      onChange={(e) => upd({ options: e.target.value.split('\n') })}
                    />
                    <FieldDescription>Uma por linha.</FieldDescription>
                  </Field>
                )}
                {q.kind === 'number' && (
                  <Field>
                    <FieldLabel htmlFor={`q-${i}-unit`}>Unidade</FieldLabel>
                    <Input
                      id={`q-${i}-unit`}
                      value={q.unit ?? ''}
                      onChange={(e) => upd({ unit: e.target.value || null })}
                      placeholder="kg, crises, horas…"
                    />
                  </Field>
                )}
                <Field orientation="horizontal">
                  <Checkbox
                    id={`q-${i}-req`}
                    checked={q.required}
                    onCheckedChange={(v) => upd({ required: v === true })}
                  />
                  <FieldLabel htmlFor={`q-${i}-req`} className="font-normal">
                    Obrigatória — o check-in não fecha sem ela
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id={`q-${i}-ae`}
                    checked={q.is_side_effect}
                    onCheckedChange={(v) => upd({ is_side_effect: v === true })}
                  />
                  <FieldLabel htmlFor={`q-${i}-ae`} className="font-normal">
                    Conta como efeito adverso
                  </FieldLabel>
                </Field>
              </FieldGroup>
            </FieldSet>

            <FieldSeparator />

            <FieldSet>
              <FieldLegend>Quando alertar</FieldLegend>
              <FieldDescription>Sem operador, esta pergunta nunca gera alerta.</FieldDescription>
              <FieldGroup>
                <div className="grid grid-cols-[9rem_1fr] gap-3">
                  <Field>
                    <FieldLabel htmlFor={`q-${i}-alert-op`}>Operador</FieldLabel>
                    <SimpleSelect
                      id={`q-${i}-alert-op`}
                      value={q.alert_threshold_json?.op ?? ''}
                      onValueChange={(v) =>
                        upd({
                          alert_threshold_json: v
                            ? { op: v, value: q.alert_threshold_json?.value ?? '' }
                            : null,
                        })
                      }
                      options={[{ value: '', label: '— nunca' }, ...OP_OPTIONS]}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`q-${i}-alert-val`}>Valor</FieldLabel>
                    <Input
                      id={`q-${i}-alert-val`}
                      value={String(q.alert_threshold_json?.value ?? '')}
                      disabled={!q.alert_threshold_json}
                      onChange={(e) =>
                        upd({
                          alert_threshold_json: {
                            op: q.alert_threshold_json!.op,
                            value: e.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                </div>
              </FieldGroup>
            </FieldSet>

            <FieldSeparator />

            <FieldSet>
              <FieldLegend>Quando perguntar</FieldLegend>
              <FieldDescription>
                Só é possível condicionar a uma pergunta que vem antes desta.
              </FieldDescription>
              <FieldGroup>
                <div className="grid grid-cols-[1fr_7rem_7rem] gap-3">
                  <Field>
                    <FieldLabel htmlFor={`q-${i}-cond`}>Depende de</FieldLabel>
                    <SimpleSelect
                      id={`q-${i}-cond`}
                      value={q.condition_json?.when ?? ''}
                      onValueChange={(v) =>
                        upd({
                          condition_json: v
                            ? {
                                when: v,
                                op: q.condition_json?.op ?? '==',
                                value: q.condition_json?.value ?? 1,
                              }
                            : null,
                        })
                      }
                      options={[
                        { value: '', label: '— sempre perguntar' },
                        ...anteriores.map((k) => ({ value: k, label: k })),
                      ]}
                    />
                  </Field>
                  {q.condition_json && (
                    <>
                      <Field>
                        <FieldLabel htmlFor={`q-${i}-cond-op`}>Operador</FieldLabel>
                        <SimpleSelect
                          id={`q-${i}-cond-op`}
                          value={q.condition_json.op}
                          onValueChange={(v) =>
                            upd({ condition_json: { ...q.condition_json!, op: v } })
                          }
                          options={OP_OPTIONS}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`q-${i}-cond-val`}>Valor</FieldLabel>
                        <Input
                          id={`q-${i}-cond-val`}
                          value={String(q.condition_json.value ?? '')}
                          onChange={(e) =>
                            upd({ condition_json: { ...q.condition_json!, value: e.target.value } })
                          }
                        />
                      </Field>
                    </>
                  )}
                </div>
              </FieldGroup>
            </FieldSet>

            {PONTUAVEL.includes(q.kind) && (
              <>
                <FieldSeparator />
                <FieldSet>
                  <FieldLegend>Score</FieldLegend>
                  <FieldDescription>
                    Fora do score, a pergunta continua sendo feita e guardada — só não entra no
                    número do dia.
                  </FieldDescription>
                  <FieldGroup>
                    <div className="grid grid-cols-[1fr_7rem] gap-3">
                      <Field>
                        <FieldLabel htmlFor={`q-${i}-dir`}>Direção</FieldLabel>
                        <SimpleSelect
                          id={`q-${i}-dir`}
                          value={q.score_direction ?? ''}
                          onValueChange={(v) => upd({ score_direction: v || null })}
                          options={DIRECAO_OPTIONS}
                        />
                      </Field>
                      {q.score_direction && (
                        <Field>
                          <FieldLabel htmlFor={`q-${i}-peso`}>Peso</FieldLabel>
                          <Input
                            id={`q-${i}-peso`}
                            type="number"
                            step="0.5"
                            min="0.5"
                            value={q.score_weight}
                            onChange={(e) => upd({ score_weight: Number(e.target.value) })}
                          />
                        </Field>
                      )}
                    </div>
                  </FieldGroup>
                </FieldSet>
              </>
            )}

            <FieldSeparator />
            <Field orientation="horizontal">
              <Button type="button" variant="ghost" size="sm" onClick={remove}>
                <Trash2Icon /> Remover pergunta
              </Button>
            </Field>
          </FieldGroup>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SetEditor({ set }: { set: QSet }) {
  const router = useRouter();
  const [qs, setQs] = useState<Q[]>(set.questions.map((q) => ({ ...q, key: q.key })));
  const [abertaIdx, setAbertaIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const upd = (i: number, patch: Partial<Q>) =>
    setQs((a) => a.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: -1 | 1) =>
    setQs((a) => {
      const b = [...a];
      const j = i + d;
      if (j < 0 || j >= b.length) return a;
      [b[i], b[j]] = [b[j], b[i]];
      return b;
    });
  function adicionar() {
    setQs((a) => [...a, emptyQ()]);
    // Pergunta nova nasce aberta: ninguém adiciona uma pergunta para não escrevê-la.
    setAbertaIdx(qs.length);
  }
  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api(`/api/question-sets/${set.id}/questions`, { method: 'PUT', json: qs });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card data-testid={`set-${set.id}`}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>
          {set.name}{' '}
          <span className="font-normal text-muted-foreground">
            ({qs.length} {qs.length === 1 ? 'pergunta' : 'perguntas'})
          </span>
        </CardTitle>
        <div className="flex items-center gap-2">
          {saved && <span className="text-sm text-sev-low">Salvo.</span>}
          {error && <span className="text-sm text-destructive">{error}</span>}
          <Button type="button" variant="outline" size="sm" onClick={adicionar}>
            <ListPlusIcon /> Adicionar pergunta
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar conjunto'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {qs.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListPlusIcon />
              </EmptyMedia>
              <EmptyTitle>Conjunto vazio</EmptyTitle>
              <EmptyDescription>
                Nenhuma pergunta ainda. A ordem aqui é a ordem em que o paciente responde.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup>
            {qs.map((q, i) => (
              <div key={i}>
                {i > 0 && <ItemSeparator />}
                <QuestionRow
                  q={q}
                  i={i}
                  total={qs.length}
                  anteriores={qs
                    .slice(0, i)
                    .map((p) => p.key ?? slugPreview(p.label))
                    .filter(Boolean)}
                  aberta={abertaIdx === i}
                  onToggle={(aberta) => setAbertaIdx(aberta ? i : null)}
                  upd={(patch) => upd(i, patch)}
                  move={(d) => move(i, d)}
                  remove={() => {
                    setQs((a) => a.filter((_, j) => j !== i));
                    setAbertaIdx(null);
                  }}
                />
              </div>
            ))}
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  );
}

export function QuestionSetsEditor({ sets }: { sets: QSet[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/api/question-sets', { method: 'POST', json: { name } });
      setName('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro');
    }
  }
  return (
    <div className="space-y-6">
      {sets.map((s) => (
        <SetEditor key={s.id} set={s} />
      ))}
      <Card>
        <CardContent>
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="set-name">Novo conjunto</Label>
              <Input
                id="set-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Manutenção"
                required
                minLength={2}
                className="w-64"
              />
            </div>
            <Button type="submit" variant="outline">
              Criar
            </Button>
            {error && <span className="text-sm text-destructive">{error}</span>}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
