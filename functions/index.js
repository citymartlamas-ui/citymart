const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

// Inicializa la app de administración (necesario para consultar Firestore y enviar mensajes)
admin.initializeApp();

exports.notificarNoticiaAprobada = functions.firestore.document("noticias/{noticiaId}").onUpdate(async (change, context) => {
    const dataAnterior = change.before.data();
    const dataNueva = change.after.data();

    // Comprobamos que el cambio es específicamente: Pasa de 'pendiente' a 'aprobado'
    if (dataNueva.estado === 'aprobado' && dataAnterior.estado !== 'aprobado') {

        const tituloNoticia = dataNueva.titulo || "Nueva Noticia en CityMart";
        const contenidoBruto = dataNueva.contenido || dataNueva.texto || "Ingresa a la app para descubrir de qué se trata.";

        // Limpiar un poco el texto de etiquetas HTML
        let cuerpoLimpio = contenidoBruto.replace(/<[^>]+>/g, '').trim();
        cuerpoLimpio = cuerpoLimpio.length > 80 ? cuerpoLimpio.substring(0, 80) + "..." : cuerpoLimpio;

        const imagenLogo = dataNueva.imagen || "https://usuarios-citymart-lamas.web.app/assets/logo.png";
        const enlaceNoticia = `https://usuarios-citymart-lamas.web.app/news_detail.html?id=${context.params.noticiaId}`;

        console.log(`Enviando notificación para noticia: ${tituloNoticia}`);

        // ========== SISTEMA DE ALERTAS INTERNAS ==========
        // Guardar alerta en Firestore para que TODOS los usuarios la vean (sin depender de Push)
        try {
            await admin.firestore().collection("alertas").add({
                titulo: tituloNoticia,
                resumen: cuerpoLimpio,
                imagen: imagenLogo,
                enlace: `news_detail.html?id=${context.params.noticiaId}`,
                noticiaId: context.params.noticiaId,
                tipo: 'noticia',
                fecha: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log("Alerta interna guardada correctamente.");
        } catch (alertaError) {
            console.error("Error guardando alerta interna:", alertaError);
        }

        try {
            // Obtener todos los tokens guardados (los usuarios que permitieron notificaciones)
            const tokensSnap = await admin.firestore().collection("fcmTokens").get();
            if (tokensSnap.empty) {
                console.log("No hay usuarios registrados para recibir notificaciones (colección vacía).");
                return null;
            }

            const tokensHabilitados = [];
            tokensSnap.forEach(doc => {
                const token = doc.id;
                tokensHabilitados.push(token);
            });

            if (tokensHabilitados.length === 0) return null;

            // Formato de Mensaje Firebase Cloud Messaging (FCM)
            const mensajeMulticast = {
                notification: {
                    title: "🔔 " + tituloNoticia,
                    body: cuerpoLimpio,
                    image: imagenLogo
                },
                data: {
                    link: enlaceNoticia,
                    noticiaId: context.params.noticiaId
                },
                webpush: {
                    fcmOptions: {
                        link: enlaceNoticia
                    },
                    notification: {
                        icon: "https://usuarios-citymart-lamas.web.app/assets/logo.png",
                        click_action: enlaceNoticia
                    }
                },
                tokens: tokensHabilitados
            };

            // Enviar el lote a todos los tokens
            const respuesta = await admin.messaging().sendEachForMulticast(mensajeMulticast);
            console.log(`Se completó el envío. Éxitos: ${respuesta.successCount}, Fallos: ${respuesta.failureCount}`);

            // Limpieza Automática de Tokens Expirados
            if (respuesta.failureCount > 0) {
                const tokensParaBorrar = [];
                respuesta.responses.forEach((resp, index) => {
                    if (!resp.success) {
                        const errorCode = resp.error.code;
                        if (errorCode === 'messaging/invalid-registration-token' ||
                            errorCode === 'messaging/registration-token-not-registered') {
                            tokensParaBorrar.push(tokensHabilitados[index]);
                        }
                    }
                });

                // Ejecutamos limpieza asincrónica de la BD
                for (const t of tokensParaBorrar) {
                    await admin.firestore().collection("fcmTokens").doc(t).delete().catch(e => console.log("Fallo al borrar token", e));
                }
                console.log(`Limpieza completada: Se borraron ${tokensParaBorrar.length} tokens muertos.`);
            }

            return null;

        } catch (error) {
            console.error("Error crítico enviando notificaciones:", error);
            return null;
        }
    }
});
