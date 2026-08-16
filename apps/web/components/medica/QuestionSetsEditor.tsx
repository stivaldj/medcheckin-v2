'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const KINDS = Object.keys(KIND_LABEL);
const OPS = ['>=', '>', '<=', '<', '==', '!='];

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

function SetEditor({ set }: { set: QSet }) {
  const router = useRouter();
  const [qs, setQs] = useState<Q[]>(set.questions.map((q) => ({ ...q, key: q.key })));
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
  const sel = 'h-9 rounded-md border bg-background px-2 text-sm';
  return (
    <Card data-testid={`set-${set.id}`}>
      <CardHeader>
        <CardTitle>{set.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {qs.map((q, i) => {
          const key = q.key ?? slugPreview(q.label);
          const previous = qs
            .slice(0, i)
            .map((p) => p.key ?? slugPreview(p.label))
            .filter(Boolean);
          return (
            <div key={i} className="rounded-md border p-3" data-testid={`question-${i}`}>
              <div className="flex items-start gap-2">
                <div className="flex flex-col">
                  <button
                    type="button"
                    className="text-xs"
                    onClick={() => move(i, -1)}
                    aria-label="subir"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="text-xs"
                    onClick={() => move(i, 1)}
                    aria-label="descer"
                  >
                    ▼
                  </button>
                </div>
                <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <div>
                    <Label>Pergunta</Label>
                    <Input
                      value={q.label}
                      onChange={(e) => upd(i, { label: e.target.value })}
                      placeholder="Como está sua dor hoje?"
                    />
                    <div className="mt-1 text-xs text-muted-foreground">chave: {key || '—'}</div>
                  </div>
                  <div>
                    <Label>Tipo</Label>
                    <select
                      className={sel}
                      value={q.kind}
                      onChange={(e) =>
                        upd(i, {
                          kind: e.target.value,
                          score_direction: ['scale_0_10', 'yes_no'].includes(e.target.value)
                            ? q.score_direction
                            : null,
                        })
                      }
                    >
                      {KINDS.map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setQs((a) => a.filter((_, j) => j !== i))}
                    >
                      remover
                    </Button>
                  </div>
                </div>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {q.kind === 'choice' && (
                  <div className="sm:col-span-2">
                    <Label>Opções (uma por linha)</Label>
                    <textarea
                      className="w-full rounded-md border bg-background p-2 text-sm"
                      rows={3}
                      value={q.options.join('\n')}
                      onChange={(e) => upd(i, { options: e.target.value.split('\n') })}
                    />
                  </div>
                )}
                {q.kind === 'number' && (
                  <div>
                    <Label>Unidade</Label>
                    <Input
                      value={q.unit ?? ''}
                      onChange={(e) => upd(i, { unit: e.target.value || null })}
                    />
                  </div>
                )}
                <div>
                  <Label>Alerta se</Label>
                  <div className="flex gap-1">
                    <select
                      className={sel}
                      value={q.alert_threshold_json?.op ?? ''}
                      onChange={(e) =>
                        upd(i, {
                          alert_threshold_json: e.target.value
                            ? { op: e.target.value, value: q.alert_threshold_json?.value ?? '' }
                            : null,
                        })
                      }
                    >
                      <option value="">—</option>
                      {OPS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                    <Input
                      className="w-24"
                      value={String(q.alert_threshold_json?.value ?? '')}
                      disabled={!q.alert_threshold_json}
                      onChange={(e) =>
                        upd(i, {
                          alert_threshold_json: {
                            op: q.alert_threshold_json!.op,
                            value: e.target.value,
                          },
                        })
                      }
                    />
                  </div>
                </div>
                <div>
                  <Label>Só perguntar se</Label>
                  <div className="flex gap-1">
                    <select
                      className={sel}
                      value={q.condition_json?.when ?? ''}
                      onChange={(e) =>
                        upd(i, {
                          condition_json: e.target.value
                            ? {
                                when: e.target.value,
                                op: q.condition_json?.op ?? '==',
                                value: q.condition_json?.value ?? 1,
                              }
                            : null,
                        })
                      }
                    >
                      <option value="">— sempre</option>
                      {previous.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                    {q.condition_json && (
                      <>
                        <select
                          className={sel}
                          value={q.condition_json.op}
                          onChange={(e) =>
                            upd(i, { condition_json: { ...q.condition_json!, op: e.target.value } })
                          }
                        >
                          {OPS.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                        <Input
                          className="w-20"
                          value={String(q.condition_json.value ?? '')}
                          onChange={(e) =>
                            upd(i, {
                              condition_json: { ...q.condition_json!, value: e.target.value },
                            })
                          }
                        />
                      </>
                    )}
                  </div>
                </div>
                {['scale_0_10', 'yes_no'].includes(q.kind) && (
                  <div>
                    <Label>Score</Label>
                    <div className="flex gap-1">
                      <select
                        className={sel}
                        value={q.score_direction ?? ''}
                        onChange={(e) => upd(i, { score_direction: e.target.value || null })}
                      >
                        <option value="">fora do score</option>
                        <option value="higher_is_better">maior = melhor</option>
                        <option value="lower_is_better">menor = melhor</option>
                      </select>
                      {q.score_direction && (
                        <Input
                          className="w-16"
                          type="number"
                          step="0.5"
                          min="0.5"
                          value={q.score_weight}
                          onChange={(e) => upd(i, { score_weight: Number(e.target.value) })}
                          title="peso"
                        />
                      )}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <label className="flex items-center gap-1">
                    <Checkbox
                      checked={q.required}
                      onCheckedChange={(v) => upd(i, { required: v === true })}
                    />{' '}
                    obrigatória
                  </label>
                  <label className="flex items-center gap-1">
                    <Checkbox
                      checked={q.is_side_effect}
                      onCheckedChange={(v) => upd(i, { is_side_effect: v === true })}
                    />{' '}
                    efeito adverso
                  </label>
                </div>
              </div>
            </div>
          );
        })}
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => setQs((a) => [...a, emptyQ()])}>
            Adicionar pergunta
          </Button>
          <Button type="button" onClick={save} disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar conjunto'}
          </Button>
          {saved && <span className="text-sm text-green-700">Salvo.</span>}
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>
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
      <form onSubmit={create} className="flex items-end gap-2">
        <div>
          <Label htmlFor="set-name">Novo conjunto</Label>
          <Input
            id="set-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Manutenção"
            required
            minLength={2}
          />
        </div>
        <Button type="submit" variant="outline">
          Criar
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </form>
    </div>
  );
}
