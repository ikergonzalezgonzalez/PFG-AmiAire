const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// Conexión a MongoDB
mongoose.connect('mongodb://localhost:27017/calidad_aire', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('Conectado a MongoDB'))
.catch(err => console.error('Error de conexión a MongoDB:', err));

// Modelo del Sensor
const sensorSchema = new mongoose.Schema({

    'Fecha de inicio': String,
    'Fecha de recogida': String,
    'Localización longitud': Number,
    'Localización latitud': Number,
    'Número de contornos detectados': Number,
    'Porcentaje de área detectada': Number,
    'Concentración estándar': Number,
    'Nivel de polución': String,
    'Imagen de entrada': String
}, {
    collection: 'sensores' // Importante si tu colección no se llama "sensors"
});
const Sensor = mongoose.model('Sensor', sensorSchema);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Para parsear form-data

// Configuración para servir archivos estáticos (IMPORTANTE)
app.use(express.static(path.join(__dirname, '../AmiAire')));

// Configuración de Multer para subir imágenes
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 } // Límite de 10MB
});

// Ruta principal para servir el frontend (NUEVO)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../AmiAire/index.html'));
});

// Rutas de la API
// Ruta para obtener todos los sensores
app.get('/api/sensores', async (req, res) => {
    try {
        console.log('Obteniendo lista de sensores...');
        
        // Obtener todos los sensores de la colección
        const sensores = await Sensor.find({}, { 'Imagen de entrada': 0 }).lean();
        
        if (!sensores || sensores.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No se encontraron sensores en la base de datos'
            });
        }

        // Formatear la respuesta
        const respuesta = {
            success: true,
            count: sensores.length,
            data: sensores.map(sensor => ({
                id: sensor._id,
                fechaInicio: sensor['Fecha de inicio'],
                fechaRecogida: sensor['Fecha de recogida'],
                ubicacion: {
                    latitud: sensor['Localización latitud'],
                   
                    longitud: sensor['Localización longitud']
                },
                metricas: {
                    contornos: sensor['Número de contornos detectados'],
                    areaDetectada: sensor['Porcentaje de área detectada'],
                    concentracion: sensor['Concentración estándar']
                },
                nivelPolucion: sensor['Nivel de polución'],
                tieneImagen: sensor.tieneImagen
            }))
        };

        console.log(`Enviando ${sensores.length} sensores`);
        res.json(respuesta);

    } catch (err) {
        console.error('Error al obtener sensores:', err);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

app.get('/api/sensores/:id', async (req, res) => {
    try {
        const sensor = await Sensor.findById(req.params.id);
        if (!sensor) {
            return res.status(404).json({ error: 'Sensor no encontrado' });
        }
        res.json(sensor);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/sensores/:id/imagen', async (req, res) => {
  try {
    const sensor = await Sensor.findById(req.params.id, 'Imagen de entrada').lean();
    if (!sensor || !sensor['Imagen de entrada']) {
      return res.status(404).json({ error: 'Imagen no encontrada' });
    }
    res.json({ id: req.params.id, base64: sensor['Imagen de entrada'] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/imagenes', async (req, res) => {
  try {
    const ids = (req.query.ids || '').split(',').filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'ids query param requerido' });

    // Traemos sólo la imagen
    const docs = await Sensor.find(
      { _id: { $in: ids } },
      { 'Imagen de entrada': 1 }          // proyección
    ).lean();

    const out = docs
      .filter(d => d['Imagen de entrada'])
      .map(d => ({ id: d._id.toString(), base64: d['Imagen de entrada'] }));

    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener imágenes' });
  }
});

app.post('/api/sensores', upload.single('imagen'), async (req, res) => {
    try {
        // 1. Validación mejorada de campos
        const camposRequeridos = {
            'fecha-inicio': 'Fecha de inicio',
            'fecha-recogida': 'Fecha de recogida',
            'longitud': 'Longitud',
            'latitud': 'Latitud'
        };

        const errores = [];
        Object.entries(camposRequeridos).forEach(([key, nombre]) => {
            if (!req.body[key]) {
                errores.push(`El campo ${nombre} es requerido`);
            }
        });

        // Validar coordenadas numéricas
        if (req.body.longitud && isNaN(parseFloat(req.body.longitud))) {
            errores.push('Longitud debe ser un número válido');
        }
        
        if (req.body.latitud && isNaN(parseFloat(req.body.latitud))) {
            errores.push('Latitud debe ser un número válido');
        }

        if (errores.length > 0) {
            return res.status(400).json({ 
                error: 'Error de validación',
                detalles: errores 
            });
        }

        // 2. Manejo de imagen mejorado
        let imagenBase64 = '';
        if (req.file) {
            try {
                // Validar tipo de imagen
                const mimeTypesPermitidos = ['image/jpeg', 'image/png', 'image/gif'];
                if (!mimeTypesPermitidos.includes(req.file.mimetype)) {
                    throw new Error('Tipo de archivo no permitido');
                }

                // Leer y convertir imagen
                const imageBuffer = fs.readFileSync(req.file.path);
                imagenBase64 = imageBuffer.toString('base64');
                
                // Eliminar archivo temporal
                await fs.promises.unlink(req.file.path);

            } catch (error) {
                console.error('Error procesando imagen:', error);
                return res.status(400).json({ 
                    error: 'Error al procesar la imagen',
                    detalles: error.message 
                });
            }
        }

        // 3. Cálculo de polución más preciso
        const calcularNivelPolucion = (concentracion) => {
            if (concentracion > 150) return "Nivel de polución Extremo, mas de 150 μg/m³";
            if (concentracion > 100) return "Nivel de polución Alto, entre 100-150 μg/m³";
            if (concentracion > 50) return "Nivel de polución Moderado, entre 50-100 μg/m³";
            return "Nivel de polución Bajo, menos de 50 μg/m³";
        };

        // 4. Creación del sensor con validación adicional
        const nuevoSensor = new Sensor({
            'Fecha de inicio': req.body['fecha-inicio'],
            'Fecha de recogida': req.body['fecha-recogida'],
            'Localización longitud': parseFloat(req.body.longitud),
            'Localización latitud': parseFloat(req.body.latitud),
            'Número de contornos detectados': req.body['contornos'] || Math.floor(Math.random() * 5000),
            'Porcentaje de área detectada': req.body['area-detectada'] || parseFloat((Math.random() * 5).toFixed(6)),
            'Concentración estándar': req.body['concentracion'] 
    ? parseFloat(req.body['concentracion']) 
    : parseFloat((Math.random() * 200).toFixed(2)),

            'Nivel de polución': calcularNivelPolucion(req.body['concentracion'] || Math.random() * 200),
            'Imagen de entrada': imagenBase64,
            'Fecha_creacion': new Date() // Campo adicional para tracking
        });

        // 5. Guardar con manejo de errores específico
        const sensorGuardado = await nuevoSensor.save();
        
        // 6. Respuesta exitosa con datos relevantes
        res.status(201).json({
            success: true,
            sensor: {
                id: sensorGuardado._id,
                ubicacion: {
                    latitud: sensorGuardado['Localización latitud'],
                    longitud: sensorGuardado['Localización longitud']
                },
                fechas: {
                    inicio: sensorGuardado['Fecha de inicio'],
                    fin: sensorGuardado['Fecha de recogida']
                },
                nivel_polucion: sensorGuardado['Nivel de polución'],
                tiene_imagen: !!sensorGuardado['Imagen de entrada']
            }
        });

    } catch (err) {
        console.error('Error al crear sensor:', err);
        
        // Manejo específico de errores de MongoDB
        if (err.name === 'ValidationError') {
            const errores = Object.values(err.errors).map(e => e.message);
            return res.status(400).json({ 
                error: 'Error de validación de datos',
                detalles: errores 
            });
        }
        
        res.status(500).json({ 
            error: 'Error interno del servidor',
            detalles: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Manejo de errores (NUEVO)
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Algo salió mal!');
});

// Ruta de fallback para SPA (NUEVO)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../AmiAire/index.html'));
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log(`Rutas disponibles:`);
    console.log(`- GET /             -> Frontend principal`);
    console.log(`- GET /api/sensores -> Obtener todos los sensores`);
    console.log(`- POST /api/sensores -> Crear nuevo sensor`);
});