# SIMP Backend — Guia para Agentes

## Blueprint

Consulte o blueprint completo em:
- **Obsidian:** `../SYSTEM-GYM/SIMP - Blueprint Fase 2.md`
- **Resumo:** `../ARCHITECTURE-BLUEPRINT.md`

## Stack

- NestJS + Supabase (service role)
- Migrations em `supabase/migrations/`
- Types em `src/shared/types/database.types.ts`

## Módulos

| Módulo | Path | Status |
|--------|------|--------|
| auth | `src/modules/auth/` | Ativo |
| biometrics | `src/modules/biometrics/` | Base |
| ecomm | `src/modules/ecomm/` | Parcial |
| finance | `src/modules/finance/` | Ativo + cron |
| gamification | `src/modules/gamification/` | Parcial |
| occupancy | `src/modules/occupancy/` | Ativo |
| workouts | `src/modules/workouts/` | Base |

## Guards

- `jwt-auth.guard.ts` — Endpoints autenticados
- `edge-api-key.guard.ts` — Catraca/biometria edge

## Segurança

- UUID v4 para todos os IDs públicos
- Ownership check em POST/PUT/PATCH/DELETE
- 404 (não 403) para recursos não autorizados
- RLS restritivo nas migrations
- Transactions atômicas em rotas financeiras
- ARGON2id para senhas
- Rate limit + CAPTCHA no login

## Hotfix Imediato

Erro PGRST205 (schema cache): executar no SQL Editor:
```sql
NOTIFY pgrst, 'reload schema';
```
