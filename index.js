require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');

const app = express();

app.use(express.static(__dirname));
app.use(express.json());

/* =========================================================
   CONEXIÓN A POSTGRESQL
   =========================================================
   - En LOCAL: usa las variables PGUSER, PGHOST, PGDATABASE,
     PGPASSWORD, PGPORT definidas en tu archivo .env (que
     nunca se sube a Internet / GitHub).
   - En PRODUCCIÓN (Railway, Render, Neon, Supabase, etc.):
     la mayoría de estos servicios te dan una sola cadena de
     conexión llamada DATABASE_URL. Si existe, se usa esa y
     se ignoran las variables PG* individuales.
   - IMPORTANTE: ya no hay contraseñas ni datos reales
     escritos en este archivo. Si faltan las variables de
     entorno, el servidor se detiene con un error claro en
     vez de arrancar con credenciales inventadas.
========================================================= */

function construirConfiguracionDB() {

    if (process.env.DATABASE_URL) {
        return {
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.PGSSL === 'false'
                ? false
                : { rejectUnauthorized: false }
        };
    }

    const requeridas = ['PGUSER', 'PGHOST', 'PGDATABASE', 'PGPASSWORD'];
    const faltantes = requeridas.filter(v => !process.env[v]);

    if (faltantes.length > 0) {
        console.error(
            `Faltan variables de entorno para conectar a PostgreSQL: ${faltantes.join(', ')}. ` +
            'Crea un archivo .env basado en .env.example y complétalo con tus datos reales.'
        );
        process.exit(1);
    }

    return {
        user: process.env.PGUSER,
        host: process.env.PGHOST,
        database: process.env.PGDATABASE,
        password: process.env.PGPASSWORD,
        port: Number(process.env.PGPORT) || 5432,
        ssl: process.env.PGSSL === 'true'
            ? { rejectUnauthorized: false }
            : false
    };
}

const pool = new Pool(construirConfiguracionDB());

pool.connect()
    .then(client => {
        console.log('Conexión exitosa con PostgreSQL');
        client.release();
    })
    .catch(err => {
        console.error('Error conectando con PostgreSQL:', err.message);
    });

/* =========================================================
   UTILIDADES
========================================================= */

