# Encuesta de satisfacción estudiantil · ITSQMET

Sistema institucional con dos accesos:

- Estudiantes: https://jeffer91.github.io/calificaci-n/estudiantes/
- Administrador: https://jeffer91.github.io/calificaci-n/administrador/

## Flujo del estudiante

1. Ingresa su cédula.
2. La aplicación consulta sus datos institucionales en Firebase UTET.
3. Puede registrar de forma independiente:
   - **Lo que hicieron bien:** 0, 1 o máximo 2 áreas.
   - **Lo que podemos mejorar:** 0, 1 o máximo 2 áreas.
4. El comentario positivo es opcional: el estudiante puede reconocer un área únicamente seleccionando la calificación y los puntos destacados.
5. Revisa y envía.

## Arquitectura

- GitHub Pages: interfaz pública.
- Firebase UTET / Firestore: consulta del estudiante por cédula.
- Neon Postgres: almacenamiento de encuestas.
- Neon Functions + AI Gateway: clasificación automática y organización de comentarios.
- IA principal: gpt-oss-20b.
- IA de respaldo: meta-llama-3.3-70b-instruct.

## Administrador

El panel separa reconocimientos de aspectos por mejorar, muestra estadísticas por área, categorías frecuentes, filtros, comentarios individuales y análisis de IA.

## Privacidad

La cédula no se almacena en texto plano en Neon: se guarda un hash. Los datos de contacto se guardan únicamente si el estudiante solicita seguimiento.

## Backend

El código está en backend/. Para activar el almacenamiento real y la IA se debe desplegar la función en Neon, ejecutar backend/schema.sql y colocar la URL de la función en assets/config.js.
