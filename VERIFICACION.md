# Verificación — Firebase Spark sin correos

16 de noviembre de 2026.

- Frontend: TypeScript y compilación Vite correctos.
- Pruebas unitarias y React: **52 aprobadas**.
- SDK web contra Firestore Emulator con reglas reales: **18 aprobadas**.
- Total del flujo actual: **70 pruebas aprobadas**.

La suite Spark cubre inicialización exclusiva del propietario con Google verificado; bloqueo de otros proveedores/correos y revocación; aportes sin sesión y sin foto; privados inaccesibles; aprobación, rechazo y proyección pública exacta; fotos pendientes privadas y conversión al aprobar; conservación de datos privados en correcciones; revisiones desactualizadas; creación y eliminación de vínculos, ciclos e idempotencia; hipótesis privadas; eliminación de personas; recibos y contadores atómicos; cuota global que el cliente no puede reiniciar; privacidad; aportes y aprobaciones simultáneos. No se escriben registros de correo.

Las 52 pruebas unitarias incluyen fechas parciales, validación de genealogía y fotos, borradores, interacción con nodos de React Flow y revisión modal. Las pruebas de integración anteriores con Cloud Functions ya no representan la arquitectura actual; `test:emulators` ejecuta `tests/spark.test.ts`.

## Configuración real preparada

- Proyecto `mi-arbol-19103`, base `(default)` Standard en `southamerica-east1`, marcada `freeTier: true` por Google.
- Reglas e índices Spark desplegados correctamente; las fotos base64 no se indexan.
- Authentication inicializado y Google habilitado.
- Dominio `leonelbustamante.github.io` autorizado.
- App Check registrado con reCAPTCHA Enterprise para los dominios del sitio; variables públicas cargadas en GitHub.
- Ninguna Cloud Function, servicio de correo ni facturación habilitada por este trabajo.
- Compilación productiva separada en `.local/production-dist`, con Firebase real y emuladores desactivados.

## Verificaciones pendientes de publicación

Comprobar entrega del HTML y assets en el dominio final, App Check desde el navegador, sesión Google del administrador, recepción y moderación en producción y pantalla móvil. GitHub Actions informó un bloqueo de cuenta por facturación; se probará Pages con los archivos ya compilados. La publicación no se considera completa hasta verificar su URL.

Los datos manuales y fotos se conservan en el emulador `demo-mi-arbol-local` y en `.local/firebase-data`, excluidos de Git. Las pruebas usan otro proyecto y otros puertos. Ningún dato familiar se publica dentro del repositorio de código.