function normalizarTexto(texto) {
    return String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function palabrasSignificativas(texto) {
    const stopwords = new Set([
        'que',
        'como',
        'cual',
        'cuales',
        'para',
        'con',
        'por',
        'del',
        'las',
        'los',
        'una',
        'uno',
        'unos',
        'unas',
        'este',
        'esta',
        'esto',
        'esas',
        'esos',
        'mis',
        'tus',
        'sus',
        'me',
        'te',
        'se',
        'de',
        'en',
        'y',
        'o',
        'a',
        'al',
        'un',
        'el',
        'la',
        'lo',
        'mi',
        'si',
        'no',
        'hay',
        'son',
        'soy',
        'quiero',
        'gusta',
        'gustan',
        'interesa',
        'interesan',
        'interesado',
        'interesada',
        'clase',
        'clases',
        'materia',
        'materias',
        'profesor',
        'profesora',
        'profesores',
        'profesoras',
        'investigador',
        'investigadora',
        'investigadores',
        'maestro',
        'maestra',
        'favorito',
        'favorita',
        'favoritos',
        'favoritas'
    ]);

    return normalizarTexto(texto)
        .split(/\s+/)
        .filter(p => p.length >= 3 && !stopwords.has(p));
}

/* =========================================================
   CONSULTAS ECONÓMICAS
   ========================================================= */

function esConsultaEconomica(texto) {
    const t = normalizarTexto(texto);

    const patrones = [
        'salario',
        'salarios',
        'sueldo',
        'sueldos',
        'paga',
        'pagan',
        'paga mas',
        'paga mejor',
        'mejor pagado',
        'mejor pagada',
        'ganar mas',
        'ganar dinero',
        'ganar bien',
        'cuanto gana',
        'cuanto pagan',
        'cuanto se gana',
        'ingreso',
        'ingresos',
        'remuneracion',
        'economico',
        'economica',
        'dinero',
        'mejor sueldo',
        'mejor salario',
        'opcion mejor pagada',
        'carrera mejor pagada',
        'area mejor pagada',
        'trabajo mejor pagado',
        'trabajo que pague mas'
    ];

    return patrones.some(p => t.includes(p));
}

/* =========================================================
   PUNTUACIÓN DE RUTAS
========================================================= */

function puntuarRuta(texto, ruta) {
    const textoLimpio = normalizarTexto(texto);
    const palabrasEntrada = palabrasSignificativas(texto);

    let puntuacion = 0;
    const coincidencias = [];

    const claves = (ruta.palabras_clave || '')
        .split(',')
        .map(x => x.trim())
        .filter(Boolean);

    for (const clave of claves) {
        const claveLimpia = normalizarTexto(clave);

        if (!claveLimpia) {
            continue;
        }

        const coincide = claveLimpia.includes(' ')
            ? textoLimpio.includes(claveLimpia)
            : palabrasEntrada.includes(claveLimpia);

        if (coincide) {
            puntuacion += claveLimpia.includes(' ') ? 5 : 3;
            coincidencias.push(clave);
        }
    }

    const titulo = normalizarTexto(ruta.titulo || '');
    const descripcion = normalizarTexto(ruta.descripcion || '');
    const trabajos = normalizarTexto(ruta.trabajos_sugeridos || '');

    for (const palabra of palabrasEntrada) {
        if (palabra.length < 4) {
            continue;
        }

        if (titulo.split(/\s+/).includes(palabra)) {
            puntuacion += 2;
        }

        if (descripcion.split(/\s+/).includes(palabra)) {
            puntuacion += 1;
        }

        if (trabajos.split(/\s+/).includes(palabra)) {
            puntuacion += 1;
        }
    }

    return {
        ruta,
        puntuacion,
        coincidencias
    };
}

/* =========================================================
   MATERIAS DEL PLAN DE ESTUDIOS
   =========================================================
   Detecta qué materias del plan de estudios menciona el
   usuario en su texto (por nombre exacto o por palabras
   clave asociadas a la materia), y calcula el aporte extra
   que esas materias dan a cada ruta laboral según la tabla
   materia_ruta.
========================================================= */

function obtenerMateriasCoincidentes(texto, materias) {
    const textoLimpio = normalizarTexto(texto);
    const palabrasEntrada = palabrasSignificativas(texto);

    const encontradas = [];

    for (const materia of materias) {
        const nombreLimpio = normalizarTexto(materia.nombre || '');

        if (!nombreLimpio) {
            continue;
        }

        let coincide = textoLimpio.includes(nombreLimpio);

        if (!coincide) {
            const claves = (materia.palabras_clave || '')
                .split(',')
                .map(x => normalizarTexto(x))
                .filter(Boolean);

            coincide = claves.some(clave =>
                clave.includes(' ')
                    ? textoLimpio.includes(clave)
                    : palabrasEntrada.includes(clave)
            );
        }

        if (coincide) {
            encontradas.push(materia);
        }
    }

    return encontradas;
}

function bonusPorMaterias(ruta, materiasCoincidentes, materiaRutaRows) {
    let puntosExtra = 0;
    const nombres = [];

    for (const materia of materiasCoincidentes) {
        const relacion = materiaRutaRows.find(mr =>
            mr.materia_id === materia.id &&
            mr.ruta_id === ruta.id
        );

        if (relacion) {
            puntosExtra += (relacion.peso || 1) * 3;
            nombres.push(materia.nombre);
        }
    }

    return {
        puntosExtra,
        nombres
    };
}

/* =========================================================
   BUSCADOR DE PROFESORES
   =========================================================
   
   IMPORTANTE:
   - Nombre completo exacto = máxima prioridad.
   - Nombre + apellido exactos = prioridad alta.
   - Si solamente coincide un nombre que pertenece a varios
     profesores, NO elige arbitrariamente.
   - Si "Miguel Ángel" corresponde a dos profesores,
     devuelve ambos como ambiguos.
   - Si "Miguel Ángel Lastras" corresponde exactamente a uno,
     devuelve ese profesor.
========================================================= */

function obtenerPartesNombre(nombre) {
    return normalizarTexto(nombre)
        .split(/\s+/)
        .filter(parte => parte.length >= 2);
}

function contieneSecuencia(tokensTexto, tokensNombre) {
    if (tokensNombre.length === 0) {
        return false;
    }

    if (tokensNombre.length > tokensTexto.length) {
        return false;
    }

    for (let i = 0; i <= tokensTexto.length - tokensNombre.length; i++) {
        let coincide = true;

        for (let j = 0; j < tokensNombre.length; j++) {
            if (tokensTexto[i + j] !== tokensNombre[j]) {
                coincide = false;
                break;
            }
        }

        if (coincide) {
            return true;
        }
    }

    return false;
}

function buscarProfesor(texto, profesores) {
    const textoNormalizado = normalizarTexto(texto);
    const tokensTexto = textoNormalizado.split(/\s+/).filter(Boolean);

    const candidatos = [];

    for (const profesor of profesores) {
        const nombreNormalizado = normalizarTexto(profesor.nombre);
        const partesNombre = obtenerPartesNombre(profesor.nombre);

        if (!nombreNormalizado || partesNombre.length === 0) {
            continue;
        }

        let puntuacion = 0;
        let tipoCoincidencia = '';

        /* -------------------------------------------------
           1. NOMBRE COMPLETO EXACTO
        ------------------------------------------------- */

        if (textoNormalizado.includes(nombreNormalizado)) {
            puntuacion = 10000;
            tipoCoincidencia = 'nombre_completo';
        }

        /* -------------------------------------------------
           2. NOMBRE COMPLETO COMO SECUENCIA DE PALABRAS
        ------------------------------------------------- */

        if (
            puntuacion === 0 &&
            contieneSecuencia(tokensTexto, partesNombre)
        ) {
            puntuacion = 9000;
            tipoCoincidencia = 'secuencia_nombre_completo';
        }

        /* -------------------------------------------------
           3. NOMBRE + APELLIDO
           
           Esto permite encontrar:
           "Miguel Lastras"
           aunque el nombre registrado sea:
           "Miguel Ángel Lastras"
        ------------------------------------------------- */

        if (puntuacion === 0 && partesNombre.length >= 2) {
            const combinaciones = [];

            combinaciones.push([
                partesNombre[0],
                partesNombre[partesNombre.length - 1]
            ]);

            if (partesNombre.length >= 3) {
                combinaciones.push([
                    partesNombre[0],
                    partesNombre[1],
                    partesNombre[partesNombre.length - 1]
                ]);
            }

            for (const combinacion of combinaciones) {
                if (contieneSecuencia(tokensTexto, combinacion)) {
                    puntuacion = 8000;
                    tipoCoincidencia = 'nombre_apellido';
                    break;
                }
            }
        }

        /* -------------------------------------------------
           4. DOS O MÁS PARTES DEL NOMBRE
        ------------------------------------------------- */

        if (puntuacion === 0) {
            const partesEncontradas = partesNombre.filter(parte =>
                tokensTexto.includes(parte)
            );

            if (partesEncontradas.length >= 2) {
                puntuacion = 6000 + partesEncontradas.length * 100;
                tipoCoincidencia = 'varias_partes';
            }
        }

        /* -------------------------------------------------
           5. UNA SOLA PARTE
           
           SOLO damos una coincidencia débil.
           Más adelante se verifica si hay ambigüedad.
        ------------------------------------------------- */

        if (puntuacion === 0) {
            const partesEncontradas = partesNombre.filter(parte =>
                tokensTexto.includes(parte)
            );

            if (
                partesEncontradas.length === 1 &&
                partesEncontradas[0].length >= 4
            ) {
                puntuacion = 1000;
                tipoCoincidencia = 'una_parte';
            }
        }

        if (puntuacion > 0) {
            candidatos.push({
                profesor,
                puntuacion,
                tipoCoincidencia,
                nombreNormalizado,
                partesNombre
            });
        }
    }

    if (candidatos.length === 0) {
        return {
            encontrado: false,
            ambiguo: false,
            profesor: null,
            candidatos: []
        };
    }

    candidatos.sort((a, b) => b.puntuacion - a.puntuacion);

    const mejorPuntuacion = candidatos[0].puntuacion;

    const mejores = candidatos.filter(
        candidato => candidato.puntuacion === mejorPuntuacion
    );

    /* -----------------------------------------------------
       SI HAY UN NOMBRE COMPLETO EXACTO, GANÓ.
    ----------------------------------------------------- */

    const coincidenciasExactas = candidatos.filter(
        candidato =>
            candidato.tipoCoincidencia === 'nombre_completo' ||
            candidato.tipoCoincidencia === 'secuencia_nombre_completo'
    );

    if (coincidenciasExactas.length === 1) {
        return {
            encontrado: true,
            ambiguo: false,
            profesor: coincidenciasExactas[0].profesor,
            candidatos: coincidenciasExactas.map(x => x.profesor)
        };
    }

    /* -----------------------------------------------------
       SI HAY MÁS DE UNA COINCIDENCIA EXACTA, ES AMBIGUO.
    ----------------------------------------------------- */

    if (coincidenciasExactas.length > 1) {
        return {
            encontrado: false,
            ambiguo: true,
            profesor: null,
            candidatos: coincidenciasExactas.map(x => x.profesor)
        };
    }

    /* -----------------------------------------------------
       SI ES UNA COINCIDENCIA DE UNA SOLA PARTE Y HAY
       VARIOS PROFESORES, NO ELEGIMOS AL PRIMERO.
    ----------------------------------------------------- */

    if (
        mejores.length > 1 &&
        mejores.every(x => x.tipoCoincidencia === 'una_parte')
    ) {
        return {
            encontrado: false,
            ambiguo: true,
            profesor: null,
            candidatos: mejores.map(x => x.profesor)
        };
    }

    /* -----------------------------------------------------
       SI VARIOS PROFESORES COMPARTEN EL MISMO NOMBRE BASE,
       POR EJEMPLO:

       Miguel Ángel González
       Miguel Ángel Lastras

       y el usuario escribe solamente:

       "Miguel Ángel"

       NO escogemos arbitrariamente.
    ----------------------------------------------------- */

    if (mejores.length > 1) {
        const nombresCandidatos = mejores.map(x => x.partesNombre);

        const tienenMismoInicio = nombresCandidatos.every(partes =>
            partes.length >= 2 &&
            partes[0] === nombresCandidatos[0][0] &&
            partes[1] === nombresCandidatos[0][1]
        );

        if (tienenMismoInicio) {
            return {
                encontrado: false,
                ambiguo: true,
                profesor: null,
                candidatos: mejores.map(x => x.profesor)
            };
        }
    }

    /* -----------------------------------------------------
       SI SOLO QUEDA UN CANDIDATO, LO DEVOLVEMOS.
    ----------------------------------------------------- */

    return {
        encontrado: true,
        ambiguo: false,
        profesor: candidatos[0].profesor,
        candidatos: [candidatos[0].profesor]
    };
}

/* =========================================================
   DETECCIÓN DE INTENCIÓN
========================================================= */

function esProfesorFavorito(texto) {
    const t = normalizarTexto(texto);

    return (
        t.includes('profesor favorito') ||
        t.includes('profesora favorita') ||
        t.includes('mi profesor favorito') ||
        t.includes('mi profesora favorita') ||
        t.includes('mi profesor preferido') ||
        t.includes('mi profesora preferida')
    );
}

function esMencionDeClaseOProfesor(texto) {
    const t = normalizarTexto(texto);

    return (
        t.includes('clase de') ||
        t.includes('clases de') ||
        t.includes('materia de') ||
        t.includes('materias de') ||
        t.includes('profesor') ||
        t.includes('profesora') ||
        t.includes('profesores') ||
        t.includes('profesoras') ||
        t.includes('maestro') ||
        t.includes('maestra') ||
        t.includes('investigador') ||
        t.includes('investigadora') ||
        t.includes('favorito') ||
        t.includes('favorita')
    );
}

function esConsultaSobreProfesor(texto) {
    const t = normalizarTexto(texto);

    return (
        esMencionDeClaseOProfesor(t) ||
        t.includes('quien da') ||
        t.includes('quien imparte') ||
        t.includes('quien ensena') ||
        t.includes('quien enseña')
    );
}

/* =========================================================
   RESPUESTA DE PROFESOR
========================================================= */

function obtenerRespuestaProfesor(p) {
    let respuesta =
        `${p.nombre} pertenece al área de ${
            p.linea_principal ||
            p.cuerpo_academico ||
            'investigación del IICO'
        }.`;

    if (p.perfil_investigacion) {
        respuesta += `\n\n${p.perfil_investigacion}`;
    }

    if (p.orientacion_profesional) {
        respuesta +=
            `\n\nCómo puede orientarte:\n${p.orientacion_profesional}`;
    }

    if (p.tecnologias) {
        const tecnologias = p.tecnologias
            .split(',')
            .map(x => x.trim())
            .filter(Boolean)
            .slice(0, 8);

        if (tecnologias.length > 0) {
            respuesta +=
                `\n\nTemas y técnicas relacionadas:\n${tecnologias.join(', ')}`;
        }
    }

    return respuesta;
}

/* =========================================================
   RUTAS
========================================================= */

app.get('/api/rutas', async (req, res) => {
    try {
        const resultado = await pool.query(`
            SELECT *
            FROM rutas_laborales
            ORDER BY id ASC
        `);

        res.json(resultado.rows);
    } catch (err) {
        console.error('Error al obtener rutas:', err);

        res.status(500).json({
            error: err.message
        });
    }
});

app.get('/api/ruta-detalle/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const ruta = await pool.query(`
            SELECT *
            FROM rutas_laborales
            WHERE id = $1
        `, [id]);

        if (ruta.rows.length === 0) {
            return res.status(404).json({
                error: 'Ruta no encontrada'
            });
        }

        const profesores = await pool.query(`
            SELECT
                p.*,
                COALESCE(pub.total_destacadas, 0) AS publicaciones_destacadas_count,
                pub.titulo_destacada AS publicacion_destacada_titulo
            FROM profesores p
            JOIN profesor_ruta pr
                ON p.id = pr.profesor_id
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*) AS total_destacadas,
                    (ARRAY_AGG(titulo ORDER BY año DESC NULLS LAST, id ASC))[1] AS titulo_destacada
                FROM publicaciones
                WHERE profesor_id = p.id
                AND destacada = true
            ) pub ON true
            WHERE pr.ruta_id = $1
            ORDER BY p.nombre ASC
        `, [id]);

        res.json({
            ruta: ruta.rows[0],
            profesores: profesores.rows
        });
    } catch (err) {
        console.error('Error al obtener detalle de ruta:', err);

        res.status(500).json({
            error: err.message
        });
    }
});

/* =========================================================
   PERFIL DEL ESTUDIANTE
========================================================= */

app.get('/api/perfil', async (req, res) => {
    try {
        const resultado = await pool.query(`
            SELECT *
            FROM perfil_estudiante
            LIMIT 1
        `);

        res.json(resultado.rows[0] || null);
    } catch (err) {
        console.error('Error al obtener perfil:', err);

        res.status(500).json({
            error: err.message
        });
    }
});

/* =========================================================
   MATERIAS
========================================================= */

app.get('/api/materias', async (req, res) => {
    try {
        const resultado = await pool.query(`
            SELECT *
            FROM materias
            ORDER BY semestre ASC, id ASC
        `);

        res.json(resultado.rows);
    } catch (err) {
        console.error('Error al obtener materias:', err);

        res.status(500).json({
            error: err.message
        });
    }
});

/* =========================================================
   PROFESORES
========================================================= */

app.get('/api/profesores', async (req, res) => {
    try {
        const resultado = await pool.query(`
            SELECT
                p.*,
                COALESCE(pub.total_destacadas, 0) AS publicaciones_destacadas_count,
                pub.titulo_destacada AS publicacion_destacada_titulo
            FROM profesores p
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*) AS total_destacadas,
                    (ARRAY_AGG(titulo ORDER BY año DESC NULLS LAST, id ASC))[1] AS titulo_destacada
                FROM publicaciones
                WHERE profesor_id = p.id
                AND destacada = true
            ) pub ON true
            ORDER BY p.nombre ASC
        `);

        res.json(resultado.rows);
    } catch (err) {
        console.error('Error al obtener profesores:', err);

        res.status(500).json({
            error: err.message
        });
    }
});

app.get('/api/profesor/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const profesor = await pool.query(`
            SELECT
                id,
                nombre,
                grado,
                snii,
                orbis_id,
                orcid,
                entidad_academica,
                entidad_investigacion,
                direccion_oficina,
                cuerpo_academico,
                laboratorio_enfoque,
                foto_url,
                correo,
                perfil_investigacion,
                linea_principal,
                tecnologias,
                google_scholar_url,
                perfil_url,
                orientacion_profesional
            FROM profesores
            WHERE id = $1
        `, [id]);

        if (profesor.rows.length === 0) {
            return res.status(404).json({
                error: 'Profesor no encontrado'
            });
        }

        const rutas = await pool.query(`
            SELECT
                r.id,
                r.titulo
            FROM rutas_laborales r
            JOIN profesor_ruta pr
                ON r.id = pr.ruta_id
            WHERE pr.profesor_id = $1
            ORDER BY r.titulo ASC
        `, [id]);

        const lineas = await pool.query(`
            SELECT
                id,
                nombre,
                descripcion
            FROM lineas_investigacion
            WHERE profesor_id = $1
            ORDER BY id ASC
        `, [id]);

        const publicaciones = await pool.query(`
            SELECT
                id,
                titulo,
                año,
                revista,
                autores,
                citas,
                enlace,
                destacada
            FROM publicaciones
            WHERE profesor_id = $1
            ORDER BY destacada DESC, año DESC NULLS LAST, id ASC
        `, [id]);

        res.json({
            profesor: profesor.rows[0],
            rutasRelacionadas: rutas.rows,
            lineasInvestigacion: lineas.rows,
            publicaciones: publicaciones.rows
        });
    } catch (err) {
        console.error('Error al obtener profesor:', err);

        res.status(500).json({
            error: err.message
        });
    }
});

app.get('/api/profesor/:id/publicaciones', async (req, res) => {
    const { id } = req.params;

    try {
        const resultado = await pool.query(`
            SELECT
                id,
                titulo,
                año,
                revista,
                autores,
                citas,
                enlace,
                destacada
            FROM publicaciones
            WHERE profesor_id = $1
            ORDER BY destacada DESC, año DESC NULLS LAST, id ASC
        `, [id]);

        res.json(resultado.rows);
    } catch (err) {
        console.error('Error al obtener publicaciones:', err);

        res.status(500).json({
            error: err.message
        });
    }
});

app.get('/api/profesor/:id/lineas', async (req, res) => {
    const { id } = req.params;

    try {
        const resultado = await pool.query(`
            SELECT
                id,
                nombre,
                descripcion
            FROM lineas_investigacion
            WHERE profesor_id = $1
            ORDER BY id ASC
        `, [id]);

        res.json(resultado.rows);
    } catch (err) {
        console.error('Error al obtener líneas de investigación:', err);

        res.status(500).json({
            error: err.message
        });
    }
});

/* =========================================================
   ANALIZAR FORTALEZAS
========================================================= */

app.post('/api/analizar-fortalezas', async (req, res) => {
    const { fortalezas } = req.body;

    try {
        if (!fortalezas || !fortalezas.trim()) {
            return res.status(400).json({
                error: 'Ingresa materias de interés'
            });
        }

        const rutasRes = await pool.query(`
            SELECT *
            FROM rutas_laborales
            ORDER BY id ASC
        `);

        const materiasRes = await pool.query(`
            SELECT *
            FROM materias
            ORDER BY semestre ASC, id ASC
        `);

        const materiaRutaRes = await pool.query(`
            SELECT *
            FROM materia_ruta
        `);

        const rutas = rutasRes.rows;
        const materias = materiasRes.rows;
        const materiaRutaRows = materiaRutaRes.rows;

        const materiasCoincidentes = obtenerMateriasCoincidentes(
            fortalezas,
            materias
        );

        const resultados = rutas
            .map(ruta => {
                const base = puntuarRuta(fortalezas, ruta);

                const { puntosExtra, nombres } = bonusPorMaterias(
                    ruta,
                    materiasCoincidentes,
                    materiaRutaRows
                );

                return {
                    ...base,
                    puntuacion: base.puntuacion + puntosExtra,
                    materiasCoincidentes: nombres
                };
            })
            .sort((a, b) => {
                if (b.puntuacion !== a.puntuacion) {
                    return b.puntuacion - a.puntuacion;
                }

                return a.ruta.id - b.ruta.id;
            })
            .filter(r => r.puntuacion > 0)
            .slice(0, 3);

        if (resultados.length === 0 && rutas.length > 0) {
            resultados.push({
                ruta: rutas[0],
                puntuacion: 0,
                coincidencias: [],
                materiasCoincidentes: []
            });
        }

        const profesoresMap = new Map();

        for (const resultado of resultados) {
            const profesoresRes = await pool.query(`
                SELECT
                    p.*,
                    COALESCE(pub.total_destacadas, 0) AS publicaciones_destacadas_count,
                    pub.titulo_destacada AS publicacion_destacada_titulo
                FROM profesores p
                JOIN profesor_ruta pr
                    ON p.id = pr.profesor_id
                LEFT JOIN LATERAL (
                    SELECT
                        COUNT(*) AS total_destacadas,
                        (ARRAY_AGG(titulo ORDER BY año DESC NULLS LAST, id ASC))[1] AS titulo_destacada
                    FROM publicaciones
                    WHERE profesor_id = p.id
                    AND destacada = true
                ) pub ON true
                WHERE pr.ruta_id = $1
                ORDER BY p.nombre ASC
            `, [resultado.ruta.id]);

            resultado.profesores = profesoresRes.rows;

            for (const profesor of profesoresRes.rows) {
                if (!profesoresMap.has(profesor.id)) {
                    profesoresMap.set(profesor.id, {
                        ...profesor,
                        rutasCoincidentes: []
                    });
                }

                profesoresMap
                    .get(profesor.id)
                    .rutasCoincidentes
                    .push({
                        id: resultado.ruta.id,
                        titulo: resultado.ruta.titulo,
                        puntuacion: resultado.puntuacion
                    });
            }
        }

        const puntuacionMaxima =
            resultados.length > 0
                ? Math.max(...resultados.map(r => r.puntuacion), 1)
                : 1;

        const calcularPorcentaje = puntuacion => {
            if (!puntuacion || puntuacion <= 0) {
                return 0;
            }

            return Math.max(
                8,
                Math.min(100, Math.round((puntuacion / puntuacionMaxima) * 100))
            );
        };

        res.json({
            coincidenciaPuntos: resultados[0]?.puntuacion || 0,
            conceptosDetectados: resultados[0]?.coincidencias || [],
            materiasDetectadas: resultados[0]?.materiasCoincidentes || [],
            rutaSugerida: resultados[0]?.ruta || null,
            porcentajeCoincidencia: calcularPorcentaje(resultados[0]?.puntuacion),

            profesoresRecomendados:
                resultados[0]?.profesores || [],

            rutasCoincidentes: resultados.map(resultado => ({
                id: resultado.ruta.id,
                titulo: resultado.ruta.titulo,
                descripcion: resultado.ruta.descripcion,
                puntuacion: resultado.puntuacion,
                porcentaje: calcularPorcentaje(resultado.puntuacion),
                conceptosDetectados: resultado.coincidencias,
                materiasCoincidentes: resultado.materiasCoincidentes || [],
                profesores: resultado.profesores || []
            })),

            profesoresUnificados:
                Array.from(profesoresMap.values())
        });

    } catch (err) {
        console.error('Error al analizar fortalezas:', err);

        res.status(500).json({
            error: err.message
        });
    }
});

/* =========================================================
   BOT
========================================================= */

app.post('/api/bot', async (req, res) => {
    const { mensaje } = req.body;

    try {
        if (!mensaje || !mensaje.trim()) {
            return res.status(400).json({
                error: 'Escribe un mensaje.'
            });
        }

        const texto = normalizarTexto(mensaje);

        /* -------------------------------------------------
           CARGAR DATOS
        ------------------------------------------------- */

        const rutasRes = await pool.query(`
            SELECT *
            FROM rutas_laborales
            ORDER BY id ASC
        `);

        const profesoresRes = await pool.query(`
            SELECT *
            FROM profesores
            ORDER BY nombre ASC
        `);

        const lineasRes = await pool.query(`
            SELECT *
            FROM lineas_investigacion
            ORDER BY nombre ASC
        `);

        const publicacionesRes = await pool.query(`
            SELECT *
            FROM publicaciones
            ORDER BY año DESC NULLS LAST
        `);

        const materiasRes = await pool.query(`
            SELECT *
            FROM materias
            ORDER BY semestre ASC, id ASC
        `);

        const materiaRutaRes = await pool.query(`
            SELECT *
            FROM materia_ruta
        `);

        const rutas = rutasRes.rows;
        const profesores = profesoresRes.rows;
        const lineas = lineasRes.rows;
        const publicaciones = publicacionesRes.rows;
        const materias = materiasRes.rows;
        const materiaRutaRows = materiaRutaRes.rows;

        const materiasCoincidentes = obtenerMateriasCoincidentes(
            mensaje,
            materias
        );

        /* =================================================
           SALUDO
        ================================================= */

        if (
            texto === 'hola' ||
            texto === 'buenas' ||
            texto === 'buenos dias' ||
            texto === 'buenas tardes' ||
            texto === 'buenas noches' ||
            texto === 'hey'
        ) {
            return res.json({
                respuesta:
                    '¡Hola! Soy el asistente del Orientador de Carrera del IICO. Puedo ayudarte a explorar áreas profesionales, profesores, investigación y posibles rutas de desarrollo. ¿Qué te interesa?',
                tipo: 'saludo'
            });
        }

        /* =================================================
           AYUDA

           IMPORTANTE:
           NO se menciona absolutamente nada económico.
        ================================================= */

        if (
            texto.includes('que puedes hacer') ||
            texto.includes('como me puedes ayudar') ||
            texto === 'ayuda'
        ) {
            return res.json({
                respuesta:
                    'Puedo ayudarte a:\n\n' +
                    '• Encontrar áreas profesionales según tus intereses.\n' +
                    '• Reconocer profesores que menciones por nombre.\n' +
                    '• Explorar qué profesor puede orientarte.\n' +
                    '• Buscar líneas de investigación.\n' +
                    '• Buscar publicaciones.\n' +
                    '• Comparar varias áreas profesionales.\n' +
                    '• Explorar posibles puestos laborales.\n\n' +
                    'Puedes escribir, por ejemplo:\n' +
                    '“Me gustan las clases de Marcela Mejía.”\n' +
                    '“Mi profesor favorito es Alfonso.”\n' +
                    '“Me interesa programación y Python.”\n' +
                    '“¿Qué profesores trabajan con óptica?”',
                tipo: 'ayuda'
            });
        }

        /* =================================================
           CONSULTA ECONÓMICA

           LOS DATOS ECONÓMICOS SOLO SE PROCESAN AQUÍ
           CUANDO EL USUARIO PREGUNTA DIRECTAMENTE.
        ================================================= */

        if (esConsultaEconomica(texto)) {

            const referenciasRes = await pool.query(`
                SELECT
                    id,
                    ocupacion,
                    categoria,
                    salario_promedio_mensual,
                    periodo,
                    fuente,
                    fuente_url,
                    notas,
                    rutas_ids
                FROM referencias_salariales
                ORDER BY salario_promedio_mensual DESC NULLS LAST
            `);

            const referencias = referenciasRes.rows;

            const resultadosEconomicos = referencias
                .map(ref => {

                    const rutasRelacionadas =
                        String(ref.rutas_ids || '')
                            .split(',')
                            .map(x => Number(x.trim()))
                            .filter(Boolean);

                    let puntuacion = 0;

                    for (const rutaId of rutasRelacionadas) {
                        const ruta = rutas.find(
                            r => r.id === rutaId
                        );

                        if (!ruta) {
                            continue;
                        }

                        const resultadoRuta =
                            puntuarRuta(mensaje, ruta);

                        puntuacion +=
                            resultadoRuta.puntuacion;
                    }

                    return {
                        referencia: ref,
                        puntuacion
                    };
                })
                .sort((a, b) => {

                    if (
                        b.puntuacion !==
                        a.puntuacion
                    ) {
                        return (
                            b.puntuacion -
                            a.puntuacion
                        );
                    }

                    return Number(
                        b.referencia
                            .salario_promedio_mensual || 0
                    ) -
                    Number(
                        a.referencia
                            .salario_promedio_mensual || 0
                    );
                });

            const seleccionadas =
                resultadosEconomicos
                    .filter(x => x.puntuacion > 0)
                    .slice(0, 5);

            const resultadosFinales =
                seleccionadas.length > 0
                    ? seleccionadas
                    : resultadosEconomicos.slice(0, 3);

            let respuesta =
                'Tomando como referencia los datos disponibles en el sistema:\n\n';

            resultadosFinales.forEach((item, index) => {

                const salario =
                    Number(
                        item.referencia
                            .salario_promedio_mensual
                    );

                respuesta +=
                    `${index + 1}. ${item.referencia.categoria}\n` +
                    `Promedio mensual de referencia: $${salario.toLocaleString('es-MX')} MXN\n` +
                    `Ocupación de referencia: ${item.referencia.ocupacion}\n` +
                    `Periodo: ${item.referencia.periodo}\n\n`;
            });

            respuesta +=
                'Estos valores son referencias de mercado y no representan una oferta salarial. El ingreso real depende de experiencia, empresa, ubicación, especialidad, puesto y prestaciones.';

            return res.json({
                respuesta,
                tipo: 'economica'
            });
        }

        /* =================================================
           BUSCAR PROFESOR MENCIONADO
        ================================================= */

        const resultadoProfesor =
            buscarProfesor(
                mensaje,
                profesores
            );

        /* =================================================
           PROFESOR AMBIGUO
           
           EJEMPLO:

           "Me gusta la clase de Miguel Ángel"

           Si existen:
           - Miguel Ángel Lastras
           - Miguel Ángel Pérez

           NO escogemos uno.
        ================================================= */

        if (
            resultadoProfesor.ambiguo &&
            resultadoProfesor.candidatos.length > 0 &&
            (
                esMencionDeClaseOProfesor(texto) ||
                resultadoProfesor.candidatos.some(p =>
                    normalizarTexto(mensaje)
                        .includes(
                            normalizarTexto(p.nombre)
                        )
                )
            )
        ) {

            const nombres =
                resultadoProfesor.candidatos
                    .slice(0, 8)
                    .map(
                        p => `• ${p.nombre}`
                    )
                    .join('\n');

            return res.json({
                respuesta:
                    'Encontré más de un profesor que podría corresponder a lo que mencionas:\n\n' +
                    `${nombres}\n\n` +
                    '¿Cuál de ellos es el que tienes en mente? Puedes escribir su nombre completo.',
                tipo: 'profesor_ambiguo',
                profesores:
                    resultadoProfesor.candidatos
            });
        }

        /* =================================================
           PROFESOR ENCONTRADO
        ================================================= */

        if (
            resultadoProfesor.encontrado &&
            resultadoProfesor.profesor &&
            (
                esMencionDeClaseOProfesor(texto) ||
                texto.includes(
                    normalizarTexto(
                        resultadoProfesor.profesor.nombre
                    )
                )
            )
        ) {

            const profesorEncontrado =
                resultadoProfesor.profesor;

            let respuesta;

            if (esProfesorFavorito(mensaje)) {

                respuesta =
                    `Entiendo. ${profesorEncontrado.nombre} aparece como el profesor que mencionaste como favorito.\n\n` +
                    obtenerRespuestaProfesor(
                        profesorEncontrado
                    );

            } else {

                respuesta =
                    `Sí, te refieres a ${profesorEncontrado.nombre}.\n\n` +
                    obtenerRespuestaProfesor(
                        profesorEncontrado
                    );
            }

            return res.json({
                respuesta,
                tipo: 'profesor',
                profesor: profesorEncontrado
            });
        }

        /* =================================================
           CONSULTA GENERAL SOBRE PROFESORES
        ================================================= */

        if (esConsultaSobreProfesor(texto)) {

            const palabras =
                palabrasSignificativas(texto);

            const encontrados =
                profesores
                    .map(p => {

                        const contenido =
                            normalizarTexto(`
                                ${p.nombre || ''}
                                ${p.cuerpo_academico || ''}
                                ${p.laboratorio_enfoque || ''}
                                ${p.perfil_investigacion || ''}
                                ${p.linea_principal || ''}
                                ${p.tecnologias || ''}
                                ${p.orientacion_profesional || ''}
                            `);

                        let puntuacion = 0;

                        for (const palabra of palabras) {

                            if (
                                contenido
                                    .split(/\s+/)
                                    .includes(palabra)
                            ) {
                                puntuacion += 2;
                            }
                        }

                        return {
                            profesor: p,
                            puntuacion
                        };
                    })
                    .filter(
                        x => x.puntuacion > 0
                    )
                    .sort(
                        (a, b) =>
                            b.puntuacion -
                            a.puntuacion
                    )
                    .slice(0, 6);

            if (encontrados.length > 0) {

                const lista =
                    encontrados
                        .map(x =>
                            `• ${x.profesor.nombre} — ${
                                x.profesor.linea_principal ||
                                x.profesor.cuerpo_academico ||
                                'Investigación'
                            }`
                        )
                        .join('\n');

                return res.json({
                    respuesta:
                        `Encontré estos investigadores relacionados con tu consulta:\n\n${lista}\n\nPuedes abrir sus perfiles desde el Directorio de Investigadores.`,
                    tipo: 'profesores',
                    profesores:
                        encontrados.map(
                            x => x.profesor
                        )
                });
            }
        }

        /* =================================================
           RUTAS PROFESIONALES
        ================================================= */

        const resultadosRuta =
            rutas
                .map(ruta => {
                    const base = puntuarRuta(
                        mensaje,
                        ruta
                    );

                    const {
                        puntosExtra,
                        nombres
                    } = bonusPorMaterias(
                        ruta,
                        materiasCoincidentes,
                        materiaRutaRows
                    );

                    return {
                        ...base,
                        puntuacion:
                            base.puntuacion +
                            puntosExtra,
                        materiasCoincidentes: nombres
                    };
                })
                .sort((a, b) => {

                    if (
                        b.puntuacion !==
                        a.puntuacion
                    ) {
                        return (
                            b.puntuacion -
                            a.puntuacion
                        );
                    }

                    return (
                        a.ruta.id -
                        b.ruta.id
                    );
                })
                .filter(
                    r => r.puntuacion > 0
                )
                .slice(0, 3);

        if (resultadosRuta.length > 0) {

            const principal =
                resultadosRuta[0];

            let respuesta =
                `Por lo que mencionas, el área que parece tener mayor relación con tus intereses es:\n\n` +
                `${principal.ruta.titulo}\n\n` +
                `${principal.ruta.descripcion || ''}\n\n`;

            if (
                principal.coincidencias.length > 0
            ) {

                respuesta +=
                    `Conceptos relacionados: ${principal.coincidencias.slice(0, 5).join(', ')}.\n\n`;
            }

            if (
                principal.materiasCoincidentes &&
                principal.materiasCoincidentes.length > 0
            ) {

                respuesta +=
                    `Materias que influyen en esta recomendación: ${principal.materiasCoincidentes.join(', ')}.\n\n`;
            }

            if (
                principal.ruta.trabajos_sugeridos
            ) {

                const trabajos =
                    principal.ruta
                        .trabajos_sugeridos
                        .split(',')
                        .map(x => x.trim())
                        .filter(Boolean)
                        .slice(0, 4);

                if (trabajos.length > 0) {

                    respuesta +=
                        `Puestos relacionados:\n${trabajos.map(x => `• ${x}`).join('\n')}\n\n`;
                }
            }

            if (resultadosRuta.length > 1) {

                respuesta +=
                    'También podrías considerar:\n\n';

                resultadosRuta
                    .slice(1)
                    .forEach((r, index) => {

                        respuesta +=
                            `${index + 2}. ${r.ruta.titulo}\n` +
                            `${r.ruta.descripcion || ''}\n\n`;
                    });
            }

            const profesoresRelacionados = [];

            for (const resultado of resultadosRuta) {

                const profs =
                    await pool.query(`
                        SELECT p.*
                        FROM profesores p
                        JOIN profesor_ruta pr
                            ON p.id = pr.profesor_id
                        WHERE pr.ruta_id = $1
                        ORDER BY p.nombre ASC
                    `, [
                        resultado.ruta.id
                    ]);

                for (const p of profs.rows) {

                    if (
                        !profesoresRelacionados.some(
                            x => x.id === p.id
                        )
                    ) {
                        profesoresRelacionados.push(p);
                    }
                }
            }

            if (
                profesoresRelacionados.length > 0
            ) {

                respuesta +=
                    'Investigadores relacionados:\n';

                profesoresRelacionados
                    .slice(0, 6)
                    .forEach(p => {

                        respuesta +=
                            `• ${p.nombre}\n`;
                    });
            }

            return res.json({
                respuesta,
                tipo: 'orientacion',

                rutas:
                    resultadosRuta.map(r => ({
                        id: r.ruta.id,
                        titulo: r.ruta.titulo,
                        descripcion:
                            r.ruta.descripcion,
                        puntuacion:
                            r.puntuacion,
                        materiasCoincidentes:
                            r.materiasCoincidentes || []
                    })),

                profesores:
                    profesoresRelacionados
                        .slice(0, 6)
            });
        }

        /* =================================================
           LÍNEAS DE INVESTIGACIÓN
        ================================================= */

        const palabrasConsulta =
            palabrasSignificativas(texto);

        const lineasEncontradas =
            lineas
                .map(linea => {

                    const contenido =
                        normalizarTexto(`
                            ${linea.nombre || ''}
                            ${linea.descripcion || ''}
                        `);

                    let puntuacion = 0;

                    for (
                        const palabra
                        of palabrasConsulta
                    ) {

                        if (
                            contenido
                                .split(/\s+/)
                                .includes(palabra)
                        ) {
                            puntuacion += 1;
                        }
                    }

                    return {
                        linea,
                        puntuacion
                    };
                })
                .filter(
                    x => x.puntuacion > 0
                )
                .sort(
                    (a, b) =>
                        b.puntuacion -
                        a.puntuacion
                )
                .slice(0, 5);

        if (lineasEncontradas.length > 0) {

            const lista =
                lineasEncontradas
                    .map(x =>
                        `• ${x.linea.nombre}${
                            x.linea.descripcion
                                ? ` — ${x.linea.descripcion}`
                                : ''
                        }`
                    )
                    .join('\n');

            return res.json({
                respuesta:
                    `Encontré líneas de investigación relacionadas con tu consulta:\n\n${lista}\n\nPuedes consultar los perfiles de los investigadores desde el directorio.`,
                tipo: 'investigacion'
            });
        }

        /* =================================================
           PUBLICACIONES
        ================================================= */

        const publicacionesEncontradas =
            publicaciones
                .map(pub => {

                    const contenido =
                        normalizarTexto(`
                            ${pub.titulo || ''}
                            ${pub.revista || ''}
                            ${pub.autores || ''}
                        `);

                    let puntuacion = 0;

                    for (
                        const palabra
                        of palabrasConsulta
                    ) {

                        if (
                            contenido
                                .split(/\s+/)
                                .includes(palabra)
                        ) {
                            puntuacion += 1;
                        }
                    }

                    return {
                        pub,
                        puntuacion
                    };
                })
                .filter(
                    x => x.puntuacion > 0
                )
                .sort(
                    (a, b) =>
                        b.puntuacion -
                        a.puntuacion
                )
                .slice(0, 5);

        if (
            publicacionesEncontradas.length > 0
        ) {

            const lista =
                publicacionesEncontradas
                    .map(x =>
                        `• ${x.pub.titulo}${
                            x.pub.año
                                ? ` (${x.pub.año})`
                                : ''
                        }`
                    )
                    .join('\n');

            return res.json({
                respuesta:
                    `Encontré publicaciones relacionadas con tu consulta:\n\n${lista}`,
                tipo: 'publicaciones'
            });
        }

        /* =================================================
           SIN RESULTADO
        ================================================= */

        return res.json({
            respuesta:
                'No encontré una coincidencia suficientemente clara con la información disponible.\n\n' +
                'Puedes escribirme algo más específico, por ejemplo:\n\n' +
                '• "Me gustan las clases de Marcela Mejía."\n' +
                '• "Mi profesor favorito es Alfonso."\n' +
                '• "Me interesa programación y Python."\n' +
                '• "Me gustan los robots, sensores y control PID."\n' +
                '• "Me interesa óptica y láseres."\n' +
                '• "¿Qué profesores trabajan con espectroscopia?"',
            tipo: 'sin_resultado'
        });

    } catch (err) {

        console.error(
            'Error en el bot:',
            err
        );

        res.status(500).json({
            error:
                'No fue posible procesar la consulta del bot.'
        });
    }
});

/* =========================================================
   SERVIDOR
========================================================= */

const PUERTO = process.env.PORT || 3000;

app.listen(PUERTO, () => {

    console.log('');
    console.log('==========================================');
    console.log('Servidor corriendo correctamente');
    console.log(`http://localhost:${PUERTO}`);
    console.log('==========================================');
    console.log('');
});