const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

let _s3 = null;

function s3() {
  if (!_s3) {
    _s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    });
  }
  return _s3;
}

const MIMES_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const LIMITE_UPLOAD = 5 * 1024 * 1024; // 5 MB

async function uploadBase64(dataURL) {
  if (!dataURL) return null;
  if (!String(dataURL).startsWith('data:')) return dataURL; // já é URL pública
  const m = /^data:(image\/[\w+]+);base64,(.+)$/.exec(dataURL);
  if (!m) return null;
  const mime = m[1];
  if (!MIMES_PERMITIDOS.has(mime)) {
    throw Object.assign(new Error('Formato de imagem não permitido. Use JPEG, PNG, WebP ou GIF.'), { status: 400 });
  }
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > LIMITE_UPLOAD) {
    throw Object.assign(new Error('Imagem maior que 5 MB.'), { status: 400 });
  }
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
  const chave = `fotos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await s3().send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: chave,
    Body: buffer,
    ContentType: mime
  }));
  return `${(process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')}/${chave}`;
}

module.exports = { uploadBase64 };
