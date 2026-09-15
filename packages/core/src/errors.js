/** Erro de validação de entrada (campo opcional, status HTTP opcional). Usado por todos os serviços. */
export class ValidationError extends Error {
  constructor(message, field = null, { status } = {}) {
    super(message);
    this.code = 'validation';
    this.field = field;
    this.status = status;
  }
}
