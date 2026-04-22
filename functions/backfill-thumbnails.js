const admin = require("firebase-admin");
const sharp = require("sharp");
const path = require("path");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
const THUMB_WIDTH = 560;
const THUMB_HEIGHT = 560;
const THUMB_QUALITY = 68;
const THUMB_FORMAT = "webp";
const THUMB_CONTENT_TYPE = "image/webp";

admin.initializeApp({
  storageBucket: "usuarios-citymart-lamas.appspot.com",
});

function buildDownloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

async function updateDocByField(collectionName, fieldName, filePath, payload) {
  const snap = await admin.firestore().collection(collectionName).where(fieldName, "==", filePath).limit(50).get();
  if (snap.empty) return 0;

  const writes = [];
  snap.forEach((docSnap) => {
    writes.push(docSnap.ref.set(payload, { merge: true }));
  });
  await Promise.all(writes);
  return writes.length;
}

function getTargets(filePath, thumbUrl, thumbStoragePath) {
  if (filePath.startsWith("promociones/")) {
    return [
      updateDocByField("promociones", "imagen_path", filePath, {
        imagen_thumb: thumbUrl,
        imagen_thumb_path: thumbStoragePath,
      }),
    ];
  }

  if (filePath.startsWith("noticias/")) {
    return [
      updateDocByField("noticias", "imagen_path", filePath, {
        imagen_thumb: thumbUrl,
        imagen_thumb_path: thumbStoragePath,
      }),
    ];
  }

  if (filePath.startsWith("negocios/")) {
    return [
      updateDocByField("negocio", "foto_path", filePath, {
        foto_thumb: thumbUrl,
        foto_thumb_path: thumbStoragePath,
      }),
      updateDocByField("negocio", "imagen_path", filePath, {
        imagen_thumb: thumbUrl,
        imagen_thumb_path: thumbStoragePath,
      }),
    ];
  }

  if (filePath.startsWith("lost_found/")) {
    return [
      updateDocByField("comunidad_lostfound", "photo_path", filePath, {
        photo_thumb: thumbUrl,
        photo_thumb_path: thumbStoragePath,
      }),
    ];
  }

  if (filePath.startsWith("users/")) {
    const userId = filePath.split("/")[1];
    if (!userId) return [];
    return [
      admin.firestore().collection("users").doc(userId).set({
        photoURL_thumb: thumbUrl,
        photo_thumb_path: thumbStoragePath,
      }, { merge: true }),
    ];
  }

  return [];
}

async function processFile(bucket, file) {
  const filePath = file.name;
  const [metadata] = await file.getMetadata();
  const contentType = metadata.contentType || "";

  if (!contentType.startsWith("image/")) return { skipped: true, reason: "not-image" };
  if (path.basename(filePath).startsWith("thumb_")) return { skipped: true, reason: "thumb" };

  const fileName = path.basename(filePath);
  const dirName = path.dirname(filePath);
  const thumbFileName = `thumb_${fileName.replace(/\.[^/.]+$/, "")}.${THUMB_FORMAT}`;
  const thumbStoragePath = dirName === "." ? thumbFileName : `${dirName}/${thumbFileName}`;
  const tempOriginalPath = path.join(os.tmpdir(), `orig_${Date.now()}_${fileName}`);
  const tempThumbPath = path.join(os.tmpdir(), `thumb_${Date.now()}_${thumbFileName}`);

  try {
    const thumbFile = bucket.file(thumbStoragePath);
    const [thumbExists] = await thumbFile.exists();

    if (!thumbExists) {
      await file.download({ destination: tempOriginalPath });

      await sharp(tempOriginalPath)
        .rotate()
        .resize({ width: THUMB_WIDTH, height: THUMB_HEIGHT, fit: "cover", withoutEnlargement: true })
        .webp({ quality: THUMB_QUALITY })
        .toFile(tempThumbPath);

      const token = crypto.randomUUID();
      await bucket.upload(tempThumbPath, {
        destination: thumbStoragePath,
        metadata: {
          contentType: THUMB_CONTENT_TYPE,
          metadata: {
            firebaseStorageDownloadTokens: token,
            sourcePath: filePath,
          },
          cacheControl: "public,max-age=31536000",
        },
      });
    }

    const [thumbMeta] = await thumbFile.getMetadata();
    const token = thumbMeta.metadata?.firebaseStorageDownloadTokens || crypto.randomUUID();

    if (!thumbMeta.metadata?.firebaseStorageDownloadTokens) {
      await thumbFile.setMetadata({
        metadata: {
          ...(thumbMeta.metadata || {}),
          firebaseStorageDownloadTokens: token,
          sourcePath: filePath,
        },
      });
    }

    const thumbUrl = buildDownloadUrl(bucket.name, thumbStoragePath, token);
    const updates = getTargets(filePath, thumbUrl, thumbStoragePath);
    await Promise.all(updates);

    return { skipped: false, thumbStoragePath };
  } finally {
    if (fs.existsSync(tempOriginalPath)) fs.unlinkSync(tempOriginalPath);
    if (fs.existsSync(tempThumbPath)) fs.unlinkSync(tempThumbPath);
  }
}

async function main() {
  const bucket = admin.storage().bucket();
  const roots = ["negocios", "promociones", "noticias", "lost_found", "users"];

  let processed = 0;
  let skipped = 0;

  for (const root of roots) {
    console.log(`\n[Backfill] Revisando ${root}/ ...`);
    const [files] = await bucket.getFiles({ prefix: `${root}/` });

    for (const file of files) {
      try {
        const result = await processFile(bucket, file);
        if (result.skipped) {
          skipped += 1;
          continue;
        }
        processed += 1;
        console.log(`[OK] ${file.name} -> ${result.thumbStoragePath}`);
      } catch (error) {
        console.error(`[ERROR] ${file.name}:`, error.message);
      }
    }
  }

  console.log(`\n[Backfill] Terminado. Procesadas: ${processed}. Omitidas: ${skipped}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[Backfill] Fallo general:", error);
    process.exit(1);
  });
