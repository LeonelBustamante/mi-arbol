# Verificación local — 16 de noviembre de 2026

## Resultado

- Compilación de frontend y Cloud Functions: correcta.
- Pruebas unitarias: **52 aprobadas**.
- Firebase Emulator Suite: **55 aprobadas**, con Auth, Firestore y Functions reales en entorno emulado (24 de integración y 31 de reglas).
- Total: **107 pruebas aprobadas**, sin fallos.
- Vista previa del importador: plantilla válida, cero personas y cero vínculos, sin escrituras.
- La instalación de dependencias informó cero vulnerabilidades al actualizar Sharp a 0.35.5. Se conservó el override de gRPC corregido.
- Nuevas pruebas: nombre del colaborador obligatorio, fechas parciales y compactas, cronología con precisión desigual, duplicados con fechas compatibles, validación de fotos, reducción y eliminación de EXIF, fotos pendientes privadas y publicación de fotos atómica con aprobación.

El último informe de emuladores se conserva localmente en `.local/emulator-tests.json` y la ejecución en `.local/emulator-verification.log` (ambos ignorados por Git).

## Comprobaciones cubiertas

Proyección pública exacta; aportes y solicitudes de privacidad sin cuenta ni sesión anónima de Firebase; nombre de quien carga obligatorio y sin verificar; acceso administrativo exclusivo del propietario con Google verificado y rol; antiguos familiares sin acceso privado; denegación de escrituras directas; aprobación y rechazo; moderación atómica, concurrente e idempotente; duplicados y ciclos; correcciones públicas que preservan datos y vínculos privados; conflictos de revisión; hipótesis privadas; importación; privacidad, eliminación, campo trampa y límites por origen.

Actualización del flujo: se retiraron las solicitudes de acceso y la gestión de colaboradores con cuenta. Los visitantes agregan sin login y solo el propietario aprueba al iniciar sesión. El build y las pruebas anteriores fueron reemplazados por una ejecución correspondiente a este flujo.

Chrome mostró el formulario actualizado: nombre de quien carga obligatorio, nombre del familiar, foto opcional, fechas flexibles, lugares y parentescos, sin los campos retirados ni el checkbox final. La página fue recargada y el usuario comenzó a completar el formulario; se preservó su entrada. La nueva vista usa todo el viewport sin sidebar. No se verificó visualmente la vista móvil.

## Pendiente antes de producción

- Elegir y configurar un proyecto Firebase real, dominios OAuth autorizados y App Check.
- Configurar el proveedor de correo, dominio remitente y secreto en Secret Manager; comprobar una entrega real.
- Asignar la cuenta administradora desde un entorno confiable.
- Recibir y revisar los datos familiares existentes. No se inventaron personas ni parentescos.
- Ejecutar la comprobación de aceptación en el dominio final, incluyendo móvil, Google real del administrador y aportes sin sesión.
- Confirmar costos y autorizar despliegue. No se desplegó ni habilitó un servicio pago.

El entorno local disponible usa Node 24.22.1 y Java 21 temporal. El backend y los workflows están configurados para Node 22; la ejecución de CI en ese runtime queda pendiente de conectar el repositorio.

## Guardado local y foto opcional

Se identificó que el envío estaba deshabilitado por falta de conexión Firebase, no por la ausencia de foto. Se activó el backend local `demo-mi-arbol-local` y se configuró Vite para conectarse a él. Se agregó exportación periódica a `.local/firebase-data` y restauración al reiniciar. Se verificó la existencia de la copia inicial y la carga de las funciones.

La prueba de integración de envío sin sesión verifica además que el aporte sin foto se guarda sin documento de imagen. Las tres pruebas adicionales comprueban la conservación del borrador durante recargas, su eliminación al enviar y la exclusión de borradores vencidos o ediciones privadas. Chrome mostró «Modo local · datos en este equipo», el selector sin archivo y el botón «Enviar para revisión» habilitado. No se enviaron ni aprobaron datos del usuario desde la automatización.

## Edición por nodo y parentescos administrativos

El nodo público abre la propuesta de edición. El administrador dispone de conexión por formulario o por arrastre y asigna padre, madre o pareja, con dirección explícita para hijos. Los nuevos tests comprueban autorización, idempotencia, proyecciones limitadas, reemplazo explícito del parentesco ocupado, conservación de otros vínculos, ciclos, vínculos hipotéticos privados, eliminación de relaciones sin eliminar personas y protección de ediciones previas mediante revisiones.

La suite de integración se ejecutó en puertos aislados mediante `firebase.test.json`, conservando en ejecución el backend `demo-mi-arbol-local` y sus datos manuales. La revisión visual específica de arrastrar conectores sigue pendiente; la compilación y las operaciones del servidor fueron verificadas.

## Corrección del clic en los nodos

Se reprodujo la causa en el código de React Flow instalado: cuando un nodo no es seleccionable ni arrastrable y no hay `onNodeClick`, su contenedor recibe `pointer-events: none`. El `onClick` que estaba dentro de la tarjeta no podía recibir el evento. Se registró el manejador en React Flow, se dejó el botón accesible por teclado y se evitó que los conectores abran el formulario durante la unión de nodos.

Tres pruebas de interfaz con el componente real de React Flow verifican el contenedor interactivo, la apertura por clic para visitante y administrador, y la apertura con Enter. La verificación visual adicional no se completó porque había interacción simultánea del usuario en Chrome; no se enviaron ni modificaron sus formularios o datos.

## Revisión modal y preparación de producción

El panel administrativo abre cada aporte en un modal con el nombre de quien lo cargó, foto opcional y comparación de datos actuales y propuestos. Aprobar y publicar requiere una acción explícita. Las correcciones desactualizadas no pueden aprobarse. Tres pruebas cubren apertura, aprobación, cierre sin cambios y conflictos de revisión.

El código fue enviado a https://github.com/LeonelBustamante/mi-arbol sin datos familiares, fotos ni credenciales locales. El propietario autorizó hacerlo público para GitHub Pages. Pages está configurado con GitHub Actions; todavía no hay una publicación productiva. Se identificó el proyecto Firebase `mi-arbol-19103` y se cargó su configuración pública en variables de Actions. Falta habilitar facturación para Functions, configurar Auth, Firestore, App Check, correo y rol administrativo y comprobar el dominio final.
