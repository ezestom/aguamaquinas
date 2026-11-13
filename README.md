# Agua Máquinas

Catálogo de maquinaria para agua y soda. El proyecto utiliza Astro, Node y SQLite.

## Abrir en local

Desde esta carpeta, con Node 24 o posterior:

```sh
npm install
npm run dev
```

Abrí [http://127.0.0.1:4321](http://127.0.0.1:4321). Para habilitar **Publicá gratis**, configurá el correo según la sección siguiente. Al abrir **Panel de gestión** por primera vez, el proyecto genera la clave local en `data/clave-panel.txt`. Usá esa clave para revisar avisos y leer las consultas. En el servidor, definí `AGUA_ADMIN_KEY` con una clave larga y aleatoria.

## Activar verificación y notificaciones

Configurá estas variables en el proceso que ejecuta Astro o en el entorno del hosting. Los nombres también están en `.env.example`.

- `RESEND_API_KEY` contiene la clave privada de envío de Resend.
- `AGUA_EMAIL_FROM` contiene el remitente de un dominio verificado en Resend, por ejemplo `Agua Máquinas <avisos@tu-dominio.com>`.
- `AGUA_NOTIFICATION_EMAIL` contiene el email del administrador que recibe las alertas de avisos y consultas.
- `AGUA_WHATSAPP_NUMBER` es el número de consultas con código de país, sin espacios ni guiones.
- `AGUA_WHATSAPP_GROUP_URL` admite una invitación a un grupo o un enlace a un canal de WhatsApp para nuevos ingresos. Cada enlace de WhatsApp aparece en el pie cuando su variable está configurada.

Los mensajes de **Enviar un comentario** se guardan en **Panel de gestión → Comentarios del sitio**. Si configuraste el correo de notificaciones, también se envía una alerta.

El código de seis dígitos vence a los 10 minutos y admite cinco intentos. Al verificarlo, el vendedor tiene una hora para cargar un aviso. Los avisos nuevos se guardan en USD, o sin precio si se deja el campo vacío. Los importes históricos conservan su moneda. Los avisos anteriores que sigan pendientes necesitan un nuevo envío con email verificado para aprobarse.

Desde el panel podés descargar el CSV privado, que usa punto y coma como separador, y abrir el contacto del vendedor desde cada consulta. Las alertas por correo incluyen la referencia para buscar en el panel. Si falla un envío, el panel muestra cuántas alertas siguen pendientes y permite reintentarlas en tandas de cinco.

La planilla del panel muestra los avisos, sus vendedores y las consultas. Al eliminar un registro, se mueve a la papelera. Restaurar un aviso recupera su estado anterior, sus fotos y sus datos de contacto.

En **Consultas web** entran los pedidos que completan los compradores. Si consultan desde una ficha, se guarda el equipo junto con el WhatsApp y el correo del comprador. El mensaje es opcional para un equipo seleccionado. El aviso por correo se envía a `AGUA_NOTIFICATION_EMAIL` con la referencia y los datos de la consulta. Si el proveedor no responde, la consulta queda guardada y la alerta se puede reintentar desde el panel.

En **Consultas web → Registro manual** podés cargar pedidos de WhatsApp, teléfono o referidos. En **Seguimiento** podés calificar el pedido, registrar la presentación y la visita, anotar minutos de gestión y cargar el cierre, la comisión acordada y lo efectivamente cobrado. Los importes de una operación usan la moneda que elijas para esa operación. **Exportar consultas** incluye el canal seleccionado, los contactos, el origen, los días hasta el cierre y los datos de comisión.

Para medir el piloto, usá `/?origen=sitio-anterior` en los enlaces desde la web anterior y `/?origen=pedro` en los enlaces que Pedro comparta. El origen acompaña la navegación desde el catálogo hasta la consulta. Revisalo en el panel cuando el comprador indique cómo llegó.

En **Gestionar portada** podés editar los banners y asignar hasta cinco avisos publicados a la sección de destacados. Marcá **Patrocinado** cuando corresponda a un acuerdo comercial. Los avisos pausados, vendidos o en la papelera salen de los destacados. Para los banners, cargá una imagen horizontal y elegí el orden, el destino y si querés mostrar la campaña.

## Activar el asistente

Cargá `GROQ_API_KEY` en el `.env` local y reiniciá `npm run dev`. En el hosting, configurá la clave como variable privada del proceso. `GROQ_MODEL` permite elegir otro modelo de Groq que admita respuestas JSON.

El asistente busca en el catálogo público en cada consulta y usa una guía breve de publicación, búsqueda y contacto. Los mensajes necesarios para responder se envían a Groq.

## Recordatorios de disponibilidad

Al publicar, se registra la fecha de confirmación. A los 30 días, los avisos que sigan publicados y tengan correo verificado pueden recibir un recordatorio. El vendedor puede confirmar que el equipo sigue disponible o marcarlo como vendido desde el enlace del correo. También podés confirmar desde el panel. Los avisos que esperan respuesta siguen visibles y se señalan como **Por reconfirmar** en el panel.

Para automatizar el envío, configurá `AGUA_PUBLIC_URL` con el origen HTTPS del sitio y `AGUA_REMINDER_KEY` con una clave aleatoria guardada en el hosting y el programador. Usá las mismas variables de Resend del sitio. Programá cada hora una solicitud `POST` a `/api/recordatorios`, con el encabezado `Authorization: Bearer <clave>`. Cada ejecución procesa hasta 10 avisos y devuelve los conteos de envíos y fallos. Ante un fallo, el aviso puede reintentarse en una ejecución posterior.

## Probar los recorridos

- Buscá por título, marca o referencia de un aviso publicado. Elegí una categoría y filtrá por provincia, formato o estado.
- Abrí una ficha y enviá una consulta con datos de prueba. El panel muestra la referencia y el origen. El enlace `/?origen=sitio-anterior` marca una consulta derivada del sitio anterior.
- Enviá un aviso con 1 a 5 imágenes JPG, PNG o WebP de hasta 3 MB cada una y, si querés, un enlace de YouTube o Vimeo. Las fotos se guardan comprimidas fuera de SQLite. El aviso entra como pendiente. En el panel se puede aprobar, pausar o marcar como vendido.

## Compilar y guardar los datos

`npm test` corre los tests. `npm run build` compila y `npm start` ejecuta la versión compilada. Para Render, configurá Node 24 o posterior, `HOST=0.0.0.0`, una clave de panel y `AGUA_DATA_DIR` dentro del punto de montaje de un disco persistente. La base y las fotos comparten esa carpeta.

Al actualizar desde la versión anterior, volvé a ingresar al panel. Las sesiones vencen en el servidor después de una hora y se revocan al cerrar sesión.

El formulario de publicación admite hasta 12 intentos cada 10 minutos por base SQLite y dos cargas simultáneas por proceso. La carpeta de fotos admite hasta 1.000 archivos y 256 MiB en total, incluidas las fotos de avisos existentes. Podés ajustar el límite en bytes con `AGUA_PHOTO_QUOTA_BYTES`.
# aguamaquinas
