# Agua Máquinas

Demo local de un catálogo para maquinaria de agua y soda. El logotipo es provisorio. Los equipos, precios y fotos iniciales son ilustrativos. El proyecto utiliza Astro, Node y SQLite.

## Abrir la demo

Desde esta carpeta, con Node 24 o posterior:

```sh
npm install
npm run dev
```

Abrí [http://127.0.0.1:4321](http://127.0.0.1:4321). Desde **Publicá gratis** podés cargar un aviso. Al abrir **Panel de gestión** por primera vez, el proyecto genera la clave local en `data/clave-panel.txt`. Usá esa clave para revisar y aprobar avisos y leer las consultas. Para una instalación con variables de entorno, podés definir `AGUA_ADMIN_KEY` con una clave larga y aleatoria.

## Probar los recorridos

- Buscá `llenadora 20 litros`, `AM-1043` o `ozono`. Elegí una categoría y filtrá por provincia, formato o estado.
- Abrí una ficha y enviá una consulta con datos de prueba. El panel muestra la referencia y el origen. El enlace `/?origen=alloatti` marca una consulta derivada de Alloatti.
- Enviá un aviso con 1 a 5 imágenes JPG, PNG o WebP de hasta 3 MB cada una y, si querés, un enlace de YouTube o Vimeo. Las fotos se guardan comprimidas fuera de SQLite. El aviso entra como pendiente. En el panel se puede aprobar, pausar o marcar como vendido.

## Compilar y guardar los datos

`npm test` corre los tests. `npm run build` compila y `npm start` ejecuta la versión compilada. Para Render, configurá Node 24 o posterior, `HOST=0.0.0.0`, una clave de panel y `AGUA_DATA_DIR` dentro del punto de montaje de un disco persistente. La base y las fotos comparten esa carpeta. Para la demo compartida, restringí el acceso al entorno y usá exclusivamente datos de prueba.
# aguamaquinas
