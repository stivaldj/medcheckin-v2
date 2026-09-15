'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { catalogNameKey } from '@medcheckin/core/name-key';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CatalogNameInput } from './CatalogNameInput';

type Resp = {
  kind: 'patient' | 'caregiver';
  name: string;
  email: string;
  phone: string;
  relationship: string;
  can_answer: boolean;
  receives_alarms: boolean;
};
const emptyResp = (kind: Resp['kind']): Resp => ({
  kind,
  name: '',
  email: '',
  phone: '',
  relationship: '',
  can_answer: true,
  receives_alarms: true,
});

export const CONSENT_VERSION = 'v1';

export function NewPatientForm({ conditionNames }: { conditionNames: string[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [conditions, setConditions] = useState<string[]>([]);
  const [conditionDraft, setConditionDraft] = useState('');
  function addCondition() {
    const v = conditionDraft.trim();
    if (v.length < 2) return;
    if (!conditions.some((c) => catalogNameKey(c) === catalogNameKey(v)))
      setConditions((cs) => [...cs, v]);
    setConditionDraft('');
  }
  const [checkinTime, setCheckinTime] = useState('09:00');
  const [resps, setResps] = useState<Resp[]>([emptyResp('patient')]);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function setResp(i: number, patch: Partial<Resp>) {
    setResps((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!consent) {
      setError('Confirme que o consentimento foi obtido antes de cadastrar.');
      return;
    }
    setSaving(true);
    try {
      const out = await api<{ patient: { id: string } }>('/api/patients', {
        method: 'POST',
        json: {
          name,
          birth_date: birth || null,
          conditions,
          checkin_time: checkinTime,
          consent_version: CONSENT_VERSION,
          respondents: resps.map((r) => ({
            ...r,
            name: r.name || (r.kind === 'patient' ? name : ''),
            email: r.email || null,
            phone: r.phone || null,
            relationship: r.relationship || null,
          })),
        },
      });
      router.push(`/pacientes/${out.patient.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro inesperado ao salvar.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Dados do paciente</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="birth">Data de nascimento</Label>
            <Input
              id="birth"
              type="date"
              value={birth}
              onChange={(e) => setBirth(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="checkin_time">Horário do check-in</Label>
            <Input
              id="checkin_time"
              type="time"
              value={checkinTime}
              onChange={(e) => setCheckinTime(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="condition">Condições</Label>
            <CatalogNameInput
              id="condition"
              value={conditionDraft}
              onChange={setConditionDraft}
              suggestions={conditionNames}
              onSubmit={addCondition}
              placeholder="Ex.: epilepsia — Enter adiciona"
              testId="condition"
            />
            {conditions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5" data-testid="new-patient-conditions">
                {conditions.map((c) => (
                  <Badge key={c} variant="outline" className="gap-1 pr-1">
                    {c}
                    <button
                      type="button"
                      aria-label={`Remover ${c}`}
                      className="rounded-full px-1 hover:bg-muted"
                      onClick={() => setConditions((cs) => cs.filter((x) => x !== c))}
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quem responde e recebe alarmes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {resps.map((r, i) => (
            <div key={i} className="rounded-md border p-3" data-testid={`respondent-${i}`}>
              <div className="mb-2 flex items-center justify-between">
                <strong>{r.kind === 'patient' ? 'Paciente' : 'Cuidador'}</strong>
                {resps.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setResps((rs) => rs.filter((_, j) => j !== i))}
                  >
                    remover
                  </Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor={`r-name-${i}`}>Nome</Label>
                  <Input
                    id={`r-name-${i}`}
                    value={r.name}
                    placeholder={r.kind === 'patient' ? name : ''}
                    onChange={(e) => setResp(i, { name: e.target.value })}
                    required={r.kind === 'caregiver'}
                  />
                </div>
                {r.kind === 'caregiver' && (
                  <div>
                    <Label htmlFor={`r-rel-${i}`}>Relação</Label>
                    <Input
                      id={`r-rel-${i}`}
                      value={r.relationship}
                      placeholder="mãe, cônjuge…"
                      onChange={(e) => setResp(i, { relationship: e.target.value })}
                    />
                  </div>
                )}
                <div>
                  <Label htmlFor={`r-email-${i}`}>E-mail (opcional)</Label>
                  <Input
                    id={`r-email-${i}`}
                    type="email"
                    value={r.email}
                    onChange={(e) => setResp(i, { email: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor={`r-phone-${i}`}>Telefone (opcional)</Label>
                  <Input
                    id={`r-phone-${i}`}
                    value={r.phone}
                    onChange={(e) => setResp(i, { phone: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={r.can_answer}
                    onCheckedChange={(v) => setResp(i, { can_answer: v === true })}
                  />{' '}
                  pode responder check-ins
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={r.receives_alarms}
                    onCheckedChange={(v) => setResp(i, { receives_alarms: v === true })}
                  />{' '}
                  recebe alarmes de dose
                </label>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => setResps((rs) => [...rs, emptyResp('caregiver')])}
          >
            Adicionar cuidador
          </Button>
        </CardContent>
      </Card>

      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={consent}
          onCheckedChange={(v) => setConsent(v === true)}
          data-testid="consent"
        />
        <span>
          Confirmo que o paciente/responsável foi informado e consentiu com o acompanhamento remoto
          (termo {CONSENT_VERSION}). Cada respondente também aceitará o termo ao entrar pelo link de
          convite.
        </span>
      </label>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={saving}>
        {saving ? 'Salvando…' : 'Cadastrar paciente'}
      </Button>
    </form>
  );
}
