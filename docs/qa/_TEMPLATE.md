# QA — <card-id> <titulo>

- Spec: docs/specs/<card-id>.md
- Rango revisado: <commit-base>..<commit-head>
- Ronda: 1
- Implementer: sonnet · QA: opus

## Criterios de aceptacion
| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | ... | CUMPLIDO / NO CUMPLIDO | archivo:linea o test |

## Bugs

### BUG-1 · <severidad: CRITICO|ALTO|MEDIO|BAJO> · <ABIERTO|CORREGIDO|DISPUTADO|VERIFICADO|DESCARTADO>
- Ubicacion: `ruta/archivo.ts:linea`
- Escenario de falla: entrada/estado -> resultado erroneo
- Fix sugerido: (opcional, una linea)
- Fix aplicado (implementer): commit + descripcion
- Verificacion (QA): ronda N, evidencia

## Tests
- vitest: <N pass / M fail>
- tsc --noEmit: <ok / errores>

VEREDICTO: <APROBADO | RECHAZADO (N abiertos)>
